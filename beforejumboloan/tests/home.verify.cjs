/* Homepage cockpit verification — live interactivity + routes (Netlify-drop parity). */
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

  const page = await browser.newPage({ viewport: { width: 1320, height: 1500 }, deviceScaleFactor: 1.3 });
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  // headline + intent
  const h1 = (await page.textContent('.cockpit h1')).replace(/\s+/g, ' ').trim();
  check(/The bank may call it jumbo\./.test(h1) && /The structure may tell a different story\./.test(h1), `cockpit headline (${h1})`);
  check(/run the loan amount against the county line, payment stack, rent coverage, and buydown math/i.test(await page.textContent('.cockpit__sub')), 'subheadline present');
  check(/Continue Into Full Strategy Studio/.test(await page.textContent('[data-ho-continue]')), 'CTA: Continue Into Full Strategy Studio');

  // scanner is interactive — wait for the live default compute (LA, $1.6M, 18%)
  await page.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  check(true, 'scanner computes estimated loan amount live ($1,312,000)');
  check(/\$1,249,125/.test(await page.textContent('[data-ho="limit"]')), 'county limit reference resolved ($1,249,125)');
  check(/\$62,875 above the county line/.test(await page.textContent('[data-ho="delta"]')), 'amount above county line computed');
  check(/\$62,875 down/.test(await page.textContent('[data-ho="gap"]')), 'before-jumbo gap = additional down needed');
  check(/\/mo/.test(await page.textContent('[data-ho="pi"]')), 'payment stack preview (P&I) shown');
  check(/about \$62,875 in down payment/i.test(await page.textContent('[data-ho="nextlever"]')), 'next best lever suggests the additional down');
  check(/Educational structure estimate only\. Not approval, qualification/.test(await page.textContent('[data-ho-note]')), 'safe wording in scanner note');

  // Loan Path Map marker = jumbo (loan over county line)
  check(await page.getAttribute('.pathmap__node[data-node="jumbo"]', 'data-current') === 'yes', 'loan path map marks Jumbo for the default scenario');

  // engine insight panel deterministic
  check((await page.$$('[data-ho-insights] li')).length >= 3, 'engine insight panel has deterministic insights');

  // interactivity: raise down payment to 40% → moves below the line
  await page.fill('#hs-down', '40');
  await page.waitForFunction(() => /below the county line/.test(document.querySelector('[data-ho="delta"]')?.textContent || ''), { timeout: 3000 });
  check(true, 'raising down payment moves the scenario below the county line (live)');

  // lever chip: Investment → DSCR node
  await page.click('[data-lever-action="invest"]');
  await page.waitForFunction(() => document.querySelector('.pathmap__node[data-node="dscr"]')?.getAttribute('data-current') === 'yes', { timeout: 3000 });
  check(true, 'Investment lever maps the review path to DSCR (live)');

  // footer from centralized compliance config
  const footer = await page.textContent('.footer-legal');
  check(/West Coast Capital Mortgage Inc\., NMLS #2817729/.test(footer) && /Anatoliy Kanevsky, NMLS #2775380/.test(footer), 'footer: entity + individual NMLS from config');
  check(/NMLS Consumer Access/.test(footer) && /Equal Housing Opportunity/.test(footer), 'footer: NMLS Consumer Access + EHO');
  check(!/K West|Sun Coast|REPLACE_WITH/i.test(footer), 'footer: no K West / Sun Coast / placeholder email');

  // compliance strip + dataset language
  check(/Official full loan-limit database must be imported before production nationwide launch/.test(await page.textContent('.compliance-strip')), 'compliance strip carries safe dataset language');

  // cookie banner is the low-profile mini variant
  check(await page.isVisible('.cookie-bar--mini'), 'cookie banner is low-profile mini variant');

  await page.screenshot({ path: '/tmp/home-desktop.png', fullPage: true });

  // ---- Continue link carries the scenario into the studio (fresh default page) ----
  const cont = await browser.newPage();
  await cont.goto(`${base}/`, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  const href = await cont.getAttribute('[data-ho-continue]', 'href');
  check(/market=los-angeles/.test(href) && /state=CA/.test(href) && /county=Los\+Angeles\+County/.test(href) && /price=1600000/.test(href), `continue link carries scenario (${href.slice(0, 80)}…)`);
  await cont.goto(base + '/' + href, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
  check((await cont.inputValue('#st-state')) === 'CA' && /Los Angeles/.test(await cont.inputValue('#st-county')), 'studio prefilled from continue link (CA / Los Angeles County)');
  await cont.close();

  // ---- mobile ----
  const m = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true });
  m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(`${base}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(300);
  check(await m.isVisible('.scanner'), 'mobile: scanner renders');
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
