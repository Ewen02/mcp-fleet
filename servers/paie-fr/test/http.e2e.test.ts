/**
 * Test de bout en bout du serveur paie-fr en HTTP : sa définition est
 * branchée sur l'application HTTP du kit, démarrée sur un port aléatoire,
 * et le client officiel lui parle en Streamable HTTP, comme un connecteur
 * distant (Claude, ChatGPT, Cursor).
 *
 * Les garde-fous HTTP (Host, Origin, taille, limite de débit, arrêt propre)
 * sont de l'infrastructure : ils sont testés dans packages/mcp-kit.
 */

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createHttpApp, createLogger, type HttpApp } from '@repo/mcp-kit'
import { definition } from '../src/server.js'
import type { GrossToNetOutput } from '../src/tools/gross-to-net.js'

let app: HttpApp
let baseUrl: string

before(async () => {
  app = createHttpApp(definition, {
    allowedHosts: ['localhost', '127.0.0.1'],
    allowedOrigins: [],
    trustProxy: false,
    rateLimitPerMinute: 0,
    maxBodyBytes: 64 * 1024,
    logger: createLogger('silent'),
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const { port } = app.server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(() => app.close())

type Mode = 'legacy' | { pin: string }

for (const [name, mode] of [
  ['legacy 2025-11-25', 'legacy'],
  ['modern 2026-07-28', { pin: '2026-07-28' }],
] as const satisfies ReadonlyArray<readonly [string, Mode]>) {
  describe(`http — ${name} era`, () => {
    let client: Client
    after(() => client?.close())

    test('tools/list exposes the three tools', async () => {
      client = new Client({ name: 'test-http', version: '0.0.0' }, { versionNegotiation: { mode } })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))
      const { tools } = await client.listTools()
      assert.deepEqual(
        tools.map((t) => t.name),
        ['gross_to_net', 'employer_cost', 'income_tax_estimate'],
      )
    })

    test('tools/call works over HTTP', async () => {
      const res = await client.callTool({ name: 'gross_to_net', arguments: { gross_salary: 3000 } })
      const data = res.structuredContent as GrossToNetOutput
      assert.equal(data.net_before_income_tax, 2352.85)
      assert.equal(data.source.year, 2026)
    })
  })
}

describe('http — health', () => {
  test('GET /health returns the version and the rules vintage', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      status: string
      name: string
      rules: { modele_social_version: string; reference_date: string }
    }
    assert.equal(body.status, 'ok')
    assert.equal(body.name, 'mcp-paie-fr')
    assert.equal(body.rules.modele_social_version, '11.1.0')
    assert.equal(body.rules.reference_date, '2026-07-01')
  })
})
