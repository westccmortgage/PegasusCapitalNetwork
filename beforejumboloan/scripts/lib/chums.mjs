/* ============================================================
   chums.mjs — parsers for HUD CHUMS fixed-width data files.
   No invented data: these only read official HUD CHUMS exports and
   rebuild 5-digit county FIPS from the documented state-abbr + county
   code columns. County NAMES are backfilled (untruncated) from the
   official FHFA county list when a FIPS index is supplied.

   Field offsets were verified against the CY2026 CHUMS files:
     • Forward limits (cy2026-forward-limits.txt)
     • ZIP codes      (ZIP.txt)
   ============================================================ */
import { STATE_FIPS, STATE_NAME, titleCase } from "./import-utils.mjs";

const intOrNull = (s) => {
  const n = Number(String(s == null ? "" : s).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const splitLines = (text) => String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");

/* Build a FIPS -> {county_name, state_name} index from an imported FHFA dataset
   object (authoritative, untruncated names). Optional. */
export function fipsNameIndex(fhfaDataset) {
  const idx = {};
  if (fhfaDataset && Array.isArray(fhfaDataset.counties)) {
    for (const c of fhfaDataset.counties) {
      if (/^\d{5}$/.test(String(c.county_fips || ""))) {
        idx[c.county_fips] = { county_name: c.county_name, state_name: c.state_name };
      }
    }
  }
  return idx;
}

/* HUD CHUMS Forward limits → rows-of-arrays with a synthetic header that the
   FHA importer's buildFhaDataset() can pick columns from. */
export function parseChumsForward(text, opts = {}) {
  const names = opts.fipsName || {};
  const header = ["fips", "county", "state", "onefamily", "twofamily", "threefamily", "fourfamily"];
  const rows = [header];
  for (const l of splitLines(text)) {
    if (l.length < 132) continue;                  // summary/ceiling/floor header rows
    const st = l.slice(101, 103).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(st) || !STATE_FIPS[st]) continue;
    const cc = l.slice(103, 106).replace(/\D/g, "");
    if (cc.length !== 3) continue;
    const fips = STATE_FIPS[st] + cc;
    const one = intOrNull(l.slice(73, 80));
    const two = intOrNull(l.slice(80, 87));
    const three = intOrNull(l.slice(87, 94));
    const four = intOrNull(l.slice(94, 101));
    const county = (names[fips] && names[fips].county_name) || titleCase(l.slice(132, 155).trim());
    rows.push([fips, county, st, one, two, three, four]);
  }
  return rows;
}

/* HUD CHUMS ZIP file → { zips: { "#####": [ {county...}, ... ] }, stats }.
   A ZIP that appears against more than one county becomes a multi-county ZIP
   (ambiguous). CHUMS carries NO residential-ratio fields, so ratios stay null
   and the resolver must ask the user to choose (no confidence claim). */
export function parseChumsZip(text, opts = {}) {
  const names = opts.fipsName || {};
  const zips = {};
  let pairs = 0;
  for (const l of splitLines(text)) {
    if (l.length < 35) continue;
    const zip = l.slice(4, 9);
    if (!/^\d{5}$/.test(zip)) continue;
    const st = l.slice(30, 32).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(st) || !STATE_FIPS[st]) continue;
    const cc = l.slice(32, 35).replace(/\D/g, "");
    if (cc.length !== 3) continue;
    const fips = STATE_FIPS[st] + cc;
    const county_name = (names[fips] && names[fips].county_name) ||
      (titleCase(l.slice(35, 50).trim()) + " County");
    const state_name = (names[fips] && names[fips].state_name) || STATE_NAME[st] || null;
    if (!zips[zip]) zips[zip] = [];
    if (zips[zip].some((x) => x.county_fips === fips)) continue;
    zips[zip].push({ county_fips: fips, county_name, state_abbr: st, state_name, res_ratio: null, tot_ratio: null });
    pairs++;
  }
  const keys = Object.keys(zips);
  return { zips, zip_count: keys.length, pair_count: pairs, multi_county_zips: keys.filter((z) => zips[z].length > 1).length };
}
