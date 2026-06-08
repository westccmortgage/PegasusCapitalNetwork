#!/usr/bin/env node
/**
 * PEGASUS QA — Auth & Route Protection Audit
 * Tests: logged-out access, logged-in access, admin guard, logout redirect.
 * Requires: @playwright/test
 * Usage:    QA_BASE_URL=https://pegasuscapitalnetwork.com node qa/auth-audit.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { console.error('❌ Playwright not installed.'); process.exit(1); }

const ROUTES    = require('./routes');
const BASE_URL  = process.env.QA_BASE_URL     || 'https://pegasuscapitalnetwork.com';
const EMAIL     = process.env.QA_TEST_EMAIL    || '';
const PASSWORD  = process.env.QA_TEST_PASSWORD || '';
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || '';
const REPORT_OUT = path.join(__dirname, '..', 'qa-report-auth.md');

const results = [];

function result(name, passed, detail, severity = 'CRITICAL') {
  results.push({ name, passed, detail, severity });
  console.log(`  ${passed ? '✅' : '❌'} ${name}${!passed ? '\n       ' + detail : ''}`);
}

async function run() {
  console.log('═'.repeat(60));
  console.log('  PEGASUS QA — Auth & Route Protection Audit');
  console.log('═'.repeat(60) + '\n');

  const browser = await chromium.launch({ headless: true });

  /* ── 1. Logged-out: protected routes should redirect to signin ── */
  console.log('🔓 Testing logged-out access to protected routes…\n');
  const anonCtx = await browser.newContext();

  for (const route of ROUTES.allProtected) {
    if (!route.requiresAuth) continue;
    try {
      const page = await anonCtx.newPage();
      await page.goto(BASE_URL + route.path, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1500);
      const url = page.url();
      const isRedirected = url.includes('/signin') || url.includes('/signup');
      result(
        `${route.name} — logged-out redirect`,
        isRedirected,
        `Expected signin redirect, got: ${url}`,
      );
      await page.close();
    } catch (e) {
      result(`${route.name} — logged-out redirect`, false, e.message);
    }
  }

  /* ── 2. Admin page NOT accessible to regular user ── */
  if (EMAIL && PASSWORD) {
    console.log('\n🔒 Testing admin page with non-admin credentials…\n');
    const userCtx = await browser.newContext();
    const loginPage = await userCtx.newPage();
    await loginPage.goto(BASE_URL + '/signin.html', { waitUntil: 'domcontentloaded' });
    try {
      await loginPage.fill('input[type="email"]', EMAIL);
      await loginPage.fill('input[type="password"]', PASSWORD);
      await loginPage.click('button[onclick*="doSignin"], #go');
      await loginPage.waitForTimeout(3000);
      await loginPage.close();

      const adminPage = await userCtx.newPage();
      await adminPage.goto(BASE_URL + '/admin.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await adminPage.waitForTimeout(2000);
      const url = adminPage.url();
      const blocked = url.includes('/dashboard') || url.includes('/signin');
      result('Admin page — non-admin user blocked', blocked, `Admin accessible to non-admin: ${url}`);
      await adminPage.close();
    } catch (e) {
      result('Admin access test', false, e.message);
    }
  }

  /* ── 3. Public routes accessible without login ── */
  console.log('\n🌐 Verifying public routes work without auth…\n');
  const pubCtx = await browser.newContext();
  const publicCheck = [
    { path: '/', name: 'Homepage' },
    { path: '/members.html', name: 'Members Directory' },
    { path: '/u/anatoliy-kanevsky', name: 'Public Profile' },
    { path: '/signup.html', name: 'Signup' },
    { path: '/signin.html', name: 'Signin' },
    { path: '/membership.html', name: 'Pricing / Membership' },
  ];
  for (const route of publicCheck) {
    try {
      const page = await pubCtx.newPage();
      const resp = await page.goto(BASE_URL + route.path, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1000);
      const url = page.url();
      const ok = resp?.status() < 400 && !url.includes('/signin');
      result(`${route.name} — public access`, ok, `Status ${resp?.status()}, URL: ${url}`, 'CRITICAL');
      await page.close();
    } catch (e) {
      result(`${route.name} — public access`, false, e.message);
    }
  }

  /* ── 4. Profile slug routing ── */
  console.log('\n🔗 Testing profile slug routing…\n');
  const slugCtx = await browser.newContext();
  const slugPage = await slugCtx.newPage();
  await slugPage.goto(BASE_URL + '/u/anatoliy-kanevsky', { waitUntil: 'domcontentloaded' });
  await slugPage.waitForTimeout(2000);
  const slugContent = await slugPage.evaluate(() => document.body?.innerText?.slice(0, 200));
  const slugOk = slugContent && !slugContent.includes('Profile not available') && !slugContent.includes('404');
  result('Profile slug /u/anatoliy-kanevsky resolves', slugOk,
    `Profile shows "not available" or error. Content: ${slugContent?.slice(0,100)}`);
  await slugPage.close();

  await browser.close();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const md = `# Pegasus QA — Auth Audit Report
Generated: ${now}

## Summary
| | |
|--|--|
| Total tests | ${results.length} |
| ✅ Passed | ${passed} |
| ❌ Failed | ${failed.length} |

${failed.length ? '## ❌ Failed\n\n' + failed.map(r => `- **[${r.severity}]** ${r.name}: ${r.detail}`).join('\n') : '## ✅ All auth tests passed!'}
`;

  fs.writeFileSync(REPORT_OUT, md);
  console.log(`\nPassed: ${passed}/${results.length} | Report: qa-report-auth.md`);
  if (failed.some(r => r.severity === 'CRITICAL')) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
