const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const PORT = 8079;

function serve() {
  // tiny static server
  const http = require('http');
  const fs = require('fs');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    fs.readFile(fp, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('404'); }
      res.setHeader('Content-Type', types[path.extname(fp)] || 'application/octet-stream');
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
  // Ignore external-CDN resource failures (e.g. fonts.googleapis.com cert in the
  // sandbox) — we only care about real JS/app errors.
  const isExternalNoise = (t) => /ERR_CERT_AUTHORITY_INVALID|Failed to load resource/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !isExternalNoise(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const base = `http://localhost:${PORT}`;
  let failures = 0;
  const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };

  // ---- Landing ----
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  const pvTotal = await page.textContent('#pvTotal');
  const propsCount = await page.$$eval('#propsGrid .prop', (n) => n.length);
  const disclaimer = await page.textContent('#disclaimer');
  check(/\$\d/.test(pvTotal), `landing live preview renders a $ total (${pvTotal})`);
  check(propsCount === 4, `landing renders 4 value props (${propsCount})`);
  check(disclaimer && disclaimer.length > 30, 'landing disclaimer injected from config');

  // ---- Studio: default conforming ----
  await page.goto(`${base}/studio.html`, { waitUntil: 'networkidle' });
  const headline = await page.textContent('#headlinePayment');
  const tier = await page.textContent('#tierBadge');
  const stackRows = await page.$$eval('#paymentStack .stack-row', (n) => n.length);
  check(/\$\d/.test(headline), `studio headline payment renders (${headline})`);
  check(['Conforming', 'High-Balance Conforming', 'Jumbo'].includes(tier), `tier badge renders (${tier})`);
  check(stackRows >= 3, `payment stack rows render (${stackRows})`);

  // ---- Reactivity: bump down payment, payment should change ----
  await page.fill('#downPaymentPct', '40');
  await page.waitForTimeout(50);
  const headline2 = await page.textContent('#headlinePayment');
  check(headline2 !== headline, `payment reacts to input change (${headline} -> ${headline2})`);

  // ---- Make it jumbo: huge price, low down ----
  await page.fill('#homePrice', '2000000');
  await page.fill('#downPaymentPct', '10');
  await page.waitForTimeout(50);
  const tierJumbo = await page.textContent('#tierBadge');
  const gapMsg = await page.textContent('#jumboPanel .gap-msg');
  check(tierJumbo === 'Jumbo', `large loan classifies as Jumbo (${tierJumbo})`);
  check(/over the jumbo line/i.test(gapMsg), 'jumbo gap message explains the gap');

  // ---- DSCR tab ----
  await page.click('[data-product="dscr"]');
  await page.waitForTimeout(50);
  const dscrVisible = await page.isVisible('#grossMonthlyRent');
  const dscrMetric = await page.textContent('#dscrPanel .metric-num');
  check(dscrVisible, 'DSCR rent input becomes visible on DSCR tab');
  check(/\d\.\d\d/.test(dscrMetric), `DSCR ratio renders (${dscrMetric})`);

  // ---- Buydown tab ----
  await page.click('[data-product="buydown"]');
  await page.waitForTimeout(50);
  const pointsVisible = await page.isVisible('#points');
  const buydownCards = await page.$$eval('#buydownPanel .buydown-card', (n) => n.length);
  check(pointsVisible, 'buydown points input visible on Buydown tab');
  check(buydownCards === 2, `buydown shows permanent + temporary cards (${buydownCards})`);

  // ---- AI placeholder panel ----
  const aiBody = await page.textContent('#aiPanel .ai-body');
  check(/Phase 2/i.test(aiBody), 'AI explainer placeholder text present');

  // ---- Lead form validation (empty submit) ----
  await page.click('#leadForm button[type=submit]');
  await page.waitForTimeout(50);
  const leadStatus = await page.textContent('#leadStatus');
  check(/name|email/i.test(leadStatus), `lead form validates empty submit (${leadStatus})`);

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime console/page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
