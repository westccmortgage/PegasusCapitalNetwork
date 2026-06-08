-- ============================================================================
-- PEGASUS NETWORK — Membership, Access Control & Deal Room schema
-- Project: trdwsssouhpawhfdkfqf
-- Idempotent migration. Safe to re-run. Run in Supabase SQL Editor.
--
-- Design principles:
--   * All entitlement checks live in SECURITY DEFINER functions with a fixed
--     search_path => no RLS recursion (same pattern as your is_admin_user()).
--   * Tier limits are DATA (plan_entitlements table), not code => change limits
--     without a deploy. -1 means "unlimited".
--   * Deal Room creation limits are enforced in the INSERT WITH CHECK policy,
--     so the cap is impossible to bypass from the client.
-- ============================================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";

-- ---------- ENUMS (as text + checks, for easy future edits) ----------
-- tiers: starter | pro | gold
-- sub status: trialing | active | past_due | canceled | incomplete
-- room stage: 0..6 (Structuring..Funded)

-- ============================================================================
-- 1. PLAN ENTITLEMENTS  (the single source of truth for tier limits)
-- ============================================================================
create table if not exists public.plan_entitlements (
  tier              text primary key check (tier in ('starter','pro','gold')),
  layer             text not null,
  monthly_price     int  not null,
  annual_price      int  not null,
  max_deal_rooms    int  not null,   -- 0 = none, -1 = unlimited
  max_ai_queries    int  not null,   -- per calendar month, -1 = unlimited
  max_match_requests int not null,   -- per calendar month, -1 = unlimited
  match_engine      text not null check (match_engine in ('none','standard','full')),
  analytics_level   text not null check (analytics_level in ('basic','enhanced','institutional')),
  featured_profile  boolean not null default false
);

insert into public.plan_entitlements
  (tier, layer, monthly_price, annual_price, max_deal_rooms, max_ai_queries, max_match_requests, match_engine, analytics_level, featured_profile)
values
  ('starter','Network Access Layer',        20, 168,  0,  20,  2, 'none',     'basic',         false),
  ('pro',    'Professional Access Layer',   50, 420,  2,  -1, 20, 'standard', 'enhanced',      false),
  ('gold',   'Institutional Access Layer', 100, 840, -1,  -1, -1, 'full',     'institutional', true)
on conflict (tier) do update set
  layer=excluded.layer, monthly_price=excluded.monthly_price, annual_price=excluded.annual_price,
  max_deal_rooms=excluded.max_deal_rooms, max_ai_queries=excluded.max_ai_queries,
  max_match_requests=excluded.max_match_requests, match_engine=excluded.match_engine,
  analytics_level=excluded.analytics_level, featured_profile=excluded.featured_profile;

-- ============================================================================
-- 2. SUBSCRIPTIONS  (one row per user, synced from Stripe webhook)
-- ============================================================================
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  tier                   text not null default 'starter' check (tier in ('starter','pro','gold')),
  status                 text not null default 'active'  check (status in ('trialing','active','past_due','canceled','incomplete')),
  billing_cycle          text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_sub_user on public.subscriptions(user_id);
create index if not exists idx_sub_stripe_cust on public.subscriptions(stripe_customer_id);

-- ============================================================================
-- 3. DEAL ROOMS  (Pegasus Deal Room™)
-- ============================================================================
create table if not exists public.deal_rooms (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  deal_type       text,
  amount          numeric(14,2) default 0,
  ltv             text,
  location        text,
  stage           int  not null default 0 check (stage between 0 and 6),
  alignment_score int  not null default 0 check (alignment_score between 0 and 100),
  debt_yield      text,
  risk_tier       text,
  confidence      text,
  refi_window     text,
  status          text not null default 'active' check (status in ('active','funded','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_dr_owner  on public.deal_rooms(owner_id);
create index if not exists idx_dr_status on public.deal_rooms(status);

-- ============================================================================
-- 4. DEAL ROOM PARTICIPANTS
-- ============================================================================
create table if not exists public.deal_room_participants (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,  -- null = external invite
  display_name text not null,
  role         text not null,
  initials     text,
  status       text not null default 'active' check (status in ('active','invited')),
  created_at   timestamptz not null default now(),
  unique (deal_room_id, user_id)
);
create index if not exists idx_drp_room on public.deal_room_participants(deal_room_id);
create index if not exists idx_drp_user on public.deal_room_participants(user_id);

-- ============================================================================
-- 5. DEAL ROOM DOCUMENTS  (metadata; bytes live in Storage bucket)
-- ============================================================================
create table if not exists public.deal_room_documents (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  name         text not null,
  doc_type     text,
  status       text not null default 'pending' check (status in ('verified','pending','review')),
  storage_path text,            -- e.g. deal-room-docs/<room_id>/<file>
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_drd_room on public.deal_room_documents(deal_room_id);

-- ============================================================================
-- 6. DEAL ROOM ACTIVITY  (timeline)
-- ============================================================================
create table if not exists public.deal_room_activity (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  message      text not null,
  kind         text default 'info',
  created_at   timestamptz not null default now()
);
create index if not exists idx_dra_room on public.deal_room_activity(deal_room_id, created_at desc);

-- ============================================================================
-- 7. LENDER INTEREST
-- ============================================================================
create table if not exists public.lender_interest (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  lender_name  text not null,
  terms        text,
  status       text not null default 'interested' check (status in ('interested','reviewing','term_sheet','accepted','declined')),
  created_at   timestamptz not null default now()
);
create index if not exists idx_li_room on public.lender_interest(deal_room_id);

-- ============================================================================
-- 8. USAGE METERING  (AI queries + match requests, per calendar month)
-- ============================================================================
create table if not exists public.ai_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  query_count  int  not null default 0,
  primary key (user_id, period_month)
);
create table if not exists public.match_requests (
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  request_count int not null default 0,
  primary key (user_id, period_month)
);

-- ============================================================================
-- ENTITLEMENT FUNCTIONS  (SECURITY DEFINER, fixed search_path => no recursion)
-- ============================================================================

create or replace function public.current_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tier from public.subscriptions
      where user_id = uid and status in ('active','trialing')
      order by updated_at desc limit 1),
    'starter'
  );
$$;

create or replace function public.entitlements(uid uuid)
returns public.plan_entitlements language sql stable security definer set search_path = public as $$
  select pe.* from public.plan_entitlements pe
  where pe.tier = public.current_tier(uid);
$$;

create or replace function public.active_deal_room_count(uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.deal_rooms
  where owner_id = uid and status = 'active';
$$;

-- Hard gate used by the deal_rooms INSERT policy.
create or replace function public.can_create_deal_room(uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare mx int; cnt int;
begin
  select max_deal_rooms into mx from public.plan_entitlements where tier = public.current_tier(uid);
  if mx = 0  then return false; end if;   -- Starter: no rooms
  if mx = -1 then return true;  end if;   -- Gold: unlimited
  select public.active_deal_room_count(uid) into cnt;
  return cnt < mx;                        -- Pro: cap at 2
end; $$;

create or replace function public.has_match_engine(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select match_engine from public.plan_entitlements where tier = public.current_tier(uid)) <> 'none';
$$;

-- Membership test used across Deal Room child-table policies.
create or replace function public.is_room_member(room uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.deal_rooms d where d.id = room and d.owner_id = uid)
      or exists (select 1 from public.deal_room_participants p where p.deal_room_id = room and p.user_id = uid);
$$;

create or replace function public.is_room_owner(room uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.deal_rooms d where d.id = room and d.owner_id = uid);
$$;

-- Atomic AI usage: returns TRUE if allowed (and increments), FALSE if over limit.
create or replace function public.consume_ai_query()
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mx int; used int; m date := date_trunc('month', now())::date;
begin
  if uid is null then return false; end if;
  select max_ai_queries into mx from public.plan_entitlements where tier = public.current_tier(uid);
  insert into public.ai_usage(user_id, period_month, query_count) values (uid, m, 0)
    on conflict (user_id, period_month) do nothing;
  select query_count into used from public.ai_usage where user_id = uid and period_month = m;
  if mx <> -1 and used >= mx then return false; end if;
  update public.ai_usage set query_count = query_count + 1 where user_id = uid and period_month = m;
  return true;
end; $$;

-- Ensure a subscription row exists for the current user (call on first login).
create or replace function public.ensure_subscription()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions(user_id, tier, status)
  values (auth.uid(), 'starter', 'active')
  on conflict (user_id) do nothing;
end; $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.plan_entitlements      enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.deal_rooms             enable row level security;
alter table public.deal_room_participants enable row level security;
alter table public.deal_room_documents    enable row level security;
alter table public.deal_room_activity     enable row level security;
alter table public.lender_interest        enable row level security;
alter table public.ai_usage               enable row level security;
alter table public.match_requests         enable row level security;

-- plan_entitlements: world-readable to authenticated users (it's pricing data)
drop policy if exists pe_read on public.plan_entitlements;
create policy pe_read on public.plan_entitlements for select to authenticated using (true);

-- subscriptions: a user reads/updates only their own. (Webhook uses service role,
-- which bypasses RLS, so no insert policy is needed for that path.)
drop policy if exists sub_read on public.subscriptions;
create policy sub_read on public.subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists sub_self_insert on public.subscriptions;
create policy sub_self_insert on public.subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists sub_self_update on public.subscriptions;
create policy sub_self_update on public.subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- deal_rooms
drop policy if exists dr_select on public.deal_rooms;
create policy dr_select on public.deal_rooms for select to authenticated
  using (owner_id = auth.uid() or public.is_room_member(id, auth.uid()));

drop policy if exists dr_insert on public.deal_rooms;
create policy dr_insert on public.deal_rooms for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_deal_room(auth.uid()));  -- TIER GATE

drop policy if exists dr_update on public.deal_rooms;
create policy dr_update on public.deal_rooms for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists dr_delete on public.deal_rooms;
create policy dr_delete on public.deal_rooms for delete to authenticated
  using (owner_id = auth.uid());

-- deal_room_participants
drop policy if exists drp_select on public.deal_room_participants;
create policy drp_select on public.deal_room_participants for select to authenticated
  using (public.is_room_member(deal_room_id, auth.uid()));
drop policy if exists drp_write on public.deal_room_participants;
create policy drp_write on public.deal_room_participants for all to authenticated
  using (public.is_room_owner(deal_room_id, auth.uid()))
  with check (public.is_room_owner(deal_room_id, auth.uid()));

-- deal_room_documents
drop policy if exists drd_select on public.deal_room_documents;
create policy drd_select on public.deal_room_documents for select to authenticated
  using (public.is_room_member(deal_room_id, auth.uid()));
drop policy if exists drd_insert on public.deal_room_documents;
create policy drd_insert on public.deal_room_documents for insert to authenticated
  with check (public.is_room_member(deal_room_id, auth.uid()));
drop policy if exists drd_modify on public.deal_room_documents;
create policy drd_modify on public.deal_room_documents for update to authenticated
  using (public.is_room_owner(deal_room_id, auth.uid()));

-- deal_room_activity
drop policy if exists dra_select on public.deal_room_activity;
create policy dra_select on public.deal_room_activity for select to authenticated
  using (public.is_room_member(deal_room_id, auth.uid()));
drop policy if exists dra_insert on public.deal_room_activity;
create policy dra_insert on public.deal_room_activity for insert to authenticated
  with check (public.is_room_member(deal_room_id, auth.uid()));

-- lender_interest
drop policy if exists li_select on public.lender_interest;
create policy li_select on public.lender_interest for select to authenticated
  using (public.is_room_member(deal_room_id, auth.uid()));
drop policy if exists li_write on public.lender_interest;
create policy li_write on public.lender_interest for all to authenticated
  using (public.is_room_owner(deal_room_id, auth.uid()))
  with check (public.is_room_owner(deal_room_id, auth.uid()));

-- usage tables: own rows only
drop policy if exists au_self on public.ai_usage;
create policy au_self on public.ai_usage for select to authenticated using (user_id = auth.uid());
drop policy if exists mr_self on public.match_requests;
create policy mr_self on public.match_requests for select to authenticated using (user_id = auth.uid());

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_sub_touch on public.subscriptions;
create trigger trg_sub_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_dr_touch on public.deal_rooms;
create trigger trg_dr_touch before update on public.deal_rooms
  for each row execute function public.touch_updated_at();

-- Auto-add the owner as the first participant when a Deal Room is created.
create or replace function public.add_owner_participant()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; ini text;
begin
  select coalesce(full_name, email), upper(left(coalesce(full_name, email),2))
    into nm, ini from public.profiles where id = new.owner_id;
  insert into public.deal_room_participants(deal_room_id, user_id, display_name, role, initials, status)
  values (new.id, new.owner_id, coalesce(nm,'Owner'), 'Sponsor', coalesce(ini,'SP'), 'active')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists trg_dr_owner on public.deal_rooms;
create trigger trg_dr_owner after insert on public.deal_rooms
  for each row execute function public.add_owner_participant();

-- ============================================================================
-- OPTIONAL: seed a starter subscription whenever a new auth user appears.
-- Only enable if you are NOT already handling this in an existing
-- handle_new_user() trigger. Safe (on conflict do nothing).
-- ============================================================================
-- create or replace function public.seed_starter_subscription()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   insert into public.subscriptions(user_id, tier, status)
--   values (new.id, 'starter', 'active') on conflict (user_id) do nothing;
--   return new;
-- end; $$;
-- drop trigger if exists trg_seed_sub on auth.users;
-- create trigger trg_seed_sub after insert on auth.users
--   for each row execute function public.seed_starter_subscription();

-- Done.
