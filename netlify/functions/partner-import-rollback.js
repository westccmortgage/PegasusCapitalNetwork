// ============================================================================
// PEGASUS CALIFORNIA PARTNER NETWORK — import rollback (admin only)
// POST { batch_id }  with Authorization: Bearer <jwt>
// Delegates to pn_rollback_import_batch (073): last committed batch only, and
// only when nothing it touched was modified afterwards.
// ============================================================================
"use strict";

const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  const { uid, supabase } = auth;
  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return resp(400, { ok: false, error: "invalid JSON body" }); }
    const batchId = String(body.batch_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return resp(400, { ok: false, error: "missing/invalid batch_id" });
    const { data, error } = await supabase.rpc("pn_rollback_import_batch", { p_batch_id: batchId, p_admin_id: uid });
    if (error) return resp(500, { ok: false, error: "rollback failed (apply migration 073?): " + error.message });
    console.log("[partner-import-rollback] batch=" + batchId + " by admin=" + uid + " → " + JSON.stringify(data));
    return resp(data && data.ok ? 200 : 422, data);
  } catch (err) {
    console.error("[partner-import-rollback] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
