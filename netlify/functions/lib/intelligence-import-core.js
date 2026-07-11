// ============================================================================
// PEGASUS CAPITAL INTELLIGENCE — import core (pure logic, no I/O)
// netlify/functions/lib/intelligence-import-core.js
//
// Everything semantic about the daily XLSX import lives here so it can be
// unit-tested offline (qa/intelligence-audit.js) without Supabase or Netlify:
//   • the workbook contract (sheets + columns + types)
//   • value normalization (currency, percent, date, boolean, confidence)
//   • dedupe keys (property: parcel → external → normalized address;
//                  contact: email → external → name+company)
//   • row validation
//   • action planning (insert / update / unchanged / conflict / invalid)
//     with the confidence ladder: Verified > Reported > Estimated > Unknown.
//
// The Netlify functions add: auth, file checks, exceljs parsing, DB lookups,
// storage upload, and the transactional commit RPC call.
// ============================================================================
"use strict";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB (base64 body stays under Netlify's 6MB)

const CONFIDENCE = ["Verified", "Reported", "Estimated", "Unknown"];
function confidenceRank(c) {
  return { Verified: 4, Reported: 3, Estimated: 2, Unknown: 1 }[c] || 0;
}

// ── Workbook contract ────────────────────────────────────────────────────────
// type: text | number | currency | percent | int | date | bool | confidence | url
const SHEETS = {
  Properties: {
    target: "property",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Property_Name", "property_name", "text"],
      ["Address", "address_line1", "text"],
      ["City", "city", "text"],
      ["State", "state", "text"],
      ["ZIP", "postal_code", "text"],
      ["County", "county", "text"],
      ["Parcel_ID", "parcel_id", "text"],
      ["Latitude", "latitude", "number"],
      ["Longitude", "longitude", "number"],
      ["Property_Subtype", "property_subtype", "text"],
      ["Building_SF", "building_sf", "number"],
      ["Land_Acres", "land_acres", "number"],
      ["Year_Built", "year_built", "int"],
      ["Asking_Price", "asking_price", "currency"],
      ["NOI", "noi", "currency"],
      ["Cap_Rate_Pct", "cap_rate_pct", "percent"],
      ["Occupancy_Pct", "occupancy_pct", "percent"],
      ["Tenant_Count", "tenant_count", "int"],
      ["Anchor_Tenant", "anchor_tenant", "text"],
      ["Listing_Status", "listing_status", "text"],
      ["Listing_URL", "listing_url", "url"],
      ["First_Seen_Date", "first_seen_at", "date"],
      ["Last_Seen_Date", "last_seen_at", "date"],
      ["Opportunity_Score", "opportunity_score", "int"],
      ["Recommendation", "recommendation", "text"],
      ["Notes", "notes", "text"],
      ["Confidence", "data_confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Source_Title", "source_title", "text"],
      ["Source_Date", "source_date", "date"],
    ],
    required: ["address_line1", "city"],
  },
  Property_Updates: {
    target: "property_update",
    columns: [
      ["Property_Key", "property_key", "text"],
      ["Field_Name", "field_name", "text"],
      ["New_Value", "new_value", "raw"],
      ["Value_Type", "value_type", "text"],
      ["Effective_Date", "effective_date", "date"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Source_Title", "source_title", "text"],
      ["Notes", "notes", "text"],
    ],
    required: ["property_key", "field_name"],
  },
  Contacts: {
    target: "contact",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Name", "name", "text"],
      ["Company", "company", "text"],
      ["Job_Title", "job_title", "text"],
      ["Contact_Type", "contact_type", "text"],
      ["Email", "email", "text"],
      ["Phone", "phone", "text"],
      ["Website", "website", "url"],
      ["LinkedIn_URL", "linkedin_url", "url"],
      ["City", "city", "text"],
      ["State", "state", "text"],
      ["Tags", "tags", "text"],
      ["Notes", "notes", "text"],
      ["Confidence", "data_confidence", "confidence"],
      ["Last_Verified_Date", "last_verified_at", "date"],
      ["Source_URL", "source_url", "url"],
    ],
    required: ["name"],
  },
  Property_Contacts: {
    target: "property_contact",
    columns: [
      ["Property_Key", "property_key", "text"],
      ["Contact_Key", "contact_key", "text"],
      ["Relationship_Role", "relationship_role", "text"],
      ["Is_Primary", "is_primary", "bool"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
    ],
    required: ["property_key", "contact_key", "relationship_role"],
  },
  Loans: {
    target: "loan",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Property_Key", "property_key", "text"],
      ["Lender_Contact_Key", "lender_contact_key", "text"],
      ["Lien_Position", "lien_position", "int"],
      ["Original_Amount", "original_amount", "currency"],
      ["Recorded_Date", "recorded_date", "date"],
      ["Instrument_Number", "instrument_number", "text"],
      ["Estimated_Balance", "estimated_balance", "currency"],
      ["Interest_Rate_Pct", "interest_rate_pct", "percent"],
      ["Rate_Type", "rate_type", "text"],
      ["Maturity_Date", "maturity_date", "date"],
      ["Maturity_Basis", "maturity_basis", "confidence"],
      ["Loan_Type", "loan_type", "text"],
      ["Recourse", "recourse", "text"],
      ["DSCR", "dscr", "number"],
      ["LTV_Pct", "ltv_pct", "percent"],
      ["Status", "status", "text"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Notes", "notes", "text"],
    ],
    required: ["property_key"],
  },
  Tenants: {
    target: "tenant",
    columns: [
      ["Property_Key", "property_key", "text"],
      ["Tenant_Name", "tenant_name", "text"],
      ["Suite", "suite", "text"],
      ["Leased_SF", "leased_sf", "number"],
      ["Lease_Start", "lease_start", "date"],
      ["Lease_Expiration", "lease_expiration", "date"],
      ["Annual_Rent", "annual_rent", "currency"],
      ["Market_Rent", "market_rent", "currency"],
      ["Category", "category", "text"],
      ["Credit_Quality", "credit_quality", "text"],
      ["Rollover_Risk", "rollover_risk", "text"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Notes", "notes", "text"],
    ],
    required: ["property_key", "tenant_name"],
  },
  Distress_Signals: {
    target: "distress_signal",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Property_Key", "property_key", "text"],
      ["Signal_Type", "signal_type", "text"],
      ["Event_Date", "event_date", "date"],
      ["Status", "status", "text"],
      ["Case_or_Instrument_No", "case_or_instrument_no", "text"],
      ["Amount", "amount", "currency"],
      ["Summary", "summary", "text"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Source_Title", "source_title", "text"],
    ],
    required: ["property_key", "signal_type"],
  },
  Lender_Programs: {
    target: "lender_program",
    columns: [
      ["External_ID", "external_id", "text"],
      ["Lender_Contact_Key", "lender_contact_key", "text"],
      ["Program_Name", "program_name", "text"],
      ["Capital_Source_Type", "capital_source_type", "text"],
      ["Florida_Appetite", "florida_appetite", "text"],
      ["Retail_Appetite", "retail_appetite", "text"],
      ["Stabilized_or_Value_Add", "stabilized_or_value_add", "text"],
      ["Min_Loan", "min_loan", "currency"],
      ["Max_Loan", "max_loan", "currency"],
      ["Max_LTV_Pct", "max_ltv_pct", "percent"],
      ["Max_LTC_Pct", "max_ltc_pct", "percent"],
      ["Min_DSCR", "min_dscr", "number"],
      ["Recourse", "recourse", "text"],
      ["Interest_Only", "interest_only", "text"],
      ["Term_Months", "term_months", "int"],
      ["Amortization_Years", "amortization_years", "int"],
      ["Rate_Guidance", "rate_guidance", "text"],
      ["Fees", "fees", "text"],
      ["Prepayment", "prepayment", "text"],
      ["Active_Status", "active_status", "text"],
      ["Last_Verified_Date", "last_verified_at", "date"],
      ["Confidence", "confidence", "confidence"],
      ["Source_URL", "source_url", "url"],
      ["Notes", "notes", "text"],
    ],
    required: ["lender_contact_key"],
  },
  Daily_Actions: {
    target: "daily_action",
    columns: [
      ["Priority", "priority", "int"],
      ["Action_Type", "action_type", "text"],
      ["Property_Key", "property_key", "text"],
      ["Contact_Key", "contact_key", "text"],
      ["Due_Date", "due_date", "date"],
      ["Action", "action", "text"],
      ["Reason", "reason", "text"],
      ["Notes", "notes", "text"],
    ],
    required: ["action"],
  },
};

const SIGNAL_TYPES = ["foreclosure","lis_pendens","bankruptcy","tax_lien","code_violation","ucc",
  "receiver","delinquency","maturity_pressure","price_reduction","withdrawn_relisted","other"];
const RELATIONSHIP_ROLES = ["owner_entity","principal","listing_broker","leasing_broker",
  "property_manager","current_lender","attorney","title_contact","other"];

// Fields that legitimately move over time — a newer same/higher-confidence
// value may replace them. Non-listed fields conflict on same-confidence change.
const TIME_VARYING = {
  property: ["asking_price","noi","cap_rate_pct","occupancy_pct","tenant_count","anchor_tenant",
    "listing_status","listing_url","last_seen_at","opportunity_score","recommendation","notes",
    "data_confidence","source_url","last_verified_at"],
  contact: ["job_title","company","email","phone","website","linkedin_url","city","state",
    "contact_type","notes","data_confidence","source_url","last_verified_at"],
  loan: ["estimated_balance","interest_rate_pct","status","dscr","ltv_pct","maturity_date",
    "maturity_basis","confidence","source_url","notes"],
  tenant: ["leased_sf","annual_rent","market_rent","lease_expiration","credit_quality",
    "rollover_risk","confidence","source_url","notes","category","lease_start","suite"],
  lender_program: ["florida_appetite","retail_appetite","stabilized_or_value_add","min_loan",
    "max_loan","max_ltv_pct","max_ltc_pct","min_dscr","recourse","interest_only","term_months",
    "amortization_years","rate_guidance","fees","prepayment","active_status","last_verified_at",
    "confidence","source_url","notes","capital_source_type","program_name"],
  property_contact: ["is_primary","confidence","source_url","notes"],
  distress_signal: ["status","amount","summary","confidence","source_url","source_title","event_date"],
};

// Property_Updates whitelist: workbook Field_Name → pci_properties column.
const PROPERTY_UPDATE_FIELDS = {
  asking_price: "currency", noi: "currency", cap_rate_pct: "percent",
  occupancy_pct: "percent", tenant_count: "int", anchor_tenant: "text",
  listing_status: "text", listing_url: "url", last_seen_at: "date",
  refinance_pressure_score: "int", notes: "text", property_name: "text",
  building_sf: "number", land_acres: "number", year_built: "int",
};

// ── Normalizers ──────────────────────────────────────────────────────────────
function blank(v) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}
function normText(v) {
  if (blank(v)) return null;
  return String(v).replace(/\s+/g, " ").trim().slice(0, 2000) || null;
}
function normNumber(v) {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
// Percent: accept 6.5 or 0.065 → 6.5. Values in (0,1] are fractions (1 → 100%).
function normPercent(v) {
  let n = normNumber(typeof v === "string" ? v.replace(/%/g, "") : v);
  if (n === null || Number.isNaN(n)) return n;
  if (n > 0 && n <= 1) n = n * 100;
  n = Math.round(n * 10000) / 10000;
  if (n < 0 || n > 100) return NaN;
  return n;
}
function normInt(v) {
  const n = normNumber(v);
  if (n === null || Number.isNaN(n)) return n;
  return Number.isInteger(n) ? n : NaN;
}
function normDate(v) {
  if (blank(v)) return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === "number") { // Excel serial date
    if (v < 20000 || v > 80000) return NaN;
    d = new Date(Math.round((v - 25569) * 86400 * 1000));
  } else {
    const s = String(v).trim();
    let y, mo, day;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { y = +m[1]; mo = +m[2]; day = +m[3]; }
    else {
      m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) return NaN;
      y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; mo = +m[1]; day = +m[2];
    }
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return NaN;
    d = new Date(Date.UTC(y, mo - 1, day));
    // Reject silent JS date rollover (e.g. 02/31 → Mar 2).
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return NaN;
  }
  if (Number.isNaN(d.getTime())) return NaN;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return NaN;
  return d.toISOString().slice(0, 10);
}
function normBool(v) {
  if (blank(v)) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true","yes","y","1"].includes(s)) return true;
  if (["false","no","n","0"].includes(s)) return false;
  return NaN;
}
function normConfidence(v) {
  if (blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  const hit = CONFIDENCE.find((c) => c.toLowerCase() === s);
  return hit || NaN;
}
function normUrl(v) {
  if (blank(v)) return null;
  let s = String(v).trim();
  // Any explicit scheme other than http(s) is rejected outright
  // (javascript:, data:, file:, vbscript: …) — never silently rewritten.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return NaN;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s.slice(0, 600);
}

// ── Keys ─────────────────────────────────────────────────────────────────────
const SUFFIX = { street:"ST", avenue:"AVE", av:"AVE", boulevard:"BLVD", blvd:"BLVD", drive:"DR",
  road:"RD", lane:"LN", court:"CT", place:"PL", highway:"HWY", parkway:"PKWY", terrace:"TER",
  circle:"CIR", way:"WAY", trail:"TRL", suite:"STE", ste:"STE", north:"N", south:"S", east:"E",
  west:"W", northeast:"NE", northwest:"NW", southeast:"SE", southwest:"SW" };
function normalizeAddress(line1, city, state, zip) {
  const words = String(line1 || "").toUpperCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => SUFFIX[w.toLowerCase()] || w);
  return [words.join(" "),
    String(city || "").toUpperCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim(),
    String(state || "FL").toUpperCase().trim(),
    String(zip || "").trim().slice(0, 5)].filter(Boolean).join("|");
}
function normId(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function propertyKeyOf(d) {
  if (d.parcel_id) return "parcel:" + normId(d.parcel_id);
  if (d.external_id) return "ext:" + normText(d.external_id).toUpperCase();
  if (d.address_line1) return "addr:" + normalizeAddress(d.address_line1, d.city, d.state, d.postal_code);
  return null;
}
// A raw Property_Key cell may be a parcel id, an external id, or an address.
function parsePropertyKeyCell(v) {
  const s = normText(v);
  if (!s) return null;
  const m = s.match(/^(parcel|ext|addr)\s*:\s*(.+)$/i);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === "parcel") return "parcel:" + normId(m[2]);
    if (kind === "ext") return "ext:" + m[2].trim().toUpperCase();
    return "addr:" + m[2].trim().toUpperCase();
  }
  return "auto:" + s.toUpperCase(); // resolved against all three key forms
}
function contactKeyOf(d) {
  if (d.email) return "email:" + String(d.email).trim().toLowerCase();
  if (d.external_id) return "ext:" + normText(d.external_id).toUpperCase();
  if (d.name) return "name:" + (normText(d.name) + "|" + (normText(d.company) || "")).toUpperCase();
  return null;
}
function parseContactKeyCell(v) {
  const s = normText(v);
  if (!s) return null;
  const m = s.match(/^(email|ext|name)\s*:\s*(.+)$/i);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === "email") return "email:" + m[2].trim().toLowerCase();
    if (kind === "ext") return "ext:" + m[2].trim().toUpperCase();
    return "name:" + m[2].trim().toUpperCase();
  }
  if (s.includes("@")) return "email:" + s.toLowerCase();
  return "auto:" + s.toUpperCase();
}
function normalizeUrlKey(u) {
  const s = normUrl(u);
  if (!s || Number.isNaN(s)) return null;
  return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
}

// ── File-level checks (buffers only; no I/O) ─────────────────────────────────
function isZipMagic(buf) { return buf && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04; }
function isLegacyCfb(buf) { return buf && buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; }
function hasVbaProject(buf) { return !!buf && buf.includes("vbaProject"); } // zip stores entry names in plain bytes
function checkFile(filename, buf) {
  const errors = [];
  const fn = String(filename || "").toLowerCase();
  if (!fn.endsWith(".xlsx")) errors.push("Only .xlsx workbooks are accepted (got: " + (filename || "unnamed") + ").");
  if (/\.(xlsm|xlsb|xls)$/.test(fn)) errors.push("Macro-enabled or legacy Excel formats are rejected.");
  if (!buf || !buf.length) errors.push("Empty file.");
  else {
    if (buf.length > MAX_FILE_BYTES) errors.push("File exceeds the " + (MAX_FILE_BYTES / 1048576) + "MB limit.");
    if (isLegacyCfb(buf)) errors.push("Legacy .xls binary format is rejected — save as .xlsx.");
    else if (!isZipMagic(buf)) errors.push("Not a valid .xlsx file (bad file signature).");
    if (hasVbaProject(buf)) errors.push("Macro-enabled workbook detected (vbaProject) — macros are rejected.");
  }
  return errors;
}

// ── Row normalization ────────────────────────────────────────────────────────
function normHeader(h) { return String(h || "").toLowerCase().replace(/[\s_]+/g, ""); }

// rawRow: { headerKey(normalized) : value }. Returns {data, errors}.
function normalizeRow(sheetName, rawRow, rowNumber) {
  const spec = SHEETS[sheetName];
  const errors = [];
  const data = {};
  for (const [header, key, type] of spec.columns) {
    const v = rawRow[normHeader(header)];
    if (rawRow["__formula__" + normHeader(header)]) {
      errors.push(header + ": formulas are not accepted as data");
      continue;
    }
    let out = null;
    switch (type) {
      case "text": out = normText(v); break;
      case "raw": out = blank(v) ? null : v; break;
      case "number": out = normNumber(v); break;
      case "currency": out = normNumber(v); break;
      case "percent": out = normPercent(v); break;
      case "int": out = normInt(v); break;
      case "date": out = normDate(v); break;
      case "bool": out = normBool(v); break;
      case "confidence": out = normConfidence(v); break;
      case "url": out = normUrl(v); break;
      default: out = normText(v);
    }
    if (typeof out === "number" && Number.isNaN(out)) { errors.push(header + ": invalid " + type + " value “" + String(v).slice(0, 40) + "”"); out = null; }
    if (out !== null && typeof out !== "boolean" && typeof out !== "number" && Number.isNaN(out)) { errors.push(header + ": invalid " + type); out = null; }
    data[key] = out;
  }
  for (const req of spec.required) {
    if (blank(data[req]) ) errors.push("required column missing/blank: " + req);
  }
  // Sheet-specific vocabulary checks
  if (sheetName === "Distress_Signals" && data.signal_type) {
    const t = data.signal_type.toLowerCase().replace(/\s+/g, "_");
    if (!SIGNAL_TYPES.includes(t)) errors.push("Signal_Type must be one of: " + SIGNAL_TYPES.join(", "));
    else data.signal_type = t;
  }
  if (sheetName === "Property_Contacts" && data.relationship_role) {
    const rTag = data.relationship_role.toLowerCase().replace(/\s+/g, "_");
    if (!RELATIONSHIP_ROLES.includes(rTag)) errors.push("Relationship_Role must be one of: " + RELATIONSHIP_ROLES.join(", "));
    else data.relationship_role = rTag;
  }
  if (sheetName === "Properties" && data.recommendation) {
    const ok = ["Act Now", "Watch Closely", "Pass", "Unscored"].find((x) => x.toLowerCase() === data.recommendation.toLowerCase());
    if (!ok) errors.push("Recommendation must be Act Now / Watch Closely / Pass / Unscored");
    else data.recommendation = ok;
  }
  if (sheetName === "Property_Updates" && data.field_name) {
    const f = data.field_name.toLowerCase().replace(/\s+/g, "_");
    if (!PROPERTY_UPDATE_FIELDS[f]) errors.push("Field_Name not updatable: " + data.field_name);
    else {
      data.field_name = f;
      const t = PROPERTY_UPDATE_FIELDS[f];
      let nv = null;
      switch (t) {
        case "currency": case "number": nv = normNumber(data.new_value); break;
        case "percent": nv = normPercent(data.new_value); break;
        case "int": nv = normInt(data.new_value); break;
        case "date": nv = normDate(data.new_value); break;
        case "url": nv = normUrl(data.new_value); break;
        default: nv = normText(data.new_value);
      }
      if (typeof nv === "number" && Number.isNaN(nv)) errors.push("New_Value: invalid " + t);
      else data.new_value_normalized = nv;
    }
  }
  return { data, errors, rowNumber };
}

function recommendationFor(total) {
  return total >= 80 ? "Act Now" : total >= 60 ? "Watch Closely" : "Pass";
}

// ── Action planning ──────────────────────────────────────────────────────────
// rows: { [sheetName]: [ {data, errors, rowNumber} ] }
// existing: injected lookups (all optional):
//   properties: Map(key → {id, record})   — keyed by every known key form
//   contacts:   Map(key → {id, record})
//   loans:      Map(key → {id, record})
//   tenants / signals / programs / propertyContacts / sources: Map(key → {id, record})
// ctx: { adminId, today: 'YYYY-MM-DD', genId: () => uuid }
// Returns { rows: [importRow…], summary, conflicts, errors }
function planActions(rows, existing, ctx) {
  const out = [];
  const seen = new Set(); // in-file duplicate keys
  const newProps = new Map();       // key → generated id (same-batch children)
  const newContacts = new Map();
  const newContactNames = new Map(); // id → {name, company} for snapshots
  const sourcesPlanned = new Set();
  const sum = { insert: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  const E = existing || {};
  const maps = {
    properties: E.properties || new Map(), contacts: E.contacts || new Map(),
    loans: E.loans || new Map(), tenants: E.tenants || new Map(),
    signals: E.signals || new Map(), programs: E.programs || new Map(),
    propertyContacts: E.propertyContacts || new Map(), sources: E.sources || new Map(),
    openActions: E.openActions || new Set(),
  };

  function push(sheet, r, target, action, key, before, after, targetId, extraErr) {
    const errs = (r.errors || []).concat(extraErr || []);
    if (action === "invalid") sum.invalid++; else sum[action]++;
    out.push({
      sheet_name: sheet, row_number: r.rowNumber, target_type: target,
      dedupe_key: key || null, proposed_action: action,
      raw_data: r.data, normalized_data: r.data,
      before_data: before || null, after_data: after || null,
      validation_errors: errs, target_record_id: targetId || null,
    });
  }

  // Confidence/diff decision for an update. Returns {action, changed, err?}
  function decide(target, rec, incoming, confField) {
    const changed = {};
    for (const k of Object.keys(incoming)) {
      if (["id","created_at","updated_at","owner_id","created_by","updated_by"].includes(k)) continue;
      if (incoming[k] === null || incoming[k] === undefined) continue; // blank = unknown = no change
      const cur = rec[k];
      const same = (typeof incoming[k] === "number" && typeof cur === "number")
        ? Math.abs(incoming[k] - cur) < 1e-9
        : String(cur ?? "") === String(incoming[k] ?? "");
      if (!same) changed[k] = incoming[k];
    }
    const material = Object.keys(changed).filter((k) => !["source_url","source_title","last_verified_at","last_seen_at","first_seen_at"].includes(k));
    if (!material.length && !Object.keys(changed).length) return { action: "unchanged" };
    if (!material.length) return { action: "update", changed };
    const curConf = rec[confField] || "Unknown";
    const newConf = incoming[confField] || "Unknown";
    const cr = confidenceRank(curConf), nr = confidenceRank(newConf);
    if (nr < cr) return { action: "conflict", changed, err: "incoming " + newConf + " would overwrite " + curConf + " data (fields: " + material.join(", ") + ")" };
    if (nr === cr) {
      const tv = TIME_VARYING[target] || [];
      const hard = material.filter((k) => !tv.includes(k));
      if (hard.length) return { action: "conflict", changed, err: "same-confidence change to non-time-varying fields: " + hard.join(", ") };
    }
    return { action: "update", changed };
  }

  function resolvePropertyKey(cellKey) {
    if (!cellKey) return null;
    const tryKeys = cellKey.startsWith("auto:")
      ? ["parcel:" + normId(cellKey.slice(5)), "ext:" + cellKey.slice(5), "addr:" + cellKey.slice(5)]
      : [cellKey];
    for (const k of tryKeys) {
      if (maps.properties.has(k)) return { id: maps.properties.get(k).id, key: k, isNew: false, record: maps.properties.get(k).record };
      if (newProps.has(k)) return { id: newProps.get(k), key: k, isNew: true };
    }
    return null;
  }
  function resolveContactKey(cellKey) {
    if (!cellKey) return null;
    const tryKeys = cellKey.startsWith("auto:")
      ? ["email:" + cellKey.slice(5).toLowerCase(), "ext:" + cellKey.slice(5), "name:" + cellKey.slice(5)]
      : [cellKey];
    for (const k of tryKeys) {
      if (maps.contacts.has(k)) return { id: maps.contacts.get(k).id, key: k, isNew: false, record: maps.contacts.get(k).record };
      if (newContacts.has(k)) return { id: newContacts.get(k), key: k, isNew: true };
    }
    return null;
  }
  function planSource(sheet, r) {
    const urlKey = normalizeUrlKey(r.data.source_url);
    if (!urlKey || maps.sources.has("url:" + urlKey) || sourcesPlanned.has(urlKey)) return;
    sourcesPlanned.add(urlKey);
    const id = ctx.genId();
    push(sheet, { data: {}, errors: [], rowNumber: r.rowNumber }, "source", "insert", "url:" + urlKey, null, {
      id, source_url: r.data.source_url, normalized_url: urlKey,
      source_title: r.data.source_title || null, source_date: r.data.source_date || null,
      retrieved_at: ctx.today + "T00:00:00Z", source_type: "import",
    }, id);
  }

  // ── Contacts (before properties so lender/broker keys resolve) ──
  for (const r of rows.Contacts || []) {
    if (r.errors.length) { push("Contacts", r, "contact", "invalid"); continue; }
    const d = r.data;
    const key = contactKeyOf(d);
    const allKeys = [d.email && ("email:" + d.email.toLowerCase()), d.external_id && ("ext:" + normText(d.external_id).toUpperCase()), d.name && ("name:" + (normText(d.name) + "|" + (normText(d.company) || "")).toUpperCase())].filter(Boolean);
    if (allKeys.some((k) => seen.has("c|" + k))) { push("Contacts", r, "contact", "invalid", key, null, null, null, ["duplicate contact row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("c|" + k));
    const hit = allKeys.map((k) => maps.contacts.get(k)).find(Boolean);
    const record = {
      name: d.name, company: d.company, job_title: d.job_title, contact_type: d.contact_type,
      email: d.email, phone: d.phone, website: d.website, linkedin_url: d.linkedin_url,
      city: d.city, state: d.state, notes: d.notes, data_confidence: d.data_confidence,
      last_verified_at: d.last_verified_at ? d.last_verified_at + "T00:00:00Z" : null,
      source_url: d.source_url,
      tags: d.tags ? d.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
    };
    if (!hit) {
      const id = ctx.genId();
      allKeys.forEach((k) => newContacts.set(k, id));
      newContactNames.set(id, { name: d.name, company: d.company });
      const ins = Object.assign({ id, owner_id: ctx.adminId, source: "import", status: "active" }, record,
        { tags: record.tags || [], metadata: d.external_id ? { external_id: normText(d.external_id) } : {} });
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      push("Contacts", r, "contact", "insert", key, null, ins, id);
    } else {
      const dec = decide("contact", hit.record || {}, record, "data_confidence");
      if (dec.action === "unchanged") push("Contacts", r, "contact", "unchanged", key, hit.record, null, hit.id);
      else push("Contacts", r, "contact", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Contacts", r);
  }

  // ── Properties ──
  for (const r of rows.Properties || []) {
    if (r.errors.length) { push("Properties", r, "property", "invalid"); continue; }
    const d = r.data;
    d.normalized_address = normalizeAddress(d.address_line1, d.city, d.state, d.postal_code);
    const key = propertyKeyOf(d);
    const allKeys = [d.parcel_id && ("parcel:" + normId(d.parcel_id)), d.external_id && ("ext:" + normText(d.external_id).toUpperCase()), "addr:" + d.normalized_address].filter(Boolean);
    if (allKeys.some((k) => seen.has("p|" + k))) { push("Properties", r, "property", "invalid", key, null, null, null, ["duplicate property row in this file"]); continue; }
    allKeys.forEach((k) => seen.add("p|" + k));
    const hit = allKeys.map((k) => maps.properties.get(k)).find(Boolean);
    const record = {};
    for (const [, colKey] of SHEETS.Properties.columns) {
      if (["source_title","source_date"].includes(colKey)) continue;
      record[colKey] = d[colKey] !== undefined ? d[colKey] : null;
    }
    record.normalized_address = d.normalized_address;
    record.state = record.state || "FL";
    record.county = record.county || "Palm Beach";
    if (!hit) {
      const id = ctx.genId();
      allKeys.forEach((k) => newProps.set(k, id));
      const ins = Object.assign({ id, created_by: ctx.adminId, first_seen_at: record.first_seen_at || ctx.today, last_seen_at: record.last_seen_at || ctx.today }, record);
      Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; });
      if (ins.recommendation && ins.opportunity_score == null) delete ins.recommendation;
      push("Properties", r, "property", "insert", key, null, ins, id);
      if (d.opportunity_score != null) {
        const sid = ctx.genId();
        const reco = d.recommendation || recommendationFor(d.opportunity_score);
        push("Properties", { data: {}, errors: [], rowNumber: r.rowNumber }, "score", "insert", "score:" + id + ":" + ctx.today, null, {
          id: sid, property_id: id, score_date: ctx.today, total_score: d.opportunity_score,
          recommendation: reco,
          override_reason: (d.recommendation && d.recommendation !== recommendationFor(d.opportunity_score)) ? "Imported from workbook (differs from threshold mapping)" : null,
          rationale: "Imported (" + (d.source_title || "daily workbook") + ")", created_by: ctx.adminId,
        }, sid);
      }
    } else {
      const dec = decide("property", hit.record || {}, record, "data_confidence");
      if (dec.action === "unchanged") push("Properties", r, "property", "unchanged", key, hit.record, null, hit.id);
      else {
        if (dec.action === "update" && dec.changed) dec.changed.updated_by = ctx.adminId;
        push("Properties", r, "property", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
        // Listing event when price/status genuinely changes.
        if (dec.action === "update" && dec.changed && (dec.changed.asking_price !== undefined || dec.changed.listing_status !== undefined)) {
          const lid = ctx.genId();
          push("Properties", { data: {}, errors: [], rowNumber: r.rowNumber }, "listing", "insert", "listing:" + hit.id + ":" + ctx.today + ":" + r.rowNumber, null, {
            id: lid, property_id: hit.id, listing_source: "import",
            listing_url: record.listing_url || (hit.record || {}).listing_url || null,
            asking_price: dec.changed.asking_price !== undefined ? dec.changed.asking_price : (hit.record || {}).asking_price || null,
            listing_status: dec.changed.listing_status !== undefined ? dec.changed.listing_status : (hit.record || {}).listing_status || null,
            changed_on: ctx.today, confidence: record.data_confidence || null, source_url: record.source_url || null,
          }, lid);
        }
        if (dec.action === "update" && d.opportunity_score != null && (hit.record || {}).opportunity_score !== d.opportunity_score) {
          const sid = ctx.genId();
          const reco = d.recommendation || recommendationFor(d.opportunity_score);
          push("Properties", { data: {}, errors: [], rowNumber: r.rowNumber }, "score", "insert", "score:" + hit.id + ":" + ctx.today, null, {
            id: sid, property_id: hit.id, score_date: ctx.today, total_score: d.opportunity_score,
            recommendation: reco,
            override_reason: (d.recommendation && d.recommendation !== recommendationFor(d.opportunity_score)) ? "Imported from workbook (differs from threshold mapping)" : null,
            rationale: "Imported (" + (d.source_title || "daily workbook") + ")", created_by: ctx.adminId,
          }, sid);
        }
      }
    }
    planSource("Properties", r);
  }

  // ── Property_Updates ──
  for (const r of rows.Property_Updates || []) {
    if (r.errors.length) { push("Property_Updates", r, "property_update", "invalid"); continue; }
    const d = r.data;
    const ref = resolvePropertyKey(parsePropertyKeyCell(d.property_key));
    if (!ref) { push("Property_Updates", r, "property_update", "invalid", d.property_key, null, null, null, ["Property_Key not found: " + d.property_key]); continue; }
    if (ref.isNew) { push("Property_Updates", r, "property_update", "unchanged", d.property_key, null, null, ref.id, ["property is new in this batch — value already applied by the Properties sheet"]); continue; }
    const rec = ref.record || {};
    const incoming = { [d.field_name]: d.new_value_normalized, data_confidence: d.confidence || null, source_url: d.source_url || null };
    const dec = decide("property", rec, incoming, "data_confidence");
    if (dec.action === "unchanged") { push("Property_Updates", r, "property_update", "unchanged", d.property_key, rec, null, ref.id); continue; }
    if (dec.changed) dec.changed.updated_by = ctx.adminId;
    push("Property_Updates", r, "property_update", dec.action, d.property_key, rec, dec.changed, ref.id, dec.err ? [dec.err] : []);
    if (dec.action === "update" && (d.field_name === "asking_price" || d.field_name === "listing_status")) {
      const lid = ctx.genId();
      push("Property_Updates", { data: {}, errors: [], rowNumber: r.rowNumber }, "listing", "insert", "listing:" + ref.id + ":" + (d.effective_date || ctx.today) + ":" + r.rowNumber, null, {
        id: lid, property_id: ref.id, listing_source: "import",
        asking_price: d.field_name === "asking_price" ? d.new_value_normalized : rec.asking_price || null,
        listing_status: d.field_name === "listing_status" ? d.new_value_normalized : rec.listing_status || null,
        changed_on: d.effective_date || ctx.today, confidence: d.confidence || null, source_url: d.source_url || null,
      }, lid);
    }
    planSource("Property_Updates", r);
  }

  // ── Property_Contacts / Loans / Tenants / Distress / Programs / Actions ──
  function needProp(sheet, r, cell) {
    const ref = resolvePropertyKey(parsePropertyKeyCell(cell));
    if (!ref) push(sheet, r, SHEETS[sheet].target, "invalid", cell, null, null, null, ["Property_Key not found: " + cell]);
    return ref;
  }
  for (const r of rows.Property_Contacts || []) {
    if (r.errors.length) { push("Property_Contacts", r, "property_contact", "invalid"); continue; }
    const d = r.data;
    const p = needProp("Property_Contacts", r, d.property_key); if (!p) continue;
    const cRef = resolveContactKey(parseContactKeyCell(d.contact_key));
    if (!cRef) { push("Property_Contacts", r, "property_contact", "invalid", d.contact_key, null, null, null, ["Contact_Key not found: " + d.contact_key]); continue; }
    const key = "pc:" + p.id + ":" + cRef.id + ":" + d.relationship_role;
    if (seen.has(key)) { push("Property_Contacts", r, "property_contact", "invalid", key, null, null, null, ["duplicate link row in this file"]); continue; }
    seen.add(key);
    const hit = maps.propertyContacts.get(key);
    const rec = { property_id: p.id, crm_contact_id: cRef.id, relationship_role: d.relationship_role,
      is_primary: d.is_primary === true, confidence: d.confidence, source_url: d.source_url };
    if (!hit) { const id = ctx.genId(); push("Property_Contacts", r, "property_contact", "insert", key, null, Object.assign({ id }, rec), id); }
    else {
      const dec = decide("property_contact", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Property_Contacts", r, "property_contact", "unchanged", key, hit.record, null, hit.id);
      else push("Property_Contacts", r, "property_contact", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Property_Contacts", r);
  }
  for (const r of rows.Loans || []) {
    if (r.errors.length) { push("Loans", r, "loan", "invalid"); continue; }
    const d = r.data;
    const p = needProp("Loans", r, d.property_key); if (!p) continue;
    const lRef = d.lender_contact_key ? resolveContactKey(parseContactKeyCell(d.lender_contact_key)) : null;
    const keys = [d.instrument_number && ("instr:" + normId(d.instrument_number)), d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      "nat:" + p.id + ":" + (lRef ? lRef.id : (normText(d.lender_contact_key) || "")) + ":" + (d.recorded_date || "") + ":" + (d.original_amount ?? "")].filter(Boolean);
    if (keys.some((k) => seen.has("l|" + k))) { push("Loans", r, "loan", "invalid", keys[0], null, null, null, ["duplicate loan row in this file"]); continue; }
    keys.forEach((k) => seen.add("l|" + k));
    const hit = keys.map((k) => maps.loans.get(k)).find(Boolean);
    // lender_name_snapshot is a FALLBACK display name for loans with no CRM
    // match. When a contact resolves, the FK supplies the name and the
    // snapshot stays null — and it must never be an email or key string.
    var lenderSnap = null;
    if (!lRef && d.lender_contact_key && d.lender_contact_key.indexOf("@") < 0 && d.lender_contact_key.indexOf(":") < 0) {
      lenderSnap = normText(d.lender_contact_key);
    }
    const rec = { external_id: d.external_id, property_id: p.id, lender_contact_id: lRef ? lRef.id : null,
      lender_name_snapshot: lenderSnap,
      lien_position: d.lien_position, original_amount: d.original_amount, recorded_date: d.recorded_date,
      instrument_number: d.instrument_number, estimated_balance: d.estimated_balance,
      interest_rate_pct: d.interest_rate_pct, rate_type: d.rate_type, maturity_date: d.maturity_date,
      maturity_basis: d.maturity_basis, loan_type: d.loan_type, recourse: d.recourse, dscr: d.dscr,
      ltv_pct: d.ltv_pct, status: d.status, confidence: d.confidence, source_url: d.source_url, notes: d.notes };
    if (!hit) { const id = ctx.genId(); const ins = Object.assign({ id }, rec); Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; }); push("Loans", r, "loan", "insert", keys[0], null, ins, id); }
    else {
      const dec = decide("loan", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Loans", r, "loan", "unchanged", keys[0], hit.record, null, hit.id);
      else push("Loans", r, "loan", dec.action, keys[0], hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Loans", r);
  }
  for (const r of rows.Tenants || []) {
    if (r.errors.length) { push("Tenants", r, "tenant", "invalid"); continue; }
    const d = r.data;
    const p = needProp("Tenants", r, d.property_key); if (!p) continue;
    const key = "t:" + p.id + ":" + (normText(d.tenant_name) || "").toUpperCase() + ":" + ((normText(d.suite) || "").toUpperCase());
    if (seen.has(key)) { push("Tenants", r, "tenant", "invalid", key, null, null, null, ["duplicate tenant row in this file"]); continue; }
    seen.add(key);
    const hit = maps.tenants.get(key);
    const rec = { property_id: p.id, tenant_name: d.tenant_name, suite: d.suite, leased_sf: d.leased_sf,
      lease_start: d.lease_start, lease_expiration: d.lease_expiration, annual_rent: d.annual_rent,
      market_rent: d.market_rent, category: d.category, credit_quality: d.credit_quality,
      rollover_risk: d.rollover_risk, confidence: d.confidence, source_url: d.source_url, notes: d.notes };
    if (!hit) { const id = ctx.genId(); const ins = Object.assign({ id }, rec); Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; }); push("Tenants", r, "tenant", "insert", key, null, ins, id); }
    else {
      const dec = decide("tenant", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Tenants", r, "tenant", "unchanged", key, hit.record, null, hit.id);
      else push("Tenants", r, "tenant", dec.action, key, hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Tenants", r);
  }
  for (const r of rows.Distress_Signals || []) {
    if (r.errors.length) { push("Distress_Signals", r, "distress_signal", "invalid"); continue; }
    const d = r.data;
    const p = needProp("Distress_Signals", r, d.property_key); if (!p) continue;
    const keys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      "nat:" + p.id + ":" + d.signal_type + ":" + (d.event_date || "") + ":" + (normId(d.case_or_instrument_no || ""))].filter(Boolean);
    if (keys.some((k) => seen.has("s|" + k))) { push("Distress_Signals", r, "distress_signal", "invalid", keys[0], null, null, null, ["duplicate signal row in this file"]); continue; }
    keys.forEach((k) => seen.add("s|" + k));
    const hit = keys.map((k) => maps.signals.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, property_id: p.id, signal_type: d.signal_type,
      event_date: d.event_date, status: d.status, case_or_instrument_no: d.case_or_instrument_no,
      amount: d.amount, summary: d.summary, confidence: d.confidence, source_url: d.source_url, source_title: d.source_title };
    if (!hit) { const id = ctx.genId(); const ins = Object.assign({ id }, rec); Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; }); push("Distress_Signals", r, "distress_signal", "insert", keys[0], null, ins, id); }
    else {
      const dec = decide("distress_signal", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Distress_Signals", r, "distress_signal", "unchanged", keys[0], hit.record, null, hit.id);
      else push("Distress_Signals", r, "distress_signal", dec.action, keys[0], hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Distress_Signals", r);
  }
  for (const r of rows.Lender_Programs || []) {
    if (r.errors.length) { push("Lender_Programs", r, "lender_program", "invalid"); continue; }
    const d = r.data;
    const lRef = resolveContactKey(parseContactKeyCell(d.lender_contact_key));
    var lenderName = null;
    if (lRef) {
      var pn = lRef.record ? { name: lRef.record.name, company: lRef.record.company } : newContactNames.get(lRef.id);
      if (pn) lenderName = pn.company || pn.name || null;
    }
    if (!lenderName) {
      var rawL = normText(d.lender_contact_key || "").replace(/^(email|ext|name)\s*:/i, "").trim();
      lenderName = rawL && rawL.indexOf("@") < 0 ? rawL : null;
    }
    const keys = [d.external_id && ("ext:" + normText(d.external_id).toUpperCase()),
      "nat:" + String(lenderName || "").toUpperCase() + ":" + ((normText(d.program_name) || "").toUpperCase())].filter(Boolean);
    if (keys.some((k) => seen.has("g|" + k))) { push("Lender_Programs", r, "lender_program", "invalid", keys[0], null, null, null, ["duplicate program row in this file"]); continue; }
    keys.forEach((k) => seen.add("g|" + k));
    const hit = keys.map((k) => maps.programs.get(k)).find(Boolean);
    const rec = { external_id: d.external_id, lender_contact_id: lRef ? lRef.id : null,
      lender_name_snapshot: lenderName || "Unknown Lender", program_name: d.program_name,
      capital_source_type: d.capital_source_type, florida_appetite: d.florida_appetite,
      retail_appetite: d.retail_appetite, stabilized_or_value_add: d.stabilized_or_value_add,
      min_loan: d.min_loan, max_loan: d.max_loan, max_ltv_pct: d.max_ltv_pct, max_ltc_pct: d.max_ltc_pct,
      min_dscr: d.min_dscr, recourse: d.recourse, interest_only: d.interest_only,
      term_months: d.term_months, amortization_years: d.amortization_years, rate_guidance: d.rate_guidance,
      fees: d.fees, prepayment: d.prepayment, active_status: d.active_status || "active",
      last_verified_at: d.last_verified_at ? d.last_verified_at + "T00:00:00Z" : null,
      confidence: d.confidence, source_url: d.source_url, notes: d.notes };
    if (!hit) { const id = ctx.genId(); const ins = Object.assign({ id }, rec); Object.keys(ins).forEach((k) => { if (ins[k] === null) delete ins[k]; }); push("Lender_Programs", r, "lender_program", "insert", keys[0], null, ins, id); }
    else {
      const dec = decide("lender_program", hit.record || {}, rec, "confidence");
      if (dec.action === "unchanged") push("Lender_Programs", r, "lender_program", "unchanged", keys[0], hit.record, null, hit.id);
      else push("Lender_Programs", r, "lender_program", dec.action, keys[0], hit.record || null, dec.changed, hit.id, dec.err ? [dec.err] : []);
    }
    planSource("Lender_Programs", r);
  }
  for (const r of rows.Daily_Actions || []) {
    if (r.errors.length) { push("Daily_Actions", r, "daily_action", "invalid"); continue; }
    const d = r.data;
    let pid = null, cid = null;
    if (d.property_key) { const p = resolvePropertyKey(parsePropertyKeyCell(d.property_key)); if (p) pid = p.id; }
    if (d.contact_key) { const cRef = resolveContactKey(parseContactKeyCell(d.contact_key)); if (cRef) cid = cRef.id; }
    const key = "a:" + (d.action_type || "") + ":" + (pid || "") + ":" + String(d.action).toUpperCase().slice(0, 120);
    if (seen.has(key) || maps.openActions.has(key)) { push("Daily_Actions", r, "daily_action", "unchanged", key, null, null, null, ["identical open action already exists"]); continue; }
    seen.add(key);
    const id = ctx.genId();
    const ins = { id, priority: d.priority, action_type: d.action_type, property_id: pid, contact_id: cid,
      due_date: d.due_date, action: d.action, reason: d.reason, notes: d.notes, status: "open" };
    Object.keys(ins).forEach((k) => { if (ins[k] === null || ins[k] === undefined) delete ins[k]; });
    push("Daily_Actions", r, "daily_action", "insert", key, null, ins, id);
  }

  const conflicts = out.filter((r) => r.proposed_action === "conflict");
  const errors = out.filter((r) => r.proposed_action === "invalid");
  return { rows: out, summary: sum, conflicts, errors };
}

module.exports = {
  MAX_FILE_BYTES, CONFIDENCE, SHEETS, SIGNAL_TYPES, RELATIONSHIP_ROLES,
  TIME_VARYING, PROPERTY_UPDATE_FIELDS,
  confidenceRank, normText, normNumber, normPercent, normInt, normDate, normBool,
  normConfidence, normUrl, normalizeAddress, propertyKeyOf, contactKeyOf,
  parsePropertyKeyCell, parseContactKeyCell, normalizeUrlKey, normHeader,
  isZipMagic, isLegacyCfb, hasVbaProject, checkFile, normalizeRow,
  recommendationFor, planActions,
};
