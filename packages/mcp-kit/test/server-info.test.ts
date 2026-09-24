/**
 * Identité d'un serveur : nom et version lus dans son package.json.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { readServerInfo } from '../src/server-info.js'

function packageJson(content: unknown): URL {
  const file = join(mkdtempSync(join(tmpdir(), 'mcp-kit-')), 'package.json')
  writeFileSync(file, JSON.stringify(content))
  return pathToFileURL(file)
}

test('name and version come from the package.json of the server', () => {
  const info = readServerInfo(packageJson({ name: 'mcp-demo', version: '2.3.4', private: true }))
  assert.deepEqual(info, { name: 'mcp-demo', version: '2.3.4' })
})

test('a package.json without a version is refused at startup', () => {
  assert.throws(() => readServerInfo(packageJson({ name: 'mcp-demo' })))
})
