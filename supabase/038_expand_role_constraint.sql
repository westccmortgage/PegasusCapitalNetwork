-- ============================================================================
-- 038 — Expand profiles.role CHECK constraint
--
-- The profile-edit form includes 'ecosystem_member' as a selectable role,
-- but the profiles table CHECK constraint did not include it — causing
-- "new row for relation profiles violates check constraint profiles_role_check"
-- whenever a user selected that option and saved their profile.
--
-- This migration:
--   1. Drops the old profiles_role_check constraint
--   2. Recreates it with the full current role list including ecosystem_member
--
-- Idempotent: uses DO $$ exception handler so re-running is safe.
-- ============================================================================

do $$
begin
  -- Drop the existing role constraint (name may vary)
  alter table public.profiles drop constraint if exists profiles_role_check;
exception
  when undefined_object then null;
end $$;

-- Recreate with the full expanded role list
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'borrower',
    'lender',
    'broker',
    'agent',
    'insurance',
    'rwa_partner',
    'business_funding_provider',
    'investor',
    'developer',
    'ecosystem_member',
    'admin'
  ));

select 'profiles_role_check updated — ecosystem_member now allowed' as status;
