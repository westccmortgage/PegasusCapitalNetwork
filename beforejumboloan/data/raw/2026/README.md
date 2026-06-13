# Raw official source files — 2026

Place the **official** FHFA and HUD/FHA files here, then run the import scripts.
Large raw files are git-ignored (see `data/raw/.gitignore`); only the committed
`*.sample.csv` seeds are tracked. **Do not hand-edit limits — import only.**

## 1. FHFA conforming (all counties)
1. Download the FHFA full-county flat file for the year:
   https://www.fhfa.gov/data/conforming-loan-limit →
   `fullcountyloanlimitlist2026_hera-based_final_flat.xlsx`
   (If your network blocks fhfa.gov, download on a machine that can reach it.)
2. Open it and **Save As CSV** to:
   `data/raw/2026/fhfa-conforming-2026.csv`
   Required columns (header names are matched flexibly): FIPS State Code,
   FIPS County Code, County Name, State, One-Unit Limit, Two/Three/Four-Unit Limit.
3. Run:
   ```
   npm run import:fhfa -- --year 2026 --verified 2026-12-01
   npm run build:geo   -- --year 2026
   ```

## 2. HUD / FHA forward limits
1. Download the HUD FHA forward mortgage-limit county file:
   https://entp.hud.gov/idapp/html/hicostlook.cfm (export the full county list).
2. Save As CSV to:
   `data/raw/2026/fha-forward-2026.csv`
   Required columns: State, County Name, One-Family (+ Two/Three/Four-Family).
   County Code / FIPS is used when present.
3. Run:
   ```
   npm run import:fha -- --year 2026 --verified 2026-12-01
   ```

## Next year
Create `data/raw/<YEAR>/`, drop the new files, and run the same commands with
`--year <YEAR>`. The resolver reads the year from the dataset. Update the studio
loader path in `js/loan-limits.js` if you change the active year.
