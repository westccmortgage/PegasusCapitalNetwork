-- ============================================================================
-- PEGASUS Migration 013 — Access System (Invitation + Source Tracking)
-- IDEMPOTENT. Safe to run multiple times.
--
-- Builds: access_codes, code_redemptions, secure validate/redeem RPCs.
-- Membership activation via access code is FREE (no Stripe) and writes to the
-- same subscriptions/memberships tables the rest of the app reads.
-- ============================================================================

-- 0. Make sure billing tables have the columns the RPC writes (reconcile).
alter table public.subscriptions add column if not exists tier text not null default 'starter';
alter table public.subscriptions add column if not exists status text not null default 'active';
alter table public.subscriptions add column if not exists billing_cycle text not null default 'monthly';
alter table public.subscriptions add column if not exists trial_end timestamptz;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists source text;
alter table public.subscriptions add column if not exists access_code text;
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

alter table public.memberships add column if not exists tier text not null default 'starter';
alter table public.memberships add column if not exists plan text not null default 'starter';
alter table public.memberships add column if not exists status text not null default 'active';
alter table public.memberships add column if not exists billing_cycle text not null default 'monthly';
alter table public.memberships add column if not exists trial_end timestamptz;
alter table public.memberships add column if not exists source text;
alter table public.memberships add column if not exists access_code text;
alter table public.memberships add column if not exists updated_at timestamptz not null default now();

-- Referral / source columns on profiles (clean foundation, not overbuilt)
alter table public.profiles add column if not exists signup_source text;
alter table public.profiles add column if not exists access_code text;
alter table public.profiles add column if not exists onboarding_flow text;
alter table public.profiles add column if not exists invited_by uuid;

-- 1. access_codes ------------------------------------------------------------
create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source text not null default 'Organic',
  type text not null default 'invitation',
  membership_tier text not null default 'starter',     -- starter | pro | gold
  duration_days integer not null default 30,
  usage_limit integer,                                  -- null = unlimited (use sparingly)
  usage_count integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid,
  referred_by uuid,
  onboarding_flow text default 'growth_partner',        -- growth_partner | growth_capital | priority | default
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_access_codes_code on public.access_codes(lower(code));
create index if not exists idx_access_codes_active on public.access_codes(active) where active = true;

-- 2. code_redemptions (source tracking + referral graph foundation) ----------
create table if not exists public.code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid references public.access_codes(id) on delete set null,
  code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text,
  membership_tier text,
  onboarding_flow text,
  invited_by uuid,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);
create index if not exists idx_redemptions_code on public.code_redemptions(code_id);
create index if not exists idx_redemptions_user on public.code_redemptions(user_id);

-- 3. RLS ---------------------------------------------------------------------
alter table public.access_codes enable row level security;
alter table public.code_redemptions enable row level security;

-- Codes: only admins can read/manage directly (validation happens via RPC).
do $$ begin
  create policy ac_admin_all on public.access_codes for all to authenticated
    using (public.is_admin_user()) with check (public.is_admin_user());
exception when duplicate_object then null; end $$;

-- Redemptions: owner can read their own; admins read all.
do $$ begin
  create policy rd_owner_read on public.code_redemptions for select to authenticated
    using (user_id = auth.uid() or public.is_admin_user());
exception when duplicate_object then null; end $$;

-- 4. validate RPC — safe for anon. Returns a tier PREVIEW without exposing the
--    whole table or mutating anything.
create or replace function public.validate_access_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.access_codes%rowtype;
begin
  select * into c from public.access_codes where lower(code) = lower(trim(p_code)) limit 1;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if c.active is not true then
    return jsonb_build_object('valid', false, 'reason', 'inactive');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  if c.usage_limit is not null and c.usage_count >= c.usage_limit then
    return jsonb_build_object('valid', false, 'reason', 'limit_reached');
  end if;
  return jsonb_build_object(
    'valid', true,
    'code', c.code,
    'source', c.source,
    'type', c.type,
    'membership_tier', c.membership_tier,
    'duration_days', c.duration_days,
    'onboarding_flow', c.onboarding_flow
  );
end;
$$;

-- 5. redeem RPC — atomic. Validates, increments usage, records redemption, and
--    ACTIVATES the membership (free, no Stripe). Caller must be authenticated;
--    activation always applies to the calling user (auth.uid()).
create or replace function public.redeem_access_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.access_codes%rowtype;
  uid uuid := auth.uid();
  v_trial_end timestamptz;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Lock the code row to enforce usage_limit atomically
  select * into c from public.access_codes
    where lower(code) = lower(trim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.active is not true then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if c.usage_limit is not null and c.usage_count >= c.usage_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached'); end if;

  -- Idempotency: if this user already redeemed this code, don't double-count.
  if exists (select 1 from public.code_redemptions where code = c.code and user_id = uid) then
    return jsonb_build_object('ok', true, 'already', true,
      'membership_tier', c.membership_tier, 'onboarding_flow', c.onboarding_flow, 'source', c.source);
  end if;

  v_trial_end := now() + (c.duration_days || ' days')::interval;

  -- Activate membership (free — never touches Stripe)
  insert into public.subscriptions (user_id, tier, status, billing_cycle, trial_end, source, access_code, updated_at)
    values (uid, c.membership_tier, 'trialing', 'monthly', v_trial_end, 'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier = excluded.tier, status = 'trialing', trial_end = excluded.trial_end,
    source = excluded.source, access_code = excluded.access_code, updated_at = now();

  insert into public.memberships (user_id, tier, plan, status, billing_cycle, trial_end, source, access_code, updated_at)
    values (uid, c.membership_tier, c.membership_tier, 'trialing', 'monthly', v_trial_end, 'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier = excluded.tier, plan = excluded.plan, status = 'trialing', trial_end = excluded.trial_end,
    source = excluded.source, access_code = excluded.access_code, updated_at = now();

  -- Source tracking on profile
  update public.profiles set
    signup_source = coalesce(signup_source, c.source),
    access_code = c.code,
    onboarding_flow = c.onboarding_flow,
    invited_by = coalesce(invited_by, c.referred_by)
  where id = uid;

  -- Record redemption + increment usage
  insert into public.code_redemptions (code_id, code, user_id, source, membership_tier, onboarding_flow, invited_by)
    values (c.id, c.code, uid, c.source, c.membership_tier, c.onboarding_flow, c.referred_by);
  update public.access_codes set usage_count = usage_count + 1, updated_at = now() where id = c.id;

  return jsonb_build_object('ok', true, 'already', false,
    'membership_tier', c.membership_tier, 'duration_days', c.duration_days,
    'onboarding_flow', c.onboarding_flow, 'source', c.source, 'trial_end', v_trial_end);
end;
$$;

grant execute on function public.validate_access_code(text) to anon, authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;

-- 6. Seed example invitation codes (idempotent) ------------------------------
insert into public.access_codes (code, source, type, membership_tier, duration_days, onboarding_flow, notes)
values
  ('LINKEDIN30',    'LinkedIn',       'invitation', 'starter', 30,  'growth_partner', 'LinkedIn outreach'),
  ('AMBASSADORVIP', 'Ambassador',     'invitation', 'gold',    365, 'priority',       'Ambassador VIP grant'),
  ('EVENTACCESS',   'Pegasus Events', 'invitation', 'pro',     90,  'growth_partner', 'Event attendee access'),
  ('FOUNDER365',    'Growth Capital', 'invitation', 'gold',    365, 'growth_capital', 'Founder referral')
on conflict (code) do nothing;

select code, source, membership_tier, duration_days, usage_count, active from public.access_codes order by created_at;
