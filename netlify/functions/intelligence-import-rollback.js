// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — import rollback (admin only)
// POST { batch_id }  with Authorization: Bearer <jwt>
//
// Delegates to pci_rollback_import_batch (069): rollback is permitted only for
// the most recent committed batch and only when nothing this batch touched was
// modified afterwards by anything else — otherwise it refuses and explains.
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
    const { data, error } = await supabase.rpc("pci_rollback_import_batch", {
      p_batch_id: batchId, p_admin_id: uid,
    });
    if (error) return resp(500, { ok: false, error: "rollback failed (apply migration 069?): " + error.message });
    console.log("[intelligence-import-rollback] batch=" + batchId + " by admin=" + uid + " → " + JSON.stringify(data));
    return resp(data && data.ok ? 200 : 422, data);
  } catch (err) {
    console.error("[intelligence-import-rollback] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
