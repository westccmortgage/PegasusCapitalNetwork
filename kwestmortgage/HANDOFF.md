# K West Mortgage — Handoff & Maintenance Guide

**Live domain:** https://kwestmortgages.com
**Powered by:** Sun Coast Capital Mortgage / West Coast Capital Mortgage Inc. — NMLS #2817729 · CA DRE #01385024
**Recipient email for all forms:** info@kwestmortgages.com · **Phone:** (561) 956-8866
**Market:** Key West / Monroe County + all of Florida
**Stack:** Static HTML + CSS + vanilla JS. No build step, no backend, no framework. Deploys to Netlify by drag-and-drop.

> This site is intentionally **static and self-contained**. There is no server, no database, and no AI/LLM integration. Everything runs in the browser. Forms are handled by Netlify Forms.

---

## 1. How to deploy

1. Open the site folder (this `kwestmortgage/` directory).
2. Netlify → your site → **Deploys** → drag the **contents of this folder** (or a zip of them) onto the deploy drop zone.
3. Netlify reads `netlify.toml` automatically (clean URLs + cache headers) and registers the two forms.
4. Point the domain **kwestmortgages.com** at the site under Domain settings (if not already).

**Do NOT** deploy the parent repo root — deploy this `kwestmortgage/` folder only. It is a standalone site, separate from any other package in the repo.

---

## 2. File map

```
kwestmortgage/
├── index.html                     Homepage — hero + embedded Strategy Studio console
├── concierge.html                 Concierge — opens straight on the console
├── scenario-studio.html           /scenario-studio — full-page Strategy Studio console
├── jumbo-vs-conforming.html       Conforming vs jumbo explainer
├── loan-options.html              All loan programs grid
├── rates.html                     Rates & payments (educational)
├── education.html                 Education hub (links the articles below)
├── about.html  contact.html  disclosures.html  privacy.html  terms.html  thank-you.html
│
│   Program landing pages (each has FAQ JSON-LD + a lead form):
├── high-balance-conforming.html  conventional-loans.html  jumbo-loans.html
├── va-loans.html  fha-loans.html  dscr-loans.html  bank-statement-loans.html
├── self-employed-mortgage.html  non-qm-loans.html  second-home-financing.html
├── condo-financing.html  refinance-cash-out.html  get-preapproved.html  human-review.html
│
│   Education articles:
├── no-credit-check.html  which-program-fits.html  complex-scenarios.html
│
├── css/
│   ├── kwest.css                  Main design system (colors, fonts, layout, components)
│   └── studio-console.css         Strategy Studio console-specific styles
│
├── js/
│   ├── kwest.js                   Site behavior: nav, mobile menu, cookie bar, Netlify form AJAX, hero quick-check
│   ├── engine.js                  ★ THE ENGINE — loan-path logic + all mortgage math (window.KW)
│   ├── loan-limits.js             County loan-limit resolver (reads the JSON in data/)
│   ├── rate-config.js             ★ Rate assumptions + score/PMI/doc-type tables (window.BJLRates)
│   ├── studio-app.js              Strategy Studio console controller (drives the UI)
│   └── studio-compliance.js       KWest shim (routes console CTA to the on-page form)
│
├── data/                          County loan-limit + geo data (Florida-only, ~79 KB)
│   ├── loan-limits/2026/fhfa-conforming.json   FHFA 2026 conforming limits, 67 FL counties
│   ├── loan-limits/2026/fha-forward.json       HUD FHA 2026 limits, 67 FL counties
│   ├── geo/us-counties.json                    State list + FL counties
│   ├── geo/us-zips.json                         FL ZIP → county crosswalk
│   ├── geo/us-places.json                       FL cities → county
│   └── geo/aliases.json                         "key west", "the keys", etc. → Monroe
│
├── assets/                        favicon, OG image, hero videos (hero-desktop.mp4 / hero-mobile.mp4)
├── netlify.toml                   Clean URLs (200 redirects) + cache headers
├── sitemap.xml  robots.txt        SEO
└── HANDOFF.md                     ← this file
```

---

## 3. The engine (how the Strategy Studio works)

The console appears on **index.html**, **concierge.html**, and **scenario-studio.html**. All three load the same script stack and the same markup. Script load order matters:

```
rate-config.js  →  loan-limits.js  →  engine.js  →  studio-compliance.js  →  kwest.js  →  studio-app.js
```

- **`engine.js`** exposes `window.KW` with all the deterministic math:
  `primaryPath()` (Conforming → High-Balance → Jumbo), `rateFor()`, `monthlyPI()`,
  `paymentBreakdown()` (PITIA), `dscr()`, `qualifyingLoan()` (income → max loan by DTI),
  `monthlyMI()` (PMI), `permanentBuydown()` / `temporaryBuydown()`, `estimateIncomeTax()`,
  `interestOnly()`, `reviewPaths()`, `summaryText()`.
- **`loan-limits.js`** exposes `window.BJLLimits` — resolves a county's real FHFA/FHA limit from the JSON in `data/`.
- **`studio-app.js`** wires the console UI (county dropdown, sliders, buttons) to `window.KW` and re-computes on every input.
- **`studio-compliance.js`** makes the console's "Apply" CTA scroll to the on-page lead form (`#lead`) instead of any external portal.

**Default example:** Monroe County, FL (Key West), FIPS `12087`. Set in `studio-app.js` (`var S = { ... county_fips: "12087" ... }`) and the county dropdown pre-selects it.

---

## 4. Common future changes — where to edit

| You want to change… | Edit this |
|---|---|
| **Rate assumptions** (30-yr conforming/jumbo/FHA/VA/DSCR, etc.) | `js/rate-config.js` → `assumptions` block. Update `lastUpdated` too. |
| **Credit-score → rate add-ons** | `js/rate-config.js` → `score_adjustments` |
| **PMI factors** | `js/rate-config.js` → `mi_annual_factors` / `mi_score_multiplier` |
| **Income-type / Non-QM pricing** | `js/rate-config.js` → `doc_type_adjustments` |
| **Buydown point value, DTI, tax brackets** | `js/rate-config.js` → `buydown` / `affordability` / `tax` |
| **County loan limits (annual FHFA/HUD update)** | Replace the JSON in `data/loan-limits/2026/`. To add a new year, create `data/loan-limits/2027/…` and change the two paths in `js/loan-limits.js` (`load()` function). |
| **Colors / fonts / spacing** | `css/kwest.css` → `:root` variables at the top (`--ocean`, `--navy`, `--sand`, `--gold`, font vars) |
| **Console layout/styling** | `css/studio-console.css` |
| **Phone / email / NMLS in footer** | Search-replace across `*.html` (they're inline in each footer) |
| **Nav menu / Loan Programs dropdown** | The `<ul class="nav__links">` block near the top of every `*.html` (kept identical across pages) |
| **Add a new program page** | Copy an existing one (e.g. `conventional-loans.html`), change title/description/canonical/H1/FAQ/body + the hidden `program` field in its form, then add it to: the nav dropdown (all pages), `loan-options.html` grid, `sitemap.xml`, and `netlify.toml`. |
| **Homepage hero text/height** | `index.html` — the `<section class="hero">` block + the `<style>` block in `<head>` |

**After editing CSS or JS:** bump the `?v=N` query string on that file's `<link>`/`<script>` tags (currently `?v=7` for css/js, `?v=8` for studio-app.js / studio-console.css) so browsers fetch the new version. Search-replace the version number across all HTML files.

---

## 5. Forms (Netlify)

Two forms, both handled by `js/kwest.js` (AJAX POST to `/`, then redirect to `/thank-you.html`):

- **`key-west-scenario-review`** — used on program pages, concierge lead capture, get-preapproved.
- **`key-west-strategy-studio`** — used by the Strategy Studio console (includes a hidden `scenario_snapshot` field that `studio-app.js` fills with the computed scenario).

Netlify auto-detects both at deploy because each has `data-netlify="true"` + a hidden `form-name`. Submissions arrive in the Netlify dashboard under **Forms**. To email them, set up a Netlify form notification to **info@kwestmortgages.com**.

---

## 6. Compliance rules (keep these)

- Educational language only: "may fit / can review / subject to guidelines / not a commitment to lend / math illustration only".
- Never: "approved / qualified / guaranteed / best rate / lowest payment / no documents required / instant approval".
- No AI features, no external AI links, no WCCI.online routing. The console is deterministic math only.

---

## 7. ⚠️ Before the next production launch — verify these

- **Loan limits & rates are placeholders/dated** (rate-config `lastUpdated: 2026-06-12`). Verify current **FHFA / Fannie / HUD** county limits and current rate assumptions before relying on any figure publicly.
- Footer says *"Florida mortgage licensing details to be added before launch"* — replace with the real Florida license info.
- Confirm the Netlify form-notification email is pointed at info@kwestmortgages.com.

---

## 8. Git

Branch: `claude/gracious-carson-ggnh2v`. Everything is committed. To resume work later, pull this branch — this `kwestmortgage/` folder is the complete site.
