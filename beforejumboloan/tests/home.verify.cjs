/* Homepage cockpit verification — scenario classifier + trust rule (no default county) + routes. */
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
  const txt = (p, s) => p.textContent(s);

  const page = await browser.newPage({ viewport: { width: 1320, height: 1700 }, deviceScaleFactor: 1.3 });
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  // headline + intent
  const h1 = (await txt(page, '.cockpit h1')).replace(/\s+/g, ' ').trim();
  check(/The bank may call it jumbo\./.test(h1) && /The structure may tell a different story\./.test(h1), `cockpit headline (${h1})`);
  check(/What are you trying to structure/i.test(await txt(page, '.purpose__label')), 'scenario purpose: "What are you trying to structure?"');
  check((await page.$$('[data-purpose-opt]')).length === 6, 'six scenario purposes offered');
  check(await page.getAttribute('#hs-q', 'placeholder') === 'ZIP, city, county, or property location', 'command input asks where the property is');

  // page-load example is clearly labeled and visually separate
  await page.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  check(await page.isVisible('[data-example-banner]'), 'page-load example is clearly labeled as an example');
  check(/Example/.test(await txt(page, '[data-confirmed-county]')), 'confirmed chip labels the page-load county as an example');
  check(/\$62,875 above the selected county line/.test(await txt(page, '[data-hero]')), 'HERO result shows the dominant county-line gap');
  check(/\$1,249,125/.test(await txt(page, '[data-ho="limit"]')) && /high-cost/.test(await txt(page, '[data-ho="limit"]')), 'county limit + correct tier label (high-cost)');
  check(/Estimated P&I preview/.test(await txt(page, '[data-ho="rate"]')), 'payment label is "Estimated P&I preview"');
  // the page-load example must NOT pass a default county into the Studio
  const exHref = await page.getAttribute('[data-ho-continue]', 'href');
  check(/needs_property_location=true/.test(exHref) && !/[?&]state=/.test(exHref) && !/county_fips=/.test(exHref),
    'example Continue carries needs_property_location=true and NO default county');

  // ---- TRUST RULE: typing into search clears the example; no default calculation ----
  await page.fill('#hs-q', 'Nowhereville');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-needcty]:not([hidden])', { timeout: 3000 });
  check(!(await page.isVisible('[data-scenario]')), 'unresolved: scenario/output is NOT shown (no default-county calculation)');
  check(!(await page.isVisible('[data-example-banner]')), 'typing into the property search removes the example');
  check(/Property county required to calculate the county line/.test(await txt(page, '[data-needcty] .needcty__msg')), 'unresolved location asks for the property county before calculating');

  // ---- ZIP-first: single-county ZIP auto-detects AND calculates (Phase 2.1) ----
  await page.fill('#hs-q', '90210');
  await page.press('#hs-q', 'Enter');
  await page.waitForFunction(() => /Los Angeles County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(/Detected:/.test(await txt(page, '[data-confirmed-county]')) && /matched by zip/i.test(await txt(page, '[data-confirmed-county]')), 'ZIP 90210 auto-detects Los Angeles County (Detected · matched by zip)');
  check(await page.isVisible('[data-scenario]') && /\$1,249,125/.test(await txt(page, '[data-ho="limit"]')), 'single-county ZIP proceeds straight to the county-line calculation');
  check(await page.isVisible('[data-change]'), 'auto-detected ZIP still offers a Change affordance');

  // ---- ZIP crosses county lines → choices, no auto-select ----
  await page.fill('#hs-q', '10463');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-choices]:not([hidden])', { timeout: 3000 });
  check((await page.$$('[data-choices] .choice')).length >= 2, 'multi-county ZIP 10463 lists county choices (no silent guess)');

  // ---- ZIP not found → ask for city/state or county, no calculation ----
  await page.fill('#hs-q', '00000');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-needcty]:not([hidden])', { timeout: 3000 });
  check(/could not match this ZIP/i.test(await txt(page, '[data-needcty] .needcty__msg')), 'unknown ZIP is not defaulted to a county');

  // ---- confident city+state → confirm → calculate (official full data) ----
  await page.fill('#hs-q', 'Newport Beach CA');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  check(/Detected: Orange County, CA/.test(await txt(page, '[data-detected]')), 'resolver detects Newport Beach CA → Orange County (confirm step)');
  check(!(await page.isVisible('[data-scenario]')), 'still no calculation until the county is CONFIRMED');
  await page.click('[data-confirm]');
  await page.waitForFunction(() => /Orange County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(/\$1,249,125/.test(await txt(page, '[data-ho="limit"]')), 'after confirming Orange County, its official county line is used');

  // ---- ambiguous "Austin TX" (Austin County vs city of Austin → Travis) → choices ----
  await page.fill('#hs-q', 'Austin TX');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-choices]:not([hidden])', { timeout: 3000 });
  const austinChoices = await page.$$eval('[data-choices] .choice', (els) => els.map((e) => e.textContent));
  check(austinChoices.some((t) => /Austin County/.test(t)) && austinChoices.some((t) => /Travis County/.test(t)),
    'ambiguous "Austin TX" surfaces Austin County AND Travis County to confirm');
  // confirm Travis (the city of Austin) and verify a real official line is used
  await page.click('xpath=//*[@data-choices]//button[contains(., "Travis County")]');
  await page.waitForFunction(() => /Travis County, TX/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(/\$832,750/.test(await txt(page, '[data-ho="limit"]')) && /baseline/.test(await txt(page, '[data-ho="limit"]')), 'Travis County resolves to its official baseline county line');

  // ---- scenario classifier: cash-out refinance changes the input model ----
  await page.fill('#hs-q', 'Newport Beach CA');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  await page.click('[data-confirm]');
  await page.waitForFunction(() => /Orange County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  await page.click('[data-purpose-opt="cash_out"]');
  await page.waitForFunction(() => document.querySelector('[data-purpose-opt="cash_out"]')?.classList.contains('is-sel'), { timeout: 2000 });
  check(/Estimated property value/.test(await txt(page, '[data-value-label]')), 'cash-out refi relabels the value input to "Estimated property value"');
  check(await page.isVisible('#hs-payoff') && await page.isVisible('#hs-cashout'), 'cash-out refi reveals payoff + cash-out inputs');
  check(!(await page.isVisible('#hs-down')), 'cash-out refi hides the purchase down-payment input');
  check(!(await page.isVisible('[data-ho-ltv-row][hidden]')) && /%/.test(await txt(page, '[data-ho="ltv"]')), 'cash-out refi shows LTV');

  // ---- investment shows DSCR ----
  await page.click('[data-purpose-opt="investment"]');
  await page.waitForFunction(() => document.querySelector('[data-purpose-opt="investment"]')?.classList.contains('is-sel'), { timeout: 2000 });
  check(await page.isVisible('[data-ho-dscr-row]') && /×|rent/.test(await txt(page, '[data-ho="dscr"]')), 'investment / DSCR shows a DSCR preview');

  // ---- interest-only payment option (Phase 4) ----
  check(/\/mo/.test(await txt(page, '[data-ho="pi"]')) && /\/mo/.test(await txt(page, '[data-ho="io"]')), 'cockpit shows both P&I and interest-only previews');
  check(/lower than amortizing/i.test(await txt(page, '[data-ho="iodiff"]')), 'cockpit shows interest-only vs amortizing difference');
  await page.click('[data-paymode="io"]');
  await page.waitForFunction(() => /interest-only preview/i.test(document.querySelector('[data-ho="rate"]')?.textContent || ''), { timeout: 2000 });
  check(/selected/.test(await txt(page, '[data-ho="io"]')), 'selecting Interest Only marks it selected');
  check(/educational payment illustration only/i.test(await txt(page, '[data-ho-ionote]')), 'interest-only note shown');
  await page.click('[data-paymode="pi"]');

  // ---- buydown integrated INSIDE the console (Phase 5) ----
  check(/→/.test(await txt(page, '[data-ho-bd-pi]')) && /\/mo/.test(await txt(page, '[data-ho-bd-savings]')), 'console shows permanent buydown P&I before→after + monthly savings');
  check(/months/i.test(await txt(page, '[data-ho-bd-be]')), 'console shows permanent buydown break-even');
  check(/\$.* \/ .*\$/.test(await txt(page, '[data-ho-tb]')) && /\$/.test(await txt(page, '[data-ho-tb-sub]')), 'console shows temporary 2-1 buydown schedule + subsidy');
  check(/educational illustration only/i.test(await txt(page, '[data-ho-bdnote]')), 'buydown safe-language note shown');

  // ---- Potential Review Paths inside the console ----
  check((await page.$$('.pathmap--wide .pathmap__node')).length >= 9, 'Potential Review Paths shows the full program set (9+ paths)');
  const headings = await page.$$eval('.console__h', (els) => els.map((e) => e.textContent));
  check(headings.some((h) => /Potential Review Paths/i.test(h)), 'review paths labeled "Potential Review Paths"');
  check(/Review/.test(await txt(page, '[data-ho="path"]')), 'current review path is shown in the result');

  // ---- Conversion CTA: state-gated lender application (Phase 2/3) ----
  const ARIVE = 'https://2817729.my1003app.com/2775380/register';
  // CA (90210 → Los Angeles) → application CTA to ARIVE in a new tab + helper
  await page.fill('#hs-q', '90210');
  await page.press('#hs-q', 'Enter');
  await page.waitForFunction(() => /Los Angeles/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(await page.isVisible('[data-cta-app]'), 'CA: secure lender application CTA appears');
  check((await page.getAttribute('[data-cta-app]', 'href')) === ARIVE, 'CA: application CTA links to the ARIVE portal');
  check((await page.getAttribute('[data-cta-app]', 'target')) === '_blank', 'CA: application opens in a new tab');
  check(await page.isVisible('[data-cta-helper]') && /secure lender application portal powered by ARIVE/i.test(await txt(page, '[data-cta-helper]')), 'CA: application helper text shown');
  check(!(await page.isVisible('[data-cta-state]')), 'CA: no unsupported-state block');

  // FL (ZIP 33139 → Miami-Dade, auto-detect) → application CTA to ARIVE
  await page.fill('#hs-q', '33139');
  await page.press('#hs-q', 'Enter');
  await page.waitForFunction(() => /Miami-Dade County, FL/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(await page.isVisible('[data-cta-app]') && (await page.getAttribute('[data-cta-app]', 'href')) === ARIVE, 'FL: application CTA appears and links to ARIVE');

  // TX (Austin → Travis) → NO application; unsupported-state block + contact CTA
  await page.fill('#hs-q', 'Austin TX');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-resolve-choices]:not([hidden])', { timeout: 3000 });
  await page.click('xpath=//*[@data-choices]//button[contains(., "Travis County")]');
  await page.waitForFunction(() => /Travis County, TX/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  check(!(await page.isVisible('[data-cta-app]')), 'TX: no ARIVE application link for an unsupported state');
  check(await page.isVisible('[data-cta-state]') && /not available for this property state/i.test(await txt(page, '[data-cta-state]')), 'TX: unsupported-state message shown');
  check((await page.getAttribute('[data-cta-contact]', 'href')) === 'contact.html', 'TX: contact CTA links to contact.html (not ARIVE)');

  // Unresolved → no application link; prompt to confirm location
  await page.fill('#hs-q', 'Nowhereville');
  await page.press('#hs-q', 'Enter');
  await page.waitForSelector('[data-needcty]:not([hidden])', { timeout: 3000 });
  check(!(await page.isVisible('[data-cta-app]')) && !(await page.isVisible('[data-cta-state]')), 'unresolved: no application link');
  check(await page.isVisible('[data-cta-prompt]'), 'unresolved: prompt to confirm property location');

  // Header powered-by trust line
  check(/Powered by West Coast Capital Mortgage Inc\./.test(await txt(page, '.site-header .brand__powered')), 'header shows "Powered by West Coast Capital Mortgage Inc."');

  // footer compliance
  const footer = await txt(page, '.footer-legal');
  check(/West Coast Capital Mortgage Inc\., NMLS #2817729/.test(footer) && /Anatoliy Kanevsky, NMLS #2775380/.test(footer), 'footer: entity + individual NMLS from config');
  check(!/K West|Sun Coast|REPLACE_WITH/i.test(footer), 'footer: no K West / Sun Coast / placeholder email');
  check(await page.isVisible('.cookie-bar--mini'), 'cookie banner is low-profile mini variant');

  await page.screenshot({ path: '/tmp/home-desktop.png', fullPage: true });

  // ---- Continue link carries scenario_type + value + loan + ltv into the studio ----
  const cont = await browser.newPage();
  await cont.goto(`${base}/`, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => /\$1,312,000/.test(document.querySelector('[data-ho="loan"]')?.textContent || ''), { timeout: 6000 });
  // switch to cash-out, confirm a real county, then read the continue link
  await cont.fill('#hs-q', 'Newport Beach CA');
  await cont.press('#hs-q', 'Enter');
  await cont.waitForSelector('[data-resolve-confident]:not([hidden])', { timeout: 3000 });
  await cont.click('[data-confirm]');
  await cont.waitForFunction(() => /Orange County, CA/.test(document.querySelector('[data-confirmed-county]')?.textContent || ''), { timeout: 3000 });
  await cont.click('[data-purpose-opt="cash_out"]');
  await cont.waitForFunction(() => document.querySelector('[data-purpose-opt="cash_out"]')?.classList.contains('is-sel'), { timeout: 2000 });
  const href = await cont.getAttribute('[data-ho-continue]', 'href');
  check(/scenario_type=cash_out/.test(href) && /state=CA/.test(href) && /county_fips=06059/.test(href) &&
        /estimated_property_value=/.test(href) && /current_payoff=/.test(href) && /cash_out_requested=/.test(href) &&
        /estimated_loan_amount=/.test(href) && /ltv=/.test(href),
        `continue link carries scenario_type + property + financials (${href.slice(0, 110)}…)`);
  await cont.goto(base + '/' + href, { waitUntil: 'networkidle' });
  await cont.waitForFunction(() => { const s = document.querySelector('#st-state'); return s && s.options.length > 5; }, { timeout: 6000 });
  check((await cont.inputValue('#st-state')) === 'CA' && /Orange/.test(await cont.inputValue('#st-county')), 'studio prefilled from continue link (CA / Orange County)');
  // refi mode: the refinance input block is un-hidden (its step may not be active yet) and the Cash-out intent is preselected
  check((await cont.getAttribute('[data-mode-refi]', 'hidden')) === null, 'studio enters refinance mode from scenario_type=cash_out');
  check((await cont.getAttribute('.opt[data-field="intent"][data-value="Cash-out refinance"]', 'aria-pressed')) === 'true', 'studio preselects the Cash-out refinance intent');
  await cont.close();

  // ---- mobile ----
  const m = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true });
  m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(`${base}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(300);
  check(await m.isVisible('.scanner') && await m.isVisible('[data-purpose]') && await m.isVisible('#hs-q'), 'mobile: cockpit + purpose + command input render');
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
