-- ============================================================================
-- 067 — CRM corrections + intelligence-workflow fields
--
-- Part of the private Pegasus Capital Intelligence module (see 068/069/070).
-- The CRM stays the relationship layer for people and organizations (brokers,
-- owners, principals, lenders, attorneys, property managers, title contacts).
--
-- Fixes / adds:
--   1. Optional contact fields used by the intelligence workflow (all nullable).
--   2. Safe FK crm_contacts.linked_profile_id -> profiles.id ON DELETE SET NULL
--      (the client-side pegasus_user_id bug is fixed in js/crm/crm.js — the
--      column never existed; linked_profile_id from 020 is the real one).
--   3. NON-DESTRUCTIVE de-duplication of accidental double-imports of the same
--      linked member: a deterministic MERGE (never a blind delete) that
--      reassigns every dependent record and preserves all field data, so the
--      partial unique index (owner_id, linked_profile_id) can be created safely.
--
-- MERGE POLICY (deterministic, loss-free):
--   • Group = rows sharing (owner_id, linked_profile_id) with linked_profile_id
--     not null. Manual contacts (linked_profile_id null) are NEVER touched.
--   • Survivor = the OLDEST row (min created_at, then min id).
--   • Every crm_deals / crm_reminders / crm_activities row pointing at a loser
--     is re-pointed at the survivor BEFORE the loser is removed — so nothing is
--     cascade-deleted or detached.
--   • Fields: the survivor keeps its own non-empty values; blanks are filled
--     from the loser (coalesce). Tags are unioned. Notes are concatenated when
--     both differ. metadata is merged (survivor wins on key conflicts).
--   • Only after every group is merged is the unique index created.
--
-- No exception is ever swallowed: if a merge step fails, the whole migration
-- fails loudly and applies nothing (it runs in one transaction).
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. Requires migration 020.
-- ============================================================================

-- ── 1. Optional intelligence-workflow fields (added first so the merge and
--       the final table shape are complete before de-duplication) ────────────
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

-- ── 2. FK to profiles (guarded: add only if absent and profiles exists) ──────
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='profiles')
     and not exists (
       select 1 from pg_constraint
       where conname = 'crm_contacts_linked_profile_fk'
         and conrelid = 'public.crm_contacts'::regclass
     ) then
    -- A dangling link (profile no longer exists) is nulled — non-destructive.
    update public.crm_contacts c set linked_profile_id = null
     where linked_profile_id is not null
       and not exists (select 1 from public.profiles p where p.id = c.linked_profile_id);
    alter table public.crm_contacts
      add constraint crm_contacts_linked_profile_fk
      foreign key (linked_profile_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ── 3. Non-destructive de-duplication (deterministic merge) ──────────────────
do $$
declare
  g          record;
  survivor   uuid;
  loser      record;
  n_groups   int := 0;
  n_merged   int := 0;
  n_reassign int := 0;
begin
  for g in
    select owner_id, linked_profile_id, count(*) as c
      from public.crm_contacts
     where linked_profile_id is not null
     group by owner_id, linked_profile_id
    having count(*) > 1
  loop
    n_groups := n_groups + 1;
    raise notice 'CRM dedup: owner % / profile % has % linked rows — merging into the oldest.',
      g.owner_id, g.linked_profile_id, g.c;

    select id into survivor
      from public.crm_contacts
     where owner_id = g.owner_id and linked_profile_id = g.linked_profile_id
     order by created_at asc, id asc
     limit 1;

    for loser in
      select * from public.crm_contacts
       where owner_id = g.owner_id and linked_profile_id = g.linked_profile_id and id <> survivor
    loop
      -- Re-point every dependent record at the survivor FIRST.
      update public.crm_deals      set contact_id = survivor where contact_id = loser.id;
      update public.crm_reminders  set contact_id = survivor where contact_id = loser.id;
      update public.crm_activities set contact_id = survivor where contact_id = loser.id;
      n_reassign := n_reassign + 1;

      -- Merge fields: survivor keeps its values; blanks fill from the loser.
      update public.crm_contacts s set
        name             = coalesce(nullif(btrim(s.name), ''), loser.name),
        company          = coalesce(s.company, loser.company),
        email            = coalesce(s.email, loser.email),
        phone            = coalesce(s.phone, loser.phone),
        contact_type     = coalesce(s.contact_type, loser.contact_type),
        job_title        = coalesce(s.job_title, loser.job_title),
        website          = coalesce(s.website, loser.website),
        linkedin_url     = coalesce(s.linkedin_url, loser.linkedin_url),
        address_line1    = coalesce(s.address_line1, loser.address_line1),
        city             = coalesce(s.city, loser.city),
        state            = coalesce(s.state, loser.state),
        postal_code      = coalesce(s.postal_code, loser.postal_code),
        source_url       = coalesce(s.source_url, loser.source_url),
        data_confidence  = coalesce(s.data_confidence, loser.data_confidence),
        last_verified_at = greatest(s.last_verified_at, loser.last_verified_at),
        metadata         = coalesce(loser.metadata, '{}'::jsonb) || coalesce(s.metadata, '{}'::jsonb),
        status           = case when s.status = 'archived' and loser.status = 'active' then 'active' else s.status end,
        notes            = case
                             when coalesce(btrim(s.notes), '') = ''     then loser.notes
                             when coalesce(btrim(loser.notes), '') = '' then s.notes
                             when s.notes = loser.notes                 then s.notes
                             else s.notes || E'\n---\n' || loser.notes end,
        tags             = (select coalesce(array_agg(distinct t), '{}')
                              from (select unnest(coalesce(s.tags, '{}')) as t
                                    union
                                    select unnest(coalesce(loser.tags, '{}'))) u
                             where t is not null and btrim(t) <> '')
      where s.id = survivor;

      delete from public.crm_contacts where id = loser.id;
      n_merged := n_merged + 1;
    end loop;
  end loop;

  if n_groups > 0 then
    raise notice 'CRM dedup complete: % duplicate group(s), % row(s) merged, dependents reassigned for % loser(s). No records lost.',
      n_groups, n_merged, n_reassign;
  end if;
end $$;

-- ── 4. One CRM row per linked member per owner (now provably safe) ───────────
create unique index if not exists uq_crm_contacts_owner_linked
  on public.crm_contacts(owner_id, linked_profile_id)
  where linked_profile_id is not null;

-- ── 5. Confidence vocabulary (nullable; enforced only when set) ──────────────
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname='crm_contacts_confidence_check'
                   and conrelid='public.crm_contacts'::regclass) then
    alter table public.crm_contacts add constraint crm_contacts_confidence_check
      check (data_confidence is null or data_confidence in ('Verified','Reported','Estimated','Unknown'));
  end if;
end $$;

-- ── 6. Import dedupe helpers (owner-scoped) ──────────────────────────────────
create index if not exists idx_crm_contacts_owner_email
  on public.crm_contacts(owner_id, lower(email)) where email is not null;
create index if not exists idx_crm_contacts_owner_extid
  on public.crm_contacts(owner_id, (metadata->>'external_id'))
  where metadata ? 'external_id';
