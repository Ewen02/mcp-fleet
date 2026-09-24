/**
 * Adaptateur MCP du coût employeur. Même structure que gross-to-net.ts :
 * schémas publics, mapping vers le domaine, texte pour le LLM.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { assumptionsSchema, instrument, READ_ONLY_ANNOTATIONS, warningsSchema } from '@repo/mcp-kit'
import * as z from 'zod/v4'
import { computeEmployerCost } from '../domain/salary.js'
import { employeeFields, footerLines, formatEuros, periodSchema, periodSuffix, source, sourceSchema } from './shared.js'

const inputSchema = z.object({
  ...employeeFields,
  // Seul paramètre propre à ce tool : l'effectif change certains taux patronaux
  // (FNAL, formation, participation construction, paramètre de la RGDU).
  company_headcount: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .optional()
    .describe('Number of employees in the company (effectif). Affects some employer rates. Omit if unknown.'),
})

const outputSchema = z.object({
  gross_salary: z.number(),
  period: periodSchema,
  total_employer_cost: z
    .number()
    .describe(
      'Total cost for the employer: gross salary + employer contributions, after reductions (coût total employeur, "salaire chargé").',
    ),
  employer_contributions: z
    .number()
    .describe('Employer social contributions after reductions (cotisations patronales).'),
  general_reduction: z
    .number()
    .describe(
      'General contribution reduction already deducted, 0 above ~3× minimum wage (réduction générale dégressive unique, RGDU).',
    ),
  net_before_income_tax: z.number().describe('What the employee receives before withholding tax, for comparison.'),
  cost_to_net_ratio: z.number().describe('total_employer_cost / net_before_income_tax.'),
  assumptions: assumptionsSchema,
  warnings: warningsSchema,
  source: sourceSchema,
})

/** Forme du `structuredContent` renvoyé (utile aux clients et aux tests). */
export type EmployerCostOutput = z.infer<typeof outputSchema>

export function registerEmployerCost(server: McpServer): void {
  server.registerTool(
    'employer_cost',
    {
      title: 'Employer cost of a salary (France)',
      // Formulée pour être choisie en premier sur toute question de coût :
      // lors du test dans Claude Desktop, sans ce tool, le modèle appelait
      // gross_to_net puis estimait le reste par recherche web.
      description:
        'Computes the total cost of an employee for the employer in France (coût employeur, coût total, salaire chargé, super brut) from a gross salary (salaire brut), ' +
        'using the official URSSAF calculation engine (mon-entreprise.urssaf.fr). ' +
        'Use it for ANY question about how much an employee costs, employer contributions (cotisations patronales) or the gap between cost and net. ' +
        'Returns total employer cost, employer contributions, the general reduction applied (RGDU), the net for comparison, assumptions, warnings and the source of the rules.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    instrument('employer_cost', async ({ gross_salary, period, is_executive, alsace_moselle, company_headcount }) => {
      const r = computeEmployerCost({
        grossSalary: gross_salary,
        period,
        isExecutive: is_executive,
        alsaceMoselle: alsace_moselle,
        ...(company_headcount !== undefined && { companyHeadcount: company_headcount }),
      })

      const result: z.infer<typeof outputSchema> = {
        gross_salary: r.grossSalary,
        period: r.period,
        total_employer_cost: r.totalEmployerCost,
        employer_contributions: r.employerContributions,
        general_reduction: r.generalReduction,
        net_before_income_tax: r.netBeforeIncomeTax,
        cost_to_net_ratio: r.costToNetRatio,
        assumptions: r.assumptions,
        warnings: r.warnings,
        source: source(r.documentation),
      }

      const p = periodSuffix(period)
      const text = [
        `Gross ${formatEuros(r.grossSalary)}${p} → total employer cost ${formatEuros(r.totalEmployerCost)}${p}.`,
        `Employer contributions: ${formatEuros(r.employerContributions)}${p} (after a general reduction of ${formatEuros(r.generalReduction)}${p}).`,
        `The employee receives ${formatEuros(r.netBeforeIncomeTax)}${p} before income tax: the cost is ${r.costToNetRatio}× the net.`,
        ...footerLines(r),
      ].join('\n')

      return { content: [{ type: 'text', text }], structuredContent: result }
    }),
  )
}
