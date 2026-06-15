/* ============================================================
   BeforeJumboLoan.com — Homepage property-intelligence cockpit
   Command-driven: the user describes the property (ZIP, city, county,
   or alias); the deterministic resolver finds the county; the user
   CONFIRMS the property county; then the same engine (window.KW) +
   resolver (window.BJLLimits) compute the county line, jumbo gap,
   review path, and an Estimated P&I preview. No AI. No PII sent.
   ============================================================ */
(function () {
  "use strict";
  if (!window.KW || !document.querySelector("[data-scanner]")) return;
  var KW = window.KW;
  var BJL = window.BJLLimits;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var fmt = KW.fmtCurrency, num = KW.parseNum;
  var COMPLIANCE = (KW.COMPLIANCE_REF) || "Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch.";
  var SAFE = "Educational structure estimate only. Not approval, qualification, rate quote, APR, loan estimate, or commitment to lend.";

  // Default example (clearly labeled — user can change immediately).
  var S = {
    query: "Los Angeles County, CA",
    state: "CA", county: "Los Angeles County", county_fips: "06037",
    confirmed: true, isExample: true,
    units: 1, occupancy: "Primary residence", price: 1600000, downPct: 18
  };

  var E = {
    q: $("#hs-q"), resolve: $("[data-resolve]"),
    confident: $("[data-resolve-confident]"), detected: $("[data-detected]"), confirm: $("[data-confirm]"),
    choicesWrap: $("[data-resolve-choices]"), choices: $("[data-choices]"),
    manual: $("[data-resolve-manual]"), warn: $("[data-resolve-warn]"),
    mstate: $("#hs-mstate"), mcounty: $("#hs-mcounty"), confirmManual: $("[data-confirm-manual]"),
    confirmed: $("[data-confirmed]"), confirmedCounty: $("[data-confirmed-county]"), change: $("[data-change]"),
    scenario: $("[data-scenario]"),
    units: $("#hs-units"), occ: $("#hs-occ"), price: $("#hs-price"), down: $("#hs-down"),
    priceOut: $("#hs-price-out"), downOut: $("#hs-down-out")
  };
  function set(sel, t) { var e = $(sel); if (e) e.textContent = t; }
  function show(el, on) { if (el) el.hidden = !on; }

  /* ---------- resolve ---------- */
  function doResolve(query) {
    S.query = query;
    var r = BJL && BJL.resolvePropertyLocation ? BJL.resolvePropertyLocation(query) : { confidence: "none", possible_matches: [], warning: "Resolver not loaded." };
    show(E.resolve, true);
    show(E.confident, false); show(E.choicesWrap, false); show(E.manual, false);

    if (r.confidence === "high" && r.possible_matches.length === 1) {
      var m = r.possible_matches[0];
      E.detected.textContent = m.county_name + ", " + m.state_abbr + (m.matched_by ? "  ·  matched by " + m.matched_by : "");
      E.confirm.onclick = function () { confirmCounty(m, false); };
      show(E.confident, true);
    } else if (r.confidence === "ambiguous") {
      E.choices.innerHTML = "";
      r.possible_matches.forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "choice";
        b.textContent = m.label;
        b.onclick = function () { confirmCounty(m, false); };
        E.choices.appendChild(b);
      });
      show(E.choicesWrap, true);
    } else {
      E.warn.textContent = (r.warning || "I need the property county to calculate the county line.") +
        " Enter the property’s state and county.";
      show(E.manual, true);
      if (E.mstate && BJL) {
        var states = BJL.getStates();
        if (states.length && E.mstate.options.length <= 1) {
          E.mstate.innerHTML = '<option value="">State…</option>' + states.map(function (s) { return '<option value="' + s.abbr + '">' + s.name + "</option>"; }).join("");
        }
      }
    }
  }

  function confirmCounty(m, isExample) {
    S.state = m.state_abbr; S.county = m.county_name; S.county_fips = m.county_fips || null;
    S.confirmed = true; S.isExample = !!isExample;
    show(E.resolve, false);
    show(E.confirmed, true);
    if (E.confirmedCounty) E.confirmedCounty.textContent = (S.isExample ? "Example · " : "") + S.county + ", " + S.state;
    show(E.scenario, true);
    compute();
  }

  function confirmManual() {
    var st = E.mstate ? E.mstate.value : "";
    var cty = E.mcounty ? E.mcounty.value.trim() : "";
    if (!st || !cty) { E.warn.textContent = "Enter both the state and the property county."; return; }
    confirmCounty({ state_abbr: st, county_name: /county$|parish$|borough$/i.test(cty) ? cty : cty + " County", county_fips: null }, false);
  }

  /* ---------- compute (deterministic) ---------- */
  function read() {
    if (E.price) S.price = num(E.price.value);
    if (E.down) S.downPct = num(E.down.value);
    if (E.units) S.units = parseInt(E.units.value, 10) || 1;
    if (E.occ) S.occupancy = E.occ.value;
  }
  function occShort(o) { return KW.occShort ? KW.occShort(o) : (/invest/i.test(o) ? "Investment" : /second/i.test(o) ? "Second home" : "Primary"); }

  function compute() {
    if (!S.confirmed) return;
    read();
    var down = Math.min(S.price, Math.round(S.price * S.downPct / 100));
    var loan = Math.max(0, S.price - down);
    var loc = KW.applyLocation ? KW.applyLocation(S.state, S.county, "", S.units) : null;
    // Prefer FIPS-accurate resolution when we have it.
    if (BJL && BJL.resolveLoanLimits && S.county_fips) {
      var r2 = BJL.resolveLoanLimits({ county_fips: S.county_fips, state: S.state, county: S.county, units: S.units });
      if (r2 && r2.found) loc = r2;
    }
    var hasData = loc && loc.found && loc.countyConformingLimit != null && !loc.needsVerification;
    var countyLimit = hasData ? loc.countyConformingLimit : null;
    var baseline = loc && loc.conformingBaseline;
    var delta = hasData ? (loan - countyLimit) : null;
    var addlDown = (delta != null && delta > 0) ? delta : 0;

    var occ = occShort(S.occupancy);
    var zone = "conforming";
    if (hasData && loan > countyLimit) zone = "jumbo";
    else if (hasData && baseline != null && loan > baseline) zone = "high-balance";
    var node = !hasData ? null : (occ === "Investment" ? "dscr" : zone);

    var ra = KW.rateFor ? KW.rateFor({ loan: loan, main_concern: "" }) : { rate: 6.84, label: "30-yr assumption" };
    var pi = KW.monthlyPI ? KW.monthlyPI(loan, ra.rate, 30) : 0;

    render({ down: down, loan: loan, baseline: baseline, countyLimit: countyLimit, hasData: hasData,
      delta: delta, addlDown: addlDown, zone: zone, node: node, occ: occ, pi: pi, rate: ra,
      datasetType: loc && loc.datasetType, tier: loc && loc.tier });
    updateContinue();
  }

  function render(o) {
    set('[data-ho="loan"]', fmt(o.loan));

    var limEl = $('[data-ho="limit"]');
    if (limEl) {
      limEl.textContent = o.hasData ? (fmt(o.countyLimit) + (o.tier === "high-cost" ? " · high-cost" : " · baseline")) : "Needs official county data";
      limEl.setAttribute("data-verify", o.hasData ? "no" : "yes");
    }
    var deltaEl = $('[data-ho="delta"]');
    if (deltaEl) {
      if (!o.hasData) { deltaEl.textContent = "—"; deltaEl.removeAttribute("data-over"); }
      else if (o.delta > 0) { deltaEl.textContent = fmt(o.delta) + " above the selected county line"; deltaEl.setAttribute("data-over", "yes"); }
      else { deltaEl.textContent = fmt(-o.delta) + " below the selected county line"; deltaEl.setAttribute("data-over", "no"); }
    }
    set('[data-ho="gap"]', !o.hasData ? "Import official county data to calculate" : (o.addlDown > 0 ? ("+" + fmt(o.addlDown) + " down to reach the line") : "At or below the county line"));
    set('[data-ho="pi"]', fmt(o.pi) + "/mo");
    set('[data-ho="rate"]', "Estimated P&I preview · " + o.rate.rate + "% " + (o.rate.label || "assumption") + " · taxes, insurance, HOA, flood & MI added in the Studio");

    // County Line Meter (dollar axis: 0 → max(loan, county line, baseline)).
    var meter = $("[data-meter]");
    if (meter) {
      if (o.hasData) {
        meter.removeAttribute("data-empty");
        var max = Math.max(o.loan, o.countyLimit, o.baseline || 0) * 1.08;
        var pos = function (v) { return Math.max(0, Math.min(100, (v / max) * 100)); };
        var fill = $("[data-meter-loan]"); if (fill) fill.style.width = pos(o.loan) + "%";
        var over = $("[data-meter-over]");
        if (over) {
          if (o.delta > 0) { over.hidden = false; over.style.left = pos(o.countyLimit) + "%"; over.style.width = (pos(o.loan) - pos(o.countyLimit)) + "%"; }
          else over.hidden = true;
        }
        var bl = $("[data-meter-baseline]"); if (bl) { bl.style.left = pos(o.baseline) + "%"; bl.hidden = (o.baseline == null); }
        var cl = $("[data-meter-line]"); if (cl) cl.style.left = pos(o.countyLimit) + "%";
        set("[data-meter-loanlbl]", "Loan " + fmt(o.loan));
        set("[data-meter-linelbl]", "County line " + fmt(o.countyLimit));
      } else {
        meter.setAttribute("data-empty", "yes");
        set("[data-meter-loanlbl]", "Loan " + fmt(o.loan));
        set("[data-meter-linelbl]", "County line — needs official data");
      }
    }

    // Loan Path Map.
    $$(".pathmap__node").forEach(function (n) { n.removeAttribute("data-current"); });
    if (o.node) { var cur = $('.pathmap__node[data-node="' + o.node + '"]'); if (cur) cur.setAttribute("data-current", "yes"); }

    set('[data-ho="nextlever"]', nextLever(o));
    renderSees(o);

    var note = $("[data-ho-note]");
    if (note) {
      var msg = SAFE + " ";
      if (!o.hasData) msg += "This county isn’t in the configured loan-limit data — import the official full FHFA database to calculate its county line. ";
      else if (o.datasetType === "sample") msg += "County line calculated from configured official data (engine-preview). ";
      note.textContent = msg + COMPLIANCE;
    }
  }

  function nextLever(o) {
    if (!o.hasData) return "Property county confirmed — import the official full FHFA data to calculate its county line.";
    if (o.delta > 0) return "Add about " + fmt(o.addlDown) + " in down payment to bring the estimated loan amount to the selected county reference line.";
    if (o.zone === "high-balance") return "You’re in high-balance review — a larger down payment could move the scenario toward conforming.";
    if (o.occ === "Investment") return "Investment occupancy can introduce rent and DSCR review.";
    return "You’re at or below the county line — review the payment stack and buydown options in the Studio.";
  }

  function renderSees(o) {
    var ul = $("[data-ho-insights]"); if (!ul) return;
    var lines = [];
    lines.push("Property county confirmed: " + S.county + ", " + S.state + (S.isExample ? " (example — change to your property)." : "."));
    if (!o.hasData) {
      lines.push("This county’s line is not in the configured data — import the official full FHFA database to calculate it.");
    } else if (o.delta > 0) {
      lines.push("Estimated loan amount is above the selected county reference line.");
      lines.push("A larger down payment may move the scenario closer to the county line.");
    } else {
      lines.push("Estimated loan amount is at or below the selected county reference line.");
    }
    lines.push("Taxes, insurance, HOA, flood, and mortgage insurance can materially change the monthly picture.");
    lines.push(o.occ === "Investment" ? "Investment occupancy can introduce rent and DSCR review." : "Investment occupancy can introduce rent and DSCR review.");
    lines.push("Buydown math depends on upfront cost, monthly savings, and expected hold period.");
    ul.innerHTML = lines.slice(0, 6).map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }

  function updateContinue() {
    var a = $("[data-ho-continue]"); if (!a) return;
    var q = new URLSearchParams();
    if (S.query) q.set("q", S.query);
    if (S.state) q.set("state", S.state);
    if (S.county) q.set("county", S.county);
    if (S.county_fips) q.set("county_fips", S.county_fips);
    if (S.units) q.set("units", String(S.units));
    q.set("price", String(S.price));
    q.set("downpct", String(S.downPct));
    q.set("occ", occShort(S.occupancy).toLowerCase());
    a.setAttribute("href", "scenario-studio.html?" + q.toString());
  }

  /* ---------- wiring ---------- */
  function syncReadouts() {
    if (E.priceOut && E.price) E.priceOut.textContent = fmt(num(E.price.value));
    if (E.downOut && E.down) E.downOut.textContent = num(E.down.value) + "%";
  }
  function bind() {
    if (E.q) {
      E.q.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doResolve(E.q.value); } });
    }
    $$("[data-ex]").forEach(function (b) { b.addEventListener("click", function () { if (E.q) E.q.value = b.textContent.trim(); doResolve(b.textContent.trim()); }); });
    if (E.confirmManual) E.confirmManual.addEventListener("click", confirmManual);
    if (E.change) E.change.addEventListener("click", function () { show(E.confirmed, false); show(E.scenario, false); show(E.resolve, false); if (E.q) { E.q.value = ""; E.q.focus(); } });
    [E.price, E.down].forEach(function (el) { if (el) el.addEventListener("input", function () { syncReadouts(); compute(); }); });
    [E.units, E.occ].forEach(function (el) { if (el) el.addEventListener("change", compute); });
    $$("[data-lever-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var a = btn.getAttribute("data-lever-action");
        if (a === "down+5" && E.down) E.down.value = Math.min(60, num(E.down.value) + 5);
        if (a === "down-5" && E.down) E.down.value = Math.max(0, num(E.down.value) - 5);
        if (a === "units2" && E.units) E.units.value = "2";
        if (a === "units1" && E.units) E.units.value = "1";
        if (a === "invest" && E.occ) E.occ.value = "Investment property";
        if (a === "primary" && E.occ) E.occ.value = "Primary residence";
        syncReadouts(); compute();
      });
    });
  }

  function init() {
    if (E.price) E.price.value = S.price;
    if (E.down) E.down.value = S.downPct;
    if (E.units) E.units.value = String(S.units);
    if (E.occ) E.occ.value = S.occupancy;
    syncReadouts();
    // Show the default example confirmed so the machine is live immediately.
    show(E.resolve, false); show(E.confirmed, true); show(E.scenario, true);
    if (E.confirmedCounty) E.confirmedCounty.textContent = "Example · " + S.county + ", " + S.state;
    compute();
  }

  bind();
  if (BJL && BJL.isLoaded && BJL.isLoaded()) init();
  else { syncReadouts(); }
  window.addEventListener("bjl:limits-ready", init);
})();
