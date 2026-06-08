-- ============================================================================
-- PEGASUS Migration 031 — Access Membership: Active + Idempotent Upsert
-- IDEMPOTENT. Safe to run multiple times. Run ONCE in Supabase SQL Editor.
--
-- WHAT THIS FIXES
-- ---------------
-- 1) The original redeem_access_code (013) returned ok:true, already:true on
--    repeat calls but DID NOT write to subscriptions/memberships. So if those
--    rows were ever missing (partial first-redeem, manual reset, webhook
--    flipping status, etc.) a re-redemption looked successful but left the
--    user on tier='starter' — silently blocked from Deal Rooms and any other
--    tier-gated surface, and redirected to billing.
--
-- 2) Status was 'trialing' on code-based redemptions. Some gates only check
--    status='active'. Per the access-code spec, code-based memberships are
--    full free access (not a trial), so we now write status='active' and
--    record the trial flag separately via the source column.
--
-- SCHEMA NAMING NOTE: the spec referenced membership_status, membership_tier,
-- access_expires_at, access_source. The actual columns on subscriptions and
-- memberships are status, tier, trial_end, source. We are NOT renaming them
-- (would break Stripe webhooks and other readers). We honor the intent:
--   status        = 'active'        (was 'trialing')
--   tier          = code's tier     (unchanged)
--   trial_end     = now + duration  (unchanged — this IS access_expires_at)
--   source        = 'access_code:X' (identifies code-based memberships)
--   access_code   = the code string (unchanged)
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
  v_access_end   timestamptz;
  v_redeemed_at  timestamptz;
  v_already      boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Lock the code row so usage_limit checks are atomic with usage_count update
  select * into c from public.access_codes
    where lower(code) = lower(trim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.active is not true then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  -- Has this user already redeemed this code?
  select redeemed_at into v_redeemed_at
    from public.code_redemptions
    where code = c.code and user_id = uid
    order by redeemed_at desc limit 1;
  v_already := v_redeemed_at is not null;

  -- Usage limit only blocks NEW redemptions. An already-redeemed user can
  -- always re-resolve their membership rows, even if the code hit its cap.
  if not v_already
     and c.usage_limit is not null
     and c.usage_count >= c.usage_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;

  -- Preserve the original access window for already-redeemed users; otherwise
  -- start a fresh window now. This is the "access_expires_at" the spec named.
  v_access_end := coalesce(v_redeemed_at, now()) + (c.duration_days || ' days')::interval;

  -- ALWAYS write membership state on every successful call. This is the fix:
  -- the prior version skipped these writes on the "already" branch, which is
  -- why missing rows stayed missing and users stayed gated.
  --
  -- status = 'active' (not 'trialing') — code-based access is full membership.
  insert into public.subscriptions
    (user_id, tier, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (uid, c.membership_tier, 'active', 'monthly', v_access_end,
     'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    status       = 'active',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = excluded.access_code,
    updated_at   = now();

  insert into public.memberships
    (user_id, tier, plan, status, billing_cycle, trial_end, source, access_code, updated_at)
  values
    (uid, c.membership_tier, c.membership_tier, 'active', 'monthly', v_access_end,
     'access_code:' || c.source, c.code, now())
  on conflict (user_id) do update set
    tier         = excluded.tier,
    plan         = excluded.plan,
    status       = 'active',
    trial_end    = excluded.trial_end,
    source       = excluded.source,
    access_code  = excluded.access_code,
    updated_at   = now();

  -- First-redemption-only: profile source tracking, redemption log, usage++.
  -- Skipped on repeat calls so abuse limits stay intact.
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
    'trial_end', v_access_end,
    'access_expires_at', v_access_end
  );
end;
$$;

grant execute on function public.redeem_access_code(text) to authenticated;

-- Sanity check the seeded codes
select code, source, membership_tier, duration_days, usage_count, active
  from public.access_codes
  where code in ('LINKEDIN30','EVENTACCESS','FOUNDER365','AMBASSADORVIP')
  order by code;
