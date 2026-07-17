# Resource Registry

The registry (`src/lib/resources/site-registry.js`) is the ONLY place URLs the
assistant can recommend may live. The model emits ids; the app resolves URLs.

## The 26 registered resources

| id | brand | canonical | category | scope |
|---|---|---|---|---|
| `wccm-home` / `wccm-about` / `wccm-contact` | West Coast Capital Mortgage | westccmortgage.com | corporate_trust | company, licensing, human contact |
| `nmls-consumer-access` | NMLS Consumer Access | nmlsconsumeraccess.org | corporate_trust | independent license verification |
| `wcci-home` | WCCI | wcci.online | scenario_tool | the AI workspace (never for "who are you") |
| `ourmtg-portal` | OurMTG | ourmtg.com | secure_application | apply / upload / loan status (readiness only) |
| `californiamtg-home/about/privacy` | California Mortgage | californiamtg.com | state_mortgage | CA education, scenario, privacy |
| `suncoast-home/about/resources` | Suncoast Capital Mortgage | suncoastcapitalmortgage.com | state_mortgage | Florida-facing brand |
| `kwest-home/about/scenario-studio/disclosures` | K West Mortgage | kwestmortgages.com | local_mortgage | Key West / Monroe County only |
| `beforejumbo-home` | Before Jumbo Loan | beforejumboloan.com | mortgage_education | conforming/high-balance/jumbo, points, buydown, IO |
| `belair-home` | Bel Air Financing | belairfinancing.com | local_mortgage | LA luxury estates only |
| `lunadabay-home` | Lunada Bay Mortgage | lunadabaymortgage.com | local_mortgage | Palos Verdes / South Bay — **verified:false** |
| `orange-home/about` | Orange Mortgage | orangesmortgages.com | mortgage_education | friendly / first-time / OC |
| `cadeed-home` | CADeed | cadeed.com | private_real_estate_capital | CA bridge/construction/2nd-lien/private money |
| `privatenotecapital-home` | Private Note Capital | privatenotecapital.com | investor_capital | qualified investors only |
| `pegasuscapital-home` | Pegasus Capital Network | pegasuscapitalnetwork.com | professional_network | capital pros only |
| `pegasusprivate-home` | Pegasus Private Network | pegasusprivatenetwork.com | digital_assets | tokenization only |
| `californiardp-home` | California Residential Development Partners | californiardp.com | development_proof | development credibility |
| `grcrm-home` | GRCRM | grcrm.com | internal_platform | professionals only — never a borrower next step |

Aliases `westcoastcapitalmortgage.com`, `wwccm.com` normalize to
`westccmortgage.com` (never shown as separate companies).

## Hard exclusions (never indexed, recommended, or rendered)

`markevita.com`, `vistadelmartownhomes.com`, plus pattern-based blocks for
`*.netlify.app`, `netlify.com`, localhost, `staging`, and
`/admin|/login|/signin|/account|/dashboard|/wp-admin` paths
(`EXCLUDED_DOMAINS` / `EXCLUDED_URL_PATTERNS`). Enforced in
`resource-validator.isUrlAllowed`.

## Verification & `verified`

Only `verified: true` resources ever render. Owner-approved canonical pages ship
`verified: true`. **Lunada Bay is `verified: false`** until a live crawl of its
routes passes (per the mission's crawl-first requirement) — the validator drops
it even if routed, and a test asserts this.

### How to (re)verify — `npm run sync:resources`

`scripts/sync-site-resources.mjs` crawls only allow-listed registry domains,
respects `robots.txt`, checks `sitemap.xml`, rejects preview/staging/login/admin
URLs, extracts title/description/canonical/headings/clean-text/locale/geo/topic
tags + content hash + HTTP status, records redirects/broken links, and writes
`docs/resource-index.json` + `docs/link-health.md`. It never adds URLs — it only
verifies what the owner approved. After a clean report, set `verified: true` and
`lastVerifiedAt` on the passing entries. (No LLM is involved; no vector DB is
introduced — deterministic tags + registry scoring, embeddings optional later.)

## How to add another website (future)

1. Add a `SiteResource` object to `SITE_REGISTRY` with a stable kebab-case `id`,
   canonical https URL, `category`, `audiences`, geo/topic tags,
   localized `actionLabel` + `shortDescription` (en/es/ru), `priority`, and
   `verified: false`.
2. If it's audience-restricted (professional/investor), set `neverAutoRouteFor`.
3. If it's a specialty resource, add its required topics to `TOPIC_GATED` in
   `resource-router.js`; if geo-local, add its id to `GEO_GATED`.
4. Run `npm run sync:resources`, review `docs/link-health.md`, then flip
   `verified: true` + stamp `lastVerifiedAt`.
5. Add/extend a routing test in `test/resource-routing.test.mjs`.

## How to update licensing & supported states

All legal facts live in `src/config/companyFacts.js` (the single source of
truth). Change `supportedStates` there to add/remove a state — nothing else
reads marketing copy for availability. Never add an unverified license number
(Florida shows the company NMLS only). `src/i18n.js`, `src/systemPrompt.js`, and
the structured-data in `index.html` all derive from this file, and
`test/company-facts.test.mjs` + `test/licensing.test.mjs` guard the numbers.
