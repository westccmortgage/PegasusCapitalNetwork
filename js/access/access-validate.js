/* ============================================================================
 * Pegasus Access System — Validation
 * js/access/access-validate.js
 *
 * window.PegAccess.validate(code) -> Promise<{valid, membership_tier,
 *   duration_days, source, onboarding_flow, reason}>
 *
 * Calls the secure validate_access_code RPC (SECURITY DEFINER) so the full
 * access_codes table is never exposed to the client. Safe for anon use on the
 * signup page to preview the tier a code grants.
 * ========================================================================== */
(function () {
  "use strict";
  var PegAccess = (window.PegAccess = window.PegAccess || {});

  // Friendly labels for tiers (display only)
  var TIER_LABELS = { starter: "Starter", pro: "Pro", gold: "Gold" };
  PegAccess.tierLabel = function (t) { return TIER_LABELS[(t || "").toLowerCase()] || "Starter"; };

  var REASONS = {
    not_found: "That invitation code wasn’t recognized.",
    inactive: "This invitation code is no longer active.",
    expired: "This invitation has expired.",
    limit_reached: "This invitation has reached its limit.",
    not_authenticated: "Please sign in to redeem this invitation.",
  };
  PegAccess.reasonText = function (r) { return REASONS[r] || "This invitation code could not be applied."; };

  /* Validate a code (read-only preview). Returns a normalized object. */
  PegAccess.validate = async function (code) {
    var clean = (code || "").trim();
    if (!clean) return { valid: false, reason: "empty" };
    try {
      var sb = await window.PegSB.ready;
      var res = await sb.rpc("validate_access_code", { p_code: clean });
      if (res.error) {
        console.warn("[Access] validate error:", res.error.message);
        return { valid: false, reason: "error", error: res.error.message };
      }
      return res.data || { valid: false, reason: "not_found" };
    } catch (e) {
      console.warn("[Access] validate exception:", e && e.message);
      return { valid: false, reason: "error", error: e && e.message };
    }
  };
})();
