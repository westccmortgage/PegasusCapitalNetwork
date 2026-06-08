-- ============================================================================
-- PEGASUS Migration 012 — Reconcile billing table columns
-- IDEMPOTENT. Optional: the app now self-heals around missing columns, but
-- running this brings subscriptions + memberships up to the full schema so
-- richer fields (billing cycle, period end, trial end) are stored too.
--
-- WHY: an earlier migration created subscriptions/memberships with a minimal
-- column set, and CREATE TABLE IF NOT EXISTS in 010 could not add columns to
-- an already-existing table. These ALTERs add whatever is missing.
-- ============================================================================

-- subscriptions
alter table public.subscriptions add column if not exists tier text not null default 'starter';
alter table public.subscriptions add column if not exists status text not null default 'active';
alter table public.subscriptions add column if not exists billing_cycle text not null default 'monthly';
alter table public.subscriptions add column if not exists stripe_customer_id text;
alter table public.subscriptions add column if not exists stripe_subscription_id text;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists trial_end timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

-- memberships (has plan + billing aliases in addition to the above)
alter table public.memberships add column if not exists tier text not null default 'starter';
alter table public.memberships add column if not exists plan text not null default 'starter';
alter table public.memberships add column if not exists status text not null default 'active';
alter table public.memberships add column if not exists billing_cycle text not null default 'monthly';
alter table public.memberships add column if not exists billing text;
alter table public.memberships add column if not exists stripe_customer_id text;
alter table public.memberships add column if not exists stripe_subscription_id text;
alter table public.memberships add column if not exists current_period_end timestamptz;
alter table public.memberships add column if not exists trial_end timestamptz;
alter table public.memberships add column if not exists cancel_at_period_end boolean not null default false;
alter table public.memberships add column if not exists updated_at timestamptz not null default now();

-- Verify
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'subscriptions'
 order by ordinal_position;
