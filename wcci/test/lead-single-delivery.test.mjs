// FINAL AUTOMATIC-LEAD SINGLE-DELIVERY AUDIT — required tests.
//
// Proves one qualifying scenario produces exactly ONE completed-lead side
// effect, no matter how the model signals (SCENARIO_COMPLETE and/or CONVO_META)
// or how the browser retries. The single authoritative delivery function is
// partial-lead.js → sendAiQualifiedEmail, guarded by the shared
// completedLeadEventId in netlify/functions/lib/idempotency.cjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  evaluateCompletion, buildCompletedLeadPayload, submitCompletedLead,
  createLeadTracker, computeCompletedLeadEventId, leadFingerprint, scenarioVersion,
} from '../src/lib/leadPipeline.js';

const require = createRequire(import.meta.url);
const idem = require('../netlify/functions/lib/idempotency.cjs');

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const U = (c) => ({ role: 'user', content: c });
const A = (c) => ({ role: 'assistant', content: c });

// The server idempotency store is a process-wide singleton (as in production it
// is durable and shared) — so each test uses a DISTINCT session id to avoid the
// prior test's delivered event id colliding with this one.
let sidCounter = 0;
const nextSid = () => `abcd1234-abcd-4abc-8abc-${String(++sidCounter).padStart(12, '0')}`;

const QUALIFIED = {
  profile: { loanPurpose: 'purchase', state: 'FL', purchasePrice: 800000, employmentType: 'self-employed', downPayment: 160000 },
  convState: { city: 'boca raton', topics: ['purchase'], contactConsent: 'unknown', objections: [] },
  messages: [U('buying in Boca Raton around 800k, self-employed'), A('great'), U('my number is 305-555-0142')],
};

function payloadFor(sessionId, extra = {}) {
  const ev = evaluateCompletion(QUALIFIED);
  return buildCompletedLeadPayload({ ...QUALIFIED, evaluation: ev, sessionId, ...extra });
}

// A fake authoritative endpoint backed by the REAL idempotency module (memory
// tier), mirroring partial-lead.js's aiQualifiedLead branch. Counts real sends.
function makeServer() {
  let emailsSent = 0;
  const endpoint = async (_url, opts) => {
    const { aiQualifiedLead } = JSON.parse(opts.body);
    const eventId = aiQualifiedLead.completedLeadEventId;
    const claim = await idem.claimCompletedLead(eventId);
    if (!claim.firstTime) return { ok: true, json: async () => ({ ok: true, alreadyDelivered: true, idempotencyMode: claim.mode }) };
    emailsSent += 1;                                   // the single side effect
    await idem.markDelivered(eventId, claim.blob, { channel: 'email' });
    return { ok: true, json: async () => ({ ok: true, email: true, alreadyDelivered: false, idempotencyMode: claim.mode }) };
  };
  return { endpoint, sends: () => emailsSent };
}

// ── The event id is deterministic and stable across identical scenarios ──
test('completedLeadEventId is deterministic (no timestamp) and stable per scenario', () => {
  const SID = nextSid();
  const a = payloadFor(SID);
  const b = payloadFor(SID);
  assert.equal(a.completedLeadEventId, b.completedLeadEventId, 'same scenario → same id');
  assert.ok(a.completedLeadEventId.startsWith('cle_'));
  // Recomputable from its parts.
  const fp = leadFingerprint({ phone: '305-555-0142', email: null, sessionId: SID });
  const sv = scenarioVersion({ profile: QUALIFIED.profile, convState: QUALIFIED.convState, contact: { phone: '305-555-0142' } });
  assert.equal(a.completedLeadEventId, computeCompletedLeadEventId({ sessionId: SID, fingerprint: fp, scenarioVersion: sv }));
});

// ── 1. Both signals in the same response → exactly one completed lead ──
test('T1 both SCENARIO_COMPLETE + CONVO_META in one response → one delivery', async () => {
  const srv = makeServer();
  const tracker = createLeadTracker(mem());
  const p = payloadFor(nextSid());
  // The client builds ONE payload and calls once (unified trigger). Even if the
  // call were attempted twice for the two markers, the id dedups it.
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker });
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker }); // simulate a stray second attempt
  assert.equal(srv.sends(), 1, 'exactly one email');
});

// ── 2. Same assistant response processed twice → one completed lead ──
test('T2 same response processed twice → one delivery', async () => {
  const srv = makeServer();
  const tracker = createLeadTracker(mem());
  const p = payloadFor(nextSid());
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker });
  const second = await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker });
  assert.equal(srv.sends(), 1);
  assert.equal(second.status, 'skipped_duplicate'); // client tracker stops it before the server even sees it
});

// ── 3. Browser retries after timeout while the first delivery succeeded ──
test('T3 retry after the first delivery already succeeded → no duplicate', async () => {
  const srv = makeServer();
  const p = payloadFor(nextSid());
  // Two independent trackers (e.g. the client lost its optimistic state) hit the
  // SAME server event id.
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  const retry = await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  assert.equal(srv.sends(), 1, 'server idempotency prevents the second send');
  assert.equal(retry.status, 'already_delivered');
  assert.equal(retry.ok, true);
});

// ── 4. Two browser tabs process the same qualified session ──
test('T4 two tabs, same session/scenario → one delivery (server idempotency)', async () => {
  const srv = makeServer();
  const p = payloadFor(nextSid());
  const [r1, r2] = await Promise.all([
    submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) }),
    submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) }),
  ]);
  assert.equal(srv.sends(), 1, 'only one tab actually delivers');
  assert.ok(r1.ok && r2.ok);
  assert.ok([r1.status, r2.status].includes('already_delivered'));
});

// ── 5. Existing partial promoted to complete → one record, not partial+dupe ──
test('T5 partial → complete uses one record; complete delivers once', async () => {
  const srv = makeServer();
  const SID = nextSid();
  const tracker = createLeadTracker(mem());
  const fp = leadFingerprint({ phone: '305-555-0142', email: null, sessionId: SID });
  tracker.ensure(fp, SID); tracker.begin('partial'); tracker.succeed('partial');
  // Promote same record to complete.
  await submitCompletedLead(payloadFor(SID), { fetchFn: srv.endpoint, tracker });
  const rec = tracker.get();
  assert.equal(rec.fingerprint, fp, 'same record');
  assert.equal(rec.stages.partial.status, 'submitted');
  assert.equal(rec.stages.complete.status, 'submitted');
  assert.equal(srv.sends(), 1, 'one completed delivery');
});

// ── 6. First delivery fails before success → controlled retry, same event id ──
test('T6 failure then retry uses the SAME event id and delivers once', async () => {
  const SID = nextSid();
  let calls = 0; let failFirst = true; let emails = 0;
  const endpoint = async (_url, opts) => {
    calls += 1;
    const { aiQualifiedLead } = JSON.parse(opts.body);
    const eventId = aiQualifiedLead.completedLeadEventId;
    const claim = await idem.claimCompletedLead(eventId);
    if (!claim.firstTime) return { ok: true, json: async () => ({ ok: true, alreadyDelivered: true }) };
    if (failFirst) { failFirst = false; await idem.markFailed(eventId, claim.blob); return { ok: false, status: 502, json: async () => ({ ok: false, error: 'smtp' }) }; }
    emails += 1; await idem.markDelivered(eventId, claim.blob, {});
    return { ok: true, json: async () => ({ ok: true, email: true }) };
  };
  const tracker = createLeadTracker(mem());
  const idBefore = payloadFor(SID).completedLeadEventId;
  const first = await submitCompletedLead(payloadFor(SID), { fetchFn: endpoint, tracker });
  assert.equal(first.ok, false);
  assert.equal(tracker.canRetry('complete'), true);
  const retry = await submitCompletedLead(payloadFor(SID), { fetchFn: endpoint, tracker }); // rebuilt payload, SAME id
  assert.equal(payloadFor(SID).completedLeadEventId, idBefore, 'event id unchanged across retry');
  assert.equal(retry.ok, true);
  assert.equal(emails, 1, 'exactly one email despite the earlier failure');
  assert.equal(calls, 2);
});

// ── 7. First delivery succeeds but the browser response is lost → retry resolves already-delivered ──
test('T7 lost success response → retry resolves already_delivered, no second send', async () => {
  const srv = makeServer();
  const p = payloadFor(nextSid());
  // First call really delivers on the server, but the client "never sees" it
  // (simulate by using a fresh tracker for the retry, i.e. no local success).
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  const retry = await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  assert.equal(srv.sends(), 1);
  assert.equal(retry.status, 'already_delivered');
});

// ── 8. Repeated model completion signals on later turns → no repeated delivery ──
test('T8 repeated completion signals on later turns → no repeat (material-change policy off)', async () => {
  const srv = makeServer();
  const SID = nextSid();
  const tracker = createLeadTracker(mem());
  await submitCompletedLead(payloadFor(SID), { fetchFn: srv.endpoint, tracker });
  // Later turn, model signals completion again with a MINOR change (down payment
  // nudged) — bucketed scenario version is unchanged → same id, and the client
  // tracker also blocks re-trigger.
  const minorChange = { ...QUALIFIED, profile: { ...QUALIFIED.profile, downPayment: 165000 } };
  const p2 = buildCompletedLeadPayload({ ...minorChange, evaluation: evaluateCompletion(minorChange), sessionId: SID });
  assert.equal(p2.completedLeadEventId, payloadFor(SID).completedLeadEventId, 'minor change → same id (bucketed)');
  const again = await submitCompletedLead(p2, { fetchFn: srv.endpoint, tracker });
  assert.equal(again.status, 'skipped_duplicate');
  assert.equal(srv.sends(), 1, 'still exactly one delivery across turns');
});

// ── doNotContact still delivers exactly once (internal record) ──
test('doNotContact scenario still delivers exactly one internal record', async () => {
  const srv = makeServer();
  const SID = nextSid();
  const dnc = { ...QUALIFIED, convState: { ...QUALIFIED.convState, contactConsent: 'declined' } };
  const p = buildCompletedLeadPayload({ ...dnc, evaluation: evaluateCompletion(dnc), sessionId: SID });
  assert.equal(p.doNotContact, true);
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  await submitCompletedLead(p, { fetchFn: srv.endpoint, tracker: createLeadTracker(mem()) });
  assert.equal(srv.sends(), 1);
});
