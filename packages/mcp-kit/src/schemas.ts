/**
 * Schémas communs à tous les serveurs de la famille.
 *
 * Convention : chaque résultat de tool se termine par `assumptions`,
 * `warnings` et `source`. Les deux premiers ont la même forme partout et
 * vivent ici ; `source` dépend du domaine (version d'un moteur, d'un jeu de
 * données…) et reste défini par chaque serveur.
 */
import * as z from 'zod/v4'

export const assumptionsSchema = z
  .array(z.string())
  .describe('Assumptions applied to everything that was not specified. Always mention them when quoting a figure.')

export const warningsSchema = z
  .array(z.string())
  .describe('Known limitations affecting this result. Mention them to the user when not empty.')

/**
 * Annotations d'un tool qui ne fait que lire ou calculer.
 * Elles aident le client à décider s'il peut appeler le tool sans demander
 * de confirmation à l'utilisateur.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
