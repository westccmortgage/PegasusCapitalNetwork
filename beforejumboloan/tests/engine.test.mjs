import { test } from 'node:test';
import assert from 'node:assert/strict';

import { monthlyPI } from '../src/js/lib/finance.js';
import { buildPaymentStack } from '../src/js/engine/paymentStack.js';
import { computeJumboGap } from '../src/js/engine/jumboGap.js';
import { computeDSCR } from '../src/js/engine/dscr.js';
import { permanentBuydown, temporaryBuydown } from '../src/js/engine/buydown.js';
import { runStrategy } from '../src/js/engine/index.js';
import { DEFAULTS } from '../src/config/defaults.js';
import { getMarket } from '../src/config/markets.js';
import { getProduct } from '../src/config/products.js';

test('monthlyPI matches a known amortization figure', () => {
  // $500,000 @ 6.875% / 30yr ≈ $3,285.16
  const pi = monthlyPI(500000, 6.875, 30);
  assert.ok(Math.abs(pi - 3285.16) < 1, `got ${pi}`);
});

test('monthlyPI handles 0% rate', () => {
  assert.equal(monthlyPI(360000, 0, 30), 1000);
});

test('payment stack sums components to total', () => {
  const s = buildPaymentStack({
    homePrice: 1000000,
    loanAmount: 800000,
    rate: 6.875,
    termYears: 30,
    propertyTaxRatePct: 1.1,
    homeInsuranceAnnual: 1800,
    hoaMonthly: 100,
    pmiAnnualRatePct: 0,
  });
  const sum = s.pi + s.taxes + s.insurance + s.hoa + s.mi;
  assert.ok(Math.abs(sum - s.total) < 0.05);
  assert.equal(s.ltv, 80);
});

test('payment stack applies PMI above 80% LTV', () => {
  const withMI = buildPaymentStack({
    homePrice: 1000000,
    loanAmount: 900000, // 90% LTV
    rate: 6.875,
    termYears: 30,
    propertyTaxRatePct: 1.1,
    homeInsuranceAnnual: 1800,
    pmiAnnualRatePct: 0.55,
  });
  assert.ok(withMI.miApplies);
  assert.ok(withMI.mi > 0);
});

test('jumbo gap classifies tiers correctly', () => {
  const conf = computeJumboGap({ homePrice: 900000, loanAmount: 700000, conformingLimit: 806500, highBalanceLimit: 1209750 });
  assert.equal(conf.tier, 'conforming');

  const hb = computeJumboGap({ homePrice: 1200000, loanAmount: 1000000, conformingLimit: 806500, highBalanceLimit: 1209750 });
  assert.equal(hb.tier, 'high-balance');

  const jumbo = computeJumboGap({ homePrice: 1600000, loanAmount: 1300000, conformingLimit: 806500, highBalanceLimit: 1209750 });
  assert.equal(jumbo.tier, 'jumbo');
  assert.ok(jumbo.isJumbo);
  // Need 1,300,000 - 1,209,750 = 90,250 more down to avoid jumbo
  assert.equal(jumbo.additionalDownToAvoidJumbo, 90250);
});

test('DSCR ratio and qualification', () => {
  const d = computeDSCR({
    grossMonthlyRent: 6500,
    monthlyDebtService: 5000,
    tiers: DEFAULTS.dscr.tiers,
    minQualifyingRatio: 1.0,
    targetRatio: 1.25,
  });
  assert.equal(d.ratio, 1.3);
  assert.ok(d.qualifies);
  assert.equal(d.tier.label, 'Tier 1 — Strong');
  assert.equal(d.monthlyCashflow, 1500);
});

test('DSCR below minimum does not qualify', () => {
  const d = computeDSCR({
    grossMonthlyRent: 4000,
    monthlyDebtService: 5000,
    tiers: DEFAULTS.dscr.tiers,
    minQualifyingRatio: 1.0,
  });
  assert.equal(d.ratio, 0.8);
  assert.equal(d.qualifies, false);
});

test('permanent buydown lowers rate and computes break-even', () => {
  const b = permanentBuydown({
    loanAmount: 800000,
    baseRate: 6.875,
    termYears: 30,
    points: 2,
    pointCostPctOfLoan: 1.0,
    rateReductionPerPoint: 0.25,
  });
  assert.equal(b.boughtDownRate, 6.375);
  assert.equal(b.cost, 16000); // 2% of 800k
  assert.ok(b.monthlySavings > 0);
  assert.ok(b.breakevenMonths > 0);
});

test('temporary 2-1 buydown produces a 2-year schedule', () => {
  const t = temporaryBuydown({ loanAmount: 800000, noteRate: 6.875, termYears: 30, steps: [2, 1] });
  assert.equal(t.schedule.length, 2);
  assert.equal(t.schedule[0].rate, 4.875);
  assert.equal(t.schedule[1].rate, 5.875);
  assert.ok(t.totalSubsidy > 0);
});

test('runStrategy produces a complete snapshot with aiContext', () => {
  const snap = runStrategy(
    { homePrice: 1000000, downPaymentPct: 15, rate: 6.875 },
    { defaults: DEFAULTS, market: getMarket('la-county-ca'), product: getProduct('conforming') }
  );
  assert.equal(snap.inputs.loanAmount, 850000);
  assert.ok(snap.paymentStack.total > 0);
  assert.ok(snap.jumboGap.tier);
  assert.equal(snap.meta.schemaVersion, 1);
  // aiContext is the Phase 2 contract — must be present and populated.
  assert.ok(snap.aiContext);
  assert.equal(snap.aiContext.strategy, 'conforming');
  assert.equal(snap.aiContext.loanAmount, 850000);
});

test('runStrategy DSCR path applies tier rate add-on', () => {
  const snap = runStrategy(
    { homePrice: 600000, downPaymentPct: 25, rate: 7.0, grossMonthlyRent: 4500 },
    { defaults: DEFAULTS, market: getMarket('national'), product: getProduct('dscr') }
  );
  assert.ok(snap.dscr);
  assert.ok(snap.dscr.ratio > 0);
  // effective rate should be >= base rate (add-on applied per tier)
  assert.ok(snap.inputs.effectiveRate >= snap.inputs.baseRate);
});
