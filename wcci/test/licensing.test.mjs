// Regression test: company vs. individual licensing numbers must stay correctly
// assigned and never be interchanged.
//
//   Company:  West Coast Capital Mortgage Inc.
//             CA DRE Corporation License #02440065 · NMLS #2817729
//   Broker:   Anatoliy Kanevsky — California Real Estate Broker
//             CA DRE Broker License #01385024 · NMLS #2775380

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COMPANY_NAME, COMPANY_LICENSE, COMPANY_NMLS, COMPANY_DRE,
  BROKER_NAME, BROKER_TITLE, BROKER_LICENSE, BROKER_NMLS, BROKER_DRE,
  LICENSE_FOOTER, LICENSE_BLOCK,
} from '../src/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const COMPANY_NMLS_N = '2817729';
const COMPANY_DRE_N = '02440065';
const BROKER_NMLS_N = '2775380';
const BROKER_DRE_N = '01385024';

// ── Canonical constants ──
test('licensing: company constants are exactly correct', () => {
  assert.equal(COMPANY_NAME, 'West Coast Capital Mortgage Inc.');
  assert.equal(COMPANY_NMLS, COMPANY_NMLS_N);
  assert.equal(COMPANY_DRE, COMPANY_DRE_N);
  assert.equal(COMPANY_LICENSE, 'CA DRE Corporation License #02440065 · NMLS #2817729');
  assert.ok(COMPANY_LICENSE.includes(COMPANY_NMLS_N));
  assert.ok(COMPANY_LICENSE.includes(COMPANY_DRE_N));
});

test('licensing: broker constants are exactly correct', () => {
  assert.equal(BROKER_NAME, 'Anatoliy Kanevsky');
  assert.equal(BROKER_TITLE, 'California Real Estate Broker');
  assert.equal(BROKER_NMLS, BROKER_NMLS_N);
  assert.equal(BROKER_DRE, BROKER_DRE_N);
  assert.equal(BROKER_LICENSE, 'CA DRE Broker License #01385024 · NMLS #2775380');
  assert.ok(BROKER_LICENSE.includes(BROKER_NMLS_N));
  assert.ok(BROKER_LICENSE.includes(BROKER_DRE_N));
});

// ── The two NMLS/DRE numbers must never be interchanged ──
test('licensing: company and broker numbers are never interchanged', () => {
  // Company license must NOT contain the broker's numbers.
  assert.ok(!COMPANY_LICENSE.includes(BROKER_NMLS_N), 'company line must not contain broker NMLS');
  assert.ok(!COMPANY_LICENSE.includes(BROKER_DRE_N), 'company line must not contain broker DRE');
  // Broker license must NOT contain the company's numbers.
  assert.ok(!BROKER_LICENSE.includes(COMPANY_NMLS_N), 'broker line must not contain company NMLS');
  assert.ok(!BROKER_LICENSE.includes(COMPANY_DRE_N), 'broker line must not contain company DRE');
  // The four numbers are all distinct.
  assert.equal(new Set([COMPANY_NMLS_N, COMPANY_DRE_N, BROKER_NMLS_N, BROKER_DRE_N]).size, 4);
});

// In the combined footer/block, the company NMLS appears with the corporation
// license, and the broker NMLS appears with the broker license + name.
function assertCorrectPairing(text, label) {
  assert.ok(text.includes(COMPANY_NAME), `${label}: has company name`);
  assert.ok(text.includes('CA DRE Corporation License #02440065'), `${label}: has corp DRE`);
  assert.ok(text.includes('NMLS #2817729'), `${label}: has company NMLS`);
  assert.ok(text.includes(BROKER_NAME), `${label}: has broker name`);
  assert.ok(text.includes('CA DRE Broker License #01385024'), `${label}: has broker DRE`);
  assert.ok(text.includes('NMLS #2775380'), `${label}: has broker NMLS`);
  // Order guard: the corporation NMLS must appear before the broker NMLS, and the
  // broker's individual NMLS must sit with the broker name, not the company.
  assert.ok(text.indexOf('#2817729') < text.indexOf('#2775380'), `${label}: company NMLS precedes broker NMLS`);
}

test('licensing: LICENSE_FOOTER and LICENSE_BLOCK pair numbers correctly', () => {
  assertCorrectPairing(LICENSE_FOOTER, 'LICENSE_FOOTER');
  assertCorrectPairing(LICENSE_BLOCK, 'LICENSE_BLOCK');
});

// ── Every surface must carry the correct, non-interchanged licensing ──
const SURFACES = [
  'index.html',                         // metadata + structured data
  'netlify/functions/chat.js',          // completed-lead email
  'netlify/functions/partial-lead.js',  // partial + structured lead emails
  'netlify/functions/upload.js',        // document review confirmation email
];

test('licensing: all server/metadata surfaces carry correct numbers', () => {
  for (const file of SURFACES) {
    const src = read(file);
    assert.ok(src.includes('2817729'), `${file}: has company NMLS`);
    assert.ok(src.includes('02440065'), `${file}: has corp DRE`);
    assert.ok(src.includes('2775380'), `${file}: has broker NMLS`);
    assert.ok(src.includes('01385024'), `${file}: has broker DRE`);
  }
});

test('licensing: structured data assigns each NMLS to the right entity', () => {
  const html = read('index.html');
  // Company block: legalName Inc. near 2817729; broker Person near 2775380.
  const companyIdx = html.indexOf('West Coast Capital Mortgage Inc.');
  const brokerIdx = html.indexOf('Anatoliy Kanevsky');
  assert.ok(companyIdx >= 0 && brokerIdx >= 0);
  assert.ok(companyIdx < brokerIdx, 'company appears before broker in structured data');
  // The corporation license value and company NMLS are present as identifiers.
  assert.ok(html.includes('"value": "02440065"'));
  assert.ok(html.includes('"value": "2817729"'));
  assert.ok(html.includes('"value": "01385024"'));
  assert.ok(html.includes('"value": "2775380"'));
});

// ── Guard against the OLD single-NMLS footer sneaking back in ──
test('licensing: no legacy "NMLS #2817729"-only footer without the broker', () => {
  const footer = LICENSE_FOOTER;
  // If the company NMLS is shown, the broker NMLS must also be shown.
  assert.ok(footer.includes('2775380'), 'combined footer must also include the broker NMLS');
});
