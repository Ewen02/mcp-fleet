/**
 * Limite de débit : clés normalisées (IPv6 /64, IPv4 mappée) et mémoire bornée.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRateLimiter, rateLimitKey } from '../src/rate-limit.js'

test('IPv4 and IPv4-mapped IPv6 share the same key', () => {
  assert.equal(rateLimitKey('203.0.113.9'), '203.0.113.9')
  assert.equal(rateLimitKey('::ffff:203.0.113.9'), '203.0.113.9')
})

test('IPv6 addresses are grouped by /64 prefix', () => {
  assert.equal(rateLimitKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64')
  assert.equal(rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64')
  assert.equal(rateLimitKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64')
  assert.equal(rateLimitKey('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(rateLimitKey('fe80::1%eth0'), 'fe80:0:0:0::/64')
})

test('rotating addresses inside one /64 does not bypass the limit', () => {
  const limiter = createRateLimiter(2)
  const now = 1_000_000
  assert.equal(limiter.hit('2001:db8:1:2::a', now), null)
  assert.equal(limiter.hit('2001:db8:1:2::b', now), null)
  assert.ok((limiter.hit('2001:db8:1:2::c', now) ?? 0) > 0)
  limiter.stop()
})

test('the window resets after a minute', () => {
  const limiter = createRateLimiter(1)
  assert.equal(limiter.hit('203.0.113.1', 0), null)
  assert.ok((limiter.hit('203.0.113.1', 1_000) ?? 0) > 0)
  assert.equal(limiter.hit('203.0.113.1', 60_000), null)
  limiter.stop()
})

test('memory is bounded: the oldest key is evicted when the cap is reached', () => {
  const limiter = createRateLimiter(1, 2)
  limiter.hit('10.0.0.1', 0)
  limiter.hit('10.0.0.2', 0)
  limiter.hit('10.0.0.3', 0) // évince 10.0.0.1
  assert.equal(limiter.hit('10.0.0.1', 0), null) // de nouveau neuf
  limiter.stop()
})
