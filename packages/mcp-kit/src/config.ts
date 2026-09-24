/**
 * Configuration du serveur HTTP, lue et validée UNE fois au démarrage.
 *
 * Principe "fail fast" : une variable invalide arrête le process avec un
 * message clair, plutôt qu'un comportement bizarre découvert en prod.
 */
import * as z from 'zod/v4'
import type { HttpAppOptions } from './http-app.js'

const LOCALHOST = ['localhost', '127.0.0.1', '[::1]']

const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  ALLOWED_HOSTS: list,
  ALLOWED_ORIGINS: list,
  // true uniquement derrière un reverse proxy de confiance (Caddy) : on lit
  // alors l'IP cliente dans X-Forwarded-For. Sinon n'importe qui pourrait
  // usurper une IP et contourner la limite de débit.
  TRUST_PROXY: bool,
  // Garde-fou anti-abus, pas un quota : les connecteurs Claude/ChatGPT
  // appellent depuis quelques IP partagées par tous leurs utilisateurs.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(600),
})

export interface HttpConfig {
  port: number
  host: string
  app: Omit<HttpAppOptions, 'logger'>
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration: ${details}`)
  }
  const c = parsed.data
  return {
    port: c.PORT,
    host: c.HOST,
    app: {
      allowedHosts: [...LOCALHOST, ...c.ALLOWED_HOSTS],
      allowedOrigins: c.ALLOWED_ORIGINS,
      trustProxy: c.TRUST_PROXY,
      rateLimitPerMinute: c.RATE_LIMIT_PER_MINUTE,
      // Un appel de tool pèse moins de 1 Ko : 64 Ko laisse une large marge.
      maxBodyBytes: 64 * 1024,
    },
  }
}
