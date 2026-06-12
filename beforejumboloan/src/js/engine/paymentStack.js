/**
 * paymentStack.js
 * Decomposes a monthly housing payment into its component "stack":
 * Principal & Interest, Taxes, Insurance, HOA, and Mortgage Insurance (MI).
 *
 * Pure function. Inputs are explicit; callers resolve config/market values first.
 */

import { monthlyPI, ltvPct, round2 } from '../lib/finance.js';

/**
 * @param {Object} input
 * @param {number} input.homePrice
 * @param {number} input.loanAmount
 * @param {number} input.rate              annual note rate %
 * @param {number} input.termYears
 * @param {number} input.propertyTaxRatePct effective annual % of home price
 * @param {number} input.homeInsuranceAnnual
 * @param {number} [input.hoaMonthly=0]
 * @param {number} [input.pmiAnnualRatePct=0] annual MI % of loan balance (0 disables)
 * @param {number} [input.pmiLtvThreshold=80] MI applies above this LTV
 * @returns {{
 *   pi:number, taxes:number, insurance:number, hoa:number, mi:number,
 *   total:number, ltv:number, miApplies:boolean, components:Array
 * }}
 */
export function buildPaymentStack(input) {
  const {
    homePrice,
    loanAmount,
    rate,
    termYears,
    propertyTaxRatePct,
    homeInsuranceAnnual,
    hoaMonthly = 0,
    pmiAnnualRatePct = 0,
    pmiLtvThreshold = 80,
  } = input;

  const pi = monthlyPI(loanAmount, rate, termYears);
  const taxes = (homePrice * (propertyTaxRatePct / 100)) / 12;
  const insurance = homeInsuranceAnnual / 12;
  const hoa = hoaMonthly;

  const ltv = ltvPct(loanAmount, homePrice);
  const miApplies = pmiAnnualRatePct > 0 && ltv > pmiLtvThreshold;
  const mi = miApplies ? (loanAmount * (pmiAnnualRatePct / 100)) / 12 : 0;

  const total = pi + taxes + insurance + hoa + mi;

  const components = [
    { key: 'pi', label: 'Principal & Interest', amount: round2(pi) },
    { key: 'taxes', label: 'Property Taxes', amount: round2(taxes) },
    { key: 'insurance', label: 'Home Insurance', amount: round2(insurance) },
    { key: 'hoa', label: 'HOA', amount: round2(hoa) },
    { key: 'mi', label: 'Mortgage Insurance', amount: round2(mi) },
  ].filter((c) => c.amount > 0 || c.key === 'pi');

  return {
    pi: round2(pi),
    taxes: round2(taxes),
    insurance: round2(insurance),
    hoa: round2(hoa),
    mi: round2(mi),
    total: round2(total),
    ltv: round2(ltv),
    miApplies,
    components,
  };
}

export default buildPaymentStack;
