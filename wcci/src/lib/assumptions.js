// Central planning assumptions for the AI Mortgage Strategy Review.
//
// IMPORTANT: These are PLANNING ASSUMPTIONS for education only — not quotes,
// not locked rates, not a Loan Estimate. Every number produced from these must
// be labeled "estimated" / "based on available assumptions, subject to change".
// No value here represents a lender commitment.

// ── Derived tax / insurance rates (scale from purchase price) ──
// Both are back-derived from the reference scenario in the product spec:
//   $1,487.98 monthly tax  on a $1,399,000 home  →  annual rate
//   $300.00  monthly insurance on a $1,399,000 home  →  annual rate
export const TAX_ANNUAL_RATE = (1487.98 * 12) / 1399000;   // ≈ 1.2763%
export const INS_ANNUAL_RATE = (300 * 12) / 1399000;       // ≈ 0.2573%

// ── Lender fee model (scale from loan amount) ──
export const POINTS_PCT = 0.005152;          // discount/points as % of loan
export const ORIGINATOR_COMP_PCT = 0.01;     // originator compensation as % of loan
export const APPLICATION_FEE = 1595;         // fixed application fee

// ── Prepaid interest ──
export const PREPAID_INTEREST_DAYS = 15;     // default; 360-day basis
export const INTEREST_DAY_BASIS = 360;

// ── Third-party / title / escrow / government fee model ──
// Estimated and scaling — the user requirement is that these MOVE with the
// purchase price / loan amount rather than staying fixed. Values are planning
// estimates only and vary widely by state, county, and settlement provider.
export const THIRD_PARTY_FIXED = 1750;           // appraisal, credit, flood, etc.
export const TITLE_ESCROW_FIXED = 900;           // base escrow/settlement
export const TITLE_ESCROW_RATE = 0.0016;         // owner's/lender's title ~ per $ of price
export const GOV_FIXED = 200;                    // recording base
export const GOV_RATE = 0.0011;                  // transfer/recording ~ per $ of price

// ── Escrow reserves collected at closing ──
export const RESERVE_MONTHS_TAX = 3;
export const RESERVE_MONTHS_INS = 2;

// ── Amortization ──
export const LOAN_TERM_MONTHS = 360;

// ── Conforming loan-limit reference points (2025 FHFA) ──
// Used only to CLASSIFY conforming vs high-balance vs jumbo as a planning
// signal. The true limit is per-county and changes yearly — always defer the
// exact figure to a licensed MLO.
export const CONFORMING_BASELINE = 806500;       // national baseline 1-unit
export const CONFORMING_HIGH_COST = 1209750;     // high-cost ceiling 1-unit

// ── Per-path planning-assumption rates (NOT quotes) ──
// Mid-range placeholder rates so the tool can show an ESTIMATED payment.
// A licensed MLO provides real pricing for the borrower's actual profile.
export const PATH_ASSUMPTION_RATE = {
  conformingQM: 0.0675,
  highBalanceQM: 0.07,
  jumboQM: 0.068,
  nonQMBankStatement: 0.08,
  nonQMPnL: 0.081,
  nonQMAssetDepletion: 0.079,
  dscr: 0.0775,
  fha: 0.065,
  va: 0.064,
  bridge: 0.1,
};
