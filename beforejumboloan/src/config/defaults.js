/**
 * defaults.js
 * Global default assumptions for the BeforeJumboLoan strategy engine.
 *
 * Everything in this file is intended to be edited by a non-developer.
 * The engine never hard-codes a number that belongs here.
 */

export const DEFAULTS = {
  // Conforming loan limits (FHFA). Update annually.
  // These are national fallbacks — per-market overrides live in markets.js.
  loanLimits: {
    year: 2025,
    baselineConforming: 806500, // 1-unit national baseline
    highBalanceCeiling: 1209750, // 1-unit high-cost-area ceiling (150% of baseline)
    lastVerified: '2025-01-01',
    source: 'FHFA Conforming Loan Limit Values',
  },

  // Loan + amortization defaults
  loan: {
    termYears: 30,
    baseRatePct: 6.875, // illustrative starting note rate, not a quote
    downPaymentPct: 20,
  },

  // Carrying-cost assumptions used by the payment stack when a market
  // or user does not supply explicit numbers.
  carrying: {
    propertyTaxRatePct: 1.1, // effective annual % of home price
    homeInsuranceAnnual: 1800, // $/yr
    hoaMonthly: 0, // $/mo
    // PMI applies to conforming loans above 80% LTV. Annual % of loan balance.
    pmiAnnualRatePct: 0.55,
  },

  // DSCR (Debt-Service Coverage Ratio) program defaults
  dscr: {
    minQualifyingRatio: 1.0, // many programs price tiers at 1.0 / 1.10 / 1.25
    targetRatio: 1.25,
    // Rate add-ons (bps) by DSCR tier — illustrative pricing grid.
    tiers: [
      { minRatio: 1.25, label: 'Tier 1 — Strong', rateAddPct: 0.0 },
      { minRatio: 1.10, label: 'Tier 2 — Standard', rateAddPct: 0.25 },
      { minRatio: 1.0, label: 'Tier 3 — Minimum', rateAddPct: 0.5 },
      { minRatio: 0.75, label: 'Tier 4 — Ratio Buydown', rateAddPct: 1.0 },
    ],
  },

  // Rate buydown defaults
  buydown: {
    // Permanent discount points: each point typically buys ~0.25% off rate.
    pointCostPctOfLoan: 1.0, // 1 point = 1% of loan amount
    rateReductionPerPoint: 0.25, // % rate reduction per point (illustrative)
    maxPoints: 4,
    // Temporary buydown structures (seller/lender funded escrow).
    temporaryStructures: [
      { id: '3-2-1', label: '3-2-1 Buydown', steps: [3, 2, 1] },
      { id: '2-1', label: '2-1 Buydown', steps: [2, 1] },
      { id: '1-0', label: '1-0 Buydown', steps: [1] },
    ],
  },

  // Lead capture
  lead: {
    endpoint: '/.netlify/functions/submit-lead',
    // Soft validation only — the function re-validates server-side.
    requiredFields: ['name', 'email'],
  },

  // Phase 2 AI seam (not active in Phase 1)
  ai: {
    enabled: false,
    explainEndpoint: '/.netlify/functions/explain-strategy',
  },

  // Compliance
  compliance: {
    nmls: 'NMLS #________',
    equalHousing: true,
    disclaimer:
      'All figures are illustrative estimates for educational purposes only and are not a loan commitment, ' +
      'pre-approval, or offer to lend. Rates, fees, and program terms are subject to change and underwriting approval.',
  },
};

export default DEFAULTS;
