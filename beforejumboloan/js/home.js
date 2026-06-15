/* ============================================================
   BeforeJumboLoan.com — Homepage mini-engine (deterministic)
   Drives the above-the-fold Jumbo Gap Scanner, Loan Path Map,
   Strategy Levers, and Engine Insight panel using the SAME engine
   (window.KW) and resolver (window.BJLLimits) as the Strategy Studio.
   No AI. No network beyond the local loan-limit dataset fetch.
   ============================================================ */
(function () {
  "use strict";
  if (!window.KW || !document.querySelector("[data-scanner]")) return;
  var KW = window.KW;
  var $ = function (s) { return document.querySelector(s); };
  var fmt = KW.fmtCurrency;
  var num = KW.parseNum;
  var COMPLIANCE = (window.KW && KW.COMPLIANCE_REF) ||
    "Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch.";
  var SAFE = "Educational structure estimate only. Not approval, qualification, rate quote, APR, loan estimate, or commitment to lend.";

  // Default example scenario (Los Angeles County — a high-cost market).
  var S = { state: "CA", county: "Los Angeles County", units: 1, occupancy: "Primary residence",
    price: 1600000, downPct: 18 };

  var els = {
    state: $("#hs-state"), county: $("#hs-county"), countyFree: $("#hs-county-free"),
    units: $("#hs-units"), occ: $("#hs-occ"), price: $("#hs-price"), down: $("#hs-down"),
    priceOut: $("#hs-price-out"), downOut: $("#hs-down-out")
  };

  function set(sel, txt) { var e = $(sel); if (e) e.textContent = txt; }

  /* ---- selector population (from the resolver's geo data) ---- */
  function populateStates() {
    if (!els.state || !window.BJLLimits) return;
    var states = window.BJLLimits.getStates();
    if (!states.length) return;
    els.state.innerHTML = states.map(function (s) {
      return '<option value="' + s.abbr + '">' + s.name + "</option>";
    }).join("");
    els.state.value = S.state;
  }
  function populateCounties(stateAbbr, keep) {
    if (!els.county) return;
    var counties = (window.BJLLimits && window.BJLLimits.getCounties(stateAbbr)) || [];
    if (counties.length) {
      els.county.hidden = false; els.county.disabled = false;
      if (els.countyFree) { els.countyFree.hidden = true; els.countyFree.value = ""; }
      els.county.innerHTML = '<option value="">Select county…</option>' +
        counties.map(function (c) { return '<option value="' + c.name + '">' + c.name + "</option>"; }).join("");
      if (keep) els.county.value = keep;
    } else {
      els.county.hidden = true; els.county.disabled = true;
      if (els.countyFree) { els.countyFree.hidden = false; els.countyFree.value = keep || ""; }
    }
  }

  /* ---- read current inputs into S ---- */
  function read() {
    if (els.price) S.price = num(els.price.value);
    if (els.down) S.downPct = num(els.down.value);
    if (els.units) S.units = parseInt(els.units.value, 10) || 1;
    if (els.occ) S.occupancy = els.occ.value;
    if (els.state) S.state = els.state.value;
    if (els.county && !els.county.hidden) S.county = els.county.value;
    else if (els.countyFree && !els.countyFree.hidden) S.county = els.countyFree.value.trim();
  }

  function occShort(o) { return KW.occShort ? KW.occShort(o) : (/(invest)/i.test(o) ? "Investment" : /second/i.test(o) ? "Second home" : "Primary"); }

  /* ---- the deterministic computation ---- */
  function compute() {
    read();
    var down = Math.min(S.price, Math.round(S.price * S.downPct / 100));
    var loan = Math.max(0, S.price - down);

    // Resolve county limits via the shared engine (mutates MARKET_CONFIG for KW.* reuse).
    var loc = KW.applyLocation ? KW.applyLocation(S.state, S.county, "", S.units) : null;
    var baseline = loc && loc.conformingBaseline;
    var countyLimit = loc && loc.countyConformingLimit;
    var needsVerify = loc && loc.needsVerification;
    var datasetType = loc && loc.datasetType;

    var delta = (countyLimit != null) ? (loan - countyLimit) : null;   // >0 over the line
    var addlDown = (delta != null && delta > 0) ? delta : 0;

    // Review-path zone.
    var occ = occShort(S.occupancy);
    var zone = "conforming";
    if (countyLimit != null && loan > countyLimit) zone = "jumbo";
    else if (baseline != null && loan > baseline) zone = "high-balance";
    var node = occ === "Investment" ? "dscr" : zone;

    // Estimated P&I (payment-stack preview altitude).
    var ra = KW.rateFor ? KW.rateFor({ loan: loan, main_concern: "" }) : { rate: 6.84, label: "30-yr assumption" };
    var pi = KW.monthlyPI ? KW.monthlyPI(loan, ra.rate, 30) : 0;

    render({ down: down, loan: loan, baseline: baseline, countyLimit: countyLimit,
      delta: delta, addlDown: addlDown, zone: zone, node: node, occ: occ,
      needsVerify: needsVerify, datasetType: datasetType, pi: pi, rate: ra });
    updateContinue();
  }

  /* ---- render outputs ---- */
  function render(o) {
    set('[data-ho="loan"]', fmt(o.loan));
    set('[data-ho="limit"]', o.countyLimit != null
      ? (fmt(o.countyLimit) + (o.needsVerify ? " · needs verification" : (o.zone === "jumbo" || o.zone === "high-balance" ? " · high-cost" : "")))
      : "—");
    var limEl = $('[data-ho="limit"]'); if (limEl) limEl.setAttribute("data-verify", o.needsVerify ? "yes" : "no");

    var deltaEl = $('[data-ho="delta"]');
    if (deltaEl) {
      if (o.delta == null) { deltaEl.textContent = "—"; deltaEl.removeAttribute("data-over"); }
      else if (o.delta > 0) { deltaEl.textContent = fmt(o.delta) + " above the county line"; deltaEl.setAttribute("data-over", "yes"); }
      else { deltaEl.textContent = fmt(-o.delta) + " below the county line"; deltaEl.setAttribute("data-over", "no"); }
    }

    set('[data-ho="gap"]', o.addlDown > 0 ? ("+" + fmt(o.addlDown) + " down to reach the line") : "At or below the county line");
    set('[data-ho="pi"]', fmt(o.pi) + "/mo");
    set('[data-ho="rate"]', "est. P&I · " + o.rate.rate + "% " + (o.rate.label || "assumption"));

    // structure bar (purchase axis): down segment, loan segment, county line marker.
    var dPct = Math.max(0, Math.min(100, (o.down / S.price) * 100));
    var barDown = $("[data-ho-bar-down]"); if (barDown) barDown.style.width = dPct + "%";
    var barLoan = $("[data-ho-bar-loan]"); if (barLoan) { barLoan.style.left = dPct + "%"; barLoan.style.width = (100 - dPct) + "%"; }
    var line = $("[data-ho-bar-line]");
    if (line) {
      // County line position = where the loan would equal the county limit on the purchase axis.
      if (o.countyLimit != null && S.price > 0) {
        var linePos = Math.max(0, Math.min(100, ((o.down + o.countyLimit) / S.price) * 100));
        line.style.left = linePos + "%"; line.hidden = false;
      } else { line.hidden = true; }
    }

    // Loan Path Map marker.
    document.querySelectorAll(".pathmap__node").forEach(function (n) {
      n.removeAttribute("data-current");
    });
    var cur = document.querySelector('.pathmap__node[data-node="' + o.node + '"]');
    if (cur) cur.setAttribute("data-current", "yes");

    // Next best lever.
    set('[data-ho="nextlever"]', nextLever(o));

    // Engine insights (deterministic).
    renderInsights(o);

    // Dataset / verification note.
    var note = $("[data-ho-note]");
    if (note) {
      var msg = SAFE + " ";
      if (o.needsVerify) msg += "Selected county isn’t in the loaded dataset — limit needs official verification. ";
      if (o.datasetType === "sample") msg += "County limit database is being finalized. ";
      note.textContent = msg + COMPLIANCE;
    }
  }

  function nextLever(o) {
    if (o.countyLimit == null) return "Select a state and county to scan the structure.";
    if (o.delta > 0) return "Add about " + fmt(o.addlDown) + " in down payment to bring the loan to the county line.";
    if (o.zone === "high-balance") return "You’re in high-balance review — a larger down payment could move the scenario toward conforming.";
    if (o.occ === "Investment") return "Investment scenario — rent vs. payment (DSCR) drives the review path.";
    return "You’re below the county line — review the payment stack and buydown options in the Studio.";
  }

  function renderInsights(o) {
    var ul = $("[data-ho-insights]"); if (!ul) return;
    var lines = [];
    if (o.delta != null && o.delta > 0)
      lines.push("Estimated loan amount is " + fmt(o.delta) + " above the selected county reference line.");
    else if (o.delta != null && o.zone === "high-balance")
      lines.push("Estimated loan amount is within the high-balance reference range for the selected county.");
    else if (o.delta != null)
      lines.push("Estimated loan amount is below the selected county reference line.");
    if (o.addlDown > 0)
      lines.push("A larger down payment (about " + fmt(o.addlDown) + ") may move the scenario closer to the county line.");
    lines.push("Taxes, insurance, HOA, and flood assumptions can materially change the monthly picture.");
    lines.push(o.occ === "Investment"
      ? "DSCR applies for this investment-property review — rent vs. estimated housing cost."
      : "DSCR applies only for investment-property review.");
    lines.push("Buydown math depends on upfront cost, monthly savings, and expected hold period.");
    if (o.needsVerify) lines.push("This county’s limit is not in the loaded dataset — it needs official verification before use.");
    ul.innerHTML = lines.slice(0, 6).map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }

  /* ---- "Continue Into Full Strategy Studio" carries the scenario ---- */
  var PRESET_SLUG = {
    "CA|los angeles": "los-angeles", "CA|orange": "orange-county",
    "FL|miami-dade": "miami-dade", "FL|palm beach": "palm-beach", "FL|monroe": "key-west"
  };
  function updateContinue() {
    var a = $("[data-ho-continue]"); if (!a) return;
    var key = (S.state || "") + "|" + String(S.county || "").toLowerCase().replace(/\s+county$/, "");
    var q = new URLSearchParams();
    if (PRESET_SLUG[key]) q.set("market", PRESET_SLUG[key]);
    if (S.state) q.set("state", S.state);
    if (S.county) q.set("county", S.county);
    if (S.units) q.set("units", String(S.units));
    q.set("price", String(S.price));
    q.set("downpct", String(S.downPct));
    q.set("occ", occShort(S.occupancy).toLowerCase());
    a.setAttribute("href", "scenario-studio.html?" + q.toString());
  }

  /* ---- wiring ---- */
  function syncReadouts() {
    if (els.priceOut) els.priceOut.textContent = fmt(num(els.price.value));
    if (els.downOut) els.downOut.textContent = num(els.down.value) + "%";
  }

  function bind() {
    [els.price, els.down].forEach(function (el) { if (el) el.addEventListener("input", function () { syncReadouts(); compute(); }); });
    [els.units, els.occ].forEach(function (el) { if (el) el.addEventListener("change", compute); });
    if (els.state) els.state.addEventListener("change", function () { S.county = ""; populateCounties(els.state.value, ""); compute(); });
    if (els.county) els.county.addEventListener("change", compute);
    if (els.countyFree) els.countyFree.addEventListener("input", compute);

    // Strategy lever quick-actions.
    document.querySelectorAll("[data-lever-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-lever-action");
        if (act === "down+5" && els.down) els.down.value = Math.min(60, num(els.down.value) + 5);
        if (act === "down-5" && els.down) els.down.value = Math.max(0, num(els.down.value) - 5);
        if (act === "units2" && els.units) els.units.value = "2";
        if (act === "units1" && els.units) els.units.value = "1";
        if (act === "invest" && els.occ) els.occ.value = "Investment property";
        if (act === "primary" && els.occ) els.occ.value = "Primary residence";
        syncReadouts(); compute();
      });
    });
  }

  function init() {
    populateStates();
    populateCounties(S.state, S.county);
    if (els.price) els.price.value = S.price;
    if (els.down) els.down.value = S.downPct;
    if (els.units) els.units.value = String(S.units);
    if (els.occ) els.occ.value = S.occupancy;
    syncReadouts();
    bind();
    compute();
  }

  // Render immediately with whatever is loaded, then re-init when the dataset arrives.
  if (window.BJLLimits && window.BJLLimits.isLoaded && window.BJLLimits.isLoaded()) init();
  else { bind(); syncReadouts(); compute(); }
  window.addEventListener("bjl:limits-ready", init);
})();
