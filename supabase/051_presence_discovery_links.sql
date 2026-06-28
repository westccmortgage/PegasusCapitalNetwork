-- ============================================================================
-- PEGASUS Migration 051 — Discovery & association links
--
-- Connects business pages to people and to the network feed, WITHOUT exposing
-- private data and WITHOUT weakening RLS. Three SECURITY DEFINER RPCs that each
-- enforce visibility by auth.uid() and return safe fields only.
--
--   1. get_profile_business_pages_by_slug(p_profile_slug) — the businesses /
--      projects a person represents, for their public profile.
--   2. get_recent_network_activity() — a mixed recent feed of people +
--      business/project pages (guests see business pages only; members also see
--      people — matching the existing member-privacy gate).
--   3. get_presence_page_by_slug(...) re-created to also return a safe
--      "managed_by" attribution (name + profile slug), honoring
--      show_owner_publicly. NEVER returns owner_user_id / metadata / role rows.
--
-- Depends on 047/050. IDEMPOTENT. No table/RLS changes.
-- ============================================================================

-- ── 1. Businesses / projects a person represents ─────────────────────────────
create or replace function public.get_profile_business_pages_by_slug(p_profile_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_admin  boolean := false;
  v_target uuid;
  v_result jsonb;
begin
  if p_profile_slug is null or btrim(p_profile_slug) = '' then return '[]'::jsonb; end if;
  select id into v_target from public.profiles where profile_slug = p_profile_slug limit 1;
  if v_target is null then return '[]'::jsonb; end if;
  if v_me is not null then v_admin := public.is_admin_user(); end if;

  select coalesce(jsonb_agg(obj order by ord desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
             'id', pr.id, 'presence_type', pr.presence_type, 'name', pr.name, 'slug', pr.slug,
             'tagline', pr.tagline, 'short_description', pr.short_description,
             'category', pr.category, 'industry', pr.industry,
             'location', pr.location, 'market', pr.market,
             'visibility', pr.visibility, 'status', pr.status,
             'can_manage',
               ( v_admin or exists (
                   select 1 from public.presence_members mm
                   where mm.presence_id = pr.id and mm.user_id = v_me
                     and mm.role in ('owner','admin','editor')) )
           ) as obj,
           coalesce(pr.updated_at, pr.created_at) as ord
    from public.presence_members pm
    join public.presences pr on pr.id = pm.presence_id
    where pm.user_id = v_target
      and pr.presence_type <> 'personal'
      and pr.status = 'active'
      and (
            v_admin
            or exists (select 1 from public.presence_members me2
                        where me2.presence_id = pr.id and me2.user_id = v_me)
            or pr.visibility = 'public_preview'
            or (pr.visibility = 'member_only' and v_me is not null)
          )
  ) s;

  return v_result;
end;
$$;

grant execute on function public.get_profile_business_pages_by_slug(text) to anon, authenticated;

-- ── 2. Recent mixed network activity (people + business/project pages) ───────
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
  select coalesce(jsonb_agg(obj order by ord desc), '[]'::jsonb) into v_result
  from (
    select obj, ord from (
      -- People — only for authenticated viewers (guests never see real members)
      select jsonb_build_object(
               'kind','person','name',pf.full_name,'slug',pf.profile_slug,
               'url', case when pf.profile_slug is not null
                           then '/u/'||pf.profile_slug
                           else '/public-profile.html?id='||pf.id end,
               'meta', coalesce(nullif(replace(pf.role,'_',' '),''),'member'),
               'location', pf.location
             ) as obj,
             pf.updated_at as ord
      from public.profiles pf
      where v_me is not null and pf.full_name is not null and btrim(pf.full_name) <> ''

      union all

      -- Business / project pages — public_preview to all; member_only to members
      select jsonb_build_object(
               'kind', pr.presence_type, 'name', pr.name, 'slug', pr.slug,
               'url', '/presence.html?slug='||pr.slug,
               'meta', coalesce(nullif(pr.category,''), initcap(replace(pr.presence_type,'_',' '))),
               'location', coalesce(pr.location, pr.market)
             ) as obj,
             coalesce(pr.updated_at, pr.created_at) as ord
      from public.presences pr
      where pr.presence_type <> 'personal' and pr.status = 'active'
        and ( pr.visibility = 'public_preview'
              or (pr.visibility = 'member_only' and v_me is not null) )
    ) u
    order by ord desc nulls last
    limit 24
  ) s;

  return v_result;
end;
$$;

grant execute on function public.get_recent_network_activity() to anon, authenticated;

-- ── 3. get_presence_page_by_slug + safe managed_by attribution ───────────────
create or replace function public.get_presence_page_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  r             record;
  v_role        text;
  v_can_publish boolean := false;
  v_member      boolean := false;
  v_can_manage  boolean := false;
  v_admin       boolean := false;
  v_safe        jsonb;
  v_oname       text;
  v_oslug       text;
  v_managed     jsonb;
begin
  if p_slug is null or btrim(p_slug) = '' then return null; end if;
  select * into r from public.presences where slug = p_slug limit 1;
  if not found then return null; end if;

  if v_me is not null then
    v_admin := public.is_admin_user();
    select role, can_publish_as into v_role, v_can_publish
    from public.presence_members where presence_id = r.id and user_id = v_me limit 1;
    v_member     := v_role is not null;
    v_can_manage := (v_role in ('owner','admin','editor')) or v_admin;
  end if;

  v_safe := jsonb_build_object(
    'id', r.id, 'presence_type', r.presence_type, 'name', r.name, 'slug', r.slug,
    'tagline', r.tagline, 'short_description', r.short_description,
    'category', r.category, 'industry', r.industry, 'location', r.location, 'market', r.market,
    'website_url', r.website_url, 'public_cta_label', r.public_cta_label, 'public_cta_url', r.public_cta_url,
    'offers', r.offers, 'looking_for', r.looking_for, 'ideal_connections', r.ideal_connections,
    'visibility', r.visibility, 'status', r.status
  );

  -- Safe "managed by" attribution — owner display name + profile slug only,
  -- never owner_user_id. Anonymous viewers see a generic label unless the owner
  -- opted in via show_owner_publicly.
  select full_name, profile_slug into v_oname, v_oslug from public.profiles where id = r.owner_user_id;
  if v_can_manage then
    v_managed := jsonb_build_object('name', v_oname, 'slug', v_oslug, 'you', (r.owner_user_id = v_me), 'generic', false);
  elsif coalesce(r.show_owner_publicly, false) then
    v_managed := jsonb_build_object('name', v_oname, 'slug', v_oslug, 'you', false, 'generic', false);
  elsif v_me is not null then
    v_managed := jsonb_build_object('name', v_oname, 'slug', v_oslug, 'you', false, 'generic', false);
  else
    v_managed := jsonb_build_object('name', null, 'slug', null, 'you', false, 'generic', true);
  end if;

  if v_can_manage or v_member then
    return jsonb_build_object('access','full','presence',v_safe,'managed_by',v_managed,
      'role',v_role,'can_publish_as',coalesce(v_can_publish,false),'can_manage',v_can_manage);
  end if;

  if r.status <> 'active' then return jsonb_build_object('access','unavailable'); end if;

  if r.visibility = 'public_preview' then
    if v_me is null and not coalesce(r.public_preview_enabled, true) then
      return jsonb_build_object('access','locked');
    end if;
    return jsonb_build_object('access','full','presence',v_safe,'managed_by',v_managed,
      'role',null,'can_publish_as',false,'can_manage',false);
  elsif r.visibility = 'member_only' then
    if v_me is null then return jsonb_build_object('access','locked'); end if;
    return jsonb_build_object('access','full','presence',v_safe,'managed_by',v_managed,
      'role',null,'can_publish_as',false,'can_manage',false);
  else
    return jsonb_build_object('access','unavailable');
  end if;
end;
$$;

grant execute on function public.get_presence_page_by_slug(text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'discovery links ready' as status;
