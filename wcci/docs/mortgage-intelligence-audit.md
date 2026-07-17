# Mortgage Intelligence Audit — WCCI Loan Strategy AI

Audit of the application as it exists **before** the Mortgage Intelligence and
Resource Routing upgrade. Stack: Vite + React 18 (plain JavaScript, no
TypeScript, no router — a single `App.jsx` with three screens), Netlify
Functions (Node CJS), Anthropic Messages API. No secrets appear in this
document.

---

## 1. Where everything lives today

| Concern | Location | Notes |
|---|---|---|
| System prompt (all fragments) | `src/systemPrompt.js` | One large template string `SYSTEM_PROMPT` + `langDirective(lang)` (ES/RU opening-language directive) + `localeFor(lang)` (SpeechRecognition locale). Shared by the app and the live conversation test. |
| Dynamic prompt block | `src/App.jsx` → `buildEstimatesContext(profile)` | Appends "CURRENT APP-COMPUTED ESTIMATES" (engine-calculated payment / cash-to-close) to the system prompt each turn. |
| Claude API integration | `netlify/functions/chat.js` | Thin proxy: forwards the client-built request body verbatim to `api.anthropic.com/v1/messages` with `ANTHROPIC_KEY`; also detects `SCENARIO_COMPLETE:` in the response and fires the lead email server-side. Model: `claude-sonnet-4-6`, `max_tokens: 1024`, non-streaming. |
| Response parsing | `src/App.jsx` → `sendMessage()` | Extracts two machine lines from the reply text: `PROFILE_UPDATE:{...}` (live profile sync, authoritative, stripped before display) and `SCENARIO_COMPLETE:{...}` (final lead JSON). Everything else renders as plain text with a minimal `**bold**` renderer. **No markdown links are rendered; raw URLs would appear as dead text.** |
| Conversation history | React state `messages` + `localStorage['wcci-session']` | The full message array is sent to the model every turn (so the model *can* see history), persisted with flush-on-hide for mobile Safari. **No summarization; no structured memory beyond the Scenario Profile.** |
| Loan Strategy Profile state | React state `profile` + `src/lib/scenarioProfile.js` | Field definitions (needed/helpful/optional), completion %, merge logic (parser fill-only < AI authoritative < manual-entry protected). |
| Scenario parsing | `src/lib/parser.js` | Deterministic extraction of price/down/state/city/employment/FICO/goal from free text. |
| Question engine | `src/lib/questionEngine.js` | Next 1–3 most important questions. |
| Strategy engine | `src/lib/strategyEngine.js` | 10 loan paths with cautious labels + per-path estimates. |
| Cash-to-close engine | `src/lib/cashToClose.js` + `src/lib/assumptions.js` | Deterministic, scaling fees. See §2.8 for the fee-labeling problem. |
| Lead capture | `StrategyProfile.jsx` (`LeadCapture`) + `App.jsx` `handleSubmitLead` → `src/lib/leadAdapter.js` | Adapter registry: email (live via `partial-lead` fn), telegram/crm/arive/googleSheet/webhook stubs. **No GRCRM integration exists — only a disabled `crm` stub.** |
| Contact requests | Prompt-driven | See §2.2 — the prompt *tells* the model to capture contact early. |
| Website links exposed to model | None whitelisted | The prompt *forbids* URLs entirely ("Do NOT output links… never send the borrower to a website"). |
| Language handling | `src/i18n.js` (`T`, `STRATEGY_UI`, `UPLOAD_UI`) + prompt language rules | EN/ES/RU UI; legal text intentionally English. |
| Database / Supabase | **None** | Supabase was removed earlier (CRM decommissioned). Sessions live in `localStorage` only. No cookies are set by the app itself. |
| Analytics & consent | `index.html` Plausible script | Cookieless Plausible; no custom events are fired today; no consent banner (none required by the cookieless setup). |
| Existing tests | `test/engine.test.mjs` (20), `test/licensing.test.mjs` (7), `test/conversation-test.mjs` (live-model, skips without key) | Run via `npm test` (node --test) and `npm run test:ai`. |
| Lint / build | `scripts/lint.mjs` (esbuild syntax + compliance-phrase guard), `vite build` | No ESLint/TS toolchain by design. |
| Env vars | `ANTHROPIC_KEY`, `RESEND_API_KEY`, `LEAD_EMAIL_TO`, `LEAD_EMAIL_FROM` | Netlify deploy (drag-drop bundle or repo build). Netlify secret scanning previously required `SECRETS_SCAN_ENABLED=false`. |

## 2. Why the current assistant fails the mission requirements

1. **Responds mostly to the latest turn.** Although full history is sent, the
   only *structured* memory is the Scenario Profile (facts about the loan).
   There is no representation of stage, trust level, objections, refusals, or
   competitor mentions — so nothing stops the model from re-asking for a phone
   number two turns after a refusal. Behavior depends entirely on the model
   re-reading raw history under a prompt that *pushes* contact capture.

2. **Repeatedly requests contact information.** The prompt's `PHASE 1 — LIGHT
   CONTACT` ("Get their FIRST NAME and best way to reach them"), `PHASE 3 —
   CONFIRM CONTACT`, and `ANTI-ABANDONMENT` ("prioritize capturing at minimum
   their FIRST NAME and one contact method") are lead-capture-first
   instructions. A refusal is answered with "circle back to contact gently" —
   i.e., ask again. There is no consent state, no ask counter, no "declined is
   sticky" rule.

3. **Generic "visit wcci.online"-style answers.** The prompt bans all URLs, so
   when a user asks "who are you people?", the model can only say "our
   licensed team will follow up" — it cannot present the corporate About page,
   licensing verification, or any state-specific resource. There is no site
   registry, no routing, no cards, and the renderer would show raw URLs as
   plain unclickable text anyway.

4. **No Florida-specific routing.** Florida is only mentioned as a supported
   state. A Boca Raton borrower and a Key West borrower get identical
   treatment; Suncoast/K West resources don't exist anywhere in the system.

5. **Company information never enters the chat.** Licensing constants exist
   (`src/i18n.js`) and render in footers/emails, but the model has no company
   biography, founder background, or brand map, so trust questions get vague
   answers instead of in-chat facts plus verifiable links.

6. **Trust-building is conflated with lead capture.** The `SKEPTICAL` branch
   of the rapport section ends in "earn the next answer", and `RUSHED` ends in
   "still capture contact so nothing is lost". There is no trust_building
   stage that explicitly excludes contact requests.

7. **False precision in closing costs.** `calculateCashToClose()` lumps
   `pointsAmount + originatorComp + applicationFee` into a single
   `totalLenderFees`. For a $1.12M loan that is **$5,770.24 + $11,200 +
   $1,595 = $18,565.24**, which the estimates block hands to the model labeled
   "lender fees" — exactly the reported failure ("assistant invented an
   $18,565 lender fee"). Discount points are silently inside "lender fees",
   no assumption disclosure accompanies the numbers, and there is no "lender
   charges and points are not known yet" language.

8. **Unsupported statements about banks/lenders.** Nothing in the prompt
   forbids "Bank X doesn't offer that" claims or prescribes neutral
   bank-vs-broker framing; competitor mentions aren't detected or tracked.

9. **No clickable contextual resource cards.** The message renderer supports
   only bold text; there is no card component, no link whitelist, no
   server-side URL resolution, and no way for the model to recommend a page
   safely.

10. **Misattribution risk: WCCI presented as the company.** The prompt's first
    line calls the assistant "the mortgage strategy assistant for West Coast
    Capital Mortgage (wcci.online)" without explaining that WCCI is the AI
    workspace and West Coast Capital Mortgage Inc. is the licensed company.

11. **"Team will reach out" claims without consent.** The post-completion
    message asserts contact will happen; nothing verifies a contact method +
    consent actually exists at that point (it usually does via
    SCENARIO_COMPLETE, but partial-lead emails fire from a regex match on any
    phone-shaped number in the transcript — not from consent).

## 3. Constraints that shape the new design

- **Plain-JS stack.** "TypeScript" deliverables land as JSDoc-typed `.js`
  modules (`src/lib/resources/types.js` documents the shapes); no TS
  toolchain is introduced.
- **Thin serverless proxy.** There is no stateful server; "server-side" URL
  resolution/validation happens in the trusted client layer that renders
  cards: the model only ever emits registry **IDs**, never URLs, and the
  renderer resolves IDs through the registry (unknown/unverified/excluded IDs
  are dropped and logged).
- **No database.** The resource index and conversation state live in code +
  `localStorage`, matching the existing persistence pattern. The sync script
  writes JSON reports to `docs/` instead of Supabase tables.
- **Outbound network from this build environment is blocked**, so
  `scripts/sync-site-resources.mjs` ships runnable-by-owner; registry entries
  carry explicit `verified` flags (owner-approved canonical pages), and
  Lunada Bay deep routes stay `verified: false` until a real crawl passes
  (per the mission's crawl-first requirement).
