/**
 * buydown.js
 * Rate buydown economics — permanent (discount points) and temporary (2-1 / 3-2-1).
 *
 * Pure functions. Pricing assumptions (cost per point, reduction per point) are
 * passed in from config, never hard-coded here.
 */

import { monthlyPI, round2, round3 } from '../lib/finance.js';

/**
 * Permanent buydown via discount points.
 * @param {Object} input
 * @param {number} input.loanAmount
 * @param {number} input.baseRate              note rate before buydown %
 * @param {number} input.termYears
 * @param {number} input.points                number of points purchased
 * @param {number} input.pointCostPctOfLoan    cost of one point (% of loan)
 * @param {number} input.rateReductionPerPoint % rate drop per point
 * @returns {Object}
 */
export function permanentBuydown(input) {
  const {
    loanAmount,
    baseRate,
    termYears,
    points,
    pointCostPctOfLoan,
    rateReductionPerPoint,
  } = input;

  const boughtDownRate = Math.max(0, baseRate - points * rateReductionPerPoint);
  const cost = loanAmount * (pointCostPctOfLoan / 100) * points;

  const basePI = monthlyPI(loanAmount, baseRate, termYears);
  const newPI = monthlyPI(loanAmount, boughtDownRate, termYears);
  const monthlySavings = basePI - newPI;

  const breakevenMonths = monthlySavings > 0 ? cost / monthlySavings : Infinity;
  const lifetimeSavings = monthlySavings * termYears * 12 - cost;

  return {
    type: 'permanent',
    points,
    baseRate: round3(baseRate),
    boughtDownRate: round3(boughtDownRate),
    cost: round2(cost),
    basePI: round2(basePI),
    newPI: round2(newPI),
    monthlySavings: round2(monthlySavings),
    breakevenMonths: Number.isFinite(breakevenMonths) ? Math.ceil(breakevenMonths) : null,
    lifetimeSavings: round2(lifetimeSavings),
  };
}

/**
 * Temporary buydown (escrow-funded). Each step lowers the rate by N% for one year.
 * e.g. 2-1 => year1 rate-2%, year2 rate-1%, then note rate.
 * Returns per-year schedule and the total subsidy cost (sum of payment deltas).
 * @param {Object} input
 * @param {number} input.loanAmount
 * @param {number} input.noteRate              fully-indexed note rate %
 * @param {number} input.termYears
 * @param {number[]} input.steps               e.g. [2,1] for a 2-1
 * @returns {Object}
 */
export function temporaryBuydown(input) {
  const { loanAmount, noteRate, termYears, steps } = input;
  const notePI = monthlyPI(loanAmount, noteRate, termYears);

  let totalSubsidy = 0;
  const schedule = steps.map((reduction, i) => {
    const yearRate = Math.max(0, noteRate - reduction);
    const yearPI = monthlyPI(loanAmount, yearRate, termYears);
    const monthlySavings = notePI - yearPI;
    const yearSubsidy = monthlySavings * 12;
    totalSubsidy += yearSubsidy;
    return {
      year: i + 1,
      rate: round3(yearRate),
      monthlyPI: round2(yearPI),
      monthlySavings: round2(monthlySavings),
      yearSubsidy: round2(yearSubsidy),
    };
  });

  return {
    type: 'temporary',
    noteRate: round3(noteRate),
    notePI: round2(notePI),
    schedule,
    totalSubsidy: round2(totalSubsidy),
    firstYearPayment: schedule.length ? schedule[0].monthlyPI : round2(notePI),
  };
}

export default { permanentBuydown, temporaryBuydown };
