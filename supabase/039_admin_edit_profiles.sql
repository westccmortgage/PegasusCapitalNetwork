-- ============================================================================
-- PEGASUS Migration 039 — Allow admins to UPDATE any member profile
-- IDEMPOTENT — safe to run multiple times.
--
-- WHY:
--   The only UPDATE policy on profiles is prof_self_u (id = auth.uid()), so an
--   admin physically cannot save edits to another member's profile. This adds a
--   SEPARATE admin UPDATE policy that uses the existing SECURITY DEFINER helper
--   public.is_admin_user() (from migration 011). prof_self_u is left untouched,
--   so normal members keep editing only their own row.
--
--   Postgres evaluates multiple permissive policies with OR — a row is updatable
--   if EITHER prof_self_u OR this admin policy passes.
-- ============================================================================

-- Drop first so re-runs pick up any tweaks (idempotent).
drop policy if exists prof_admin_u on public.profiles;

create policy prof_admin_u
  on public.profiles
  for update
  to authenticated
  using ( public.is_admin_user() )
  with check ( public.is_admin_user() );

-- Verify the policy now exists alongside prof_self_u
select policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'profiles'
   and cmd = 'UPDATE';
