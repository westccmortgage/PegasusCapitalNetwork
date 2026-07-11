# Pegasus Network — v69 Platform Rebuild

**"The operating system for structured real estate capital."**

A clean, platform-first rebuild — one unified design system, JS-injected shell
(identical nav/sidebar/cards/typography on every page), and a real Match Engine.

## Run / preview
Static site — preview-ready for Netlify as-is.
- **Local:** `npx serve .` (or any static server) and open `/index.html`.
- **Netlify:** drag this folder in, or `netlify deploy`. `netlify.toml` sets
  `publish="."` and bundles the functions in `netlify/functions`.

### Preview modes (no backend needed)
Every app page defaults to a **demo Gold session** so it renders immediately.
Override via query string:
- `?tier=starter` · `?tier=pro` · `?tier=gold`
- `&status=trialing` · `&status=past_due` · `&status=canceled`

e.g. `/dashboard.html?tier=starter` shows the locked-Deal-Rooms state;
`/deal-rooms.html?tier=pro` shows the 2-room cap; `/membership.html?status=past_due`
shows the failed-payment banner.

## Structure
- `css/pegasus.css` — the entire design system (tokens, shell, components).
- `js/pegasus-core.js` — shell injection, session, nav, footer, modal, toast.
- `js/pegasus-entitlements.js` — tier limits (mirror of server RLS).
- `js/pegasus-billing.js` — membership/usage cards, plans, subscription states.
- `js/pegasus-match.js` — Match Engine scoring + demo lender appetites.
- `js/pegasus-data.js` — demo seed data (replaced by Supabase in prod).
- `netlify/functions/*` — Stripe checkout, portal, webhook (tier source of truth).
- `supabase/membership-schema.sql` — tables, RLS, entitlement functions.

## Going to production
1. Run `supabase/membership-schema.sql` in Supabase.
2. Set Netlify env vars (Stripe keys, price IDs, `SUPABASE_SERVICE_ROLE_KEY`).
3. In `pegasus-core.js`, replace `loadSession()` (demo) with Supabase auth +
   a read of `subscriptions`/`plan_entitlements`. Everything else already keys
   off `Pegasus.session`, so the UI needs no further changes.
4. Point auth pages at `supabase.auth` (signin/signup/callback are wired for it).

Tier naming is canonical `starter|pro|gold` throughout (DB, UI, Stripe metadata).

---

## Full site rebuild (v69.1)
The entire public + member site is now rebuilt in the unified design system —
**59 pages** total, all sharing one `css/pegasus.css` and the JS shell.

**Content pages** carry the real copy from the prior site (extracted into
`js/pegasus-content.js`) rendered through reusable templates in
`js/pegasus-pages.js` (hero, feature grid, steps, FAQ, legal, directory,
profile, form). The full-site mega-nav and footer live in `pegasus-core.js`.

Page groups:
- **Platform/app:** index, dashboard, deal-rooms, deal-room, match-engine, membership, admin
- **Auth:** signin, signup, auth-callback, reset-password
- **Marketing/info (22):** about, how-it-works, borrowers, mortgage-brokers, real-estate-agents, insurance-agents, agent-partnership, business-capital-funding, capital-academy, education, rwa-network, rwa-education, rwa-tokenization, rwa-events-network, partner-media-kit, network-badge, investor-interest, ai-advisor, ai-assistant, capital-sessions, webinars, rwa-readiness-check
- **Legal:** terms, privacy, disclosures, trust-and-safety
- **FAQ:** faq
- **Directories:** lender-directory, business-funding-providers, rwa-partners
- **Profiles:** profile, public-profile, lender-profile, rwa-partner-profile, business-funding-provider-profile
- **Forms/intake:** submit-deal, business-funding-request, rwa-project-intake, badge-proof-submit, contact, profile-edit
- **Tools (app shell):** deal-feed, deal-analyzer, lead-finder, capital-strategy-simulator, messages, rwa-project-workspace, saved-scenario

The deal-analyzer and capital-strategy-simulator have live, working math.

---

## v69.2 — Systems Integration
The platform now runs on shared systems (see ARCHITECTURE.md): one Supabase
client, one global store (`PegStore`), one data-access layer (`PegAPI`), real
auth (`PegAuth`), and a role/tier/onboarding-aware shell. The dashboard, deal
rooms, deal-room detail, match engine, membership, admin, and profile editor
all `boot()` from the store and read/write through the API — live when
authenticated, seeded-demo otherwise. SQL: 001 (membership) + 002 (platform:
9-state workflow, matching, notifications, messaging) + 003 (seed).

## Private: Capital Intelligence (admins)
Internal CRE acquisition/debt/lender research OS at `/admin/intelligence`
(Palm Beach County retail, $4–7M focus). Daily XLSX import with preview/
commit/rollback, confidence-guarded history, private document storage,
deterministic capital matching. Docs: `docs/CAPITAL-INTELLIGENCE.md` ·
`docs/CAPITAL-INTELLIGENCE-IMPORT.md`. Migrations 067–070. QA:
`npm run qa:intelligence`.
