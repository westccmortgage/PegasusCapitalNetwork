/* Homepage property-intelligence cockpit verification — command flow + routes (Netlify-drop parity). */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8103;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const REDIRECTS = {};
for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
  const mm = line.trim().match(/^(\/\S+)\s+(\/\S+)\s+200\b/);
  if (mm) REDIRECTS[mm[1]] = mm[2];
}
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (REDIRECTS[p]) p = REDIRECTS[p];
    fs.readFile(path.join(ROOT, p), (err, data) => {
      if (err) { res.statusCode = 404; return res.end('404'); }
      res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((r) => srv.listen(PORT, () => r(srv)));
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  let failures = 0;
  const check = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) failures++; };
  const base = `http://localhost:${PORT}`;
  const noise = (t) => /ERR_CERT_AUTHORITY_INVALID|Failed to load resource|favicon|fonts\.g/i.test(t);
  const errors = [];

  const page = await browser.newPage({ viewport: { width: 1320, height: 1600 }, deviceScaleFactor: 1.3 });
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  // headline + intent
  const h1 = (await page.textContent('.cockpit h1')).replace(/\s+/g, ' ').trim();
  check(/The bank may call it jumbo\./.test(h1) && /The structure may tell a different story\./.test(h1), `cockpit headline (${h1})`);
  check(/Tell the engine where the property is/i.test(await page.textContent('.cockpit__sub')), 'subheadline: property-location framing');
  check(/Continue Into Full Strategy Studio/.test(await page.textContent('[data-ho-continue]')), 'CTA: Continue Into Full Strategy Studio');

  // command input present
  check(await page.getAttribute('#hs-q', 'placeholder') === 'ZIP, city, county, or property location', 'command input asks where the property is');
  check((await page.$$('[data-ex]')).length >= 5, 'example chips present');

  // default example computes live (LA, $1.6M, 18%) and is clearly labeled an example
  await page.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  check(true, 'default example computes estimated loan amount live ($1,312,000)');
  check(/Example/.test(await page.textContent('[data-confirmed-county]')), 'confirmed chip is labeled an example, not a guessed location');
  check(/\$1,249,125/.test(await page.textContent('[data-ho="limit"]')) && /high-cost/.test(await page.textContent('[data-ho="limit"]')), 'county limit resolved + tier label (high-cost)');
  check(/\$62,875 above the selected county line/.test(await page.textContent('[data-ho="delta"]')), 'amount above the selected county line computed');
  check(/Estimated P&I preview/.test(await page.textContent('[data-ho="rate"]')), 'payment label is "Estimated P&I preview" (not payment stack)');
  check(await page.isVisible('[data-meter]'), 'County Line Meter renders');

  // Loan Path Map marker = jumbo (loan over county line)
  check(await page.getAttribute('.pathmap__node[data-node="jumbo"]', 'data-current') === 'yes', 'loan path map marks Jumbo for the default scenario');
  check((await page.$$('[data-ho-insights] li')).length >= 3, '"Engine sees" panel has deterministic insights');
  check(/Property county confirmed/.test(await page.textContent('[data-ho-insights]')), 'engine insight leads with the confirmed property county');

  // ---- command resolve: city + state → confident → confirm (Newport Beach CA → Orange) ----
  await page.fill('#hs-q', 'Newport Beach CA');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  check(/Orange County, CA/.test(await page.textContent('[data-detected]')), 'resolver detects Newport Beach CA → Orange County (confirm step shown)');
  await page.click('[data-confirm]');
  await page.waitForFunction(() => /Orange County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(/\$1,249,125/.test(await page.textContent('[data-ho="limit"]')), 'after confirming Orange County, its county line is used');

  // ---- ZIP → confident (90210 → Los Angeles) ----
  await page.fill('#hs-q', '90210');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  check(/Los Angeles County, CA/.test(await page.textContent('[data-detected]')) && /matched by zip/i.test(await page.textContent('[data-detected]')), 'ZIP 90210 resolves to Los Angeles County (matched by zip)');

  // ---- ambiguous city → choices, requires confirmation ----
  await page.fill('#hs-q', 'Beverly Hills');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-choices]:not([hidden])', { timeout: 3000 });
  check((await page.$$('[data-choices] .choice')).length >= 2, 'ambiguous city "Beverly Hills" offers multiple counties to confirm');

  // ---- county not in dataset → honest "needs official county data" (no fabricated line) ----
  await page.fill('#hs-q', 'Austin TX');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  check(/Travis County, TX/.test(await page.textContent('[data-detected]')), 'Austin TX resolves to Travis County');
  await page.click('[data-confirm]');
  await page.waitForFunction(() => /Travis County, TX/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(/Needs official county data/i.test(await page.textContent('[data-ho="limit"]')), 'county outside the dataset is NOT given a fabricated line — flagged for official data');

  // ---- back to a real county, exercise interactivity ----
  await page.fill('#hs-q', '90210');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  await page.click('[data-confirm]');
  await page.waitForFunction(() => /Los Angeles County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });

  await page.fill('#hs-down', '40');
  await page.waitForFunction(() => /below the selected county line/.test(document.querySelector('[data-ho="delta"]')?.textContent || ''), { timeout: 3000 });
  check(true, 'raising down payment moves the scenario below the county line (live)');

  await page.click('[data-lever-action="invest"]');
  await page.waitForFunction(() => document.querySelector('.pathmap__node[data-node="dscr"]')?.getAttribute('data-current') === 'yes', { timeout: 3000 });
  check(true, 'Investment lever maps the review path to DSCR (live)');

  // footer from centralized compliance config
  const footer = await page.textContent('.footer-legal');
  check(/West Coast Capital Mortgage Inc\., NMLS #2817729/.test(footer) && /Anatoliy Kanevsky, NMLS #2775380/.test(footer), 'footer: entity + individual NMLS from config');
  check(/NMLS Consumer Access/.test(footer) && /Equal Housing Opportunity/.test(footer), 'footer: NMLS Consumer Access + EHO');
  check(!/K West|Sun Coast|REPLACE_WITH/i.test(footer), 'footer: no K West / Sun Coast / placeholder email');
  check(await page.isVisible('.cookie-bar--mini'), 'cookie banner is low-profile mini variant');

  await page.screenshot({ path: '/tmp/home-desktop.png', fullPage: true });

  // ---- Continue link carries the property + scenario into the studio (fresh default page) ----
  const cont = await browser.newPage();
  await cont.goto(`${base}/`, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  const href = await cont.getAttribute('[data-ho-continue]', 'href');
  check(/state=CA/.test(href) && /county=Los\+Angeles\+County/.test(href) && /county_fips=06037/.test(href) && /price=1600000/.test(href), `continue link carries property + scenario (${href.slice(0, 90)}…)`);
  await cont.goto(base + '/' + href, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
  check((await cont.inputValue('#st-state')) === 'CA' && /Los Angeles/.test(await cont.inputValue('#st-county')), 'studio prefilled from continue link (CA / Los Angeles County)');
  await cont.close();

  // ---- mobile ----
  const m = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true });
  m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(`${base}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(300);
  check(await m.isVisible('.scanner'), 'mobile: cockpit renders');
  check(await m.isVisible('#hs-q'), 'mobile: command input visible');
  check(await m.isVisible('.nav__toggle'), 'mobile: hamburger visible');
  await m.screenshot({ path: '/tmp/home-mobile.png', fullPage: true });

  // ---- route presets still resolve to studio ----
  for (const [route, st, county] of [['/los-angeles', 'CA', 'Los Angeles'], ['/key-west', 'FL', 'Monroe']]) {
    const r = await browser.newPage();
    await r.goto(`${base}${route}`, { waitUntil: 'networkidle' });
    await r.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
    check((await r.inputValue('#st-state')) === st && new RegExp(county, 'i').test(await r.inputValue('#st-county')), `route ${route} → ${st}/${county}`);
    await r.close();
  }

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime console/page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL HOME CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
