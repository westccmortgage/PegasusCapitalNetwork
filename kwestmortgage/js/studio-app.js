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
    query: "Monroe County, FL",
    state: "FL", county: "Monroe County", county_fips: "12087",
    confirmed: true, isExample: true,
    units: 1,
    value: 1150000, downPct: 20,
    payoff: 900000, newLoan: 900000, cashOut: 150000, includeCosts: false,
    loanAmt: 1200000, rent: 7500,
    paymentMode: "pi", creditScore: 760, docType: "w2", annualIncome: 180000, buydownPoints: 1
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
    costs: $("#hs-costs"), loanamt: $("#hs-loanamt"), rent: $("#hs-rent"),
    score: $("#hs-score"), doc: $("#hs-doc"), income: $("#hs-income")
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
    set("[data-occ-out]", t === "investment" ? "Investment property" : (t === "second_home" ? "Second home" : "Primary residence"));
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
    updateContinue(); // flip CTA to needs_property_location (no default county)
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
    // A new search invalidates any prior confirmation until it re-resolves.
    S.confirmed = false;
    S.query = query;
    var r = BJL && BJL.resolvePropertyLocation
      ? BJL.resolvePropertyLocation(query)
      : { confidence: "none", possible_matches: [], warning: "Resolver not loaded." };

    show(E.confirmed, false); show(E.scenario, false);
    show(E.resolve, false); show(E.confident, false); show(E.choicesWrap, false);
    show(E.needcty, false);

    S.locStatus = r.status || (r.confidence === "high" ? "resolved" : (r.confidence === "ambiguous" ? "ambiguous" : "unresolved"));
    S.possibleMatches = r.possible_matches || [];

    if (r.status === "resolved" && r.possible_matches.length === 1) {
      var m = r.possible_matches[0];
      if (r.needs_confirmation === false) {
        // Clear single-county ZIP (Phase 2.1): auto-detect AND calculate.
        confirmCounty(m, true);
      } else {
        // City / county / alias: quick confirm step.
        E.detected.textContent = "Detected: " + m.county_name + ", " + m.state_abbr +
          (m.matched_by ? "  ·  matched by " + m.matched_by : "");
        E.confirm.onclick = function () { confirmCounty(m); };
        show(E.resolve, true); show(E.confident, true);
      }
    } else if (r.status === "ambiguous") {
      var k = $("[data-resolve-choices] .resolve__k");
      if (k) k.textContent = (r.matched_by === "zip")
        ? "This ZIP may be in more than one county. Which county is the property in?"
        : "More than one match — which property county?";
      E.choices.innerHTML = "";
      r.possible_matches.forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "choice"; b.textContent = m.label;
        b.onclick = function () { confirmCounty(m); };
        E.choices.appendChild(b);
      });
      show(E.resolve, true); show(E.choicesWrap, true);
      updateContinue(); // CTA carries needs_property_location + possible_matches
    } else {
      // UNRESOLVED (incl. ZIP before the official ZIP/county file): never
      // calculate on a default county — ask for state + property county.
      var msg = $("[data-needcty] .needcty__msg");
      if (msg) {
        msg.textContent = (r.matched_by === "zip" && r.warning)
          ? r.warning                                   // ZIP not matched / needs official file
          : "Property county required to calculate the county line.";
      }
      populateStates($("#hs-mstate"));
      show(E.needcty, true);
      updateContinue(); // CTA carries needs_property_location=true
    }
  }

  function confirmCounty(m, autoDetected) {
    S.state = m.state_abbr; S.county = m.county_name; S.county_fips = m.county_fips || null;
    S.confirmed = true; S.isExample = false;
    S.locStatus = "resolved"; S.matchedBy = m.matched_by || null;
    show(E.resolve, false); show(E.needcty, false); show(E.exampleBanner, false);
    show(E.confirmed, true);
    if (E.confirmedCounty) {
      E.confirmedCounty.textContent = (autoDetected ? "Detected: " : "") + S.county + ", " + S.state +
        (autoDetected && S.matchedBy ? " · matched by " + S.matchedBy : "");
    }
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

  /* ---------- lead-form bridge: publish a readable scenario snapshot ----------
     Fills any [data-studio-snapshot] field in the Key West lead form and
     exposes window.KW_STUDIO so the broker receives the structured scenario
     with the contact submission. Deterministic; no PII leaves the page. */
  function publishSnapshot(o) {
    var pathLabels = { conforming: "Conforming Review", "high-balance": "High-Balance Conforming Review",
      jumbo: "Jumbo Review", "interest-only-jumbo": "Interest-Only Jumbo Review", dscr: "DSCR / Investor Review",
      "second-home": "Second Home Review", "bank-statement": "Bank Statement Review", fha: "FHA Review", va: "VA Review" };
    var L = [];
    L.push("Key West Strategy Studio — scenario snapshot (educational, not a quote)");
    L.push("Property: " + (S.county || "—") + ", " + (S.state || "—") + (S.isExample ? " (example)" : ""));
    L.push("Goal: " + (S.scenarioType || "—"));
    L.push("Estimated loan amount: " + fmt(o.loan));
    if (o.countyLimit != null) L.push("County conforming/high-balance line: " + fmt(o.countyLimit));
    if (o.node) L.push("Current review path: " + (pathLabels[o.node] || "Licensed Review"));
    if (o.ra) L.push("Assumed rate (score + income type): " + o.ra.rate + "% (" + (o.ra.label || "assumption") + ")");
    if (o.qual && o.qual.maxLoan > 0) L.push("Income-based supportable loan: " + fmt(o.qual.maxLoan) + " at " + Math.round(o.qual.dti * 100) + "% DTI");
    if (o.mi > 0) L.push("Estimated PMI: " + fmt(o.mi) + "/mo");
    if (o.dscr != null) L.push("DSCR preview: " + o.dscr.toFixed(2) + "x");
    L.push("Credit score (assumption): " + (S.creditScore || "—") + " · income type: " + (S.docType || "—"));
    L.push("Educational only — not approval, qualification, rate quote, APR, or commitment to lend.");
    var text = L.join("\n");
    try { window.KW_STUDIO = { snapshot: text, county: S.county, state: S.state, scenarioType: S.scenarioType, loan: o.loan, path: o.node }; } catch (e) {}
    $$("[data-studio-snapshot]").forEach(function (el) { if ("value" in el) el.value = text; });
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
    if (E.score) S.creditScore = parseInt(E.score.value, 10) || 760;
    if (E.doc) S.docType = E.doc.value;
    if (E.income) S.annualIncome = num(E.income.value);
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
    var io = S.paymentMode === "io";
    var occLabel = occ === "Investment" ? "Investment property" : (occ === "Second home" ? "Second home" : "Primary");
    var nonqm = (S.docType === "bank_statement" || S.docType === "ten99");
    var sc = { loan: loan, scenario_type: S.scenarioType, occupancy: occLabel, payment_mode: io ? "interest-only" : "pi",
      creditScore: S.creditScore, docType: S.docType };

    // Mortgage insurance (PMI) when LTV > 80% (less than 20% down).
    var ltvPct = (ltv != null && isFinite(ltv)) ? ltv * 100 : null;
    var mi = (ltvPct != null && KW.monthlyMI) ? KW.monthlyMI(loan, ltvPct, S.creditScore) : 0;

    // Current review path (one of the Potential Review Paths the engine compares).
    var zone = "conforming";
    if (hasData && loan > countyLimit) zone = "jumbo";
    else if (hasData && baseline != null && loan > baseline) zone = "high-balance";
    var node = null;
    if (hasData) {
      if (S.scenarioType === "investment") node = "dscr";
      else if (nonqm) node = "bank-statement";
      else if (io && loan > countyLimit) node = "interest-only-jumbo";
      else if (loan > countyLimit) node = "jumbo";
      else if (S.scenarioType === "second_home") node = "second-home";
      else if (baseline != null && loan > baseline) node = "high-balance";
      else node = "conforming";
    }
    var pathLabels = { conforming: "Conforming Review", "high-balance": "High-Balance Conforming Review",
      jumbo: "Jumbo Review", "interest-only-jumbo": "Interest-Only Jumbo Review", dscr: "DSCR / Investor Review",
      "second-home": "Second Home Review", "bank-statement": "Bank Statement Review", fha: "FHA Review", va: "VA Review" };

    var ra = KW.rateFor ? KW.rateFor(sc) : { rate: 6.84, baseRate: 6.84, scoreAdj: 0, docAdj: 0, scoreTier: null, docLabel: null, label: "assumption", key: "jumbo" };
    var pp = KW.paymentPreview ? KW.paymentPreview(sc)
      : { pi: KW.monthlyPI ? KW.monthlyPI(loan, 6.84, 30) : 0, interestOnly: 0, difference: 0, rate: 6.84, rateLabel: "30-yr assumption", rateKey: "jumbo" };
    var dscrBasis = io ? pp.interestOnly : pp.pi;
    var dscr = (S.scenarioType === "investment" && S.rent > 0 && dscrBasis > 0) ? (S.rent / dscrBasis) : null;

    // Income-based qualifying loan (uses the assumed rate, so score + Non-QM flow in).
    var qual = KW.qualifyingLoan ? KW.qualifyingLoan({ annualIncome: S.annualIncome, ratePct: ra.rate, termYears: 30 }) : null;

    // Income-tax estimate (very rough, educational) for the confirmed state.
    var tax = KW.estimateIncomeTax ? KW.estimateIncomeTax({ annualIncome: S.annualIncome, state: S.state }) : null;

    // Buydown illustrations — borrower chooses the points to pay.
    var scBd = Object.assign({ bdPoints: S.buydownPoints }, sc);
    var pb = KW.permanentBuydown ? KW.permanentBuydown(scBd) : null;
    var tb = KW.temporaryBuydown ? KW.temporaryBuydown(Object.assign({ bdTempType: "2-1" }, sc)) : null;
    var tb10 = KW.temporaryBuydown ? KW.temporaryBuydown(Object.assign({ bdTempType: "1-0" }, sc)) : null;

    render({
      loan: loan, ltv: ltv, ltvPct: ltvPct, baseline: baseline, countyLimit: countyLimit, hasData: hasData,
      delta: delta, addlDown: addlDown, zone: zone, node: node, occ: occ,
      pathLabel: node ? (pathLabels[node] || "Licensed Review") : "Confirm a property county",
      pi: pp.pi, io: pp.interestOnly, iodiff: pp.difference, paymentMode: S.paymentMode,
      rate: { rate: pp.rate, label: pp.rateLabel, key: pp.rateKey },
      ra: ra, mi: mi, nonqm: nonqm, qual: qual, tax: tax,
      dscr: dscr, datasetType: loc && loc.datasetType, tier: loc && loc.tier,
      pb: pb, tb: tb, tb10: tb10
    });
    try { publishSnapshot({ loan: loan, sc: sc, ra: ra, qual: qual, mi: mi, dscr: dscr, countyLimit: countyLimit, baseline: baseline, node: node }); } catch (e) {}
    updateContinue();
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

    // LTV — always shown (it drives the 20%-down / PMI threshold).
    var ltvRow = $("[data-ho-ltv-row]");
    if (ltvRow) {
      var showLtv = o.ltv != null && isFinite(o.ltv);
      ltvRow.hidden = !showLtv;
      if (showLtv) {
        var pct = Math.round(o.ltv * 1000) / 10;
        var lEl = $('[data-ho="ltv"]');
        if (lEl) {
          lEl.textContent = pct + "%" + (o.ltv > 0.8 ? " · under 20% down (PMI applies)" : " · 20%+ down (no PMI)");
          lEl.setAttribute("data-high", o.ltv > 0.8 ? "yes" : "no");
        }
      }
    }

    // Mortgage insurance (PMI) row — only when LTV > 80%.
    var miRow = $("[data-ho-mi-row]");
    if (miRow) {
      var showMi = o.mi > 0;
      miRow.hidden = !showMi;
      if (showMi) set('[data-ho="mi"]', fmt(o.mi) + "/mo (until you reach 20% equity)");
    }

    // Score tier + income-type notes (educational drivers).
    if (o.ra) {
      set("[data-ho-scoretier]", (o.ra.scoreTier || "") + (o.ra.scoreAdj > 0 ? " · +" + o.ra.scoreAdj.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "% to your rate" : " · no rate add-on"));
      set("[data-ho-docnote]", o.nonqm
        ? ((o.ra.docLabel || "Non-QM") + " — Non-QM, rate is higher (+" + (o.ra.docAdj || 0) + "%)")
        : ((o.ra.docLabel || "W-2") + " — full documentation, baseline pricing"));
      set('[data-ho="raterow"]', o.ra.rate + "% assumption");
    }

    // Income-based qualifying loan + comparison to the estimated loan.
    if (o.qual) {
      var qEl = $('[data-ho="qual"]');
      if (qEl) {
        qEl.textContent = o.qual.maxLoan > 0 ? (fmt(o.qual.maxLoan) + " · at " + Math.round(o.qual.dti * 100) + "% DTI") : "Add an annual income";
        qEl.setAttribute("data-short", (o.qual.maxLoan > 0 && o.loan > o.qual.maxLoan) ? "yes" : "no");
      }
      var qn = "";
      if (o.qual.maxLoan > 0) {
        qn = (o.loan > o.qual.maxLoan)
          ? "Estimated loan " + fmt(o.loan) + " is above the income-based estimate — a higher income, lower loan, or more reserves may be needed (licensed review required)."
          : "Estimated loan " + fmt(o.loan) + " is within the income-based estimate. Educational only — not a pre-qualification or approval.";
      } else {
        qn = "Enter an approximate annual income to estimate the loan it could support.";
      }
      set("[data-ho-qualnote]", qn);
    }

    // Income-tax estimate (very rough, educational) — shows the state difference.
    if (o.tax) {
      set('[data-ho="tax"]', o.tax.total > 0
        ? (fmt(o.tax.total) + "/yr · ~" + o.tax.effectiveRate + "% effective")
        : "—");
      var noStateTax = (o.tax.stateRate === 0);
      set("[data-ho-taxnote]", o.tax.total > 0
        ? ("Approx. income taxes: " + fmt(o.tax.federal) + " federal + " + fmt(o.tax.state) + " state ("
           + S.state + " ~" + o.tax.stateRate + "%" + (noStateTax ? ", no state income tax" : "") + "). Very rough — single filer, standard deduction. Not tax advice.")
        : "Enter an annual income to estimate approximate income taxes.");
      var rf = "Rate factors: " + o.ra.baseRate + "% base"
        + (o.ra.scoreAdj > 0 ? " + " + o.ra.scoreAdj + "% (score " + S.creditScore + ")" : " + 0% (score " + S.creditScore + ", 740+)")
        + (o.ra.docAdj > 0 ? " + " + o.ra.docAdj + "% (" + (o.nonqm ? "Non-QM income" : "income") + ")" : "")
        + " = " + o.ra.rate + "% assumption";
      set('[data-ho="ratefactors"]', rf);
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

    set('[data-ho="path"]', o.pathLabel || "—");
    set('[data-ho="pi"]', fmt(o.pi) + "/mo" + (o.paymentMode === "pi" ? " · selected" : ""));
    set('[data-ho="io"]', fmt(o.io) + "/mo" + (o.paymentMode === "io" ? " · selected" : ""));
    set('[data-ho="iodiff"]', "Interest-only is " + fmt(o.iodiff) + "/mo lower than amortizing");
    set('[data-ho="rate"]', "Estimated " + (o.paymentMode === "io" ? "interest-only" : "P&I") + " preview · " + o.rate.rate + "% " + (o.rate.label || "assumption") + " · taxes, insurance, HOA, flood & MI added in the Studio");
    var ioNote = $("[data-ho-ionote]");
    if (ioNote) ioNote.textContent = (KW.IO_NOTE || "Interest-only options vary by lender, loan purpose, occupancy, property type, borrower profile, and market. This is an educational payment illustration only.");

    // Buydown strategy (integrated into the console).
    if (o.pb) {
      set("[data-ho-bd-pi]", fmt(o.pb.piCur) + " → " + fmt(o.pb.piBd) + " (" + o.pb.curRate + "% → " + o.pb.bdRate + "%)");
      set("[data-ho-bd-savings]", fmt(o.pb.monthlySavings) + "/mo");
      set("[data-ho-bd-cost]", fmt(o.pb.cost) + " (" + o.pb.points + " pts)");
      set("[data-ho-bd-be]", o.pb.breakEvenMonths != null ? (Math.round(o.pb.breakEvenMonths) + " months (~" + o.pb.breakEvenYears.toFixed(1) + " yrs)") : "—");
    }
    if (o.tb) {
      set("[data-ho-tb]", fmt(o.tb.piY1) + " / " + fmt(o.tb.piY2) + " / " + fmt(o.tb.piNote));
      set("[data-ho-tb-sub]", fmt(o.tb.subsidy));
    }
    if (o.tb10) set("[data-ho-tb10]", fmt(o.tb10.piY1) + " / " + fmt(o.tb10.piNote));
    set("[data-ho-bdnote]", KW.BUYDOWN_NOTE || "Buydown options may not be available for every borrower, loan purpose, occupancy, property, lender, or market. This is an educational illustration only.");

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
    // Scenario-type aware (Phase 7).
    if (S.scenarioType === "purchase" || S.scenarioType === "second_home") {
      lines.push("This scenario is being structured as a " + (S.scenarioType === "second_home" ? "second-home purchase" : "purchase") + ".");
      lines.push("Down payment changes the estimated loan amount.");
    } else if (S.scenarioType === "rate_term") {
      lines.push("This scenario is being structured as a refinance.");
      lines.push("LTV and current payoff drive the new loan amount.");
    } else if (S.scenarioType === "cash_out") {
      lines.push("This scenario is being structured as a cash-out refinance.");
      lines.push("Cash-out amount increases the estimated new loan amount and LTV.");
    } else if (S.scenarioType === "investment") {
      lines.push("This scenario is being structured as an investment / DSCR loan.");
      lines.push("Investment occupancy can introduce rent and DSCR review.");
    } else {
      lines.push("Scenario type not set yet — pick a structure to sharpen the analysis.");
    }
    lines.push("Property county confirmed: " + S.county + ", " + S.state + ".");
    if (!o.hasData) {
      lines.push("This county’s line is not in the configured data — import the official full FHFA database to calculate it.");
    } else if (o.delta > 0) {
      lines.push("Estimated loan amount is above the selected county reference line.");
    } else {
      lines.push("Estimated loan amount is at or below the selected county reference line.");
    }
    if (o.ltv != null && isFinite(o.ltv)) lines.push("Estimated LTV is about " + Math.round(o.ltv * 100) + "% (loan ÷ value).");
    if (S.paymentMode === "io") lines.push("Interest-only lowers the initial payment illustration but does not reduce principal during the interest-only period.");
    lines.push("Taxes, insurance, HOA, flood, and mortgage insurance can materially change the monthly picture.");
    lines.push("Buydown math depends on upfront cost, monthly savings, and expected hold period.");
    ul.innerHTML = lines.slice(0, 6).map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }
  function label(t) {
    return ({ purchase: "Purchase", rate_term: "Rate-and-term refinance", cash_out: "Cash-out refinance",
      investment: "Investment / DSCR", second_home: "Second home", unknown: "Not yet specified" })[t] || t;
  }

  function updateContinue() {
    var a = $("[data-ho-continue]"); if (!a) return;
    read();
    var ll = loanAndLtv();
    var confirmedReal = S.confirmed && !S.isExample;
    var status = confirmedReal ? "resolved" : (S.isExample ? "example" : (S.locStatus === "ambiguous" ? "ambiguous" : "unresolved"));

    var q = new URLSearchParams();
    q.set("scenario_type", S.scenarioType);
    q.set("property_location_status", status);
    if (S.query && !S.isExample) q.set("property_query", S.query);
    q.set("units", String(S.units));
    q.set("occ", occFor(S.scenarioType).toLowerCase());
    q.set("estimated_property_value", String(S.value));
    if (S.scenarioType === "purchase" || S.scenarioType === "second_home") {
      q.set("purchase_price", String(S.value));
      q.set("downpct", String(S.downPct));
    }
    if (isRefi()) q.set("current_payoff", String(S.payoff));
    if (S.scenarioType === "cash_out") q.set("cash_out_requested", String(S.cashOut));
    q.set("estimated_loan_amount", String(ll.loan));
    if (ll.ltv != null && isFinite(ll.ltv)) q.set("ltv", String(Math.round(ll.ltv * 1000) / 1000));
    q.set("price", String(S.value)); // back-compat with the studio prefill
    // Payment mode + rate assumption + payment previews (Phase 4).
    var occ2 = occFor(S.scenarioType);
    var pp = KW.paymentPreview ? KW.paymentPreview({ loan: ll.loan, scenario_type: S.scenarioType, occupancy: occ2 === "Investment" ? "Investment property" : (occ2 === "Second home" ? "Second home" : "Primary"), payment_mode: S.paymentMode === "io" ? "interest-only" : "pi", creditScore: S.creditScore, docType: S.docType }) : null;
    q.set("payment_mode", S.paymentMode === "io" ? "interest_only" : "pi");
    q.set("credit_score", String(S.creditScore));
    q.set("income_doc_type", S.docType);
    if (S.annualIncome > 0) {
      q.set("annual_income", String(S.annualIncome));
      if (KW.qualifyingLoan && pp) q.set("qualifying_loan_estimate", String(KW.qualifyingLoan({ annualIncome: S.annualIncome, ratePct: pp.rate, termYears: 30 }).maxLoan));
    }
    if (ll.ltv != null && isFinite(ll.ltv) && KW.monthlyMI) q.set("mortgage_insurance_monthly", String(Math.round(KW.monthlyMI(ll.loan, ll.ltv * 100, S.creditScore))));
    if (pp) {
      q.set("rate_assumption", String(pp.rate));
      q.set("estimated_pi_payment", String(Math.round(pp.pi)));
      q.set("estimated_interest_only_payment", String(Math.round(pp.interestOnly)));
      q.set("interest_only_difference", String(Math.round(pp.difference)));
    }

    if (confirmedReal) {
      // Only a CONFIRMED real property county is carried into the Studio.
      if (S.state) q.set("state", S.state);
      if (S.county) q.set("county", S.county);
      if (S.county_fips) q.set("county_fips", S.county_fips);
      a.removeAttribute("data-needs-loc");
      a.textContent = "Scenario Engine Preview (internal)";
    } else {
      // No confirmed property (example / unresolved / ambiguous): never pass a
      // default county. Flag the Studio to open at property-location confirmation.
      q.set("needs_property_location", "true");
      // Carry ambiguous candidates so the Studio can offer the same choices.
      if (status === "ambiguous" && S.possibleMatches && S.possibleMatches.length) {
        try {
          q.set("possible_matches", JSON.stringify(S.possibleMatches.map(function (m) {
            return { state_abbr: m.state_abbr, county_name: m.county_name, county_fips: m.county_fips };
          })));
        } catch (e) {}
      }
      a.setAttribute("data-needs-loc", "yes");
      a.textContent = "Scenario Engine Preview (internal)";
    }
    a.setAttribute("href", "scenario-studio.html?" + q.toString());
    renderCta(confirmedReal);
  }

  /* ---------- conversion CTA: state-gated lender application (CA/FL) ---------- */
  function renderCta(confirmedReal) {
    var comp = window.BJLCompliance;
    var supported = confirmedReal && comp && comp.isSupportedState && comp.isSupportedState(S.state);
    var appCta = $("[data-cta-app]"), helper = $("[data-cta-helper]"), stateBlock = $("[data-cta-state]"), prompt = $("[data-cta-prompt]");
    show(appCta, false); show(helper, false); show(stateBlock, false); show(prompt, false);
    if (supported) {
      if (appCta) {
        appCta.setAttribute("href", (comp.applicationUrl && comp.applicationUrl()) || (comp.config && comp.config.application_portal_url) || "#");
        appCta.textContent = "Review My Key West Scenario →";
      }
      show(appCta, true); show(helper, true);
    } else if (confirmedReal) {
      // Confirmed county in a state we don't route applications for yet.
      var t = $("[data-cta-state] .state-block__title");
      if (t) t.textContent = "Licensed review is not available for this property state yet.";
      show(stateBlock, true);
    } else {
      show(prompt, true);
    }
  }

  /* ---------- wiring ---------- */
  function syncReadouts() {
    set("#hs-value-out", fmt(E.value ? num(E.value.value) : S.value));
    set("#hs-down-out", (E.down ? num(E.down.value) : S.downPct) + "%");
    set("#hs-payoff-out", fmt(E.payoff ? num(E.payoff.value) : S.payoff));
    set("#hs-newloan-out", fmt(E.newloan ? num(E.newloan.value) : S.newLoan));
    set("#hs-cashout-out", fmt(E.cashout ? num(E.cashout.value) : S.cashOut));
    set("#hs-loanamt-out", fmt(E.loanamt ? num(E.loanamt.value) : S.loanAmt));
    set("#hs-score-out", String(E.score ? (parseInt(E.score.value, 10) || S.creditScore) : S.creditScore));
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
    $$("[data-paymode]").forEach(function (b) {
      b.addEventListener("click", function () {
        S.paymentMode = b.getAttribute("data-paymode");
        $$("[data-paymode]").forEach(function (x) { x.classList.toggle("is-sel", x === b); });
        if (S.confirmed) compute(); else updateContinue();
      });
    });
    $$("[data-bd-points]").forEach(function (b) {
      b.addEventListener("click", function () {
        S.buydownPoints = parseFloat(b.getAttribute("data-bd-points")) || 1;
        $$("[data-bd-points]").forEach(function (x) { x.classList.toggle("is-sel", x === b); });
        if (S.confirmed) compute();
      });
    });
    var mb1 = $("[data-confirm-manual]"); if (mb1) mb1.addEventListener("click", confirmManual);
    var mb2 = $("[data-confirm-manual2]"); if (mb2) mb2.addEventListener("click", confirmManual);
    if (E.change) E.change.addEventListener("click", function () {
      S.confirmed = false; S.isExample = false;
      show(E.confirmed, false); show(E.scenario, false); show(E.resolve, false); show(E.needcty, false);
      updateContinue();
      if (E.q) { E.q.value = ""; E.q.focus(); }
    });
    [E.value, E.down, E.payoff, E.newloan, E.cashout, E.loanamt, E.rent, E.score, E.income].forEach(function (el) {
      if (el) el.addEventListener("input", function () { syncReadouts(); compute(); });
    });
    [E.units, E.costs, E.doc].forEach(function (el) { if (el) el.addEventListener("change", compute); });
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
    if (E.score) E.score.value = String(S.creditScore);
    if (E.doc) E.doc.value = S.docType;
    if (E.income) E.income.value = String(S.annualIncome);
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
