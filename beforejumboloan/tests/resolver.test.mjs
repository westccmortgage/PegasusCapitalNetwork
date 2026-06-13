/* National loan-limit resolver tests.
 * loan-limits.js is a browser IIFE that assigns global.BJLLimits; importing it
 * for its side effect populates globalThis.BJLLimits in Node. We pass an
 * explicit `db` (the real JSON files) to the pure resolver. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

await import('../js/loan-limits.js');
const API = globalThis.BJLLimits;

const db = {
  conforming: read('data/loan-limits/2026/fhfa-conforming.json'),
  fha: read('data/loan-limits/2026/fha-forward.json'),
  geo: read('data/geo/us-counties.json'),
};

test('resolver API + compliance string present', () => {
  assert.equal(typeof API.resolveLoanLimits, 'function');
  assert.match(API.COMPLIANCE, /verify current FHFA\/Fannie\/Freddie\/HUD limits before launch/);
});

test('seeded high-cost county (Monroe) resolves to its 1-unit limit', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County' }, db);
  assert.equal(r.found, true);
  assert.equal(r.countyConformingLimit, 990150);
  assert.equal(r.highCost, true);
  assert.equal(r.year, 2026);
  assert.equal(r.warning, null);
});

test('seeded baseline county (Palm Beach) is not high-cost', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Palm Beach County' }, db);
  assert.equal(r.countyConformingLimit, 832750);
  assert.equal(r.highCost, false);
});

test('matching is case/space/"County"-insensitive', () => {
  const r = API.resolveLoanLimits({ state: 'ca', county: 'los angeles' }, db);
  assert.equal(r.found, true);
  assert.equal(r.countyConformingLimit, 1249125);
});

test('multi-unit returns the correct unit column', () => {
  const r = API.resolveLoanLimits({ state: 'CA', county: 'Orange County', units: 2 }, db);
  assert.equal(r.countyConformingLimit, 1599375);
});

test('county present but unit not imported → baseline + warning', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: 3 }, db);
  assert.equal(r.countyConformingLimit, 1288800); // baseline 3-unit
  assert.match(r.warning, /three-unit limit isn’t imported/);
});

test('unknown county → national baseline + verify warning', () => {
  const r = API.resolveLoanLimits({ state: 'TX', county: 'Travis County' }, db);
  assert.equal(r.found, false);
  assert.equal(r.countyConformingLimit, 832750);
  assert.match(r.warning, /not in the loan-limit dataset/);
});

test('missing county selection → prompt to select', () => {
  const r = API.resolveLoanLimits({ state: 'FL' }, db);
  assert.match(r.warning, /Select a state and county/);
});

test('no dataset loaded → graceful warning, no throw', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County' }, { conforming: null });
  assert.equal(r.countyConformingLimit, null);
  assert.match(r.warning, /not loaded/);
});

test('geo: states complete (51) and seeded counties present', () => {
  assert.equal(db.geo.states.length, 51); // 50 states + DC
  assert.ok(db.geo.counties.FL.some((c) => c.name === 'Monroe County'));
  assert.ok(db.geo.counties.CA.some((c) => c.name === 'Orange County'));
});
