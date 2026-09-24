/**
 * Point d'entrée local d'un serveur : le client (Claude Desktop, Cursor,
 * Inspector…) lance le process et lui parle via stdin/stdout.
 *
 * Usage, dans le `src/stdio.ts` d'un serveur :  runStdio(definition)
 *
 * Règle d'or : stdout est réservé au JSON-RPC. Tout log passe par stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { McpServerDefinition } from './definition.js'
import { logger } from './logger.js'

export function runStdio(definition: McpServerDefinition): void {
  const handle = serveStdio(definition.createServer)

  logger.info('server_started', { transport: 'stdio', version: definition.info.version })

  const shutdown = async (): Promise<void> => {
    await handle.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
