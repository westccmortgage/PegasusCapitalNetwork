/* ============================================================
   Before Jumbo Strategy Studio — Market config + portable logic
   ------------------------------------------------------------
   PORTABILITY: swap MARKET_CONFIG / BRAND_CONFIG to reuse this
   engine for MonroeCountyMortgage.com, PalmBeachCountyMortgage.com,
   MiamiDadeMortgage.com, BeforeJumboLoan.com, etc.
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
  var DEFAULT_MARKET = "key-west";
  var LIMIT_YEAR = 2026;
  var VERIFY = "VERIFY BEFORE LAUNCH (FHFA / Fannie Mae / HUD)";
  // FHFA 2026 Conforming Loan Limit Values (effective 2026-01-01):
  //   baseline 1-unit $832,750 · high-cost ceiling 1-unit $1,249,125.
  // County values below reflect FHFA's published 2026 1-unit limits.
  var VERIFIED = "FHFA 2026 CLL — verified 2026-06-12";

  var MARKETS = {
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

  /* Rate ASSUMPTIONS — education only. Edit in ONE place. Not a rate quote. */
  var RATE_CONFIG = {
    lastUpdated: "2026-06-12",
    sourceLabel: "Public national mortgage rate averages; update before launch",
    conforming30: 6.58,
    jumbo30: 6.84,
    fha30: 6.14,
    va30: 6.16,
    note: "Rates shown are assumptions for education only. They are not rate quotes, APRs, locked rates, or commitments to lend."
  };

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
    var con = s.main_concern || "";
    if (/va/i.test(con)) return { rate: RATE_CONFIG.va30, label: "VA 30-yr assumption" };
    if (/fha/i.test(con)) return { rate: RATE_CONFIG.fha30, label: "FHA 30-yr assumption" };
    if (county && loan > county) return { rate: RATE_CONFIG.jumbo30, label: "Jumbo 30-yr assumption" };
    return { rate: RATE_CONFIG.conforming30, label: "Conforming 30-yr assumption" };
  }

  /* ---------- payment estimator (deterministic amortization) ---------- */
  function monthlyPI(loan, ratePct, termYears) {
    loan = Number(loan) || 0; termYears = Number(termYears) || 30;
    var r = (Number(ratePct) || 0) / 100 / 12, n = termYears * 12;
    if (loan <= 0) return 0;
    if (r === 0) return loan / n;
    return loan * r / (1 - Math.pow(1 + r, -n));
  }
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
    out.push("The temporary " + tb.type + " buydown lowers the estimated payment in the early years, but the note-rate payment begins after the buydown period. Final availability depends on program guidelines and an approved funding source (seller, builder, or lender credit).");
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
    monthlyPI: monthlyPI,
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
