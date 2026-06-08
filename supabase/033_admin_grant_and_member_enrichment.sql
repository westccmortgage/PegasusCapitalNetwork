-- ============================================================================
-- 033 — Admin grant RPC + member_log enrichment + upgrade notification log
--
-- This migration is idempotent and additive. It does NOT modify existing
-- access_codes / redeem_access_code logic. It does NOT change RLS on
-- subscriptions / memberships. It adds:
--
--   1. admin_grants audit table     — every admin-issued grant logged here
--   2. admin_grant_member_access()  — RPC the admin UI calls
--   3. member_log columns           — full_name, role, signup_method,
--                                     access_code, tier (for richer email)
--   4. _on_new_auth_user() update   — populates the new columns on signup
--   5. upgrade_log table + trigger  — fires on subscriptions INSERT/UPDATE
--                                     when status becomes 'active', so a
--                                     webhook can email the member
--
-- After applying this migration, run schedule from Supabase Dashboard →
-- Database → Webhooks to wire upgrade_log INSERT → Netlify
-- notify-member-upgrade function (instructions in admin Platform Health tab).
-- ============================================================================

-- ── 1. admin_grants audit table ─────────────────────────────────────────────
create table if not exists public.admin_grants (
  id                uuid primary key default gen_random_uuid(),
  granted_by        uuid not null references auth.users(id) on delete set null,
  target_user_id    uuid not null references auth.users(id) on delete cascade,
  tier              text not null check (tier in ('starter','pro','gold')),
  duration_days     int  not null check (duration_days > 0),
  access_expires_at timestamptz not null,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_admin_grants_target  on public.admin_grants(target_user_id);
create index if not exists idx_admin_grants_created on public.admin_grants(created_at desc);

alter table public.admin_grants enable row level security;

do $$ begin
  create policy admin_grants_admin_all on public.admin_grants
    for all to authenticated
    using (public.is_admin_user())
    with check (public.is_admin_user());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy admin_grants_self_read on public.admin_grants
    for select to authenticated
    using (target_user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── 2. admin_grant_member_access RPC ────────────────────────────────────────
-- Same membership/subscription writes as redeem_access_code, but source =
-- 'admin_grant' and no access code involved. Idempotent: re-running on the
-- same user extends/changes their tier and resets the window.
create or replace function public.admin_grant_member_access(
  p_user_id       uuid,
  p_tier          text,
  p_duration_days int,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_admin boolean;
  v_end          timestamptz;
  v_email        text;
begin
  -- Caller must be admin
  select public.is_admin_user() into v_caller_admin;
  if not coalesce(v_caller_admin, false) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- Validate inputs
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_user');
  end if;
  if p_tier not in ('starter','pro','gold') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_tier');
  end if;
  if p_duration_days is null or p_duration_days < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;

  -- Target must exist in auth.users
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  v_end := now() + (p_duration_days || ' days')::interval;

  -- Upsert subscriptions (preferred source — store reads this first)
  insert into public.subscriptions
    (user_id, tier, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (p_user_id, p_tier, 'active', 'monthly', v_end, 'admin_grant', null, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    status       = 'active',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = null,
    updated_at   = now();

  -- Upsert memberships (legacy/fallback — store reads both)
  insert into public.memberships
    (user_id, tier, plan, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (p_user_id, p_tier, p_tier, 'active', 'monthly', v_end, 'admin_grant', null, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    plan         = excluded.plan,
    status       = 'active',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = null,
    updated_at   = now();

  -- Audit row
  insert into public.admin_grants
    (granted_by, target_user_id, tier, duration_days, access_expires_at, note)
  values
    (auth.uid(), p_user_id, p_tier, p_duration_days, v_end, p_note);

  return jsonb_build_object(
    'ok', true,
    'tier', p_tier,
    'duration_days', p_duration_days,
    'access_expires_at', v_end,
    'source', 'admin_grant'
  );
end;
$$;

grant execute on function public.admin_grant_member_access(uuid, text, int, text) to authenticated;

-- ── 3. member_log enrichment ────────────────────────────────────────────────
-- Add columns so the admin notification email has the full picture.
alter table public.member_log add column if not exists full_name      text;
alter table public.member_log add column if not exists role           text;
alter table public.member_log add column if not exists signup_method  text;
alter table public.member_log add column if not exists access_code    text;
alter table public.member_log add column if not exists tier           text;

-- ── 4. Updated trigger function — populates the new columns on signup ───────
-- Reads from raw_user_meta_data (email signup) and raw_app_meta_data (OAuth
-- provider). Keeps the original behavior (insert into member_log) so the
-- existing webhook → notify-new-member.js path is unchanged.
create or replace function public._on_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name    text;
  v_role         text;
  v_provider     text;
  v_method       text;
  v_access_code  text;
begin
  v_full_name := coalesce(
    nullif(NEW.raw_user_meta_data->>'full_name', ''),
    nullif(NEW.raw_user_meta_data->>'name', ''),
    split_part(NEW.email, '@', 1)
  );
  v_role := coalesce(nullif(NEW.raw_user_meta_data->>'role', ''), 'borrower');

  v_provider := coalesce(NEW.raw_app_meta_data->>'provider', 'email');
  v_method := case when v_provider = 'google' then 'google' else 'email' end;

  v_access_code := nullif(NEW.raw_user_meta_data->>'access_code', '');

  insert into public.member_log
    (user_id, email, full_name, role, signup_method, access_code)
  values
    (NEW.id, NEW.email, v_full_name, v_role, v_method, v_access_code);

  return NEW;
end;
$$;

-- Trigger already exists from 027; re-create to ensure attached to new function
drop trigger if exists on_new_auth_user on auth.users;
create trigger on_new_auth_user
  after insert on auth.users
  for each row execute function public._on_new_auth_user();

-- ── 5. Upgrade notification log (optional member upgrade email) ─────────────
-- Single row per upgrade event. Webhook fires on insert → Netlify function
-- sends "Your access has been upgraded" email. Insert is non-blocking; if
-- the email path isn't wired yet, rows just accumulate harmlessly.
create table if not exists public.upgrade_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  tier          text not null,
  source        text,            -- 'admin_grant' | 'access_code' | 'stripe' | etc.
  access_code   text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_upgrade_log_user    on public.upgrade_log(user_id);
create index if not exists idx_upgrade_log_created on public.upgrade_log(created_at desc);

alter table public.upgrade_log enable row level security;
do $$ begin
  create policy upgrade_log_self_read on public.upgrade_log
    for select to authenticated
    using (user_id = auth.uid() or public.is_admin_user());
exception when duplicate_object then null; end $$;

-- Trigger: when a subscriptions row goes (or stays) active and is non-stripe
-- (avoid duplicating Stripe webhook's own emails), log an upgrade event.
create or replace function public._on_subscription_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'active'
     and NEW.source is not null
     and NEW.source <> 'stripe'
     and (TG_OP = 'INSERT'
          or OLD.status is distinct from NEW.status
          or OLD.tier   is distinct from NEW.tier
          or OLD.source is distinct from NEW.source) then
    insert into public.upgrade_log(user_id, tier, source, access_code, expires_at)
    values (NEW.user_id, NEW.tier, NEW.source, NEW.access_code, NEW.trial_end);
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_subscription_active on public.subscriptions;
create trigger on_subscription_active
  after insert or update on public.subscriptions
  for each row execute function public._on_subscription_active();

select '033 migration complete — admin_grant + member_log enriched + upgrade_log ready' as status;
