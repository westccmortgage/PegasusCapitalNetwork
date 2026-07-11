// ─────────────────────────────────────────────────────────────────────────────
// COMPANY FACTS — the single source of truth.
//
// Every legal fact, license number, biography date, supported state, phone,
// and disclosure used anywhere in WCCI (prompts, UI, emails, structured data)
// MUST come from this module. Do not duplicate these values elsewhere.
//
// The company NMLS (#2817729) and the founder's individual NMLS (#2775380)
// are DIFFERENT numbers and must never be interchanged.
//
// Some external marketing pages contain inconsistent biography dates or show
// an individual license where the corporation license belongs. Those
// inconsistencies must NOT be propagated here — this file is owner-approved.
// ─────────────────────────────────────────────────────────────────────────────

export const COMPANY_FACTS = {
  legalEntity: 'West Coast Capital Mortgage Inc.',
  brandNames: [
    'West Coast Capital Mortgage',
    'WCCI',
    'California Mortgage (californiamtg.com)',
    'Suncoast Capital Mortgage',
    'K West Mortgage',
    'Bel Air Financing',
    'Lunada Bay Mortgage',
    'Orange Mortgage',
    'Before Jumbo Loan',
  ],

  companyNmls: '2817729',
  companyDreCorporationLicense: '02440065',

  founderName: 'Anatoliy Kanevsky',
  founderTitle: 'California Real Estate Broker',
  founderNmls: '2775380',
  founderDreBrokerLicense: '01385024',

  // Owner-approved biography facts. External pages with other dates are wrong.
  mortgageCareerStartYear: 2004,
  brokerLicenseYear: 2009,

  officePhone: '(310) 686-5053',
  officePhoneHref: 'tel:+13106865053',
  // Florida-facing and direct lines: not yet owner-supplied. Leave null rather
  // than inventing; UI must fall back to officePhone when null.
  floridaPhone: null,
  directPhone: null,

  approvedEmails: ['leads@wcci.online'],

  // State availability comes from THIS list only — never from marketing copy.
  // The owner updates this single value to add/remove a state.
  supportedStates: ['CA', 'FL'],

  // Per-state licensing display. Only verified license identifiers may appear.
  // Florida: the entity operates a Florida-facing brand (Suncoast), but NO
  // Florida license number has been verified by the owner — so none is shown.
  licensingByState: {
    CA: {
      lines: [
        'West Coast Capital Mortgage Inc. · CA DRE Corporation License #02440065 · NMLS #2817729',
        'Anatoliy Kanevsky · California Real Estate Broker · CA DRE Broker License #01385024 · NMLS #2775380',
      ],
    },
    FL: {
      // Do NOT display an unverified Florida license number.
      lines: ['West Coast Capital Mortgage Inc. · NMLS #2817729'],
    },
  },

  canonicalCorporateDomain: 'westccmortgage.com',
  secureApplicationDomain: 'ourmtg.com',

  equalHousingLanguage: 'Equal Housing Lender',

  standardDisclosures: [
    'This is for educational and planning purposes only. It is not a mortgage application, Loan Estimate, loan approval, or commitment to lend.',
    'Actual loan terms, rates, APR, fees, mortgage insurance, reserve requirements, documentation requirements, and program availability vary by lender, borrower profile, property, market conditions, and closing date.',
  ],
};

// ── Derived display strings (kept here so formatting is also single-source) ──

export const COMPANY_LICENSE_LINE =
  `CA DRE Corporation License #${COMPANY_FACTS.companyDreCorporationLicense} · NMLS #${COMPANY_FACTS.companyNmls}`;

export const BROKER_LICENSE_LINE =
  `CA DRE Broker License #${COMPANY_FACTS.founderDreBrokerLicense} · NMLS #${COMPANY_FACTS.founderNmls}`;

// Short factual biography the assistant may state in-chat when a borrower asks
// who is behind the platform. Facts only — no dates other than owner-approved.
export function companyBio() {
  const f = COMPANY_FACTS;
  return `${f.legalEntity} is the licensed mortgage company behind this assistant (${COMPANY_LICENSE_LINE}). ` +
    `It was founded by ${f.founderName}, a ${f.founderTitle} (${BROKER_LICENSE_LINE}) whose mortgage career began in ${f.mortgageCareerStartYear}; ` +
    `he has held a California real estate broker license since ${f.brokerLicenseYear}. ` +
    `WCCI (wcci.online) is the AI-assisted scenario and education workspace operated for ${f.legalEntity} — WCCI itself is not the mortgage company. ` +
    `Office: ${f.officePhone}.`;
}

export function isSupportedState(code) {
  return COMPANY_FACTS.supportedStates.includes(String(code || '').toUpperCase());
}
