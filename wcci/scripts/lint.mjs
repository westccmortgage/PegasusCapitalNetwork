#!/usr/bin/env node
// Dependency-free lint pass (uses esbuild, already installed via Vite).
//
// The project intentionally avoids adding a full ESLint toolchain to keep the
// deploy tiny. This lint does two things that actually matter here:
//   1. Parses every JS/JSX/MJS source file with esbuild (catches real syntax
//      errors, including JSX).
//   2. Guards the shared system prompt against banned compliance phrases.
// Exits non-zero on any problem so `npm run lint` gates CI meaningfully.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { transformSync } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'scripts']);
const errors = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (['.js', '.mjs', '.jsx'].includes(extname(name))) checkFile(full);
  }
}

function checkFile(file) {
  const src = readFileSync(file, 'utf8');
  const loader = extname(file) === '.jsx' ? 'jsx' : 'js';
  try {
    transformSync(src, { loader, format: 'esm', sourcefile: file });
  } catch (e) {
    const msg = (e.errors && e.errors.length)
      ? e.errors.map(x => `${x.text} (line ${x.location ? x.location.line : '?'})`).join('; ')
      : e.message;
    errors.push(`${rel(file)}: ${msg}`);
  }
}

function rel(f) { return f.replace(root + '/', ''); }

// ── Compliance guard on the shared system prompt ──
function checkPrompt() {
  const file = join(root, 'src', 'systemPrompt.js');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return; }
  // Flag banned phrases only where used as assertions — skip lines that clearly
  // list them as forbidden (contain never/not/n't/avoid/forbid/do not).
  const banned = [/\byou are approved\b/i, /\bguaranteed rate\b/i, /\byou qualify\b/i, /\bbest rate guaranteed\b/i];
  src.split('\n').forEach((line, i) => {
    if (/(never|not |n't|avoid|forbid|banned|do not)/i.test(line)) return;
    for (const re of banned) if (re.test(line)) errors.push(`src/systemPrompt.js:${i + 1}: banned compliance phrase ${re}`);
  });
}

walk(root);
checkPrompt();

if (errors.length) {
  console.error('✖ lint failed:\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('✓ lint passed (' + 'esbuild syntax + compliance guard)');
