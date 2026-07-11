// ============================================================================
// PEGASUS CALIFORNIA PARTNER NETWORK — read one import batch + its rows (admin)
// POST { batch_id, only? }   only: 'conflict' | 'invalid' (default all)
// Read-only; used by the Import Center preview/conflict screen + error report.
// ============================================================================
"use strict";

const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  const { supabase } = auth;
  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return resp(400, { ok: false, error: "invalid JSON body" }); }
    const batchId = String(body.batch_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return resp(400, { ok: false, error: "missing/invalid batch_id" });
    const only = ["conflict", "invalid"].includes(body.only) ? body.only : null;

    const { data: batch, error: bErr } = await supabase.from("pn_import_batches")
      .select("*").eq("id", batchId).maybeSingle();
    if (bErr) return resp(500, { ok: false, error: bErr.message });
    if (!batch) return resp(404, { ok: false, error: "batch not found" });

    let q = supabase.from("pn_import_rows")
      .select("id, sheet_name, row_number, target_type, dedupe_key, proposed_action, before_data, after_data, validation_errors, status, target_record_id")
      .eq("batch_id", batchId).order("sheet_name").order("row_number").limit(5000);
    if (only) q = q.eq("proposed_action", only);
    const { data: rows, error: rErr } = await q;
    if (rErr) return resp(500, { ok: false, error: rErr.message });

    return resp(200, { ok: true, batch, rows: rows || [] });
  } catch (err) {
    console.error("[partner-import-batch] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
