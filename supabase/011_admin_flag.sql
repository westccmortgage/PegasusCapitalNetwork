-- ============================================================================
-- PEGASUS Migration 011 — Dedicated admin flag (decoupled from role)
-- IDEMPOTENT — safe to run multiple times.
--
-- ROOT CAUSE THIS FIXES:
--   profiles.role was overloaded — it stored BOTH the professional role
--   (broker, lender, etc.) AND the admin flag ('admin'). When a user completed
--   their profile via profile-edit.html, role was overwritten with their
--   profession (e.g. 'broker'), silently destroying their admin status.
--
--   This adds a dedicated is_admin boolean that profile editing never touches.
-- ============================================================================

-- 1. Add the dedicated admin flag
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- 2. Promote the known admin account(s) by email.
--    Add more emails here if you have multiple admins.
update public.profiles
  set is_admin = true
  where lower(email) in ('westccmortgage@gmail.com');

-- 3. Also promote anyone whose role is still literally 'admin' (legacy),
--    so existing admin accounts keep working during the transition.
update public.profiles
  set is_admin = true
  where role = 'admin';

-- 4. Index for fast admin lookups
create index if not exists idx_profiles_is_admin on public.profiles(is_admin) where is_admin = true;

-- 5. SECURITY DEFINER helper — single source of truth, callable from RLS.
--    Returns true if the current authenticated user is an admin.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or role = 'admin'
       from public.profiles
      where id = auth.uid()
      limit 1),
    false
  );
$$;

-- 6. Verify
select id, email, role, is_admin
  from public.profiles
 where is_admin = true;
