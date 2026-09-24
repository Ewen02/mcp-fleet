/**
 * Couche "moteur" : le seul fichier qui parle à publicodes.
 *
 * Principe : tout le reste du projet (domaine, tools MCP) passe par ici.
 * Si demain on change de version de modele-social ou de moteur, c'est
 * le seul endroit à toucher.
 */

import rules, { type RègleModèleSocial } from 'modele-social'
import modeleSocialPkg from 'modele-social/package.json' with { type: 'json' }
import Engine, { type Evaluation } from 'publicodes'

// Les noms de règles publicodes restent en français : ce sont des données du moteur.
export type RuleName = RègleModèleSocial

/** Situation publicodes : règle → valeur ('3000 €/mois', 'oui', 12…). */
export type Situation = Partial<Record<RuleName, string | number>>

/**
 * Le parsing des ~650 règles prend ~600 ms : on le fait UNE fois au
 * chargement du module, jamais par requête. La factory MCP (server.ts)
 * reste ainsi quasi gratuite, ce qui compte en HTTP stateless où un
 * McpServer est créé à chaque requête.
 *
 * Le logger est coupé : publicodes écrit ses warnings sur stdout, ce qui
 * corromprait le canal JSON-RPC en mode stdio.
 */
const baseEngine = new Engine(rules, {
  logger: {
    log: () => {},
    warn: () => {},
    error: (message: string) => process.stderr.write(`[publicodes] ${message}\n`),
  },
})

/** Un calcul en cours : une situation figée sur une copie isolée du moteur. */
export interface Evaluator {
  /** Montant d'une règle, converti dans l'unité demandée ('€/mois', '€/an', '%'…). */
  amount(rule: RuleName, unit: string): number
  /** Idem, mais 0 si la règle n'est pas applicable (ex. : pas de réduction au-delà de 3 Smic). */
  amountOrZero(rule: RuleName, unit: string): number
  /** Valeur brute d'une règle (texte, booléen, nombre) : sert à décrire les hypothèses. */
  value(rule: RuleName): Evaluation
}

/**
 * Prépare un calcul pour une situation donnée.
 *
 * `shallowCopy()` isole chaque calcul : setSituation() muterait sinon le
 * moteur partagé entre toutes les requêtes. Le coût est négligeable (~2 ms).
 */
export function withSituation(situation: Situation): Evaluator {
  const engine = baseEngine.shallowCopy().setSituation(situation)
  return {
    amount: (rule, unit) => toNumber(engine.evaluate({ valeur: rule, unité: unit }).nodeValue, rule),
    amountOrZero: (rule, unit) => {
      // publicodes renvoie `null` pour une règle non applicable : c'est un 0 métier, pas une erreur.
      const value = engine.evaluate({ valeur: rule, unité: unit }).nodeValue
      return value === null ? 0 : toNumber(value, rule)
    },
    value: (rule) => engine.evaluate(rule).nodeValue,
  }
}

/** Lit la valeur par défaut d'une règle, hors de toute situation. */
export function defaultValue(rule: RuleName): Evaluation {
  return baseEngine.evaluate(rule).nodeValue
}

function toNumber(value: Evaluation, rule: RuleName): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Rule "${rule}" did not produce an amount (value: ${String(value)}).`)
  }
  return value
}

/**
 * Traçabilité : chaque résultat renvoie d'où viennent les règles.
 * La date de référence est lue dans le moteur (règle `date`), jamais codée
 * en dur : elle suivra automatiquement la prochaine version de modele-social.
 */
const referenceDate = parseFrenchDate(defaultValue('date'))

export const RULES_SOURCE = {
  engine: 'publicodes + modele-social (URSSAF / beta.gouv.fr)',
  modele_social_version: modeleSocialPkg.version,
  reference_date: referenceDate,
  year: Number(referenceDate.slice(0, 4)),
  license: 'MIT',
  repository: 'https://github.com/betagouv/mon-entreprise/tree/master/modele-social',
} as const

/** URL de la page de documentation officielle d'une règle sur mon-entreprise.urssaf.fr. */
export function documentationUrl(rule: RuleName): string {
  const path = rule
    .split(' . ')
    .map((segment) => encodeURIComponent(segment.replaceAll(' ', '-')))
    .join('/')
  return `https://mon-entreprise.urssaf.fr/documentation/${path}`
}

/** "01/07/2026" → "2026-07-01" */
function parseFrenchDate(value: Evaluation): string {
  const match = typeof value === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value) : null
  if (!match) throw new Error(`Unreadable model reference date: ${String(value)}`)
  const [, day, month, year] = match
  return `${year}-${month}-${day}`
}
