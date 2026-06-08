/* ============================================================================
 * Pegasus Access System — Onboarding Routing
 * js/access/access-onboarding.js
 *
 * Different access codes carry an onboarding_flow. This module maps a flow to
 * a destination + a short, premium welcome message. Kept intentionally simple
 * and data-driven so new flows are one-line additions.
 *
 * window.PegAccessOnboarding.route(flow)        -> navigates
 * window.PegAccessOnboarding.destination(flow)  -> returns URL (no navigation)
 * window.PegAccessOnboarding.welcome(flow)      -> returns {title, body}
 * ========================================================================== */
(function () {
  "use strict";
  var O = (window.PegAccessOnboarding = window.PegAccessOnboarding || {});

  var FLOWS = {
    growth_partner: {
      dest: "/profile-edit.html",
      title: "Welcome, Growth Partner.",
      body: "Build your presence so the ecosystem can align you with the right capital relationships.",
    },
    growth_capital: {
      dest: "/growth-capital.html",
      title: "Welcome to Growth Capital.",
      body: "Set up your founder presence and connect with institutional capital partners.",
    },
    priority: {
      dest: "/dashboard.html",
      title: "Priority access granted.",
      body: "Your ambassador invitation unlocks elevated access. Your workspace is ready.",
    },
    default: {
      dest: "/dashboard.html",
      title: "You’re in.",
      body: "Welcome to the Pegasus ecosystem.",
    },
  };

  function pick(flow) { return FLOWS[(flow || "default")] || FLOWS.default; }

  O.destination = function (flow) { return pick(flow).dest; };
  O.welcome = function (flow) { var f = pick(flow); return { title: f.title, body: f.body }; };
  O.route = function (flow) {
    var dest = pick(flow).dest;
    // Defer slightly so any activation writes settle before navigation
    setTimeout(function () { try { window.location.href = dest; } catch (_) {} }, 400);
  };
})();
