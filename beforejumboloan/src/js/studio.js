/**
 * studio.js
 * Strategy Studio controller. Owns the DOM; delegates all math to the engine.
 * Reactive: any input change re-runs the engine and re-renders.
 */

import { DEFAULTS } from '../config/defaults.js';
import { getProduct } from '../config/products.js';
import { getMarket, MARKETS } from '../config/markets.js';
import { runStrategy } from './engine/index.js';
import { mountMarketSelector } from './marketSelector.js';
import { submitLead } from './leadSubmission.js';
import { explainStrategy } from './ai/explainer.js';
import { money, moneyCents, pct, ratio } from './lib/format.js';

const state = {
  productId: 'conforming',
  marketId: MARKETS[0].id,
  snapshot: null,
};

const $ = (id) => document.getElementById(id);
const els = {};

function readScenario() {
  const val = (id) => {
    const el = $(id);
    return el ? el.value : '';
  };
  return {
    homePrice: val('homePrice'),
    downPaymentPct: val('downPaymentPct'),
    rate: val('rate'),
    termYears: val('termYears'),
    propertyTaxRatePct: val('propertyTaxRatePct'),
    homeInsuranceAnnual: val('homeInsuranceAnnual'),
    hoaMonthly: val('hoaMonthly'),
    grossMonthlyRent: val('grossMonthlyRent'),
    points: val('points'),
    temporaryStructure: val('temporaryStructure'),
  };
}

function recompute() {
  const product = getProduct(state.productId);
  const market = getMarket(state.marketId);
  const scenario = readScenario();
  state.snapshot = runStrategy(scenario, { defaults: DEFAULTS, market, product });
  render(state.snapshot, product);
}

/* ------------------------------- rendering ------------------------------- */

function render(snap, product) {
  renderHeadline(snap);
  renderPaymentStack(snap);
  renderJumbo(snap);
  toggleProductPanels(product.id);
  if (product.id === 'dscr') renderDscr(snap);
  if (product.id === 'buydown') renderBuydown(snap);
  renderAiPlaceholder(snap);

  // Sync the live down-payment readout
  if (els.downPaymentReadout) {
    els.downPaymentReadout.textContent = `${money(snap.inputs.downPayment)} down · loan ${money(
      snap.inputs.loanAmount
    )}`;
  }
}

function renderHeadline(snap) {
  els.headlinePayment.textContent = moneyCents(snap.paymentStack.total);
  const tier = snap.jumboGap.tierLabel;
  els.tierBadge.textContent = tier;
  els.tierBadge.dataset.tier = snap.jumboGap.tier;
  els.headlineMeta.textContent = `${pct(snap.inputs.effectiveRate, 3)} · ${
    snap.inputs.termYears
  }-yr · ${pct(snap.paymentStack.ltv, 1)} LTV`;
}

function renderPaymentStack(snap) {
  const total = snap.paymentStack.total || 1;
  els.paymentStack.innerHTML = '';
  for (const c of snap.paymentStack.components) {
    const width = Math.max(2, (c.amount / total) * 100);
    const row = document.createElement('div');
    row.className = 'stack-row';
    row.innerHTML = `
      <div class="stack-label">${c.label}</div>
      <div class="stack-bar"><span class="stack-fill" data-key="${c.key}" style="width:${width}%"></span></div>
      <div class="stack-amt">${moneyCents(c.amount)}</div>`;
    els.paymentStack.appendChild(row);
  }
}

function renderJumbo(snap) {
  const j = snap.jumboGap;
  const limitToShow = j.highBalanceLimit > j.conformingLimit ? j.highBalanceLimit : j.conformingLimit;
  let msg;
  if (j.tier === 'jumbo') {
    msg = `This loan is <strong>${money(j.gapToHighBalance)} over</strong> the jumbo line. Put
      <strong>${money(j.additionalDownToAvoidJumbo)}</strong> more down to get back under
      ${money(limitToShow)} and stay before jumbo.`;
  } else if (j.tier === 'high-balance') {
    msg = `You're in <strong>high-balance conforming</strong> — still before jumbo. You have
      <strong>${money(j.headroom)}</strong> of headroom before crossing into jumbo at
      ${money(j.highBalanceLimit)}.`;
  } else {
    msg = `You're solidly <strong>conforming</strong> with <strong>${money(
      j.headroom
    )}</strong> of headroom before the jumbo line at ${money(j.highBalanceLimit)}.`;
  }
  els.jumboPanel.innerHTML = `
    <div class="gap-meter" data-tier="${j.tier}">
      <div class="gap-track">
        <div class="gap-marker" style="left:${gapMarkerPct(j)}%" title="your loan"></div>
        <div class="gap-line gap-conf" style="left:${linePct(j, j.conformingLimit)}%"></div>
        <div class="gap-line gap-jumbo" style="left:${linePct(j, j.highBalanceLimit)}%"></div>
      </div>
      <div class="gap-scale"><span>${money(j.conformingLimit)}</span><span>${money(
    j.highBalanceLimit
  )}</span></div>
    </div>
    <p class="gap-msg">${msg}</p>`;
}

function gapMarkerPct(j) {
  const max = Math.max(j.highBalanceLimit, j.loanAmount) * 1.05;
  return Math.min(100, (j.loanAmount / max) * 100);
}
function linePct(j, value) {
  const max = Math.max(j.highBalanceLimit, j.loanAmount) * 1.05;
  return Math.min(100, (value / max) * 100);
}

function renderDscr(snap) {
  const d = snap.dscr;
  if (!d) return;
  const status = d.qualifies ? 'pass' : 'fail';
  els.dscrPanel.innerHTML = `
    <div class="metric-big" data-status="${status}">
      <span class="metric-num">${ratio(d.ratio)}</span>
      <span class="metric-cap">DSCR ${d.qualifies ? '· qualifies' : '· below minimum'}</span>
    </div>
    <ul class="kv">
      <li><span>Tier</span><span>${d.tier ? d.tier.label : '—'}</span></li>
      <li><span>Monthly cashflow</span><span>${moneyCents(d.monthlyCashflow)}</span></li>
      <li><span>Rent to hit ${ratio(d.minQualifyingRatio)} min</span><span>${moneyCents(
    d.rentNeededToQualify
  )}</span></li>
      <li><span>Rent to hit ${ratio(d.targetRatio)} target</span><span>${moneyCents(
    d.rentNeededForTarget
  )}</span></li>
    </ul>`;
}

function renderBuydown(snap) {
  const b = snap.buydown;
  if (!b) return;
  const p = b.permanent;
  const t = b.temporary;
  const tempRows = t.schedule
    .map(
      (s) =>
        `<li><span>Year ${s.year} @ ${pct(s.rate, 3)}</span><span>${moneyCents(
          s.monthlyPI
        )}/mo</span></li>`
    )
    .join('');
  els.buydownPanel.innerHTML = `
    <div class="buydown-grid">
      <div class="buydown-card">
        <h4>Permanent · ${p.points} pt${p.points === 1 ? '' : 's'}</h4>
        <p class="bd-rate">${pct(p.baseRate, 3)} → <strong>${pct(p.boughtDownRate, 3)}</strong></p>
        <ul class="kv">
          <li><span>Cost</span><span>${money(p.cost)}</span></li>
          <li><span>Monthly savings</span><span>${moneyCents(p.monthlySavings)}</span></li>
          <li><span>Break-even</span><span>${
            p.breakevenMonths ? `${p.breakevenMonths} mo` : '—'
          }</span></li>
          <li><span>Lifetime net</span><span>${money(p.lifetimeSavings)}</span></li>
        </ul>
      </div>
      <div class="buydown-card">
        <h4>Temporary · ${b.structureLabel}</h4>
        <p class="bd-rate">Note rate ${pct(t.noteRate, 3)}</p>
        <ul class="kv">${tempRows}
          <li class="kv-total"><span>Total subsidy</span><span>${money(t.totalSubsidy)}</span></li>
        </ul>
      </div>
    </div>`;
}

async function renderAiPlaceholder(snap) {
  const result = await explainStrategy(snap, {
    enabled: DEFAULTS.ai.enabled,
    endpoint: DEFAULTS.ai.explainEndpoint,
  });
  els.aiPanel.querySelector('.ai-body').textContent = result.text;
}

function toggleProductPanels(productId) {
  document.querySelectorAll('[data-when-product]').forEach((el) => {
    const wants = el.getAttribute('data-when-product').split(',');
    el.hidden = !wants.includes(productId);
  });
  document.querySelectorAll('[data-product]').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-product') === productId);
  });
}

/* ------------------------------- lead form ------------------------------- */

async function handleLeadSubmit(e) {
  e.preventDefault();
  els.leadStatus.textContent = 'Submitting…';
  els.leadStatus.dataset.state = 'pending';

  const lead = {
    name: $('leadName').value,
    email: $('leadEmail').value,
    phone: $('leadPhone').value,
    message: $('leadMessage').value,
  };

  const result = await submitLead(lead, state.snapshot);
  if (result.ok) {
    els.leadStatus.textContent = 'Received — an advisor will prepare your options memo.';
    els.leadStatus.dataset.state = 'ok';
    els.leadForm.reset();
  } else if (result.error === 'validation') {
    els.leadStatus.textContent = 'Please add your name and a valid email.';
    els.leadStatus.dataset.state = 'error';
  } else {
    els.leadStatus.textContent =
      'We could not submit right now. The lead endpoint may not be configured locally.';
    els.leadStatus.dataset.state = 'error';
  }
}

/* --------------------------------- init ---------------------------------- */

function init() {
  els.headlinePayment = $('headlinePayment');
  els.headlineMeta = $('headlineMeta');
  els.tierBadge = $('tierBadge');
  els.paymentStack = $('paymentStack');
  els.jumboPanel = $('jumboPanel');
  els.dscrPanel = $('dscrPanel');
  els.buydownPanel = $('buydownPanel');
  els.aiPanel = $('aiPanel');
  els.downPaymentReadout = $('downPaymentReadout');
  els.leadForm = $('leadForm');
  els.leadStatus = $('leadStatus');

  // Market selector
  mountMarketSelector(
    $('marketSelect'),
    (m) => {
      state.marketId = m.id;
      // adopt the market's local tax/insurance defaults if user hasn't overridden
      maybeSyncMarketDefaults(m);
      recompute();
    },
    state.marketId
  );

  // Product tabs
  document.querySelectorAll('[data-product]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.productId = tab.getAttribute('data-product');
      recompute();
    });
  });

  // Reactive inputs
  document.querySelectorAll('[data-input]').forEach((el) => {
    el.addEventListener('input', recompute);
    el.addEventListener('change', recompute);
  });

  // Lead form
  els.leadForm.addEventListener('submit', handleLeadSubmit);

  // Seed market-derived defaults, then first render
  maybeSyncMarketDefaults(getMarket(state.marketId));
  recompute();
}

/** Keep tax/insurance fields in step with the chosen market unless the user
 *  has typed something different (we only overwrite when field is empty or
 *  still equals the previous market's value). */
let lastMarketId = null;
function maybeSyncMarketDefaults(market) {
  const tax = $('propertyTaxRatePct');
  const ins = $('homeInsuranceAnnual');
  if (lastMarketId === null) {
    if (tax && !tax.value) tax.value = market.propertyTaxRatePct;
    if (ins && !ins.value) ins.value = market.homeInsuranceAnnual;
  } else if (lastMarketId !== market.id) {
    const prev = getMarket(lastMarketId);
    if (tax && Number(tax.value) === prev.propertyTaxRatePct) tax.value = market.propertyTaxRatePct;
    if (ins && Number(ins.value) === prev.homeInsuranceAnnual) ins.value = market.homeInsuranceAnnual;
  }
  lastMarketId = market.id;
}

document.addEventListener('DOMContentLoaded', init);
