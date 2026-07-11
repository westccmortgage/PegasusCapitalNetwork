// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — workbook builders (template + QA fixture)
// Generated from the same CONTRACT the parser uses, so template and importer
// can never drift apart. Requires exceljs (server/QA only — never in browser).
// ============================================================================
"use strict";

const core = require("./intelligence-import-core.js");

function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  const headers = core.SHEETS[name].columns.map((c) => c[0]);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => { col.width = Math.max(14, headers[i].length + 4); });
  (rows || []).forEach((r) => ws.addRow(headers.map((h) => (r[h] !== undefined ? r[h] : null))));
  return ws;
}

// Empty template with every contract sheet + a README sheet.
async function buildTemplate(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pegasus Capital Intelligence";
  const readme = wb.addWorksheet("README");
  readme.getColumn(1).width = 110;
  [
    "PEGASUS CAPITAL INTELLIGENCE — DAILY IMPORT TEMPLATE",
    "",
    "Rules:",
    "• Sheet names and headers must match this template (case/spacing-insensitive).",
    "• Confidence must be one of: Verified, Reported, Estimated, Unknown.",
    "• Blank cells stay blank — never enter 0 for unknown values.",
    "• Percent columns accept 6.5 or 0.065 (both mean 6.5%).",
    "• Currency may include $ and commas.",
    "• Dates: YYYY-MM-DD or MM/DD/YYYY.",
    "• Booleans: true/false, yes/no, 1/0.",
    "• Property_Key: Parcel_ID first, else External_ID, else the full street address.",
    "• Contact_Key: email first, else External_ID, else \"Name | Company\".",
    "• No formulas and no macros — values only. Save as .xlsx.",
    "",
    "Full documentation: docs/CAPITAL-INTELLIGENCE-IMPORT.md in the repository.",
  ].forEach((t) => readme.addRow([t]));
  Object.keys(core.SHEETS).forEach((name) => addSheet(wb, name, []));
  return wb.xlsx.writeBuffer();
}

// Small sanitized fixture for QA — obviously-fake values, no real entities.
async function buildFixture(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Properties", [
    { External_ID: "QA-PROP-1", Property_Name: "QA Test Plaza", Address: "123 Example Street",
      City: "West Palm Beach", State: "FL", ZIP: "33401", County: "Palm Beach",
      Parcel_ID: "00-0000-000-0000-QA1", Property_Subtype: "strip_center", Building_SF: 25000,
      Asking_Price: "$5,250,000", NOI: 315000, Cap_Rate_Pct: "0.06", Occupancy_Pct: 92,
      Tenant_Count: 8, Anchor_Tenant: "QA Grocer", Listing_Status: "active",
      Listing_URL: "https://example.com/listing/qa1", Opportunity_Score: 82,
      Notes: "QA fixture row", Confidence: "Reported",
      Source_URL: "https://example.com/source/qa1", Source_Title: "QA Source", Source_Date: "2026-01-15" },
    { External_ID: "QA-PROP-2", Property_Name: "QA Corner Retail", Address: "456 Sample Ave",
      City: "Boca Raton", State: "FL", ZIP: "33431", County: "Palm Beach",
      Building_SF: 12000, Asking_Price: 4100000, Cap_Rate_Pct: 6.8, Occupancy_Pct: "0.85",
      Listing_Status: "active", Confidence: "Estimated" },
  ]);
  addSheet(wb, "Property_Updates", [
    { Property_Key: "QA-PROP-1", Field_Name: "asking_price", New_Value: "$4,950,000",
      Value_Type: "currency", Effective_Date: "2026-02-01", Confidence: "Reported",
      Source_URL: "https://example.com/source/qa1-update" },
  ]);
  addSheet(wb, "Contacts", [
    { External_ID: "QA-CT-1", Name: "Test Broker", Company: "QA Brokerage LLC",
      Job_Title: "Senior Director", Contact_Type: "listing_broker", Email: "test.broker@example.com",
      Phone: "(555) 000-0001", City: "West Palm Beach", State: "FL", Tags: "retail, qa",
      Confidence: "Verified", Last_Verified_Date: "2026-01-10", Source_URL: "https://example.com/ct1" },
    { External_ID: "QA-CT-2", Name: "Test Lender", Company: "QA Capital Partners",
      Contact_Type: "current_lender", Email: "test.lender@example.com", Confidence: "Reported" },
  ]);
  addSheet(wb, "Property_Contacts", [
    { Property_Key: "QA-PROP-1", Contact_Key: "test.broker@example.com",
      Relationship_Role: "listing_broker", Is_Primary: "yes", Confidence: "Verified",
      Source_URL: "https://example.com/link1" },
  ]);
  addSheet(wb, "Loans", [
    { External_ID: "QA-LOAN-1", Property_Key: "QA-PROP-1", Lender_Contact_Key: "test.lender@example.com",
      Lien_Position: 1, Original_Amount: "$3,600,000", Recorded_Date: "2019-06-15",
      Instrument_Number: "QA-INSTR-0001", Recording_Jurisdiction: "Palm Beach", Estimated_Balance: 3200000, Interest_Rate_Pct: 4.75,
      Rate_Type: "fixed", Maturity_Date: "2026-11-30", Maturity_Basis: "Reported",
      Loan_Type: "CMBS", Status: "current", Confidence: "Reported",
      Source_URL: "https://example.com/loan1" },
  ]);
  addSheet(wb, "Tenants", [
    { Property_Key: "QA-PROP-1", Tenant_Name: "QA Grocer", Suite: "100", Leased_SF: 9800,
      Lease_Start: "2018-03-01", Lease_Expiration: "2027-02-28", Annual_Rent: "$196,000",
      Category: "grocery", Credit_Quality: "regional", Rollover_Risk: "medium",
      Confidence: "Reported", Source_URL: "https://example.com/rentroll" },
  ]);
  addSheet(wb, "Distress_Signals", [
    { External_ID: "QA-SIG-1", Property_Key: "QA-PROP-2", Signal_Type: "price_reduction",
      Event_Date: "2026-02-01", Status: "active", Amount: 250000,
      Summary: "QA fixture: asking price reduced", Confidence: "Reported",
      Source_URL: "https://example.com/sig1", Source_Title: "QA Signal Source" },
  ]);
  addSheet(wb, "Lender_Programs", [
    { External_ID: "QA-PRG-1", Lender_Contact_Key: "test.lender@example.com",
      Program_Name: "QA Retail Bridge", Capital_Source_Type: "debt_fund", Florida_Appetite: "Yes",
      Retail_Appetite: "Yes", Stabilized_or_Value_Add: "both", Min_Loan: 2000000, Max_Loan: 15000000,
      Max_LTV_Pct: 70, Min_DSCR: 1.2, Recourse: "non-recourse", Interest_Only: "yes",
      Term_Months: 36, Rate_Guidance: "SOFR + 350-450", Active_Status: "active",
      Last_Verified_Date: "2026-01-20", Confidence: "Reported", Source_URL: "https://example.com/prg1" },
  ]);
  addSheet(wb, "Daily_Actions", [
    { Priority: 1, Action_Type: "call_broker", Property_Key: "QA-PROP-1",
      Contact_Key: "test.broker@example.com", Due_Date: "2026-02-03",
      Action: "Call listing broker about price reduction", Reason: "Score 82 — Act Now" },
  ]);
  return wb.xlsx.writeBuffer();
}

module.exports = { buildTemplate, buildFixture };
