#!/usr/bin/env node
/**
 * PEGASUS QA — Runtime Browser Audit
 * Requires: npx playwright install chromium
 * Usage:    QA_BASE_URL=https://pegasuscapitalnetwork.com node qa/runtime-audit.js
 *
 * Opens every public route in a real browser, captures:
 *   - Console errors / warnings
 *   - Page crash errors
 *   - Failed network requests (4xx, 5xx)
 *   - Bad redirects
 *   - JS null reference errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  console.error('❌ Playwright not installed. Run: npm install --save-dev @playwright/test && npx playwright install chromium');
  process.exit(1);
}

const ROUTES     = require('./routes');
const BASE_URL   = process.env.QA_BASE_URL || 'https://pegasuscapitalnetwork.com';
const TIMEOUT    = parseInt(process.env.QA_TIMEOUT || '15000');
const REPORT_OUT = path.join(__dirname, '..', 'qa-report-runtime.md');

const results = [];

async function auditRoute(page, route) {
  const url = BASE_URL + route.path;
  const errors = [];
  const warnings = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error')   errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.message}`));
  page.on('requestfailed', req => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', resp => {
    const status = resp.status();
    if (status >= 400) {
      failedRequests.push(`${status} ${resp.url()}`);
    }
  });

  let finalUrl = url;
  let httpStatus = 0;
  let loadError = null;
  let redirected = false;

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    httpStatus = resp?.status() || 0;
    finalUrl = page.url();
    redirected = finalUrl !== url && !finalUrl.includes(route.path);
    await page.waitForTimeout(1500); // let JS execute
  } catch (e) {
    loadError = e.message;
  }

  /* Evaluate page for specific red flags */
  let pageTitle = '';
  let has404Content = false;
  try {
    pageTitle = await page.title();
    has404Content = await page.evaluate(() =>
      document.body?.innerText?.includes('not found') ||
      document.body?.innerText?.includes('404') ||
      document.title?.includes('404')
    );
  } catch (_) {}

  const criticalErrors = errors.filter(e =>
    /null|undefined|cannot read|is not a function|unexpected token|syntaxerror/i.test(e)
  );

  const passed = !loadError
    && httpStatus < 400
    && criticalErrors.length === 0
    && !has404Content
    && !(route.requiresAuth && redirected && finalUrl.includes('signin'));

  const result = {
    name:      route.name,
    path:      route.path,
    url,
    passed,
    httpStatus,
    finalUrl,
    redirected,
    loadError,
    errors:    errors.slice(0, 10),
    warnings:  warnings.slice(0, 5),
    failedRequests: failedRequests.slice(0, 10),
    has404Content,
    pageTitle,
    requiresAuth: !!route.requiresAuth,
    criticalErrors,
  };

  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [${httpStatus}] ${route.name.padEnd(35)} ${route.path}`);
  if (criticalErrors.length) console.log(`       🚨 ${criticalErrors[0].slice(0, 100)}`);
  if (loadError) console.log(`       💥 ${loadError.slice(0, 100)}`);

  return result;
}

async function run() {
  console.log('═'.repeat(60));
  console.log('  PEGASUS QA — Runtime Browser Audit');
  console.log('═'.repeat(60));
  console.log(`  Base URL : ${BASE_URL}`);
  console.log(`  Timeout  : ${TIMEOUT}ms per page`);
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'PegasusQA/1.0 (+qa-bot)',
  });

  /* ── Public routes (no auth) ── */
  const publicRoutes = [...ROUTES.public, ...ROUTES.directories, ...ROUTES.auth, ...ROUTES.legal, ...ROUTES.rwa];

  console.log(`\n📡 Testing ${publicRoutes.length} public routes…\n`);
  for (const route of publicRoutes) {
    const page = await context.newPage();
    results.push(await auditRoute(page, route));
    await page.close();
  }

  /* ── Protected routes (expect redirect to signin if not logged in) ── */
  console.log(`\n🔐 Testing ${ROUTES.allProtected.length} protected routes (expect auth redirect)…\n`);
  for (const route of ROUTES.allProtected) {
    const page = await context.newPage();
    const r = await auditRoute(page, route);
    /* For protected routes, a redirect to signin is CORRECT — mark as passed */
    if (r.redirected && r.finalUrl.includes('signin')) {
      r.passed = true;
      r.note = 'Auth redirect working correctly';
    }
    results.push(r);
    await page.close();
  }

  await browser.close();

  /* ── Write report ── */
  const passed  = results.filter(r => r.passed);
  const failed  = results.filter(r => !r.passed);
  const now     = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const md = `# Pegasus QA — Runtime Audit Report
Generated: ${now}
Base URL: ${BASE_URL}

## Summary

| | Count |
|--|--|
| Total routes tested | ${results.length} |
| ✅ Passed | ${passed.length} |
| ❌ Failed | ${failed.length} |

---

## ❌ Failed Routes

${failed.length === 0 ? '✅ All routes passed!' : failed.map(r => `
### ${r.name}
- **Path**: \`${r.path}\`
- **Status**: ${r.httpStatus}
- **Final URL**: ${r.finalUrl}
- **Load error**: ${r.loadError || 'None'}
- **Console errors**: ${r.errors.join('; ') || 'None'}
- **Failed requests**: ${r.failedRequests.slice(0, 3).join(', ') || 'None'}
`).join('\n')}

---

## ✅ Passed Routes

${passed.map(r => `- [${r.httpStatus}] **${r.name}** \`${r.path}\`${r.note ? ' — ' + r.note : ''}`).join('\n')}
`;

  fs.writeFileSync(REPORT_OUT, md);
  console.log('\n' + '─'.repeat(60));
  console.log(`Passed: ${passed.length} / ${results.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Report: qa-report-runtime.md`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
