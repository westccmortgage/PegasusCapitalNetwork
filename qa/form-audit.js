#!/usr/bin/env node
/**
 * PEGASUS QA — Form Audit
 * Tests: signup, signin, profile save, upload button trigger, contact forms.
 * Requires: @playwright/test + npx playwright install chromium
 * Usage:    QA_BASE_URL=https://pegasuscapitalnetwork.com node qa/form-audit.js
 *
 * Uses TEST credentials — set via env vars:
 *   QA_TEST_EMAIL=qa@pegasuslendersgroup.com
 *   QA_TEST_PASSWORD=testpassword123
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { console.error('❌ Playwright not installed.'); process.exit(1); }

const BASE_URL  = process.env.QA_BASE_URL     || 'https://pegasuscapitalnetwork.com';
const EMAIL     = process.env.QA_TEST_EMAIL    || '';
const PASSWORD  = process.env.QA_TEST_PASSWORD || '';
const REPORT_OUT = path.join(__dirname, '..', 'qa-report-forms.md');

const results = [];

function result(name, passed, detail, severity = 'CRITICAL') {
  results.push({ name, passed, detail, severity });
  console.log(`  ${passed ? '✅' : '❌'} ${name}`);
  if (!passed) console.log(`       ${detail}`);
}

async function run() {
  console.log('═'.repeat(60));
  console.log('  PEGASUS QA — Form Audit');
  console.log('═'.repeat(60) + '\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  /* ── 1. Signup form ── */
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/signup.html', { waitUntil: 'domcontentloaded' });
    const emailInput = await page.$('#em, input[type="email"], input[name="email"]');
    const passInput  = await page.$('#pw, input[type="password"]');
    const submitBtn  = await page.$('#go, button[onclick*="doSignup"]');
    result('Signup — email input exists',  !!emailInput,  'No email input found');
    result('Signup — password input exists', !!passInput, 'No password input found');
    result('Signup — submit button exists', !!submitBtn,  'No submit button found');
    if (emailInput && passInput && submitBtn) {
      await emailInput.fill('qa-test@example.com');
      await passInput.fill('TestPass123!');
      /* Don't actually submit — check button is clickable */
      const isEnabled = await submitBtn.isEnabled();
      result('Signup — button is enabled',  isEnabled,    'Submit button is disabled');
    }
    await page.close();
  } catch (e) { result('Signup — page load', false, e.message); }

  /* ── 2. Signin form ── */
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/signin.html', { waitUntil: 'domcontentloaded' });
    const emailInput = await page.$('input[type="email"], #em');
    const passInput  = await page.$('input[type="password"], #pw');
    const submitBtn  = await page.$('button[onclick*="doSignin"], #go');
    result('Signin — email input exists',    !!emailInput,  'No email input');
    result('Signin — password input exists', !!passInput,   'No password input');
    result('Signin — submit button exists',  !!submitBtn,   'No submit button');
    await page.close();
  } catch (e) { result('Signin — page load', false, e.message); }

  /* ── 3. Upload buttons (profile-edit) — require checking after login ── */
  if (EMAIL && PASSWORD) {
    try {
      /* Sign in */
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/signin.html', { waitUntil: 'domcontentloaded' });
      await page.fill('input[type="email"]', EMAIL);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[onclick*="doSignin"], #go');
      await page.waitForTimeout(3000);

      /* Navigate to profile edit */
      await page.goto(BASE_URL + '/profile-edit.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      /* Check upload buttons exist */
      const uploadPhotoBtn  = await page.$('button:has-text("Upload Photo"), [onclick*="ep-av-file"]');
      const uploadBannerBtn = await page.$('button:has-text("Upload Banner"), [onclick*="ep-bn-file"]');
      const avFileInput     = await page.$('#ep-av-file');
      const bnFileInput     = await page.$('#ep-bn-file');
      const saveBtn         = await page.$('#ep-save-btn, button:has-text("Save Profile")');

      result('Profile Edit — Upload Photo button', !!uploadPhotoBtn, 'Upload Photo button not found');
      result('Profile Edit — Upload Banner button', !!uploadBannerBtn, 'Upload Banner button not found');
      result('Profile Edit — Avatar file input exists', !!avFileInput, '#ep-av-file input not in DOM');
      result('Profile Edit — Banner file input exists', !!bnFileInput, '#ep-bn-file input not in DOM');
      result('Profile Edit — Save button', !!saveBtn, 'Save Profile button not found');

      /* Try saving the profile */
      if (saveBtn) {
        const nameInput = await page.$('#f_name');
        if (nameInput) {
          await nameInput.fill('QA Test User');
          await saveBtn.click();
          await page.waitForTimeout(2000);
          const successToast = await page.$('.toast, .peg-toast, [class*="toast"]');
          result('Profile Save — save completes', !!successToast, 'No success toast after save — may have errored', 'IMPORTANT');
        }
      }

      await page.close();
    } catch (e) { result('Profile Edit — authenticated flow', false, e.message); }
  } else {
    result('Profile Edit — authenticated tests', false, 'Set QA_TEST_EMAIL and QA_TEST_PASSWORD env vars to run authenticated form tests', 'IMPORTANT');
  }

  /* ── 4. Membership page — billing buttons ── */
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/membership.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const upgradeBtn = await page.$('button:has-text("Upgrade"), [onclick*="checkout"]');
    result('Membership — Upgrade button present', !!upgradeBtn, 'No Upgrade button found on membership page', 'IMPORTANT');
    await page.close();
  } catch (e) { result('Membership page', false, e.message); }

  /* ── 5. Forgot password form ── */
  try {
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/forgot-password.html', { waitUntil: 'domcontentloaded' });
    const emailInput = await page.$('input[type="email"]');
    const submitBtn  = await page.$('button[type="submit"], button[onclick*="reset"], button[onclick*="forgot"]');
    result('Forgot Password — email input', !!emailInput, 'No email input on forgot password page');
    result('Forgot Password — submit button', !!submitBtn, 'No submit button on forgot password page', 'IMPORTANT');
    await page.close();
  } catch (e) { result('Forgot Password', false, e.message); }

  await browser.close();

  /* Report */
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const md = `# Pegasus QA — Form Audit Report
Generated: ${now}

## Summary
| | |
|--|--|
| Total tests | ${results.length} |
| ✅ Passed | ${passed} |
| ❌ Failed | ${failed.length} |

${failed.length ? '## ❌ Failed\n\n' + failed.map(r => `- **[${r.severity}]** ${r.name}: ${r.detail}`).join('\n') : '## ✅ All form tests passed!'}

## All Results
${results.map(r => `- ${r.passed ? '✅' : '❌'} **${r.name}** (${r.severity})`).join('\n')}

## Notes
- To run authenticated form tests: \`QA_TEST_EMAIL=... QA_TEST_PASSWORD=... node qa/form-audit.js\`
`;

  fs.writeFileSync(REPORT_OUT, md);
  console.log(`\nPassed: ${passed}/${results.length} | Report: qa-report-forms.md`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
