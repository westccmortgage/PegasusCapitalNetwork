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
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
