#!/usr/bin/env node
/* ============================================================
   import-fha-limits.mjs
   Read the OFFICIAL HUD/FHA forward mortgage-limit file (CSV) from
   data/raw/2026/ and write data/loan-limits/2026/fha-forward.json.

   Never invents data. Fails loudly on missing columns, duplicate
   records, or missing/invalid one-family limits.

   Usage:
     node scripts/import-fha-limits.mjs [path-to-csv] [--year 2026] [--verified 2026-12-01]
   With no path it uses data/raw/2026/fha-forward-2026.csv, falling back
   to the committed *.sample.csv (with a loud warning).
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
  fips5:   ["countycode", "fips", "fips5", "countyfips", "geoid", "statecountycode"],
  stateFips: ["fipsstatecode", "statefips"],
  countyFips: ["fipscountycode", "countyfips"],
  county:  ["countyname", "county", "countymsaname", "areaname"],
  msa:     ["msaname", "msamdname", "msa", "cbsaname"],
  state:   ["state", "stateabbr", "statecode", "stateabbreviation"],
  one:     ["onefamily", "oneunit", "oneunitlimit", "1unit", "fhaoneunit"],
  two:     ["twofamily", "twounit", "twounitlimit", "2unit", "fhatwounit"],
  three:   ["threefamily", "threeunit", "threeunitlimit", "3unit", "fhathreeunit"],
  four:    ["fourfamily", "fourunit", "fourunitlimit", "4unit", "fhafourunit"]
};

export function buildFhaDataset(rows, opts = {}) {
  const year = Number(opts.year) || 2026;
  if (!rows.length) fail("input file has no rows");
  const header = rows[0].map(normHeader);
  const idx = {};
  for (const key of Object.keys(COLS)) idx[key] = pickColumn(header, COLS[key]);

  if (idx.county < 0) fail("missing required column: County Name");
  if (idx.state < 0) fail("missing required column: State (2-letter abbr)");
  if (idx.one < 0) fail("missing required column: One-Family (FHA one-unit) limit");
  const hasCombinedFips = idx.fips5 >= 0;
  const hasSplitFips = idx.stateFips >= 0 && idx.countyFips >= 0;

  const counties = [];
  const seenKey = new Map();
  const invalidOne = [];
  const dupKey = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const stateAbbr = String(row[idx.state] || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(stateAbbr)) fail(`row ${r + 1}: invalid state abbreviation "${row[idx.state]}"`);

    let fips = null;
    if (hasCombinedFips) fips = pad(row[idx.fips5], 5);
    else if (hasSplitFips) fips = pad(row[idx.stateFips], 2) + pad(row[idx.countyFips], 3);
    if (fips && !/^\d{5}$/.test(fips)) fips = null; // FHA files sometimes carry non-FIPS codes

    let county = titleCase(row[idx.county]);
    if (!/(county|parish|borough|municipality|census area|city|municipio|district)$/i.test(county)) {
      county = county + " County";
    }

    const one = parseAmount(row[idx.one]);
    if (one == null || Number.isNaN(one) || one <= 0) invalidOne.push(r + 1);

    const rec = {
      state_name: STATE_NAME[stateAbbr] || stateAbbr, state_abbr: stateAbbr,
      county_name: county, county_fips: fips,
      msa: idx.msa >= 0 ? titleCase(row[idx.msa]) || null : null,
      year,
      fha_one_unit: one == null || Number.isNaN(one) ? null : one,
      fha_two_unit: idx.two >= 0 ? parseAmount(row[idx.two]) : null,
      fha_three_unit: idx.three >= 0 ? parseAmount(row[idx.three]) : null,
      fha_four_unit: idx.four >= 0 ? parseAmount(row[idx.four]) : null,
      special_area: SPECIAL_AREAS.has(stateAbbr),
      source: "HUD FHA " + year + " forward limits", verified_at: opts.verified || null
    };

    const key = stateAbbr + "|" + normHeader(county);
    if (seenKey.has(key)) dupKey.push(`${county}, ${stateAbbr} (rows ${seenKey.get(key)} & ${r + 1})`);
    else seenKey.set(key, r + 1);

    counties.push(rec);
  }

  if (invalidOne.length) fail("FHA one-family limit missing/invalid on data rows: " + invalidOne.slice(0, 20).join(", ") + (invalidOne.length > 20 ? " …" : ""));
  if (dupKey.length) fail("duplicate state/county FHA records:\n  " + dupKey.slice(0, 20).join("\n  "));
  if (!counties.length) fail("no FHA county records parsed");

  const ones = counties.map((c) => c.fha_one_unit);
  const floor = Math.min.apply(null, ones);
  const ceiling = Math.max.apply(null, ones);
  const datasetType = opts.datasetType || (counties.length >= FHA_MIN_OFFICIAL ? "official_full" : "sample");

  return {
    schema: "fha-forward",
    dataset_type: datasetType,
    source_name: "HUD FHA Forward Mortgage Limits",
    source_file: opts.sourceFile || null,
    source_url_or_label: opts.sourceLabel || "https://www.hud.gov/program_offices/housing/sfh/lender/origination/mortgage_limits (CHUMS full file)",
    effective_year: year,
    imported_at: nowISO(),
    verified_at: opts.verified || null,
    record_count: counties.length,
    year, source: "HUD FHA Forward Mortgage Limits",
    compliance: COMPLIANCE,
    floor: { one_unit: floor }, ceiling: { one_unit: ceiling },
    counties: counties.sort((a, b) =>
      a.state_abbr.localeCompare(b.state_abbr) || a.county_name.localeCompare(b.county_name))
  };
}

/* Minimum FHA county records to be considered nationwide-official. */
export const FHA_MIN_OFFICIAL = 3000;

export function fhaStats(ds) {
  const states = new Set(ds.counties.map((c) => c.state_abbr));
  const missingFips = ds.counties.filter((c) => !/^\d{5}$/.test(String(c.county_fips || ""))).length;
  const invalid = ds.counties.filter((c) => c.fha_one_unit == null || c.fha_one_unit <= 0).length;
  return { states: states.size, counties: ds.counties.length, missingFips, invalid };
}

function resolveInput(argPath) {
  if (argPath) return argPath;
  const real = path.join(ROOT, "data/raw/2026/fha-forward-2026.csv");
  const sample = path.join(ROOT, "data/raw/2026/fha-forward-2026.sample.csv");
  if (fs.existsSync(real)) return real;
  if (fs.existsSync(sample)) {
    info("⚠ Using the committed SAMPLE file (a few counties only). Drop the official HUD FHA");
    info("  export at data/raw/2026/fha-forward-2026.csv to import the full nation.\n");
    return sample;
  }
  fail("no input file. Place data/raw/2026/fha-forward-2026.csv (see data/loan-limits/IMPORT.md).");
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
  if (/\.sample\.csv$/.test(file)) opts.datasetType = "sample";
  opts.sourceFile = path.basename(file);
  info("Reading: " + path.relative(ROOT, file));
  const ds = buildFhaDataset(readCSV(file), opts);
  const out = path.join(ROOT, "data/loan-limits/" + opts.year + "/fha-forward.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ds, null, 2) + "\n");
  const s = fhaStats(ds);
  info(`✔ Wrote ${path.relative(ROOT, out)}`);
  info("  ── FHA import report ───────────────────────────────");
  info(`  dataset_type:     ${ds.dataset_type}`);
  info(`  FHA record count: ${ds.record_count}`);
  info(`  states covered:   ${s.states}`);
  info(`  counties covered: ${s.counties}`);
  info(`  missing FIPS:     ${s.missingFips}`);
  info(`  duplicate count:  0 (import fails loudly on duplicates)`);
  info(`  invalid 1-unit:   ${s.invalid}`);
  if (ds.dataset_type === "sample") {
    info("  ⚠ SAMPLE dataset — not nationwide. Import the official HUD full file before production.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
