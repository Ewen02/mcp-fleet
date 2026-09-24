/**
 * Contrat public du serveur, figé par snapshot : ce que voit le modèle
 * (noms, descriptions, JSON Schema d'entrée et de sortie, annotations) et
 * ce qu'il reçoit (texte + structuredContent) pour des appels représentatifs.
 *
 * Pourquoi ? Le kit est partagé par plusieurs serveurs : un changement dans
 * un schéma commun, une montée de zod ou du SDK peut modifier le contrat de
 * tous les serveurs sans qu'aucun test de valeur ne casse. Ici, toute
 * différence fait échouer le test : un changement de contrat doit être une
 * décision, comme une montée de version des règles.
 *
 * Snapshot initial généré après avoir vérifié l'égalité octet pour octet
 * avec la v0.4.0 (tools/list + 20 appels, dans les deux ères du protocole).
 *
 * Changement voulu :  pnpm --filter mcp-paie-fr test:update-contract
 * puis relire le diff de test/contract.test.ts.snapshot avant de commiter.
 */

import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createHttpApp, createLogger, type HttpApp } from '@repo/mcp-kit'
import { definition } from '../src/server.js'

let app: HttpApp
let client: Client

before(async () => {
  app = createHttpApp(definition, {
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    trustProxy: false,
    rateLimitPerMinute: 0,
    maxBodyBytes: 64 * 1024,
    logger: createLogger('silent'),
  })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const { port } = app.server.address() as AddressInfo
  client = new Client({ name: 'contract', version: '0' }, { versionNegotiation: { mode: 'legacy' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
})

after(async () => {
  await client.close()
  await app.close()
})

test('tools/list: names, descriptions, schemas and annotations', async (t) => {
  const { tools } = await client.listTools()
  t.assert.snapshot(tools)
})

const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['gross_to_net', { gross_salary: 3000 }],
  ['employer_cost', { gross_salary: 3200, is_executive: true }],
  ['employer_cost', { gross_salary: 3200, company_headcount: 50 }],
  [
    'income_tax_estimate',
    {
      gross_salary: 3200,
      is_executive: true,
      family_situation: 'couple',
      dependent_children: 2,
      other_taxable_income: 30000,
    },
  ],
  ['gross_to_net', { gross_salary: -10 }],
]

for (const [name, args] of CALLS) {
  test(`${name} ${JSON.stringify(args)}`, async (t) => {
    // `_meta` porte la version du serveur : elle change à chaque release sans
    // que le contrat change.
    const { _meta, ...result } = await client.callTool({ name, arguments: args })
    t.assert.snapshot(result)
  })
}
