-- ============================================================================
-- 034 — Fix missing UNIQUE(user_id) on subscriptions + memberships
--
-- ROOT CAUSE
-- In production, public.subscriptions and public.memberships predate the
-- migration files that declare `user_id ... unique`. Both 010_billing_sync.sql
-- and membership-schema.sql use `create table if not exists`, so when the
-- tables already existed (the legacy v68 setup), neither migration altered
-- them to add the unique constraint. The live tables therefore have NO unique
-- constraint on user_id.
--
-- Every `insert ... on conflict (user_id) do update` then fails with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- This breaks BOTH:
--   * redeem_access_code            (why access codes "worked mostly")
--   * admin_grant_member_access     (the Grant Access error you just saw)
-- ...and any other upsert keyed on user_id (010, 013, 030, 031, 033).
--
-- THE FIX
-- 1. Collapse any duplicate rows, keeping the most-recently-updated row per
--    user (safe: a user should only ever have one membership/subscription row).
-- 2. Add the UNIQUE(user_id) constraint, but only if one doesn't already exist.
--
-- Fully idempotent. Safe to run more than once.
-- ============================================================================

-- ── subscriptions ───────────────────────────────────────────────────────────
-- Step 1: dedupe. Keep the row with the latest updated_at (then latest id).
delete from public.subscriptions a
using public.subscriptions b
where a.user_id = b.user_id
  and a.id <> b.id
  and (
        coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz)
          < coalesce(b.updated_at, b.created_at, 'epoch'::timestamptz)
     or (
        coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz)
          = coalesce(b.updated_at, b.created_at, 'epoch'::timestamptz)
        and a.id < b.id
        )
      );

-- Step 2: add UNIQUE(user_id) only if a single-column unique on user_id is absent.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute att
      on att.attrelid = c.conrelid
     and att.attnum   = any (c.conkey)
    where c.conrelid = 'public.subscriptions'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 1
      and att.attname = 'user_id'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_user_id_unique unique (user_id);
    raise notice 'Added subscriptions_user_id_unique';
  else
    raise notice 'subscriptions already has a unique constraint on user_id';
  end if;
end $$;

-- ── memberships ──────────────────────────────────────────────────────────────
delete from public.memberships a
using public.memberships b
where a.user_id = b.user_id
  and a.id <> b.id
  and (
        coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz)
          < coalesce(b.updated_at, b.created_at, 'epoch'::timestamptz)
     or (
        coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz)
          = coalesce(b.updated_at, b.created_at, 'epoch'::timestamptz)
        and a.id < b.id
        )
      );

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute att
      on att.attrelid = c.conrelid
     and att.attnum   = any (c.conkey)
    where c.conrelid = 'public.memberships'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 1
      and att.attname = 'user_id'
  ) then
    alter table public.memberships
      add constraint memberships_user_id_unique unique (user_id);
    raise notice 'Added memberships_user_id_unique';
  else
    raise notice 'memberships already has a unique constraint on user_id';
  end if;
end $$;

select '034 complete — UNIQUE(user_id) ensured on subscriptions + memberships; redeem + admin grant will now work' as status;
