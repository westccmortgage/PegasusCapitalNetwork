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

  /* ---------- attention items (show only the relevant 1–5) ---------- */
  function attentionItems(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var county = cfg.countyConformingLimitOneUnit;
    var occ = occShort(s.occupancy);
    var out = [];
    if (county && loan > county) out.push("Loan amount may need jumbo comparison.");
    if (!isRefi(s) && county && loan > cfg.baselineConformingLimitOneUnit) out.push("Down payment may affect whether high-balance review is possible.");
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
    var county = cfg.countyConformingLimitOneUnit;
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

  /* ---------- structured strategy object (single source for UI + form) ---------- */
  function strategySummary(s) {
    var cfg = MARKET_CONFIG;
    var loan = s.loan != null ? s.loan : estimatedLoan(s);
    var refi = isRefi(s) || s.mode === "refi";
    var r = reviewPaths(s);
    var secondary = r.paths.filter(function (p) { return p !== r.primary; });
    return {
      market: cfg.marketName,
      county: cfg.countyName,
      year: cfg.year,
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
    L.push("  " + o.market + " (" + cfg.state + ", " + o.year + " reference)");
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
