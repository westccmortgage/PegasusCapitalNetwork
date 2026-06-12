/**
 * products.js
 * Loan strategy catalog. Each product is a "lens" the Strategy Studio can
 * apply to the same scenario. Config-driven so new strategies can be added
 * without touching the engine.
 */

export const PRODUCTS = [
  {
    id: 'conforming',
    label: 'Conforming (Stay Before Jumbo)',
    tagline: 'Keep the loan under the conforming ceiling for the best pricing.',
    engines: ['paymentStack', 'jumboGap'],
    minDownPct: 5,
    notes: 'Best execution when the loan amount stays at or below the conforming/high-balance limit.',
  },
  {
    id: 'jumbo',
    label: 'Jumbo',
    tagline: 'Above the conforming ceiling — different pricing and reserves.',
    engines: ['paymentStack', 'jumboGap'],
    minDownPct: 10,
    notes: 'Used when the loan amount exceeds the local limit. The studio shows the gap to get back under.',
  },
  {
    id: 'dscr',
    label: 'DSCR (Investment Property)',
    tagline: 'Qualify on the property’s rent, not personal income.',
    engines: ['paymentStack', 'dscr'],
    minDownPct: 20,
    notes: 'Debt-Service Coverage Ratio loan. Qualification is driven by rent vs. PITIA.',
  },
  {
    id: 'buydown',
    label: 'Rate Buydown',
    tagline: 'Trade cash today for a lower payment — permanent or temporary.',
    engines: ['paymentStack', 'buydown'],
    minDownPct: 5,
    notes: 'Compare discount points (permanent) against 2-1 / 3-2-1 temporary structures.',
  },
];

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
}

export default PRODUCTS;
