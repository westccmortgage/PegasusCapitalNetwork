#!/usr/bin/env node
/* ============================================================================
   PEGASUS — ACCEPTANCE TEST for the current California Partner Network workbook
   Run: npm run qa:acceptance

   Reproduces the exact schema of the production-rejected file
   "California-Partner-Network-2026-07-11-Live-Upload.xlsx" (ChatGPT California
   Partner Research: non-Pegasus headers, Contact_Key references, human-readable
   Signal_Type / Priority / Contact_Type), builds it as a real .xlsx, and runs
   the SAME pipeline the import-map-preview function runs:

     extractSheets → matchBuiltinProfile → autoMap → applyBuiltinTransforms
     → applyMapping (+ cross-sheet resolveReferences) → buildPlannerRows
     → planActions → quality + per-entity counts

   Acceptance: Agents 11 / Escrow 4 / Companies 12 / Activity 15 / Outreach 15
   / DNC 0, all new; 0 blocking; 0 unresolved subject refs; enums normalized;
   detected profile visible; every row traceable.
   ============================================================================ */
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ExcelJS = require("exceljs");
const mapper = require(path.join(ROOT, "netlify/functions/lib/import-mapper-core.js"));
const schemas = require(path.join(ROOT, "netlify/functions/lib/import-mapper-schemas.js"));
const mp = require(path.join(ROOT, "netlify/functions/import-map-preview.js"));
const P = schemas.DESCRIPTORS.partner;

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); } }

// ── Build the exact workbook ────────────────────────────────────────────────
const AGENT_COLS = ["External_ID", "Name", "Company", "Job_Title", "DRE_License_ID", "License_Status",
  "City", "County", "Service_Areas", "Specialization", "Recent_Activity_Evidence", "Buyer_Side_Relevance",
  "Estimated_Production_Tier", "Website", "LinkedIn_URL", "Public_Email", "Public_Phone", "Priority",
  "Partner_Potential_Score", "Why_Relevant", "Recommended_Next_Step", "Connection_Note", "Confidence",
  "Source_URL", "Last_Verified_Date"];
const ESCROW_COLS = ["External_ID", "Name", "Company", "Job_Title", "Organization_Type", "License_or_Entity_ID",
  "Regulator", "License_Status", "City", "County", "Service_Areas", "Public_Email", "Public_Phone", "Website",
  "LinkedIn_URL", "Priority", "Partner_Potential_Score", "Why_Relevant", "Recommended_Next_Step",
  "Connection_Note", "Confidence", "Source_URL", "Last_Verified_Date"];
const COMPANY_COLS = ["External_ID", "Company_Name", "Company_Type", "City", "County", "Website", "Public_Phone",
  "Specialization", "Confidence", "Source_URL", "Last_Verified_Date"];
const SIGNAL_COLS = ["External_ID", "Contact_Key", "Signal_Type", "Signal_Date", "Property_or_Market",
  "Description", "Relevance", "Confidence", "Source_URL"];
const OUTREACH_COLS = ["Priority", "Contact_Key", "Contact_Type", "Action_Type", "Due_Date", "Message",
  "Reason", "Status", "Notes"];
const DNC_COLS = ["External_ID", "Name", "Company", "Public_Email", "Public_Phone", "Scope", "Reason",
  "Effective_Date", "Source_URL"];

const PRIORITIES = ["A", "B", "C"];
const HUMAN_SIGNALS = ["Buyer-Side Closing", "Luxury Closing", "Recent Closing", "Multiple Recent Closings",
  "Buyer-Side Activity", "Current Local Practice", "Active Market Presence", "Relationship Development Role",
  "Residential Escrow Specialization", "Association / Settlement Expertise", "Current Title Team Role"];

function agentRow(i) {
  return { External_ID: "AGENT_" + String(i).padStart(3, "0"), Name: "Agent Number " + i, Company: "Brokerage " + ((i % 4) + 1),
    Job_Title: "Realtor", DRE_License_ID: "0" + (1000000 + i), License_Status: "Active", City: "San Diego", County: "San Diego",
    Service_Areas: "Coastal, Downtown", Specialization: "Luxury Residential", Recent_Activity_Evidence: "Closed a coastal listing",
    Buyer_Side_Relevance: "High", Estimated_Production_Tier: "Tier " + ((i % 3) + 1), Website: "https://example.com/agent" + i,
    LinkedIn_URL: "https://linkedin.com/in/agent" + i, Public_Email: "agent" + i + "@example.com", Public_Phone: "(619) 555-" + String(1000 + i),
    Priority: PRIORITIES[i % 3], Partner_Potential_Score: 70 + (i % 30), Why_Relevant: "Strong buyer-side coastal presence",
    Recommended_Next_Step: "Intro call", Connection_Note: "Referred by network", Confidence: "Reported",
    Source_URL: "https://example.com/src/agent" + i, Last_Verified_Date: "2026-07-01" };
}
function escrowRow(i) {
  return { External_ID: "ESCROW_" + String(i).padStart(3, "0"), Name: "Escrow Officer " + i, Company: "Escrow Co " + i,
    Job_Title: "Escrow Officer", Organization_Type: "Escrow", License_or_Entity_ID: "ENT-" + (2000 + i), Regulator: "CA DFPI",
    License_Status: "Active", City: "Sacramento", County: "Sacramento", Service_Areas: "Statewide",
    Public_Email: "escrow" + i + "@example.com", Public_Phone: "(916) 555-" + String(2000 + i),
    Website: "https://example.com/escrow" + i, LinkedIn_URL: "https://linkedin.com/in/escrow" + i, Priority: PRIORITIES[i % 3],
    Partner_Potential_Score: 60 + i, Why_Relevant: "High transaction volume", Recommended_Next_Step: "Email intro",
    Connection_Note: "", Confidence: "Reported", Source_URL: "https://example.com/src/escrow" + i, Last_Verified_Date: "2026-07-01" };
}
function companyRow(i) {
  return { External_ID: "CO_" + String(i).padStart(3, "0"), Company_Name: "Brokerage " + i, Company_Type: "brokerage",
    City: "San Diego", County: "San Diego", Website: "https://example.com/co" + i, Public_Phone: "(619) 555-" + String(3000 + i),
    Specialization: "Residential", Confidence: "Reported", Source_URL: "https://example.com/src/co" + i, Last_Verified_Date: "2026-07-01" };
}
function signalRow(i) {
  return { External_ID: "SIG_" + String(i).padStart(3, "0"), Contact_Key: "AGENT_" + String((i % 11) + 1).padStart(3, "0"),
    Signal_Type: HUMAN_SIGNALS[i % HUMAN_SIGNALS.length], Signal_Date: "2026-06-" + String((i % 28) + 1).padStart(2, "0"),
    Property_or_Market: "La Jolla", Description: "Signal detail " + i, Relevance: "High",
    Confidence: "Reported", Source_URL: "https://example.com/src/sig" + i };
}
function outreachRow(i) {
  const toEscrow = i % 4 === 0;
  return { Priority: PRIORITIES[i % 3], Contact_Key: toEscrow ? "ESCROW_" + String((i % 4) + 1).padStart(3, "0") : "AGENT_" + String((i % 11) + 1).padStart(3, "0"),
    Contact_Type: toEscrow ? "Escrow/Title Professional" : "Residential Real Estate Agent", Action_Type: "call",
    Due_Date: "2026-07-" + String((i % 28) + 1).padStart(2, "0"), Message: "Reach out about partner program #" + i,
    Reason: "Strong fit", Status: "open", Notes: "" };
}

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  function add(name, cols, rows) {
    const ws = wb.addWorksheet(name);
    ws.addRow(cols);
    rows.forEach((r) => ws.addRow(cols.map((c) => (r[c] !== undefined ? r[c] : null))));
  }
  add("Agents", AGENT_COLS, Array.from({ length: 11 }, (_, i) => agentRow(i + 1)));
  add("Escrow_Title", ESCROW_COLS, Array.from({ length: 4 }, (_, i) => escrowRow(i + 1)));
  add("Companies", COMPANY_COLS, Array.from({ length: 12 }, (_, i) => companyRow(i + 1)));
  add("Activity_Signals", SIGNAL_COLS, Array.from({ length: 15 }, (_, i) => signalRow(i + 1)));
  add("Outreach_Actions", OUTREACH_COLS, Array.from({ length: 15 }, (_, i) => outreachRow(i + 1)));
  add("Do_Not_Contact", DNC_COLS, []); // 0 rows
  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  try {
    console.log("== Acceptance: ChatGPT California Partner Research workbook ==");
    const buf = await buildWorkbook();

    // 1. Same extraction the function uses.
    const sheets = (await mp._extractSheets("California-Partner-Network-2026-07-11-Live-Upload.xlsx", buf))
      .filter((s) => (s.headers || []).some((h) => String(h).trim() !== ""));

    // 2. Built-in profile detection.
    const builtin = schemas.matchBuiltinProfile(sheets, "partner");
    ok("Detected profile: ChatGPT California Partner Research", !!builtin && builtin.profile.name === "ChatGPT California Partner Research", builtin ? builtin.profile.name : "none");

    // 3. Auto-map + built-in value transforms.
    const suggestion = mapper.autoMap(sheets, P);
    if (builtin) schemas.applyBuiltinTransforms(suggestion, builtin.profile);
    const bySheet = {}; suggestion.forEach((s) => { bySheet[s.sheet] = s; });
    ok("Agents sheet → Agents entity", bySheet.Agents && bySheet.Agents.entity === "Agents");
    ok("Escrow_Title → Escrow_Title", bySheet.Escrow_Title && bySheet.Escrow_Title.entity === "Escrow_Title");
    ok("Activity_Signals → Activity_Signals", bySheet.Activity_Signals && bySheet.Activity_Signals.entity === "Activity_Signals");
    ok("Agents.Name → Full_Name mapped", bySheet.Agents.columns.find((c) => c.source === "Name").target === "Full_Name");
    ok("Escrow_Title.Name → Officer_Name mapped", bySheet.Escrow_Title.columns.find((c) => c.source === "Name").target === "Officer_Name");
    ok("Activity_Signals.Contact_Key → Subject_Key mapped", bySheet.Activity_Signals.columns.find((c) => c.source === "Contact_Key").target === "Subject_Key");
    ok("Outreach.Message → Action mapped", bySheet.Outreach_Actions.columns.find((c) => c.source === "Message").target === "Action");
    ok("Outreach.Contact_Key → Subject_Key mapped", bySheet.Outreach_Actions.columns.find((c) => c.source === "Contact_Key").target === "Subject_Key");

    // 4. Apply mapping (+ cross-sheet resolution) → plan.
    const mappingSheets = suggestion.filter((s) => s.entity).map((s) => ({ sheet: s.sheet, entity: s.entity, columns: s.columns.filter((c) => c.target).map((c) => ({ source: c.source, sourceIndex: c.sourceIndex, target: c.target, valueMap: c.valueMap })) }));
    const applied = mapper.applyMapping(sheets, mappingSheets, P);
    const rows = mapper.buildPlannerRows(applied.canonical, P);
    let n = 0;
    const plan = P.planActions(rows, {}, { adminId: "00000000-0000-0000-0000-0000000000a1", today: "2026-07-11", genId: () => "00000000-0000-0000-0000-" + String(++n).padStart(12, "0") });
    const quality = mapper.qualityReport(applied.canonical, P);

    // 5. Per-entity counts.
    const counts = {};
    plan.rows.forEach((r) => { const c = counts[r.sheet_name] = counts[r.sheet_name] || { new: 0, invalid: 0 }; if (r.proposed_action === "insert") c.new++; else if (r.proposed_action === "invalid") c.invalid++; });
    ok("Agents: 11 mapped", (counts.Agents || {}).new === 11, JSON.stringify(counts.Agents));
    ok("Escrow & Title: 4 mapped", (counts.Escrow_Title || {}).new === 4, JSON.stringify(counts.Escrow_Title));
    ok("Companies: 12 mapped", (counts.Companies || {}).new === 12, JSON.stringify(counts.Companies));
    ok("Activity Signals: 15 mapped", (counts.Activity_Signals || {}).new === 15, JSON.stringify(counts.Activity_Signals));
    ok("Outreach Actions: 15 mapped", (counts.Outreach_Actions || {}).new === 15, JSON.stringify(counts.Outreach_Actions));
    ok("Do Not Contact: 0 mapped", !counts.Do_Not_Contact, JSON.stringify(counts.Do_Not_Contact));

    // 6. Zero blocking.
    ok("Blocking invalid rows: 0", plan.summary.invalid === 0, JSON.stringify(plan.summary));
    ok("Missing required values: 0", quality.missingRequired.length === 0, JSON.stringify(quality.missingRequired.slice(0, 5)));

    // 7. Subject resolution + enums.
    const sigs = plan.rows.filter((r) => r.target_type === "activity_signal");
    ok("Unresolved subject references: 0 (subject_name resolved from same-batch)", sigs.every((r) => r.after_data.subject_name && String(r.after_data.subject_name).trim() !== ""));
    ok("Signal_Type normalized to enums (no raw human strings)", sigs.every((r) => schemas.PARTNER.entities.Activity_Signals && /^[a-z_]+$/.test(r.after_data.signal_type)));
    ok("Signal_Type includes closed_deal + marketing + other (mapped)", sigs.some((r) => r.after_data.signal_type === "closed_deal") && sigs.some((r) => r.after_data.signal_type === "marketing") && sigs.some((r) => r.after_data.signal_type === "other"));
    const oas = plan.rows.filter((r) => r.target_type === "outreach_action");
    ok("Invalid priorities: 0 (A/B/C → 1/2/3)", oas.every((r) => [1, 2, 3].includes(r.after_data.priority)), JSON.stringify(oas.map((r) => r.after_data.priority)));
    ok("Outreach subject_name resolved from Contact_Key", oas.every((r) => r.after_data.subject_name && String(r.after_data.subject_name).trim() !== ""));
    ok("Outreach subject_type normalized (agent / escrow_title)", oas.every((r) => ["agent", "escrow_title"].includes(r.after_data.subject_type)));
    ok("Activity signal linked to its agent (same-batch)", sigs.every((r) => r.after_data.agent_id));

    // 8. Traceability (provenance present per canonical row).
    ok("All source rows traceable (provenance retained)", applied.provenance.length === (11 + 4 + 12 + 15 + 15) && applied.provenance.every((p) => p.raw && p.sourceRow && p.sourceSheet));

    // 9. Research fields preserved into typed columns.
    const a0 = plan.rows.find((r) => r.target_type === "agent");
    ok("Agent research fields preserved (license_status/county/partner_score/linkedin_url)",
      a0.after_data.license_status === "Active" && a0.after_data.county === "San Diego" && typeof a0.after_data.partner_score === "number" && /linkedin/.test(a0.after_data.linkedin_url || ""));

    console.log("\n──────────────────────────────");
    console.log("PASS " + pass + " · FAIL " + fail);
    console.log("Expected normalized result: Agents 11 · Escrow_Title 4 · Companies 12 · Activity_Signals 15 · Outreach_Actions 15 · Do_Not_Contact 0 · blocking 0");
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error("FATAL", e); process.exit(1); }
})();
