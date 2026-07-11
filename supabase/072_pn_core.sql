-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — core data model (private admin module)
-- Migration 072. ADDITIVE + IDEMPOTENT. Safe to run repeatedly.
-- Requires 011 (is_admin_user). Independent of the Capital Intelligence pci_*
-- tables — partner records never mix with properties, loans, tenants, or
-- lender programs.
--
-- SECURITY MODEL: every pn_ table is RLS-enabled with a single admin-only
-- policy using public.is_admin_user() for SELECT/INSERT/UPDATE/DELETE. No anon
-- access; no analyst tier (this module is full-admin only).
--
-- CRM: partner people may be LINKED to an existing crm_contacts row (by email)
-- via linked_contact_id, but this module never CREATES crm_contacts and never
-- creates borrower records.
-- ============================================================================

-- Shared helpers (namespaced; independent of the pci_ equivalents) ────────────
create or replace function public.pn_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.pn_confidence_rank(c text) returns int
language sql immutable as $$
  select case c when 'Verified' then 4 when 'Reported' then 3
                when 'Estimated' then 2 when 'Unknown' then 1 else 0 end
$$;

-- ── A. pn_companies — brokerages / escrow / title / lender orgs ───────────────
create table if not exists public.pn_companies(
  id                uuid primary key default gen_random_uuid(),
  external_id       text,
  company_name      text not null,
  company_type      text,   -- brokerage / escrow / title / lender / team / other
  address_line1     text,
  city              text,
  state             text default 'CA',
  postal_code       text,
  phone             text,
  email             text,
  website           text,
  agent_count       integer,
  specialty         text,
  active_status     text not null default 'active',
  notes             text,
  data_confidence   text check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url        text,
  last_verified_at  timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_pn_company_external
  on public.pn_companies(external_id) where external_id is not null;
create unique index if not exists uq_pn_company_natural
  on public.pn_companies((upper(regexp_replace(company_name,'[^A-Za-z0-9]','','g'))),
                          (upper(regexp_replace(coalesce(city,''),'[^A-Za-z0-9]','','g'))))
  where external_id is null;
create index if not exists idx_pn_companies_type on public.pn_companies(company_type);
drop trigger if exists trg_pn_companies_touch on public.pn_companies;
create trigger trg_pn_companies_touch before update on public.pn_companies
  for each row execute function public.pn_touch();

-- ── B. pn_agents — real-estate agents / partners ─────────────────────────────
create table if not exists public.pn_agents(
  id                    uuid primary key default gen_random_uuid(),
  external_id           text,
  full_name             text not null,
  company_name_snapshot text,
  company_id            uuid references public.pn_companies(id) on delete set null,
  license_number        text,
  job_title             text,
  email                 text,
  phone                 text,
  website               text,
  city                  text,
  state                 text default 'CA',
  specialty             text,
  production_volume     numeric,
  deal_count            integer,
  status                text not null default 'active',
  tags                  text[] not null default '{}',
  notes                 text,
  linked_contact_id     uuid references public.crm_contacts(id) on delete set null,
  data_confidence       text check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url            text,
  last_verified_at      timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_pn_agent_external
  on public.pn_agents(external_id) where external_id is not null;
create unique index if not exists uq_pn_agent_email
  on public.pn_agents(lower(email)) where email is not null and external_id is null;
create unique index if not exists uq_pn_agent_license
  on public.pn_agents(upper(regexp_replace(license_number,'[^A-Za-z0-9]','','g')))
  where license_number is not null and email is null and external_id is null;
create index if not exists idx_pn_agents_company on public.pn_agents(company_id);
create index if not exists idx_pn_agents_status on public.pn_agents(status);
drop trigger if exists trg_pn_agents_touch on public.pn_agents;
create trigger trg_pn_agents_touch before update on public.pn_agents
  for each row execute function public.pn_touch();

-- ── C. pn_escrow_title — escrow & title officers ─────────────────────────────
create table if not exists public.pn_escrow_title(
  id                    uuid primary key default gen_random_uuid(),
  external_id           text,
  officer_name          text not null,
  company_name_snapshot text,
  company_id            uuid references public.pn_companies(id) on delete set null,
  role                  text,   -- escrow_officer / title_officer / other
  license_number        text,
  email                 text,
  phone                 text,
  city                  text,
  state                 text default 'CA',
  transaction_volume    numeric,
  status                text not null default 'active',
  tags                  text[] not null default '{}',
  notes                 text,
  linked_contact_id     uuid references public.crm_contacts(id) on delete set null,
  data_confidence       text check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url            text,
  last_verified_at      timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_pn_escrow_external
  on public.pn_escrow_title(external_id) where external_id is not null;
create unique index if not exists uq_pn_escrow_email
  on public.pn_escrow_title(lower(email)) where email is not null and external_id is null;
create unique index if not exists uq_pn_escrow_natural
  on public.pn_escrow_title((upper(regexp_replace(officer_name,'[^A-Za-z0-9]','','g'))),
                            (upper(regexp_replace(coalesce(company_name_snapshot,''),'[^A-Za-z0-9]','','g'))))
  where external_id is null and email is null;
create index if not exists idx_pn_escrow_company on public.pn_escrow_title(company_id);
drop trigger if exists trg_pn_escrow_touch on public.pn_escrow_title;
create trigger trg_pn_escrow_touch before update on public.pn_escrow_title
  for each row execute function public.pn_touch();

-- ── D. pn_activity_signals — market activity per agent/company ────────────────
create table if not exists public.pn_activity_signals(
  id            uuid primary key default gen_random_uuid(),
  external_id   text,
  subject_type  text,   -- agent / company / escrow / other
  subject_name  text not null,
  agent_id      uuid references public.pn_agents(id) on delete set null,
  company_id    uuid references public.pn_companies(id) on delete set null,
  signal_type   text not null,
  signal_date   date,
  detail        text,
  url           text,
  confidence    text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  source_url    text,
  source_title  text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_pn_signal_external
  on public.pn_activity_signals(external_id) where external_id is not null;
create unique index if not exists uq_pn_signal_natural
  on public.pn_activity_signals((upper(regexp_replace(subject_name,'[^A-Za-z0-9]','','g'))),
                                signal_type, (coalesce(signal_date,'1900-01-01'::date)))
  where external_id is null;
create index if not exists idx_pn_signal_agent on public.pn_activity_signals(agent_id);
create index if not exists idx_pn_signal_date on public.pn_activity_signals(signal_date desc);
drop trigger if exists trg_pn_signal_touch on public.pn_activity_signals;
create trigger trg_pn_signal_touch before update on public.pn_activity_signals
  for each row execute function public.pn_touch();

-- ── E. pn_outreach_actions — prioritized outreach queue ──────────────────────
create table if not exists public.pn_outreach_actions(
  id            uuid primary key default gen_random_uuid(),
  external_id   text,
  priority      integer,
  action_type   text,
  subject_type  text,
  subject_name  text not null,
  agent_id      uuid references public.pn_agents(id) on delete set null,
  company_id    uuid references public.pn_companies(id) on delete set null,
  channel       text,
  due_date      date,
  action        text not null,
  reason        text,
  status        text not null default 'open',
  notes         text,
  created_by    uuid,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_pn_outreach_external
  on public.pn_outreach_actions(external_id) where external_id is not null;
create index if not exists idx_pn_outreach_open
  on public.pn_outreach_actions(status, priority, due_date);
drop trigger if exists trg_pn_outreach_touch on public.pn_outreach_actions;
create trigger trg_pn_outreach_touch before update on public.pn_outreach_actions
  for each row execute function public.pn_touch();

-- ── F. pn_do_not_contact — suppression list ──────────────────────────────────
create table if not exists public.pn_do_not_contact(
  id                    uuid primary key default gen_random_uuid(),
  external_id           text,
  subject_type          text,   -- agent / company / person
  subject_name          text not null,
  company_name_snapshot text,
  email                 text,
  phone                 text,
  scope                 text not null default 'all',  -- email / phone / all
  reason                text not null,
  effective_date        date,
  expires_date          date,
  source_url            text,
  notes                 text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_pn_dnc_external
  on public.pn_do_not_contact(external_id) where external_id is not null;
create unique index if not exists uq_pn_dnc_email
  on public.pn_do_not_contact(lower(email)) where email is not null and external_id is null;
create unique index if not exists uq_pn_dnc_natural
  on public.pn_do_not_contact((upper(regexp_replace(subject_name,'[^A-Za-z0-9]','','g'))))
  where external_id is null and email is null;
create index if not exists idx_pn_dnc_email on public.pn_do_not_contact(lower(email));
drop trigger if exists trg_pn_dnc_touch on public.pn_do_not_contact;
create trigger trg_pn_dnc_touch before update on public.pn_do_not_contact
  for each row execute function public.pn_touch();

-- ── RLS: admin-only on every pn_ table ───────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'pn_companies','pn_agents','pn_escrow_title',
    'pn_activity_signals','pn_outreach_actions','pn_do_not_contact'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;
