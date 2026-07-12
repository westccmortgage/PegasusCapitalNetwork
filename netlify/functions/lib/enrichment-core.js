// ============================================================================
// PEGASUS — Enrichment core (pure logic, no I/O)
// Whitelisted enrichment targets per entity, borrower/PII guard, and proposal
// validation. Enrichment NEVER fabricates: a proposal with a value MUST carry a
// source URL (and license/email/phone values are rejected without one).
// ============================================================================
"use strict";

const icore = require("./intelligence-import-core.js");
const mapper = require("./import-mapper-core.js");

// Entity → { table, targets:[{field,label}], allow:Set }.
const ENTITIES = {
  agent: {
    table: "pn_agents",
    targets: [
      ["license_number", "California DRE license #"],
      ["license_status", "DRE license status"],
      ["company_name_snapshot", "Brokerage / company"],
      ["website", "Public company website"],
      ["linkedin_url", "Public LinkedIn profile URL"],
      ["email", "Public business email"],
      ["phone", "Public business phone"],
      ["service_areas", "Service area"],
      ["specialty", "Specialties"],
      ["activity_evidence", "Recent listings / buyer-side closings"],
      ["buyer_side_relevance", "Buyer-side relevance"],
      ["production_tier", "Estimated production tier"],
      ["notes", "Awards / public recognition"],
    ],
  },
  escrow_title: {
    table: "pn_escrow_title",
    targets: [
      ["license_number", "License / entity ID"],
      ["license_status", "License status"],
      ["organization_type", "Organization type"],
      ["company_name_snapshot", "Company"],
      ["website", "Public company website"],
      ["linkedin_url", "Public LinkedIn profile URL"],
      ["email", "Public business email"],
      ["phone", "Public business phone"],
      ["service_areas", "Service area"],
      ["notes", "Awards / public recognition"],
    ],
  },
  company: {
    table: "pn_companies",
    targets: [
      ["company_type", "Company type"],
      ["website", "Public company website"],
      ["email", "Public business email"],
      ["phone", "Public business phone"],
      ["address_line1", "Address"],
      ["city", "City"],
      ["specialty", "Specialties"],
      ["agent_count", "Agent count"],
      ["notes", "Awards / public recognition"],
    ],
  },
};
Object.keys(ENTITIES).forEach((k) => { ENTITIES[k].allow = new Set(ENTITIES[k].targets.map((t) => t[0])); });

// Fields whose VALUE must never be guessed — a proposal without a source URL is
// rejected outright.
const NEVER_GUESS = new Set(["license_number", "license_status", "email", "phone", "linkedin_url"]);

function confRank(c) { return { Verified: 4, Reported: 3, Estimated: 2, Unknown: 1 }[c] || 0; }

// Validate one provider proposal. Returns { ok, field?, error? }.
function validateProposal(entityType, p) {
  const ent = ENTITIES[entityType];
  if (!ent) return { ok: false, error: "unknown entity type" };
  const field = String(p.target_field || p.field || "").trim();
  if (!ent.allow.has(field)) return { ok: false, error: "field '" + field + "' is not an allowed enrichment target" };
  // Borrower/consumer PII guard.
  if (mapper.borrowerFieldsPresent([{ headers: [field, String(p.label || "")] }]).length)
    return { ok: false, error: "borrower/consumer field rejected" };
  const value = p.proposed_value == null ? null : String(p.proposed_value).trim();
  const src = p.source_url == null ? null : String(p.source_url).trim();
  if (value) {
    // Any proposed VALUE must carry a source URL; never-guess fields especially.
    if (!src) return { ok: false, error: "proposed value for '" + field + "' has no source URL — rejected (never guess)" };
    if (!/^https?:\/\//i.test(src)) return { ok: false, error: "source URL must be http(s)" };
    if (NEVER_GUESS.has(field) && !p.confidence) return { ok: false, error: "'" + field + "' requires an explicit confidence" };
  }
  return {
    ok: true,
    field: {
      target_field: field, label: p.label || (ent.targets.find((t) => t[0] === field) || [])[1] || field,
      proposed_value: value, source_url: src || null,
      confidence: p.confidence && confRank(p.confidence) ? p.confidence : null,
      last_verified_date: p.last_verified_date || null,
    },
  };
}

// The standard enrichment worksheet for an entity: one row per target, seeded
// with the current value (proposed_value left blank — the admin/provider fills
// it with a sourced value). No fabrication.
function worksheet(entityType, record) {
  const ent = ENTITIES[entityType];
  if (!ent) return [];
  return ent.targets.map(([field, label]) => ({
    target_field: field, label: label,
    proposed_value: null, current_value: record && record[field] != null ? String(record[field]) : null,
    source_url: null, confidence: null, last_verified_date: null,
  }));
}

module.exports = { ENTITIES, NEVER_GUESS, confRank, validateProposal, worksheet };
