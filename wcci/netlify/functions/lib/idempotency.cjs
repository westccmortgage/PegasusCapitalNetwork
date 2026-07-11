// Durable idempotency for completed-lead delivery.
//
// One qualifying scenario must produce exactly ONE completed-lead side effect,
// even though the model may expose two compatibility signals (SCENARIO_COMPLETE
// and CONVO_META handoff:automatic_lead) and the browser may retry.
//
// The completed-lead delivery function (partial-lead.js) claims a deterministic
// `completedLeadEventId` here BEFORE sending and marks it delivered only after
// the endpoint confirms. A second attempt with the same id is a no-op.
//
// Storage tiers (best available wins):
//   1. Netlify Blobs (strong consistency) — TRUE cross-request idempotency.
//   2. Warm-instance in-memory Map — best-effort only within one container.
// We never claim durable idempotency when only tier 2 is available.

const INFLIGHT_TTL_MS = 20000; // treat a very recent in-flight claim as a dup

// Warm-instance fallback (survives only within a single warm serverless box).
const MEM = new Map();

async function getBlobStore() {
  try {
    // @netlify/blobs is ESM and injected by the Netlify Functions runtime.
    const mod = await import('@netlify/blobs');
    if (mod && typeof mod.getStore === 'function') {
      try { return mod.getStore({ name: 'wcci-lead-idempotency', consistency: 'strong' }); }
      catch { return mod.getStore('wcci-lead-idempotency'); }
    }
  } catch { /* not available in this environment */ }
  return null;
}

async function readRecord(blob, eventId) {
  if (blob) { try { return await blob.get(eventId, { type: 'json' }); } catch { return null; } }
  return MEM.get(eventId) || null;
}
async function writeRecord(blob, eventId, rec) {
  if (blob) { try { await blob.setJSON(eventId, rec); return; } catch { /* fall through */ } }
  MEM.set(eventId, rec);
}
async function clearRecord(blob, eventId) {
  if (blob) { try { await blob.delete(eventId); return; } catch { /* fall through */ } }
  MEM.delete(eventId);
}

/**
 * Attempt to claim delivery for an event id.
 * @returns {{ firstTime: boolean, alreadyDelivered: boolean, mode: 'durable'|'memory', blob: any }}
 *   firstTime true  → caller should send, then call markDelivered/markFailed.
 *   alreadyDelivered→ a prior attempt already delivered; caller must NOT send.
 */
function isDup(rec) {
  if (!rec) return false;
  if (rec.status === 'delivered') return true;
  if (rec.status === 'inflight' && (Date.now() - (rec.at || 0)) < INFLIGHT_TTL_MS) return true;
  return false;
}

async function claimCompletedLead(eventId) {
  if (!eventId) return { firstTime: true, alreadyDelivered: false, mode: 'memory', blob: null };
  const blob = await getBlobStore();
  if (!blob) {
    // MEMORY TIER — synchronous check-and-set: no await between read and write,
    // so two concurrent claims in the SAME process cannot both win. (Across
    // separate warm instances this tier is still best-effort — see docs.)
    const existing = MEM.get(eventId);
    if (isDup(existing)) return { firstTime: false, alreadyDelivered: true, mode: 'memory', blob: null };
    MEM.set(eventId, { status: 'inflight', at: Date.now() });
    return { firstTime: true, alreadyDelivered: false, mode: 'memory', blob: null };
  }
  // DURABLE TIER (Netlify Blobs, strong consistency). Get-then-set has a small
  // eventual-consistency window; strong consistency + the inflight TTL make
  // near-simultaneous duplicates very unlikely but not provably impossible.
  const existing = await readRecord(blob, eventId);
  if (isDup(existing)) return { firstTime: false, alreadyDelivered: true, mode: 'durable', blob };
  await writeRecord(blob, eventId, { status: 'inflight', at: Date.now() });
  return { firstTime: true, alreadyDelivered: false, mode: 'durable', blob };
}

async function markDelivered(eventId, blob, meta = {}) {
  if (!eventId) return;
  await writeRecord(blob, eventId, { status: 'delivered', at: Date.now(), ...meta });
}

// On send failure, remove the in-flight marker so a controlled retry (same
// eventId, later turn) can proceed.
async function markFailed(eventId, blob) {
  if (!eventId) return;
  await clearRecord(blob, eventId);
}

module.exports = { claimCompletedLead, markDelivered, markFailed, INFLIGHT_TTL_MS };
