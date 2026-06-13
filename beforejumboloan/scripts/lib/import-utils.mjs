/* Shared helpers for the loan-limit import scripts.
   No invented data — these only parse, normalize, and validate official files. */
import fs from "node:fs";

export function fail(msg) {
  console.error("\n✖ IMPORT FAILED: " + msg + "\n");
  process.exit(1);
}
export function info(msg) { console.log(msg); }

/* RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop fully-blank rows.
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

export function readCSV(path) {
  if (!fs.existsSync(path)) fail("file not found: " + path);
  return parseCSV(fs.readFileSync(path, "utf8"));
}

export function normHeader(h) {
  return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* Find the index of the first header matching any candidate (normalized). */
export function pickColumn(headerNorms, candidates) {
  for (const cand of candidates) {
    const idx = headerNorms.indexOf(cand);
    if (idx >= 0) return idx;
  }
  return -1;
}

/* Parse a money/integer cell ("$832,750" | "832,750" | "832750" | ""). */
export function parseAmount(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || /^(n\/?a|na|null|-)$/i.test(s)) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN; // NaN signals "present but invalid"
}

export function pad(n, len) {
  return String(n == null ? "" : n).trim().replace(/\.0$/, "").padStart(len, "0");
}

export function titleCase(s) {
  return String(s == null ? "" : s)
    .trim().toLowerCase()
    .replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
    .replace(/\bMsa\b/g, "MSA")
    .replace(/\bMd\b/g, "MD");
}

export function nowISO() { return new Date().toISOString(); }

export const COMPLIANCE =
  "Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch.";

/* Statutory special-exception areas (Alaska, Hawaii, Guam, U.S. Virgin Islands). */
export const SPECIAL_AREAS = new Set(["AK", "HI", "GU", "VI"]);

export const STATE_NAME = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands"
};
