# State → County selector data (`us-counties.json`)

`us-counties.json` drives the Strategy Studio's State → County dropdown.

- `states[]` is complete (50 states + DC). Add territories (PR, GU, VI) if needed.
- `counties{}` is **derived from the official FHFA county list** by
  `scripts/build-geo.mjs` — do not hand-edit it.

## Rebuild
```bash
npm run build:geo -- --year 2026
```
Run this after `npm run import:fhfa`. It reads
`data/loan-limits/<YEAR>/fhfa-conforming.json` and writes one
`{ name, fips }` entry per county, grouped and sorted by state. With the full
FHFA file imported, every U.S. county appears in the dropdown automatically.

States without a county list fall back to a free-text county field plus a
"verify manually" warning, so the studio stays usable before a full import.
