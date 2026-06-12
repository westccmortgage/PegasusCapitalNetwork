/**
 * format.js
 * Display formatting helpers. Browser + Node safe (Intl is available in both).
 */

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const money = (n) => usd0.format(Number.isFinite(n) ? n : 0);
export const moneyCents = (n) => usd2.format(Number.isFinite(n) ? n : 0);
export const pct = (n, digits = 2) => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;
export const ratio = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

/** Parse a currency-ish string ("$1,200,000") into a number. */
export function parseMoney(str) {
  if (typeof str === 'number') return str;
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
