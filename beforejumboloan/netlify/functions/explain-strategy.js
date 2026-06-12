/**
 * explain-strategy.js — Netlify Function — PHASE 2 SEAM (inert)
 *
 * This is the server endpoint the AI Strategy Explainer will use. It is wired
 * into routing but intentionally returns 501 until Phase 2, so the contract is
 * visible and testable without shipping AI behavior early.
 *
 * Phase 2 plan:
 *   - read `context` (snapshot.aiContext) from the body
 *   - call the model (Anthropic) with a constrained, compliance-aware prompt
 *   - stream/return a plain-English explanation
 *   - secrets via env (e.g. ANTHROPIC_API_KEY), never in the repo
 */

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  // Phase 1: not enabled.
  return json(501, {
    ok: false,
    enabled: false,
    message:
      'AI Strategy Explainer is not enabled yet. This endpoint is reserved for Phase 2 and ' +
      'already accepts the engine snapshot contract.',
  });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
