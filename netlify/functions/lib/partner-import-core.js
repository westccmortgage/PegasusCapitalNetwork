// ============================================================================
// PEGASUS CALIFORNIA PARTNER NETWORK — import core (pure logic, no I/O)
// netlify/functions/lib/partner-import-core.js
//
// Separate contract + planner from Capital Intelligence. Six sheets:
//   Agents · Escrow_Title · Companies · Activity_Signals · Outreach_Actions
//   · Do_Not_Contact
//
// Reuses the shared value normalizers, file checks, and OOXML/namespace header
// normalization from intelligence-import-core.js so both importers behave
// identically at the cell level — but the data model, dedupe keys, and planner
// are entirely partner-specific. Partner records never touch pci_ tables and
// this module never creates crm_contacts or borrower records (it only LINKS to
// an existing CRM contact by email where one already exists).
// ============================================================================
"use strict";

const core = require("./intelligence-import-core.js");
const {
  MAX_FILE_BYTES, CONFIDENCE, confidenceRank,
  normText, normNumber, normInt, normDate, normBool, normConfidence, normUrl,
  normId, normHeader, checkFile,
} = core;

// ── Workbook contract ────────────────────────────────────────────────────────
// type: text | number | currency | int | date | bool | confidence | url
const SHEETS = {
  Companies: {
    target: "company",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Company_Name", "company_name", "text"],
      ["Company_Type", "company_type", "text"],
      ["Address", "address_line1", "text"],
      ["City", "city", "text"],
      ["State", "state", "text"],
      ["ZIP", "postal_code", "text"],
      ["Phone", "phone", "text"],
      ["Email", "email", "text"],
      ["Website", "website", "url"],
      ["Agent_Count", "agent_count", "int"],
      ["Specialty", "specialty", "text"],
      ["Status", "active_status", "text"],
      ["Notes", "notes", "text"],
      ["Confidence", "data_confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Last_Verified_Date", "last_verified_at", "date"],
    ],
    required: ["company_name"],
  },
  Agents: {
    target: "agent",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Full_Name", "full_name", "text"],
      ["Company", "company_name_snapshot", "text"],
      ["Company_Key", "company_key", "text"],
      ["License_Number", "license_number", "text"],
      ["Job_Title", "job_title", "text"],
      ["Email", "email", "text"],
      ["Phone", "phone", "text"],
      ["Website", "website", "url"],
      ["City", "city", "text"],
      ["State", "state", "text"],
      ["Specialty", "specialty", "text"],
      ["Production_Volume", "production_volume", "currency"],
      ["Deal_Count", "deal_count", "int"],
      ["Status", "status", "text"],
      ["Tags", "tags", "text"],
      ["Notes", "notes", "text"],
      ["Confidence", "data_confidence", "confidence"],
      ["Last_Verified_Date", "last_verified_at", "date"],
      ["Source_URL", "source_url", "url"],
      // Research fields (migration 077)
      ["License_Status", "license_status", "text"],
      ["County", "county", "text"],
      ["Service_Areas", "service_areas", "text"],
      ["Activity_Evidence", "activity_evidence", "text"],
      ["Buyer_Side_Relevance", "buyer_side_relevance", "text"],
      ["Production_Tier", "production_tier", "text"],
      ["Partner_Score", "partner_score", "number"],
      ["Why_Relevant", "why_relevant", "text"],
      ["Next_Step", "next_step", "text"],
      ["Connection_Note", "connection_note", "text"],
      ["Priority", "priority", "int"],
      ["LinkedIn_URL", "linkedin_url", "url"],
    ],
    required: ["full_name"],
  },
  Escrow_Title: {
    target: "escrow_title",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Officer_Name", "officer_name", "text"],
      ["Company", "company_name_snapshot", "text"],
      ["Company_Key", "company_key", "text"],
      ["Role", "role", "text"],
      ["License_Number", "license_number", "text"],
      ["Email", "email", "text"],
      ["Phone", "phone", "text"],
      ["City", "city", "text"],
      ["State", "state", "text"],
      ["Transaction_Volume", "transaction_volume", "currency"],
      ["Status", "status", "text"],
      ["Tags", "tags", "text"],
      ["Notes", "notes", "text"],
      ["Confidence", "data_confidence", "confidence"],
      ["Last_Verified_Date", "last_verified_at", "date"],
      ["Source_URL", "source_url", "url"],
      // Research fields (migration 077)
      ["Organization_Type", "organization_type", "text"],
      ["Regulator", "regulator", "text"],
      ["License_Status", "license_status", "text"],
      ["County", "county", "text"],
      ["Service_Areas", "service_areas", "text"],
      ["Partner_Score", "partner_score", "number"],
      ["Why_Relevant", "why_relevant", "text"],
      ["Next_Step", "next_step", "text"],
      ["Connection_Note", "connection_note", "text"],
      ["Priority", "priority", "int"],
      ["LinkedIn_URL", "linkedin_url", "url"],
    ],
    required: ["officer_name"],
  },
  Activity_Signals: {
    target: "activity_signal",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Subject_Type", "subject_type", "text"],
      ["Subject_Name", "subject_name", "text"],
      ["Subject_Key", "subject_key", "text"],
      ["Signal_Type", "signal_type", "text"],
      ["Signal_Date", "signal_date", "date"],
      ["Detail", "detail", "text"],
      ["Market", "market", "text"],
      ["Relevance", "relevance", "text"],
      ["URL", "url", "url"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Source_Title", "source_title", "text"],
    ],
    required: ["subject_name", "signal_type"],
  },
  Outreach_Actions: {
    target: "outreach_action",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Priority", "priority", "int"],
      ["Action_Type", "action_type", "text"],
      ["Subject_Type", "subject_type", "text"],
      ["Subject_Name", "subject_name", "text"],
      ["Subject_Key", "subject_key", "text"],
      ["Channel", "channel", "text"],
      ["Due_Date", "due_date", "date"],
      ["Action", "action", "text"],
      ["Reason", "reason", "text"],
      ["Status", "status", "text"],
      ["Notes", "notes", "text"],
    ],
    required: ["subject_name", "action"],
  },
  Do_Not_Contact: {
    target: "do_not_contact",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Subject_Type", "subject_type", "text"],
      ["Subject_Name", "subject_name", "text"],
      ["Company", "company_name_snapshot", "text"],
      ["Email", "email", "text"],
      ["Phone", "phone", "text"],
      ["Scope", "scope", "text"],
      ["Reason", "reason", "text"],
      ["Effective_Date", "effective_date", "date"],
      ["Expires_Date", "expires_date", "date"],
      ["Source_URL", "source_url", "url"],
      ["Notes", "notes", "text"],
    ],
    required: ["subject_name", "reason"],
  },
};

const SIGNAL_TYPES = ["new_listing", "closed_deal", "price_change", "team_move",
  "license_change", "brokerage_change", "marketing", "social", "news", "award", "other"];
const DNC_SCOPES = ["email", "phone", "all"];

// Fields that legitimately change over time (same/higher confidence may update).
const TIME_VARYING = {
  company: ["company_type", "address_line1", "city", "state", "postal_code", "phone", "email",
    "website", "agent_count", "specialty", "active_status", "notes", "data_confidence",
    "source_url", "last_verified_at"],
  agent: ["company_name_snapshot", "company_id", "license_number", "job_title", "email", "phone",
    "website", "city", "state", "specialty", "production_volume", "deal_count", "status",
    "tags", "notes", "data_confidence", "source_url", "last_verified_at", "linked_contact_id",
    "license_status", "county", "service_areas", "activity_evidence", "buyer_side_relevance",
    "production_tier", "partner_score", "why_relevant", "next_step", "connection_note", "priority"],
  escrow_title: ["company_name_snapshot", "company_id", "role", "license_number", "email", "phone",
    "city", "state", "transaction_volume", "status", "tags", "notes", "data_confidence",
    "source_url", "last_verified_at", "linked_contact_id", "organization_type", "regulator",
    "license_status", "county", "service_areas", "partner_score", "why_relevant", "next_step",
    "connection_note", "priority"],
  activity_signal: ["subject_type", "signal_date", "detail", "market", "relevance", "url",
    "confidence", "source_url", "source_title", "agent_id", "company_id"],
};

function blank(v) { return v === null || v === undefined || (typeof v === "string" && v.trim() === ""); }

// ── Row normalization (contract-driven, shared cell normalizers) ─────────────
function normalizeRow(sheetName, rawRow, rowNumber) {
  const spec = SHEETS[sheetName];
  const errors = [];
  const data = {};
  for (const [header, key, type] of spec.columns) {
    if (rawRow["__formula__" + normHeader(header)]) { errors.push(header + ": formulas are not accepted as data"); continue; }
    const v = rawRow[normHeader(header)];
    let out = null;
    switch (type) {
      case "text": out = normText(v); break;
      case "number": case "currency": out = normNumber(v); break;
      case "int": out = normInt(v); break;
      case "date": out = normDate(v); break;
      case "bool": out = normBool(v); break;
      case "confidence": out = normConfidence(v); break;
      case "url": out = normUrl(v); break;
      default: out = normText(v);
    }
    if (typeof out === "number" && Number.isNaN(out)) { errors.push(header + ": invalid " + type + " value “" + String(v).slice(0, 40) + "”"); out = null; }
    else if (out !== null && typeof out !== "boolean" && typeof out !== "number" && Number.isNaN(out)) { errors.push(header + ": invalid " + type); out = null; }
    data[key] = out;
  }
  for (const req of spec.required) if (blank(data[req])) errors.push("required column missing/blank: " + req);

  if (sheetName === "Activity_Signals" && data.signal_type) {
    const t = data.signal_type.toLowerCase().replace(/\s+/g, "_");
    if (!SIGNAL_TYPES.includes(t)) errors.push("Signal_Type must be one of: " + SIGNAL_TYPES.join(", "));
    else data.signal_type = t;
  }
  if (sheetName === "Do_Not_Contact") {
    const s = (data.scope || "all").toLowerCase();
    if (!DNC_SCOPES.includes(s)) errors.push("Scope must be one of: " + DNC_SCOPES.join(", "));
    else data.scope = s;
  }
  return { data, errors, rowNumber };
}

// ── Keys ─────────────────────────────────────────────────────────────────────
function companyKeyOf(d) {
  if (d.external_id) return "ext:" + normText(d.external_id).toUpperCase();
  if (d.company_name) return "nat:" + normId(d.company_name) + ":" + normId(d.city);
  return null;
}
// A Company_Key cell may be an explicit ext:/name:, a bare company name, or blank.
function parseCompanyKeyCell(v) {
  const s = normText(v);
  if (!s) return null;
  const m = s.match(/^(ext|name)\s*:\s*(.+)$/i);
  if (m) return m[1].toLowerCase() === "ext" ? "ext:" + m[2].trim().toUpperCase() : "auto:" + m[2].trim().toUpperCase();
  return "auto:" + s.toUpperCase();
}
function agentKeyOf(d) {
  if (d.external_id) return "ext:" + normText(d.external_id).toUpperCase();
  if (d.email) return "email:" + String(d.email).trim().toLowerCase();
  if (d.license_number) return "lic:" + normId(d.license_number);
  if (d.full_name) return "nat:" + normId(d.full_name) + ":" + normId(d.company_name_snapshot);
  return null;
}
function escrowKeyOf(d) {
  if (d.external_id) return "ext:" + normText(d.external_id).toUpperCase();
  if (d.email) return "email:" + String(d.email).trim().toLowerCase();
  if (d.officer_name) return "nat:" + normId(d.officer_name) + ":" + normId(d.company_name_snapshot);
  return null;
}

// ── Cross-workbook guard (symmetric with the intelligence importer) ──────────
const CAPITAL_INTELLIGENCE_SHEETS = ["Properties", "Property_Updates", "Contacts",
  "Property_Contacts", "Loans", "Tenants", "Distress_Signals", "Lender_Programs", "Daily_Actions"];
function foreignWorkbookError(allSheetNames) {
  const norm = (allSheetNames || []).map(normHeader);
  const ownHits = Object.keys(SHEETS).filter((s) => norm.includes(normHeader(s))).length;
  const ciHits = CAPITAL_INTELLIGENCE_SHEETS.filter((s) => norm.includes(normHeader(s))).length;
  if (ownHits === 0 && ciHits > 0) {
    return "This workbook belongs to Capital Intelligence (Palm Beach). Upload it in /admin/intelligence.";
  }
  return null;
}

// ── Action planning ──────────────────────────────────────────────────────────
// existing: { companies, agents, escrow, signals, dncs: Map(key→{id,record}),
//             openOutreach: Set, crmByEmail: Map(email→contactId) }
// ctx: { adminId, today, genId }
function planActions(rows, existing, ctx) {
  const out = [];
  const seen = new Set();
  const newCompanies = new Map();  // key → id
  const newAgents = new Map();     // key → id
  const sum = { insert: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  const E = existing || {};
  const maps = {
    companies: E.companies || new Map(), agents: E.agents || new Map(),
    escrow: E.escrow || new Map(), signals: E.signals || new Map(),
    dncs: E.dncs || new Map(), openOutreach: E.openOutreach || new Set(),
    crmByEmail: E.crmByEmail || new Map(),
  };

  function push(sheet, r, target, action, key, before, after, targetId, extraErr) {
    const errs = (r.errors || []).concat(extraErr || []);
    if (action === "invalid") sum.invalid++; else sum[action]++;
    out.push({
      sheet_name: sheet, row_number: r.rowNumber, target_type: target,
      dedupe_key: key || null, proposed_action: action,
      raw_data: r.data, normalized_data: r.data,
      before_data: before || null, after_data: after || null,
      validation_errors: errs, target_record_id: targetId || null,
    });
  }

  // Confidence/diff decision for an update. Returns {action, changed, err?}.
  function decide(target, rec, incoming, confField) {
    const changed = {};
    for (const k of Object.keys(incoming)) {
      if (["id", "created_at", "updated_at", "owner_id", "created_by", "updated_by"].includes(k)) continue;
      if (incoming[k] === null || incoming[k] === undefined) continue;
      const cur = rec[k];
      const same = (typeof incoming[k] === "number" && typeof cur === "number")
        ? Math.abs(incoming[k] - cur) < 1e-9
        : String(cur ?? "") === String(incoming[k] ?? "");
      if (!same) changed[k] = incoming[k];
    }
    const material = Object.keys(changed).filter((k) => !["source_url", "last_verified_at"].includes(k));
    if (!Object.keys(changed).length) return { action: "unchanged" };
    if (!material.length) return { action: "update", changed };
    if (confField) {
      const cr = confidenceRank(rec[confField] || "Unknown"), nr = confidenceRank(incoming[confField] || "Unknown");
      if (nr < cr) return { action: "conflict", changed, err: "incoming " + (incoming[confField] || "Unknown") + " would overwrite " + (rec[confField] || "Unknown") + " data (fields: " + material.join(", ") + ")" };
      if (nr === cr) {
        const tv = TIME_VARYING[target] || [];
        const hard = material.filter((k) => !tv.includes(k));
        if (hard.length) return { action: "conflict", changed, err: "same-confidence change to non-time-varying fields: " + hard.join(", ") };
      }
    }
    return { action: "update", changed };
  }

  function resolveCompany(cellOrName) {
    const parsed = parseCompanyKeyCell(cellOrName);
    if (!parsed) return null;
    const tryKeys = parsed.startsWith("auto:")
      ? ["nat:" + normId(parsed.slice(5)) + ":", parsed.slice(5)]  // by natural name (any city) or literal
      : [parsed];
    // exact ext / nat match first
    for (const k of [parsed].filter((k) => !k.startsWith("auto:"))) {
      if (maps.companies.has(k)) return maps.companies.get(k).id;
      if (newCompanies.has(k)) return newCompanies.get(k);
    }
    // auto: resolve by company name prefix (nat:NAME:city — match on the name part)
    if (parsed.startsWith("auto:")) {
      const nm = normId(parsed.slice(5));
      for (const [k, v] of maps.companies) if (k.startsWith("nat:" + nm + ":")) return v.id;
      for (const [k, v] of newCompanies) if (k.startsWith("nat:" + nm + ":")) return v;
      if (maps.companies.has("ext:" + parsed.slice(5))) return maps.companies.get("ext:" + parsed.slice(5)).id;
    }
    return null;
  }
  function linkCrm(email) {
    if (!email) return null;
    return maps.crmByEmail.get(String(email).trim().toLowerCase()) || null;
  }

  // ── Companies (first — agents/escrow/signals reference them) ──
  for (const r of rows.Companies || []) {
    if (r.errors.length) { push("Companies", r, "company", "invalid"); continue; }
    const d = r.data;
    const key = companyKeyOf(d);
    const allKeys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      d.company_name && ("nat:" + normId(d.company_name) + ":" + normId(d.city))].filter(Boolean);
    if (allKeys.some((k) => seen.has("co|" + k))) { push("Companies", r, "company", "invalid", key, null, null, null, ["duplicate company row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("co|" + k));
    const hit = allKeys.map((k) => maps.companies.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, company_name: d.company_name, company_type: d.company_type,
      address_line1: d.address_line1, city: d.city, state: d.state || "CA", postal_code: d.postal_code,
      phone: d.phone, email: d.email, website: d.website, agent_count: d.agent_count,
      specialty: d.specialty, active_status: d.active_status || "active", notes: d.notes,
      data_confidence: d.data_confidence, source_url: d.source_url,
      last_verified_at: d.last_verified_at ? d.last_verified_at + "T00:00:00Z" : null };
    if (!hit) {
      const id = ctx.genId();
      allKeys.forEach((k) => newCompanies.set(k, id));
      const ins = Object.assign({ id, created_by: ctx.adminId }, rec);
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Companies", r, "company", "insert", key, null, ins, id);
    } else {
      const dec = decide("company", hit.record || {}, rec, "data_confidence");
      if (dec.action === "unchanged") push("Companies", r, "company", "unchanged", key, hit.record, null, hit.id);
      else { if (dec.changed) dec.changed.updated_by = ctx.adminId; push("Companies", r, "company", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []); }
    }
  }

  // ── Agents ──
  for (const r of rows.Agents || []) {
    if (r.errors.length) { push("Agents", r, "agent", "invalid"); continue; }
    const d = r.data;
    const key = agentKeyOf(d);
    const allKeys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      d.email && ("email:" + d.email.toLowerCase()),
      d.license_number && ("lic:" + normId(d.license_number)),
      d.full_name && ("nat:" + normId(d.full_name) + ":" + normId(d.company_name_snapshot))].filter(Boolean);
    if (allKeys.some((k) => seen.has("ag|" + k))) { push("Agents", r, "agent", "invalid", key, null, null, null, ["duplicate agent row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("ag|" + k));
    const companyId = resolveCompany(d.company_key || d.company_name_snapshot);
    const hit = allKeys.map((k) => maps.agents.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, full_name: d.full_name,
      company_name_snapshot: d.company_name_snapshot, company_id: companyId,
      license_number: d.license_number, job_title: d.job_title, email: d.email, phone: d.phone,
      website: d.website, city: d.city, state: d.state || "CA", specialty: d.specialty,
      production_volume: d.production_volume, deal_count: d.deal_count, status: d.status || "active",
      tags: d.tags ? d.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
      notes: d.notes, linked_contact_id: linkCrm(d.email),
      data_confidence: d.data_confidence, source_url: d.source_url,
      last_verified_at: d.last_verified_at ? d.last_verified_at + "T00:00:00Z" : null,
      license_status: d.license_status, county: d.county, service_areas: d.service_areas,
      activity_evidence: d.activity_evidence, buyer_side_relevance: d.buyer_side_relevance,
      production_tier: d.production_tier, partner_score: d.partner_score, why_relevant: d.why_relevant,
      next_step: d.next_step, connection_note: d.connection_note, priority: d.priority, linkedin_url: d.linkedin_url };
    if (!hit) {
      const id = ctx.genId();
      allKeys.forEach((k) => newAgents.set(k, id));
      const ins = Object.assign({ id, created_by: ctx.adminId }, rec, { tags: rec.tags || [] });
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Agents", r, "agent", "insert", key, null, ins, id);
    } else {
      const dec = decide("agent", hit.record || {}, rec, "data_confidence");
      if (dec.action === "unchanged") push("Agents", r, "agent", "unchanged", key, hit.record, null, hit.id);
      else { if (dec.changed) dec.changed.updated_by = ctx.adminId; push("Agents", r, "agent", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []); }
    }
  }

  // ── Escrow & Title ──
  for (const r of rows.Escrow_Title || []) {
    if (r.errors.length) { push("Escrow_Title", r, "escrow_title", "invalid"); continue; }
    const d = r.data;
    const key = escrowKeyOf(d);
    const allKeys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      d.email && ("email:" + d.email.toLowerCase()),
      d.officer_name && ("nat:" + normId(d.officer_name) + ":" + normId(d.company_name_snapshot))].filter(Boolean);
    if (allKeys.some((k) => seen.has("es|" + k))) { push("Escrow_Title", r, "escrow_title", "invalid", key, null, null, null, ["duplicate escrow/title row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("es|" + k));
    const companyId = resolveCompany(d.company_key || d.company_name_snapshot);
    const hit = allKeys.map((k) => maps.escrow.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, officer_name: d.officer_name,
      company_name_snapshot: d.company_name_snapshot, company_id: companyId, role: d.role,
      license_number: d.license_number, email: d.email, phone: d.phone, city: d.city,
      state: d.state || "CA", transaction_volume: d.transaction_volume, status: d.status || "active",
      tags: d.tags ? d.tags.split(",").map((t) => t.trim()).filter(Boolean) : null, notes: d.notes,
      linked_contact_id: linkCrm(d.email), data_confidence: d.data_confidence, source_url: d.source_url,
      last_verified_at: d.last_verified_at ? d.last_verified_at + "T00:00:00Z" : null,
      organization_type: d.organization_type, regulator: d.regulator, license_status: d.license_status,
      county: d.county, service_areas: d.service_areas, partner_score: d.partner_score,
      why_relevant: d.why_relevant, next_step: d.next_step, connection_note: d.connection_note, priority: d.priority, linkedin_url: d.linkedin_url };
    if (!hit) {
      const id = ctx.genId();
      const ins = Object.assign({ id, created_by: ctx.adminId }, rec, { tags: rec.tags || [] });
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Escrow_Title", r, "escrow_title", "insert", key, null, ins, id);
    } else {
      const dec = decide("escrow_title", hit.record || {}, rec, "data_confidence");
      if (dec.action === "unchanged") push("Escrow_Title", r, "escrow_title", "unchanged", key, hit.record, null, hit.id);
      else { if (dec.changed) dec.changed.updated_by = ctx.adminId; push("Escrow_Title", r, "escrow_title", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []); }
    }
  }

  // Resolve a Subject_Key/Subject_Name to an agent or company (snapshot always kept).
  function resolveSubject(cell, name) {
    const raw = normText(cell) || normText(name);
    let agentId = null, companyId = null;
    if (raw) {
      const em = raw.includes("@") ? raw.toLowerCase() : null;
      const tryA = [em && ("email:" + em), "ext:" + raw.toUpperCase(), "nat:" + normId(raw) + ":"];
      for (const k of tryA.filter(Boolean)) {
        if (k.endsWith(":")) {
          for (const [mk, v] of maps.agents) if (mk.startsWith(k)) { agentId = v.id; break; }
          if (!agentId) for (const [mk, v] of newAgents) if (mk.startsWith(k)) { agentId = v; break; }
        } else if (maps.agents.has(k)) agentId = maps.agents.get(k).id;
        else if (newAgents.has(k)) agentId = newAgents.get(k);
        if (agentId) break;
      }
      if (!agentId) companyId = resolveCompany(raw);
    }
    return { agentId, companyId };
  }

  // ── Do Not Contact ──
  for (const r of rows.Do_Not_Contact || []) {
    if (r.errors.length) { push("Do_Not_Contact", r, "do_not_contact", "invalid"); continue; }
    const d = r.data;
    const allKeys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      d.email && ("email:" + d.email.toLowerCase()),
      d.subject_name && ("nat:" + normId(d.subject_name))].filter(Boolean);
    const key = allKeys[0];
    if (allKeys.some((k) => seen.has("dnc|" + k))) { push("Do_Not_Contact", r, "do_not_contact", "invalid", key, null, null, null, ["duplicate do-not-contact row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("dnc|" + k));
    const hit = allKeys.map((k) => maps.dncs.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, subject_type: d.subject_type, subject_name: d.subject_name,
      company_name_snapshot: d.company_name_snapshot, email: d.email, phone: d.phone,
      scope: d.scope || "all", reason: d.reason, effective_date: d.effective_date,
      expires_date: d.expires_date, source_url: d.source_url, notes: d.notes };
    if (!hit) {
      const id = ctx.genId();
      const ins = Object.assign({ id, created_by: ctx.adminId }, rec);
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Do_Not_Contact", r, "do_not_contact", "insert", key, null, ins, id);
    } else {
      const dec = decide("do_not_contact", hit.record || {}, rec, null);
      if (dec.action === "unchanged") push("Do_Not_Contact", r, "do_not_contact", "unchanged", key, hit.record, null, hit.id);
      else { if (dec.changed) dec.changed.updated_by = ctx.adminId; push("Do_Not_Contact", r, "do_not_contact", dec.action, key, hit.record || null, dec.changed, hit.id); }
    }
  }

  // ── Activity Signals ──
  for (const r of rows.Activity_Signals || []) {
    if (r.errors.length) { push("Activity_Signals", r, "activity_signal", "invalid"); continue; }
    const d = r.data;
    const sub = resolveSubject(d.subject_key, d.subject_name);
    const keys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      "nat:" + normId(d.subject_name) + ":" + d.signal_type + ":" + (d.signal_date || "")].filter(Boolean);
    if (keys.some((k) => seen.has("sig|" + k))) { push("Activity_Signals", r, "activity_signal", "invalid", keys[0], null, null, null, ["duplicate activity-signal row in this file"]); continue; }
    keys.forEach((k) => seen.add("sig|" + k));
    const hit = keys.map((k) => maps.signals.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, subject_type: d.subject_type, subject_name: d.subject_name,
      agent_id: sub.agentId, company_id: sub.companyId, signal_type: d.signal_type,
      signal_date: d.signal_date, detail: d.detail, market: d.market, relevance: d.relevance,
      url: d.url, confidence: d.confidence, source_url: d.source_url, source_title: d.source_title };
    if (!hit) {
      const id = ctx.genId();
      const ins = Object.assign({ id, created_by: ctx.adminId }, rec);
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Activity_Signals", r, "activity_signal", "insert", keys[0], null, ins, id);
    } else {
      const dec = decide("activity_signal", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Activity_Signals", r, "activity_signal", "unchanged", keys[0], hit.record, null, hit.id);
      else push("Activity_Signals", r, "activity_signal", dec.action, keys[0], hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
  }

  // ── Outreach Actions (skip identical still-open actions) ──
  for (const r of rows.Outreach_Actions || []) {
    if (r.errors.length) { push("Outreach_Actions", r, "outreach_action", "invalid"); continue; }
    const d = r.data;
    const sub = resolveSubject(d.subject_key, d.subject_name);
    const key = "oa:" + (d.action_type || "") + ":" + normId(d.subject_name) + ":" + String(d.action).toUpperCase().slice(0, 120);
    if (seen.has(key) || maps.openOutreach.has(key)) { push("Outreach_Actions", r, "outreach_action", "unchanged", key, null, null, null, ["identical open outreach action already exists"]); continue; }
    seen.add(key);
    const id = ctx.genId();
    const ins = { id, priority: d.priority, action_type: d.action_type, subject_type: d.subject_type,
      subject_name: d.subject_name, agent_id: sub.agentId, company_id: sub.companyId,
      channel: d.channel, due_date: d.due_date, action: d.action, reason: d.reason,
      status: (d.status || "open"), notes: d.notes, created_by: ctx.adminId };
    Object.keys(ins).forEach((k) => { if (ins[k] === null || ins[k] === undefined) delete ins[k]; });
    push("Outreach_Actions", r, "outreach_action", "insert", key, null, ins, id);
  }

  const conflicts = out.filter((r) => r.proposed_action === "conflict");
  const errors = out.filter((r) => r.proposed_action === "invalid");
  return { rows: out, summary: sum, conflicts, errors };
}

module.exports = {
  MAX_FILE_BYTES, CONFIDENCE, SHEETS, SIGNAL_TYPES, DNC_SCOPES, TIME_VARYING,
  CAPITAL_INTELLIGENCE_SHEETS,
  confidenceRank, normText, normNumber, normInt, normDate, normBool, normConfidence, normUrl,
  normId, normHeader, checkFile, normalizeRow, planActions,
  companyKeyOf, agentKeyOf, escrowKeyOf, foreignWorkbookError,
};
