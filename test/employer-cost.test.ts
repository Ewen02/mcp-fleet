/**
 * Coût employeur.
 *
 * Au-delà de 3 Smic, la RGDU ne s'applique pas : le résultat doit être
 * identique à l'API publique de mon-entreprise.urssaf.fr.
 * En dessous, modele-social 11.1.0 (npm) diffère de la prod (voir
 * src/domain/known-issues.ts) : on teste la valeur du moteur publié ET la
 * présence de l'avertissement.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeEmployerCost } from '../src/domain/salary.js'

test('€6,000 gross/month executive → €8,666.80 employer cost (matches the URSSAF API, no RGDU)', () => {
  const r = computeEmployerCost({ grossSalary: 6000, period: 'monthly', isExecutive: true })
  assert.equal(r.totalEmployerCost, 8666.8)
  assert.equal(r.generalReduction, 0)
})

test('no RGDU warning when no reduction applies (no possible gap with the live simulator)', () => {
  const r = computeEmployerCost({ grossSalary: 6000, period: 'monthly', isExecutive: true })
  assert.deepEqual(r.warnings, [])
})

test('€3,200 gross/month executive → published engine value, RGDU applied', () => {
  const r = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true })
  assert.equal(r.totalEmployerCost, 4360.22)
  assert.equal(r.generalReduction, 281.6)
  assert.equal(r.netBeforeIncomeTax, 2505.75)
  // Cohérence interne : coût = brut + cotisations patronales (déjà nettes de la réduction).
  assert.equal(r.totalEmployerCost, Math.round((r.grossSalary + r.employerContributions) * 100) / 100)
})

test('the known RGDU gap with the live simulator is reported as a warning', () => {
  const r = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true })
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0] ?? '', /RGDU/)
})

test('company headcount is used and reflected in the assumptions', () => {
  const small = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true })
  const large = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true, companyHeadcount: 250 })
  assert.notEqual(large.totalEmployerCost, small.totalEmployerCost)
  assert.ok(large.assumptions.includes('Company headcount: 250 employees'))
  assert.ok(small.assumptions.some((a) => a.endsWith('(simulator default)')))
})

test('transport tax (versement mobilité) is flagged only when it applies (11+ employees)', () => {
  const small = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true, companyHeadcount: 10 })
  const large = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true, companyHeadcount: 11 })
  assert.ok(!small.warnings.some((w) => w.includes('versement mobilité')))
  assert.ok(large.warnings.some((w) => w.includes('versement mobilité')))
})

test('the default work-accident rate is stated in the assumptions', () => {
  const r = computeEmployerCost({ grossSalary: 3200, period: 'monthly', isExecutive: true })
  assert.ok(r.assumptions.some((a) => a.startsWith('Work-accident rate (taux AT/MP): 2.08%')))
})
