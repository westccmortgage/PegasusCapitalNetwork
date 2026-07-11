// ============================================================================
// PEGASUS CALIFORNIA PARTNER NETWORK — workbook builders (template + QA fixture)
// Generated from the same CONTRACT the parser uses, so template and importer
// cannot drift apart. Requires exceljs (server/QA only — never in browser).
// ============================================================================
"use strict";

const core = require("./partner-import-core.js");

function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  const headers = core.SHEETS[name].columns.map((c) => c[0]);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => { col.width = Math.max(14, headers[i].length + 4); });
  (rows || []).forEach((r) => ws.addRow(headers.map((h) => (r[h] !== undefined ? r[h] : null))));
  return ws;
}

// Empty template: README + all six contract sheets, in contract order.
async function buildTemplate(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pegasus California Partner Network";
  const readme = wb.addWorksheet("README");
  readme.getColumn(1).width = 110;
  [
    "PEGASUS CALIFORNIA PARTNER NETWORK — IMPORT TEMPLATE",
    "",
    "Six sheets (names/headers matched case- and spacing-insensitively):",
    "  Agents · Escrow_Title · Companies · Activity_Signals · Outreach_Actions · Do_Not_Contact",
    "",
    "Rules:",
    "• Confidence must be one of: Verified, Reported, Estimated, Unknown.",
    "• Blank cells stay blank — never enter 0 for unknown values.",
    "• Currency may include $ and commas. Dates: YYYY-MM-DD or MM/DD/YYYY.",
    "• Company_Key on Agents/Escrow points at a Companies row (name or ext:ID).",
    "• Subject_Key on Activity_Signals/Outreach points at an Agent or Company.",
    "• No formulas and no macros — values only. Save as .xlsx.",
    "• This workbook is ONLY for California Partner Network — not the Palm Beach",
    "  Capital Intelligence importer.",
  ].forEach((t) => readme.addRow([t]));
  // Contract order for the template sheets.
  ["Agents", "Escrow_Title", "Companies", "Activity_Signals", "Outreach_Actions", "Do_Not_Contact"]
    .forEach((name) => addSheet(wb, name, []));
  return wb.xlsx.writeBuffer();
}

// Small sanitized fixture for QA — obviously-fake values, no real entities.
async function buildFixture(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Companies", [
    { External_ID: "QA-CO-1", Company_Name: "QA Coastal Realty", Company_Type: "brokerage",
      Address: "1 Example Plaza", City: "San Diego", State: "CA", ZIP: "92101",
      Phone: "(555) 000-1000", Email: "info@example.com", Website: "https://example.com/co1",
      Agent_Count: 42, Specialty: "residential", Status: "active", Confidence: "Reported",
      Source_URL: "https://example.com/src/co1", Last_Verified_Date: "2026-01-10" },
    { External_ID: "QA-CO-2", Company_Name: "QA Sierra Escrow", Company_Type: "escrow",
      City: "Sacramento", State: "CA", Confidence: "Estimated" },
  ]);
  addSheet(wb, "Agents", [
    { External_ID: "QA-AG-1", Full_Name: "Test Agent", Company: "QA Coastal Realty",
      Company_Key: "QA Coastal Realty", License_Number: "DRE-01234567", Job_Title: "Broker Associate",
      Email: "test.agent@example.com", Phone: "(555) 000-2000", City: "San Diego", State: "CA",
      Specialty: "luxury", Production_Volume: "$18,500,000", Deal_Count: 24, Status: "active",
      Tags: "top-producer, coastal", Confidence: "Verified", Last_Verified_Date: "2026-01-12",
      Source_URL: "https://example.com/ag1" },
  ]);
  addSheet(wb, "Escrow_Title", [
    { External_ID: "QA-ET-1", Officer_Name: "Test Officer", Company: "QA Sierra Escrow",
      Company_Key: "QA Sierra Escrow", Role: "escrow_officer", Email: "test.officer@example.com",
      Phone: "(555) 000-3000", City: "Sacramento", State: "CA", Transaction_Volume: 12000000,
      Status: "active", Confidence: "Reported", Source_URL: "https://example.com/et1" },
  ]);
  addSheet(wb, "Activity_Signals", [
    { External_ID: "QA-SIG-1", Subject_Type: "agent", Subject_Name: "Test Agent",
      Subject_Key: "test.agent@example.com", Signal_Type: "closed_deal", Signal_Date: "2026-02-01",
      Detail: "QA fixture: closed a coastal listing", URL: "https://example.com/sig1",
      Confidence: "Reported", Source_URL: "https://example.com/src/sig1", Source_Title: "QA Signal" },
  ]);
  addSheet(wb, "Outreach_Actions", [
    { External_ID: "QA-OA-1", Priority: 1, Action_Type: "call", Subject_Type: "agent",
      Subject_Name: "Test Agent", Subject_Key: "test.agent@example.com", Channel: "phone",
      Due_Date: "2026-02-05", Action: "Introduce partner program", Reason: "High producer — coastal",
      Status: "open" },
  ]);
  addSheet(wb, "Do_Not_Contact", [
    { External_ID: "QA-DNC-1", Subject_Type: "agent", Subject_Name: "Do Not Call Agent",
      Company: "QA Coastal Realty", Email: "donotcall@example.com", Scope: "all",
      Reason: "Requested no contact", Effective_Date: "2026-01-15",
      Source_URL: "https://example.com/dnc1" },
  ]);
  return wb.xlsx.writeBuffer();
}

module.exports = { buildTemplate, buildFixture };
