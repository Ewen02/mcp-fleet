/**
 * Domaine "impôt sur le revenu" : estimation pour un foyer dont le salaire
 * est le revenu principal. Pas de dépendance à MCP.
 *
 * Méthode : le "barème standard" de modele-social (barème progressif,
 * quotient familial, décote, CEHR). Les deux autres méthodes du moteur
 * (taux neutre, taux personnalisé) ne servent qu'à reproduire une fiche de
 * paie ; elles ne répondent pas à « combien d'impôt vais-je payer ? ».
 */
import { documentationUrl, type Situation, withSituation } from './engine.js'
import { type EmployeeInput, employeeAssumptions, employeeSituation, type Period, round, UNIT } from './salary.js'

export type FamilySituation = 'single' | 'couple' | 'widowed'

export interface HouseholdInput {
  familySituation: FamilySituation
  dependentChildren: number
  singleParent: boolean
  /** Autres revenus imposables annuels du foyer, ajoutés tels quels au revenu imposable. */
  otherTaxableIncome: number
}

export interface IncomeTaxResult {
  grossSalary: number
  period: Period
  householdTaxableIncome: number
  annualIncomeTax: number
  effectiveTaxRate: number
  taxShares: number
  withholdingTax: number
  netBeforeIncomeTax: number
  netAfterIncomeTax: number
  assumptions: string[]
  warnings: string[]
  documentation: string
}

// Valeurs de l'énumération publicodes : données du moteur, en français.
const FAMILY_SITUATION: Record<FamilySituation, string> = {
  single: "'célibataire'",
  couple: "'couple'",
  widowed: "'veuf'",
}

const TAX_RULE = 'impôt . foyer fiscal . impôt à payer' as const

export function computeIncomeTax(employee: EmployeeInput, household: HouseholdInput): IncomeTaxResult {
  const unit = UNIT[employee.period]
  // La règle "parent isolé" n'existe que pour un célibataire avec enfant(s) :
  // on ne la transmet que dans ce cas, sinon le moteur la juge non applicable.
  const singleParentApplies =
    household.singleParent && household.familySituation === 'single' && household.dependentChildren > 0

  const situation: Situation = {
    ...employeeSituation(employee),
    'impôt . méthode de calcul': "'barème standard'",
    'impôt . foyer fiscal . situation de famille': FAMILY_SITUATION[household.familySituation],
    'impôt . foyer fiscal . enfants à charge': household.dependentChildren,
    'impôt . foyer fiscal . revenu imposable . autres revenus imposables': `${household.otherTaxableIncome} €/an`,
    ...(singleParentApplies && { 'impôt . foyer fiscal . parent isolé': 'oui' }),
  }

  const e = withSituation(situation)

  return {
    grossSalary: employee.grossSalary,
    period: employee.period,
    // L'administration arrondit le revenu imposable et l'impôt à l'euro le plus
    // proche (art. 1657 CGI) ; le moteur le fait déjà pour le prélèvement
    // (`impôt . montant`). Sans ça, on affichait 3 063,68 € d'impôt pour
    // 3 064 € prélevés.
    householdTaxableIncome: Math.round(e.amount('impôt . foyer fiscal . revenu imposable', '€/an')),
    annualIncomeTax: Math.round(e.amount(TAX_RULE, '€/an')),
    effectiveTaxRate: round(e.amount('impôt . foyer fiscal . taux effectif', '%')),
    taxShares: e.amount('impôt . foyer fiscal . nombre de parts', 'part'),
    withholdingTax: round(e.amount('impôt . montant', unit)),
    netBeforeIncomeTax: round(e.amount('salarié . rémunération . net . à payer avant impôt', unit)),
    netAfterIncomeTax: round(e.amount('salarié . rémunération . net . payé après impôt', unit)),
    assumptions: [
      ...employeeAssumptions(employee, e),
      'Official progressive income tax scale (barème) in force at the reference date, applied to a full year of this salary',
      'Standard deduction for professional expenses (no actual expenses claimed)',
      household.otherTaxableIncome > 0
        ? 'Other household income is added as-is to the taxable income'
        : 'No other taxable income in the household',
      ...(household.singleParent && !singleParentApplies
        ? ['Single-parent status ignored: it only applies to a single person with dependent children']
        : []),
      'Withholding tax computed at the household effective rate (taux effectif)',
    ],
    warnings: [],
    documentation: documentationUrl(TAX_RULE),
  }
}
