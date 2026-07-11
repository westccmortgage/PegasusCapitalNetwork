# SECURITY REVIEW — Pegasus Capital Intelligence (private admin module)

Scope: migrations **067–071**, the `intelligence-*` Netlify functions, the
`js/intelligence/*` client, and `admin-intelligence.html`. Dependency
`public.is_admin_user()` (migration 011) is included because it is the trust
root for the whole module.

Security model in one line: **every `pci_` table is RLS-locked to
`public.is_admin_user()` (full admin); migration 071 additively widens *read* to
staff and *write* on properties & lender programs to a lower-privilege `analyst`
role — never DELETE, never other tables; the import functions run with the
service role only after independently verifying the caller's *full-admin* JWT;
the two write RPCs are `service_role`-EXECUTE-only; the document bucket is
private with admin-only storage RLS.** Page redirects and hidden links are
convenience, not the boundary — the boundary is RLS + the function-level admin
check.

### Analyst role (migration 071) — capability boundary

`profiles.pci_role = 'analyst'` is a dedicated marker, orthogonal to
`is_admin`/`role='admin'`. An analyst can **read every `pci_` table** and
**INSERT/UPDATE `pci_properties` and `pci_lender_programs`** — nothing else. An
analyst **cannot** DELETE any row, cannot write any other `pci_` table (loans,
tenants, contacts, scores, distress, actions, sources, import/change-log),
cannot touch private storage, and cannot import/commit/rollback (the functions
require full admin and return HTTP 403). This is enforced by RLS + function
auth, proven at the DB layer in `qa/sql/pci-db-tests.sql` (block **AN**, run as
the real non-owner `authenticated` role). The UI gating in
`admin-intelligence.js` is convenience only.

---

## 1. SECURITY DEFINER functions

| Function | Migration | Volatility | `search_path` | Who may EXECUTE | Internal authz | Notes |
|---|---|---|---|---|---|---|
| `public.is_admin_user()` | 011 (dependency) | stable | `public` | (as granted in 011) | returns `is_admin OR role='admin'` for `auth.uid()`, else `false` | Trust root. Returns `false` for anon (`auth.uid()` null). |
| `public.pci_is_staff()` | 071 | stable | `public` | PUBLIC (read-only; returns bool) | returns `is_admin OR role='admin' OR pci_role='analyst'` for `auth.uid()`, else `false` | Read gate for `pci_` `SELECT`. `false` for anon. Reads only the caller's own profile row. |
| `public.pci_can_edit()` | 071 | stable | `public` | PUBLIC (read-only; returns bool) | same population as `pci_is_staff()` today | Write gate for manual `INSERT`/`UPDATE` on `pci_properties` & `pci_lender_programs` only. Kept distinct from the read gate so the write surface can narrow later without touching RLS. |
| `public.pci_commit_import_batch(uuid, uuid, jsonb)` | 069 | volatile | `public` | **service_role only** (revoked from public/anon/authenticated) | none inside — caller (`requireAdmin`) verified admin first | **Atomic**: the whole batch applies in ONE transaction or nothing does. Any DB failure on an applicable row re-raises with sheet/row context and aborts everything (no live rows, no change-log rows, batch stays `previewed`). Writes `pci_change_log` (+`source_id`) and `pci_entity_sources`; enforces the Verified-downgrade backstop. |
| `public.pci_rollback_import_batch(uuid, uuid)` | 069 | volatile | `public` | **service_role only** | none inside — caller verified admin | LIFO (most-recent committed only). **Edit-aware**: two passes — first compares every live record to the exact state the batch committed (`after_data`), so a manual admin edit or deletion (which writes NO change-log row) is detected; refuses with per-record blockers (table, id, changed fields) and mutates nothing. Only when clean does it revert (delete inserts; restore only the import-changed columns of updates). |
| `public.pci_check_schema()` | 070 | stable | `public` | authenticated + service_role (revoked from public/anon) | **`if not public.is_admin_user() then raise exception 'Admins only'`** | Read-only health (pg_catalog + storage.buckets). The internal admin check is the real gate; the `authenticated` grant only lets the RPC be reached. |

### Non-DEFINER (SECURITY INVOKER) helpers — no elevated rights
| Function | Migration | EXECUTE | Why it is safe |
|---|---|---|---|
| `public.pci_apply_row(text,text,uuid,jsonb)` | 069 | **revoked from public/anon/authenticated; granted to no role** | Callable only from inside the two DEFINER RPCs, where it inherits the definer's rights. Dynamic SQL is bounded: (a) `p_table` is re-validated against a hard-coded 11-name whitelist and raises otherwise; (b) column identifiers come from `information_schema.columns` filtered to keys present in the payload; (c) **all values are passed as parameters (`$1`/`$2`) through `jsonb_populate_record` — no value is string-interpolated.** No injection surface from workbook content. |
| `public.pci_touch()` | 068 | trigger context | Sets `updated_at=now()`; no data access. |
| `public.pci_confidence_rank(text)` | 068 | immutable | Pure mapping. |
| `public.pci_target_table(text)` | 069 | immutable | Pure whitelist mapping (type→table name). |
| `public.pci_conf_col(text)` | 069 | immutable | Pure mapping (table→confidence column). |

---

## 2. Service-role Netlify functions

All live in `netlify/functions/`, are **POST-only**, and call
`requireAdmin(event)` (§6) before doing anything. The service-role key
(`SUPABASE_SERVICE_ROLE_KEY`) is read only inside
`lib/intelligence-auth.js → serviceClient()` and never returned to the client.
Every response carries `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow`.

| Function | DB access | Privileged action |
|---|---|---|
| `intelligence-import-preview.js` | service client (bypasses RLS) | Validates the `.xlsx` (extension/signature/size/macros), SHA-256 dedupe, uploads the original to the private bucket, and writes `pci_import_batches` + `pci_import_rows` with `status='previewed'`. **Does not touch live domain tables.** |
| `intelligence-import-commit.js` | `rpc('pci_commit_import_batch')` | Transactional apply of a previewed batch (+ conflict resolutions). |
| `intelligence-import-rollback.js` | `rpc('pci_rollback_import_batch')` | LIFO rollback of the most recent committed batch. |
| `intelligence-import-batch.js` | service client (read-only) | Returns one batch + its rows for the review UI / error report. |
| `intelligence-template.js` | none | Generates and returns the template workbook. |

Existing service-role functions in the repo (unchanged, for context):
`delete-user.js`, `create-checkout-session.js`, `create-portal-session.js`,
`verify-checkout-session.js`, `stripe-webhook.js`, `notify-*`, `run-health-check.js`,
`scheduled-health-check.js`, `send-health-report.js`.

---

## 3. All grants / revokes introduced (067–071)

```sql
-- 069
revoke all on function public.pci_apply_row(text, text, uuid, jsonb)        from public, anon, authenticated;
revoke all on function public.pci_commit_import_batch(uuid, uuid, jsonb)     from public, anon, authenticated;
revoke all on function public.pci_rollback_import_batch(uuid, uuid)          from public, anon, authenticated;
grant  execute on function public.pci_commit_import_batch(uuid, uuid, jsonb) to service_role;
grant  execute on function public.pci_rollback_import_batch(uuid, uuid)      to service_role;

-- 070
revoke all on function public.pci_check_schema() from public, anon;
grant  execute on function public.pci_check_schema() to authenticated, service_role;
```

- **067 grants nothing** — it adds columns, one FK, indexes, and a CHECK
  constraint to `crm_contacts`. The existing owner-scoped RLS (migration 020)
  automatically governs the new columns.
- **068 grants nothing at the function level** — table access is entirely via
  the RLS policies in §4. (`pci_touch`, `pci_confidence_rank` keep PostgreSQL's
  defaults; neither reads data.)
- **071 grants nothing at the function level.** `pci_is_staff()` /
  `pci_can_edit()` are read-only boolean helpers (like `is_admin_user()`) that
  keep PostgreSQL's default PUBLIC-EXECUTE; they leak nothing (they only read
  the caller's own profile row and return a boolean). All 071 access is via the
  added RLS policies in §4 — no `grant ... on table`, no `grant ... to anon`.
- No `grant ... to anon` anywhere in the module. No `grant ... on table` — all
  table access flows through RLS.

---

## 4. RLS policies

**Every `pci_` table** has RLS **enabled** and exactly one policy named
`<table>_admin_all`:

```sql
create policy <table>_admin_all on public.<table>
  for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
```

- Migration **068** (10 tables): `pci_properties`, `pci_property_contacts`,
  `pci_loans`, `pci_tenants`, `pci_listings`, `pci_distress_signals`,
  `pci_lender_programs`, `pci_sources`, `pci_scores`, `pci_daily_actions`.
- Migration **069** (4 tables): `pci_import_batches`, `pci_import_rows`,
  `pci_change_log`, `pci_entity_sources`.

**Migration 071** adds staff policies *alongside* (not replacing) the
`<table>_admin_all` policies. Since PostgreSQL **OR**s permissive policies, these
only widen access for staff:

```sql
-- all 14 tables: read for admin OR analyst
create policy <table>_staff_select on public.<table>
  for select to authenticated using (public.pci_is_staff());

-- pci_properties + pci_lender_programs ONLY: manual insert/update (never delete)
create policy <table>_staff_insert on public.<table>
  for insert to authenticated with check (public.pci_can_edit());
create policy <table>_staff_update on public.<table>
  for update to authenticated using (public.pci_can_edit()) with check (public.pci_can_edit());
```

Consequences:
- `anon` role matches **no** policy → denied on read and write (RLS default-deny;
  both `is_admin_user()` and `pci_is_staff()` return `false` for anon).
- `authenticated` non-staff (neither admin nor analyst) → every policy predicate
  is `false` → denied on read and write.
- **analyst**: `pci_is_staff()` → `true` so `SELECT` succeeds on all 14 tables;
  `pci_can_edit()` → `true` so `INSERT`/`UPDATE` succeed on `pci_properties` and
  `pci_lender_programs`. **DELETE** is covered by no analyst policy (only
  `admin_all`'s `USING`), so it silently affects 0 rows. Writes to the other 12
  tables match no `WITH CHECK` the analyst satisfies → `42501`.
- **admin**: covered by `admin_all` for everything, exactly as before 071.
- Only the `service_role` (used by the functions) bypasses RLS, and only after
  the function's own **full-admin** check.

**CRM (`crm_contacts`)**: RLS is unchanged from migration 020 —
`crm_contacts_all FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH
CHECK (owner_id = auth.uid())`. 067 adds columns/FK/index/CHECK only; the new
`linked_profile_id` FK is `ON DELETE SET NULL` (deleting a profile nulls the
link, never cascades a CRM contact away). No member emails are pulled into the
browser anymore (client fix in `js/crm/crm.js`).

---

## 5. Storage policies

Bucket **`capital-intelligence-private`**, created with `public = false` and
forced private on re-run (`on conflict … do update set public = false`).
Four policies on `storage.objects`, each scoped to the bucket **and** admin:

```sql
create policy "pci bucket admin select" on storage.objects for select to authenticated
  using (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
create policy "pci bucket admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
create policy "pci bucket admin update" on storage.objects for update to authenticated
  using       (bucket_id = 'capital-intelligence-private' and public.is_admin_user())
  with check  (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
create policy "pci bucket admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
```

- Paths: `imports/YYYY/MM/<checksum>-<file>` (originals, uploaded by the
  service role in preview) and `properties/{property_id}/<file>` (docs,
  uploaded by the admin's own session, RLS-checked).
- Browser access is via **short-lived signed URLs** (`createSignedUrl`, 600s)
  created by the admin session — a guessed object path returns nothing to a
  non-admin, and no object is public.
- These policies are additive to the bucket's own existing policies for other
  buckets (e.g. public `profile-media` is untouched).

---

## 6. JWT / admin validation flow

```
Browser (admin session)
  └─ intelligence-api.js fn(name, payload)
        Authorization: Bearer <Supabase session access_token (JWT)>
        │
        ▼
Netlify function  ── lib/intelligence-auth.js requireAdmin(event) ──────────────
  1. event.httpMethod !== 'POST'            → 405
  2. no Bearer token                        → 401
  3. serviceClient.auth.getUser(token)      → real uid (verified by Supabase);
        error/none                          → 401
  4. profiles.select(is_admin, role).eq(id,uid)  ; query error → 500
  5. isAdmin = is_admin===true OR role==='admin' ; false        → 403
        (NOTE: pci_role='analyst' is NOT admin here — analysts get 403 on
         every import function: preview, commit, rollback, batch, template.)
  6. return { uid, supabase: <service client> }
        │  (all responses: Cache-Control:no-store, X-Robots-Tag:noindex)
        ▼
Function body runs with the service client, then either:
  • writes staging rows directly (preview / batch-read), or
  • calls a service_role-only DEFINER RPC (commit / rollback), or
  • returns generated bytes (template).
```

Defense in depth (each layer independent):
1. **RLS** on every table + storage object — the real boundary. A signed-in
   non-admin (or anon) calling Supabase/PostgREST directly gets nothing.
2. **Function admin check** — `requireAdmin` re-derives the uid from the JWT
   and re-reads `profiles` live (no trust in client claims).
3. **RPC grants** — commit/rollback are `service_role`-only; `pci_check_schema`
   re-checks `is_admin_user()` internally.
4. **Page gates** (UX only) — `admin-intelligence.html` runs a store check
   (redirect signed-out users) **and** a live `PegIntelAPI.verifyStaff()` DB
   re-check that resolves the tier (`admin` / `analyst` / none) before
   rendering; non-staff are redirected. The tier only decides which controls
   render — bypassing it still yields no data an analyst couldn't already reach
   (layer 1 RLS). Import controls are hidden for analysts, and the functions
   reject them regardless (layer 2).
5. **Routing/headers** — `netlify.toml` serves the page `no-store` +
   `X-Robots-Tag: noindex,nofollow`; page `<meta robots noindex>`; no sitemap
   entry; sidebar/account-menu links render for staff (admins + analysts) only.

Input hardening:
- Workbook: `.xlsx` only; `.xls`/`.xlsm` rejected by name **and** by binary
  signature; `vbaProject` (macros) rejected by content scan; formulas rejected
  as data; ≤ 4 MB; SHA-256 duplicate-file guard (force-override explicit).
- Value normalization is server-side: currency/percent/int/date (with rollover
  rejection)/boolean/confidence-enum; **URLs restricted to `http(s)` — any
  other scheme (`javascript:`, `data:`, `file:` …) is rejected, never
  rewritten**; blanks stay NULL (never 0).
- Rendered text is escaped (`Pegasus.esc`) throughout the UI; CSV export
  prefixes `= + - @` cells to prevent spreadsheet formula injection.
- `batch_id` / resolution keys are validated as UUIDs before use.

Residual risks / accepted posture (unchanged platform decisions):
- **No enforcing site-wide CSP** — documented in `netlify.toml` (inline
  handlers/styles across the legacy site). XSS is mitigated by escaping +
  URL-scheme restriction; a Report-Only CSP is the recommended next step.
- **Preview writes with the service client** (bypasses RLS) — intentional, and
  only after `requireAdmin`; it writes staging rows, never live domain data.
- **Admin = `is_admin OR role='admin'`** in one place (`is_admin_user`,
  mirrored in `requireAdmin`). Granting admin is out of band (existing flow).

---

## 7. Manual staging tests required before production

Run these against a **staging Supabase project + Netlify deploy preview** with
migrations 067–071 applied there ONLY. Do not run against production. You need:
one admin account, one **analyst** account (`pci_role='analyst'`), one ordinary
(non-staff) member account, and the anon key.

### A. Migration & schema
1. Apply `067 → 068 → 069 → 070 → 071` in order in the staging SQL editor. Each
   must succeed and be **re-runnable** (run 068–071 a second time → no error).
2. As the admin (authenticated), `select public.pci_check_schema();` →
   `"ok": true`, all `missing_*` arrays empty, `private_bucket_ok: true`.
3. Confirm the bucket `capital-intelligence-private` exists and is **private**
   (Storage → bucket settings show "Private").

### B. Access control (the boundary)
4. Signed **out**, open `/admin/intelligence` → redirected to `/signin.html`;
   no intelligence data or table names visible in the DOM/network.
5. As a **non-admin** member, open `/admin/intelligence` → redirected to
   `/dashboard.html`.
6. As a **non-admin** member, from the browser console run
   `PegSB.ready.then(c=>c.from('pci_properties').select('*').limit(1)).then(console.log)`
   → `data: []` (or RLS error), never rows. Repeat for `pci_loans`,
   `pci_import_batches`, `pci_change_log`.
7. With the **anon** key (curl PostgREST):
   `GET /rest/v1/pci_properties?select=id` with `apikey: <anon>` →
   `[]` / permission error, never rows. Repeat for `pci_lender_programs`,
   `pci_scores`.
8. As the **admin**, open `/admin/intelligence` → app renders; sidebar shows
   "Capital Intelligence"; all seven tabs load without console errors.

### C. Function authorization
9. `POST /.netlify/functions/intelligence-import-commit` **without** an
   Authorization header → `401`. With a **malformed** token → `401`. With a
   **non-admin** member's valid JWT → `403`. (Repeat one call for
   `-preview`, `-rollback`, `-template`, `-batch`.)
10. `GET` (wrong method) on any `intelligence-*` function → `405`.
11. Confirm every function response includes `Cache-Control: no-store` and
    `X-Robots-Tag: noindex, nofollow` (browser dev-tools → Network → Headers).
12. Confirm `curl -I https://<preview>/admin/intelligence` returns
    `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

### D. Import happy path
13. Top of the page → **Download Import Template**; open it → 9 sheets +
    README, headers intact, no macros.
14. Add ONE property row (a fake staging address) + one contact + one loan
    referencing that property's key. Upload in **Import Center** → preview
    shows the expected `insert` counts, `0 invalid`, `0 conflict`.
15. **Approve & Commit** → success toast; the property appears in **Properties**;
    Property Detail → Debt shows the loan; Contacts tab maps the broker;
    Dashboard tiles increment; `pci_change_log` has `(created)` entries.
16. In Supabase, confirm the original file is stored under
    `capital-intelligence-private/imports/YYYY/MM/…`.

### E. Dedupe, conflict, confidence protection
17. Re-upload the **same file** → `409 duplicate file`; "Import anyway (force)"
    proceeds; re-preview shows all rows as **unchanged**.
18. Edit the committed property to `data_confidence = 'Verified'` (via the UI).
    Prepare a workbook that changes that property's `asking_price` with
    `Confidence = Estimated` → preview marks it a **conflict** (not an update).
    Commit with the conflict left as "Skip" → the Verified value is unchanged.
    Then re-commit choosing **Apply incoming** → value updates and a
    `pci_change_log` row records the confidence transition.
19. Change a **time-varying** field (e.g. `occupancy_pct`) at the **same**
    confidence → preview shows **update** (allowed); a **non-time-varying**
    field (e.g. `year_built`) at same confidence → **conflict**.
20. Put two rows with the same key in one file → both flagged **invalid**
    (duplicate in file), the rest still import.
20a. **Atomic commit.** Prepare a workbook with one valid property and one
    database-invalid property (e.g. `Opportunity_Score = 999`). Commit → the
    call **fails** naming the offending sheet/row, **zero** rows are inserted,
    no `pci_change_log` rows exist, and the batch stays `previewed` (nothing
    partially applied).
20b. **County / jurisdiction identity.** A workbook with the same `Parcel_ID`
    in Palm Beach and Broward → **two** distinct properties. The same
    `Instrument_Number` with two `Recording_Jurisdiction` values → **two**
    distinct loans. A child `Property_Key: parcel:{id}` that matches two
    counties → **invalid (ambiguous)**; `parcel:{county}:{id}` resolves.
20c. **Provenance.** After committing a row with a `Source_URL`, Property
    Detail → *Sources & Documents* lists the linked source, *Change History*
    links each change to its source, and `pci_entity_sources` + `pci_change_log.source_id` are populated.

### F. Rollback safety
21. Immediately after a commit, **Roll back** the batch → property/loan created
    by it are removed; import-changed columns of updated rows are restored;
    batch status `rolled_back`.
22. Commit batch X, then commit batch Y, then try to roll back **X** →
    **refused** with a "newer committed batch exists" message.
23. Commit a batch, then manually edit one affected property in the UI (writes
    no change-log row), then try to roll back that batch → **refused**
    ("records were modified after this import"), listing the exact blockers
    (table, id, changed fields). Restore the field to its committed value →
    rollback now **succeeds**. Delete an imported record, then roll back →
    **refused** ("record missing").

> The DB-level guarantees behind 20a, 23, the CRM merge, county/
> jurisdiction/provenance, and the analyst role (§F2) are also proven
> automatically by `qa/sql/pci-db-tests.sql` (run via
> `PCI_DB_TESTS=1 … npm run qa:intelligence` against a throwaway Postgres) —
> every assertion raises on regression.

### F2. Analyst role (migration 071)
First promote the analyst account:
`update public.profiles set pci_role='analyst' where lower(email)='<analyst>';`

23a. **Analyst reaches the app.** As the analyst, open `/admin/intelligence` →
    it renders (no redirect). The header shows an **Analyst** badge, there is
    **no** "Upload Daily Workbook" button, and there is **no Import Center** tab.
    The sidebar shows "Capital Intelligence" but **not** "Admin Console".
23b. **Analyst can read + manually edit.** Properties tab lists rows; open one →
    all sub-tabs load. Edit the property (Overview → Edit) and save → succeeds.
    Add a new property (+ Property) → succeeds. Lenders & Capital → add/edit a
    program → succeeds.
23c. **Analyst cannot do batch/privileged actions.** In Property Detail the
    Score tab has **no** "+ New score" button and Sources & Documents shows the
    linked sources but **no** document upload/open. From the console, the import
    functions reject the analyst:
    `PegIntelAPI.importCommit('00000000-0000-0000-0000-000000000000',{})` → `403`
    (repeat for `importPreview`, `importRollback`, `importTemplate`).
23d. **Analyst RLS backstop (bypass the UI).** From the analyst's console:
    `c.from('pci_loans').insert({property_id:'…',lender_name_snapshot:'x'})` →
    RLS error (no rows written); `c.from('pci_properties').delete().eq('id','…')`
    → 0 rows affected (row survives); `c.from('pci_properties').select('*')` →
    returns rows (read allowed). Repeat the insert-denied check for `pci_scores`.
23e. **Revoke.** `update public.profiles set pci_role=null where …;` → the
    analyst is now redirected to `/dashboard.html` and sees no `pci_` rows.

### G. Storage privacy
24. As admin, upload a document on a Property Detail → Sources & Documents;
    open it → works via a signed URL. Copy the raw object path.
25. As a **non-admin** (or anon), attempt to read that object path directly
    (Storage API / guessed public URL) → denied / 400, never the file.

### H. CRM fix & regression
26. As any member, CRM → **Add from Pegasus Network** → the picker loads,
    selecting a member **adds** them (previously failed); confirm the created
    `crm_contacts` row has `linked_profile_id` set and **no email** copied from
    the other member. Re-open the picker → that member shows "✓ in CRM".
26a. **Non-destructive CRM merge.** On a DB that has two `crm_contacts` linked
    to the same profile for one owner (with deals/reminders/activities on the
    newer one), applying 067 merges them into the **oldest** row: all fields
    preserved (blanks filled, tags unioned, notes concatenated), every
    dependent reassigned to the survivor, **nothing deleted or orphaned**, and
    the migration emits a `NOTICE` summary. It never runs a blind delete.
27. Open an existing contact created before 067 → still renders and saves
    (backward compatible); the new "More details" fields save when 067 is
    applied.
28. Load `/intelligence.html` (member Capital Intelligence Stream) → unchanged,
    no `pci_`/`PegIntel` references, still works.
29. `npm ci && npm run qa:intelligence` on the deploy → **PASS / FAIL 0**
    (offline suite). With `PCI_DB_TESTS=1` + PG env, the DB-proof section runs
    `qa/sql/pci-db-tests.sql` (atomic commit, edit-aware rollback, CRM merge,
    county + jurisdiction uniqueness, provenance, **analyst RLS**) — also green.
    With staging `SUPABASE_URL` + `SUPABASE_ANON_KEY`, the live anon-RLS probe
    passes too.

Only after A–H (incl. F2) pass on staging should migrations 067–071 be applied
to production and the branch merged.
