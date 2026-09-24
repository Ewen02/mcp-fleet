/**
 * Factory du serveur MCP : assemble les tools, ne fait rien d'autre.
 *
 * Pourquoi une factory plutôt qu'une instance unique ? Le SDK v2 crée un
 * McpServer par connexion (stdio) ou par requête (HTTP stateless). La
 * factory doit donc être peu coûteuse et sans état : le travail lourd
 * (parsing des règles) est fait une fois, au chargement de domain/engine.ts.
 *
 * Les transports (stdio.ts et http-app.ts) importent tous cette même
 * factory : un seul endroit déclare ce que le serveur sait faire.
 */
import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { registerEmployerCost } from './tools/employer-cost.js'
import { registerGrossToNet } from './tools/gross-to-net.js'
import { registerIncomeTaxEstimate } from './tools/income-tax-estimate.js'

// Une seule source de vérité pour la version : package.json. Lu à l'exécution
// (et validé) plutôt qu'importé : il est hors de rootDir pour le build, et
// `../package.json` pointe au même endroit depuis src/ comme depuis dist/.
const pkg = z
  .object({ name: z.string(), version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')))

export const SERVER_INFO = { name: pkg.name, version: pkg.version } as const

export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'French payroll and income tax calculations, based on the open-source URSSAF engine. ' +
      'Amounts are estimates: always cite the returned assumptions, warnings and source.',
  })

  // L'ordre d'enregistrement est l'ordre de tools/list : la spec 2026 demande
  // un ordre déterministe (cache côté client et cache de prompt du LLM).
  registerGrossToNet(server)
  registerEmployerCost(server)
  registerIncomeTaxEstimate(server)

  return server
}
