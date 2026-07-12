// ============================================================================
// PEGASUS — Universal Import Mapper: preview endpoint (admin only)
// POST { module, filename, file_base64, mapping?, profile_id?, override? }
//   with Authorization: Bearer <jwt>
//
// Two phases in one endpoint:
//  • No `mapping`  → DETECT: parse the file (CSV or XLSX), guard against the
//                    wrong module, suggest per-sheet entity + column mapping,
//                    and return matching saved profiles. Nothing is stored.
//  • With `mapping`→ PREVIEW: apply the (admin-confirmed) mapping, normalize into
//                    the module's CANONICAL rows, run the module's own planner
//                    (dedupe/conflict/confidence), store the batch + rows with
//                    provenance (source_kind='mapped'), and return the plan +
//                    data-quality report + fuzzy-duplicate warnings.
//
// Commit/rollback reuse the module's EXISTING functions/RPCs — mapped rows are
// stored in the same shape as native imports, so atomic commit + edit-aware
// rollback + audit logging are unchanged. Records never cross modules.
//
// Security preserved: admin JWT (requireAdmin), file extension/signature/size/
// macro/formula checks on the ORIGINAL upload, URL validation via the module's
// normalizeRow, private storage, and audit logging.
// ============================================================================
"use strict";

const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { stripTableParts } = require("./lib/xlsx-sanitize.js");
const icore = require("./lib/intelligence-import-core.js");
const mapper = require("./lib/import-mapper-core.js");
const schemas = require("./lib/import-mapper-schemas.js");
const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

const MOD = {
  partner: {
    batches: "pn_import_batches", rows: "pn_import_rows", profiles: "pn_import_profiles",
    bucket: "partner-network-private", descriptor: schemas.DESCRIPTORS.partner,
    loadExisting: () => require("./partner-import-preview.js")._loadExisting,
    nameIndex: partnerNameIndex,
  },
  intelligence: {
    batches: "pci_import_batches", rows: "pci_import_rows", profiles: "pci_import_profiles",
    bucket: "capital-intelligence-private", descriptor: schemas.DESCRIPTORS.intelligence,
    loadExisting: () => require("./intelligence-import-preview.js")._loadExisting,
    nameIndex: intelNameIndex,
  },
};

async function partnerNameIndex(supabase) {
  const idx = { Agents: [], Escrow_Title: [], Companies: [] };
  const q = async (t, sel) => { const r = await supabase.from(t).select(sel).limit(10000); return r.error ? [] : (r.data || []); };
  for (const a of await q("pn_agents", "id, full_name, company_name_snapshot")) idx.Agents.push({ id: a.id, name: a.full_name, company: a.company_name_snapshot });
  for (const s of await q("pn_escrow_title", "id, officer_name, company_name_snapshot")) idx.Escrow_Title.push({ id: s.id, name: s.officer_name, company: s.company_name_snapshot });
  for (const c of await q("pn_companies", "id, company_name, city")) idx.Companies.push({ id: c.id, name: c.company_name, company: c.city });
  return idx;
}
async function intelNameIndex(supabase) {
  const idx = { Properties: [], Contacts: [] };
  const q = async (t, sel) => { const r = await supabase.from(t).select(sel).limit(10000); return r.error ? [] : (r.data || []); };
  for (const p of await q("pci_properties", "id, property_name, city")) idx.Properties.push({ id: p.id, name: p.property_name, company: p.city });
  for (const c of await q("crm_contacts", "id, name, company")) idx.Contacts.push({ id: c.id, name: c.name, company: c.company });
  return idx;
}

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

// Extract RAW sheets ([{name, headers[], rows[][]}]) for the mapper.
async function extractSheets(filename, buf) {
  if (String(filename || "").toLowerCase().endsWith(".csv")) {
    return [mapper.sheetFromCsv(String(filename).replace(/\.csv$/i, ""), buf.toString("utf8"))];
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await stripTableParts(buf)); // table-safe + OOXML handled downstream
  const sheets = [];
  for (const ws of wb.worksheets) {
    const headerRow = ws.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellValToHeader(cellVal(cell)); });
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const arr = [];
      let any = false;
      for (let c = 1; c <= headers.length; c++) {
        const v = cellVal(row.getCell(c));
        arr[c - 1] = v;
        if (v && typeof v === "object" && v.__formula) any = true;
        else if (v !== null && v !== undefined && String(v).trim() !== "") any = true;
      }
      if (any) rows.push(arr);
    });
    sheets.push({ name: ws.name, headers: headers.map((h) => (h == null ? "" : h)), rows: rows, firstDataRow: 2 });
  }
  return sheets;
}
function cellValToHeader(v) { return v && typeof v === "object" && v.__formula ? "" : (v == null ? "" : String(v)); }

// File-level checks: CSV (size only) or delegate to the native XLSX checks.
function checkImportFile(filename, buf) {
  const fn = String(filename || "").toLowerCase();
  if (fn.endsWith(".csv")) {
    const errs = [];
    if (!buf || !buf.length) errs.push("Empty file.");
    else if (buf.length > icore.MAX_FILE_BYTES) errs.push("File exceeds the " + (icore.MAX_FILE_BYTES / 1048576) + "MB limit.");
    return errs;
  }
  if (!/\.xlsx$/.test(fn)) return ["Only .xlsx or .csv files are accepted (got: " + (filename || "unnamed") + ")."];
  return icore.checkFile(filename, buf);
}

// Sample rows (raw objects) for the mapping UI.
function sampleRows(sheet, n) {
  return (sheet.rows || []).slice(0, n || 5).map((r) => mapper.rawObject(sheet.headers, r.map((v) => (v && typeof v === "object" && v.__formula ? "=formula" : v))));
}

exports._extractSheets = extractSheets; // offline QA

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  const { uid, supabase } = auth;
  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return resp(400, { ok: false, error: "invalid JSON body" }); }
    const modKey = body.module === "intelligence" ? "intelligence" : body.module === "partner" ? "partner" : null;
    if (!modKey) return resp(400, { ok: false, error: "unknown module (expected 'partner' or 'intelligence')" });
    const M = MOD[modKey];
    const descriptor = M.descriptor;
    const filename = String(body.filename || "").slice(0, 200);
    if (!body.file_base64) return resp(400, { ok: false, error: "missing file_base64" });
    let buf;
    try { buf = Buffer.from(String(body.file_base64), "base64"); } catch (_) { return resp(400, { ok: false, error: "file_base64 is not valid base64" }); }

    const fileErrors = checkImportFile(filename, buf);
    if (fileErrors.length) return resp(422, { ok: false, error: "file rejected", details: fileErrors });

    let sheets;
    try { sheets = await extractSheets(filename, buf); }
    catch (e) { return resp(422, { ok: false, error: "could not read file: " + e.message }); }
    sheets = sheets.filter((s) => (s.headers || []).some((h) => String(h).trim() !== ""));
    if (!sheets.length) return resp(422, { ok: false, error: "no readable sheets/columns in the file" });
    const totalRows = sheets.reduce((n, s) => n + (s.rows || []).length, 0);
    if (!totalRows) return resp(422, { ok: false, error: "file has no data rows" });
    if (totalRows > 5000) return resp(422, { ok: false, error: "file too large (" + totalRows + " rows; max 5000 per import)" });

    // Borrower/consumer PII guard — Partner Network must reject lead data.
    if (descriptor.rejectBorrower) {
      const borrower = mapper.borrowerFieldsPresent(sheets);
      if (borrower.length) {
        return resp(422, { ok: false, error: "This file appears to contain borrower or consumer lead data. Use the authorized borrower CRM workflow instead.", borrower_fields: borrower });
      }
    }
    // Built-in profile recognition (module-isolated).
    const builtin = schemas.matchBuiltinProfile(sheets, modKey);

    // ── DETECT phase (no mapping supplied) ──
    if (!body.mapping) {
      const modDetect = schemas.detectModule(sheets, modKey);
      if (modDetect.wrongModule && !body.override) {
        return resp(200, {
          ok: true, phase: "wrong_module",
          wrong_module: { message: modDetect.message, module_label: modDetect.otherLabel, route: modDetect.otherRoute },
          detection: modDetect,
          note: "Override is allowed only for generic contact files with a manually chosen target entity.",
        });
      }
      const suggestion = mapper.autoMap(sheets, descriptor);
      // Overlay a matching built-in profile's whitelisted value transforms.
      if (builtin) schemas.applyBuiltinTransforms(suggestion, builtin.profile);
      // Match saved profiles by header fingerprint or sheet-name hint.
      const fps = suggestion.map((s) => s.fingerprint);
      const { data: profs } = await supabase.from(M.profiles).select("id, name, description, fingerprints, sheet_name_hints, mapping, mapping_version").limit(200);
      const matched = (profs || []).filter((p) =>
        (p.fingerprints || []).some((fp) => fps.includes(fp)) ||
        (p.sheet_name_hints || []).some((h) => sheets.some((s) => icore.normHeader(s.name) === icore.normHeader(h))));
      // Field metadata per entity so the UI can re-map when the admin overrides
      // the target entity (target list + required flags + aliases for matching).
      const entityFields = {};
      Object.keys(descriptor.entities).forEach((e) => {
        entityFields[e] = descriptor.entities[e].fields.map((f) => ({
          target: f.target, required: !!f.required, transform: f.transform || null,
          aliases: [f.target].concat(f.aliases || []).map(icore.normHeader),
        }));
      });
      return resp(200, {
        ok: true, phase: "map", module: modKey,
        detection: modDetect, entityFields: entityFields,
        detected_profile: builtin ? { id: builtin.profile.id, name: builtin.profile.name, description: builtin.profile.description, score: builtin.score } : null,
        sheets: suggestion.map((s) => ({
          sheet: s.sheet, headers: s.headers, fingerprint: s.fingerprint,
          detection: s.detection, entity: s.entity, entityConfidence: s.entityConfidence,
          columns: s.columns, rowCount: s.rowCount,
          samples: sampleRows(sheets.find((x) => x.name === s.sheet), 5),
        })),
        entities: Object.keys(descriptor.entities),
        profiles: matched.map((p) => ({ id: p.id, name: p.name, description: p.description, mapping: p.mapping, mapping_version: p.mapping_version })),
      });
    }

    // ── PREVIEW phase (mapping supplied) ──
    const mapping = body.mapping;
    const mappingSheets = Array.isArray(mapping.sheets) ? mapping.sheets : [];
    if (!mappingSheets.some((m) => m.entity)) return resp(422, { ok: false, error: "no sheet is mapped to a target entity" });

    // Re-apply the built-in profile's whitelisted value transforms server-side,
    // so the enum normalizations always run even if the client dropped them.
    if (builtin) schemas.applyBuiltinTransforms(mappingSheets, builtin.profile);

    const applied = mapper.applyMapping(sheets, mappingSheets, descriptor);
    const plannerRows = mapper.buildPlannerRows(applied.canonical, descriptor);
    const existing = await M.loadExisting()(supabase, uid);
    const today = new Date().toISOString().slice(0, 10);
    const plan = descriptor.planActions(plannerRows, existing, { adminId: uid, today: today, genId: () => crypto.randomUUID() });

    const quality = mapper.qualityReport(applied.canonical, descriptor);
    let fuzzy = [];
    try { fuzzy = mapper.fuzzyDuplicates(applied.canonical, descriptor, await M.nameIndex(supabase)); } catch (_) {}

    // Provenance lookup: provBySheet[contractSheet][index] = {sourceSheet,sourceRow,raw}
    const provBySheet = {};
    applied.provenance.forEach((p) => {
      (provBySheet[p.contractSheet] = provBySheet[p.contractSheet] || []).push(p);
    });

    // Store original file privately.
    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    const ym = today.slice(0, 7).replace("-", "/");
    const ext = filename.toLowerCase().endsWith(".csv") ? ".csv" : ".xlsx";
    const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(-80) || ("import" + ext);
    const storagePath = "imports/" + ym + "/" + checksum.slice(0, 16) + "-" + safeName;
    const up = await supabase.storage.from(M.bucket).upload(storagePath, buf, {
      contentType: ext === ".csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true,
    });
    if (up.error) return resp(500, { ok: false, error: "could not store file (apply the storage migration?): " + up.error.message });

    const profileId = /^[0-9a-f-]{36}$/i.test(String(body.profile_id || "")) ? body.profile_id : null;
    const mappingVersion = Number(mapping.mapping_version) || 1;
    const { data: batch, error: bErr } = await supabase.from(M.batches).insert({
      filename: filename || safeName, original_filename: filename || safeName,
      file_checksum: checksum, file_storage_path: storagePath, uploaded_by: uid, status: "previewed",
      source_kind: "mapped", import_profile_id: profileId, mapping: mapping, mapping_version: mappingVersion,
      summary: Object.assign({ sheets: Object.keys(applied.canonical), total_rows: quality.rows, mapped: true }, plan.summary),
      validation_errors: plan.errors.slice(0, 200).map((r) => ({ sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
    }).select("id").single();
    if (bErr) return resp(500, { ok: false, error: "could not create batch (apply migrations 075/076?): " + bErr.message });

    // Attach provenance to primary rows and stamp batch id / profile / version.
    const counters = {};
    const rows = plan.rows.map((r) => {
      const out = Object.assign({ batch_id: batch.id, import_profile_id: profileId, mapping_version: mappingVersion }, r);
      const list = provBySheet[r.sheet_name];
      if (list) {
        const idx = (r.row_number || 2) - 2;
        const prov = list[idx];
        if (prov) { out.source_sheet = prov.sourceSheet; out.source_row = prov.sourceRow; out.source_raw = prov.raw; }
      }
      if (r.target_type === "entity_source" && r.after_data) r.after_data.batch_id = batch.id;
      return out;
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error: rErr } = await supabase.from(M.rows).insert(rows.slice(i, i + 200));
      if (rErr) { await supabase.from(M.batches).update({ status: "failed" }).eq("id", batch.id); return resp(500, { ok: false, error: "could not store preview rows: " + rErr.message }); }
    }

    // Per-entity counts (each canonical sheet = one target entity).
    const entityCounts = {};
    plan.rows.forEach((r) => {
      const e = r.sheet_name; if (!e) return;
      const c = entityCounts[e] || (entityCounts[e] = { new: 0, updated: 0, unchanged: 0, conflict: 0, invalid: 0 });
      if (r.proposed_action === "insert") c.new++;
      else if (r.proposed_action === "update") c.updated++;
      else if (r.proposed_action === "unchanged") c.unchanged++;
      else if (r.proposed_action === "conflict") c.conflict++;
      else if (r.proposed_action === "invalid") c.invalid++;
    });

    console.log("[import-map-preview] module=" + modKey + " batch=" + batch.id + " by admin=" + uid + " rows=" + rows.length + " summary=" + JSON.stringify(plan.summary));
    return resp(200, {
      ok: true, phase: "preview", module: modKey, batch_id: batch.id, checksum, storage_path: storagePath,
      summary: plan.summary, entity_counts: entityCounts,
      detected_profile: builtin ? { id: builtin.profile.id, name: builtin.profile.name } : null,
      conflicts: plan.conflicts.slice(0, 100).map((r) => ({ sheet: r.sheet_name, row: r.row_number, key: r.dedupe_key, errors: r.validation_errors, changes: r.after_data })),
      invalid: plan.errors.slice(0, 100).map((r) => ({ sheet: r.sheet_name, row: r.row_number, errors: r.validation_errors })),
      quality: {
        missingRequired: quality.missingRequired.slice(0, 100),
        invalidEmail: quality.invalidEmail.slice(0, 100),
        invalidPhone: quality.invalidPhone.slice(0, 100),
        invalidEnum: quality.invalidEnum.slice(0, 100),
      },
      fuzzy_duplicates: fuzzy.slice(0, 100),
      transform_warnings: applied.warnings.slice(0, 100),
    });
  } catch (err) {
    console.error("[import-map-preview] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
