/* ============================================================================
   PEGASUS — Universal Import Mapper UI (shared)  window.PegMapper

   One workflow for both Capital Intelligence and California Partner Network:
     Upload → Detect → Map → Normalize → Preview → Resolve → Commit
   Driven by an api adapter so records never cross modules.

   PegMapper.open({ module, moduleLabel, api, onDone })
     api needs: mapPreview(payload), importCommit(batchId, resolutions),
                listImportProfiles(), saveImportProfile(row)
   ============================================================================ */
(function () {
  "use strict";
  var esc = function (s) { return window.Pegasus.esc(s == null ? "" : s); };
  var S = null;

  function toast(ok, t, m) { window.Pegasus.toast(ok ? "✓" : "!", ok ? "var(--green-dim)" : "var(--gold-dim)", t, m || ""); }
  function fileToB64(file) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onload = function () { res(String(rd.result).split(",")[1]); };
      rd.onerror = function () { rej(new Error("could not read file")); };
      rd.readAsDataURL(file);
    });
  }
  function shell(inner) {
    return '<div class="sce-scrim" onclick="if(event.target===this)PegMapper.close()"><div class="sce-modal" style="max-width:940px">' +
      '<div class="sce-head"><div class="sce-title">Universal Import — ' + esc(S.label) + '</div><button class="sce-x" onclick="PegMapper.close()" aria-label="Close">✕</button></div>' +
      '<div class="sce-body" style="max-height:80vh;overflow-y:auto" id="pmBody">' + inner + "</div></div></div>";
  }
  function render(inner) {
    var b = document.getElementById("pmBody");
    if (b) b.innerHTML = inner; else window.Pegasus.modal(shell(inner));
  }

  function open(opts) {
    S = { api: opts.api, module: opts.module, label: opts.moduleLabel || opts.module, onDone: opts.onDone,
      onNative: opts.onNative || null, file: null,
      step: "upload", fileB64: null, filename: null, detect: null, sheets: [], entityFields: {}, profiles: [], override: false, batch: null, forceReview: false, native: false };
    window.Pegasus.modal(shell(uploadView()));
  }
  // Open the mapper on a file already chosen in the Import Center (the primary
  // upload path routes every file through here before strict validation).
  function openWithFile(file, opts) {
    open(opts);
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) { err("Only .xlsx or .csv files are accepted."); return; }
    S.filename = file.name; S.file = file;
    render('<div class="pit-empty">Uploading · Reading workbook · Detecting sheets…</div>');
    fileToB64(file).then(function (b64) { S.fileB64 = b64; return detect(); }).catch(function (e) { render(uploadView()); err(e.message); });
  }
  function close() { window.Pegasus.closeModal(); S = null; }

  /* ── Step 1: upload ── */
  function uploadView() {
    return '<div class="pit-note" style="margin:0 0 12px">Upload a reasonable CSV or XLSX from any source (ChatGPT research, a LinkedIn export, a DRE download, a legacy CRM). The mapper detects each sheet’s target, proposes column mappings, and normalizes values before anything is written. Max 4MB.</div>' +
      '<div class="pit-drop" id="pmDrop" onclick="document.getElementById(\'pmFile\').click()">Drop a .csv or .xlsx here or click to choose</div>' +
      '<input type="file" id="pmFile" accept=".xlsx,.csv" style="display:none" onchange="PegMapper.fileChosen(this)">' +
      '<div id="pmErr" class="pit-invalid" style="display:none;margin-top:10px"></div>';
  }
  function err(msg) { var e = document.getElementById("pmErr"); if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; } }
  async function fileChosen(input) {
    err(""); var f = input.files && input.files[0]; input.value = "";
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) { err("Only .xlsx or .csv files are accepted."); return; }
    render('<div class="pit-empty">Reading and detecting…</div>');
    try {
      S.filename = f.name; S.fileB64 = await fileToB64(f);
      await detect();
    } catch (e) { render(uploadView()); err(e.message); }
  }
  async function detect() {
    var r = await S.api.mapPreview({ filename: S.filename, file_base64: S.fileB64, override: S.override });
    // Native workbook → hand off to the module's strict native importer, which
    // handles every native sheet (the mapper models only a subset as entities).
    if (r.phase === "native") {
      if (S.onNative && S.file) { var f = S.file; var nat = S.onNative; close(); nat(f); return; }
      // No native handler wired — fall back to the mapper with a clear heads-up.
      S.override = true; render('<div class="pit-empty">Loading mapper…</div>'); return detect();
    }
    if (r.phase === "wrong_module") { S.step = "wrong"; renderWrong(r.wrong_module); return; }
    S.detect = r; S.sheets = r.sheets || []; S.entityFields = r.entityFields || {}; S.entities = r.entities || Object.keys(S.entityFields);
    try { S.profiles = await S.api.listImportProfiles(); } catch (_) { S.profiles = []; }
    // Auto-apply a matched saved profile if exactly one came back.
    if (r.profiles && r.profiles.length === 1) applyProfileMapping(r.profiles[0]);
    // Native fast-path: every sheet + column matches the native template exactly.
    var native = !S.forceReview && S.sheets.length > 0 && S.sheets.every(function (sh) {
      return sh.entity && sh.entityConfidence >= 0.85 &&
        (sh.columns || []).every(function (c) { return !c.target || c.confidence === 1; }) &&
        requiredMissing(sh).length === 0;
    });
    S.step = "map";
    if (native && !r.detected_profile) { S.native = true; render('<div class="pit-empty">Native Pegasus template detected — normalizing…</div>'); buildPreview(); return; }
    renderMap(r.profiles || []);
  }
  function reviewMapping() { S.forceReview = true; S.native = false; S.step = "map"; renderMap((S.detect && S.detect.profiles) || []); }

  /* ── Wrong-module guard ── */
  function renderWrong(w) {
    render('<div class="pit-conflict" style="border-color:rgba(200,74,58,.4);background:rgba(200,74,58,.06)">' +
      '<div style="font-size:13px;color:var(--text)">' + esc(w.message) + "</div></div>" +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<a class="btn btn-pri btn-sm" href="' + esc(w.route) + '">Open ' + esc(w.module_label) + "</a>" +
      '<button class="btn btn-ghost btn-sm" onclick="PegMapper.overrideWrong()">This is a generic contact file — import here anyway</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="PegMapper.back()">Choose another file</button></div>' +
      '<div class="pit-note">Override is intended only for generic contact lists where you pick the target entity manually.</div>');
  }
  async function overrideWrong() { S.override = true; render('<div class="pit-empty">Loading mapper…</div>'); try { await detect(); } catch (e) { err(e.message); } }
  function back() { S.step = "upload"; render(uploadView()); }

  /* ── Step 2: mapping editor ── */
  function confBadge(c) {
    var cls = c >= 0.85 ? "Verified" : c >= 0.6 ? "Reported" : c > 0 ? "Estimated" : "";
    var label = c >= 0.85 ? "high" : c >= 0.6 ? "medium" : c > 0 ? "low" : "—";
    return '<span class="pit-conf ' + cls + '">' + label + "</span>";
  }
  function renderMap(matchedProfiles) {
    var det = S.detect.detection || {};
    var wrongHint = det.wrongModule ? '<div class="pit-note" style="color:var(--amber)">Heads up: this file scores higher for ' + esc(det.otherLabel) + ' — proceed only if these are generic contacts.</div>' : "";
    var dp = S.detect.detected_profile;
    var profileHint = dp ? '<div class="pit-panel" style="border-color:var(--blue-dim);background:var(--blue-dim)"><b style="color:var(--text)">Detected profile: ' + esc(dp.name) + "</b> " + (dp.score ? '<span class="pit-meta">' + Math.round(dp.score * 100) + "% match</span>" : "") + "<div class=\"pit-note\" style=\"margin-top:4px\">Column mappings and value transforms below are pre-filled from this profile. Review and edit before committing.</div></div>" : "";
    var mappedCounts = '<div class="pit-import-sum" style="margin:0 0 12px">' + S.sheets.map(function (sh) {
      return '<span class="chip">' + esc((sh.entity || sh.sheet).replace(/_/g, " ")) + " <b>" + (sh.entity ? sh.rowCount : 0) + "</b> mapped</span>";
    }).join("") + "</div>";
    var profileBar =
      '<div class="pit-panel" style="margin-bottom:12px"><h3>Import profile</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="field" style="margin:0"><label class="label">Apply saved profile</label><select class="input" id="pmProfile" onchange="PegMapper.applyProfile()">' +
      '<option value="">— none —</option>' + (S.profiles || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field" style="margin:0"><label class="label">Save current mapping as</label><input class="input" id="pmProfName" placeholder="e.g. LinkedIn Agent Export"></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="PegMapper.saveProfile()">Save profile</button>' +
      (matchedProfiles && matchedProfiles.length ? '<span class="pit-meta">Matched: ' + matchedProfiles.map(function (p) { return esc(p.name); }).join(", ") + "</span>" : "") +
      "</div></div>";
    var body = S.sheets.map(function (sh, si) {
      var entOpts = '<option value="">(ignore this sheet)</option>' + (S.entities || []).map(function (e) { return '<option value="' + esc(e) + '"' + (sh.entity === e ? " selected" : "") + ">" + esc(e.replace(/_/g, " ")) + "</option>"; }).join("");
      var cols = sh.entity ? colTable(sh, si) : '<div class="pit-note">Choose a target entity to map this sheet’s columns.</div>';
      return '<div class="pit-panel" data-sheet="' + si + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div><b style="color:var(--text)">' + esc(sh.sheet) + '</b> <span class="pit-meta">' + sh.rowCount + " rows</span> " + confBadge(sh.entityConfidence) + "</div>" +
        '<div class="field" style="margin:0;min-width:220px"><label class="label">Target entity</label><select class="input pm-entity" data-sheet="' + si + '" onchange="PegMapper.entityChange(' + si + ')">' + entOpts + "</select></div></div>" +
        '<div id="pmCols' + si + '">' + cols + "</div></div>";
    }).join("");
    render(wrongHint + profileHint + mappedCounts + profileBar + body +
      '<div id="pmErr" class="pit-invalid" style="display:none;margin:8px 0"></div>' +
      '<div class="pm-sticky" style="display:flex;gap:8px;margin-top:8px;position:sticky;bottom:0;background:var(--bg1);padding:8px 0"><button class="btn btn-pri" onclick="PegMapper.buildPreview()">Build normalized preview</button>' +
      '<button class="btn btn-ghost" onclick="PegMapper.back()">Start over</button></div>');
  }
  function colTable(sh, si) {
    var fields = S.entityFields[sh.entity] || [];
    var targetOpts = function (sel) {
      return '<option value="">(ignore)</option>' + fields.map(function (f) { return '<option value="' + esc(f.target) + '"' + (sel === f.target ? " selected" : "") + ">" + esc(f.target.replace(/_/g, " ")) + (f.required ? " *" : "") + "</option>"; }).join("");
    };
    var rows = (sh.columns || []).map(function (c, ci) {
      var fld = fields.find(function (f) { return f.target === c.target; });
      return "<tr><td class=\"strong\" data-label=\"Source\">" + esc(c.source) + '</td>' +
        '<td data-label="Target"><label class="sr-only">Map ' + esc(c.source) + '</label><select class="input pm-col" aria-label="Target field for ' + esc(c.source) + '" data-sheet="' + si + '" data-src="' + esc(c.source) + '" data-idx="' + (c.sourceIndex != null ? c.sourceIndex : ci) + '">' + targetOpts(c.target || "") + "</select></td>" +
        '<td data-label="Confidence">' + confBadge(c.confidence || 0) + "</td>" +
        '<td class="pit-meta" data-label="Samples">' + esc((c.samples || []).join(", ")).slice(0, 60) + "</td>" +
        '<td class="pit-meta" data-label="Transform">' + (fld && fld.transform ? esc(fld.transform) : (c.valueMap ? "value map" : "—")) + "</td>" +
        '<td data-label="Req">' + (fld && fld.required ? '<span class="pit-conf Estimated">required</span>' : '<span class="pit-meta">optional</span>') + "</td></tr>";
    }).join("");
    var missing = requiredMissing(sh);
    return '<div class="pit-table-wrap"><table class="pit-table" style="min-width:720px"><thead><tr><th class="noclick">Source column</th><th class="noclick">Target field</th><th class="noclick">Confidence</th><th class="noclick">Samples</th><th class="noclick">Transform</th><th class="noclick">Req</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="pit-note">Map two source columns to the same field to <b>combine</b> them (e.g. First + Last → Full Name). ' + (missing.length ? '<span style="color:var(--amber)">Unmapped required: ' + missing.map(esc).join(", ") + "</span>" : "All required fields mapped.") + "</div>";
  }
  function requiredMissing(sh) {
    var fields = S.entityFields[sh.entity] || [];
    var mapped = {}; (sh.columns || []).forEach(function (c) { if (c.target) mapped[c.target] = 1; });
    return fields.filter(function (f) { return f.required && !mapped[f.target]; }).map(function (f) { return f.target; });
  }
  // Sync the in-memory sheet columns from the DOM selects.
  function syncFromDom() {
    S.sheets.forEach(function (sh, si) {
      var entSel = document.querySelector('.pm-entity[data-sheet="' + si + '"]');
      sh.entity = entSel ? entSel.value : sh.entity;
      var sels = document.querySelectorAll('.pm-col[data-sheet="' + si + '"]');
      if (sels.length) {
        sh.columns = Array.prototype.map.call(sels, function (s) {
          return { source: s.getAttribute("data-src"), sourceIndex: Number(s.getAttribute("data-idx")), target: s.value || null, ignored: !s.value };
        });
      }
    });
  }
  function entityChange(si) {
    syncFromDom();
    var sh = S.sheets[si];
    // Re-suggest column targets for the newly chosen entity (client-side, alias-based).
    if (sh.entity) sh.columns = clientAutoMap(sh);
    var host = document.getElementById("pmCols" + si);
    if (host) host.innerHTML = sh.entity ? colTable(sh, si) : '<div class="pit-note">Choose a target entity to map this sheet’s columns.</div>';
  }
  function normH(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function clientAutoMap(sh) {
    var fields = S.entityFields[sh.entity] || [];
    var used = {};
    return (sh.columns || []).map(function (c) {
      var h = normH(c.source), best = null;
      fields.forEach(function (f) {
        var score = 0;
        f.aliases.forEach(function (a) { if (a === h) score = Math.max(score, 1); else if (a && (a.indexOf(h) >= 0 || h.indexOf(a) >= 0) && Math.min(a.length, h.length) >= 3) score = Math.max(score, 0.8); });
        if (!best || score > best.score) best = { score: score, target: f.target };
      });
      var target = best && best.score >= 0.6 && !used[best.target] ? best.target : null;
      if (target) used[target] = 1;
      return { source: c.source, sourceIndex: c.sourceIndex, target: target, confidence: target ? best.score : 0, samples: c.samples };
    });
  }

  function applyProfile() {
    var sel = document.getElementById("pmProfile"); if (!sel || !sel.value) return;
    var p = (S.profiles || []).find(function (x) { return x.id === sel.value; });
    if (p) { applyProfileMapping(p); renderMap([]); document.getElementById("pmProfile") && (document.getElementById("pmProfile").value = p.id); }
  }
  function applyProfileMapping(p) {
    var m = p.mapping || {}; var bySheet = {}; (m.sheets || []).forEach(function (ms) { bySheet[normH(ms.sheet)] = ms; });
    S.sheets.forEach(function (sh) {
      var ms = bySheet[normH(sh.sheet)] || (m.sheets || []).find(function (x) { return true; }); // fall back to first if single-sheet
      if (!ms) return;
      sh.entity = ms.entity || sh.entity;
      if (ms.columns && ms.columns.length) {
        sh.columns = (sh.columns || []).map(function (c) {
          var mc = ms.columns.find(function (x) { return normH(x.source) === normH(c.source) || x.sourceIndex === c.sourceIndex; });
          return mc ? { source: c.source, sourceIndex: c.sourceIndex, target: mc.target || null, confidence: c.confidence, samples: c.samples } : c;
        });
      }
    });
    S.appliedProfile = p;
  }
  async function saveProfile() {
    syncFromDom();
    var nameEl = document.getElementById("pmProfName"); var name = nameEl ? nameEl.value.trim() : "";
    if (!name) { err("Enter a profile name to save."); return; }
    var mapping = collectMapping();
    var fps = S.sheets.map(function (sh) { return fingerprint(sh.headers); });
    var hints = S.sheets.map(function (sh) { return sh.sheet; });
    try {
      var row = { name: name, mapping: mapping, mapping_version: 1, fingerprints: fps, sheet_name_hints: hints };
      var saved = await S.api.saveImportProfile(row);
      S.profiles.push(saved); toast(true, "Profile saved", name); renderMap([]);
    } catch (e) { err("Could not save profile: " + e.message); }
  }
  function fingerprint(headers) { return (headers || []).map(normH).filter(Boolean).sort().join("|"); }

  function collectMapping() {
    syncFromDom();
    return { mapping_version: S.appliedProfile ? (S.appliedProfile.mapping_version || 1) : 1,
      sheets: S.sheets.filter(function (sh) { return sh.entity; }).map(function (sh) {
        return { sheet: sh.sheet, entity: sh.entity,
          columns: (sh.columns || []).filter(function (c) { return c.target; }).map(function (c) { return { source: c.source, sourceIndex: c.sourceIndex, target: c.target }; }),
          constants: sh.constants || [] };
      }) };
  }

  /* ── Step 3: preview ── */
  async function buildPreview() {
    syncFromDom();
    var mapping = collectMapping();
    if (!mapping.sheets.length) { err("Map at least one sheet to a target entity."); return; }
    // Block if any mapped sheet is missing required fields.
    var missing = [];
    S.sheets.forEach(function (sh) { if (sh.entity) requiredMissing(sh).forEach(function (m) { missing.push(sh.sheet + ": " + m); }); });
    if (missing.length) { err("Map required fields before preview — " + missing.join(", ")); return; }
    render('<div class="pit-empty">Normalizing and building preview…</div>');
    try {
      var r = await S.api.mapPreview({ filename: S.filename, file_base64: S.fileB64, mapping: mapping, profile_id: (S.appliedProfile && S.appliedProfile.id) || null, override: S.override });
      if (!r.ok || r.phase !== "preview") { S.step = "map"; renderMap([]); err(r.error || "preview failed"); return; }
      S.preview = r; S.resolutions = {}; S.step = "preview"; renderPreview();
    } catch (e) { S.step = "map"; renderMap([]); err((e && e.message) || "preview failed"); }
  }
  function renderPreview() {
    var r = S.preview, s = r.summary || {}, q = r.quality || {};
    function chip(n, l) { return '<span class="chip"><b>' + (n || 0) + "</b> " + l + "</span>"; }
    var blocking = (q.missingRequired || []).length;
    var nativeBadge = S.native ? '<div class="pit-panel" style="border-color:var(--green-dim);background:var(--green-dim)"><b style="color:var(--text)">Native Pegasus template detected</b> — mapping skipped. <a href="#" onclick="PegMapper.reviewMapping();return false" style="color:var(--blue)">Review mapping</a></div>' : "";
    var dp = r.detected_profile ? '<div class="pit-note">Import profile: <b style="color:var(--text)">' + esc(r.detected_profile.name) + "</b></div>" : "";
    var ec = r.entity_counts || {};
    var perEntity = Object.keys(ec).length ? '<div class="pit-grid2">' + Object.keys(ec).map(function (e) {
      var c = ec[e];
      return '<div class="pit-panel"><h3>' + esc(e.replace(/_/g, " ")) + "</h3><div class=\"pit-import-sum\" style=\"margin:0\">" + chip(c.new, "new") + chip(c.updated, "updated") + chip(c.unchanged, "unchanged") + chip(c.conflict, "conflicts") + chip(c.invalid, "invalid") + "</div></div>";
    }).join("") + "</div>" : "";
    var html = nativeBadge + dp + '<div class="pit-import-sum">' + chip(s.insert, "new") + chip(s.update, "updates") + chip(s.unchanged, "unchanged") + chip(s.conflict, "conflicts") + chip(s.invalid, "invalid") + "</div>" + perEntity;
    html += '<div class="pit-note">Batch ' + esc(r.batch_id) + " · provenance (original file, sheet, row, raw JSON, profile) retained for every row.</div>";
    function block(title, arr, fmt, warn) {
      if (!arr || !arr.length) return "";
      return '<div class="pit-panel"><h3>' + title + " (" + arr.length + ")</h3>" + arr.slice(0, 40).map(fmt).join("") + "</div>";
    }
    html += block("Missing required values — BLOCKING", q.missingRequired, function (x) { return '<div class="pit-invalid">' + esc(x.sheet) + " row " + x.row + " — " + esc(x.error) + "</div>"; });
    html += block("Invalid enum values", q.invalidEnum, function (x) { return '<div class="pit-invalid">' + esc(x.sheet) + " row " + x.row + " — " + esc(x.error) + "</div>"; });
    html += block("Invalid emails", q.invalidEmail, function (x) { return '<div class="pit-conflict"><div class="k">' + esc(x.sheet) + " row " + x.row + "</div>" + esc(x.value) + "</div>"; });
    html += block("Invalid phones", q.invalidPhone, function (x) { return '<div class="pit-conflict"><div class="k">' + esc(x.sheet) + " row " + x.row + "</div>" + esc(x.value) + "</div>"; });
    html += block("Possible duplicates — review (never auto-merged)", r.fuzzy_duplicates, function (x) { return '<div class="pit-conflict"><div class="k">' + esc(x.sheet) + " row " + x.row + '</div>"' + esc(x.name) + '" looks like existing "' + esc(x.candidate) + '" (' + x.score + ")</div>"; });
    html += block("Transform warnings", r.transform_warnings, function (x) { return '<div class="pit-note">' + esc(x.sheet) + " row " + x.row + " — " + esc(x.message) + "</div>"; });
    html += block("Invalid rows (skipped)", r.invalid, function (x) { return '<div class="pit-invalid">' + esc(x.sheet) + " row " + x.row + " — " + (x.errors || []).map(esc).join("; ") + "</div>"; });
    // conflicts with resolution radios
    if ((r.conflicts || []).length) {
      html += '<div class="pit-panel"><h3>Conflicts — your call (' + r.conflicts.length + ")</h3>" + r.conflicts.map(function (c, i) {
        return '<div class="pit-conflict"><div class="k">' + esc(c.sheet) + " row " + c.row + " · " + esc(c.key || "") + "</div>" +
          (c.errors && c.errors.length ? "<div>" + c.errors.map(esc).join("; ") + "</div>" : "") + "</div>";
      }).join("") + '<div class="pit-note">Unresolved conflicts are skipped (safe). Reopen the batch in the Import Center to resolve individually.</div></div>';
    }
    html += '<div id="pmErr" class="pit-invalid" style="display:none;margin:8px 0"></div>';
    html += '<div style="display:flex;gap:8px;margin-top:10px">' +
      (blocking ? '<button class="btn btn-pri" disabled title="Resolve missing required values first">Approve & Commit</button>' : '<button class="btn btn-pri" onclick="PegMapper.commit()">Approve & Commit</button>') +
      '<button class="btn btn-ghost" onclick="PegMapper.back()">Back to mapping</button></div>' +
      (blocking ? '<div class="pit-note" style="color:var(--amber)">Commit is blocked until required values are provided (fix the source file or remap).</div>' : '<div class="pit-note">Commit is transactional — the whole batch applies or nothing changes.</div>');
    render(html);
  }
  async function commit() {
    render('<div class="pit-empty">Committing…</div>');
    try {
      var r = await S.api.importCommit(S.preview.batch_id, S.resolutions || {});
      if (r && r.ok) { toast(true, "Import committed", "+" + (r.inserted || 0) + " new · " + (r.updated || 0) + " updated · " + (r.skipped || 0) + " skipped"); var done = S.onDone; close(); if (done) done(); }
      else { S.step = "preview"; renderPreview(); err((r && r.error) || "commit failed"); }
    } catch (e) { S.step = "preview"; renderPreview(); err((e && e.message) || "commit failed"); }
  }

  window.PegMapper = {
    open: open, openWithFile: openWithFile, close: close, fileChosen: fileChosen, back: back,
    overrideWrong: overrideWrong, entityChange: entityChange, applyProfile: applyProfile,
    saveProfile: saveProfile, buildPreview: buildPreview, commit: commit, reviewMapping: reviewMapping,
  };
})();
