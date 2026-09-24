/**
 * Application HTTP : route les requêtes, applique les garde-fous, délègue
 * le protocole MCP au SDK. Séparée de http.ts (lecture de l'env + listen)
 * pour que les tests puissent la démarrer sur un port aléatoire.
 *
 * Routes :
 *   POST /mcp    → endpoint Streamable HTTP (MCP)
 *   GET  /health → sonde pour l'hébergeur (nom, version + champs fournis par le serveur)
 *   *            → 404
 *
 * Ordre des garde-fous sur /mcp : Host → Origin → limite de débit → SDK
 * (qui applique lui-même la limite de taille du body).
 *
 * Aucune connaissance du métier : le serveur MCP (factory, identité, champs
 * de /health) est injecté par l'appelant via McpServerDefinition.
 */
import { randomUUID } from 'node:crypto'
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  hostHeaderValidation,
  type NodeIncomingMessageLike,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpServerDefinition } from './definition.js'
import type { Logger } from './logger.js'
import { createRateLimiter } from './rate-limit.js'

export interface HttpAppOptions {
  /** Hostnames acceptés dans le header Host (protection DNS rebinding). */
  allowedHosts: string[]
  /** Hostnames acceptés dans le header Origin. Les clients serveur-à-serveur n'en envoient pas. */
  allowedOrigins: string[]
  /** Lire l'IP cliente dans X-Forwarded-For (uniquement derrière un proxy de confiance). */
  trustProxy: boolean
  /** Requêtes /mcp autorisées par IP et par minute. 0 = pas de limite. */
  rateLimitPerMinute: number
  /** Taille maximale d'un body de requête, en octets. */
  maxBodyBytes: number
  logger: Logger
}

export interface HttpApp {
  server: Server
  close(): Promise<void>
}

export function createHttpApp(definition: McpServerDefinition, options: HttpAppOptions): HttpApp {
  const { logger } = options

  // Stateless : le SDK crée un McpServer par requête via la factory du serveur.
  // Aucune session à stocker → n'importe quel nombre d'instances derrière
  // un load balancer, sans Redis ni sticky sessions.
  // `legacy: 'stateless'` (défaut, explicité ici) sert aussi les clients
  // 2025 qui envoient encore `initialize`.
  const mcpHandler = createMcpHandler(definition.createServer, {
    legacy: 'stateless',
    maxRequestBodySize: options.maxBodyBytes,
    onerror: (error) => logger.warn('mcp_error', { error: error.name, message: error.message.slice(0, 200) }),
  })
  const handleMcp = toNodeHandler(mcpHandler, {
    maxRequestBodySize: options.maxBodyBytes,
    onerror: (error) => logger.error('mcp_adapter_error', { error: error.name, message: error.message.slice(0, 200) }),
  })

  const validateHost = hostHeaderValidation(options.allowedHosts)
  const validateOrigin = originValidation(options.allowedOrigins)
  const rateLimiter = options.rateLimitPerMinute > 0 ? createRateLimiter(options.rateLimitPerMinute) : null

  const server = createNodeServer((req, res) => {
    const start = performance.now()
    const requestId = requestIdOf(req)
    // Chemin calculé UNE fois et sans exception : une cible de requête
    // invalide (ex. `//a:99999/`) ne doit jamais atteindre un code qui lève
    // hors du try, sinon c'est le process entier qui tombe.
    const path = pathOf(req)
    res.setHeader('x-request-id', requestId)
    res.setHeader('x-content-type-options', 'nosniff')

    // Log sans body ni IP : les arguments d'un tool peuvent être des données
    // personnelles, et l'IP n'est utile qu'à la limite de débit.
    res.on('finish', () => {
      // La sonde de santé passe toutes les 30 s : en debug pour ne pas noyer les logs.
      const log = path === '/health' ? logger.debug : logger.info
      log('http_request', {
        request_id: requestId,
        method: req.method,
        path: path ?? '(invalid)',
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - start),
        mcp_method: header(req, 'mcp-method'),
      })
    })

    route(req, res, path).catch((error: unknown) => {
      logger.error('unhandled_route_error', {
        request_id: requestId,
        error: error instanceof Error ? error.name : 'unknown',
      })
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error.' })
      else res.end()
    })
  })

  // Timeouts : keepAlive plus long que celui du reverse proxy (30 s dans
  // deploy/Caddyfile), sinon Node peut fermer une connexion que le proxy
  // réutilise au même moment → 502 aléatoires.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 70_000

  async function route(req: IncomingMessage, res: ServerResponse, path: string | null): Promise<void> {
    if (path === null) return sendJson(res, 400, { error: 'Invalid request target.' })

    if (path === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      return sendJson(res, 200, {
        status: 'ok',
        name: definition.info.name,
        version: definition.info.version,
        ...definition.health?.(),
      })
    }

    if (path === '/mcp') {
      // Les deux garde-fous répondent eux-mêmes (403) quand ils refusent.
      if (!validateHost(req, res) || !validateOrigin(req, res)) return

      if (rateLimiter) {
        const retryAfter = rateLimiter.hit(clientIp(req, options.trustProxy))
        if (retryAfter !== null) {
          res.setHeader('retry-after', String(retryAfter))
          return sendJson(res, 429, { error: 'Too many requests. Retry later.' })
        }
      }
      return handleMcp(asMcpRequest(req), res)
    }

    sendJson(res, 404, { error: 'Not found. The MCP endpoint is POST /mcp.' })
  }

  return {
    server,
    async close() {
      // Ordre important : d'abord refuser les nouvelles connexions et fermer
      // celles qui sont inactives, laisser les requêtes en cours se terminer,
      // et seulement ensuite fermer le handler MCP. L'inverse ferait échouer
      // en 500 les requêtes arrivées pendant l'arrêt (vu à chaque déploiement).
      const closed = new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      server.closeIdleConnections()
      await closed
      rateLimiter?.stop()
      await mcpHandler.close()
    },
  }
}

/**
 * IP cliente. Derrière Caddy, la dernière entrée de X-Forwarded-For est
 * celle ajoutée par le proxy lui-même : c'est la seule fiable (les
 * précédentes viennent du client et peuvent être forgées).
 */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = header(req, 'x-forwarded-for')
    const last = forwarded?.split(',').at(-1)?.trim()
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Réutilise l'identifiant du proxy s'il est sûr, sinon en génère un. */
function requestIdOf(req: IncomingMessage): string {
  const incoming = header(req, 'x-request-id')
  return incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID()
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Le SDK déclare `method?: string` (sans `| undefined`) : avec notre option
 * `exactOptionalPropertyTypes`, l'IncomingMessage de Node n'est pas
 * assignable alors que c'est exactement l'objet attendu. Seul cast du projet,
 * limité au typage : l'objet transmis est le même.
 */
function asMcpRequest(req: IncomingMessage): NodeIncomingMessageLike {
  return req as unknown as NodeIncomingMessageLike
}

/** Chemin de la requête, ou null si la cible est invalide. Ne lève jamais. */
function pathOf(req: IncomingMessage): string | null {
  try {
    // On ignore la query string ; l'URL de base n'est là que pour satisfaire le parseur.
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return null
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}
