/**
 * Test de bout en bout : on lance le vrai serveur en sous-process et on lui
 * parle avec le client officiel, exactement comme Claude Desktop ou Cursor.
 *
 * On couvre les deux "ères" du protocole :
 * - legacy (2025-11-25, handshake `initialize`) : ce que parlent la plupart
 *   des clients aujourd'hui ;
 * - modern (2026-07-28, stateless, `server/discover`).
 */

import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { EmployerCostOutput } from '../src/tools/employer-cost.js'
import type { GrossToNetOutput } from '../src/tools/gross-to-net.js'
import type { IncomeTaxEstimateOutput } from '../src/tools/income-tax-estimate.js'

const root = fileURLToPath(new URL('..', import.meta.url))

type Mode = 'legacy' | { pin: string }

async function connect(mode: Mode): Promise<Client> {
  const client = new Client({ name: 'test-e2e', version: '0.0.0' }, { versionNegotiation: { mode } })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/stdio.ts'],
    cwd: root,
    stderr: 'ignore',
  })
  await client.connect(transport)
  return client
}

for (const [name, mode] of [
  ['legacy 2025-11-25', 'legacy'],
  ['modern 2026-07-28', { pin: '2026-07-28' }],
] as const satisfies ReadonlyArray<readonly [string, Mode]>) {
  describe(`stdio — ${name} era`, () => {
    let client: Client
    after(() => client?.close())

    test('tools/list exposes the three tools in a deterministic order', async () => {
      client = await connect(mode)
      const { tools } = await client.listTools()
      assert.deepEqual(
        tools.map((t) => t.name),
        ['gross_to_net', 'employer_cost', 'income_tax_estimate'],
      )
      for (const tool of tools) {
        assert.deepEqual(tool.inputSchema.required, ['gross_salary'], `${tool.name}: required inputs`)
        assert.ok(tool.outputSchema, `${tool.name}: missing outputSchema`)
        assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name}: readOnlyHint`)
      }
    })

    test('tools/call returns a structured, sourced result', async () => {
      const res = await client.callTool({ name: 'gross_to_net', arguments: { gross_salary: 3000 } })
      assert.notEqual(res.isError, true)
      const data = res.structuredContent as GrossToNetOutput
      assert.equal(data.net_before_income_tax, 2352.85)
      assert.equal(data.period, 'monthly')
      assert.equal(data.source.year, 2026)
      assert.match(data.source.documentation, /^https:\/\/mon-entreprise\.urssaf\.fr\/documentation\//)
    })

    test('employer_cost returns cost, reduction and the known-issue warning', async () => {
      const res = await client.callTool({
        name: 'employer_cost',
        arguments: { gross_salary: 3200, is_executive: true },
      })
      const data = res.structuredContent as EmployerCostOutput
      assert.equal(data.total_employer_cost, 4360.22)
      assert.equal(data.general_reduction, 281.6)
      assert.equal(data.warnings.length, 1)
    })

    test('income_tax_estimate returns household tax and net after tax', async () => {
      const res = await client.callTool({
        name: 'income_tax_estimate',
        arguments: {
          gross_salary: 3200,
          is_executive: true,
          family_situation: 'couple',
          dependent_children: 2,
          other_taxable_income: 30000,
        },
      })
      const data = res.structuredContent as IncomeTaxEstimateOutput
      assert.equal(data.tax_shares, 3)
      assert.equal(data.annual_income_tax, 2352)
      assert.equal(data.net_after_income_tax, 2404.58)
    })

    test('an invalid argument is rejected before reaching the handler', async () => {
      const res = await client.callTool({ name: 'gross_to_net', arguments: { gross_salary: -10 } })
      assert.equal(res.isError, true)
    })
  })
}
