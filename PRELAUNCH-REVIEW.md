# Pegasus — Live Pre-Launch Review (v70)

Preview-first. **Not deployed. Production not touched.** This phase = visual polish +
backend-readiness + launch docs. Full feature map: see `MIGRATION-MAP.md`.

## 1. Changed files (this phase)
- `css/pegasus.css` — soft light panels (`.panel`/`.soft-stat`/`.soft-inset`/`.soft-note`), Live Capital Session block, Ambassador cards, premium profile classes (`.prof-hero`/`.role-badge`/`.verify-chip`/`.ring`/`.prof-module`)
- `index.html` — Capital Pipeline card softened to a light institutional panel; **Live Capital Session** block + **Featured Network Participants / Ambassadors** section added
- `js/pegasus-pages.js` — `profileBody()` rebuilt to a premium institutional layout
- `public-profile.html`, `profile.html`, `lender-profile.html`, `rwa-partner-profile.html`, `business-funding-provider-profile.html` — enriched with featured badge, completion ring, headline, credentials, capital appetite, active Deal Rooms

## 2. New files
- `supabase/004_academy_growth_featured.sql` — speakers, sessions, session_registrations (tier-gated), founder_submissions, investor_appetite_profiles, growth deal-room tag, profiles featured/ambassador columns, `score_growth()`, `email_outbox` + `queue_email()` hook, seed session + speaker
- `PRELAUNCH-REVIEW.md` (this file)
- (carried from prior phases) `js/pegasus-forms.js`, `MIGRATION-MAP.md`, `ARCHITECTURE.md`, brand asset package, `site.webmanifest`

## 3. Supabase tables required
**Run in order:** `membership-schema.sql` (001) → `002_platform_schema.sql` → `003_seed.sql` → `004_academy_growth_featured.sql`
- **Reused from v68 production:** profiles, memberships, contact_submissions, rwa_project_intakes, investor_interest_submissions, badge_proof_submissions, business_funding_requests, business_funding_provider_profiles, capital_scenarios, webinar_library, webinar_registrations, lender_profiles, deal_submissions, messages, ai_assistant_chats, ai_assistant_messages
- **New (v69):** plan_entitlements, deal_rooms, deal_room_participants/documents/activity, lender_interest, ai_usage, match_requests, lender_appetite_profiles, financing_requests, match_results, notifications
- **New (v70):** speakers, sessions, session_registrations, founder_submissions, investor_appetite_profiles, email_outbox; profiles.{featured,featured_kind,credibility_line}; deal_rooms.kind
- ⚠ **Do NOT run 002's `message_threads/messages/message_reads` over the live DB** — `messages` collides with v68's flat table (see MIGRATION-MAP plan #2).

## 4. Environment variables required
**Netlify:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and Stripe price IDs — checkout reads **either** `STRIPE_PRICE_{STARTER,PRO,GOLD}_{MONTHLY,ANNUAL}` **or** the v68 names `STRIPE_{STARTER,PROFESSIONAL,GOLD}_{MONTHLY,ANNUAL}`.
**Supabase Edge secret:** `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`).
**Client (`js/pegasus-config.js`):** SUPABASE_URL + publishable key (already set).

## 5. Stripe webhook setup
1. Endpoint: `https://<site>/.netlify/functions/stripe-webhook`
2. Events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`
3. Signing secret → Netlify `STRIPE_WEBHOOK_SECRET`
4. Webhook upserts `memberships` (plan→tier, status, stripe_subscription_id, current_period_end) by `user_id` from metadata. Stripe is the source of truth; Supabase mirrors; client only displays.

## 6. Live-ready ✅ (works once SQL is run + env vars set + deployed)
- Supabase Auth: signup / signin / logout / callback / session persistence / protected routes / role + admin detection
- Stripe: checkout (trial, monthly/annual, Starter/Pro/Gold, customer reuse), billing portal, webhook → membership sync, state banners (trial/active/past_due/canceled)
- Entitlements: tier limits via `plan_entitlements` + SQL functions; Deal Room / Match Engine / AI gating
- Dashboard: real profile, tier, deal rooms, notifications (when authed)
- Deal Rooms: create, view, 9-state workflow, lender interest, activity + participant notifications (triggers)
- Match Engine: financing request → `run_match` scores + persists `match_results` + notifies; client+server scoring identical
- AI Assistant: invokes real `pegasus-ai-assistant` edge fn; tier usage limits; history saved by edge fn
- Forms (real tables): contact, RWA intake, investor interest, badge proof, business funding
- Visual system: light institutional canvas, premium profiles, homepage polish, full brand/logo system, favicon/app icons

## 7. Still placeholder / demo (clearly marked)
- **Deal Room document upload** — UI present; needs Supabase Storage bucket `deal-docs` + upload wire
- **Academy/Live Sessions UI** — schema + seed ready; `capital-sessions.html`/`webinars.html` not yet bound to `sessions`/`session_registrations` (reserve-seat flow). `getPublishedWebinars`/`submitWebinarRegistration` functions are ready.
- **Capital Strategy Simulator save** — `submitCapitalScenario` ready; page "Save" button not yet wired
- **Growth Capital UI** — schema (founder_submissions, investor_appetite, growth deal rooms, `score_growth`) ready; founder-intake page + admin review queue not yet built
- **Admin live binding** — admin.html renders tabs but most are not bound to live queries
- **Email sending** — `email_outbox` + `queue_email()` hook ready; an actual provider function (Edge `send-email` / Resend / SendGrid) must consume the outbox
- **Nav AI concierge widget** (`nav-assistant.js`) — not yet ported into v69
- **Messaging** — flat `messages` table reads/writes via `PegForms`; threaded Deal Room comments UI not wired
- **Demo fallback** is ON (`PEG_CONFIG.ALLOW_DEMO_FALLBACK=true`) so preview renders without a backend; set false to hard-gate after live verification

## 8. Final QA checklist (run in preview)
**Auth:** [ ] signup [ ] signin [ ] logout [ ] protected redirect (with ALLOW_DEMO_FALLBACK=false)
**Stripe:** [ ] checkout button per tier/cycle [ ] portal button [ ] tier status card [ ] trial banner [ ] past_due banner
**Profiles:** [ ] public profile loads (premium layout) [ ] edit profile saves [ ] featured/ambassador badge shows [ ] completion ring
**Deal Rooms:** [ ] Starter blocked [ ] Pro limited to 2 [ ] Gold unlimited [ ] create works [ ] detail + workflow advance
**Match Engine:** [ ] scoring runs [ ] result saves (run_match) [ ] tier gating [ ] labels: High Alignment / Strong Fit / Conditional Fit / Manual Review
**Academy:** [ ] (pending) session page + reserve flow + tier display
**Admin:** [ ] non-admin redirect [ ] (pending) live review queues
**Mobile:** [ ] homepage [ ] dashboard [ ] profile [ ] Deal Room [ ] Match Engine [ ] Academy
