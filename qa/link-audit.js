#!/usr/bin/env node
/**
 * PEGASUS QA — Static Link & Code Audit
 * Zero dependencies — pure Node.js fs/path/regex.
 * Scans every HTML and JS file for broken links, bad patterns,
 * missing files, placeholder hrefs, and suspicious onclick handlers.
 *
 * Usage: node qa/link-audit.js
 * Output: qa-report.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const REPORT  = path.join(ROOT, 'qa-report.md');
const ROUTES  = require('./routes');

/* ── Collect files ──────────────────────────────────────────── */

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'qa'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const htmlFiles = walk(ROOT, '.html');
const jsFiles   = walk(ROOT, '.js').filter(f => f.includes('/js/'));

/* Existing files index */
const existingFiles = new Set(
  htmlFiles.map(f => path.relative(ROOT, f))
);

/* ── Issue collector ────────────────────────────────────────── */

const issues = [];
const stats  = { files: 0, passed: 0, totalIssues: 0, critical: 0, important: 0, later: 0 };

function issue(severity, file, line, type, detail, fix = '') {
  issues.push({
    severity,
    file: path.relative(ROOT, file),
    line,
    type,
    detail,
    fix,
  });
  stats.totalIssues++;
  stats[severity.toLowerCase()]++;
}

/* ── Patterns ────────────────────────────────────────────────── */

const KNOWN_EXTERNAL = /^(https?:|\/\/|mailto:|tel:|#|javascript:)/;
const OLD_ROUTES = [
  'lender-directory.html',
  'create-account.html',
  'register.html',
  'login.html',
  'pricing.html',
  'view-pricing.html',
];
const MAIN_CTA_WORDS = /\b(join|signup|sign.up|create.account|get.start|register|upgrade)\b/i;

/* ── HTML audit ─────────────────────────────────────────────── */

function auditHTML(filePath) {
  const src  = fs.readFileSync(filePath, 'utf-8');
  const rel  = path.relative(ROOT, filePath);
  const lines = src.split('\n');
  let fileIssues = 0;

  lines.forEach((raw, i) => {
    const ln = i + 1;

    /* 1. href="#" — placeholder link */
    if (/href="#"/.test(raw)) {
      const isCTA = MAIN_CTA_WORDS.test(raw) || /btn-pri/.test(raw);
      issue(
        isCTA ? 'CRITICAL' : 'LATER',
        filePath, ln, 'PLACEHOLDER_HREF',
        `href="#" found${isCTA ? ' on primary CTA — dead button' : ''}`,
        isCTA ? 'Replace # with correct target route' : 'Replace or remove anchor'
      );
      fileIssues++;
    }

    /* 2. href="" — empty */
    if (/href=""/.test(raw)) {
      issue('IMPORTANT', filePath, ln, 'EMPTY_HREF',
        'Empty href="" attribute — will navigate to page root unexpectedly',
        'Add the correct URL or remove the href');
      fileIssues++;
    }

    /* 3. <a> with no href at all */
    const aNoHref = raw.match(/<a\s+(?![^>]*href)[^>]*>/g);
    if (aNoHref) {
      aNoHref.forEach(() => {
        issue('LATER', filePath, ln, 'ANCHOR_NO_HREF',
          '<a> tag with no href — behaves like a span, may confuse users',
          'Add href or convert to <button>');
        fileIssues++;
      });
    }

    /* 4. Local .html links — check existence */
    const hrefRe = /href="([^"]+\.html[^"]*)"/g;
    let m;
    while ((m = hrefRe.exec(raw)) !== null) {
      const href = m[1];
      if (KNOWN_EXTERNAL.test(href)) continue;

      /* Old route aliases */
      const base = href.replace(/^\//, '').split(/[?#]/)[0];
      if (OLD_ROUTES.includes(base)) {
        issue('CRITICAL', filePath, ln, 'OLD_ROUTE',
          `Links to deprecated route: ${href}`,
          `Replace with current route (e.g. members.html or membership.html)`);
        fileIssues++;
        continue;
      }

      /* Missing file — skip if href looks like a JS template fragment */
      const target = base;
      const looksLikeJSFragment = base.includes("'") || base.includes('"') || base.includes('+') || base.includes('$') || base.includes('opts.');
      if (target && !looksLikeJSFragment && !existingFiles.has(target)) {
        issue('CRITICAL', filePath, ln, 'MISSING_FILE',
          `Links to file that does not exist: ${href}`,
          'Create the file or correct the link');
        fileIssues++;
      }
    }

    /* 5. onclick without a function reference */
    const onclickRe = /onclick="([^"]+)"/g;
    while ((m = onclickRe.exec(raw)) !== null) {
      const handler = m[1].trim();
      /* Flag onclick="void 0" or onclick="" or onclick="return false" as suspicious */
      if (!handler || handler === 'void 0' || handler === 'return false;') {
        issue('LATER', filePath, ln, 'EMPTY_ONCLICK',
          `Suspicious onclick: "${handler}"`,
          'Replace with correct handler or remove');
        fileIssues++;
      }
    }

    /* 6. <button> without type — can accidentally submit a form */
    const btnRe = /<button(?![^>]*type=)[^>]*>/g;
    while ((m = btnRe.exec(raw)) !== null) {
      /* Only flag if it's inside or near a form */
      if (/<form/i.test(src.slice(Math.max(0, src.indexOf(m[0]) - 500), src.indexOf(m[0])))) {
        issue('LATER', filePath, ln, 'BUTTON_NO_TYPE',
          '<button> without type="button" inside/near a form — may unintentionally submit',
          'Add type="button" or type="submit" explicitly');
        fileIssues++;
      }
    }

    /* 7. Relative hrefs that should be absolute (no leading /) */
    const relHrefRe = /href="(?!\/)(?!http)(?!#)(?!mailto)(?!tel)([a-zA-Z][^"]+\.html)"/g;
    while ((m = relHrefRe.exec(raw)) !== null) {
      const href = m[1];
      issue('IMPORTANT', filePath, ln, 'RELATIVE_HREF',
        `Relative link "${href}" — breaks when navigating from sub-paths (e.g. /u/slug)`,
        `Change to "/${href}"`);
      fileIssues++;
    }

    /* 8. Common wrong routes */
    if (/href=".*signin\.html"/.test(raw) && /href=".*signout|logout/.test(raw)) {
      /* OK — both present */
    }
  });

  stats.files++;
  if (fileIssues === 0) stats.passed++;
  return fileIssues;
}

/* ── JS audit ───────────────────────────────────────────────── */

function auditJS(filePath) {
  /* Skip files that intentionally reference old routes as check targets */
  var skipFiles = ['health-monitor.js', 'link-audit.js', 'routes.js'];
  if (skipFiles.includes(path.basename(filePath))) return 0;

  const src   = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  let fileIssues = 0;

  lines.forEach((raw, i) => {
    const ln = i + 1;

    /* Bare relative HTML refs in JS strings */
    const jsHrefRe = /['"]([a-zA-Z][\w-]+\.html)(?:[?#][^'"]*)?['"]/g;
    let m;
    while ((m = jsHrefRe.exec(raw)) !== null) {
      const ref = m[1];
      if (ref === 'text/html') continue; // content-type string

      if (OLD_ROUTES.includes(ref)) {
        issue('CRITICAL', filePath, ln, 'OLD_ROUTE_JS',
          `JS references deprecated route "${ref}"`,
          'Update to current route');
        fileIssues++;
      }

      /* Missing file ref */
      if (!existingFiles.has(ref)) {
        /* Skip template strings that are clearly dynamic */
        if (!raw.includes('${') && !raw.includes('opts.') && !raw.includes('href||')) {
          issue('IMPORTANT', filePath, ln, 'MISSING_FILE_JS',
            `JS references non-existent file "${ref}"`,
            'Correct or remove the reference');
          fileIssues++;
        }
      }
    }

    /* location.href = relative path */
    const locRe = /location\.href\s*=\s*['"]([^/'"http][^'"]*\.html[^'"]*)['"]/g;
    while ((m = locRe.exec(raw)) !== null) {
      issue('IMPORTANT', filePath, ln, 'RELATIVE_LOCATION',
        `location.href set to relative path "${m[1]}" — breaks from sub-paths`,
        `Use absolute path "/${m[1]}"`);
      fileIssues++;
    }

    /* console.log left in production code */
    if (/console\.log\(/.test(raw) && !raw.trim().startsWith('//')) {
      issue('LATER', filePath, ln, 'CONSOLE_LOG',
        'console.log() left in production JS',
        'Remove or replace with a QA flag');
      fileIssues++;
    }
  });

  if (fileIssues === 0) stats.passed++;
  return fileIssues;
}

/* ── Route coverage check ───────────────────────────────────── */

function auditRouteCoverage() {
  const missing = [];
  for (const route of ROUTES.all) {
    if (route.file && !existingFiles.has(route.file)) {
      missing.push(route);
      issue('CRITICAL', path.join(ROOT, route.file), 0, 'ROUTE_FILE_MISSING',
        `Route "${route.name}" → file "${route.file}" does not exist`,
        'Create the file or remove from routes registry');
    }
  }
  return missing;
}

/* ── Protected route check ──────────────────────────────────── */

function auditProtectedRoutes() {
  /* Check that protected pages contain auth guard code */
  for (const route of ROUTES.allProtected) {
    if (!route.file) continue;
    const filePath = path.join(ROOT, route.file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf-8');

    /* Should have Pegasus.boot() or admin-auth.js */
    /* Recognized auth guards: Pegasus.boot(), admin-auth.js, pegasus-auth.js */
    const hasAuthGuard = src.includes('Pegasus.boot') || src.includes('admin-auth.js') || src.includes('pegasus-auth.js');
    if (!hasAuthGuard) {
      issue('CRITICAL', filePath, 0, 'MISSING_AUTH_GUARD',
        `Protected route "${route.name}" has no auth guard (Pegasus.boot or admin-auth.js)`,
        'Add Pegasus.boot() or the admin-auth.js script');
    }

    /* Admin pages should have admin-auth.js */
    if (route.requiresAdmin) {
      if (!src.includes('admin-auth.js')) {
        issue('CRITICAL', filePath, 0, 'MISSING_ADMIN_GUARD',
          `Admin page "${route.name}" does not load admin-auth.js`,
          'Add <script src="/js/admin-auth.js"></script>');
      }
    }
  }
}

/* ── Report writer ──────────────────────────────────────────── */

function writeReport() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const bySeverity = { CRITICAL: [], IMPORTANT: [], LATER: [] };
  for (const i of issues) (bySeverity[i.severity] || bySeverity.LATER).push(i);

  const sev = (s, items) => items.length
    ? `\n### ${s} (${items.length})\n\n` + items.map(i =>
        `| \`${i.file}\` | L${i.line} | ${i.type} | ${i.detail} | ${i.fix} |`
      ).join('\n')
    : `\n### ${s} — ✅ None\n`;

  const md = `# Pegasus QA Report
Generated: ${now}

## Summary

| Metric | Count |
|--------|-------|
| Files scanned | ${stats.files} |
| Files with no issues | ${stats.passed} |
| Total issues | ${stats.totalIssues} |
| 🔴 CRITICAL | ${stats.critical} |
| 🟠 IMPORTANT | ${stats.important} |
| 🟡 LATER | ${stats.later} |

---

## Issues by Severity

### Severity Key
- **CRITICAL** — Broken auth, broken forms, dead main CTAs, missing routes, exposed admin, JS crash
- **IMPORTANT** — Relative links, missing files in JS, broken redirects
- **LATER** — Console.logs, minor UX issues, cosmetic link problems

${sev('🔴 CRITICAL', bySeverity.CRITICAL)}

---
| File | Line | Type | Detail | Suggested Fix |
|------|------|------|--------|---------------|

${sev('🟠 IMPORTANT', bySeverity.IMPORTANT)}

---
| File | Line | Type | Detail | Suggested Fix |
|------|------|------|--------|---------------|

${sev('🟡 LATER', bySeverity.LATER)}

---
| File | Line | Type | Detail | Suggested Fix |
|------|------|------|--------|---------------|

---

## Route Registry Coverage

Total routes defined: ${ROUTES.all.length}
Public routes: ${ROUTES.allPublic.length}
Protected routes: ${ROUTES.allProtected.length}

## Next Steps
1. Fix all CRITICAL issues listed above
2. Re-run: \`npm run qa:links\`
3. Confirm zero CRITICAL issues
4. Run: \`npm run qa:runtime\` (requires Playwright + live URL)
`;

  fs.writeFileSync(REPORT, md);
  return md;
}

/* ── Main ───────────────────────────────────────────────────── */

console.log('═'.repeat(60));
console.log('  PEGASUS QA — Static Link & Code Audit');
console.log('═'.repeat(60));

console.log(`\n📂 Scanning ${htmlFiles.length} HTML files…`);
for (const f of htmlFiles) auditHTML(f);

console.log(`📜 Scanning ${jsFiles.length} JS files…`);
for (const f of jsFiles) auditJS(f);

console.log('🗺  Checking route coverage…');
auditRouteCoverage();

console.log('🔐 Checking auth guards on protected routes…');
auditProtectedRoutes();

console.log('\n' + '─'.repeat(60));
console.log(`Files scanned : ${stats.files}`);
console.log(`Issues found  : ${stats.totalIssues}`);
console.log(`  🔴 CRITICAL : ${stats.critical}`);
console.log(`  🟠 IMPORTANT: ${stats.important}`);
console.log(`  🟡 LATER    : ${stats.later}`);
console.log('─'.repeat(60));

writeReport();
console.log(`\n📋 Full report written to: qa-report.md`);

if (stats.critical > 0) {
  console.log(`\n🚨 ${stats.critical} CRITICAL issue(s) found — fix before deploy!\n`);
  process.exitCode = 1;
} else {
  console.log('\n✅ No CRITICAL issues — safe to deploy.\n');
}
