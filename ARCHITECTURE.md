# Pegasus v69 — Platform Architecture (Systems Integration)

This is no longer a set of pages — it's one connected platform with shared
systems, one data model, real workflows, and a single source of truth.

## The systems layer (load order matters; set on every page)
1. **pegasus-config.js** — Supabase URL + publishable key + `ALLOW_DEMO_FALLBACK`.
2. **pegasus-supabase.js** — one Supabase client instance (`window.PegSB`); lazy-loads supabase-js from CDN.
3. **pegasus-entitlements.js** — tier limits (`PEG_TIERS`), the UX mirror of server RLS.
4. **pegasus-data.js** — seeded demo data (used only when not authenticated).
5. **pegasus-match.js** — canonical scoring (`PegasusMatch.scoreMatch`), mirrored 1:1 in SQL `score_match()`.
6. **pegasus-store.js** — `PegStore`: the **single global app state**. Holds session, profile, tier, subscription, usage, dealRooms, matches, notifications, counts. `hydrate()` pulls live from Supabase when a session exists, else seeds demo. Pub/sub via `subscribe()`.
7. **pegasus-api.js** — `PegAPI`: the **only** place DB reads/writes live. Deal rooms (create/advance/setState), financing requests (+ server `run_match`), appetites, lender interest, notifications, profile. Live or in-memory demo automatically.
8. **pegasus-auth.js** — `PegAuth`: real Supabase `signUp/signIn/signOut/getSession/requireAuth`.
9. **pegasus-core.js** — shell (`mountApp`/`mountPublic`), `boot(render)`, role/tier/onboarding-aware nav, notifications dropdown, logout. `Pegasus.session` is a **getter proxy** over the store, so every page sees the same state.
10. **pegasus-billing.js / pegasus-pages.js** — UI render modules (no state of their own).

### How a page works now
```js
Pegasus.boot(async (state) => {
  const v = Pegasus.mountApp({active:'Deal Rooms', title:'…'});
  const rooms = await PegAPI.listDealRooms();   // live or demo, same call
  // render from `state` / API — never store local copies
});
```
`boot()` hydrates the store (live if logged in), renders, and keeps state warm.
No page holds its own session/tier/usage — they all read `PegStore`.

## Data model (Supabase)
- **001_pegasus_membership.sql** — plans, subscriptions, deal_rooms, participants, documents, activity, lender_interest, ai_usage, entitlement functions, RLS.
- **002_platform_schema.sql** — profile system (markets, specialties, verification, completion, onboarding), the **9-state workflow** (`draft → submitted → reviewing → matched → docs_requested → underwriting → term_sheet → funded → closed`), `lender_appetite_profiles`, `financing_requests`, `match_results`, `notifications`, messaging (`message_threads`/`messages`/reads), the server-side `score_match()` + `run_match()`, and triggers that fire notifications on lender interest, workflow change, and new-user onboarding. Full RLS on every table.
- **003_seed.sql** — believable showcase lender appetites (render pre-signup) + plan entitlements.

### Real workflows wired
- **Deal Rooms:** create → advances through all 9 states (`PegAPI.advanceDealRoom`); workflow change → activity log + participant notifications (SQL trigger).
- **Match Engine:** borrower request scored against every active appetite (`run_match`), persists `match_results`, notifies aligned lenders (≥70). Same math client & server.
- **Notifications:** centralized table + `notify()`; unread badge in the topbar reads from the store.
- **Onboarding:** new auth user → profile row + welcome notification; completion recomputed on every profile save; banner shows until ≥70%.

## Going live (one switch)
1. Run `001`, `002`, `003` in Supabase.
2. Set Netlify env vars (Stripe keys/prices, `SUPABASE_SERVICE_ROLE_KEY`, webhook secret).
3. Deploy. On a real domain the Supabase client loads, `PegStore.hydrate()` finds the session, and every page flips from demo to live automatically — no per-page changes.
4. Optionally set `ALLOW_DEMO_FALLBACK:false` in config to hard-gate (no demo).

The preview still renders everywhere because demo fallback is on by default.
