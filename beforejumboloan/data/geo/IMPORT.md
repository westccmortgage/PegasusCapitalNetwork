# Importing the full US county list

`us-counties.json` drives the State → County selector in the Strategy Studio.

- `states[]` is **complete** (50 states + DC). Add territories (PR, GU, VI) if needed.
- `counties{}` is keyed by state abbreviation and **seeded** only for the route-preset
  markets. States without a county list fall back to a free-text county field plus a
  "verify manually" warning — the site stays usable nationwide before the full import.

## To import every county

1. Use a public Census/FIPS county source (e.g. Census Bureau county FIPS list) or
   reuse the county names + FIPS already present in
   `data/loan-limits/2026/fhfa-conforming.json` (one entry per county nationwide).
2. Populate `counties["XX"] = [{ "name": "<County> County", "fips": "<5-digit>" }, …]`
   for each state, sorted by name.

Keep county `name` and `fips` **identical** to the records in
`fhfa-conforming.json` so the resolver matches them (matching is case/space
insensitive and ignores a trailing "County", but FIPS should still line up).
