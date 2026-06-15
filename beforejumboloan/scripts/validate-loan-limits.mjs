#!/usr/bin/env node
/* ============================================================
   validate-loan-limits.mjs  —  production-readiness gate
   `npm run validate:loan-limits`

   Exit 0 ONLY when the installed dataset is official, nationwide,
   and complete. Exits 1 (with reasons) while a sample is installed
   or anything required is missing — so it cannot be shipped by
   accident. Does NOT modify data.
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FHFA_MIN_OFFICIAL } from "./import-fhfa-limits.mjs";
import { FHA_MIN_OFFICIAL } from "./import-fha-limits.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const YEAR = Number((process.argv.find((a, i) => process.argv[i - 1] === "--year")) || 2026);

const REQUIRED_META = ["dataset_type", "source_name", "effective_year", "imported_at", "record_count"];

const fails = [];
const warns = [];
const note = (arr, m) => arr.push(m);

function load(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { note(fails, `missing dataset file: ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { note(fails, `invalid JSON in ${rel}: ${e.message}`); return null; }
}

function checkMeta(ds, label) {
  for (const k of REQUIRED_META) if (ds[k] == null) note(fails, `${label}: required metadata "${k}" is missing`);
}

const fhfa = load(`data/loan-limits/${YEAR}/fhfa-conforming.json`);
const fha = load(`data/loan-limits/${YEAR}/fha-forward.json`);

if (fhfa) {
  checkMeta(fhfa, "FHFA");
  if (fhfa.dataset_type !== "official_full")
    note(fails, `FHFA dataset_type is "${fhfa.dataset_type}" — official full FHFA import required before nationwide launch`);
  if ((fhfa.record_count || 0) < FHFA_MIN_OFFICIAL)
    note(fails, `FHFA record_count ${fhfa.record_count} is below the nationwide threshold (${FHFA_MIN_OFFICIAL})`);

  const noOne = (fhfa.counties || []).filter((c) => c.conforming_one_unit == null || c.conforming_one_unit <= 0);
  if (noOne.length) note(fails, `FHFA: ${noOne.length} counties missing/invalid one-unit limit`);

  const noUnits = (fhfa.counties || []).filter((c) =>
    c.conforming_two_unit == null || c.conforming_three_unit == null || c.conforming_four_unit == null);
  if (noUnits.length) note(fails, `FHFA: ${noUnits.length} counties missing 2–4 unit limits (units 1–4 must be populated)`);

  const seenFips = new Set(), seenKey = new Set();
  let dupFips = 0, dupKey = 0;
  for (const c of fhfa.counties || []) {
    if (seenFips.has(c.county_fips)) dupFips++; else seenFips.add(c.county_fips);
    const k = c.state_abbr + "|" + String(c.county_name).toLowerCase().replace(/\s+county$/, "");
    if (seenKey.has(k)) dupKey++; else seenKey.add(k);
  }
  if (dupFips) note(fails, `FHFA: ${dupFips} duplicate FIPS records`);
  if (dupKey) note(fails, `FHFA: ${dupKey} duplicate state/county records`);

  // County FIPS present + valid on every record.
  const badFips = (fhfa.counties || []).filter((c) => !/^\d{5}$/.test(String(c.county_fips || "")));
  if (badFips.length) note(fails, `FHFA: ${badFips.length} counties missing/invalid county FIPS`);

  // Baseline/high-cost labeling must be correct (high_cost iff one-unit > baseline).
  const baseOne = fhfa.baseline && fhfa.baseline.one_unit;
  if (baseOne != null) {
    const badLabel = (fhfa.counties || []).filter((c) => !!c.high_cost !== (c.conforming_one_unit > baseOne));
    if (badLabel.length) note(fails, `FHFA: ${badLabel.length} counties have wrong baseline/high-cost labeling`);
  }

  // State coverage + the must-be-complete states from the official source.
  const perState = {};
  for (const c of fhfa.counties || []) perState[c.state_abbr] = (perState[c.state_abbr] || 0) + 1;
  const states = Object.keys(perState).length;
  if (states < 51) note(fails, `FHFA covers ${states} states/territories — official full data spans 50 states + DC (and territories)`);
  const REQUIRED = { CA: 58, FL: 67, TX: 254 }; // official county counts
  for (const [st, n] of Object.entries(REQUIRED)) {
    if ((perState[st] || 0) < n) note(fails, `FHFA: ${st} has ${perState[st] || 0} counties — official source has ${n}`);
  }
}

if (fha) {
  checkMeta(fha, "FHA");
  if (fha.dataset_type !== "official_full")
    note(fails, `FHA dataset_type is "${fha.dataset_type}" — official full HUD/FHA import required before nationwide launch`);
  if ((fha.record_count || 0) < FHA_MIN_OFFICIAL)
    note(fails, `FHA record_count ${fha.record_count} is below the nationwide threshold (${FHA_MIN_OFFICIAL})`);
  const noOne = (fha.counties || []).filter((c) => c.fha_one_unit == null || c.fha_one_unit <= 0);
  if (noOne.length) note(fails, `FHA: ${noOne.length} counties missing/invalid one-family limit`);
}

/* ---- report ---- */
console.log("Loan-limit production readiness — year " + YEAR);
console.log("  FHFA: " + (fhfa ? `${fhfa.dataset_type}, ${fhfa.record_count} records` : "MISSING"));
console.log("  FHA:  " + (fha ? `${fha.dataset_type}, ${fha.record_count} records` : "MISSING"));
warns.forEach((w) => console.log("  ⚠ " + w));

if (fails.length) {
  console.error("\n✖ NOT PRODUCTION READY:");
  fails.forEach((f) => console.error("  - " + f));
  console.error("\nInstall the official full files (see data/loan-limits/IMPORT.md) and re-run.\n");
  process.exit(1);
}
console.log("\n✔ PRODUCTION READY: official nationwide loan-limit data installed.\n");
