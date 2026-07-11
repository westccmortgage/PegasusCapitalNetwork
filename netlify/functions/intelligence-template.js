// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — download the import template (admin only)
// POST {}  with Authorization: Bearer <jwt>
// Returns { ok, filename, file_base64 } — generated from the same CONTRACT the
// parser uses, so template and importer can never drift apart.
// ============================================================================
"use strict";

const ExcelJS = require("exceljs");
const { requireAdmin, resp } = require("./lib/intelligence-auth.js");
const { buildTemplate } = require("./lib/intelligence-workbook.js");

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (!auth.ok) return resp(auth.statusCode, { ok: false, error: auth.reason });
  try {
    const buf = Buffer.from(await buildTemplate(ExcelJS));
    return resp(200, {
      ok: true,
      filename: "pegasus-capital-intelligence-template.xlsx",
      file_base64: buf.toString("base64"),
    });
  } catch (err) {
    console.error("[intelligence-template] ERROR:", err.message);
    return resp(500, { ok: false, error: err.message });
  }
};
