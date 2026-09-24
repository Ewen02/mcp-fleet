#!/usr/bin/env node
/**
 * Point d'entrée distant : charge la configuration, démarre le serveur HTTP,
 * gère le cycle de vie du process. Tout le reste est dans http-app.ts.
 *
 * Variables d'environnement : voir src/config.ts et DEPLOY.md.
 */
import { loadHttpConfig } from './config.js'
import { createHttpApp } from './http-app.js'
import { logger } from './logger.js'
import { SERVER_INFO } from './server.js'

// Une erreur non rattrapée laisse le process dans un état inconnu : on la
// journalise et on sort. Docker (restart: unless-stopped) relance proprement.
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: error.name, message: error.message })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { error: reason instanceof Error ? reason.name : String(reason) })
  process.exit(1)
})

const config = (() => {
  try {
    return loadHttpConfig()
  } catch (error) {
    logger.error('invalid_config', { message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  }
})()

const app = createHttpApp({ ...config.app, logger })

app.server.listen(config.port, config.host, () => {
  logger.info('server_started', {
    version: SERVER_INFO.version,
    url: `http://${config.host}:${config.port}/mcp`,
    allowed_hosts: config.app.allowedHosts.join(','),
    trust_proxy: config.app.trustProxy,
    rate_limit_per_minute: config.app.rateLimitPerMinute,
  })
})

// Arrêt propre : Docker envoie SIGTERM puis SIGKILL après 10 s. On laisse
// les requêtes en cours finir, avec un plafond de 8 s pour ne pas être tué.
let stopping = false
const shutdown = (signal: string): void => {
  if (stopping) return
  stopping = true
  logger.info('server_stopping', { signal })
  setTimeout(() => {
    logger.warn('forced_exit')
    process.exit(1)
  }, 8_000).unref()
  app
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
