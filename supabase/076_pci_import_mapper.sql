-- ============================================================================
-- PEGASUS CAPITAL INTELLIGENCE — Universal Import Mapper (migration 076)
-- ADDITIVE + IDEMPOTENT. Requires 011 (is_admin_user), 068/069.
--
-- Mirrors 075 for the Capital Intelligence module: saved Import Profiles and
-- per-row provenance for mapped imports. Commit/rollback RPCs (069) are
-- UNCHANGED — mapped rows use the same pci_import_rows shape.
-- ============================================================================

create table if not exists public.pci_import_profiles(
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  fingerprints       text[] not null default '{}',
  sheet_name_hints   text[] not null default '{}',
  mapping            jsonb not null default '{}'::jsonb,
  mapping_version    integer not null default 1,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_pci_profiles_name on public.pci_import_profiles(lower(name));
create index if not exists idx_pci_profiles_fingerprints on public.pci_import_profiles using gin(fingerprints);
drop trigger if exists trg_pci_profiles_touch on public.pci_import_profiles;
create trigger trg_pci_profiles_touch before update on public.pci_import_profiles
  for each row execute function public.pci_touch();

alter table public.pci_import_profiles enable row level security;
drop policy if exists pci_import_profiles_admin_all on public.pci_import_profiles;
create policy pci_import_profiles_admin_all on public.pci_import_profiles
  for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());

alter table public.pci_import_batches
  add column if not exists source_kind      text not null default 'native',
  add column if not exists import_profile_id uuid references public.pci_import_profiles(id) on delete set null,
  add column if not exists mapping          jsonb,
  add column if not exists mapping_version  integer,
  add column if not exists original_filename text;

alter table public.pci_import_rows
  add column if not exists source_sheet      text,
  add column if not exists source_row        integer,
  add column if not exists source_raw        jsonb,
  add column if not exists import_profile_id uuid,
  add column if not exists mapping_version   integer;
