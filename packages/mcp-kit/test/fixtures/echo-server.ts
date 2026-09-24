/**
 * Serveur MCP minimal pour tester le kit sans aucun métier.
 *
 * - `echo` renvoie son texte : prouve qu'un appel traverse le transport.
 * - `wait` reste en cours tant que le test ne l'a pas libéré : permet de
 *   tester l'arrêt propre avec une requête réellement « en vol ».
 */
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { McpServerDefinition } from '../../src/definition.js'
import { READ_ONLY_ANNOTATIONS } from '../../src/schemas.js'

/** Verrou partagé entre le test et le handler de `wait`. */
export class Gate {
  #enter!: () => void
  #release!: () => void
  /** Résolue quand le handler de `wait` a commencé. */
  readonly entered = new Promise<void>((resolve) => {
    this.#enter = resolve
  })
  readonly released = new Promise<void>((resolve) => {
    this.#release = resolve
  })
  enter(): void {
    this.#enter()
  }
  /** Laisse le handler de `wait` se terminer. */
  release(): void {
    this.#release()
  }
}

export const ECHO_INFO = { name: 'echo-test', version: '1.2.3' } as const

export function echoDefinition(gate?: Gate): McpServerDefinition {
  return {
    info: ECHO_INFO,
    createServer: () => {
      const server = new McpServer(ECHO_INFO)
      server.registerTool(
        'echo',
        {
          description: 'Returns its input.',
          inputSchema: z.object({ text: z.string().max(100) }),
          outputSchema: z.object({ text: z.string() }),
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async ({ text }) => ({ content: [{ type: 'text', text }], structuredContent: { text } }),
      )
      server.registerTool(
        'wait',
        { description: 'Waits until the test releases it.', annotations: READ_ONLY_ANNOTATIONS },
        async () => {
          gate?.enter()
          await gate?.released
          return { content: [{ type: 'text', text: 'done' }] }
        },
      )
      return server
    },
    health: () => ({ fixture: { ready: true } }),
  }
}
