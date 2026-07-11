-- ============================================================================
-- 068 — Pegasus Capital Intelligence: private core data model (pci_*)
--
-- Admin-only operating system for daily CRE acquisition/debt intelligence.
-- First market: Palm Beach County FL retail centers (~$4–7M). Extensible.
--
-- SECURITY MODEL (v1): every pci_ table is RLS-enabled with a single policy —
-- public.is_admin_user() for SELECT/INSERT/UPDATE/DELETE. No anon access, no
-- ordinary-member access, even with direct Supabase calls. The service role
-- (Netlify import functions) bypasses RLS by design after its own admin check.
--
-- DATA HONESTY: unknown values stay NULL. data_confidence is one of
-- Verified / Reported / Estimated / Unknown. Source + last-verified metadata
-- accompany material data. History lives in pci_change_log (069), scores in
-- pci_scores — never overwritten in place.
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. Requires 011 (is_admin_user)
-- and 020/067 (crm_contacts). No changes to existing tables.
-- ============================================================================
create extension if not exists pgcrypto;

-- Shared touch trigger for pci tables.
create or replace function public.pci_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Confidence vocabulary helper (used in CHECKs; keep in sync with import core).
-- 'Verified' > 'Reported' > 'Estimated' > 'Unknown'
create or replace function public.pci_confidence_rank(p text) returns int
language sql immutable as $$
  select case p when 'Verified' then 4 when 'Reported' then 3
                when 'Estimated' then 2 when 'Unknown' then 1 else 0 end
$$;

-- ── A. pci_properties — canonical current snapshot per tracked property ──────
create table if not exists public.pci_properties(
  id                       uuid primary key default gen_random_uuid(),
  external_id              text,
  property_name            text,
  address_line1            text not null,
  normalized_address       text not null,
  city                     text not null,
  state                    text not null default 'FL',
  postal_code              text,
  county                   text,
  parcel_id                text,
  latitude                 numeric,
  longitude                numeric,
  property_type            text not null default 'retail',
  property_subtype         text,
  building_sf              numeric,
  land_acres               numeric,
  year_built               integer,
  asking_price             numeric,
  noi                      numeric,
  cap_rate_pct             numeric,
  occupancy_pct            numeric,
  tenant_count             integer,
  anchor_tenant            text,
  listing_status           text,
  listing_url              text,
  first_seen_at            date,
  last_seen_at             date,
  last_verified_at         timestamptz,
  opportunity_score        integer check (opportunity_score is null or (opportunity_score between 0 and 100)),
  recommendation           text check (recommendation is null or recommendation in ('Act Now','Watch Closely','Pass','Unscored')),
  refinance_pressure_score integer check (refinance_pressure_score is null or (refinance_pressure_score between 0 and 100)),
  notes                    text,
  data_confidence          text check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown')),
  created_by               uuid,
  updated_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- Dedupe priority: parcel_id → external_id → normalized address. Partial unique
-- indexes enforce each key when present without merging separate parcels.
create unique index if not exists uq_pci_prop_parcel
  on public.pci_properties((coalesce(county,'')), parcel_id) where parcel_id is not null;
create unique index if not exists uq_pci_prop_external
  on public.pci_properties(external_id) where external_id is not null and parcel_id is null;
create unique index if not exists uq_pci_prop_addr
  on public.pci_properties(normalized_address) where parcel_id is null and external_id is null;
create index if not exists idx_pci_prop_city     on public.pci_properties(city);
create index if not exists idx_pci_prop_status   on public.pci_properties(listing_status);
create index if not exists idx_pci_prop_score    on public.pci_properties(opportunity_score desc nulls last);
create index if not exists idx_pci_prop_reco     on public.pci_properties(recommendation);
create index if not exists idx_pci_prop_updated  on public.pci_properties(updated_at desc);
drop trigger if exists trg_pci_properties_touch on public.pci_properties;
create trigger trg_pci_properties_touch before update on public.pci_properties
  for each row execute function public.pci_touch();

-- ── B. pci_property_contacts — junction to the CRM relationship layer ────────
create table if not exists public.pci_property_contacts(
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.pci_properties(id) on delete cascade,
  crm_contact_id   uuid not null references public.crm_contacts(id) on delete cascade,
  relationship_role text not null check (relationship_role in
    ('owner_entity','principal','listing_broker','leasing_broker','property_manager',
     'current_lender','attorney','title_contact','other')),
  is_primary       boolean not null default false,
  confidence       text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url       text,
  last_verified_at timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_pci_prop_contact_role
  on public.pci_property_contacts(property_id, crm_contact_id, relationship_role);
create index if not exists idx_pci_pc_contact on public.pci_property_contacts(crm_contact_id);
drop trigger if exists trg_pci_property_contacts_touch on public.pci_property_contacts;
create trigger trg_pci_property_contacts_touch before update on public.pci_property_contacts
  for each row execute function public.pci_touch();

-- ── C. pci_loans ─────────────────────────────────────────────────────────────
create table if not exists public.pci_loans(
  id                   uuid primary key default gen_random_uuid(),
  external_id          text,
  property_id          uuid not null references public.pci_properties(id) on delete cascade,
  lender_contact_id    uuid references public.crm_contacts(id) on delete set null,
  lender_name_snapshot text,
  lien_position        integer,
  original_amount      numeric,
  recorded_date        date,
  instrument_number    text,
  -- Recording jurisdiction (usually the county where the instrument was
  -- recorded). Instrument numbers are unique only WITHIN a jurisdiction, so
  -- loan identity is (recording_jurisdiction, instrument_number). Stored
  -- explicitly; the importer infers it from the property's county when blank.
  recording_jurisdiction text,
  estimated_balance    numeric,
  interest_rate_pct    numeric,
  rate_type            text,
  maturity_date        date,
  maturity_basis       text check (maturity_basis is null or maturity_basis in ('Verified','Reported','Estimated','Unknown')),
  loan_type            text,
  recourse             text,
  dscr                 numeric,
  ltv_pct              numeric,
  status               text,
  confidence           text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url           text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Dedupe priority: (recording_jurisdiction, instrument_number) → external_id
-- → property+lender+date+amount. The same instrument number recorded in two
-- different counties is TWO distinct loans.
create unique index if not exists uq_pci_loan_instrument
  on public.pci_loans((lower(btrim(coalesce(recording_jurisdiction,'')))), instrument_number)
  where instrument_number is not null;
create unique index if not exists uq_pci_loan_external
  on public.pci_loans(external_id) where external_id is not null and instrument_number is null;
create index if not exists idx_pci_loans_property on public.pci_loans(property_id);
create index if not exists idx_pci_loans_maturity on public.pci_loans(maturity_date);
drop trigger if exists trg_pci_loans_touch on public.pci_loans;
create trigger trg_pci_loans_touch before update on public.pci_loans
  for each row execute function public.pci_touch();

-- ── D. pci_tenants ───────────────────────────────────────────────────────────
create table if not exists public.pci_tenants(
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.pci_properties(id) on delete cascade,
  tenant_name      text not null,
  suite            text,
  leased_sf        numeric,
  lease_start      date,
  lease_expiration date,
  annual_rent      numeric,
  market_rent      numeric,
  category         text,
  credit_quality   text,
  rollover_risk    text,
  confidence       text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url       text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_pci_tenant
  on public.pci_tenants(property_id, tenant_name, (coalesce(suite,'')));
create index if not exists idx_pci_tenants_exp on public.pci_tenants(lease_expiration);
drop trigger if exists trg_pci_tenants_touch on public.pci_tenants;
create trigger trg_pci_tenants_touch before update on public.pci_tenants
  for each row execute function public.pci_touch();

-- ── E. pci_listings — listing EVENTS, separate from the property snapshot ────
create table if not exists public.pci_listings(
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.pci_properties(id) on delete cascade,
  listing_source    text,
  listing_url       text,
  broker_contact_id uuid references public.crm_contacts(id) on delete set null,
  asking_price      numeric,
  listing_status    text,
  listed_on         date,
  changed_on        date,
  withdrawn_on      date,
  source_url        text,
  confidence        text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_pci_listings_prop on public.pci_listings(property_id, changed_on desc);
drop trigger if exists trg_pci_listings_touch on public.pci_listings;
create trigger trg_pci_listings_touch before update on public.pci_listings
  for each row execute function public.pci_touch();

-- ── F. pci_distress_signals ──────────────────────────────────────────────────
create table if not exists public.pci_distress_signals(
  id                    uuid primary key default gen_random_uuid(),
  external_id           text,
  property_id           uuid references public.pci_properties(id) on delete cascade,
  signal_type           text not null check (signal_type in
    ('foreclosure','lis_pendens','bankruptcy','tax_lien','code_violation','ucc',
     'receiver','delinquency','maturity_pressure','price_reduction','withdrawn_relisted','other')),
  event_date            date,
  status                text,
  case_or_instrument_no text,
  amount                numeric,
  summary               text,
  confidence            text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url            text,
  source_title          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_pci_signal_external
  on public.pci_distress_signals(external_id) where external_id is not null;
create unique index if not exists uq_pci_signal_natural
  on public.pci_distress_signals(property_id, signal_type, (coalesce(event_date,'1900-01-01'::date)), (coalesce(case_or_instrument_no,'')))
  where external_id is null and property_id is not null;
create index if not exists idx_pci_signals_prop on public.pci_distress_signals(property_id, event_date desc);
drop trigger if exists trg_pci_distress_touch on public.pci_distress_signals;
create trigger trg_pci_distress_touch before update on public.pci_distress_signals
  for each row execute function public.pci_touch();

-- ── G. pci_lender_programs — internal researched capital-source matrix ───────
-- Separate from member-facing lender_appetite_profiles by design.
create table if not exists public.pci_lender_programs(
  id                     uuid primary key default gen_random_uuid(),
  external_id            text,
  lender_contact_id      uuid references public.crm_contacts(id) on delete set null,
  lender_name_snapshot   text not null,
  program_name           text,
  capital_source_type    text,
  florida_appetite       text,   -- 'Yes' / 'No' / 'Selective' / null=unknown
  retail_appetite        text,
  stabilized_or_value_add text,
  min_loan               numeric,
  max_loan               numeric,
  max_ltv_pct            numeric,
  max_ltc_pct            numeric,
  min_dscr               numeric,
  recourse               text,
  interest_only          text,
  term_months            integer,
  amortization_years     integer,
  rate_guidance          text,
  fees                   text,
  prepayment             text,
  active_status          text not null default 'active',
  last_verified_at       timestamptz,
  confidence             text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url             text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists uq_pci_program_external
  on public.pci_lender_programs(external_id) where external_id is not null;
create unique index if not exists uq_pci_program_natural
  on public.pci_lender_programs(lender_name_snapshot, (coalesce(program_name,''))) where external_id is null;
create index if not exists idx_pci_programs_active on public.pci_lender_programs(active_status);
drop trigger if exists trg_pci_programs_touch on public.pci_lender_programs;
create trigger trg_pci_programs_touch before update on public.pci_lender_programs
  for each row execute function public.pci_touch();

-- ── H. pci_sources — research provenance ─────────────────────────────────────
create table if not exists public.pci_sources(
  id                    uuid primary key default gen_random_uuid(),
  source_url            text,
  normalized_url        text,
  source_title          text,
  publisher             text,
  source_type           text,
  source_date           date,
  retrieved_at          timestamptz,
  reliability_level     text,
  excerpt_or_summary    text,
  private_document_path text,   -- path inside the private bucket (070)
  checksum              text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_pci_source_url
  on public.pci_sources(normalized_url) where normalized_url is not null;
create unique index if not exists uq_pci_source_checksum
  on public.pci_sources(checksum) where checksum is not null and normalized_url is null;
drop trigger if exists trg_pci_sources_touch on public.pci_sources;
create trigger trg_pci_sources_touch before update on public.pci_sources
  for each row execute function public.pci_touch();

-- ── I. pci_scores — score HISTORY (never overwritten) ────────────────────────
create table if not exists public.pci_scores(
  id                          uuid primary key default gen_random_uuid(),
  property_id                 uuid not null references public.pci_properties(id) on delete cascade,
  score_date                  date not null default current_date,
  location_score              integer check (location_score is null or location_score between 0 and 15),
  tenant_quality_score        integer check (tenant_quality_score is null or tenant_quality_score between 0 and 15),
  cash_flow_score             integer check (cash_flow_score is null or cash_flow_score between 0 and 15),
  pricing_score               integer check (pricing_score is null or pricing_score between 0 and 15),
  distress_refinance_score    integer check (distress_refinance_score is null or distress_refinance_score between 0 and 20),
  upside_score                integer check (upside_score is null or upside_score between 0 and 10),
  financing_feasibility_score integer check (financing_feasibility_score is null or financing_feasibility_score between 0 and 10),
  total_score                 integer not null check (total_score between 0 and 100),
  recommendation              text not null check (recommendation in ('Act Now','Watch Closely','Pass','Unscored')),
  override_reason             text,
  rationale                   text,
  batch_id                    uuid,
  created_by                  uuid,
  created_at                  timestamptz not null default now(),
  -- When all components are present, the total must be their sum.
  constraint pci_scores_component_sum check (
    location_score is null or tenant_quality_score is null or cash_flow_score is null
    or pricing_score is null or distress_refinance_score is null or upside_score is null
    or financing_feasibility_score is null
    or total_score = location_score + tenant_quality_score + cash_flow_score
                   + pricing_score + distress_refinance_score + upside_score
                   + financing_feasibility_score),
  -- Default thresholds: 80–100 Act Now · 60–79 Watch Closely · 0–59 Pass.
  -- An admin may override ONLY with a stored reason.
  constraint pci_scores_reco_thresholds check (
    override_reason is not null
    or recommendation = case when total_score >= 80 then 'Act Now'
                             when total_score >= 60 then 'Watch Closely'
                             else 'Pass' end)
);
create index if not exists idx_pci_scores_prop on public.pci_scores(property_id, score_date desc);

-- ── J. pci_daily_actions ─────────────────────────────────────────────────────
create table if not exists public.pci_daily_actions(
  id           uuid primary key default gen_random_uuid(),
  priority     integer,
  action_type  text,
  property_id  uuid references public.pci_properties(id) on delete set null,
  contact_id   uuid references public.crm_contacts(id) on delete set null,
  due_date     date,
  action       text not null,
  reason       text,
  status       text not null default 'open' check (status in ('open','done','dismissed')),
  notes        text,
  batch_id     uuid,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_pci_actions_open on public.pci_daily_actions(status, priority, due_date);

-- ── RLS: admin-only on every pci_ table ──────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'pci_properties','pci_property_contacts','pci_loans','pci_tenants',
    'pci_listings','pci_distress_signals','pci_lender_programs','pci_sources',
    'pci_scores','pci_daily_actions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;
