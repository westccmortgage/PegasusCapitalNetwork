#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const pkg = require("exceljs/package.json");
const core = require("../netlify/functions/lib/intelligence-import-core.js");
const { buildTemplate } = require("../netlify/functions/lib/intelligence-workbook.js");
const preview = require("../netlify/functions/intelligence-import-preview.js");

const payloadDir = path.join(__dirname, "tmp");
const payloadB64 = fs.readdirSync(payloadDir)
  .filter(n => /^workbook-payload-\d+\.b64$/.test(n))
  .sort()
  .map(n => fs.readFileSync(path.join(payloadDir, n), "utf8").trim())
  .join("");
const payloadHash = crypto.createHash("sha256").update(payloadB64).digest("hex");
if (payloadHash !== "3904a652aa40ab4f181ba2f4c744de3d396c9a5c8e7aad9384d3017257f02f7b") {
  throw new Error(`Payload chunk checksum mismatch: ${payloadHash}`);
}
const payload = JSON.parse(zlib.gunzipSync(Buffer.from(payloadB64, "base64")).toString("utf8"));
const out = path.join(__dirname, "..", "Pegasus-Intelligence-2026-07-27.xlsx");
const reportPath = path.join(__dirname, "..", "Pegasus-Intelligence-2026-07-27-validation.json");

function fail(m) { throw new Error(m); }
function value(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(x => x.text).join("");
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return v.result;
  }
  return v;
}
function nonEmpty(v) { return v !== null && v !== undefined && String(value(v)).trim() !== ""; }

(async () => {
  if (pkg.version !== "4.4.0") fail(`ExcelJS ${pkg.version} loaded; expected 4.4.0`);
  const templateBuffer = await buildTemplate(ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const expectedSheets = ["README", ...Object.keys(core.SHEETS)];
  const actualSheets = wb.worksheets.map(ws => ws.name);
  if (JSON.stringify(actualSheets) !== JSON.stringify(expectedSheets)) fail(`Native template sheet mismatch: ${JSON.stringify(actualSheets)}`);

  for (const [sheetName, rows] of Object.entries(payload.datasets)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) fail(`Missing target sheet ${sheetName}`);
    for (const row of rows) ws.addRow(row);
  }
  wb.creator = "Pegasus Capital Intelligence";
  wb.modified = new Date(payload.as_of + "T12:00:00Z");
  const finalBuffer = Buffer.from(await wb.xlsx.writeBuffer());
  fs.writeFileSync(out, finalBuffer);

  const check = new ExcelJS.Workbook();
  await check.xlsx.load(finalBuffer);
  if (JSON.stringify(check.worksheets.map(ws => ws.name)) !== JSON.stringify(expectedSheets)) fail("ExcelJS round-trip changed sheet order");

  let formulaCells = 0;
  for (const ws of check.worksheets) ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    const v = cell.value;
    if (cell.formula || (v && typeof v === "object" && (v.formula !== undefined || v.sharedFormula !== undefined))) formulaCells++;
  }));
  if (formulaCells) fail(`Found ${formulaCells} formula cells`);

  const parsed = await preview._parseWorkbook(finalBuffer);
  const expectedContract = Object.keys(core.SHEETS);
  if (JSON.stringify(parsed.found) !== JSON.stringify(expectedContract)) fail(`Production parser recognized ${JSON.stringify(parsed.found)}, expected ${JSON.stringify(expectedContract)}`);

  const parserRowCounts = {};
  const rowErrors = [];
  for (const name of expectedContract) {
    const rows = parsed.bySheet[name] || [];
    parserRowCounts[name] = rows.length;
    const expected = payload.datasets[name].length;
    if (rows.length !== expected) fail(`${name} parser rows ${rows.length}, expected ${expected}`);
    for (const r of rows) if (r.errors && r.errors.length) rowErrors.push({ sheet: name, row: r.rowNumber || r.row_number, errors: r.errors });
  }
  if (rowErrors.length) fail(`Normalized row errors: ${JSON.stringify(rowErrors)}`);

  let seq = 0;
  const plan = core.planActions(parsed.bySheet, {}, {
    adminId: "00000000-0000-0000-0000-000000000001",
    today: payload.as_of,
    genId: () => "00000000-0000-0000-0000-" + String(++seq).padStart(12, "0"),
  });
  if (plan.summary.invalid !== 0) fail(`Planner invalid rows: ${plan.summary.invalid}; ${JSON.stringify(plan.errors)}`);
  if (plan.summary.conflict !== 0) fail(`Planner conflicts: ${plan.summary.conflict}`);

  const loansWs = check.getWorksheet("Loans");
  let loanDataRows = 0;
  loansWs.eachRow({ includeEmpty: false }, (row, n) => { if (n > 1 && row.values.slice(1).some(nonEmpty)) loanDataRows++; });
  if (loanDataRows !== 0) fail(`Loans must be header-only; found ${loanDataRows} rows`);

  for (const name of expectedContract) {
    const ws = check.getWorksheet(name);
    const expected = core.SHEETS[name].columns.map(c => c[0]);
    const got = expected.map((_, i) => String(value(ws.getRow(1).getCell(i + 1).value) || ""));
    if (JSON.stringify(got) !== JSON.stringify(expected)) fail(`${name} header mismatch`);
  }

  const sha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");
  const report = {
    status: "PASS",
    validator: `ExcelJS ${pkg.version}`,
    productionParser: "netlify/functions/intelligence-import-preview.js::_parseWorkbook",
    productionPlanner: "netlify/functions/lib/intelligence-import-core.js::planActions",
    filename: path.basename(out), bytes: finalBuffer.length, sha256,
    sheets: actualSheets, parserRecognizedSheets: parsed.found, parserRowCounts,
    expectedDataRowCounts: Object.fromEntries(Object.entries(payload.datasets).map(([k,v]) => [k,v.length])),
    formulaCells, loanDataRows, plannerSummary: plan.summary,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error("VALIDATION FAILED:", e.stack || e.message); process.exit(1); });
