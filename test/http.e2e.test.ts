/**
 * Test de bout en bout du transport HTTP : l'application est démarrée sur
 * un port aléatoire et le client officiel lui parle en Streamable HTTP,
 * comme un connecteur distant (Claude, ChatGPT, Cursor).
 *
 * On couvre les deux ères du protocole, puis les garde-fous HTTP.
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createHttpApp, type HttpApp } from '../src/http-app.js'
import { createLogger } from '../src/logger.js'
import type { GrossToNetOutput } from '../src/tools/gross-to-net.js'
import type { IncomeTaxEstimateOutput } from '../src/tools/income-tax-estimate.js'

let app: HttpApp
let baseUrl: string

before(async () => {
  app = createHttpApp({
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

describe('http — safeguards', () => {
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
  })
  const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

  test('GET /health returns the version and the rules vintage', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { status: string; rules: { reference_date: string } }
    assert.equal(body.status, 'ok')
    assert.equal(body.rules.reference_date, '2026-07-01')
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
    limited = createHttpApp({
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedOrigins: [],
      trustProxy: true,
      rateLimitPerMinute: 2,
      maxBodyBytes: 64 * 1024,
      logger: createLogger('silent'),
    })
    await new Promise<void>((resolve) => limited.server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(limited.server.address() as AddressInfo).port}/mcp`
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
    const shutdownApp = createHttpApp({
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedOrigins: [],
      trustProxy: false,
      rateLimitPerMinute: 0,
      maxBodyBytes: 64 * 1024,
      logger: createLogger('silent'),
    })
    await new Promise<void>((resolve) => shutdownApp.server.listen(0, '127.0.0.1', resolve))
    const url = new URL(`http://127.0.0.1:${(shutdownApp.server.address() as AddressInfo).port}/mcp`)

    // Client de l'ère 2026 : c'est sur ce chemin qu'un arrêt dans le mauvais
    // ordre coupait les requêtes en cours.
    const client = new Client(
      { name: 'shutdown', version: '0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(new StreamableHTTPClientTransport(url))

    // On attend que le serveur ait reçu la requête : elle est alors vraiment "en cours".
    const received = once(shutdownApp.server, 'request')
    const inFlight = client.callTool({ name: 'income_tax_estimate', arguments: { gross_salary: 3200 } })
    await received
    const closing = shutdownApp.close()

    const res = await inFlight
    assert.notEqual(res.isError, true)
    assert.ok((res.structuredContent as IncomeTaxEstimateOutput).annual_income_tax > 0)
    await client.close()
    await closing
  })
})
