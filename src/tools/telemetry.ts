/**
 * Télémétrie des tools : une ligne de log par appel (nom, durée, issue).
 *
 * C'est la mesure produit de base : quels tools sont utilisés, combien de
 * fois, en combien de temps, avec quel taux d'erreur. Les arguments ne sont
 * JAMAIS journalisés (données personnelles).
 */
import { logger } from '../logger.js'

export function instrument<Args extends unknown[], Result>(
  tool: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const start = performance.now()
    try {
      const result = await handler(...args)
      logger.info('tool_call', { tool, outcome: 'ok', duration_ms: Math.round(performance.now() - start) })
      return result
    } catch (error) {
      // On journalise le type d'erreur, pas son message complet : il pourrait
      // contenir une valeur saisie. Le SDK renvoie l'erreur au modèle (isError).
      logger.error('tool_call', {
        tool,
        outcome: 'error',
        error: error instanceof Error ? error.name : 'unknown',
        duration_ms: Math.round(performance.now() - start),
      })
      throw error
    }
  }
}
