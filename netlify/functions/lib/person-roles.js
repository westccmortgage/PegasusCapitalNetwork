// Pegasus — people-side capital-stack taxonomy (shared by the public directory
// and the sitemap). People are REAL, consented members only — this module never
// creates or infers identities; it only groups existing public profiles into
// navigable role sections, mirroring the business directory.
//
// A profile's section/role is inferred from its own public, self-entered fields
// (role, professional_title, headline, additional_roles). No external data.

// Top-level sections, in display order.
const SECTIONS = [
  { slug: "lenders",    label: "Lenders & Loan Officers" },
  { slug: "advisors",   label: "Brokers & Advisors" },
  { slug: "realestate", label: "Real Estate" },
  { slug: "investors",  label: "Investors & Capital" },
  { slug: "services",   label: "Services & Operators" },
  { slug: "other",      label: "Other" },
];

// Roles in match priority order (specific → generic). First keyword hit wins.
const ROLES = [
  { slug: "loan-officers",      label: "Loan Officers",               section: "lenders",    match: ["loan officer","loan originator","mlo","mortgage loan originator"] },
  { slug: "real-estate-agents", label: "Real Estate Agents & Brokers", section: "realestate", match: ["real estate agent","realtor","real estate broker","real estate salesperson"] },
  { slug: "mortgage-brokers",   label: "Mortgage Brokers",            section: "advisors",   match: ["mortgage broker","broker"] },
  { slug: "developers",         label: "Developers",                  section: "realestate", match: ["real estate developer","developer","homebuilder","builder"] },
  { slug: "property-managers",  label: "Property Managers",           section: "realestate", match: ["property manager","property management"] },
  { slug: "private-lenders",    label: "Private & Hard Money Lenders", section: "lenders",    match: ["private lender","hard money","bridge lender"] },
  { slug: "financial-advisors", label: "Financial Advisors & Planners", section: "advisors", match: ["financial advisor","financial planner","wealth manager","wealth advisor","wealth management","financial advisory"] },
  { slug: "capital-advisors",   label: "Capital Advisors",            section: "advisors",   match: ["capital strategist","capital advisor","capital placement","investment banker","capital markets"] },
  { slug: "fund-managers",      label: "Fund Managers",               section: "investors",  match: ["fund manager","general partner","portfolio manager"] },
  { slug: "family-offices",     label: "Family Offices",              section: "investors",  match: ["family office"] },
  { slug: "investors",          label: "Investors & LPs",             section: "investors",  match: ["investor","limited partner","syndicator","syndication"] },
  { slug: "appraisers",         label: "Appraisers",                  section: "services",   match: ["appraiser","appraisal"] },
  { slug: "attorneys",          label: "Attorneys",                   section: "services",   match: ["attorney","lawyer","legal counsel"] },
  { slug: "accountants",        label: "Accountants & CPAs",          section: "services",   match: ["cpa","accountant","accounting"] },
  { slug: "title-escrow",       label: "Title & Escrow Officers",     section: "services",   match: ["escrow","title officer"] },
  { slug: "proptech",           label: "Proptech / Fintech",          section: "services",   match: ["proptech","fintech","tokenization","rwa"] },
  { slug: "bankers",            label: "Bankers",                     section: "lenders",    match: ["banker"] },
  { slug: "lenders",            label: "Lenders",                     section: "lenders",    match: ["lender","lending"] },
  { slug: "capital-seekers",    label: "Capital Seekers",             section: "investors",  match: ["borrower","seeking capital","capital seeker"] },
  { slug: "founders",           label: "Founders & Operators",        section: "services",   match: ["founder","ceo","entrepreneur","startup","intrapreneur","operator","owner","principal"] },
];

const SECTION_LABEL = Object.fromEntries(SECTIONS.map(s => [s.slug, s.label]));
const ROLE_BY_SLUG = Object.fromEntries(ROLES.map(r => [r.slug, r]));

function haystack(p) {
  const extra = Array.isArray(p && p.additional_roles) ? p.additional_roles.join(" ") : "";
  return [p && p.role, p && p.professional_title, p && p.headline, extra]
    .filter(Boolean).join(" ").toLowerCase().replace(/_/g, " ");
}

// Returns a role slug (never null; falls back to "other").
function classifyPerson(p) {
  const h = haystack(p);
  if (h.trim()) {
    for (const r of ROLES) {
      for (const kw of r.match) { if (h.includes(kw)) return r.slug; }
    }
  }
  return "other";
}

function sectionOf(roleSlug) {
  return (ROLE_BY_SLUG[roleSlug] && ROLE_BY_SLUG[roleSlug].section) || "other";
}
function roleLabel(roleSlug) {
  return (ROLE_BY_SLUG[roleSlug] && ROLE_BY_SLUG[roleSlug].label) || "Other";
}

// Build an ordered nav model from classified rows (each row must carry _role).
// Returns [{slug,label,total,subs:[{slug,label,n}]}] in SECTION order, with only
// non-empty roles, and sections sorted by their configured order then by count.
function buildPeopleSections(rows) {
  const counts = {};
  for (const row of rows) {
    const role = row._role || classifyPerson(row);
    const sec = sectionOf(role);
    (counts[sec] = counts[sec] || {})[role] = (counts[sec][role] || 0) + 1;
  }
  const out = [];
  for (const s of SECTIONS) {
    const roleCounts = counts[s.slug];
    if (!roleCounts) continue;
    const subs = ROLES.filter(r => r.section === s.slug && roleCounts[r.slug])
      .map(r => ({ slug: r.slug, label: r.label, n: roleCounts[r.slug] }));
    const total = subs.reduce((a, x) => a + x.n, 0);
    if (total > 0) out.push({ slug: s.slug, label: s.label, total, subs });
  }
  return out;
}

export { SECTIONS, ROLES, SECTION_LABEL, classifyPerson, sectionOf, roleLabel, buildPeopleSections };
