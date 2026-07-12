/* ============================================================================
   PEGASUS CALIFORNIA PARTNER NETWORK — Enrichment + Outreach Approval UI
   window.PegPartnerX — rendered inside the Partner Network admin (pit-* styles).

   PART 1  Enrichment: run a background job, review proposed public fields
           (source URL + confidence + last-verified required), accept/reject/
           edit / accept-all-high-confidence, commit with Verified protection.
   PART 2  Outreach Approval: draft → approve → open-in-LinkedIn (manual send).
           No automatic connect/send. Full audit trail. Do-Not-Contact blocks.
   ============================================================================ */
(function () {
  "use strict";
  var esc = function (s) { return window.Pegasus.esc(s == null ? "" : s); };
  function A() { return window.PegPartnerAPI; }
  function toast(ok, t, m) { window.Pegasus.toast(ok ? "✓" : "!", ok ? "var(--green-dim)" : "var(--gold-dim)", t, m || ""); }
  function gv(id) { var e = document.getElementById(id); return e ? (e.value || "").trim() : ""; }
  function dt(d) { if (!d) return "—"; var x = new Date(d); return isNaN(x) ? "—" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function empty(m, s) { return '<div class="pit-empty">' + esc(m) + (s ? '<br><span style="font-size:11px">' + esc(s) + "</span>" : "") + "</div>"; }
  function conf(c) { return c ? '<span class="pit-conf ' + esc(c) + '">' + esc(c) + "</span>" : '<span class="pit-conf">—</span>'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t || ""); } catch (_) {}
    try { var ta = document.createElement("textarea"); ta.value = t || ""; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } catch (_) {}
    return Promise.resolve();
  }
  var CACHE = { jobs: null, prospects: null, entities: {}, refresh: null };
  function bind(refresh) { CACHE.refresh = refresh; }

  /* ═══════════════ PART 1 — ENRICHMENT ═══════════════ */
  async function renderEnrichment(host) {
    CACHE.jobs = await A().listEnrichmentJobs();
    var jobs = CACHE.jobs;
    var byStatus = {}; jobs.forEach(function (j) { byStatus[j.status] = (byStatus[j.status] || 0) + 1; });
    function tile(n, l, cls) { return '<div class="pit-tile ' + (cls || "") + '"><div class="n">' + (n || 0) + '</div><div class="l">' + esc(l) + "</div></div>"; }
    host.innerHTML =
      '<div class="pit-note" style="margin:0 0 12px">Run enrichment to gather <b>public business information</b> for an imported Agent, Escrow/Title contact, or Company. Enrichment never guesses licenses, emails or phones — every proposed field needs a source URL, confidence and last-verified date, and you review each before commit.</div>' +
      '<div class="pit-tiles">' + tile(byStatus.queued, "Queued") + tile(byStatus.researching, "Researching") + tile(byStatus.review_ready, "Review Ready", byStatus.review_ready ? "good" : "") + tile(byStatus.approved, "Approved") + tile(byStatus.failed, "Failed", byStatus.failed ? "hot" : "") + "</div>" +
      '<div class="pit-head-actions"><button class="btn btn-pri btn-sm" onclick="PegPartnerX.newEnrichment()">Run enrichment</button></div>' +
      '<div class="pit-panel"><h3>Enrichment jobs</h3>' +
      (jobs.length ? jobs.map(function (j) {
        var st = j.status === "review_ready" ? "Reported" : j.status === "approved" ? "Verified" : (j.status === "failed" || j.status === "rejected") ? "Unknown" : "Estimated";
        return '<div class="pit-row"><span class="grow"><b style="color:var(--text)">' + esc(j.entity_name || j.entity_id) + "</b> <span class=\"pit-meta\">· " + esc(j.entity_type.replace("_", " ")) + "</span></span>" +
          '<span class="pit-conf ' + st + '">' + esc(j.status.replace(/_/g, " ")) + "</span><span class=\"pit-meta\">" + esc(dt(j.created_at)) + "</span>" +
          (j.status === "review_ready" ? '<button class="btn btn-ghost btn-sm" onclick="PegPartnerX.review(\'' + j.id + '\')">Review</button>' :
            j.status === "approved" ? '<button class="btn btn-ghost btn-sm" onclick="PegPartnerX.review(\'' + j.id + '\')">View</button>' : "") + "</div>";
      }).join("") : empty("No enrichment jobs yet.", "Choose a record and run enrichment.")) + "</div>";
  }
  async function newEnrichment() {
    var inner = '<div class="field"><label class="label">Entity type</label><select class="input" id="enType" onchange="PegPartnerX.enSearch()"><option value="agent">Agent</option><option value="escrow_title">Escrow / Title</option><option value="company">Company</option></select></div>' +
      '<div class="field"><label class="label">Search a record by name</label><input class="input" id="enQ" oninput="PegPartnerX.enSearch()" placeholder="Type a name…"></div>' +
      '<div id="enResults" style="max-height:280px;overflow-y:auto"></div>';
    window.Pegasus.modal(shell("Run enrichment", inner, '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Close</button>'));
    enSearch();
  }
  async function enSearch() {
    var type = gv("enType"), q = gv("enQ").toLowerCase();
    var table = { agent: "pn_agents", escrow_title: "pn_escrow_title", company: "pn_companies" }[type];
    var nameCol = { agent: "full_name", escrow_title: "officer_name", company: "company_name" }[type];
    if (!CACHE.entities[type]) { var c = await window.PegSB.ready; var r = await c.from(table).select("id," + nameCol + ",company_name_snapshot,data_confidence").limit(1000); CACHE.entities[type] = r.error ? [] : (r.data || []); }
    var rows = CACHE.entities[type].filter(function (x) { return !q || String(x[nameCol] || "").toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
    var host = document.getElementById("enResults"); if (!host) return;
    host.innerHTML = rows.length ? rows.map(function (x) {
      return '<div class="pit-row"><span class="grow">' + esc(x[nameCol] || "—") + "</span>" + conf(x.data_confidence) + '<button class="btn btn-ghost btn-sm" onclick="PegPartnerX.runFor(\'' + type + '\',\'' + x.id + '\')">Run</button></div>';
    }).join("") : empty("No matching records.");
  }
  async function runFor(type, id) {
    window.Pegasus.closeModal();
    toast(true, "Enrichment queued…", "Researching public information");
    try { var r = await A().enrichmentRun({ entity_type: type, entity_id: id }); if (r.ok) { if (CACHE.refresh) CACHE.refresh(); review(r.job.id); } }
    catch (e) { toast(false, "Could not run enrichment", e.message); }
  }
  async function review(jobId) {
    var job = (CACHE.jobs || []).find(function (j) { return j.id === jobId; });
    var fields = await A().enrichmentFields(jobId);
    var readOnly = job && job.status === "approved";
    var rows = fields.map(function (f, i) {
      var cur = f.current_value == null ? "" : f.current_value;
      var appliedTag = f.status === "applied" ? '<span class="pit-conf Verified">applied</span>' : f.status === "skipped_conflict" ? '<span class="pit-conf Estimated">conflict</span>' : f.status === "rejected" ? '<span class="pit-meta">rejected</span>' : "";
      if (readOnly) {
        return "<tr><td class=\"strong\" data-label=\"Field\">" + esc(f.label || f.target_field) + '</td><td data-label="Current">' + esc(cur) + '</td><td data-label="Proposed">' + esc(f.proposed_value || "—") + "</td><td>" + conf(f.confidence) + "</td><td>" + appliedTag + "</td></tr>";
      }
      var confOpts = ["", "Verified", "Reported", "Estimated", "Unknown"].map(function (o) { return "<option" + (f.confidence === o ? " selected" : "") + ">" + o + "</option>"; }).join("");
      return "<tr data-fid=\"" + f.id + "\">" +
        '<td class="strong" data-label="Field">' + esc(f.label || f.target_field) + '<div class="pit-meta">current: ' + esc(cur || "—") + "</div></td>" +
        '<td data-label="Proposed value"><input class="input enx-val" data-fid="' + f.id + '" value="' + esc(f.proposed_value || "") + '" placeholder="public value (leave blank to skip)"></td>' +
        '<td data-label="Source URL"><input class="input enx-src" data-fid="' + f.id + '" value="' + esc(f.source_url || "") + '" placeholder="https://…"></td>' +
        '<td data-label="Confidence"><select class="input enx-conf" data-fid="' + f.id + '">' + confOpts + "</select></td>" +
        '<td data-label="Verified"><input class="input enx-date" data-fid="' + f.id + '" type="date" value="' + esc(f.last_verified_date || "") + '"></td>' +
        '<td data-label="Decision">' +
          '<label style="font-size:11px"><input type="radio" name="enx_' + f.id + '" value="accept" class="enx-dec" data-fid="' + f.id + '"> accept</label> ' +
          '<label style="font-size:11px"><input type="radio" name="enx_' + f.id + '" value="reject" class="enx-dec" data-fid="' + f.id + '"> reject</label>' +
        "</td></tr>";
    }).join("");
    var head = readOnly
      ? "<tr><th class=\"noclick\">Field</th><th class=\"noclick\">Current</th><th class=\"noclick\">Proposed</th><th class=\"noclick\">Conf</th><th class=\"noclick\">Result</th></tr>"
      : "<tr><th class=\"noclick\">Field</th><th class=\"noclick\">Proposed value</th><th class=\"noclick\">Source URL</th><th class=\"noclick\">Conf</th><th class=\"noclick\">Verified</th><th class=\"noclick\">Decision</th></tr>";
    var footer = readOnly ? '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Close</button>'
      : '<button class="btn btn-ghost" onclick="PegPartnerX.acceptHighConf(\'' + jobId + '\')">Accept all high-confidence</button>' +
        '<button class="btn btn-ghost" onclick="PegPartnerX.rejectJob(\'' + jobId + '\')">Reject job</button>' +
        '<button class="btn btn-pri" onclick="PegPartnerX.commit(\'' + jobId + '\')">Commit approved</button>';
    var inner = '<div class="pit-note" style="margin:0 0 10px">Review each proposed public field. A value requires a source URL and confidence. Verified data is never overwritten by lower-confidence values. Blank values never erase existing data.</div>' +
      '<div id="enxErr" class="pit-invalid" style="display:none;margin-bottom:8px"></div>' +
      '<div class="pit-table-wrap"><table class="pit-table" style="min-width:820px"><thead>' + head + "</thead><tbody id=\"enxBody\">" + (rows || "<tr><td>" + esc("No fields.") + "</td></tr>") + "</tbody></table></div>";
    window.Pegasus.modal(shellWide((job ? (job.entity_name || "Enrichment") : "Enrichment") + " — Review Enrichment", inner, footer));
  }
  function acceptHighConf(jobId) {
    document.querySelectorAll("#enxBody tr[data-fid]").forEach(function (tr) {
      var fid = tr.getAttribute("data-fid");
      var val = tr.querySelector(".enx-val"); var cf = tr.querySelector(".enx-conf");
      if (val && val.value.trim() && cf && (cf.value === "Verified" || cf.value === "Reported")) {
        var r = tr.querySelector('.enx-dec[value="accept"]'); if (r) r.checked = true;
      }
    });
    toast(true, "High-confidence fields selected", "Review, then Commit approved.");
  }
  async function commit(jobId) {
    var decisions = {}; var e = document.getElementById("enxErr"); if (e) e.style.display = "none";
    var bad = null;
    document.querySelectorAll("#enxBody tr[data-fid]").forEach(function (tr) {
      var fid = tr.getAttribute("data-fid");
      var dec = tr.querySelector(".enx-dec:checked");
      if (!dec) return;
      if (dec.value === "reject") { decisions[fid] = { action: "reject" }; return; }
      var val = (tr.querySelector(".enx-val") || {}).value || "";
      var src = (tr.querySelector(".enx-src") || {}).value || "";
      var cf = (tr.querySelector(".enx-conf") || {}).value || "";
      var dte = (tr.querySelector(".enx-date") || {}).value || "";
      if (val.trim()) {
        if (!src.trim() || !/^https?:\/\//i.test(src.trim())) { bad = "Accepted field needs a valid source URL (http/https)."; return; }
        if (!cf) { bad = "Accepted field needs a confidence."; return; }
      }
      decisions[fid] = { action: "accept", value: val, source_url: src, confidence: cf, last_verified_date: dte || null };
    });
    if (bad) { if (e) { e.textContent = bad; e.style.display = "block"; } return; }
    try {
      var r = await A().enrichmentCommit(jobId, decisions);
      if (r.ok) { toast(true, "Enrichment applied", r.applied + " fields · " + (r.conflicts.length || 0) + " conflicts skipped"); window.Pegasus.closeModal(); if (CACHE.refresh) CACHE.refresh(); }
      else { if (e) { e.textContent = r.error || "commit failed"; e.style.display = "block"; } }
    } catch (err) { if (e) { e.textContent = err.message; e.style.display = "block"; } }
  }
  async function rejectJob(jobId) {
    try { var c = await window.PegSB.ready; await c.from("pn_enrichment_jobs").update({ status: "rejected", completed_at: new Date().toISOString() }).eq("id", jobId); toast(true, "Enrichment rejected"); window.Pegasus.closeModal(); if (CACHE.refresh) CACHE.refresh(); }
    catch (e) { toast(false, "Could not reject", e.message); }
  }

  /* ═══════════════ PART 2 — OUTREACH APPROVAL ═══════════════ */
  var LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/(in|company|pub)\/[^\s]+/i;
  var NOTE_MAX = 300;
  async function renderOutreach(host) {
    var mode = (await A().getSetting("linkedin_sending_mode")) || { mode: "manual" };
    CACHE.prospects = await A().listProspects();
    var ps = CACHE.prospects;
    function count(fn) { return ps.filter(fn).length; }
    var sentToday = count(function (p) { return p.status === "sent" && p.sent_at && String(p.sent_at).slice(0, 10) === today(); });
    var followDue = count(function (p) { return ["approved", "opened_in_linkedin", "sent", "connected", "follow_up_due"].indexOf(p.status) >= 0 && p.due_date && p.due_date <= today() && p.status !== "replied"; });
    function tile(n, l, cls) { return '<div class="pit-tile ' + (cls || "") + '"><div class="n">' + (n || 0) + '</div><div class="l">' + esc(l) + "</div></div>"; }
    var modeBanner = '<div class="pit-panel" style="border-color:var(--amber);background:rgba(201,162,39,.06)"><b style="color:var(--text)">Manual confirmation required.</b> Pegasus never auto-connects or auto-sends on LinkedIn. "Open LinkedIn" opens the profile and copies your approved note — you perform the final send.</div>';
    var modeSel = '<div class="pit-panel"><h3>LinkedIn sending mode</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<select class="input" id="lkMode" style="max-width:320px" onchange="PegPartnerX.setMode()">' +
      '<option value="manual"' + (mode.mode === "manual" ? " selected" : "") + '>Manual — open profile &amp; copy note (default)</option>' +
      '<option value="assisted"' + (mode.mode === "assisted" ? " selected" : "") + '>Assisted Browser Extension — human final send</option>' +
      '<option value="api" disabled>Official API — disabled (no approved API partnership configured)</option>' +
      "</select><span class=\"pit-meta\">The Official API mode stays disabled until approved LinkedIn Invitations API credentials + partnership are configured.</span></div></div>";
    host.innerHTML = modeBanner + modeSel +
      '<div class="pit-tiles">' +
        tile(count(function (p) { return p.status === "drafted"; }), "New / drafts") +
        tile(count(function (p) { return p.status === "ready_for_approval"; }), "Awaiting approval", count(function (p) { return p.status === "ready_for_approval"; }) ? "warn" : "") +
        tile(count(function (p) { return p.status === "approved"; }), "Approved", count(function (p) { return p.status === "approved"; }) ? "good" : "") +
        tile(sentToday, "Sent today") +
        tile(count(function (p) { return p.status === "replied"; }), "Replies", count(function (p) { return p.status === "replied"; }) ? "good" : "") +
        tile(followDue, "Follow-ups due", followDue ? "warn" : "") +
        tile(count(function (p) { return p.status === "do_not_contact"; }), "Do Not Contact", count(function (p) { return p.status === "do_not_contact"; }) ? "hot" : "") +
      "</div>" +
      '<div class="pit-head-actions"><button class="btn btn-pri btn-sm" onclick="PegPartnerX.prospectModal(null)">+ Prospect</button></div>' +
      '<div class="pit-panel"><h3>Outreach approval queue</h3>' +
      (ps.length ? ps.map(prospectRow).join("") : empty("No prospects yet.", "Add a prospect or promote an agent from your list.")) + "</div>";
  }
  function statusBadge(s) {
    var cls = s === "approved" || s === "connected" || s === "replied" ? "Verified" : s === "do_not_contact" || s === "not_interested" ? "Unknown" : s === "ready_for_approval" || s === "follow_up_due" ? "Estimated" : "Reported";
    return '<span class="pit-conf ' + cls + '">' + esc(s.replace(/_/g, " ")) + "</span>";
  }
  function prospectRow(p) {
    var dnc = p.status === "do_not_contact";
    var canApprove = p.status === "drafted" || p.status === "ready_for_approval";
    var canOpen = p.status === "approved" || p.status === "opened_in_linkedin";
    function b(label, fn, on) { return on ? '<button class="btn btn-ghost btn-sm" onclick="PegPartnerX.' + fn + '(\'' + p.id + '\')">' + label + "</button>" : ""; }
    return '<div class="pit-row" style="flex-wrap:wrap;align-items:flex-start">' +
      '<span class="grow"><b style="color:var(--text)">' + esc(p.name) + "</b>" + (p.title ? " <span class=\"pit-meta\">· " + esc(p.title) + "</span>" : "") + (p.company ? " <span class=\"pit-meta\">· " + esc(p.company) + "</span>" : "") +
      (p.partner_score != null ? ' <span class="pit-conf">score ' + esc(p.partner_score) + "</span>" : "") + " " + statusBadge(p.status) +
      (p.why_relevant ? '<div class="pit-meta">' + esc(p.why_relevant).slice(0, 120) + "</div>" : "") +
      (p.connection_note ? '<div class="pit-meta">note: ' + esc(p.connection_note).slice(0, 120) + "</div>" : "") +
      (p.due_date ? '<div class="pit-meta">follow-up ' + esc(dt(p.due_date)) + "</div>" : "") + "</span>" +
      '<span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' +
      b("Generate Draft", "generateDraft", !dnc && (p.status === "drafted")) +
      b("Edit", "prospectModal", !dnc) +
      b("Approve", "approve", !dnc && canApprove) +
      b("Reject", "reject", !dnc && (p.status === "ready_for_approval" || p.status === "approved")) +
      b("Open LinkedIn", "openLinkedIn", !dnc && canOpen) +
      b("Copy Note", "copyNote", !dnc && !!p.connection_note) +
      b("Mark Sent", "markSent", !dnc && (p.status === "opened_in_linkedin" || p.status === "approved")) +
      b("Mark Connected", "markConnected", !dnc && (p.status === "sent" || p.status === "opened_in_linkedin")) +
      b("Mark Replied", "markReplied", !dnc && (p.status === "connected" || p.status === "sent")) +
      b("Follow-up", "scheduleFollowup", !dnc) +
      b("Do Not Contact", "doNotContact", !dnc) +
      "</span></div>";
  }
  function find(id) { return (CACHE.prospects || []).find(function (p) { return p.id === id; }) || {}; }
  async function setStatus(id, status, extra, eventType, detail) {
    var p = find(id); var patch = Object.assign({ status: status }, extra || {});
    await A().saveProspect(id, patch);
    try { await A().prospectEvent({ prospect_id: id, event_type: eventType || "status_change", from_status: p.status, to_status: status, detail: detail || null }); } catch (_) {}
    if (CACHE.refresh) CACHE.refresh();
  }
  async function generateDraft(id) {
    var p = find(id); var first = String(p.name || "there").split(/\s+/)[0];
    var why = (p.why_relevant || "your work in the California market").replace(/\s+/g, " ").trim();
    var note = ("Hi " + first + " — " + why.charAt(0).toLowerCase() + why.slice(1) + ". Would love to connect.").slice(0, NOTE_MAX);
    var follow = "Thanks for connecting, " + first + ". " + (why.charAt(0).toUpperCase() + why.slice(1)) + " — open to a quick chat about how we partner with agents?";
    try { await A().saveProspect(id, { connection_note: note, follow_up_message: follow, status: p.status === "drafted" ? "drafted" : p.status }); await A().prospectEvent({ prospect_id: id, event_type: "generate_draft", to_status: p.status, detail: "note+follow-up drafted" }); toast(true, "Draft generated", "Review, then approve."); if (CACHE.refresh) CACHE.refresh(); }
    catch (e) { toast(false, "Could not draft", e.message); }
  }
  async function approve(id) {
    var p = find(id);
    if (p.connection_note && p.connection_note.length > NOTE_MAX) { toast(false, "Note too long", "Connection note must be ≤ " + NOTE_MAX + " characters."); return; }
    if (p.linkedin_url && !LINKEDIN_RE.test(p.linkedin_url)) { toast(false, "Invalid LinkedIn URL", "Use a linkedin.com profile URL."); return; }
    var c = await window.PegSB.ready; var u = await c.auth.getUser(); var uid = u && u.data && u.data.user && u.data.user.id;
    await setStatus(id, "approved", { approved_by: uid, approved_at: new Date().toISOString() }, "approve", "approved for outreach");
    toast(true, "Approved", "You can now open LinkedIn (manual send).");
  }
  async function reject(id) { await setStatus(id, "drafted", { approved_by: null, approved_at: null }, "reject", "un-approved / sent back to draft"); toast(true, "Rejected", "Returned to draft — not approved."); }
  async function openLinkedIn(id) {
    var p = find(id);
    if (p.status === "do_not_contact") { toast(false, "Do Not Contact", "Outreach is blocked for this prospect."); return; }
    if (p.status !== "approved" && p.status !== "opened_in_linkedin") { toast(false, "Approval required", "Approve the draft before opening LinkedIn."); return; }
    if (!p.linkedin_url || !LINKEDIN_RE.test(p.linkedin_url)) { toast(false, "Invalid LinkedIn URL", "Add a valid linkedin.com profile URL first."); return; }
    window.open(p.linkedin_url, "_blank", "noopener,noreferrer");
    await copyText(p.connection_note || "");
    await setStatus(id, "opened_in_linkedin", {}, "open_linkedin", "opened profile + copied note (manual send)");
    toast(true, "LinkedIn opened and message copied.", "Paste the note and send it yourself — Pegasus does not auto-send.");
  }
  async function copyNote(id) { var p = find(id); await copyText(p.connection_note || ""); try { await A().prospectEvent({ prospect_id: id, event_type: "copy_note", to_status: p.status }); } catch (_) {} toast(true, "Connection note copied."); }
  async function markSent(id) { await setStatus(id, "sent", { sent_at: new Date().toISOString() }, "mark_sent", "marked sent by admin"); toast(true, "Marked sent"); }
  async function markConnected(id) { await setStatus(id, "connected", { connected_at: new Date().toISOString() }, "mark_connected"); toast(true, "Marked connected"); }
  async function markReplied(id) { await setStatus(id, "replied", { replied_at: new Date().toISOString() }, "mark_replied"); toast(true, "Marked replied"); }
  async function doNotContact(id) { if (!window.confirm("Mark Do Not Contact? This blocks all outreach for this prospect.")) return; await setStatus(id, "do_not_contact", {}, "do_not_contact", "flagged do-not-contact"); toast(true, "Do Not Contact set"); }
  async function scheduleFollowup(id) {
    var p = find(id);
    var d = window.prompt("Follow-up date (YYYY-MM-DD):", p.due_date || today());
    if (!d) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast(false, "Invalid date", "Use YYYY-MM-DD."); return; }
    await setStatus(id, p.status === "do_not_contact" ? p.status : "follow_up_due", { due_date: d }, "schedule_followup", "follow-up " + d);
    toast(true, "Follow-up scheduled", dt(d));
  }
  function prospectModal(id) {
    var p = id ? find(id) : {};
    function f(label, fid, val, ph) { return '<div class="field"><label class="label">' + label + '</label><input class="input" id="pr_' + fid + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '"></div>'; }
    function ta(label, fid, val, ph, max) { return '<div class="field"><label class="label">' + label + (max ? ' <span class="pit-meta">(≤ ' + max + ")</span>" : "") + '</label><textarea class="ws-textarea" id="pr_' + fid + '"' + (max ? ' maxlength="' + max + '"' : "") + ' placeholder="' + esc(ph || "") + '">' + esc(val || "") + "</textarea></div>"; }
    var inner = '<div class="row2">' + f("Name *", "name", p.name) + f("Title", "title", p.title) + "</div>" +
      '<div class="row2">' + f("Company", "company", p.company) + f("Partner score", "score", p.partner_score) + "</div>" +
      f("LinkedIn URL", "url", p.linkedin_url, "https://www.linkedin.com/in/…") +
      ta("Why relevant", "why", p.why_relevant, "Public rationale") +
      ta("Public activity evidence", "act", p.activity_evidence, "Recent public activity") +
      ta("Connection note", "note", p.connection_note, "≤ 300 chars", NOTE_MAX) +
      ta("Follow-up message", "follow", p.follow_up_message) +
      f("Follow-up due date", "due", p.due_date, "YYYY-MM-DD");
    window.Pegasus.modal(shell((id ? "Edit" : "New") + " prospect", inner,
      '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button><button class="btn btn-pri" onclick="PegPartnerX.saveProspect(' + (id ? "'" + id + "'" : "null") + ')">' + (id ? "Save" : "Add") + "</button>"));
  }
  async function saveProspectUI(id) {
    var e = document.getElementById("pnErr");
    var name = gv("pr_name"); if (!name) { if (e) e.textContent = "Name is required."; return; }
    var url = gv("pr_url"); if (url && !LINKEDIN_RE.test(url)) { if (e) e.textContent = "LinkedIn URL must be a linkedin.com profile."; return; }
    var note = gv("pr_note"); if (note.length > NOTE_MAX) { if (e) e.textContent = "Connection note must be ≤ " + NOTE_MAX + " characters."; return; }
    var due = gv("pr_due"); if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) { if (e) e.textContent = "Follow-up date must be YYYY-MM-DD."; return; }
    var row = { name: name, title: gv("pr_title") || null, company: gv("pr_company") || null,
      partner_score: gv("pr_score") ? Number(gv("pr_score")) : null, linkedin_url: url || null,
      why_relevant: gv("pr_why") || null, activity_evidence: gv("pr_act") || null,
      connection_note: note || null, follow_up_message: gv("pr_follow") || null, due_date: due || null };
    if (!id) row.status = "drafted";
    try { await A().saveProspect(id, row); window.Pegasus.closeModal(); toast(true, id ? "Prospect saved" : "Prospect added", name); if (CACHE.refresh) CACHE.refresh(); }
    catch (err) { if (e) e.textContent = err.message; }
  }
  async function setMode() {
    var m = gv("lkMode") || "manual"; if (m === "api") { toast(false, "Official API unavailable", "Requires approved LinkedIn partnership."); return; }
    try { await A().setSetting("linkedin_sending_mode", { mode: m }); toast(true, "Sending mode saved", m === "assisted" ? "Assisted — human final send" : "Manual"); }
    catch (e) { toast(false, "Could not save mode", e.message); }
  }

  function shell(title, inner, footer) {
    return '<div class="sce-scrim" onclick="if(event.target===this)Pegasus.dismissModal()"><div class="sce-modal" style="max-width:640px">' +
      '<div class="sce-head"><div class="sce-title">' + esc(title) + '</div><button class="sce-x" onclick="Pegasus.closeModal()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:74vh;overflow-y:auto">' + inner + "</div>" +
      '<div class="sce-foot"><div id="pnErr" class="sce-err"></div>' + footer + "</div></div></div>";
  }
  function shellWide(title, inner, footer) {
    return '<div class="sce-scrim" onclick="if(event.target===this)Pegasus.dismissModal()"><div class="sce-modal" style="max-width:960px">' +
      '<div class="sce-head"><div class="sce-title">' + esc(title) + '</div><button class="sce-x" onclick="Pegasus.closeModal()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:78vh;overflow-y:auto">' + inner + "</div>" +
      '<div class="sce-foot" style="flex-wrap:wrap;gap:6px">' + footer + "</div></div></div>";
  }

  window.PegPartnerX = {
    bind: bind, renderEnrichment: renderEnrichment, renderOutreach: renderOutreach,
    newEnrichment: newEnrichment, enSearch: enSearch, runFor: runFor, review: review,
    acceptHighConf: acceptHighConf, commit: commit, rejectJob: rejectJob,
    prospectModal: prospectModal, saveProspect: saveProspectUI, generateDraft: generateDraft,
    approve: approve, reject: reject, openLinkedIn: openLinkedIn, copyNote: copyNote,
    markSent: markSent, markConnected: markConnected, markReplied: markReplied,
    doNotContact: doNotContact, scheduleFollowup: scheduleFollowup, setMode: setMode,
  };
})();
