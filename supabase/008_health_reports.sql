-- ============================================================
-- Pegasus Migration 008 — Platform Health Reports
-- Admin-only table to store health check results over time.
-- ============================================================

create table if not exists public.health_reports (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  created_by   uuid        references auth.users(id) on delete set null,
  status       text        not null check (status in ('healthy','degraded','critical')),
  score        int         not null check (score between 0 and 100),
  critical_count int       not null default 0,
  warning_count  int       not null default 0,
  info_count     int       not null default 0,
  report_json  jsonb       not null,
  summary      text
);

-- Admin-only RLS
alter table public.health_reports enable row level security;

do $$ begin
  -- Only admin users can read reports
  create policy health_read on public.health_reports
    for select to authenticated
    using (
      exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    );
  -- Only admin users can insert reports
  create policy health_insert on public.health_reports
    for insert to authenticated
    with check (
      exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      )
    );
exception when duplicate_object then null; end $$;

-- Index for fast recent report lookups
create index if not exists idx_health_reports_created
  on public.health_reports(created_at desc);
