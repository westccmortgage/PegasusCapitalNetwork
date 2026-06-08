-- ============================================================================
-- PEGASUS Migration 010 — Billing Sync: ensure subscriptions + memberships
-- IDEMPOTENT — safe to run multiple times.
-- Run this in Supabase SQL Editor if membership-schema.sql was not yet run.
-- ============================================================================

-- Ensure subscriptions table exists (primary billing table, webhook-updated)
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  tier                   text not null default 'starter',
  status                 text not null default 'active',
  billing_cycle          text not null default 'monthly',
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_sub_user        on public.subscriptions(user_id);
create index if not exists idx_sub_stripe_cust on public.subscriptions(stripe_customer_id);

-- Ensure memberships table exists (legacy v68 table — store reads both)
create table if not exists public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  plan                   text not null default 'starter',
  tier                   text not null default 'starter',
  status                 text not null default 'active',
  billing_cycle          text not null default 'monthly',
  billing                text,
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- RLS
alter table public.subscriptions enable row level security;
alter table public.memberships    enable row level security;

do $$ begin
  create policy sub_read on public.subscriptions
    for select to authenticated using (user_id = auth.uid());
  create policy sub_self_insert on public.subscriptions
    for insert to authenticated with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy mem_read on public.memberships
    for select to authenticated using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_sub_touch on public.subscriptions;
create trigger trg_sub_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- current_tier() function (used by RLS policies)
create or replace function public.current_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tier from public.subscriptions
      where user_id = uid and status in ('active','trialing')
      order by updated_at desc limit 1),
    'starter'
  );
$$;

-- ensure_subscription() — creates starter row on first login (optional trigger)
create or replace function public.ensure_subscription()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions(user_id, tier, status)
  values (auth.uid(), 'starter', 'active')
  on conflict (user_id) do nothing;
end; $$;

-- Verify the tables exist and show row counts
select
  'subscriptions' as tbl, count(*) as rows from public.subscriptions
union all
select
  'memberships', count(*) from public.memberships;
