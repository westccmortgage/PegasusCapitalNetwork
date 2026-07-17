// Mortgage strategy engine.
//
// Compares possible loan PATHS for a given Scenario Profile and returns a
// cautious, labeled assessment for each — never an approval, never a quote.
// Every path carries an ESTIMATED payment + cash-to-close (from cashToClose.js)
// so the borrower gets real numbers to compare, clearly marked as assumptions.

import { PATH_ASSUMPTION_RATE, CONFORMING_BASELINE, CONFORMING_HIGH_COST } from './assumptions.js';
import { calculateCashToClose } from './cashToClose.js';

// Cautious status labels required by the product spec.
export const STATUS = {
  STRONG: 'Strong possible path',
  POSSIBLE: 'Possible path',
  MORE_INFO: 'Needs more information',
  HIGHER_RISK: 'Higher-risk path',
  UNLIKELY: 'Likely not suitable',
};

const num = (v) => (v == null || v === '' ? undefined : Number(v));

function loanFrom(profile) {
  const price = num(profile.purchasePrice);
  let loan = num(profile.loanAmount);
  const down = num(profile.downPayment);
  if (loan == null && price != null && down != null) loan = Math.max(0, price - down);
  const ltv = price && loan != null ? loan / price : undefined;
  return { price, loan, down, ltv };
}

// Estimate payment + cash-to-close for a path's assumption rate.
function estimateFor(profile, rate) {
  const { price, loan, down } = loanFrom(profile);
  if (!price || (loan == null && down == null)) return null;
  return calculateCashToClose({ purchasePrice: price, loanAmount: loan, downPayment: down, annualRate: rate });
}

// Conforming tier signal from loan size (subject to county limit confirmation).
function conformingTier(loan) {
  if (loan == null) return 'unknown';
  if (loan <= CONFORMING_BASELINE) return 'conforming';
  if (loan <= CONFORMING_HIGH_COST) return 'high-balance';
  return 'jumbo';
}

const isSelfEmployed = (p) => ['self-employed', '1099', 'business owner', 'investor'].includes(p.employmentType);
const docKnown = (p) => p.incomeDocPath && p.incomeDocPath !== 'unsure';

// Build one path result.
function mk(id, label, status, why, opts = {}) {
  return {
    id, label, status, why,
    missingData: opts.missingData || [],
    documentation: opts.documentation || [],
    risks: opts.risks || [],
    pmiRisk: opts.pmiRisk || 'Not expected',
    pricingRisk: opts.pricingRisk || 'Standard, subject to final pricing',
    reserveNote: opts.reserveNote || 'Reserves vary by program and lender — subject to verification.',
    estimate: opts.estimate || null,
  };
}

export function evaluatePaths(profile) {
  const p = profile || {};
  const { price, loan, ltv } = loanFrom(p);
  const tier = conformingTier(loan);
  const missingCore = [];
  if (price == null) missingCore.push('purchasePrice');
  if (loan == null) missingCore.push('downPayment');
  if (!p.state) missingCore.push('state');
  if (!p.zipOrCounty) missingCore.push('zipOrCounty');
  if (!p.occupancy) missingCore.push('occupancy');

  const est = (rate) => estimateFor(p, rate);
  const highLtv = ltv != null && ltv > 0.8;
  const results = [];

  // ── Conforming QM ──
  results.push((() => {
    let status = STATUS.MORE_INFO;
    let why = 'Standard conventional financing for loan amounts within the county conforming limit.';
    if (loan != null) {
      if (tier === 'conforming') { status = STATUS.STRONG; why = 'Loan amount appears within the standard conforming limit.'; }
      else { status = STATUS.UNLIKELY; why = 'Loan amount appears above the standard conforming limit — see High-Balance / Jumbo.'; }
    }
    return mk('conformingQM', 'Conforming QM', status, why, {
      missingData: missingCore.filter(k => ['purchasePrice', 'downPayment', 'zipOrCounty'].includes(k)),
      documentation: ['Income docs (W-2s/paystubs or tax returns)', 'Asset statements', 'ID'],
      risks: highLtv ? ['Mortgage insurance likely with less than 20% down'] : [],
      pmiRisk: highLtv ? 'Likely (LTV over 80%) — subject to program' : 'Not expected at/below 80% LTV',
      reserveNote: 'Typically a few months of reserves — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.conformingQM),
    });
  })());

  // ── High-Balance QM ──
  results.push((() => {
    let status = STATUS.MORE_INFO;
    let why = 'Conventional financing for high-cost counties above the baseline limit.';
    if (loan != null) {
      if (tier === 'high-balance') { status = STATUS.STRONG; why = 'Loan amount fits the high-cost county (high-balance) range — subject to the exact county limit.'; }
      else if (tier === 'conforming') { status = STATUS.POSSIBLE; why = 'Loan amount is within the standard conforming range; high-balance may not be needed.'; }
      else { status = STATUS.UNLIKELY; why = 'Loan amount appears above the high-balance ceiling — see Jumbo.'; }
    }
    return mk('highBalanceQM', 'High-Balance QM', status, why, {
      missingData: !p.zipOrCounty ? ['zipOrCounty'] : [],
      documentation: ['Income docs', 'Asset statements', 'ID'],
      risks: ['Exact county limit must be confirmed'],
      pmiRisk: highLtv ? 'Possible with less than 20% down — subject to program' : 'Not expected at/below 80% LTV',
      reserveNote: 'Often a few months of reserves — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.highBalanceQM),
    });
  })());

  // ── Jumbo QM ──
  results.push((() => {
    let status = STATUS.MORE_INFO;
    let why = 'Full-doc financing for loan amounts above the conforming/high-balance limits.';
    if (loan != null) {
      if (tier === 'jumbo') { status = isSelfEmployed(p) && p.incomeDocPath === 'bank statements' ? STATUS.POSSIBLE : STATUS.STRONG; why = 'Loan amount appears above the conforming limits, which points to jumbo financing.'; }
      else { status = STATUS.POSSIBLE; why = 'Loan amount may fall within conforming/high-balance; jumbo may not be required.'; }
    }
    return mk('jumboQM', 'Jumbo QM', status, why, {
      missingData: missingCore.filter(k => ['zipOrCounty', 'downPayment'].includes(k)).concat(!docKnown(p) ? ['incomeDocPath'] : []),
      documentation: ['2 years tax returns', 'Asset statements', 'Reserves documentation', 'ID'],
      risks: ['Stronger reserve and credit requirements', 'Pricing more sensitive to credit/LTV'],
      pmiRisk: 'Usually structured to avoid MI — subject to program',
      pricingRisk: 'More sensitive to credit score and LTV — subject to final pricing',
      reserveNote: 'Jumbo typically requires more months of reserves — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.jumboQM),
    });
  })());

  // ── Non-QM Bank Statement ──
  results.push((() => {
    let status = STATUS.MORE_INFO;
    let why = 'For self-employed borrowers who qualify on bank-statement deposits instead of tax returns.';
    if (isSelfEmployed(p)) {
      status = (p.incomeDocPath === 'bank statements' || p.incomeDocPath === 'unsure' || !docKnown(p)) ? STATUS.STRONG : STATUS.POSSIBLE;
      why = 'Self-employed profile — bank-statement qualifying can work when tax returns understate income.';
    } else if (p.employmentType === 'W-2') {
      status = STATUS.UNLIKELY; why = 'Bank-statement programs are designed for self-employed income, not W-2.';
    }
    return mk('nonQMBankStatement', 'Non-QM Bank Statement', status, why, {
      missingData: !p.employmentType ? ['employmentType'] : (!docKnown(p) ? ['incomeDocPath'] : []),
      documentation: ['12–24 months personal or business bank statements', 'Business verification (license/CPA letter)', 'Asset statements', 'ID'],
      risks: ['Rate typically higher than full-doc', 'Deposit analysis determines qualifying income'],
      pricingRisk: 'Non-QM pricing is higher than QM — subject to final pricing',
      reserveNote: 'Reserves often required — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.nonQMBankStatement),
    });
  })());

  // ── Non-QM P&L ──
  results.push((() => {
    let status = isSelfEmployed(p) ? STATUS.POSSIBLE : STATUS.MORE_INFO;
    if (p.incomeDocPath === 'P&L') status = STATUS.STRONG;
    if (p.employmentType === 'W-2') status = STATUS.UNLIKELY;
    return mk('nonQMPnL', 'Non-QM P&L', status,
      'Qualifies self-employed borrowers using a CPA-prepared profit & loss statement.', {
      missingData: !docKnown(p) ? ['incomeDocPath'] : [],
      documentation: ['CPA/accountant-prepared P&L', 'Business verification', 'Asset statements', 'ID'],
      risks: ['Requires third-party-prepared P&L', 'Higher pricing than full-doc'],
      pricingRisk: 'Non-QM pricing — subject to final pricing',
      estimate: est(PATH_ASSUMPTION_RATE.nonQMPnL),
    });
  })());

  // ── Non-QM Asset Depletion ──
  results.push((() => {
    let status = STATUS.MORE_INFO;
    if (p.incomeDocPath === 'asset depletion' || p.employmentType === 'retired') status = STATUS.POSSIBLE;
    if (num(p.reservesAfterClosing) && num(p.reservesAfterClosing) > (loan || 0)) status = STATUS.STRONG;
    return mk('nonQMAssetDepletion', 'Non-QM Asset Depletion', status,
      'Uses large liquid assets to derive qualifying income — useful for retirees or asset-rich borrowers.', {
      missingData: p.reservesAfterClosing == null ? ['reservesAfterClosing'] : [],
      documentation: ['2–3 months statements for all qualifying assets', 'Sourcing of large deposits', 'ID'],
      risks: ['Requires substantial documented liquid assets'],
      pricingRisk: 'Non-QM pricing — subject to final pricing',
      reserveNote: 'Qualifying depends heavily on documented reserves — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.nonQMAssetDepletion),
    });
  })());

  // ── DSCR Investment ──
  results.push((() => {
    const investor = p.occupancy === 'investment' || p.loanPurpose === 'investment' || p.incomeDocPath === 'DSCR';
    let status = investor ? STATUS.STRONG : STATUS.MORE_INFO;
    if (p.occupancy === 'primary residence') status = STATUS.UNLIKELY;
    return mk('dscr', 'DSCR Investment', status,
      investor ? 'Investment property qualifying on the property\'s rental cash flow rather than personal income.'
        : 'Applies only to investment properties that qualify on rental income.', {
      missingData: !p.occupancy ? ['occupancy'] : [],
      documentation: ['Lease or market-rent estimate', 'Property expenses (taxes, insurance, HOA)', 'Asset statements', 'Entity docs if applicable', 'ID'],
      risks: ['Qualifying tied to rent vs. payment (DSCR ratio)', 'Higher pricing than owner-occupied'],
      pricingRisk: 'Investor pricing is higher — subject to final pricing',
      reserveNote: 'Investor reserves typically required — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.dscr),
    });
  })());

  // ── FHA ──
  results.push((() => {
    let status = STATUS.POSSIBLE;
    let why = 'Government-backed loan with flexible credit and low down payment for primary residences.';
    if (p.occupancy && p.occupancy !== 'primary residence') { status = STATUS.UNLIKELY; why = 'FHA is for primary residences only.'; }
    else if (tier === 'jumbo') { status = STATUS.UNLIKELY; why = 'Loan amount appears above FHA limits for the area.'; }
    else if (isSelfEmployed(p) && p.incomeDocPath === 'bank statements') { status = STATUS.MORE_INFO; why = 'FHA requires full documentation — bank-statement income does not qualify.'; }
    return mk('fha', 'FHA', status, why, {
      missingData: !p.occupancy ? ['occupancy'] : [],
      documentation: ['Full income docs (W-2s/tax returns)', 'Asset statements', 'ID'],
      risks: ['Upfront + monthly mortgage insurance applies', 'Loan limits vary by county'],
      pmiRisk: 'FHA mortgage insurance applies regardless of down payment',
      reserveNote: 'Reserves usually modest — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.fha),
    });
  })());

  // ── VA ──
  results.push((() => {
    // We never ask veteran status directly here; surface as needs-info unless hinted.
    let status = STATUS.MORE_INFO;
    const why = 'For eligible veterans, active-duty service members, and some surviving spouses — often no down payment.';
    if (p.occupancy && p.occupancy !== 'primary residence') status = STATUS.UNLIKELY;
    return mk('va', 'VA', status, why, {
      missingData: ['veteran eligibility'],
      documentation: ['Certificate of Eligibility (COE)', 'Income docs', 'ID'],
      risks: ['Requires VA eligibility', 'VA funding fee may apply'],
      pmiRisk: 'No monthly mortgage insurance',
      reserveNote: 'Reserves usually minimal for primary residence — subject to verification.',
      estimate: est(PATH_ASSUMPTION_RATE.va),
    });
  })());

  // ── Bridge / private money (placeholder) ──
  results.push(mk('bridge', 'Bridge / Private Money', STATUS.MORE_INFO,
    'Short-term financing placeholder for fast-close, equity-driven, or transitional situations.', {
    missingData: ['exit strategy', 'timeline'],
    documentation: ['Asset/equity documentation', 'Exit plan', 'ID'],
    risks: ['Short term and higher cost', 'Requires a clear exit strategy'],
    pricingRisk: 'Private-money pricing is materially higher — subject to final pricing',
    reserveNote: 'Structured case-by-case — subject to verification.',
    estimate: est(PATH_ASSUMPTION_RATE.bridge),
  }));

  // Rank: strong first, then possible, then more-info, higher-risk, unlikely.
  const order = [STATUS.STRONG, STATUS.POSSIBLE, STATUS.MORE_INFO, STATUS.HIGHER_RISK, STATUS.UNLIKELY];
  results.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return {
    tier,
    paths: results,
    topPaths: results.filter(r => r.status === STATUS.STRONG || r.status === STATUS.POSSIBLE),
    missingCore,
  };
}
