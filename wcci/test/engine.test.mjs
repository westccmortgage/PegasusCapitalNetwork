// Unit tests for the AI Mortgage Strategy Review engines.
// Run with:  node --test   (Node 18+, no extra deps)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseScenario } from '../src/lib/parser.js';
import { mergeProfile, profileStatus, NEEDED_KEYS } from '../src/lib/scenarioProfile.js';
import { nextQuestions } from '../src/lib/questionEngine.js';
import { calculateCashToClose } from '../src/lib/cashToClose.js';
import { evaluatePaths, STATUS } from '../src/lib/strategyEngine.js';
import { buildLead, submitLead } from '../src/lib/leadAdapter.js';

const SPEC_INPUT = "I want to buy a $2M home in California. I'm self-employed and have $400k down.";

// ── Parser ──
test('parser: extracts price, down, state, employment from the spec input', () => {
  const r = parseScenario(SPEC_INPUT);
  assert.equal(r.purchasePrice, 2000000);
  assert.equal(r.downPayment, 400000);
  assert.equal(r.state, 'CA');
  assert.equal(r.employmentType, 'self-employed');
  assert.equal(r.loanAmount, 1600000);
  assert.equal(r.ltv, 80);
});

test('parser: handles percent-down and abbreviations', () => {
  const r = parseScenario('Refinance my $1.5m condo in TX, cash-out, 20% down, 740 fico');
  assert.equal(r.purchasePrice, 1500000);
  assert.equal(r.state, 'TX');
  assert.equal(r.loanPurpose, 'cash-out');
  assert.equal(r.downPayment, 300000);
  assert.equal(r.estimatedFICO, 740);
});

test('parser: lowercase "City, ST" fills state and location', () => {
  const r = parseScenario('santa clarita, ca');
  assert.equal(r.state, 'CA');
  assert.equal(r.zipOrCounty, 'Santa Clarita');
});

test('parser: does not misread "score 720, partial" as a state', () => {
  const r = parseScenario('purchase 1400000 with 20% down score 720, partial income w2 and partial 1099');
  assert.equal(r.state, undefined);
  assert.equal(r.purchasePrice, 1400000);
  assert.equal(r.downPayment, 280000);
  assert.equal(r.employmentType, '1099');
});

test('parser: county and ZIP forms', () => {
  assert.equal(parseScenario('los angeles county').zipOrCounty, 'Los Angeles County');
  assert.equal(parseScenario('property in 90210').zipOrCounty, '90210');
});

test('parser: a surname is not a state ("Tony Montana")', () => {
  assert.equal(parseScenario('Tony Montana').state, undefined);
  assert.equal(parseScenario('my last name is montana not the state').state, undefined);
  // but a real location cue still works
  assert.equal(parseScenario('a home in Montana').state, 'MT');
});

test('parser: money shorthand "mil" and a bare ZIP is not a price', () => {
  assert.equal(parseScenario('i want to buy a 1.4 mil home').purchasePrice, 1400000);
  const z = parseScenario('90210');
  assert.equal(z.zipOrCounty, '90210');
  assert.equal(z.purchasePrice, undefined);
});

test('parser: bank statement + investment DSCR signals', () => {
  const r = parseScenario('Buying a $800k investment property, bank statement borrower, DSCR');
  assert.equal(r.purchasePrice, 800000);
  assert.equal(r.occupancy, 'investment');
  // bank statement is matched before DSCR by design
  assert.equal(r.incomeDocPath, 'bank statements');
});

// ── Scenario Profile ──
test('profile: auto-fills known fields and marks missing ones', () => {
  const profile = mergeProfile({}, parseScenario(SPEC_INPUT));
  const st = profileStatus(profile);
  assert.equal(profile.purchasePrice, 2000000);
  assert.equal(profile.loanAmount, 1600000);
  assert.ok(st.needed.missing.includes('zipOrCounty'));
  assert.ok(st.needed.missing.includes('occupancy'));
  assert.ok(st.needed.missing.includes('incomeDocPath'));
  assert.ok(st.percent > 0 && st.percent < 100);
  assert.equal(st.hasCoreScenario, true);
});

test('profile: AI-style update normalizes strings and fill-only preserves parsed values', () => {
  // Parser authoritatively set the state to CA.
  let profile = mergeProfile({}, { state: 'CA', purchasePrice: 1400000 });
  // AI update arrives with a messy string value and a conflicting state — fill-only
  // must NOT overwrite the known state, but SHOULD fill the empty occupancy.
  profile = mergeProfile(profile, { purchasePrice: '$1,400,000', state: 'TX', occupancy: 'primary residence' }, { fillOnly: true });
  assert.equal(profile.state, 'CA');                 // preserved
  assert.equal(profile.occupancy, 'primary residence'); // filled
  assert.equal(profile.purchasePrice, 1400000);      // normalized number, unchanged
});

test('profile: merge recomputes LTV when down payment changes', () => {
  let profile = mergeProfile({}, { purchasePrice: 2000000, downPayment: 400000 });
  assert.equal(profile.ltv, 80);
  profile = mergeProfile(profile, { downPayment: 500000 });
  assert.equal(profile.loanAmount, 1500000);
  assert.equal(profile.ltv, 75);
});

// ── Question engine ──
test('question engine: asks only the next 1-3 important questions', () => {
  const profile = mergeProfile({}, parseScenario(SPEC_INPUT));
  const qs = nextQuestions(profile, 3);
  assert.equal(qs.length, 3);
  assert.deepEqual(qs.map(q => q.id), ['zipOrCounty', 'occupancy', 'incomeDocPath']);
});

test('question engine: asks core scenario questions when nothing is known', () => {
  const qs = nextQuestions({}, 3);
  assert.deepEqual(qs.map(q => q.id), ['purchasePrice', 'state', 'downPayment']);
});

// ── Cash-to-close calculation ──
test('calc: $2M / $400k down produces scaled figures', () => {
  const r = calculateCashToClose({ purchasePrice: 2000000, downPayment: 400000, annualRate: 0.068 });
  assert.equal(r.loanAmount, 1600000);
  assert.equal(r.ltv, 80);
  // lender fees scale with loan
  assert.equal(r.pointsAmount, +(1600000 * 0.005152).toFixed(2));
  assert.equal(r.originatorComp, 16000);
  assert.equal(r.applicationFee, 1595);
  // monthly tax/ins scale with price
  assert.ok(Math.abs(r.monthlyTax - 2127.21) < 0.5);
  assert.ok(Math.abs(r.monthlyInsurance - 428.88) < 0.5);
  // cash to close is above the down payment
  assert.ok(r.estimatedCashToClose > 400000);
  assert.ok(r.extraFundsAboveDownPayment > 0);
});

test('calc: fees are dynamic — $4M/$800k roughly doubles $2M/$400k', () => {
  const a = calculateCashToClose({ purchasePrice: 2000000, downPayment: 400000, annualRate: 0.068 });
  const b = calculateCashToClose({ purchasePrice: 4000000, downPayment: 800000, annualRate: 0.068 });
  assert.notEqual(a.totalLenderFees, b.totalLenderFees);
  assert.notEqual(a.titleEscrowFees, b.titleEscrowFees);
  assert.notEqual(a.governmentFees, b.governmentFees);
  // points scale linearly with loan amount
  assert.ok(Math.abs(b.pointsAmount - 2 * a.pointsAmount) < 1);
  // tax scales linearly with price
  assert.ok(Math.abs(b.monthlyTax - 2 * a.monthlyTax) < 0.5);
});

test('calc: prepaid interest uses 360-day basis', () => {
  const rate = 0.07, loan = 1000000, days = 15;
  const r = calculateCashToClose({ purchasePrice: 1250000, loanAmount: loan, annualRate: rate, prepaidInterestDays: days });
  const expected = +(loan * rate / 360 * days).toFixed(2);
  assert.equal(r.prepaidInterest, expected);
});

// ── Strategy engine ──
test('strategy: $2M jumbo self-employed surfaces jumbo + bank-statement as strong', () => {
  const profile = mergeProfile({}, parseScenario(SPEC_INPUT));
  profile.zipOrCounty = 'San Mateo County';
  profile.occupancy = 'primary residence';
  const r = evaluatePaths(profile);
  assert.equal(r.tier, 'jumbo');
  const strong = r.paths.filter(p => p.status === STATUS.STRONG).map(p => p.id);
  assert.ok(strong.includes('jumboQM'));
  assert.ok(strong.includes('nonQMBankStatement'));
  // every path carries an estimate
  assert.ok(r.paths.every(p => p.estimate && p.estimate.monthlyPayment > 0));
});

test('strategy: DSCR is strong for investment, unsuitable for primary', () => {
  const inv = evaluatePaths({ purchasePrice: 800000, downPayment: 200000, occupancy: 'investment', loanPurpose: 'investment' });
  assert.equal(inv.paths.find(p => p.id === 'dscr').status, STATUS.STRONG);
  const prim = evaluatePaths({ purchasePrice: 800000, downPayment: 200000, occupancy: 'primary residence' });
  assert.equal(prim.paths.find(p => p.id === 'dscr').status, STATUS.UNLIKELY);
});

// ── Lead adapter ──
test('lead: builds a structured object and submits via placeholder', async () => {
  const profile = mergeProfile({}, parseScenario(SPEC_INPUT));
  const strat = evaluatePaths({ ...profile, zipOrCounty: 'San Mateo County', occupancy: 'primary residence' });
  const lead = buildLead({
    originalMessage: SPEC_INPUT,
    parsedScenario: parseScenario(SPEC_INPUT),
    profile,
    missingFields: profileStatus(profile).needed.missing,
    loanPaths: strat.paths,
    cashToClose: strat.paths[0].estimate,
    strategySummary: 'Jumbo and bank-statement paths look strongest.',
    timestamp: '2026-07-10T00:00:00.000Z',
  });
  assert.equal(lead.originalMessage, SPEC_INPUT);
  assert.equal(lead.scenarioProfile.purchasePrice, 2000000);
  assert.ok(Array.isArray(lead.loanPathMatches) && lead.loanPathMatches.length > 0);
  assert.equal(lead.timestamp, '2026-07-10T00:00:00.000Z');

  // No network in tests → email adapter fails → placeholder success.
  const res = await submitLead(lead, { messages: [] });
  assert.equal(res.ok, true);
});

// ── Contact/lead-capture timing guard ──
test('lead timing: contact fields are optional-tier, never needed', () => {
  assert.ok(!NEEDED_KEYS.includes('name'));
  assert.ok(!NEEDED_KEYS.includes('phone'));
  assert.ok(!NEEDED_KEYS.includes('email'));
});
