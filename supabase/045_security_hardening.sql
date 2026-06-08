-- ============================================================================
-- PEGASUS Migration 045 — Security hardening
-- Closes findings from the full-site audit (2026-06-04):
--   C1 — privilege escalation: any member could self-grant is_admin / role='admin'
--   H7 — homepage_events writable by any authenticated user (defacement)
--   H6 — member_log (PII + access codes) had NO row-level security
--   H5 — anon could read every member's email / access codes off public.profiles
--
-- IDEMPOTENT — safe to run multiple times. Run AFTER all prior migrations.
-- IMPORTANT: deploy the updated static site BEFORE running this, so the H5
-- column lock-down lines up with the front-end (the 5 *-profile.html pages now
-- select explicit columns instead of '*').
-- ============================================================================

-- ── C1: lock the privilege columns on public.profiles ───────────────────────
-- The prof_self_u policy (002) is `using (id = auth.uid())` with no WITH CHECK,
-- so a logged-in member could UPDATE *any* column on their own row — including
-- is_admin. is_admin_user() (011) trusts both is_admin AND role='admin', so the
-- legacy role path is an escalation vector too. This BEFORE-UPDATE trigger makes
-- both immutable for non-admins while leaving normal profile edits untouched.
create or replace function public.guard_profile_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-side operations (SQL editor, service_role key, SECURITY DEFINER jobs
  -- such as the Stripe webhook and the admin-promotion script in 011) run with
  -- no JWT, so auth.uid() is null. Trust them.
  if auth.uid() is null then
    return new;
  end if;

  -- Real admins may change anything (e.g. the admin profile editor / RPCs).
  if public.is_admin_user() then
    return new;
  end if;

  -- Non-admins: the admin flag is immutable…
  new.is_admin := old.is_admin;

  -- …and they cannot escalate through the legacy role='admin' value. (Any other
  -- professional role — broker, lender, etc. — is still allowed, so the normal
  -- profile-completion flow keeps working.)
  if new.role = 'admin' and coalesce(old.role, '') <> 'admin' then
    new.role := old.role;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_profile_privilege on public.profiles;
create trigger trg_guard_profile_privilege
  before update on public.profiles
  for each row execute function public.guard_profile_privilege();

-- ── H7: homepage_events writes require admin (was: any authenticated user) ───
-- hpe_admin_all (007) was `for all to authenticated using(true) with check(true)`
-- despite the name — any member could insert/edit/delete the public homepage
-- "Event of the Month" card. Gate it on is_admin_user(). Public read (anon,
-- active=true) via hpe_public_read is unchanged.
drop policy if exists hpe_admin_all on public.homepage_events;
create policy hpe_admin_all on public.homepage_events
  for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

-- ── H6: enable RLS on member_log (PII + access codes) ───────────────────────
-- member_log (027, enriched in 033) is the only table with RLS never enabled,
-- so access fell back to ambient grants (anon/authenticated could read every
-- member's email, signup method and redeemed access code). Lock it to admins.
-- Inserts come from _on_new_auth_user() (SECURITY DEFINER) which bypasses RLS,
-- so signups are unaffected.
alter table public.member_log enable row level security;
revoke select on public.member_log from anon;
revoke select on public.member_log from authenticated;
drop policy if exists ml_admin_read on public.member_log;
create policy ml_admin_read on public.member_log
  for select
  to authenticated
  using (public.is_admin_user());

-- ── H5: stop anon reading email / access codes / review metadata ────────────
-- profiles_public_read (007) is `for select to anon using(true)`; RLS is
-- row-level, not column-level, so logged-out callers could scrape the whole
-- roster's emails with the public anon key. Replace anon's table-wide SELECT
-- with a column-scoped grant covering only directory-safe columns. The grant is
-- built dynamically so it stays correct regardless of how many columns prior
-- migrations added. The public anon read POLICY stays; only the column GRANT is
-- narrowed.
--
-- NOTE (residual): authenticated members still read all columns of profiles via
-- prof_read (002, `using(true)`), including each other's email — required today
-- by the CRM (crm.js) and connect flow. Tighten later with an admin-only RPC /
-- separate private table if member-to-member email harvesting is a concern.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name not in (
      'email',                  -- PII
      'access_code',            -- redeemed access codes
      'invited_by',             -- referral graph
      'signup_source',          -- internal attribution
      'review_notes',           -- internal moderation notes
      'review_status',
      'reviewed_at',
      'reviewed_by',
      'reviewed_by_pegasus'
    );
  execute 'revoke select on public.profiles from anon';
  execute 'grant select (' || cols || ') on public.profiles to anon';
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- 1) anon should NOT be able to select email (expect: email absent from list)
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles'
   and grantee = 'anon' and column_name = 'email';

-- 2) confirm RLS is enabled on member_log (expect: rowsecurity = true)
select relname, relrowsecurity
  from pg_class
 where oid = 'public.member_log'::regclass;

-- 3) confirm the privilege guard trigger exists
select tgname from pg_trigger
 where tgrelid = 'public.profiles'::regclass
   and tgname = 'trg_guard_profile_privilege';
