/**
 * engine/index.js
 * The single entry point that turns a raw scenario + config into a complete,
 * structured "strategy snapshot".
 *
 * Design goals:
 *  - Pure & deterministic: same inputs -> same snapshot (no DOM, no I/O).
 *  - One object out: the UI renders it AND Phase 2's AI explainer consumes it.
 *  - Config-driven: defaults/markets/products are injected, not imported here,
 *    so the engine stays testable and reusable.
 */

import { buildPaymentStack } from './paymentStack.js';
import { computeJumboGap } from './jumboGap.js';
import { computeDSCR } from './dscr.js';
import { permanentBuydown, temporaryBuydown } from './buydown.js';
import { round2, round3 } from '../lib/finance.js';

/**
 * @param {Object} scenario          user inputs (raw numbers)
 * @param {Object} ctx               { defaults, market, product }
 * @returns {Object} snapshot
 */
export function runStrategy(scenario, ctx) {
  const { defaults, market, product } = ctx;

  // ---- Resolve inputs (scenario overrides market overrides defaults) ----
  const homePrice = num(scenario.homePrice, 1000000);
  const downPaymentPct = num(scenario.downPaymentPct, defaults.loan.downPaymentPct);
  const downPayment = round2(homePrice * (downPaymentPct / 100));
  const loanAmount = round2(homePrice - downPayment);

  const termYears = num(scenario.termYears, defaults.loan.termYears);

  const propertyTaxRatePct = num(scenario.propertyTaxRatePct, market.propertyTaxRatePct);
  const homeInsuranceAnnual = num(scenario.homeInsuranceAnnual, market.homeInsuranceAnnual);
  const hoaMonthly = num(scenario.hoaMonthly, 0);

  // ---- Before-Jumbo Gap (drives the effective rate add-ons later) ----
  const jumbo = computeJumboGap({
    homePrice,
    loanAmount,
    conformingLimit: market.conformingLimit,
    highBalanceLimit: market.highBalanceLimit,
  });

  // ---- Effective rate: base + DSCR tier add-on (if applicable) ----
  let baseRate = num(scenario.rate, defaults.loan.baseRatePct);
  let dscr = null;

  // First-pass payment stack at base rate (needed for DSCR's debt service).
  const stackBase = buildPaymentStack({
    homePrice,
    loanAmount,
    rate: baseRate,
    termYears,
    propertyTaxRatePct,
    homeInsuranceAnnual,
    hoaMonthly,
    pmiAnnualRatePct: jumbo.tier === 'conforming' ? defaults.carrying.pmiAnnualRatePct : 0,
  });

  let effectiveRate = baseRate;

  if (product.id === 'dscr') {
    dscr = computeDSCR({
      grossMonthlyRent: num(scenario.grossMonthlyRent, 0),
      monthlyDebtService: stackBase.total,
      tiers: defaults.dscr.tiers,
      minQualifyingRatio: defaults.dscr.minQualifyingRatio,
      targetRatio: defaults.dscr.targetRatio,
    });
    if (dscr.tier) effectiveRate = round3(baseRate + dscr.tier.rateAddPct);
  }

  // ---- Final payment stack at the effective rate ----
  const stack = buildPaymentStack({
    homePrice,
    loanAmount,
    rate: effectiveRate,
    termYears,
    propertyTaxRatePct,
    homeInsuranceAnnual,
    hoaMonthly,
    // MI only on conforming financing; DSCR/jumbo priced differently.
    pmiAnnualRatePct:
      product.id === 'conforming' && jumbo.tier === 'conforming'
        ? defaults.carrying.pmiAnnualRatePct
        : 0,
  });

  // Recompute DSCR against the final stack so the ratio reflects true PITIA.
  if (product.id === 'dscr') {
    dscr = computeDSCR({
      grossMonthlyRent: num(scenario.grossMonthlyRent, 0),
      monthlyDebtService: stack.total,
      tiers: defaults.dscr.tiers,
      minQualifyingRatio: defaults.dscr.minQualifyingRatio,
      targetRatio: defaults.dscr.targetRatio,
    });
  }

  // ---- Buydown (only computed for the buydown product, but cheap & pure) ----
  let buydown = null;
  if (product.id === 'buydown') {
    const points = num(scenario.points, 1);
    const structureId = scenario.temporaryStructure || '2-1';
    const structure =
      defaults.buydown.temporaryStructures.find((s) => s.id === structureId) ||
      defaults.buydown.temporaryStructures[0];

    buydown = {
      permanent: permanentBuydown({
        loanAmount,
        baseRate,
        termYears,
        points,
        pointCostPctOfLoan: defaults.buydown.pointCostPctOfLoan,
        rateReductionPerPoint: defaults.buydown.rateReductionPerPoint,
      }),
      temporary: temporaryBuydown({
        loanAmount,
        noteRate: baseRate,
        termYears,
        steps: structure.steps,
      }),
      structureId: structure.id,
      structureLabel: structure.label,
    };
  }

  // ---- Structured snapshot (UI + Phase 2 AI both consume THIS) ----
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      product: { id: product.id, label: product.label },
      market: { id: market.id, label: market.label, state: market.state },
      schemaVersion: 1,
    },
    inputs: {
      homePrice,
      downPaymentPct,
      downPayment,
      loanAmount,
      termYears,
      baseRate,
      effectiveRate,
      propertyTaxRatePct,
      homeInsuranceAnnual,
      hoaMonthly,
      grossMonthlyRent: num(scenario.grossMonthlyRent, 0),
    },
    paymentStack: stack,
    jumboGap: jumbo,
    dscr,
    buydown,
    // A compact, model-friendly summary. Phase 2 hands this to the AI explainer.
    aiContext: buildAiContext({ product, market, inputs: { homePrice, loanAmount, downPaymentPct }, stack, jumbo, dscr, buydown }),
  };
}

/** Compact, declarative facts for the (future) AI explainer. No prose here. */
function buildAiContext({ product, market, inputs, stack, jumbo, dscr, buydown }) {
  return {
    strategy: product.id,
    market: market.label,
    homePrice: inputs.homePrice,
    loanAmount: inputs.loanAmount,
    downPaymentPct: inputs.downPaymentPct,
    monthlyPayment: stack.total,
    ltv: stack.ltv,
    jumboTier: jumbo.tier,
    additionalDownToStayConforming: jumbo.additionalDownToStayConforming,
    dscrRatio: dscr ? dscr.ratio : null,
    dscrQualifies: dscr ? dscr.qualifies : null,
    buydownBreakevenMonths: buydown ? buydown.permanent.breakevenMonths : null,
  };
}

function num(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default runStrategy;
