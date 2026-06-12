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
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  let failures = 0;
  const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };
  const base = `http://localhost:${PORT}`;

  // Deterministic market via query param.
  await page.goto(`${base}/scenario-studio.html?market=california`, { waitUntil: 'networkidle' });

  // Market-aware copy applied from config.
  const marketName = await page.textContent('[data-market-name]');
  check(/California/i.test(marketName), `market config drives copy (${marketName.trim()})`);

  const opt = (field, value) => `.opt[data-field="${field}"][data-value="${value}"]`;
  const stepVisible = (n) => page.waitForSelector(`.st[data-step="${n}"]:not([hidden])`, { timeout: 4000 });

  // Walk the 9-step wizard.
  await page.click(opt('intent', 'Buy a primary home'));         // step 1 → auto-advance
  await stepVisible(2);
  await page.click(opt('property_location', 'Primary county / metro')); // 2 → auto
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

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime console/page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
