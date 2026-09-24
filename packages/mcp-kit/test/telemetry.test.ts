/**
 * Télémétrie : une ligne par appel de tool, sans jamais les arguments.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLogger } from '../src/logger.js'
import { instrument } from '../src/telemetry.js'

function capture() {
  const lines: string[] = []
  return { lines, logger: createLogger('debug', (line) => lines.push(line)) }
}

test('a successful call logs tool, outcome and duration, never the arguments', async () => {
  const { lines, logger } = capture()
  const handler = instrument('convert', async (args: { amount: number }) => args.amount * 2, logger)
  assert.equal(await handler({ amount: 3141.59 }), 6283.18)
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0] ?? '')
  assert.equal(entry.event, 'tool_call')
  assert.equal(entry.tool, 'convert')
  assert.equal(entry.outcome, 'ok')
  assert.equal(typeof entry.duration_ms, 'number')
  assert.ok(!(lines[0] ?? '').includes('3141'), 'an argument value leaked into the log')
})

test('a failing call logs the error type only and rethrows', async () => {
  const { lines, logger } = capture()
  const handler = instrument(
    'convert',
    async (_args: { amount: number }) => {
      throw new RangeError('amount 98765 is too high')
    },
    logger,
  )
  await assert.rejects(handler({ amount: 98765 }), RangeError)
  const entry = JSON.parse(lines[0] ?? '')
  assert.equal(entry.level, 'error')
  assert.equal(entry.outcome, 'error')
  assert.equal(entry.error, 'RangeError')
  assert.ok(!(lines[0] ?? '').includes('98765'), 'the error message (which may hold user input) leaked')
})
