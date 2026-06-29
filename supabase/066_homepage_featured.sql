-- ============================================================================
-- PEGASUS Migration 066 — Homepage Featured Member + Network Index
--
-- Powers the front-page hero with REAL, public-safe data only:
--   • get_featured_member()  — one member to feature in the hero dossier. Returns
--     only public profile fields (the same fields already shown on /u/{slug}).
--     Selection: a profile flagged is_featured first, else the most recently
--     updated verified member. Never exposes email/phone/private metadata.
--   • get_network_index()    — real counts for the hero index (members, distinct
--     markets, % verified). No invented figures.
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. The frontend degrades
-- gracefully: if these RPCs are absent the dossier and index simply hide.
-- ============================================================================

-- Pin/curate a featured member (admin-toggleable). Defaults to false.
alter table public.profiles add column if not exists is_featured boolean not null default false;

-- Initial featured member (explicit choice). Safe no-op if the slug doesn't exist.
update public.profiles set is_featured = true where profile_slug = 'anatoliy-kanevsky';

-- ── get_featured_member — public-safe single member for the homepage hero ─────
create or replace function public.get_featured_member()
returns table (
  full_name          text,
  role               text,
  professional_title text,
  company_name       text,
  location           text,
  headline           text,
  current_focus      text,
  markets            text[],
  avatar_url         text,
  profile_slug       text,
  reviewed_by_pegasus boolean
)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.role, p.professional_title, p.company_name, p.location,
         p.headline, p.current_focus, p.markets, p.avatar_url, p.profile_slug,
         p.reviewed_by_pegasus
    from public.profiles p
   where p.full_name is not null and btrim(p.full_name) <> ''
     and p.profile_slug is not null
   order by p.is_featured desc,
            p.reviewed_by_pegasus desc nulls last,
            p.profile_completion desc nulls last,
            p.updated_at desc nulls last
   limit 1;
$$;

-- ── get_network_index — real public counts for the hero index ────────────────
create or replace function public.get_network_index()
returns table (members bigint, markets bigint, verified_pct int)
language sql stable security definer set search_path = public as $$
  with m as (
    select reviewed_by_pegasus, markets
      from public.profiles
     where full_name is not null and btrim(full_name) <> ''
  )
  select
    (select count(*) from m)::bigint,
    (select count(distinct mk)
       from (select unnest(markets) as mk from m) s
      where mk is not null and btrim(mk) <> '')::bigint,
    (select case when count(*) = 0 then 0
                 else round(100.0 * count(*) filter (where reviewed_by_pegasus) / count(*))::int
            end
       from m);
$$;

grant execute on function public.get_featured_member() to anon, authenticated;
grant execute on function public.get_network_index()   to anon, authenticated;
