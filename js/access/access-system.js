/* ============================================================================
 * Pegasus Access System — Core (redeem + activate)
 * js/access/access-system.js
 *
 * window.PegAccess.redeem(code) -> Promise<{ok, membership_tier,
 *   onboarding_flow, source, already, reason}>
 *
 * Calls redeem_access_code RPC which ATOMICALLY validates, increments usage,
 * records the redemption, and activates the membership (free — never Stripe).
 * Must be called while authenticated; activation applies to the signed-in user.
 *
 * Also handles a pending code captured at signup (stored in auth metadata or a
 * short-lived in-memory handoff) so it can be redeemed after email confirmation.
 * ========================================================================== */
(function () {
  "use strict";
  var PegAccess = (window.PegAccess = window.PegAccess || {});

  /* Redeem a code for the current authenticated user. */
  PegAccess.redeem = async function (code) {
    var clean = (code || "").trim();
    if (!clean) return { ok: false, reason: "empty" };
    try {
      var sb = await window.PegSB.ready;
      var res = await sb.rpc("redeem_access_code", { p_code: clean });
      if (res.error) {
        console.warn("[Access] redeem error:", res.error.message);
        return { ok: false, reason: "error", error: res.error.message };
      }
      var out = res.data || { ok: false, reason: "unknown" };
      if (out.ok) {
        console.log("[Access] redeemed:", out.membership_tier, "via", out.source, out.already ? "(already)" : "");
        // Refresh the local store so the new tier is visible same-page,
        // without requiring a navigation. Without this, a tier-gated surface
        // (Deal Rooms, Showcase, Network Requests) re-checks tier from a
        // stale store and still sends the user to billing even though the DB
        // already has the upgraded membership row.
        try {
          if (window.Pegasus && Pegasus.store && typeof Pegasus.store.hydrate === "function") {
            await Pegasus.store.hydrate();
          } else if (window.PegStore && typeof PegStore.hydrate === "function") {
            await PegStore.hydrate();
          }
        } catch (e) { console.warn("[Access] post-redeem hydrate failed:", e && e.message); }
      }
      return out;
    } catch (e) {
      console.warn("[Access] redeem exception:", e && e.message);
      return { ok: false, reason: "error", error: e && e.message };
    }
  };

  /* Read the access code the user signed up with — checks two sources so
   * a Google OAuth round-trip on signup doesn't lose the code:
   *   1. Supabase user_metadata.access_code (set by email/password signUp)
   *   2. localStorage pegasus.pendingAccessCode (set by signup.html before
   *      redirecting to Google, since OAuth metadata is owned by Google) */
  PegAccess.pendingCode = async function () {
    try {
      var sb = await window.PegSB.ready;
      var u = (await sb.auth.getUser()).data.user;
      var md = (u && u.user_metadata) || {};
      if (md.access_code) return md.access_code;
    } catch (e) {}
    try {
      var pc = localStorage.getItem('pegasus.pendingAccessCode');
      return pc || null;
    } catch (e) { return null; }
  };
  /* Clear the localStorage handoff once the code has been redeemed, so we
   * don't try to re-redeem it on every page load. */
  PegAccess.clearPendingCode = function () {
    try { localStorage.removeItem('pegasus.pendingAccessCode'); } catch (_) {}
  };

  /* Convenience: if the signed-in user has a pending code from signup and has
   * not yet redeemed it, redeem it now. Safe to call on dashboard/callback load.
   * Idempotent — the RPC no-ops if already redeemed. */
  PegAccess.redeemPendingIfAny = async function () {
    var code = await PegAccess.pendingCode();
    if (!code) return null;
    var result = await PegAccess.redeem(code);
    if (result && result.ok) { try { PegAccess.clearPendingCode(); } catch(_){} }
    if (result && result.ok && window.PegAccessOnboarding && !result.already) {
      // Route to the appropriate onboarding once, on fresh redemption
      try { window.PegAccessOnboarding.route(result.onboarding_flow); } catch (_) {}
    }
    return result;
  };
})();
