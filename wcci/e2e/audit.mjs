// Lab performance + accessibility audit (headless Chromium over a local static
// server). These are LAB numbers, not field data — INP and real-network timing
// require field measurement (documented as such). Prints a short report.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHROMIUM = process.env.WCCI_CHROMIUM || '/opt/pw-browsers/chromium';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
if (!existsSync(DIST)) { console.error('Run `npm run build` first.'); process.exit(1); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  try { res.writeHead(200, { 'Content-Type': MIME[extname(join(DIST, p))] || 'application/octet-stream' }); res.end(readFileSync(join(DIST, p))); }
  catch { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(readFileSync(join(DIST, 'index.html'))); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { const es = l.getEntries(); window.__lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
});
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
  const js = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'));
  const jsBytes = js.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    fcp: Math.round(fcp || 0),
    lcp: Math.round(window.__lcp || 0),
    cls: Math.round((window.__cls || 0) * 1000) / 1000,
    jsRequests: js.length,
    jsTransferredKB: Math.round(jsBytes / 102.4) / 10,
  };
});

// Accessibility sanity: interactive elements need an accessible name; document lang.
const a11y = await page.evaluate(() => {
  const named = (el) => !!(el.getAttribute('aria-label') || (el.textContent || '').trim() || el.getAttribute('title') || el.getAttribute('alt'));
  const btns = [...document.querySelectorAll('button')];
  const links = [...document.querySelectorAll('a')];
  const inputs = [...document.querySelectorAll('input,textarea')];
  return {
    lang: document.documentElement.lang,
    buttonsUnnamed: btns.filter((b) => !named(b)).length,
    linksUnnamed: links.filter((a) => !a.getAttribute('href') ? false : !named(a) && !a.getAttribute('aria-label')).length,
    inputsUnlabeled: inputs.filter((i) => !i.getAttribute('aria-label') && !i.getAttribute('placeholder') && !i.labels?.length).length,
    smallTargets: [...document.querySelectorAll('button,a[href]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length,
  };
});

await browser.close(); server.close();

console.log('── WCCI lab audit (headless Chromium, 390×844, LAB not field) ──');
console.log('Performance:', JSON.stringify(perf, null, 2));
console.log('Accessibility:', JSON.stringify(a11y, null, 2));
console.log('\nNote: LCP/CLS/FCP are lab values in a fast local environment; INP and');
console.log('real-network LCP require field measurement (e.g. Lighthouse/CrUX).');
