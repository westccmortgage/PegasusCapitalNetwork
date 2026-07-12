// ============================================================================
// PEGASUS — Enrichment commit (admin only)
// POST { job_id, decisions: { <field_id>: { action:'accept'|'reject'|'edit', value?, confidence?, source_url?, last_verified_date? } } }
//   Authorization: Bearer <jwt>
//
// Applies the admin-reviewed proposals to the entity:
//  • only whitelisted columns are written (column allowlist per entity);
//  • Verified data is NEVER overwritten by a lower-confidence value (skipped as
//    a conflict);
//  • a blank value never erases an existing value;
//  • every applied change is logged to pn_change_log (old → new, confidence,
//    source) for provenance/audit.
// The job becomes 'approved'. Nothing outside the allowlist can be written.
// ============================================================================
"use strict";

const ecore = require("./lib/enrichment-core.js");
const { requireAdmin, resp } = require("./lib/intelligence-auth.js");

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  const { uid, supabase } = auth;
  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return resp(400, { ok: false, error: "invalid JSON body" }); }
    if (!/^[0-9a-f-]{36}$/i.test(String(body.job_id || ""))) return resp(400, { ok: false, error: "missing/invalid job_id" });
    const decisions = (body.decisions && typeof body.decisions === "object") ? body.decisions : {};

    const { data: job } = await supabase.from("pn_enrichment_jobs").select("*").eq("id", body.job_id).maybeSingle();
    if (!job) return resp(404, { ok: false, error: "job not found" });
    if (!["review_ready", "researching"].includes(job.status)) return resp(422, { ok: false, error: "job is " + job.status + " — only a review_ready job can be committed" });
    const ent = ecore.ENTITIES[job.entity_type];
    const { data: rec } = await supabase.from(ent.table).select("*").eq("id", job.entity_id).maybeSingle();
    if (!rec) return resp(404, { ok: false, error: "entity no longer exists" });

    const { data: fields } = await supabase.from("pn_enrichment_fields").select("*").eq("job_id", job.id);
    const entityVerified = rec.data_confidence === "Verified";

    const updates = {}; const applied = []; const conflicts = []; const rejected = [];
    for (const f of (fields || [])) {
      const d = decisions[f.id] || {};
      const action = d.action || (f.status === "accepted" || f.status === "edited" ? "accept" : null);
      if (action === "reject") { await supabase.from("pn_enrichment_fields").update({ status: "rejected" }).eq("id", f.id); rejected.push(f.target_field); continue; }
      if (action !== "accept" && action !== "edit") continue;
      // Only whitelisted columns are writable.
      if (!ent.allow.has(f.target_field)) { rejected.push(f.target_field); continue; }
      const value = d.value != null ? String(d.value).trim() : (f.proposed_value != null ? String(f.proposed_value).trim() : "");
      if (value === "") continue; // blank never erases an existing value
      const conf = d.confidence || f.confidence || "Reported";
      // Verified-downgrade protection.
      if (entityVerified && ecore.confRank(conf) < ecore.confRank("Verified")) {
        conflicts.push({ field: f.target_field, reason: "would downgrade Verified data" });
        await supabase.from("pn_enrichment_fields").update({ status: "skipped_conflict" }).eq("id", f.id);
        continue;
      }
      updates[f.target_field] = ent.table === "pn_companies" && f.target_field === "agent_count" ? Number(value) || null : value;
      applied.push({ id: f.id, field: f.target_field, old: rec[f.target_field] == null ? null : rec[f.target_field], value: value, conf: conf, source: d.source_url || f.source_url || null });
    }

    if (Object.keys(updates).length) {
      updates.last_verified_at = new Date().toISOString();
      const { error: uErr } = await supabase.from(ent.table).update(updates).eq("id", job.entity_id);
      if (uErr) return resp(500, { ok: false, error: "could not apply enrichment: " + uErr.message });
      // Provenance / audit.
      const logs = applied.map((a) => ({
        entity_type: ent.table, entity_id: job.entity_id, field_name: a.field,
        old_value: a.old === null ? null : JSON.stringify(a.old), new_value: JSON.stringify(a.value),
        confidence_after: a.conf, changed_by: uid,
      }));
      for (let i = 0; i < logs.length; i += 200) await supabase.from("pn_change_log").insert(logs.slice(i, i + 200));
      for (const a of applied) await supabase.from("pn_enrichment_fields").update({ status: "applied", applied: true }).eq("id", a.id);
    }

    await supabase.from("pn_enrichment_jobs").update({ status: "approved", completed_at: new Date().toISOString() }).eq("id", job.id);
    console.log("[enrichment-commit] job=" + job.id + " by admin=" + uid + " applied=" + applied.length + " conflicts=" + conflicts.length);
    return resp(200, { ok: true, applied: applied.length, conflicts: conflicts, rejected: rejected.length, fields: applied.map((a) => a.field) });
  } catch (err) {
    console.error("[enrichment-commit] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
