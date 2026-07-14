// ============================================================================
// PEGASUS — XLSX import sanitizer (shared by both importers)
// netlify/functions/lib/xlsx-sanitize.js
//
// Excel "Table" objects (ListObjects) are stored as separate parts:
//   xl/tables/tableN.xml            (the table definition)
//   xl/worksheets/sheetN.xml        <tableParts><tablePart r:id="…"/></tableParts>
//   xl/worksheets/_rels/…rels       Relationship Type=".../table"
//   [Content_Types].xml             <Override PartName="/xl/tables/…"/>
//
// A malformed or DANGLING table relationship (tableParts pointing at a table
// part/rel that is missing or unparseable) makes ExcelJS throw
//   "Cannot read properties of undefined (reading 'name')"
// while reducing worksheet.tables. Our importers do NOT use Excel table objects
// — we read raw cell values — so we strip every table-related part BEFORE
// handing the workbook to ExcelJS. This is lossless for our purposes:
// worksheet cell values, styles, number formats, data validations, hyperlinks,
// and formulas are all in OTHER parts and are left byte-for-byte untouched.
//
// Only import workbooks pass through here. The upload's own security checks
// (extension/signature/size/macro-`vbaProject` scan, formula-as-data rejection)
// run on the ORIGINAL buffer in the caller before parsing, so stripping tables
// changes none of them.
//
// stripTableParts(buf) → Promise<Buffer>. Returns the original buffer unchanged
// when there is nothing to strip or the file is not a readable zip (so ExcelJS
// still surfaces the real error for a genuinely corrupt upload).
// ============================================================================
"use strict";

const JSZip = require("jszip");

const TABLE_PART_RE = /^xl\/tables\/[^/]+\.xml$/i;
const WORKSHEET_RE = /^xl\/worksheets\/[^/]+\.xml$/i;
const WS_RELS_RE = /^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/i;
// A <tableParts> block, either with children or self-closing.
const TABLEPARTS_RE = /<(?:\w+:)?tableParts\b[\s\S]*?<\/(?:\w+:)?tableParts>|<(?:\w+:)?tableParts\b[^>]*\/>/gi;
// A <Relationship …> whose Type ends in ".../table" (NOT pivotTable/queryTable/
// tableSingleCells — those keep their own suffixes). Order-independent attrs.
const TABLE_REL_RE = /<Relationship\b[^>]*\bType="[^"]*\/table"[^>]*\/>/gi;
// A content-type override for an xl/tables/* part.
const TABLE_OVERRIDE_RE = /<Override\b[^>]*\bPartName="\/xl\/tables\/[^"]*"[^>]*\/>/gi;

async function stripTableParts(buf) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); }
  catch (_) { return buf; } // not a readable zip — let ExcelJS report the real error
  let changed = false;

  const names = Object.keys(zip.files);

  // 1. Remove xl/tables/* parts outright.
  for (const n of names) {
    if (TABLE_PART_RE.test(n)) { zip.remove(n); changed = true; }
  }

  // 2. Remove <tableParts> from every worksheet part.
  for (const n of names) {
    if (!WORKSHEET_RE.test(n) || WS_RELS_RE.test(n)) continue;
    const f = zip.file(n); if (!f) continue;
    const xml = await f.async("string");
    const out = xml.replace(TABLEPARTS_RE, "");
    if (out !== xml) { zip.file(n, out); changed = true; }
  }

  // 3. Remove table relationships from worksheet .rels parts.
  for (const n of names) {
    if (!WS_RELS_RE.test(n)) continue;
    const f = zip.file(n); if (!f) continue;
    const xml = await f.async("string");
    const out = xml.replace(TABLE_REL_RE, "");
    if (out !== xml) { zip.file(n, out); changed = true; }
  }

  // 4. Remove table overrides from [Content_Types].xml.
  const ctf = zip.file("[Content_Types].xml");
  if (ctf) {
    const xml = await ctf.async("string");
    const out = xml.replace(TABLE_OVERRIDE_RE, "");
    if (out !== xml) { zip.file("[Content_Types].xml", out); changed = true; }
  }

  if (!changed) return buf;
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// Turn ExcelJS's cryptic internal parse failures into an actionable message.
// Files exported by some tools/libraries produce a workbook ExcelJS cannot read
// (it throws e.g. "Cannot read properties of undefined (reading 'sheets')" or
// "…(reading 'name')") — surface guidance instead of the raw stack text.
function friendlyParseError(err) {
  const m = (err && err.message) || String(err);
  if (/reading '(sheets|name|model|worksheets)'/.test(m) || /Cannot read propert/.test(m)) {
    return "the .xlsx structure could not be read — it may have been produced by a tool that writes an incompatible workbook. Re-save it as .xlsx from Excel or Google Sheets (File → Save As / Download → .xlsx), or start from Download Import Template.";
  }
  return m;
}

module.exports = { stripTableParts, friendlyParseError };
