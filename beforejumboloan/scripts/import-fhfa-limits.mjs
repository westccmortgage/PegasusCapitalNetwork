#!/usr/bin/env node
/* ============================================================
   import-fhfa-limits.mjs
   Read the OFFICIAL FHFA all-county conforming loan-limit file
   (CSV exported from the FHFA "full county" flat file) from
   data/raw/2026/ and write data/loan-limits/2026/fhfa-conforming.json.

   Never invents data. Fails loudly on missing columns, duplicate
   records, or missing/invalid one-unit limits.

   Usage:
     node scripts/import-fhfa-limits.mjs [path-to-csv] [--year 2026] [--verified 2026-12-01]
   With no path it uses data/raw/2026/fhfa-conforming-2026.csv, falling
   back to the committed *.sample.csv (with a loud warning).
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCSV, normHeader, pickColumn, parseAmount, pad, titleCase,
  fail, info, nowISO, COMPLIANCE, SPECIAL_AREAS, STATE_NAME
} from "./lib/import-utils.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const COLS = {
  stateFips:  ["fipsstatecode", "statefips", "statefipscode", "fipsstate", "stfips"],
  countyFips: ["fipscountycode", "countyfips", "countyfipscode", "cntyfips"],
  fips5:      ["fips", "fips5", "countyfips5", "statecountyfips", "geoid"],
  county:     ["countyname", "county", "countyareaname"],
  state:      ["state", "stateabbreviation", "stateabbr", "statecode", "stateabbrev"],
  one:        ["oneunitlimit", "oneunit", "1unitlimit", "limit1unit", "onefamily"],
  two:        ["twounitlimit", "twounit", "2unitlimit", "limit2unit", "twofamily"],
  three:      ["threeunitlimit", "threeunit", "3unitlimit", "limit3unit", "threefamily"],
  four:       ["fourunitlimit", "fourunit", "4unitlimit", "limit4unit", "fourfamily"]
};

/* Pure: rows (array of arrays incl. header) -> dataset object. Throws via fail(). */
export function buildFhfaDataset(rows, opts = {}) {
  const year = Number(opts.year) || 2026;
  if (!rows.length) fail("input file has no rows");
  const header = rows[0].map(normHeader);
  const idx = {};
  for (const key of Object.keys(COLS)) idx[key] = pickColumn(header, COLS[key]);

  // Required columns.
  if (idx.county < 0) fail("missing required column: County Name");
  if (idx.state < 0) fail("missing required column: State (2-letter abbr)");
  if (idx.one < 0) fail("missing required column: One-Unit Limit");
  const hasCombinedFips = idx.fips5 >= 0;
  const hasSplitFips = idx.stateFips >= 0 && idx.countyFips >= 0;
  if (!hasCombinedFips && !hasSplitFips) {
    fail("missing FIPS columns: need either a 5-digit FIPS column or FIPS State Code + FIPS County Code");
  }

  const counties = [];
  const seenKey = new Map();   // state|county -> rowNum
  const seenFips = new Map();  // fips -> rowNum
  const invalidOne = [];
  const dupKey = [];
  const dupFips = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const stateAbbr = String(row[idx.state] || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(stateAbbr)) fail(`row ${r + 1}: invalid state abbreviation "${row[idx.state]}"`);
    const stateName = STATE_NAME[stateAbbr] || stateAbbr;

    let fips;
    if (hasCombinedFips) fips = pad(row[idx.fips5], 5);
    else fips = pad(row[idx.stateFips], 2) + pad(row[idx.countyFips], 3);
    if (!/^\d{5}$/.test(fips)) fail(`row ${r + 1}: invalid county FIPS "${fips}"`);

    let county = titleCase(row[idx.county]);
    // FHFA names usually omit the designation; keep as-is when present.
    if (!/(county|parish|borough|municipality|census area|city|municipio|district)$/i.test(county)) {
      county = county + " County";
    }

    const one = parseAmount(row[idx.one]);
    if (one == null || Number.isNaN(one) || one <= 0) invalidOne.push(r + 1);

    const rec = {
      state_name: stateName, state_abbr: stateAbbr, county_name: county, county_fips: fips,
      year,
      conforming_one_unit: one == null || Number.isNaN(one) ? null : one,
      conforming_two_unit: idx.two >= 0 ? parseAmount(row[idx.two]) : null,
      conforming_three_unit: idx.three >= 0 ? parseAmount(row[idx.three]) : null,
      conforming_four_unit: idx.four >= 0 ? parseAmount(row[idx.four]) : null,
      high_cost: false, // computed below
      special_area: SPECIAL_AREAS.has(stateAbbr),
      source: "FHFA " + year + " CLL", verified_at: opts.verified || null
    };

    const key = stateAbbr + "|" + normHeader(county);
    if (seenKey.has(key)) dupKey.push(`${county}, ${stateAbbr} (rows ${seenKey.get(key)} & ${r + 1})`);
    else seenKey.set(key, r + 1);
    if (seenFips.has(fips)) dupFips.push(`${fips} (rows ${seenFips.get(fips)} & ${r + 1})`);
    else seenFips.set(fips, r + 1);

    counties.push(rec);
  }

  if (invalidOne.length) fail("one-unit limit missing/invalid on data rows: " + invalidOne.slice(0, 20).join(", ") + (invalidOne.length > 20 ? " …" : ""));
  if (dupKey.length) fail("duplicate state/county records:\n  " + dupKey.slice(0, 20).join("\n  "));
  if (dupFips.length) fail("duplicate FIPS records:\n  " + dupFips.slice(0, 20).join("\n  "));
  if (!counties.length) fail("no county records parsed");

  // Baseline = the national floor (minimum one-unit). Ceiling = maximum.
  const ones = counties.map((c) => c.conforming_one_unit);
  const baselineOne = Math.min.apply(null, ones);
  const ceilingOne = Math.max.apply(null, ones);
  for (const c of counties) c.high_cost = c.conforming_one_unit > baselineOne;

  const repBaseline = counties.find((c) => c.conforming_one_unit === baselineOne && c.conforming_two_unit != null);
  const repCeiling = counties.find((c) => c.conforming_one_unit === ceilingOne && c.conforming_two_unit != null);
  const baseline = {
    one_unit: baselineOne,
    two_unit: repBaseline ? repBaseline.conforming_two_unit : null,
    three_unit: repBaseline ? repBaseline.conforming_three_unit : null,
    four_unit: repBaseline ? repBaseline.conforming_four_unit : null
  };
  const ceiling = {
    one_unit: ceilingOne,
    two_unit: repCeiling ? repCeiling.conforming_two_unit : null,
    three_unit: repCeiling ? repCeiling.conforming_three_unit : null,
    four_unit: repCeiling ? repCeiling.conforming_four_unit : null
  };

  // Sample vs official_full. Explicit override wins; otherwise infer from size.
  const datasetType = opts.datasetType || (counties.length >= FHFA_MIN_OFFICIAL ? "official_full" : "sample");

  return {
    schema: "fhfa-conforming",
    dataset_type: datasetType,
    source_name: "FHFA Conforming Loan Limit Values",
    source_url_or_label: opts.sourceLabel || "https://www.fhfa.gov/data/conforming-loan-limit (full county flat file)",
    effective_year: year,
    imported_at: nowISO(),
    verified_at: opts.verified || null,
    record_count: counties.length,
    // back-compat aliases the resolver/engine read:
    year, source: "FHFA Conforming Loan Limit Values",
    compliance: COMPLIANCE,
    baseline, ceiling,
    counties: counties.sort((a, b) =>
      a.state_abbr.localeCompare(b.state_abbr) || a.county_name.localeCompare(b.county_name))
  };
}

/* Minimum FHFA county records to be considered nationwide-official (~3,234). */
export const FHFA_MIN_OFFICIAL = 3000;

/* Coverage stats for the import report. */
export function fhfaStats(ds) {
  const states = new Set(ds.counties.map((c) => c.state_abbr));
  const missingFips = ds.counties.filter((c) => !/^\d{5}$/.test(String(c.county_fips || ""))).length;
  const invalid = ds.counties.filter((c) => c.conforming_one_unit == null || c.conforming_one_unit <= 0).length;
  const missingUnits = ds.counties.filter((c) =>
    c.conforming_two_unit == null || c.conforming_three_unit == null || c.conforming_four_unit == null).length;
  return { states: states.size, counties: ds.counties.length, missingFips, invalid, missingUnits };
}

/* ---- CLI ---- */
function resolveInput(argPath) {
  if (argPath) return argPath;
  const real = path.join(ROOT, "data/raw/2026/fhfa-conforming-2026.csv");
  const sample = path.join(ROOT, "data/raw/2026/fhfa-conforming-2026.sample.csv");
  if (fs.existsSync(real)) return real;
  if (fs.existsSync(sample)) {
    info("⚠ Using the committed SAMPLE file (seeded counties only). Drop the official FHFA");
    info("  export at data/raw/2026/fhfa-conforming-2026.csv to import the full nation.\n");
    return sample;
  }
  fail("no input file. Place data/raw/2026/fhfa-conforming-2026.csv (see data/loan-limits/IMPORT.md).");
}

function main() {
  const args = process.argv.slice(2);
  const opts = { year: 2026 };
  let input = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--year") opts.year = Number(args[++i]);
    else if (args[i] === "--verified") opts.verified = args[++i];
    else if (args[i] === "--source") opts.sourceLabel = args[++i];
    else if (!args[i].startsWith("--")) input = args[i];
  }
  const file = resolveInput(input);
  if (/\.sample\.csv$/.test(file)) opts.datasetType = "sample"; // committed seed → never "official_full"
  info("Reading: " + path.relative(ROOT, file));
  const ds = buildFhfaDataset(readCSV(file), opts);
  const out = path.join(ROOT, "data/loan-limits/" + opts.year + "/fhfa-conforming.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ds, null, 2) + "\n");
  const s = fhfaStats(ds);
  const hc = ds.counties.filter((c) => c.high_cost).length;
  info(`✔ Wrote ${path.relative(ROOT, out)}`);
  info("  ── FHFA import report ──────────────────────────────");
  info(`  dataset_type:      ${ds.dataset_type}`);
  info(`  FHFA record count: ${ds.record_count}`);
  info(`  states covered:    ${s.states}`);
  info(`  counties covered:  ${s.counties}`);
  info(`  missing FIPS:      ${s.missingFips}`);
  info(`  duplicate count:   0 (import fails loudly on duplicates)`);
  info(`  invalid 1-unit:    ${s.invalid}`);
  info(`  counties missing 2–4 unit: ${s.missingUnits}`);
  info(`  baseline 1-unit:   ${ds.baseline.one_unit} | ceiling 1-unit: ${ds.ceiling.one_unit} | high-cost counties: ${hc}`);
  if (ds.dataset_type === "sample") {
    info("  ⚠ SAMPLE dataset — not nationwide. Import the official full file before production.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
