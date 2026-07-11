/* ============================================================================
   PEGASUS CALIFORNIA PARTNER NETWORK — client data layer (admin only)
   window.PegPartnerAPI

   Two channels, no service keys in the browser:
   • Direct Supabase reads/writes — permitted purely by admin-only RLS (072/073).
   • Netlify functions for the import pipeline — called with the admin's own
     Supabase JWT; the function re-verifies admin status server-side.
   ============================================================================ */
(function () {
  "use strict";

  async function sb() { return await window.PegSB.ready; }
  async function jwt() {
    var c = await sb();
    var s = await c.auth.getSession();
    return s && s.data && s.data.session && s.data.session.access_token;
  }
  async function fn(name, payload) {
    var token = await jwt();
    if (!token) throw new Error("Not signed in.");
    var r = await fetch("/.netlify/functions/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(payload || {}),
    });
    var out = null;
    try { out = await r.json(); } catch (_) {}
    if (!out) throw new Error(name + ": empty response (" + r.status + ")");
    if (!r.ok && out.error) { var e = new Error(out.error); e.payload = out; throw e; }
    return out;
  }
  function err(r) { if (r.error) throw new Error(r.error.message || String(r.error)); return r; }

  /* ── Live admin re-check against the database (never trust a stale cache) ── */
  async function verifyAdmin() {
    try {
      var c = await sb();
      var u = await c.auth.getUser();
      var uid = u && u.data && u.data.user && u.data.user.id;
      if (!uid) return false;
      var r = await c.from("profiles").select("is_admin, role").eq("id", uid).maybeSingle();
      if (r.error) return false;
      return !!(r.data && (r.data.is_admin === true || r.data.role === "admin"));
    } catch (_) { return false; }
  }

  function lister(table, sel, order) {
    return async function () {
      var c = await sb();
      var q = c.from(table).select(sel || "*").limit(2000);
      if (order) q = q.order(order.col, { ascending: !!order.asc, nullsFirst: false });
      return err(await q).data || [];
    };
  }
  var listAgents = lister("pn_agents", "*, pn_companies(company_name,company_type)", { col: "updated_at" });
  var listEscrow = lister("pn_escrow_title", "*, pn_companies(company_name)", { col: "updated_at" });
  var listCompanies = lister("pn_companies", "*", { col: "company_name", asc: true });
  var listSignals = lister("pn_activity_signals", "*, pn_agents(full_name), pn_companies(company_name)", { col: "signal_date" });
  var listDnc = lister("pn_do_not_contact", "*", { col: "created_at" });
  async function listOutreach() {
    var c = await sb();
    return err(await c.from("pn_outreach_actions")
      .select("*, pn_agents(full_name,email), pn_companies(company_name)")
      .order("status").order("priority", { ascending: true, nullsFirst: false }).order("due_date").limit(2000)).data || [];
  }

  async function saveAgent(id, row) {
    var c = await sb();
    if (id) return err(await c.from("pn_agents").update(row).eq("id", id).select().single()).data;
    return err(await c.from("pn_agents").insert(row).select().single()).data;
  }
  async function saveCompany(id, row) {
    var c = await sb();
    if (id) return err(await c.from("pn_companies").update(row).eq("id", id).select().single()).data;
    return err(await c.from("pn_companies").insert(row).select().single()).data;
  }
  async function setOutreachStatus(id, status) {
    var c = await sb();
    var patch = { status: status };
    if (status === "done") patch.completed_at = new Date().toISOString();
    return err(await c.from("pn_outreach_actions").update(patch).eq("id", id).select().single()).data;
  }
  async function agentActivity(agentId) {
    var c = await sb();
    var out = {};
    var sig = await c.from("pn_activity_signals").select("*").eq("agent_id", agentId).order("signal_date", { ascending: false }).limit(50);
    out.signals = sig.error ? [] : (sig.data || []);
    var oa = await c.from("pn_outreach_actions").select("*").eq("agent_id", agentId).order("due_date").limit(50);
    out.outreach = oa.error ? [] : (oa.data || []);
    var ch = await c.from("pn_change_log").select("*").eq("entity_id", agentId).order("changed_at", { ascending: false }).limit(50);
    out.changes = ch.error ? [] : (ch.data || []);
    return out;
  }

  /* ── Dashboard ── */
  async function dashboard() {
    var c = await sb();
    var today = new Date().toISOString().slice(0, 10);
    var weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    async function count(q) { var r = await q; return r.error ? null : (r.count || 0); }
    var res = {};
    res.agents = await count(c.from("pn_agents").select("*", { count: "exact", head: true }));
    res.companies = await count(c.from("pn_companies").select("*", { count: "exact", head: true }));
    res.escrow = await count(c.from("pn_escrow_title").select("*", { count: "exact", head: true }));
    res.signals7d = await count(c.from("pn_activity_signals").select("*", { count: "exact", head: true }).gte("signal_date", weekAgo));
    res.outreachOpen = await count(c.from("pn_outreach_actions").select("*", { count: "exact", head: true }).eq("status", "open"));
    res.outreachDue = await count(c.from("pn_outreach_actions").select("*", { count: "exact", head: true }).eq("status", "open").lte("due_date", today));
    res.dnc = await count(c.from("pn_do_not_contact").select("*", { count: "exact", head: true }));
    var r1 = await c.from("pn_activity_signals").select("*, pn_agents(full_name)").order("signal_date", { ascending: false }).limit(10);
    res.recentSignals = r1.error ? [] : r1.data;
    var r2 = await c.from("pn_outreach_actions").select("*, pn_agents(full_name), pn_companies(company_name)").eq("status", "open").order("priority", { ascending: true, nullsFirst: false }).order("due_date").limit(8);
    res.topOutreach = r2.error ? [] : r2.data;
    var r3 = await c.from("pn_import_batches").select("*").order("created_at", { ascending: false }).limit(1);
    res.lastImport = r3.error || !r3.data.length ? null : r3.data[0];
    return res;
  }

  /* ── Data quality / health ── */
  async function health() {
    var c = await sb();
    var r = await c.rpc("pn_check_schema");
    return r.error ? { ok: false, error: r.error.message } : r.data;
  }

  /* ── Import pipeline (functions) ── */
  function importPreview(filename, base64, force) { return fn("partner-import-preview", { filename: filename, file_base64: base64, force: !!force }); }
  function importCommit(batchId, resolutions) { return fn("partner-import-commit", { batch_id: batchId, resolutions: resolutions || {} }); }
  function importRollback(batchId) { return fn("partner-import-rollback", { batch_id: batchId }); }
  function importBatch(batchId, only) { return fn("partner-import-batch", { batch_id: batchId, only: only }); }
  function importTemplate() { return fn("partner-template", {}); }
  async function listBatches() {
    var c = await sb();
    return err(await c.from("pn_import_batches").select("*").order("created_at", { ascending: false }).limit(50)).data || [];
  }
  async function rejectBatch(id) {
    var c = await sb();
    return err(await c.from("pn_import_batches").update({ status: "rejected" }).eq("id", id).in("status", ["uploaded", "previewed", "approved"]));
  }

  /* ── Universal Import Mapper ── */
  function mapPreview(payload) { return fn("import-map-preview", Object.assign({ module: "partner" }, payload)); }
  async function listImportProfiles() { var c = await sb(); return err(await c.from("pn_import_profiles").select("*").order("name")).data || []; }
  async function saveImportProfile(row) {
    var c = await sb();
    try { var u = await c.auth.getUser(); if (u && u.data && u.data.user) row.created_by = u.data.user.id; } catch (_) {}
    return err(await c.from("pn_import_profiles").insert(row).select().single()).data;
  }
  async function deleteImportProfile(id) { var c = await sb(); return err(await c.from("pn_import_profiles").delete().eq("id", id)); }

  window.PegPartnerAPI = {
    verifyAdmin: verifyAdmin, fn: fn,
    mapPreview: mapPreview, listImportProfiles: listImportProfiles,
    saveImportProfile: saveImportProfile, deleteImportProfile: deleteImportProfile,
    listAgents: listAgents, listEscrow: listEscrow, listCompanies: listCompanies,
    listSignals: listSignals, listDnc: listDnc, listOutreach: listOutreach,
    saveAgent: saveAgent, saveCompany: saveCompany, setOutreachStatus: setOutreachStatus,
    agentActivity: agentActivity, dashboard: dashboard, health: health,
    importPreview: importPreview, importCommit: importCommit, importRollback: importRollback,
    importBatch: importBatch, importTemplate: importTemplate, listBatches: listBatches, rejectBatch: rejectBatch,
  };
})();
