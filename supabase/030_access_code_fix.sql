-- ============================================================================
-- PEGASUS Migration 030 — Access Code Membership Fix
-- IDEMPOTENT. Safe to run multiple times. Run ONCE in the Supabase SQL Editor.
--
-- WHAT THIS FIXES
-- ---------------
-- In migration 013 the redeem_access_code RPC had a guard:
--
--   if exists (select 1 from code_redemptions where code = c.code and user_id = uid) then
--     return jsonb_build_object('ok', true, 'already', true, ...);
--   end if;
--
-- The intent was to prevent the same user from incrementing usage_count twice
-- when re-running redemption. The side effect was that if the user's
-- subscriptions/memberships rows were EVER missing (partial failure, manual
-- reset, Stripe webhook resetting status='canceled', etc.), calling redeem
-- again "succeeded" without ever recreating the membership rows. The store
-- then read no active subscription, tier defaulted to 'starter', and Deal
-- Rooms gated the user with a billing redirect.
--
-- This migration rewrites the function so that EVERY successful call
-- (including a repeat redemption) writes the subscriptions + memberships rows
-- via UPSERT. Usage counters and the code_redemptions log are still only
-- incremented on the first redemption — so the original anti-abuse behavior
-- is preserved.
-- ============================================================================

create or replace function public.redeem_access_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c              public.access_codes%rowtype;
  uid            uuid := auth.uid();
  v_trial_end    timestamptz;
  v_redeemed_at  timestamptz;
  v_already      boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Lock the code row so usage_limit checks are atomic with the usage_count update.
  select * into c from public.access_codes
    where lower(code) = lower(trim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.active is not true then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  -- Has this user already redeemed this code? If so, preserve their original
  -- access window (don't extend it by re-redeeming).
  select redeemed_at into v_redeemed_at
    from public.code_redemptions
    where code = c.code and user_id = uid
    order by redeemed_at desc limit 1;
  v_already := v_redeemed_at is not null;

  -- Usage limit only applies to NEW redemptions. An already-redeemed user can
  -- always re-resolve their membership rows, even if the code hit its cap.
  if not v_already
     and c.usage_limit is not null
     and c.usage_count >= c.usage_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;

  v_trial_end := coalesce(v_redeemed_at, now()) + (c.duration_days || ' days')::interval;

  -- ALWAYS write membership state. This is the fix: previously this only
  -- happened on first redemption, which is why missing rows stayed missing.
  insert into public.subscriptions
    (user_id, tier, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (uid, c.membership_tier, 'trialing', 'monthly', v_trial_end,
     'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    status       = 'trialing',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = excluded.access_code,
    updated_at   = now();

  insert into public.memberships
    (user_id, tier, plan, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (uid, c.membership_tier, c.membership_tier, 'trialing', 'monthly', v_trial_end,
     'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    plan         = excluded.plan,
    status       = 'trialing',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = excluded.access_code,
    updated_at   = now();

  -- First-redemption-only side effects: profile source tracking, log entry,
  -- and usage counter. Skipped on repeat calls so abuse limits stay intact.
  if not v_already then
    update public.profiles set
      signup_source   = coalesce(signup_source, c.source),
      access_code     = c.code,
      onboarding_flow = c.onboarding_flow,
      invited_by      = coalesce(invited_by, c.referred_by)
    where id = uid;

    insert into public.code_redemptions
      (code_id, code, user_id, source, membership_tier, onboarding_flow, invited_by)
    values
      (c.id, c.code, uid, c.source, c.membership_tier, c.onboarding_flow, c.referred_by);

    update public.access_codes
      set usage_count = usage_count + 1, updated_at = now()
      where id = c.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', v_already,
    'membership_tier', c.membership_tier,
    'duration_days', c.duration_days,
    'onboarding_flow', c.onboarding_flow,
    'source', c.source,
    'trial_end', v_trial_end
  );
end;
$$;

grant execute on function public.redeem_access_code(text) to authenticated;

-- Sanity check: seeded codes still present and active
select code, source, membership_tier, duration_days, usage_count, active
  from public.access_codes
  where code in ('LINKEDIN30','EVENTACCESS','FOUNDER365','AMBASSADORVIP')
  order by code;
