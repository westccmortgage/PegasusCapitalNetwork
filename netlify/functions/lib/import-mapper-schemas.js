// ============================================================================
// PEGASUS — Universal Import Mapper: per-module descriptors
// netlify/functions/lib/import-mapper-schemas.js
//
// Each module gets its OWN descriptor: target entities, field aliases, required
// flags, enum transforms, dedupe/fuzzy keys, and the module's native planner +
// contract. The mapper engine is otherwise module-agnostic and NEVER mixes
// records. detectModule() decides which module a file most likely belongs to
// (for the wrong-module guard).
// ============================================================================
"use strict";

const pcore = require("./partner-import-core.js");
const icore = require("./intelligence-import-core.js");

// Build an entity's field list from the module's native contract + an alias map.
// contractSheet: name in moduleCore.SHEETS. skip: contract keys to exclude
// (reference keys resolved by the planner, not directly mappable).
function buildEntity(moduleCore, contractSheet, opts) {
  opts = opts || {};
  const spec = moduleCore.SHEETS[contractSheet];
  const skipKeys = opts.skip || [];
  const aliasMap = opts.aliases || {};
  const transforms = opts.transforms || {};
  const fields = [];
  for (const [header, key, type] of spec.columns) {
    if (skipKeys.includes(key)) continue;
    fields.push({
      target: header,
      key: key,
      type: type,
      required: spec.required.includes(key),
      aliases: aliasMap[header] || [],
      transform: transforms[header] || null,
    });
  }
  return {
    contractSheet: contractSheet,
    fields: fields,
    detectHints: opts.detectHints || [],
    nameField: opts.nameField || null,
    companyField: opts.companyField || null,
  };
}

// ── California Partner Network descriptor ────────────────────────────────────
const PARTNER = {
  module: "partner",
  label: "California Partner Network",
  route: "/admin/partner-network",
  normalizeRow: pcore.normalizeRow,
  planActions: pcore.planActions,
  foreignError: pcore.foreignWorkbookError,
  entities: {
    Agents: buildEntity(pcore, "Agents", {
      nameField: "Full_Name", companyField: "Company",
      detectHints: ["agent", "realtor", "dre", "license", "brokerage", "producer"],
      transforms: { Priority: "priority" },
      aliases: {
        Full_Name: ["name", "full name", "agent name", "realtor name", "agent", "contact name", "rep name", "licensee name", "licensee", "first name", "last name", "first name last name"],
        Company: ["brokerage", "office", "company name", "firm", "company", "brokerage name", "brokerage/office"],
        License_Number: ["dre", "dre number", "license #", "license number", "license", "dre #", "lic", "lic #", "dre lic", "dre license id", "dre_license_id"],
        License_Status: ["license status", "dre status", "status of license"],
        Job_Title: ["title", "job title", "position", "designation"],
        Email: ["email address", "work email", "e-mail", "business email", "email", "public email", "public_email"],
        Phone: ["cell", "mobile", "business phone", "telephone", "direct", "cell phone", "phone number", "phone", "public phone", "public_phone"],
        Website: ["url", "web", "website", "profile url"],
        LinkedIn_URL: ["linkedin", "linkedin url", "linkedin_url"],
        City: ["area", "territory", "location", "city"],
        County: ["county"],
        Service_Areas: ["service areas", "areas served", "coverage", "service area", "markets"],
        Specialty: ["focus", "niche", "segment", "expertise", "specialty", "specialties", "specialization"],
        Production_Volume: ["volume", "sales", "production", "gci", "sales volume", "annual volume", "production volume", "$ volume"],
        Production_Tier: ["estimated production tier", "production tier", "tier"],
        Deal_Count: ["transactions", "sides", "deals", "closings", "units", "transaction count", "deal count", "# of deals"],
        Activity_Evidence: ["recent activity evidence", "activity evidence", "recent activity", "evidence"],
        Buyer_Side_Relevance: ["buyer side relevance", "buyer-side relevance", "buyer relevance"],
        Partner_Score: ["partner potential score", "partner score", "partner potential", "score"],
        Why_Relevant: ["why relevant", "why", "rationale"],
        Next_Step: ["recommended next step", "next step", "suggested next step"],
        Connection_Note: ["connection note", "intro note", "outreach note"],
        Priority: ["priority", "rank", "tier"],
        Status: ["active", "status"],
        Tags: ["labels", "tags"],
        External_ID: ["id", "source id", "record id", "external id"],
        Notes: ["comments", "note", "notes"],
        Source_URL: ["source", "source url", "source link"],
        Last_Verified_Date: ["last verified date", "last verified", "verified date"],
      },
    }),
    Escrow_Title: buildEntity(pcore, "Escrow_Title", {
      nameField: "Officer_Name", companyField: "Company",
      detectHints: ["escrow", "title", "officer", "settlement"],
      transforms: { Priority: "priority" },
      aliases: {
        Officer_Name: ["name", "officer", "escrow officer", "officer name", "title officer", "title rep", "contact", "settlement officer", "licensee name"],
        Company: ["company", "brokerage", "office", "escrow company", "title company", "firm", "company name"],
        Organization_Type: ["organization type", "org type", "entity type", "company type"],
        Regulator: ["regulator", "regulatory body", "agency", "regulated by"],
        Role: ["role", "title rep", "title officer", "escrow officer", "type", "position"],
        License_Number: ["license", "license number", "lic", "escrow license", "dre", "license or entity id", "entity id", "license id", "nmls"],
        License_Status: ["license status", "status of license"],
        Email: ["email", "email address", "work email", "e-mail", "public email", "public_email"],
        Phone: ["phone", "cell", "mobile", "business phone", "direct", "phone number", "public phone", "public_phone"],
        Website: ["website", "url", "web"],
        LinkedIn_URL: ["linkedin", "linkedin url", "linkedin_url"],
        City: ["city", "area", "location", "region"],
        County: ["county"],
        Service_Areas: ["service areas", "areas served", "coverage", "service area"],
        Transaction_Volume: ["volume", "transaction volume", "escrow volume", "closings"],
        Partner_Score: ["partner potential score", "partner score", "partner potential", "score"],
        Why_Relevant: ["why relevant", "why", "rationale"],
        Next_Step: ["recommended next step", "next step"],
        Connection_Note: ["connection note", "intro note"],
        Priority: ["priority", "rank", "tier"],
        Status: ["status", "active"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id", "source id"],
        Last_Verified_Date: ["last verified date", "last verified", "verified date"],
      },
    }),
    Companies: buildEntity(pcore, "Companies", {
      nameField: "Company_Name",
      detectHints: ["brokerage", "company", "office", "firm", "escrow", "title"],
      aliases: {
        Company_Name: ["company", "company name", "brokerage", "office", "firm", "name", "organization", "brokerage name"],
        Company_Type: ["type", "company type", "category", "kind"],
        Address: ["address", "street", "street address"],
        City: ["city", "area", "location"],
        State: ["state", "st"],
        ZIP: ["zip", "postal", "zip code", "postal code"],
        Phone: ["phone", "telephone", "main phone"],
        Email: ["email", "email address"],
        Website: ["website", "url", "domain", "web", "site"],
        Agent_Count: ["agents", "agent count", "size", "headcount", "# agents", "number of agents"],
        Specialty: ["specialty", "focus", "niche"],
        Status: ["status", "active"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id", "entity id", "license", "entity number"],
      },
    }),
    Activity_Signals: buildEntity(pcore, "Activity_Signals", {
      nameField: "Subject_Name",
      detectHints: ["activity", "signal", "event", "listing", "sale", "closed"],
      transforms: { Signal_Type: "signal_type" },
      aliases: {
        Subject_Name: ["contact", "subject", "agent name", "name", "subject name", "agent", "who"],
        Subject_Key: ["contact key", "contact_key", "subject key", "contact id", "ref"],
        Subject_Type: ["subject type", "type of subject", "contact type", "contact_type"],
        Signal_Type: ["signal type", "activity", "event", "type", "headline", "category", "recent sale", "closed transaction", "new listing", "price reduction"],
        Signal_Date: ["date", "signal date", "event date", "when", "activity date"],
        Detail: ["detail", "details", "description", "summary", "headline", "note"],
        Market: ["property or market", "property/market", "market", "property", "location"],
        Relevance: ["relevance", "why relevant", "significance"],
        URL: ["url", "link", "source"],
        Source_URL: ["source", "source url"],
        Source_Title: ["source title", "publisher"],
        External_ID: ["id", "external id"],
      },
    }),
    Outreach_Actions: buildEntity(pcore, "Outreach_Actions", {
      nameField: "Subject_Name",
      detectHints: ["outreach", "task", "follow up", "action", "next step"],
      transforms: { Priority: "priority" },
      aliases: {
        Subject_Name: ["contact", "subject", "agent name", "name", "who"],
        Subject_Key: ["contact key", "contact_key", "subject key", "contact id", "ref"],
        Subject_Type: ["subject type", "type of subject", "contact type", "contact_type"],
        Action: ["message", "task", "next step", "action", "todo", "to-do", "to do", "activity", "step"],
        Priority: ["urgency", "rank", "tier", "priority", "importance", "level"],
        Action_Type: ["action type", "type", "kind"],
        Channel: ["channel", "method", "via"],
        Due_Date: ["due date", "due", "follow up date", "date", "when", "followup"],
        Reason: ["reason", "why", "context"],
        Status: ["status"],
        Notes: ["notes", "note", "comments"],
        External_ID: ["id", "external id"],
      },
    }),
    Do_Not_Contact: buildEntity(pcore, "Do_Not_Contact", {
      nameField: "Subject_Name",
      detectHints: ["do not contact", "dnc", "suppress", "opt out", "unsubscribe"],
      aliases: {
        Subject_Name: ["name", "subject", "contact", "do not contact", "agent name"],
        Subject_Type: ["subject type", "type"],
        Company: ["company", "brokerage", "office"],
        Email: ["email", "email address"],
        Phone: ["phone", "cell", "mobile"],
        Scope: ["scope", "channel"],
        Reason: ["reason", "why", "notes"],
        Effective_Date: ["date", "effective date", "since", "as of"],
        Expires_Date: ["expires", "expires date", "until"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id"],
      },
    }),
  },
};

// Partner Network rejects consumer/borrower lead data.
PARTNER.rejectBorrower = true;

// Cross-sheet reference resolution (runs in the mapper BEFORE schema
// validation): resolve Activity/Outreach Contact_Key → subject_name from the
// same-batch Agents/Escrow_Title records (by External_ID, then normalized name).
PARTNER.resolveReferences = function (canonical, warnings) {
  const norm = (s) => String(s == null ? "" : s).trim().toUpperCase();
  const normName = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const byExt = {}, byName = {};
  (canonical.Agents || []).forEach((a) => {
    if (a.External_ID) byExt[norm(a.External_ID)] = { name: a.Full_Name, type: "agent" };
    if (a.Full_Name) byName[normName(a.Full_Name)] = { name: a.Full_Name, type: "agent" };
  });
  (canonical.Escrow_Title || []).forEach((e) => {
    if (e.External_ID) byExt[norm(e.External_ID)] = { name: e.Officer_Name, type: "escrow_title" };
    if (e.Officer_Name) byName[normName(e.Officer_Name)] = { name: e.Officer_Name, type: "escrow_title" };
  });
  ["Activity_Signals", "Outreach_Actions"].forEach((cs) => {
    (canonical[cs] || []).forEach((rec, i) => {
      const hasName = rec.Subject_Name && String(rec.Subject_Name).trim() !== "";
      if (hasName || !rec.Subject_Key) return;
      const hit = byExt[norm(rec.Subject_Key)] || byName[normName(rec.Subject_Key)];
      if (hit) { rec.Subject_Name = hit.name; if (!rec.Subject_Type) rec.Subject_Type = hit.type; }
      else warnings.push({ sheet: cs, row: i + 2, message: 'Contact_Key "' + rec.Subject_Key + '" did not match any Agent or Escrow/Title in this workbook.' });
    });
  });
};

// ── Capital Intelligence descriptor (Palm Beach CRE) ─────────────────────────
const INTELLIGENCE = {
  module: "intelligence",
  label: "Capital Intelligence (Palm Beach)",
  route: "/admin/intelligence",
  normalizeRow: icore.normalizeRow,
  planActions: icore.planActions,
  foreignError: icore.foreignWorkbookError,
  entities: {
    Properties: buildEntity(icore, "Properties", {
      nameField: "Property_Name", companyField: "City",
      detectHints: ["property", "parcel", "asking", "noi", "cap rate", "retail", "plaza", "center"],
      skip: [],
      aliases: {
        Property_Name: ["property name", "name", "property", "asset", "plaza", "center name"],
        Address: ["address", "street", "street address", "location"],
        City: ["city", "town"],
        State: ["state", "st"],
        ZIP: ["zip", "postal", "zip code"],
        County: ["county"],
        Parcel_ID: ["parcel", "parcel id", "apn", "folio", "pcn"],
        Asking_Price: ["asking price", "price", "list price", "asking"],
        NOI: ["noi", "net operating income"],
        Cap_Rate_Pct: ["cap rate", "cap", "cap rate %", "caprate"],
        Occupancy_Pct: ["occupancy", "occ", "occupancy %"],
        Building_SF: ["building sf", "sf", "square feet", "gla", "size"],
        Anchor_Tenant: ["anchor", "anchor tenant"],
        Listing_Status: ["listing status", "status"],
        Listing_URL: ["listing url", "listing", "url"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id"],
      },
    }),
    Contacts: buildEntity(icore, "Contacts", {
      nameField: "Name", companyField: "Company",
      detectHints: ["broker", "owner", "principal", "contact", "lender", "attorney"],
      aliases: {
        Name: ["name", "full name", "contact name", "broker name"],
        Company: ["company", "firm", "brokerage", "office"],
        Job_Title: ["title", "job title", "position"],
        Contact_Type: ["contact type", "role", "type"],
        Email: ["email", "email address", "e-mail"],
        Phone: ["phone", "cell", "mobile", "telephone"],
        Website: ["website", "url"],
        LinkedIn_URL: ["linkedin", "linkedin url"],
        City: ["city", "area"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id"],
      },
    }),
    Loans: buildEntity(icore, "Loans", {
      nameField: null,
      detectHints: ["loan", "lender", "maturity", "instrument", "lien", "cmbs", "balance"],
      skip: ["property_key", "lender_contact_key"],
      aliases: {
        Original_Amount: ["original amount", "loan amount", "amount", "original balance"],
        Estimated_Balance: ["estimated balance", "balance", "current balance", "upb"],
        Interest_Rate_Pct: ["interest rate", "rate", "coupon"],
        Maturity_Date: ["maturity", "maturity date", "matures"],
        Instrument_Number: ["instrument", "instrument number", "instrument no", "recording number"],
        Recording_Jurisdiction: ["recording jurisdiction", "jurisdiction", "county recorded"],
        Loan_Type: ["loan type", "type"],
        Status: ["status"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id"],
      },
    }),
    Lender_Programs: buildEntity(icore, "Lender_Programs", {
      nameField: "Program_Name",
      detectHints: ["lender", "program", "capital", "debt fund", "ltv", "dscr", "loan program"],
      skip: ["lender_contact_key"],
      aliases: {
        Program_Name: ["program name", "program", "product"],
        Capital_Source_Type: ["capital source", "source type", "capital type"],
        Min_Loan: ["min loan", "minimum loan", "min"],
        Max_Loan: ["max loan", "maximum loan", "max"],
        Max_LTV_Pct: ["max ltv", "ltv", "max ltv %"],
        Min_DSCR: ["min dscr", "dscr", "minimum dscr"],
        Rate_Guidance: ["rate", "rate guidance", "pricing"],
        Source_URL: ["source", "source url"],
        External_ID: ["id", "external id"],
      },
    }),
  },
};

const DESCRIPTORS = { partner: PARTNER, intelligence: INTELLIGENCE };

// Best entity score a set of sheets achieves against a descriptor.
function bestScore(sheets, descriptor) {
  const mapper = require("./import-mapper-core.js");
  let best = 0;
  for (const sheet of (sheets || [])) {
    const det = mapper.detectEntity(sheet, descriptor);
    if (det[0] && det[0].score > best) best = det[0].score;
  }
  return best;
}

// Decide the most likely module for a file, and whether it clearly belongs to
// the OTHER module than the one the admin is importing into.
//   sheets: [{name, headers, rows}]
//   currentModule: 'partner' | 'intelligence'
// Returns { belongs, currentScore, otherScore, wrongModule, otherLabel, otherRoute, exactForeign }
function detectModule(sheets, currentModule) {
  const cur = DESCRIPTORS[currentModule];
  const otherKey = currentModule === "partner" ? "intelligence" : "partner";
  const other = DESCRIPTORS[otherKey];
  const sheetNames = (sheets || []).map((s) => s.name);
  // Exact Pegasus-header signal (native workbook of the other module).
  const exactForeign = cur.foreignError(sheetNames);
  const currentScore = bestScore(sheets, cur);
  const otherScore = bestScore(sheets, other);
  const wrongModule = !!exactForeign || (otherScore >= 0.5 && otherScore - currentScore >= 0.2);
  return {
    belongs: wrongModule ? otherKey : currentModule,
    currentScore: Math.round(currentScore * 100) / 100,
    otherScore: Math.round(otherScore * 100) / 100,
    wrongModule: wrongModule,
    otherLabel: other.label,
    otherRoute: other.route,
    exactForeign: exactForeign || null,
    message: wrongModule ? ("This workbook appears to belong to " + other.label + ". Open the correct importer (" + other.route + ").") : null,
  };
}

// ── Built-in Import Profiles (code-defined; module-isolated) ─────────────────
// A built-in profile recognizes a file by its sheet signature and supplies
// explicit value transforms (whitelisted maps) that the generic engine can't
// infer. Column→field mapping is left to alias auto-mapping (which the admin
// can still edit); the profile only pins the enum/value normalizations.
const SIGNAL_VALUE_MAP = {
  "buyer-side closing": "closed_deal", "luxury closing": "closed_deal",
  "recent closing": "closed_deal", "multiple recent closings": "closed_deal",
  "buyer-side activity": "closed_deal",
  "current local practice": "marketing", "active market presence": "marketing",
  "relationship development role": "other", "residential escrow specialization": "other",
  "association / settlement expertise": "other", "association/settlement expertise": "other",
  "current title team role": "other",
};
const SUBJECT_TYPE_MAP = {
  "residential real estate agent": "agent", "real estate agent": "agent", "agent": "agent",
  "escrow/title professional": "escrow_title", "escrow / title professional": "escrow_title",
  "escrow officer": "escrow_title", "title officer": "escrow_title", "escrow_title": "escrow_title",
};
const PRIORITY_VALUE_MAP = { a: 1, b: 2, c: 3 };

const BUILTIN_PROFILES = {
  partner: [{
    id: "builtin:chatgpt-ca-partner",
    name: "ChatGPT California Partner Research",
    description: "Built-in mapping for the ChatGPT California Partner Research workbook (Agents, Escrow_Title, Companies, Activity_Signals, Outreach_Actions, Do_Not_Contact).",
    sheetSignature: ["Agents", "Escrow_Title", "Companies", "Activity_Signals", "Outreach_Actions", "Do_Not_Contact"],
    // valueTransforms[entity][targetField] = { rawLowercased: normalized }
    valueTransforms: {
      Activity_Signals: { Signal_Type: SIGNAL_VALUE_MAP },
      Outreach_Actions: { Priority: PRIORITY_VALUE_MAP, Subject_Type: SUBJECT_TYPE_MAP },
      Agents: { Priority: PRIORITY_VALUE_MAP },
      Escrow_Title: { Priority: PRIORITY_VALUE_MAP },
    },
  }],
  intelligence: [],
};

function _nh(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s_]+/g, ""); }
// Match a file's sheets against built-in profiles for a module. Returns
// { profile, score } for the best match at or above a threshold, else null.
function matchBuiltinProfile(sheets, module) {
  const names = (sheets || []).map((s) => _nh(s.name));
  let best = null;
  for (const p of (BUILTIN_PROFILES[module] || [])) {
    const need = p.sheetSignature.map(_nh);
    const hit = need.filter((n) => names.includes(n)).length;
    const score = need.length ? hit / need.length : 0;
    if (score >= 0.6 && (!best || score > best.score)) best = { profile: p, score: Math.round(score * 100) / 100 };
  }
  return best;
}
// Overlay a built-in profile's value transforms onto an auto-mapped suggestion.
// Mutates each matching column to carry a whitelisted valueMap.
function applyBuiltinTransforms(suggestion, profile) {
  (suggestion || []).forEach((sh) => {
    const vt = profile.valueTransforms && profile.valueTransforms[sh.entity];
    if (!vt) return;
    (sh.columns || []).forEach((c) => { if (c.target && vt[c.target]) c.valueMap = vt[c.target]; });
  });
  return suggestion;
}

module.exports = {
  DESCRIPTORS, PARTNER, INTELLIGENCE, buildEntity, detectModule, bestScore,
  BUILTIN_PROFILES, matchBuiltinProfile, applyBuiltinTransforms,
};
