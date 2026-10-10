-- ============================================================================
-- PEGASUS Migration 094 — Public page view counts (company / event pages)
--
--   presence_views_daily(presence_id, day, views)  — RLS on, no policies
--   record_presence_view(slug)   anon beacon, +1 for today (active public pages)
--   get_presence_views(slug, days) → int   shown in the "claim this page" strip
--   admin_top_viewed_pages(days, limit)     admin-only (Admin → Directory)
-- Counting is client-side (pages are CDN-cached): one view per browser per page
-- per day, obvious bots skipped. Applied to the live project on 2026-10-10.
-- ============================================================================
create table if not exists public.presence_views_daily (
  presence_id uuid not null references public.presences(id) on delete cascade,
  day date not null default current_date,
  views int not null default 0,
  primary key (presence_id, day)
);
alter table public.presence_views_daily enable row level security;

create or replace function public.record_presence_view(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{0,120}$' then return; end if;
  select id into v_id from public.presences
   where slug = p_slug and status = 'active' and visibility = 'public_preview' limit 1;
  if v_id is null then return; end if;
  insert into public.presence_views_daily (presence_id, day, views) values (v_id, current_date, 1)
  on conflict (presence_id, day) do update set views = public.presence_views_daily.views + 1;
end; $$;

create or replace function public.get_presence_views(p_slug text, p_days int default 30) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.views), 0)::int
    from public.presence_views_daily v join public.presences p on p.id = v.presence_id
   where p.slug = p_slug and v.day > current_date - greatest(1, least(coalesce(p_days, 30), 365));
$$;

create or replace function public.admin_top_viewed_pages(p_days int default 30, p_limit int default 50)
returns table (name text, slug text, category text, location text, views int, claimable boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_user() then return; end if;
  return query
  select p.name, p.slug, p.category, p.location, sum(v.views)::int,
         ((p.metadata->>'source') is not null and not exists (select 1 from public.entity_claims ec where ec.entity_id = p.id and ec.status = 'approved'))
    from public.presence_views_daily v join public.presences p on p.id = v.presence_id
   where v.day > current_date - greatest(1, least(coalesce(p_days, 30), 365))
   group by p.id order by 5 desc limit greatest(1, least(coalesce(p_limit, 50), 500));
end; $$;

grant execute on function public.record_presence_view(text), public.get_presence_views(text, int) to anon, authenticated;
grant execute on function public.admin_top_viewed_pages(int, int) to authenticated;
revoke execute on function public.admin_top_viewed_pages(int, int) from anon;
