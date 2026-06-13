# Importing the full national loan-limit dataset

These files are **seeded** with the route-preset counties only. The architecture
(resolver + selector) already supports nationwide data — you just need to import
the full county list. Nothing here is hardcoded in UI components; the UI reads
only the resolver, which reads these files.

## FHFA conforming (`2026/fhfa-conforming.json`)

Source of truth: **FHFA Conforming Loan Limit Values** (annual).
- News release + data: https://www.fhfa.gov/data/conforming-loan-limit
- Full county list (flat file): `fullcountyloanlimitlist<YEAR>_hera-based_final_flat.xlsx`

Steps:
1. Download the FHFA full county `.xlsx` for the year.
2. Map columns → one record per county in `counties[]`:
   - `state_name`, `state_abbr`, `county_name`, `county_fips` (5-digit, zero-padded)
   - `conforming_one_unit` … `conforming_four_unit`
   - `high_cost`: `true` when `conforming_one_unit > baseline.one_unit`
   - `source`, `verified_at` (ISO date you confirmed the values)
3. Keep the top-level `baseline` and `ceiling` blocks in sync for the year.
4. Re-run the tests (`node --test`) — the resolver test will pass on any county
   present in the file.

A new year = a new folder: `data/loan-limits/<YEAR>/` with the same shape. The
resolver reads `year` from the file, so point the loader at the new folder.

## FHA forward (`2026/fha-forward.json`)

Source of truth: **HUD FHA Mortgage Limits** (set by HUD, not FHFA).
- Lookup: https://entp.hud.gov/idapp/html/hicostlook.cfm
- FHA county limit = greater of the national **floor** or 115% of area median,
  capped at the **ceiling**. Populate `counties[]` with `fha_one_unit` …
  `fha_four_unit`. The resolver returns `fhaLimit` only when a county record exists.

## Compliance

Every imported value remains a **configured reference**. The UI always shows:
"Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch."
