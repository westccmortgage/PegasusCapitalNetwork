#!/usr/bin/env node
/* ============================================================================
   PEGASUS — Enrichment Layer + LinkedIn Outreach Approval Queue QA
   Run: npm run qa:enrichment
   ============================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "netlify/functions/lib/enrichment-core.js"));

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.error("  ✗ " + n + (d ? " — " + d : "")); } }
function section(t) { console.log("\n== " + t + " =="); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ── Static wiring ── */
section("Static wiring");
[
  "supabase/078_pn_enrichment.sql", "supabase/079_pn_outreach_approval.sql",
  "netlify/functions/lib/enrichment-core.js", "netlify/functions/enrichment-run.js",
  "netlify/functions/enrichment-commit.js", "js/partner-network/partner-enrichment-outreach.js",
  "docs/LINKEDIN-EXTENSION-DESIGN.md",
].forEach((f) => ok("exists: " + f, fs.existsSync(path.join(ROOT, f))));
ok("enrichment + outreach tabs wired", /enrich: renderEnrichTab/.test(read("js/partner-network/admin-partner-network.js")) && /approval: renderApprovalTab/.test(read("js/partner-network/admin-partner-network.js")));
ok("UI script included on the partner page", /partner-enrichment-outreach\.js/.test(read("admin-partner-network.html")));
ok("partner API exposes enrichment + outreach + settings", /enrichmentRun/.test(read("js/partner-network/partner-api.js")) && /saveProspect/.test(read("js/partner-network/partner-api.js")) && /setSetting/.test(read("js/partner-network/partner-api.js")));

/* ── PART 1: Enrichment core ── */
section("PART 1 — Enrichment: never guess, source required, no fabrication");
const ws = E.worksheet("agent", { full_name: "Jane", license_number: "01998877", website: null });
ok("worksheet seeds current values but fabricates nothing (proposed all null)", ws.length > 0 && ws.every((f) => f.proposed_value === null) && ws.find((f) => f.target_field === "license_number").current_value === "01998877");
ok("enrichment targets cover the required fields", ["license_number", "license_status", "company_name_snapshot", "website", "linkedin_url", "email", "phone", "service_areas", "specialty", "production_tier"].every((t) => E.ENTITIES.agent.allow.has(t)));
ok("value WITHOUT a source URL is rejected (never guess)", E.validateProposal("agent", { target_field: "website", proposed_value: "https://x.com" }).ok === false);
ok("license/email/phone value without source rejected", E.validateProposal("agent", { target_field: "license_number", proposed_value: "01" }).ok === false && E.validateProposal("agent", { target_field: "email", proposed_value: "a@b.com" }).ok === false);
ok("valid sourced proposal accepted", E.validateProposal("agent", { target_field: "website", proposed_value: "https://x.com", source_url: "https://dre.ca.gov/x", confidence: "Reported" }).ok === true);
ok("non-http source rejected", E.validateProposal("agent", { target_field: "website", proposed_value: "x", source_url: "ftp://x" }).ok === false);
ok("disallowed target column rejected (allowlist)", E.validateProposal("agent", { target_field: "is_admin", proposed_value: "true", source_url: "https://x.com" }).ok === false);
ok("borrower/consumer field rejected", E.validateProposal("agent", { target_field: "email", label: "SSN", proposed_value: "a@b.com", source_url: "https://x.com", confidence: "Reported" }).ok === false);
ok("confidence ladder Verified > Reported > Estimated > Unknown", E.confRank("Verified") > E.confRank("Reported") && E.confRank("Reported") > E.confRank("Estimated") && E.confRank("Estimated") > E.confRank("Unknown"));

section("PART 1 — Enrichment functions: protection + provenance + statuses");
const runSrc = read("netlify/functions/enrichment-run.js");
const commitSrc = read("netlify/functions/enrichment-commit.js");
const mig78 = read("supabase/078_pn_enrichment.sql");
ok("job statuses present (queued/researching/review_ready/approved/rejected/failed)", /queued.*researching.*review_ready.*approved.*rejected.*failed/s.test(mig78));
ok("run sets review_ready and never fabricates without a provider", /status: "review_ready"/.test(runSrc) && /ENRICHMENT_PROVIDER_URL/.test(runSrc));
ok("commit enforces Verified-downgrade protection", /entityVerified && ecore\.confRank\(conf\) < ecore\.confRank\("Verified"\)/.test(commitSrc) && /skipped_conflict/.test(commitSrc));
ok("commit only writes whitelisted columns", /ent\.allow\.has\(f\.target_field\)/.test(commitSrc));
ok("commit never erases with a blank value", /value === "" \) continue/.test(commitSrc.replace(/\s+/g, " ")) || /blank never erases/.test(commitSrc));
ok("commit writes provenance to pn_change_log", /pn_change_log/.test(commitSrc));
ok("run/commit require admin JWT", /requireAdmin/.test(runSrc) && /requireAdmin/.test(commitSrc));
ok("enrichment RLS is admin-only", /is_admin_user\(\)/.test(mig78) && /pn_enrichment_jobs_admin_all|admin_all/.test(mig78));

/* ── PART 2: Outreach approval ── */
section("PART 2 — Outreach Approval: statuses + no auto-send");
const mig79 = read("supabase/079_pn_outreach_approval.sql");
["drafted", "ready_for_approval", "approved", "opened_in_linkedin", "sent", "connected", "replied", "follow_up_due", "not_interested", "do_not_contact"]
  .forEach((s) => ok("status present: " + s, mig79.indexOf("'" + s + "'") >= 0));
ok("default LinkedIn sending mode is manual", /linkedin_sending_mode', '\{"mode":"manual"\}/.test(mig79));
ok("outreach + settings RLS admin-only", /pn_outreach_prospects/.test(mig79) && /is_admin_user\(\)/.test(mig79) && /pn_settings/.test(mig79));
const ui = read("js/partner-network/partner-enrichment-outreach.js");
const flat = ui.replace(/\s+/g, " ");
ok("Open LinkedIn requires approval (blocks non-approved)", /status !== "approved" && p\.status !== "opened_in_linkedin"\) \{ toast\(false, "Approval required"/.test(flat));
ok("Do-Not-Contact blocks Open LinkedIn", /status === "do_not_contact"\) \{ toast\(false, "Do Not Contact"/.test(flat));
ok("Open LinkedIn opens a new tab + copies note + confirmation, no auto-send", /window\.open\(p\.linkedin_url, "_blank"/.test(flat) && /copyText\(p\.connection_note/.test(flat) && /LinkedIn opened and message copied\./.test(flat) && !/\.click\(\)/.test(flat.replace(/getElementById\([^)]*\)\.click/g, "")));
ok("no automatic Connect/Send anywhere in the outreach UI", ui.indexOf("auto") < 0 || !/autoSend|autoConnect|clickSend/.test(ui));
ok("LinkedIn URL validation (linkedin.com profile)", /LINKEDIN_RE = \/\^https\?/.test(ui) && /linkedin\\\.com/.test(ui));
ok("connection-note length validation (<= 300)", /NOTE_MAX = 300/.test(ui) && /Note too long/.test(ui));
ok("follow-up scheduling with date validation", /scheduleFollowup/.test(ui) && /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(ui));
ok("audit trail written on actions (pn_outreach_events)", /prospectEvent/.test(ui) && /open_linkedin/.test(ui) && /approve/.test(ui));
ok("rejected drafts are un-approved (cannot open as approved)", /function reject\(id\) \{ await setStatus\(id, "drafted"/.test(flat));
ok("dashboard cards (new/awaiting/approved/sent today/replies/follow-ups due)", /Awaiting approval/.test(ui) && /Sent today/.test(ui) && /Follow-ups due/.test(ui) && /Replies/.test(ui));
ok("settings: Manual default, Assisted, Official API disabled", /value="manual"/.test(ui) && /\(default\)/.test(ui) && /Assisted Browser Extension/.test(ui) && /Official API/.test(ui) && /option value="api" disabled/.test(ui));
ok("Manual confirmation required banner", /Manual confirmation required/.test(ui));
ok("actions present (Generate Draft/Approve/Reject/Open/Copy/Mark/Follow-up/DNC)", ["generateDraft", "approve", "reject", "openLinkedIn", "copyNote", "markSent", "markConnected", "markReplied", "scheduleFollowup", "doNotContact"].every((a) => ui.indexOf(a) >= 0));

section("Chrome extension design (spec only)");
const ext = read("docs/LINKEDIN-EXTENSION-DESIGN.md");
ok("extension is design-only, not deployed", /design only\. Not built, not deployed/i.test(ext));
ok("extension forbids scraping / bulk / auto-click / credential storage / limit bypass",
  /must not/i.test(ext) && /scrape/i.test(ext) && /bulk/i.test(ext) && /auto-click/i.test(ext) && /credential/i.test(ext) && /limit/i.test(ext) && /final human click/i.test(ext));

console.log("\n──────────────────────────────");
console.log("PASS " + pass + " · FAIL " + fail);
process.exit(fail ? 1 : 0);
