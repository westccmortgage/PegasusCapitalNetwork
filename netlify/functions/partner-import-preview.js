// ============================================================================
// PEGASUS CALIFORNIA PARTNER NETWORK — import preview (admin only)
// POST { filename, file_base64, force? }  with Authorization: Bearer <jwt>
//
// Validates the partner .xlsx workbook (6 sheets), stores the original
// privately, plans insert/update/unchanged/conflict/invalid per row (all
// semantics in lib/partner-import-core.js), and writes pn_import_batches +
// pn_import_rows with status 'previewed'. Nothing touches live pn_ tables here.
// ============================================================================
"use strict";

const crypto = require("crypto");
const ExcelJS = require("exceljs");
const core = require("./lib/partner-import-core.js");
const { stripTableParts } = require("./lib/xlsx-sanitize.js");
const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

const BUCKET = "partner-network-private";

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
  // Strip any Excel table parts first — a malformed/dangling table relationship
  // otherwise crashes ExcelJS. Values/styles/validations/hyperlinks/formulas
  // are untouched (see lib/xlsx-sanitize.js).
  await wb.xlsx.load(await stripTableParts(buf));
  const bySheet = {};
  const found = [];
  const allSheetNames = wb.worksheets.map((ws) => ws.name);
  const contractNames = Object.keys(core.SHEETS);
  for (const ws of wb.worksheets) {
    // OOXML/namespace-normalized sheet matching (see core.normHeader).
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
  return { bySheet, found, allSheetNames };
}

async function loadExisting(supabase, adminId) {
  const E = { companies: new Map(), agents: new Map(), escrow: new Map(), signals: new Map(),
    dncs: new Map(), openOutreach: new Set(), crmByEmail: new Map() };
  const LIM = 10000;
  const q = async (t, sel) => {
    const { data, error } = await supabase.from(t).select(sel || "*").limit(LIM);
    if (error) { if (/does not exist|schema cache/i.test(error.message)) return []; throw new Error(t + ": " + error.message); }
    return data || [];
  };
  for (const c of await q("pn_companies")) {
    const rec = { id: c.id, record: c };
    if (c.external_id) E.companies.set("ext:" + String(c.external_id).trim().toUpperCase(), rec);
    E.companies.set("nat:" + core.normId(c.company_name) + ":" + core.normId(c.city), rec);
  }
  for (const a of await q("pn_agents")) {
    const rec = { id: a.id, record: a };
    if (a.external_id) E.agents.set("ext:" + String(a.external_id).trim().toUpperCase(), rec);
    if (a.email) E.agents.set("email:" + String(a.email).trim().toLowerCase(), rec);
    if (a.license_number) E.agents.set("lic:" + core.normId(a.license_number), rec);
    if (a.full_name) E.agents.set("nat:" + core.normId(a.full_name) + ":" + core.normId(a.company_name_snapshot), rec);
  }
  for (const s of await q("pn_escrow_title")) {
    const rec = { id: s.id, record: s };
    if (s.external_id) E.escrow.set("ext:" + String(s.external_id).trim().toUpperCase(), rec);
    if (s.email) E.escrow.set("email:" + String(s.email).trim().toLowerCase(), rec);
    if (s.officer_name) E.escrow.set("nat:" + core.normId(s.officer_name) + ":" + core.normId(s.company_name_snapshot), rec);
  }
  for (const s of await q("pn_activity_signals")) {
    const rec = { id: s.id, record: s };
    if (s.external_id) E.signals.set("ext:" + String(s.external_id).trim().toUpperCase(), rec);
    E.signals.set("nat:" + core.normId(s.subject_name) + ":" + s.signal_type + ":" + (s.signal_date || ""), rec);
  }
  for (const d of await q("pn_do_not_contact")) {
    const rec = { id: d.id, record: d };
    if (d.external_id) E.dncs.set("ext:" + String(d.external_id).trim().toUpperCase(), rec);
    if (d.email) E.dncs.set("email:" + String(d.email).trim().toLowerCase(), rec);
    if (d.subject_name) E.dncs.set("nat:" + core.normId(d.subject_name), rec);
  }
  for (const o of await q("pn_outreach_actions", "action_type, subject_name, action, status")) {
    if ((o.status || "open") === "open") {
      E.openOutreach.add("oa:" + (o.action_type || "") + ":" + core.normId(o.subject_name) + ":" + String(o.action || "").toUpperCase().slice(0, 120));
    }
  }
  // Existing CRM contacts (this admin's) — LINK ONLY by email; never created here.
  const { data: cts } = await supabase.from("crm_contacts").select("id, email").eq("owner_id", adminId).limit(LIM);
  for (const c of cts || []) if (c.email) E.crmByEmail.set(String(c.email).trim().toLowerCase(), c.id);
  return E;
}

// Exported for offline QA — no I/O of its own.
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

    const fileErrors = core.checkFile(filename, buf);
    if (fileErrors.length) return resp(422, { ok: false, error: "file rejected", details: fileErrors });

    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    const { data: dup } = await supabase.from("pn_import_batches")
      .select("id, status, created_at").eq("file_checksum", checksum)
      .in("status", ["previewed", "approved", "committed"]).limit(1);
    if (dup && dup.length && !force) {
      return resp(409, { ok: false, error: "duplicate file", details: [
        "This exact file (checksum match) was already imported on " + dup[0].created_at +
        " (batch " + dup[0].id + ", status " + dup[0].status + "). Pass force=true to import anyway." ] });
    }

    let parsed;
    try { parsed = await parseWorkbook(buf); }
    catch (e) { return resp(422, { ok: false, error: "could not read workbook: " + e.message }); }
    if (!parsed.found.length) {
      // Wrong-module guard: a Capital Intelligence (Palm Beach) workbook gets a
      // clear, actionable message instead of an opaque "no recognized sheets".
      const foreign = core.foreignWorkbookError(parsed.allSheetNames);
      if (foreign) return resp(422, { ok: false, error: foreign });
      return resp(422, { ok: false, error: "no recognized sheets", details: [
        "Expected any of: " + Object.keys(core.SHEETS).join(", ") ] });
    }
    const totalRows = Object.values(parsed.bySheet).reduce((n, r) => n + r.length, 0);
    if (!totalRows) return resp(422, { ok: false, error: "workbook has no data rows" });
    if (totalRows > 5000) return resp(422, { ok: false, error: "workbook too large (" + totalRows + " rows; max 5000 per import)" });

    const existing = await loadExisting(supabase, uid);
    const today = new Date().toISOString().slice(0, 10);
    const plan = core.planActions(parsed.bySheet, existing, { adminId: uid, today, genId: () => crypto.randomUUID() });

    const ym = today.slice(0, 7).replace("-", "/");
    const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(-80) || "import.xlsx";
    const storagePath = "imports/" + ym + "/" + checksum.slice(0, 16) + "-" + safeName;
    const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true,
    });
    if (up.error) return resp(500, { ok: false, error: "could not store file (apply migration 074?): " + up.error.message });

    const { data: batch, error: bErr } = await supabase.from("pn_import_batches").insert({
      filename: filename || safeName, file_checksum: checksum, file_storage_path: storagePath,
      uploaded_by: uid, status: "previewed",
      summary: Object.assign({ sheets: parsed.found, total_rows: totalRows, forced: force }, plan.summary),
      validation_errors: plan.errors.slice(0, 200).map((r) => ({ sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
    }).select("id").single();
    if (bErr) return resp(500, { ok: false, error: "could not create batch (apply migration 073?): " + bErr.message });

    const rows = plan.rows.map((r) => Object.assign({ batch_id: batch.id }, r));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: rErr } = await supabase.from("pn_import_rows").insert(rows.slice(i, i + 200));
      if (rErr) {
        await supabase.from("pn_import_batches").update({ status: "failed" }).eq("id", batch.id);
        return resp(500, { ok: false, error: "could not store preview rows: " + rErr.message });
      }
    }

    console.log("[partner-import-preview] batch=" + batch.id + " by admin=" + uid +
      " rows=" + rows.length + " summary=" + JSON.stringify(plan.summary));
    return resp(200, {
      ok: true, batch_id: batch.id, checksum, storage_path: storagePath,
      sheets: parsed.found, summary: plan.summary,
      conflicts: plan.conflicts.slice(0, 100).map((r) => ({
        row_id: null, sheet: r.sheet_name, row: r.row_number, key: r.dedupe_key,
        errors: r.validation_errors, changes: r.after_data })),
      invalid: plan.errors.slice(0, 100).map((r) => ({ sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
      duplicate_of: dup && dup.length ? dup[0].id : null,
    });
  } catch (err) {
    console.error("[partner-import-preview] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
