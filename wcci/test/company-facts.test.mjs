// Config-integrity tests for the single source of truth (companyFacts.js) and
// the structured-output guards. Ensures state availability comes from ONE value,
// the two NMLS numbers never cross, and no unverified Florida license shows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMPANY_FACTS, COMPANY_LICENSE_LINE, BROKER_LICENSE_LINE, companyBio, isSupportedState } from '../src/config/companyFacts.js';
import { applyStatePatch, grantContactConsent, initialConversationState } from '../src/lib/conversationIntelligence.js';

test('company facts: numbers are correct and never interchanged', () => {
  assert.equal(COMPANY_FACTS.legalEntity, 'West Coast Capital Mortgage Inc.');
  assert.equal(COMPANY_FACTS.companyNmls, '2817729');
  assert.equal(COMPANY_FACTS.companyDreCorporationLicense, '02440065');
  assert.equal(COMPANY_FACTS.founderNmls, '2775380');
  assert.equal(COMPANY_FACTS.founderDreBrokerLicense, '01385024');
  assert.ok(COMPANY_LICENSE_LINE.includes('2817729') && COMPANY_LICENSE_LINE.includes('02440065'));
  assert.ok(!COMPANY_LICENSE_LINE.includes('2775380'), 'company line has no broker NMLS');
  assert.ok(BROKER_LICENSE_LINE.includes('2775380') && BROKER_LICENSE_LINE.includes('01385024'));
  assert.ok(!BROKER_LICENSE_LINE.includes('2817729'), 'broker line has no company NMLS');
});

test('company facts: owner-approved biography dates only', () => {
  assert.equal(COMPANY_FACTS.mortgageCareerStartYear, 2004);
  assert.equal(COMPANY_FACTS.brokerLicenseYear, 2009);
  const bio = companyBio();
  assert.ok(bio.includes('2004') && bio.includes('2009'));
  assert.ok(bio.includes('West Coast Capital Mortgage Inc.'));
  assert.ok(/WCCI.*not the mortgage company/i.test(bio), 'bio clarifies WCCI is not the company');
});

test('supported states come from ONE config value', () => {
  assert.deepEqual(COMPANY_FACTS.supportedStates, ['CA', 'FL']);
  assert.equal(isSupportedState('CA'), true);
  assert.equal(isSupportedState('fl'), true);
  assert.equal(isSupportedState('TX'), false);
  assert.equal(isSupportedState('NY'), false);
});

test('no unverified Florida license number is displayed', () => {
  const fl = COMPANY_FACTS.licensingByState.FL.lines.join(' ');
  // Florida shows the company NMLS only — never a fabricated FL license #.
  assert.ok(fl.includes('2817729'));
  assert.ok(!/DRE.*FL|Florida.*License #\d/i.test(fl), 'no invented Florida license number');
  assert.equal(COMPANY_FACTS.floridaPhone, null, 'no invented Florida phone');
});

test('state patch guard: model can decline consent but never grant it', () => {
  let s = initialConversationState();
  // Model tries to grant consent — must be ignored.
  s = applyStatePatch(s, { contactConsent: 'granted', stage: 'education' });
  assert.notEqual(s.contactConsent, 'granted', 'model cannot grant consent');
  assert.equal(s.stage, 'education', 'benign fields still apply');
  // Model can record a decline.
  s = applyStatePatch(s, { contactConsent: 'declined' });
  assert.equal(s.contactConsent, 'declined');
  // Only an explicit app-side grant (form submit) flips it.
  s = grantContactConsent(s);
  assert.equal(s.contactConsent, 'granted');
});

test('state patch guard: unknown enum values are ignored', () => {
  let s = initialConversationState();
  s = applyStatePatch(s, { stage: 'totally_invalid', trustLevel: 'nope', objections: ['made_up', 'privacy'] });
  assert.equal(s.stage, 'discovery', 'invalid stage ignored');
  assert.equal(s.trustLevel, 'unknown', 'invalid trust ignored');
  assert.ok(s.objections.includes('privacy') && !s.objections.includes('made_up'), 'only valid objections kept');
});
