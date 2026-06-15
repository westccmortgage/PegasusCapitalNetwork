/* Homepage + route verification (Netlify-drop parity).
 * Serves the project with minimal _redirects handling so /los-angeles and
 * /key-west resolve to the studio, exactly like a Netlify manual deploy. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8101;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

// Parse _redirects (200 rewrites only).
const REDIRECTS = {};
for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
  const m = line.trim().match(/^(\/\S+)\s+(\/\S+)\s+200\b/);
  if (m) REDIRECTS[m[1]] = m[2];
}

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (REDIRECTS[p]) p = REDIRECTS[p];               // route preset → studio
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
  let failures = 0;
  const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };
  const base = `http://localhost:${PORT}`;
  const noise = (t) => /ERR_CERT_AUTHORITY_INVALID|Failed to load resource|favicon|fonts\.g/i.test(t);

  // ---------- Homepage (desktop) ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 1.4 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  const h1 = (await page.textContent('.bjl-hero h1')).replace(/\s+/g, ' ').trim();
  check(/Before You Go Jumbo,/.test(h1) && /See What the Structure Says\./.test(h1), `hero headline (${h1})`);
  check(/Run the Numbers First/.test(await page.textContent('.bjl-hero__brandline')), 'supporting brand line present');
  check(/county limits.*down payment.*DSCR/i.test(await page.textContent('.bjl-hero__sub')), 'hero subheadline present');
  const ctas = await page.$$eval('.bjl-hero__cta a', (a) => a.map((x) => x.textContent.trim()));
  check(ctas.includes('Open Strategy Studio') && ctas.includes('Start With Property Location'), `hero CTAs (${ctas.join(', ')})`);

  const ticker = await page.textContent('.bjl-ticker__track');
  check(/Los Angeles County/.test(ticker) && /Maricopa County/.test(ticker), 'county ticker populated');
  check(/Official full loan-limit database must be imported/.test(await page.textContent('.bjl-ticker__note')), 'ticker shows safe coverage language');

  const compass = await page.textContent('.compass');
  check(/\$1,312,000/.test(compass) && /\$1,249,125/.test(compass) && /\$62,875 over/.test(compass), 'Loan Structure Compass shows the example + before-jumbo gap');
  check(await page.isVisible('.compass__line'), 'compass county-line marker rendered');

  const cards = await page.$$eval('.feature-card h3', (n) => n.map((x) => x.textContent.trim()));
  check(['County Limit Line', 'Payment Stack', 'DSCR / Investment Coverage', 'Buydown Break-Even'].every((t) => cards.includes(t)), `four studio-check cards (${cards.length})`);
  check((await page.$$('.move-list li')).length >= 5, 'small-changes list present');
  check((await page.$$('.loc-pill')).length === 6, 'six location preset pills');

  // Footer rendered from centralized compliance config.
  const footer = await page.textContent('.footer-legal');
  check(/West Coast Capital Mortgage Inc\., NMLS #2817729/.test(footer), 'footer: licensed-review entity + company NMLS');
  check(/Anatoliy Kanevsky, NMLS #2775380/.test(footer), 'footer: individual NMLS from config');
  check(/NMLS Consumer Access/.test(footer) && /Equal Housing Opportunity/.test(footer), 'footer: NMLS Consumer Access + EHO');
  check(/not a loan application, rate quote, APR disclosure, loan estimate/.test(footer), 'footer: conservative disclaimer');
  check(!/K West|Sun Coast|REPLACE_WITH/i.test(footer), 'footer: no K West / Sun Coast / placeholder email');

  await page.screenshot({ path: '/tmp/home-desktop.png', fullPage: true });

  // ---------- Homepage (mobile) ----------
  const m = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true });
  m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(`${base}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(200);
  check(await m.isVisible('.nav__toggle'), 'mobile: hamburger visible');
  check(await m.isVisible('.bjl-hero h1'), 'mobile: hero renders');
  await m.screenshot({ path: '/tmp/home-mobile.png', fullPage: true });

  // ---------- Route presets resolve to the studio ----------
  for (const [route, st, county] of [['/los-angeles', 'CA', 'Los Angeles'], ['/key-west', 'FL', 'Monroe']]) {
    const r = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
    await r.goto(`${base}${route}`, { waitUntil: 'networkidle' });
    await r.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
    const got = await r.inputValue('#st-state');
    const cty = await r.inputValue('#st-county').catch(() => '');
    check(got === st && new RegExp(county, 'i').test(cty), `route ${route} → ${st}/${county} (got ${got}/${cty})`);
    if (route === '/los-angeles') await r.screenshot({ path: '/tmp/route-la.png' });
    await r.close();
  }

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime console/page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL HOME CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
