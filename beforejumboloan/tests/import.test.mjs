/* Import-pipeline tests: pure builders (happy path) + fail-loud guards
   (run the CLI on bad fixtures and assert a non-zero exit). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildFhfaDataset } = await import('../scripts/import-fhfa-limits.mjs');
const { buildFhaDataset } = await import('../scripts/import-fha-limits.mjs');

test('FHFA builder: baseline=min, ceiling=max, high_cost derived, metadata present', () => {
  const rows = [
    ['FIPS State Code', 'FIPS County Code', 'County Name', 'State', 'One-Unit Limit', 'Two-Unit Limit', 'Three-Unit Limit', 'Four-Unit Limit'],
    ['12', '099', 'Palm Beach County', 'FL', '832750', '1066250', '1288800', '1601750'],
    ['12', '087', 'Monroe County', 'FL', '990150', '', '', ''],
    ['06', '037', 'Los Angeles County', 'CA', '1249125', '1599375', '1933200', '2402625'],
  ];
  const ds = buildFhfaDataset(rows, { year: 2026, verified: '2026-06-12' });
  assert.equal(ds.record_count, 3);
  assert.equal(ds.baseline.one_unit, 832750);
  assert.equal(ds.ceiling.one_unit, 1249125);
  assert.equal(ds.effective_year, 2026);
  assert.ok(ds.imported_at && ds.source_name && ds.source_url_or_label);
  const monroe = ds.counties.find((c) => c.county_name === 'Monroe County');
  assert.equal(monroe.county_fips, '12087');
  assert.equal(monroe.high_cost, true);
  const pb = ds.counties.find((c) => c.county_name === 'Palm Beach County');
  assert.equal(pb.high_cost, false);
});

test('FHA builder: parses unit columns + computes floor/ceiling', () => {
  const rows = [
    ['State', 'County Code', 'County Name', 'One-Family', 'Two-Family', 'Three-Family', 'Four-Family'],
    ['CA', '06037', 'Los Angeles County', '1249125', '1599375', '1933200', '2402625'],
  ];
  const ds = buildFhaDataset(rows, { year: 2026 });
  assert.equal(ds.record_count, 1);
  assert.equal(ds.counties[0].fha_two_unit, 1599375);
  assert.equal(ds.floor.one_unit, 1249125);
});

function expectFail(script, fixture, rx) {
  let failed = false, output = '';
  try {
    execFileSync('node', [join(root, 'scripts', script), join(root, 'tests/fixtures', fixture)], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
    output = String(e.stdout || '') + String(e.stderr || '');
  }
  assert.ok(failed, `${script} on ${fixture} should exit non-zero`);
  assert.match(output, rx);
}

test('FHFA import fails loudly on a missing required column', () => {
  expectFail('import-fhfa-limits.mjs', 'fhfa-missing-onecol.csv', /missing required column: One-Unit/i);
});

test('FHFA import fails loudly on duplicate state/county records', () => {
  expectFail('import-fhfa-limits.mjs', 'fhfa-duplicate.csv', /duplicate/i);
});

test('FHFA import fails loudly on missing/invalid one-unit limit', () => {
  expectFail('import-fhfa-limits.mjs', 'fhfa-invalid-one.csv', /one-unit limit missing\/invalid/i);
});

test('committed dataset matches its own record_count + carries provenance', () => {
  const fhfa = JSON.parse(readFileSync(join(root, 'data/loan-limits/2026/fhfa-conforming.json'), 'utf8'));
  assert.equal(fhfa.record_count, fhfa.counties.length);
  assert.ok(fhfa.imported_at && fhfa.source_name);
  assert.match(fhfa.compliance, /verify current FHFA\/Fannie\/Freddie\/HUD limits before launch/);
});

import { FHFA_MIN_OFFICIAL } from '../scripts/import-fhfa-limits.mjs';

test('dataset_type = "sample" for a small file, "official_full" past the threshold', () => {
  const small = buildFhfaDataset([
    ['FIPS', 'County Name', 'State', 'One-Unit Limit', 'Two-Unit Limit', 'Three-Unit Limit', 'Four-Unit Limit'],
    ['12099', 'Palm Beach County', 'FL', '832750', '1066250', '1288800', '1601750'],
  ]);
  assert.equal(small.dataset_type, 'sample');

  const rows = [['FIPS', 'County Name', 'State', 'One-Unit Limit', 'Two-Unit Limit', 'Three-Unit Limit', 'Four-Unit Limit']];
  for (let i = 0; i < FHFA_MIN_OFFICIAL; i++) {
    rows.push([String(10000 + i), 'Test' + i + ' County', 'TX', '832750', '1066250', '1288800', '1601750']);
  }
  const big = buildFhfaDataset(rows);
  assert.equal(big.dataset_type, 'official_full');
  assert.ok(big.record_count >= FHFA_MIN_OFFICIAL);
});

test('production gate reflects the installed dataset (official_full ⇒ exit 0)', () => {
  // With the official FHFA + FHA full files imported, the gate must PASS.
  let failed = false, output = '';
  try {
    output = String(execFileSync('node', [join(root, 'scripts/validate-loan-limits.mjs')], { stdio: 'pipe' }));
  } catch (e) {
    failed = true;
    output = String(e.stdout || '') + String(e.stderr || '');
  }
  const fhfa = JSON.parse(readFileSync(join(root, 'data/loan-limits/2026/fhfa-conforming.json'), 'utf8'));
  if (fhfa.dataset_type === 'official_full') {
    assert.ok(!failed, 'gate must pass (exit 0) when official_full data is installed');
    assert.match(output, /PRODUCTION READY/);
  } else {
    assert.ok(failed, 'gate must fail on non-official data');
    assert.match(output, /NOT PRODUCTION READY/);
  }
});

test('the gate FAILS loudly on a sample dataset (guard logic intact)', () => {
  // Sanity-check the guard against a synthetic sample without touching installed data.
  const sample = buildFhfaDataset([
    ['FIPS State Code', 'FIPS County Code', 'County Name', 'State', 'One-Unit Limit', 'Two-Unit Limit', 'Three-Unit Limit', 'Four-Unit Limit'],
    ['06', '037', 'Los Angeles County', 'CA', '1249125', '1599375', '1933200', '2402625'],
  ]);
  assert.equal(sample.dataset_type, 'sample');
});
