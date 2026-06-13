# Importing the national loan-limit dataset

The JSON files in `data/loan-limits/<YEAR>/` are **build artifacts of the import
scripts** — never hand-edit limits. Place the official source files in
`data/raw/<YEAR>/` (see `data/raw/2026/README.md`) and run the importers.

## Commands
```bash
# 1. FHFA conforming / high-balance (all counties)
npm run import:fhfa -- --year 2026 --verified 2026-12-01
#    → writes data/loan-limits/2026/fhfa-conforming.json

# 2. HUD / FHA forward limits
npm run import:fha  -- --year 2026 --verified 2026-12-01
#    → writes data/loan-limits/2026/fha-forward.json

# 3. Rebuild the State→County dropdown from the official FHFA county list
npm run build:geo   -- --year 2026
#    → writes data/geo/us-counties.json

# Or all three:
npm run import:all
```
Each script prints the record count and fails loudly (non-zero exit) on a
missing required column, a duplicate state/county or FIPS, or a missing/invalid
one-unit limit. Nothing is invented.

## Official source files (do this for a real nationwide dataset)

**FHFA 2026 — All Counties:**
1. Go to the FHFA **Conforming Loan Limit Values** page: https://www.fhfa.gov/data/conforming-loan-limit
2. Download the **all-county** file for 2026
   (`fullcountyloanlimitlist2026_hera-based_final_flat.xlsx`, ~3,200+ rows).
3. Open it and **Save As CSV** → `data/raw/2026/fhfa-conforming-2026.csv`.

**HUD CY2026 FHA Forward Limits — Full File:**
1. Go to HUD's **FHA Mortgage Limits / CHUMS file layouts** page:
   https://www.hud.gov/program_offices/housing/sfh/lender/origination/mortgage_limits
2. Download the **CY2026 Forward Mortgage Limits full file** (CHUMS).
3. Save As CSV → `data/raw/2026/fha-forward-2026.csv`.

Then:
```bash
npm run import:all                 # imports both + rebuilds the county dropdown
npm run validate:loan-limits       # production gate — must print "PRODUCTION READY"
```

Header names are matched flexibly (see `COLS` in each script). Required:
- FHFA — County Name, State (2-letter), One-Unit Limit, and FIPS (combined or
  State+County). Two/Three/Four-Unit must be present for production.
- FHA — State, County Name, One-Family. Two/Three/Four-Family + County Code optional.

## Sample vs official_full (coverage guard)
Each dataset carries `dataset_type`:
- `"sample"` — the committed seed (a handful of verified counties). The studio
  shows "County limit database is being finalized…" and logs a developer console
  warning; it does **not** claim full nationwide coverage.
- `"official_full"` — set automatically when an imported file has ≥ 3,000 county
  records (the seed `*.sample.csv` is always tagged `sample`).

`npm run validate:loan-limits` **fails (exit 1)** unless BOTH datasets are
`official_full`, above the record threshold, carry required metadata, have every
one-unit limit, and (FHFA) have all 2–4 unit limits populated. Run it in CI / a
pre-launch check — green is the proof production data is installed.

## Output metadata (each JSON carries provenance)
`source_name`, `source_url_or_label`, `effective_year`, `imported_at`,
`verified_at`, `record_count`, plus the `compliance` line. The resolver surfaces
these as `sourceMeta`.

## Seed / sample
Committed `data/raw/2026/*.sample.csv` files (FHFA-verified seed counties only)
let the pipeline run out of the box. The current committed JSON was produced from
them: **5 FHFA county records, 2 FHA county records.** Replace the samples with
the official full files (git-ignored) and re-run to import the whole nation.

## Next year
`data/raw/<YEAR>/` + the same commands with `--year <YEAR>`. Point the studio
loader (`js/loan-limits.js`) at the new year's folder.
