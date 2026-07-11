/* ============================================================================
   PEGASUS CAPITAL INTELLIGENCE — client data layer (admin only)
   window.PegIntelAPI

   Two channels, no service keys in the browser:
   • Direct Supabase reads/writes — permitted purely by admin-only RLS (068/069).
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

  /* ── Properties ── */
  async function listProperties() {
    var c = await sb();
    return err(await c.from("pci_properties").select("*").order("updated_at", { ascending: false }).limit(2000)).data || [];
  }
  async function saveProperty(id, row) {
    var c = await sb();
    if (id) return err(await c.from("pci_properties").update(row).eq("id", id).select().single()).data;
    return err(await c.from("pci_properties").insert(row).select().single()).data;
  }
  async function propertyChildren(id) {
    var c = await sb();
    var out = {};
    var reads = [
      ["contactsFor", c.from("pci_property_contacts").select("*, crm_contacts(id,name,company,email,phone,contact_type,job_title,data_confidence)").eq("property_id", id)],
      ["loans", c.from("pci_loans").select("*, crm_contacts(name,company)").eq("property_id", id).order("lien_position")],
      ["tenants", c.from("pci_tenants").select("*").eq("property_id", id).order("lease_expiration")],
      ["listings", c.from("pci_listings").select("*").eq("property_id", id).order("changed_on", { ascending: false })],
      ["signals", c.from("pci_distress_signals").select("*").eq("property_id", id).order("event_date", { ascending: false })],
      ["scores", c.from("pci_scores").select("*").eq("property_id", id).order("score_date", { ascending: false }).limit(30)],
      ["changes", c.from("pci_change_log").select("*").eq("entity_id", id).order("changed_at", { ascending: false }).limit(100)],
    ];
    for (var i = 0; i < reads.length; i++) {
      var r = await reads[i][1];
      out[reads[i][0]] = r.error ? [] : (r.data || []);
    }
    return out;
  }
  async function insertChild(table, row) {
    var c = await sb();
    return err(await c.from(table).insert(row).select().single()).data;
  }
  async function updateChild(table, id, row) {
    var c = await sb();
    return err(await c.from(table).update(row).eq("id", id).select().single()).data;
  }
  async function deleteChild(table, id) {
    var c = await sb();
    return err(await c.from(table).delete().eq("id", id));
  }

  /* ── Dashboard ── */
  async function dashboard() {
    var c = await sb();
    var today = new Date().toISOString().slice(0, 10);
    var weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    var yearOut = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
    async function count(q) { var r = await q; return r.error ? null : (r.count || 0); }
    var res = {};
    res.propertiesTracked = await count(c.from("pci_properties").select("*", { count: "exact", head: true }));
    res.actNow = await count(c.from("pci_properties").select("*", { count: "exact", head: true }).eq("recommendation", "Act Now"));
    res.watchClosely = await count(c.from("pci_properties").select("*", { count: "exact", head: true }).eq("recommendation", "Watch Closely"));
    res.newToday = await count(c.from("pci_properties").select("*", { count: "exact", head: true }).gte("created_at", today + "T00:00:00Z"));
    res.priceCuts7d = await count(c.from("pci_change_log").select("*", { count: "exact", head: true }).eq("entity_type", "pci_properties").eq("field_name", "asking_price").gte("changed_at", weekAgo + "T00:00:00Z"));
    res.refiPressure = await count(c.from("pci_loans").select("*", { count: "exact", head: true }).lte("maturity_date", yearOut).gte("maturity_date", today));
    res.distressActive = await count(c.from("pci_distress_signals").select("*", { count: "exact", head: true }).neq("status", "resolved"));
    res.actionsDue = await count(c.from("pci_daily_actions").select("*", { count: "exact", head: true }).eq("status", "open").lte("due_date", today));
    res.programsActive = await count(c.from("pci_lender_programs").select("*", { count: "exact", head: true }).eq("active_status", "active"));
    var r1 = await c.from("pci_change_log").select("*").order("changed_at", { ascending: false }).limit(12);
    res.recentChanges = r1.error ? [] : r1.data;
    var r2 = await c.from("pci_properties").select("id,property_name,address_line1,city,asking_price,noi,cap_rate_pct,opportunity_score,recommendation").not("opportunity_score", "is", null).order("opportunity_score", { ascending: false }).limit(5);
    res.topOpportunities = r2.error ? [] : r2.data;
    var r3 = await c.from("pci_loans").select("id,property_id,lender_name_snapshot,estimated_balance,maturity_date,maturity_basis,pci_properties(property_name,address_line1,city)").gte("maturity_date", today).lte("maturity_date", yearOut).order("maturity_date").limit(12);
    res.maturities = r3.error ? [] : r3.data;
    var r4 = await c.from("pci_daily_actions").select("*, pci_properties(property_name,address_line1), crm_contacts(name,company)").eq("status", "open").order("priority", { ascending: true, nullsFirst: false }).order("due_date").limit(5);
    res.topActions = r4.error ? [] : r4.data;
    var r5 = await c.from("pci_import_batches").select("*").order("created_at", { ascending: false }).limit(1);
    res.lastImport = r5.error || !r5.data.length ? null : r5.data[0];
    return res;
  }

  /* ── Lender programs / capital match ── */
  async function listPrograms() {
    var c = await sb();
    return err(await c.from("pci_lender_programs").select("*, crm_contacts(name,company,email,phone)").order("updated_at", { ascending: false }).limit(1000)).data || [];
  }
  async function saveProgram(id, row) {
    var c = await sb();
    if (id) return err(await c.from("pci_lender_programs").update(row).eq("id", id).select().single()).data;
    return err(await c.from("pci_lender_programs").insert(row).select().single()).data;
  }
  /* Deterministic match — a screen, not an approval. */
  function matchPrograms(programs, scenario) {
    var res = { fits: [], possible: [], gaps: [] };
    (programs || []).forEach(function (p) {
      if ((p.active_status || "active") !== "active") return;
      var reasons = [], soft = [];
      function no(v) { return v === null || v === undefined || v === ""; }
      var loan = scenario.loanAmount;
      if (!no(p.min_loan) && loan < Number(p.min_loan)) reasons.push("below min loan " + fmtMoney(p.min_loan));
      if (!no(p.max_loan) && loan > Number(p.max_loan)) reasons.push("above max loan " + fmtMoney(p.max_loan));
      var fl = String(p.florida_appetite || "").toLowerCase();
      if (fl.indexOf("no") === 0) reasons.push("no Florida appetite");
      else if (no(p.florida_appetite) || fl.indexOf("select") === 0) soft.push("Florida appetite " + (p.florida_appetite || "unknown"));
      var rt = String(p.retail_appetite || "").toLowerCase();
      if (rt.indexOf("no") === 0) reasons.push("no retail appetite");
      else if (no(p.retail_appetite) || rt.indexOf("select") === 0) soft.push("retail appetite " + (p.retail_appetite || "unknown"));
      if (scenario.ltvPct != null && !no(p.max_ltv_pct) && scenario.ltvPct > Number(p.max_ltv_pct) + 1e-9)
        reasons.push("needs LTV " + scenario.ltvPct.toFixed(1) + "% > max " + Number(p.max_ltv_pct).toFixed(0) + "%");
      if (scenario.dscr != null && !no(p.min_dscr) && scenario.dscr < Number(p.min_dscr) - 1e-9)
        reasons.push("DSCR " + scenario.dscr.toFixed(2) + " < min " + Number(p.min_dscr).toFixed(2));
      if (scenario.dscr == null && !no(p.min_dscr)) soft.push("DSCR unknown (program min " + p.min_dscr + ")");
      if (scenario.profile && p.stabilized_or_value_add) {
        var want = String(scenario.profile).toLowerCase(), have = String(p.stabilized_or_value_add).toLowerCase();
        if (have.indexOf("both") < 0 && have.indexOf(want) < 0) reasons.push("profile mismatch (" + p.stabilized_or_value_add + ")");
      }
      var item = { program: p, reasons: reasons, soft: soft };
      if (reasons.length) res.gaps.push(item);
      else if (soft.length) res.possible.push(item);
      else res.fits.push(item);
    });
    return res;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  /* ── Import pipeline (functions) ── */
  function importPreview(filename, base64, force) { return fn("intelligence-import-preview", { filename: filename, file_base64: base64, force: !!force }); }
  function importCommit(batchId, resolutions) { return fn("intelligence-import-commit", { batch_id: batchId, resolutions: resolutions || {} }); }
  function importRollback(batchId) { return fn("intelligence-import-rollback", { batch_id: batchId }); }
  function importBatch(batchId, only) { return fn("intelligence-import-batch", { batch_id: batchId, only: only }); }
  function importTemplate() { return fn("intelligence-template", {}); }
  async function listBatches() {
    var c = await sb();
    return err(await c.from("pci_import_batches").select("*").order("created_at", { ascending: false }).limit(50)).data || [];
  }
  async function rejectBatch(id) {
    var c = await sb();
    return err(await c.from("pci_import_batches").update({ status: "rejected" }).eq("id", id).in("status", ["uploaded", "previewed", "approved"]));
  }

  /* ── Data quality ── */
  async function dataQuality() {
    var c = await sb();
    var out = {};
    var r0 = await c.rpc("pci_check_schema");
    out.schema = r0.error ? { ok: false, error: r0.error.message } : r0.data;
    var staleCut = new Date(Date.now() - 90 * 864e5).toISOString();
    var q = [
      ["missingCritical", c.from("pci_properties").select("id,property_name,address_line1,city,asking_price,noi,cap_rate_pct,occupancy_pct").or("asking_price.is.null,noi.is.null,occupancy_pct.is.null").limit(50)],
      ["stalePrograms", c.from("pci_lender_programs").select("id,lender_name_snapshot,program_name,last_verified_at").eq("active_status", "active").or("last_verified_at.is.null,last_verified_at.lt." + staleCut).limit(50)],
      ["loansNoBasis", c.from("pci_loans").select("id,property_id,lender_name_snapshot,maturity_date,maturity_basis,source_url").or("maturity_basis.is.null,source_url.is.null").limit(50)],
      ["conflicts", c.from("pci_import_rows").select("id,batch_id,sheet_name,row_number,dedupe_key,validation_errors,status").eq("proposed_action", "conflict").in("status", ["pending", "skipped"]).limit(50)],
    ];
    for (var i = 0; i < q.length; i++) { var r = await q[i][1]; out[q[i][0]] = r.error ? [] : (r.data || []); }
    var rAll = await c.from("pci_properties").select("id,data_confidence");
    var dist = { Verified: 0, Reported: 0, Estimated: 0, Unknown: 0, unset: 0 };
    (rAll.error ? [] : rAll.data || []).forEach(function (p) { dist[p.data_confidence || "unset"] = (dist[p.data_confidence || "unset"] || 0) + 1; });
    out.confidenceDist = dist;
    var rPc = await c.from("pci_property_contacts").select("property_id");
    var withC = {}; (rPc.error ? [] : rPc.data || []).forEach(function (x) { withC[x.property_id] = 1; });
    var rP = await c.from("pci_properties").select("id,property_name,address_line1,city").limit(2000);
    out.propsNoContacts = (rP.error ? [] : rP.data || []).filter(function (p) { return !withC[p.id]; }).slice(0, 50);
    return out;
  }

  /* ── Documents (private bucket, signed URLs via the admin's own session) ── */
  var BUCKET = "capital-intelligence-private";
  async function uploadPropertyDoc(propertyId, file) {
    var c = await sb();
    var safe = String(file.name || "document").replace(/[^\w.\-]+/g, "_").slice(-80);
    var path = "properties/" + propertyId + "/" + Date.now() + "-" + safe;
    var up = await c.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (up.error) throw new Error(up.error.message);
    return path;
  }
  async function listPropertyDocs(propertyId) {
    var c = await sb();
    var r = await c.storage.from(BUCKET).list("properties/" + propertyId, { limit: 100 });
    if (r.error) return [];
    return r.data || [];
  }
  async function signedUrl(path) {
    var c = await sb();
    var r = await c.storage.from(BUCKET).createSignedUrl(path, 600);
    if (r.error) throw new Error(r.error.message);
    return r.data.signedUrl;
  }

  window.PegIntelAPI = {
    verifyAdmin: verifyAdmin, fn: fn,
    listProperties: listProperties, saveProperty: saveProperty, propertyChildren: propertyChildren,
    insertChild: insertChild, updateChild: updateChild, deleteChild: deleteChild,
    dashboard: dashboard, listPrograms: listPrograms, saveProgram: saveProgram,
    matchPrograms: matchPrograms,
    importPreview: importPreview, importCommit: importCommit, importRollback: importRollback,
    importBatch: importBatch, importTemplate: importTemplate, listBatches: listBatches, rejectBatch: rejectBatch,
    dataQuality: dataQuality,
    uploadPropertyDoc: uploadPropertyDoc, listPropertyDocs: listPropertyDocs, signedUrl: signedUrl,
  };
})();
