/**
 * Impôt sur le revenu : valeurs de référence obtenues sur l'API publique
 * de mon-entreprise.urssaf.fr avec les mêmes situations.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeIncomeTax, type HouseholdInput } from '../src/domain/income-tax.js'

const SINGLE: HouseholdInput = {
  familySituation: 'single',
  dependentChildren: 0,
  singleParent: false,
  otherTaxableIncome: 0,
}

test('single, €3,200 gross/month executive → €1,852 tax/year, €2,351.41 net after tax', () => {
  const r = computeIncomeTax({ grossSalary: 3200, period: 'monthly', isExecutive: true }, SINGLE)
  assert.equal(r.annualIncomeTax, 1852)
  assert.equal(r.effectiveTaxRate, 5.79)
  assert.equal(r.taxShares, 1)
  assert.equal(r.householdTaxableIncome, 28802)
  assert.equal(r.netAfterIncomeTax, 2351.41)
})

test('couple, 2 children, €30,000 other income → 3 shares, €2,352 tax/year', () => {
  const r = computeIncomeTax(
    { grossSalary: 3200, period: 'monthly', isExecutive: true },
    { familySituation: 'couple', dependentChildren: 2, singleParent: false, otherTaxableIncome: 30000 },
  )
  assert.equal(r.taxShares, 3)
  assert.equal(r.annualIncomeTax, 2352)
  assert.equal(r.netAfterIncomeTax, 2404.58)
})

test('single parent with 1 child → 2 shares (extra half share)', () => {
  const r = computeIncomeTax(
    { grossSalary: 6000, period: 'monthly', isExecutive: true },
    { familySituation: 'single', dependentChildren: 1, singleParent: true, otherTaxableIncome: 0 },
  )
  assert.equal(r.taxShares, 2)
  assert.equal(r.annualIncomeTax, 5007)
  assert.equal(r.netAfterIncomeTax, 4318.47)
})

test('single-parent flag is ignored (and said so) for a couple', () => {
  const r = computeIncomeTax(
    { grossSalary: 3200, period: 'monthly', isExecutive: true },
    { familySituation: 'couple', dependentChildren: 1, singleParent: true, otherTaxableIncome: 0 },
  )
  assert.ok(r.assumptions.some((a) => a.startsWith('Single-parent status ignored')))
})

test('annual tax and yearly withholding are both rounded to the euro and agree', () => {
  const r = computeIncomeTax({ grossSalary: 45000, period: 'yearly', isExecutive: false }, SINGLE)
  assert.equal(r.annualIncomeTax, 3064)
  assert.equal(r.withholdingTax, 3064)
})

test('yearly period returns yearly withholding and net', () => {
  const monthly = computeIncomeTax({ grossSalary: 3200, period: 'monthly', isExecutive: true }, SINGLE)
  const yearly = computeIncomeTax({ grossSalary: 38400, period: 'yearly', isExecutive: true }, SINGLE)
  assert.equal(yearly.annualIncomeTax, monthly.annualIncomeTax)
  assert.ok(Math.abs(yearly.netAfterIncomeTax - monthly.netAfterIncomeTax * 12) < 0.1)
})
