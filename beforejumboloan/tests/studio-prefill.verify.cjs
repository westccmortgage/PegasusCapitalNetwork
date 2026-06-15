/* Studio prefill + market-leakage verification.
   Proves: generic Studio never shows Key West; homepage scenario carries into
   the Studio (county, value, loan, scenario type); unresolved opens at the
   location step; genuine /key-west route still shows Key West. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8104;
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
  const errors = [];

  // 1) GENERIC studio (no params) — must NOT leak Key West.
  let pg = await browser.newPage();
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await pg.goto(`${base}/scenario-studio.html`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(300);
  const genLabel = await pg.textContent('[data-market-name]');
  const genHero = await pg.textContent('[data-market-hero]');
  check(!/Key West|Monroe/i.test(genLabel) && !/Key West|Monroe/i.test(genHero), `generic studio shows no Key West (label="${genLabel.trim()}")`);
  check(/Before Jumbo Strategy Studio/.test(genLabel), 'generic studio label is "Before Jumbo Strategy Studio"');
  check(/Confirm property location to begin/i.test(genHero), 'generic studio asks to confirm property location');
  await pg.close();

  // 2) Homepage → confirm Newport Beach (Orange County) → Continue → Studio.
  const home = await browser.newPage();
  home.on('pageerror', (e) => errors.push('home pageerror: ' + e.message));
  await home.goto(`${base}/`, { waitUntil: 'networkidle' });
  await home.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  await home.fill('#hs-q', 'Newport Beach CA');
  await home.press('#hs-q', 'Enter');
  await home.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  await home.click('[data-confirm]');
  await home.waitForFunction(() => /Orange County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  const loanText = await home.textContent('[data-ho="loan"]');           // homepage estimated loan (default value 1.6M, 18% down)
  const limitText = await home.textContent('[data-ho="limit"]');         // homepage county line
  const href = await home.getAttribute('[data-ho-continue]', 'href');
  check(/scenario_type=purchase/.test(href) && /county=Orange\+County/.test(href) && /county_fips=06059/.test(href) && /payment_mode=/.test(href) && /estimated_loan_amount=/.test(href), 'continue link carries scenario_type + Orange County + payment fields');
  await home.close();

  // 3) Studio with those params — hero is Orange County, snapshot matches.
  const st = await browser.newPage();
  st.on('pageerror', (e) => errors.push('studio pageerror: ' + e.message));
  await st.goto(base + '/' + href, { waitUntil: 'networkidle' });
  await st.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
  const stLabel = await st.textContent('[data-market-name]');
  check(/Orange County, CA · Before Jumbo Strategy Studio/.test(stLabel), `studio header reflects the confirmed county (="${stLabel.trim()}")`);
  check(!/Key West|Monroe/i.test(await st.textContent('[data-market-hero]')), 'studio hero has no Key West leakage');
  check((await st.inputValue('#st-state')) === 'CA' && /Orange/.test(await st.inputValue('#st-county')), 'studio prefilled CA / Orange County');
  // snapshot county limit matches the homepage county line ($1,249,125)
  await st.waitForFunction(() => /1,249,125/.test(document.querySelector('[data-snap-countylimit]')?.textContent || ''), { timeout: 4000 });
  check(/1,249,125/.test(limitText) && /1,249,125/.test(await st.textContent('[data-snap-countylimit]')), 'studio county limit matches the homepage county line');
  check(/1,312,000/.test(loanText) && /1,312,000/.test(await st.textContent('[data-st-loan]')), 'studio estimated loan matches the homepage loan');
  // interest-only + buydown panel populated
  check(/\/mo/.test(await st.textContent('[data-pp-pi]')) && /\/mo/.test(await st.textContent('[data-pp-io]')), 'studio shows Estimated P&I + interest-only previews');
  check(/lower than amortizing/i.test(await st.textContent('[data-pp-iodiff]')), 'studio shows interest-only vs amortizing difference');
  check(/months/i.test(await st.textContent('[data-pp-bd-be]')), 'studio shows permanent buydown break-even');
  check(/\$/.test(await st.textContent('[data-pp-tb]')), 'studio shows temporary 2-1 buydown schedule');
  await st.close();

  // 4) Unresolved → Studio opens at the property-location step, no default county.
  const un = await browser.newPage();
  await un.goto(`${base}/scenario-studio.html?scenario_type=purchase&needs_property_location=true&property_location_status=unresolved&estimated_property_value=1600000`, { waitUntil: 'networkidle' });
  await un.waitForTimeout(400);
  check(await un.isVisible('.st[data-step="2"]'), 'unresolved: studio opens at the property-location step');
  check(/—|Select a county/i.test(await un.textContent('[data-snap-countylimit]')), 'unresolved: no default county line shown');
  check(!/Key West|Monroe/i.test(await un.textContent('[data-market-name]')), 'unresolved: no Key West leakage');
  await un.close();

  // 4b) Ambiguous ZIP → Studio opens at the location step, carries possible_matches, no default county.
  const amb = await browser.newPage();
  const pm = encodeURIComponent(JSON.stringify([{ state_abbr: 'NY', county_name: 'Bronx County', county_fips: '36005' }, { state_abbr: 'NY', county_name: 'New York County', county_fips: '36061' }]));
  await amb.goto(`${base}/scenario-studio.html?scenario_type=purchase&needs_property_location=true&property_location_status=ambiguous&possible_matches=${pm}&estimated_property_value=1600000`, { waitUntil: 'networkidle' });
  await amb.waitForTimeout(400);
  check(await amb.isVisible('.st[data-step="2"]'), 'ambiguous: studio opens at the property-location step');
  check(/—|Select a county/i.test(await amb.textContent('[data-snap-countylimit]')), 'ambiguous: no default county line shown');
  check(!/Key West|Monroe/i.test(await amb.textContent('[data-market-name]')), 'ambiguous: no Key West / default leakage');
  await amb.close();

  // 5) Genuine /key-west route still shows Key West (allowed).
  const kw = await browser.newPage();
  await kw.goto(`${base}/key-west`, { waitUntil: 'networkidle' });
  await kw.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
  check(/Key West|Monroe County/i.test(await kw.textContent('[data-market-name]')), 'genuine /key-west route still shows Key West (allowed)');
  await kw.close();

  console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
  check(errors.length === 0, 'no runtime page errors');

  await browser.close();
  srv.close();
  console.log(`\n${failures === 0 ? 'ALL STUDIO-PREFILL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
