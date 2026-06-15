# BeforeJumboLoan.com — engine preview (v9)

Official 2026 **loan-limit** data is imported and `npm run validate:loan-limits`
reports LOAN LIMITS PRODUCTION READY. **ZIP intelligence is official-starter**
(HUD CHUMS ZIP, no residential ratios), so this build stays an **engine preview
for ZIP** until the HUD-USPS ZIP_COUNTY crosswalk is imported.

ZIP behaviour: a clear single-county ZIP **auto-detects and calculates**
("Detected: County, ST · matched by zip", with a Change affordance); a
multi-county ZIP shows county **choices** (no calc until you pick); an unknown
ZIP asks for **city + state or property county**. No default Los Angeles / Key West.

## Data status
| Layer | Source | Status |
|------|--------|--------|
| FHFA conforming (1–4 unit, all counties) | FHFA CY2026 all-county flat file | **official_full** — 3,235 counties, 50 states + DC + territories |
| FHA forward limits (1–4 unit) | HUD CHUMS CY2026 forward limits | **official_full** — 3,235 counties |
| ZIP → county | HUD CHUMS ZIP file | **official_starter** — 37,774 ZIPs. Single-county ZIPs auto-detect; multi-county ZIPs (3,811) ask the user to confirm. **No residential-ratio confidence** until the HUD-USPS ZIP-County Crosswalk is imported. |
| GSE cross-check | HUD CHUMS GSE limits | included in `data/raw/2026/` for reference (not required by the engine) |

`validate:loan-limits` result: **PRODUCTION READY — official nationwide loan-limit data installed.**

## What the engine does
- **Scenario-purpose first.** Purchase / Rate-and-term refi / Cash-out refi / Investment-DSCR /
  Second home / Not sure — the input model adapts (price+down, value+payoff+new-loan,
  value+payoff+cash-out, value+loan+rent→DSCR). LTV shown for refi/cash-out/investment.
- **Property-location intelligence.** Enter a ZIP, city, county, or alias. Single-county ZIPs
  auto-detect ("Detected: County, ST · matched by zip"); multi-county ZIPs and ambiguous names
  (e.g. "Austin TX" = Austin County vs the city of Austin → Travis County) return choices.
  **Nothing is calculated until you confirm the property county** — no guessed/default county,
  ever. A page-load example is clearly labeled and disappears the moment you use the search.
- **Deterministic engine.** County-line gap (dominant hero result), County Line Meter,
  Loan Path Map, Strategy Levers, an "Engine sees" panel, and an **Estimated P&I preview**
  (P&I only; taxes/insurance/HOA/flood/MI are added in the Studio).
- **AI is optional.** Fully functional with no AI; the single AI explainer returns 503 without
  `ANTHROPIC_API_KEY` and the UI falls back to a deterministic explanation. No PII sent anywhere.

## Re-importing / updating data
```
npm run import:all            # FHFA + FHA + ZIP + geo
npm run validate:loan-limits  # production-readiness gate
```
Place official source files in `data/raw/2026/` (the importers auto-detect them):
- `fhfa-conforming-all-counties-2026.csv`
- `hud-fha-forward-limits-2026.txt`  (HUD CHUMS fixed-width)
- `hud-chums-zip-codes.txt`          (HUD CHUMS ZIP fixed-width)

## To upgrade ZIP from starter → full multi-county ratio confidence
Download the **HUD-USPS ZIP Code Crosswalk** (ZIP-County, with RES_RATIO/TOT_RATIO) from
<https://www.huduser.gov/portal/datasets/usps_crosswalk.html>, save it as
`data/raw/2026/zip-county-crosswalk-2026.csv`, then run `npm run import:zip`. The resolver
will automatically rank multi-county ZIPs by residential ratio ("most common" hint).

Deploy: drag this folder into Netlify. `_redirects` maps the market routes to the Studio.
