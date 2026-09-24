/**
 * Logger minimal : une ligne JSON par événement, sur stderr.
 *
 * Pourquoi stderr ? En stdio, stdout transporte le JSON-RPC : y écrire
 * corromprait le protocole. En HTTP (Docker), stderr est collecté comme
 * stdout. Un seul canal, valable pour les deux transports.
 *
 * Pourquoi pas pino ? Trois niveaux et du JSON suffisent ici ; une
 * dépendance de moins à maintenir. À remplacer si les besoins grossissent.
 *
 * Règle : on ne journalise JAMAIS d'arguments de tool ni de body de requête
 * (ils peuvent contenir des données personnelles : un salaire, une adresse…).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const

export type LogLevel = keyof typeof LEVELS
export type LogFields = Record<string, string | number | boolean | null | undefined>

export interface Logger {
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

export function isLogLevel(value: string): value is LogLevel {
  return value in LEVELS
}

export function createLogger(level: LogLevel, write: (line: string) => void = (l) => process.stderr.write(l)): Logger {
  const threshold = LEVELS[level]
  const emit = (lvl: Exclude<LogLevel, 'silent'>, event: string, fields?: LogFields): void => {
    if (LEVELS[lvl] < threshold) return
    write(`${JSON.stringify({ time: new Date().toISOString(), level: lvl, event, ...fields })}\n`)
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

/**
 * Logger partagé du process. Les tools l'utilisent pour la télémétrie ;
 * le niveau vient de LOG_LEVEL (lu ici, seul accès à l'env hors config.ts,
 * pour que stdio et HTTP aient le même comportement sans câblage).
 */
const envLevel = process.env.LOG_LEVEL ?? 'info'
export const logger: Logger = createLogger(isLogLevel(envLevel) ? envLevel : 'info')
