// ─────────────────────────────────────────────────────────────────────────────
// VERIFIED CONFORMING LOAN LIMITS — 2026 FHFA national baseline.
//
// The national BASELINE (one-unit) conforming limit is the owner-verified value.
// A loan at or below the applicable baseline is conforming BY LOAN SIZE — it is
// NOT jumbo, and county does NOT need to be known merely to decide that. County
// may still affect high-balance classification, pricing, or program structure —
// but not the fact that the loan is below the national baseline.
//
// High-cost "high-balance" ceilings are county-specific and are NOT hard-coded
// here (they require the current county lookup by a licensed professional).
// ─────────────────────────────────────────────────────────────────────────────

export const CONFORMING_YEAR = 2026;

// National baseline by unit count (2026).
export const CONFORMING_BASELINE = {
  1: 832750,
  2: 1066150,
  3: 1288650,
  4: 1601650,
};

export function baselineConformingLimit(units = 1) {
  const u = Math.min(4, Math.max(1, Math.round(Number(units) || 1)));
  return CONFORMING_BASELINE[u];
}

/**
 * Classify a loan purely by SIZE against the national baseline.
 * @param {{loanAmount?: number, units?: number}} p
 * @returns {{ baseline:number, units:number, known:boolean,
 *             conformingBySize:boolean, jumboBySize:boolean }}
 */
export function classifyLoanSize({ loanAmount, units = 1 } = {}) {
  const baseline = baselineConformingLimit(units);
  const amt = Number(loanAmount);
  const known = loanAmount != null && loanAmount !== '' && !Number.isNaN(amt) && amt > 0;
  return {
    baseline,
    units: Math.min(4, Math.max(1, Math.round(Number(units) || 1))),
    known,
    conformingBySize: known && amt <= baseline,
    jumboBySize: known && amt > baseline,
  };
}
