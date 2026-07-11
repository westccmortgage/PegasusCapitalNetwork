/* ============================================================================
   PEGASUS CALIFORNIA PARTNER NETWORK — private admin application
   window.PegPartner

   Tabs: Dashboard · Agents · Escrow & Title · Companies · Outreach Queue ·
   Activity Signals · Do Not Contact · Import Center. Admin-only (RLS + JWT).
   Reuses the shared Pegasus shell + the pit-* admin styles.
   ============================================================================ */
(function () {
  "use strict";
  var A = null;
  var esc = function (s) { return window.Pegasus.esc(s); };
  var view = null, TAB = "dash";
  var CACHE = { agents: null, escrow: null, companies: null, signals: null, outreach: null, dnc: null };

  function money(n) { if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—"; return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function num(n) { return n === null || n === undefined || n === "" ? "—" : String(n); }
  function dt(d) { if (!d) return "—"; var x = new Date(d); return isNaN(x) ? "—" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function conf(c) { return c ? '<span class="pit-conf ' + esc(c) + '">' + esc(c) + "</span>" : '<span class="pit-conf">—</span>'; }
  function empty(msg, sub) { return '<div class="pit-empty">' + esc(msg) + (sub ? '<br><span style="font-size:11px">' + esc(sub) + "</span>" : "") + "</div>"; }
  function toast(ok, t, m) { window.Pegasus.toast(ok ? "✓" : "!", ok ? "var(--green-dim)" : "var(--gold-dim)", t, m || ""); }
  function gv(id) { var e = document.getElementById(id); return e ? (e.value || "").trim() : ""; }
  function numOr(v) { v = String(v || "").replace(/[$,\s]/g, ""); if (v === "") return null; var n = Number(v); return isNaN(n) ? null : n; }
  function srcLink(u) { return u ? '<a class="pit-src" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : ""; }
  function nk(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  function csvExport(filename, headers, rows) {
    function cell(v) { var s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
    var out = [headers.map(cell).join(",")].concat(rows.map(function (r) { return r.map(cell).join(","); })).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function b64ToBlobUrl(b64, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  }
  function shell(title, inner, footer) {
    return '<div class="sce-scrim" onclick="if(event.target===this)Pegasus.dismissModal()"><div class="sce-modal" style="max-width:640px">' +
      '<div class="sce-head"><div class="sce-title">' + esc(title) + '</div><button class="sce-x" onclick="Pegasus.closeModal()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:70vh;overflow-y:auto">' + inner + "</div>" +
      '<div class="sce-foot"><div id="pnErr" class="sce-err"></div>' + footer + "</div></div></div>";
  }

  var TABS = [["dash", "Dashboard"], ["agents", "Agents"], ["escrow", "Escrow & Title"],
    ["companies", "Companies"], ["outreach", "Outreach Queue"], ["signals", "Activity Signals"],
    ["dnc", "Do Not Contact"], ["import", "Import Center"]];
  function mount(v) {
    view = v; A = window.PegPartnerAPI;
    v.innerHTML =
      '<div class="pit-head-actions">' +
        '<button class="btn btn-pri btn-sm" onclick="PegPartner.nav(\'import\')">Upload Partner Workbook</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="PegPartner.downloadTemplate()">Download Import Template</button>' +
        '<a class="btn btn-ghost btn-sm" href="/crm.html">Open CRM</a>' +
      "</div>" +
      '<div class="pit-tabs">' + TABS.map(function (t) {
        return '<button class="pit-tab" id="pnTab-' + t[0] + '" onclick="PegPartner.nav(\'' + t[0] + '\')">' + t[1] + "</button>";
      }).join("") + "</div>" +
      '<div id="pnView"></div>';
    nav("dash");
  }
  function nav(tab) {
    TAB = tab;
    TABS.forEach(function (t) { var e = document.getElementById("pnTab-" + t[0]); if (e) e.classList.toggle("on", t[0] === tab); });
    var host = document.getElementById("pnView"); if (!host) return;
    host.innerHTML = '<div class="pit-empty">Loading…</div>';
    ({ dash: renderDash, agents: renderAgents, escrow: renderEscrow, companies: renderCompanies,
       outreach: renderOutreach, signals: renderSignals, dnc: renderDnc, import: renderImport }[tab] || renderDash)(host)
      .catch(function (e) { host.innerHTML = empty("Could not load this view.", (e && e.message || "") + " — check that migrations 072–074 are applied."); });
  }

  /* ═══ 1. DASHBOARD ═══ */
  async function renderDash(host) {
    var d = await A.dashboard();
    function tile(n, l, cls) { return '<div class="pit-tile ' + (cls || "") + '"><div class="n">' + (n === null ? "—" : esc(String(n))) + '</div><div class="l">' + esc(l) + "</div></div>"; }
    var tiles = tile(d.agents, "Agents") + tile(d.companies, "Companies") + tile(d.escrow, "Escrow & Title") +
      tile(d.signals7d, "Signals · 7d", d.signals7d ? "good" : "") +
      tile(d.outreachOpen, "Outreach Open") + tile(d.outreachDue, "Outreach Due", d.outreachDue ? "warn" : "") +
      tile(d.dnc, "Do Not Contact", d.dnc ? "hot" : "");
    var sig = d.recentSignals.length ? d.recentSignals.map(function (s) {
      var who = (s.pn_agents && s.pn_agents.full_name) || s.subject_name || "—";
      return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc((s.signal_type || "").replace(/_/g, " ")) + "</b> · " + esc(who) +
        (s.detail ? " — " + esc(s.detail).slice(0, 60) : "") + '</span><span class="pit-meta">' + esc(dt(s.signal_date)) + "</span></div>";
    }).join("") : empty("No activity signals yet.", "Signals arrive via the partner workbook import.");
    var oa = d.topOutreach.length ? d.topOutreach.map(function (a) {
      var who = (a.pn_agents && a.pn_agents.full_name) || (a.pn_companies && a.pn_companies.company_name) || a.subject_name || "—";
      return '<div class="pit-row"><span style="font-weight:600;color:var(--text);width:18px">' + num(a.priority) + '</span><span class="grow">' + esc(a.action) +
        ' <span class="pit-meta">· ' + esc(who) + "</span></span><span class=\"pit-meta\">" + esc(dt(a.due_date)) + "</span></div>";
    }).join("") : empty("No open outreach.", "Add outreach rows via the workbook, then work the queue here.");
    var imp = d.lastImport ? '<div class="pit-row"><span class="grow">' + esc(d.lastImport.filename || "workbook") + ' <span class="pit-meta">· ' + esc(d.lastImport.status) + '</span></span><span class="pit-meta">' + esc(dt(d.lastImport.created_at)) + "</span></div>"
      : empty("No imports yet.", "Upload your first partner workbook from the Import Center.");
    host.innerHTML = '<div class="pit-tiles">' + tiles + "</div>" +
      '<div class="pit-grid2"><div class="pit-panel"><h3>Recent activity signals</h3>' + sig + "</div>" +
      '<div class="pit-panel"><h3>Top outreach — open</h3>' + oa + "</div></div>" +
      '<div class="pit-panel"><h3>Latest import</h3>' + imp + "</div>";
  }

  /* ═══ 2. AGENTS ═══ */
  var AF = { q: "", city: "", status: "", conf: "" };
  async function renderAgents(host) { CACHE.agents = await A.listAgents(); drawAgents(host); }
  function drawAgents(host) {
    host = host || document.getElementById("pnView");
    var all = CACHE.agents || [];
    var rows = all.filter(function (a) {
      if (AF.q) { var q = AF.q.toLowerCase(); if (((a.full_name || "") + " " + (a.company_name_snapshot || "") + " " + (a.email || "") + " " + (a.license_number || "")).toLowerCase().indexOf(q) < 0) return false; }
      if (AF.city && (a.city || "").toLowerCase() !== AF.city.toLowerCase()) return false;
      if (AF.status && (a.status || "") !== AF.status) return false;
      if (AF.conf && (a.data_confidence || "") !== AF.conf) return false;
      return true;
    });
    function opts(list, cur) { return '<option value="">All</option>' + list.map(function (o) { return '<option' + (cur === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join(""); }
    var cities = Array.from(new Set(all.map(function (a) { return a.city; }).filter(Boolean))).sort();
    host.innerHTML =
      '<div class="pit-filters">' +
        '<div class="field"><label class="label">Search</label><input class="input" id="af_q" value="' + esc(AF.q) + '" placeholder="Name, company, email, license…" oninput="PegPartner._af()"></div>' +
        '<div class="field"><label class="label">City</label><select class="input" id="af_city" onchange="PegPartner._af()">' + opts(cities, AF.city) + "</select></div>" +
        '<div class="field"><label class="label">Status</label><select class="input" id="af_status" onchange="PegPartner._af()">' + opts(["active", "inactive"], AF.status) + "</select></div>" +
        '<div class="field"><label class="label">Confidence</label><select class="input" id="af_conf" onchange="PegPartner._af()">' + opts(["Verified", "Reported", "Estimated", "Unknown"], AF.conf) + "</select></div>" +
        '<button class="btn btn-pri btn-sm" onclick="PegPartner.agentModal(null)">+ Agent</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="PegPartner.exportAgents()">Export CSV</button>' +
      "</div>" +
      (rows.length ?
        '<div class="pit-table-wrap"><table class="pit-table"><thead><tr><th class="noclick">Agent</th><th class="noclick">Company</th><th class="noclick">City</th><th class="noclick num">Volume</th><th class="noclick num">Deals</th><th class="noclick">Status</th><th class="noclick">Confidence</th></tr></thead><tbody>' +
        rows.map(function (a) {
          var co = (a.pn_companies && a.pn_companies.company_name) || a.company_name_snapshot || "—";
          return '<tr onclick="PegPartner.openAgent(\'' + a.id + '\')"><td class="strong">' + esc(a.full_name) + (a.linked_contact_id ? ' <span class="pit-meta">· CRM</span>' : "") + '<div class="pit-meta">' + esc(a.email || "") + "</div></td>" +
            "<td>" + esc(co) + "</td><td>" + esc(a.city || "—") + '</td><td class="num">' + money(a.production_volume) + '</td><td class="num">' + num(a.deal_count) + "</td>" +
            "<td>" + esc(a.status || "—") + "</td><td>" + conf(a.data_confidence) + "</td></tr>";
        }).join("") + "</tbody></table></div><div class=\"pit-note\">" + rows.length + " of " + all.length + " agents.</div>"
      : empty("No agents match.", all.length ? "Adjust the filters." : "Import your first partner workbook or add an agent manually."));
  }
  function _af() { ["q", "city", "status", "conf"].forEach(function (k) { AF[k] = gv("af_" + k); }); drawAgents(); }
  function exportAgents() {
    var all = CACHE.agents || [];
    csvExport("pegasus-partner-agents.csv",
      ["Name", "Company", "License", "Email", "Phone", "City", "State", "Specialty", "Volume", "Deals", "Status", "Confidence"],
      all.map(function (a) { return [a.full_name, a.company_name_snapshot, a.license_number, a.email, a.phone, a.city, a.state, a.specialty, a.production_volume, a.deal_count, a.status, a.data_confidence]; }));
  }
  function agentModal(id) {
    var a = id ? (CACHE.agents || []).find(function (x) { return x.id === id; }) || {} : {};
    function f(label, fid, val, ph) { return '<div class="field"><label class="label">' + label + '</label><input class="input" id="pa_' + fid + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '"></div>'; }
    var confOpts = ["", "Verified", "Reported", "Estimated", "Unknown"].map(function (o) { return "<option" + ((a.data_confidence || "") === o ? " selected" : "") + ">" + o + "</option>"; }).join("");
    var inner =
      f("Full name *", "name", a.full_name, "Agent name") +
      '<div class="row2">' + f("Company", "company", a.company_name_snapshot, "Brokerage") + f("License #", "lic", a.license_number, "DRE-…") + "</div>" +
      '<div class="row2">' + f("Email", "email", a.email, "") + f("Phone", "phone", a.phone, "") + "</div>" +
      '<div class="row2">' + f("City", "city", a.city, "") + f("State", "state", a.state || "CA", "") + "</div>" +
      '<div class="row2">' + f("Specialty", "specialty", a.specialty, "") + f("Job title", "job", a.job_title, "") + "</div>" +
      '<div class="row2">' + f("Production volume", "vol", a.production_volume, "18500000") + f("Deal count", "deals", a.deal_count, "") + "</div>" +
      '<div class="row2">' + f("Status", "status", a.status || "active", "active / inactive") + '<div class="field"><label class="label">Data confidence</label><select class="input" id="pa_conf">' + confOpts + "</select></div></div>" +
      f("Source URL", "src", a.source_url, "https://…") +
      '<div class="field"><label class="label">Notes</label><textarea class="ws-textarea" id="pa_notes">' + esc(a.notes || "") + "</textarea></div>";
    var footer = '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>' +
      '<button class="btn btn-pri" onclick="PegPartner.saveAgent(' + (id ? "'" + id + "'" : "null") + ')">' + (id ? "Save" : "Add agent") + "</button>";
    window.Pegasus.modal(shell((id ? "Edit" : "New") + " agent", inner, footer));
  }
  async function saveAgentUI(id) {
    var e = document.getElementById("pnErr");
    var name = gv("pa_name");
    if (!name) { if (e) e.textContent = "Full name is required."; return; }
    var row = { full_name: name, company_name_snapshot: gv("pa_company") || null, license_number: gv("pa_lic") || null,
      email: gv("pa_email") || null, phone: gv("pa_phone") || null, city: gv("pa_city") || null, state: gv("pa_state") || "CA",
      specialty: gv("pa_specialty") || null, job_title: gv("pa_job") || null, production_volume: numOr(gv("pa_vol")),
      deal_count: numOr(gv("pa_deals")), status: gv("pa_status") || "active", data_confidence: gv("pa_conf") || null,
      source_url: gv("pa_src") || null, notes: gv("pa_notes") || null };
    try { await A.saveAgent(id, row); window.Pegasus.closeModal(); toast(true, id ? "Agent updated" : "Agent added", name); CACHE.agents = null; nav("agents"); }
    catch (err) { if (e) e.textContent = err.message; }
  }
  async function openAgent(id) {
    var a = (CACHE.agents || []).find(function (x) { return x.id === id; }) || {};
    window.Pegasus.modal('<div class="sce-scrim" onclick="if(event.target===this)Pegasus.dismissModal()"><div class="sce-modal" style="max-width:760px">' +
      '<div class="sce-head"><div class="sce-title">' + esc(a.full_name || "Agent") + '</div><button class="sce-x" onclick="Pegasus.closeModal()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:76vh;overflow-y:auto" id="pnAgentBody">' + empty("Loading…") + "</div></div></div>");
    var act = {};
    try { act = await A.agentActivity(id); } catch (_) {}
    var co = (a.pn_companies && a.pn_companies.company_name) || a.company_name_snapshot;
    function kv(k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + v + "</dd>" : ""; }
    var body = '<dl class="pit-kv">' +
      kv("Company", esc(co || "—")) + kv("License", esc(a.license_number || "—")) +
      kv("Email", esc(a.email || "—")) + kv("Phone", esc(a.phone || "—")) +
      kv("Location", esc([a.city, a.state].filter(Boolean).join(", ") || "—")) +
      kv("Specialty", esc(a.specialty || "—")) + kv("Volume / deals", money(a.production_volume) + " · " + num(a.deal_count)) +
      kv("Status", esc(a.status || "—")) + kv("Data quality", conf(a.data_confidence) + " " + srcLink(a.source_url)) +
      kv("CRM", a.linked_contact_id ? '<a class="pit-src" href="/crm.html">linked contact ↗</a>' : "not linked") +
      kv("Notes", esc(a.notes || "")) + "</dl>" +
      '<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" onclick="Pegasus.closeModal();PegPartner.agentModal(\'' + a.id + '\')">Edit agent</button></div>';
    body += '<div class="pit-panel" style="margin-top:14px"><h3>Activity signals (' + (act.signals || []).length + ')</h3>' +
      ((act.signals || []).length ? act.signals.map(function (s) { return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc((s.signal_type || "").replace(/_/g, " ")) + "</b>" + (s.detail ? " — " + esc(s.detail) : "") + "</span>" + conf(s.confidence) + '<span class="pit-meta">' + esc(dt(s.signal_date)) + "</span></div>"; }).join("") : empty("No signals.")) + "</div>";
    body += '<div class="pit-panel"><h3>Outreach (' + (act.outreach || []).length + ')</h3>' +
      ((act.outreach || []).length ? act.outreach.map(function (o) { return '<div class="pit-row"><span class="grow">' + esc(o.action) + ' <span class="pit-meta">· ' + esc(o.status) + "</span></span><span class=\"pit-meta\">" + esc(dt(o.due_date)) + "</span></div>"; }).join("") : empty("No outreach.")) + "</div>";
    var h = document.getElementById("pnAgentBody"); if (h) h.innerHTML = body;
  }

  /* ═══ 3. ESCROW & TITLE ═══ */
  async function renderEscrow(host) {
    CACHE.escrow = await A.listEscrow();
    var rows = CACHE.escrow || [];
    host.innerHTML = '<div class="pit-head-actions"><button class="btn btn-ghost btn-sm" onclick="PegPartner.exportEscrow()">Export CSV</button></div>' +
      (rows.length ? '<div class="pit-table-wrap"><table class="pit-table"><thead><tr><th class="noclick">Officer</th><th class="noclick">Company</th><th class="noclick">Role</th><th class="noclick">City</th><th class="noclick num">Volume</th><th class="noclick">Confidence</th></tr></thead><tbody>' +
        rows.map(function (s) {
          var co = (s.pn_companies && s.pn_companies.company_name) || s.company_name_snapshot || "—";
          return "<tr><td class=\"strong\">" + esc(s.officer_name) + (s.linked_contact_id ? ' <span class="pit-meta">· CRM</span>' : "") + '<div class="pit-meta">' + esc(s.email || "") + "</div></td><td>" + esc(co) + "</td><td>" + esc((s.role || "—").replace(/_/g, " ")) + "</td><td>" + esc(s.city || "—") + '</td><td class="num">' + money(s.transaction_volume) + "</td><td>" + conf(s.data_confidence) + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : empty("No escrow/title officers.", "Import your first partner workbook (Escrow_Title sheet)."));
  }
  function exportEscrow() {
    var all = CACHE.escrow || [];
    csvExport("pegasus-partner-escrow-title.csv", ["Officer", "Company", "Role", "License", "Email", "Phone", "City", "Volume", "Confidence"],
      all.map(function (s) { return [s.officer_name, s.company_name_snapshot, s.role, s.license_number, s.email, s.phone, s.city, s.transaction_volume, s.data_confidence]; }));
  }

  /* ═══ 4. COMPANIES ═══ */
  async function renderCompanies(host) { CACHE.companies = await A.listCompanies(); drawCompanies(host); }
  function drawCompanies(host) {
    host = host || document.getElementById("pnView");
    var rows = CACHE.companies || [];
    host.innerHTML = '<div class="pit-head-actions"><button class="btn btn-pri btn-sm" onclick="PegPartner.companyModal(null)">+ Company</button><button class="btn btn-ghost btn-sm" onclick="PegPartner.exportCompanies()">Export CSV</button></div>' +
      (rows.length ? '<div class="pit-table-wrap"><table class="pit-table"><thead><tr><th class="noclick">Company</th><th class="noclick">Type</th><th class="noclick">City</th><th class="noclick num">Agents</th><th class="noclick">Specialty</th><th class="noclick">Confidence</th></tr></thead><tbody>' +
        rows.map(function (c) {
          return '<tr onclick="PegPartner.companyModal(\'' + c.id + '\')"><td class="strong">' + esc(c.company_name) + '<div class="pit-meta">' + esc([c.city, c.state].filter(Boolean).join(", ")) + "</div></td><td>" + esc(c.company_type || "—") + "</td><td>" + esc(c.city || "—") + '</td><td class="num">' + num(c.agent_count) + "</td><td>" + esc(c.specialty || "—") + "</td><td>" + conf(c.data_confidence) + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : empty("No companies.", "Import your first partner workbook or add a company manually."));
  }
  function exportCompanies() {
    var all = CACHE.companies || [];
    csvExport("pegasus-partner-companies.csv", ["Company", "Type", "Address", "City", "State", "Phone", "Email", "Website", "Agents", "Specialty", "Confidence"],
      all.map(function (c) { return [c.company_name, c.company_type, c.address_line1, c.city, c.state, c.phone, c.email, c.website, c.agent_count, c.specialty, c.data_confidence]; }));
  }
  function companyModal(id) {
    var c = id ? (CACHE.companies || []).find(function (x) { return x.id === id; }) || {} : {};
    function f(label, fid, val, ph) { return '<div class="field"><label class="label">' + label + '</label><input class="input" id="pc_' + fid + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '"></div>'; }
    var confOpts = ["", "Verified", "Reported", "Estimated", "Unknown"].map(function (o) { return "<option" + ((c.data_confidence || "") === o ? " selected" : "") + ">" + o + "</option>"; }).join("");
    var inner =
      '<div class="row2">' + f("Company name *", "name", c.company_name, "Brokerage / escrow / title") + f("Type", "type", c.company_type, "brokerage / escrow / title / lender") + "</div>" +
      f("Address", "addr", c.address_line1, "") +
      '<div class="row2">' + f("City", "city", c.city, "") + f("State", "state", c.state || "CA", "") + "</div>" +
      '<div class="row2">' + f("Phone", "phone", c.phone, "") + f("Email", "email", c.email, "") + "</div>" +
      '<div class="row2">' + f("Website", "web", c.website, "https://…") + f("Agent count", "agents", c.agent_count, "") + "</div>" +
      '<div class="row2">' + f("Specialty", "specialty", c.specialty, "") + '<div class="field"><label class="label">Data confidence</label><select class="input" id="pc_conf">' + confOpts + "</select></div></div>" +
      f("Source URL", "src", c.source_url, "https://…") +
      '<div class="field"><label class="label">Notes</label><textarea class="ws-textarea" id="pc_notes">' + esc(c.notes || "") + "</textarea></div>";
    var footer = '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>' +
      '<button class="btn btn-pri" onclick="PegPartner.saveCompany(' + (id ? "'" + id + "'" : "null") + ')">' + (id ? "Save" : "Add company") + "</button>";
    window.Pegasus.modal(shell((id ? "Edit" : "New") + " company", inner, footer));
  }
  async function saveCompanyUI(id) {
    var e = document.getElementById("pnErr");
    var name = gv("pc_name");
    if (!name) { if (e) e.textContent = "Company name is required."; return; }
    var row = { company_name: name, company_type: gv("pc_type") || null, address_line1: gv("pc_addr") || null,
      city: gv("pc_city") || null, state: gv("pc_state") || "CA", phone: gv("pc_phone") || null, email: gv("pc_email") || null,
      website: gv("pc_web") || null, agent_count: numOr(gv("pc_agents")), specialty: gv("pc_specialty") || null,
      data_confidence: gv("pc_conf") || null, source_url: gv("pc_src") || null, notes: gv("pc_notes") || null };
    try { await A.saveCompany(id, row); window.Pegasus.closeModal(); toast(true, id ? "Company updated" : "Company added", name); CACHE.companies = null; nav("companies"); }
    catch (err) { if (e) e.textContent = err.message; }
  }

  /* ═══ 5. OUTREACH QUEUE (respects Do Not Contact) ═══ */
  async function renderOutreach(host) {
    var oa = await A.listOutreach();
    CACHE.outreach = oa;
    if (!CACHE.dnc) CACHE.dnc = await A.listDnc();
    var dncNames = new Set(), dncEmails = new Set();
    (CACHE.dnc || []).forEach(function (d) { if (d.subject_name) dncNames.add(nk(d.subject_name)); if (d.email) dncEmails.add(String(d.email).toLowerCase()); });
    function flagged(a) {
      var who = (a.pn_agents && a.pn_agents.full_name) || a.subject_name;
      var em = a.pn_agents && a.pn_agents.email;
      return (who && dncNames.has(nk(who))) || (em && dncEmails.has(String(em).toLowerCase()));
    }
    var open = oa.filter(function (a) { return a.status === "open"; });
    var done = oa.filter(function (a) { return a.status !== "open"; });
    function row(a) {
      var who = (a.pn_agents && a.pn_agents.full_name) || (a.pn_companies && a.pn_companies.company_name) || a.subject_name || "—";
      var dnc = flagged(a);
      var btns = a.status === "open"
        ? '<button class="btn btn-ghost btn-sm" onclick="PegPartner.outreachDone(\'' + a.id + '\')">Mark done</button><button class="btn btn-ghost btn-sm" onclick="PegPartner.outreachSkip(\'' + a.id + '\')">Skip</button>'
        : '<span class="pit-meta">' + esc(a.status) + "</span>";
      return '<div class="pit-row"><span style="font-weight:600;color:var(--text);width:18px">' + num(a.priority) + '</span>' +
        '<span class="grow">' + esc(a.action) + ' <span class="pit-meta">· ' + esc(who) + (a.action_type ? " · " + esc(a.action_type) : "") + "</span>" +
        (dnc ? ' <span class="pit-conf hot" style="color:var(--red);border-color:var(--red)">DO NOT CONTACT</span>' : "") +
        (a.reason ? '<div class="pit-meta">' + esc(a.reason) + "</div>" : "") + "</span>" +
        '<span class="pit-meta">' + esc(dt(a.due_date)) + "</span>" + btns + "</div>";
    }
    host.innerHTML =
      '<div class="pit-note" style="margin:0 0 12px">Rows flagged <b style="color:var(--red)">DO NOT CONTACT</b> match an entry on the suppression list — do not reach out.</div>' +
      '<div class="pit-panel"><h3>Open (' + open.length + ')</h3>' + (open.length ? open.map(row).join("") : empty("Queue is clear.", "Outreach actions arrive via the workbook (Outreach_Actions sheet).")) + "</div>" +
      (done.length ? '<div class="pit-panel"><h3>Closed (' + done.length + ')</h3>' + done.slice(0, 100).map(row).join("") + "</div>" : "");
  }
  async function outreachSet(id, status) {
    try { await A.setOutreachStatus(id, status); toast(true, status === "done" ? "Marked done" : "Skipped"); nav("outreach"); }
    catch (e) { toast(false, "Could not update", e.message); }
  }

  /* ═══ 6. ACTIVITY SIGNALS ═══ */
  async function renderSignals(host) {
    var ss = await A.listSignals();
    host.innerHTML = ss.length ? '<div class="pit-panel"><h3>Activity signals</h3>' + ss.map(function (s) {
      var who = (s.pn_agents && s.pn_agents.full_name) || (s.pn_companies && s.pn_companies.company_name) || s.subject_name || "—";
      return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc((s.signal_type || "").replace(/_/g, " ")) + "</b> · " + esc(who) +
        (s.detail ? " — " + esc(s.detail) : "") + "</span>" + conf(s.confidence) + srcLink(s.url || s.source_url) + '<span class="pit-meta">' + esc(dt(s.signal_date)) + "</span></div>";
    }).join("") + "</div>" : empty("No activity signals.", "Signals arrive via the Activity_Signals sheet.");
  }

  /* ═══ 7. DO NOT CONTACT ═══ */
  async function renderDnc(host) {
    var dd = await A.listDnc();
    CACHE.dnc = dd;
    host.innerHTML = '<div class="pit-head-actions"><button class="btn btn-ghost btn-sm" onclick="PegPartner.exportDnc()">Export CSV</button></div>' +
      (dd.length ? '<div class="pit-table-wrap"><table class="pit-table"><thead><tr><th class="noclick">Subject</th><th class="noclick">Company</th><th class="noclick">Email</th><th class="noclick">Scope</th><th class="noclick">Reason</th><th class="noclick">Effective</th></tr></thead><tbody>' +
        dd.map(function (d) { return "<tr><td class=\"strong\">" + esc(d.subject_name) + "</td><td>" + esc(d.company_name_snapshot || "—") + "</td><td>" + esc(d.email || "—") + "</td><td>" + esc(d.scope || "all") + "</td><td>" + esc(d.reason || "—") + "</td><td class=\"pit-meta\">" + esc(dt(d.effective_date)) + "</td></tr>"; }).join("") + "</tbody></table></div>"
      : empty("Suppression list is empty.", "Do-not-contact entries arrive via the Do_Not_Contact sheet."));
  }
  function exportDnc() {
    var all = CACHE.dnc || [];
    csvExport("pegasus-partner-do-not-contact.csv", ["Subject", "Company", "Email", "Phone", "Scope", "Reason", "Effective", "Expires"],
      all.map(function (d) { return [d.subject_name, d.company_name_snapshot, d.email, d.phone, d.scope, d.reason, d.effective_date, d.expires_date]; }));
  }

  /* ═══ 8. IMPORT CENTER ═══ */
  var IMP = { preview: null, file: null, resolutions: {} };
  function impErr(msg) { var e = document.getElementById("pnImpErr"); if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; } }
  async function renderImport(host) {
    var batches = [];
    try { batches = await A.listBatches(); } catch (_) {}
    host.innerHTML =
      '<div class="pit-panel"><h3>Upload partner workbook (.xlsx)</h3>' +
        '<div class="pit-drop" id="pnDrop" onclick="document.getElementById(\'pnFile\').click()">Drop a .xlsx here or click to choose. Six sheets: Agents · Escrow_Title · Companies · Activity_Signals · Outreach_Actions · Do_Not_Contact.</div>' +
        '<input type="file" id="pnFile" accept=".xlsx" style="display:none" onchange="PegPartner.fileChosen(this)">' +
        '<div id="pnImpErr" class="pit-invalid" style="display:none;margin-top:10px"></div>' +
        '<div id="pnPreview" style="margin-top:12px"></div>' +
        '<div class="pit-note">Commit is transactional — either the batch applies cleanly or nothing changes. This importer is only for California Partner Network workbooks.</div>' +
      "</div>" +
      '<div class="pit-panel"><h3>Import history</h3>' +
        (batches.length ? batches.map(function (b) {
          var s = b.summary || {};
          var canRoll = b.status === "committed";
          return '<div class="pit-row"><span class="grow">' + esc(b.filename || "workbook") + ' <span class="pit-meta">· ' + esc(b.status) +
            (s.inserted != null ? " · +" + s.inserted + " ins / " + (s.updated || 0) + " upd" : "") + '</span></span>' +
            '<span class="pit-meta">' + esc(dt(b.created_at)) + "</span>" +
            (b.status === "previewed" ? '<button class="btn btn-ghost btn-sm" onclick="PegPartner.reopenBatch(\'' + b.id + '\')">Review</button>' : "") +
            (canRoll ? '<button class="btn btn-ghost btn-sm" onclick="PegPartner.rollback(\'' + b.id + '\')">Roll back</button>' : "") + "</div>";
        }).join("") : empty("No imports yet.")) + "</div>";
  }
  function fileChosen(input) {
    impErr("");                              // clear any stale error when a new file is selected
    var f = input.files && input.files[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { impErr("Only .xlsx workbooks are accepted."); return; }
    IMP.file = f;
    doPreview(false);
  }
  async function doPreview(force) {
    impErr("");
    var pv = document.getElementById("pnPreview"); if (pv) pv.innerHTML = '<div class="pit-empty">Analyzing…</div>';
    try {
      var b64 = await fileToB64(IMP.file);
      var r = await A.importPreview(IMP.file.name, b64, force);
      IMP.preview = r; IMP.resolutions = {};
      impErr("");                            // success clears the banner
      drawPreview();
    } catch (e) {
      var pl = e.payload || {};
      if (pl.error === "duplicate file") {
        impErr((pl.details || []).join(" ") + " ");
        var pv2 = document.getElementById("pnPreview");
        if (pv2) pv2.innerHTML = '<button class="btn btn-pri btn-sm" onclick="PegPartner.forcePreview()">Import anyway (force)</button>';
        return;
      }
      impErr(e.message + (pl.details ? " — " + pl.details.join("; ") : ""));
      var pv3 = document.getElementById("pnPreview"); if (pv3) pv3.innerHTML = "";
    }
  }
  function forcePreview() { doPreview(true); }
  function drawPreview() {
    var r = IMP.preview, pv = document.getElementById("pnPreview"); if (!pv) return;
    var s = r.summary || {};
    var sum = ["insert", "update", "unchanged", "conflict", "invalid"].map(function (k) {
      return '<span class="chip">' + k + " <b>" + (s[k] || 0) + "</b></span>";
    }).join("");
    var html = '<div class="pit-import-sum">' + sum + "</div>" +
      '<div class="pit-note">Sheets: ' + esc((r.sheets || []).join(", ")) + " · batch " + esc(r.batch_id) + "</div>";
    (r.invalid || []).slice(0, 50).forEach(function (iv) {
      html += '<div class="pit-invalid">' + esc(iv.sheet) + " row " + iv.row + ": " + esc((iv.errors || []).join("; ")) + "</div>";
    });
    (r.conflicts || []).forEach(function (cf, i) {
      html += '<div class="pit-conflict"><div class="k">' + esc(cf.sheet) + " row " + cf.row + " · " + esc(cf.key || "") + "</div>" +
        (cf.errors && cf.errors.length ? "<div>" + esc(cf.errors.join("; ")) + "</div>" : "") +
        '<div class="choices"><label><input type="radio" name="cf' + i + '" onclick="PegPartner.resolve(' + i + ',\'skip\')" checked> Skip</label>' +
        '<label><input type="radio" name="cf' + i + '" onclick="PegPartner.resolve(' + i + ',\'keep\')"> Keep existing</label>' +
        '<label><input type="radio" name="cf' + i + '" onclick="PegPartner.resolve(' + i + ',\'apply\')"> Apply incoming</label></div></div>';
    });
    html += '<div style="margin-top:12px;display:flex;gap:8px">' +
      '<button class="btn btn-pri btn-sm" onclick="PegPartner.commit()">Approve &amp; Commit</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="PegPartner.rejectPreview()">Discard</button></div>';
    pv.innerHTML = html;
  }
  function resolve(i, choice) {
    var cf = (IMP.preview.conflicts || [])[i]; if (!cf) return;
    IMP._resolveKeys = IMP._resolveKeys || {};
    IMP._resolveKeys[i] = { sheet: cf.sheet, row: cf.row, choice: choice };
  }
  async function reopenBatch(batchId) {
    impErr("");
    try {
      var r = await A.importBatch(batchId);
      var conflicts = (r.rows || []).filter(function (x) { return x.proposed_action === "conflict"; })
        .map(function (x) { return { sheet: x.sheet_name, row: x.row_number, key: x.dedupe_key, errors: x.validation_errors, changes: x.after_data, row_id: x.id }; });
      var invalid = (r.rows || []).filter(function (x) { return x.proposed_action === "invalid"; })
        .map(function (x) { return { sheet: x.sheet_name, row: x.row_number, errors: x.validation_errors }; });
      IMP.preview = { batch_id: batchId, summary: r.batch.summary || {}, sheets: (r.batch.summary || {}).sheets || [], conflicts: conflicts, invalid: invalid };
      IMP._rowIdByConflict = conflicts.map(function (c) { return c.row_id; });
      IMP.resolutions = {}; nav("import"); setTimeout(drawPreview, 60);
    } catch (e) { toast(false, "Could not reopen", e.message); }
  }
  async function commit() {
    var res = {};
    // Map conflict resolutions to row ids (from a reopened batch) when available.
    var ids = IMP._rowIdByConflict || [];
    Object.keys(IMP._resolveKeys || {}).forEach(function (i) {
      var rid = ids[i]; var ch = IMP._resolveKeys[i].choice;
      if (rid && (ch === "apply" || ch === "keep")) res[rid] = ch;
    });
    try {
      var r = await A.importCommit(IMP.preview.batch_id, res);
      if (r.ok) { toast(true, "Committed", "+" + (r.inserted || 0) + " ins · " + (r.updated || 0) + " upd · " + (r.skipped || 0) + " skip"); IMP.preview = null; CACHE = { agents: null, escrow: null, companies: null, signals: null, outreach: null, dnc: null }; impErr(""); nav("import"); }
      else { impErr(r.error || "commit failed"); }
    } catch (e) { impErr(e.message); }
  }
  async function rejectPreview() {
    try { await A.rejectBatch(IMP.preview.batch_id); toast(true, "Discarded", "Nothing was applied."); IMP.preview = null; impErr(""); nav("import"); }
    catch (e) { toast(false, "Could not discard", e.message); }
  }
  async function rollback(batchId) {
    if (!window.confirm("Roll back this committed batch? Records it created will be removed and updated fields restored — only if nothing was changed since.")) return;
    try {
      var r = await A.importRollback(batchId);
      if (r.ok) { toast(true, "Rolled back", (r.deleted || 0) + " removed · " + (r.restored || 0) + " restored"); CACHE = { agents: null, escrow: null, companies: null, signals: null, outreach: null, dnc: null }; nav("import"); }
      else { toast(false, "Rollback refused", r.error || "unsafe"); }
    } catch (e) { toast(false, "Rollback failed", e.message); }
  }
  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(String(rd.result).split(",")[1]); };
      rd.onerror = function () { reject(new Error("could not read file")); };
      rd.readAsDataURL(file);
    });
  }
  async function downloadTemplate() {
    try {
      toast(true, "Preparing template…", "");
      var r = await A.importTemplate();
      var url = b64ToBlobUrl(r.file_base64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      var a = document.createElement("a"); a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    } catch (e) { toast(false, "Template failed", e.message); }
  }

  window.PegPartner = {
    mount: mount, nav: nav,
    agentModal: agentModal, saveAgent: saveAgentUI, openAgent: openAgent, exportAgents: exportAgents, _af: _af,
    exportEscrow: exportEscrow, companyModal: companyModal, saveCompany: saveCompanyUI, exportCompanies: exportCompanies,
    outreachDone: function (id) { outreachSet(id, "done"); }, outreachSkip: function (id) { outreachSet(id, "skipped"); },
    exportDnc: exportDnc,
    fileChosen: fileChosen, forcePreview: forcePreview, resolve: resolve, reopenBatch: reopenBatch,
    commit: commit, rejectPreview: rejectPreview, rollback: rollback, downloadTemplate: downloadTemplate,
  };
})();
