/**
 * finance.js
 * Pure financial primitives. No DOM, no config — just math.
 * Safe to import in the browser and in Node (for tests).
 */

/** Monthly periodic rate from an annual percentage rate. */
export function monthlyRate(annualRatePct) {
  return annualRatePct / 100 / 12;
}

/**
 * Fully-amortizing monthly principal & interest payment.
 * @param {number} principal     loan amount
 * @param {number} annualRatePct e.g. 6.875
 * @param {number} termYears     e.g. 30
 * @returns {number} monthly P&I
 */
export function monthlyPI(principal, annualRatePct, termYears) {
  if (principal <= 0 || termYears <= 0) return 0;
  const n = Math.round(termYears * 12);
  const r = monthlyRate(annualRatePct);
  if (r === 0) return principal / n;
  const factor = Math.pow(1 + r, n);
  return (principal * r * factor) / (factor - 1);
}

/**
 * Remaining balance after `monthsPaid` payments on a fixed loan.
 * Useful for break-even and buydown comparisons.
 */
export function remainingBalance(principal, annualRatePct, termYears, monthsPaid) {
  const n = Math.round(termYears * 12);
  const r = monthlyRate(annualRatePct);
  if (r === 0) return Math.max(0, principal * (1 - monthsPaid / n));
  const pmt = monthlyPI(principal, annualRatePct, termYears);
  const bal = principal * Math.pow(1 + r, monthsPaid) - pmt * ((Math.pow(1 + r, monthsPaid) - 1) / r);
  return Math.max(0, bal);
}

/** Loan-to-value ratio as a percentage. */
export function ltvPct(loanAmount, homePrice) {
  if (homePrice <= 0) return 0;
  return (loanAmount / homePrice) * 100;
}

/** Clamp helper. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Round to cents. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Round to 3 decimals — used for rates (e.g. 6.375%) where cents-rounding lies. */
export function round3(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
