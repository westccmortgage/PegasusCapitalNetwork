-- ============================================================================
-- 006 — profile_slug: unique shareable profile addresses (LinkedIn-style)
-- Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================================

alter table public.profiles add column if not exists profile_slug text;

-- Generate a unique slug from a base string, avoiding collisions
create or replace function public.generate_profile_slug(base text, uid uuid)
returns text language plpgsql as $$
declare candidate text; n int := 0;
begin
  base := lower(regexp_replace(coalesce(base,''), '[^a-z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  if base = '' then base := 'member'; end if;
  candidate := base;
  while exists(select 1 from public.profiles where profile_slug = candidate and id <> uid) loop
    n := n + 1;
    if n > 50 then candidate := base || '-' || substr(uid::text,1,8); exit; end if;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- Auto-assign slug on insert/update when missing
create or replace function public.set_profile_slug()
returns trigger language plpgsql as $$
begin
  if new.profile_slug is null or new.profile_slug = '' then
    new.profile_slug := public.generate_profile_slug(
      coalesce(new.full_name, split_part(new.email,'@',1)), new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_set_profile_slug on public.profiles;
create trigger trg_set_profile_slug
  before insert or update on public.profiles
  for each row execute procedure public.set_profile_slug();

-- Backfill existing rows
update public.profiles
set profile_slug = public.generate_profile_slug(
  coalesce(full_name, split_part(email,'@',1)), id)
where profile_slug is null or profile_slug = '';

-- Enforce uniqueness
create unique index if not exists idx_profiles_slug on public.profiles(profile_slug);

-- Public read of profile_slug is already covered by prof_read (using true)
select id, full_name, profile_slug from public.profiles order by created_at desc limit 20;
