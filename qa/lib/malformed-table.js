// ============================================================================
// QA helper — corrupt an .xlsx buffer with a malformed / DANGLING Excel table
// relationship so it reproduces the ExcelJS crash
//   "Cannot read properties of undefined (reading 'name')"
// (worksheet.js, reducing value.tables).
//
// It injects, on the first worksheet: a <tableParts> pointing at a table
// relationship whose Target part is NEVER created — a dangling table ref plus a
// dangling content-type override. Used by the importer regression tests to
// prove stripTableParts() lets both importers read the worksheet data anyway.
// ============================================================================
"use strict";
const JSZip = require("jszip");

async function injectDanglingTable(buf) {
  const zip = await JSZip.loadAsync(buf);
  const sheet = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort()[0];
  if (!sheet) throw new Error("no worksheet part to corrupt");

  // 1. tableParts on the worksheet, referencing a table relationship id.
  let xml = await zip.file(sheet).async("string");
  xml = xml.replace(/<\/worksheet>\s*$/,
    '<tableParts count="1"><tablePart r:id="rIdBadTable"/></tableParts></worksheet>');
  zip.file(sheet, xml);

  // 2. Worksheet .rels with a table relationship whose Target part is missing.
  const base = sheet.split("/").pop();
  const relPath = "xl/worksheets/_rels/" + base + ".rels";
  let rels = zip.file(relPath)
    ? await zip.file(relPath).async("string")
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  rels = rels.replace("</Relationships>",
    '<Relationship Id="rIdBadTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/tableBAD.xml"/></Relationships>');
  zip.file(relPath, rels);

  // 3. Content-type override for the (never-created) table part.
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace("</Types>",
    '<Override PartName="/xl/tables/tableBAD.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>');
  zip.file("[Content_Types].xml", ct);

  // 4. Deliberately DO NOT add xl/tables/tableBAD.xml → dangling.
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

module.exports = { injectDanglingTable };
