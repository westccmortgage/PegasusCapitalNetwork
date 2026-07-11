#!/usr/bin/env node
/* ============================================================================
   PEGASUS CALIFORNIA PARTNER NETWORK — QA audit
   Run: npm run qa:partner            (after npm install — needs exceljs)

   OFFLINE (always runs):
     • static wiring: files, netlify.toml route + no-store headers, noindex,
       sidebar link, admin gate
     • unit tests over the partner import core: contract, planner, dedupe,
       cross-workbook rejection, "no borrower records / no CRM creation"
     • exceljs round-trip: the CA fixture parses + plans cleanly
   LIVE (only when SUPABASE_URL + SUPABASE_ANON_KEY are set):
     • anon client is blocked by RLS from every pn_ table
   Optional DB proofs: PCI_DB_TESTS=1 runs qa/sql/pn-db-tests.sql via psql.
   Exit code 0 = all pass.
   ============================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const core = require(path.join(ROOT, "netlify/functions/lib/partner-import-core.js"));
const icore = require(path.join(ROOT, "netlify/functions/lib/intelligence-import-core.js"));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " =="); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ── 1. Static wiring ── */
section("Static wiring");
[
  "admin-partner-network.html", "js/partner-network/partner-api.js",
  "js/partner-network/admin-partner-network.js",
  "netlify/functions/partner-import-preview.js", "netlify/functions/partner-import-commit.js",
  "netlify/functions/partner-import-rollback.js", "netlify/functions/partner-import-batch.js",
  "netlify/functions/partner-template.js", "netlify/functions/lib/partner-import-core.js",
  "netlify/functions/lib/partner-workbook.js",
  "supabase/072_pn_core.sql", "supabase/073_pn_import.sql", "supabase/074_pn_storage_health.sql",
  "qa/sql/pn-db-tests.sql",
].forEach((f) => ok("exists: " + f, fs.existsSync(path.join(ROOT, f))));

const toml = read("netlify.toml");
ok("netlify.toml rewrites /admin/partner-network", /from = "\/admin\/partner-network"[\s\S]{0,90}to = "\/admin-partner-network\.html"/.test(toml));
ok("netlify.toml no-store on partner page", /for = "\/admin-partner-network\.html"[\s\S]{0,160}no-store/.test(toml));
ok("netlify.toml X-Robots-Tag on partner page", /for = "\/admin-partner-network\.html"[\s\S]{0,220}X-Robots-Tag/.test(toml));
const page = read("admin-partner-network.html");
ok("partner page has meta noindex", /name="robots" content="noindex,nofollow"/.test(page));
ok("partner page double-gates (store + live admin re-check)", /verifyAdmin/.test(page) && /PegStore/.test(page));
ok("partner page is admin-only (redirect non-admins)", /if\(!_isAdmin\)/.test(page) && /dashboard\.html/.test(page));
const corejs = read("js/pegasus-core.js");
ok("sidebar has admin Partner Network link", corejs.indexOf("'/admin/partner-network'") >= 0 || corejs.indexOf('"/admin/partner-network"') >= 0);

/* ── 2. Contract ── */
section("Import contract — exactly 6 sheets");
const SHEET_NAMES = Object.keys(core.SHEETS);
ok("contract has exactly the 6 required sheets",
  JSON.stringify(SHEET_NAMES.sort()) === JSON.stringify(["Activity_Signals", "Agents", "Companies", "Do_Not_Contact", "Escrow_Title", "Outreach_Actions"].sort()),
  SHEET_NAMES.join(","));
["Agents", "Escrow_Title", "Companies", "Activity_Signals", "Outreach_Actions", "Do_Not_Contact"]
  .forEach((s) => ok("accepts sheet: " + s, !!core.SHEETS[s]));

/* ── 3. File safety (shared with intelligence core) ── */
section("File-level safety");
ok("rejects .xls", core.checkFile("x.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0])).length > 0);
ok("rejects macro workbook (vbaProject)", core.checkFile("x.xlsx", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("vbaProject")])).length > 0);
ok("rejects non-zip", core.checkFile("x.xlsx", Buffer.from("not a zip")).length > 0);

/* ── 4. Round-trip: CA fixture imports successfully (required test #6) ── */
section("Issue 1 test #6: California workbook imports successfully in Partner Network");
(async () => {
  try {
    const ExcelJS = require("exceljs");
    const wbLib = require(path.join(ROOT, "netlify/functions/lib/partner-workbook.js"));
    const preview = require(path.join(ROOT, "netlify/functions/partner-import-preview.js"));

    const tplBuf = Buffer.from(await wbLib.buildTemplate(ExcelJS));
    ok("template generates and is a valid zip", core.checkFile("t.xlsx", tplBuf).length === 0);
    const fixBuf = Buffer.from(await wbLib.buildFixture(ExcelJS));
    const parsed = await preview._parseWorkbook(fixBuf);
    ok("CA fixture parses with all 6 sheets", parsed.found.length === 6, "found: " + parsed.found.join(","));
    const badRows = Object.values(parsed.bySheet).flat().filter((r) => r.errors.length);
    ok("CA fixture rows all valid", badRows.length === 0, JSON.stringify(badRows.map((r) => r.errors)).slice(0, 300));

    let m = 0;
    const plan = core.planActions(parsed.bySheet, {}, {
      adminId: "00000000-0000-0000-0000-00000000adm1", today: "2026-07-11",
      genId: () => "00000000-0000-0000-0000-" + String(++m + 700).padStart(12, "0"),
    });
    ok("#6 CA fixture plans cleanly (no invalid, no conflict)", plan.summary.invalid === 0 && plan.summary.conflict === 0, JSON.stringify(plan.summary));
    ok("#6 CA fixture yields expected inserts (2 companies, agent, escrow, signal, outreach, dnc)",
      plan.summary.insert === 7, "inserts: " + plan.summary.insert);
    const agent = plan.rows.find((r) => r.target_type === "agent");
    const company = plan.rows.find((r) => r.target_type === "company" && r.after_data.company_name === "QA Coastal Realty");
    ok("#6 agent linked to its company (same-batch)", agent && company && agent.after_data.company_id === company.after_data.id);
    const sig = plan.rows.find((r) => r.target_type === "activity_signal");
    ok("#6 activity signal linked to its agent (same-batch)", sig && agent && sig.after_data.agent_id === agent.after_data.id);
    const oa = plan.rows.find((r) => r.target_type === "outreach_action");
    ok("#6 outreach action linked to its agent (same-batch)", oa && agent && oa.after_data.agent_id === agent.after_data.id);

    /* No borrower records, no CRM creation — partner import only LINKS to CRM. */
    section("No borrower records / no CRM mixing");
    const targets = new Set(plan.rows.map((r) => r.target_type));
    ok("no crm_contacts / contact rows created by partner import", !targets.has("contact") && !targets.has("crm_contact"));
    ok("no pci_ (property/loan/tenant/lender) targets in partner plan",
      ![...targets].some((t) => ["property", "loan", "tenant", "lender_program", "distress_signal", "score"].includes(t)),
      [...targets].join(","));
    ok("no target_type or field mentions 'borrower'", !JSON.stringify(plan.rows).toLowerCase().includes("borrower"));
    ok("partner core never writes crm_contacts (source has no such insert)",
      !/from\("crm_contacts"\)\.insert|target_type.*contact/.test(read("netlify/functions/lib/partner-import-core.js")) &&
      /link.*existing CRM|LINK/.test(read("netlify/functions/lib/partner-import-core.js")));

    /* Cross-workbook rejection (required test #5, symmetric side) ── */
    section("Issue 1 test #5 (symmetric): CA rejected by CI · CI rejected by PN");
    ok("#5 CA workbook rejected by Capital Intelligence (exact message)",
      icore.foreignWorkbookError(parsed.allSheetNames) === "This workbook belongs to California Partner Network. Upload it in /admin/partner-network.");
    ok("#5b CI workbook rejected by Partner Network (clear message)",
      core.foreignWorkbookError(["Properties", "Loans", "Tenants", "Lender_Programs"]) === "This workbook belongs to Capital Intelligence (Palm Beach). Upload it in /admin/intelligence.");
    ok("#5c own CA workbook not falsely rejected by PN", core.foreignWorkbookError(parsed.allSheetNames) === null);

    /* Dedupe / update planning against existing rows ── */
    section("Dedupe & update planning");
    const E = { companies: new Map(), agents: new Map(), escrow: new Map(), signals: new Map(), dncs: new Map(), openOutreach: new Set(), crmByEmail: new Map() };
    // Seed an existing agent by email to force an update path.
    E.agents.set("email:test.agent@example.com", { id: "00000000-0000-0000-0000-0000000000e1", record: { full_name: "Test Agent", email: "test.agent@example.com", deal_count: 10, data_confidence: "Reported" } });
    let n = 0;
    const plan2 = core.planActions(parsed.bySheet, E, { adminId: "a", today: "2026-07-11", genId: () => "00000000-0000-0000-0000-" + String(++n + 800).padStart(12, "0") });
    const agentRow = plan2.rows.find((r) => r.target_type === "agent");
    ok("existing agent (by email) becomes update/unchanged, not a duplicate insert",
      agentRow && agentRow.proposed_action !== "insert", agentRow && agentRow.proposed_action);

    /* Existing CRM contact links (no creation) ── */
    const E2 = { companies: new Map(), agents: new Map(), escrow: new Map(), signals: new Map(), dncs: new Map(), openOutreach: new Set(), crmByEmail: new Map([["test.agent@example.com", "00000000-0000-0000-0000-0000000cr01"]]) };
    let n2 = 0;
    const plan3 = core.planActions(parsed.bySheet, E2, { adminId: "a", today: "2026-07-11", genId: () => "00000000-0000-0000-0000-" + String(++n2 + 900).padStart(12, "0") });
    const agentIns = plan3.rows.find((r) => r.target_type === "agent" && r.proposed_action === "insert");
    ok("agent LINKS to an existing CRM contact by email (linked_contact_id set, none created)",
      agentIns && agentIns.after_data.linked_contact_id === "00000000-0000-0000-0000-0000000cr01");

    /* ── Live RLS probe (optional) ── */
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      section("Live RLS probe (anon)");
      const { createClient } = require("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      for (const t of ["pn_agents", "pn_companies", "pn_import_batches", "pn_change_log"]) {
        const r = await anon.from(t).select("id").limit(1);
        ok("anon blocked from " + t, !!r.error || (r.data || []).length === 0, r.error ? r.error.message : "returned rows!");
      }
    } else {
      console.log("\n(live RLS probe skipped — set SUPABASE_URL + SUPABASE_ANON_KEY to enable)");
    }

    /* ── DB proofs (optional) ── */
    section("DB-level proofs (optional)");
    const sqlPath = path.join(ROOT, "qa/sql/pn-db-tests.sql");
    ok("db-proof SQL present (qa/sql/pn-db-tests.sql)", fs.existsSync(sqlPath));
    if (process.env.PCI_DB_TESTS === "1") {
      const { spawnSync } = require("child_process");
      const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-f", sqlPath], { cwd: ROOT, encoding: "utf8" });
      const passed = r.status === 0 && /ALL PN DB-LEVEL PROOFS PASSED/.test((r.stdout || "") + (r.stderr || ""));
      ok("psql proofs: PN atomic commit · edit-aware rollback · admin-only RLS", passed,
        passed ? "" : ((r.stderr || r.stdout || "psql unavailable").split("\n").filter(Boolean).slice(-3).join(" | ")));
    } else {
      console.log("  (db proofs skipped — run `PCI_DB_TESTS=1 <PG env> npm run qa:partner`)");
    }

    console.log("\n──────────────────────────────");
    console.log("PASS " + pass + " · FAIL " + fail);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("FATAL", e);
    process.exit(1);
  }
})();
