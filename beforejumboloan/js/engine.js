/* ============================================================
   Before Jumbo Strategy Studio — Market config + portable logic
   ------------------------------------------------------------
   PORTABILITY: market copy lives in the MARKETS registry; the default
   is a neutral "generic" market so the Studio never shows a specific
   county unless a route preset or a confirmed property county sets it.
   Calculation logic below references the config only — no city or
   limit is hard-coded inside the functions.

   COMPLIANCE: this is NOT a rate/payment calculator. It organizes a
   loan amount and review path only. No PII is processed here.
   Verify all loan limits annually (FHFA / Fannie Mae / HUD).
   ============================================================ */
(function (global) {
  "use strict";

  /* ============================================================
     MARKET REGISTRY — add/edit markets here. The engine + UI read
     the ACTIVE market only. Resolve by URL path (/key-west) or
     ?market=slug. Verify every limit annually before launch.
     baselineConformingLimit = standard 1-unit conforming reference.
     highBalanceLimit = 1-unit high-cost-area ceiling for that county
       (set equal to baseline for non-high-cost counties).
     ============================================================ */
  var DEFAULT_MARKET = "generic";
  var LIMIT_YEAR = 2026;
  var VERIFY = "VERIFY BEFORE LAUNCH (FHFA / Fannie Mae / HUD)";
  // FHFA 2026 Conforming Loan Limit Values (effective 2026-01-01):
  //   baseline 1-unit $832,750 · high-cost ceiling 1-unit $1,249,125.
  // County values below reflect FHFA's published 2026 1-unit limits.
  var VERIFIED = "FHFA 2026 CLL — verified 2026-06-12";

  var MARKETS = {
    "generic": {
      marketSlug: "generic", marketName: "", countyName: "", state: "",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 832750, fhaLimit: null,
      localDisclaimer: "", marketHeroCopy: "", lastVerifiedDate: VERIFY
    },
    "key-west": {
      marketSlug: "key-west", marketName: "Key West / Monroe County", countyName: "Monroe County", state: "FL",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 990150, fhaLimit: null,
      localDisclaimer: "Monroe County is a high-cost area; coastal insurance, flood, condo, and HOA factors can significantly affect Key West scenarios.",
      marketHeroCopy: "Buying in Key West? Don’t assume it has to be jumbo — compare your review path before you write the offer.",
      lastVerifiedDate: VERIFIED
    },
    "palm-beach": {
      marketSlug: "palm-beach", marketName: "Palm Beach County", countyName: "Palm Beach County", state: "FL",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 832750, fhaLimit: null,
      localDisclaimer: "Palm Beach County generally uses the baseline conforming limit; insurance, flood, and HOA factors can affect scenarios.",
      marketHeroCopy: "Buying in Palm Beach County? Compare conforming, jumbo, and other review paths before you write the offer.",
      lastVerifiedDate: VERIFIED
    },
    "miami-dade": {
      marketSlug: "miami-dade", marketName: "Miami-Dade County", countyName: "Miami-Dade County", state: "FL",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 832750, fhaLimit: null,
      localDisclaimer: "Miami-Dade County generally uses the baseline conforming limit; condo project, insurance, and HOA review can matter.",
      marketHeroCopy: "Buying in Miami-Dade? Compare conforming, jumbo, condo, and investor review paths before you write the offer.",
      lastVerifiedDate: VERIFIED
    },
    "california": {
      marketSlug: "california", marketName: "California (high-cost)", countyName: "California", state: "CA",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 1249125, fhaLimit: null,
      localDisclaimer: "California conforming limits vary by county; the configured value is the 2026 high-cost-area ceiling. Verify the specific county before launch.",
      marketHeroCopy: "Buying in California? Don’t assume it has to be jumbo — compare your review path before you write the offer.",
      lastVerifiedDate: VERIFY
    },
    "orange-county": {
      marketSlug: "orange-county", marketName: "Orange County, CA", countyName: "Orange County", state: "CA",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 1249125, fhaLimit: null,
      localDisclaimer: "Orange County is a high-cost area; the configured value is the 2026 high-cost ceiling.",
      marketHeroCopy: "Buying in Orange County? Compare high-balance conforming vs jumbo before you write the offer.",
      lastVerifiedDate: VERIFIED
    },
    "los-angeles": {
      marketSlug: "los-angeles", marketName: "Los Angeles County, CA", countyName: "Los Angeles County", state: "CA",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 1249125, fhaLimit: null,
      localDisclaimer: "Los Angeles County is a high-cost area; the configured value is the 2026 high-cost ceiling.",
      marketHeroCopy: "Buying in Los Angeles? Compare high-balance conforming vs jumbo before you write the offer.",
      lastVerifiedDate: VERIFIED
    },
    "custom": {
      marketSlug: "custom", marketName: "Your Market", countyName: "Your County", state: "US",
      loanLimitYear: LIMIT_YEAR, baselineConformingLimit: 832750, highBalanceLimit: 832750, fhaLimit: null,
      localDisclaimer: "Configure this market in MARKETS['custom'] before launch.",
      marketHeroCopy: "Don’t assume it has to be jumbo — compare your review path before you write the offer.",
      lastVerifiedDate: VERIFY
    }
  };

  var BRAND_CONFIG = {
    brandName: "Before Jumbo Loan",
    domain: "beforejumboloan.com",
    logoText: "Before Jumbo",
    primaryCTA: "Review My Scenario",
    poweredByText: "Powered by licensed mortgage professionals.",
    complianceFooter: "Educational scenario-organization tool. Not a loan application, approval, rate quote, underwriting decision, or commitment to lend. Subject to borrower qualification, property eligibility, underwriting approval, and current program guidelines.",
    recipient: "REPLACE_WITH_PRODUCTION_LEAD_EMAIL"
  };

  var FORM_CONFIG = {
    formName: "before-jumbo-strategy-studio",
    leadSource: "Before Jumbo Strategy Studio",
    notificationEmail: "REPLACE_WITH_PRODUCTION_LEAD_EMAIL"
  };

  /* Resolve active market from ?market=slug, URL path slug, or default. */
  function resolveSlug() {
    try {
      var loc = global.location || {};
      var qs = new URLSearchParams(loc.search || "");
      if (qs.get("market") && MARKETS[qs.get("market")]) return qs.get("market");
      var seg = (loc.pathname || "").replace(/^\/+|\/+$/g, "").split("/")[0].toLowerCase();
      if (MARKETS[seg]) return seg;
    } catch (e) {}
    return DEFAULT_MARKET;
  }
  var ACTIVE_SLUG = resolveSlug();
  var MARKET_CONFIG = MARKETS[ACTIVE_SLUG];
  MARKET_CONFIG.year = MARKET_CONFIG.loanLimitYear;          // back-compat alias used by engine
  MARKET_CONFIG.sourceNote = MARKET_CONFIG.localDisclaimer;  // back-compat alias

  // Map registry brand/form into the legacy BRAND_CONFIG keys the studio expects.
  BRAND_CONFIG.studioFormName = FORM_CONFIG.formName;
  BRAND_CONFIG.leadSource = FORM_CONFIG.leadSource;
  if (FORM_CONFIG.notificationEmail) BRAND_CONFIG.recipient = FORM_CONFIG.notificationEmail;

  function setMarket(slug) {
    if (MARKETS[slug]) {
      ACTIVE_SLUG = slug; MARKET_CONFIG = MARKETS[slug];
      MARKET_CONFIG.year = MARKET_CONFIG.loanLimitYear;
      MARKET_CONFIG.sourceNote = MARKET_CONFIG.localDisclaimer;
      if (global.KW) global.KW.config = MARKET_CONFIG;
      global.MARKET_CONFIG = MARKET_CONFIG;
    }
    return MARKET_CONFIG;
  }

  var COMPLIANCE_REF = "Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch.";
  var LAST_LOCATION = null;

  /* Resolve loan limits for a selected property location via the national
     resolver (js/loan-limits.js) and fold them into the active MARKET_CONFIG
     so ALL existing engine math (primaryPath, meter, whatIf, payment, …)
     reuses them with no rewrite. Returns the full resolution object. */
  function applyLocation(state, county, zip, units) {
    var res = null;
    if (global.BJLLimits && typeof global.BJLLimits.resolveLoanLimits === "function") {
      res = global.BJLLimits.resolveLoanLimits({ state: state, county: county, zip: zip, units: units });
    }
    if (res) {
      if (res.conformingBaseline != null) MARKET_CONFIG.baselineConformingLimit = res.conformingBaseline;
      if (res.countyConformingLimit != null) MARKET_CONFIG.highBalanceLimit = res.countyConformingLimit;
      if (res.year != null) { MARKET_CONFIG.year = res.year; MARKET_CONFIG.loanLimitYear = res.year; }
    }
    if (state) MARKET_CONFIG.state = String(state).toUpperCase();
    if (county) MARKET_CONFIG.countyName = county;
    MARKET_CONFIG.units = (res && res.units) || units || 1;
    global.MARKET_CONFIG = MARKET_CONFIG;
    var stored = res || {
      state: state || null, county: county || null, zip: zip || null, units: units || 1,
      year: MARKET_CONFIG.year,
      conformingBaseline: MARKET_CONFIG.baselineConformingLimit,
      countyConformingLimit: MARKET_CONFIG.highBalanceLimit,
      highCost: MARKET_CONFIG.highBalanceLimit > MARKET_CONFIG.baselineConformingLimit,
      fhaLimit: null, source: "Route preset", verifiedAt: null,
      compliance: COMPLIANCE_REF,
      warning: "Loan-limit dataset not loaded — using the route preset. Verify before use.",
      found: false
    };
    LAST_LOCATION = stored;
    if (global.KW) global.KW.lastLocation = stored;
    return stored;
  }

  /* Route-preset location for preselecting the selector (state abbr + concrete
     county only; placeholder county names like "California"/"Your County" are
     treated as "state only, pick a county"). */
  function locationPreset() {
    var st = MARKET_CONFIG.state || "";
    var cty = MARKET_CONFIG.countyName || "";
    if (/^(your county|california)$/i.test(cty)) cty = "";
    return { state: st, county: cty };
  }

  /* Rate ASSUMPTIONS — education only. Edit in js/rate-config.js (window.BJLRates).
     Falls back to these defaults when the central config isn't loaded. */
  var RATE_CONFIG = {
    lastUpdated: "2026-06-12",
    sourceLabel: "Owner-provided educational rate assumptions. Verify current pricing before use.",
    conforming30: 6.58,
    jumbo30: 6.84,
    fha30: 6.14,
    va30: 6.16,
    note: "Rates shown are assumptions for education only. They are not rate quotes, APRs, locked rates, or commitments to lend."
  };
  /* Resolve a named assumption from the central config (window.BJLRates) with a
     safe fallback. Keeps everything deterministic and owner-configurable. */
  function rateAssumption(key, fallback) {
    var a = global.BJLRates && global.BJLRates.assumptions;
    if (a && a[key] != null) return a[key];
    return fallback;
  }

  /* ---------- Credit score → rate add-on (educational, deterministic) ---------- */
  var SCORE_BANDS_FALLBACK = [
    { min: 740, add: 0.00, tier: "Strong (740+) — already great for pricing" },
    { min: 720, add: 0.25, tier: "Good (720–739)" },
    { min: 700, add: 0.50, tier: "Fair (700–719)" },
    { min: 680, add: 0.875, tier: "Below par (680–699)" },
    { min: 660, add: 1.25, tier: "Lower (660–679)" },
    { min: 640, add: 1.75, tier: "Low (640–659)" },
    { min: 0,   add: 2.50, tier: "Under 640 — needs licensed review" }
  ];
  function scoreBands() {
    var b = global.BJLRates && global.BJLRates.score_adjustments;
    return (b && b.length) ? b : SCORE_BANDS_FALLBACK;
  }
  function scoreRateAdjust(score) {
    score = parseInt(score, 10) || 0;
    var bands = scoreBands();
    for (var i = 0; i < bands.length; i++) if (score >= bands[i].min) return bands[i].add;
    return bands[bands.length - 1].add;
  }
  function scoreTier(score) {
    score = parseInt(score, 10) || 0;
    var bands = scoreBands();
    for (var i = 0; i < bands.length; i++) if (score >= bands[i].min) return bands[i].tier;
    return bands[bands.length - 1].tier;
  }

  /* ---------- Mortgage insurance (PMI) — only when LTV > 80% ---------- */
  var MI_FACTORS_FALLBACK = [
    { maxLtv: 80, pct: 0 }, { maxLtv: 85, pct: 0.30 }, { maxLtv: 90, pct: 0.49 },
    { maxLtv: 95, pct: 0.67 }, { maxLtv: 97, pct: 0.92 }, { maxLtv: 100, pct: 1.10 }
  ];
  var MI_SCORE_MULT_FALLBACK = [
    { min: 760, mult: 1.0 }, { min: 740, mult: 1.05 }, { min: 720, mult: 1.15 },
    { min: 700, mult: 1.30 }, { min: 680, mult: 1.50 }, { min: 0, mult: 1.80 }
  ];
  function miFactor(ltvPct) {
    var f = (global.BJLRates && global.BJLRates.mi_annual_factors) || MI_FACTORS_FALLBACK;
    for (var i = 0; i < f.length; i++) if (ltvPct <= f[i].maxLtv) return f[i].pct;
    return f[f.length - 1].pct;
  }
  function miScoreMult(score) {
    score = parseInt(score, 10) || 0;
    var m = (global.BJLRates && global.BJLRates.mi_score_multiplier) || MI_SCORE_MULT_FALLBACK;
    for (var i = 0; i < m.length; i++) if (score >= m[i].min) return m[i].mult;
    return m[m.length - 1].mult;
  }
  /* Monthly PMI estimate. ltvPct is loan/value as a percent. 0 at/below 80% LTV. */
  function monthlyMI(loan, ltvPct, score) {
    loan = parseNum(loan); ltvPct = Number(ltvPct) || 0;
    if (loan <= 0 || ltvPct <= 80) return 0;
    var annualPct = miFactor(ltvPct) * miScoreMult(score);
    return loan * (annualPct / 100) / 12;
  }

  /* ---------- Income documentation type → rate add-on (Non-QM prices higher) ---------- */
  var DOC_FALLBACK = [
    { key: "w2", add: 0.00, label: "W-2 (full documentation)", nonqm: false },
    { key: "self_employed", add: 0.125, label: "Self-employed (tax returns)", nonqm: false },
    { key: "ten99", add: 0.75, label: "1099 (Non-QM)", nonqm: true },
    { key: "bank_statement", add: 0.90, label: "Bank statements (Non-QM)", nonqm: true }
  ];
  function docTypes() {
    var d = global.BJLRates && global.BJLRates.doc_type_adjustments;
    return (d && d.length) ? d : DOC_FALLBACK;
  }
  function docTypeInfo(key) {
    var d = docTypes();
    for (var i = 0; i < d.length; i++) if (d[i].key === key) return d[i];
    return d[0];
  }
  function docTypeAdjust(key) { return docTypeInfo(key).add; }

  /* ---------- Income → qualifying loan estimate (educational, DTI-based) ----------
     Given an approximate gross ANNUAL income and the assumed rate (which already
     includes the score + income-type add-ons), back out the largest loan the
     payment could support. Not an approval or pre-qualification. */
  function qualifyingLoan(o) {
    o = o || {};
    var cfg = (global.BJLRates && global.BJLRates.affordability) || {};
    var annual = parseNum(o.annualIncome);
    var rate = parseNum(o.ratePct);
    var term = o.termYears ? parseNum(o.termYears) : 30;
    var dti = o.maxDti != null ? o.maxDti : (cfg.max_dti != null ? cfg.max_dti : 0.43);
    var tiShare = o.tiShare != null ? o.tiShare : (cfg.ti_share != null ? cfg.ti_share : 0.18);
    var otherDebts = parseNum(o.monthlyDebts);
    var monthlyIncome = annual / 12;
    if (annual <= 0 || rate <= 0) {
      return { annualIncome: annual, monthlyIncome: monthlyIncome, dti: dti, maxPITI: 0, maxPI: 0, maxLoan: 0 };
    }
    var maxPITI = Math.max(0, monthlyIncome * dti - otherDebts);
    var maxPI = maxPITI * (1 - tiShare);
    var r = rate / 100 / 12, n = term * 12;
    var maxLoan = r > 0 ? (maxPI * (1 - Math.pow(1 + r, -n)) / r) : (maxPI * n);
    return {
      annualIncome: annual, monthlyIncome: monthlyIncome, dti: dti, tiShare: tiShare,
      maxPITI: maxPITI, maxPI: maxPI, maxLoan: Math.max(0, Math.round(maxLoan))
    };
  }

  /* ---------- formatting / parsing ---------- */
  function fmtCurrency(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    return "$" + n.toLocaleString("en-US");
  }
  function parseNum(v) {
    if (typeof v === "number") return v;
    return Number(String(v == null ? "" : v).replace(/[^0-9.]/g, "")) || 0;
  }
  function occShort(occ) {
    occ = occ || "";
    if (/investment/i.test(occ)) return "Investment";
    if (/second/i.test(occ)) return "Second home";
    return "Primary";
  }
  function isRefi(s) { return /refinance|cash-out/i.test(s.intent || s.mode || ""); }

  /* ---------- core loan amount (purchase OR refi) ---------- */
  function estimatedLoan(s) {
    if (isRefi(s) || s.mode === "refi") {
      return Math.max(0, (parseNum(s.balance) + parseNum(s.cashout)));
    }
    var price = parseNum(s.price);
    var down = s.down != null ? parseNum(s.down) : Math.round(price * (parseNum(s.downPct) / 100));
    return Math.max(0, price - down);
  }

  /* ---------- primary path by loan amount vs configured limits ---------- */
  function primaryPath(loan) {
    var cfg = MARKET_CONFIG;
    var base = cfg.baselineConformingLimit;
    var county = cfg.highBalanceLimit;
    if (!county) return { label: "High-Balance / Jumbo — licensed review needed", missing: true };
    if (loan <= base) return { label: "Conforming Review" };
    if (loan <= county) return { label: "High-Balance Conforming Review" };
    return { label: "Jumbo Review" };
  }

  /* Hero quick-check badge (5 friendly paths). */
  function heroPath(loan, occ) {
    if (occ === "Investment") return "Investor / DSCR Review";
    if (occ === "Second home") return "Second Home Review";
    return primaryPath(loan).label;
  }

  /* Meter position across Conforming → High-Balance → Jumbo. */
  function meter(loan) {
    var cfg = MARKET_CONFIG;
    var base = cfg.baselineConformingLimit;
    var county = cfg.highBalanceLimit || base;
    var max = county * 1.55;
    var pct = Math.max(2, Math.min(100, (loan / max) * 100));
    var zone = loan <= base ? "conforming" : (loan <= county ? "high-balance" : "jumbo");
    return { pct: pct, zone: zone, tick1: Math.min(98, (base / max) * 100), tick2: Math.min(99, (county / max) * 100) };
  }

  function heroInsight(loan, occ) {
    var county = MARKET_CONFIG.highBalanceLimit;
    if (occ === "Investment") return "Changing occupancy to investment may change the review path (for example, DSCR).";
    if (county && loan > county) return "A higher down payment may move the scenario from jumbo review into high-balance review.";
    if (occ === "Second home") return "Second-home purchases may have different down payment, reserve, and pricing considerations.";
    return "Condos, insurance, reserves, and income type can affect the final program.";
  }

  /* ---------- full review-path set with overlays + notes ---------- */
  function reviewPaths(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var occ = occShort(s.occupancy);
    var inc = s.income_situation || "";
    var con = s.main_concern || "";
    var pt = s.property_type || "";
    var paths = [], notes = [];
    var add = function (p) { if (p && paths.indexOf(p) < 0) paths.push(p); };
    var note = function (n) { if (n && notes.indexOf(n) < 0) notes.push(n); };

    var pp = primaryPath(loan);
    add(pp.label);
    if (pp.missing) note("County high-balance limit is not configured — a licensed review is needed to confirm the path.");

    if (occ === "Second home") {
      add("Second Home Review");
      if (county && loan > county) add("Possible Jumbo / High-Balance Review");
    }
    if (occ === "Investment") {
      add("Investor Review"); add("DSCR Review"); add("Conventional Investment Review");
    }
    if (/self-?employed|business owner|mixed/i.test(inc)) {
      add("Self-Employed Review"); add("Bank Statement Review");
    }
    if (/dscr/i.test(con)) add("DSCR / Rental-Income Review");
    if (/va/i.test(con)) {
      add("VA Review");
      note("VA scenarios depend on service eligibility, entitlement, occupancy, lender approval, and property review.");
    }
    if (/fha/i.test(con)) {
      if (occ === "Primary") add("FHA High-Cost Review");
      else note("FHA is generally reviewed for primary residence scenarios only. Licensed review required.");
    }
    if (/condo/i.test(pt)) {
      add("Condo Review");
      note("Condo eligibility, HOA, insurance, reserves, and project review may affect final options.");
    }
    if (/2.?4 unit|2–4/i.test(pt)) {
      add("2–4 Unit Review");
      note("2–4 unit scenarios require licensed review because loan limits and eligibility may differ by unit count and program.");
    }
    if (county && loan > county * 1.5) {
      add("Jumbo / Portfolio Review"); add("Potential Private Banking Review");
    }
    if (isRefi(s)) {
      note("This does not include financed closing costs, prepaid items, mortgage insurance, VA funding fee, FHA upfront MIP, or other costs that may affect the final loan amount.");
    }
    return { primary: pp.label, paths: paths, notes: notes };
  }

  function suggested(s) {
    var r = reviewPaths(s);
    return r.paths.length ? r.paths : ["Licensed Mortgage Review"];
  }

  /* ---------- scenario complexity (NOT an approval score) ---------- */
  function complexity(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var score = 0;
    if (county && loan > county) score += 2;
    if (/condo/i.test(s.property_type || "")) score += 1;
    if (/2.?4 unit|2–4/i.test(s.property_type || "")) score += 2;
    if (/self-?employed|business owner|mixed|investor|rental/i.test(s.income_situation || "")) score += 1;
    if (/investment/i.test(s.occupancy || "")) score += 1;
    if (/second home/i.test(s.occupancy || "")) score += 1;
    if (isRefi(s)) score += 1;
    if (/va|fha/i.test(s.main_concern || "")) score += 1;
    var label = score <= 1 ? "Simple Review" : score <= 3 ? "Standard Review" : score <= 5 ? "Advanced Review" : "Complex Review";
    return { score: score, label: label };
  }

  /* ---------- "Before Jumbo" what-if (math illustration only) ---------- */
  function whatIf(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var base = cfg.baselineConformingLimit;
    var price = parseNum(s.price);
    var curDown = (isRefi(s) || s.mode === "refi") ? parseNum(s.equity) : parseNum(s.down);
    if (county && loan > county && price > 0) {
      var extra = loan - county;
      var target = curDown + extra;
      var pct = (target / price) * 100;
      return { state: "over", extra: extra, target: target, pct: pct };
    }
    if (county && loan <= county && loan > base) return { state: "highbalance" };
    if (loan <= base) return { state: "baseline" };
    return { state: "unknown" };
  }

  /* ---------- dynamic micro-insights (return the 1–3 most relevant) ---------- */
  function insights(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var occ = occShort(s.occupancy);
    var out = [];
    if (county && loan > county && !(isRefi(s))) out.push("A higher down payment may move the scenario from jumbo review into high-balance review.");
    if (/self-?employed|business owner|mixed/i.test(s.income_situation || "")) out.push("Self-employed income may require additional documentation or alternative income review.");
    if (/condo/i.test(s.property_type || "")) out.push("Condos may require project, HOA, insurance, and reserve review.");
    if (/2.?4 unit|2–4/i.test(s.property_type || "")) out.push("2–4 unit loan limits and program rules may differ and need licensed review.");
    if (occ === "Investment") out.push("Changing occupancy from primary to investment may change the review path.");
    if (occ === "Second home") out.push("Second-home and investment properties may have different down payment, reserve, and pricing considerations.");
    if (/va/i.test(s.main_concern || "")) out.push("VA review is different from conventional conforming review and depends on VA eligibility and entitlement.");
    if (/fha/i.test(s.main_concern || "")) out.push("FHA review is usually tied to primary residence use and program-specific limits.");
    if (!out.length) out.push("Condos, insurance, reserves, and income type can affect the final program.");
    return out.slice(0, 3);
  }

  /* ---------- attention items (show only the relevant 1–5) ---------- */
  function attentionItems(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var occ = occShort(s.occupancy);
    var out = [];
    if (county && loan > county) out.push("Loan amount may need jumbo comparison.");
    if (!isRefi(s) && county && loan > cfg.baselineConformingLimit) out.push("Down payment may affect whether high-balance review is possible.");
    if (/condo/i.test(s.property_type || "")) out.push("Condo project review may matter.");
    if (s.property_type) out.push("Insurance and flood requirements may affect the final file.");
    if (/self-?employed|business owner|mixed/i.test(s.income_situation || "")) out.push("Self-employed income may require additional documentation review.");
    if (occ === "Investment") out.push("Investment occupancy may require investor or DSCR review.");
    if (occ === "Second home") out.push("Second-home rules may differ from primary residence rules.");
    if (/2.?4 unit|2–4/i.test(s.property_type || "")) out.push("2–4 unit scenarios may have different loan limits and program requirements.");
    return out.slice(0, 5);
  }

  /* ---------- lead intent + tags (for routing; no PII) ---------- */
  function leadIntent(s) {
    if (/yes/i.test(s.under_contract || "")) return "Under Contract";
    if (/soon/i.test(s.preapproval || "")) return "Urgent Review";
    var t = s.timeline || "";
    if (/offer soon/i.test(t)) return "Making Offer Soon";
    if (/0.?3 months|0–3/i.test(t)) return "Planning";
    if (/3.?6|6.?12/i.test(t)) return "Planning";
    if (/researching/i.test(t)) return "Browsing";
    return "Planning";
  }
  function leadTags(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.highBalanceLimit;
    var occ = occShort(s.occupancy);
    var inc = s.income_situation || "", con = s.main_concern || "";
    var tags = [];
    var pp = primaryPath(loan).label;
    if (/high-balance/i.test(pp)) tags.push("high_balance_review");
    if (county && loan > county) tags.push("jumbo_comparison");
    if (/self-?employed|business owner|mixed/i.test(inc)) { tags.push("self_employed"); tags.push("bank_statement"); }
    if (occ === "Investment" || /dscr/i.test(con) || /investor|rental/i.test(inc)) { tags.push("dscr"); tags.push("investor"); }
    if (occ === "Second home") tags.push("second_home");
    if (/condo/i.test(s.property_type || "")) tags.push("condo_review");
    if (/va/i.test(con) || /yes/i.test(s.veteran || "")) tags.push("va_review");
    if (/fha/i.test(con)) tags.push("fha_review");
    if (/yes/i.test(s.realtor || "")) tags.push("realtor_involved");
    var intent = leadIntent(s);
    if (intent === "Under Contract" || intent === "Urgent Review" || intent === "Making Offer Soon") tags.push("urgent");
    return tags.filter(function (t, i, a) { return a.indexOf(t) === i; });
  }

  /* ---------- rate assumption selection (by path/program) ---------- */
  function rateFor(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = MARKET_CONFIG.highBalanceLimit;
    var base = MARKET_CONFIG.baselineConformingLimit;
    var con = s.main_concern || "";
    var st = s.scenario_type || "";
    var occ = occShort(s.occupancy || "");
    var io = /interest[ _-]?only/i.test(s.payment_mode || "") || s.interest_only === true;
    var r;
    if (/va/i.test(con)) r = { rate: rateAssumption("va", RATE_CONFIG.va30), label: "VA 30-yr assumption", key: "va" };
    else if (/fha/i.test(con)) r = { rate: rateAssumption("fha", RATE_CONFIG.fha30), label: "FHA 30-yr assumption", key: "fha" };
    else if (occ === "Investment" || st === "investment") {
      r = io ? { rate: rateAssumption("interest_only_jumbo", 7.10), label: "Interest-only investment assumption", key: "interest_only_jumbo" }
             : { rate: rateAssumption("dscr", 7.49), label: "DSCR / investment assumption", key: "dscr" };
    } else if (county && loan > county) {
      r = io ? { rate: rateAssumption("interest_only_jumbo", 7.10), label: "Interest-only jumbo assumption", key: "interest_only_jumbo" }
             : { rate: rateAssumption("jumbo", RATE_CONFIG.jumbo30), label: "Jumbo 30-yr assumption", key: "jumbo" };
    } else if (occ === "Second home" || st === "second_home") r = { rate: rateAssumption("second_home", 6.99), label: "Second-home assumption", key: "second_home" };
    else if (base != null && county && loan > base && loan <= county) r = { rate: rateAssumption("high_balance", 6.66), label: "High-balance assumption", key: "high_balance" };
    else r = { rate: rateAssumption("conforming", RATE_CONFIG.conforming30), label: "Conforming 30-yr assumption", key: "conforming" };
    // Apply the credit-score and income-doc-type rate add-ons (educational).
    r.baseRate = r.rate;
    r.scoreAdj = 0; r.scoreTier = null;
    if (s.creditScore != null && s.creditScore !== "") {
      r.scoreAdj = scoreRateAdjust(s.creditScore);
      r.scoreTier = scoreTier(s.creditScore);
    }
    r.docAdj = 0; r.docLabel = null; r.nonqm = false;
    if (s.docType) {
      var di = docTypeInfo(s.docType);
      r.docAdj = di.add; r.docLabel = di.label; r.nonqm = !!di.nonqm;
      if (di.nonqm) { r.key = "bank-statement"; r.label = di.label + " — Non-QM pricing"; }
    }
    r.rate = Math.round((r.baseRate + r.scoreAdj + r.docAdj) * 1000) / 1000;
    return r;
  }

  /* ---------- payment estimator (deterministic amortization) ---------- */
  function monthlyPI(loan, ratePct, termYears) {
    loan = Number(loan) || 0; termYears = Number(termYears) || 30;
    var r = (Number(ratePct) || 0) / 100 / 12, n = termYears * 12;
    if (loan <= 0) return 0;
    if (r === 0) return loan / n;
    return loan * r / (1 - Math.pow(1 + r, -n));
  }
  /* ---------- Interest-only payment illustration (Phase 4) ---------- */
  var IO_NOTE = "Interest-only options vary by lender, loan purpose, occupancy, property type, borrower profile, and market. This is an educational payment illustration only.";
  function interestOnly(loan, ratePct) {
    loan = Number(loan) || 0;
    var r = (Number(ratePct) || 0) / 100 / 12;
    return loan > 0 ? loan * r : 0;
  }
  /* Returns the amortizing P&I, the interest-only payment, and the difference. */
  function paymentPreview(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var ra = rateFor(s);
    var rate = (s.rate != null && s.rate !== "") ? parseNum(s.rate) : ra.rate;
    var term = s.term ? parseNum(s.term) : 30;
    var pi = monthlyPI(loan, rate, term);
    var io = interestOnly(loan, rate);
    return {
      loan: loan, rate: rate, term: term, rateLabel: ra.label, rateKey: ra.key,
      pi: pi, interestOnly: io, difference: Math.max(0, pi - io), note: IO_NOTE
    };
  }

  /* Buydown safe-language note (the deterministic buydown math lives below). */
  var BUYDOWN_NOTE = "Buydown options may not be available for every borrower, loan purpose, occupancy, property, lender, or market. This is an educational illustration only, not a rate quote, APR, loan estimate, approval, or commitment to lend.";

  function paymentBreakdown(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var ra = rateFor(s);
    var rate = (s.rate != null && s.rate !== "") ? parseNum(s.rate) : ra.rate;
    var term = s.term ? parseNum(s.term) : 30;
    var pi = monthlyPI(loan, rate, term);
    var tax = parseNum(s.taxAnnual) / 12;
    var hoi = parseNum(s.homeownersAnnual) / 12;
    var flood = parseNum(s.floodAnnual) / 12;
    var hoa = parseNum(s.hoaMonthly);
    var miOther = parseNum(s.miMonthly) + parseNum(s.otherMonthly);
    var extrasEntered = (tax + hoi + flood + hoa + miOther) > 0;
    var total = pi + tax + hoi + flood + hoa + miOther;
    return {
      rate: rate, rateLabel: ra.label, term: term, pi: pi,
      tax: tax, hoi: hoi, flood: flood, hoa: hoa, miOther: miOther,
      total: total, extrasEntered: extrasEntered,
      segments: [
        { key: "pi", label: "Principal & Interest", amt: pi },
        { key: "tax", label: "Property Taxes", amt: tax },
        { key: "hoi", label: "Homeowners / Wind", amt: hoi },
        { key: "flood", label: "Flood Insurance", amt: flood },
        { key: "hoa", label: "HOA", amt: hoa },
        { key: "other", label: "Mortgage Insurance / Other", amt: miOther }
      ]
    };
  }
  function dscr(s) {
    var rent = parseNum(s.monthlyRent), pb = paymentBreakdown(s), pitia = pb.total;
    if (rent <= 0 || pitia <= 0) return { has: false, pitia: pitia };
    return { has: true, rent: rent, pitia: pitia, ratio: rent / pitia };
  }

  /* ---------- Rate Buydown — math illustrations only (deterministic) ---------- */
  function permanentBuydown(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var term = s.term ? parseNum(s.term) : 30;
    var curRate = (s.bdCurrentRate != null && s.bdCurrentRate !== "") ? parseNum(s.bdCurrentRate) : rateFor(s).rate;
    var bdRate = (s.bdBuydownRate != null && s.bdBuydownRate !== "") ? parseNum(s.bdBuydownRate) : Math.max(0, curRate - 0.5);
    var points = (s.bdPoints != null && s.bdPoints !== "") ? parseNum(s.bdPoints) : 1.5;
    var piCur = monthlyPI(loan, curRate, term);
    var piBd = monthlyPI(loan, bdRate, term);
    var monthlySavings = piCur - piBd;
    var cost = loan * points / 100;
    var beMonths = monthlySavings > 0 ? cost / monthlySavings : null;
    return {
      loan: loan, term: term, curRate: curRate, bdRate: bdRate, points: points, cost: cost,
      piCur: piCur, piBd: piBd, monthlySavings: monthlySavings,
      breakEvenMonths: beMonths, breakEvenYears: beMonths != null ? beMonths / 12 : null
    };
  }
  function temporaryBuydown(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var term = s.term ? parseNum(s.term) : 30;
    var note = (s.bdNoteRate != null && s.bdNoteRate !== "") ? parseNum(s.bdNoteRate) : rateFor(s).rate;
    var type = s.bdTempType || "2-1";
    var y1, y2;
    if (type === "1-0") { y1 = note - 1; y2 = note; }
    else if (type === "custom") { y1 = (s.bdY1Rate !== "" && s.bdY1Rate != null) ? parseNum(s.bdY1Rate) : note - 2; y2 = (s.bdY2Rate !== "" && s.bdY2Rate != null) ? parseNum(s.bdY2Rate) : note - 1; }
    else { y1 = note - 2; y2 = note - 1; } // 2-1
    y1 = Math.max(0, y1); y2 = Math.max(0, y2);
    var piNote = monthlyPI(loan, note, term), piY1 = monthlyPI(loan, y1, term), piY2 = monthlyPI(loan, y2, term);
    var subsidy = (piNote - piY1) * 12 + (type === "1-0" ? 0 : (piNote - piY2) * 12);
    return {
      type: type, loan: loan, term: term, note: note, y1: y1, y2: y2,
      piNote: piNote, piY1: piY1, piY2: piY2,
      y1Savings: piNote - piY1, y2Savings: type === "1-0" ? 0 : (piNote - piY2),
      subsidy: subsidy, fundingSource: s.bdFunding || ""
    };
  }
  function buydownInsight(s) {
    var pb = permanentBuydown(s), tb = temporaryBuydown(s), hold = s.bdHoldYears ? parseNum(s.bdHoldYears) : 5;
    var out = [];
    if (pb.monthlySavings > 0 && pb.breakEvenMonths != null) {
      var t = "At the current assumptions, the permanent buydown costs approximately " + fmtCurrency(pb.cost) +
        " and reduces estimated P&I by " + fmtCurrency(pb.monthlySavings) + " per month. The math break-even is approximately " +
        Math.round(pb.breakEvenMonths) + " months (" + pb.breakEvenYears.toFixed(1) + " years). ";
      t += (hold * 12 < pb.breakEvenMonths)
        ? "If you expect to refinance or sell in about " + hold + " years, the buydown may take longer to recover."
        : "If you expect to keep the loan about " + hold + " years, the buydown may recover before your time horizon.";
      out.push(t);
    } else {
      out.push("At the current assumptions, the buydown rate is not lower than the current rate, so there is no monthly savings to recover. Adjust the assumptions to compare.");
    }
    out.push("The temporary " + tb.type + " buydown lowers the estimated payment in the early years, but the note-rate payment begins after the buydown period. Final availability depends on program guidelines and an eligible funding source (seller, builder, or lender credit).");
    return out;
  }

  /* ---------- rule-based "smart" explanation (no AI, no invented numbers) ---------- */
  function explain(s) {
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var cfg = MARKET_CONFIG, county = cfg.highBalanceLimit, base = cfg.baselineConformingLimit;
    var occ = occShort(s.occupancy), r = reviewPaths(s);
    var p1 = "Your estimated loan amount is " + fmtCurrency(loan) + " on a " + fmtCurrency(parseNum(s.price)) +
      " " + ((isRefi(s) || s.mode === "refi") ? "refinance" : "purchase") + ". The current review path is " + r.primary + ".";
    var p2;
    if (county && loan > county) {
      p2 = "Your estimated loan amount is above the configured " + cfg.countyName + " high-balance reference range, so the scenario may need a jumbo comparison. Increasing down payment or adjusting purchase price may change the review path.";
    } else if (county && loan > base) {
      p2 = "Your estimated loan amount is within the configured high-balance reference range, so a high-balance conforming review may fit. Adjusting down payment can move the scenario.";
    } else {
      p2 = "Your estimated loan amount is within the baseline conforming reference range. Final review still depends on full guidelines.";
    }
    var extras = [];
    if (occ === "Investment") extras.push("because this is marked as an investment property, the scenario may also need investor or DSCR review");
    if (occ === "Second home") extras.push("second-home rules may differ from primary residence rules");
    if (/self-?employed|business owner|mixed/i.test(s.income_situation || "")) extras.push("self-employed income may need alternative documentation review");
    if (/condo/i.test(s.property_type || "")) extras.push("condo project, HOA, insurance, and reserves may matter");
    if (/2.?4 unit|2–4/i.test(s.property_type || "")) extras.push("2–4 unit limits and program rules may differ");
    if (extras.length) p2 += " Also, " + extras.join("; ") + ".";
    var p3 = "Final review should include income documentation, property type, insurance, flood, HOA, reserves, and current lender guidelines. A licensed mortgage professional can confirm which options may fit.";
    return [p1, p2, p3];
  }

  /* ---------- structured strategy object (single source for UI + form) ---------- */
  function strategySummary(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var refi = isRefi(s) || s.mode === "refi";
    var r = reviewPaths(s);
    var secondary = r.paths.filter(function (p) { return p !== r.primary; });
    return {
      market: cfg.marketName,
      marketSlug: cfg.marketSlug || ACTIVE_SLUG,
      county: cfg.countyName,
      state: cfg.state,
      domain: BRAND_CONFIG.domain,
      year: cfg.year,
      baselineConformingLimit: cfg.baselineConformingLimit,
      highBalanceLimit: cfg.highBalanceLimit,
      purchasePurpose: s.intent || "",
      propertyLocation: s.property_location || "",
      mode: refi ? "refinance" : "purchase",
      purchasePrice: parseNum(s.price),
      downPaymentAmount: refi ? parseNum(s.equity) : parseNum(s.down),
      downPaymentPercent: refi ? null : parseNum(s.downPct),
      currentLoanBalance: refi ? parseNum(s.balance) : null,
      cashOut: refi ? parseNum(s.cashout) : null,
      estimatedLoanAmount: loan,
      occupancy: s.occupancy || "",
      propertyType: s.property_type || "",
      incomeSituation: s.income_situation || "",
      mainConcern: s.main_concern || "",
      primaryReviewPath: r.primary,
      secondaryReviewPaths: secondary,
      complexityLevel: complexity(s).label,
      keyInsights: insights(s),
      attentionItems: attentionItems(s),
      whatIfBeforeJumbo: whatIf(s),
      rateAssumption: rateFor(s),
      payment: paymentBreakdown(s),
      dscr: dscr(s),
      explanation: explain(s),
      buydownPermanent: permanentBuydown(s),
      buydownTemporary: temporaryBuydown(s),
      buydownHoldYears: s.bdHoldYears ? parseNum(s.bdHoldYears) : 5,
      leadIntentLevel: leadIntent(s),
      leadTags: leadTags(s),
      complianceNote: "Educational scenario only. Not a loan approval, rate quote, underwriting decision, or commitment to lend."
    };
  }

  /* ---------- clean, human-readable email body ---------- */
  function summaryText(s) {
    var cfg = MARKET_CONFIG;
    var o = strategySummary(s);
    var L = [];
    L.push(BRAND_CONFIG.brandName + " — Before Jumbo Strategy Studio Lead");
    L.push("");
    L.push("Lead Source:");
    L.push("  " + BRAND_CONFIG.leadSource);
    L.push("");
    L.push("Market:");
    L.push("  " + o.market + " [" + o.marketSlug + "] (" + cfg.state + ", " + o.year + " reference)");
    L.push("  Configured limits: baseline " + fmtCurrency(o.baselineConformingLimit) + " / high-balance " + fmtCurrency(o.highBalanceLimit));
    L.push("  Domain: " + o.domain);
    L.push("");
    L.push("Property location & loan-limit reference:");
    var loc = LAST_LOCATION;
    var u = (loc && loc.units) || cfg.units || 1;
    L.push("  Location: " + ((loc && loc.county) || cfg.countyName || "—") + ", " + ((loc && loc.state) || cfg.state || "—"));
    L.push("  Units: " + u + (u === 1 ? " unit" : " units"));
    if (loc && loc.countyConformingLimit != null) {
      L.push("  County conforming/high-balance reference (" + u + "-unit): " + fmtCurrency(loc.countyConformingLimit) +
        (loc.highCost ? " (high-cost)" : "") + " — configured reference only, verify before launch");
    }
    if (loc && loc.fhaLimit != null) {
      L.push("  FHA reference (" + u + "-unit): " + fmtCurrency(loc.fhaLimit) + " — configured reference only, verify before launch");
    }
    if (loc && loc.source) L.push("  Source: " + loc.source + (loc.verifiedAt ? " (verified " + loc.verifiedAt + ")" : ""));
    L.push("");
    L.push("Scenario:");
    if (o.purchasePurpose) L.push("  Goal: " + o.purchasePurpose);
    if (o.propertyLocation) L.push("  Location: " + o.propertyLocation);
    if (o.mode === "refinance") {
      L.push("  Estimated value: " + fmtCurrency(o.purchasePrice));
      L.push("  Current loan balance: " + fmtCurrency(o.currentLoanBalance));
      L.push("  Desired cash-out: " + fmtCurrency(o.cashOut));
    } else {
      L.push("  Purchase price: " + fmtCurrency(o.purchasePrice));
      L.push("  Down payment: " + fmtCurrency(o.downPaymentAmount) + " / " + (o.downPaymentPercent || 0).toFixed(0) + "%");
    }
    L.push("  Estimated loan amount: " + fmtCurrency(o.estimatedLoanAmount));
    if (o.occupancy) L.push("  Occupancy: " + o.occupancy);
    if (o.propertyType) L.push("  Property type: " + o.propertyType);
    if (o.incomeSituation) L.push("  Income situation: " + o.incomeSituation);
    if (o.mainConcern) L.push("  Main concern: " + o.mainConcern);
    L.push("");
    L.push("Primary review path:");
    L.push("  " + o.primaryReviewPath);
    if (o.secondaryReviewPaths.length) {
      L.push("");
      L.push("Secondary review paths:");
      o.secondaryReviewPaths.forEach(function (p) { L.push("  " + p); });
    }
    if (o.attentionItems.length) {
      L.push("");
      L.push("Attention items:");
      o.attentionItems.forEach(function (a) { L.push("  - " + a); });
    }
    L.push("");
    L.push("What-if before jumbo:");
    if (o.whatIfBeforeJumbo.state === "over") {
      L.push("  ~" + fmtCurrency(o.whatIfBeforeJumbo.extra) + " additional down payment could bring the estimated loan amount to the configured " + o.county + " high-balance reference limit (target down ~" + o.whatIfBeforeJumbo.pct.toFixed(0) + "%). Math illustration only.");
    } else if (o.whatIfBeforeJumbo.state === "highbalance") {
      L.push("  Estimated loan amount appears within configured high-balance reference range.");
    } else if (o.whatIfBeforeJumbo.state === "baseline") {
      L.push("  Estimated loan amount appears within baseline conforming reference range.");
    } else {
      L.push("  Pending — adjust scenario.");
    }
    L.push("");
    L.push("Rate assumptions (NOT a quote):");
    L.push("  Assumption used: " + o.payment.rateLabel + " — " + o.payment.rate + "% / " + o.payment.term + " yr");
    L.push("  Rate assumptions last updated: " + RATE_CONFIG.lastUpdated);
    L.push("");
    L.push("Payment assumptions (estimates only):");
    L.push("  Estimated P&I: " + fmtCurrency(o.payment.pi) + "/mo");
    L.push("  Property taxes: " + fmtCurrency(o.payment.tax) + "/mo");
    L.push("  Homeowners / wind: " + fmtCurrency(o.payment.hoi) + "/mo");
    L.push("  Flood: " + fmtCurrency(o.payment.flood) + "/mo");
    L.push("  HOA: " + fmtCurrency(o.payment.hoa) + "/mo");
    L.push("  Mortgage insurance / other: " + fmtCurrency(o.payment.miOther) + "/mo");
    L.push("  Estimated monthly housing cost (PITIA): " + fmtCurrency(o.payment.total) + "/mo");
    if (o.dscr.has) {
      L.push("");
      L.push("DSCR math illustration:");
      L.push("  Estimated monthly rent: " + fmtCurrency(o.dscr.rent));
      L.push("  Estimated monthly housing cost: " + fmtCurrency(o.dscr.pitia));
      L.push("  DSCR: " + o.dscr.ratio.toFixed(2) + "x (lender DSCR requirements vary by program, property, credit, reserves, and guidelines)");
    }
    var bp = o.buydownPermanent, bt = o.buydownTemporary;
    L.push("");
    L.push("Rate Buydown Illustration (NOT a quote):");
    L.push("  Current rate assumption: " + bp.curRate + "%");
    L.push("  Permanent buydown rate: " + bp.bdRate + "% at " + bp.points + " pts (" + fmtCurrency(bp.cost) + ")");
    L.push("  Est. P&I before buydown: " + fmtCurrency(bp.piCur) + "/mo");
    L.push("  Est. P&I after buydown: " + fmtCurrency(bp.piBd) + "/mo");
    L.push("  Est. monthly savings: " + fmtCurrency(bp.monthlySavings) + "/mo");
    L.push("  Break-even: " + (bp.breakEvenMonths != null ? (Math.round(bp.breakEvenMonths) + " months (" + bp.breakEvenYears.toFixed(1) + " yrs)") : "n/a at these assumptions"));
    L.push("  Expected hold period: " + o.buydownHoldYears + " years");
    L.push("  Temporary buydown option: " + bt.type + " — est. subsidy " + fmtCurrency(bt.subsidy) + (bt.fundingSource ? " (funding: " + bt.fundingSource + ")" : ""));
    L.push("  Note: Rate buydown figures are educational math illustrations only and are not rate quotes, APRs, locked terms, approvals, or commitments to lend.");
    L.push("");
    L.push("Scenario complexity: " + o.complexityLevel);
    L.push("Lead intent: " + o.leadIntentLevel);
    L.push("Lead tags: " + (o.leadTags.join(", ") || "—"));
    L.push("");
    L.push("Contact:");
    L.push("  Name: " + (s.name || ""));
    L.push("  Email: " + (s.email || ""));
    L.push("  Phone: " + (s.phone || ""));
    L.push("  Preferred contact: " + (s.preferred_contact_method || ""));
    if (s.message) { L.push("  Notes: " + s.message); }
    L.push("");
    L.push("Compliance:");
    L.push("  " + o.complianceNote);
    return L.join("\n");
  }

  global.MARKETS = MARKETS;
  global.MARKET_CONFIG = MARKET_CONFIG;
  global.BRAND_CONFIG = BRAND_CONFIG;
  global.FORM_CONFIG = FORM_CONFIG;
  global.RATE_CONFIG = RATE_CONFIG;
  global.KW = {
    markets: MARKETS,
    form: FORM_CONFIG,
    activeSlug: function () { return ACTIVE_SLUG; },
    setMarket: setMarket,
    applyLocation: applyLocation,
    locationPreset: locationPreset,
    lastLocation: null,
    COMPLIANCE_REF: COMPLIANCE_REF,
    config: MARKET_CONFIG,
    brand: BRAND_CONFIG,
    rates: RATE_CONFIG,
    rateFor: rateFor,
    rateAssumption: rateAssumption,
    scoreRateAdjust: scoreRateAdjust,
    scoreTier: scoreTier,
    monthlyMI: monthlyMI,
    docTypeAdjust: docTypeAdjust,
    docTypeInfo: docTypeInfo,
    qualifyingLoan: qualifyingLoan,
    rateConfigLabel: function () { return (global.BJLRates && global.BJLRates.label) || RATE_CONFIG.sourceLabel; },
    monthlyPI: monthlyPI,
    interestOnly: interestOnly,
    paymentPreview: paymentPreview,
    IO_NOTE: IO_NOTE,
    BUYDOWN_NOTE: BUYDOWN_NOTE,
    paymentBreakdown: paymentBreakdown,
    dscr: dscr,
    explain: explain,
    permanentBuydown: permanentBuydown,
    temporaryBuydown: temporaryBuydown,
    buydownInsight: buydownInsight,
    fmtCurrency: fmtCurrency,
    parseNum: parseNum,
    occShort: occShort,
    isRefi: isRefi,
    estimatedLoan: estimatedLoan,
    primaryPath: primaryPath,
    heroPath: heroPath,
    meter: meter,
    heroInsight: heroInsight,
    reviewPaths: reviewPaths,
    suggested: suggested,
    complexity: complexity,
    whatIf: whatIf,
    insights: insights,
    attentionItems: attentionItems,
    leadIntent: leadIntent,
    leadTags: leadTags,
    strategySummary: strategySummary,
    summaryText: summaryText
  };
})(typeof window !== "undefined" ? window : globalThis);

/* Node export for QA harness (ignored in browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).KW;
}
