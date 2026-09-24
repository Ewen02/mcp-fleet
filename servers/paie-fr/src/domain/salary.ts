/**
 * Domaine "salaire" : logique métier pure, sans aucune dépendance à MCP.
 *
 * On peut l'appeler depuis un tool MCP, une API REST, un CLI ou un test
 * unitaire. Le protocole est un détail d'exposition, pas le cœur du produit.
 */
import { documentationUrl, type Evaluator, type Situation, withSituation } from './engine.js'
import { KNOWN_ISSUES } from './known-issues.js'

export type Period = 'monthly' | 'yearly'

/** Ce qui décrit un salarié : commun à tous les calculs. */
export interface EmployeeInput {
  grossSalary: number
  period: Period
  isExecutive: boolean
  /** Régime local Alsace-Moselle. Absent = non. */
  alsaceMoselle?: boolean
  /** Effectif de l'entreprise. Absent = valeur par défaut du simulateur URSSAF. */
  companyHeadcount?: number
}

// Unités publicodes : ce sont des données du moteur, elles restent en français.
export const UNIT: Record<Period, string> = { monthly: '€/mois', yearly: '€/an' }

/**
 * Traduit l'entrée métier en situation publicodes.
 *
 * `dirigeant: non` est indispensable : modele-social sert aussi le simulateur
 * des dirigeants et vaut `oui` par défaut. Sans ça, le revenu d'activité
 * retenu pour l'impôt est nul (piège trouvé en testant income_tax_estimate).
 */
export function employeeSituation(input: EmployeeInput): Situation {
  return {
    dirigeant: 'non',
    'salarié . contrat . salaire brut': `${input.grossSalary} ${UNIT[input.period]}`,
    'salarié . contrat . statut cadre': input.isExecutive ? 'oui' : 'non',
    // Dans le moteur, cette règle se déduit du département de l'établissement.
    // On la fixe directement : l'utilisateur sait où il travaille, pas son code commune.
    'salarié . régimes spécifiques . alsace moselle': input.alsaceMoselle ? 'oui' : 'non',
    ...(input.companyHeadcount !== undefined && {
      'entreprise . salariés . effectif': input.companyHeadcount,
    }),
  }
}

/**
 * Tout ce que l'utilisateur ne précise pas prend la valeur par défaut du
 * simulateur URSSAF. On le dit explicitement : un LLM qui présente un
 * chiffre doit pouvoir expliquer sous quelles hypothèses il est valable.
 * Les valeurs sont lues dans le moteur pour CE calcul, jamais codées en dur.
 */
export function employeeAssumptions(input: EmployeeInput, e: Evaluator): string[] {
  return [
    input.isExecutive ? 'Executive status (cadre)' : 'Non-executive status (non-cadre)',
    `Contract type: ${String(e.value('salarié . contrat'))}`,
    e.value('salarié . contrat . temps de travail . temps partiel') ? 'Part-time' : 'Full-time',
    `Collective agreement: ${String(e.value('salarié . convention collective'))}`,
    `Company headcount: ${String(e.value('entreprise . salariés . effectif'))} employees` +
      (input.companyHeadcount === undefined ? ' (simulator default)' : ''),
    e.value('salarié . régimes spécifiques . alsace moselle') ? 'Alsace-Moselle regime' : 'Outside Alsace-Moselle',
    'No bonuses, overtime, benefits in kind or meal vouchers',
  ]
}

// ─── Brut → net ──────────────────────────────────────────────────────────────

export interface GrossToNetResult {
  grossSalary: number
  period: Period
  netBeforeIncomeTax: number
  taxableNet: number
  employeeContributions: number
  assumptions: string[]
  warnings: string[]
  documentation: string
}

const NET_RULE = 'salarié . rémunération . net . à payer avant impôt' as const

export function computeGrossToNet(input: EmployeeInput): GrossToNetResult {
  const unit = UNIT[input.period]
  const e = withSituation(employeeSituation(input))

  return {
    grossSalary: input.grossSalary,
    period: input.period,
    netBeforeIncomeTax: round(e.amount(NET_RULE, unit)),
    taxableNet: round(e.amount('salarié . rémunération . net . imposable', unit)),
    employeeContributions: round(e.amount('salarié . cotisations . salarié', unit)),
    assumptions: employeeAssumptions(input, e),
    warnings: [],
    documentation: documentationUrl(NET_RULE),
  }
}

// ─── Coût employeur ──────────────────────────────────────────────────────────

export interface EmployerCostResult {
  grossSalary: number
  period: Period
  totalEmployerCost: number
  employerContributions: number
  generalReduction: number
  netBeforeIncomeTax: number
  costToNetRatio: number
  assumptions: string[]
  warnings: string[]
  documentation: string
}

const EMPLOYER_COST_RULE = 'salarié . coût total employeur' as const

export function computeEmployerCost(input: EmployeeInput): EmployerCostResult {
  const unit = UNIT[input.period]
  const e = withSituation(employeeSituation(input))

  const totalEmployerCost = e.amount(EMPLOYER_COST_RULE, unit)
  const netBeforeIncomeTax = e.amount(NET_RULE, unit)
  const generalReduction = e.amountOrZero('salarié . cotisations . exonérations . RGDU', unit)

  return {
    grossSalary: input.grossSalary,
    period: input.period,
    totalEmployerCost: round(totalEmployerCost),
    // Les cotisations patronales renvoyées par le moteur sont déjà nettes des réductions.
    employerContributions: round(e.amount('salarié . cotisations . employeur', unit)),
    generalReduction: round(generalReduction),
    netBeforeIncomeTax: round(netBeforeIncomeTax),
    costToNetRatio: Math.round((totalEmployerCost / netBeforeIncomeTax) * 100) / 100,
    assumptions: [
      ...employeeAssumptions(input, e),
      `Work-accident rate (taux AT/MP): ${String(e.value('établissement . taux ATMP'))}% (simulator default; the real rate depends on the company's sector and history)`,
    ],
    warnings: [
      // L'écart RGDU connu ne peut exister que si notre moteur applique une réduction :
      // s'il n'en calcule aucune (Smic de juin), la prod n'en calcule pas non plus
      // (Smic de janvier, plus bas). Sinon l'avertissement serait faux.
      ...(generalReduction > 0 ? KNOWN_ISSUES.employerCost : []),
      // Le versement mobilité dépend du taux de la commune, que l'on ne demande pas.
      // Le moteur dit s'il s'applique (règle non nulle à partir de 11 salariés) :
      // dans ce cas il est compté à 0 et on le signale au lieu de le taire.
      ...(e.value(TRANSPORT_TAX_RULE) !== null ? [TRANSPORT_TAX_WARNING] : []),
    ],
    documentation: documentationUrl(EMPLOYER_COST_RULE),
  }
}

const TRANSPORT_TAX_RULE = 'salarié . cotisations . versement mobilité' as const

const TRANSPORT_TAX_WARNING =
  'Transport tax (versement mobilité) not included: it applies from 11 employees at a rate set by the commune ' +
  '(up to a few percent of gross salary in large cities). The real employer cost is higher for such companies.'

export function round(amount: number): number {
  return Math.round(amount * 100) / 100
}
