# BeforeJumboLoan.com — ENGINE PREVIEW (v4)

This package is an **engine preview**. It is **NOT production nationwide-ready.**

## Why "engine preview" and not "nationwide"
The full official loan-limit data has **not** been imported. The package ships with a
small, clearly-labeled **sample** dataset (a handful of counties) plus the complete
**import / validation / resolver architecture** needed to go nationwide.

`npm run validate:loan-limits` currently **fails on purpose** — it refuses to certify the
site as production-ready until the official full files are imported. This is the guardrail
that prevents a false "nationwide live coverage" claim.

## What works today
- **Property-location intelligence engine.** The homepage is command-driven: enter a ZIP,
  city, county, or alias ("90210", "Beverly Hills CA", "Newport Beach", "Miami-Dade",
  "Key West", "Austin TX"). The deterministic resolver finds the county, you **confirm the
  property county**, and only then does the engine calculate. It never silently calculates
  on a guessed or default county.
- **Deterministic engine.** County line, jumbo gap, County Line Meter, Loan Path Map,
  Strategy Levers, an "Engine sees" insight panel, and an **Estimated P&I preview**
  (principal & interest only — taxes, insurance, HOA, flood, and MI are added in the Studio).
- **Honest empty states.** A county that is not in the imported data is shown as
  "Needs official county data" — never a fabricated limit.
- **AI is optional.** The site is fully functional with no AI. The single AI explainer
  Netlify function returns 503 without `ANTHROPIC_API_KEY` and the UI falls back to a
  rule-based explanation. No PII is sent anywhere.

## To make it production nationwide-ready
1. Drop the official FHFA full-county conforming file at
   `data/raw/2026/fhfa-conforming-2026.csv`.
2. Drop the official HUD/FHA forward-limit file at
   `data/raw/2026/fha-forward-2026.csv`.
3. Run `npm run import:all` then `npm run validate:loan-limits`.
4. The gate passes only when the data is official, complete (50 states + DC, all units
   1–4, valid FIPS, correct baseline/high-cost labeling, and full CA/FL/TX county counts).

See `data/loan-limits/IMPORT.md` for the exact required columns and source URLs.

## Official source files still needed
- **FHFA** Conforming Loan Limit Values — full county flat file (~3,234 counties), all units 1–4.
- **HUD/FHA** Forward Mortgage Limits — full CHUMS county file.
- (Optional, for richer location input) official **ZCTA→county** and **Census Places**
  files to replace the seed `data/geo/us-zips.json` and `data/geo/us-places.json`.

Deploy: drag this folder into Netlify. `_redirects` maps the market routes to the Studio.
