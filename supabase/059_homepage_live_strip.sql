-- 059_homepage_live_strip.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Curate the public "Most Active in Pegasus" homepage strip so that no single
-- owner can dominate it. This redefines get_recent_network_activity() to:
--   • cap business/project pages to the 2 most-recent PER OWNER (server-side),
--   • add an OPAQUE owner_group key (md5 of the owner id) so the client can
--     diversify further WITHOUT ever receiving a real user id,
--   • keep people visible only to authenticated viewers (guests never see them).
-- Public-safe: never returns owner_user_id, emails, phone, metadata, private or
-- (for guests) member-only content. Output shape is backward compatible — it
-- only ADDS owner_group, so existing callers keep working.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_recent_network_activity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(obj order by ord desc nulls last), '[]'::jsonb) into v_result
  from (
    select obj, ord from (

      -- People — only for authenticated viewers (guests never see real members)
      select jsonb_build_object(
               'kind','person','name',pf.full_name,'slug',pf.profile_slug,
               'url', case when pf.profile_slug is not null
                           then '/u/'||pf.profile_slug
                           else '/public-profile.html?id='||pf.id end,
               'meta', coalesce(nullif(replace(pf.role,'_',' '),''),'member'),
               'location', pf.location,
               'owner_group', md5(pf.id::text)
             ) as obj,
             pf.updated_at as ord
      from public.profiles pf
      where v_me is not null and pf.full_name is not null and btrim(pf.full_name) <> ''

      union all

      -- Business / project pages — at most 2 most-recent per owner
      select jsonb_build_object(
               'kind', b.presence_type, 'name', b.name, 'slug', b.slug,
               'url', '/presence.html?slug='||b.slug,
               'meta', coalesce(nullif(b.category,''), initcap(replace(b.presence_type,'_',' '))),
               'location', coalesce(b.location, b.market),
               'owner_group', md5(coalesce(b.owner_user_id::text, b.id::text))
             ) as obj,
             b.ord as ord
      from (
        select pr.*,
               coalesce(pr.updated_at, pr.created_at) as ord,
               row_number() over (
                 partition by pr.owner_user_id
                 order by coalesce(pr.updated_at, pr.created_at) desc nulls last
               ) as rn
        from public.presences pr
        where pr.presence_type <> 'personal'
          and pr.status = 'active'
          and ( pr.visibility = 'public_preview'
                or (pr.visibility = 'member_only' and v_me is not null) )
      ) b
      where b.rn <= 2

    ) u
    order by ord desc nulls last
    limit 24
  ) s;

  return v_result;
end;
$$;

grant execute on function public.get_recent_network_activity() to anon, authenticated;
