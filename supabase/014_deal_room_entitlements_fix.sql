-- ============================================================================
-- PEGASUS Migration 014 — Deal Room entitlements fix
-- IDEMPOTENT.
--
-- ROOT CAUSE: 003_seed.sql seeded plan_entitlements using column names
-- (deal_rooms, ai_queries, ...) that don't match the table (max_deal_rooms,
-- max_ai_queries, ...). That INSERT failed, so plan_entitlements could be
-- missing the row for a user's tier. can_create_deal_room() then read NULL and
-- returned NULL, which the deal_rooms INSERT RLS policy treats as DENY — so
-- creating a Deal Room silently failed even for Gold members.
--
-- FIX: (1) re-seed plan_entitlements with the CORRECT columns, and
--      (2) make can_create_deal_room() null-safe (fall back to tier name).
-- ============================================================================

-- 1. Ensure the table exists with the canonical columns, then seed correctly.
create table if not exists public.plan_entitlements (
  tier              text primary key check (tier in ('starter','pro','gold')),
  layer             text not null default '',
  monthly_price     int  not null default 0,
  annual_price      int  not null default 0,
  max_deal_rooms    int  not null default 0,
  max_ai_queries    int  not null default 0,
  max_match_requests int not null default 0,
  match_engine      text not null default 'none',
  analytics_level   text not null default 'basic',
  featured_profile  boolean not null default false
);

insert into public.plan_entitlements
  (tier, layer, monthly_price, annual_price, max_deal_rooms, max_ai_queries, max_match_requests, match_engine, analytics_level, featured_profile)
values
  ('starter','Network Access Layer',        20, 168,  0,  20,  2, 'none',     'basic',         false),
  ('pro',    'Professional Access Layer',   50, 420,  2,  -1, 20, 'standard', 'enhanced',      false),
  ('gold',   'Institutional Access Layer', 100, 840, -1,  -1, -1, 'full',     'institutional', true)
on conflict (tier) do update set
  max_deal_rooms     = excluded.max_deal_rooms,
  max_ai_queries     = excluded.max_ai_queries,
  max_match_requests = excluded.max_match_requests,
  match_engine       = excluded.match_engine,
  analytics_level    = excluded.analytics_level,
  featured_profile   = excluded.featured_profile;

-- 2. Null-safe tier gate. If the entitlements row is somehow missing, fall back
--    to a sane default derived from the tier name so Gold/Pro are never blocked.
create or replace function public.can_create_deal_room(uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare mx int; cnt int; t text;
begin
  t := public.current_tier(uid);
  select max_deal_rooms into mx from public.plan_entitlements where tier = t;
  if mx is null then
    mx := case t when 'gold' then -1 when 'pro' then 2 else 0 end;
  end if;
  if mx = 0  then return false; end if;   -- Starter: none
  if mx = -1 then return true;  end if;   -- Gold: unlimited
  select public.active_deal_room_count(uid) into cnt;
  return coalesce(cnt, 0) < mx;           -- Pro: capped
end; $$;

-- 3. Re-assert the INSERT policy (no change in logic; ensures it's present).
drop policy if exists dr_insert on public.deal_rooms;
create policy dr_insert on public.deal_rooms for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_deal_room(auth.uid()));

grant execute on function public.can_create_deal_room(uuid) to authenticated;
grant execute on function public.current_tier(uuid) to authenticated;

-- Verify
select tier, max_deal_rooms, max_ai_queries, match_engine from public.plan_entitlements order by monthly_price;
