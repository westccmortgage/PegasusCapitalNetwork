/* End-to-end verification for the Before Jumbo Strategy Studio + AI Explainer.
 * Drives the real wizard in a headless browser, reaches the result page, and
 * checks the AI Strategy Explainer renders and falls back gracefully when no
 * backend/API key is present (static server has no functions). */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8085;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    fs.readFile(fp, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('404'); }
      res.setHeader('Content-Type', TYPES[path.extname(fp)] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((r) => srv.listen(PORT, () => r(srv)));
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const noise = (t) => /ERR_CERT_AUTHORITY_INVALID|Failed to load resource|favicon|fonts\.g/i.test(t);
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  let failures = 0;
  const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };
  const base = `http://localhost:${PORT}`;

  // Deterministic market via query param.
  await page.goto(`${base}/scenario-studio.html?market=key-west`, { waitUntil: 'networkidle' });

  // Market-aware copy applied from config.
  const marketName = await page.textContent('[data-market-name]');
  check(/Key West|Monroe/i.test(marketName), `market config drives copy (${marketName.trim()})`);

  // National loan-limit dataset loads asynchronously and populates the selector.
  await page.waitForFunction(() => {
    const s = document.querySelector('#st-state');
    return s && s.options.length > 5;
  }, { timeout: 6000 });

  // Route preset preselects FL / Monroe County and resolves the county limit.
  const presetState = await page.inputValue('#st-state');
  const presetCounty = await page.inputValue('#st-county');
  check(presetState === 'FL', `route preset preselects state FL (${presetState})`);
  check(/Monroe/i.test(presetCounty), `route preset preselects Monroe County (${presetCounty})`);
  const countyLimit0 = await page.textContent('[data-snap-countylimit]');
  check(/990,150/.test(countyLimit0), `county limit reference resolves to $990,150 (${countyLimit0.trim()})`);
  const limitNote = await page.textContent('[data-snap-limitnote]');
  check(/verify current FHFA\/Fannie\/Freddie\/HUD limits before launch/.test(limitNote), 'county limit carries the compliance line');
  const snapLoc = await page.textContent('[data-snap-location]');
  check(/Monroe County, FL/i.test(snapLoc), `dashboard shows property location (${snapLoc.trim()})`);

  const opt = (field, value) => `.opt[data-field="${field}"][data-value="${value}"]`;
  const stepVisible = (n) => page.waitForSelector(`.st[data-step="${n}"]:not([hidden])`, { timeout: 4000 });

  // Walk the 9-step wizard.
  await page.click(opt('intent', 'Buy a primary home'));         // step 1 → auto-advance
  await stepVisible(2);

  // Step 2 — property location selector. Unseeded state falls back to free text.
  await page.selectOption('#st-state', 'TX');
  await page.waitForSelector('#st-county-free:not([hidden])', { timeout: 3000 });
  check(await page.isVisible('#st-county-free'), 'unseeded state (TX) falls back to free-text county input');
  check(/isn’t imported yet/i.test(await page.textContent('[data-loc-note]')), 'free-text fallback shows import warning');

  // A county not in the dataset must be labeled — never silently treated as verified.
  await page.fill('#st-county-free', 'Travis County');
  await page.waitForFunction(
    () => /Needs official verification/i.test(document.querySelector('[data-snap-countylimit]')?.textContent || ''),
    { timeout: 3000 }
  );
  check(true, 'unseeded county labeled "Needs official verification"');
  check(/being finalized/i.test(await page.textContent('[data-snap-limitnote]')), 'sample dataset shows "database is being finalized" note');

  // Back to FL, pick a baseline county → limit updates to $832,750.
  await page.selectOption('#st-state', 'FL');
  await page.waitForFunction(() => {
    const c = document.querySelector('#st-county');
    return c && !c.disabled && c.options.length > 1;
  }, { timeout: 3000 });
  await page.selectOption('#st-county', 'Palm Beach County');
  await page.waitForFunction(() => /832,750/.test(document.querySelector('[data-snap-countylimit]')?.textContent || ''), { timeout: 3000 });
  check(true, 'selecting Palm Beach County resolves to $832,750 (1-unit)');

  // Units selector: 1 → 4 updates the county limit reference live.
  await page.selectOption('#st-units', '4');
  await page.waitForFunction(() => /1,601,750/.test(document.querySelector('[data-snap-countylimit]')?.textContent || ''), { timeout: 3000 });
  check(true, 'changing units 1 → 4 updates the county limit to $1,601,750');
  await page.selectOption('#st-units', '1'); // reset for the rest of the flow

  await page.click('[data-st-next]');                            // 2 (selector) → next
  await stepVisible(3);
  await page.click('[data-st-next]');                            // 3 (slider) → next
  await stepVisible(4);
  await page.click('[data-st-next]');                            // 4 (slider) → next
  await stepVisible(5);
  await page.click(opt('occupancy', 'Primary residence'));       // 5 → auto
  await stepVisible(6);
  await page.click(opt('property_type', 'Condo'));               // 6 → auto
  await stepVisible(7);
  await page.click(opt('income_situation', 'Self-employed'));    // 7 → auto
  await stepVisible(8);
  await page.click(opt('main_concern', 'I want to avoid jumbo if possible')); // 8 → auto
  await stepVisible(9);

  // Step 9: contact + review.
  await page.fill('[data-c="name"]', 'Test Buyer');
  await page.fill('[data-c="email"]', 'test@example.com');
  await page.fill('[data-c="phone"]', '(305) 555-0100');
  await page.click('[data-st-next]'); // validates + showResult()
  await page.waitForSelector('[data-result]:not([hidden])', { timeout: 4000 });

  // Result page populated by the engine.
  const paths = await page.textContent('[data-result-paths]');
  check(paths.trim().length > 0, `result shows suggested review path(s) (${paths.trim().slice(0, 40)})`);

  // AI Explainer present, with the on-demand prompt.
  const aiPresent = await page.isVisible('[data-ai-explain]');
  const aiPrompt = await page.textContent('[data-ai-body]');
  check(aiPresent, 'AI Explainer button present on result page');
  check(/plain-english walkthrough/i.test(aiPrompt), 'AI Explainer shows on-demand prompt');

  // Click → no backend on the static server → graceful rule-based fallback.
  await page.click('[data-ai-explain]');
  await page.waitForFunction(
    () => document.querySelector('[data-ai-badge]')?.textContent.trim() === 'Offline summary',
    { timeout: 6000 }
  );
  const fallbackParas = await page.$$eval('[data-ai-body] p', (ps) => ps.length);
  const fallbackText = await page.textContent('[data-ai-body]');
  check(fallbackParas >= 1, `fallback renders rule-based explanation (${fallbackParas} paragraphs)`);
  check(/estimated loan amount|review path/i.test(fallbackText), 'fallback text is the engine explanation');

  check(warnings.some((w) => /Sample loan-limit dataset installed/i.test(w)), 'developer console warns about the sample dataset');

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime console/page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
