-- ============================================================================
-- 067 — CRM corrections + intelligence-workflow fields
--
-- Part of the private Pegasus Capital Intelligence module (see 068/069/070).
-- The CRM stays the relationship layer for people and organizations (brokers,
-- owners, principals, lenders, attorneys, property managers, title contacts).
--
-- Fixes / adds:
--   1. Safe FK crm_contacts.linked_profile_id -> profiles.id ON DELETE SET NULL
--      (the client-side pegasus_user_id bug is fixed in js/crm/crm.js — the
--      column never existed; linked_profile_id from 020 is the real one).
--   2. Partial unique index (owner_id, linked_profile_id) to prevent duplicate
--      member imports.
--   3. Optional contact fields used by the intelligence workflow. All nullable —
--      existing rows are untouched.
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. No destructive changes.
-- ============================================================================

-- ── 1. FK to profiles (guarded: add only if absent and profiles exists) ──────
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='profiles')
     and not exists (
       select 1 from pg_constraint
       where conname = 'crm_contacts_linked_profile_fk'
         and conrelid = 'public.crm_contacts'::regclass
     ) then
    -- Clean orphans first so the constraint can attach on any existing DB.
    update public.crm_contacts c set linked_profile_id = null
     where linked_profile_id is not null
       and not exists (select 1 from public.profiles p where p.id = c.linked_profile_id);
    alter table public.crm_contacts
      add constraint crm_contacts_linked_profile_fk
      foreign key (linked_profile_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ── 2. One CRM row per linked member per owner ────────────────────────────────
-- Remove duplicate links (keep the oldest row) so the index can build anywhere.
do $$
begin
  delete from public.crm_contacts a
   using public.crm_contacts b
   where a.owner_id = b.owner_id
     and a.linked_profile_id is not null
     and a.linked_profile_id = b.linked_profile_id
     and a.created_at > b.created_at;
exception when others then null; -- never block the migration on legacy data
end $$;
create unique index if not exists uq_crm_contacts_owner_linked
  on public.crm_contacts(owner_id, linked_profile_id)
  where linked_profile_id is not null;

-- ── 3. Optional intelligence-workflow fields ─────────────────────────────────
alter table public.crm_contacts add column if not exists job_title        text;
alter table public.crm_contacts add column if not exists website          text;
alter table public.crm_contacts add column if not exists linkedin_url     text;
alter table public.crm_contacts add column if not exists address_line1    text;
alter table public.crm_contacts add column if not exists city             text;
alter table public.crm_contacts add column if not exists state            text;
alter table public.crm_contacts add column if not exists postal_code      text;
alter table public.crm_contacts add column if not exists last_verified_at timestamptz;
alter table public.crm_contacts add column if not exists data_confidence  text;
alter table public.crm_contacts add column if not exists source_url       text;
alter table public.crm_contacts add column if not exists metadata         jsonb not null default '{}'::jsonb;

-- Confidence vocabulary (nullable; enforced only when set).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname='crm_contacts_confidence_check'
                   and conrelid='public.crm_contacts'::regclass) then
    alter table public.crm_contacts add constraint crm_contacts_confidence_check
      check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown'));
  end if;
end $$;

-- Import dedupe helpers (owner-scoped; used by the intelligence import).
create index if not exists idx_crm_contacts_owner_email
  on public.crm_contacts(owner_id, lower(email)) where email is not null;
create index if not exists idx_crm_contacts_owner_extid
  on public.crm_contacts(owner_id, (metadata->>'external_id'))
  where metadata ? 'external_id';
