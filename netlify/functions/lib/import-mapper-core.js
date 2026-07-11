// ============================================================================
// PEGASUS — Universal Import Mapper (shared engine, pure logic, no I/O)
// netlify/functions/lib/import-mapper-core.js
//
// A module-agnostic front end that lets admins upload reasonable external
// CSV/XLSX files and map them into a module's canonical schema WITHOUT the
// source file using Pegasus headers. It:
//   • detects the likely target entity per sheet (with confidence),
//   • auto-maps source columns to target fields (alias + fuzzy),
//   • normalizes user-facing values into internal enums,
//   • builds canonical rows shaped EXACTLY like the module's native workbook,
//   • and hands them to that module's EXISTING planner (dedupe / conflict /
//     confidence / atomic commit / edit-aware rollback / provenance).
//
// The engine never mixes modules: everything is driven by a per-module
// "descriptor" (see import-mapper-schemas.js). It shares only parsing,
// OOXML/namespace header normalization, detection, alias matching, transforms,
// validation, and provenance shaping — never records.
//
// Security is unchanged: file-level checks (extension/signature/size/macro/
// formula) run on the ORIGINAL upload in the caller; this engine only reshapes
// already-extracted rows.
// ============================================================================
"use strict";

const icore = require("./intelligence-import-core.js");
const normHeader = icore.normHeader; // OOXML namespace + whitespace normalization

// ── String similarity (0..1) for fuzzy column + value matching ───────────────
function tokens(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function similarity(a, b) {
  const na = normHeader(a), nb = normHeader(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.86;
  // token Jaccard
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  if (ta.size && tb.size) {
    let inter = 0; ta.forEach((t) => { if (tb.has(t)) inter++; });
    const jac = inter / (ta.size + tb.size - inter);
    if (jac >= 0.5) return 0.6 + jac * 0.25;
  }
  // Levenshtein ratio on the normalized strings
  const dist = levenshtein(na, nb);
  const ratio = 1 - dist / Math.max(na.length, nb.length);
  return ratio;
}

// ── Value transforms (enum coercion) ─────────────────────────────────────────
function normPriorityLabel(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  if (Number.isFinite(n) && String(v).match(/\d/)) return n >= 1 ? Math.round(n) : null;
  const s = String(v).trim().toLowerCase();
  if (/^(a|high|urgent|top|hot|p1|priority ?1)$/.test(s)) return 1;
  if (/^(b|med(ium)?|normal|warm|p2|priority ?2)$/.test(s)) return 2;
  if (/^(c|low|later|cold|p3|priority ?3)$/.test(s)) return 3;
  return null;
}
const SIGNAL_MAP = [
  [/(recent sale|buyer closing|closed (transaction|deal)|just (sold|closed)|sold)/, "closed_deal"],
  [/(new listing|just listed|listed)/, "new_listing"],
  [/(price (cut|reduction|change|drop)|reduced|reduction)/, "price_change"],
  [/(joined (team|company)|changed brokerage|moved brokerage|moved to|new brokerage)/, "brokerage_change"],
  [/(joined team|new team|team move)/, "team_move"],
  [/(award|ranking|ranked|top producer|honou?r)/, "award"],
  [/(article|announcement|press|news|feature)/, "news"],
  [/(social|instagram|linkedin post|facebook|tweet|post)/, "social"],
  [/(license (change|update)|renewed license)/, "license_change"],
  [/(marketing|campaign|ad|advert)/, "marketing"],
];
function normSignalLabel(v) {
  if (v === null || v === undefined || v === "") return { value: null, warn: null };
  const s = String(v).trim().toLowerCase();
  // exact enum passthrough
  const exact = ["new_listing", "closed_deal", "price_change", "team_move", "license_change", "brokerage_change", "marketing", "social", "news", "award", "other"];
  const norm = s.replace(/\s+/g, "_");
  if (exact.includes(norm)) return { value: norm, warn: null };
  for (const [re, out] of SIGNAL_MAP) if (re.test(s)) return { value: out, warn: null };
  return { value: "other", warn: "Signal type \"" + String(v).slice(0, 40) + "\" not recognized — mapped to \"other\"." };
}

// Apply the transform a field declares. Returns { value, warn }.
function transformValue(field, value) {
  if (!field || !field.transform) return { value: value, warn: null };
  if (field.transform === "priority") return { value: normPriorityLabel(value), warn: null };
  if (field.transform === "signal_type") return normSignalLabel(value);
  return { value: value, warn: null };
}

// ── Quality validators (surfaced as warnings; not schema-enforced) ───────────
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); }
function phoneDigits(v) { return String(v || "").replace(/\D/g, ""); }
function isPhone(v) { const d = phoneDigits(v); return d.length >= 10 && d.length <= 15; }

// ── Header fingerprint (stable across column order) for profile matching ─────
function fingerprint(headers) {
  const norm = (headers || []).map(normHeader).filter(Boolean).sort();
  return norm.join("|");
}

// ── Entity detection ─────────────────────────────────────────────────────────
// Score how well a sheet's headers match an entity's fields (alias-aware).
function scoreEntity(headers, entity) {
  const nHeaders = (headers || []).map(normHeader).filter(Boolean);
  if (!nHeaders.length) return 0;
  let matched = 0, requiredMatched = 0, requiredTotal = 0;
  for (const f of entity.fields) {
    if (f.required) requiredTotal++;
    const alii = [f.target].concat(f.aliases || []).map(normHeader);
    const hit = nHeaders.some((h) => alii.some((a) => a === h || similarity(h, a) >= 0.9));
    if (hit) { matched++; if (f.required) requiredMatched++; }
  }
  // Weighted: coverage of the entity's fields + required-field satisfaction.
  const coverage = matched / entity.fields.length;
  const reqCov = requiredTotal ? requiredMatched / requiredTotal : 1;
  const hintBonus = 0; // hints applied by caller with sample values
  return Math.min(1, coverage * 0.6 + reqCov * 0.4 + hintBonus);
}
function detectEntity(sheet, descriptor) {
  const scores = Object.keys(descriptor.entities).map((name) => {
    let sc = scoreEntity(sheet.headers, descriptor.entities[name]);
    // token hints from sheet name + headers
    const hay = normHeader(sheet.name) + " " + (sheet.headers || []).map(normHeader).join(" ");
    const hints = descriptor.entities[name].detectHints || [];
    const hintHits = hints.filter((h) => hay.indexOf(normHeader(h)) >= 0).length;
    if (hints.length) sc = Math.min(1, sc + Math.min(0.15, hintHits * 0.05));
    return { entity: name, score: Math.round(sc * 100) / 100 };
  }).sort((a, b) => b.score - a.score);
  return scores;
}

// ── Column auto-mapping ──────────────────────────────────────────────────────
function autoMapColumns(sheet, entityName, descriptor) {
  const entity = descriptor.entities[entityName];
  const headers = sheet.headers || [];
  const used = {}; // target -> best {sourceIdx, conf}
  const cols = [];
  headers.forEach((h, idx) => {
    if (normHeader(h) === "") { cols.push({ source: h, sourceIndex: idx, target: null, confidence: 0, ignored: true, samples: sampleValues(sheet, idx) }); return; }
    let best = null;
    for (const f of entity.fields) {
      const alii = [f.target].concat(f.aliases || []);
      let s = 0;
      for (const a of alii) { const sim = similarity(h, a); if (sim > s) s = sim; }
      if (!best || s > best.s) best = { s, field: f };
    }
    const conf = best ? Math.round(best.s * 100) / 100 : 0;
    const target = conf >= 0.55 ? best.field.target : null;
    cols.push({
      source: h, sourceIndex: idx,
      target: target,
      confidence: target ? conf : 0,
      required: target ? !!best.field.required : false,
      transform: target && best.field.transform ? best.field.transform : null,
      type: target ? best.field.type : null,
      samples: sampleValues(sheet, idx),
      ignored: !target,
    });
    if (target) {
      if (!used[target] || conf > used[target].confidence) {
        if (used[target]) { const prev = cols[used[target].colIndex]; prev.target = null; prev.ignored = true; prev.confidence = 0; }
        used[target] = { confidence: conf, colIndex: cols.length - 1 };
      } else { cols[cols.length - 1].target = null; cols[cols.length - 1].ignored = true; cols[cols.length - 1].confidence = 0; }
    }
  });
  return cols;
}
function sampleValues(sheet, colIndex, n) {
  const out = [];
  for (const row of (sheet.rows || [])) {
    const v = row[colIndex];
    if (v !== null && v !== undefined && String(v).trim() !== "") out.push(String(v).slice(0, 40));
    if (out.length >= (n || 3)) break;
  }
  return out;
}

// ── Build a full auto-mapping for a file (detection + per-sheet columns) ─────
function autoMap(sheets, descriptor) {
  return (sheets || []).map((sheet) => {
    const detection = detectEntity(sheet, descriptor);
    const top = detection[0] || { entity: null, score: 0 };
    const entity = top.score >= 0.25 ? top.entity : null;
    return {
      sheet: sheet.name,
      headers: sheet.headers,
      fingerprint: fingerprint(sheet.headers),
      detection: detection.slice(0, 4),
      entity: entity,
      entityConfidence: top.score,
      columns: entity ? autoMapColumns(sheet, entity, descriptor) : [],
      rowCount: (sheet.rows || []).length,
    };
  });
}

// ── Apply a (possibly admin-edited) mapping → canonical rows per contract sheet
// mappingSheets: [{ sheet, entity, columns:[{sourceIndex|source, target, transform, constant, combineWith?, split?, ignored}], constants? }]
// Returns { canonical: { [ContractSheet]: [ {ContractHeader: value} ] },
//           provenance: [ {contractSheet, sourceSheet, sourceRow, raw} ],
//           warnings: [ {sheet,row,message} ] }
function applyMapping(sheets, mappingSheets, descriptor) {
  const bySheetName = {}; (sheets || []).forEach((s) => { bySheetName[s.name] = s; });
  const canonical = {}; const provenance = []; const warnings = [];
  for (const ms of (mappingSheets || [])) {
    if (!ms.entity) continue;
    const src = bySheetName[ms.sheet]; if (!src) continue;
    const contractSheet = descriptor.entities[ms.entity].contractSheet;
    canonical[contractSheet] = canonical[contractSheet] || [];
    const active = (ms.columns || []).filter((c) => c.target && !c.ignored);
    (src.rows || []).forEach((row, ri) => {
      const rowNum = (src.firstDataRow || 2) + ri;
      const rec = {};
      // per-target: support combine (multiple sources → one target)
      const byTarget = {};
      for (const c of active) {
        const idx = c.sourceIndex != null ? c.sourceIndex : (src.headers || []).indexOf(c.source);
        let val = idx >= 0 ? row[idx] : null;
        // Security: never import a formula's value as data (parity with the
        // native importer's formula rejection) — drop it with a warning.
        if (val && typeof val === "object" && val.__formula) {
          warnings.push({ sheet: ms.sheet, row: rowNum, message: "Formula in column \"" + c.source + "\" rejected — paste values only." });
          val = null;
        }
        if (c.split && val != null) {
          const parts = String(val).split(c.split.on || ",");
          val = parts[c.split.index || 0] != null ? parts[c.split.index || 0].trim() : null;
        }
        (byTarget[c.target] = byTarget[c.target] || []).push({ c, val });
      }
      Object.keys(byTarget).forEach((target) => {
        const parts = byTarget[target];
        const field = descriptor.entities[ms.entity].fields.find((f) => f.target === target) || {};
        let value;
        if (parts.length > 1) value = parts.map((p) => p.val).filter((v) => v != null && String(v).trim() !== "").join(" ").trim() || null;
        else value = parts[0].val;
        const t = transformValue(field, value);
        if (t.warn) warnings.push({ sheet: ms.sheet, row: rowNum, message: t.warn });
        rec[target] = t.value;
      });
      // constants
      (ms.constants || []).forEach((k) => { if (k.target && (rec[k.target] === undefined || rec[k.target] === null || rec[k.target] === "")) rec[k.target] = k.value; });
      // skip fully-empty rows
      if (!Object.values(rec).some((v) => v !== null && v !== undefined && String(v).trim() !== "")) return;
      canonical[contractSheet].push(rec);
      provenance.push({ contractSheet: contractSheet, sourceSheet: ms.sheet, sourceRow: rowNum, raw: rawObject(src.headers, row), entity: ms.entity });
    });
  }
  return { canonical, provenance, warnings };
}
function rawObject(headers, row) {
  const o = {};
  (headers || []).forEach((h, i) => { if (h != null && String(h).trim() !== "") o[String(h)] = row[i] == null ? null : row[i]; });
  return o;
}

// ── Data-quality report over canonical rows (before planning) ────────────────
// Uses the module's normalizeRow for schema-level validation and adds
// email/phone/enum quality on top. Returns per-canonical-sheet arrays.
function qualityReport(canonical, descriptor) {
  const out = { missingRequired: [], invalidEmail: [], invalidPhone: [], invalidEnum: [], rows: 0 };
  Object.keys(canonical).forEach((cs) => {
    (canonical[cs] || []).forEach((rec, i) => {
      out.rows++;
      const raw = {}; Object.keys(rec).forEach((k) => { raw[normHeader(k)] = rec[k]; });
      const nr = descriptor.normalizeRow(cs, raw, i + 2);
      (nr.errors || []).forEach((e) => {
        if (/required column/.test(e)) out.missingRequired.push({ sheet: cs, row: i + 2, error: e });
        else out.invalidEnum.push({ sheet: cs, row: i + 2, error: e });
      });
      if (rec.Email && !isEmail(rec.Email)) out.invalidEmail.push({ sheet: cs, row: i + 2, value: rec.Email });
      if (rec.Phone && !isPhone(rec.Phone)) out.invalidPhone.push({ sheet: cs, row: i + 2, value: rec.Phone });
    });
  });
  return out;
}

// ── Fuzzy duplicate detection (WARN only — never auto-merge) ──────────────────
// existingNames: [{id, name, company}] per entity family, plus in-file rows.
// Returns [{sheet,row,name,candidate,score}] for near-duplicates that are NOT
// exact-key matches (those are handled by the module planner as updates).
function fuzzyDuplicates(canonical, descriptor, existingByEntity) {
  const warnings = [];
  Object.keys(canonical).forEach((cs) => {
    const entity = Object.keys(descriptor.entities).find((e) => descriptor.entities[e].contractSheet === cs);
    if (!entity) return;
    const nameField = descriptor.entities[entity].nameField;
    const companyField = descriptor.entities[entity].companyField;
    if (!nameField) return;
    const existing = (existingByEntity && existingByEntity[entity]) || [];
    const seen = [];
    (canonical[cs] || []).forEach((rec, i) => {
      const nm = rec[nameField]; if (!nm) return;
      const co = companyField ? rec[companyField] : "";
      const pool = existing.concat(seen);
      for (const cand of pool) {
        const ns = similarity(nm, cand.name);
        const cs2 = companyField ? similarity(co || "", cand.company || "") : 1;
        // near but not identical → review
        if (ns >= 0.8 && ns < 1 && cs2 >= 0.5) {
          warnings.push({ sheet: cs, row: i + 2, name: String(nm), candidate: cand.name, score: Math.round(ns * 100) / 100 });
          break;
        }
      }
      seen.push({ name: String(nm), company: String(co || "") });
    });
  });
  return warnings;
}

// ── Bridge canonical rows into the module's native planner ───────────────────
// Produces { [ContractSheet]: [ normalizeRow output ] } ready for
// descriptor.planActions — reusing the module's dedupe / conflict / confidence /
// provenance logic unchanged. provenance[] (from applyMapping) aligns 1:1 with
// the rows in file order per sheet, so callers can attach source lineage.
function buildPlannerRows(canonical, descriptor) {
  const rowsBySheet = {};
  Object.keys(canonical).forEach((cs) => {
    rowsBySheet[cs] = (canonical[cs] || []).map((rec, i) => {
      const raw = {};
      Object.keys(rec).forEach((k) => { raw[normHeader(k)] = rec[k]; });
      return descriptor.normalizeRow(cs, raw, i + 2);
    });
  });
  return rowsBySheet;
}

// ── CSV parsing (RFC4180-ish; no dependency) ─────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* ignore */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// Turn a CSV buffer into a single-sheet structure.
function sheetFromCsv(name, text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!rows.length) return { name: name, headers: [], rows: [], firstDataRow: 2 };
  const headers = rows[0].map((h) => String(h).trim());
  return { name: name, headers: headers, rows: rows.slice(1), firstDataRow: 2 };
}

module.exports = {
  normHeader, similarity, levenshtein, fingerprint,
  normPriorityLabel, normSignalLabel, transformValue,
  isEmail, isPhone, phoneDigits,
  scoreEntity, detectEntity, autoMapColumns, autoMap, sampleValues,
  applyMapping, rawObject, qualityReport, fuzzyDuplicates, buildPlannerRows,
  parseCsv, sheetFromCsv,
};
