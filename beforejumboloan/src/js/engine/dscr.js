/**
 * dscr.js
 * Debt-Service Coverage Ratio math for investment-property loans.
 *
 * DSCR = Gross Monthly Rent / Monthly Debt Service (PITIA)
 *   >= 1.00  the property covers its own payment
 *   >= 1.25  strong; typically best pricing tier
 *
 * Pure functions. Tier grid is passed in (from config), not hard-coded.
 */

import { round2 } from '../lib/finance.js';

/**
 * @param {Object} input
 * @param {number} input.grossMonthlyRent
 * @param {number} input.monthlyDebtService  full PITIA (use payment stack total)
 * @param {Array}  input.tiers               [{minRatio,label,rateAddPct}], desc by minRatio
 * @param {number} [input.minQualifyingRatio=1.0]
 * @returns {{
 *   ratio:number, qualifies:boolean, minQualifyingRatio:number,
 *   tier:(Object|null), monthlyCashflow:number,
 *   rentNeededToQualify:number, rentNeededForTarget:number
 * }}
 */
export function computeDSCR(input) {
  const {
    grossMonthlyRent,
    monthlyDebtService,
    tiers = [],
    minQualifyingRatio = 1.0,
    targetRatio = 1.25,
  } = input;

  const ratio = monthlyDebtService > 0 ? grossMonthlyRent / monthlyDebtService : 0;
  const qualifies = ratio >= minQualifyingRatio;

  // Highest tier whose threshold the ratio clears.
  const tier =
    [...tiers].sort((a, b) => b.minRatio - a.minRatio).find((t) => ratio >= t.minRatio) || null;

  const monthlyCashflow = grossMonthlyRent - monthlyDebtService;
  const rentNeededToQualify = monthlyDebtService * minQualifyingRatio;
  const rentNeededForTarget = monthlyDebtService * targetRatio;

  return {
    ratio: round2(ratio),
    qualifies,
    minQualifyingRatio,
    targetRatio,
    tier,
    monthlyCashflow: round2(monthlyCashflow),
    rentNeededToQualify: round2(rentNeededToQualify),
    rentNeededForTarget: round2(rentNeededForTarget),
  };
}

export default computeDSCR;
