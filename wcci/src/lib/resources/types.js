// Type documentation for the Site Registry (JSDoc — this stack is plain JS).
// These typedefs are the contract every registry entry and router result obeys.

/**
 * @typedef {(
 *   'corporate_trust' | 'state_mortgage' | 'local_mortgage' |
 *   'mortgage_education' | 'scenario_tool' | 'secure_application' |
 *   'private_real_estate_capital' | 'investor_capital' |
 *   'professional_network' | 'digital_assets' | 'development_proof' |
 *   'internal_platform'
 * )} ResourceCategory
 */

/**
 * @typedef {(
 *   'consumer_borrower' | 'homebuyer' | 'homeowner' | 'real_estate_investor' |
 *   'private_lender' | 'qualified_investor' | 'developer' |
 *   'mortgage_professional' | 'real_estate_professional' |
 *   'capital_professional' | 'internal_user'
 * )} ResourceAudience
 */

/**
 * @typedef {Object} LocalizedText
 * @property {string} en
 * @property {string} es
 * @property {string} ru
 */

/**
 * A verified page/site the assistant may recommend. The model only ever emits
 * a resource `id`; the URL is resolved from this object by the app — never by
 * the model.
 *
 * @typedef {Object} SiteResource
 * @property {string} id                      Stable ID (kebab-case).
 * @property {string} brand                   Human brand name.
 * @property {string} title                   Page title.
 * @property {string} canonicalUrl            Full https URL (canonical only).
 * @property {string} domain                  Canonical domain.
 * @property {string[]} [aliases]             Alias domains — normalize, never show as separate companies.
 * @property {ResourceCategory} category
 * @property {ResourceAudience[]} audiences   Who may ever see this resource.
 * @property {string[]} [states]              2-letter codes this page serves.
 * @property {string[]} [counties]            Lowercase county names (no "county" suffix).
 * @property {string[]} [cities]              Lowercase city/market names.
 * @property {string[]} topics                Topic tags (jumbo, dscr, bridge, notes_investing, …).
 * @property {string[]} [trustIntents]        identity | licensing | privacy | company_background | development_credibility
 * @property {string[]} [stages]              Conversation stages where it fits.
 * @property {string[]} [languages]           Content languages (['en'] unless verified otherwise).
 * @property {number} priority                Higher wins ties.
 * @property {boolean} autoRoute              May the router surface it proactively?
 * @property {string[]} [neverAutoRouteFor]   Audiences that must never see it.
 * @property {LocalizedText} actionLabel      Card button label.
 * @property {LocalizedText} shortDescription One-sentence relevance description.
 * @property {boolean} verified               Only verified resources ever render.
 * @property {string} [lastVerifiedAt]        ISO date from the sync script.
 */

/**
 * @typedef {Object} ResourceRecommendation
 * @property {string} id        Registry resource id.
 * @property {string} reason    Localized one-sentence reason (model- or router-supplied).
 * @property {string} [reasonKey] Router's deterministic reason key.
 */

export {}; // module marker — typedefs only
