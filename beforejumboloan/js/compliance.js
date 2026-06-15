/* ============================================================
   BeforeJumboLoan.com — Centralized compliance / company config
   Single source of truth for brand, licensing, and footer wording.
   Loaded on every page; renders the global footer-legal block and
   fills [data-compliance="…"] hooks. Conservative by design:
   nothing here asserts a license as final until verified.
   ============================================================ */
(function (global) {
  "use strict";

  var C = {
    product_brand: "BeforeJumboLoan.com",
    product_description: "educational mortgage strategy resource",
    licensed_review_entity: "West Coast Capital Mortgage Inc.",
    company_nmls: "2817729",
    individual_name: "Anatoliy Kanevsky",
    individual_nmls: "2775380",
    ca_dre: "01385024",
    lead_email: "REPLACE_WITH_PRODUCTION_LEAD_EMAIL",
    phone: "REPLACE_WITH_PRODUCTION_PHONE",
    business_address: "REPLACE_WITH_PRODUCTION_ADDRESS",
    equal_housing: true,
    verification_status: "verify before production launch",
    nmls_consumer_access_url: "https://www.nmlsconsumeraccess.org/",
    // Configurable license footprint — left empty until confirmed, so the site
    // never asserts active state licensing it can't back up.
    states_active: [],
    states_pending_or_future: ["CA", "FL"],
    // Single source of truth for the lender-application redirect. The secure
    // application portal (ARIVE / my1003app) is shown ONLY for these states.
    supported_application_states: ["CA", "FL"],
    application_portal_name: "ARIVE / my1003app",
    application_portal_url: "https://2817729.my1003app.com/2775380/register"
  };

  function isSupportedState(st) {
    st = String(st == null ? "" : st).trim().toUpperCase();
    return C.supported_application_states.indexOf(st) > -1;
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function realEmail() { return EMAIL_RE.test(C.lead_email) && !/REPLACE|SET_/i.test(C.lead_email); }
  function realPhone() { return C.phone && !/REPLACE|SET_/i.test(C.phone); }

  var EHO_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/></svg>';

  function educationalDisclaimer() {
    return C.product_brand + " is an " + C.product_description +
      ". It is not a loan application, rate quote, APR disclosure, loan estimate, approval, or commitment to lend. " +
      "Licensed mortgage review may be provided only where properly licensed and authorized.";
  }

  function licensingSentence() {
    return "Licensed mortgage review may be provided by " + C.licensed_review_entity +
      ", NMLS #" + C.company_nmls + " (" + C.individual_name + ", NMLS #" + C.individual_nmls +
      "; CA DRE #" + C.ca_dre + "), where licensed and applicable. Additional license details must be " +
      C.verification_status + ".";
  }

  function footerLegalHTML() {
    var year = new Date().getFullYear();
    return '' +
      '<div class="footer-disclosures">' +
        '<span class="ehl">' + EHO_SVG + ' Equal Housing Opportunity</span>' +
        '<span><a href="' + C.nmls_consumer_access_url + '" rel="noopener" target="_blank">NMLS Consumer Access</a></span>' +
      '</div>' +
      '<p>' + educationalDisclaimer() + '</p>' +
      '<p>' + licensingSentence() + '</p>' +
      '<p style="margin-top:14px">&copy; ' + year + ' ' + C.product_brand +
        ' · <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a> · <a href="disclosures.html">Disclosures</a></p>';
  }

  function setHTML(sel, html) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].innerHTML = html;
  }

  function render() {
    // Global footer — overwrite any .footer-legal block from one source.
    setHTML(".footer-legal", footerLegalHTML());
    // Page hooks.
    setHTML('[data-compliance="legal"]', educationalDisclaimer());
    setHTML('[data-compliance="licensing"]', licensingSentence());
    // Powered-by trust line under the brand mark, on every page (one source).
    var brands = document.querySelectorAll(".brand");
    for (var b = 0; b < brands.length; b++) {
      if (!brands[b].querySelector(".brand__powered")) {
        var s = document.createElement("span");
        s.className = "brand__powered";
        s.textContent = "Powered by " + C.licensed_review_entity;
        brands[b].appendChild(s);
      }
    }
    // Contact details only when real values are configured.
    if (realEmail()) {
      document.querySelectorAll('[data-compliance="email"]').forEach(function (a) {
        a.textContent = C.lead_email; a.setAttribute("href", "mailto:" + C.lead_email);
      });
    }
    if (realPhone()) setHTML('[data-compliance="phone"]', C.phone);
  }

  global.BJL_COMPLIANCE = C;
  global.BJLCompliance = {
    config: C, render: render, footerLegalHTML: footerLegalHTML,
    licensingSentence: licensingSentence, educationalDisclaimer: educationalDisclaimer,
    isSupportedState: isSupportedState,
    applicationUrl: function () { return C.application_portal_url; },
    supportedStates: function () { return C.supported_application_states.slice(); }
  };

  if (document.readyState !== "loading") render();
  else document.addEventListener("DOMContentLoaded", render);
})(window);
