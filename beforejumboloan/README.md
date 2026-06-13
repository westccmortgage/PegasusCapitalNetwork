# Before Jumbo Loan — Multi-Market Strategy Studio

One reusable, market-config-driven engine for **BeforeJumboLoan.com** (and any market).
The active market is selected by route, so one engine serves every market.

## How it works
- `js/engine.js` holds a **`MARKETS` registry** + `BRAND_CONFIG` + `FORM_CONFIG` + the
  full calculation engine (review paths, payment/PITIA, DSCR, rate buydown, complexity,
  attention items, smart explanation, summary).
- The **active market** is resolved at page load from the **URL path slug** (`/key-west`,
  `/palm-beach`, …) or `?market=slug`, falling back to `DEFAULT_MARKET`.
- One page (`scenario-studio.html`) renders any market. Hero copy, market name, and the
  local disclaimer are injected from the active market config.

## Routes (configured in `netlify.toml`)
```
/key-west       /palm-beach     /miami-dade
/california     /orange-county  /los-angeles
```
Each is a 200 rewrite to `/scenario-studio.html`; the path stays visible so the engine
reads the slug. `index.html` is a market picker. `?market=slug` also works (handy locally).

Secondary domain: `beforejumboloans.com → beforejumboloan.com` (301; also add both
domains in Netlify domain settings).

## Configure before launch (`js/engine.js`)
**MARKETS** — per market: `marketSlug, marketName, countyName, state, loanLimitYear,
baselineConformingLimit, highBalanceLimit, fhaLimit, localDisclaimer, marketHeroCopy,
lastVerifiedDate`. **Verify every limit** (FHFA / Fannie Mae / HUD). For non-high-cost
counties, set `highBalanceLimit = baselineConformingLimit` (no separate high-balance band).

**BRAND_CONFIG** — `brandName, domain, logoText, primaryCTA, poweredByText,
complianceFooter, recipient`.

**FORM_CONFIG** — `formName` (must match the Netlify form + the hidden form in
`scenario-studio.html`), `leadSource`, `notificationEmail`. Set `recipient`/
`notificationEmail` to your real lead inbox.

**RATE_CONFIG** — rate assumptions (education only; update `lastUpdated`).

## Add a new market
```js
MARKETS["broward"] = {
  marketSlug:"broward", marketName:"Broward County", countyName:"Broward County", state:"FL",
  loanLimitYear:2026, baselineConformingLimit:832750, highBalanceLimit:832750, fhaLimit:null,
  localDisclaimer:"…", marketHeroCopy:"…", lastVerifiedDate:"VERIFY BEFORE LAUNCH"
};
```
Then add a `/broward → /scenario-studio.html` 200 rewrite in `netlify.toml`. Done.

## Netlify Forms
Hidden static form name = **`before-jumbo-strategy-studio`** (matches `FORM_CONFIG.formName`).
After deploy: enable form detection → redeploy → add an email notification to your inbox.
Submissions POST to `/` (url-encoded) and include: selected **market_name + market_slug**,
**domain**, **page_url**, configured limits/year, payment + DSCR + buydown assumptions,
suggested review paths, complexity, lead intent/tags, and contact — plus a clean
`scenario_summary` text block.

## Files
```
index.html            # market picker landing
scenario-studio.html  # the studio (renders any market)
js/engine.js          # MARKETS registry + BRAND/FORM config + engine
js/studio.js          # studio UI controller (reads active market)
js/site.js            # nav / cookie / hero quick-check behavior
css/studio.css        # design system + studio styles
netlify.toml          # market routes + secondary-domain redirect + cache headers
```

## Compliance
Review path / may fit / math illustration only. No rate quotes, APRs, payments-as-fact,
approvals, or eligibility promises. Required consent + “no credit check to start” on submit.
Verify loan limits and rate assumptions before public launch.

## Standalone
BeforeJumboLoan.com is a standalone project. This package is the portable multi-market
version of the Strategy Studio; any market can be added via the `MARKETS` registry and a
matching route. Key West / Monroe County is included only as a market/location.

## AI Strategy Explainer (Phase 2)

The result page includes an **AI Strategy Explainer** — an on-demand, plain-English
walkthrough of the scenario the buyer built (review path, before-jumbo math, DSCR /
buydown notes, attention items). It is **button-triggered**, not auto-run, so it never
calls the API on every keystroke.

- **Client:** `js/studio.js` builds a compact, **PII-free** context from
  `KW.strategySummary(S)` and POSTs it to the function. The contact fields
  (name/email/phone) are never sent.
- **Server:** `netlify/functions/explain-strategy.js` calls Claude
  (`@anthropic-ai/sdk`) with a compliance-aware system prompt — review-path framing,
  no rate/payment/APR guarantees, fair-lending safe — and returns the narration.
  The API key stays server-side.
- **Graceful fallback:** if the function is unavailable (no key, offline, error), the
  panel automatically shows the engine's built-in rule-based explanation
  (`KW.explain(S)`) and badges it "Offline summary". The result page is always useful.

### Environment variables (Netlify → Site settings → Environment)
```
ANTHROPIC_API_KEY   required — enables the live explainer
ANTHROPIC_MODEL     optional — defaults to claude-opus-4-8
                    (e.g. claude-haiku-4-5 / claude-sonnet-4-6 for lower cost/latency)
```
Without `ANTHROPIC_API_KEY` the function returns 503 and the UI falls back — safe to
deploy before the key is set.

## Run locally
```bash
# Static only (AI button falls back to the rule-based summary):
npm run serve            # http://localhost:8080  -> /scenario-studio.html?market=california

# Full stack incl. the AI function (needs the Netlify CLI + a key):
export ANTHROPIC_API_KEY=sk-ant-...
npx netlify-cli dev      # http://localhost:8888

# Tests:
npm run test:e2e         # Playwright: drives the wizard + AI explainer
node --test tests/function.test.mjs   # function guard/validation paths
```

## Deploy to Netlify
Deploy this folder (`beforejumboloan`) as its own Netlify site. `netlify.toml` already
sets `publish = "."`, `functions = "netlify/functions"`, the market routes, and the
secondary-domain redirect. Steps: connect the repo → base directory `beforejumboloan`
→ deploy → enable Netlify **form detection** and redeploy (for lead capture) → add
`ANTHROPIC_API_KEY` in the site environment to turn the AI explainer live.

## Files added for Phase 2
```
netlify/functions/explain-strategy.js   # Claude-backed explainer (key stays server-side)
package.json                            # @anthropic-ai/sdk dependency + dev scripts
tests/e2e.verify.cjs                    # wizard + explainer end-to-end (Playwright)
tests/function.test.mjs                 # function guard/validation tests
```
