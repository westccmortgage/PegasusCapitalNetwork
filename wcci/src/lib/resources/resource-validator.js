// Resource validator — the security layer between model output and the UI.
//
// The model only ever emits resource IDs. Before anything renders:
//   1. the ID must exist in the Site Registry,
//   2. the resource must be `verified`,
//   3. the audience must be allowed (hard audience mismatch overrides all),
//   4. the resolved URL must not match any hard exclusion,
//   5. duplicates are removed and the list is capped at MAX_RECOMMENDATIONS.
// Unknown or model-invented URLs can never render because URLs are resolved
// exclusively from the registry — a raw URL in model text is not a link.

import { getResource, EXCLUDED_DOMAINS, EXCLUDED_URL_PATTERNS } from './site-registry.js';

export const MAX_RECOMMENDATIONS = 3;

// Is a URL allowed to render at all? (defense-in-depth; normal flow never
// passes raw URLs, but tests + the sync script use this check too)
export function isUrlAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (EXCLUDED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return false;
  if (EXCLUDED_URL_PATTERNS.some(re => re.test(url))) return false;
  return true;
}

// Does this audience have access to the resource?
export function audienceAllowed(resource, audience) {
  const aud = audience || 'consumer_borrower';
  if ((resource.neverAutoRouteFor || []).includes(aud)) return false;
  return resource.audiences.includes(aud);
}

/**
 * Validate model/router recommendations into render-safe entries.
 * @param {Array<{id:string, reason?:string, reasonKey?:string}>} recs
 * @param {{audience?: string, allowedIds?: string[], onReject?: (id:string, why:string)=>void}} opts
 *   allowedIds — when provided (the deterministic candidate set), the model may
 *   only pick from it; anything else is rejected.
 * @returns {Array<{id, url, brand, title, category, actionLabel, shortDescription, reason, reasonKey}>}
 */
export function validateRecommendations(recs, opts = {}) {
  const { audience = 'consumer_borrower', allowedIds = null, onReject } = opts;
  const out = [];
  const seen = new Set();
  for (const rec of Array.isArray(recs) ? recs : []) {
    const id = rec && rec.id;
    if (!id || seen.has(id)) continue;
    const reject = (why) => { try { onReject && onReject(String(id), why); } catch {} };

    const r = getResource(id);
    if (!r) { reject('unknown_id'); continue; }
    if (!r.verified) { reject('unverified'); continue; }
    if (allowedIds && !allowedIds.includes(id)) { reject('not_in_candidate_set'); continue; }
    if (!audienceAllowed(r, audience)) { reject('audience_mismatch'); continue; }
    if (!isUrlAllowed(r.canonicalUrl)) { reject('excluded_url'); continue; }

    seen.add(id);
    out.push({
      id: r.id,
      url: r.canonicalUrl,
      brand: r.brand,
      title: r.title,
      category: r.category,
      actionLabel: r.actionLabel,
      shortDescription: r.shortDescription,
      reason: typeof rec.reason === 'string' ? rec.reason.slice(0, 240) : '',
      reasonKey: rec.reasonKey || '',
    });
    if (out.length >= MAX_RECOMMENDATIONS) break;
  }
  return out;
}
