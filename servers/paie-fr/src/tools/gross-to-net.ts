/**
 * Adaptateur MCP du calcul brut → net.
 *
 * Son seul rôle : traduire le contrat public du tool (snake_case, schémas
 * zod, texte pour le LLM) vers le domaine, et inversement. Aucune règle
 * de calcul ici.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { assumptionsSchema, instrument, READ_ONLY_ANNOTATIONS, warningsSchema } from '@repo/mcp-kit'
import * as z from 'zod/v4'
import { computeGrossToNet } from '../domain/salary.js'
import { employeeFields, footerLines, formatEuros, periodSchema, periodSuffix, source, sourceSchema } from './shared.js'

const inputSchema = z.object(employeeFields)

const outputSchema = z.object({
  gross_salary: z.number(),
  period: periodSchema,
  net_before_income_tax: z
    .number()
    .describe('Net amount paid to the employee before withholding tax (net à payer avant impôt).'),
  taxable_net: z.number().describe('Base for withholding tax and the income tax return (net imposable).'),
  employee_contributions: z.number().describe('Employee social contributions (cotisations salariales).'),
  assumptions: assumptionsSchema,
  warnings: warningsSchema,
  source: sourceSchema,
})

/** Forme du `structuredContent` renvoyé (utile aux clients et aux tests). */
export type GrossToNetOutput = z.infer<typeof outputSchema>

export function registerGrossToNet(server: McpServer): void {
  server.registerTool(
    'gross_to_net',
    {
      title: 'Gross → net salary (France)',
      // La description est un prompt : c'est elle que le modèle lit pour
      // décider quand appeler le tool et comment remplir les arguments.
      // Les termes français entre parenthèses l'aident à matcher les
      // questions posées en français.
      description:
        'Converts a gross salary (salaire brut) into net salary (salaire net) for a private-sector employee in France, ' +
        'using the official URSSAF calculation engine (mon-entreprise.urssaf.fr). ' +
        'Use it whenever someone asks how much a gross salary is in net, or for the amount of employee contributions (cotisations salariales). ' +
        'Returns net before income tax, taxable net, contributions, the assumptions applied and the source of the rules (including the year). ' +
        'For employer cost use employer_cost; for income tax or net after tax use income_tax_estimate.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    instrument('gross_to_net', async ({ gross_salary, period, is_executive, alsace_moselle }) => {
      const r = computeGrossToNet({
        grossSalary: gross_salary,
        period,
        isExecutive: is_executive,
        alsaceMoselle: alsace_moselle,
      })

      const result: z.infer<typeof outputSchema> = {
        gross_salary: r.grossSalary,
        period: r.period,
        net_before_income_tax: r.netBeforeIncomeTax,
        taxable_net: r.taxableNet,
        employee_contributions: r.employeeContributions,
        assumptions: r.assumptions,
        warnings: r.warnings,
        source: source(r.documentation),
      }

      const p = periodSuffix(period)
      const text = [
        `Gross ${formatEuros(r.grossSalary)}${p} → net before income tax ${formatEuros(r.netBeforeIncomeTax)}${p}.`,
        `Taxable net: ${formatEuros(r.taxableNet)}${p}. Employee contributions: ${formatEuros(r.employeeContributions)}${p}.`,
        ...footerLines(r),
      ].join('\n')

      return { content: [{ type: 'text', text }], structuredContent: result }
    }),
  )
}
