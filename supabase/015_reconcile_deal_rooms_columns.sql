-- ============================================================================
-- PEGASUS Migration 015 — Reconcile deal_rooms columns (prod drift fix)
-- IDEMPOTENT. Safe to run multiple times.
--
-- ROOT CAUSE: membership-schema.sql defines deal_rooms with the full column set
-- (owner_id, deal_type, amount, ltv, location, stage, ...), but it uses
-- `create table if not exists`. Production already had a bare-bones deal_rooms
-- table (id, name, workflow_state, created_by, created_at, updated_at), so that
-- richer CREATE was a no-op and the extra columns were never added. No later
-- migration ran `alter table ... add column owner_id`, so:
--   1. The frontend insert (owner_id, deal_type, amount, ltv, location, ...)
--      fails on unknown columns.
--   2. The dr_insert RLS policy (014) references owner_id, which doesn't exist.
--
-- FIX: add every missing column, backfill owner_id from the legacy created_by,
-- keep the two owner columns in sync so either can be supplied, and re-assert
-- the indexes + insert policy. Entitlement logic (014) is unchanged.
-- ============================================================================

-- 1. Add the canonical columns that production is missing -------------------
--    (owner_id added nullable first so the backfill in step 2 can run; the
--     NOT NULL + FK are enforced in step 3 once data is clean.)
alter table public.deal_rooms add column if not exists owner_id        uuid;
alter table public.deal_rooms add column if not exists deal_type       text;
alter table public.deal_rooms add column if not exists amount          numeric(14,2) default 0;
alter table public.deal_rooms add column if not exists ltv             text;
alter table public.deal_rooms add column if not exists location        text;
alter table public.deal_rooms add column if not exists stage           int  not null default 0;
alter table public.deal_rooms add column if not exists alignment_score int  not null default 0;
alter table public.deal_rooms add column if not exists debt_yield      text;
alter table public.deal_rooms add column if not exists risk_tier       text;
alter table public.deal_rooms add column if not exists confidence      text;
alter table public.deal_rooms add column if not exists refi_window     text;
alter table public.deal_rooms add column if not exists status          text not null default 'active';
alter table public.deal_rooms add column if not exists created_by      uuid;
alter table public.deal_rooms add column if not exists updated_at      timestamptz not null default now();

-- Constraints (guarded so re-runs don't error on duplicates) ----------------
do $$ begin
  alter table public.deal_rooms add constraint deal_rooms_stage_chk
    check (stage between 0 and 6);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deal_rooms add constraint deal_rooms_align_chk
    check (alignment_score between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deal_rooms add constraint deal_rooms_status_chk
    check (status in ('active','funded','archived'));
exception when duplicate_object then null; end $$;

-- 2. Backfill owner_id from the legacy created_by (and vice-versa) -----------
update public.deal_rooms set owner_id   = created_by where owner_id   is null and created_by is not null;
update public.deal_rooms set created_by = owner_id   where created_by is null and owner_id   is not null;

-- 3. Enforce owner_id integrity ONLY if the data is clean -------------------
--    (won't fail the whole migration if some legacy row has no owner yet).
do $$ begin
  alter table public.deal_rooms
    add constraint deal_rooms_owner_fk
    foreign key (owner_id) references auth.users(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$
begin
  if not exists (select 1 from public.deal_rooms where owner_id is null) then
    alter table public.deal_rooms alter column owner_id set not null;
  else
    raise notice 'deal_rooms has rows with null owner_id; leaving column nullable. Backfill, then re-run.';
  end if;
end $$;

-- created_by must stay nullable: the frontend insert only sets owner_id, and
-- the trigger below fills created_by. Drop a stray NOT NULL if one exists.
do $$ begin
  alter table public.deal_rooms alter column created_by drop not null;
exception when others then null; end $$;

-- 4. Keep owner_id <-> created_by in sync on every write --------------------
--    so inserts that supply only one of the two always populate both.
create or replace function public.deal_rooms_sync_owner()
returns trigger language plpgsql as $$
begin
  new.owner_id   := coalesce(new.owner_id, new.created_by, auth.uid());
  new.created_by := coalesce(new.created_by, new.owner_id);
  return new;
end $$;

drop trigger if exists trg_dr_sync_owner on public.deal_rooms;
create trigger trg_dr_sync_owner
  before insert or update on public.deal_rooms
  for each row execute function public.deal_rooms_sync_owner();

-- 5. Indexes (canonical) ----------------------------------------------------
create index if not exists idx_dr_owner  on public.deal_rooms(owner_id);
create index if not exists idx_dr_status on public.deal_rooms(status);

-- 6. Re-assert the insert policy now that owner_id exists --------------------
drop policy if exists dr_insert on public.deal_rooms;
create policy dr_insert on public.deal_rooms for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_deal_room(auth.uid()));

-- 7. Verify -----------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'deal_rooms'
order by ordinal_position;
