/**
 * Transport stdio du kit : stdout ne transporte QUE du JSON-RPC.
 *
 * On lance le serveur « echo » en sous-process avec les logs au niveau le
 * plus bavard, on lui parle en JSON-RPC brut, et on vérifie que chaque
 * ligne de stdout est un message JSON-RPC valide, les logs partant sur stderr.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('stdout carries only JSON-RPC, logs go to stderr', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/echo-stdio.ts'], {
    cwd: root,
    env: { ...process.env, LOG_LEVEL: 'debug' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'ok' } } })

  // Attend la réponse au tools/call, puis arrête proprement le serveur.
  while (!stdout.includes('"id":2')) await once(child.stdout, 'data')
  child.kill('SIGTERM')
  await once(child, 'exit')

  const lines = stdout.trim().split('\n')
  assert.equal(lines.length, 2)
  for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', `not JSON-RPC on stdout: ${line}`)
  assert.deepEqual(JSON.parse(lines[1] ?? '').result.structuredContent, { text: 'ok' })

  const events = stderr
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).event)
  assert.ok(events.includes('server_started'), `server_started missing from stderr: ${stderr}`)
})
