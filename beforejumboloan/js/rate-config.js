/* ============================================================
   BeforeJumboLoan.com — centralized rate ASSUMPTIONS (Phase 6)
   ------------------------------------------------------------
   These are owner-provided EDUCATIONAL assumptions, NOT live rates,
   not rate quotes, APRs, locked rates, or commitments to lend.
   Edit values in ONE place. The engine (js/engine.js) reads
   window.BJLRates when present and falls back to its own defaults.
   ============================================================ */
(function (global) {
  "use strict";
  global.BJLRates = {
    lastUpdated: "2026-06-12",
    label: "Owner-provided educational rate assumptions. Verify current pricing before use.",
    disclaimer: "Educational assumptions only — not live rates, rate quotes, APRs, locked rates, or commitments to lend. Pricing varies by lender, loan purpose, occupancy, property type, borrower profile, and market.",
    /* 30-year assumptions by review path (percent). */
    assumptions: {
      conforming: 6.58,
      high_balance: 6.66,
      jumbo: 6.84,
      dscr: 7.49,
      bank_statement: 7.65,
      interest_only_jumbo: 7.10,
      second_home: 6.99,
      investment: 7.49,
      fha: 6.14,
      va: 6.16
    },
    /* Credit-score rate ADD-ONS (educational, LLPA-style). Added on top of the
       path assumption. 740+ is the strong-pricing tier — you do NOT need 780.
       Ordered by minimum score; first match wins. */
    score_adjustments: [
      { min: 760, add: 0.00, tier: "Excellent (760+)" },
      { min: 740, add: 0.00, tier: "Strong (740–759) — already great for pricing" },
      { min: 720, add: 0.25, tier: "Good (720–739)" },
      { min: 700, add: 0.50, tier: "Fair (700–719)" },
      { min: 680, add: 0.875, tier: "Below par (680–699)" },
      { min: 660, add: 1.25, tier: "Lower (660–679)" },
      { min: 640, add: 1.75, tier: "Low (640–659)" },
      { min: 620, add: 2.25, tier: "Very low (620–639)" },
      { min: 0,   add: 3.00, tier: "Under 620 — needs licensed review" }
    ],
    /* Mortgage insurance (PMI) ANNUAL factors as a % of the loan, by LTV band.
       Applies only when LTV > 80% (less than 20% down). Educational estimate. */
    mi_annual_factors: [
      { maxLtv: 80,  pct: 0.00 },
      { maxLtv: 85,  pct: 0.30 },
      { maxLtv: 90,  pct: 0.49 },
      { maxLtv: 95,  pct: 0.67 },
      { maxLtv: 97,  pct: 0.92 },
      { maxLtv: 100, pct: 1.10 }
    ],
    /* PMI is also score-sensitive — a light multiplier on the factor above. */
    mi_score_multiplier: [
      { min: 760, mult: 1.00 },
      { min: 740, mult: 1.05 },
      { min: 720, mult: 1.15 },
      { min: 700, mult: 1.30 },
      { min: 680, mult: 1.50 },
      { min: 0,   mult: 1.80 }
    ],
    /* Income documentation type → rate ADD-ON (educational). W-2 / full-doc is
       the baseline; bank-statement and 1099 are Non-QM and price higher. */
    doc_type_adjustments: [
      { key: "w2",             add: 0.00,  label: "W-2 (full documentation)",      nonqm: false },
      { key: "self_employed",  add: 0.125, label: "Self-employed (tax returns)",   nonqm: false },
      { key: "ten99",          add: 0.75,  label: "1099 (Non-QM)",                 nonqm: true },
      { key: "bank_statement", add: 0.90,  label: "Bank statements (Non-QM)",      nonqm: true }
    ],
    /* Affordability (educational, DTI-based). max_dti = share of gross monthly
       income available for housing debt; ti_share = portion of that budget
       reserved for taxes / insurance / HOA / PMI (so the rest is P&I). */
    affordability: {
      max_dti: 0.43,
      ti_share: 0.18
    },
    /* Permanent buydown: the borrower chooses how many points to pay; each point
       buys roughly point_value_pct off the rate (educational rule of thumb). */
    buydown: {
      point_value_pct: 0.25,
      points_options: [0.5, 1, 1.5]
    },
    /* VERY ROUGH educational income-tax estimate — single filer, standard
       deduction, no other income/credits/deductions. NOT tax advice. */
    tax: {
      standard_deduction: 14600,
      federal_brackets: [
        { upTo: 11600, rate: 0.10 }, { upTo: 47150, rate: 0.12 },
        { upTo: 100525, rate: 0.22 }, { upTo: 191950, rate: 0.24 },
        { upTo: 243725, rate: 0.32 }, { upTo: 609350, rate: 0.35 },
        { upTo: null, rate: 0.37 }
      ],
      /* Approximate EFFECTIVE state income-tax rates (%). No-income-tax states
         are 0. Progressive states use a rough higher-income effective rate. */
      state_effective_rate: {
        AL: 4.5, AK: 0, AZ: 2.5, AR: 4.4, CA: 8.0, CO: 4.4, CT: 5.5, DE: 5.5, DC: 8.5,
        FL: 0, GA: 5.39, HI: 8.0, ID: 5.8, IL: 4.95, IN: 3.15, IA: 5.7, KS: 5.2, KY: 4.0,
        LA: 4.25, ME: 6.75, MD: 5.0, MA: 5.0, MI: 4.25, MN: 7.0, MS: 4.7, MO: 4.8, MT: 5.9,
        NE: 5.84, NV: 0, NH: 0, NJ: 6.5, NM: 4.9, NY: 6.85, NC: 4.5, ND: 2.0, OH: 3.5,
        OK: 4.75, OR: 9.0, PA: 3.07, RI: 5.5, SC: 6.4, SD: 0, TN: 0, TX: 0, UT: 4.65,
        VT: 6.6, VA: 5.75, WA: 0, WV: 5.1, WI: 5.3, WY: 0, PR: 0, GU: 0, VI: 0
      },
      default_state_rate: 5.0
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
