# Pegasus — Functional Migration Map (v68 → v69/v70)

Reconnecting the new visual rebuild to the **real working backend** from the old site.
**Preview-first. No production deploy. No production overwrite.** Existing working
functions are reused, not faked. Missing pieces are marked and planned.

**Status legend:** ✅ working · 🔌 reconnected this session · ⚠ needs reconnect · ⛔ missing (rebuild) · 🟡 partial

**Mode model:** every reconnected feature runs LIVE when a Supabase session exists
(real tables/functions), and falls back to seeded demo in preview. One switch
(`PEG_CONFIG.ALLOW_DEMO_FALLBACK=false`) hard-gates to live once verified.

---

## Key reconciliations (old ↔ new naming)
| Concern | v68 (production) | v69 (rebuild) | Resolution |
|---|---|---|---|
| Subscription table | `memberships` (`plan IN starter/professional/gold`, `stripe_subscription_id`) | `subscriptions` (`tier` pro) | Store reads **`memberships` first**, maps `professional→pro`, falls back to `subscriptions`. 🔌 |
| Plan key | `professional` | `pro` | Boundary mapping both ways (checkout + store). 🔌 |
| Stripe env vars | `STRIPE_PROFESSIONAL_*` etc. | `STRIPE_PRICE_PRO_*` etc. | Checkout reads **both**; whichever is set wins. 🔌 |
| Checkout body | `{plan, billing}` | `{tier, cycle}` | Function accepts **both**. 🔌 |
| Lender data | `lender_profiles` (real) | `lender_appetite_profiles` (new) | Both supported: `PegForms.getLenderProfiles()` reads the real table; Match Engine uses appetite profiles. ⚠ unify later |
| Borrower deal | `deal_submissions` (flat) | `deal_rooms` + `financing_requests` (workflow) | `PegForms.submitDeal()` preserves the v68 path; Deal Rooms is the new model. Both coexist. 🟡 |
| Messaging | `messages` (flat sender/recipient) | `message_threads`/`messages`/`message_reads` (002) | ⚠ **table-name collision** on `messages`; see Broken/Missing. |

---

## 1. Supabase Auth
| Feature | Old file | New target | Frontend fn | Backend/API | Table | Stripe | Auth | Status |
|---|---|---|---|---|---|---|---|---|
| Signup | pegasus-client.js `signUp` | signup.html | `PegAuth.signUp` | Supabase Auth + `handle_new_user` trigger | profiles | – | public | 🔌 |
| Signin | pegasus-client.js `signIn` | signin.html | `PegAuth.signIn` | Supabase Auth | profiles | – | public | 🔌 |
| Logout | pegasus-client.js `signOut` | core topbar | `PegAuth.signOut` | Supabase Auth | – | – | auth | 🔌 |
| Auth callback | (n/a) | auth-callback.html | `PegAuth.getSession` | Supabase Auth | – | – | public | 🔌 |
| Session persistence | initSupabase | pegasus-supabase.js | `PegSB` (persistSession) | Supabase | – | – | – | 🔌 |
| Protected routes | requireAuth | pegasus-auth.js | `PegAuth.requireAuth` | – | – | – | auth | 🔌 |
| Role-aware nav | updateNavForAuth | pegasus-core.js | `mountApp`/store role | – | profiles.role | – | auth | 🔌 |

## 2. Stripe Billing
| Feature | Old file | New target | Frontend fn | Backend fn | Table | Stripe | Auth | Status |
|---|---|---|---|---|---|---|---|---|
| Checkout session | create-checkout-session.js | netlify/functions/create-checkout-session.js | `PegBilling.checkout` | ✅ reconciled fn | memberships | ✅ Prices | auth | 🔌 |
| Billing portal | (none in v68) | create-portal-session.js | billing.html | ✅ portal fn | – | ✅ Portal | auth | 🔌 |
| Subscription webhook | ⛔ none in v68 | stripe-webhook.js | – | ✅ webhook | memberships/subscriptions | ✅ webhook secret | service | 🔌 (new) |
| Tier sync | manual | webhook → memberships | store hydrate | webhook | memberships | ✅ | – | 🟡 verify live |
| trial/active/canceled/past_due | partial | PegBilling state banners | `PegBilling.stateBanner` | webhook writes status | memberships.status | ✅ | auth | 🟡 |

## 3. Entitlements / Gating
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Starter/Pro/Gold rules | (ad hoc) | pegasus-entitlements.js | `PEG_TIERS` | `entitlements()` SQL (001) | plan_entitlements | – | 🔌 |
| Deal Room limits | – | gating in deal-rooms.html | `Pegasus.limit('dealRooms')` | `can_create_deal_room` (001) | deal_rooms | auth | 🔌 |
| AI usage limits | – | ai-assistant.html | `Pegasus.limit('aiQueries')` | `consume_ai_query` (001) / ai_usage | ai_usage | auth | 🟡 (UI enforced; server count needs live test) |
| Match Engine access | – | match-engine.html gate | `Pegasus.limit('matchEngine')` | `has_match_engine` (001) | – | auth | 🔌 |
| Academy access by tier | ⛔ | (Academy pages) | – | – | – | auth | ⛔ rule not yet enforced |
| Growth Capital access | ⛔ | ⛔ | – | – | – | auth | ⛔ feature absent |

## 4. Dashboard
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Real user data | getCurrentProfile | dashboard.html | `PegStore` profile | hydrateLive | profiles | auth | 🔌 |
| Real subscription tier | memberships read | dashboard.html | store.tier | hydrateLive | memberships | auth | 🔌 |
| Real usage data | – | dashboard.html | store.usage | ai_usage / counts | ai_usage | auth | 🟡 |
| Real Deal Rooms | ⛔ (none) | dashboard.html | `PegAPI.listDealRooms` | hydrateLive | deal_rooms | auth | 🔌 (new model) |
| Real notifications | ⛔ | dashboard topbar | `PegAPI.listNotifications` | notifications | notifications | auth | 🔌 (new) |
| Profile status | onboarding_complete | dashboard.html | store.profile | recompute trigger (002) | profiles | auth | 🔌 |

## 5. Deal Rooms (new model; not in v68)
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Create room | ⛔ (v68 had deal_submissions only) | deal-rooms.html | `PegAPI.createDealRoom` | insert | deal_rooms | auth | 🔌 |
| View room | ⛔ | deal-room.html | `PegAPI.getDealRoom` | select | deal_rooms | auth | 🔌 |
| Participants | ⛔ | deal-room rail | (read) | trigger add_owner (001) | deal_room_participants | auth | 🟡 |
| Workflow status (9-state) | ⛔ | deal-room.html | `PegAPI.advanceDealRoom` | `on_dr_state` trigger (002) | deal_rooms | auth | 🔌 |
| Activity log | ⛔ | deal-room Activity tab | (read) | trigger writes | deal_room_activity | auth | 🟡 |
| Document upload | ⛔ | deal-room Documents tab | placeholder | Supabase Storage | deal_room_documents | auth | ⛔ storage bucket not wired |
| Lender interest | lender_profiles (browse only) | deal-room Lenders tab | `PegAPI.expressInterest` | `on_lender_interest` trigger (002) | lender_interest | auth | 🔌 |
| Comments/messages | messages (flat) | deal-room | ⚠ | message_threads (002) | message_threads | auth | ⚠ not wired to UI |

## 6. Pegasus Match Engine
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Borrower request form | submitDeal→deal_submissions | match-engine.html | `PegAPI.submitFinancingRequest` | insert + `run_match` (002) | financing_requests | auth | 🔌 |
| Lender appetite profiles | lender_profiles (real) | match-engine + lender-directory | `PegForms.getLenderProfiles` / `PegAPI.listAppetites` | select | lender_profiles / lender_appetite_profiles | auth | 🟡 two sources |
| Scoring logic | ⛔ (none) | pegasus-match.js + SQL | `PegasusMatch.scoreMatch` | `score_match()` (002, mirrors JS) | – | – | 🔌 |
| Save match result | ⛔ | match-engine.html | `run_match` | insert | match_results | auth | 🔌 |
| Trigger notifications | ⛔ | – | – | `run_match`→`notify` (002) | notifications | service | 🔌 |
| Show alignment score | ⛔ | match-engine.html | render | – | – | – | 🔌 |

## 7. AI Assistant
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| AI backend | edge `pegasus-ai-assistant` (OpenAI) | ai-assistant.html | `PegForms.aiQuery` | `functions.invoke('pegasus-ai-assistant')` | ai_assistant_chats / messages | auth-opt | 🔌 |
| Usage limits | – | ai-assistant.html | tier `aiQueries` | ai_usage | ai_usage | auth | 🟡 (UI; server count to verify) |
| Save query history | edge writes | – | – | edge fn | ai_assistant_messages | auth | ✅ (edge already does this) |
| Connect to account | edge uses auth header | `PegSB` session | invoke w/ session | edge fn | – | auth | 🔌 |
| Nav concierge widget | nav-assistant.js | ⚠ not ported | – | same edge | – | – | ⚠ floating widget not yet in v69 |

## 8. Academy / Live Sessions
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Event/webinar list | getPublishedWebinars | webinars.html / capital-sessions.html | `PegForms.getPublishedWebinars` | select | webinar_library | public | 🔌 (read wired; page render pending) |
| Reserve seat | submitWebinarRegistration | webinars.html | `PegForms.submitWebinarRegistration` | insert | webinar_registrations | public | 🔌 (fn ready; form wire pending) |
| Session access by tier | ⛔ | – | – | – | – | auth | ⛔ |
| Replay access | webinar_library.status | – | – | – | webinar_library | auth | ⚠ |
| Speaker pages | ⛔ | – | – | – | – | – | ⛔ |
| Knowledge library | capital-academy.html (static) | capital-academy.html | – | – | – | – | 🟡 static content only |
| Capital Strategy Simulator save | submitCapitalScenario/getSavedScenario | capital-strategy-simulator.html | `PegForms.submitCapitalScenario` | insert/select | capital_scenarios | public | 🔌 (fn ready; save button wire pending) |

## 9. Growth Capital
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Founder intake | ⛔ (not in v68) | ⛔ | – | – | – | – | ⛔ MISSING — rebuild |
| Investor appetite | investor_interest_submissions (interest only) | investor-interest.html | `PegForms.submitInvestorInterest` | insert | investor_interest_submissions | public | 🔌 (closest existing) |
| Venture deal rooms | ⛔ | (reuse Deal Rooms) | – | – | deal_rooms | auth | ⛔ |
| Growth matching | ⛔ | (reuse Match Engine) | – | – | – | auth | ⛔ |
| Admin review | ⛔ | admin.html | – | – | – | admin | ⛔ |
> Growth Capital is a **net-new module** — v68 had no founder/venture pipeline. See implementation plan below.

## 10. Admin
| Feature | Old | New target | Frontend fn | Backend | Table | Auth | Status |
|---|---|---|---|---|---|---|---|
| Admin auth protection | admin-auth.js | admin.html | `PegStore.isAdmin` | profiles.role='admin' | profiles | admin | 🔌 |
| User management | admin-users.html | admin.html | ⚠ live query | select profiles | profiles | admin | ⚠ render only |
| Subscription oversight | admin (manual) | admin.html | ⚠ | select memberships | memberships | admin | ⚠ |
| Deal Room review | ⛔ | admin.html | ⚠ | select deal_rooms | deal_rooms | admin | ⚠ |
| Submission review | admin-submissions.html | admin.html | ⚠ | select *_submissions | contact_/deal_/funding_… | admin | ⚠ |
| Lender verification | admin-providers.html | admin.html | ⚠ | update lender_profiles | lender_profiles | admin | ⚠ |
| Activity monitoring | ⛔ | admin.html | ⚠ | select activity/notifications | deal_room_activity | admin | ⚠ |
> Admin pages render in v69 but most tabs are **not yet bound to live queries** — see plan.

---

## Implementation plan for MISSING / ⚠ items
1. **Document upload (Deal Rooms)** — create Supabase Storage bucket `deal-docs`, wire the Documents tab "Upload" to `supabase.storage.from('deal-docs').upload()` + insert `deal_room_documents` row. (auth, RLS by room membership)
2. **Deal Room messaging collision** — `messages` exists in v68 (flat) AND v69 002 (threaded). **Do not run 002's messaging block over the live DB.** Either (a) rename 002 tables to `dr_threads/dr_messages`, or (b) keep v68 `messages` and link by `deal_room_id`. Decide before running 002 on production.
3. **Academy/webinars render** — bind `webinars.html`/`capital-sessions.html` to `PegForms.getPublishedWebinars()` and the reserve-seat form to `submitWebinarRegistration` (functions already ported).
4. **Simulator save** — wire `capital-strategy-simulator.html` save button to `PegForms.submitCapitalScenario` (function ready).
5. **Admin live queries** — bind admin tabs to selects on profiles / memberships / *_submissions / deal_rooms (admin RLS).
6. **Nav AI concierge** — port `nav-assistant.js` floating widget calling `PegForms.aiQuery`.
7. **Growth Capital (net-new)** — schema: `founder_submissions`, `investor_appetite`, reuse `deal_rooms` (add `kind='growth'`), reuse `score_match`; founder intake form; admin review tab.
8. **Lender source unification** — migrate `lender_appetite_profiles` ↔ `lender_profiles` to one table, or have Match Engine read `lender_profiles`.

---

## Backend functions required (Netlify + Supabase)
- **Netlify:** `create-checkout-session.js` 🔌, `create-portal-session.js` 🔌, `stripe-webhook.js` 🔌
- **Supabase Edge:** `pegasus-ai-assistant` ✅ (already deployed in prod; v69 invokes it) — needs `OPENAI_API_KEY` secret
- **Supabase SQL functions:** `entitlements`, `can_create_deal_room`, `has_match_engine`, `consume_ai_query` (001); `score_match`, `run_match`, `notify`, `unread_count`, workflow + onboarding triggers (002)

## Environment variables required (Netlify)
```
STRIPE_SECRET_KEY                = sk_live_…
SITE_URL                         = https://pegasuslendersgroup.com   (use the *.netlify.app URL for preview)
# Either the v69 names OR the v68 names — checkout reads both:
STRIPE_PRICE_STARTER_MONTHLY  / STRIPE_STARTER_MONTHLY
STRIPE_PRICE_STARTER_ANNUAL   / STRIPE_STARTER_ANNUAL
STRIPE_PRICE_PRO_MONTHLY      / STRIPE_PROFESSIONAL_MONTHLY
STRIPE_PRICE_PRO_ANNUAL       / STRIPE_PROFESSIONAL_ANNUAL
STRIPE_PRICE_GOLD_MONTHLY     / STRIPE_GOLD_MONTHLY
STRIPE_PRICE_GOLD_ANNUAL      / STRIPE_GOLD_ANNUAL
STRIPE_WEBHOOK_SECRET            = whsec_…
SUPABASE_URL                     = https://trdwsssouhpawhfdkfqf.supabase.co
SUPABASE_SERVICE_ROLE_KEY        = (for webhook + admin writes; server-side only)
```
**Supabase Edge secret:** `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default gpt-4o-mini)
**Client config (already set in `js/pegasus-config.js`):** SUPABASE_URL + publishable key.

## Supabase tables required
- **Already in production (v68, reused):** profiles, memberships, membership_credits, contact_submissions, rwa_project_intakes, investor_interest_submissions, badge_proof_submissions, capital_scenarios, webinar_library, webinar_registrations, business_funding_requests, business_funding_provider_profiles, lender_profiles, listings, deal_submissions, messages, ai_assistant_chats, ai_assistant_messages, rwa_partner_profiles, rwa_project_workspaces, navigation_items, site_settings, admin_contacts, admin_notes, compliance_acknowledgements
- **New for v69 (run 001 + 002 + 003):** plan_entitlements, subscriptions*, deal_rooms, deal_room_participants, deal_room_documents, deal_room_activity, lender_interest, ai_usage, match_requests, lender_appetite_profiles, financing_requests, match_results, notifications  *(subscriptions optional — memberships is canonical)*
- ⚠ **Do not** create 002's `message_threads/messages/message_reads` over the live DB without resolving the `messages` collision (see plan #2).

## Stripe webhook setup
1. Stripe Dashboard → Developers → Webhooks → Add endpoint:
   `https://<site>/.netlify/functions/stripe-webhook`
2. Events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`.
3. Copy signing secret → Netlify env `STRIPE_WEBHOOK_SECRET`.
4. Webhook upserts `memberships` (plan, status, stripe_subscription_id, current_period_end) keyed by `user_id` from session metadata.

---

## Testing checklist (preview first)
**Auth**
- [ ] Sign up new user → profile row + welcome notification created
- [ ] Sign in → routes admin→admin.html, member→dashboard.html
- [ ] Refresh persists session; Logout clears it
- [ ] Visiting an app page while signed out → demo (or redirect when ALLOW_DEMO_FALLBACK=false)

**Billing**
- [ ] Membership page → checkout opens Stripe (test mode) for each tier/cycle
- [ ] Completing test checkout → webhook writes `memberships`; dashboard shows new tier
- [ ] Simulate `invoice.payment_failed` → past_due banner appears
- [ ] Billing portal opens; cancel → cancel_at_period_end state shows

**Entitlements**
- [ ] Starter: Deal Rooms gated; Match Engine gated; AI limited to 20
- [ ] Pro: 2 Deal Rooms; standard Match Engine; unlimited AI
- [ ] Gold: unlimited Deal Rooms; full Match Engine

**Forms (live tables)**
- [ ] Contact → row in `contact_submissions`
- [ ] RWA intake → `rwa_project_intakes`
- [ ] Investor interest → `investor_interest_submissions`
- [ ] Badge proof → `badge_proof_submissions`
- [ ] Business funding → `business_funding_requests`
- [ ] Each form in preview shows "Saved (preview mode)" without erroring

**Match Engine**
- [ ] Submit financing request → `financing_requests` row + `match_results` populated + lender notifications

**AI**
- [ ] ai-assistant.html replies via edge fn when signed in; canned routing in preview
- [ ] Starter hits AI limit → upgrade nudge

**Deal Rooms**
- [ ] Create room → `deal_rooms` row; advance workflow → activity + participant notifications
- [ ] (Pending) document upload to Storage

**Admin**
- [ ] Non-admin cannot reach admin.html (redirect)
- [ ] (Pending) tabs show live counts

---
## v70 pre-launch delta (this phase)
- Homepage: pipeline card → light `.panel`; added Live Capital Session + Ambassadors. **status: connected (UI)**
- Profiles: `profileBody` premium rebuild across all 5 profile pages. **status: rebuilt**
- Academy/Sessions: schema 004 (sessions/speakers/session_registrations, tier-gated). **status: backend-ready; UI pending**
- Growth Capital: schema 004 (founder_submissions/investor_appetite/growth rooms/score_growth). **status: backend-ready; UI pending**
- Featured/Ambassador: profiles.featured columns + homepage placement. **status: connected**
- Email: `email_outbox` + `queue_email()` single integration point. **status: hook-ready; sender pending**
