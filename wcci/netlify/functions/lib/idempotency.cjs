// Durable idempotency for completed-lead delivery — HARDENED.
//
// One qualifying scenario must produce exactly ONE completed-lead side effect,
// even though the model may expose two compatibility signals (SCENARIO_COMPLETE
// and CONVO_META handoff:automatic_lead) and the browser may retry, and even if
// Resend accepted an email but the Netlify Function timed out before it saw the
// response.
//
// The completed-lead delivery function (partial-lead.js) CLAIMS a deterministic
// `completedLeadEventId` here BEFORE sending, using an ATOMIC conditional write,
// and only marks it `delivered` after Resend confirms. Everything else is a
// no-op or an idempotent retry.
//
// Storage tiers (best available wins):
//   1. Netlify Blobs (site-wide, strong consistency) — TRUE cross-request
//      idempotency via store.setJSON(key, rec, { onlyIfNew: true }) and, for
//      protected status transitions, { onlyIfMatch: etag }.
//   2. Warm-instance in-memory Map — best-effort only within one container.
//      Reported as NON-DURABLE (durable:false, mode:'memory'). We never claim
//      durable idempotency when only tier 2 is available.
//
// State machine (rec.status):
//   claimed → sending → delivered
//                    ↘ sending_unknown (ambiguous network/timeout — claim KEPT,
//                                       retry uses same id + Resend idempotency key)
//                    ↘ failed_retryable (definitive but retryable)
//   A claim is RELEASED (deleted) only when it is proven no external delivery
//   request was accepted. A `delivered` record is never overwritten by a stale
//   writer (guarded by both a status check and onlyIfMatch/ETag).

const INFLIGHT_TTL_MS = 20000; // treat a very recent claimed/sending record as in-flight

// ── Stable hashing (matches leadPipeline.djb2) ──
function djb2(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const _num = (n) => (n == null || n === '' || isNaN(n) ? '' : String(Math.round(Number(n))));
const _up = (s) => String(s || '').toUpperCase();
const _low = (s) => String(s || '').toLowerCase();
const _normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const _normEmail = (e) => String(e || '').trim().toLowerCase();
const _sortArr = (a) => (Array.isArray(a) ? [...a].map((x) => String(x)).sort() : []);

// Canonical hash of the MATERIAL email payload — the fields that determine what
// the borrower's team actually receives. Deliberately EXCLUDES unstable values
// (nonce, submittedAt; the event id already keys the record) and orders arrays so
// a mere reordering of resources is NOT treated as a material change. Persisted
// at claim time; a retry whose material payload changed is rejected.
function canonicalLeadHash(lead) {
  const l = lead || {};
  const material = {
    name: l.name || '',
    phone: _normPhone(l.phone),
    email: _normEmail(l.email),
    loanGoal: l.loanGoal || '',
    state: _up(l.state),
    city: _low(l.city),
    county: _low(l.county),
    zip: String(l.zip || ''),
    purchasePrice: _num(l.purchasePrice),
    loanAmount: _num(l.loanAmount),
    downPayment: _num(l.downPayment),
    occupancy: l.occupancy || '',
    propertyType: l.propertyType || '',
    creditRange: String(l.creditRange == null ? '' : l.creditRange),
    incomeType: l.incomeType || '',
    expectedTiming: l.expectedTiming || '',
    contactPreference: l.contactPreference || '',
    doNotContact: !!l.doNotContact,
    preferredLanguage: l.preferredLanguage || '',
    primaryQuestions: _sortArr(l.primaryQuestions),
    objections: _sortArr(l.objections),
    competitorMentioned: l.competitorMentioned || '',
    resourcesRecommended: _sortArr(l.resourcesRecommended),
    resourcesOpened: _sortArr(l.resourcesOpened),
    unresolvedItems: _sortArr(l.unresolvedItems),
    qualificationReason: l.qualificationReason || '',
  };
  return 'ph_' + djb2(JSON.stringify(material));
}

// ── Storage backends (uniform primitive contract) ──
// Each backend exposes:
//   claimNew(key, rec)               → { modified, etag }   (atomic create-if-absent)
//   conditionalSet(key, rec, etag)   → { modified, etag }   (write iff etag matches)
//   read(key)                        → { data, etag }
//   remove(key)                      → void

// Warm-instance fallback (survives only within a single warm serverless box).
const MEM = new Map(); // key -> { rec, etag }
let MEM_SEQ = 0;

function makeMemoryBackend() {
  return {
    durable: false,
    // Synchronous check-and-set: no await between the existence check and the
    // write, so two concurrent claims in the SAME process cannot both win.
    async claimNew(key, rec) {
      if (MEM.has(key)) { const cur = MEM.get(key); return { modified: false, etag: cur.etag }; }
      const etag = 'm' + (++MEM_SEQ);
      MEM.set(key, { rec, etag });
      return { modified: true, etag };
    },
    async conditionalSet(key, rec, expectedEtag) {
      const cur = MEM.get(key);
      // onlyIfMatch semantics: reject stale writers.
      if (!cur || (expectedEtag != null && cur.etag !== expectedEtag)) {
        return { modified: false, etag: cur ? cur.etag : null };
      }
      const etag = 'm' + (++MEM_SEQ);
      MEM.set(key, { rec, etag });
      return { modified: true, etag };
    },
    async read(key) {
      const cur = MEM.get(key);
      return cur ? { data: cur.rec, etag: cur.etag } : { data: null, etag: null };
    },
    async remove(key) { MEM.delete(key); },
  };
}

async function getBlobStore() {
  try {
    // @netlify/blobs is ESM and injected by the Netlify Functions runtime.
    const mod = await import('@netlify/blobs');
    if (mod && typeof mod.getStore === 'function') {
      // getStore() is SITE-WIDE (survives across deploys); getDeployStore() would
      // be deploy-scoped and must NOT be used for a durable claim. Strong
      // consistency so a claim is visible to the very next request.
      try { return mod.getStore({ name: 'wcci-lead-idempotency', consistency: 'strong' }); }
      catch { return mod.getStore('wcci-lead-idempotency'); }
    }
  } catch { /* not available in this environment */ }
  return null;
}

function makeBlobBackend(store) {
  const etagOf = (res) => (res && (res.etag || (res.data && res.data.etag))) || null;
  const backend = {
    durable: true,
    async claimNew(key, rec) {
      // ATOMIC CLAIM — the durable idempotency guarantee. onlyIfNew writes ONLY
      // if the key does not already exist; modified:false means an existing claim.
      const res = await store.setJSON(key, rec, { onlyIfNew: true });
      const modified = !(res && res.modified === false);
      let etag = etagOf(res);
      if (modified && !etag) { const r = await backend.read(key); etag = r.etag; }
      return { modified, etag };
    },
    async conditionalSet(key, rec, expectedEtag) {
      // Protected transition — write ONLY if the record still carries the etag we
      // last saw. A stale writer (e.g. a slow failure path racing a delivery)
      // fails here instead of clobbering a newer state.
      const opts = expectedEtag != null ? { onlyIfMatch: expectedEtag } : {};
      const res = await store.setJSON(key, rec, opts);
      const modified = !(res && res.modified === false);
      return { modified, etag: etagOf(res) };
    },
    async read(key) {
      try {
        if (typeof store.getWithMetadata === 'function') {
          const res = await store.getWithMetadata(key, { type: 'json' });
          if (!res) return { data: null, etag: null };
          return { data: res.data, etag: res.etag || null };
        }
        const data = await store.get(key, { type: 'json' });
        return { data: data || null, etag: null };
      } catch { return { data: null, etag: null }; }
    },
    async remove(key) { try { await store.delete(key); } catch { /* ignore */ } },
  };
  return backend;
}

// Test seam: inject a mock Blobs store to exercise the durable path.
let _storeFactory = getBlobStore;
function __setBlobStoreFactory(fn) { _storeFactory = fn || getBlobStore; }

function resolveBackend(ref) {
  if (ref && typeof ref.claimNew === 'function') return ref; // already a backend
  return makeMemoryBackend(); // operates on the module-global MEM
}

async function backendFor(opts) {
  if (opts && opts.backend) return opts.backend; // test injection of a full backend
  const store = await _storeFactory();
  if (store) return makeBlobBackend(store);
  return makeMemoryBackend();
}

function classifyExisting(rec) {
  if (!rec) return 'none';
  return rec.status || 'claimed';
}

/**
 * Atomically claim delivery for an event id.
 * @param {string} eventId
 * @param {{ payloadHash?: string, backend?: object }} [opts]
 * @returns {Promise<object>} with booleans firstTime | alreadyDelivered | retry |
 *   inflightBusy | payloadMismatch, plus { durable, mode, backend, blob, etag, record }.
 *   firstTime        → this caller won the claim; send, then mark the result.
 *   alreadyDelivered → a prior attempt already delivered; caller must NOT send.
 *   retry            → a prior attempt is ambiguous/failed-retryable; caller may
 *                      re-send with the SAME event id + Resend idempotency key.
 *   inflightBusy     → a fresh concurrent attempt holds the claim; do not send now.
 *   payloadMismatch  → same event id but a DIFFERENT material payload; reject.
 */
async function claimCompletedLead(eventId, opts = {}) {
  const payloadHash = opts.payloadHash || null;
  const base = { firstTime: false, alreadyDelivered: false, retry: false, inflightBusy: false, payloadMismatch: false };
  if (!eventId) {
    return { ...base, firstTime: true, durable: false, mode: 'memory', backend: null, blob: null, etag: null, record: null };
  }
  const backend = await backendFor(opts);
  const mode = backend.durable ? 'durable' : 'memory';
  const now = Date.now();
  const newRec = { status: 'claimed', payloadHash, at: now, attempts: 1 };

  const claimRes = await backend.claimNew(eventId, newRec);
  if (claimRes.modified) {
    let etag = claimRes.etag;
    if (!etag) { const r = await backend.read(eventId); etag = r.etag; }
    return { ...base, firstTime: true, durable: backend.durable, mode, backend, blob: backend, etag, record: newRec };
  }

  // Existing claim — read it and decide.
  const { data: existing, etag } = await backend.read(eventId);
  const status = classifyExisting(existing);

  // PAYLOAD STABILITY — a genuinely different material payload under the same
  // event id is a bug or a tampering attempt; reject rather than send a mismatched
  // email under an idempotency key that promises "same payload".
  if (payloadHash && existing && existing.payloadHash && existing.payloadHash !== payloadHash) {
    return { ...base, payloadMismatch: true, durable: backend.durable, mode, backend, blob: backend, etag, record: existing };
  }
  if (status === 'delivered') {
    return { ...base, alreadyDelivered: true, durable: backend.durable, mode, backend, blob: backend, etag, record: existing };
  }
  // A fresh claimed/sending record from a concurrent request → don't double-send.
  if ((status === 'claimed' || status === 'sending') && (now - ((existing && existing.at) || 0)) < INFLIGHT_TTL_MS) {
    return { ...base, inflightBusy: true, durable: backend.durable, mode, backend, blob: backend, etag, record: existing };
  }
  // sending_unknown / failed_retryable / stale in-flight → controlled retry.
  return { ...base, retry: true, durable: backend.durable, mode, backend, blob: backend, etag, record: existing };
}

// Shared conditional writer. Never lets a non-delivered patch clobber a delivered
// record (double-guarded: explicit status check AND onlyIfMatch/ETag).
async function conditionalWrite(backend, eventId, patch, etag, { neverOverwriteDelivered = true } = {}) {
  const { data: cur, etag: curEtag } = await backend.read(eventId);
  if (neverOverwriteDelivered && cur && cur.status === 'delivered' && patch.status !== 'delivered') {
    return { ok: false, kept: true, record: cur, etag: curEtag };
  }
  const useEtag = etag != null ? etag : curEtag;
  const rec = Object.assign({}, cur || {}, patch, { at: Date.now() });
  const res = await backend.conditionalSet(eventId, rec, useEtag);
  if (!res.modified) {
    const after = await backend.read(eventId); // lost the race — report the winner
    return { ok: false, record: after.data, etag: after.etag };
  }
  return { ok: true, record: rec, etag: res.etag };
}

async function markSending(eventId, ref, etag) {
  if (!eventId) return { ok: false };
  return conditionalWrite(resolveBackend(ref), eventId, { status: 'sending' }, etag);
}

async function markDelivered(eventId, ref, meta = {}) {
  if (!eventId) return { ok: false };
  return conditionalWrite(resolveBackend(ref), eventId, { status: 'delivered', ...meta }, null, { neverOverwriteDelivered: false });
}

// AMBIGUOUS network error / timeout: the request MAY have been accepted by Resend.
// Keep the claim (do NOT release) and record sending_unknown so a retry re-sends
// with the SAME event id + Resend idempotency key and resolves to the original.
async function markSendingUnknown(eventId, ref, meta = {}) {
  if (!eventId) return { ok: false };
  return conditionalWrite(resolveBackend(ref), eventId, { status: 'sending_unknown', ...meta }, null);
}

// Definitive-but-retryable failure recorded as status (claim KEPT). Uses
// onlyIfMatch (etag) so a stale failure cannot overwrite a delivered record.
async function markFailedRetryable(eventId, ref, etag) {
  if (!eventId) return { ok: false };
  return conditionalWrite(resolveBackend(ref), eventId, { status: 'failed_retryable' }, etag);
}

// RELEASE the claim (delete) — ONLY safe when it is proven no external delivery
// request was accepted (e.g. RESEND_API_KEY missing, or a validated reject before
// the send). Never releases a delivered record.
async function markFailed(eventId, ref) {
  if (!eventId) return { ok: false };
  const backend = resolveBackend(ref);
  const { data: cur } = await backend.read(eventId);
  if (cur && cur.status === 'delivered') return { ok: false, kept: true };
  await backend.remove(eventId);
  return { ok: true };
}

module.exports = {
  claimCompletedLead,
  markSending,
  markDelivered,
  markSendingUnknown,
  markFailedRetryable,
  markFailed,
  canonicalLeadHash,
  __setBlobStoreFactory,
  INFLIGHT_TTL_MS,
};
