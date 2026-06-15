/* National loan-limit resolver tests (run against the imported OFFICIAL data).
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
  places: read('data/geo/us-places.json'),
  zips: read('data/geo/us-zips.json'),
  aliases: read('data/geo/aliases.json'),
};

test('resolver API + compliance string present', () => {
  assert.equal(typeof API.resolveLoanLimits, 'function');
  assert.equal(typeof API.resolvePropertyLocation, 'function');
  assert.match(API.COMPLIANCE, /verify current FHFA\/Fannie\/Freddie\/HUD limits before launch/);
});

test('official dataset is full nationwide (official_full, all 50 states + DC + territories)', () => {
  assert.equal(db.conforming.dataset_type, 'official_full');
  assert.equal(db.fha.dataset_type, 'official_full');
  assert.ok(db.conforming.record_count >= 3000, 'FHFA county count');
  const states = new Set(db.conforming.counties.map((c) => c.state_abbr));
  assert.ok(states.size >= 51, 'covers 50 states + DC (+ territories)');
});

test('high-cost county (Monroe) resolves to its 1-unit limit', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County' }, db);
  assert.equal(r.found, true);
  assert.equal(r.countyConformingLimit, 990150);
  assert.equal(r.highCost, true);
  assert.equal(r.tier, 'high-cost');
  assert.equal(r.year, 2026);
  assert.equal(r.warning, null);
});

test('baseline county (Palm Beach) is not high-cost', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Palm Beach County' }, db);
  assert.equal(r.countyConformingLimit, 832750);
  assert.equal(r.highCost, false);
  assert.equal(r.tier, 'baseline');
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

test('high-cost county carries real 2–4 unit limits (no baseline fallback)', () => {
  const v = [null, 990150, 1267600, 1532200, 1904150];
  for (let u = 1; u <= 4; u++) {
    const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: u }, db);
    assert.equal(r.found, true);
    assert.equal(r.countyConformingLimit, v[u], `Monroe ${u}-unit`);
    assert.equal(r.needsVerification, false);
    assert.equal(r.warning, null);
  }
});

test('a genuinely-absent county → national baseline + verify warning, never silently verified', () => {
  const r = API.resolveLoanLimits({ state: 'CA', county: 'Nonexistent County' }, db);
  assert.equal(r.found, false);
  assert.equal(r.needsVerification, true);
  assert.equal(r.countyConformingLimit, db.conforming.baseline.one_unit);
  assert.match(r.warning, /not in the loan-limit dataset|needs official verification/i);
});

test('missing county selection → prompt for property location', () => {
  const r = API.resolveLoanLimits({ state: 'FL' }, db);
  assert.match(r.warning, /property location|state and county/i);
});

test('resolveLoanLimits accepts county_fips directly', () => {
  const r = API.resolveLoanLimits({ county_fips: '06037', state: 'CA', county: 'Los Angeles County' }, db);
  assert.equal(r.found, true);
  assert.equal(r.countyConformingLimit, 1249125);
});

test('no dataset loaded → graceful warning, no throw', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County' }, { conforming: null });
  assert.equal(r.countyConformingLimit, null);
  assert.match(r.warning, /not loaded/);
});

test('geo: 50 states + DC present, real counties present', () => {
  assert.equal(db.geo.states.length, 51);
  assert.ok(db.geo.counties.FL.some((c) => c.name === 'Monroe County'));
  assert.ok(db.geo.counties.TX.some((c) => c.name === 'Travis County'));
});

/* ---- units 1–4 coverage (driven by the imported dataset) ---- */
const expect = {
  'Los Angeles County': { st: 'CA', v: [null, 1249125, 1599375, 1933200, 2402625] },
  'Orange County': { st: 'CA', v: [null, 1249125, 1599375, 1933200, 2402625] },
  'Miami-Dade County': { st: 'FL', v: [null, 832750, 1066250, 1288800, 1601750] },
  'Travis County': { st: 'TX', v: [null, 832750, 1066250, 1288800, 1601750] },
};
for (const [county, { st, v }] of Object.entries(expect)) {
  test(`${county} resolves all units 1–4`, () => {
    for (let u = 1; u <= 4; u++) {
      const r = API.resolveLoanLimits({ state: st, county, units: u }, db);
      assert.equal(r.found, true);
      assert.equal(r.units, u);
      assert.equal(r.countyConformingLimit, v[u], `${county} ${u}-unit`);
      assert.equal(r.needsVerification, false);
    }
  });
}

test('changing units 1 → 4 changes the resolved limit', () => {
  const u1 = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 1 }, db);
  const u4 = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 4 }, db);
  assert.notEqual(u1.countyConformingLimit, u4.countyConformingLimit);
  assert.equal(u4.countyConformingLimit, 2402625);
});

test('FHA limit returned per-unit from the official HUD CHUMS forward file', () => {
  const la = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County', units: 2 }, db);
  assert.equal(la.fhaLimit, 1599375);
  const monroe = API.resolveLoanLimits({ state: 'FL', county: 'Monroe County', units: 1 }, db);
  assert.equal(monroe.fhaLimit, 990150);
  const travis = API.resolveLoanLimits({ state: 'TX', county: 'Travis County', units: 1 }, db);
  assert.equal(travis.fhaLimit, 571550);
});

test('resolver surfaces sourceMeta provenance', () => {
  const r = API.resolveLoanLimits({ state: 'FL', county: 'Miami-Dade County' }, db);
  assert.ok(r.sourceMeta && r.sourceMeta.source_name && r.sourceMeta.imported_at);
  assert.equal(r.sourceMeta.effective_year, 2026);
  assert.equal(r.datasetType, 'official_full');
});

test('County suffix optional both ways', () => {
  const withSuffix = API.resolveLoanLimits({ state: 'FL', county: 'Miami-Dade County' }, db);
  const without = API.resolveLoanLimits({ state: 'FL', county: 'miami-dade' }, db);
  assert.equal(withSuffix.countyConformingLimit, without.countyConformingLimit);
  assert.equal(without.found, true);
});

/* ---- BUG FIX: a county equal to the national baseline is "baseline", not "high-cost" ---- */
test('baseline/high-cost labeling: limit == baseline ⇒ baseline tier, not high-cost', () => {
  const r = API.resolveLoanLimits({ state: 'TX', county: 'Travis County' }, db);
  assert.equal(r.countyConformingLimit, db.conforming.baseline.one_unit);
  assert.equal(r.highCost, false);
  assert.equal(r.highBalance, false);
  assert.equal(r.tier, 'baseline');
});

test('baseline/high-cost labeling: limit above baseline ⇒ high-cost tier', () => {
  const r = API.resolveLoanLimits({ state: 'CA', county: 'Los Angeles County' }, db);
  assert.ok(r.countyConformingLimit > db.conforming.baseline.one_unit);
  assert.equal(r.highCost, true);
  assert.equal(r.tier, 'high-cost');
});

/* ============================================================
   resolvePropertyLocation — deterministic property → county
   ============================================================ */

/* ---- ZIP: official HUD CHUMS starter (single-county auto-resolve; multi-county asks) ---- */
test('ZIP → one county → auto-detect + resolved status (official HUD CHUMS starter)', () => {
  const r = API.resolvePropertyLocation('90210', db);
  assert.equal(r.status, 'resolved');
  assert.equal(r.matched_by, 'zip');
  assert.equal(r.possible_matches.length, 1);
  assert.equal(r.county_fips, '06037');
  assert.equal(r.county_name, 'Los Angeles County');
});

test('ZIP → multiple counties (CHUMS, no ratios) → ambiguous, no auto-select, NO ratio hint', () => {
  const r = API.resolvePropertyLocation('10463', db); // Bronx / New York counties
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.confidence, 'ambiguous');
  assert.equal(r.county_fips, null, 'must not auto-select');
  assert.ok(r.possible_matches.length >= 2);
  assert.equal(r.most_common, null, 'CHUMS has no ratios → no most-common confidence claim');
  assert.match(r.warning, /more than one county/i);
});

test('ZIP not found in the official set → unresolved, no calculation', () => {
  const r = API.resolvePropertyLocation('00000', db);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.county_fips, null);
  assert.match(r.warning, /could not match this ZIP/i);
});

test('ZIP is GATED when the zips dataset is only a sample (never defaults a county)', () => {
  const sampleDb = Object.assign({}, db, { zips: { dataset_type: 'sample', coverage: 'partial-seed', zips: {} } });
  const r = API.resolvePropertyLocation('90210', sampleDb);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.county_fips, null);
  assert.match(r.warning, /official ZIP\/county file/i);
});

/* ---- HUD-USPS crosswalk tier (with ratios) — ranked most-common hint ---- */
const officialCrosswalk = (zips) => Object.assign({}, db, {
  zips: { dataset_type: 'official', coverage: 'official', has_ratio_confidence: true, source_name: 'HUD USPS ZIP Code Crosswalk', zips }
});

test('crosswalk ZIP → multiple counties → ratio-ranked most-common hint', () => {
  const r = API.resolvePropertyLocation('12345', officialCrosswalk({
    '12345': [
      { state_abbr: 'NY', county_name: 'Schenectady County', county_fips: '36093', res_ratio: 0.7 },
      { state_abbr: 'NY', county_name: 'Albany County', county_fips: '36001', res_ratio: 0.3 }
    ]
  }));
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.county_fips, null);
  assert.equal(r.possible_matches[0].county_fips, '36093', 'highest residential ratio first');
  assert.match(r.most_common, /Schenectady/);
  assert.match(r.possible_matches[0].label, /most common/);
});

/* ---- alias / city / county ---- */
test('alias → county (Miami-Dade)', () => {
  const r = API.resolvePropertyLocation('Miami-Dade', db);
  assert.equal(r.confidence, 'high');
  assert.equal(r.possible_matches[0].county_fips, '12086');
});

test('alias → county (Key West → Monroe)', () => {
  const r = API.resolvePropertyLocation('Key West', db);
  assert.equal(r.possible_matches[0].county_name, 'Monroe County');
  assert.equal(r.possible_matches[0].state_abbr, 'FL');
});

test('"Austin TX" is honestly ambiguous (Austin County vs city of Austin → Travis)', () => {
  // With the full official county list, "Austin" is both a county (Austin
  // County, TX) and a city (Austin → Travis County). Surface both; never guess.
  const r = API.resolvePropertyLocation('Austin TX', db);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.county_fips, null, 'no auto-select');
  const names = r.possible_matches.map((m) => m.county_name).sort();
  assert.ok(names.includes('Austin County'), 'includes Austin County');
  assert.ok(names.includes('Travis County'), 'includes the city of Austin → Travis County');
});

test('unambiguous city resolves directly (Newport Beach CA → Orange, no county collision)', () => {
  const r = API.resolvePropertyLocation('Newport Beach CA', db);
  assert.equal(r.status, 'resolved');
  assert.equal(r.possible_matches[0].county_name, 'Orange County');
});

test('city+state → county (Newport Beach CA → Orange)', () => {
  const r = API.resolvePropertyLocation('Newport Beach CA', db);
  assert.equal(r.possible_matches[0].county_name, 'Orange County');
});

test('ambiguous city → multiple matches, needs confirmation, no auto-select', () => {
  const r = API.resolvePropertyLocation('Beverly Hills', db);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.needs_confirmation, true);
  assert.equal(r.county_fips, null);
  assert.ok(r.possible_matches.length >= 2);
});

test('county name query → county (Miami-Dade County, FL)', () => {
  const r = API.resolvePropertyLocation('Miami-Dade County, FL', db);
  assert.equal(r.possible_matches[0].county_name, 'Miami-Dade County');
  assert.equal(r.possible_matches[0].state_abbr, 'FL');
});

test('unresolvable query → status unresolved + warning', () => {
  const r = API.resolvePropertyLocation('zzzz nowhere xx', db);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.confidence, 'none');
  assert.ok(r.warning);
});
