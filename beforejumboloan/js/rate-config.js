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
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
