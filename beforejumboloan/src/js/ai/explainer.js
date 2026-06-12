/**
 * ai/explainer.js  — PHASE 2 SEAM (inert in Phase 1)
 *
 * This module defines the *interface* the AI Strategy Explainer will implement,
 * so the rest of the app can already depend on a stable contract. In Phase 1 it
 * returns a deterministic placeholder and never makes a network call.
 *
 * Phase 2 will:
 *   - POST `snapshot.aiContext` to defaults.ai.explainEndpoint
 *   - stream a plain-English explanation back into the studio panel
 *
 * Nothing about the engine or UI needs to change to enable it — only this file
 * and the matching Netlify function (netlify/functions/explain-strategy.js).
 */

/**
 * @param {Object} snapshot  output of engine/index.js#runStrategy
 * @param {Object} [opts]    { enabled, endpoint }
 * @returns {Promise<{ ok:boolean, mode:'placeholder'|'live', text:string }>}
 */
export async function explainStrategy(snapshot, opts = {}) {
  const enabled = opts.enabled === true;

  if (!enabled) {
    return {
      ok: true,
      mode: 'placeholder',
      text:
        'AI Strategy Explainer activates in Phase 2. The engine has already prepared a ' +
        'structured snapshot of this exact scenario, so turning it on is a wiring change — ' +
        'not a rebuild.',
    };
  }

  // ---- Phase 2 implementation (left intentionally unwired) ----
  // const res = await fetch(opts.endpoint, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ context: snapshot.aiContext }),
  // });
  // const data = await res.json();
  // return { ok: res.ok, mode: 'live', text: data.explanation };

  return { ok: false, mode: 'placeholder', text: 'Live explainer not yet enabled.' };
}

export default explainStrategy;
