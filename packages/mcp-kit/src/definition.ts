/**
 * Contrat entre le kit et un serveur MCP.
 *
 * Le kit fournit tout ce qui est commun (transports, garde-fous, logs,
 * télémétrie) et ne sait RIEN du métier. Ce qui dépend du domaine lui est
 * injecté par le serveur à travers cet objet : son identité, sa factory MCP
 * et ce qu'il veut ajouter à la sonde de santé.
 *
 * Sens des dépendances : un serveur importe le kit, jamais l'inverse.
 * pnpm le garantit (le kit ne déclare aucun serveur dans ses dépendances,
 * donc il ne peut pas en importer un).
 */
import type { McpServer } from '@modelcontextprotocol/server'

export interface ServerInfo {
  name: string
  version: string
}

export interface McpServerDefinition {
  /** Nom et version annoncés aux clients MCP, dans les logs et sur GET /health. */
  info: ServerInfo
  /**
   * Factory appelée à chaque connexion (stdio) ou à chaque requête (HTTP
   * stateless). Elle doit rester peu coûteuse et sans état : le travail
   * lourd (ex. parsing de règles) se fait une fois, au chargement du module.
   */
  createServer: () => McpServer
  /** Champs métier ajoutés à la réponse de GET /health (ex. millésime des règles). */
  health?: () => Record<string, unknown>
}
