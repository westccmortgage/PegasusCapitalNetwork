#!/usr/bin/env node
/* ============================================================================
   PEGASUS CAPITAL INTELLIGENCE — QA audit
   Run: npm run qa:intelligence          (after npm install — needs exceljs)

   OFFLINE (always runs):
     • static wiring: files, netlify.toml rewrite + no-store headers, noindex,
       sidebar link, member intelligence.html untouched by pci code
     • unit tests over the import core: normalization, keys, file checks,
       row validation, dedupe/conflict/confidence planning
     • exceljs round-trip: generated fixture parses through the real parser
   LIVE (only when SUPABASE_URL + SUPABASE_ANON_KEY are set):
     • anon client is blocked by RLS from every pci_ table
   Exit code 0 = all pass.
   ============================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const core = require(path.join(ROOT, "netlify/functions/lib/intelligence-import-core.js"));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " =="); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ── 1. Static wiring ── */
section("Static wiring");
["admin-intelligence.html", "css/admin-intelligence.css",
  "js/intelligence/intelligence-api.js", "js/intelligence/admin-intelligence.js",
  "netlify/functions/intelligence-import-preview.js", "netlify/functions/intelligence-import-commit.js",
  "netlify/functions/intelligence-import-rollback.js", "netlify/functions/intelligence-import-batch.js",
  "netlify/functions/intelligence-template.js", "netlify/functions/lib/intelligence-import-core.js",
  "netlify/functions/lib/intelligence-workbook.js", "netlify/functions/lib/intelligence-auth.js",
  "supabase/067_crm_intelligence_fields.sql", "supabase/068_pci_core.sql",
  "supabase/069_pci_import.sql", "supabase/070_pci_storage_health.sql",
  "docs/CAPITAL-INTELLIGENCE.md", "docs/CAPITAL-INTELLIGENCE-IMPORT.md",
].forEach((f) => ok("exists: " + f, fs.existsSync(path.join(ROOT, f))));

const toml = read("netlify.toml");
ok("netlify.toml rewrites /admin/intelligence", /from = "\/admin\/intelligence"[\s\S]{0,80}to = "\/admin-intelligence\.html"/.test(toml));
ok("netlify.toml no-store on admin page", /for = "\/admin-intelligence\.html"[\s\S]{0,160}no-store/.test(toml));
ok("netlify.toml X-Robots-Tag on admin page", /for = "\/admin-intelligence\.html"[\s\S]{0,220}X-Robots-Tag/.test(toml));
const page = read("admin-intelligence.html");
ok("admin page has meta noindex", /name="robots" content="noindex,nofollow"/.test(page));
ok("admin page double-gates (store + live re-check)", /verifyAdmin/.test(page) && /PegStore/.test(page));
const corejs = read("js/pegasus-core.js");
ok("sidebar has admin Capital Intelligence link", corejs.indexOf("'/admin/intelligence'") >= 0 || corejs.indexOf('"/admin/intelligence"') >= 0);
const memberIntel = read("intelligence.html");
ok("member intelligence.html untouched by pci module", memberIntel.indexOf("pci_") < 0 && memberIntel.indexOf("PegIntel") < 0);
const crm = read("js/crm/crm.js");
ok("CRM bug fixed: no pegasus_user_id references", crm.indexOf("pegasus_user_id") < 0);
ok("CRM picker no longer selects profiles.email", !/from\('profiles'\)\.select\([^)]*email/.test(crm));
ok("CRM picker uses linked_profile_id", /linked_profile_id/.test(crm));
const pkg = JSON.parse(read("package.json"));
ok("exceljs dependency declared", !!(pkg.dependencies && pkg.dependencies.exceljs));
ok("service key never referenced in browser js/", (() => {
  const scan = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? scan(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  return !scan(path.join(ROOT, "js")).some((f) => f.endsWith(".js") && fs.readFileSync(f, "utf8").indexOf("SERVICE_ROLE") >= 0);
})());

/* ── 2. Normalization unit tests ── */
section("Normalization");
ok("percent 0.065 → 6.5", core.normPercent(0.065) === 6.5);
ok("percent 6.5 → 6.5", core.normPercent(6.5) === 6.5);
ok("percent '92' → 92", core.normPercent("92") === 92);
ok("percent 1 → 100 (fraction rule)", core.normPercent(1) === 100);
ok("percent 250 → invalid", Number.isNaN(core.normPercent(250)));
ok("currency '$5,250,000' → 5250000", core.normNumber("$5,250,000") === 5250000);
ok("currency '(1,000)' → -1000", core.normNumber("(1,000)") === -1000);
ok("blank stays null (never 0)", core.normNumber("") === null && core.normNumber("   ") === null && core.normPercent(null) === null);
ok("date '2026-02-01' ok", core.normDate("2026-02-01") === "2026-02-01");
ok("date '2/1/2026' ok", core.normDate("2/1/2026") === "2026-02-01");
ok("date '13/45/2026' invalid", Number.isNaN(core.normDate("13/45/2026")));
ok("date year 1800 rejected", Number.isNaN(core.normDate("1800-01-01")));
ok("bool yes/no/1/0", core.normBool("Yes") === true && core.normBool("no") === false && core.normBool(1) === true && core.normBool("0") === false);
ok("bool 'maybe' invalid", Number.isNaN(core.normBool("maybe")));
ok("confidence case-insensitive", core.normConfidence("verified") === "Verified");
ok("confidence invalid rejected", Number.isNaN(core.normConfidence("Sure")));
ok("url adds https + blocks javascript:", core.normUrl("example.com/x") === "https://example.com/x" && Number.isNaN(core.normUrl("javascript:alert(1)")));
ok("confidence ladder", core.confidenceRank("Verified") > core.confidenceRank("Reported") &&
  core.confidenceRank("Reported") > core.confidenceRank("Estimated") &&
  core.confidenceRank("Estimated") > core.confidenceRank("Unknown"));

section("Keys & dedupe identity");
ok("address normalization unifies suffix/case", core.normalizeAddress("123 Example Street", "West Palm Beach", "FL", "33401")
  === core.normalizeAddress("123 example st.", "WEST PALM BEACH", "fl", "33401-1234"));
ok("property key priority parcel > ext > addr",
  core.propertyKeyOf({ parcel_id: "00-1", external_id: "E1", address_line1: "1 A St", city: "X" }).startsWith("parcel:") &&
  core.propertyKeyOf({ external_id: "E1", address_line1: "1 A St", city: "X" }).startsWith("ext:") &&
  core.propertyKeyOf({ address_line1: "1 A St", city: "X" }).startsWith("addr:"));
ok("contact key priority email > ext > name",
  core.contactKeyOf({ email: "A@B.com", external_id: "C1", name: "N" }) === "email:a@b.com" &&
  core.contactKeyOf({ external_id: "C1", name: "N" }).startsWith("ext:") &&
  core.contactKeyOf({ name: "Jane", company: "Acme" }).startsWith("name:"));

/* ── 3. File checks ── */
section("File-level safety");
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const cfb = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
ok("valid zip magic accepted", core.checkFile("a.xlsx", zip).length === 0);
ok(".xls legacy rejected", core.checkFile("a.xls", cfb).length > 0);
ok(".xlsm rejected by name", core.checkFile("a.xlsm", zip).length > 0);
ok("macro content rejected", core.checkFile("a.xlsx", Buffer.concat([zip, Buffer.from("xl/vbaProject.bin")])).length > 0);
ok("oversize rejected", core.checkFile("a.xlsx", Buffer.alloc(core.MAX_FILE_BYTES + 1, 1)).length > 0);
ok("non-zip rejected", core.checkFile("a.xlsx", Buffer.from("PLAINTEXT")).length > 0);

/* ── 4. Row validation ── */
section("Row validation");
const rowOk = core.normalizeRow("Properties", { address: "1 Main St", city: "WPB", confidence: "Reported", caprate_pct: undefined, askingprice: "$5,000,000" }, 2);
ok("valid property row parses", rowOk.errors.length === 0 && rowOk.data.asking_price === 5000000);
const rowBad = core.normalizeRow("Properties", { city: "WPB" }, 3);
ok("missing address flagged", rowBad.errors.some((e) => /address_line1/.test(e)));
const rowF = core.normalizeRow("Properties", { address: "1 Main St", city: "WPB", "__formula__askingprice": true }, 4);
ok("formula cell flagged", rowF.errors.some((e) => /formula/i.test(e)));
const sigBad = core.normalizeRow("Distress_Signals", { propertykey: "X", signaltype: "weird_thing" }, 2);
ok("bad signal type flagged", sigBad.errors.some((e) => /Signal_Type/.test(e)));
const updBad = core.normalizeRow("Property_Updates", { propertykey: "X", fieldname: "parcel_id", newvalue: "1" }, 2);
ok("non-updatable field flagged", updBad.errors.some((e) => /not updatable/.test(e)));

/* ── 5. Action planning: insert / unchanged / update / conflict ── */
section("Action planning");
let n = 0;
const ctx = { adminId: "00000000-0000-0000-0000-00000000adm1", today: "2026-02-02", genId: () => "00000000-0000-0000-0000-" + String(++n).padStart(12, "0") };
function planFixtureRows(existing) {
  const rows = {
    Contacts: [core.normalizeRow("Contacts", { name: "Test Broker", company: "QA Brokerage LLC", email: "test.broker@example.com", confidence: "Verified" }, 2)],
    Properties: [core.normalizeRow("Properties", { externalid: "QA-PROP-1", address: "123 Example Street", city: "West Palm Beach", state: "FL", zip: "33401", askingprice: "$5,250,000", confidence: "Reported", opportunityscore: 82, sourceurl: "https://example.com/s1" }, 2)],
    Loans: [core.normalizeRow("Loans", { propertykey: "QA-PROP-1", lendercontactkey: "test.broker@example.com", originalamount: 3600000, instrumentnumber: "QA-1", confidence: "Reported" }, 2)],
  };
  return core.planActions(rows, existing, ctx);
}
const p1 = planFixtureRows({});
ok("fresh file → inserts (contact, property, loan, score, source)",
  p1.summary.insert >= 5 && p1.summary.conflict === 0 && p1.summary.invalid === 0);
const propRow = p1.rows.find((r) => r.target_type === "property");
const loanRow = p1.rows.find((r) => r.target_type === "loan");
ok("same-batch loan references pre-generated property id",
  !!(loanRow && loanRow.after_data && propRow && propRow.after_data) && loanRow.after_data.property_id === propRow.after_data.id);
const scoreRow = p1.rows.find((r) => r.target_type === "score");
ok("score snapshot generated with threshold recommendation",
  scoreRow && scoreRow.after_data.total_score === 82 && scoreRow.after_data.recommendation === "Act Now");

// Re-import identical file against "existing" DB state → unchanged.
const existing1 = {
  contacts: new Map([["email:test.broker@example.com", { id: "C-1", record: { name: "Test Broker", company: "QA Brokerage LLC", email: "test.broker@example.com", data_confidence: "Verified" } }]]),
  properties: new Map([["ext:QA-PROP-1", { id: "P-1", record: { external_id: "QA-PROP-1", address_line1: "123 Example Street", normalized_address: core.normalizeAddress("123 Example Street", "West Palm Beach", "FL", "33401"), city: "West Palm Beach", state: "FL", postal_code: "33401", county: "Palm Beach", asking_price: 5250000, opportunity_score: 82, data_confidence: "Reported", source_url: "https://example.com/s1", first_seen_at: "2026-02-02", last_seen_at: "2026-02-02" } }],
    ["addr:" + core.normalizeAddress("123 Example Street", "West Palm Beach", "FL", "33401"), { id: "P-1", record: {} }]]),
  loans: new Map([["instr:QA1", { id: "L-1", record: { property_id: "P-1", lender_contact_id: "C-1", original_amount: 3600000, instrument_number: "QA-1", confidence: "Reported" } }]]),
  sources: new Map([["url:example.com/s1", { id: "S-1", record: {} }]]),
};
const p2 = planFixtureRows(existing1);
ok("identical re-import → all unchanged", p2.summary.insert === 0 && p2.summary.update === 0 &&
  p2.summary.conflict === 0 && p2.summary.unchanged >= 3, JSON.stringify(p2.summary));

// Price change at same confidence (time-varying) → update + listing event.
const existing2 = JSON.parse(JSON.stringify({}));
const e2 = {
  contacts: existing1.contacts,
  properties: new Map(existing1.properties),
  loans: existing1.loans, sources: existing1.sources,
};
e2.properties.set("ext:QA-PROP-1", { id: "P-1", record: Object.assign({}, existing1.properties.get("ext:QA-PROP-1").record, { asking_price: 5600000 }) });
const p3 = planFixtureRows(e2);
const upd = p3.rows.find((r) => r.target_type === "property" && r.proposed_action === "update");
ok("same-confidence price change → update", !!upd && upd.after_data.asking_price === 5250000);
ok("price change synthesizes a listing event", p3.rows.some((r) => r.target_type === "listing" && r.proposed_action === "insert"));

// Estimated must NOT overwrite Verified → conflict.
const e3 = { contacts: existing1.contacts, properties: new Map(existing1.properties), loans: existing1.loans, sources: existing1.sources };
e3.properties.set("ext:QA-PROP-1", { id: "P-1", record: Object.assign({}, existing1.properties.get("ext:QA-PROP-1").record, { asking_price: 5600000, data_confidence: "Verified" }) });
const p4 = planFixtureRows(e3);
ok("lower confidence over Verified → conflict", p4.rows.some((r) => r.target_type === "property" && r.proposed_action === "conflict"));

// Same-confidence change to a NON-time-varying field → conflict.
const e4 = { contacts: existing1.contacts, properties: new Map(existing1.properties), loans: existing1.loans, sources: existing1.sources };
e4.properties.set("ext:QA-PROP-1", { id: "P-1", record: Object.assign({}, existing1.properties.get("ext:QA-PROP-1").record, { year_built: 1988 }) });
const rowsY = { Properties: [core.normalizeRow("Properties", { externalid: "QA-PROP-1", address: "123 Example Street", city: "West Palm Beach", state: "FL", zip: "33401", yearbuilt: 1994, confidence: "Reported" }, 2)] };
const p5 = core.planActions(rowsY, e4, ctx);
ok("same-confidence non-time-varying change → conflict", p5.rows.some((r) => r.proposed_action === "conflict" && /year_built/.test((r.validation_errors || []).join(" "))));

// In-file duplicate rows → invalid.
const dupRows = { Properties: [
  core.normalizeRow("Properties", { externalid: "D1", address: "9 Dup St", city: "X" }, 2),
  core.normalizeRow("Properties", { externalid: "D1", address: "9 Dup St", city: "X" }, 3)] };
const p6 = core.planActions(dupRows, {}, ctx);
ok("duplicate in-file property → invalid", p6.summary.invalid === 1 && p6.summary.insert >= 1);

// Property_Updates against existing property.
const updRows = { Property_Updates: [core.normalizeRow("Property_Updates", { propertykey: "QA-PROP-1", fieldname: "asking_price", newvalue: "$4,950,000", confidence: "Reported", effectivedate: "2026-02-01" }, 2)] };
const p7 = core.planActions(updRows, { properties: existing1.properties }, ctx);
ok("Property_Updates → single-field update", p7.rows.some((r) => r.target_type === "property_update" && r.proposed_action === "update" && r.after_data.asking_price === 4950000));
ok("Property_Updates price → listing event", p7.rows.some((r) => r.target_type === "listing"));
const updMissing = core.planActions({ Property_Updates: [core.normalizeRow("Property_Updates", { propertykey: "NOPE-1", fieldname: "asking_price", newvalue: "1" }, 2)] }, {}, ctx);
ok("Property_Updates unknown key → invalid", updMissing.summary.invalid === 1);

/* ── 6. exceljs round-trip through the real parser ── */
section("Workbook round-trip (exceljs)");
(async () => {
  try {
    const ExcelJS = require("exceljs");
    const wbLib = require(path.join(ROOT, "netlify/functions/lib/intelligence-workbook.js"));
    const preview = require(path.join(ROOT, "netlify/functions/intelligence-import-preview.js"));
    const tplBuf = Buffer.from(await wbLib.buildTemplate(ExcelJS));
    ok("template generates and is a zip", core.isZipMagic(tplBuf) && core.checkFile("t.xlsx", tplBuf).length === 0);
    const fixBuf = Buffer.from(await wbLib.buildFixture(ExcelJS));
    ok("fixture generates", core.isZipMagic(fixBuf));
    const parsed = await preview._parseWorkbook(fixBuf);
    ok("fixture parses with all 9 sheets", parsed.found.length === 9, "found: " + parsed.found.join(","));
    const badRows = Object.values(parsed.bySheet).flat().filter((r) => r.errors.length);
    ok("fixture rows all valid", badRows.length === 0, JSON.stringify(badRows.map((r) => r.errors)).slice(0, 300));
    let m = 0;
    const plan = core.planActions(parsed.bySheet, {}, { adminId: "00000000-0000-0000-0000-00000000adm1", today: "2026-02-02", genId: () => "00000000-0000-0000-0000-" + String(++m + 500).padStart(12, "0") });
    ok("fixture plans cleanly (no invalid, no conflict)", plan.summary.invalid === 0 && plan.summary.conflict === 0, JSON.stringify(plan.summary));
    ok("fixture yields expected inserts (props, contacts, loan, tenant, signal, program, action, sources, score)",
      plan.summary.insert >= 11, "inserts: " + plan.summary.insert);
    const fixLoan = plan.rows.find((r) => r.target_type === "loan");
    const fixProp = plan.rows.find((r) => r.target_type === "property" && r.after_data.external_id === "QA-PROP-1");
    ok("fixture loan wired to fixture property", fixLoan && fixProp && fixLoan.after_data.property_id === fixProp.after_data.id);

    /* ── 7. Optional live RLS probe ── */
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      section("Live RLS probe (anon)");
      const { createClient } = require("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      for (const t of ["pci_properties", "pci_loans", "pci_import_batches", "pci_change_log"]) {
        const r = await anon.from(t).select("id").limit(1);
        ok("anon blocked from " + t, !!r.error || (r.data || []).length === 0, r.error ? r.error.message : "returned rows!");
      }
    } else {
      console.log("\n(live RLS probe skipped — set SUPABASE_URL + SUPABASE_ANON_KEY to enable)");
    }

    console.log("\n──────────────────────────────");
    console.log("PASS " + pass + " · FAIL " + fail);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("  ✗ round-trip crashed — " + e.message);
    process.exit(1);
  }
})();
