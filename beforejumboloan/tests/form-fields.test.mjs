/* Netlify hidden-form-fields test.
 * Every field studio.js posts to "/" must have a matching hidden input in the
 * static form in scenario-studio.html, or Netlify won't capture it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'scenario-studio.html'), 'utf8');
const studio = readFileSync(join(root, 'js', 'studio.js'), 'utf8');

// Field names declared in the hidden Netlify form.
const formBlock = html.slice(html.indexOf('data-netlify="true"'));
const formFields = new Set([...formBlock.matchAll(/(?:name)="([a-z0-9_-]+)"/gi)].map((m) => m[1]));

// Keys studio.js sends in the submission `data` object.
const dataBlock = studio.slice(studio.indexOf('var data = {'), studio.indexOf('var body = new URLSearchParams'));
const sentKeys = new Set([...dataBlock.matchAll(/(?:"([a-z0-9_-]+)"|\b([a-z_][a-z0-9_]*)):/gi)]
  .map((m) => m[1] || m[2])
  .filter((k) => k && k !== 'data'));

test('hidden form declares the Netlify form name', () => {
  assert.ok(formFields.has('form-name'));
  assert.ok(html.includes('name="before-jumbo-strategy-studio"'));
});

test('every posted field has a matching hidden form input', () => {
  const missing = [...sentKeys].filter((k) => !formFields.has(k));
  assert.deepEqual(missing, [], `missing hidden inputs for: ${missing.join(', ')}`);
});

test('core lead + scenario fields are present', () => {
  for (const f of ['name', 'email', 'phone', 'market_slug', 'estimated_loan_amount', 'scenario_summary', 'suggested_review_paths']) {
    assert.ok(formFields.has(f) && sentKeys.has(f), `field ${f} present in both form and payload`);
  }
});
