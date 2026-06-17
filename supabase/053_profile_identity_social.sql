-- ============================================================================
-- PEGASUS Migration 053 — Profile identity taxonomy + social links (additive)
--
-- 1) Relaxes the role value CHECK so the expanded Role-in-Network taxonomy
--    (Founder, Entrepreneur, Mortgage Broker, Private Lender, Fund Manager, …)
--    can be stored. The privilege trigger from 045 still prevents non-admins
--    from setting role/is_admin to 'admin', so this is safe.
-- 2) Adds optional, nullable columns for additional roles + social/online links.
--    profiles.website already exists.
--
-- Purely additive. IDEMPOTENT. No data migration; existing values keep working.
-- ============================================================================

-- Relax the role value restriction (kept as a free-form category).
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles add column if not exists additional_roles text[];
alter table public.profiles add column if not exists linkedin_url  text;
alter table public.profiles add column if not exists facebook_url  text;
alter table public.profiles add column if not exists instagram_url text;
alter table public.profiles add column if not exists x_url         text;
alter table public.profiles add column if not exists youtube_url   text;
alter table public.profiles add column if not exists tiktok_url    text;

notify pgrst, 'reload schema';

select 'profile taxonomy + social columns ready' as status;
