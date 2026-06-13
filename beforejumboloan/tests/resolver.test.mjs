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

/* ---- units 1–4 coverage (driven by the imported dataset) ---- */
const U = [null, 'one', 'two', 'three', 'four'];
const expect = {
  'Los Angeles County': { st: 'CA', v: [null, 1249125, 1599375, 1933200, 2402625] },
  'Orange County': { st: 'CA', v: [null, 1249125, 1599375, 1933200, 2402625] },
  'Miami-Dade County': { st: 'FL', v: [null, 832750, 1066250, 1288800, 1601750] },
};
for (const [county, { st, v }] of Object.entries(expect)) {
  test(`${county} resolves all units 1–4`, () => {
    for (let u = 1; u <= 4; u++) {
      const r = API.resolveLoanLimits({ state: st, county, units: u }, db);
      assert.equal(r.found, true);
      assert.equal(r.units, u);
      assert.equal(r.countyConformingLimit, v[u], `${county} ${u}-unit`);
    }
  });
}

test('Monroe County: 1-unit verified; 2–4 fall back to baseline with a warning', () => {
  const r1 = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: 1 }, db);
  assert.equal(r1.countyConformingLimit, 990150);
  assert.equal(r1.highCost, true);
  for (let u = 2; u <= 4; u++) {
    const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: u }, db);
    assert.equal(r.countyConformingLimit, db.conforming.baseline[U[u] + '_unit']);
    assert.match(r.warning, /isn’t imported yet/);
  }
});

test('changing units 1 → 4 changes the resolved limit', () => {
  const u1 = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 1 }, db);
  const u4 = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 4 }, db);
  assert.notEqual(u1.countyConformingLimit, u4.countyConformingLimit);
  assert.equal(u4.countyConformingLimit, 2402625);
});

test('FHA limit returned per-unit when present (LA), null when absent (Monroe)', () => {
  const la = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 2 }, db);
  assert.equal(la.fhaLimit, 1599375);
  const monroe = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: 1 }, db);
  assert.equal(monroe.fhaLimit, null);
});

test('resolver surfaces sourceMeta provenance', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Miami-Dade County' }, db);
  assert.ok(r.sourceMeta && r.sourceMeta.source_name && r.sourceMeta.imported_at);
  assert.equal(r.sourceMeta.effective_year, 2026);
});

test('County suffix optional both ways', () => {
  const withSuffix = API.resolveLoanLimits({ state: 'FL', county: 'Miami-Dade County' }, db);
  const without = API.resolveLoanLimits({ state: 'FL', county: 'miami-dade' }, db);
  assert.equal(withSuffix.countyConformingLimit, without.countyConformingLimit);
  assert.equal(without.found, true);
});
