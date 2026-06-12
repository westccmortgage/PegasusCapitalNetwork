/* ============================================================
   Before Jumbo Strategy Studio — interactive engine
   Uses window.KW (market-config.js). No PII in localStorage or analytics.
   ============================================================ */
(function () {
  "use strict";
  if (!window.KW) return;
  var KW = window.KW, CFG = KW.config, BRAND = KW.brand;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var root = $(".studio-section");
  if (!root) return;

  /* lightweight analytics hook — never receives PII */
  function trackEvent(name) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: name });
      if (typeof window.gtag === "function") window.gtag("event", name);
    } catch (e) {}
  }

  var TOTAL = 9, step = 1, lastPath = "", whatIfSeen = false, formStarted = false;

  var S = {
    intent: "", mode: "purchase",
    price: 1150000, downPct: 20, down: 230000,
    balance: 700000, cashout: 0, equity: 0, loan: 920000,
    property_location: "", occupancy: "", property_type: "",
    income_situation: "", main_concern: "",
    name: "", email: "", phone: "", preferred_contact_method: "", message: "",
    timeline: "", preapproval: "", realtor: "", rental_income: "", veteran: "", funds_source: "", under_contract: ""
  };

  /* ---------- prefill from hero (URL + non-PII localStorage) ---------- */
  (function prefill() {
    try {
      var qs = new URLSearchParams(location.search);
      if (qs.get("price")) S.price = KW.parseNum(qs.get("price"));
      if (qs.get("downpct")) S.downPct = KW.parseNum(qs.get("downpct"));
      if (qs.get("occ")) S.occupancy = mapOcc(qs.get("occ"));
    } catch (e) {}
    try {
      var saved = JSON.parse(localStorage.getItem("kw_scenario") || "null");
      if (saved) {
        if (saved.price) S.price = saved.price;
        if (saved.downPct != null) S.downPct = saved.downPct;
        if (saved.occ && !S.occupancy) S.occupancy = mapOcc(saved.occ);
      }
    } catch (e) {}
  })();
  function mapOcc(o) {
    if (/investment/i.test(o)) return "Investment property";
    if (/second/i.test(o)) return "Second home";
    return "Primary residence";
  }

  /* ---------- elements ---------- */
  var bar = $("[data-st-bar]"), curEl = $("[data-st-cur]");
  var backBtn = $("[data-st-back]"), nextBtn = $("[data-st-next]"), controls = $("[data-st-controls]");
  var resultEl = $("[data-result]"), thanksEl = $("[data-thanks]");
  var priceSlider = $("[data-st-price]"), priceOut = $("[data-st-price-out]");
  var downSlider = $("[data-st-down]"), downPctOut = $("[data-st-down-pct]"), downOut = $("[data-st-down-out]");
  var balSlider = $("[data-st-bal]"), balOut = $("[data-st-bal-out]");
  var cashSlider = $("[data-st-cash]"), cashOut = $("[data-st-cash-out]");
  var loanOut = $("[data-st-loan]");
  var modePurchase = $("[data-mode-purchase]"), modeRefi = $("[data-mode-refi]");
  var st3Title = $("[data-st3-title]"), st4Title = $("[data-st4-title]");
  var consentEl = $("[data-consent]");
  var sendBtn = $("[data-st-send]"), sendNote = $("[data-st-sendnote]");

  if (priceSlider) priceSlider.value = S.price;
  if (downSlider) downSlider.value = S.downPct;

  /* ---------- compute ---------- */
  function recompute() {
    if (priceSlider) S.price = KW.parseNum(priceSlider.value);
    if (S.mode === "refi") {
      if (balSlider) S.balance = KW.parseNum(balSlider.value);
      if (cashSlider) S.cashout = KW.parseNum(cashSlider.value);
      S.equity = Math.max(0, S.price - S.balance);
      S.loan = KW.estimatedLoan({ mode: "refi", balance: S.balance, cashout: S.cashout });
    } else {
      if (downSlider) S.downPct = KW.parseNum(downSlider.value);
      S.down = Math.min(S.price, Math.round(S.price * S.downPct / 100));
      S.loan = Math.max(0, S.price - S.down);
    }
    persist(); renderInputs(); renderSnapshot();
  }
  function persist() {
    try {
      localStorage.setItem("kw_scenario", JSON.stringify({
        price: S.price, downPct: S.downPct, down: S.down, occ: KW.occShort(S.occupancy),
        mode: S.mode, balance: S.balance, cashout: S.cashout, loan: S.loan
      }));
    } catch (e) {}
  }
  function renderInputs() {
    if (priceOut) priceOut.textContent = KW.fmtCurrency(S.price);
    if (downPctOut) downPctOut.textContent = S.downPct + "%";
    if (downOut) downOut.textContent = KW.fmtCurrency(S.down);
    if (balOut) balOut.textContent = KW.fmtCurrency(S.balance);
    if (cashOut) cashOut.textContent = KW.fmtCurrency(S.cashout);
    if (loanOut) loanOut.textContent = KW.fmtCurrency(S.loan);
  }

  function set(sel, val) { var el = $(sel); if (el) el.textContent = val; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  /* ---------- snapshot / meter / complexity / what-if / insights / cards ---------- */
  function renderSnapshot() {
    set("[data-snap-price]", KW.fmtCurrency(S.price));
    set("[data-snap-down]", S.mode === "refi"
      ? "Equity ~" + KW.fmtCurrency(S.equity) + " · Cash-out " + KW.fmtCurrency(S.cashout)
      : KW.fmtCurrency(S.down) + " (" + S.downPct + "%)");
    set("[data-snap-loan]", KW.fmtCurrency(S.loan));
    set("[data-snap-occ]", S.occupancy || "—");
    set("[data-snap-type]", S.property_type || "—");
    set("[data-snap-income]", S.income_situation || "—");

    var path = KW.heroPath(S.loan, KW.occShort(S.occupancy));
    set("[data-snap-path]", path);
    if (path !== lastPath) { lastPath = path; trackEvent("review_path_changed"); }

    var m = KW.meter(S.loan);
    var fill = $("[data-snap-fill]"); if (fill) fill.style.width = m.pct + "%";
    var t1 = $("[data-snap-tick1]"); if (t1) t1.style.left = m.tick1 + "%";
    var t2 = $("[data-snap-tick2]"); if (t2) t2.style.left = m.tick2 + "%";
    var snap = $(".snap"); if (snap) snap.setAttribute("data-zone", m.zone);

    var cx = KW.complexity(S), cxEl = $("[data-snap-cx]");
    if (cxEl) { cxEl.textContent = cx.label; cxEl.setAttribute("data-level", String(cx.score)); }

    var ins = KW.insights(S), insWrap = $("[data-snap-insights]");
    if (insWrap) { insWrap.innerHTML = ""; ins.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; insWrap.appendChild(li); }); }

    renderWhatIf(); renderPathCards();
  }

  function renderWhatIf() {
    var wi = KW.whatIf(S), body = $("[data-whatif-body]"), note = $("[data-whatif-note]");
    if (!body) return;
    if (wi.state === "over") {
      if (!whatIfSeen) { whatIfSeen = true; trackEvent("what_if_viewed"); }
      body.innerHTML = "To bring the estimated loan amount to the configured " + CFG.countyName +
        " high-balance reference limit, the math illustration suggests approximately <strong>" + KW.fmtCurrency(wi.extra) +
        "</strong> additional down payment.<br>That would bring estimated total down payment to <strong>" + KW.fmtCurrency(wi.target) +
        "</strong>, or about <strong>" + wi.pct.toFixed(0) + "%</strong>.";
      note.textContent = "This is only a math illustration. It is not a loan approval, rate quote, underwriting decision, or recommendation. Jumbo may still be the right path for some buyers. Final options depend on borrower qualification, property eligibility, occupancy, insurance, condo review, assets, income, credit, and lender guidelines.";
    } else if (wi.state === "highbalance") {
      body.innerHTML = "Your estimated loan amount appears to be within the configured high-balance review range.";
      note.textContent = "Final eligibility still depends on borrower, property, occupancy, and lender guidelines.";
    } else if (wi.state === "baseline") {
      body.innerHTML = "Your estimated loan amount appears to be within the baseline conforming review range.";
      note.textContent = "Final eligibility still depends on full underwriting and program guidelines.";
    } else {
      body.innerHTML = "Adjust your numbers to see how the review path may change.";
      note.textContent = "";
    }
  }

  function renderPathCards() {
    var wrap = $("[data-pathcards]"); if (!wrap) return;
    var r = KW.reviewPaths(S);
    wrap.innerHTML = "";
    r.paths.forEach(function (label) {
      var primary = label === r.primary;
      var card = document.createElement("div");
      card.className = "pcard"; card.setAttribute("data-status", primary ? "primary" : "possible");
      card.innerHTML = '<span class="pcard__label">' + esc(label) + '</span><span class="pcard__status">' +
        (primary ? "Primary review path" : "Possible review path") + "</span>";
      wrap.appendChild(card);
    });
    var notesWrap = $("[data-pathnotes]") || (function () {
      var n = document.createElement("div"); n.setAttribute("data-pathnotes", ""); n.className = "pathnotes";
      wrap.parentNode.insertBefore(n, wrap.nextSibling); return n;
    })();
    notesWrap.innerHTML = "";
    r.notes.forEach(function (t) { var p = document.createElement("p"); p.className = "pathnote"; p.textContent = t; notesWrap.appendChild(p); });
  }

  /* ---------- mode ---------- */
  function applyMode() {
    S.mode = /refinance|cash-out/i.test(S.intent) ? "refi" : "purchase";
    var refi = S.mode === "refi";
    if (modePurchase) modePurchase.hidden = refi;
    if (modeRefi) modeRefi.hidden = !refi;
    if (st3Title) st3Title.textContent = refi ? "Estimated property value" : "Purchase price or estimated value";
    if (st4Title) st4Title.textContent = refi ? "Current balance & cash-out" : "Down payment or equity";
    recompute();
  }

  /* ---------- option selection ---------- */
  $$(".opt").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var field = btn.getAttribute("data-field"), val = btn.getAttribute("data-value");
      S[field] = val;
      $$('.opt[data-field="' + field + '"]').forEach(function (b) {
        b.classList.toggle("is-sel", b === btn); b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      if (field === "intent") applyMode();
      renderSnapshot();
      var optStep = Number(btn.closest(".st").getAttribute("data-step"));
      if ([1, 2, 5, 6, 7, 8].indexOf(optStep) > -1 && optStep === step) {
        window.setTimeout(function () { if (step === optStep) goTo(step + 1); }, 260);
      }
    });
  });
  function preselect() {
    if (S.occupancy) {
      var b = $('.opt[data-field="occupancy"][data-value="' + S.occupancy + '"]');
      if (b) { b.classList.add("is-sel"); b.setAttribute("aria-pressed", "true"); }
    }
  }

  /* ---------- sliders + contact + advanced + consent ---------- */
  [priceSlider, downSlider, balSlider, cashSlider].forEach(function (sl) { if (sl) sl.addEventListener("input", recompute); });
  $$("[data-c]").forEach(function (el) { el.addEventListener("input", function () { S[el.getAttribute("data-c")] = el.value.trim(); el.classList.remove("is-bad"); }); });
  $$("[data-adv]").forEach(function (el) {
    el.addEventListener("change", function () {
      var k = el.getAttribute("data-adv"); S[k] = el.value;
      if (k === "timeline") S.under_contract = /under contract/i.test(el.value) ? "Yes" : "No";
      renderSnapshot();
    });
  });

  /* ---------- next-best question ---------- */
  var nbqEl = document.createElement("p");
  nbqEl.className = "st__nbq"; nbqEl.setAttribute("aria-live", "polite");
  if (controls && controls.parentNode) controls.parentNode.insertBefore(nbqEl, controls);
  var NBQ = {
    1: "Are you trying to keep the loan amount before jumbo?",
    2: "Where in the Keys are you focused?",
    3: "Are you trying to keep the loan amount before jumbo? Try adjusting the price.",
    4: "A higher down payment may change the review path — try adjusting it.",
    5: "Will this be a primary home, second home, or rental/investment property?",
    6: "Is this property a condo or part of an HOA?",
    7: "Do you want traditional income review or alternative documentation review?",
    8: "Want a licensed professional to review this scenario?",
    9: ""
  };
  function renderNBQ(n) { nbqEl.textContent = NBQ[n] || ""; nbqEl.style.display = NBQ[n] ? "" : "none"; }

  /* ---------- navigation ---------- */
  function goTo(n) {
    n = Math.max(1, Math.min(TOTAL, n));
    step = n;
    $$(".st").forEach(function (s) {
      var sn = Number(s.getAttribute("data-step")), on = sn === n;
      s.hidden = !on; s.classList.toggle("is-active", on);
    });
    if (resultEl) resultEl.hidden = true;
    if (thanksEl) thanksEl.hidden = true;
    if (controls) controls.hidden = false;
    if (bar) bar.style.width = Math.round(n / TOTAL * 100) + "%";
    if (curEl) curEl.textContent = n;
    if (backBtn) backBtn.disabled = n === 1;
    if (nextBtn) nextBtn.textContent = n === TOTAL ? "Review my scenario →" : "Next →";
    renderNBQ(n);
    updateMobileBar();
    if (n === TOTAL && !formStarted) { formStarted = true; trackEvent("lead_form_started"); }
    var active = $('.st[data-step="' + n + '"]');
    var focusable = active && active.querySelector(".opt, input, select, textarea");
    if (focusable) { try { focusable.focus({ preventScroll: true }); } catch (e) {} }
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (backBtn) backBtn.addEventListener("click", function () { goTo(step - 1); });
  if (nextBtn) nextBtn.addEventListener("click", function () {
    if (step === TOTAL) { if (validateContact()) showResult(); return; }
    goTo(step + 1);
  });

  function validateContact() {
    var ok = true, first = null;
    [["name", S.name], ["email", S.email], ["phone", S.phone]].forEach(function (p) {
      var el = $('[data-c="' + p[0] + '"]');
      var bad = !p[1] || (p[0] === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p[1]));
      if (el) el.classList.toggle("is-bad", bad);
      if (bad && !first) first = el;
      if (bad) ok = false;
    });
    if (first) { try { first.focus(); } catch (e) {} }
    return ok;
  }

  /* ---------- result ---------- */
  function showResult() {
    $$(".st").forEach(function (s) { s.hidden = true; s.classList.remove("is-active"); });
    if (controls) controls.hidden = true;
    nbqEl.style.display = "none";
    if (resultEl) resultEl.hidden = false;
    if (bar) bar.style.width = "100%";
    updateMobileBar();

    var o = KW.strategySummary(S), refi = o.mode === "refinance";
    var dl = $("[data-result-summary]");
    if (dl) {
      var rows = [
        ["Goal", o.purchasePurpose || "—"],
        ["Location", o.propertyLocation || "—"],
        [refi ? "Estimated value" : "Purchase price / value", KW.fmtCurrency(o.purchasePrice)],
        refi ? ["Current balance / cash-out", KW.fmtCurrency(o.currentLoanBalance) + " / " + KW.fmtCurrency(o.cashOut)]
             : ["Down payment / equity", KW.fmtCurrency(o.downPaymentAmount) + " (" + (o.downPaymentPercent || 0).toFixed(0) + "%)"],
        ["Estimated loan amount", KW.fmtCurrency(o.estimatedLoanAmount)],
        ["Occupancy", o.occupancy || "—"],
        ["Property type", o.propertyType || "—"],
        ["Income situation", o.incomeSituation || "—"],
        ["Main concern", o.mainConcern || "—"],
        ["Scenario complexity", o.complexityLevel]
      ];
      dl.innerHTML = rows.map(function (r) { return '<div class="snap__row"><dt>' + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
    }
    var chips = $("[data-result-paths]");
    if (chips) chips.innerHTML = [o.primaryReviewPath].concat(o.secondaryReviewPaths).map(function (p) { return '<span class="chip">' + esc(p) + "</span>"; }).join("");
    var aw = $("[data-result-attention-wrap]"), al = $("[data-result-attention]");
    if (al) { al.innerHTML = o.attentionItems.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join(""); }
    if (aw) aw.hidden = o.attentionItems.length === 0;
    resetAiPanel();
    if (resultEl) resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  var editBtn = $("[data-st-edit]");
  if (editBtn) editBtn.addEventListener("click", function () { goTo(3); });

  /* ---------- AI Strategy Explainer (on-demand; rule-based fallback) ---------- */
  var AI_ENDPOINT = "/.netlify/functions/explain-strategy";
  var aiBtn = $("[data-ai-explain]"), aiBody = $("[data-ai-body]"), aiBadge = $("[data-ai-badge]");
  var AI_PROMPT_HTML = aiBody ? aiBody.innerHTML : "";

  /* Build a compact, PII-free context from the engine's strategy summary. */
  function aiContextFrom(o) {
    var bp = o.buydownPermanent, bt = o.buydownTemporary;
    return {
      market: o.market, county: o.county, state: o.state, limitYear: o.year,
      baselineConformingLimit: o.baselineConformingLimit, highBalanceLimit: o.highBalanceLimit,
      mode: o.mode, purchasePrice: o.purchasePrice,
      downPaymentAmount: o.downPaymentAmount, downPaymentPercent: o.downPaymentPercent,
      estimatedLoanAmount: o.estimatedLoanAmount,
      occupancy: o.occupancy, propertyType: o.propertyType,
      incomeSituation: o.incomeSituation, mainConcern: o.mainConcern,
      primaryReviewPath: o.primaryReviewPath, secondaryReviewPaths: o.secondaryReviewPaths,
      complexityLevel: o.complexityLevel,
      whatIfBeforeJumbo: o.whatIfBeforeJumbo,
      payment: {
        rateAssumptionLabel: o.payment.rateLabel, estimatedRatePct: o.payment.rate,
        termYears: o.payment.term, estimatedPI: Math.round(o.payment.pi),
        estimatedPITIA: Math.round(o.payment.total)
      },
      dscr: (o.dscr && o.dscr.has) ? { ratio: Number(o.dscr.ratio.toFixed(2)) } : null,
      buydownPermanent: (bp && bp.monthlySavings > 0) ? {
        currentRatePct: bp.curRate, buydownRatePct: bp.bdRate, points: bp.points,
        costEstimate: Math.round(bp.cost), monthlySavingsEstimate: Math.round(bp.monthlySavings),
        breakEvenMonths: bp.breakEvenMonths != null ? Math.round(bp.breakEvenMonths) : null
      } : null,
      buydownTemporary: bt ? { type: bt.type, subsidyEstimate: Math.round(bt.subsidy) } : null,
      buydownHoldYears: o.buydownHoldYears,
      attentionItems: o.attentionItems, keyInsights: o.keyInsights
    };
  }

  function renderParagraphs(text) {
    if (!aiBody) return;
    aiBody.innerHTML = "";
    String(text).split(/\n{2,}|\n/).forEach(function (para) {
      var t = para.trim(); if (!t) return;
      var p = document.createElement("p"); p.textContent = t; aiBody.appendChild(p);
    });
  }

  /* When the API is unavailable (no key, offline), use the engine's built-in
     rule-based explanation so the result page always shows a useful walkthrough. */
  function ruleBasedFallback() {
    renderParagraphs(KW.explain(S).join("\n\n"));
    if (aiBadge) aiBadge.textContent = "Offline summary";
  }

  function resetAiPanel() {
    if (!aiBody) return;
    aiBody.innerHTML = AI_PROMPT_HTML;
    if (aiBadge) aiBadge.textContent = "Plain English";
    if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = "Explain my strategy →"; }
  }

  if (aiBtn) aiBtn.addEventListener("click", function () {
    trackEvent("ai_explainer_requested");
    aiBtn.disabled = true; aiBtn.textContent = "Thinking…";
    if (aiBadge) aiBadge.textContent = "Working…";
    aiBody.innerHTML = '<p class="result-ai__loading">Reading your scenario…</p>';
    var ctx = aiContextFrom(KW.strategySummary(S));
    fetch(AI_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: ctx })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (r.ok && r.data && r.data.explanation) {
        renderParagraphs(r.data.explanation);
        if (aiBadge) aiBadge.textContent = "Plain English";
        aiBtn.disabled = false; aiBtn.textContent = "Re-explain";
        trackEvent("ai_explainer_succeeded");
      } else {
        ruleBasedFallback();
        aiBtn.disabled = false; aiBtn.textContent = "Try again";
        trackEvent("ai_explainer_fallback");
      }
    }).catch(function () {
      ruleBasedFallback();
      aiBtn.disabled = false; aiBtn.textContent = "Try again";
      trackEvent("ai_explainer_fallback");
    });
  });

  /* ---------- copy summary ---------- */
  function copySummary(btn) {
    var text = KW.summaryText(S);
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = "Copied ✓"; window.setTimeout(function () { btn.textContent = t; }, 1800); } trackEvent("scenario_summary_copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fb); else fb();
    function fb() { var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(ta); }
  }
  var copyBtn = $("[data-st-copy]");
  if (copyBtn) copyBtn.addEventListener("click", function () { copySummary(copyBtn); });

  /* ---------- submit to Netlify ("/" urlencoded) ---------- */
  if (sendBtn) sendBtn.addEventListener("click", function () {
    if (consentEl && !consentEl.checked) {
      if (sendNote) sendNote.textContent = "Please check the consent box so a licensed mortgage professional can contact you.";
      try { consentEl.focus(); } catch (e) {}
      return;
    }
    var o = KW.strategySummary(S);
    var data = {
      "form-name": BRAND.studioFormName,
      "bot-field": "",
      lead_source: BRAND.leadSource,
      page_url: location.href,
      timestamp: new Date().toISOString(),
      market_name: o.market,
      market_slug: o.marketSlug,
      domain: o.domain,
      county_name: o.county,
      configured_limit_year: String(o.year),
      purchase_price_or_value: KW.fmtCurrency(o.purchasePrice),
      down_payment_or_equity: KW.fmtCurrency(o.downPaymentAmount),
      down_payment_percentage: o.downPaymentPercent == null ? "" : (o.downPaymentPercent + "%"),
      estimated_loan_amount: KW.fmtCurrency(o.estimatedLoanAmount),
      property_location: o.propertyLocation,
      occupancy: o.occupancy,
      property_type: o.propertyType,
      income_situation: o.incomeSituation,
      main_concern: o.mainConcern,
      suggested_review_paths: [o.primaryReviewPath].concat(o.secondaryReviewPaths).join(", "),
      scenario_complexity: o.complexityLevel,
      what_if_additional_down_payment: o.whatIfBeforeJumbo.state === "over" ? KW.fmtCurrency(o.whatIfBeforeJumbo.extra) : "",
      lead_intent_level: o.leadIntentLevel,
      lead_tags: o.leadTags.join(", "),
      scenario_summary: KW.summaryText(S),
      name: S.name, email: S.email, phone: S.phone,
      preferred_contact_method: S.preferred_contact_method, message: S.message
    };
    var body = new URLSearchParams();
    Object.keys(data).forEach(function (k) { body.append(k, data[k] == null ? "" : data[k]); });

    sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    if (sendNote) sendNote.textContent = "This is not a loan approval or commitment to lend.";
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
      .then(function (res) { if (!res.ok) throw new Error(res.status); trackEvent("lead_form_submitted"); showThanks(); })
      .catch(function () {
        trackEvent("lead_form_error");
        sendBtn.disabled = false; sendBtn.textContent = "Send My Scenario for Licensed Review";
        if (sendNote) {
          sendNote.innerHTML = "We couldn’t submit the scenario automatically. Your details are still here — please use <strong>Copy Scenario Summary</strong> and email it to <a href=\"mailto:" + BRAND.recipient + "\">" + BRAND.recipient + "</a>, or call (561) 956-8866.";
        }
      });
  });

  function showThanks() {
    if (resultEl) resultEl.hidden = true;
    if (thanksEl) thanksEl.hidden = false;
    if (controls) controls.hidden = true;
    nbqEl.style.display = "none";
    updateMobileBar(true);
    try { localStorage.removeItem("kw_scenario"); } catch (e) {}
    if (thanksEl) thanksEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- soft CTA in snapshot ---------- */
  (function softCTA() {
    var panel = $(".snap"); if (!panel) return;
    var box = document.createElement("div"); box.className = "snap__cta";
    box.innerHTML = '<p>Want a licensed mortgage professional to review this scenario?</p>' +
      '<button type="button" class="btn btn--primary btn--block" data-st-jump>Send for Licensed Review →</button>';
    panel.appendChild(box);
    box.querySelector("[data-st-jump]").addEventListener("click", function () { goTo(9); });
  })();

  /* ---------- mobile bottom bar (appears after interaction) ---------- */
  var mbar = document.createElement("div");
  mbar.className = "studio-mbar"; mbar.hidden = true;
  mbar.innerHTML = '<span class="studio-mbar__txt">Scenario started</span><button type="button" class="btn btn--primary" data-mbar-go>Continue →</button>';
  document.body.appendChild(mbar);
  mbar.querySelector("[data-mbar-go]").addEventListener("click", function () {
    if (step < TOTAL) goTo(step + 1);
    else { if (validateContact()) showResult(); }
  });
  function updateMobileBar(forceHide) {
    var inFlow = !forceHide && step >= 2 && step <= TOTAL && (!resultEl || resultEl.hidden) && (!thanksEl || thanksEl.hidden);
    mbar.hidden = !inFlow;
    var go = mbar.querySelector("[data-mbar-go]");
    if (go) go.textContent = step === TOTAL ? "Review →" : "Continue →";
  }

  /* ---------- market-aware copy (from active MARKET_CONFIG) ---------- */
  (function applyMarketCopy() {
    var name = CFG.marketName || "";
    var nameEl = $("[data-market-name]"); if (nameEl) nameEl.textContent = name + " · Before Jumbo Strategy Studio";
    var heroEl = $("[data-market-hero]"); if (heroEl && CFG.marketHeroCopy) heroEl.textContent = CFG.marketHeroCopy;
    if (name) { try { document.title = "Before Jumbo Strategy Studio — " + name; } catch (e) {} }
    // surface the market's local disclaimer in the compliance line if present
    var comp = $(".studio__compliance");
    if (comp && CFG.localDisclaimer) comp.insertAdjacentHTML("afterbegin", "<strong>" + name + ":</strong> " + CFG.localDisclaimer + " ");
  })();

  /* ---------- init ---------- */
  preselect();
  applyMode();
  goTo(1);
  trackEvent("strategy_studio_started");
})();
