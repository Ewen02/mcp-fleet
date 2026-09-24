/**
 * Définition du serveur paie-fr : son identité, sa factory MCP et ce qu'il
 * ajoute à la sonde de santé. C'est tout ce que le kit reçoit de lui.
 *
 * Pourquoi une factory plutôt qu'une instance unique ? Le SDK v2 crée un
 * McpServer par connexion (stdio) ou par requête (HTTP stateless). La
 * factory doit donc être peu coûteuse et sans état : le travail lourd
 * (parsing des règles) est fait une fois, au chargement de domain/engine.ts.
 *
 * Les deux points d'entrée (stdio.ts et http.ts) passent cette même
 * définition au kit : un seul endroit déclare ce que le serveur sait faire.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { type McpServerDefinition, readServerInfo } from '@repo/mcp-kit'
import { RULES_SOURCE } from './domain/engine.js'
import { registerEmployerCost } from './tools/employer-cost.js'
import { registerGrossToNet } from './tools/gross-to-net.js'
import { registerIncomeTaxEstimate } from './tools/income-tax-estimate.js'

// `../package.json` pointe au même endroit depuis src/ comme depuis dist/.
export const SERVER_INFO = readServerInfo(new URL('../package.json', import.meta.url))

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

export const definition: McpServerDefinition = {
  info: SERVER_INFO,
  createServer,
  // Le millésime des règles sur /health : on voit d'un coup d'œil quelle
  // version du moteur URSSAF tourne en production.
  health: () => ({
    rules: {
      modele_social_version: RULES_SOURCE.modele_social_version,
      reference_date: RULES_SOURCE.reference_date,
    },
  }),
}
