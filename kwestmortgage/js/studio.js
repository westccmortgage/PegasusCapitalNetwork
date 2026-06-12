/* ============================================================
   Before Jumbo Strategy Studio — interactive engine
   Uses window.KW (market-config.js). No PII in localStorage.
   ============================================================ */
(function () {
  "use strict";
  if (!window.KW) return;
  var KW = window.KW, CFG = KW.config, BRAND = KW.brand;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var root = $(".studio-section");
  if (!root) return;

  var TOTAL = 9;
  var step = 1;

  var S = {
    intent: "", mode: "purchase",
    price: 1150000, downPct: 20, down: 230000,
    balance: 700000, cashout: 0, equity: 0,
    loan: 920000,
    property_location: "", occupancy: "", property_type: "",
    income_situation: "", main_concern: "",
    name: "", email: "", phone: "", preferred_contact_method: "", message: ""
  };

  /* ---------- prefill from hero (URL params + non-PII localStorage) ---------- */
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
  var backBtn = $("[data-st-back]"), nextBtn = $("[data-st-next]");
  var controls = $("[data-st-controls]");
  var resultEl = $("[data-result]"), thanksEl = $("[data-thanks]");

  var priceSlider = $("[data-st-price]"), priceOut = $("[data-st-price-out]");
  var downSlider = $("[data-st-down]"), downPctOut = $("[data-st-down-pct]"), downOut = $("[data-st-down-out]");
  var balSlider = $("[data-st-bal]"), balOut = $("[data-st-bal-out]");
  var cashSlider = $("[data-st-cash]"), cashOut = $("[data-st-cash-out]");
  var loanOut = $("[data-st-loan]");
  var modePurchase = $("[data-mode-purchase]"), modeRefi = $("[data-mode-refi]");
  var st3Title = $("[data-st3-title]"), st4Title = $("[data-st4-title]");

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
      S.down = Math.round(S.price * S.downPct / 100);
      if (S.down > S.price) S.down = S.price; // guard
      S.loan = Math.max(0, S.price - S.down);
    }
    persist();
    renderInputs();
    renderSnapshot();
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

  /* ---------- snapshot / meter / complexity / what-if / insights / cards ---------- */
  function renderSnapshot() {
    set("[data-snap-price]", KW.fmtCurrency(S.price));
    if (S.mode === "refi") {
      set("[data-snap-down]", "Equity ~" + KW.fmtCurrency(S.equity) + " · Cash-out " + KW.fmtCurrency(S.cashout));
    } else {
      set("[data-snap-down]", KW.fmtCurrency(S.down) + " (" + S.downPct + "%)");
    }
    set("[data-snap-loan]", KW.fmtCurrency(S.loan));
    set("[data-snap-occ]", S.occupancy || "—");
    set("[data-snap-type]", S.property_type || "—");
    set("[data-snap-income]", S.income_situation || "—");
    set("[data-snap-path]", KW.heroPath(S.loan, KW.occShort(S.occupancy)));

    var m = KW.meter(S.loan);
    var fill = $("[data-snap-fill]"); if (fill) fill.style.width = m.pct + "%";
    var t1 = $("[data-snap-tick1]"); if (t1) t1.style.left = m.tick1 + "%";
    var t2 = $("[data-snap-tick2]"); if (t2) t2.style.left = m.tick2 + "%";
    var snap = $(".snap"); if (snap) snap.setAttribute("data-zone", m.zone);

    var cx = KW.complexity(S);
    var cxEl = $("[data-snap-cx]");
    if (cxEl) { cxEl.textContent = cx.label; cxEl.setAttribute("data-level", String(cx.score)); }

    var ins = KW.insights(S), insWrap = $("[data-snap-insights]");
    if (insWrap) {
      insWrap.innerHTML = "";
      ins.forEach(function (t) {
        var li = document.createElement("li"); li.textContent = t; insWrap.appendChild(li);
      });
    }
    renderWhatIf();
    renderPathCards();
  }

  function renderWhatIf() {
    var wi = KW.whatIf(S), body = $("[data-whatif-body]"), note = $("[data-whatif-note]");
    if (!body) return;
    if (wi.state === "over") {
      body.innerHTML =
        "To bring the estimated loan amount to the configured " + CFG.countyName +
        " high-balance reference limit, the math illustration suggests approximately <strong>" +
        KW.fmtCurrency(wi.extra) + "</strong> additional down payment.<br>" +
        "That would bring estimated total down payment to <strong>" + KW.fmtCurrency(wi.target) +
        "</strong>, or about <strong>" + wi.pct.toFixed(0) + "%</strong>.";
      note.textContent = "This is only a math illustration. It is not a loan approval, rate quote, underwriting decision, or recommendation. Final options depend on borrower qualification, property eligibility, occupancy, insurance, condo review, assets, income, credit, and lender guidelines.";
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
      var status = label === r.primary ? "Primary review path" : "Possible review path";
      var card = document.createElement("div");
      card.className = "pcard";
      card.setAttribute("data-status", status === "Primary review path" ? "primary" : "possible");
      card.innerHTML = '<span class="pcard__label">' + esc(label) + '</span><span class="pcard__status">' + status + "</span>";
      wrap.appendChild(card);
    });
    var notesWrap = $("[data-pathnotes]") || (function () {
      var n = document.createElement("div"); n.setAttribute("data-pathnotes", ""); n.className = "pathnotes";
      wrap.parentNode.insertBefore(n, wrap.nextSibling); return n;
    })();
    notesWrap.innerHTML = "";
    r.notes.forEach(function (t) {
      var p = document.createElement("p"); p.className = "pathnote"; p.textContent = t; notesWrap.appendChild(p);
    });
  }

  function set(sel, val) { var el = $(sel); if (el) el.textContent = val; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  /* ---------- mode (purchase vs refi) ---------- */
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
        b.classList.toggle("is-sel", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      if (field === "intent") applyMode();
      renderSnapshot();
      // auto-advance from single-select steps
      var optStep = Number(btn.closest(".st").getAttribute("data-step"));
      if ([1, 2, 5, 6, 7, 8].indexOf(optStep) > -1 && optStep === step) {
        window.setTimeout(function () { if (step === optStep) goTo(step + 1); }, 260);
      }
    });
  });

  /* preselect occupancy option if prefilled */
  function preselect() {
    if (S.occupancy) {
      var b = $('.opt[data-field="occupancy"][data-value="' + S.occupancy + '"]');
      if (b) { b.classList.add("is-sel"); b.setAttribute("aria-pressed", "true"); }
    }
  }

  /* ---------- sliders ---------- */
  [priceSlider, downSlider, balSlider, cashSlider].forEach(function (sl) {
    if (sl) sl.addEventListener("input", recompute);
  });

  /* ---------- contact fields ---------- */
  $$("[data-c]").forEach(function (el) {
    el.addEventListener("input", function () { S[el.getAttribute("data-c")] = el.value.trim(); });
  });

  /* ---------- navigation ---------- */
  function goTo(n) {
    n = Math.max(1, Math.min(TOTAL, n));
    step = n;
    $$(".st").forEach(function (s) {
      var sn = Number(s.getAttribute("data-step"));
      var on = sn === n;
      s.hidden = !on; s.classList.toggle("is-active", on);
    });
    if (resultEl) resultEl.hidden = true;
    if (thanksEl) thanksEl.hidden = true;
    if (controls) controls.hidden = false;
    if (bar) bar.style.width = Math.round(n / TOTAL * 100) + "%";
    if (curEl) curEl.textContent = n;
    if (backBtn) backBtn.disabled = n === 1;
    if (nextBtn) nextBtn.textContent = n === TOTAL ? "Review my scenario →" : "Next →";
    var active = $('.st[data-step="' + n + '"]');
    var focusable = active && (active.querySelector(".opt, input, select, textarea"));
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
    if (resultEl) resultEl.hidden = false;
    if (bar) bar.style.width = "100%";
    var dl = $("[data-result-summary]");
    if (dl) {
      var refi = S.mode === "refi";
      var rows = [
        ["Goal", S.intent || "—"],
        ["Location", S.property_location || "—"],
        [refi ? "Estimated value" : "Purchase price / value", KW.fmtCurrency(S.price)],
        refi ? ["Current balance / cash-out", KW.fmtCurrency(S.balance) + " / " + KW.fmtCurrency(S.cashout)]
             : ["Down payment / equity", KW.fmtCurrency(S.down) + " (" + S.downPct + "%)"],
        ["Estimated loan amount", KW.fmtCurrency(S.loan)],
        ["Occupancy", S.occupancy || "—"],
        ["Property type", S.property_type || "—"],
        ["Income situation", S.income_situation || "—"],
        ["Main concern", S.main_concern || "—"],
        ["Scenario complexity", KW.complexity(S).label]
      ];
      dl.innerHTML = rows.map(function (r) {
        return '<div class="snap__row"><dt>' + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>";
      }).join("");
    }
    var chips = $("[data-result-paths]");
    if (chips) {
      chips.innerHTML = KW.suggested(S).map(function (p) { return '<span class="chip">' + esc(p) + "</span>"; }).join("");
    }
    if (resultEl) resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  var editBtn = $("[data-st-edit]");
  if (editBtn) editBtn.addEventListener("click", function () { goTo(3); });

  /* ---------- copy summary ---------- */
  var copyBtn = $("[data-st-copy]");
  if (copyBtn) copyBtn.addEventListener("click", function () {
    var text = KW.summaryText(S);
    var done = function () { copyBtn.textContent = "Copied ✓"; window.setTimeout(function () { copyBtn.textContent = "Copy Scenario Summary"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });

  /* ---------- submit to Netlify ("/" urlencoded) ---------- */
  var sendBtn = $("[data-st-send]"), sendNote = $("[data-st-sendnote]");
  if (sendBtn) sendBtn.addEventListener("click", function () {
    var wi = KW.whatIf(S);
    var data = {
      "form-name": BRAND.studioFormName,
      "bot-field": "",
      lead_source: BRAND.leadSource,
      page_url: location.href,
      timestamp: new Date().toISOString(),
      market_name: CFG.marketName,
      county_name: CFG.countyName,
      configured_limit_year: String(CFG.year),
      purchase_price_or_value: KW.fmtCurrency(S.price),
      down_payment_or_equity: S.mode === "refi" ? KW.fmtCurrency(S.equity) : KW.fmtCurrency(S.down),
      down_payment_percentage: S.mode === "refi" ? "" : (S.downPct + "%"),
      estimated_loan_amount: KW.fmtCurrency(S.loan),
      property_location: S.property_location,
      occupancy: S.occupancy,
      property_type: S.property_type,
      income_situation: S.income_situation,
      main_concern: S.main_concern,
      suggested_review_paths: KW.suggested(S).join(", "),
      scenario_complexity: KW.complexity(S).label,
      what_if_additional_down_payment: wi.state === "over" ? KW.fmtCurrency(wi.extra) : "",
      scenario_summary: KW.summaryText(S),
      name: S.name, email: S.email, phone: S.phone,
      preferred_contact_method: S.preferred_contact_method, message: S.message
    };
    var body = new URLSearchParams();
    Object.keys(data).forEach(function (k) { body.append(k, data[k] == null ? "" : data[k]); });

    sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
      .then(function (res) { if (!res.ok) throw new Error(res.status); showThanks(); })
      .catch(function () {
        sendBtn.disabled = false; sendBtn.textContent = "Send My Scenario for Licensed Review";
        if (sendNote) sendNote.textContent = "We couldn’t send that just now. Please try again, or call (561) 956-8866. This is not a loan approval or commitment to lend.";
      });
  });

  function showThanks() {
    if (resultEl) resultEl.hidden = true;
    if (thanksEl) thanksEl.hidden = false;
    if (controls) controls.hidden = true;
    try { localStorage.removeItem("kw_scenario"); } catch (e) {}
    if (thanksEl) thanksEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- soft CTA in the snapshot ("Send for Licensed Review") ---------- */
  (function softCTA() {
    var panel = $(".snap"); if (!panel) return;
    var box = document.createElement("div"); box.className = "snap__cta";
    box.innerHTML = '<p>Want a licensed mortgage professional to review this scenario?</p>' +
      '<button type="button" class="btn btn--primary btn--block" data-st-jump>Send for Licensed Review →</button>';
    panel.appendChild(box);
    box.querySelector("[data-st-jump]").addEventListener("click", function () { goTo(9); });
  })();

  /* ---------- init ---------- */
  preselect();
  applyMode();   // sets mode + recompute + snapshot
  goTo(1);
})();
