// FINAL IDEMPOTENCY HARDENING — required tests.
//
// Proves the durable claim is atomic (Netlify Blobs onlyIfNew), that the Resend
// idempotency key equals the completedLeadEventId, that ambiguous network
// failures keep the claim and retry idempotently, that the material payload is
// stable, and that a stale failed write can never overwrite a delivered record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test_key_for_suite';

const require = createRequire(import.meta.url);
const idem = require('../netlify/functions/lib/idempotency.cjs');
const partialLead = require('../netlify/functions/lib/ai-qualified-email.cjs');

let idCounter = 0;
const nextId = () => `cle_hard_${++idCounter}`;

// ── A faithful mock of the Netlify Blobs store (onlyIfNew / onlyIfMatch) ──
function makeMockBlobStore() {
  const map = new Map(); // key -> { value, etag }
  let seq = 0;
  const spy = { onlyIfNew: 0, onlyIfMatch: 0 };
  return {
    spy,
    // Atomic: the existence check and the write happen with NO await between
    // them, so two concurrent onlyIfNew writes cannot both succeed.
    async setJSON(key, value, opts = {}) {
      const cur = map.get(key);
      if (opts.onlyIfNew) {
        spy.onlyIfNew += 1;
        if (cur) return { modified: false, etag: cur.etag };
        const etag = 'e' + (++seq); map.set(key, { value, etag }); return { modified: true, etag };
      }
      if (opts.onlyIfMatch != null) {
        spy.onlyIfMatch += 1;
        if (!cur || cur.etag !== opts.onlyIfMatch) return { modified: false, etag: cur ? cur.etag : null };
        const etag = 'e' + (++seq); map.set(key, { value, etag }); return { modified: true, etag };
      }
      const etag = 'e' + (++seq); map.set(key, { value, etag }); return { modified: true, etag };
    },
    async getWithMetadata(key) { const cur = map.get(key); return cur ? { data: cur.value, etag: cur.etag } : null; },
    async get(key) { const cur = map.get(key); return cur ? cur.value : null; },
    async delete(key) { map.delete(key); },
  };
}

// ── A mock of Resend keyed by the Idempotency-Key header ──
function makeResend({ dropFirstResponse = false } = {}) {
  const byKey = new Map();
  const keysSeen = [];
  let sent = 0;
  let dropOnce = dropFirstResponse;
  return {
    sent: () => sent,
    keysSeen,
    async post(_url, _payload, headers = {}) {
      const key = headers['Idempotency-Key'];
      keysSeen.push(key);
      if (key && byKey.has(key)) return { status: 200, body: JSON.stringify(byKey.get(key)) }; // idempotent replay
      sent += 1;
      const resp = { id: 're_' + sent };
      if (key) byKey.set(key, resp);
      if (dropOnce) { dropOnce = false; const e = new Error('socket hang up'); e.ambiguous = true; throw e; } // accepted, response lost
      return { status: 200, body: JSON.stringify(resp) };
    },
  };
}

const baseLead = (eventId, extra = {}) => ({
  completedLeadEventId: eventId,
  name: 'Test Borrower', phone: '305-555-0142', email: null,
  loanGoal: 'purchase', state: 'FL', city: 'boca raton', county: null,
  purchasePrice: 800000, loanAmount: 640000, downPayment: 160000,
  occupancy: 'primary', propertyType: 'single_family', creditRange: 720,
  incomeType: 'self-employed', contactPreference: 'any', doNotContact: false,
  preferredLanguage: 'en', primaryQuestions: ['purchase'], objections: [],
  resourcesRecommended: [], resourcesOpened: [], unresolvedItems: [],
  qualificationReason: 'scenario_sufficiently_complete',
  ...extra,
});

// Mirrors partial-lead.js's aiQualifiedLead branch, with an injectable Resend post.
async function deliverOnce(lead, { post } = {}) {
  const eventId = lead.completedLeadEventId;
  const payloadHash = idem.canonicalLeadHash(lead);
  const claim = await idem.claimCompletedLead(eventId, { payloadHash });
  if (claim.payloadMismatch) return { status: 409, payloadMismatch: true };
  if (claim.alreadyDelivered) return { status: 200, alreadyDelivered: true, mode: claim.mode };
  if (claim.inflightBusy) return { status: 200, alreadyDelivered: true, inFlight: true, mode: claim.mode };
  await idem.markSending(eventId, claim.backend, claim.etag);
  const send = await partialLead.sendAiQualifiedEmail(lead, { idempotencyKey: eventId, post });
  if (send.outcome === 'delivered') { await idem.markDelivered(eventId, claim.backend, { channel: 'email' }); return { status: 200, delivered: true, mode: claim.mode }; }
  if (send.outcome === 'ambiguous') { await idem.markSendingUnknown(eventId, claim.backend, { lastError: send.error }); return { status: 504, retryable: true, mode: claim.mode }; }
  await idem.markFailed(eventId, claim.backend); return { status: 502, mode: claim.mode };
}

// ══ 1. Two simultaneous Blob claims → onlyIfNew, one wins ══
test('H1 two simultaneous durable claims use onlyIfNew and exactly one wins', async () => {
  const store = makeMockBlobStore();
  idem.__setBlobStoreFactory(() => store);
  try {
    const eventId = nextId();
    const [a, b] = await Promise.all([
      idem.claimCompletedLead(eventId, { payloadHash: 'ph_x' }),
      idem.claimCompletedLead(eventId, { payloadHash: 'ph_x' }),
    ]);
    const winners = [a, b].filter((c) => c.firstTime);
    assert.equal(winners.length, 1, 'exactly one claim is firstTime');
    assert.ok(a.durable && b.durable, 'both report durable tier');
    assert.equal(a.mode, 'durable');
    assert.ok(store.spy.onlyIfNew >= 2, 'both claims went through an onlyIfNew write');
    const loser = [a, b].find((c) => !c.firstTime);
    assert.ok(loser.inflightBusy || loser.alreadyDelivered, 'the loser did not also win');
  } finally { idem.__setBlobStoreFactory(() => null); }
});

// ══ 2. Successful email + lost HTTP response → one email ══
test('H2 email accepted but response lost → retry yields exactly one email', async () => {
  idem.__setBlobStoreFactory(() => null); // memory tier, single process
  const resend = makeResend({ dropFirstResponse: true });
  const lead = baseLead(nextId());
  const first = await deliverOnce(lead, { post: resend.post });
  assert.equal(first.status, 504, 'first attempt is ambiguous (response lost)');
  assert.equal(resend.sent(), 1, 'Resend accepted exactly one send');
  const retry = await deliverOnce(lead, { post: resend.post });
  assert.equal(retry.delivered, true, 'retry resolves via Resend replay');
  assert.equal(resend.sent(), 1, 'still exactly one email — no duplicate');
});

// ══ 3. Timeout retries use the identical Resend idempotency key ══
test('H3 ambiguous timeout retries reuse the identical Resend idempotency key', async () => {
  idem.__setBlobStoreFactory(() => null);
  const resend = makeResend({ dropFirstResponse: true });
  const eventId = nextId();
  const lead = baseLead(eventId);
  await deliverOnce(lead, { post: resend.post }); // ambiguous
  await deliverOnce(lead, { post: resend.post }); // idempotent retry
  assert.ok(resend.keysSeen.length >= 2, 'Resend was called at least twice');
  for (const k of resend.keysSeen) assert.equal(k, eventId, 'every Resend call used the completedLeadEventId as its key');
});

// ══ 4. Concurrent Resend idempotency conflict → retried, not duplicated ══
test('H4 concurrent sends with the same Resend key produce one email', async () => {
  const resend = makeResend();
  const eventId = nextId();
  const lead = baseLead(eventId);
  // Two sends race straight to Resend with the SAME idempotency key (simulating a
  // claim-layer bypass); Resend dedups by key so only one email is created.
  const [r1, r2] = await Promise.all([
    partialLead.sendAiQualifiedEmail(lead, { idempotencyKey: eventId, post: resend.post }),
    partialLead.sendAiQualifiedEmail(lead, { idempotencyKey: eventId, post: resend.post }),
  ]);
  assert.equal(r1.outcome, 'delivered');
  assert.equal(r2.outcome, 'delivered');
  assert.equal(resend.sent(), 1, 'Resend idempotency key collapsed the duplicate');
  assert.deepEqual([...new Set(resend.keysSeen)], [eventId]);
});

// ══ 5. Ambiguous failure does NOT delete the claim ══
test('H5 ambiguous failure keeps the durable claim (retry, not firstTime)', async () => {
  idem.__setBlobStoreFactory(() => null);
  const resend = makeResend({ dropFirstResponse: true });
  const eventId = nextId();
  const lead = baseLead(eventId);
  const first = await deliverOnce(lead, { post: resend.post });
  assert.equal(first.status, 504);
  // Re-claim: the record must still exist as sending_unknown → retry, NOT firstTime.
  const claim2 = await idem.claimCompletedLead(eventId, { payloadHash: idem.canonicalLeadHash(lead) });
  assert.equal(claim2.firstTime, false, 'claim was not released');
  assert.equal(claim2.retry, true, 'ambiguous claim is retryable');
  assert.equal(claim2.alreadyDelivered, false);
});

// ══ 6. Payload change under the same event id → rejected ══
test('H6 same event id with a changed material payload is rejected', async () => {
  idem.__setBlobStoreFactory(() => null);
  const eventId = nextId();
  const leadA = baseLead(eventId, { occupancy: 'primary' });
  const leadB = baseLead(eventId, { occupancy: 'investment' }); // material change, same id
  assert.notEqual(idem.canonicalLeadHash(leadA), idem.canonicalLeadHash(leadB), 'the hashes differ');
  const c1 = await idem.claimCompletedLead(eventId, { payloadHash: idem.canonicalLeadHash(leadA) });
  assert.equal(c1.firstTime, true);
  const c2 = await idem.claimCompletedLead(eventId, { payloadHash: idem.canonicalLeadHash(leadB) });
  assert.equal(c2.payloadMismatch, true, 'a different material payload under the same id is rejected');
  // And reordered resources are NOT a material change (stable hash).
  const reordered = baseLead(eventId, { resourcesRecommended: ['b', 'a'] });
  const straight = baseLead(eventId, { resourcesRecommended: ['a', 'b'] });
  assert.equal(idem.canonicalLeadHash(reordered), idem.canonicalLeadHash(straight), 'resource order is not material');
});

// ══ 7. Delivered state is not overwritten by a stale failed request (onlyIfMatch) ══
test('H7 a stale failed write cannot overwrite a delivered record', async () => {
  const store = makeMockBlobStore();
  idem.__setBlobStoreFactory(() => store);
  try {
    const eventId = nextId();
    const claim = await idem.claimCompletedLead(eventId, { payloadHash: 'ph_x' });
    const staleEtag = claim.etag; // a slow failure path still holds this
    await idem.markSending(eventId, claim.backend, claim.etag);
    await idem.markDelivered(eventId, claim.backend, { channel: 'email' });
    // The stale writer tries to fail the record using its OLD etag.
    const stale = await idem.markFailedRetryable(eventId, claim.backend, staleEtag);
    assert.equal(stale.ok, false, 'the stale write was refused');
    const after = await claim.backend.read(eventId);
    assert.equal(after.data.status, 'delivered', 'delivered survived');
    assert.ok(store.spy.onlyIfMatch >= 1, 'onlyIfMatch guarded the transition');

    // Direct onlyIfMatch rejection on a non-delivered record too.
    const e2 = nextId();
    const c2 = await idem.claimCompletedLead(e2, { payloadHash: 'ph_y' });
    const stale2 = c2.etag;
    await idem.markSending(e2, c2.backend, c2.etag); // advances the etag
    const rejected = await idem.markSending(e2, c2.backend, stale2); // stale etag
    assert.equal(rejected.ok, false, 'a stale onlyIfMatch write is rejected');
  } finally { idem.__setBlobStoreFactory(() => null); }
});

// ══ 8. In-memory fallback is clearly reported as non-durable ══
test('H8 in-memory fallback reports durable:false / mode:memory', async () => {
  idem.__setBlobStoreFactory(() => null); // no Blobs store available
  const claim = await idem.claimCompletedLead(nextId(), { payloadHash: 'ph_x' });
  assert.equal(claim.durable, false, 'memory tier is NOT durable');
  assert.equal(claim.mode, 'memory');
});

// ── Payload stability: two builds of the same lead produce identical email content ──
test('material email payload is byte-stable across builds (no timestamps/random)', () => {
  const lead = baseLead(nextId());
  const p1 = partialLead.buildAiQualifiedEmailPayload(lead, { from: 'a@b.co', to: 'x@y.co' });
  const p2 = partialLead.buildAiQualifiedEmailPayload(lead, { from: 'a@b.co', to: 'x@y.co' });
  assert.deepEqual(p1, p2, 'same lead → identical material payload');
});
