/**
 * Adaptateur MCP de l'estimation d'impôt sur le revenu.
 * Même structure que les autres tools ; seuls les champs du foyer s'ajoutent.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { computeIncomeTax } from '../domain/income-tax.js'
import {
  assumptionsSchema,
  CALCULATION_ANNOTATIONS,
  employeeFields,
  footerLines,
  formatEuros,
  periodSchema,
  periodSuffix,
  source,
  sourceSchema,
  warningsSchema,
} from './shared.js'
import { instrument } from './telemetry.js'

const inputSchema = z.object({
  ...employeeFields,
  family_situation: z
    .enum(['single', 'couple', 'widowed'])
    .default('single')
    .describe(
      'Tax household status: single (célibataire, divorcé), couple (marié ou pacsé, joint return), widowed (veuf).',
    ),
  dependent_children: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(0)
    .describe('Number of dependent children in the tax household (enfants à charge).'),
  single_parent: z
    .boolean()
    .default(false)
    .describe('true if a single person lives alone with their children (parent isolé, case T). Ignored otherwise.'),
  other_taxable_income: z
    .number()
    .min(0)
    .max(100_000_000)
    .default(0)
    .describe(
      'Other annual taxable income of the household in euros, added as-is (e.g. the spouse’s taxable income after the 10% deduction). ' +
        'Leave 0 for a single-income household.',
    ),
})

const outputSchema = z.object({
  gross_salary: z.number(),
  period: periodSchema,
  household_taxable_income: z
    .number()
    .describe('Annual taxable income of the household (revenu net imposable du foyer).'),
  annual_income_tax: z
    .number()
    .describe('Annual income tax due by the household (impôt sur le revenu), yearly amount.'),
  effective_tax_rate: z.number().describe('Household effective tax rate in percent (taux effectif).'),
  tax_shares: z.number().describe('Number of tax shares (nombre de parts de quotient familial).'),
  withholding_tax: z
    .number()
    .describe('Income tax withheld on this salary for the requested period (prélèvement à la source).'),
  net_before_income_tax: z.number().describe('Net salary before withholding tax, for the requested period.'),
  net_after_income_tax: z
    .number()
    .describe('Net salary actually received after withholding tax (net payé après impôt), for the requested period.'),
  assumptions: assumptionsSchema,
  warnings: warningsSchema,
  source: sourceSchema,
})

/** Forme du `structuredContent` renvoyé (utile aux clients et aux tests). */
export type IncomeTaxEstimateOutput = z.infer<typeof outputSchema>

export function registerIncomeTaxEstimate(server: McpServer): void {
  server.registerTool(
    'income_tax_estimate',
    {
      title: 'Income tax estimate (France)',
      description:
        'Estimates French income tax (impôt sur le revenu) for a household whose main income is a salary, from the gross salary (salaire brut) and the household situation, ' +
        'using the official URSSAF calculation engine (mon-entreprise.urssaf.fr) with the official progressive scale, family quotient (quotient familial) and discount (décote). ' +
        'Use it for questions about income tax, tax rate, withholding tax (prélèvement à la source) or net salary after tax (net après impôt). ' +
        'Returns the annual tax of the household, the effective rate, the tax shares, the withholding and net after tax for the requested period, assumptions and the source of the rules. ' +
        'It is an estimate: it does not handle tax credits, deductions for actual expenses or non-salary income beyond the amount given.',
      inputSchema,
      outputSchema,
      annotations: CALCULATION_ANNOTATIONS,
    },
    instrument('income_tax_estimate', async (args) => {
      const r = computeIncomeTax(
        {
          grossSalary: args.gross_salary,
          period: args.period,
          isExecutive: args.is_executive,
          alsaceMoselle: args.alsace_moselle,
        },
        {
          familySituation: args.family_situation,
          dependentChildren: args.dependent_children,
          singleParent: args.single_parent,
          otherTaxableIncome: args.other_taxable_income,
        },
      )

      const result: z.infer<typeof outputSchema> = {
        gross_salary: r.grossSalary,
        period: r.period,
        household_taxable_income: r.householdTaxableIncome,
        annual_income_tax: r.annualIncomeTax,
        effective_tax_rate: r.effectiveTaxRate,
        tax_shares: r.taxShares,
        withholding_tax: r.withholdingTax,
        net_before_income_tax: r.netBeforeIncomeTax,
        net_after_income_tax: r.netAfterIncomeTax,
        assumptions: r.assumptions,
        warnings: r.warnings,
        source: source(r.documentation),
      }

      const p = periodSuffix(args.period)
      const text = [
        `Household income tax: ${formatEuros(r.annualIncomeTax)}/year (${r.taxShares} tax shares, effective rate ${r.effectiveTaxRate}%, taxable income ${formatEuros(r.householdTaxableIncome)}/year).`,
        `On this salary: withholding ${formatEuros(r.withholdingTax)}${p}, net ${formatEuros(r.netBeforeIncomeTax)}${p} before tax → ${formatEuros(r.netAfterIncomeTax)}${p} after tax.`,
        ...footerLines(r),
      ].join('\n')

      return { content: [{ type: 'text', text }], structuredContent: result }
    }),
  )
}
