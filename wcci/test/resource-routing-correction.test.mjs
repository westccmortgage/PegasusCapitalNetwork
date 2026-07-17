// RESOURCE ROUTING CORRECTION — conforming threshold + stage-aware recommendations.
// Verifies the 2026 baseline conforming rule, BeforeJumboLoan materiality gating,
// CaliforniaMTG "state alone is never enough", stage gating, resolution cleanup,
// and single-placement (no inline+sidebar duplication).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeResources, placementFor, beforeJumboEligible, JUMBO_TOPICS } from '../src/lib/resources/resource-router.js';
import { classifyLoanSize, baselineConformingLimit } from '../src/config/conformingLimits.js';
import { SYSTEM_PROMPT } from '../src/systemPrompt.js';

// Prompt guidance: classify jumbo by LOAN AMOUNT, never the purchase price, and
// never before the loan amount is known (the exact bug seen with a $1.1M price
// and no down payment yet).
test('system prompt classifies jumbo by loan amount (not price) and not before the loan is known', () => {
  assert.match(SYSTEM_PROMPT, /LOAN AMOUNT, NEVER THE PURCHASE PRICE/);
  assert.match(SYSTEM_PROMPT, /until you actually know the LOAN AMOUNT/);
  assert.match(SYSTEM_PROMPT, /HIGH-BALANCE CONFORMING tier/);
  assert.ok(SYSTEM_PROMPT.includes('$832,750'));
  // Do not instruct quoting a specific county figure.
  assert.match(SYSTEM_PROMPT, /Do NOT quote a specific COUNTY high-balance dollar figure/);
});

const ids = (ctx) => routeResources(ctx).candidates.map(c => c.id);
const has = (arr, id) => arr.includes(id);

// Verified baseline.
test('2026 one-unit baseline conforming limit is $832,750', () => {
  assert.equal(baselineConformingLimit(1), 832750);
  assert.equal(classifyLoanSize({ loanAmount: 750000, units: 1 }).conformingBySize, true);
  assert.equal(classifyLoanSize({ loanAmount: 832750, units: 1 }).conformingBySize, true);
  assert.equal(classifyLoanSize({ loanAmount: 900000, units: 1 }).jumboBySize, true);
});

// 1 & 2. Below-baseline CA loans → conforming by size, no BeforeJumboLoan.
test('1) $750k one-unit CA → conforming by size, no BeforeJumboLoan', () => {
  const ctx = { state: 'CA', topics: ['jumbo'], loanAmount: 750000, units: 1, dataGathering: true };
  assert.equal(beforeJumboEligible(ctx), false);
  assert.ok(!has(ids(ctx), 'beforejumbo-home'), 'no jumbo clarification resource');
});
test('2) $800k one-unit CA → below $832,750 baseline, no BeforeJumboLoan', () => {
  const ctx = { state: 'CA', topics: ['conforming', 'jumbo'], loanAmount: 800000, units: 1, dataGathering: true };
  assert.equal(classifyLoanSize({ loanAmount: 800000 }).conformingBySize, true);
  assert.ok(!has(ids(ctx), 'beforejumbo-home'));
});

// 3. Above baseline, county unknown → BeforeJumboLoan may be eligible.
test('3) $900k one-unit, county unknown → jumbo by size, BeforeJumboLoan eligible', () => {
  const ctx = { state: 'CA', topics: ['jumbo', 'county_limit'], loanAmount: 900000, units: 1 };
  assert.equal(beforeJumboEligible(ctx), true);
  assert.ok(has(ids(ctx), 'beforejumbo-home'));
});

// 4. Resolved as conforming → stale jumbo resource removed.
test('4) classification resolved as conforming → BeforeJumboLoan suppressed', () => {
  const ctx = { state: 'CA', topics: ['jumbo', 'conforming'], loanAmount: 780000, units: 1, resolvedTopics: ['jumbo', 'conforming'] };
  assert.equal(beforeJumboEligible(ctx), false);
  assert.ok(!has(ids(ctx), 'beforejumbo-home'));
});

// 5. CA borrower still in profile-building → no CaliforniaMTG merely for state=CA.
test('5) CA borrower in profile-building → no CaliforniaMTG on state alone', () => {
  const ctx = { state: 'CA', topics: [], dataGathering: true };
  assert.ok(!has(ids(ctx), 'californiamtg-home'));
});

// 6. CA borrower explicitly asks for California resources → CaliforniaMTG allowed.
test('6) explicit request for California resources → CaliforniaMTG allowed', () => {
  const ctx = { state: 'CA', topics: [], dataGathering: true, explicitResourceRequest: true, wantsCaliforniaResources: true };
  assert.ok(has(ids(ctx), 'californiamtg-home'));
});

// 7. A resource is rendered in exactly one place (inline XOR sidebar).
test('7) placement is single-surface (no inline + sidebar duplication)', () => {
  assert.equal(placementFor('topic'), 'inline');
  assert.equal(placementFor('trust'), 'inline');
  assert.equal(placementFor('apply'), 'inline');
  assert.equal(placementFor('local_market'), 'sidebar');
  assert.equal(placementFor('education'), 'sidebar');
  // Simulated validated picks → split with no overlap.
  const recs = [{ id: 'a', reasonKey: 'topic' }, { id: 'b', reasonKey: 'local_market' }, { id: 'c', reasonKey: 'education' }];
  const inline = recs.filter(r => placementFor(r.reasonKey) === 'inline').map(r => r.id);
  const sidebar = recs.filter(r => placementFor(r.reasonKey) === 'sidebar').map(r => r.id);
  assert.deepEqual(inline, ['a']);
  assert.deepEqual(sidebar, ['b', 'c']);
  assert.equal(inline.filter(id => sidebar.includes(id)).length, 0, 'no id in both');
});

// 8. Active data-gathering, missing down payment + county → no general interruption.
test('8) still gathering (missing down/county) → no broad educational resources', () => {
  const ctx = { state: 'CA', topics: [], dataGathering: true };
  const got = ids(ctx);
  assert.ok(!has(got, 'californiamtg-home'), 'no state-brand interruption');
  assert.ok(!has(got, 'beforejumbo-home'), 'no jumbo education interruption');
});

// 9. Trust/licensing question during profile-building → trust resource allowed.
test('9) trust/licensing during profile-building → trust resource allowed despite stage gate', () => {
  const ctx = { state: 'CA', topics: [], objections: ['identity', 'licensing'], dataGathering: true, stage: 'trust_building' };
  const got = ids(ctx);
  assert.ok(got.some(id => ['wccm-about', 'nmls-consumer-access', 'californiamtg-about'].includes(id)), 'a trust/licensing resource is present');
});

// 10. User explicitly asks for a calculator → tool resource allowed during gathering.
test('10) explicit calculator request → tool resource allowed during data-gathering', () => {
  const ctx = { state: 'CA', county: 'orange', topics: ['calculator', 'first_time_buyer'], tonePreference: 'plain_english', dataGathering: true, explicitResourceRequest: true, wantsCalculator: true };
  const got = ids(ctx);
  assert.ok(got.includes('orange-home'), 'the calculator-bearing tool resource is allowed');
});

// State match alone is never sufficient (scoring guard).
test('state match alone never clears the bar', () => {
  // A CA state resource with NO topic/trust/tone/city/county signal is excluded.
  const bare = ids({ state: 'CA', topics: [] });
  assert.ok(!has(bare, 'californiamtg-home'), 'state-only match does not surface the state brand');
});

// Structure comparison keeps BeforeJumboLoan even below baseline (explicit value-add).
test('below baseline but user wants a buydown/interest-only comparison → BeforeJumboLoan allowed', () => {
  const ctx = { state: 'CA', topics: ['jumbo', 'interest_only'], loanAmount: 700000, units: 1 };
  assert.equal(beforeJumboEligible(ctx), true);
});
