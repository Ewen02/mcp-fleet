/**
 * Briques partagées par tous les tools : champs d'entrée communes, schéma
 * de la source des règles, avertissements. Chaque tool les réutilise pour
 * que les clients reçoivent toujours la même structure.
 */
import * as z from 'zod/v4'
import { RULES_SOURCE } from '../domain/engine.js'

// ─── Entrées communes ────────────────────────────────────────────────────────

export const periodSchema = z.enum(['monthly', 'yearly'])

/** Champs décrivant le salaire, identiques dans les trois tools. */
export const employeeFields = {
  gross_salary: z
    .number()
    .positive()
    .max(10_000_000)
    .describe('Gross salary in euros (salaire brut), excluding bonuses. E.g. 3000 for €3,000 gross per month.'),
  period: periodSchema
    .default('monthly')
    .describe('Period of the given gross salary. Amounts are returned for the same period unless stated otherwise.'),
  is_executive: z.boolean().default(false).describe('true if the employee has French executive status (statut cadre).'),
  alsace_moselle: z
    .boolean()
    .default(false)
    .describe(
      'true if the employee works in Bas-Rhin, Haut-Rhin or Moselle (régime local Alsace-Moselle: extra employee health contribution).',
    ),
}

// ─── Sorties communes ────────────────────────────────────────────────────────

export const sourceSchema = z
  .object({
    engine: z.string(),
    modele_social_version: z.string(),
    reference_date: z.string().describe('Date at which the rules (rates, ceilings) are evaluated, ISO format.'),
    year: z.number().int().describe('Year of the applied rules.'),
    license: z.string(),
    repository: z.string(),
    documentation: z.string().describe('Official page detailing the calculation on mon-entreprise.urssaf.fr.'),
  })
  .describe('Origin and vintage of the calculation rules.')

export const assumptionsSchema = z
  .array(z.string())
  .describe('Assumptions applied to everything that was not specified. Always mention them when quoting a figure.')

export const warningsSchema = z
  .array(z.string())
  .describe('Known limitations affecting this result. Mention them to the user when not empty.')

export function source(documentation: string): z.infer<typeof sourceSchema> {
  return { ...RULES_SOURCE, documentation }
}

/** Lignes de texte communes à la fin de chaque réponse (hypothèses, avertissements, source). */
export function footerLines(r: { assumptions: string[]; warnings: string[]; documentation: string }): string[] {
  return [
    `Assumptions: ${r.assumptions.join('; ')}.`,
    ...r.warnings.map((w) => `Warning: ${w}`),
    `Source: URSSAF modele-social ${RULES_SOURCE.modele_social_version} engine, rules as of ${RULES_SOURCE.reference_date} — ${r.documentation}`,
  ]
}

// ─── Divers ──────────────────────────────────────────────────────────────────

/**
 * Annotations communes : ces tools ne font que calculer.
 * Elles aident le client à décider s'il peut appeler le tool sans demander
 * de confirmation à l'utilisateur.
 */
export const CALCULATION_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const formatEuros = (amount: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(amount)

export const periodSuffix = (period: 'monthly' | 'yearly'): string => (period === 'monthly' ? '/month' : '/year')
