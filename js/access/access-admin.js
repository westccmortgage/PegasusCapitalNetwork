/* ============================================================================
 * Pegasus Access System — Admin Console
 * js/access/access-admin.js
 *
 * window.PegAccessAdmin.render(container)
 *
 * Admins read/write access_codes directly (RLS allows via is_admin_user()).
 * Provides: create code, list with usage analytics, deactivate toggle, and a
 * per-code redemptions view (who joined through each code).
 * ========================================================================== */
(function () {
  "use strict";
  var A = (window.PegAccessAdmin = window.PegAccessAdmin || {});

  var TIERS = ["starter", "pro", "gold"];
  var FLOWS = ["growth_partner", "growth_capital", "priority", "default"];
  var SOURCES = ["LinkedIn", "Ambassador", "Pegasus Events", "Growth Capital", "Organic", "PegasusPrivateNetwork", "Partner Campaign"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  A.render = async function (container) {
    if (!container) return;
    container.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text2);font-size:13px">Loading access system…</div>';

    var sb;
    try { sb = await window.PegSB.ready; }
    catch (e) { container.innerHTML = '<div class="banner bn-cancel"><div class="banner-msg">🔴 <span>Supabase unavailable.</span></div></div>'; return; }

    async function load() {
      var codesRes = await sb.from("access_codes").select("*").order("created_at", { ascending: false });
      if (codesRes.error) {
        container.innerHTML = '<div class="banner bn-cancel"><div class="banner-msg">⚑ <span>Could not load access_codes — run 013_access_system.sql in Supabase. (' + esc(codesRes.error.message) + ')</span></div></div>';
        return;
      }
      var codes = codesRes.data || [];
      var redRes = await sb.from("code_redemptions").select("code,membership_tier,redeemed_at,user_id").order("redeemed_at", { ascending: false });
      var reds = (redRes && redRes.data) || [];

      var totalRedemptions = reds.length;
      var activeCodes = codes.filter(function (c) { return c.active; }).length;

      var html = "";
      // Summary stats
      html += '<div class="grid g4" style="margin-bottom:18px">' +
        stat("◆", codes.length, "Total Codes", "var(--blue)") +
        stat("●", activeCodes, "Active", "var(--green)") +
        stat("→", totalRedemptions, "Redemptions", "var(--teal)") +
        stat("★", SOURCES.length, "Tracked Sources", "var(--gold)") +
        "</div>";

      // ── Grant Access panel — manual admin upgrade for any member ────────
      // Calls admin_grant_member_access RPC. Same membership/subscription
      // writes as access-code redemption, source='admin_grant'.
      html += '<div class="card" style="margin-bottom:18px;border:1px solid var(--border)">'+
        '<div class="card-head"><div class="card-title">Grant Member Access</div>'+
        '<span style="font-size:11px;color:var(--text3);font-family:var(--mono)">manual upgrade · admin_grant</span></div>'+
        '<div class="card-body">'+
          '<div class="grid g4" style="gap:10px;align-items:end">'+
            field("ag-search", "Search member (name or email)", '<input class="input" id="ag-search" placeholder="anatoliy@... or Anatoliy K..." autocomplete="off">')+
            field("ag-tier",   "Tier",           sel("ag-tier", TIERS.map(function(t){ return [t, window.PegAccess ? window.PegAccess.tierLabel(t) : t]; })))+
            field("ag-dur",    "Duration (days)", '<input class="input" id="ag-dur" type="number" value="90" min="1">')+
            field("ag-note",   "Internal note",   '<input class="input" id="ag-note" placeholder="Reason / context (optional)">')+
          '</div>'+
          '<div id="ag-results" style="margin-top:10px;font-size:12px"></div>'+
          '<div id="ag-selected" style="margin-top:10px;display:none;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;font-size:12px"></div>'+
          '<div id="ag-msg" style="font-size:11px;font-family:var(--mono);min-height:14px;margin:10px 0;color:var(--text2)"></div>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-ghost btn-sm" id="ag-search-btn">Search</button>'+
            '<button class="btn btn-pri" id="ag-grant-btn" disabled>Grant Access</button>'+
          '</div>'+
        '</div></div>';

            // Create form
      html += '<div class="card" style="margin-bottom:18px"><div class="card-head"><div class="card-title">Create Invitation Code</div></div><div class="card-body">' +
        '<div class="grid g4" style="gap:10px;align-items:end">' +
        field("ac-code", "Code", '<input class="input" id="ac-code" placeholder="LINKEDIN30" style="text-transform:uppercase">') +
        field("ac-source", "Source", sel("ac-source", SOURCES.map(function (s) { return [s, s]; }))) +
        field("ac-tier", "Membership Tier", sel("ac-tier", TIERS.map(function (t) { return [t, window.PegAccess ? window.PegAccess.tierLabel(t) : t]; }))) +
        field("ac-dur", "Duration (days)", '<input class="input" id="ac-dur" type="number" value="30" min="1">') +
        '</div><div class="grid g4" style="gap:10px;align-items:end;margin-top:10px">' +
        field("ac-flow", "Onboarding Flow", sel("ac-flow", FLOWS.map(function (f) { return [f, f.replace(/_/g, " ")]; }))) +
        field("ac-limit", "Usage Limit (blank = unlimited)", '<input class="input" id="ac-limit" type="number" placeholder="∞" min="1">') +
        field("ac-exp", "Expires (optional)", '<input class="input" id="ac-exp" type="date">') +
        field("ac-notes", "Notes", '<input class="input" id="ac-notes" placeholder="Campaign note">') +
        '</div>' +
        '<div id="ac-msg" style="font-size:11px;font-family:var(--mono);min-height:14px;margin:10px 0;color:var(--text2)"></div>' +
        '<button class="btn btn-pri" id="ac-create">Create Code</button>' +
        '</div></div>';

      // Codes table
      if (!codes.length) {
        html += '<div class="card" style="padding:28px;text-align:center;color:var(--text2);font-size:13px">No invitation codes yet. Create one above.</div>';
      } else {
        html += '<div class="card"><table class="tbl"><thead><tr>' +
          ["Code", "Source", "Tier", "Duration", "Usage", "Onboarding", "Status", ""].map(function (h) { return "<th>" + h + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          codes.map(function (c) {
            var usage = c.usage_count + (c.usage_limit != null ? " / " + c.usage_limit : " / ∞");
            var expired = c.expires_at && new Date(c.expires_at) < new Date();
            var statusChip = !c.active ? '<span class="badge b-cancel">inactive</span>' :
              expired ? '<span class="badge b-cancel">expired</span>' : '<span class="badge b-active">active</span>';
            var toggle = '<button class="btn btn-ghost btn-sm" data-toggle="' + esc(c.id) + '" data-active="' + (c.active ? "1" : "0") + '">' + (c.active ? "Deactivate" : "Activate") + "</button>";
            var view = '<button class="btn btn-ghost btn-sm" data-view="' + esc(c.code) + '">Who joined →</button>';
            return "<tr>" +
              "<td><span style='font-family:var(--mono);font-weight:600'>" + esc(c.code) + "</span></td>" +
              "<td>" + esc(c.source) + "</td>" +
              "<td>" + esc(window.PegAccess ? window.PegAccess.tierLabel(c.membership_tier) : c.membership_tier) + "</td>" +
              "<td>" + esc(c.duration_days) + "d</td>" +
              "<td style='font-family:var(--mono)'>" + esc(usage) + "</td>" +
              "<td style='font-size:11px;color:var(--text2)'>" + esc((c.onboarding_flow || "").replace(/_/g, " ")) + "</td>" +
              "<td>" + statusChip + "</td>" +
              "<td style='white-space:nowrap'>" + view + " " + toggle + "</td>" +
              "</tr>";
          }).join("") +
          "</tbody></table></div>";
      }

      html += '<div id="ac-redemptions" style="margin-top:16px"></div>';
      container.innerHTML = html;

      // Wire create
      var createBtn = document.getElementById("ac-create");
      if (createBtn) createBtn.onclick = async function () {
        var msg = document.getElementById("ac-msg");
        var code = (document.getElementById("ac-code").value || "").trim().toUpperCase();
        if (!code) { msg.style.color = "var(--red)"; msg.textContent = "Code is required."; return; }
        var row = {
          code: code,
          source: document.getElementById("ac-source").value,
          type: "invitation",
          membership_tier: document.getElementById("ac-tier").value,
          duration_days: parseInt(document.getElementById("ac-dur").value, 10) || 30,
          onboarding_flow: document.getElementById("ac-flow").value,
          notes: (document.getElementById("ac-notes").value || "").trim() || null,
          active: true,
        };
        var lim = parseInt(document.getElementById("ac-limit").value, 10);
        if (!isNaN(lim) && lim > 0) row.usage_limit = lim;
        var exp = document.getElementById("ac-exp").value;
        if (exp) row.expires_at = new Date(exp + "T23:59:59").toISOString();
        try { var u = (await sb.auth.getUser()).data.user; if (u) row.created_by = u.id; } catch (_) {}

        createBtn.disabled = true; createBtn.textContent = "Creating…";
        var ins = await sb.from("access_codes").insert(row);
        createBtn.disabled = false; createBtn.textContent = "Create Code";
        if (ins.error) {
          msg.style.color = "var(--red)";
          msg.textContent = /duplicate|unique/i.test(ins.error.message) ? "That code already exists." : ins.error.message;
          return;
        }
        load(); // refresh
      };

      // Wire toggles
      [].forEach.call(container.querySelectorAll("[data-toggle]"), function (btn) {
        btn.onclick = async function () {
          var id = btn.getAttribute("data-toggle");
          var newActive = btn.getAttribute("data-active") !== "1";
          btn.disabled = true;
          await sb.from("access_codes").update({ active: newActive, updated_at: new Date().toISOString() }).eq("id", id);
          load();
        };
      });

      // Wire "who joined"
      [].forEach.call(container.querySelectorAll("[data-view]"), function (btn) {
        btn.onclick = function () {
          var code = btn.getAttribute("data-view");
          var rows = reds.filter(function (r) { return r.code === code; });
          var box = document.getElementById("ac-redemptions");
          if (!rows.length) { box.innerHTML = '<div class="card" style="padding:18px;color:var(--text2);font-size:12px">No redemptions yet for <b>' + esc(code) + "</b>.</div>"; return; }
          box.innerHTML = '<div class="card"><div class="card-head"><div class="card-title">Joined through ' + esc(code) + " · " + rows.length + "</div></div><table class=\"tbl\"><thead><tr><th>User</th><th>Tier Granted</th><th>When</th></tr></thead><tbody>" +
            rows.map(function (r) {
              return "<tr><td style='font-family:var(--mono);font-size:11px'>" + esc((r.user_id || "").slice(0, 8)) + "…</td><td>" + esc(window.PegAccess ? window.PegAccess.tierLabel(r.membership_tier) : r.membership_tier) + "</td><td>" + esc(new Date(r.redeemed_at).toLocaleDateString()) + "</td></tr>";
            }).join("") +
            "</tbody></table></div>";
          box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
      });
    }

    /* Grant Access panel — wired after the HTML is in the DOM */
    function wireGrantHandlers() {
      var searchInput = document.getElementById("ag-search");
      var searchBtn   = document.getElementById("ag-search-btn");
      var grantBtn    = document.getElementById("ag-grant-btn");
      var resultsBox  = document.getElementById("ag-results");
      var selectedBox = document.getElementById("ag-selected");
      var msgBox      = document.getElementById("ag-msg");
      var tierSel     = document.getElementById("ag-tier");
      var durInput    = document.getElementById("ag-dur");
      var noteInput   = document.getElementById("ag-note");
      if (!searchBtn || !grantBtn) return;
      var selectedUser = null;

      function setMsg(kind, text) {
        if (!msgBox) return;
        var color = kind === "success" ? "var(--green)" : kind === "error" ? "#a02323" : "var(--text2)";
        msgBox.style.color = color;
        msgBox.textContent = text || "";
      }

      async function doSearch() {
        var q = (searchInput.value || "").trim();
        if (q.length < 2) { setMsg("error", "Enter at least 2 characters"); return; }
        setMsg("info", "Searching…");
        resultsBox.innerHTML = "";
        try {
          var res = await sb.from("profiles")
            .select("id,full_name,email,role")
            .or("full_name.ilike.%" + q + "%,email.ilike.%" + q + "%")
            .limit(10);
          if (res.error) { setMsg("error", res.error.message); return; }
          var rows = res.data || [];
          if (!rows.length) { setMsg("info", "No members found"); resultsBox.innerHTML = ""; return; }
          setMsg("info", rows.length + " result(s) — click one to select");
          resultsBox.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">' +
            rows.map(function(r){
              return '<div data-uid="' + esc(r.id) + '" class="ag-result" ' +
                'style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px">' +
                '<strong>' + esc(r.full_name || "(no name)") + '</strong> · ' + esc(r.email || "—") +
                ' · <span style="color:var(--text3);font-family:var(--mono)">' + esc(r.role || "—") + '</span>' +
                '</div>';
            }).join("") + '</div>';
          Array.prototype.forEach.call(resultsBox.querySelectorAll(".ag-result"), function(node){
            node.addEventListener("click", function(){
              var uid = node.getAttribute("data-uid");
              var match = rows.filter(function(r){ return r.id === uid; })[0];
              if (!match) return;
              selectedUser = match;
              selectedBox.style.display = "block";
              selectedBox.innerHTML = 'Selected: <strong>' + esc(match.full_name || "(no name)") +
                '</strong> · ' + esc(match.email || "—") +
                ' · <code style="font-family:var(--mono);font-size:11px">' + esc(uid.slice(0,8)) + '…</code>';
              grantBtn.disabled = false;
              setMsg("info", "Ready to grant. Choose tier, duration, then click Grant Access.");
            });
          });
        } catch (e) { setMsg("error", e.message); }
      }

      async function doGrant() {
        if (!selectedUser) { setMsg("error", "Select a member first"); return; }
        var tier = tierSel.value;
        var dur  = parseInt(durInput.value, 10);
        var note = (noteInput.value || "").trim() || null;
        if (!tier || !dur || dur < 1) { setMsg("error", "Tier and duration required"); return; }
        grantBtn.disabled = true; grantBtn.textContent = "Granting…";
        setMsg("info", "Calling admin_grant_member_access…");
        try {
          var res = await sb.rpc("admin_grant_member_access", {
            p_user_id: selectedUser.id,
            p_tier: tier,
            p_duration_days: dur,
            p_note: note
          });
          if (res.error) { setMsg("error", res.error.message); return; }
          var out = res.data || {};
          if (!out.ok) { setMsg("error", "Grant failed: " + (out.reason || "unknown")); return; }
          var until = out.access_expires_at ? new Date(out.access_expires_at).toLocaleDateString() : "—";
          setMsg("success", "Granted " + (out.tier || tier).toUpperCase() + " access to " +
                 (selectedUser.full_name || selectedUser.email) + " until " + until + ".");
          selectedUser = null; selectedBox.style.display = "none"; selectedBox.innerHTML = "";
          resultsBox.innerHTML = ""; searchInput.value = ""; noteInput.value = "";
          try { if (window.Pegasus && Pegasus.toast) Pegasus.toast("✓", "var(--green)", "Access granted",
              (out.tier || tier).toUpperCase() + " until " + until); } catch(_) {}
        } catch (e) { setMsg("error", e.message); }
        finally { grantBtn.textContent = "Grant Access"; }
      }

      searchBtn.addEventListener("click", doSearch);
      searchInput.addEventListener("keydown", function(e){ if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
      grantBtn.addEventListener("click", doGrant);
    }

    /* Wire grant handlers each time load() refreshes the DOM. */
    var _origLoad = load;
    load = async function() { await _origLoad.apply(this, arguments); wireGrantHandlers(); };
    wireGrantHandlers();

    load();
  };

  function stat(ic, v, l, color) {
    return '<div class="stat" style="--accent:' + color + '"><div class="stat-ic">' + ic + '</div><div class="stat-v">' + v + '</div><div class="stat-l">' + l + "</div></div>";
  }
  function field(id, label, inner) {
    return '<div class="field" style="margin:0"><label class="label" for="' + id + '">' + label + "</label>" + inner + "</div>";
  }
  function sel(id, pairs) {
    return '<select class="input" id="' + id + '">' + pairs.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + "</option>"; }).join("") + "</select>";
  }
})();
