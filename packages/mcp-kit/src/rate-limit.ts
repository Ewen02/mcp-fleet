/**
 * Limite de débit par client, fenêtre fixe d'une minute, en mémoire.
 *
 * Suffisant pour une instance unique sur un VPS. Avec plusieurs instances,
 * la limite devient "par instance" : acceptable pour un garde-fou anti-abus,
 * à déplacer dans le reverse proxy ou un store partagé si ça devient un quota.
 */
import { isIPv6 } from 'node:net'

export interface RateLimiter {
  /** Consomme un jeton. Renvoie le délai d'attente en secondes si la limite est atteinte, sinon null. */
  hit(ip: string, now?: number): number | null
  /** Arrête le nettoyage périodique (tests, arrêt du serveur). */
  stop(): void
}

const WINDOW_MS = 60_000

/**
 * Plafond de clés suivies : borne la mémoire même si un attaquant fait
 * varier son adresse. Au-delà, la plus ancienne entrée est évincée (une Map
 * conserve l'ordre d'insertion). ~100 octets par entrée → ~10 Mo au pire.
 */
const DEFAULT_MAX_KEYS = 100_000

export function createRateLimiter(maxPerMinute: number, maxKeys = DEFAULT_MAX_KEYS): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>()

  // Purge des fenêtres expirées pour que la Map ne grossisse pas indéfiniment.
  // `unref` : ce timer ne doit pas empêcher le process de s'arrêter.
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(key)
  }, WINDOW_MS)
  sweeper.unref()

  return {
    hit(ip, now = Date.now()) {
      const key = rateLimitKey(ip)
      const w = windows.get(key)
      if (!w || now - w.start >= WINDOW_MS) {
        if (!w && windows.size >= maxKeys) {
          const oldest = windows.keys().next().value
          if (oldest !== undefined) windows.delete(oldest)
        }
        windows.set(key, { start: now, count: 1 })
        return null
      }
      w.count += 1
      if (w.count <= maxPerMinute) return null
      return Math.ceil((w.start + WINDOW_MS - now) / 1000)
    },
    stop: () => clearInterval(sweeper),
  }
}

/**
 * Clé de limitation pour une adresse :
 * - IPv4 mappée en IPv6 (`::ffff:1.2.3.4`) → l'IPv4 ;
 * - IPv6 → son préfixe /64 : un abonné dispose d'au moins un /64 et peut
 *   changer d'adresse à chaque requête, la limite doit donc porter sur le préfixe.
 */
export function rateLimitKey(ip: string): string {
  const address = ip.replace(/%.*$/, '') // identifiant de zone (fe80::1%eth0)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped?.[1]) return mapped[1]
  if (!isIPv6(address)) return address

  const [head = '', tail = ''] = address.toLowerCase().split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = address.includes('::') ? (tail ? tail.split(':') : []) : []
  const groups = address.includes('::')
    ? [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
    : headGroups
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}
