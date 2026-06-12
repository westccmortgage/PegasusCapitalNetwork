# Architecture — BeforeJumboLoan

## Principles

1. **Config-driven.** Numbers and content that a non-developer might change live
   in `src/config/`. The engine never hard-codes a limit, rate, tier, or price.
2. **Pure engine.** Everything in `src/js/engine/` and `src/js/lib/` is a pure
   function: no DOM, no network, deterministic. This is why it's unit-testable
   in Node and reusable anywhere.
3. **One snapshot.** `runStrategy(scenario, ctx)` returns a single structured
   object. The UI, the lead payload, and the (future) AI explainer all consume
   that same object. Add features by extending the snapshot, not by threading
   new values through call sites.
4. **No build step.** Native ES modules in the browser. What you read is what
   ships.

## Layers

```
src/config/        defaults.js · markets.js · products.js · copy.js
src/js/lib/        finance.js (amortization) · format.js (Intl display)
src/js/engine/     paymentStack · jumboGap · dscr · buydown · index (aggregator)
src/js/            studio.js · landing.js · marketSelector.js · leadSubmission.js
src/js/ai/         explainer.js  (Phase 2 seam, inert)
netlify/functions/ submit-lead.js (live) · explain-strategy.js (Phase 2, 501)
```

## The snapshot contract

`runStrategy(scenario, { defaults, market, product })` →

```js
{
  meta:         { generatedAt, product, market, schemaVersion },
  inputs:       { homePrice, downPaymentPct, downPayment, loanAmount,
                  termYears, baseRate, effectiveRate, propertyTaxRatePct,
                  homeInsuranceAnnual, hoaMonthly, grossMonthlyRent },
  paymentStack: { pi, taxes, insurance, hoa, mi, total, ltv, miApplies, components[] },
  jumboGap:     { tier, tierLabel, gapToConforming, gapToHighBalance, headroom,
                  additionalDownToStayConforming, additionalDownToAvoidJumbo, isJumbo, ... },
  dscr:         null | { ratio, qualifies, tier, monthlyCashflow, rentNeededToQualify, ... },
  buydown:      null | { permanent{...}, temporary{ schedule[], totalSubsidy }, structureLabel },
  aiContext:    { strategy, market, homePrice, loanAmount, downPaymentPct, monthlyPayment,
                  ltv, jumboTier, additionalDownToStayConforming, dscrRatio, dscrQualifies,
                  buydownBreakevenMonths }   // <-- Phase 2 AI input
}
```

`schemaVersion` lets the AI prompt and any stored leads evolve safely.

## Adding things without touching code

- **A market:** copy a block in `src/config/markets.js`, set the county limits
  and tax/insurance defaults. It appears in the selector automatically.
- **A strategy lens:** add an entry to `src/config/products.js` and a tab in
  `studio.html`. Wire its engine branch in `engine/index.js` only if it needs
  new math.
- **Pricing assumptions:** edit `src/config/defaults.js` (rates, point cost,
  rate reduction per point, DSCR tiers, PMI, conforming limits).
- **Copy/brand voice:** edit `src/config/copy.js`.

## Phase 2 AI seam

The only files that change to enable AI:

- `netlify/functions/explain-strategy.js` — implement the model call (env
  secrets), return the explanation. Currently returns `501`.
- `src/js/ai/explainer.js` — the live branch is stubbed and commented; the
  contract (`explainStrategy(snapshot, opts)`) is already stable.
- `src/config/defaults.js` — flip `ai.enabled` to `true`.

The Studio already renders the explainer panel and calls `explainStrategy` on
every recompute, so once enabled the narration appears with no UI work.
