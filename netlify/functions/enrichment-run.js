// ============================================================================
// PEGASUS — Enrichment run (admin only)
// POST { entity_type, entity_id }  or  { job_id }   Authorization: Bearer <jwt>
//
// Creates/advances an enrichment job: queued → researching → review_ready.
// Proposals come from a pluggable research provider (ENRICHMENT_PROVIDER_URL);
// with none configured, the job is seeded with the standard enrichment
// worksheet (current values only — NO fabricated data) for the admin to fill.
// Every proposal is validated: a value with no source URL is rejected.
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

    let job;
    if (body.job_id) {
      const { data } = await supabase.from("pn_enrichment_jobs").select("*").eq("id", body.job_id).maybeSingle();
      if (!data) return resp(404, { ok: false, error: "job not found" });
      job = data;
    } else {
      const entityType = body.entity_type;
      if (!ecore.ENTITIES[entityType]) return resp(400, { ok: false, error: "entity_type must be agent, escrow_title or company" });
      if (!/^[0-9a-f-]{36}$/i.test(String(body.entity_id || ""))) return resp(400, { ok: false, error: "missing/invalid entity_id" });
      const table = ecore.ENTITIES[entityType].table;
      const { data: rec } = await supabase.from(table).select("*").eq("id", body.entity_id).maybeSingle();
      if (!rec) return resp(404, { ok: false, error: "entity not found" });
      const name = rec.full_name || rec.officer_name || rec.company_name || "record";
      const { data: created, error: cErr } = await supabase.from("pn_enrichment_jobs").insert({
        entity_type: entityType, entity_id: body.entity_id, entity_name: name,
        status: "researching", provider: process.env.ENRICHMENT_PROVIDER_URL ? "provider" : "manual", requested_by: uid,
      }).select("*").single();
      if (cErr) return resp(500, { ok: false, error: "could not create job (apply migration 078?): " + cErr.message });
      job = created;
      job._record = rec;
    }

    // Load the entity record if not already loaded.
    const table = ecore.ENTITIES[job.entity_type].table;
    let rec = job._record;
    if (!rec) { const r = await supabase.from(table).select("*").eq("id", job.entity_id).maybeSingle(); rec = r.data || {}; }

    // Gather proposals from the provider (if configured), else none.
    const proposals = [];
    const rejected = [];
    if (process.env.ENRICHMENT_PROVIDER_URL) {
      try {
        const r = await fetch(process.env.ENRICHMENT_PROVIDER_URL, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (process.env.ENRICHMENT_PROVIDER_KEY || "") },
          body: JSON.stringify({ entity_type: job.entity_type, record: publicSubset(rec) }),
        });
        const out = await r.json().catch(() => ({}));
        for (const p of (out.proposals || [])) {
          const v = ecore.validateProposal(job.entity_type, p);
          if (v.ok) proposals.push(v.field); else rejected.push({ field: p.target_field, error: v.error });
        }
      } catch (e) {
        await supabase.from("pn_enrichment_jobs").update({ status: "failed", error: "provider error: " + e.message }).eq("id", job.id);
        return resp(502, { ok: false, error: "research provider error: " + e.message });
      }
    }

    // Seed the standard worksheet, then overlay any validated provider proposals.
    const sheet = ecore.worksheet(job.entity_type, rec);
    const byField = {}; sheet.forEach((f) => { byField[f.target_field] = f; });
    proposals.forEach((p) => {
      const base = byField[p.target_field] || (byField[p.target_field] = { target_field: p.target_field, label: p.label, current_value: rec[p.target_field] != null ? String(rec[p.target_field]) : null });
      base.proposed_value = p.proposed_value; base.source_url = p.source_url; base.confidence = p.confidence; base.last_verified_date = p.last_verified_date;
    });

    // Replace any existing field rows for this job (idempotent re-run).
    await supabase.from("pn_enrichment_fields").delete().eq("job_id", job.id);
    const rows = Object.values(byField).map((f) => Object.assign({ job_id: job.id, status: "proposed", applied: false }, f));
    if (rows.length) {
      const { error: fErr } = await supabase.from("pn_enrichment_fields").insert(rows);
      if (fErr) return resp(500, { ok: false, error: "could not store proposals: " + fErr.message });
    }

    const { data: updated } = await supabase.from("pn_enrichment_jobs")
      .update({ status: "review_ready", error: rejected.length ? (rejected.length + " provider proposals rejected (no source / not allowed)") : null }).eq("id", job.id).select("*").single();

    console.log("[enrichment-run] job=" + job.id + " entity=" + job.entity_type + " by admin=" + uid + " proposals=" + proposals.length + " rejected=" + rejected.length);
    return resp(200, { ok: true, job: updated, fields: rows, rejected: rejected, provider_configured: !!process.env.ENRICHMENT_PROVIDER_URL });
  } catch (err) {
    console.error("[enrichment-run] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};

// Only public business fields are ever sent to a research provider — never
// borrower/consumer data (there is none on these tables) and never secrets.
function publicSubset(rec) {
  const keep = ["full_name", "officer_name", "company_name", "company_name_snapshot", "city", "state", "county", "license_number", "website", "linkedin_url"];
  const o = {}; keep.forEach((k) => { if (rec[k] != null) o[k] = rec[k]; }); return o;
}
