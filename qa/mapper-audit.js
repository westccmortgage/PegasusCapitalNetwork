#!/usr/bin/env node
/* ============================================================================
   PEGASUS — Universal Import Mapper QA
   Run: npm run qa:mapper            (needs exceljs)

   Covers the acceptance list: exact Pegasus template, ChatGPT-style headers,
   LinkedIn CSV, DRE export, missing required, invalid enums, duplicate
   licenses, fuzzy-duplicate warning, saved profile reuse, malformed table
   relationships, namespace-prefixed XLSX, wrong-module guard + override, and
   provenance shaping. Atomic-commit + rollback for MAPPED rows are proven at
   the DB layer (qa/sql/pn-db-tests.sql, block PN-MAP).
   ============================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "netlify/functions/lib/import-mapper-core.js"));
const schemas = require(path.join(ROOT, "netlify/functions/lib/import-mapper-schemas.js"));
const P = schemas.DESCRIPTORS.partner, I = schemas.DESCRIPTORS.intelligence;

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); } }
function section(t) { console.log("\n== " + t + " =="); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let _id = 0; const genId = () => "00000000-0000-0000-0000-" + String(++_id).padStart(12, "0");
function sheet(name, headers, rows) { return { name: name, headers: headers, rows: rows, firstDataRow: 2 }; }
function plan(sheets, desc, mapping, existing) {
  const map = mapping || M.autoMap(sheets, desc);
  const applied = M.applyMapping(sheets, map, desc);
  const rows = M.buildPlannerRows(applied.canonical, desc);
  _id = 0;
  const p = desc.planActions(rows, existing || {}, { adminId: "00000000-0000-0000-0000-0000000000a1", today: "2026-07-11", genId: genId });
  return { map: map, applied: applied, plan: p, quality: M.qualityReport(applied.canonical, desc) };
}

/* ── Static wiring ── */
section("Static wiring");
[
  "netlify/functions/lib/import-mapper-core.js", "netlify/functions/lib/import-mapper-schemas.js",
  "netlify/functions/import-map-preview.js", "js/lib/import-mapper-ui.js",
  "supabase/075_pn_import_mapper.sql", "supabase/076_pci_import_mapper.sql",
].forEach((f) => ok("exists: " + f, fs.existsSync(path.join(ROOT, f))));
ok("partner API exposes mapPreview + profiles", /mapPreview/.test(read("js/partner-network/partner-api.js")) && /saveImportProfile/.test(read("js/partner-network/partner-api.js")));
ok("intelligence API exposes mapPreview + profiles", /mapPreview/.test(read("js/intelligence/intelligence-api.js")) && /saveImportProfile/.test(read("js/intelligence/intelligence-api.js")));
ok("both Import Centers expose Universal Import", /universalImport/.test(read("js/partner-network/admin-partner-network.js")) && /universalImport/.test(read("js/intelligence/admin-intelligence.js")));
ok("mapper UI script included on both pages", /import-mapper-ui\.js/.test(read("admin-partner-network.html")) && /import-mapper-ui\.js/.test(read("admin-intelligence.html")));

/* ── Borrower-data rejection + CSV encoding/delimiter (acceptance items) ── */
section("Borrower-data rejection + CSV encoding/delimiter");
ok("borrower fields detected (SSN / DOB / income / credit score)",
  M.borrowerFieldsPresent([sheet("X", ["Name", "SSN", "Date of Birth", "Credit Score"], [])]).length >= 3);
ok("clean partner file has no borrower fields", M.borrowerFieldsPresent([sheet("Agents", ["Full_Name", "Company", "DRE"], [])]).length === 0);
ok("map-preview rejects borrower data with the exact message",
  /This file appears to contain borrower or consumer lead data\. Use the authorized borrower CRM workflow instead\./.test(read("netlify/functions/import-map-preview.js")) &&
  /rejectBorrower/.test(read("netlify/functions/lib/import-mapper-schemas.js")));
{
  const bom = "﻿Agent Name;Brokerage;DRE\nJane;Coastal;01998877\n";
  const s = M.sheetFromCsv("x.csv", bom);
  ok("CSV: UTF-8 BOM stripped + semicolon delimiter detected", s.headers[0] === "Agent Name" && s.delimiter === ";" && s.rows.length === 1);
  const tab = "Agent Name\tBrokerage\tDRE\nBob\tSummit\t02011223\n";
  ok("CSV: tab delimiter detected", M.sheetFromCsv("x.csv", tab).delimiter === "\t" && M.sheetFromCsv("x.csv", tab).headers.length === 3);
  ok("CSV: quoted field with embedded delimiter + newline preserved",
    M.parseCsv('a,"b,c\nd",e\n')[0][1] === "b,c\nd");
}
ok("production upload routes through the mapper (partner primary input)",
  /mapChosen/.test(read("js/partner-network/admin-partner-network.js")) &&
  /openWithFile/.test(read("js/partner-network/admin-partner-network.js")) &&
  /onchange="PegPartner\.mapChosen/.test(read("js/partner-network/admin-partner-network.js")));
ok("native fast-path present (skip mapping for exact native template)",
  /Native Pegasus template detected/.test(read("js/lib/import-mapper-ui.js")) && /reviewMapping/.test(read("js/lib/import-mapper-ui.js")));

/* ── (1) exact Pegasus template ── */
section("(1) exact Pegasus template maps 1:1");
const peg = sheet("Agents", ["External_ID", "Full_Name", "Company", "License_Number", "Email", "Phone", "City"],
  [["X1", "Ann Lee", "BigCo", "01111111", "a@b.com", "6195551212", "Irvine"]]);
let r = plan([peg], P);
ok("Pegasus headers detected as Agents", r.map[0].entity === "Agents");
ok("all Pegasus columns map at full confidence", r.map[0].columns.filter((c) => c.target).every((c) => c.confidence === 1));
ok("Pegasus row plans as 1 insert, 0 invalid", r.plan.summary.insert === 1 && r.plan.summary.invalid === 0);

/* ── (2) ChatGPT workbook, different headers ── */
section("(2) ChatGPT-style headers (aliases)");
const chat = sheet("ChatGPT Agents",
  ["Agent Name", "Brokerage", "DRE Number", "Cell", "Work Email", "Market", "Production", "Sides"],
  [["Jane Rivera", "Coastal Realty", "01998877", "(619) 555-1000", "jane@coastal.com", "San Diego", "$25,000,000", "31"]]);
r = plan([chat], P);
ok("ChatGPT sheet detected as Agents", r.map[0].entity === "Agents", "got " + r.map[0].entity);
const cAg = r.plan.rows.find((x) => x.target_type === "agent");
ok("aliases mapped (name/brokerage/dre/cell/email/market/production/sides)",
  cAg && cAg.after_data.full_name === "Jane Rivera" && cAg.after_data.company_name_snapshot === "Coastal Realty" &&
  cAg.after_data.license_number === "01998877" && cAg.after_data.production_volume === 25000000 && cAg.after_data.deal_count === 31);

/* ── (3) LinkedIn CSV (combine First + Last) ── */
section("(3) LinkedIn-style CSV");
const li = M.sheetFromCsv("LinkedInExport.csv", "First Name,Last Name,Company,Position,Email Address,Profile URL\nMaria,Gomez,Keller Williams,Realtor,maria@kw.com,https://linkedin.com/in/maria\n");
ok("LinkedIn CSV parses (headers + 1 row)", li.headers.length === 6 && li.rows.length === 1);
const liAuto = M.autoMap([li], P);
ok("LinkedIn detected as Agents", liAuto[0].entity === "Agents", "got " + liAuto[0].entity);
const liMapping = [{ sheet: "LinkedInExport.csv", entity: "Agents", columns: [
  { source: "First Name", sourceIndex: 0, target: "Full_Name" }, { source: "Last Name", sourceIndex: 1, target: "Full_Name" },
  { source: "Company", sourceIndex: 2, target: "Company" }, { source: "Position", sourceIndex: 3, target: "Job_Title" },
  { source: "Email Address", sourceIndex: 4, target: "Email" }, { source: "Profile URL", sourceIndex: 5, target: "Website" } ] }];
r = plan([li], P, liMapping);
const liAg = r.plan.rows.find((x) => x.target_type === "agent");
ok("combine First + Last → Full_Name = \"Maria Gomez\"", liAg && liAg.after_data.full_name === "Maria Gomez");

/* ── (4) DRE-style export ── */
section("(4) DRE-style export");
const dre = sheet("DRE", ["License Number", "Licensee Name", "Mailing City", "License Status", "Broker/Office"],
  [["01234567", "SMITH, JOHN", "IRVINE", "Licensed", "ABC Realty Inc"]]);
r = plan([dre], P);
ok("DRE detected as Agents", r.map[0].entity === "Agents", "got " + r.map[0].entity);
ok("DRE license + name + company mapped",
  r.map[0].columns.find((c) => c.source === "License Number").target === "License_Number" &&
  r.map[0].columns.find((c) => c.source === "Licensee Name").target === "Full_Name" &&
  r.map[0].columns.find((c) => c.source === "Broker/Office").target === "Company");

/* ── (5) missing required fields ── */
section("(5) missing required fields");
const noName = sheet("A", ["Brokerage", "DRE", "Email"], [["Coastal", "01998877", "x@y.com"]]);
r = plan([noName], P, [{ sheet: "A", entity: "Agents", columns: [
  { source: "Brokerage", sourceIndex: 0, target: "Company" }, { source: "DRE", sourceIndex: 1, target: "License_Number" }, { source: "Email", sourceIndex: 2, target: "Email" } ] }]);
ok("missing Full_Name flagged as missingRequired (blocking)", r.quality.missingRequired.length === 1 && /full_name/i.test(r.quality.missingRequired[0].error));
ok("row with missing required is invalid in the plan", r.plan.summary.invalid === 1);

/* ── (6) invalid enums ── */
section("(6) invalid enums (priority + signal_type)");
ok("priority A/High/Med/C/2 → 1/1/2/3/2", [["A", 1], ["High", 1], ["Medium", 2], ["C", 3], ["2", 2]].every((x) => M.normPriorityLabel(x[0]) === x[1]));
ok("signal recent sale/just listed/price cut/moved brokerage map correctly",
  M.normSignalLabel("Recent Sale").value === "closed_deal" && M.normSignalLabel("Just Listed").value === "new_listing" &&
  M.normSignalLabel("price cut").value === "price_change" && M.normSignalLabel("moved brokerage").value === "brokerage_change");
const badSig = M.normSignalLabel("totally unknown thing");
ok("unmatched signal → other + warning", badSig.value === "other" && /not recognized/.test(badSig.warn));
const sigSheet = sheet("Sig", ["Contact", "Activity", "Date"], [["Jane Rivera", "totally unknown thing", "2026-02-01"]]);
r = plan([sigSheet], P, [{ sheet: "Sig", entity: "Activity_Signals", columns: [
  { source: "Contact", sourceIndex: 0, target: "Subject_Name" }, { source: "Activity", sourceIndex: 1, target: "Signal_Type" }, { source: "Date", sourceIndex: 2, target: "Signal_Date" } ] }]);
ok("unmatched signal surfaces a transform warning", r.applied.warnings.some((w) => /not recognized/.test(w.message)));

/* ── (7) duplicate licenses ── */
section("(7) duplicate licenses");
const dupLic = sheet("A", ["Full Name", "Company", "DRE"],
  [["Jane Rivera", "Coastal", "01998877"], ["Jane R.", "Coastal Realty", "01998877"], ["Bob Lee", "Summit", "02011223"]]);
r = plan([dupLic], P);
ok("in-file duplicate license → 1 invalid, 2 insert", r.plan.summary.insert === 2 && r.plan.summary.invalid === 1);
// against existing (dedupe → update, not a new insert)
const existing = { agents: new Map([["lic:01998877", { id: "00000000-0000-0000-0000-0000000000e1", record: { full_name: "Jane Rivera", license_number: "01998877", data_confidence: "Reported" } }]]) };
r = plan([sheet("A", ["Full Name", "Company", "DRE"], [["Jane Rivera", "Coastal Realty", "01998877"]])], P, null, existing);
const upd = r.plan.rows.find((x) => x.target_type === "agent");
ok("existing license → update, never a duplicate insert", upd && upd.proposed_action !== "insert", upd && upd.proposed_action);

/* ── (8) fuzzy duplicate warning (never auto-merge) ── */
section("(8) fuzzy duplicate warning");
const fz = sheet("A", ["Full Name", "Company", "DRE"],
  [["Jane Rivera", "Coastal", "01998877"], ["Jane Riveraa", "Coastal", "09999999"]]);
const fzApplied = M.applyMapping([fz], M.autoMap([fz], P), P);
const fzWarn = M.fuzzyDuplicates(fzApplied.canonical, P, {});
ok("near-duplicate name flagged for review (not merged)", fzWarn.length === 1 && fzWarn[0].score >= 0.8 && fzWarn[0].score < 1);
const fzPlan = plan([fz], P);
ok("fuzzy pair are two distinct inserts (no auto-merge)", fzPlan.plan.summary.insert === 2);

/* ── (9) saved profile reuse ── */
section("(9) saved profile reuse");
const savedMapping = { mapping_version: 1, sheets: [{ sheet: "ChatGPT Agents", entity: "Agents", columns: r0Columns() }] };
function r0Columns() { return [
  { source: "Agent Name", sourceIndex: 0, target: "Full_Name" }, { source: "Brokerage", sourceIndex: 1, target: "Company" },
  { source: "DRE Number", sourceIndex: 2, target: "License_Number" }, { source: "Cell", sourceIndex: 3, target: "Phone" },
  { source: "Work Email", sourceIndex: 4, target: "Email" }, { source: "Market", sourceIndex: 5, target: "City" },
  { source: "Production", sourceIndex: 6, target: "Production_Volume" }, { source: "Sides", sourceIndex: 7, target: "Deal_Count" } ]; }
const chat2 = sheet("ChatGPT Agents",
  ["Agent Name", "Brokerage", "DRE Number", "Cell", "Work Email", "Market", "Production", "Sides"],
  [["Nora Diaz", "Bayview", "03000001", "6195559000", "nora@bv.com", "Encinitas", "9000000", "12"]]);
ok("same header fingerprint matches the saved profile", M.fingerprint(chat.headers) === M.fingerprint(chat2.headers));
r = plan([chat2], P, savedMapping.sheets);
const savedAg = r.plan.rows.find((x) => x.target_type === "agent");
ok("saved profile applied to a new file yields correct mapping", savedAg && savedAg.after_data.full_name === "Nora Diaz" && savedAg.after_data.deal_count === 12);

/* ── (12) malformed table relationships (via extractSheets) ── */
section("(12) malformed table relationships tolerated");
(async () => {
  try {
    const ExcelJS = require("exceljs");
    const { injectDanglingTable } = require(path.join(ROOT, "qa/lib/malformed-table.js"));
    const mp = require(path.join(ROOT, "netlify/functions/import-map-preview.js"));
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Agent Name", "Brokerage", "DRE"]); ws.addRow(["Zed Kane", "Peak", "04000002"]);
    const bad = await injectDanglingTable(Buffer.from(await wb.xlsx.writeBuffer()));
    let crashed = false; try { const w2 = new ExcelJS.Workbook(); await w2.xlsx.load(bad); } catch (_) { crashed = true; }
    ok("raw ExcelJS crashes on the dangling table (repro)", crashed);
    const sheets = await mp._extractSheets("x.xlsx", bad);
    ok("mapper extractSheets reads the sheet despite dangling table", sheets.length === 1 && sheets[0].headers.indexOf("Agent Name") >= 0 && sheets[0].rows.length === 1);
    const am = M.autoMap(sheets, P);
    ok("mapper still detects + maps the recovered sheet", am[0].entity === "Agents");

    /* ── (13) namespace-prefixed XLSX headers ── */
    section("(13) namespace-prefixed XLSX headers (OOXML normalization)");
    const nsSheet = sheet("x:Agents", ["ss:Agent Name", "x:Brokerage", "DRE Number"], [["Uma Patel", "Crestline", "05000003"]]);
    const nsAuto = M.autoMap([nsSheet], P);
    ok("namespace-prefixed sheet detected as Agents", nsAuto[0].entity === "Agents", "got " + nsAuto[0].entity);
    ok("namespace-prefixed headers still map (prefix stripped)",
      nsAuto[0].columns.find((c) => /Agent Name/.test(c.source)).target === "Full_Name" &&
      nsAuto[0].columns.find((c) => /Brokerage/.test(c.source)).target === "Company");

    /* ── Wrong-module guard + override ── */
    section("Wrong-module guard + override");
    const cre = sheet("Sheet1", ["Address", "City", "Parcel ID", "Asking Price", "NOI", "Cap Rate"], [["1 Main", "WPB", "00-1", "5000000", "300000", "6"]]);
    const dm = schemas.detectModule([cre], "partner");
    ok("CRE file into Partner → wrong-module message", dm.wrongModule && /Capital Intelligence/.test(dm.message) && /\/admin\/intelligence/.test(dm.message));
    ok("Partner Agents file into Partner → not wrong-module", !schemas.detectModule([chat], "partner").wrongModule);
    ok("override path exists (generic contacts, manual entity)", /override/.test(read("netlify/functions/import-map-preview.js")) && /overrideWrong/.test(read("js/lib/import-mapper-ui.js")));

    /* ── Provenance shaping ── */
    section("Provenance retained per row");
    const provApplied = M.applyMapping([chat], M.autoMap([chat], P), P);
    ok("provenance keeps source sheet + row + raw JSON", provApplied.provenance.length === 1 &&
      provApplied.provenance[0].sourceSheet === "ChatGPT Agents" && provApplied.provenance[0].sourceRow === 2 &&
      provApplied.provenance[0].raw["Agent Name"] === "Jane Rivera");
    ok("map-preview stores source_sheet/source_row/source_raw + profile/version", /out\.source_sheet = prov\.sourceSheet/.test(read("netlify/functions/import-map-preview.js")) && /import_profile_id: profileId/.test(read("netlify/functions/import-map-preview.js")));

    /* ── Intelligence module descriptor also works ── */
    section("Shared framework — Capital Intelligence module");
    const prop = sheet("Retail", ["Property", "Street Address", "City", "Parcel", "List Price", "NOI", "Cap Rate"],
      [["Sunrise Plaza", "100 Ocean Dr", "West Palm Beach", "00-42-1", "5250000", "315000", "6.0"]]);
    const ir = plan([prop], I);
    ok("CRE headers detected as Properties", ir.map[0].entity === "Properties", "got " + ir.map[0].entity);
    const pr = ir.plan.rows.find((x) => x.target_type === "property");
    ok("CRE property mapped (address/price/noi)", pr && pr.after_data.asking_price === 5250000 && pr.after_data.noi === 315000);
    ok("CI descriptor never references pn_ entities", !Object.keys(I.entities).some((e) => ["Agents", "Escrow_Title", "Do_Not_Contact"].includes(e)));

    /* ── Native workbook → strict native importer (mapper models only a subset) ── */
    section("Native workbook routes to the strict native importer");
    const nativeIntel = ["Properties", "Property_Updates", "Contacts", "Property_Contacts", "Loans", "Tenants", "Distress_Signals", "Lender_Programs", "Daily_Actions"].map((n) => ({ name: n }));
    const intelHit = mp._nativeOnlySheetsPresent("intelligence", nativeIntel);
    ok("native CI workbook flagged for the strict importer", intelHit.length > 0 && ["Tenants", "Distress_Signals", "Property_Contacts", "Property_Updates", "Daily_Actions"].every((s) => intelHit.includes(s)));
    ok("CI file with only mapper-covered sheets stays in the mapper",
      mp._nativeOnlySheetsPresent("intelligence", [{ name: "Properties" }, { name: "Contacts" }, { name: "Loans" }]).length === 0);
    ok("a lone coincidental native sheet name is NOT diverted (needs ≥2)",
      mp._nativeOnlySheetsPresent("intelligence", [{ name: "Tenants" }]).length === 0);
    ok("Partner native workbook is never diverted (mapper covers all 6 entities)",
      mp._nativeOnlySheetsPresent("partner", ["Agents", "Escrow_Title", "Companies", "Activity_Signals", "Outreach_Actions", "Do_Not_Contact"].map((n) => ({ name: n }))).length === 0);
    ok("mapper UI hands a native file to onNative + strict importer wired in admin",
      /phase === "native"/.test(read("js/lib/import-mapper-ui.js")) && /onNative: handleFile/.test(read("js/intelligence/admin-intelligence.js")));
    const fpe = require(path.join(ROOT, "netlify/functions/lib/xlsx-sanitize.js")).friendlyParseError;
    ok("cryptic ExcelJS parse error becomes actionable guidance",
      /Save As|Download Import Template/.test(fpe(new Error("Cannot read properties of undefined (reading 'sheets')"))));

    /* ── DB proofs (optional) ── */
    section("DB-level proofs (optional)");
    const sqlPath = path.join(ROOT, "qa/sql/pn-db-tests.sql");
    ok("mapper DB proofs present (pn-db-tests PN-MAP block)", fs.existsSync(sqlPath) && /PN-MAP/.test(fs.readFileSync(sqlPath, "utf8")));
    if (process.env.PCI_DB_TESTS === "1") {
      const { spawnSync } = require("child_process");
      const rr = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-f", sqlPath], { cwd: ROOT, encoding: "utf8" });
      const passed = rr.status === 0 && /ALL PN DB-LEVEL PROOFS PASSED/.test((rr.stdout || "") + (rr.stderr || ""));
      ok("psql: mapped-batch atomic commit + rollback (PN-MAP)", passed, passed ? "" : ((rr.stderr || rr.stdout || "psql unavailable").split("\n").filter(Boolean).slice(-3).join(" | ")));
    } else {
      console.log("  (db proofs skipped — run `PCI_DB_TESTS=1 <PG env> npm run qa:mapper`)");
    }

    console.log("\n──────────────────────────────");
    console.log("PASS " + pass + " · FAIL " + fail);
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error("FATAL", e); process.exit(1); }
})();
