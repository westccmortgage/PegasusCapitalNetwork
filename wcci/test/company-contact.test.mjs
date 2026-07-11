// GLOBAL COMPANY CONTACT AND LICENSING STANDARD — the single source of truth.
// Office vs Direct must be distinct, the email/websites are the approved values,
// and no outdated contact info remains.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMPANY_FACTS, companyBio, CONTACT_LINE } from '../src/config/companyFacts.js';
import { OFFICE_PHONE, DIRECT_PHONE, COMPANY_EMAIL, PRIMARY_WEBSITES, OFFICE_PHONE_HREF, DIRECT_PHONE_HREF } from '../src/i18n.js';

test('office and direct numbers are the approved, distinct values', () => {
  assert.equal(COMPANY_FACTS.officePhone, '(310) 654-1577');
  assert.equal(COMPANY_FACTS.directPhone, '(310) 686-5053');
  assert.notEqual(COMPANY_FACTS.officePhone, COMPANY_FACTS.directPhone);
  assert.equal(OFFICE_PHONE, '(310) 654-1577');
  assert.equal(DIRECT_PHONE, '(310) 686-5053');
  assert.equal(OFFICE_PHONE_HREF, 'tel:+13106541577');
  assert.equal(DIRECT_PHONE_HREF, 'tel:+13106865053');
});

test('email and primary websites are the approved values', () => {
  assert.equal(COMPANY_FACTS.email, 'westccmortgage@gmail.com');
  assert.equal(COMPANY_EMAIL, 'westccmortgage@gmail.com');
  assert.deepEqual(PRIMARY_WEBSITES, ['https://westcoastcapitalmortgage.com', 'https://wcci.online']);
  // The old lead email must be gone from the source of truth.
  assert.ok(!COMPANY_FACTS.approvedEmails.includes('leads@wcci.online'));
});

test('companyBio distinguishes office (general) from direct, and never drops one', () => {
  const bio = companyBio();
  assert.ok(bio.includes('(310) 654-1577'), 'office present');
  assert.ok(bio.includes('(310) 686-5053'), 'direct present');
  assert.ok(/office/i.test(bio) && /direct/i.test(bio), 'both labeled');
  assert.ok(bio.includes('westccmortgage@gmail.com'), 'email present');
});

test('CONTACT_LINE labels office as general and includes both lines + email', () => {
  assert.ok(/Office:.*654-1577/.test(CONTACT_LINE));
  assert.ok(/Direct:.*686-5053/.test(CONTACT_LINE));
  assert.ok(CONTACT_LINE.includes('westccmortgage@gmail.com'));
});

test('licensing numbers remain correct and never interchanged', () => {
  assert.equal(COMPANY_FACTS.companyNmls, '2817729');
  assert.equal(COMPANY_FACTS.companyDreCorporationLicense, '02440065');
  assert.equal(COMPANY_FACTS.founderNmls, '2775380');
  assert.equal(COMPANY_FACTS.founderDreBrokerLicense, '01385024');
});
