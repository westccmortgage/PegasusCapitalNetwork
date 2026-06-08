-- ============================================================================
-- 035 — Create missing admin tables
--
-- These three tables are referenced by the Admin Console but were never
-- created in production (002_platform_schema.sql uses `create table if not
-- exists` but the migration was never run against the live database).
--
-- Running this migration will:
-- 1. Create lender_appetite_profiles (lender showcase / appetite data)
-- 2. Create financing_requests (Growth Partner deal submissions)
-- 3. Create match_results (scored alignment of request × appetite)
--
-- After this migration, the Admin Console Lender Profiles, Growth Partner
-- Submissions, and Match Activity tabs will connect to real tables
-- (though they'll be empty until members submit data — add admin SELECT
-- policies when you want admin-wide read access).
--
-- Idempotent: create table IF NOT EXISTS + do $$ exception handlers.
-- Safe to run on a database that already has some of these tables.
-- ============================================================================

-- ── lender_appetite_profiles ─────────────────────────────────────────────────
create table if not exists public.lender_appetite_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  is_showcase      boolean default false,
  name             text not null,
  loan_types       text[] not null default '{}',
  states           text[] not null default '{}',
  asset_types      text[] not null default '{}',
  min_loan         numeric(14,2) default 0,
  max_loan         numeric(14,2) default 0,
  max_ltv          int default 0,
  dscr_min         numeric(5,2) default 0,
  construction_ok  boolean default false,
  bridge_ok        boolean default false,
  pref_sponsor_years int default 0,
  rate_from        text,
  active           boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.lender_appetite_profiles enable row level security;
do $$ begin
  create policy lap_read on public.lender_appetite_profiles
    for select to authenticated using (active or user_id = auth.uid());
  create policy lap_anon on public.lender_appetite_profiles
    for select to anon using (is_showcase);
  create policy lap_write on public.lender_appetite_profiles
    for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
create index if not exists idx_lap_user     on public.lender_appetite_profiles(user_id);
create index if not exists idx_lap_active   on public.lender_appetite_profiles(active);
create index if not exists idx_lap_showcase on public.lender_appetite_profiles(is_showcase);

-- ── financing_requests ───────────────────────────────────────────────────────
create table if not exists public.financing_requests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  deal_room_id      uuid references public.deal_rooms(id) on delete set null,
  loan_type         text,
  amount            numeric(14,2) default 0,
  state             text,
  asset_type        text,
  ltv               int default 0,
  dscr              numeric(5,2) default 0,
  construction_stage text,
  timeline          text,
  exit_strategy     text,
  sponsor_years     int default 0,
  docs_ready        int default 0,
  notes             text,
  status            text default 'open'
                      check (status in ('open','matching','matched','closed')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.financing_requests enable row level security;
do $$ begin
  create policy fr_owner on public.financing_requests
    for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
create index if not exists idx_fr_user      on public.financing_requests(user_id);
create index if not exists idx_fr_deal_room on public.financing_requests(deal_room_id);

-- ── match_results ────────────────────────────────────────────────────────────
create table if not exists public.match_results (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.financing_requests(id) on delete cascade,
  appetite_id uuid not null references public.lender_appetite_profiles(id) on delete cascade,
  alignment   int default 0,
  strength    int default 0,
  funding     int default 0,
  docs        int default 0,
  risk        text,
  fit         text,
  flags       text[] default '{}',
  created_at  timestamptz default now(),
  unique (request_id, appetite_id)
);
alter table public.match_results enable row level security;
do $$ begin
  create policy mr_owner on public.match_results
    for select to authenticated using (
      exists (
        select 1 from public.financing_requests f
        where f.id = request_id and f.user_id = auth.uid()
      ) or exists (
        select 1 from public.lender_appetite_profiles a
        where a.id = appetite_id and a.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
create index if not exists idx_mr_request  on public.match_results(request_id);
create index if not exists idx_mr_appetite on public.match_results(appetite_id);

select '035 complete — lender_appetite_profiles, financing_requests, match_results created' as status;
