#!/usr/bin/env node
/**
 * PEGASUS QA — Mobile & Responsive Audit
 * Tests key pages at mobile (375px), tablet (768px), desktop (1280px).
 * Checks: nav visibility, CTA buttons reachable, forms usable, no overflow.
 * Requires: @playwright/test
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { console.error('❌ Playwright not installed.'); process.exit(1); }

const BASE_URL   = process.env.QA_BASE_URL || 'https://pegasuscapitalnetwork.com';
const REPORT_OUT = path.join(__dirname, '..', 'qa-report-mobile.md');

const VIEWPORTS = [
  { name: 'Mobile (375px)',  width: 375,  height: 667  },
  { name: 'iPad (768px)',    width: 768,  height: 1024 },
  { name: 'Desktop (1280px)', width: 1280, height: 800  },
];

const TEST_PAGES = [
  { path: '/',                name: 'Homepage' },
  { path: '/members.html',   name: 'Members Directory' },
  { path: '/signup.html',    name: 'Signup' },
  { path: '/signin.html',    name: 'Signin' },
  { path: '/membership.html', name: 'Pricing' },
  { path: '/u/anatoliy-kanevsky', name: 'Public Profile' },
  { path: '/borrowers.html', name: 'Borrowers' },
];

const results = [];

async function auditViewport(page, url, viewport, pageName) {
  const issues = [];
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForTimeout(1500);

  /* Horizontal overflow — content wider than viewport */
  const hasHScroll = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 5);
  if (hasHScroll) issues.push('Horizontal scroll / overflow detected');

  /* Primary CTA visible and clickable */
  const cta = await page.$('.btn-pri, .btn-lg, [class*="btn-pri"]');
  if (cta) {
    const box = await cta.boundingBox();
    if (box && box.height < 28) issues.push(`Primary CTA too small: ${box.height}px (min 44px for touch)`);
    if (box && box.width < 44) issues.push(`Primary CTA too narrow: ${box.width}px`);
  }

  /* Navbar accessible */
  const nav = await page.$('nav, .pub-nav, .topbar, .shell');
  if (!nav) issues.push('No navigation element found');

  /* Mobile tabbar (on small screens) */
  if (viewport.width < 768) {
    const tabbar = await page.$('.mob-tabbar');
    if (!tabbar) issues.push('Mobile tabbar not found at narrow viewport');
  }

  /* Inputs large enough for touch */
  const inputs = await page.$$('input[type="text"], input[type="email"], input[type="password"]');
  for (const inp of inputs) {
    const box = await inp.boundingBox();
    if (box && box.height < 32) issues.push(`Input too short for touch: ${box.height}px`);
  }

  /* Text readable (no zero-opacity or super tiny text) */
  const tinyText = await page.evaluate(() => {
    const all = document.querySelectorAll('p, span, a, button, label');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      if (size > 0 && size < 9 && el.textContent.trim().length > 2) return el.textContent.slice(0, 40);
    }
    return null;
  });
  if (tinyText) issues.push(`Text below 9px found: "${tinyText}"`);

  const passed = issues.length === 0;
  results.push({
    page: pageName, viewport: viewport.name, passed, issues,
  });

  const icon = passed ? '✅' : '⚠️';
  console.log(`  ${icon} ${pageName} @ ${viewport.name}${issues.length ? ' — ' + issues[0] : ''}`);
}

async function run() {
  console.log('═'.repeat(60));
  console.log('  PEGASUS QA — Mobile & Responsive Audit');
  console.log('═'.repeat(60) + '\n');

  const browser = await chromium.launch({ headless: true });

  for (const viewport of VIEWPORTS) {
    console.log(`\n📱 ${viewport.name}\n`);
    const ctx = await browser.newContext({ viewport });
    for (const testPage of TEST_PAGES) {
      const page = await ctx.newPage();
      try {
        await auditViewport(page, BASE_URL + testPage.path, viewport, testPage.name);
      } catch (e) {
        results.push({ page: testPage.name, viewport: viewport.name, passed: false, issues: [e.message] });
        console.log(`  ❌ ${testPage.name} @ ${viewport.name} — ${e.message.slice(0, 80)}`);
      }
      await page.close();
    }
    await ctx.close();
  }

  await browser.close();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const md = `# Pegasus QA — Mobile Audit Report
Generated: ${now}

## Summary
| | |
|--|--|
| Total checks | ${results.length} |
| ✅ Passed | ${passed} |
| ⚠️ Issues | ${failed.length} |

${failed.length ? '## Issues Found\n\n' + failed.map(r =>
  `### ${r.page} @ ${r.viewport}\n${r.issues.map(i => `- ${i}`).join('\n')}`
).join('\n\n') : '## ✅ All responsive checks passed!'}
`;

  fs.writeFileSync(REPORT_OUT, md);
  console.log(`\nPassed: ${passed}/${results.length} | Report: qa-report-mobile.md`);
}

run().catch(err => { console.error(err); process.exit(1); });
