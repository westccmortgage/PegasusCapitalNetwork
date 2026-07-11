// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — import preview (admin only)
// POST { filename, file_base64, force? }  with Authorization: Bearer <jwt>
//
// Validates the daily .xlsx workbook, stores the original privately, plans
// insert/update/unchanged/conflict/invalid actions per row (all semantics in
// lib/intelligence-import-core.js), and writes pci_import_batches +
// pci_import_rows with status 'previewed'. NOTHING touches live tables here —
// commit happens later via the transactional RPC.
// ============================================================================
"use strict";

const crypto = require("crypto");
const ExcelJS = require("exceljs");
const core = require("./lib/intelligence-import-core.js");
const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

const BUCKET = "capital-intelligence-private";

function cellVal(cell) {
  if (!cell) return null;
  let v = cell.value;
  if (v instanceof Date) return v;
  if (v && typeof v === "object") {
    if (v.formula !== undefined || v.sharedFormula !== undefined) return { __formula: true };
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.hyperlink !== undefined) return v.text !== undefined ? v.text : v.hyperlink;
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return { __formula: true };
    if (v.error !== undefined) return null;
  }
  return v;
}

async function parseWorkbook(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const bySheet = {};
  const found = [];
  const contractNames = Object.keys(core.SHEETS);
  for (const ws of wb.worksheets) {
    const match = contractNames.find((n) => core.normHeader(n) === core.normHeader(ws.name));
    if (!match) continue;
    found.push(match);
    const headerRow = ws.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = core.normHeader(cellVal(cell)); });
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const raw = {};
      let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const h = headers[col];
        if (!h) return;
        const v = cellVal(cell);
        if (v && typeof v === "object" && v.__formula) { raw["__formula__" + h] = true; any = true; return; }
        if (v !== null && v !== undefined && String(v).trim() !== "") any = true;
        raw[h] = v;
      });
      if (any) rows.push(core.normalizeRow(match, raw, rowNumber));
    });
    bySheet[match] = rows;
  }
  return { bySheet, found };
}

// Build key→{id,record} maps from live tables (service client bypasses RLS —
// the caller was already verified as admin).
async function loadExisting(supabase, adminId) {
  const E = { properties: new Map(), contacts: new Map(), loans: new Map(), tenants: new Map(),
    signals: new Map(), programs: new Map(), propertyContacts: new Map(), sources: new Map(),
    openActions: new Set() };
  const LIM = 10000;
  const q = async (t, sel) => {
    const { data, error } = await supabase.from(t).select(sel || "*").limit(LIM);
    if (error) { if (/does not exist|schema cache/i.test(error.message)) return []; throw new Error(t + ": " + error.message); }
    return data || [];
  };
  for (const p of await q("pci_properties")) {
    const rec = { id: p.id, record: p };
    if (p.parcel_id) E.properties.set("parcel:" + String(p.parcel_id).toUpperCase().replace(/[^A-Z0-9]/g, ""), rec);
    if (p.external_id) E.properties.set("ext:" + String(p.external_id).trim().toUpperCase(), rec);
    if (p.normalized_address) E.properties.set("addr:" + p.normalized_address, rec);
  }
  const { data: cts, error: ce } = await supabase.from("crm_contacts").select("*").eq("owner_id", adminId).limit(LIM);
  if (ce && !/does not exist/i.test(ce.message)) throw new Error("crm_contacts: " + ce.message);
  for (const c of cts || []) {
    const rec = { id: c.id, record: c };
    if (c.email) E.contacts.set("email:" + String(c.email).trim().toLowerCase(), rec);
    const ext = c.metadata && c.metadata.external_id;
    if (ext) E.contacts.set("ext:" + String(ext).trim().toUpperCase(), rec);
    if (c.name) E.contacts.set("name:" + (String(c.name).trim() + "|" + String(c.company || "").trim()).toUpperCase().replace(/\s+/g, " "), rec);
  }
  for (const l of await q("pci_loans")) {
    const rec = { id: l.id, record: l };
    if (l.instrument_number) E.loans.set("instr:" + String(l.instrument_number).toUpperCase().replace(/[^A-Z0-9]/g, ""), rec);
    if (l.external_id) E.loans.set("ext:" + String(l.external_id).trim().toUpperCase(), rec);
    E.loans.set("nat:" + l.property_id + ":" + (l.lender_contact_id || "") + ":" + (l.recorded_date || "") + ":" + (l.original_amount ?? ""), rec);
  }
  for (const t of await q("pci_tenants")) {
    E.tenants.set("t:" + t.property_id + ":" + String(t.tenant_name || "").trim().toUpperCase().replace(/\s+/g, " ") + ":" + String(t.suite || "").trim().toUpperCase(), { id: t.id, record: t });
  }
  for (const s of await q("pci_distress_signals")) {
    const rec = { id: s.id, record: s };
    if (s.external_id) E.signals.set("ext:" + String(s.external_id).trim().toUpperCase(), rec);
    E.signals.set("nat:" + s.property_id + ":" + s.signal_type + ":" + (s.event_date || "") + ":" + String(s.case_or_instrument_no || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), rec);
  }
  for (const g of await q("pci_lender_programs")) {
    const rec = { id: g.id, record: g };
    if (g.external_id) E.programs.set("ext:" + String(g.external_id).trim().toUpperCase(), rec);
    E.programs.set("nat:" + String(g.lender_name_snapshot || "").toUpperCase().replace(/\s+/g, " ") + ":" + String(g.program_name || "").toUpperCase().replace(/\s+/g, " "), rec);
  }
  for (const pc of await q("pci_property_contacts")) {
    E.propertyContacts.set("pc:" + pc.property_id + ":" + pc.crm_contact_id + ":" + pc.relationship_role, { id: pc.id, record: pc });
  }
  for (const s of await q("pci_sources", "id, normalized_url")) {
    if (s.normalized_url) E.sources.set("url:" + s.normalized_url, { id: s.id, record: s });
  }
  const { data: acts } = await supabase.from("pci_daily_actions")
    .select("action_type, property_id, action").eq("status", "open").limit(LIM);
  for (const a of acts || []) {
    E.openActions.add("a:" + (a.action_type || "") + ":" + (a.property_id || "") + ":" + String(a.action || "").toUpperCase().slice(0, 120));
  }
  return E;
}

// Exported for offline QA (qa/intelligence-audit.js) — no I/O of its own.
exports._parseWorkbook = parseWorkbook;

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  const { uid, supabase } = auth;

  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return resp(400, { ok: false, error: "invalid JSON body" }); }
    const filename = String(body.filename || "").slice(0, 200);
    const force = body.force === true;
    if (!body.file_base64) return resp(400, { ok: false, error: "missing file_base64" });
    let buf;
    try { buf = Buffer.from(String(body.file_base64), "base64"); } catch (_) { return resp(400, { ok: false, error: "file_base64 is not valid base64" }); }

    // 1. File-level validation (extension, signature, size, macros).
    const fileErrors = core.checkFile(filename, buf);
    if (fileErrors.length) return resp(422, { ok: false, error: "file rejected", details: fileErrors });

    // 2. Checksum + duplicate-file detection.
    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    const { data: dup } = await supabase.from("pci_import_batches")
      .select("id, status, created_at").eq("file_checksum", checksum)
      .in("status", ["previewed", "approved", "committed"]).limit(1);
    if (dup && dup.length && !force) {
      return resp(409, { ok: false, error: "duplicate file", details: [
        "This exact file (checksum match) was already imported on " + dup[0].created_at +
        " (batch " + dup[0].id + ", status " + dup[0].status + "). Pass force=true to import anyway." ] });
    }

    // 3. Parse workbook.
    let parsed;
    try { parsed = await parseWorkbook(buf); }
    catch (e) { return resp(422, { ok: false, error: "could not read workbook: " + e.message }); }
    if (!parsed.found.length) {
      return resp(422, { ok: false, error: "no recognized sheets", details: [
        "Expected any of: " + Object.keys(core.SHEETS).join(", ") ] });
    }
    const totalRows = Object.values(parsed.bySheet).reduce((n, r) => n + r.length, 0);
    if (!totalRows) return resp(422, { ok: false, error: "workbook has no data rows" });
    if (totalRows > 5000) return resp(422, { ok: false, error: "workbook too large (" + totalRows + " rows; max 5000 per import)" });

    // 4. Plan actions against live data.
    const existing = await loadExisting(supabase, uid);
    const today = new Date().toISOString().slice(0, 10);
    const plan = core.planActions(parsed.bySheet, existing, {
      adminId: uid, today, genId: () => crypto.randomUUID(),
    });

    // 5. Store the original file privately: imports/YYYY/MM/<checksum>-<name>.
    const ym = today.slice(0, 7).replace("-", "/");
    const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(-80) || "import.xlsx";
    const storagePath = "imports/" + ym + "/" + checksum.slice(0, 16) + "-" + safeName;
    const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
    if (up.error) return resp(500, { ok: false, error: "could not store file (apply migration 070?): " + up.error.message });

    // 6. Persist batch + rows.
    const { data: batch, error: bErr } = await supabase.from("pci_import_batches").insert({
      filename: filename || safeName, file_checksum: checksum, file_storage_path: storagePath,
      uploaded_by: uid, status: "previewed",
      summary: Object.assign({ sheets: parsed.found, total_rows: totalRows, forced: force }, plan.summary),
      validation_errors: plan.errors.slice(0, 200).map((r) => ({
        sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
    }).select("id").single();
    if (bErr) return resp(500, { ok: false, error: "could not create batch (apply migration 069?): " + bErr.message });

    const rows = plan.rows.map((r) => Object.assign({ batch_id: batch.id }, r));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: rErr } = await supabase.from("pci_import_rows").insert(rows.slice(i, i + 200));
      if (rErr) {
        await supabase.from("pci_import_batches").update({ status: "failed" }).eq("id", batch.id);
        return resp(500, { ok: false, error: "could not store preview rows: " + rErr.message });
      }
    }

    console.log("[intelligence-import-preview] batch=" + batch.id + " by admin=" + uid +
      " rows=" + rows.length + " summary=" + JSON.stringify(plan.summary));
    return resp(200, {
      ok: true, batch_id: batch.id, checksum, storage_path: storagePath,
      sheets: parsed.found, summary: plan.summary,
      conflicts: plan.conflicts.slice(0, 100).map((r) => ({
        row_id: null, sheet: r.sheet_name, row: r.row_number, key: r.dedupe_key,
        errors: r.validation_errors, changes: r.after_data })),
      invalid: plan.errors.slice(0, 100).map((r) => ({
        sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
      duplicate_of: dup && dup.length ? dup[0].id : null,
    });
  } catch (err) {
    console.error("[intelligence-import-preview] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
