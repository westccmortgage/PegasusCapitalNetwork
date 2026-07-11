/* ============================================================================
   PEGASUS CAPITAL INTELLIGENCE — private admin application (window.PegIntel)

   Tabs: Dashboard · Properties · Contacts · Lenders & Capital · Capital Match ·
   Import Center · Data Quality. Property Detail opens as a large modal with
   its own sub-tabs. Uses the shared Pegasus shell/components; data via
   PegIntelAPI (admin-only RLS + JWT-authenticated functions).

   UX rules honored here: confidence badges + source links + last-checked dates
   beside material data; honest empty states (never demo records); recorded
   facts visually distinct from analysis; consistent money/%/SF/date formats.
   ============================================================================ */
(function () {
  "use strict";
  var A = null; // PegIntelAPI shorthand, set at mount
  var esc = function (s) { return window.Pegasus.esc(s); };
  var view = null;
  var TAB = "dash";
  var CACHE = { properties: null, programs: null };
  // Capability gate resolved at mount: { role:'admin'|'analyst', canImport, canEdit }.
  // Defaults to full admin so nothing breaks if mount is called the old way.
  var CAP = { role: "admin", canImport: true, canEdit: true };

  /* ── formatters ── */
  function money(n) { if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—"; return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function pct(n) { if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—"; return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%"; }
  function sf(n) { if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—"; return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " SF"; }
  function dt(d) { if (!d) return "—"; var x = new Date(d); return isNaN(x) ? "—" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function conf(c) { return c ? '<span class="pit-conf ' + esc(c) + '">' + esc(c) + "</span>" : '<span class="pit-conf">—</span>'; }
  function reco(r) {
    if (!r) return "—";
    var cls = r === "Act Now" ? "act" : r === "Watch Closely" ? "watch" : "pass";
    return '<span class="pit-reco ' + cls + '">' + esc(r) + "</span>";
  }
  function srcLink(u, when) {
    var h = "";
    if (u) h += '<a class="pit-src" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">source ↗</a>';
    if (when) h += ' <span class="pit-meta">checked ' + esc(dt(when)) + "</span>";
    return h;
  }
  function empty(msg, sub) { return '<div class="pit-empty">' + esc(msg) + (sub ? '<br><span style="font-size:11px">' + esc(sub) + "</span>" : "") + "</div>"; }
  function toast(ok, t, m) { window.Pegasus.toast(ok ? "✓" : "!", ok ? "var(--green-dim)" : "var(--gold-dim)", t, m || ""); }
  function gv(id) { var e = document.getElementById(id); return e ? (e.value || "").trim() : ""; }
  function numOr(v) { v = String(v || "").replace(/[$,\s]/g, ""); if (v === "") return null; var n = Number(v); return isNaN(n) ? null : n; }

  /* Accessible clickable row → opens Property Detail. Whole row is the target;
     Enter/Space activate it; a visible hover/focus state comes from CSS
     (.pit-clickable). Any inner element (incl. the recommendation badge) simply
     bubbles to this handler, so the badge is clickable and never blocks the row. */
  function clickRow(id, inner, extraStyle) {
    return '<div class="pit-row pit-clickable" role="button" tabindex="0" data-prop="' + esc(id) + '"' +
      (extraStyle ? ' style="' + extraStyle + '"' : "") +
      ' onclick="PegIntel.openProperty(\'' + id + '\')" onkeydown="PegIntel._rowKey(event,\'' + id + '\')">' + inner + "</div>";
  }
  function _rowKey(e, id) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar" || e.keyCode === 13 || e.keyCode === 32) {
      e.preventDefault(); openProperty(id);
    }
  }
  // Deep-link plumbing so browser Back closes the Property Detail and returns to
  // the Dashboard (or wherever it was opened from) WITHOUT re-rendering — the
  // underlying view, including its filters, is left intact behind the modal.
  function propUrl(id) { return location.pathname + "?property=" + encodeURIComponent(id); }
  function currentPropParam() { try { return new URLSearchParams(location.search).get("property"); } catch (_) { return null; } }

  /* CSV export with formula-injection guard. */
  function csvExport(filename, headers, rows) {
    function cell(v) {
      var s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }
    var out = [headers.map(cell).join(",")].concat(rows.map(function (r) { return r.map(cell).join(","); })).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function b64ToBlobUrl(b64, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  }

  /* ── shell ── */
  var ALL_TABS = [["dash", "Dashboard"], ["props", "Properties"], ["contacts", "Contacts"],
    ["lenders", "Lenders & Capital"], ["match", "Capital Match"], ["import", "Import Center"], ["quality", "Data Quality"]];
  var TABS = ALL_TABS;
  function mount(v, access) {
    view = v; A = window.PegIntelAPI;
    if (access && access.role) CAP = access;
    // Analysts do batch import — hide the Import Center tab entirely (the
    // functions reject them server-side regardless).
    TABS = CAP.canImport ? ALL_TABS : ALL_TABS.filter(function (t) { return t[0] !== "import"; });
    var roleBadge = CAP.role === "analyst"
      ? '<span class="pit-conf" title="Read all + manually add/edit properties &amp; lender programs. Batch import is full-admin only.">Analyst</span>'
      : "";
    var importBtn = CAP.canImport
      ? '<button class="btn btn-pri btn-sm" onclick="PegIntel.nav(\'import\')">Upload Daily Workbook</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="PegIntel.downloadTemplate()">Download Import Template</button>'
      : "";
    v.innerHTML =
      '<div class="pit-head-actions">' +
        importBtn +
        '<a class="btn btn-ghost btn-sm" href="/crm.html">Open CRM</a>' +
        roleBadge +
      "</div>" +
      '<div class="pit-tabs">' + TABS.map(function (t) {
        return '<button class="pit-tab" id="pitTab-' + t[0] + '" onclick="PegIntel.nav(\'' + t[0] + '\')">' + t[1] + "</button>";
      }).join("") + "</div>" +
      '<div id="pitView"></div>';
    nav("dash");
    wireHistory();
    // Deep link: /admin/intelligence?property=<uuid> opens that property on load.
    var deep = currentPropParam();
    if (deep) { try { history.replaceState({}, "", location.pathname); } catch (_) {} openProperty(deep); }
  }
  function nav(tab) {
    if (tab === "import" && !CAP.canImport) tab = "dash"; // analysts have no import
    TAB = tab;
    TABS.forEach(function (t) { var e = document.getElementById("pitTab-" + t[0]); if (e) e.classList.toggle("on", t[0] === tab); });
    var host = document.getElementById("pitView");
    if (!host) return;
    host.innerHTML = '<div class="pit-empty">Loading…</div>';
    ({ dash: renderDash, props: renderProps, contacts: renderContacts, lenders: renderLenders,
       match: renderMatch, import: renderImport, quality: renderQuality }[tab] || renderDash)(host)
      .catch(function (e) {
        host.innerHTML = empty("Could not load this view.", (e && e.message || "") + " — check that migrations 067–070 are applied.");
      });
  }

  /* ═══ 1. DASHBOARD ═══ */
  async function renderDash(host) {
    var d = await A.dashboard();
    function tile(n, l, cls) { return '<div class="pit-tile ' + (cls || "") + '"><div class="n">' + (n === null ? "—" : esc(String(n))) + '</div><div class="l">' + esc(l) + "</div></div>"; }
    var tiles = tile(d.propertiesTracked, "Properties Tracked") + tile(d.actNow, "Act Now", d.actNow ? "good" : "") +
      tile(d.watchClosely, "Watch Closely") + tile(d.newToday, "New Today") +
      tile(d.priceCuts7d, "Price Cuts · 7d", d.priceCuts7d ? "warn" : "") +
      tile(d.refiPressure, "Loans Maturing · 12mo", d.refiPressure ? "warn" : "") +
      tile(d.distressActive, "Active Distress Signals", d.distressActive ? "hot" : "") +
      tile(d.actionsDue, "Follow-ups Due", d.actionsDue ? "warn" : "") +
      tile(d.programsActive, "Active Lender Programs");
    var chg = d.recentChanges.length ? d.recentChanges.map(function (c) {
      return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(c.field_name) + "</b> · " + esc(c.entity_type.replace("pci_", "")) +
        (c.old_value !== null ? " · " + esc(JSON.stringify(c.old_value)).slice(0, 24) + " → " : " → ") + esc(JSON.stringify(c.new_value)).slice(0, 28) +
        '</span><span class="pit-meta">' + esc(dt(c.changed_at)) + "</span></div>";
    }).join("") : empty("No changes recorded yet.", "Changes appear after your first import or edit.");
    var top = d.topOpportunities.length ? d.topOpportunities.map(function (p) {
      var inner = '<span class="grow strong">' + esc(p.property_name || p.address_line1) +
        '</span><span class="num">' + money(p.asking_price) + "</span>" + reco(p.recommendation) +
        '<span class="num" style="width:30px;text-align:right;font-weight:600;color:var(--text)">' + (p.opportunity_score ?? "—") + "</span>";
      return clickRow(p.id, inner);
    }).join("") : empty("No scored properties yet.", "Scores arrive via the daily workbook or the Property Detail → Score tab.");
    var mat = d.maturities.length ? d.maturities.map(function (l) {
      var pr = l.pci_properties || {};
      var inner = '<span class="grow">' + esc(pr.property_name || pr.address_line1 || "—") + " · " + esc(l.lender_name_snapshot || "lender ?") +
        '</span><span class="num">' + money(l.estimated_balance) + '</span><span class="pit-meta">' + esc(dt(l.maturity_date)) + " · " + esc(l.maturity_basis || "basis ?") + "</span>";
      return l.property_id ? clickRow(l.property_id, inner) : '<div class="pit-row">' + inner + "</div>";
    }).join("") : empty("No loan maturities in the next 12 months.", "Maturities appear once loans are imported with maturity dates.");
    var acts = d.topActions.length ? d.topActions.map(function (a) {
      var pr = a.pci_properties || {}, ct = a.crm_contacts || {};
      var inner = '<span style="font-weight:600;color:var(--text);width:18px">' + (a.priority ?? "·") + '</span><span class="grow">' + esc(a.action) +
        (pr.property_name || pr.address_line1 ? ' <span class="pit-meta">· ' + esc(pr.property_name || pr.address_line1) + "</span>" : "") +
        (ct.name ? ' <span class="pit-meta">· ' + esc(ct.name) + "</span>" : "") +
        '</span><span class="pit-meta">' + esc(dt(a.due_date)) + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();PegIntel.actionDone(\'' + a.id + '\')">Done</button>';
      // Whole row opens the linked property; the Done button stops propagation.
      return a.property_id ? clickRow(a.property_id, inner) : '<div class="pit-row">' + inner + "</div>";
    }).join("") : empty("No open actions.", "Daily actions arrive with the workbook import.");
    var imp = d.lastImport
      ? '<div class="pit-row"><span class="grow">' + esc(d.lastImport.filename) + '</span><span class="pit-conf ' + (d.lastImport.status === "committed" ? "Verified" : d.lastImport.status === "failed" ? "Unknown" : "Reported") + '">' + esc(d.lastImport.status) + '</span><span class="pit-meta">' + esc(dt(d.lastImport.created_at)) + "</span></div>"
      : empty("No imports yet.", "Upload your first daily workbook from the Import Center.");
    host.innerHTML = '<div class="pit-tiles">' + tiles + "</div>" +
      '<div class="pit-grid2">' +
        '<div><div class="pit-panel"><h3>Top Opportunities</h3>' + top + "</div>" +
        '<div class="pit-panel"><h3>Maturity / Refinance Calendar · next 12 months</h3>' + mat + "</div></div>" +
        '<div><div class="pit-panel"><h3>Today’s Highest-Priority Actions</h3>' + acts + "</div>" +
        '<div class="pit-panel"><h3>Recent Changes</h3>' + chg + "</div>" +
        '<div class="pit-panel"><h3>Latest Import</h3>' + imp + "</div></div>" +
      "</div>";
  }
  async function actionDone(id) {
    try { await A.updateChild("pci_daily_actions", id, { status: "done", completed_at: new Date().toISOString() }); toast(true, "Action completed"); nav(TAB); }
    catch (e) { toast(false, "Could not update", e.message); }
  }

  /* ═══ 2. PROPERTIES ═══ */
  var PF = { q: "", city: "", subtype: "", status: "", reco: "", confd: "", minScore: "", maxPrice: "", minPrice: "", sort: "updated_at", dir: -1 };
  async function renderProps(host) {
    CACHE.properties = await A.listProperties();
    drawProps(host);
  }
  function drawProps(host) {
    host = host || document.getElementById("pitView");
    var rows = (CACHE.properties || []).filter(function (p) {
      if (PF.q) { var q = PF.q.toLowerCase(); if (((p.property_name || "") + " " + (p.address_line1 || "") + " " + (p.city || "") + " " + (p.parcel_id || "")).toLowerCase().indexOf(q) < 0) return false; }
      if (PF.city && (p.city || "").toLowerCase() !== PF.city.toLowerCase()) return false;
      if (PF.subtype && (p.property_subtype || "") !== PF.subtype) return false;
      if (PF.status && (p.listing_status || "") !== PF.status) return false;
      if (PF.reco && (p.recommendation || "") !== PF.reco) return false;
      if (PF.confd && (p.data_confidence || "") !== PF.confd) return false;
      if (PF.minScore !== "" && !(Number(p.opportunity_score) >= Number(PF.minScore))) return false;
      if (PF.minPrice !== "" && !(Number(p.asking_price) >= Number(PF.minPrice))) return false;
      if (PF.maxPrice !== "" && !(Number(p.asking_price) <= Number(PF.maxPrice))) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var k = PF.sort, av = a[k], bv = b[k];
      if (av === null || av === undefined) return 1; if (bv === null || bv === undefined) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * PF.dir;
    });
    var all = CACHE.properties || [];
    function opts(list, cur) { return '<option value="">All</option>' + list.map(function (o) { return '<option' + (cur === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join(""); }
    var cities = Array.from(new Set(all.map(function (p) { return p.city; }).filter(Boolean))).sort();
    var subs = Array.from(new Set(all.map(function (p) { return p.property_subtype; }).filter(Boolean))).sort();
    var stats = Array.from(new Set(all.map(function (p) { return p.listing_status; }).filter(Boolean))).sort();
    var th = function (k, label, num) { return '<th class="' + (num ? "num" : "") + '" onclick="PegIntel._sort(\'' + k + '\')">' + label + (PF.sort === k ? (PF.dir > 0 ? " ↑" : " ↓") : "") + "</th>"; };
    host.innerHTML =
      '<div class="pit-filters">' +
        '<div class="field"><label class="label">Search</label><input class="input" id="pf_q" value="' + esc(PF.q) + '" placeholder="Name, address, parcel…" oninput="PegIntel._f()"></div>' +
        '<div class="field"><label class="label">City</label><select class="input" id="pf_city" onchange="PegIntel._f()">' + opts(cities, PF.city) + "</select></div>" +
        '<div class="field"><label class="label">Subtype</label><select class="input" id="pf_subtype" onchange="PegIntel._f()">' + opts(subs, PF.subtype) + "</select></div>" +
        '<div class="field"><label class="label">Listing status</label><select class="input" id="pf_status" onchange="PegIntel._f()">' + opts(stats, PF.status) + "</select></div>" +
        '<div class="field"><label class="label">Recommendation</label><select class="input" id="pf_reco" onchange="PegIntel._f()">' + opts(["Act Now", "Watch Closely", "Pass", "Unscored"], PF.reco) + "</select></div>" +
        '<div class="field"><label class="label">Confidence</label><select class="input" id="pf_confd" onchange="PegIntel._f()">' + opts(["Verified", "Reported", "Estimated", "Unknown"], PF.confd) + "</select></div>" +
        '<div class="field"><label class="label">Min score</label><input class="input" id="pf_minScore" style="width:70px" value="' + esc(PF.minScore) + '" oninput="PegIntel._f()"></div>' +
        '<div class="field"><label class="label">Price min/max</label><div style="display:flex;gap:6px"><input class="input" id="pf_minPrice" style="width:90px" placeholder="4000000" value="' + esc(PF.minPrice) + '" oninput="PegIntel._f()"><input class="input" id="pf_maxPrice" style="width:90px" placeholder="7000000" value="' + esc(PF.maxPrice) + '" oninput="PegIntel._f()"></div></div>' +
        '<button class="btn btn-pri btn-sm" onclick="PegIntel.propertyModal(null)">+ Property</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="PegIntel.exportProps()">Export CSV</button>' +
      "</div>" +
      (rows.length ?
        '<div class="pit-table-wrap"><table class="pit-table"><thead><tr>' +
          th("property_name", "Property") + th("city", "City") + th("property_subtype", "Subtype") +
          th("asking_price", "Asking", 1) + th("noi", "NOI", 1) + th("cap_rate_pct", "Cap", 1) +
          th("occupancy_pct", "Occ", 1) + th("opportunity_score", "Score", 1) +
          '<th class="noclick">Reco</th><th class="noclick">Confidence</th>' + th("updated_at", "Updated") +
        "</tr></thead><tbody>" +
        rows.map(function (p) {
          return '<tr onclick="PegIntel.openProperty(\'' + p.id + '\')">' +
            '<td class="strong">' + esc(p.property_name || p.address_line1) + '<div class="pit-meta">' + esc(p.address_line1 || "") + "</div></td>" +
            "<td>" + esc(p.city || "—") + "</td><td>" + esc(p.property_subtype || "—") + "</td>" +
            '<td class="num">' + money(p.asking_price) + '</td><td class="num">' + money(p.noi) + "</td>" +
            '<td class="num">' + pct(p.cap_rate_pct) + '</td><td class="num">' + pct(p.occupancy_pct) + "</td>" +
            '<td class="num strong">' + (p.opportunity_score ?? "—") + "</td>" +
            "<td>" + reco(p.recommendation) + "</td><td>" + conf(p.data_confidence) + "</td>" +
            '<td class="pit-meta">' + esc(dt(p.updated_at)) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="pit-note">' + rows.length + " of " + all.length + " tracked properties.</div>"
      : empty("No properties match.", all.length ? "Adjust the filters." : "Import your first daily workbook or add a property manually."));
  }
  function _f() { ["q", "city", "subtype", "status", "reco", "confd", "minScore", "minPrice", "maxPrice"].forEach(function (k) { PF[k] = gv("pf_" + k); }); drawProps(); }
  function _sort(k) { if (PF.sort === k) PF.dir = -PF.dir; else { PF.sort = k; PF.dir = -1; } drawProps(); }
  function exportProps() {
    var all = CACHE.properties || [];
    csvExport("pegasus-intelligence-properties.csv",
      ["Property", "Address", "City", "State", "ZIP", "Parcel", "Subtype", "Building SF", "Asking", "NOI", "Cap %", "Occ %", "Score", "Recommendation", "Confidence", "Listing status", "Updated"],
      all.map(function (p) { return [p.property_name, p.address_line1, p.city, p.state, p.postal_code, p.parcel_id, p.property_subtype, p.building_sf, p.asking_price, p.noi, p.cap_rate_pct, p.occupancy_pct, p.opportunity_score, p.recommendation, p.data_confidence, p.listing_status, p.updated_at]; }));
  }

  /* Property create/edit modal (facts only — analysis lives in Score tab). */
  function propertyModal(id) {
    var p = id ? (CACHE.properties || []).find(function (x) { return x.id === id; }) || {} : {};
    function f(label, fid, val, ph, type) {
      return '<div class="field"><label class="label">' + label + '</label><input class="input" id="pp_' + fid + '" value="' + esc(val ?? "") + '" placeholder="' + esc(ph || "") + '"' + (type ? ' type="' + type + '"' : "") + "></div>";
    }
    var confOpts = ["", "Verified", "Reported", "Estimated", "Unknown"].map(function (o) { return "<option" + ((p.data_confidence || "") === o ? " selected" : "") + ">" + o + "</option>"; }).join("");
    var inner =
      '<div class="row2">' + f("Property name", "name", p.property_name, "Plaza name") + f("Subtype", "subtype", p.property_subtype, "strip_center / neighborhood_center") + "</div>" +
      f("Address *", "addr", p.address_line1, "Street address") +
      '<div class="row2">' + f("City *", "city", p.city, "West Palm Beach") + '<div class="field"><label class="label">State / ZIP / County</label><div style="display:flex;gap:6px"><input class="input" id="pp_state" style="width:60px" value="' + esc(p.state || "FL") + '"><input class="input" id="pp_zip" style="width:90px" value="' + esc(p.postal_code || "") + '"><input class="input" id="pp_county" value="' + esc(p.county || "Palm Beach") + '"></div></div></div>' +
      '<div class="row2">' + f("Parcel ID", "parcel", p.parcel_id, "") + f("External ID", "ext", p.external_id, "") + "</div>" +
      '<div class="row2">' + f("Building SF", "sf", p.building_sf, "", "number") + f("Year built", "year", p.year_built, "", "number") + "</div>" +
      '<div class="row2">' + f("Asking price", "price", p.asking_price, "5250000") + f("NOI", "noi", p.noi, "315000") + "</div>" +
      '<div class="row2">' + f("Cap rate %", "cap", p.cap_rate_pct, "6.0") + f("Occupancy %", "occ", p.occupancy_pct, "92") + "</div>" +
      '<div class="row2">' + f("Anchor tenant", "anchor", p.anchor_tenant, "") + f("Listing status", "lstatus", p.listing_status, "active / under_contract / off_market") + "</div>" +
      f("Listing URL", "lurl", p.listing_url, "https://…") +
      '<div class="row2"><div class="field"><label class="label">Data confidence</label><select class="input" id="pp_conf">' + confOpts + "</select></div>" + f("Source URL", "src", p.source_url, "https://… (where this info came from)") + "</div>" +
      '<div class="field"><label class="label">Notes</label><textarea class="ws-textarea" id="pp_notes">' + esc(p.notes || "") + "</textarea></div>";
    var footer = '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>' +
      '<button class="btn btn-pri" onclick="PegIntel.saveProperty(' + (id ? "'" + id + "'" : "null") + ')">' + (id ? "Save" : "Add property") + "</button>";
    window.Pegasus.modal(shell((id ? "Edit" : "New") + " property", inner, footer));
  }
  async function savePropertyUI(id) {
    var errEl = document.getElementById("pitErr");
    var addr = gv("pp_addr"), city = gv("pp_city");
    if (!addr || !city) { if (errEl) errEl.textContent = "Address and city are required."; return; }
    var norm = addr.toUpperCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim() + "|" + city.toUpperCase() + "|" + (gv("pp_state") || "FL").toUpperCase() + "|" + gv("pp_zip").slice(0, 5);
    var row = { property_name: gv("pp_name") || null, property_subtype: gv("pp_subtype") || null,
      address_line1: addr, normalized_address: norm, city: city, state: gv("pp_state") || "FL",
      postal_code: gv("pp_zip") || null, county: gv("pp_county") || null, parcel_id: gv("pp_parcel") || null,
      external_id: gv("pp_ext") || null, building_sf: numOr(gv("pp_sf")), year_built: numOr(gv("pp_year")),
      asking_price: numOr(gv("pp_price")), noi: numOr(gv("pp_noi")), cap_rate_pct: numOr(gv("pp_cap")),
      occupancy_pct: numOr(gv("pp_occ")), anchor_tenant: gv("pp_anchor") || null,
      listing_status: gv("pp_lstatus") || null, listing_url: gv("pp_lurl") || null,
      data_confidence: gv("pp_conf") || null, source_url: gv("pp_src") || null, notes: gv("pp_notes") || null };
    try {
      await A.saveProperty(id, row);
      window.Pegasus.closeModal(); toast(true, id ? "Property updated" : "Property added", addr);
      CACHE.properties = null; nav("props");
    } catch (e) { if (errEl) errEl.textContent = e.message; }
  }
  function shell(title, inner, footer) {
    return '<div class="sce-scrim" onclick="if(event.target===this)Pegasus.dismissModal()"><div class="sce-modal" style="max-width:640px">' +
      '<div class="sce-head"><div class="sce-title">' + esc(title) + '</div><button class="sce-x" onclick="Pegasus.closeModal()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:70vh;overflow-y:auto">' + inner + "</div>" +
      '<div class="sce-foot"><div id="pitErr" class="sce-err"></div>' + footer + "</div></div></div>";
  }

  /* ═══ 3. PROPERTY DETAIL (modal with sub-tabs) ═══ */
  var DET = { id: null, p: null, kids: null, tab: "overview", docs: [], open: false };
  // fromHistory=true means we are opening in response to a popstate/deep-link
  // (URL already reflects this property) — so we must NOT push another entry.
  async function openProperty(id, fromHistory) {
    if (!/^[0-9a-f-]{16,40}$/i.test(String(id || ""))) { toast(false, "Invalid property link"); return; }
    if (!fromHistory) { try { history.pushState({ pciProp: id }, "", propUrl(id)); } catch (_) {} }
    DET = { id: id, p: null, kids: null, tab: "overview", docs: [], open: true };
    window.Pegasus.modal('<div class="sce-scrim" onclick="if(event.target===this)PegIntel.closeProperty()"><div class="sce-modal" style="max-width:880px">' +
      '<div class="sce-head"><div class="sce-title" id="pitDetTitle">Property</div><button class="sce-x" onclick="PegIntel.closeProperty()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:76vh;overflow-y:auto" id="pitDet">' + empty("Loading…") + "</div></div></div>");
    try {
      if (!CACHE.properties) CACHE.properties = await A.listProperties();
      DET.p = (CACHE.properties || []).find(function (x) { return x.id === id; });
      if (!DET.p) {
        // Safe not-found state for a stale/invalid property id (e.g. a shared
        // deep link to a removed property).
        var nf = document.getElementById("pitDet");
        if (nf) nf.innerHTML = empty("Property not found.", "It may have been removed. Close this and return to the dashboard.");
        var tnf = document.getElementById("pitDetTitle"); if (tnf) tnf.textContent = "Property not found";
        return;
      }
      DET.kids = await A.propertyChildren(id);
      try { DET.docs = await A.listPropertyDocs(id); } catch (_) { DET.docs = []; }
      drawDetail();
    } catch (e) {
      var h = document.getElementById("pitDet"); if (h) h.innerHTML = empty("Could not load property.", e.message);
    }
  }
  function detTab(t) { DET.tab = t; drawDetail(); }
  // Close Property Detail. If we pushed a history entry, go back so the URL and
  // history stay in sync (popstate then tears the modal down); otherwise close
  // directly and strip the ?property= param.
  function closeProperty() {
    if (history.state && history.state.pciProp) { history.back(); }
    else { window.Pegasus.closeModal(); DET.open = false; try { history.replaceState({}, "", location.pathname); } catch (_) {} }
  }
  // Browser Back/Forward: reconcile the modal with the URL. A ?property=<id>
  // means "show that property"; its absence means "close the detail" — the
  // Dashboard/Properties view underneath is untouched, so filters survive.
  var _popWired = false;
  function wireHistory() {
    if (_popWired) return; _popWired = true;
    window.addEventListener("popstate", function () {
      var pid = currentPropParam();
      if (pid) { if (!(DET.open && DET.id === pid)) openProperty(pid, true); }
      else if (DET.open) { window.Pegasus.closeModal(); DET.open = false; }
    });
  }
  function drawDetail() {
    var p = DET.p || {}, k = DET.kids || {};
    var tEl = document.getElementById("pitDetTitle");
    if (tEl) tEl.textContent = p.property_name || p.address_line1 || "Property";
    var tabs = [["overview", "Overview"], ["contacts", "Ownership & Contacts"], ["debt", "Debt"],
      ["tenants", "Tenants & Rollover"], ["listings", "Listings & Price History"], ["distress", "Distress Signals"],
      ["score", "Opportunity Score"], ["capmatch", "Capital Match"], ["sources", "Sources & Documents"], ["history", "Change History"]];
    var host = document.getElementById("pitDet");
    if (!host) return;
    var body = "";
    var T = DET.tab;
    if (T === "overview") {
      body = '<dl class="pit-kv">' +
        kv("Address", [p.address_line1, p.city, p.state, p.postal_code].filter(Boolean).join(", ")) +
        kv("County / Parcel", [p.county, p.parcel_id].filter(Boolean).join(" · ") || "—") +
        kv("Subtype", p.property_subtype) + kv("Building", p.building_sf ? sf(p.building_sf) : null) +
        kv("Year built", p.year_built) + kv("Asking price", money(p.asking_price)) +
        kv("NOI", money(p.noi)) + kv("Cap rate", pct(p.cap_rate_pct)) +
        kv("Occupancy", pct(p.occupancy_pct)) + kv("Tenants", p.tenant_count) +
        kv("Anchor", p.anchor_tenant) +
        kv("Listing", (p.listing_status || "—") + (p.listing_url ? ' · <a class="pit-src" href="' + esc(p.listing_url) + '" target="_blank" rel="noopener noreferrer">listing ↗</a>' : ""), true) +
        kv("First / last seen", [dt(p.first_seen_at), dt(p.last_seen_at)].join(" → ")) +
        kv("Data quality", conf(p.data_confidence) + " " + srcLink(p.source_url, p.last_verified_at), true) +
        kv("Notes", p.notes) + "</dl>" +
        '<div style="margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="Pegasus.closeModal();PegIntel.propertyModal(\'' + p.id + '\')">Edit property</button></div>';
    } else if (T === "contacts") {
      var rows = (k.contactsFor || []);
      body = rows.length ? rows.map(function (r) {
        var c = r.crm_contacts || {};
        return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(c.name || "—") + "</b>" + (c.company ? " · " + esc(c.company) : "") +
          ' <span class="pit-meta">' + esc(r.relationship_role.replace(/_/g, " ")) + (r.is_primary ? " · primary" : "") + "</span></span>" +
          conf(r.confidence) + srcLink(r.source_url, r.last_verified_at) + "</div>";
      }).join("") : empty("No linked contacts.", "Link owners, brokers, and lenders via the daily workbook (Property_Contacts sheet) or the CRM.");
      body += '<div class="pit-note">People live in your CRM — <a href="/crm.html" style="color:var(--blue)">open CRM</a> to call, log activity, or set reminders.</div>';
    } else if (T === "debt") {
      var loans = k.loans || [];
      body = loans.length ? loans.map(function (l) {
        var lender = (l.crm_contacts && (l.crm_contacts.company || l.crm_contacts.name)) || l.lender_name_snapshot || "Lender ?";
        return '<div class="pit-panel" style="margin-bottom:10px"><div class="pit-row" style="border:none;padding:0 0 6px">' +
          '<span class="grow strong">' + esc(lender) + ' · lien ' + (l.lien_position ?? "?") + "</span>" + conf(l.confidence) + srcLink(l.source_url) + "</div>" +
          '<dl class="pit-kv">' + kv("Original / balance", money(l.original_amount) + " / " + money(l.estimated_balance)) +
          kv("Rate", (l.interest_rate_pct != null ? pct(l.interest_rate_pct) : "—") + (l.rate_type ? " · " + esc(l.rate_type) : ""), true) +
          kv("Maturity", dt(l.maturity_date) + (l.maturity_basis ? ' · <span class="pit-conf ' + esc(l.maturity_basis) + '">' + esc(l.maturity_basis) + "</span>" : ""), true) +
          kv("Recorded", [dt(l.recorded_date), l.instrument_number].filter(Boolean).join(" · ")) +
          kv("Type / recourse", [l.loan_type, l.recourse].filter(Boolean).join(" · ")) +
          kv("DSCR / LTV", [(l.dscr ?? "—"), (l.ltv_pct != null ? pct(l.ltv_pct) : "—")].join(" / ")) +
          kv("Status", l.status) + (l.notes ? kv("Notes", l.notes) : "") + "</dl></div>";
      }).join("") : empty("No recorded debt.", "Loans arrive via the daily workbook (Loans sheet).");
    } else if (T === "tenants") {
      var ts = k.tenants || [];
      body = ts.length ? '<div class="pit-table-wrap"><table class="pit-table" style="min-width:640px"><thead><tr><th class="noclick">Tenant</th><th class="noclick">Suite</th><th class="noclick num">SF</th><th class="noclick num">Rent</th><th class="noclick">Expires</th><th class="noclick">Risk</th><th class="noclick">Quality</th></tr></thead><tbody>' +
        ts.map(function (t) {
          var soon = t.lease_expiration && (new Date(t.lease_expiration) - Date.now()) < 540 * 864e5;
          return "<tr><td class=\"strong\">" + esc(t.tenant_name) + "</td><td>" + esc(t.suite || "—") + '</td><td class="num">' + (t.leased_sf ? sf(t.leased_sf) : "—") +
            '</td><td class="num">' + money(t.annual_rent) + "</td><td" + (soon ? ' style="color:var(--amber)"' : "") + ">" + dt(t.lease_expiration) + "</td><td>" + esc(t.rollover_risk || "—") + "</td><td>" + esc(t.credit_quality || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
        : empty("No tenant data.", "Rent-roll rows arrive via the Tenants sheet.");
    } else if (T === "listings") {
      var ls = k.listings || [];
      body = ls.length ? ls.map(function (l) {
        return '<div class="pit-row"><span class="grow">' + esc(l.listing_status || "status ?") + " · " + money(l.asking_price) +
          (l.listing_source ? ' <span class="pit-meta">via ' + esc(l.listing_source) + "</span>" : "") + "</span>" + conf(l.confidence) +
          '<span class="pit-meta">' + esc(dt(l.changed_on || l.listed_on)) + "</span></div>";
      }).join("") : empty("No listing events yet.", "Price/status changes are recorded automatically on import.");
      var priceChanges = (k.changes || []).filter(function (c) { return c.field_name === "asking_price"; });
      if (priceChanges.length) {
        body += '<div class="pit-panel" style="margin-top:12px"><h3>Asking-price history</h3>' + priceChanges.map(function (c) {
          return '<div class="pit-row"><span class="grow">' + money(c.old_value) + " → <b style=\"color:var(--text)\">" + money(c.new_value) + "</b></span><span class=\"pit-meta\">" + esc(dt(c.changed_at)) + "</span></div>";
        }).join("") + "</div>";
      }
    } else if (T === "distress") {
      var ss = k.signals || [];
      body = ss.length ? ss.map(function (s) {
        return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(s.signal_type.replace(/_/g, " ")) + "</b>" +
          (s.summary ? " — " + esc(s.summary) : "") + (s.case_or_instrument_no ? ' <span class="pit-meta">' + esc(s.case_or_instrument_no) + "</span>" : "") + "</span>" +
          (s.amount != null ? '<span class="num">' + money(s.amount) + "</span>" : "") + conf(s.confidence) + srcLink(s.source_url) +
          '<span class="pit-meta">' + esc(dt(s.event_date)) + "</span></div>";
      }).join("") : empty("No distress signals recorded.", "Signals arrive via the Distress_Signals sheet.");
    } else if (T === "score") {
      var sc = k.scores || [];
      body = '<div class="pit-note" style="margin:0 0 12px">Analysis layer — distinct from recorded facts. Components: Location 0–15 · Tenant Quality 0–15 · Cash Flow 0–15 · Pricing 0–15 · Distress/Refinance 0–20 · Upside 0–10 · Financing Feasibility 0–10. Thresholds: 80+ Act Now · 60–79 Watch Closely · below 60 Pass (override requires a stored reason).</div>';
      body += sc.length ? sc.map(function (s) {
        var parts = [["Loc", s.location_score], ["Tenant", s.tenant_quality_score], ["Cash", s.cash_flow_score], ["Price", s.pricing_score], ["Distress", s.distress_refinance_score], ["Upside", s.upside_score], ["Financing", s.financing_feasibility_score]]
          .filter(function (x) { return x[1] !== null && x[1] !== undefined; })
          .map(function (x) { return x[0] + " " + x[1]; }).join(" · ");
        return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + s.total_score + "</b> " + reco(s.recommendation) +
          (parts ? ' <span class="pit-meta">' + esc(parts) + "</span>" : ' <span class="pit-meta">total only (imported)</span>') +
          (s.override_reason ? '<div class="pit-meta">override: ' + esc(s.override_reason) + "</div>" : "") +
          (s.rationale ? '<div class="pit-meta">' + esc(s.rationale) + "</div>" : "") +
          "</span><span class=\"pit-meta\">" + esc(dt(s.score_date)) + "</span></div>";
      }).join("") : empty("Not scored yet.");
      if (CAP.canImport)
        body += '<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" onclick="PegIntel.scoreModal(\'' + p.id + '\')">+ New score</button></div>';
    } else if (T === "capmatch") {
      body = '<div id="pitDetMatch">' + empty("Loading lender programs…") + "</div>";
      setTimeout(function () { detailMatch(p); }, 0);
    } else if (T === "sources") {
      // Linked research sources (durable provenance — ARCH 6).
      var links = (k.sources || []);
      var linkHtml = '<div class="pit-panel" style="margin-bottom:12px"><h3>Linked sources</h3>' +
        (links.length ? links.map(function (l) {
          var s = l.pci_sources || {};
          return '<div class="pit-row"><span class="grow">' + esc(s.source_title || s.source_url || "source") +
            (s.publisher ? ' <span class="pit-meta">' + esc(s.publisher) + "</span>" : "") + "</span>" + conf(l.confidence) +
            (s.source_date ? '<span class="pit-meta">' + esc(dt(s.source_date)) + "</span>" : "") +
            (s.source_url ? '<a class="pit-src" href="' + esc(s.source_url) + '" target="_blank" rel="noopener noreferrer">open ↗</a>' : "") + "</div>";
        }).join("") : empty("No linked sources yet.", "Sources are attached automatically from each imported row's Source_URL.")) + "</div>";
      // Private documents live in the admin-only storage bucket. Analysts see
      // the provenance sources above but not the document vault.
      var docHtml = "";
      if (CAP.canImport) {
        var docs = DET.docs || [];
        docHtml = '<div class="pit-panel"><h3>Documents</h3>' +
          (docs.length ? docs.map(function (d) {
            return '<div class="pit-row"><span class="grow">' + esc(d.name) + '</span><button class="btn btn-ghost btn-sm" onclick="PegIntel.openDoc(\'properties/' + p.id + "/" + esc(d.name) + '\')">Open</button></div>';
          }).join("") : empty("No documents.", "OMs, rent rolls, and loan docs upload to the private intelligence bucket.")) +
          '<div style="margin-top:12px"><label class="btn btn-ghost btn-sm" style="cursor:pointer">Upload document<input type="file" style="display:none" onchange="PegIntel.uploadDoc(this,\'' + p.id + '\')"></label></div>' +
          '<div class="pit-note">Files are stored in the private capital-intelligence bucket — never public, opened via short-lived signed links.</div></div>';
      }
      body = linkHtml + docHtml;
    } else if (T === "history") {
      var ch = k.changes || [];
      var smap = k.sourceMap || {};
      body = ch.length ? ch.map(function (c) {
        var src = c.source_id && smap[c.source_id];
        var srcHtml = src ? ' <a class="pit-src" href="' + esc(src.source_url || "#") + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : "";
        return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(c.field_name) + "</b> " +
          esc(JSON.stringify(c.old_value)) + " → " + esc(JSON.stringify(c.new_value)) +
          (c.confidence_after ? " " + conf(c.confidence_after) : "") + srcHtml + "</span><span class=\"pit-meta\">" + esc(dt(c.changed_at)) + "</span></div>";
      }).join("") : empty("No recorded changes for this property yet.");
    }
    host.innerHTML = '<div class="pit-detail-tabs">' + tabs.map(function (t) {
      return '<button class="pit-detail-tab' + (T === t[0] ? " on" : "") + '" onclick="PegIntel.detTab(\'' + t[0] + '\')">' + t[1] + "</button>";
    }).join("") + "</div>" + body;
  }
  function kv(k, v, html) {
    if (v === null || v === undefined || v === "" ) v = "—";
    return "<dt>" + esc(k) + "</dt><dd>" + (html ? v : esc(String(v))) + "</dd>";
  }
  async function detailMatch(p) {
    var host = document.getElementById("pitDetMatch");
    if (!host) return;
    try {
      if (!CACHE.programs) CACHE.programs = await A.listPrograms();
      var target = p.asking_price ? Math.round(p.asking_price * 0.65) : null;
      host.innerHTML = matchUI(p, target);
    } catch (e) { host.innerHTML = empty("Could not load programs.", e.message); }
  }

  /* Score entry modal — component scores with live total. */
  function scoreModal(propertyId) {
    var COMP = [["location_score", "Location", 15], ["tenant_quality_score", "Tenant quality", 15], ["cash_flow_score", "Cash flow", 15],
      ["pricing_score", "Pricing", 15], ["distress_refinance_score", "Distress / refinance", 20], ["upside_score", "Upside", 10], ["financing_feasibility_score", "Financing feasibility", 10]];
    var inner = COMP.map(function (c) {
      return '<div class="row2" style="align-items:center"><div class="field"><label class="label">' + c[1] + " (0–" + c[2] + ')</label><input class="input" id="sc_' + c[0] + '" type="number" min="0" max="' + c[2] + '" oninput="PegIntel._scoreSum()"></div><div></div></div>';
    }).join("") +
      '<div class="field"><label class="label">Total</label><div id="sc_total" style="font-size:22px;font-family:var(--serif);color:var(--text)">0 · Pass</div></div>' +
      '<div class="field"><label class="label">Rationale</label><textarea class="ws-textarea" id="sc_rationale" placeholder="Why this score — visible in history."></textarea></div>' +
      '<div class="field"><label class="label">Recommendation override <span class="opt">(only with a reason)</span></label><select class="input" id="sc_reco"><option value="">Use thresholds</option><option>Act Now</option><option>Watch Closely</option><option>Pass</option></select>' +
      '<input class="input" id="sc_reason" style="margin-top:6px" placeholder="Override reason (required if overriding)"></div>';
    var footer = '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>' +
      '<button class="btn btn-pri" onclick="PegIntel.saveScore(\'' + propertyId + '\')">Save score</button>';
    window.Pegasus.modal(shell("New opportunity score", inner, footer));
  }
  function _scoreSum() {
    var keys = ["location_score", "tenant_quality_score", "cash_flow_score", "pricing_score", "distress_refinance_score", "upside_score", "financing_feasibility_score"];
    var total = 0, all = true;
    keys.forEach(function (k) { var v = gv("sc_" + k); if (v === "") { all = false; return; } total += Number(v) || 0; });
    var el = document.getElementById("sc_total");
    if (el) el.textContent = (all ? total : "—") + " · " + (all ? (total >= 80 ? "Act Now" : total >= 60 ? "Watch Closely" : "Pass") : "fill all components");
  }
  async function saveScore(propertyId) {
    var errEl = document.getElementById("pitErr");
    var keys = ["location_score", "tenant_quality_score", "cash_flow_score", "pricing_score", "distress_refinance_score", "upside_score", "financing_feasibility_score"];
    var row = { property_id: propertyId, score_date: new Date().toISOString().slice(0, 10), rationale: gv("sc_rationale") || null };
    var total = 0, all = true;
    keys.forEach(function (k) { var v = gv("sc_" + k); if (v === "") { all = false; row[k] = null; } else { row[k] = Number(v); total += Number(v); } });
    if (!all) { if (errEl) errEl.textContent = "Fill in all seven components (0 is a valid value)."; return; }
    row.total_score = total;
    var auto = total >= 80 ? "Act Now" : total >= 60 ? "Watch Closely" : "Pass";
    var over = gv("sc_reco");
    if (over && over !== auto) {
      if (!gv("sc_reason")) { if (errEl) errEl.textContent = "An override requires a stored reason."; return; }
      row.recommendation = over; row.override_reason = gv("sc_reason");
    } else { row.recommendation = auto; }
    try {
      await A.insertChild("pci_scores", row);
      await A.saveProperty(propertyId, { opportunity_score: total, recommendation: row.recommendation });
      window.Pegasus.closeModal(); toast(true, "Score saved", total + " · " + row.recommendation);
      CACHE.properties = null; openProperty(propertyId);
    } catch (e) { if (errEl) errEl.textContent = e.message; }
  }
  async function uploadDoc(input, propertyId) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 15 * 1048576) { toast(false, "Too large", "Maximum 15MB per document."); return; }
    try { await A.uploadPropertyDoc(propertyId, file); toast(true, "Document stored privately", file.name); DET.docs = await A.listPropertyDocs(propertyId); drawDetail(); }
    catch (e) { toast(false, "Upload failed", e.message); }
  }
  async function openDoc(path) {
    try { var u = await A.signedUrl(path); window.open(u, "_blank", "noopener,noreferrer"); }
    catch (e) { toast(false, "Could not open", e.message); }
  }

  /* ═══ 4. CONTACTS ═══ */
  async function renderContacts(host) {
    var c = await window.PegSB.ready;
    var r = await c.from("pci_property_contacts")
      .select("*, crm_contacts(id,name,company,job_title,email,phone,contact_type,data_confidence,last_verified_at,source_url), pci_properties(id,property_name,address_line1,city)")
      .order("updated_at", { ascending: false }).limit(500);
    var rows = r.error ? [] : (r.data || []);
    var byRole = {};
    rows.forEach(function (x) { (byRole[x.relationship_role] = byRole[x.relationship_role] || []).push(x); });
    var order = ["listing_broker", "owner_entity", "principal", "current_lender", "leasing_broker", "property_manager", "attorney", "title_contact", "other"];
    host.innerHTML =
      '<div class="pit-note" style="margin:0 0 14px">People and organizations live in your existing CRM (relationship layer). This view maps them to tracked properties by role. Broker/owner/lender rows from the daily workbook are created as CRM contacts automatically and linked here.</div>' +
      (rows.length ? order.filter(function (k) { return byRole[k]; }).map(function (role) {
        return '<div class="pit-panel"><h3>' + esc(role.replace(/_/g, " ")) + " (" + byRole[role].length + ')</h3>' +
          byRole[role].map(function (x) {
            var ct = x.crm_contacts || {}, pr = x.pci_properties || {};
            return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(ct.name || "—") + "</b>" + (ct.company ? " · " + esc(ct.company) : "") +
              (ct.email ? ' <span class="pit-meta">' + esc(ct.email) + "</span>" : "") +
              ' <span class="pit-meta">→ ' + esc(pr.property_name || pr.address_line1 || "property") + "</span></span>" +
              conf(x.confidence || ct.data_confidence) + srcLink(x.source_url || ct.source_url, x.last_verified_at || ct.last_verified_at) +
              (pr.id ? '<button class="btn btn-ghost btn-sm" onclick="PegIntel.openProperty(\'' + pr.id + '\')">Property</button>' : "") + "</div>";
          }).join("") + "</div>";
      }).join("") : empty("No property-linked contacts yet.", "They arrive with the Property_Contacts sheet, or link them from a Property Detail.")) +
      '<div class="pit-head-actions" style="margin-top:14px"><a class="btn btn-pri btn-sm" href="/crm.html">Open CRM</a></div>';
  }

  /* ═══ 5. LENDERS & CAPITAL ═══ */
  var LF = { q: "", type: "", active: "active" };
  async function renderLenders(host) {
    CACHE.programs = await A.listPrograms();
    drawLenders(host);
  }
  function drawLenders(host) {
    host = host || document.getElementById("pitView");
    var all = CACHE.programs || [];
    var staleCut = Date.now() - 90 * 864e5;
    var rows = all.filter(function (g) {
      if (LF.q) { var q = LF.q.toLowerCase(); if (((g.lender_name_snapshot || "") + " " + (g.program_name || "") + " " + (g.capital_source_type || "")).toLowerCase().indexOf(q) < 0) return false; }
      if (LF.type && (g.capital_source_type || "") !== LF.type) return false;
      if (LF.active && (g.active_status || "active") !== LF.active) return false;
      return true;
    });
    var types = Array.from(new Set(all.map(function (g) { return g.capital_source_type; }).filter(Boolean))).sort();
    host.innerHTML =
      '<div class="pit-filters">' +
        '<div class="field"><label class="label">Search</label><input class="input" id="lf_q" value="' + esc(LF.q) + '" oninput="PegIntel._lf()" placeholder="Lender, program…"></div>' +
        '<div class="field"><label class="label">Capital type</label><select class="input" id="lf_type" onchange="PegIntel._lf()"><option value="">All</option>' + types.map(function (t) { return "<option" + (LF.type === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label class="label">Status</label><select class="input" id="lf_active" onchange="PegIntel._lf()"><option value="">All</option><option' + (LF.active === "active" ? " selected" : "") + '>active</option><option' + (LF.active === "paused" ? " selected" : "") + ">paused</option><option" + (LF.active === "retired" ? " selected" : "") + ">retired</option></select></div>" +
        '<button class="btn btn-pri btn-sm" onclick="PegIntel.programModal(null)">+ Program</button>' +
      "</div>" +
      (rows.length ? '<div class="pit-table-wrap"><table class="pit-table"><thead><tr><th class="noclick">Lender / Program</th><th class="noclick">Type</th><th class="noclick">FL</th><th class="noclick">Retail</th><th class="noclick num">Loan range</th><th class="noclick num">Max LTV</th><th class="noclick num">Min DSCR</th><th class="noclick">Recourse</th><th class="noclick">Rate guidance</th><th class="noclick">Verified</th></tr></thead><tbody>' +
        rows.map(function (g) {
          var stale = !g.last_verified_at || new Date(g.last_verified_at).getTime() < staleCut;
          return '<tr onclick="PegIntel.programModal(\'' + g.id + '\')">' +
            '<td class="strong">' + esc(g.lender_name_snapshot) + (g.program_name ? '<div class="pit-meta">' + esc(g.program_name) + "</div>" : "") + "</td>" +
            "<td>" + esc(g.capital_source_type || "—") + "</td><td>" + esc(g.florida_appetite || "?") + "</td><td>" + esc(g.retail_appetite || "?") + "</td>" +
            '<td class="num">' + money(g.min_loan) + " – " + money(g.max_loan) + '</td><td class="num">' + pct(g.max_ltv_pct) + '</td><td class="num">' + (g.min_dscr ?? "—") + "</td>" +
            "<td>" + esc(g.recourse || "—") + "</td><td>" + esc(g.rate_guidance || "—") + "</td>" +
            "<td>" + conf(g.confidence) + (stale ? ' <span class="pit-stale">⚠ stale — reverify</span>' : ' <span class="pit-meta">' + esc(dt(g.last_verified_at)) + "</span>") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="pit-note">Terms are research notes, not commitments — always confirm directly with the lender. Programs unverified for 90+ days are flagged stale.</div>'
      : empty("No lender programs.", "Import them via the Lender_Programs sheet or add one manually."));
  }
  function _lf() { LF.q = gv("lf_q"); LF.type = gv("lf_type"); LF.active = gv("lf_active"); drawLenders(); }
  function programModal(id) {
    var g = id ? (CACHE.programs || []).find(function (x) { return x.id === id; }) || {} : {};
    function f(label, fid, val, ph) { return '<div class="field"><label class="label">' + label + '</label><input class="input" id="pg_' + fid + '" value="' + esc(val ?? "") + '" placeholder="' + esc(ph || "") + '"></div>'; }
    var confOpts = ["", "Verified", "Reported", "Estimated", "Unknown"].map(function (o) { return "<option" + ((g.confidence || "") === o ? " selected" : "") + ">" + o + "</option>"; }).join("");
    var inner =
      '<div class="row2">' + f("Lender *", "lender", g.lender_name_snapshot, "QA Capital Partners") + f("Program", "prog", g.program_name, "Retail bridge") + "</div>" +
      '<div class="row2">' + f("Capital type", "type", g.capital_source_type, "bank / debt_fund / cmbs / agency / private") + f("Stabilized / value-add", "sva", g.stabilized_or_value_add, "stabilized / value_add / both") + "</div>" +
      '<div class="row2">' + f("Florida appetite", "fl", g.florida_appetite, "Yes / No / Selective") + f("Retail appetite", "rt", g.retail_appetite, "Yes / No / Selective") + "</div>" +
      '<div class="row2">' + f("Min loan", "min", g.min_loan) + f("Max loan", "max", g.max_loan) + "</div>" +
      '<div class="row2">' + f("Max LTV %", "ltv", g.max_ltv_pct) + f("Max LTC %", "ltc", g.max_ltc_pct) + "</div>" +
      '<div class="row2">' + f("Min DSCR", "dscr", g.min_dscr) + f("Recourse", "rec", g.recourse, "recourse / non-recourse / partial") + "</div>" +
      '<div class="row2">' + f("Interest only", "io", g.interest_only, "yes / no / partial") + f("Term months / Amort years", "term", [g.term_months, g.amortization_years].filter(function (x) { return x != null; }).join(" / ")) + "</div>" +
      f("Rate guidance", "rate", g.rate_guidance, "e.g. SOFR + 350–450") +
      '<div class="row2">' + f("Fees", "fees", g.fees) + f("Prepayment", "prepay", g.prepayment) + "</div>" +
      '<div class="row2"><div class="field"><label class="label">Status</label><select class="input" id="pg_status">' + ["active", "paused", "retired"].map(function (s) { return "<option" + ((g.active_status || "active") === s ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label class="label">Confidence</label><select class="input" id="pg_conf">' + confOpts + "</select></div></div>" +
      '<div class="row2">' + f("Source URL", "src", g.source_url, "https://…") + f("Last verified (YYYY-MM-DD)", "ver", g.last_verified_at ? String(g.last_verified_at).slice(0, 10) : "") + "</div>" +
      '<div class="field"><label class="label">Notes</label><textarea class="ws-textarea" id="pg_notes">' + esc(g.notes || "") + "</textarea></div>";
    var footer = '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>' +
      '<button class="btn btn-pri" onclick="PegIntel.saveProgram(' + (id ? "'" + id + "'" : "null") + ')">' + (id ? "Save" : "Add program") + "</button>";
    window.Pegasus.modal(shell((id ? "Edit" : "New") + " lender program", inner, footer));
  }
  async function saveProgramUI(id) {
    var errEl = document.getElementById("pitErr");
    if (!gv("pg_lender")) { if (errEl) errEl.textContent = "Lender name is required."; return; }
    var term = gv("pg_term").split("/").map(function (s) { return numOr(s); });
    var row = { lender_name_snapshot: gv("pg_lender"), program_name: gv("pg_prog") || null,
      capital_source_type: gv("pg_type") || null, stabilized_or_value_add: gv("pg_sva") || null,
      florida_appetite: gv("pg_fl") || null, retail_appetite: gv("pg_rt") || null,
      min_loan: numOr(gv("pg_min")), max_loan: numOr(gv("pg_max")), max_ltv_pct: numOr(gv("pg_ltv")),
      max_ltc_pct: numOr(gv("pg_ltc")), min_dscr: numOr(gv("pg_dscr")), recourse: gv("pg_rec") || null,
      interest_only: gv("pg_io") || null, term_months: term[0] != null ? Math.round(term[0]) : null,
      amortization_years: term[1] != null ? Math.round(term[1]) : null, rate_guidance: gv("pg_rate") || null,
      fees: gv("pg_fees") || null, prepayment: gv("pg_prepay") || null, active_status: gv("pg_status") || "active",
      confidence: gv("pg_conf") || null, source_url: gv("pg_src") || null,
      last_verified_at: gv("pg_ver") ? gv("pg_ver") + "T00:00:00Z" : null, notes: gv("pg_notes") || null };
    try { await A.saveProgram(id, row); window.Pegasus.closeModal(); toast(true, id ? "Program updated" : "Program added", row.lender_name_snapshot); CACHE.programs = null; nav("lenders"); }
    catch (e) { if (errEl) errEl.textContent = e.message; }
  }

  /* ═══ 6. CAPITAL MATCH ═══ */
  async function renderMatch(host) {
    if (!CACHE.properties) CACHE.properties = await A.listProperties();
    if (!CACHE.programs) CACHE.programs = await A.listPrograms();
    var opts = (CACHE.properties || []).map(function (p) {
      return '<option value="' + p.id + '">' + esc((p.property_name || p.address_line1) + " · " + (p.city || "")) + "</option>";
    }).join("");
    host.innerHTML =
      '<div class="pit-filters">' +
        '<div class="field"><label class="label">Property</label><select class="input" id="cm_prop" style="min-width:260px" onchange="PegIntel._cm()"><option value="">— pick a property —</option>' + opts + "</select></div>" +
        '<div class="field"><label class="label">Target loan ($)</label><input class="input" id="cm_loan" style="width:130px" placeholder="3400000" oninput="PegIntel._cm()"></div>' +
        '<div class="field"><label class="label">Profile</label><select class="input" id="cm_profile" onchange="PegIntel._cm()"><option value="">unknown</option><option>stabilized</option><option>value_add</option></select></div>' +
      "</div>" +
      '<div id="cmOut">' + empty("Pick a property (and optionally adjust the target loan) to screen the researched lender programs.") + "</div>";
  }
  function _cm() {
    var pid = gv("cm_prop");
    var host = document.getElementById("cmOut");
    if (!pid) { host.innerHTML = empty("Pick a property to screen lender programs."); return; }
    var p = (CACHE.properties || []).find(function (x) { return x.id === pid; }) || {};
    var loan = numOr(gv("cm_loan"));
    if (loan == null && p.asking_price) loan = Math.round(p.asking_price * 0.65);
    host.innerHTML = matchUI(p, loan);
  }
  function matchUI(p, loanAmount) {
    if (loanAmount == null) return empty("Enter a target loan amount — the property has no asking price to derive one from.");
    var ltv = p.asking_price ? (loanAmount / p.asking_price) * 100 : null;
    var dscr = null;
    if (p.noi && loanAmount) {
      var debtService = loanAmount * 0.075; // screening assumption, stated below
      dscr = p.noi / debtService;
    }
    var m = A.matchPrograms(CACHE.programs || [], { loanAmount: loanAmount, ltvPct: ltv, dscr: dscr, profile: gv("cm_profile") || null });
    function col(title, items, showWhy) {
      return '<div class="pit-match-col"><h4>' + title + " (" + items.length + ")</h4>" +
        (items.length ? items.map(function (x) {
          var g = x.program;
          return '<div class="pit-match-card"><b style="color:var(--text)">' + esc(g.lender_name_snapshot) + "</b>" + (g.program_name ? " · " + esc(g.program_name) : "") +
            '<div class="pit-meta">' + money(g.min_loan) + "–" + money(g.max_loan) + " · LTV ≤ " + pct(g.max_ltv_pct) + (g.min_dscr ? " · DSCR ≥ " + g.min_dscr : "") + (g.rate_guidance ? " · " + esc(g.rate_guidance) : "") + "</div>" +
            (showWhy && (x.reasons.length || x.soft.length) ? '<div class="why">' + esc((x.reasons.concat(x.soft)).join("; ")) + "</div>" : "") +
            '<div style="margin-top:5px">' + conf(g.confidence) + " " + srcLink(g.source_url, g.last_verified_at) + "</div></div>";
        }).join("") : '<div class="pit-empty" style="padding:12px">None</div>') + "</div>";
    }
    return '<div class="pit-import-sum"><span class="chip">Target loan <b>' + money(loanAmount) + "</b></span>" +
      (ltv != null ? '<span class="chip">Implied LTV <b>' + ltv.toFixed(1) + "%</b> (vs asking)</span>" : "") +
      (dscr != null ? '<span class="chip">Screening DSCR <b>' + dscr.toFixed(2) + "</b> (NOI ÷ 7.5% debt constant)</span>" : "") + "</div>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">' +
      col("Fits", m.fits, false) + col("Possible fits", m.possible, true) + col("Gaps", m.gaps, true) + "</div>" +
      '<div class="pit-note">Deterministic screen against your researched program terms — NOT an approval or a quote. Lender terms change; always confirm directly with the lender. The DSCR shown is a screening estimate using a 7.5% annual debt constant, not underwriting.</div>';
  }

  /* ═══ 7. IMPORT CENTER ═══ */
  var IMP = { preview: null, resolutions: {} };
  async function renderImport(host) {
    var batches = await A.listBatches().catch(function () { return []; });
    host.innerHTML =
      '<div class="pit-grid2"><div>' +
        '<div class="pit-panel"><h3>Upload the daily workbook</h3>' +
          '<div class="pit-drop" id="pitDrop" onclick="document.getElementById(\'pitFile\').click()">Drop the .xlsx here or click to choose<br><span style="font-size:11px">Max 4MB · .xlsx only · no macros · values only (no formulas)</span></div>' +
          '<input type="file" id="pitFile" accept=".xlsx" style="display:none" onchange="PegIntel.pickFile(this)">' +
          '<div id="pitImpOut"></div>' +
        "</div>" +
        '<div class="pit-panel"><h3>Template</h3><div class="pit-note" style="margin:0">The importer and the template are generated from the same contract. Use <b>Download Import Template</b> (top of the page) and keep the sheet names and headers unchanged. Full field documentation: docs/CAPITAL-INTELLIGENCE-IMPORT.md.</div></div>' +
      "</div><div>" +
        '<div class="pit-panel"><h3>Import history</h3>' +
        (batches.length ? batches.map(function (b) {
          var s = b.summary || {};
          return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(b.filename) + "</b>" +
            '<div class="pit-meta">' + esc(dt(b.created_at)) + " · +" + (s.insert || 0) + " new · " + (s.update || 0) + " updated · " + (s.conflict || 0) + " conflicts · " + (s.invalid || 0) + " invalid</div></span>" +
            '<span class="pit-conf ' + (b.status === "committed" ? "Verified" : b.status === "failed" || b.status === "rejected" ? "Unknown" : "Reported") + '">' + esc(b.status) + "</span>" +
            (b.status === "previewed" ? '<button class="btn btn-ghost btn-sm" onclick="PegIntel.reopenBatch(\'' + b.id + '\')">Review</button>' : "") +
            (b.status === "committed" ? '<button class="btn btn-ghost btn-sm" onclick="PegIntel.rollback(\'' + b.id + '\')">Roll back</button>' : "") +
            '<button class="btn btn-ghost btn-sm" onclick="PegIntel.errorReport(\'' + b.id + '\')">Report</button>' +
          "</div>";
        }).join("") : empty("No imports yet.")) + "</div>" +
      "</div></div>";
    var drop = document.getElementById("pitDrop");
    if (drop) {
      ["dragover", "dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.toggle("over", ev === "dragover");
          if (ev === "drop" && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
      });
    }
  }
  function pickFile(input) {
    var out = document.getElementById("pitImpOut"); if (out) out.innerHTML = ""; // clear any stale error the moment a new file is chosen
    var f = input.files && input.files[0];
    input.value = ""; // reset so re-selecting the same file still fires onchange
    if (f) handleFile(f);
  }
  async function handleFile(file, force) {
    var out = document.getElementById("pitImpOut");
    if (!/\.xlsx$/i.test(file.name)) { out.innerHTML = '<div class="pit-invalid">Only .xlsx files are accepted.</div>'; return; }
    if (file.size > 4 * 1048576) { out.innerHTML = '<div class="pit-invalid">File exceeds the 4MB limit.</div>'; return; }
    out.innerHTML = '<div class="pit-empty">Validating and building the preview…</div>';
    try {
      var b64 = await new Promise(function (res, rej) {
        var rd = new FileReader();
        rd.onload = function () { res(String(rd.result).split(",")[1]); };
        rd.onerror = rej; rd.readAsDataURL(file);
      });
      var r = await A.importPreview(file.name, b64, !!force);
      IMP.preview = r; IMP.resolutions = {};
      drawPreview(out, r);
    } catch (e) {
      var p = e.payload || {};
      if (p.error === "duplicate file") {
        out.innerHTML = '<div class="pit-invalid">' + esc((p.details || [])[0] || "Duplicate file.") + "</div>" +
          '<button class="btn btn-ghost btn-sm" onclick="PegIntel.forceFile()">Import anyway (force)</button>';
        IMP.lastFile = file;
      } else {
        out.innerHTML = '<div class="pit-invalid">' + esc(e.message) + (p.details ? "<br>" + p.details.map(esc).join("<br>") : "") + "</div>";
      }
    }
  }
  function forceFile() { if (IMP.lastFile) handleFile(IMP.lastFile, true); }
  async function reopenBatch(batchId) {
    var out = document.getElementById("pitImpOut");
    out.innerHTML = '<div class="pit-empty">Loading batch…</div>';
    try {
      var r = await A.importBatch(batchId);
      var s = (r.batch && r.batch.summary) || {};
      IMP.preview = { batch_id: batchId, summary: s,
        conflicts: (r.rows || []).filter(function (x) { return x.proposed_action === "conflict"; }).map(function (x) { return { row_id: x.id, sheet: x.sheet_name, row: x.row_number, key: x.dedupe_key, errors: x.validation_errors, changes: x.after_data }; }),
        invalid: (r.rows || []).filter(function (x) { return x.proposed_action === "invalid"; }).map(function (x) { return { sheet: x.sheet_name, row: x.row_number, errors: x.validation_errors }; }),
        rows: r.rows };
      IMP.resolutions = {};
      drawPreview(out, IMP.preview);
    } catch (e) { out.innerHTML = '<div class="pit-invalid">' + esc(e.message) + "</div>"; }
  }
  function drawPreview(out, r) {
    var s = r.summary || {};
    function chip(n, l) { return '<span class="chip"><b>' + (n || 0) + "</b> " + l + "</span>"; }
    var conflictRows = (r.rows ? r.rows.filter(function (x) { return x.proposed_action === "conflict"; }) : null);
    var conflictsHtml = "";
    var confl = conflictRows || [];
    if (!conflictRows && (s.conflict || 0) > 0) {
      conflictsHtml = '<div class="pit-note">Loading conflict details…</div>';
      A.importBatch(r.batch_id, "conflict").then(function (br) {
        IMP.preview.rows = br.rows;
        drawPreview(out, Object.assign({}, r, { rows: br.rows }));
      }).catch(function () {});
    } else if (confl.length) {
      conflictsHtml = confl.map(function (x) {
        return '<div class="pit-conflict"><div class="k">' + esc(x.sheet_name) + " · row " + x.row_number + " · " + esc(x.dedupe_key || "") + "</div>" +
          '<div>' + (x.validation_errors || []).map(esc).join("<br>") + "</div>" +
          '<div class="pit-meta">incoming: ' + esc(JSON.stringify(x.after_data || {})).slice(0, 220) + "</div>" +
          '<div class="choices"><label><input type="radio" name="res_' + x.id + '" checked onchange="PegIntel.resolve(\'' + x.id + '\',null)"> Skip (decide later)</label>' +
          '<label><input type="radio" name="res_' + x.id + '" onchange="PegIntel.resolve(\'' + x.id + '\',\'keep\')"> Keep existing</label>' +
          '<label><input type="radio" name="res_' + x.id + '" onchange="PegIntel.resolve(\'' + x.id + '\',\'apply\')"> Apply incoming</label></div></div>';
      }).join("");
    }
    var invalids = (r.invalid || []).map(function (x) {
      return '<div class="pit-invalid">' + esc(x.sheet) + " · row " + x.row + " — " + (x.errors || []).map(esc).join("; ") + "</div>";
    }).join("");
    out.innerHTML =
      '<div class="pit-import-sum">' + chip(s.insert, "new") + chip(s.update, "updates") + chip(s.unchanged, "unchanged") + chip(s.conflict, "conflicts") + chip(s.invalid, "invalid") + "</div>" +
      (invalids ? "<h4 style='font-size:12px;margin:10px 0 6px'>Invalid rows (will be skipped)</h4>" + invalids : "") +
      (conflictsHtml ? "<h4 style='font-size:12px;margin:10px 0 6px'>Conflicts — your call</h4>" + conflictsHtml : "") +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn btn-pri" onclick="PegIntel.commit()">Approve & Commit</button>' +
        '<button class="btn btn-ghost" onclick="PegIntel.reject()">Reject batch</button>' +
      "</div>" +
      '<div class="pit-note">Commit is transactional — either the batch applies cleanly or nothing changes. Verified data is never overwritten by lower-confidence values unless you explicitly choose “Apply incoming”.</div>';
  }
  function resolve(rowId, val) { if (val) IMP.resolutions[rowId] = val; else delete IMP.resolutions[rowId]; }
  async function commit() {
    if (!IMP.preview) return;
    var out = document.getElementById("pitImpOut");
    out.innerHTML = '<div class="pit-empty">Committing…</div>';
    try {
      var r = await A.importCommit(IMP.preview.batch_id, IMP.resolutions);
      toast(true, "Import committed", "+" + (r.inserted || 0) + " new · " + (r.updated || 0) + " updated · " + (r.skipped || 0) + " skipped");
      CACHE.properties = null; CACHE.programs = null; IMP.preview = null;
      nav("import");
    } catch (e) { out.innerHTML = '<div class="pit-invalid">' + esc(e.message) + "</div>"; }
  }
  async function reject() {
    if (!IMP.preview) return;
    try { await A.rejectBatch(IMP.preview.batch_id); toast(true, "Batch rejected", "Nothing was applied."); IMP.preview = null; nav("import"); }
    catch (e) { toast(false, "Could not reject", e.message); }
  }
  async function rollback(batchId) {
    if (!window.confirm("Roll back this import? Records it created are removed and prior values restored. Allowed only for the most recent committed batch, and only if nothing was modified since.")) return;
    try {
      var r = await A.importRollback(batchId);
      if (r.ok) { toast(true, "Rolled back", (r.deleted || 0) + " removed · " + (r.restored || 0) + " restored"); CACHE.properties = null; CACHE.programs = null; nav("import"); }
      else toast(false, "Rollback refused", r.error || "");
    } catch (e) { toast(false, "Rollback refused", e.message); }
  }
  async function errorReport(batchId) {
    try {
      var r = await A.importBatch(batchId);
      csvExport("pegasus-import-report-" + batchId.slice(0, 8) + ".csv",
        ["Sheet", "Row", "Target", "Action", "Status", "Key", "Errors"],
        (r.rows || []).map(function (x) { return [x.sheet_name, x.row_number, x.target_type, x.proposed_action, x.status, x.dedupe_key, (x.validation_errors || []).join("; ")]; }));
    } catch (e) { toast(false, "Could not build report", e.message); }
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

  /* ═══ 8. DATA QUALITY ═══ */
  async function renderQuality(host) {
    var d = await A.dataQuality();
    var sch = d.schema || {};
    var schemaHtml = sch.ok
      ? '<div class="pit-row"><span class="grow">All intelligence tables, RPCs, CRM columns, and the private bucket are in place.</span><span class="pit-conf Verified">healthy</span></div>'
      : '<div class="pit-invalid">Schema incomplete — apply migrations 067–070.' +
        (sch.missing_tables && sch.missing_tables.length ? "<br>Missing tables: " + sch.missing_tables.map(esc).join(", ") : "") +
        (sch.missing_rpcs && sch.missing_rpcs.length ? "<br>Missing RPCs: " + sch.missing_rpcs.map(esc).join(", ") : "") +
        (sch.missing_crm_columns && sch.missing_crm_columns.length ? "<br>Missing CRM columns: " + sch.missing_crm_columns.map(esc).join(", ") : "") +
        (sch.private_bucket_ok === false ? "<br>Private bucket missing." : "") + (sch.error ? "<br>" + esc(sch.error) : "") + "</div>";
    var dist = d.confidenceDist || {};
    var distHtml = ["Verified", "Reported", "Estimated", "Unknown", "unset"].map(function (k) {
      return '<span class="chip">' + (k === "unset" ? "No confidence set" : k) + " <b>" + (dist[k] || 0) + "</b></span>";
    }).join("");
    function list(title, rows, line, sub) {
      return '<div class="pit-panel"><h3>' + title + " (" + rows.length + ")</h3>" +
        (rows.length ? rows.map(line).join("") : empty("None — clean.", sub || "")) + "</div>";
    }
    host.innerHTML = '<div class="pit-panel"><h3>Schema health</h3>' + schemaHtml + "</div>" +
      '<div class="pit-panel"><h3>Confidence distribution — properties</h3><div class="pit-import-sum" style="margin:0">' + distHtml + "</div></div>" +
      '<div class="pit-grid2"><div>' +
      list("Properties missing critical fields", d.missingCritical, function (p) {
        var miss = [p.asking_price == null && "asking price", p.noi == null && "NOI", p.occupancy_pct == null && "occupancy"].filter(Boolean).join(", ");
        return clickRow(p.id, '<span class="grow">' + esc(p.property_name || p.address_line1) + '</span><span class="pit-meta">' + esc(miss) + "</span>");
      }) +
      list("Properties without any linked contact", d.propsNoContacts, function (p) {
        return clickRow(p.id, '<span class="grow">' + esc(p.property_name || p.address_line1) + '</span><span class="pit-meta">' + esc(p.city || "") + "</span>");
      }) +
      "</div><div>" +
      list("Stale lender terms (90+ days unverified)", d.stalePrograms, function (g) {
        return '<div class="pit-row"><span class="grow">' + esc(g.lender_name_snapshot) + (g.program_name ? " · " + esc(g.program_name) : "") + '</span><span class="pit-stale">' + (g.last_verified_at ? "verified " + esc(dt(g.last_verified_at)) : "never verified") + "</span></div>";
      }) +
      list("Loans missing source or maturity basis", d.loansNoBasis, function (l) {
        return '<div class="pit-row"><span class="grow">' + esc(l.lender_name_snapshot || "lender ?") + " · matures " + esc(dt(l.maturity_date)) + '</span><span class="pit-meta">' + [(l.maturity_basis ? null : "no basis"), (l.source_url ? null : "no source")].filter(Boolean).join(" · ") + "</span></div>";
      }) +
      list("Unresolved import conflicts", d.conflicts, function (x) {
        var btn = CAP.canImport ? '<button class="btn btn-ghost btn-sm" onclick="PegIntel.reopenFromQuality(\'' + x.batch_id + '\')">Review</button>' : '<span class="pit-meta">admin resolves</span>';
        return '<div class="pit-row"><span class="grow">' + esc(x.sheet_name) + " row " + x.row_number + " · " + esc(x.dedupe_key || "") + '</span>' + btn + "</div>";
      }, "Conflicts appear when an import would overwrite higher-confidence data.") +
      "</div></div>";
  }
  function reopenFromQuality(batchId) { nav("import"); setTimeout(function () { reopenBatch(batchId); }, 300); }

  window.PegIntel = {
    mount: mount, nav: nav, openProperty: openProperty, detTab: detTab,
    _rowKey: _rowKey, closeProperty: closeProperty,
    propertyModal: propertyModal, saveProperty: savePropertyUI,
    scoreModal: scoreModal, saveScore: saveScore, _scoreSum: _scoreSum,
    uploadDoc: uploadDoc, openDoc: openDoc, actionDone: actionDone,
    _f: _f, _sort: _sort, exportProps: exportProps,
    _lf: _lf, programModal: programModal, saveProgram: saveProgramUI,
    _cm: _cm, pickFile: pickFile, forceFile: forceFile, resolve: resolve,
    commit: commit, reject: reject, rollback: rollback, errorReport: errorReport,
    reopenBatch: reopenBatch, reopenFromQuality: reopenFromQuality,
    downloadTemplate: downloadTemplate,
  };
})();
