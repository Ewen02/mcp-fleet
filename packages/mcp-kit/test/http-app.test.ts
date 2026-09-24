/**
 * Test de bout en bout du transport HTTP du kit : l'application est démarrée
 * sur un port aléatoire avec un serveur « echo » sans métier, et le client
 * officiel lui parle en Streamable HTTP, comme un connecteur distant
 * (Claude, ChatGPT, Cursor).
 *
 * On couvre les deux ères du protocole, l'injection du serveur, puis les
 * garde-fous HTTP, la limite de débit et l'arrêt propre.
 */

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createHttpApp, type HttpApp, type HttpAppOptions } from '../src/http-app.js'
import { createLogger } from '../src/logger.js'
import { ECHO_INFO, echoDefinition, Gate } from './fixtures/echo-server.js'

const OPTIONS: HttpAppOptions = {
  allowedHosts: ['localhost', '127.0.0.1'],
  allowedOrigins: [],
  trustProxy: false,
  rateLimitPerMinute: 0,
  maxBodyBytes: 64 * 1024,
  logger: createLogger('silent'),
}

async function listen(app: HttpApp): Promise<string> {
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

let app: HttpApp
let baseUrl: string

before(async () => {
  app = createHttpApp(echoDefinition(), OPTIONS)
  baseUrl = await listen(app)
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

    test('tools/list exposes the tools of the injected server', async () => {
      client = new Client({ name: 'test-http', version: '0.0.0' }, { versionNegotiation: { mode } })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))
      const { tools } = await client.listTools()
      assert.deepEqual(
        tools.map((t) => t.name),
        ['echo', 'wait'],
      )
      assert.equal(tools[0]?.annotations?.readOnlyHint, true)
    })

    test('tools/call works over HTTP', async () => {
      const res = await client.callTool({ name: 'echo', arguments: { text: 'bonjour' } })
      assert.deepEqual(res.structuredContent, { text: 'bonjour' })
    })
  })
}

describe('http — safeguards', () => {
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
  })
  const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

  test('GET /health returns the name, the version and the fields provided by the server', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), {
      status: 'ok',
      name: ECHO_INFO.name,
      version: ECHO_INFO.version,
      fixture: { ready: true },
    })
  })

  test('a foreign Host header is rejected (DNS rebinding protection)', async () => {
    // fetch() interdit de forcer Host : on passe par node:http.
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${baseUrl}/mcp`,
        { method: 'POST', headers: { ...mcpHeaders, host: 'evil.example' } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end(initialize)
    })
    assert.equal(status, 403)
  })

  test('a browser Origin that is not allowed is rejected', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...mcpHeaders, origin: 'https://evil.example' },
      body: initialize,
    })
    assert.equal(res.status, 403)
  })

  test('an oversized body is rejected before parsing', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ padding: 'x'.repeat(100 * 1024) }),
    })
    assert.equal(res.status, 413)
  })

  test('unknown paths return 404', async () => {
    const res = await fetch(`${baseUrl}/nope`)
    assert.equal(res.status, 404)
  })

  test('an invalid request target returns 400 and does not crash the server', async () => {
    // fetch() normalise l'URL : on envoie la cible brute via node:http.
    const { request } = await import('node:http')
    const { port } = app.server.address() as AddressInfo
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '//a:99999/', method: 'GET' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 400)
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200)
  })

  test('every response carries a request id (reused from the proxy when valid)', async () => {
    const generated = await fetch(`${baseUrl}/health`)
    assert.match(generated.headers.get('x-request-id') ?? '', /^[\w-]{36}$/)
    const forwarded = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'abc-123' } })
    assert.equal(forwarded.headers.get('x-request-id'), 'abc-123')
  })
})

describe('http — rate limiting', () => {
  let limited: HttpApp
  let url: string

  before(async () => {
    limited = createHttpApp(echoDefinition(), { ...OPTIONS, trustProxy: true, rateLimitPerMinute: 2 })
    url = `${await listen(limited)}/mcp`
  })

  after(() => limited.close())

  const call = (ip: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

  test('the third request of the minute from one IP gets 429 with Retry-After', async () => {
    assert.notEqual((await call('203.0.113.1')).status, 429)
    assert.notEqual((await call('203.0.113.1')).status, 429)
    const third = await call('203.0.113.1')
    assert.equal(third.status, 429)
    assert.ok(Number(third.headers.get('retry-after')) > 0)
  })

  test('another IP is not affected', async () => {
    assert.notEqual((await call('203.0.113.2')).status, 429)
  })

  test('only the last X-Forwarded-For entry (added by the proxy) counts', async () => {
    // Le client forge une première entrée ; seule la dernière (ajoutée par le proxy) compte.
    assert.equal((await call('1.2.3.4, 203.0.113.1')).status, 429)
  })
})

describe('http — graceful shutdown', () => {
  test('a tool call in flight when close() starts still completes', async () => {
    const gate = new Gate()
    const shutdownApp = createHttpApp(echoDefinition(gate), OPTIONS)
    const url = new URL(`${await listen(shutdownApp)}/mcp`)

    // Client de l'ère 2026 : c'est sur ce chemin qu'un arrêt dans le mauvais
    // ordre coupait les requêtes en cours.
    const client = new Client(
      { name: 'shutdown', version: '0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(new StreamableHTTPClientTransport(url))

    // On attend que le handler ait commencé : la requête est alors vraiment « en vol ».
    const inFlight = client.callTool({ name: 'wait', arguments: {} })
    await gate.entered
    const started = performance.now()
    const closing = shutdownApp.close()
    gate.release()

    const res = await inFlight
    assert.notEqual(res.isError, true)
    assert.deepEqual(res.content, [{ type: 'text', text: 'done' }])
    await client.close()
    await closing

    // La connexion keep-alive qui a servi la requête en vol doit être fermée
    // dès la réponse envoyée. Sinon close() attend son expiration (65 s) et,
    // en production, l'arrêt finit tué par le plafond de 8 s (forced_exit).
    const elapsed = performance.now() - started
    assert.ok(elapsed < 5_000, `close() took ${Math.round(elapsed)} ms`)
  })
})
