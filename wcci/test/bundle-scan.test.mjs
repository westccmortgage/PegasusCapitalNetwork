// Production-bundle scan: the built dist/ must carry the approved contact +
// licensing facts and must NOT contain outdated values or crossed license
// attribution.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanBundle } from '../scripts/bundle-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the production build passes the bundle scan', () => {
  // Build fresh so the scan reflects current source (idempotent, ~2s).
  execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  const r = scanBundle();
  assert.equal(r.built, true, 'dist exists after build');
  assert.deepEqual(r.missing, [], 'no required contact/licensing facts missing');
  assert.deepEqual(r.forbidden, [], 'no outdated/crossed values present');
  assert.equal(r.ok, true);
});

test('the scan CATCHES an outdated email and a crossed license line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcci-scan-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  // A bundle missing everything but containing forbidden values.
  writeFileSync(join(dir, 'index.html'), 'contact leads@wcci.online License #02440065 · NMLS #2775380');
  const r = scanBundle(dir);
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0, 'required facts reported missing');
  const needles = r.forbidden.map((f) => f.needle);
  assert.ok(needles.includes('leads@wcci.online'), 'old email caught');
  assert.ok(needles.includes('License #02440065 · NMLS #2775380'), 'crossed attribution caught');
});

test('the scan reports dist missing gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcci-empty-'));
  // Empty dir → treated as built:true with everything missing.
  const r = scanBundle(dir);
  assert.equal(r.ok, false);
});
