/* ============================================================
   BeforeJumboLoan.com — Homepage property-intelligence cockpit
   ------------------------------------------------------------
   Two deterministic gates, in order:
     1) WHAT are you structuring?  (purchase / rate-term refi /
        cash-out refi / investment-DSCR / second home / not sure)
     2) WHERE is the property?     (ZIP / city / county → resolve →
        CONFIRM the county). ZIP needs the official ZCTA file first.

   Hard rule: the engine NEVER calculates on a guessed or default
   county. A page-load example is clearly labeled and disappears the
   moment the user engages the property search. No AI. No PII sent.
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

  var VALUE_LABEL = {
    purchase: "Estimated purchase price",
    second_home: "Estimated purchase price",
    rate_term: "Estimated property value",
    cash_out: "Estimated property value",
    investment: "Estimated property value or purchase price",
    unknown: "Estimated property value or purchase price"
  };
  var PURPOSE_INTENT = {
    purchase: "Buy a primary home", second_home: "Buy a second home",
    investment: "Buy an investment property", rate_term: "Refinance",
    cash_out: "Cash-out refinance", unknown: ""
  };

  // State. Starts as a clearly-labeled example (not the user's property).
  var S = {
    scenarioType: "purchase",
    query: "Los Angeles County, CA",
    state: "CA", county: "Los Angeles County", county_fips: "06037",
    confirmed: true, isExample: true,
    units: 1,
    value: 1600000, downPct: 18,
    payoff: 900000, newLoan: 900000, cashOut: 150000, includeCosts: false,
    loanAmt: 1200000, rent: 7500
  };

  var E = {
    q: $("#hs-q"),
    needcty: $("[data-needcty]"),
    resolve: $("[data-resolve]"),
    confident: $("[data-resolve-confident]"), detected: $("[data-detected]"), confirm: $("[data-confirm]"),
    choicesWrap: $("[data-resolve-choices]"), choices: $("[data-choices]"),
    confirmed: $("[data-confirmed]"), confirmedCounty: $("[data-confirmed-county]"), change: $("[data-change]"),
    exampleBanner: $("[data-example-banner]"),
    scenario: $("[data-scenario]"),
    units: $("#hs-units"), value: $("#hs-value"), down: $("#hs-down"),
    payoff: $("#hs-payoff"), newloan: $("#hs-newloan"), cashout: $("#hs-cashout"),
    costs: $("#hs-costs"), loanamt: $("#hs-loanamt"), rent: $("#hs-rent")
  };
  function set(sel, t) { var e = $(sel); if (e) e.textContent = t; }
  function show(el, on) { if (el) el.hidden = !on; }
  function isRefi() { return S.scenarioType === "rate_term" || S.scenarioType === "cash_out"; }
  function occFor(t) { return t === "investment" ? "Investment" : (t === "second_home" ? "Second home" : "Primary"); }

  /* ---------- scenario purpose ---------- */
  function setPurpose(t) {
    S.scenarioType = t;
    $$("[data-purpose-opt]").forEach(function (b) {
      var on = b.getAttribute("data-purpose-opt") === t;
      b.classList.toggle("is-sel", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    set("[data-value-label]", VALUE_LABEL[t] || VALUE_LABEL.unknown);
    $$("[data-show]").forEach(function (w) {
      show(w, w.getAttribute("data-show").split(/\s+/).indexOf(t) > -1);
    });
    syncReadouts();
    if (S.confirmed) compute();
  }

  /* ---------- resolve (WHERE) ---------- */
  function clearExample() {
    if (!S.isExample) return;
    S.isExample = false; S.confirmed = false;
    show(E.scenario, false); show(E.confirmed, false); show(E.exampleBanner, false);
    set('[data-ho="nextlever"]', "Confirm a property county to scan the structure.");
  }

  function populateStates(sel) {
    if (!sel || !BJL) return;
    var states = BJL.getStates ? BJL.getStates() : [];
    if (states.length && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">State…</option>' +
        states.map(function (s) { return '<option value="' + s.abbr + '">' + s.name + "</option>"; }).join("");
    }
  }

  function doResolve(query) {
    clearExample();
    S.query = query;
    var r = BJL && BJL.resolvePropertyLocation
      ? BJL.resolvePropertyLocation(query)
      : { confidence: "none", possible_matches: [], warning: "Resolver not loaded." };

    show(E.confirmed, false); show(E.scenario, false);
    show(E.resolve, false); show(E.confident, false); show(E.choicesWrap, false);
    show(E.needcty, false);

    if (r.confidence === "high" && r.possible_matches.length === 1) {
      var m = r.possible_matches[0];
      E.detected.textContent = "Detected: " + m.county_name + ", " + m.state_abbr +
        (m.matched_by ? "  ·  matched by " + m.matched_by : "");
      E.confirm.onclick = function () { confirmCounty(m); };
      show(E.resolve, true); show(E.confident, true);
    } else if (r.confidence === "ambiguous") {
      E.choices.innerHTML = "";
      r.possible_matches.forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "choice"; b.textContent = m.label;
        b.onclick = function () { confirmCounty(m); };
        E.choices.appendChild(b);
      });
      show(E.resolve, true); show(E.choicesWrap, true);
    } else {
      // UNRESOLVED (incl. ZIP before the official ZCTA file): never calculate
      // on a default county — ask for state + property county.
      var msg = $("[data-needcty] .needcty__msg");
      if (msg) {
        msg.textContent = (r.matched_by === "zip" && r.warning)
          ? r.warning                                   // ZIP needs official ZCTA file
          : "I need the property county to calculate the county line.";
      }
      populateStates($("#hs-mstate"));
      show(E.needcty, true);
    }
  }

  function confirmCounty(m) {
    S.state = m.state_abbr; S.county = m.county_name; S.county_fips = m.county_fips || null;
    S.confirmed = true; S.isExample = false;
    show(E.resolve, false); show(E.needcty, false); show(E.exampleBanner, false);
    show(E.confirmed, true);
    if (E.confirmedCounty) E.confirmedCounty.textContent = S.county + ", " + S.state;
    show(E.scenario, true);
    compute();
  }

  function confirmManual() {
    var st = ($("#hs-mstate") && $("#hs-mstate").value) || ($("#hs-mstate2") && $("#hs-mstate2").value) || "";
    var cty = ($("#hs-mcounty") && $("#hs-mcounty").value.trim()) || ($("#hs-mcounty2") && $("#hs-mcounty2").value.trim()) || "";
    if (!st || !cty) {
      var msg = $("[data-needcty] .needcty__msg");
      if (msg) msg.textContent = "Enter both the state and the property county.";
      return;
    }
    confirmCounty({ state_abbr: st, county_name: /county$|parish$|borough$/i.test(cty) ? cty : cty + " County", county_fips: null });
  }

  /* ---------- compute (deterministic, scenario-aware) ---------- */
  function read() {
    if (E.units) S.units = parseInt(E.units.value, 10) || 1;
    if (E.value) S.value = num(E.value.value);
    if (E.down) S.downPct = num(E.down.value);
    if (E.payoff) S.payoff = num(E.payoff.value);
    if (E.newloan) S.newLoan = num(E.newloan.value);
    if (E.cashout) S.cashOut = num(E.cashout.value);
    if (E.costs) S.includeCosts = !!E.costs.checked;
    if (E.loanamt) S.loanAmt = num(E.loanamt.value);
    if (E.rent) S.rent = num(E.rent.value);
  }

  function loanAndLtv() {
    var t = S.scenarioType, value = S.value, loan = 0, down = 0;
    if (t === "purchase" || t === "second_home") {
      down = Math.min(value, Math.round(value * S.downPct / 100)); loan = Math.max(0, value - down);
    } else if (t === "rate_term") {
      loan = S.newLoan;
    } else if (t === "cash_out") {
      var base = S.payoff + S.cashOut; loan = S.includeCosts ? Math.round(base * 1.02) : base;
    } else { // investment | unknown
      loan = S.loanAmt;
    }
    var ltv = value > 0 ? loan / value : null;
    return { loan: loan, down: down, ltv: ltv };
  }

  function compute() {
    if (!S.confirmed) return;
    read();
    var ll = loanAndLtv();
    var loan = ll.loan, ltv = ll.ltv;

    var loc = KW.applyLocation ? KW.applyLocation(S.state, S.county, "", S.units) : null;
    if (BJL && BJL.resolveLoanLimits && S.county_fips) {
      var r2 = BJL.resolveLoanLimits({ county_fips: S.county_fips, state: S.state, county: S.county, units: S.units });
      if (r2 && r2.found) loc = r2;
    }
    var hasData = loc && loc.found && loc.countyConformingLimit != null && !loc.needsVerification;
    var countyLimit = hasData ? loc.countyConformingLimit : null;
    var baseline = loc && loc.conformingBaseline;
    var delta = hasData ? (loan - countyLimit) : null;
    var addlDown = (delta != null && delta > 0) ? delta : 0;

    var occ = occFor(S.scenarioType);
    var zone = "conforming";
    if (hasData && loan > countyLimit) zone = "jumbo";
    else if (hasData && baseline != null && loan > baseline) zone = "high-balance";
    var node = !hasData ? null : (occ === "Investment" ? "dscr" : zone);

    var ra = KW.rateFor ? KW.rateFor({ loan: loan, main_concern: "" }) : { rate: 6.84, label: "30-yr assumption" };
    var pi = KW.monthlyPI ? KW.monthlyPI(loan, ra.rate, 30) : 0;
    var dscr = (S.scenarioType === "investment" && S.rent > 0 && pi > 0) ? (S.rent / pi) : null;

    render({
      loan: loan, ltv: ltv, baseline: baseline, countyLimit: countyLimit, hasData: hasData,
      delta: delta, addlDown: addlDown, zone: zone, node: node, occ: occ, pi: pi, rate: ra,
      dscr: dscr, datasetType: loc && loc.datasetType, tier: loc && loc.tier
    });
    updateContinue(loan, ltv);
  }

  function render(o) {
    // HERO — dominant county-line result.
    var heroV = $("[data-hero]"), heroK = $("[data-hero-k]"), heroSub = $("[data-hero-sub]");
    if (heroK) heroK.textContent = "Vs. " + S.county + ", " + S.state + " county line";
    if (!o.hasData) {
      if (heroV) { heroV.textContent = "Needs official county data"; heroV.setAttribute("data-tone", "warn"); }
      if (heroSub) heroSub.textContent = "This county isn’t in the configured loan-limit data — import the official full FHFA database to calculate its county line.";
    } else if (o.delta > 0) {
      if (heroV) { heroV.textContent = fmt(o.delta) + " above the selected county line"; heroV.setAttribute("data-tone", "over"); }
      if (heroSub) heroSub.textContent = "Estimated loan " + fmt(o.loan) + " vs county line " + fmt(o.countyLimit) + ".";
    } else if (o.delta < 0) {
      if (heroV) { heroV.textContent = fmt(-o.delta) + " below the selected county line"; heroV.setAttribute("data-tone", "under"); }
      if (heroSub) heroSub.textContent = "Estimated loan " + fmt(o.loan) + " vs county line " + fmt(o.countyLimit) + ".";
    } else {
      if (heroV) { heroV.textContent = "Right at the selected county line"; heroV.setAttribute("data-tone", "under"); }
      if (heroSub) heroSub.textContent = "Estimated loan " + fmt(o.loan) + " equals the county line.";
    }

    set('[data-ho="loan"]', fmt(o.loan));

    var ltvRow = $("[data-ho-ltv-row]");
    if (ltvRow) {
      var showLtv = o.ltv != null && isFinite(o.ltv);
      ltvRow.hidden = !showLtv;
      if (showLtv) {
        var pct = Math.round(o.ltv * 1000) / 10;
        var lEl = $('[data-ho="ltv"]');
        if (lEl) { lEl.textContent = pct + "%"; lEl.setAttribute("data-high", o.ltv > 0.8 ? "yes" : "no"); }
      }
    }

    var limEl = $('[data-ho="limit"]');
    if (limEl) {
      limEl.textContent = o.hasData ? (fmt(o.countyLimit) + (o.tier === "high-cost" ? " · high-cost" : " · baseline")) : "Needs official county data";
      limEl.setAttribute("data-verify", o.hasData ? "no" : "yes");
    }

    var dscrRow = $("[data-ho-dscr-row]");
    if (dscrRow) {
      dscrRow.hidden = !(S.scenarioType === "investment");
      if (S.scenarioType === "investment") {
        set('[data-ho="dscr"]', o.dscr != null ? (o.dscr.toFixed(2) + "× rent ÷ P&I (preview)") : "Add monthly rent");
      }
    }

    set('[data-ho="pi"]', fmt(o.pi) + "/mo");
    set('[data-ho="rate"]', "Estimated P&I preview · " + o.rate.rate + "% " + (o.rate.label || "assumption") + " · taxes, insurance, HOA, flood & MI added in the Studio");

    // County Line Meter.
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
    if (!o.hasData) return "Confirm a property in an imported county, or import the official full FHFA data to calculate this county’s line.";
    var ltvNote = (o.ltv != null && o.ltv > 0.8) ? " LTV is about " + Math.round(o.ltv * 100) + "% — pricing and mortgage insurance can move with LTV." : "";
    switch (S.scenarioType) {
      case "purchase": case "second_home":
        return (o.delta > 0)
          ? "Add about " + fmt(o.addlDown) + " in down payment to bring the loan to the selected county line." + ltvNote
          : "At or below the county line — compare buydown and payment options in the Studio." + ltvNote;
      case "rate_term":
        return (o.delta > 0)
          ? "A new loan about " + fmt(o.delta) + " lower sits at the county line; otherwise this is high-balance/jumbo review." + ltvNote
          : "At or below the county line — review rate-and-term options in the Studio." + ltvNote;
      case "cash_out":
        return (o.delta > 0)
          ? "Reducing the cash-out by about " + fmt(o.delta) + " brings the new loan to the county line." + ltvNote
          : "At or below the county line — cash-out pricing still depends on LTV and occupancy." + ltvNote;
      case "investment":
        return (o.dscr != null)
          ? "DSCR preview is about " + o.dscr.toFixed(2) + "× (rent ÷ P&I). DSCR programs weigh rent against full housing cost, not P&I alone."
          : "Add an estimated monthly rent to preview DSCR coverage.";
      default:
        return "Pick a structure above (purchase, refinance, cash-out, investment) to sharpen the analysis.";
    }
  }

  function renderSees(o) {
    var ul = $("[data-ho-insights]"); if (!ul) return;
    var lines = [];
    lines.push("Structuring: " + label(S.scenarioType) + ".");
    lines.push("Property county confirmed: " + S.county + ", " + S.state + ".");
    if (!o.hasData) {
      lines.push("This county’s line is not in the configured data — import the official full FHFA database to calculate it.");
    } else if (o.delta > 0) {
      lines.push("Estimated loan amount is above the selected county reference line.");
    } else {
      lines.push("Estimated loan amount is at or below the selected county reference line.");
    }
    if (o.ltv != null && isFinite(o.ltv)) lines.push("Estimated LTV is about " + Math.round(o.ltv * 100) + "% (loan ÷ value).");
    if (S.scenarioType === "investment") lines.push("Investment occupancy can introduce rent and DSCR review.");
    lines.push("Taxes, insurance, HOA, flood, and mortgage insurance can materially change the monthly picture.");
    ul.innerHTML = lines.slice(0, 6).map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }
  function label(t) {
    return ({ purchase: "Purchase", rate_term: "Rate-and-term refinance", cash_out: "Cash-out refinance",
      investment: "Investment / DSCR", second_home: "Second home", unknown: "Not yet specified" })[t] || t;
  }

  function updateContinue(loan, ltv) {
    var a = $("[data-ho-continue]"); if (!a) return;
    var q = new URLSearchParams();
    q.set("scenario_type", S.scenarioType);
    if (S.query) q.set("q", S.query);
    if (S.state) q.set("state", S.state);
    if (S.county) q.set("county", S.county);
    if (S.county_fips) q.set("county_fips", S.county_fips);
    if (S.units) q.set("units", String(S.units));
    q.set("occ", occFor(S.scenarioType).toLowerCase());
    q.set("estimated_property_value", String(S.value));
    if (S.scenarioType === "purchase" || S.scenarioType === "second_home") {
      q.set("purchase_price", String(S.value));
      q.set("downpct", String(S.downPct));
    }
    if (isRefi()) q.set("current_payoff", String(S.payoff));
    if (S.scenarioType === "cash_out") q.set("cash_out_requested", String(S.cashOut));
    q.set("estimated_loan_amount", String(loan));
    if (ltv != null && isFinite(ltv)) q.set("ltv", String(Math.round(ltv * 1000) / 1000));
    q.set("price", String(S.value)); // back-compat with the studio prefill
    a.setAttribute("href", "scenario-studio.html?" + q.toString());
  }

  /* ---------- wiring ---------- */
  function syncReadouts() {
    set("#hs-value-out", fmt(E.value ? num(E.value.value) : S.value));
    set("#hs-down-out", (E.down ? num(E.down.value) : S.downPct) + "%");
    set("#hs-payoff-out", fmt(E.payoff ? num(E.payoff.value) : S.payoff));
    set("#hs-newloan-out", fmt(E.newloan ? num(E.newloan.value) : S.newLoan));
    set("#hs-cashout-out", fmt(E.cashout ? num(E.cashout.value) : S.cashOut));
    set("#hs-loanamt-out", fmt(E.loanamt ? num(E.loanamt.value) : S.loanAmt));
  }

  function bind() {
    $$("[data-purpose-opt]").forEach(function (b) {
      b.addEventListener("click", function () { setPurpose(b.getAttribute("data-purpose-opt")); });
    });
    if (E.q) {
      E.q.addEventListener("focus", clearExample);
      E.q.addEventListener("input", function () { if (S.isExample) clearExample(); });
      E.q.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doResolve(E.q.value); } });
    }
    $$("[data-ex]").forEach(function (b) {
      b.addEventListener("click", function () { if (E.q) E.q.value = b.textContent.trim(); doResolve(b.textContent.trim()); });
    });
    var mb1 = $("[data-confirm-manual]"); if (mb1) mb1.addEventListener("click", confirmManual);
    var mb2 = $("[data-confirm-manual2]"); if (mb2) mb2.addEventListener("click", confirmManual);
    if (E.change) E.change.addEventListener("click", function () {
      S.confirmed = false; S.isExample = false;
      show(E.confirmed, false); show(E.scenario, false); show(E.resolve, false); show(E.needcty, false);
      if (E.q) { E.q.value = ""; E.q.focus(); }
    });
    [E.value, E.down, E.payoff, E.newloan, E.cashout, E.loanamt, E.rent].forEach(function (el) {
      if (el) el.addEventListener("input", function () { syncReadouts(); compute(); });
    });
    [E.units, E.costs].forEach(function (el) { if (el) el.addEventListener("change", compute); });
    $$("[data-lever-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var a = btn.getAttribute("data-lever-action");
        if (a === "down+5" && E.down) E.down.value = Math.min(60, num(E.down.value) + 5);
        if (a === "down-5" && E.down) E.down.value = Math.max(0, num(E.down.value) - 5);
        if (a === "units2" && E.units) E.units.value = "2";
        if (a === "units1" && E.units) E.units.value = "1";
        if (a === "invest") setPurpose("investment");
        if (a === "primary") setPurpose("purchase");
        syncReadouts(); compute();
      });
    });
  }

  function init() {
    // Seed inputs.
    if (E.value) E.value.value = S.value;
    if (E.down) E.down.value = S.downPct;
    if (E.payoff) E.payoff.value = S.payoff;
    if (E.newloan) E.newloan.value = S.newLoan;
    if (E.cashout) E.cashout.value = S.cashOut;
    if (E.loanamt) E.loanamt.value = S.loanAmt;
    if (E.rent) E.rent.value = S.rent;
    if (E.units) E.units.value = String(S.units);
    setPurpose(S.scenarioType);

    // Page-load EXAMPLE — clearly labeled, not the user's property.
    S.isExample = true; S.confirmed = true;
    show(E.resolve, false); show(E.needcty, false);
    show(E.confirmed, true); show(E.scenario, true); show(E.exampleBanner, true);
    if (E.confirmedCounty) E.confirmedCounty.textContent = "Example · " + S.county + ", " + S.state;
    compute();
  }

  bind();
  if (BJL && BJL.isLoaded && BJL.isLoaded()) init();
  else { syncReadouts(); }
  window.addEventListener("bjl:limits-ready", init);
})();
