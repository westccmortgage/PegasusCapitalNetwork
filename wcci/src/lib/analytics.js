// Privacy-safe analytics. Fires named events to Plausible (cookieless, already
// loaded in index.html) with ONLY non-PII properties. Never sends chat text,
// name, email, phone, street address, financial-account data, or file names.
//
// If Plausible isn't present (or a consent flag is off) events are dropped
// silently — respecting the existing cookieless/consent setup.

const EVENTS = new Set([
  'trust_objection_detected',
  'resource_recommended',
  'resource_impression',
  'resource_clicked',
  'contact_offer_shown',
  'contact_declined',
  'human_review_requested',
  'handoff_submitted',
  'broken_resource_detected',
]);

// Allowlist of property keys that are safe to send. Anything else is dropped.
const SAFE_KEYS = new Set(['resourceId', 'category', 'state', 'county', 'stage', 'language', 'objection', 'reasonKey', 'count']);

function sanitize(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (!SAFE_KEYS.has(k)) continue;
    if (v == null) continue;
    // Only short scalar values — never objects/arrays that could carry PII.
    if (typeof v === 'object') continue;
    out[k] = String(v).slice(0, 64);
  }
  return out;
}

export function track(event, props = {}) {
  if (!EVENTS.has(event)) return;
  try {
    if (typeof window === 'undefined') return;
    const p = sanitize(props);
    if (typeof window.plausible === 'function') {
      window.plausible(event, { props: p });
    }
  } catch { /* analytics must never break the app */ }
}

export const ANALYTICS_EVENTS = [...EVENTS];
