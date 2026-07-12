-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — Intelligence Enrichment Layer (078)
-- ADDITIVE + IDEMPOTENT. Requires 011 (is_admin_user), 072.
--
-- Background-job model for enriching an imported Agent / Escrow-Title / Company
-- with PUBLIC business information. Enrichment NEVER fabricates data: proposed
-- fields are produced by a pluggable research provider and each MUST carry a
-- source URL, confidence and last-verified date. An admin reviews every field
-- before commit; commit never overwrites Verified data with lower confidence.
-- No borrower/consumer lead data is collected.
-- ============================================================================

create table if not exists public.pn_enrichment_jobs(
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('agent','escrow_title','company')),
  entity_id     uuid not null,
  entity_name   text,                       -- snapshot for display
  status        text not null default 'queued'
                  check (status in ('queued','researching','review_ready','approved','rejected','failed')),
  provider      text not null default 'manual',
  requested_by  uuid,
  note          text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists idx_pn_enrich_jobs_entity on public.pn_enrichment_jobs(entity_type, entity_id);
create index if not exists idx_pn_enrich_jobs_status on public.pn_enrichment_jobs(status, created_at desc);
drop trigger if exists trg_pn_enrich_jobs_touch on public.pn_enrichment_jobs;
create trigger trg_pn_enrich_jobs_touch before update on public.pn_enrichment_jobs
  for each row execute function public.pn_touch();

-- One proposed field per row. current_value is the entity's value at proposal
-- time (so the reviewer sees current vs. proposed). Every proposal carries
-- provenance (source_url, confidence, last_verified_date).
create table if not exists public.pn_enrichment_fields(
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.pn_enrichment_jobs(id) on delete cascade,
  target_field       text not null,         -- e.g. license_number, website, linkedin_url, service_areas, specialty, production_tier, awards
  label              text,
  proposed_value     text,
  current_value      text,
  source_url         text,
  confidence         text check (confidence is null or confidence in ('Verified','Reported','Estimated','Unknown')),
  last_verified_date date,
  status             text not null default 'proposed'
                       check (status in ('proposed','accepted','rejected','edited','applied','skipped_conflict')),
  applied            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_pn_enrich_fields_job on public.pn_enrichment_fields(job_id);
drop trigger if exists trg_pn_enrich_fields_touch on public.pn_enrichment_fields;
create trigger trg_pn_enrich_fields_touch before update on public.pn_enrichment_fields
  for each row execute function public.pn_touch();

-- RLS: admin-only.
do $$
declare t text;
begin
  foreach t in array array['pn_enrichment_jobs','pn_enrichment_fields'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;
