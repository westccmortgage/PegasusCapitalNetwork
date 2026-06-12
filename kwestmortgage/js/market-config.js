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

  var MARKET_CONFIG = {
    marketName: "Key West / Monroe County",
    countyName: "Monroe County",
    state: "FL",
    year: 2026,
    baselineConformingLimitOneUnit: 832750,
    countyConformingLimitOneUnit: 990150,
    countyConformingLimitTwoUnit: null,
    countyConformingLimitThreeUnit: null,
    countyConformingLimitFourUnit: null,
    fhaLimitOneUnit: null,
    lastVerifiedDate: "VERIFY BEFORE LAUNCH",
    sourceNote: "Loan limits must be verified annually using FHFA / Fannie Mae / HUD sources before public launch."
  };

  var BRAND_CONFIG = {
    brandName: "K West Mortgage",
    studioFormName: "key-west-strategy-studio",
    simpleFormName: "key-west-scenario-review",
    leadSource: "KWest Before Jumbo Strategy Studio",
    recipient: "info@kwestmortgages.com" // configured in Netlify notifications
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
    var base = cfg.baselineConformingLimitOneUnit;
    var county = cfg.countyConformingLimitOneUnit;
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
    var base = cfg.baselineConformingLimitOneUnit;
    var county = cfg.countyConformingLimitOneUnit || base;
    var max = county * 1.55;
    var pct = Math.max(2, Math.min(100, (loan / max) * 100));
    var zone = loan <= base ? "conforming" : (loan <= county ? "high-balance" : "jumbo");
    return { pct: pct, zone: zone, tick1: Math.min(98, (base / max) * 100), tick2: Math.min(99, (county / max) * 100) };
  }

  function heroInsight(loan, occ) {
    var county = MARKET_CONFIG.countyConformingLimitOneUnit;
    if (occ === "Investment") return "Changing occupancy to investment may change the review path (for example, DSCR).";
    if (county && loan > county) return "A higher down payment may move the scenario from jumbo review into high-balance review.";
    if (occ === "Second home") return "Second-home purchases may have different down payment, reserve, and pricing considerations.";
    return "Condos, insurance, reserves, and income type can affect the final program.";
  }

  /* ---------- full review-path set with overlays + notes ---------- */
  function reviewPaths(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.countyConformingLimitOneUnit;
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
    var county = cfg.countyConformingLimitOneUnit;
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
    var county = cfg.countyConformingLimitOneUnit;
    var base = cfg.baselineConformingLimitOneUnit;
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
    var county = cfg.countyConformingLimitOneUnit;
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

  /* ---------- text summary (for copy + form) ---------- */
  function summaryText(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var refi = isRefi(s) || s.mode === "refi";
    var cx = complexity(s);
    var L = [];
    L.push(BRAND_CONFIG.brandName + " — Before Jumbo Strategy Studio");
    L.push("Scenario summary");
    L.push("");
    if (s.intent) L.push("Goal: " + s.intent);
    L.push("Market: " + cfg.marketName + " (" + cfg.state + ", " + cfg.year + " reference)");
    if (s.property_location) L.push("Location: " + s.property_location);
    if (refi) {
      L.push("Estimated property value: " + fmtCurrency(s.price));
      L.push("Current loan balance: " + fmtCurrency(s.balance));
      L.push("Desired cash-out: " + fmtCurrency(s.cashout));
    } else {
      L.push("Purchase price / value: " + fmtCurrency(s.price));
      L.push("Down payment / equity: " + fmtCurrency(s.down) + " (" + (parseNum(s.downPct)).toFixed(0) + "%)");
    }
    L.push("Estimated loan amount: " + fmtCurrency(loan));
    if (s.occupancy) L.push("Occupancy: " + s.occupancy);
    if (s.property_type) L.push("Property type: " + s.property_type);
    if (s.income_situation) L.push("Income situation: " + s.income_situation);
    if (s.main_concern) L.push("Main concern: " + s.main_concern);
    L.push("Scenario complexity: " + cx.label);
    L.push("Suggested review paths: " + suggested(s).join(", "));
    var wi = whatIf(s);
    if (wi.state === "over") {
      L.push("Before-jumbo illustration: ~" + fmtCurrency(wi.extra) + " additional down payment could bring the estimated loan amount to the configured " + cfg.countyName + " high-balance reference limit (target down ~" + wi.pct.toFixed(0) + "%). Math illustration only.");
    }
    L.push("");
    L.push("Educational only — not a loan approval, rate quote, underwriting decision, or commitment to lend.");
    return L.join("\n");
  }

  global.MARKET_CONFIG = MARKET_CONFIG;
  global.BRAND_CONFIG = BRAND_CONFIG;
  global.KW = {
    config: MARKET_CONFIG,
    brand: BRAND_CONFIG,
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
    summaryText: summaryText
  };
})(typeof window !== "undefined" ? window : globalThis);

/* Node export for QA harness (ignored in browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).KW;
}
