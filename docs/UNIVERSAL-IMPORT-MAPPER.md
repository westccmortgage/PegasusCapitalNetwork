# Universal Import Mapper

A shared framework that lets admins upload reasonable external CSV/XLSX files
and map them into a module's schema **without** the source using Pegasus
headers. Used by both **California Partner Network** and **Capital Intelligence**
— each keeps its own target schema, enum rules, dedupe keys, saved profiles,
import history, and commit pipeline. **Records never cross modules.**

Workflow: **Upload → Detect → Map → Normalize → Preview → Resolve → Commit.**

Open it from either Import Center → **Universal Import — map any CSV/XLSX**.

## How it works

The mapper is a *front end* that transforms an arbitrary file into the module's
**canonical contract shape**, then feeds the module's existing, already-proven
planner (dedupe / conflict / confidence) and atomic commit + edit-aware rollback
RPCs. So mapped imports inherit every guarantee native imports have.

```
file (CSV/XLSX)
  → extract sheets (table-safe + OOXML/namespace-normalized headers)
  → detect target entity per sheet (confidence; admin override)
  → auto-map columns (alias + fuzzy) ; admin remap / ignore / constant / combine
  → normalize values (enums: Priority A/High→1 ; Signal recent sale→closed_deal…)
  → canonical rows → module.planActions()  (native dedupe/conflict/provenance)
  → store batch + rows with provenance → module commit RPC (atomic) / rollback
```

Shared: parsing, OOXML normalization, entity detection, alias matching, the
transformation UI, provenance, and validation. Never shared: records, schema,
enums, dedupe keys, profiles, or history.

## Files

- `netlify/functions/lib/import-mapper-core.js` — engine (detect, alias+fuzzy
  map, enum transforms, fingerprint, fuzzy-dup, canonical builder, CSV parser).
- `netlify/functions/lib/import-mapper-schemas.js` — per-module descriptors
  (field aliases, required, enum rules, dedupe/detect hints) + `detectModule`.
- `netlify/functions/import-map-preview.js` — admin endpoint (detect + preview).
- `js/lib/import-mapper-ui.js` — `window.PegMapper` shared workflow UI.
- `supabase/075_pn_import_mapper.sql`, `supabase/076_pci_import_mapper.sql` —
  saved Import Profiles + per-row provenance columns (commit/rollback RPCs
  unchanged).

## Entity detection & column mapping

Each sheet is scored against every target entity by header/alias coverage
(required fields weighted) plus token hints; the top scorer is suggested with a
confidence, and the admin can override the entity. Columns auto-map by exact
alias, substring, token-Jaccard, and Levenshtein similarity. The mapping table
shows source column · target field · confidence · sample values · transform ·
required/optional, and supports **remap**, **ignore**, **set constant**, and
**combine** (map two source columns to one field — e.g. First + Last → Full
Name). Mappings can be **saved as a named Import Profile** and are auto-matched
to future files by header fingerprint or sheet-name hint.

## Value normalization (enums)

- **Priority**: A / High / Urgent / Top → 1 ; B / Medium / Normal → 2 ;
  C / Low / Later → 3.
- **Signal_Type**: recent sale / buyer closing / closed transaction →
  `closed_deal` ; new listing / just listed → `new_listing` ; price cut /
  reduction → `price_change` ; joined team → `team_move` ; moved brokerage →
  `brokerage_change` ; award / ranking → `award` ; article / announcement →
  `news` ; social post → `social`. Anything unmatched → `other` **with a
  warning**.

## Data quality (preview)

The preview reports new / updates / duplicates / **missing required (blocking)**
/ invalid enums / invalid emails / invalid phones / **fuzzy-duplicate warnings**
/ unresolved references. **Commit is blocked while any required value is
missing.** Fuzzy matches are **never auto-merged** — they are surfaced for
review.

## Deduplication

Exact-key dedupe is handled by each module's native planner:

- **Agents**: External_ID → License_Number → Email → Phone → normalized
  Full_Name + Company.
- **Escrow/Title**: External_ID → License_Number → Email → Phone → normalized
  Officer_Name + Company.
- **Companies**: External_ID → entity id → Website domain → normalized
  Company_Name + City.

Near-but-not-exact matches are flagged as fuzzy duplicates for admin review,
never merged automatically.

## Provenance

Every mapped row retains: original filename (batch), original sheet, source row
number, original raw row JSON (`source_raw`), the Import Profile, the mapping
version, `imported_by` (uploader) and `imported_at`. The original file and the
mapping report are preserved in the batch (private storage + `mapping` jsonb).

## Wrong-module protection

On upload the file is scored against both modules. If it clearly belongs to the
other module (or carries the other module's exact Pegasus headers) the mapper
shows *“This workbook appears to belong to [module]. Open the correct
importer.”* An admin may **override** only for a generic contact file, after
manually choosing the target entity.

## Security

Unchanged: admin JWT (`requireAdmin`), file extension/signature/size checks,
macro (`vbaProject`) rejection, **formula rejection** (formula cells are dropped
with a warning — never imported as data), URL scheme validation (via the
module's normalizer), admin-only RLS, private storage, and audit logging. CSV is
accepted (size-limited); its values are treated as data only.

## QA

`npm run qa:mapper` (47 checks): exact Pegasus template, ChatGPT-style headers,
LinkedIn CSV (combine), DRE export, missing required, invalid enums, duplicate
licenses, fuzzy-duplicate warning, saved-profile reuse, malformed table
relationships, namespace-prefixed XLSX, wrong-module guard + override,
provenance shaping, and the Capital Intelligence descriptor. Atomic commit +
edit-aware rollback for **mapped** rows are proven at the DB layer in
`qa/sql/pn-db-tests.sql` (block **PN-MAP**).
