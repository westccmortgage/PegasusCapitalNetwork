# Resource Routing Architecture

How WCCI turns a conversation into safe, contextual resource recommendations —
without ever letting the language model invent a URL, fee, or licensing fact.

## Pipeline (per user turn, in `src/App.jsx` → `sendMessage`)

```
user message
  │
  ├─▶ parser (parseScenario) ─────────────▶ Loan Strategy Profile (facts)
  │
  ├─▶ conversationIntelligence
  │      updateStateFromUserMessage(state, text, profile, lang)   [deterministic]
  │      → MortgageConversationState (stage, trust, objections,
  │        consent, audience, geo, topics, competitor, readiness)
  │
  ├─▶ resource-router.routeResources(ctx)   [DETERMINISTIC — runs before the LLM]
  │      → 0–5 candidate {id, score, reasonKey}
  │
  ├─▶ buildIntelContext(state, candidates)  → prompt block listing ONLY those ids
  ├─▶ buildEstimatesContext(profile)        → app-computed numbers + assumptions
  │
  ├─▶ Claude (netlify/functions/chat.js)    → prose + CONVO_META + PROFILE_UPDATE
  │
  ├─▶ extractMarker(CONVO_META)             [balanced-brace, string-aware]
  │      meta.resources ⊆ candidate ids
  │      → validateRecommendations(recs, {audience, allowedIds})
  │           reject: unknown id · unverified · audience mismatch ·
  │                   not in candidate set · excluded URL   (cap 3, dedup)
  │      → resource cards resolved to canonical URLs
  │      → applyStatePatch(meta.state)  (consent can only be *declined* here)
  │
  └─▶ render <ResourceCard/> under the message + in the sidebar block
```

Two layers of safety, both required:

1. **Router (allow-list generator).** Only resources whose gates pass for THIS
   context become candidates. Geo-gated local brands (K West, Bel Air, Lunada)
   need a real city/county match; specialty resources need their explicit topic;
   trust pages need a trust concern; secure application needs readiness + a
   supported state. A hard exclusion or audience mismatch overrides every score.

2. **Validator (render gate).** Even a candidate is re-checked at render:
   `verified === true`, audience allowed (incl. `neverAutoRouteFor`), id ∈
   `allowedIds` (the model can't reach outside the candidate set), URL passes
   `isUrlAllowed` (https, not an excluded domain, not admin/login/preview/staging),
   deduped, capped at 3. The model emits **ids only** — never URLs — so a
   hallucinated link is not a link; it's inert text that also gets stripped.

## Scoring order (matches the mission's routing priority)

`routeResources` scores each surviving resource by, in order: safety/eligibility
gates → trust/privacy concern → geography (city > county > state, single-state
specialist bonus) → loan topic overlap → borrower-type/specialty category →
conversation stage → tone preference → handoff readiness, plus registry priority
as a tiebreaker. Generic-education pages are trimmed when ≥2 signal-bearing
candidates exist, and at most 2 per domain are kept. Output ≤ 5 candidates; the
model picks ≤ 3.

## Structured model output (Phase 7)

The model appends one machine line per reply:

```
CONVO_META:{"resources":[{"id":"suncoast-about","reason":"…"}],
            "state":{"stage":"trust_building","objections":["identity","privacy"],
                     "contactConsent":"declined"},
            "handoff":"none"}
```

`extractMarker()` scans balanced braces (respecting quoted strings), so nested
`state:{…}` / `resources:[{…}]` parse correctly and the marker is fully removed
from the visible bubble even when the JSON is malformed. The same extractor
handles `PROFILE_UPDATE` and `SCENARIO_COMPLETE`. Regression-tested in
`test/output-parsing.test.mjs`.

## What the model can and cannot do

| Can | Cannot |
|---|---|
| Explain a resource in chat | Emit or invent a URL/domain |
| Pick ids from the provided candidate list | Introduce a resource not routed this turn |
| Record `contactConsent: "declined"` | Set `contactConsent: "granted"` (app-only, on form submit) |
| Refine stage/trust/objections | Override a sticky decline |
| Voice app-computed estimates | Invent a fee, rate, or lender product |

## Analytics (privacy-safe, `src/lib/analytics.js`)

Events (`trust_objection_detected`, `resource_recommended/impression/clicked`,
`contact_offer_shown`, `contact_declined`, `human_review_requested`,
`handoff_submitted`, `broken_resource_detected`) fire to Plausible with an
allow-listed property set only (resourceId, category, state/county, stage,
language, reasonKey). Name, email, phone, address, chat text, and file names are
never sent — a key-allowlist drops everything else.
