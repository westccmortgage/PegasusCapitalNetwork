-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — Universal Import Mapper (migration 075)
-- ADDITIVE + IDEMPOTENT. Requires 011 (is_admin_user), 072/073.
--
-- Adds saved Import Profiles and per-row provenance for mapped (non-native)
-- imports. The commit/rollback RPCs (073) are UNCHANGED: mapped rows are stored
-- in the same pn_import_rows shape (target_type + after_data) they already use,
-- so atomic commit + edit-aware rollback apply identically. The new columns are
-- provenance/metadata only.
-- ============================================================================

-- ── Saved Import Profiles (admin-only) ───────────────────────────────────────
create table if not exists public.pn_import_profiles(
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  fingerprints       text[] not null default '{}',   -- header fingerprints this profile matches
  sheet_name_hints   text[] not null default '{}',   -- normalized source sheet names
  mapping            jsonb not null default '{}'::jsonb, -- { sheets:[{sheet,entity,columns,constants}] }
  mapping_version    integer not null default 1,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_pn_profiles_name on public.pn_import_profiles(lower(name));
create index if not exists idx_pn_profiles_fingerprints on public.pn_import_profiles using gin(fingerprints);
drop trigger if exists trg_pn_profiles_touch on public.pn_import_profiles;
create trigger trg_pn_profiles_touch before update on public.pn_import_profiles
  for each row execute function public.pn_touch();

alter table public.pn_import_profiles enable row level security;
drop policy if exists pn_import_profiles_admin_all on public.pn_import_profiles;
create policy pn_import_profiles_admin_all on public.pn_import_profiles
  for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

-- ── Provenance on batches (which profile / mapping produced this import) ──────
alter table public.pn_import_batches
  add column if not exists source_kind      text not null default 'native',  -- 'native' | 'mapped'
  add column if not exists import_profile_id uuid references public.pn_import_profiles(id) on delete set null,
  add column if not exists mapping          jsonb,
  add column if not exists mapping_version  integer,
  add column if not exists original_filename text;

-- ── Provenance on each row (original sheet / row / raw source JSON) ───────────
alter table public.pn_import_rows
  add column if not exists source_sheet      text,
  add column if not exists source_row        integer,
  add column if not exists source_raw        jsonb,
  add column if not exists import_profile_id uuid,
  add column if not exists mapping_version   integer;
