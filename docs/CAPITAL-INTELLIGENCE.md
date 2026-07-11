# Pegasus Capital Intelligence — Private Admin Module

A private, admin-only operating system inside Pegasus Capital Network for daily
commercial real-estate intelligence. First market: **Palm Beach County, FL —
neighborhood/community/strip retail, generally $4–7M** (sweet spot ≈ $5M).
Designed to extend to other Florida markets and property types.

**This is not a member-facing product.** It is an internal acquisition,
debt-intelligence, broker-relationship, lender-research, and opportunity-
monitoring system for authorized administrators only. The member-facing
`intelligence.html` (Capital Intelligence Stream) is unrelated and untouched.

---

## Access

| Surface | Address | Protection |
|---|---|---|
| Admin app | `/admin/intelligence` → `admin-intelligence.html` | store gate → **live DB admin re-check** → admin-only RLS |
| Data | `pci_*` tables | RLS: `public.is_admin_user()` for every command |
| Import functions | `/.netlify/functions/intelligence-*` | bearer JWT → server-side admin verification (delete-user.js pattern) |
| Files | `capital-intelligence-private` bucket | private; admin-only storage RLS; signed URLs |

The page carries `noindex,nofollow` + `Cache-Control: no-store` +
`X-Robots-Tag` (netlify.toml), has no sitemap entry and no public navigation
entry. The sidebar link appears only for admins. **None of that is the security
boundary — RLS is.** A signed-in non-admin calling Supabase directly gets no
rows and can write none.

## Data model (migrations 067–070)

Relationship layer stays in the existing CRM (`crm_contacts` — brokers, owners,
principals, lenders, attorneys, property managers, title contacts). Migration
**067** fixes the `linked_profile_id` client bug, adds a safe FK + per-owner
unique link index, and adds optional fields: `job_title, website, linkedin_url,
address_line1, city, state, postal_code, last_verified_at, data_confidence,
source_url, metadata`.

Migration **068** creates the intelligence layer (all RLS admin-only):

| Table | Purpose | Dedupe priority |
|---|---|---|
| `pci_properties` | canonical current snapshot per property | **(county, parcel)** → external_id → normalized address |
| `pci_property_contacts` | property ↔ CRM contact roles | property+contact+role |
| `pci_loans` | recorded/reported debt | **(recording_jurisdiction, instrument №)** → external_id → property+lender+date+amount |
| `pci_tenants` | rent-roll rows | property+tenant+suite |
| `pci_listings` | listing **events** (price/status timeline) | append-only |
| `pci_distress_signals` | foreclosure/lis pendens/tax lien/… | external_id → natural key |
| `pci_lender_programs` | internal researched capital matrix (separate from member `lender_appetite_profiles`) | external_id → lender+program |
| `pci_sources` | research provenance (+ private doc paths) | normalized URL / checksum |
| `pci_scores` | score **history**, components 15/15/15/15/20/10/10, thresholds 80/60, override requires stored reason (DB CHECK) | append-only |
| `pci_daily_actions` | prioritized daily to-dos | soft-dedupe vs open actions |

Migration **069** adds the import pipeline (`pci_import_batches`,
`pci_import_rows`, `pci_change_log`, and `pci_entity_sources` for durable
source lineage) and two transactional, **service-role-only** RPCs:
`pci_commit_import_batch` (atomic — the whole batch applies or nothing does)
and `pci_rollback_import_batch` (last-committed-only; refuses if any touched
record was changed after import, detected by comparing the live record to the
committed state rather than the change log, so manual admin edits are caught).

Migration **070** creates the private bucket + storage policies and the
admin-only `pci_check_schema()` health RPC (kept separate from the member-
callable `check_platform_schema()` so private table names are not enumerated
to members).

## Import pipeline (daily XLSX)

```
upload .xlsx ──► intelligence-import-preview      (validate · normalize · dedupe ·
     │                                             conflict-detect · store file ·
     │                                             write batch + rows, status=previewed)
     ▼
review in Import Center  ──►  resolve conflicts (skip / keep / apply)
     ▼
intelligence-import-commit ──► pci_commit_import_batch()   ONE TRANSACTION
     │                          · whitelisted tables · typed via jsonb_populate_record
     │                          · full pci_change_log · Verified-downgrade backstop
     ▼
intelligence-import-rollback ─► pci_rollback_import_batch  (most recent committed
                                batch only; refuses if anything was modified since)
```

All semantics (parsing, normalization, keys, confidence ladder, conflict rules)
live in `netlify/functions/lib/intelligence-import-core.js` — a pure module
unit-tested offline by `qa/intelligence-audit.js`. The template workbook is
generated from the same contract (`intelligence-template` function), so the
template and the importer cannot drift apart.

### History & conflict rules
0. **Commit is atomic.** The whole batch applies in one transaction or nothing
   does; any DB-level failure on any applicable row aborts the entire commit,
   leaving no live rows, no change-log rows, and the batch still *previewed*.
   **Rollback is edit-aware:** before reverting anything it compares each live
   record to the exact state the import committed, so a manual admin edit (which
   writes no change-log row) is detected and the rollback refuses with the exact
   blockers.
1. Every changed material value → `pci_change_log` entry (old, new, confidence
   before/after, **source_id**, batch, who, when), and each material entity is
   linked to its source in `pci_entity_sources`.
2. Property identity is **county-scoped** (`(county, parcel)`); loan identity is
   **recording-jurisdiction-scoped** (`(recording_jurisdiction, instrument)`).
2. Price and listing-status changes are also appended to `pci_listings`, so the
   timeline is visible chronologically.
3. Confidence ladder: **Verified > Reported > Estimated > Unknown.**
4. Lower-confidence incoming values NEVER auto-overwrite higher-confidence
   values → the row becomes a **conflict** (admin chooses keep/apply). The
   commit RPC re-checks this server-side as a backstop.
5. Same-confidence changes: allowed for **time-varying** fields (price, NOI,
   occupancy, listing status, balances, lender terms…), conflict for
   non-time-varying facts (year built, parcel, recorded amounts…).
6. Blank cells mean *unknown*: they never overwrite and never become 0.
7. Duplicate files are caught by SHA-256 checksum (force-import available).
8. Duplicate rows are caught by canonical dedupe keys, in-file and against DB.
9. Every import is auditable to file → sheet → row (`pci_import_rows` keeps
   raw, normalized, before, and after images).

## Admin UI (admin-intelligence.html)

Tabs: **Dashboard** (9 metric tiles, recent changes, top opportunities,
maturity calendar, top actions, latest import) · **Properties** (filter/sort/
CSV-export/create/edit) · **Property Detail** (Overview / Ownership & Contacts
/ Debt / Tenants & Rollover / Listings & Price History / Distress / Score /
Capital Match / Sources & Documents / Change History) · **Contacts** (role map
into the CRM) · **Lenders & Capital** (program matrix, stale-terms warnings) ·
**Capital Match** (deterministic screen: Fits / Possible / Gaps + disclaimer)
· **Import Center** · **Data Quality** (schema health, missing criticals,
stale terms, unresolved conflicts, confidence distribution).

UX invariants: confidence badges + source link + last-checked beside material
data; recorded facts separated from analysis (scores); honest empty states —
no demo records; consistent currency/percent/SF/date formatting; CSV export is
formula-injection-safe.

## Security summary

- RLS on every `pci_` table; policies use `public.is_admin_user()`.
- Netlify functions authenticate the bearer JWT and independently verify admin.
- Commit/rollback RPCs are EXECUTE-able **only by service_role**.
- Workbooks: .xlsx only; legacy/macro formats rejected by signature and
  content (`vbaProject`); formulas rejected as data; percent/currency/date/
  boolean values validated server-side; URLs restricted to http(s).
- Uploads ≤ 4MB (limit shown in UI); stored under `imports/YYYY/MM/`;
  property docs under `properties/{id}/`; bucket private; signed URLs only.
- Browser code never sees the service key; rendered text is escaped.
- Admin page and function responses are `no-store`.
- Privileged actions log admin id + batch id, never secrets or file contents.

## Extending to new markets / property types

- `pci_properties.county/city/property_type/property_subtype` are plain
  filterable columns — no schema change needed for new Florida markets.
- New content types: add a sheet to the CONTRACT in
  `intelligence-import-core.js`, a matching `pci_` table + RLS, and a mapping
  in `pci_target_table()` — the generic applier handles the rest.
- Scoring weights live in one place (score modal + CHECK constraint).

## Files

- `admin-intelligence.html`, `css/admin-intelligence.css`,
  `js/intelligence/{intelligence-api.js, admin-intelligence.js}`
- `netlify/functions/intelligence-{import-preview, import-commit,
  import-rollback, import-batch, template}.js`
- `netlify/functions/lib/intelligence-{import-core, workbook, auth}.js`
- `supabase/{067,068,069,070}_*.sql`
- `qa/intelligence-audit.js` (`npm run qa:intelligence`)
- `docs/CAPITAL-INTELLIGENCE-IMPORT.md` (workbook contract)
