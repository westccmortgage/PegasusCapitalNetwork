#!/usr/bin/env node
/* ============================================================
   build-geo.mjs
   Derive data/geo/us-counties.json (the State→County selector data)
   from the imported FHFA county list — so the dropdown matches the
   official source. Keeps the existing states[] list intact.

   Usage: node scripts/build-geo.mjs [--year 2026]
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, info, nowISO } from "./lib/import-utils.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  let year = 2026;
  for (let i = 0; i < args.length; i++) if (args[i] === "--year") year = Number(args[++i]);

  const fhfaPath = path.join(ROOT, "data/loan-limits/" + year + "/fhfa-conforming.json");
  const geoPath = path.join(ROOT, "data/geo/us-counties.json");
  if (!fs.existsSync(fhfaPath)) fail("run import-fhfa-limits first: " + path.relative(ROOT, fhfaPath) + " not found");

  const fhfa = JSON.parse(fs.readFileSync(fhfaPath, "utf8"));
  const geo = fs.existsSync(geoPath) ? JSON.parse(fs.readFileSync(geoPath, "utf8")) : { states: [] };

  const counties = {};
  const seen = new Set();
  for (const c of fhfa.counties) {
    const st = c.state_abbr;
    const key = st + "|" + c.county_fips;
    if (seen.has(key)) continue;
    seen.add(key);
    (counties[st] = counties[st] || []).push({ name: c.county_name, fips: c.county_fips });
  }
  for (const st of Object.keys(counties)) counties[st].sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    source: "Derived from data/loan-limits/" + year + "/fhfa-conforming.json (official FHFA county list).",
    derived_at: nowISO(),
    note: geo.note || "States list is complete; counties are derived from the imported FHFA file.",
    states: geo.states,
    counties
  };
  fs.writeFileSync(geoPath, JSON.stringify(out, null, 2) + "\n");
  const total = Object.values(counties).reduce((a, arr) => a + arr.length, 0);
  info(`✔ Wrote ${path.relative(ROOT, geoPath)} — ${Object.keys(counties).length} states, ${total} counties`);
}

main();
