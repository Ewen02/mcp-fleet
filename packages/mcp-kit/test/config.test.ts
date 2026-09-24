/**
 * Configuration : valeurs par défaut sûres et échec immédiat si invalide.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadHttpConfig } from '../src/config.js'

test('defaults are safe: localhost only, no proxy trust, rate limit on', () => {
  const c = loadHttpConfig({})
  assert.equal(c.port, 3000)
  assert.equal(c.host, '127.0.0.1')
  assert.deepEqual(c.app.allowedHosts, ['localhost', '127.0.0.1', '[::1]'])
  assert.equal(c.app.trustProxy, false)
  assert.equal(c.app.rateLimitPerMinute, 600)
})

test('lists are parsed and trimmed', () => {
  const c = loadHttpConfig({ ALLOWED_HOSTS: ' mcp.example.com , api.example.com', TRUST_PROXY: 'true' })
  assert.ok(c.app.allowedHosts.includes('mcp.example.com'))
  assert.ok(c.app.allowedHosts.includes('api.example.com'))
  assert.equal(c.app.trustProxy, true)
})

test('an invalid value fails fast with a clear message', () => {
  assert.throws(() => loadHttpConfig({ PORT: 'abc' }), /Invalid configuration: PORT/)
  assert.throws(() => loadHttpConfig({ TRUST_PROXY: 'yes' }), /TRUST_PROXY/)
})
