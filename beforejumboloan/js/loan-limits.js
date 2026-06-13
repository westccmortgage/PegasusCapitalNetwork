/* ============================================================
   BeforeJumboLoan.com — National loan-limit resolver + loader
   ------------------------------------------------------------
   Deterministic. The engine/UI never hardcode limits — they call
   resolveLoanLimits() which reads the JSON dataset under /data.

   Browser: auto-fetches the dataset and fires "bjl:limits-ready".
   Node:    module.exports = API; pass an explicit `db` to the
            pure resolver for testing.
   ============================================================ */
(function (global) {
  "use strict";

  var COMPLIANCE =
    "Configured reference only — verify current FHFA/Fannie/Freddie/HUD limits before launch.";

  var UNIT_KEY = [null, "one", "two", "three", "four"];

  // In-memory dataset (populated by load()).
  var DB = { conforming: null, fha: null, geo: null, loaded: false };

  function normCounty(s) {
    return String(s == null ? "" : s)
      .trim().toLowerCase()
      .replace(/\s+county$/, "")
      .replace(/[^a-z]/g, "");
  }
  function normState(s) {
    return String(s == null ? "" : s).trim().toUpperCase();
  }
  function clampUnits(u) {
    u = parseInt(u, 10);
    if (!u || u < 1) return 1;
    return u > 4 ? 4 : u;
  }

  /* ---- Pure resolver: resolveLoanLimits({state, county, zip, units}, db) ----
     Returns the selected location, the FHFA conforming reference + county
     (high-balance) reference, an FHA reference if available, the effective
     year, a source label, the compliance line, and a warning when data is
     missing or needs verification. Never throws. */
  function resolveLoanLimits(input, db) {
    db = db || DB;
    input = input || {};
    var conf = db.conforming;
    var units = clampUnits(input.units);
    var uk = UNIT_KEY[units] + "_unit";

    var out = {
      state: input.state ? normState(input.state) : null,
      county: input.county || null,
      zip: input.zip || null,
      units: units,
      year: conf ? (conf.year || conf.effective_year) : null,
      conformingBaseline: null,
      countyConformingLimit: null,
      highCost: false,         // high-cost / high-balance area
      highBalance: false,      // alias of highCost
      specialArea: false,      // statutory special-exception area (AK/HI/GU/VI)
      fhaLimit: null,
      source: conf ? (conf.source || conf.source_name) : null,
      verifiedAt: conf ? conf.verified_at : null,
      sourceMeta: conf ? {
        source_name: conf.source_name || conf.source || null,
        source_url_or_label: conf.source_url_or_label || null,
        effective_year: conf.effective_year || conf.year || null,
        imported_at: conf.imported_at || null,
        verified_at: conf.verified_at || null,
        record_count: conf.record_count != null ? conf.record_count : (conf.counties ? conf.counties.length : null)
      } : null,
      compliance: COMPLIANCE,
      warning: null,
      found: false
    };

    if (!conf) {
      out.warning = "Loan-limit data is not loaded yet — using the route preset. Verify before use.";
      return out;
    }

    var baseline = conf.baseline ? conf.baseline[uk] : null;
    out.conformingBaseline = baseline != null ? baseline : null;

    if (!input.state || !input.county) {
      out.countyConformingLimit = baseline != null ? baseline : null;
      out.warning = "Select a state and county to resolve the county loan-limit reference.";
      return out;
    }

    var rec = (conf.counties || []).find(function (c) {
      return normState(c.state_abbr) === normState(input.state) &&
        normCounty(c.county_name) === normCounty(input.county);
    });

    if (!rec) {
      out.countyConformingLimit = baseline != null ? baseline : null;
      out.warning =
        "“" + (input.county || "") + ", " + normState(input.state) +
        "” is not in the loan-limit dataset yet — showing the national baseline. Import/verify the county limit before use.";
      return out;
    }

    out.found = true;
    out.state = rec.state_abbr;
    out.county = rec.county_name;
    out.fips = rec.county_fips || null;
    out.verifiedAt = rec.verified_at || conf.verified_at || null;
    out.source = rec.source || conf.source || conf.source_name;
    out.specialArea = !!rec.special_area;

    var cc = rec["conforming_" + UNIT_KEY[units] + "_unit"];
    if (cc != null) {
      out.countyConformingLimit = cc;
      out.highCost = !!rec.high_cost || (baseline != null && cc > baseline);
    } else {
      out.countyConformingLimit = baseline != null ? baseline : null;
      out.highCost = !!rec.high_cost;
      out.warning =
        rec.county_name + " " + UNIT_KEY[units] +
        "-unit limit isn’t imported yet — using the national baseline. Verify before use.";
    }

    // FHA (optional)
    if (db.fha && Array.isArray(db.fha.counties)) {
      var f = db.fha.counties.find(function (c) {
        return normState(c.state_abbr) === normState(input.state) &&
          normCounty(c.county_name) === normCounty(input.county);
      });
      if (f && f["fha_" + UNIT_KEY[units] + "_unit"] != null) {
        out.fhaLimit = f["fha_" + UNIT_KEY[units] + "_unit"];
      }
    }

    out.highBalance = out.highCost;
    return out;
  }

  /* ---- Geo accessors for the selector ---- */
  function getStates() {
    return (DB.geo && DB.geo.states) || [];
  }
  function getCounties(stateAbbr) {
    var m = DB.geo && DB.geo.counties;
    return (m && m[normState(stateAbbr)]) || [];
  }
  function hasCounties(stateAbbr) {
    return getCounties(stateAbbr).length > 0;
  }

  /* ---- Browser loader (no build step; plain fetch) ---- */
  function load(base) {
    base = base || "";
    function j(url, optional) {
      return fetch(base + url, { cache: "no-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error(url + " " + r.status);
          return r.json();
        })
        .catch(function (e) {
          if (optional) return null;
          throw e;
        });
    }
    return Promise.all([
      j("data/loan-limits/2026/fhfa-conforming.json", false),
      j("data/loan-limits/2026/fha-forward.json", true),
      j("data/geo/us-counties.json", false)
    ])
      .then(function (res) {
        DB.conforming = res[0];
        DB.fha = res[1];
        DB.geo = res[2];
        DB.loaded = true;
        fire("bjl:limits-ready");
        return DB;
      })
      .catch(function (err) {
        DB.loaded = false;
        if (global.console) global.console.warn("Loan-limit data failed to load:", err && err.message);
        fire("bjl:limits-error");
      });
  }

  function fire(name) {
    try {
      if (global.dispatchEvent && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent(name));
      }
    } catch (e) {}
  }

  var API = {
    COMPLIANCE: COMPLIANCE,
    resolveLoanLimits: resolveLoanLimits,
    getStates: getStates,
    getCounties: getCounties,
    hasCounties: hasCounties,
    load: load,
    db: DB,
    isLoaded: function () { return DB.loaded; },
    // test/seed hook
    _setDB: function (d) { DB.conforming = d.conforming || null; DB.fha = d.fha || null; DB.geo = d.geo || null; DB.loaded = true; }
  };

  global.BJLLimits = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  // Auto-load in the browser.
  if (global.document) load("");
})(typeof window !== "undefined" ? window : globalThis);
