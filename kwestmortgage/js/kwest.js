/* ============================================================
   K West Mortgage — Site behavior
   Nav, scenario rotation, scroll reveal, accordion,
   forms (webhook/email ready), cookie consent + visitor ID.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- Config ----------------
     Set FORM_ENDPOINT to your webhook / Netlify function / Zapier URL
     to start capturing leads. Until set, submissions are stored
     locally and the success message still shows.                     */
  var CONFIG = {
    FORM_ENDPOINT: "", // e.g. "/.netlify/functions/lead" or a webhook URL
    BRAND: "K West Mortgage"
  };

  /* ---------------- Helpers ---------------- */
  function $(s, ctx) { return (ctx || document).querySelector(s); }
  function $all(s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); }
  function uid() { return "kw_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9); }

  /* ---------------- Header scroll state ---------------- */
  var header = $(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("scrolled", window.scrollY > 12); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- Mobile nav ---------------- */
  var toggle = $(".nav__toggle"), menu = $(".mobile-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.classList.toggle("open", open);
      document.body.style.overflow = open ? "hidden" : "";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    $all("a", menu).forEach(function (a) {
      a.addEventListener("click", function () {
        menu.classList.remove("open"); toggle.classList.remove("open"); document.body.style.overflow = "";
      });
    });
  }

  /* ---------------- Scroll reveal ---------------- */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    $all(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    $all(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------------- Rotating scenario card ---------------- */
  var stage = $("[data-scenarios]");
  if (stage) {
    var scenarios = [
      { q: "“I’m buying in Key West at $1.15M with 20% down. Do I really need jumbo?”", next: "High-Balance Review", href: "jumbo-vs-conforming.html" },
      { q: "“I’m self-employed and buying a second home in Key West.”", next: "Self-Employed / Second Home Review", href: "loan-options.html" },
      { q: "“I’m buying an investment property in the Florida Keys and want to compare DSCR vs conventional.”", next: "Investor Review", href: "loan-options.html" },
      { q: "“I’m a veteran buying in Monroe County. Can VA work in Key West?”", next: "VA Review", href: "loan-options.html" }
    ];
    var quoteEl = $(".scenario-card .quote", stage);
    var nextEl = $(".scenario-card .next span", stage);
    var nextLink = $(".scenario-card .next", stage);
    var dotsWrap = $(".scenario-dots", stage);
    var idx = 0, timer;

    scenarios.forEach(function (_, i) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("aria-label", "Scenario " + (i + 1));
      b.addEventListener("click", function () { show(i); reset(); });
      dotsWrap.appendChild(b);
    });
    var dots = $all("button", dotsWrap);

    function show(i) {
      idx = i;
      quoteEl.classList.remove("show");
      window.setTimeout(function () {
        quoteEl.textContent = scenarios[i].q;
        nextEl.textContent = scenarios[i].next;
        if (nextLink) nextLink.setAttribute("href", scenarios[i].href);
        quoteEl.classList.add("show");
      }, 180);
      dots.forEach(function (d, di) { d.classList.toggle("active", di === i); });
    }
    function advance() { show((idx + 1) % scenarios.length); }
    function reset() { window.clearInterval(timer); timer = window.setInterval(advance, 5200); }
    show(0); reset();
  }

  /* ---------------- Accordion ---------------- */
  $all(".acc-head").forEach(function (head) {
    head.addEventListener("click", function () {
      var item = head.closest(".acc-item");
      var body = $(".acc-body", item);
      var open = item.classList.toggle("open");
      body.style.maxHeight = open ? body.scrollHeight + "px" : null;
      head.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* ---------------- Visitor ID (first-party, consent-gated) ---------------- */
  function ensureVisitorId() {
    try {
      if (localStorage.getItem("kw_consent") !== "granted") return null;
      var id = localStorage.getItem("kw_visitor_id");
      if (!id) { id = uid(); localStorage.setItem("kw_visitor_id", id); }
      return id;
    } catch (e) { return null; }
  }

  /* ---------------- Cookie consent ---------------- */
  var bar = $(".cookie-bar");
  if (bar) {
    var stored;
    try { stored = localStorage.getItem("kw_consent"); } catch (e) { stored = null; }
    if (!stored) { window.setTimeout(function () { bar.classList.add("show"); }, 900); }
    var setConsent = function (val) {
      try { localStorage.setItem("kw_consent", val); } catch (e) {}
      bar.classList.remove("show");
      if (val === "granted") ensureVisitorId();
    };
    var acc = $("[data-consent-accept]", bar), dec = $("[data-consent-decline]", bar);
    if (acc) acc.addEventListener("click", function () { setConsent("granted"); });
    if (dec) dec.addEventListener("click", function () { setConsent("declined"); });
  }
  ensureVisitorId();

  /* ---------------- Netlify Forms (AJAX submit) ----------------
     Forms stay as real Netlify forms in the HTML (data-netlify="true" +
     hidden form-name + honeypot) so Netlify detects them at deploy and the
     native POST still works with JS disabled. With JS on, we submit via a
     urlencoded fetch POST to "/" (the most reliable Netlify method on
     statically-hosted sites), then redirect to the thank-you page. */
  $all('form[data-netlify]').forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      // Let the browser enforce required fields with its native UI first.
      if (typeof form.reportValidity === "function" && !form.reportValidity()) {
        ev.preventDefault();
        return;
      }
      ev.preventDefault();

      var btn = $("button[type=submit]", form);
      var redirect = form.getAttribute("action") || "/thank-you.html";

      // Build url-encoded body from the form (includes hidden form-name + bot-field).
      var data = new FormData(form);
      var encoded = new URLSearchParams();
      data.forEach(function (value, key) { encoded.append(key, value); });
      // Guarantee form-name is present even if the hidden field is ever missing.
      if (!encoded.has("form-name")) {
        encoded.append("form-name", form.getAttribute("name") || "key-west-scenario-review");
      }

      if (btn) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = "Sending…"; }

      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encoded.toString()
      }).then(function (res) {
        if (!res.ok) throw new Error("Bad status " + res.status);
        window.location.href = redirect;
      }).catch(function () {
        // Network/processing fallback: let the browser do a normal native POST,
        // which Netlify also accepts and will redirect to the action page.
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || "Submit"; }
        form.submit();
      });
    });
  });

  /* ---------------- Hero video ---------------- */
  /* Reveal a hero video only once it can actually play; otherwise the
     animated coastal gradient remains as a graceful fallback. */
  $all("[data-hero-video]").forEach(function (v) {
    var reveal = function () { v.classList.add("is-ready"); };
    if (v.readyState >= 3) reveal();
    v.addEventListener("canplay", reveal, { once: true });
    v.addEventListener("loadeddata", reveal, { once: true });
    // Best-effort autoplay (some browsers need an explicit call)
    var p = v.play && v.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  });

  /* ---------------- Year stamp ---------------- */
  $all("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
