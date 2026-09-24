/**
 * Tests du domaine, sans MCP : on vérifie le calcul lui-même.
 *
 * Valeurs de référence obtenues sur l'API publique de mon-entreprise.urssaf.fr
 * (POST /api/v1/evaluate) avec la même situation. Si modele-social change de
 * version, ces tests cassent volontairement : un changement de règles doit
 * être une décision consciente, pas une surprise en prod.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RULES_SOURCE } from '../src/domain/engine.js'
import { computeGrossToNet } from '../src/domain/salary.js'

test('€3,000 gross/month non-executive → €2,352.85 net (matches the URSSAF simulator)', () => {
  const r = computeGrossToNet({ grossSalary: 3000, period: 'monthly', isExecutive: false })
  assert.equal(r.netBeforeIncomeTax, 2352.85)
  assert.equal(r.taxableNet, 2458.91)
  assert.equal(r.employeeContributions, 647.15)
})

test('executive status increases contributions (APEC, provident insurance)', () => {
  const nonExecutive = computeGrossToNet({ grossSalary: 3000, period: 'monthly', isExecutive: false })
  const executive = computeGrossToNet({ grossSalary: 3000, period: 'monthly', isExecutive: true })
  assert.equal(executive.netBeforeIncomeTax, 2347.77)
  assert.ok(executive.netBeforeIncomeTax < nonExecutive.netBeforeIncomeTax)
})

test('yearly period is consistent with monthly', () => {
  const yearly = computeGrossToNet({ grossSalary: 36000, period: 'yearly', isExecutive: false })
  assert.equal(yearly.netBeforeIncomeTax, 28234.23)
})

test('Alsace-Moselle regime lowers the net (extra health contribution), matches the URSSAF API', () => {
  const r = computeGrossToNet({ grossSalary: 3000, period: 'monthly', isExecutive: false, alsaceMoselle: true })
  assert.equal(r.netBeforeIncomeTax, 2313.85)
  assert.ok(r.assumptions.includes('Alsace-Moselle regime'))
})

test('rules source is traceable', () => {
  assert.equal(RULES_SOURCE.year, 2026)
  assert.equal(RULES_SOURCE.reference_date, '2026-07-01')
})

// Garde-fou volontaire : une montée de version doit faire relire les valeurs
// de référence ET src/domain/known-issues.ts.
test('modele-social version is the pinned one', () => {
  assert.equal(RULES_SOURCE.modele_social_version, '11.1.0')
})
