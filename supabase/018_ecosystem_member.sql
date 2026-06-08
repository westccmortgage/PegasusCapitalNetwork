-- ============================================================================
-- 018 — Ecosystem Member role + identity fields (safe, additive)
-- profiles.role already exists; ecosystem_member is just a new allowed value
-- handled in the app. These columns store the Ecosystem Identity details.
-- ============================================================================
alter table public.profiles add column if not exists ecosystem_role         text;
alter table public.profiles add column if not exists ecosystem_contribution text;
alter table public.profiles add column if not exists ecosystem_goals        text;
alter table public.profiles add column if not exists expertise_areas        text[] not null default '{}';
