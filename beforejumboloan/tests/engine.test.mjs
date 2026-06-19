/* Engine math tests for the Before Jumbo Strategy Studio.
 * engine.js is a browser IIFE that assigns global.KW; importing it for its
 * side effect populates globalThis.KW in Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../js/engine.js');
const KW = globalThis.KW;

test('engine loads and exposes the API', () => {
  assert.ok(KW, 'global.KW is defined');
  for (const fn of ['paymentBreakdown', 'dscr', 'permanentBuydown', 'temporaryBuydown', 'strategySummary', 'monthlyPI', 'interestOnly', 'paymentPreview']) {
    assert.equal(typeof KW[fn], 'function', `KW.${fn} exists`);
  }
});

test('interest-only = loan * annual_rate / 12, and is lower than amortizing P&I', () => {
  // $800,000 @ 7% → IO = 800000 * 0.07 / 12 = 4,666.67
  assert.ok(Math.abs(KW.interestOnly(800000, 7) - 4666.666667) < 0.01);
  assert.equal(KW.interestOnly(0, 7), 0);
  const pp = KW.paymentPreview({ loan: 800000, rate: 7 });
  assert.ok(Math.abs(pp.interestOnly - 4666.6667) < 0.01);
  assert.ok(pp.pi > pp.interestOnly, 'amortizing P&I exceeds interest-only');
  assert.ok(Math.abs(pp.difference - (pp.pi - pp.interestOnly)) < 1e-6, 'difference = P&I − IO');
  assert.match(pp.note, /educational payment illustration only/i);
});

test('rate assumptions come from the central config (window.BJLRates) when present', () => {
  globalThis.BJLRates = { label: 'test', assumptions: { conforming: 5.5, jumbo: 8.5 } };
  assert.equal(KW.rateAssumption('conforming', 99), 5.5);
  assert.equal(KW.rateAssumption('jumbo', 99), 8.5);
  assert.equal(KW.rateAssumption('not_a_key', 6.1), 6.1, 'falls back when key missing');
  delete globalThis.BJLRates;
});

test('credit score adds a rate add-on; 740+ is the no-penalty tier', () => {
  assert.equal(KW.scoreRateAdjust(780), 0);
  assert.equal(KW.scoreRateAdjust(740), 0, '740 already strong — no add-on');
  assert.ok(KW.scoreRateAdjust(700) > 0, 'below 740 adds to the rate');
  assert.ok(KW.scoreRateAdjust(640) > KW.scoreRateAdjust(700), 'lower score = bigger add-on');
  const hi = KW.rateFor({ loan: 800000, scenario_type: 'purchase', creditScore: 760, docType: 'w2' });
  const lo = KW.rateFor({ loan: 800000, scenario_type: 'purchase', creditScore: 680, docType: 'w2' });
  assert.ok(lo.rate > hi.rate, 'a lower score raises the assumed rate');
  assert.equal(hi.scoreAdj, 0);
});

test('income type: bank statements / 1099 are Non-QM and price higher than W-2', () => {
  const w2 = KW.rateFor({ loan: 800000, scenario_type: 'purchase', creditScore: 760, docType: 'w2' });
  const bs = KW.rateFor({ loan: 800000, scenario_type: 'purchase', creditScore: 760, docType: 'bank_statement' });
  const k99 = KW.rateFor({ loan: 800000, scenario_type: 'purchase', creditScore: 760, docType: 'ten99' });
  assert.equal(w2.nonqm, false);
  assert.equal(bs.nonqm, true);
  assert.ok(bs.rate > w2.rate, 'bank statements (Non-QM) priced higher');
  assert.ok(k99.rate > w2.rate, '1099 (Non-QM) priced higher');
  assert.equal(bs.key, 'bank-statement');
});

test('mortgage insurance (PMI) applies only when LTV > 80%', () => {
  assert.equal(KW.monthlyMI(800000, 80, 760), 0, 'no PMI at 20% down');
  assert.equal(KW.monthlyMI(800000, 75, 760), 0);
  assert.ok(KW.monthlyMI(800000, 90, 760) > 0, 'PMI applies under 20% down');
  assert.ok(KW.monthlyMI(800000, 95, 760) > KW.monthlyMI(800000, 90, 760), 'higher LTV = more PMI');
  assert.ok(KW.monthlyMI(800000, 90, 680) > KW.monthlyMI(800000, 90, 760), 'lower score = more PMI');
});

test('rateFor is scenario-aware (DSCR for investment, interest-only key when selected)', () => {
  const inv = KW.rateFor({ loan: 700000, scenario_type: 'investment', occupancy: 'Investment property' });
  assert.equal(inv.key, 'dscr');
  const io = KW.rateFor({ loan: 700000, scenario_type: 'investment', occupancy: 'Investment property', payment_mode: 'interest-only' });
  assert.equal(io.key, 'interest_only_jumbo');
});

test('monthlyPI matches a known amortization figure', () => {
  // $500,000 @ 6.875% / 30yr ≈ $3,285.16
  assert.ok(Math.abs(KW.monthlyPI(500000, 6.875, 30) - 3285.16) < 1);
  assert.equal(Math.round(KW.monthlyPI(360000, 0, 30)), 1000); // 0% edge
});

test('Payment Stack: segments sum to the total (PITIA)', () => {
  const S = { mode: 'purchase', price: 1000000, down: 200000, loan: 800000,
    taxAnnual: 9600, homeownersAnnual: 2400, floodAnnual: 1200, hoaMonthly: 150, miMonthly: 0, otherMonthly: 0 };
  const pb = KW.paymentBreakdown(S);
  assert.equal(pb.segments.length, 6);
  const sum = pb.segments.reduce((a, s) => a + s.amt, 0);
  assert.ok(Math.abs(sum - pb.total) < 0.5, `segments ${sum} ≈ total ${pb.total}`);
  assert.ok(pb.pi > 0 && pb.total > pb.pi, 'P&I positive and PITIA exceeds P&I when extras present');
});

test('DSCR: ratio = rent / PITIA', () => {
  const S = { mode: 'purchase', price: 600000, down: 150000, loan: 450000, monthlyRent: 4500 };
  const d = KW.dscr(S);
  assert.ok(d.has);
  assert.ok(Math.abs(d.ratio - d.rent / d.pitia) < 1e-9);
  assert.equal(KW.dscr({ mode: 'purchase', price: 600000, down: 150000, loan: 450000, monthlyRent: 0 }).has, false);
});

test('Buydown: permanent break-even + temporary 2-1 schedule', () => {
  const S = { mode: 'purchase', price: 1000000, down: 200000, loan: 800000 };
  const p = KW.permanentBuydown(S);
  assert.ok(p.bdRate < p.curRate, 'buydown rate is lower');
  assert.equal(Math.round(p.cost), Math.round(p.loan * p.points / 100));
  assert.ok(p.monthlySavings > 0 && p.breakEvenMonths > 0);

  const t = KW.temporaryBuydown(Object.assign({ bdTempType: '2-1' }, S));
  assert.ok(Math.abs(t.y1 - (t.note - 2)) < 1e-9, 'year 1 is note-2 for 2-1');
  assert.ok(Math.abs(t.y2 - (t.note - 1)) < 1e-9, 'year 2 is note-1 for 2-1');
  assert.ok(t.subsidy > 0);

  const t10 = KW.temporaryBuydown(Object.assign({ bdTempType: '1-0' }, S));
  assert.ok(Math.abs(t10.y1 - (t10.note - 1)) < 1e-9, 'year 1 is note-1 for 1-0');
  assert.ok(Math.abs(t10.y2 - t10.note) < 1e-9, 'year 2 is the note rate for 1-0');
  assert.ok(t10.piY1 < t10.piNote, 'year-1 payment is lower than the note payment');
});

test('buydown insight reflects break-even vs expected hold period', () => {
  const S = { mode: 'purchase', price: 1000000, down: 200000, loan: 800000, bdHoldYears: 10 };
  const lines = KW.buydownInsight(S);
  assert.ok(Array.isArray(lines) && lines.length >= 1);
  assert.match(lines.join(' '), /break-?even|buydown/i);
});

test('Before-jumbo classification uses the active market limits (Key West route)', () => {
  // The generic default is neutral (baseline = high-balance); a genuine market
  // route (e.g. /key-west) sets the high-cost ceiling. Select it explicitly.
  KW.setMarket('key-west');
  const base = { mode: 'purchase', price: 1000000 };
  // baseline 832,750 / high-balance 990,150 for Monroe County
  const conforming = KW.strategySummary({ ...base, down: 200000, loan: 800000 });
  assert.equal(conforming.primaryReviewPath, 'Conforming Review');
  assert.equal(conforming.baselineConformingLimit, 832750);
  assert.equal(conforming.highBalanceLimit, 990150);

  const highBalance = KW.strategySummary({ ...base, down: 50000, loan: 950000 });
  assert.equal(highBalance.primaryReviewPath, 'High-Balance Conforming Review');

  const jumbo = KW.strategySummary({ mode: 'purchase', price: 1300000, down: 100000, loan: 1200000 });
  assert.equal(jumbo.primaryReviewPath, 'Jumbo Review');
});
