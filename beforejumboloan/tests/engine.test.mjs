/* Engine math tests for the Before Jumbo Strategy Studio.
 * engine.js is a browser IIFE that assigns global.KW; importing it for its
 * side effect populates globalThis.KW in Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../js/engine.js');
const KW = globalThis.KW;

test('engine loads and exposes the API', () => {
  assert.ok(KW, 'global.KW is defined');
  for (const fn of ['paymentBreakdown', 'dscr', 'permanentBuydown', 'temporaryBuydown', 'strategySummary', 'monthlyPI']) {
    assert.equal(typeof KW[fn], 'function', `KW.${fn} exists`);
  }
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
});

test('Before-jumbo classification uses verified 2026 limits (Key West default)', () => {
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
