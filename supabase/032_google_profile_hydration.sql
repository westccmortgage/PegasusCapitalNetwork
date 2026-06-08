-- ============================================================================
-- PEGASUS Migration 032 — Google OAuth Profile Hydration
-- IDEMPOTENT. Safe to run multiple times. Run ONCE in Supabase SQL Editor.
--
-- WHAT THIS FIXES
-- ---------------
-- The existing handle_new_user() trigger reads full_name from
-- raw_user_meta_data->>'full_name'. Email/password signups set that key
-- (via signUp options.data). Google OAuth, however, populates user_metadata
-- with 'name' and 'picture' (Google's payload keys). The current trigger
-- never sees those, so Google users get full_name = email-prefix fallback
-- and no avatar — which is why post-OAuth users feel like Pegasus "doesn't
-- recognize them."
--
-- This migration rewrites handle_new_user() to read from BOTH naming
-- conventions, populates avatar_url from picture/avatar_url, and is harmless
-- to email/password signups (the new fallbacks just don't fire).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_avatar    text;
  v_role      text;
begin
  -- Read full_name from either Pegasus signup ('full_name') or Google ('name')
  v_full_name := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    split_part(new.email, '@', 1)
  );

  -- Read avatar_url from either ('avatar_url') or Google ('picture')
  v_avatar := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', '')
  );

  -- Role: keep existing default (borrower) when not provided by signup form
  v_role := coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'borrower');

  insert into public.profiles (id, email, full_name, role, avatar_url, profile_completion)
  values (new.id, new.email, v_full_name, v_role, v_avatar, 20)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Triggers are already attached from migrations 002/005; rewriting the
-- function above is enough. No DDL on the trigger itself needed.

-- Sanity: confirm function exists
select proname, prosecdef
  from pg_proc
  where proname = 'handle_new_user'
    and pronamespace = (select oid from pg_namespace where nspname = 'public');
