# BeforeJumboLoan.com — Mortgage Strategy Engine

A premium, interactive mortgage **strategy engine** — not a generic mortgage
website. Buyers and investors model a real scenario and watch the math react:
the payment stack, the *before-jumbo gap*, DSCR, and rate buydowns, all in their
local market.

This is a **clean, standalone project**. It does not touch, import, or reuse
KWestMortgages.com, CaliforniaMTG.com, or any other site in the parent repo.

---

## Phase 1 — what's built

| Capability | Where |
|---|---|
| Landing page (config-driven copy, live engine preview) | `src/index.html`, `src/js/landing.js` |
| Market selector (per-county conforming/high-balance limits) | `src/js/marketSelector.js`, `src/config/markets.js` |
| Strategy Studio (reactive workspace) | `src/studio.html`, `src/js/studio.js` |
| Payment stack (P&I, taxes, insurance, HOA, MI) | `src/js/engine/paymentStack.js` |
| DSCR math (ratio, tiers, qualification) | `src/js/engine/dscr.js` |
| Rate buydown math (permanent points + 2-1 / 3-2-1) | `src/js/engine/buydown.js` |
| Before-jumbo gap (tier + dollars to stay conforming) | `src/js/engine/jumboGap.js` |
| Engine aggregator → one structured snapshot | `src/js/engine/index.js` |
| Clean lead submission (client + serverless) | `src/js/leadSubmission.js`, `netlify/functions/submit-lead.js` |
| Config-driven architecture | `src/config/*` |
| AI seam (prepared, **inert**) | `src/js/ai/explainer.js`, `netlify/functions/explain-strategy.js` |

No build step. No framework. Native ES modules — readable, debuggable, fast.

---

## Architecture at a glance

```
Config  (src/config/*)        defaults · markets · products · copy
   │  injected into
   ▼
Engine  (src/js/engine/*)     pure functions → ONE structured snapshot
   │  consumed by
   ├─► UI        (studio.js / landing.js)   renders the snapshot
   ├─► Leads     (leadSubmission.js)         attaches snapshot to the lead
   └─► AI seam   (ai/explainer.js)           Phase 2 reads snapshot.aiContext
```

**The core idea:** every input change calls `runStrategy(scenario, ctx)` which
returns a single deterministic `snapshot`. The UI, the lead payload, and the
future AI explainer all consume that same object. Add a market or a strategy by
editing config — not code.

See `ARCHITECTURE.md` for the full contract and the `aiContext` shape.

---

## Run it locally

Static site — any static server works. From this folder (`beforejumboloan/`):

```bash
# Option A — quick static preview (no serverless functions)
npm run serve            # serves src/ at http://localhost:8080

# Option B — full local stack WITH Netlify Functions (lead submission)
npx netlify-cli dev      # serves src/ + functions at http://localhost:8888
# or, if you have the CLI installed globally:  netlify dev
```

Run the math test suite:

```bash
npm test                 # node --test → tests/engine.test.mjs (11 tests)
```

> With `npm run serve` the lead form will report that the endpoint isn't
> configured locally — that's expected; the static server has no functions.
> Use `netlify dev` to exercise `submit-lead`.

---

## Deploy to Netlify

Deploy this folder as **its own Netlify site** (independent of the other sites
in the repo).

1. **New site** → connect this Git repo.
2. **Base directory:** `beforejumboloan`
3. **Publish directory:** `src` (set automatically by `netlify.toml`)
4. **Functions directory:** `netlify/functions` (set automatically)
5. **Build command:** none required (static).
6. **Environment variables** (optional, for lead routing):
   - `LEAD_WEBHOOK_URL` — POST each lead JSON to your CRM/Zapier/Slack webhook.
   - `LEAD_NOTIFY_EMAIL` — informational in Phase 1.
7. Deploy. Add the custom domain `BeforeJumboLoan.com`.

`netlify.toml` in this folder already pins publish/functions dirs, a `/studio`
redirect, and baseline security headers.

CLI alternative:

```bash
cd beforejumboloan
npx netlify-cli deploy --build --prod
```

---

## Ready for Phase 2 — AI Strategy Explainer

The seam is in place and intentionally **off**:

- The engine already emits `snapshot.aiContext` — a compact, model-friendly set
  of facts (strategy, market, loan amount, LTV, jumbo tier, DSCR ratio, buydown
  break-even). No prose, no formatting — ready to hand to a model.
- `src/js/ai/explainer.js` defines the stable `explainStrategy(snapshot, opts)`
  contract and returns a placeholder while `DEFAULTS.ai.enabled === false`.
- `netlify/functions/explain-strategy.js` is routed and returns `501` until
  Phase 2 — it already accepts the snapshot contract.
- The Studio renders a visible **"AI Strategy Explainer — Phase 2"** panel fed
  by the placeholder, so the UI slot exists.

**To turn it on in Phase 2:** implement the model call in the function (secrets
via env, e.g. `ANTHROPIC_API_KEY`), flip `DEFAULTS.ai.enabled` to `true`, and
set `explainStrategy`'s live branch. No engine or UI rebuild required.

---

## Compliance note

All figures are illustrative estimates for educational purposes — not a loan
commitment, pre-approval, or offer to lend. Pricing assumptions (rates, point
costs, MI, tax rates, county limits) live in `src/config/` and must be reviewed
and updated by a licensed professional before production use. Add the correct
NMLS ID in `src/config/defaults.js`.
```
