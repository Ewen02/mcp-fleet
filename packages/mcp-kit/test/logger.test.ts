/**
 * Logger : une ligne JSON par événement, filtrée par niveau.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLogger, isLogLevel } from '../src/logger.js'

function capture(level: Parameters<typeof createLogger>[0]) {
  const lines: string[] = []
  return { lines, logger: createLogger(level, (line) => lines.push(line)) }
}

test('one JSON line per event, with time, level, event and fields', () => {
  const { lines, logger } = capture('info')
  logger.info('server_started', { version: '1.0.0', port: 3000 })
  assert.equal(lines.length, 1)
  assert.ok(lines[0]?.endsWith('\n'))
  const entry = JSON.parse(lines[0] ?? '')
  assert.equal(entry.level, 'info')
  assert.equal(entry.event, 'server_started')
  assert.equal(entry.version, '1.0.0')
  assert.equal(entry.port, 3000)
  assert.ok(!Number.isNaN(Date.parse(entry.time)))
})

test('events below the threshold are dropped', () => {
  const { lines, logger } = capture('warn')
  logger.debug('a')
  logger.info('b')
  logger.warn('c')
  logger.error('d')
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).event),
    ['c', 'd'],
  )
})

test('silent drops everything', () => {
  const { lines, logger } = capture('silent')
  logger.error('boom')
  assert.equal(lines.length, 0)
})

test('only known levels are accepted', () => {
  assert.equal(isLogLevel('debug'), true)
  assert.equal(isLogLevel('silent'), true)
  assert.equal(isLogLevel('verbose'), false)
})
