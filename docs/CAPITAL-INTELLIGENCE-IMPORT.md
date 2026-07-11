# Capital Intelligence — Daily Workbook Contract

One `.xlsx` workbook per day, uploaded manually in **Capital Intelligence →
Import Center**. Download the always-current template with **Download Import
Template** — it is generated from the same contract the importer uses.

## Global rules

- **File**: `.xlsx` only, max **4MB**. Macro-enabled (`.xlsm`) and legacy
  (`.xls`) files are rejected. **No formulas** — paste values only.
- **Sheets/headers**: names below, matched case- and spacing-insensitively.
  Extra sheets (e.g. your own notes) are ignored. All sheets are optional, but
  the file must contain at least one recognized sheet with data.
- **Confidence** is always one of: `Verified`, `Reported`, `Estimated`,
  `Unknown`. Verified > Reported > Estimated > Unknown. A lower-confidence
  value never silently overwrites a higher-confidence one — it becomes a
  conflict you resolve on the preview screen.
- **Blank = unknown.** Blank cells stay NULL; they never overwrite existing
  values and are never converted to 0.
- **Percent** columns accept `6.5` or `0.065` (both = 6.5%). Values in (0,1]
  are treated as fractions.
- **Currency** may include `$` and commas: `$5,250,000`.
- **Dates**: `YYYY-MM-DD` or `MM/DD/YYYY` (stored as ISO).
- **Booleans**: `true/false`, `yes/no`, `1/0`.
- **Duplicate protection**: the exact same file (checksum) is refused unless
  you force it; duplicate rows inside one file are marked invalid.
- **Excel Tables are ignored.** Before parsing, the importer strips any Excel
  table objects (table parts, `tableParts`, table relationships, and their
  content-type overrides) so a malformed or dangling table relationship cannot
  crash the reader. Your cell values, styles, data validations, hyperlinks, and
  formula/security checks are untouched — only the table wrapper is removed.

## Keys

- **Property_Key** — how other sheets point at a property. Priority:
  1. `Parcel_ID` (best), 2. `External_ID`, 3. the full street address.
  You may also write explicitly: `parcel:{county}:{id}`, `ext:PBC-0007`, or
  `addr:123 Example St`. A property that is **new in the same file** can be
  referenced by the same key — the importer wires the rows together.
  - **Parcel identity is county-scoped.** The same parcel number in two
    counties is two different properties. A bare `parcel:00-42` (no county)
    resolves only if that parcel exists in exactly one tracked county; if it
    exists in several, the row is rejected as **ambiguous** — qualify it as
    `parcel:Broward:00-42`. Parcel keys on the **Properties** sheet take the
    county from that row's `County` column (default **Palm Beach**).
- **Contact_Key** — priority: 1. email, 2. `External_ID` (`ext:…`),
  3. `Name | Company` (`name:Jane Smith | Acme`). A bare value containing `@`
  is treated as an email.

## Sheets

### 1) Properties → `pci_properties`
`External_ID, Property_Name, Address, City, State, ZIP, County, Parcel_ID,
Latitude, Longitude, Property_Subtype, Building_SF, Land_Acres, Year_Built,
Asking_Price, NOI, Cap_Rate_Pct, Occupancy_Pct, Tenant_Count, Anchor_Tenant,
Listing_Status, Listing_URL, First_Seen_Date, Last_Seen_Date,
Opportunity_Score, Recommendation, Notes, Confidence, Source_URL,
Source_Title, Source_Date`

- Required: `Address`, `City`. County defaults to `Palm Beach`, State to `FL`.
- `Recommendation` (if given): `Act Now` / `Watch Closely` / `Pass` /
  `Unscored`. With an `Opportunity_Score`, a score-history row is recorded;
  if your recommendation differs from the thresholds (80/60), it is stored
  with an explicit override note.
- A changed `Asking_Price` or `Listing_Status` automatically records a
  listing event (price history timeline).

### 2) Property_Updates → field-level changes to `pci_properties`
`Property_Key, Field_Name, New_Value, Value_Type, Effective_Date, Confidence,
Source_URL, Source_Title, Notes`

- Updatable `Field_Name`s: `asking_price, noi, cap_rate_pct, occupancy_pct,
  tenant_count, anchor_tenant, listing_status, listing_url, last_seen_at,
  refinance_pressure_score, notes, property_name, building_sf, land_acres,
  year_built`.
- Record only genuine changes; identical values are reported as “unchanged”.

### 3) Contacts → existing CRM (`crm_contacts`)
`External_ID, Name, Company, Job_Title, Contact_Type, Email, Phone, Website,
LinkedIn_URL, City, State, Tags, Notes, Confidence, Last_Verified_Date,
Source_URL`

- Required: `Name`. Tags are comma-separated.
- Created contacts are owned by the importing admin, `source='import'`;
  `External_ID` is kept in `metadata.external_id` for future dedupe.

### 4) Property_Contacts → `pci_property_contacts`
`Property_Key, Contact_Key, Relationship_Role, Is_Primary, Confidence,
Source_URL`

- `Relationship_Role`: `owner_entity, principal, listing_broker,
  leasing_broker, property_manager, current_lender, attorney, title_contact,
  other`.

### 5) Loans → `pci_loans`
`External_ID, Property_Key, Lender_Contact_Key, Lien_Position,
Original_Amount, Recorded_Date, Instrument_Number, Recording_Jurisdiction,
Estimated_Balance, Interest_Rate_Pct, Rate_Type, Maturity_Date,
Maturity_Basis, Loan_Type, Recourse, DSCR, LTV_Pct, Status, Confidence,
Source_URL, Notes`

- Required: `Property_Key`. `Maturity_Basis` uses the confidence vocabulary.
- **`Recording_Jurisdiction`** (usually the county where the instrument was
  recorded). Instrument numbers are unique only **within a jurisdiction**, so
  loan identity is `(Recording_Jurisdiction, Instrument_Number)` — the same
  instrument number in Palm Beach and Broward is two different loans. If left
  blank it is **inferred from the property's county** and stored explicitly.
- Dedupe: `(Recording_Jurisdiction, Instrument_Number)` → `External_ID` →
  property+lender+date+amount.
- `Lender_Contact_Key` may be a Contact_Key or a plain lender name (stored as
  a snapshot when no CRM contact matches).

### 6) Tenants → `pci_tenants`
`Property_Key, Tenant_Name, Suite, Leased_SF, Lease_Start, Lease_Expiration,
Annual_Rent, Market_Rent, Category, Credit_Quality, Rollover_Risk,
Confidence, Source_URL, Notes`

- Dedupe: property + tenant + suite.

### 7) Distress_Signals → `pci_distress_signals`
`External_ID, Property_Key, Signal_Type, Event_Date, Status,
Case_or_Instrument_No, Amount, Summary, Confidence, Source_URL, Source_Title`

- `Signal_Type`: `foreclosure, lis_pendens, bankruptcy, tax_lien,
  code_violation, ucc, receiver, delinquency, maturity_pressure,
  price_reduction, withdrawn_relisted, other`.

### 8) Lender_Programs → `pci_lender_programs`
`External_ID, Lender_Contact_Key, Program_Name, Capital_Source_Type,
Florida_Appetite, Retail_Appetite, Stabilized_or_Value_Add, Min_Loan,
Max_Loan, Max_LTV_Pct, Max_LTC_Pct, Min_DSCR, Recourse, Interest_Only,
Term_Months, Amortization_Years, Rate_Guidance, Fees, Prepayment,
Active_Status, Last_Verified_Date, Confidence, Source_URL, Notes`

- Required: `Lender_Contact_Key`. Appetites read best as `Yes` / `No` /
  `Selective`. Programs unverified for 90+ days are flagged stale in the UI.

### 9) Daily_Actions → `pci_daily_actions`
`Priority, Action_Type, Property_Key, Contact_Key, Due_Date, Action, Reason,
Notes`

- Required: `Action`. Identical still-open actions are skipped (no daily
  duplicates). Priority 1 = highest.

## Sources & lineage

Every sheet’s `Source_URL` (+ `Source_Title`, `Source_Date` where present)
is collected into `pci_sources`, deduplicated by normalized URL — provenance
is preserved once per source. Each imported property, loan, tenant, distress
signal, lender program, and property-update is then **linked to that source**
via `pci_entity_sources`, and every field change records its source in
`pci_change_log.source_id`. Property Detail → *Sources & Documents* lists the
linked sources, and *Change History* links each change back to where it came
from.

## The import lifecycle

1. **Preview** — validation, dedupe, and a full plan (new / updates /
   unchanged / conflicts / invalid). Nothing is applied. The original file is
   stored privately under `imports/YYYY/MM/`.
2. **Resolve** — for each conflict: *Skip (decide later)* · *Keep existing* ·
   *Apply incoming*.
3. **Approve & Commit** — **atomic**: the whole batch applies in one
   transaction or nothing does. Any row that fails at the database aborts the
   entire commit (no partial import, batch stays *previewed*, error names the
   sheet + row). Full change log; Verified data protected.
4. **Roll back** — last committed batch only, and only if nothing it touched
   was modified afterwards. Safety is checked by comparing each live record to
   the exact state the import committed (not the change log), so **manual admin
   edits are detected** even though they write no change-log row; otherwise the
   system refuses and lists the exact blockers (table, id, changed fields).
5. **Report** — per-row CSV report downloadable for any batch.

## QA fixture

`qa/intelligence-audit.js` builds an in-memory sanitized fixture workbook
(obviously fake QA values) and runs it through the real parser and planner —
`npm run qa:intelligence`.
