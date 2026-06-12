/**
 * markets.js
 * Config-driven market catalog.
 *
 * Each market overrides national defaults with local conforming limits,
 * effective property-tax rates, and typical insurance costs. These numbers
 * drive the "before-jumbo gap" and the payment stack.
 *
 * IMPORTANT: County conforming limits change yearly (FHFA). The values below
 * are 2025 figures and should be re-verified each December. `lastVerified`
 * and `source` exist so this stays auditable.
 *
 * To add a market: copy a block, change the id/label/limits. No code changes.
 */

import { DEFAULTS } from './defaults.js';

const L = DEFAULTS.loanLimits;

/** @typedef {Object} Market
 *  @property {string} id
 *  @property {string} label
 *  @property {string} state
 *  @property {number} conformingLimit   1-unit conforming limit for the county
 *  @property {number} [highBalanceLimit] 1-unit high-balance limit (if high-cost)
 *  @property {number} propertyTaxRatePct effective annual property tax %
 *  @property {number} homeInsuranceAnnual typical $/yr
 *  @property {string} lastVerified
 */

export const MARKETS = [
  {
    id: 'national',
    label: 'National Baseline',
    state: 'US',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: L.baselineConforming,
    propertyTaxRatePct: 1.1,
    homeInsuranceAnnual: 1800,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'la-county-ca',
    label: 'Los Angeles County, CA',
    state: 'CA',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 1209750,
    propertyTaxRatePct: 1.25,
    homeInsuranceAnnual: 1900,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'orange-county-ca',
    label: 'Orange County, CA',
    state: 'CA',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 1209750,
    propertyTaxRatePct: 1.1,
    homeInsuranceAnnual: 1900,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'san-diego-county-ca',
    label: 'San Diego County, CA',
    state: 'CA',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 1077550,
    propertyTaxRatePct: 1.05,
    homeInsuranceAnnual: 1850,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'bay-area-ca',
    label: 'San Francisco / Santa Clara, CA',
    state: 'CA',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 1209750,
    propertyTaxRatePct: 1.2,
    homeInsuranceAnnual: 2100,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'king-county-wa',
    label: 'King County, WA (Seattle)',
    state: 'WA',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 977500,
    propertyTaxRatePct: 0.92,
    homeInsuranceAnnual: 1700,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'maricopa-az',
    label: 'Maricopa County, AZ (Phoenix)',
    state: 'AZ',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: L.baselineConforming,
    propertyTaxRatePct: 0.62,
    homeInsuranceAnnual: 1650,
    lastVerified: L.lastVerified,
    source: L.source,
  },
  {
    id: 'denver-co',
    label: 'Denver Metro, CO',
    state: 'CO',
    conformingLimit: L.baselineConforming,
    highBalanceLimit: 833750,
    propertyTaxRatePct: 0.55,
    homeInsuranceAnnual: 1950,
    lastVerified: L.lastVerified,
    source: L.source,
  },
];

/** Look up a market by id, falling back to the national baseline. */
export function getMarket(id) {
  return MARKETS.find((m) => m.id === id) || MARKETS[0];
}

export default MARKETS;
