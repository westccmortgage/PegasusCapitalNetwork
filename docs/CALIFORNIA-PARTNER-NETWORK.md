# California Partner Network — Private Admin Module

A private, **admin-only** operating system for the California agent / escrow &
title / company relationship network — completely separate from the Palm Beach
**Capital Intelligence** module. Partner records never mix with properties,
loans, tenants, or lender programs, and the importer **never creates borrower
records or CRM contacts** (it only *links* to an existing CRM contact by email).

## Access

| Surface | Address | Protection |
|---|---|---|
| Admin app | `/admin/partner-network` → `admin-partner-network.html` | store gate → **live DB admin re-check** → admin-only RLS |
| Data | `pn_*` tables | RLS: `public.is_admin_user()` for every command |
| Import functions | `/.netlify/functions/partner-*` | bearer JWT → server-side admin verification |
| Files | `partner-network-private` bucket | private; admin-only storage RLS; signed URLs |

`noindex,nofollow` + `no-store` + `X-Robots-Tag` (netlify.toml); no sitemap
entry; the sidebar link shows for admins only. **RLS is the boundary**, not the
page gate.

## Tabs

**Dashboard** (agent / company / escrow / signals / outreach / DNC tiles +
recent signals + top outreach + latest import) · **Agents** (filter · CSV ·
manual add/edit · detail with activity) · **Escrow & Title** · **Companies**
(manual add/edit) · **Outreach Queue** (work the queue; rows matching the
suppression list are flagged **DO NOT CONTACT**) · **Activity Signals** ·
**Do Not Contact** · **Import Center**.

## Data model (migrations 072–074)

Migration **072** creates the intelligence layer (all RLS admin-only):

| Table | Sheet | Dedupe priority |
|---|---|---|
| `pn_companies` | Companies | external_id → name+city |
| `pn_agents` | Agents | external_id → email → license → name+company |
| `pn_escrow_title` | Escrow_Title | external_id → email → name+company |
| `pn_activity_signals` | Activity_Signals | external_id → subject+type+date |
| `pn_outreach_actions` | Outreach_Actions | skip identical still-open action |
| `pn_do_not_contact` | Do_Not_Contact | external_id → email → name |

Migration **073** adds the import pipeline (`pn_import_batches`,
`pn_import_rows`, `pn_change_log`) and two transactional, **service-role-only**
RPCs: `pn_commit_import_batch` (atomic — whole batch or nothing) and
`pn_rollback_import_batch` (last-committed-only; refuses if any touched record
was changed after import, detected by comparing the live record to the committed
state — so manual admin edits are caught).

Migration **074** creates the private bucket + storage policies and the
admin-only `pn_check_schema()` health RPC.

## Import contract (exactly six sheets)

`Agents · Escrow_Title · Companies · Activity_Signals · Outreach_Actions ·
Do_Not_Contact` — matched case- and spacing-insensitively (with OOXML namespace
prefix + exotic-whitespace normalization). Download the always-current template
from **Import Center → Download Import Template**; it is generated from the same
contract the importer uses.

- **File**: `.xlsx` only, ≤ 4MB. Macro/legacy formats rejected by signature +
  content; formulas rejected as data; URLs restricted to http(s).
- **Excel Tables are ignored** — table parts/relationships are stripped before
  parsing (shared `lib/xlsx-sanitize.js`) so a malformed or dangling table
  relationship cannot crash the reader; cell values, styles, validations,
  hyperlinks and formula/security checks are untouched.
- **Confidence** ladder: Verified > Reported > Estimated > Unknown. Lower
  confidence never silently overwrites higher — it becomes a conflict.
- **Company_Key** on Agents/Escrow points at a Companies row (name or `ext:ID`);
  **Subject_Key** on Activity_Signals/Outreach points at an Agent or Company.
- **Wrong module guard**: a Capital Intelligence (Palm Beach) workbook uploaded
  here is rejected with *"This workbook belongs to Capital Intelligence (Palm
  Beach). Upload it in /admin/intelligence."* — and, symmetrically, a Partner
  Network workbook uploaded to Capital Intelligence is rejected with *"This
  workbook belongs to California Partner Network. Upload it in
  /admin/partner-network."*

## CRM reuse (no borrower records)

Partner import **links** an Agent/Escrow row to an existing `crm_contacts` row
when the email matches one the admin already owns (`linked_contact_id`). It never
inserts `crm_contacts` and never writes a `borrower` record. People live in the
`pn_` tables; the CRM link is convenience only.

## Files

- `admin-partner-network.html`, `js/partner-network/{partner-api.js, admin-partner-network.js}`
- `netlify/functions/partner-{import-preview, import-commit, import-rollback, import-batch, template}.js`
- `netlify/functions/lib/partner-{import-core, workbook}.js` (auth reused from `intelligence-auth.js`)
- `supabase/{072,073,074}_*.sql`
- `qa/partner-audit.js` (`npm run qa:partner`), `qa/sql/pn-db-tests.sql`
