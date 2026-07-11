// Cash-to-close engine.
//
// One module inside the larger strategy advisor. Every fee SCALES with the
// purchase price / loan amount — nothing stays fixed when the numbers change
// (the core bug this replaces). All outputs are ESTIMATES for planning only.

import {
  TAX_ANNUAL_RATE, INS_ANNUAL_RATE,
  POINTS_PCT, ORIGINATOR_COMP_PCT, APPLICATION_FEE,
  PREPAID_INTEREST_DAYS, INTEREST_DAY_BASIS,
  THIRD_PARTY_FIXED, TITLE_ESCROW_FIXED, TITLE_ESCROW_RATE,
  GOV_FIXED, GOV_RATE,
  RESERVE_MONTHS_TAX, RESERVE_MONTHS_INS,
  LOAN_TERM_MONTHS,
} from './assumptions.js';

// Standard fixed-rate monthly principal & interest.
export function monthlyPI(loanAmount, annualRate, termMonths = LOAN_TERM_MONTHS) {
  if (!loanAmount || loanAmount <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return loanAmount / termMonths;
  const f = Math.pow(1 + r, termMonths);
  return (loanAmount * r * f) / (f - 1);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Compute the full cash-to-close breakdown.
// opts:
//   purchasePrice (required)
//   downPayment  OR  loanAmount (one required)
//   annualRate (assumption; required for payment + prepaid interest)
//   prepaidInterestDays, sellerCredits, lenderCredits, pointsPercent,
//   originatorCompPercent, applicationFee  (all optional overrides)
export function calculateCashToClose(opts = {}) {
  const purchasePrice = Number(opts.purchasePrice) || 0;
  let downPayment = opts.downPayment != null ? Number(opts.downPayment) : undefined;
  let loanAmount = opts.loanAmount != null ? Number(opts.loanAmount) : undefined;

  if (loanAmount == null && downPayment != null) loanAmount = Math.max(0, purchasePrice - downPayment);
  if (downPayment == null && loanAmount != null) downPayment = Math.max(0, purchasePrice - loanAmount);
  loanAmount = loanAmount || 0;
  downPayment = downPayment || 0;

  const ltv = purchasePrice ? loanAmount / purchasePrice : 0;
  const annualRate = opts.annualRate != null ? Number(opts.annualRate) : 0.07;

  const pointsPercent = opts.pointsPercent != null ? Number(opts.pointsPercent) : POINTS_PCT;
  const originatorCompPercent = opts.originatorCompPercent != null ? Number(opts.originatorCompPercent) : ORIGINATOR_COMP_PCT;
  const applicationFee = opts.applicationFee != null ? Number(opts.applicationFee) : APPLICATION_FEE;
  const prepaidInterestDays = opts.prepaidInterestDays != null ? Number(opts.prepaidInterestDays) : PREPAID_INTEREST_DAYS;
  const sellerCredits = Number(opts.sellerCredits) || 0;
  const lenderCredits = Number(opts.lenderCredits) || 0;

  // ── Monthly housing components (scale from price) ──
  const monthlyTax = purchasePrice * TAX_ANNUAL_RATE / 12;
  const monthlyInsurance = purchasePrice * INS_ANNUAL_RATE / 12;
  const monthlyPrincipalInterest = monthlyPI(loanAmount, annualRate);

  // ── Lender-side assumptions (scale from loan amount) ──
  // FINANCIAL-ESTIMATE POLICY: no lender has quoted this scenario, so these are
  // PLANNING ASSUMPTIONS, never "the lender fee". Discount points are a
  // SEPARATE line — they must never be silently folded into lender fees.
  const pointsAmount = loanAmount * pointsPercent;                 // discount-points assumption
  const originatorComp = loanAmount * originatorCompPercent;
  const totalLenderFees = originatorComp + applicationFee;         // EXCLUDES points by design

  // ── Third-party / title / escrow / government (scale from price) ──
  const thirdPartyFees = THIRD_PARTY_FIXED;                       // appraisal, credit, flood
  const titleEscrowFees = TITLE_ESCROW_FIXED + purchasePrice * TITLE_ESCROW_RATE;
  const governmentFees = GOV_FIXED + purchasePrice * GOV_RATE;

  // ── Prepaid interest (360-day basis) ──
  const dailyInterest = loanAmount * annualRate / INTEREST_DAY_BASIS;
  const prepaidInterest = dailyInterest * prepaidInterestDays;

  // ── Escrow reserves collected at closing ──
  const escrowReserves = RESERVE_MONTHS_TAX * monthlyTax + RESERVE_MONTHS_INS * monthlyInsurance;

  // ── Totals (points included in the total, but always as their own line) ──
  const closingCosts = pointsAmount + totalLenderFees + thirdPartyFees + titleEscrowFees +
    governmentFees + prepaidInterest + escrowReserves;
  const credits = sellerCredits + lenderCredits;
  const estimatedCashToClose = downPayment + closingCosts - credits;
  const extraFundsAboveDownPayment = estimatedCashToClose - downPayment;
  const monthlyPayment = monthlyPrincipalInterest + monthlyTax + monthlyInsurance;

  return {
    purchasePrice, downPayment, loanAmount,
    ltv: round2(ltv * 100),
    annualRateAssumption: annualRate,
    // monthly
    monthlyPrincipalInterest: round2(monthlyPrincipalInterest),
    monthlyTax: round2(monthlyTax),
    monthlyInsurance: round2(monthlyInsurance),
    monthlyPayment: round2(monthlyPayment),
    // lender-side ASSUMPTIONS (no quote exists) — points always separate
    pointsAmount: round2(pointsAmount),                 // discount-points assumption
    discountPoints: round2(pointsAmount),               // explicit alias
    originatorComp: round2(originatorComp),
    applicationFee: round2(applicationFee),
    totalLenderFees: round2(totalLenderFees),           // origination-side only, NO points
    onePointExample: round2(loanAmount * 0.01),         // "1 point = 1% of loan" example
    lenderQuoteKnown: false,                            // no lender has quoted this scenario
    assumptions: [
      `Interest rate ${(annualRate * 100).toFixed(3)}% is a planning assumption — not a quote or lock`,
      `Discount points assumed at ${(pointsPercent * 100).toFixed(3)}% of the loan (points are optional and not selected yet)`,
      `Originator compensation assumed at ${(originatorCompPercent * 100).toFixed(2)}% of the loan`,
      `Application fee assumed at $${applicationFee.toLocaleString('en-US')}`,
      `Property tax estimated from the purchase price (annualized local-average rate)`,
      `Homeowners insurance estimated from the purchase price`,
      `Prepaid interest: ${prepaidInterestDays} days on a 360-day basis`,
      `Escrow reserves: ${RESERVE_MONTHS_TAX} months taxes + ${RESERVE_MONTHS_INS} months insurance`,
      'Actual lender charges and discount points are not known until a lender and rate/point combination is selected',
    ],
    // other closing costs
    thirdPartyFees: round2(thirdPartyFees),
    titleEscrowFees: round2(titleEscrowFees),
    governmentFees: round2(governmentFees),
    prepaidInterest: round2(prepaidInterest),
    escrowReserves: round2(escrowReserves),
    // credits + totals
    sellerCredits: round2(sellerCredits),
    lenderCredits: round2(lenderCredits),
    closingCosts: round2(closingCosts),
    estimatedCashToClose: round2(estimatedCashToClose),
    extraFundsAboveDownPayment: round2(extraFundsAboveDownPayment),
  };
}
