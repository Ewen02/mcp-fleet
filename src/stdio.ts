#!/usr/bin/env node
/**
 * Point d'entrée local : le client (Claude Desktop, Cursor, Inspector…)
 * lance ce process et lui parle via stdin/stdout.
 *
 * Règle d'or : stdout est réservé au JSON-RPC. Tout log passe par stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { logger } from './logger.js'
import { createServer, SERVER_INFO } from './server.js'

const handle = serveStdio(createServer)

logger.info('server_started', { transport: 'stdio', version: SERVER_INFO.version })

const shutdown = async (): Promise<void> => {
  await handle.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
