#!/usr/bin/env node
/* ============================================================
   import-zip-county-crosswalk.mjs
   Read the OFFICIAL HUD USPS ZIP Code Crosswalk (ZIP→COUNTY) file
   from data/raw/2026/ and write data/geo/us-zips.json.

   HUD publishes ZIP↔COUNTY crosswalk files (one row per ZIP/county
   pair, with RES_RATIO / BUS_RATIO / OTH_RATIO / TOT_RATIO). A ZIP
   that crosses county lines has multiple rows; we keep ALL of them so
   the resolver can ask the user which county the property is in.

   County NAMES are not in the HUD file — we join the 5-digit county
   FIPS against the official FHFA county list already imported under
   data/loan-limits/. Never invents ZIP data; fails loudly on bad input.

   Usage:
     node scripts/import-zip-county-crosswalk.mjs [path-to-csv] [--year 2026] [--verified 2026-12-01]
   With no path it uses data/raw/2026/zip-county-crosswalk-2026.csv, falling
   back to the committed *.sample.csv (with a loud warning → dataset stays
   "sample" and ZIP intelligence stays gated off in the resolver).

   Official source: HUD USPS ZIP Code Crosswalk
     https://www.huduser.gov/portal/datasets/usps_crosswalk.html
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCSV, normHeader, pickColumn, pad, fail, info, nowISO, STATE_NAME } from "./lib/import-utils.mjs";
import { parseChumsZip, fipsNameIndex } from "./lib/chums.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadFhfaNames(year) {
  const p = path.join(ROOT, "data/loan-limits/" + year + "/fhfa-conforming.json");
  if (fs.existsSync(p)) { try { return fipsNameIndex(JSON.parse(fs.readFileSync(p, "utf8"))); } catch (e) { /* ignore */ } }
  return {};
}

/* Wrap parsed CHUMS ZIP rows into the us-zips.json shape. The HUD CHUMS ZIP
   file is an OFFICIAL HUD source but carries NO residential-ratio fields, so it
   is a single-/multi-county *starter* lookup — not full multi-county ratio
   confidence. Marked dataset_type "official_starter" / coverage "starter". */
export function buildZipDatasetFromChums(parsed, opts = {}) {
  const year = Number(opts.year) || 2026;
  if (!parsed || !parsed.zip_count) fail("no ZIP rows parsed from the CHUMS ZIP file");
  // Compact the file: store only county FIPS per ZIP (no ratios in CHUMS).
  // County/state names are resolved at query time from the conforming data.
  const compact = {};
  Object.keys(parsed.zips).forEach((z) => {
    compact[z] = parsed.zips[z]
      .slice()
      .sort((a, b) => a.county_fips.localeCompare(b.county_fips))
      .map((c) => ({ f: c.county_fips }));
  });
  parsed.zips = compact;
  return {
    schema: "zip-county-crosswalk",
    dataset_type: "official_starter",
    coverage: "starter",
    source_name: "HUD CHUMS ZIP Codes (official HUD ZIP→county lookup)",
    source_file: opts.sourceFile || null,
    source_url_or_label: opts.sourceLabel || "https://apps.hud.gov/pub/chums/ZIP.txt",
    effective_year: year,
    imported_at: nowISO(),
    verified_at: opts.verified || null,
    record_count: parsed.zip_count,
    pair_count: parsed.pair_count,
    multi_county_zips: parsed.multi_county_zips,
    has_ratio_confidence: false,
    note: "Official HUD CHUMS ZIP file (no RES_RATIO/TOT_RATIO). Single-county ZIPs auto-resolve; multi-county ZIPs are returned as choices to confirm — NOT ranked by ratio. Import the HUD-USPS ZIP-County Crosswalk for multi-county ratio confidence.",
    zips: parsed.zips
  };
}

const COLS = {
  zip:   ["zip", "zipcode", "zip5"],
  fips:  ["county", "countyfips", "fips", "geoid", "countycode"],
  state: ["uspszipprefstate", "state", "stateabbr", "statecode"],
  res:   ["resratio", "residentialratio", "res"],
  bus:   ["busratio", "businessratio"],
  oth:   ["othratio", "otherratio"],
  tot:   ["totratio", "totalratio"]
};

/* Minimum ZIP/county rows to be considered the nationwide-official crosswalk
   (HUD ships ~46k+ ZIP/county pairs). */
export const ZIP_MIN_OFFICIAL = 30000;

function loadFipsIndex(year) {
  // Authoritative FIPS → {county_name, state_abbr, state_name} from the
  // official FHFA county list already in the repo (no invented names).
  const idx = {};
  const p = path.join(ROOT, "data/loan-limits/" + year + "/fhfa-conforming.json");
  if (fs.existsSync(p)) {
    try {
      const ds = JSON.parse(fs.readFileSync(p, "utf8"));
      (ds.counties || []).forEach((c) => {
        if (/^\d{5}$/.test(String(c.county_fips || ""))) {
          idx[c.county_fips] = { county_name: c.county_name, state_abbr: c.state_abbr, state_name: c.state_name };
        }
      });
    } catch (e) { /* ignore — index stays partial */ }
  }
  return idx;
}

/* Pure: rows (array of arrays incl. header) -> dataset object. Throws via fail(). */
export function buildZipDataset(rows, opts = {}) {
  const year = Number(opts.year) || 2026;
  if (!rows.length) fail("input file has no rows");
  const header = rows[0].map(normHeader);
  const idx = {};
  for (const key of Object.keys(COLS)) idx[key] = pickColumn(header, COLS[key]);
  if (idx.zip < 0) fail("missing required column: ZIP");
  if (idx.fips < 0) fail("missing required column: County FIPS (5-digit)");

  const fipsIndex = opts.fipsIndex || loadFipsIndex(year);
  const zips = {};
  let rowCount = 0, missingName = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.join("").trim() === "") continue;
    const zip = pad(row[idx.zip], 5);
    if (!/^\d{5}$/.test(zip)) fail(`row ${r + 1}: invalid ZIP "${row[idx.zip]}"`);
    const fips = pad(row[idx.fips], 5);
    if (!/^\d{5}$/.test(fips)) fail(`row ${r + 1}: invalid county FIPS "${row[idx.fips]}"`);

    const res = idx.res >= 0 ? Number(row[idx.res]) : null;
    const tot = idx.tot >= 0 ? Number(row[idx.tot]) : null;
    const known = fipsIndex[fips] || null;
    if (!known) missingName++;
    const stateAbbr = (known && known.state_abbr) || (idx.state >= 0 ? String(row[idx.state] || "").trim().toUpperCase() : "");

    const rec = {
      county_fips: fips,
      county_name: known ? known.county_name : null,
      state_abbr: stateAbbr || null,
      state_name: (known && known.state_name) || STATE_NAME[stateAbbr] || null,
      res_ratio: Number.isFinite(res) ? res : null,
      tot_ratio: Number.isFinite(tot) ? tot : null
    };
    if (!zips[zip]) zips[zip] = [];
    // De-dupe (zip,fips); keep the row with the higher residential ratio.
    const ex = zips[zip].find((x) => x.county_fips === fips);
    if (ex) { if ((rec.res_ratio || 0) > (ex.res_ratio || 0)) Object.assign(ex, rec); }
    else zips[zip].push(rec);
    rowCount++;
  }

  const zipKeys = Object.keys(zips);
  if (!zipKeys.length) fail("no ZIP rows parsed");
  // Sort each ZIP's counties by residential ratio (most common first).
  zipKeys.forEach((z) => zips[z].sort((a, b) => (b.res_ratio || 0) - (a.res_ratio || 0)));

  const datasetType = opts.datasetType || (rowCount >= ZIP_MIN_OFFICIAL ? "official" : "sample");
  const coverage = datasetType === "official" ? "official" : "partial-seed";

  return {
    schema: "zip-county-crosswalk",
    dataset_type: datasetType,
    coverage,
    source_name: "HUD USPS ZIP Code Crosswalk (ZIP-COUNTY)",
    source_file: opts.sourceFile || null,
    source_url_or_label: opts.sourceLabel || "https://www.huduser.gov/portal/datasets/usps_crosswalk.html",
    effective_year: year,
    imported_at: nowISO(),
    verified_at: opts.verified || null,
    record_count: zipKeys.length,
    pair_count: rowCount,
    multi_county_zips: zipKeys.filter((z) => zips[z].length > 1).length,
    unnamed_counties: missingName,
    note: "county_name joined from the official FHFA county FIPS list. ZIPs that cross county lines keep every county; the resolver asks the user to choose.",
    zips
  };
}

/* ---- CLI ---- */
function resolveInput(argPath) {
  if (argPath) return argPath;
  // Preferred: HUD-USPS ZIP-County crosswalk (with ratios). Fallback: official
  // HUD CHUMS ZIP file (starter, no ratios). Last: committed sample.
  const crosswalk = path.join(ROOT, "data/raw/2026/zip-county-crosswalk-2026.csv");
  const chums = path.join(ROOT, "data/raw/2026/hud-chums-zip-codes.txt");
  const sample = path.join(ROOT, "data/raw/2026/zip-county-crosswalk-2026.sample.csv");
  if (fs.existsSync(crosswalk)) return crosswalk;
  if (fs.existsSync(chums)) return chums;
  if (fs.existsSync(sample)) {
    info("⚠ Using the committed SAMPLE ZIP crosswalk (a few ZIPs only). ZIP intelligence");
    info("  stays GATED OFF in the resolver. Drop the official HUD USPS ZIP↔COUNTY export");
    info("  at data/raw/2026/zip-county-crosswalk-2026.csv to enable nationwide ZIP resolution.\n");
    return sample;
  }
  fail("no input file. Place the HUD-USPS ZIP-County crosswalk or HUD CHUMS ZIP file in data/raw/2026/.");
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
  opts.sourceFile = path.basename(file);
  info("Reading: " + path.relative(ROOT, file));

  let ds;
  if (/chums.*zip|zip.*\.txt$|\.txt$/i.test(file)) {
    // Official HUD CHUMS ZIP file (fixed-width, no ratios) — starter lookup.
    const fipsName = loadFhfaNames(opts.year);
    if (!Object.keys(fipsName).length) info("  ⚠ FHFA dataset not found — ZIP county names will use (titled) CHUMS names. Run import:fhfa first.");
    const parsed = parseChumsZip(fs.readFileSync(file, "utf8"), { fipsName });
    ds = buildZipDatasetFromChums(parsed, opts);
  } else {
    if (/\.sample\.csv$/.test(file)) opts.datasetType = "sample"; // committed seed → never "official"
    ds = buildZipDataset(readCSV(file), opts);
  }

  const out = path.join(ROOT, "data/geo/us-zips.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Minified: this is a large data file loaded by the browser, not a human diff.
  fs.writeFileSync(out, JSON.stringify(ds) + "\n");
  info(`✔ Wrote ${path.relative(ROOT, out)}`);
  info("  ── ZIP import report ───────────────────────────────");
  info(`  dataset_type:       ${ds.dataset_type}  (coverage: ${ds.coverage})`);
  info(`  ZIPs:               ${ds.record_count}`);
  info(`  ZIP/county pairs:   ${ds.pair_count}`);
  info(`  multi-county ZIPs:  ${ds.multi_county_zips}`);
  if (ds.dataset_type === "official_starter") {
    info("  ✔ Official HUD CHUMS ZIP starter — single-county ZIPs auto-resolve; multi-county ZIPs ask the user (no ratio confidence).");
    info("    Import the HUD-USPS ZIP-County Crosswalk later for multi-county ratio/confidence.");
  } else if (ds.dataset_type !== "official") {
    info("  ⚠ SAMPLE crosswalk — ZIP resolution stays GATED OFF until an official ZIP file is imported.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
