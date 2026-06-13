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

## Source files (official only)
- **FHFA**: full-county flat file from https://www.fhfa.gov/data/conforming-loan-limit
  (`fullcountyloanlimitlist<YEAR>_hera-based_final_flat.xlsx`). Save As CSV to
  `data/raw/<YEAR>/fhfa-conforming-<YEAR>.csv`.
- **HUD/FHA**: county forward limits from https://entp.hud.gov/idapp/html/hicostlook.cfm.
  Save As CSV to `data/raw/<YEAR>/fha-forward-<YEAR>.csv`.

Header names are matched flexibly (see `COLS` in each script). Required:
- FHFA — County Name, State (2-letter), One-Unit Limit, and FIPS (combined or
  State+County). Two/Three/Four-Unit optional.
- FHA — State, County Name, One-Family. Two/Three/Four-Family + County Code optional.

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
