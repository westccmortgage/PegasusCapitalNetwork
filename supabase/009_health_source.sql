-- ============================================================
-- Pegasus Migration 009 — Add source column to health_reports
-- Distinguishes manual (admin-triggered) from scheduled (weekly)
-- health check reports for the admin UI status panel.
-- ============================================================

alter table public.health_reports
  add column if not exists source text
    not null default 'manual'
    check (source in ('manual', 'scheduled'));

-- Index for fast "last scheduled run" queries
create index if not exists idx_health_reports_source
  on public.health_reports(source, created_at desc);

-- Backfill existing rows (all pre-migration reports are manual)
update public.health_reports
  set source = 'manual'
  where source is null;

-- Comment for clarity
comment on column public.health_reports.source is
  'manual = admin triggered via console | scheduled = weekly automated check';
