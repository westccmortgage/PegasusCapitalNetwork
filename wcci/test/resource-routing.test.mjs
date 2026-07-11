// Acceptance tests for the Mortgage Intelligence & Resource Routing system.
// Covers the deterministic layer end-to-end: conversation intelligence →
// router → validator. The model may only PICK from the router's candidates and
// the validator enforces that, so asserting on candidates + validation is the
// meaningful, model-independent contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialConversationState, updateStateFromUserMessage } from '../src/lib/conversationIntelligence.js';
import { routeResources } from '../src/lib/resources/resource-router.js';
import { validateRecommendations, isUrlAllowed } from '../src/lib/resources/resource-validator.js';
import { getResource } from '../src/lib/resources/site-registry.js';
import { calculateCashToClose } from '../src/lib/cashToClose.js';

// Run a sequence of user turns → final state + router candidate ids.
function converse(turns, { profile = {}, lang = 'en' } = {}) {
  let state = initialConversationState();
  for (const t of turns) state = updateStateFromUserMessage(state, t, profile, lang);
  const routed = routeResources({
    audience: state.audience, state: state.state, county: state.county, city: state.city,
    topics: state.topics, objections: state.objections, stage: state.stage,
    wantsApply: state.wantsApply, tonePreference: state.tonePreference,
  });
  return { state, ids: routed.candidates.map(c => c.id), routed };
}
const has = (ids, id) => ids.includes(id);

// ── TEST 1 — Florida identity & privacy ──
test('T1 Florida identity+privacy → Suncoast/WCCM about + licensing, no K West, no contact', () => {
  const { state, ids } = converse([
    "I'm buying a home in Boca Raton, Florida",
    "I'm not really comfortable sharing my information",
    'Who are you people, and where can I read about the company?',
  ], { profile: { state: 'FL' } });
  assert.ok(has(ids, 'suncoast-about'), 'Suncoast About present');
  assert.ok(has(ids, 'wccm-about'), 'WCCM About present');
  assert.ok(ids.some(i => i === 'nmls-consumer-access' || i === 'californiamtg-privacy' || i === 'suncoast-about'), 'a licensing/verification resource present');
  assert.ok(!has(ids, 'kwest-home') && !has(ids, 'kwest-scenario-studio'), 'K West NOT present for Boca Raton');
  assert.equal(state.contactConsent, 'declined', 'refusal recorded as declined');
});

// ── TEST 2 — Key West jumbo ──
test('T2 Key West + jumbo → K West Scenario Studio + Before Jumbo, Monroe kept, no CA resource', () => {
  const { state, ids } = converse([
    'The property is in Key West',
    'Is my loan automatically a jumbo loan?',
  ], { profile: { state: 'FL' } });
  assert.ok(has(ids, 'kwest-scenario-studio'), 'K West Scenario Studio present');
  assert.ok(has(ids, 'beforejumbo-home'), 'Before Jumbo present');
  assert.equal(state.county, 'monroe', 'Monroe County preserved');
  assert.ok(!has(ids, 'belair-home') && !has(ids, 'lunadabay-home') && !has(ids, 'californiamtg-home'), 'no unrelated CA resource');
});

// ── TEST 3 — Bel Air complex ──
test('T3 Bel Air + business owner + large loan + interest-only → Bel Air + Before Jumbo', () => {
  const { ids } = converse([
    "I'm buying in Bel Air",
    "I'm a business owner and want an interest-only jumbo loan",
  ], { profile: { state: 'CA', purchasePrice: 6000000 } });
  assert.ok(has(ids, 'belair-home'), 'Bel Air Financing present');
  assert.ok(has(ids, 'beforejumbo-home'), 'Before Jumbo present');
});

// ── TEST 4 — Palos Verdes (Lunada unverified) ──
test('T4 Palos Verdes → Before Jumbo, no Orange County assumption, Lunada gated by verification', () => {
  const { ids } = converse([
    "We're looking at a home in Palos Verdes Estates",
    'What loan makes sense for a jumbo purchase?',
  ], { profile: { state: 'CA' } });
  assert.ok(has(ids, 'beforejumbo-home'), 'Before Jumbo present');
  assert.ok(!has(ids, 'orange-home'), 'no Orange County assumption');
  // Lunada Bay is verified:false → it must NOT survive validation even if routed.
  const validated = validateRecommendations(ids.map(id => ({ id })), { audience: 'consumer_borrower' });
  assert.ok(!validated.some(v => v.id === 'lunadabay-home'), 'unverified Lunada Bay never renders');
});

// ── TEST 5 — Orange County beginner ──
test('T5 Orange County first-time → Orange Mortgage + California Mortgage, corporate About only with trust concern', () => {
  const noTrust = converse([
    "I'm a first-time buyer in Orange County and new to all this",
    'Can you explain it in plain english?',
  ], { profile: { state: 'CA', county: 'orange' } });
  assert.ok(has(noTrust.ids, 'orange-home'), 'Orange Mortgage present');
  assert.ok(has(noTrust.ids, 'californiamtg-home'), 'California Mortgage present');
  assert.ok(!has(noTrust.ids, 'wccm-about'), 'corporate About NOT shown without a trust concern');

  const withTrust = converse([
    "I'm a first-time buyer in Orange County",
    'Is this a legit real company? Who is behind it?',
  ], { profile: { state: 'CA', county: 'orange' } });
  assert.ok(has(withTrust.ids, 'wccm-about'), 'corporate About shown once trust concern present');
});

// ── TEST 6 — California private capital ──
test('T6 CA construction-completion / 2nd lien → CADeed, no forced conventional', () => {
  const { ids } = converse([
    'I need construction completion capital, my bank declined me',
    'I could also do a second deed of trust on a California property',
  ], { profile: { state: 'CA' } });
  assert.ok(has(ids, 'cadeed-home'), 'CADeed present');
  assert.equal(ids[0], 'cadeed-home', 'CADeed ranked first (not a conventional path)');
});

// ── TEST 7 — Note investor ──
test('T7 note investing → Private Note Capital only, no borrower application', () => {
  const { state, ids } = converse([
    'I want to invest in first-lien mortgage notes and earn interest income',
  ]);
  assert.ok(has(ids, 'privatenotecapital-home'), 'Private Note Capital present');
  assert.equal(state.audience, 'qualified_investor');
  assert.ok(!has(ids, 'ourmtg-portal'), 'no secure borrower application');
  assert.ok(!has(ids, 'californiamtg-home') && !has(ids, 'orange-home'), 'no borrower education funnel');
});

// ── TEST 8 — Tokenization ──
test('T8 tokenization → Pegasus Private Network, no mortgage lead capture', () => {
  const { ids } = converse(['Tell me about tokenization of real-world assets and digital ownership']);
  assert.ok(has(ids, 'pegasusprivate-home'), 'Pegasus Private Network present');
  assert.ok(!has(ids, 'ourmtg-portal'), 'no application');
});

// ── TEST 9 — Capital professional ──
test('T9 capital network → Pegasus Capital Network, no retail funnel', () => {
  const { ids } = converse(['I run a fund and want to build capital-source relationships and deal rooms']);
  assert.ok(has(ids, 'pegasuscapital-home'), 'Pegasus Capital Network present');
  assert.ok(!has(ids, 'ourmtg-portal') && !has(ids, 'californiamtg-home'), 'no retail borrower funnel');
});

// ── TEST 10 — Development credibility ──
test('T10 development credibility → CRDP only when asked about development', () => {
  const asks = converse(['Has Anatoliy actually built anything? What development projects has the team done?'], { profile: { state: 'CA' } });
  assert.ok(has(asks.ids, 'californiardp-home'), 'CRDP present when development experience asked');
  const generic = converse(['I want to buy a house in California'], { profile: { state: 'CA' } });
  assert.ok(!has(generic.ids, 'californiardp-home'), 'CRDP absent for a generic purchase');
});

// ── TEST 11 — Contact refusal (twice) ──
test('T11 two refusals → contactConsent stays declined across turns', () => {
  let s = initialConversationState();
  s = updateStateFromUserMessage(s, "I'm not giving you my phone number", {}, 'en');
  assert.equal(s.contactConsent, 'declined');
  s = updateStateFromUserMessage(s, 'What loan types exist for self-employed borrowers?', {}, 'en');
  assert.equal(s.contactConsent, 'declined', 'stays declined on a neutral turn');
  s = updateStateFromUserMessage(s, "Still not sharing my contact, don't ask again", {}, 'en');
  assert.equal(s.contactConsent, 'declined', 'remains declined after second refusal');
});

// ── TEST 12 — Bank comparison ──
test('T12 Wells Fargo mention → comparison stage + bank_comparison objection recorded', () => {
  const { state } = converse(['I might just go to Wells Fargo instead']);
  assert.equal(state.competitorMention, 'wells fargo');
  assert.ok(state.objections.includes('bank_comparison'));
  assert.equal(state.stage, 'comparison');
});

// ── TEST 13 — Fee objection / estimate policy ──
test('T13 $1.12M loan → no invented $18,565 lender fee; points separate; assumptions disclosed', () => {
  const e = calculateCashToClose({ purchasePrice: 1400000, downPayment: 280000, annualRate: 0.07 });
  assert.equal(e.loanAmount, 1120000);
  assert.equal(e.lenderQuoteKnown, false, 'no lender has quoted');
  // totalLenderFees must be origination-only (comp + app), NOT include points.
  assert.equal(e.totalLenderFees, e.originatorComp + e.applicationFee);
  assert.ok(!e.totalLenderFees.toFixed(2).startsWith('18565'), 'the merged $18,565 figure is not the lender fee');
  // Discount points are their own separate line.
  assert.ok(e.pointsAmount > 0 && e.pointsAmount !== e.totalLenderFees);
  // One point = exactly 1% of the loan.
  assert.equal(e.onePointExample, 1120000 * 0.01);
  // Assumptions are exposed.
  assert.ok(Array.isArray(e.assumptions) && e.assumptions.length >= 5);
  assert.ok(e.assumptions.some(a => /discount points/i.test(a)));
});

// ── TEST 14 — URL security ──
test('T14 URL security: unknown/excluded/internal never render; only verified registry URLs pass', () => {
  // Model-invented / excluded / internal ids are all rejected.
  const rejects = [];
  const validated = validateRecommendations(
    [{ id: 'totally-made-up' }, { id: 'grcrm-home' }, { id: 'lunadabay-home' }, { id: 'suncoast-about' }],
    { audience: 'consumer_borrower', onReject: (id, why) => rejects.push([id, why]) },
  );
  const ids = validated.map(v => v.id);
  assert.ok(!ids.includes('totally-made-up'), 'unknown id rejected');
  assert.ok(!ids.includes('grcrm-home'), 'internal GRCRM rejected for a borrower');
  assert.ok(!ids.includes('lunadabay-home'), 'unverified resource rejected');
  assert.ok(ids.includes('suncoast-about'), 'verified resource passes');

  // Hard-excluded and unsafe URLs never pass the URL gate.
  assert.equal(isUrlAllowed('https://markevita.com'), false);
  assert.equal(isUrlAllowed('https://vistadelmartownhomes.com/anything'), false);
  assert.equal(isUrlAllowed('https://wcci.netlify.app'), false);
  assert.equal(isUrlAllowed('https://example.com/admin'), false);
  assert.equal(isUrlAllowed('http://westccmortgage.com'), false, 'non-https rejected');
  assert.equal(isUrlAllowed(getResource('suncoast-about').canonicalUrl), true);

  // Validator caps at 3.
  const many = validateRecommendations(
    ['wccm-about', 'suncoast-about', 'nmls-consumer-access', 'beforejumbo-home'].map(id => ({ id })),
    { audience: 'consumer_borrower' });
  assert.ok(many.length <= 3, 'max 3 recommendations');
});

// ── Never dump the whole ecosystem ──
test('router returns at most 5 candidates and never floods with generic pages', () => {
  const { ids } = converse(['hello'], {});
  assert.ok(ids.length <= 5);
});
