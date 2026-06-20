/* ============================================================
   K West Mortgage — Strategy Studio compliance shim
   Provides the minimal window.BJLCompliance API the studio
   console (studio-app.js) reads, WITHOUT overwriting the KWest
   footer/brand. Conversion routes to the on-page Key West lead
   form (#lead) — no external application portal, no AI links.
   ============================================================ */
(function (global) {
  "use strict";
  global.BJLCompliance = {
    config: { application_portal_url: "#lead" },
    isSupportedState: function (st) { return String(st == null ? "" : st).trim().toUpperCase() === "FL"; },
    applicationUrl: function () { return "#lead"; },
    supportedStates: function () { return ["FL"]; }
  };
})(typeof window !== "undefined" ? window : globalThis);
