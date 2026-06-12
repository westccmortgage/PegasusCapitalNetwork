/**
 * landing.js
 * Hydrates the marketing page from config and renders a live preview using the
 * real engine — proof the math is real, not a mockup.
 */

import { COPY } from '../config/copy.js';
import { DEFAULTS } from '../config/defaults.js';
import { getMarket } from '../config/markets.js';
import { getProduct } from '../config/products.js';
import { runStrategy } from './engine/index.js';
import { moneyCents } from './lib/format.js';

// ---- Copy injection (config-driven content) ----
document.querySelectorAll('[data-copy]').forEach((el) => {
  const val = resolve(COPY, el.getAttribute('data-copy'));
  if (val) el.textContent = val;
});

const disclaimer = document.getElementById('disclaimer');
if (disclaimer) disclaimer.textContent = DEFAULTS.compliance.disclaimer;

// ---- Value props ----
const grid = document.getElementById('propsGrid');
if (grid) {
  grid.innerHTML = COPY.valueProps
    .map(
      (p) => `
      <div class="card prop">
        <div class="ico">${p.icon}</div>
        <h3>${p.title}</h3>
        <p>${p.body}</p>
      </div>`
    )
    .join('');
}

// ---- Live preview: real engine, sample scenario ----
const snap = runStrategy(
  { homePrice: 1000000, downPaymentPct: 15, rate: DEFAULTS.loan.baseRatePct },
  { defaults: DEFAULTS, market: getMarket('la-county-ca'), product: getProduct('conforming') }
);

const pvTotal = document.getElementById('pvTotal');
const pvBadge = document.getElementById('pvBadge');
const pvStack = document.getElementById('pvStack');
if (pvTotal) pvTotal.textContent = moneyCents(snap.paymentStack.total);
if (pvBadge) pvBadge.textContent = snap.jumboGap.tierLabel;
if (pvStack) {
  const total = snap.paymentStack.total || 1;
  pvStack.innerHTML = snap.paymentStack.components
    .map(
      (c) => `
      <div class="pv-row">
        <span class="lbl">${c.label}</span>
        <span class="pv-bar"><span style="width:${Math.max(2, (c.amount / total) * 100)}%"></span></span>
        <span>${moneyCents(c.amount)}</span>
      </div>`
    )
    .join('');
}

function resolve(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
