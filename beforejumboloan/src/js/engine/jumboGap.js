/**
 * jumboGap.js
 * The signature calculation of the product: how far is this loan from crossing
 * into jumbo territory, and what does it take to stay "before jumbo"?
 *
 * Tiers (per local market):
 *   conforming     loan <= conformingLimit
 *   high-balance   conformingLimit < loan <= highBalanceLimit
 *   jumbo          loan > highBalanceLimit
 */

import { round2 } from '../lib/finance.js';

/**
 * @param {Object} input
 * @param {number} input.homePrice
 * @param {number} input.loanAmount
 * @param {number} input.conformingLimit
 * @param {number} [input.highBalanceLimit] defaults to conformingLimit
 * @returns {{
 *   tier:'conforming'|'high-balance'|'jumbo',
 *   tierLabel:string,
 *   loanAmount:number,
 *   conformingLimit:number,
 *   highBalanceLimit:number,
 *   // gap to the next-best line you want to stay under:
 *   gapToConforming:number,    // >0 means loan exceeds conforming by this much
 *   gapToHighBalance:number,   // >0 means loan exceeds high-balance (true jumbo)
 *   headroom:number,           // <=0 jumbo; otherwise $ of room before crossing
 *   additionalDownToStayConforming:number, // extra down payment to reach conforming line
 *   additionalDownToAvoidJumbo:number,     // extra down to reach high-balance line
 *   isJumbo:boolean
 * }}
 */
export function computeJumboGap(input) {
  const { homePrice, loanAmount, conformingLimit } = input;
  const highBalanceLimit = input.highBalanceLimit ?? conformingLimit;

  const gapToConforming = loanAmount - conformingLimit;
  const gapToHighBalance = loanAmount - highBalanceLimit;

  let tier = 'conforming';
  let tierLabel = 'Conforming';
  if (loanAmount > highBalanceLimit) {
    tier = 'jumbo';
    tierLabel = 'Jumbo';
  } else if (loanAmount > conformingLimit) {
    tier = 'high-balance';
    tierLabel = 'High-Balance Conforming';
  }

  const isJumbo = tier === 'jumbo';

  // Reducing the loan = increasing the down payment (home price fixed).
  const additionalDownToStayConforming = Math.max(0, gapToConforming);
  const additionalDownToAvoidJumbo = Math.max(0, gapToHighBalance);

  // Headroom = how much the loan can grow before crossing the high-balance line.
  const headroom = highBalanceLimit - loanAmount;

  return {
    tier,
    tierLabel,
    loanAmount: round2(loanAmount),
    homePrice: round2(homePrice),
    conformingLimit,
    highBalanceLimit,
    gapToConforming: round2(gapToConforming),
    gapToHighBalance: round2(gapToHighBalance),
    headroom: round2(headroom),
    additionalDownToStayConforming: round2(additionalDownToStayConforming),
    additionalDownToAvoidJumbo: round2(additionalDownToAvoidJumbo),
    isJumbo,
  };
}

export default computeJumboGap;
