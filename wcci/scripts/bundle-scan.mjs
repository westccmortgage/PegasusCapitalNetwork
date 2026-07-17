// PRODUCTION BUNDLE SCAN — fails if outdated phone numbers, incorrect license
// attribution, or inconsistent legal-company wording reappear in the built
// bundle (dist/). Contact + licensing facts have ONE source (companyFacts.js);
// this is the safety net that catches a stray hard-coded value slipping back in.
//
// Run:  node scripts/bundle-scan.mjs   (build first: npm run build)
// Or import { scanBundle } for tests.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Every one of these MUST appear somewhere in the built output.
const REQUIRED = [
  '(310) 654-1577',                 // office (general company line)
  '(310) 686-5053',                 // direct (Anatoliy)
  'tel:+13106541577',               // office tap-to-call
  'tel:+13106865053',               // direct tap-to-call
  'westccmortgage@gmail.com',       // approved email
  'West Coast Capital Mortgage Inc.',
  '2817729',                        // company NMLS
  '2775380',                        // broker NMLS
  '02440065',                       // company DRE corp
  '01385024',                       // broker DRE
  // NOTE: the full "…License #… · NMLS #…" lines are assembled at runtime from
  // companyFacts (template interpolation), so they are not contiguous literals
  // in the minified bundle. Correct PAIRING is verified by the unit tests
  // (company-facts.test.mjs / licensing.test.mjs); here we verify presence of
  // each identifier and the ABSENCE of any hard-coded crossed line below.
];

// None of these may appear — outdated values or crossed license attribution.
const FORBIDDEN = [
  { needle: 'leads@wcci.online', why: 'outdated email (replaced by westccmortgage@gmail.com)' },
  { needle: 'License #02440065 · NMLS #2775380', why: 'crossed attribution: company DRE with broker NMLS' },
  { needle: 'License #01385024 · NMLS #2817729', why: 'crossed attribution: broker DRE with company NMLS' },
  { needle: '"telephone": "+13106865053"', why: 'direct number shown as the general company telephone (JSON-LD)' },
  { needle: '"telephone":"+13106865053"', why: 'direct number shown as the general company telephone (JSON-LD)' },
  { needle: 'West Coast Capital Mortgage LLC', why: 'wrong legal entity wording (must be "Inc.")' },
  { needle: 'West Coast Capital Mortgage, Inc.', why: 'inconsistent legal-entity punctuation' },
];

function readAll(dir) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) text += readAll(p);
    else if (/\.(js|css|html)$/.test(name)) text += '\n' + readFileSync(p, 'utf8');
  }
  return text;
}

export function scanBundle(distDir = DIST) {
  if (!existsSync(distDir)) return { ok: false, built: false, missing: REQUIRED.slice(), forbidden: [] };
  const bundle = readAll(distDir);
  const missing = REQUIRED.filter((s) => !bundle.includes(s));
  const forbidden = FORBIDDEN.filter((f) => bundle.includes(f.needle));
  return { ok: missing.length === 0 && forbidden.length === 0, built: true, missing, forbidden };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scanBundle();
  if (!r.built) { console.error('✗ bundle scan: dist/ not found — run `npm run build` first.'); process.exit(1); }
  if (r.ok) { console.log('✓ bundle scan passed — contact + licensing facts are consistent.'); process.exit(0); }
  if (r.missing.length) console.error('✗ MISSING required facts:\n  - ' + r.missing.join('\n  - '));
  if (r.forbidden.length) console.error('✗ FORBIDDEN values present:\n  - ' + r.forbidden.map((f) => `"${f.needle}" (${f.why})`).join('\n  - '));
  process.exit(1);
}
