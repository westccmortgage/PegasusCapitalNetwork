-- ============================================================================
-- 005 — Profile columns safety migration
-- Run this in Supabase SQL Editor if profile saves fail with column errors.
-- All statements use IF NOT EXISTS / DO NOTHING so safe to re-run.
-- ============================================================================

-- Core editable profile columns
alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists markets text[] default '{}';
alter table public.profiles add column if not exists specialties text[] default '{}';
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists website text;
alter table public.profiles add column if not exists avatar_color text;
alter table public.profiles add column if not exists company_name text;
alter table public.profiles add column if not exists profile_completion int default 20;
alter table public.profiles add column if not exists onboarding_complete boolean default false;
alter table public.profiles add column if not exists verification_status text default 'unverified';

-- updated_at trigger (safe — skips if trigger already exists)
do $$ begin
  create or replace function public.handle_updated_at()
  returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end $fn$;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_profiles_updated_at'
    and tgrelid = 'public.profiles'::regclass
  ) then
    create trigger set_profiles_updated_at
      before update on public.profiles
      for each row execute procedure public.handle_updated_at();
  end if;
exception when others then null; end $$;

-- Ensure handle_new_user trigger creates profile row on auth.users insert
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, profile_completion)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'borrower'),
    20
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Attach trigger (safe)
do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
    and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute procedure public.handle_new_user();
  end if;
exception when others then null; end $$;

-- Confirm columns exist (inspect with: select column_name from ...)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;
