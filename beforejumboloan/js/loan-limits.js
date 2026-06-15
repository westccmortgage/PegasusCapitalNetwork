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
  var DB = { conforming: null, fha: null, geo: null, places: null, zips: null, aliases: null, loaded: false };

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
      datasetType: conf ? (conf.dataset_type || null) : null,
      needsVerification: false,
      sourceMeta: conf ? {
        dataset_type: conf.dataset_type || null,
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

    if (!input.county_fips && (!input.state || !input.county)) {
      out.countyConformingLimit = baseline != null ? baseline : null;
      out.warning = "Enter a property location (ZIP, city, or county) to resolve the county loan-limit reference.";
      return out;
    }

    var rec = (conf.counties || []).find(function (c) {
      if (input.county_fips) return String(c.county_fips) === String(input.county_fips);
      return normState(c.state_abbr) === normState(input.state) &&
        normCounty(c.county_name) === normCounty(input.county);
    });

    if (!rec) {
      // County not in the dataset: keep the scenario usable on the national
      // baseline, but flag it loudly — never silently treat baseline as the
      // county's verified limit.
      out.countyConformingLimit = baseline != null ? baseline : null;
      out.needsVerification = true;
      out.warning =
        "“" + (input.county || input.county_fips || "") + (input.state ? ", " + normState(input.state) : "") +
        "” is not in the loan-limit dataset yet — county line needs official verification. Import the official full FHFA data to calculate it.";
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
      out.needsVerification = true;
      out.warning =
        rec.county_name + " " + UNIT_KEY[units] +
        "-unit limit isn’t imported yet — needs official verification. Using the national baseline only.";
    }

    // FHA (optional)
    if (db.fha && Array.isArray(db.fha.counties)) {
      var f = db.fha.counties.find(function (c) {
        if (input.county_fips) return String(c.county_fips) === String(input.county_fips);
        return normState(c.state_abbr) === normState(input.state) &&
          normCounty(c.county_name) === normCounty(input.county);
      });
      if (f && f["fha_" + UNIT_KEY[units] + "_unit"] != null) {
        out.fhaLimit = f["fha_" + UNIT_KEY[units] + "_unit"];
      }
    }

    // BUG FIX: only label high-cost/high-balance when the resolved county limit
    // is strictly ABOVE the national baseline for these units. If the limit
    // equals baseline (incl. the multi-unit fallback), it is "baseline".
    out.highCost = (out.countyConformingLimit != null && baseline != null && out.countyConformingLimit > baseline);
    out.highBalance = out.highCost;
    out.tier = out.highCost ? "high-cost" : "baseline";
    return out;
  }

  /* ---- Property-location intelligence ---- */
  var STATE_ABBRS = {};
  ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR","GU","VI","AS","MP"].forEach(function (a) { STATE_ABBRS[a] = true; });

  function normName(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }
  function baseCounty(n) { return normName(n).replace(/ (county|parish|borough|census area|municipality|city|municipio)$/, ""); }
  function stateName(abbr) {
    var st = (DB.geo && DB.geo.states) || [];
    for (var i = 0; i < st.length; i++) if (st[i].abbr === abbr) return st[i].name;
    return null;
  }
  function buildCountyIndex(db) {
    var idx = [], seen = {};
    function add(sa, sn, cn, fp) {
      var key = sa + "|" + fp; if (!fp || seen[key]) return; seen[key] = true;
      idx.push({ state_abbr: sa, state_name: sn || stateName(sa), county_name: cn, county_fips: fp });
    }
    ((db.conforming && db.conforming.counties) || []).forEach(function (c) { add(c.state_abbr, c.state_name, c.county_name, c.county_fips); });
    ((db.places && db.places.places) || []).forEach(function (p) { if (p.type === "county") add(p.state_abbr, p.state_name, p.county_name, p.county_fips); });
    var gc = (db.geo && db.geo.counties) || {};
    Object.keys(gc).forEach(function (sa) { gc[sa].forEach(function (c) { add(sa, stateName(sa), c.name, c.fips); }); });
    return idx;
  }

  /* resolvePropertyLocation(query, db) — deterministic.
     Accepts ZIP / city / county / "city, ST" / "county, ST" / alias.
     Returns matched_by, confidence, possible_matches, needs_confirmation,
     a warning when ambiguous/unresolved, and source metadata. Never throws. */
  function resolvePropertyLocation(query, db) {
    db = db || DB;
    var raw = String(query == null ? "" : query).trim();
    var q = normName(raw);
    var out = {
      query: raw, matched_by: null, confidence: "none",
      state_name: null, state_abbr: null, county_name: null, county_fips: null,
      possible_matches: [], needs_confirmation: true, warning: null,
      source: {
        coverage: (db.places && db.places.coverage) || (db.zips && db.zips.coverage) || "partial-seed",
        places: (db.places && db.places.source_name) || null,
        zips: (db.zips && db.zips.source_name) || null
      }
    };
    if (!q) { out.warning = "Enter a ZIP, city, county, or property location."; return out; }

    function mk(rec, by) {
      return {
        state_abbr: rec.state_abbr, state_name: rec.state_name || stateName(rec.state_abbr),
        county_name: rec.county_name, county_fips: rec.county_fips, matched_by: by,
        label: rec.city ? (rec.city + ", " + rec.state_abbr + " — " + rec.county_name + ", " + rec.state_abbr)
          : (rec.county_name + ", " + rec.state_abbr)
      };
    }
    function finalize(matches, by) {
      out.possible_matches = matches;
      if (matches.length === 1) {
        var m = matches[0];
        out.matched_by = by; out.confidence = "high";
        out.state_abbr = m.state_abbr; out.state_name = m.state_name;
        out.county_name = m.county_name; out.county_fips = m.county_fips;
        out.needs_confirmation = true; // always confirm the property county
      } else if (matches.length > 1) {
        out.matched_by = by; out.confidence = "ambiguous"; out.needs_confirmation = true;
        out.warning = "Multiple locations match — confirm the property county.";
      }
      return out;
    }

    // 1) ZIP — only when an OFFICIAL ZCTA→county file is imported. The seed
    //    must never pretend ZIP intelligence works (no defaulting to a county).
    if (/^\d{5}$/.test(q)) {
      var zipsOfficial = db.zips && (db.zips.coverage === "official" || db.zips.official === true);
      if (!zipsOfficial) {
        out.matched_by = "zip"; out.confidence = "none"; out.needs_confirmation = true;
        out.warning = "ZIP-to-county intelligence requires the official ZCTA/county file. Enter city + state or property county.";
        return out;
      }
      var z = db.zips.zips && db.zips.zips[q];
      if (z) return finalize([mk(z, "zip")], "zip");
      out.warning = "ZIP " + raw + " isn’t in the official ZIP set — enter city + state or property county.";
      return out;
    }

    // trailing "ST"
    var stateAbbr = null, namePart = q;
    var mst = q.match(/^(.+?)[ ,]+([a-z]{2})$/);
    if (mst && STATE_ABBRS[mst[2].toUpperCase()]) { namePart = mst[1].trim(); stateAbbr = mst[2].toUpperCase(); }

    // 2) alias
    var al = db.aliases && db.aliases.aliases && db.aliases.aliases[namePart];
    if (al && (!stateAbbr || stateAbbr === al.state_abbr)) return finalize([mk(al, "alias")], "alias");

    // 3) county
    var countyIdx = buildCountyIndex(db);
    var cm = countyIdx.filter(function (c) {
      return baseCounty(c.county_name) === baseCounty(namePart) && (!stateAbbr || c.state_abbr === stateAbbr);
    });
    if (cm.length) return finalize(cm.map(function (c) { return mk(c, "county"); }), "county");
    if (/ (county|parish|borough)$/.test(namePart)) {
      out.warning = "County “" + raw + "” isn’t in the configured data yet — enter state + county, or import the official county list.";
      return out;
    }

    // 4) city
    var places = (db.places && db.places.places) || [];
    var pm = places.filter(function (p) { return p.type === "city" && normName(p.name) === namePart && (!stateAbbr || p.state_abbr === stateAbbr); });
    if (pm.length) return finalize(pm.map(function (p) { return mk(p, "city"); }), "city");

    out.warning = "Couldn’t resolve “" + raw + "”. Enter the property’s state and county.";
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
      j("data/geo/us-counties.json", false),
      j("data/geo/us-places.json", true),
      j("data/geo/us-zips.json", true),
      j("data/geo/aliases.json", true)
    ])
      .then(function (res) {
        DB.conforming = res[0];
        DB.fha = res[1];
        DB.geo = res[2];
        DB.places = res[3];
        DB.zips = res[4];
        DB.aliases = res[5];
        DB.loaded = true;
        // Developer/admin warning — not shown to end users.
        if (DB.conforming && DB.conforming.dataset_type === "sample" && global.console && global.console.warn) {
          global.console.warn(
            "[BeforeJumboLoan] Sample loan-limit dataset installed (" +
            (DB.conforming.record_count || 0) +
            " FHFA records). Import official full FHFA/HUD files before production nationwide launch. See data/loan-limits/IMPORT.md."
          );
        }
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
    resolvePropertyLocation: resolvePropertyLocation,
    getStates: getStates,
    getCounties: getCounties,
    hasCounties: hasCounties,
    load: load,
    db: DB,
    isLoaded: function () { return DB.loaded; },
    // test/seed hook
    _setDB: function (d) {
      DB.conforming = d.conforming || null; DB.fha = d.fha || null; DB.geo = d.geo || null;
      DB.places = d.places || null; DB.zips = d.zips || null; DB.aliases = d.aliases || null; DB.loaded = true;
    }
  };

  global.BJLLimits = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  // Auto-load in the browser.
  if (global.document) load("");
})(typeof window !== "undefined" ? window : globalThis);
