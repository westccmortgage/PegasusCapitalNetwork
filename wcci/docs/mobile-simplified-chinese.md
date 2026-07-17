# WCCI Workspace — Entry Flow, Palette, Mobile-First + Simplified Chinese

## Default entry = the strategy workspace (no landing click)

WCCI opens **directly into the strategy workspace** — chat area, assistant intro,
composer, manual-entry/profile panel, language controls, compact trust access,
company identity, and Start Over. The old marketing landing is **preserved only
as an opt-in route: `/?intro`** (`src/App.jsx` — `screen` init reads
`?intro`; `resetSession` and resume keep the user in the workspace). Verified by
`e2e/mobile.spec.mjs` (“default route opens directly into the workspace” +
“the old landing is preserved only at /?intro”).

## Mobile header, language switcher, welcome & legal cleanup

**Logo-only mobile header.** The mobile header shows only the square `BrandMark`
(no "WCCI" text, no "by West Coast Capital Mortgage Inc." beside it). Right-side
actions are a compact **language control** (`🌐 EN ▾`), a **phone** icon, and a
**menu** (`☰`) — consistent 44×44 targets, no wrap, no horizontal overflow at
360/375/390/393/430. Desktop keeps a company-first lockup (**West Coast Capital
Mortgage Inc.** primary; *WCCI* is the small product/domain identifier) plus the
Office number, a labeled Company & Licensing button, Start Over, and the same
language/phone/menu controls.

**Compact language sheet.** The four-item row is replaced by one control that
opens a bottom sheet listing **English · Español · Русский · 简体中文** (native
names, current selected, localized "Language/Idioma/Язык/语言" title). Changing
language localizes the whole UI, persists, and never clears the chat, profile, or
partially typed text. Never shows "ZH".

**Phone → contact sheet (no auto-dial).** The phone icon opens a *Contact West
Coast Capital Mortgage* sheet with Office / Direct — Anatoliy Kanevsky / Email and
Call Office · Call Anatoliy · Send Email — the user chooses; tapping the icon
never dials.

**Menu.** Loan Strategy Profile (mobile), Start New Scenario (with a
confirmation before clearing), Company & Licensing, About West Coast Capital
Mortgage, Privacy & AI Use, Contact, Clear Saved Information — all localized.

**Shorter welcome.** The intro is concise ("Welcome. I'm your AI-assisted
mortgage strategist from West Coast Capital Mortgage. … How can I help today?")
and does not ask for a name first — the borrower can start with their scenario
immediately. Localized for en/es/ru/zh-CN.

**Legal cleanup.** The always-visible multiline licensing block under the
composer is replaced by a compact **Company & Licensing** link that opens the
drawer; the full approved facts live in the drawer (and the /?intro footer),
freeing composer space. All sheets are accessible modals (focus-in on open, Tab
trap, Escape-to-close, focus restore) with `prefers-reduced-motion` support.
Verified by `e2e/mobile.spec.mjs` + `test/localization.test.mjs` (CONTACT_UI key
parity, concise no-name welcome).

## Header & Company-trust UX (earlier)

The generic "W" tile and the ambiguous shield-only button are gone. The header
now uses a real **WCCI brand mark** (`BrandMark` — an SVG bronze "W" drawn as
rooftop peaks in a warm ivory tile; also the favicon) beside the lockup
**WCCI / by West Coast Capital Mortgage Inc.**, shown without a click. On desktop
the **Office: (310) 654-1577** number is visible in the header and the trust
control is a clearly-labeled **🛡️ Company & Licensing** button (icon + text). On
mobile the right-side actions are **phone · language · menu (☰)**; the menu holds
Loan Strategy Profile, Company & Licensing, Call Office, Call Anatoliy, and
Privacy & AI Use (44px targets, no clipping/overflow at 360px, Chinese-safe).

The **Company & Licensing drawer** is titled plainly (not a security alert),
opens with the one-line explainer *"WCCI is the mortgage strategy platform
operated for West Coast Capital Mortgage Inc."*, then the full licensing blocks,
Office/Direct/Email, and the five actions. It is an accessible modal:
`role="dialog"`, focus moves to Close on open, **Tab is trapped**, **Escape
closes**, and focus returns to the trigger. Verified by `e2e/mobile.spec.mjs`.

## Visual system — CaliforniaMTG warm concierge palette

Design tokens live in `src/theme.js` (`C`): warm ivory app canvas, soft-cream
cards, light-sand panels, muted **bronze/gold** accents, deep espresso text,
warm-gray borders, softened success/warn/danger, bronze focus ring. Applied
across the workspace header, chat bubbles (assistant = soft cream card; user =
bronze gradient), composer, chips, profile/manual panels, resource cards, trust
panel, and the global CSS (`main.jsx`) + load background (`index.html`). No cold
tech-blue, no harsh gray blocks — calm, premium, mortgage-concierge.

---

# Mobile-First + Simplified Chinese (zh-CN)

WCCI is built and tested as a mobile-first mortgage strategy tool, with Simplified
Chinese as a fully supported fourth locale. Localization is locale-keyed
throughout so **Traditional Chinese (`zh-Hant`)** can be added later by filling
entries — not by rewriting the app.

Supported locales: `en`, `es`, `ru`, `zh-CN` (`src/i18n.js` → `LANGS`).
Planned: `zh-Hant` (`src/config/mortgageGlossary.js` → `PLANNED_LOCALES`).

## Single source of truth — contact & licensing

All contact/licensing facts come from `src/config/companyFacts.js` (no
duplication). A production **bundle scan** (`scripts/bundle-scan.mjs`,
`npm run scan:bundle`) fails the build if an outdated phone, crossed license
attribution, or inconsistent legal-entity wording reappears in `dist/`.

| Fact | Value |
| --- | --- |
| Legal entity | West Coast Capital Mortgage Inc. |
| Company | CA DRE Corporation License #02440065 · NMLS #2817729 |
| Broker | Anatoliy Kanevsky · CA DRE Broker License #01385024 · NMLS #2775380 |
| **Office** (general company line) | (310) 654-1577 |
| **Direct** (Anatoliy) | (310) 686-5053 |
| Email | westccmortgage@gmail.com |
| Primary sites | westcoastcapitalmortgage.com · wcci.online |

Office and Direct are distinct and never collapsed; the direct number is never
shown as the only/general company number. The two NMLS numbers are never
interchanged (`test/company-contact.test.mjs`, `test/licensing.test.mjs`).

## Mobile-first hero

First mobile viewport prioritizes, top to bottom: brand lockup (**WCCI** _by
West Coast Capital Mortgage Inc._), a compact AI-assisted badge (AI is
**secondary** — the company is not positioned as an AI tech company), the
mortgage-strategy headline, a short explanation, the scenario input, **Build My
Strategy**, **Enter Details Step by Step**, and a **Company & Licensing** trust
button — all reachable without scrolling past a decorative hero. Uses `100dvh`,
`env(safe-area-inset-bottom)`, 16px inputs (no iOS auto-zoom), and a system font
stack including `PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei` (no shipped
or render-blocking web fonts).

## Compact mobile trust panel

A `role="dialog"` sheet (openable before chatting, from landing and chat) shows
the licensed company, both license blocks, Office/Direct/Email, and localized
actions: Call Office · Call Anatoliy · Meet the Broker · Verify Licensing
(NMLS Consumer Access) · Privacy & AI Use. Chinese: 致电办公室 · 联系 Anatoliy ·
了解房贷经纪人 · 查看执照信息 · 隐私与人工智能使用说明. Legal identifiers stay in their
official form.

## Chinese input understanding

`src/lib/parser.js` extracts from natural Simplified Chinese: geography (加州=CA,
佛罗里达/佛州=FL), intent (购房/买房=purchase, 再融资/重新贷款=refinance, 投资房=investment),
amounts (万/亿; 首付=down payment), and income (自雇=self-employed).
`src/lib/conversationIntelligence.js` detects Chinese identity/privacy/fees/
human-request/readiness and contact hesitation (我不想留电话/只想先了解一下), preserving
the selected language. Verified by `test/chinese-scenario.test.mjs`.

## Centralized glossary (professionally-reviewed, not literal)

`src/config/mortgageGlossary.js` — the model uses these renderings so chat wording
matches the UI. Starter set (audited for natural usage, extend as needed):

| English | 简体中文 |
| --- | --- |
| mortgage | 房屋贷款 |
| purchase | 购房贷款 |
| refinance | 再融资 |
| down payment | 首付款 |
| closing costs | 过户费用 |
| interest rate | 利率 |
| monthly payment | 每月还款 |
| primary residence | 自住房 |
| second home | 第二套住房 |
| investment property | 投资房产 |
| self-employed | 自雇人士 |
| bank statement loan | 银行流水贷款 |
| jumbo loan | 超额贷款 |
| DSCR loan | 债务偿付覆盖率贷款 |
| licensed mortgage professional | 持牌房贷专业人士 |
| planning estimate | 规划估算 |
| not a rate quote | 并非正式利率报价 |

## IME composer safety

`src/lib/imeSend.js` (`shouldSendOnEnter`) ensures Enter during a Chinese IME
composition confirms a candidate instead of submitting — guarding
`nativeEvent.isComposing`, our `compositionstart/end` flag, and `keyCode 229`.
Unit-tested in `test/ime-composer.test.mjs`; composition events aren't reliably
synthesizable in a headless driver, so the pure decision is tested directly.

## Test & verification commands

- `npm test` — full unit suite (localization parity, no mixed-language, glossary,
  Chinese extraction, contact/licensing, IME, bundle scan). **124 passing.**
- `npm run lint` — esbuild syntax + compliance-word guard.
- `npm run verify:prod` — production build + bundle scan.
- `npm run test:e2e` — Playwright mobile projects (Android-Chromium, WeChat-UA;
  iPhone-WebKit needs a WebKit build). **19 passing / 1 skipped** here.
- `npm run screenshots` — real mobile screenshots at 360/390/430 (EN + zh-CN).
- `node e2e/audit.mjs` — lab performance + accessibility snapshot.

## Measured results (lab — not field)

Headless Chromium, 390×844, local static server. These are **lab** numbers; INP
and real-network LCP require field measurement (Lighthouse/CrUX):

| Metric | Value |
| --- | --- |
| JS transferred | ~112 KB gzip (~327 KB raw), single request + React vendor |
| FCP (lab) | ~0.40 s |
| LCP (lab) | ~0.40 s |
| CLS (lab) | 0 |
| DOMContentLoaded / load (lab) | ~0.30 s |
| A11y: unnamed buttons / links / unlabeled inputs | 0 / 0 / 0 |
| `<html lang>` | synced to the active locale |

Optimizations applied: no render-blocking web fonts (system stack), single
bundle, no large hero media, `deviceScaleFactor`-independent layout, reserved
input space (CLS 0). Not yet done: route/panel code-splitting (the app is a single
component) — a candidate if the bundle grows.

## Screenshots

`e2e/screenshots/` (committed): `landing-en-{360,390,430}.png`,
`landing-zh-{360,390,430}.png`, `trust-zh-{360,390,430}.png`,
`chat-zh-{360,390,430}.png`. Regenerate with `npm run build && npm run screenshots`.

## WeChat in-app browser — honest status

Verified in a **WeChat user-agent** (MicroMessenger) Chromium project: page
renders, language selection works, Chinese IME-safe composer, chat + trust panel
usable, session persisted in `localStorage` (no third-party cookies), no
popup-only flow, no Google-only sign-in, external links use standard `target`/tel
behavior. **Not verified on real iOS/Android WeChat devices** — do not claim
device-level WeChat compatibility until tested on hardware. Known constraints to
watch on real devices: WeChat may intercept `tel:` and external links with its own
sheet, and may restrict some downloads; the compact trust panel and tap-to-call
provide visible fallbacks rather than failing silently.

## Known minor items

- Language switcher targets are ~34px (segmented control) rather than 44px, to
  keep the four-locale switch on one row with the brand + phone at 360px.
- iPhone-WebKit e2e project requires a WebKit browser build (absent in this CI
  image); the Android-Chromium and WeChat-UA projects cover the same specs.
