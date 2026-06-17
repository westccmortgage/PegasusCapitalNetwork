-- ============================================================================
-- PEGASUS Migration 050 — Business-value fields (offers / looking_for / ideal)
--
-- Adds three optional, free-text fields so a business/project page can express
-- the actual opportunity: what they offer, what they're looking for, and who
-- should connect. Purely additive — NO change to existing tables' constraints,
-- NO change to RLS, and NO change to the existing create_presence /
-- update_presence_basic signatures (so create/edit keep working untouched).
--
-- Adds:
--   • presences.offers, presences.looking_for, presences.ideal_connections (text)
--   • set_presence_offerings(...) RPC to write them (manager-only)
--   • get_presence_page_by_slug() updated to return them in the safe payload
--
-- Depends on 047/049. IDEMPOTENT.
-- ============================================================================

alter table public.presences add column if not exists offers            text;
alter table public.presences add column if not exists looking_for       text;
alter table public.presences add column if not exists ideal_connections text;

-- ── Write the offerings (separate RPC so existing create/edit RPCs are untouched)
create or replace function public.set_presence_offerings(
  p_presence_id       uuid,
  p_offers            text default null,
  p_looking_for       text default null,
  p_ideal_connections text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.presences where id = p_presence_id) then
    raise exception 'Presence not found';
  end if;
  if not (public.can_manage_presence(p_presence_id) or public.is_admin_user()) then
    raise exception 'Not authorized to edit this presence';
  end if;

  update public.presences set
    offers             = nullif(btrim(p_offers), ''),
    looking_for        = nullif(btrim(p_looking_for), ''),
    ideal_connections  = nullif(btrim(p_ideal_connections), ''),
    updated_by_user_id = v_me
  where id = p_presence_id;
end;
$$;

grant execute on function public.set_presence_offerings(uuid,text,text,text) to authenticated;

-- ── Re-create get_presence_page_by_slug to include the new safe fields ────────
-- (Same signature as 049 → clean replace, no overload. Logic unchanged except
-- the three added keys in the safe payload.)
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
begin
  if p_slug is null or btrim(p_slug) = '' then
    return null;
  end if;

  select * into r from public.presences where slug = p_slug limit 1;
  if not found then
    return null;
  end if;

  if v_me is not null then
    v_admin := public.is_admin_user();
    select role, can_publish_as into v_role, v_can_publish
    from public.presence_members
    where presence_id = r.id and user_id = v_me
    limit 1;
    v_member     := v_role is not null;
    v_can_manage := (v_role in ('owner','admin','editor')) or v_admin;
  end if;

  v_safe := jsonb_build_object(
    'id',                r.id,
    'presence_type',     r.presence_type,
    'name',              r.name,
    'slug',              r.slug,
    'tagline',           r.tagline,
    'short_description', r.short_description,
    'category',          r.category,
    'industry',          r.industry,
    'location',          r.location,
    'market',            r.market,
    'website_url',       r.website_url,
    'public_cta_label',  r.public_cta_label,
    'public_cta_url',    r.public_cta_url,
    'offers',            r.offers,
    'looking_for',       r.looking_for,
    'ideal_connections', r.ideal_connections,
    'visibility',        r.visibility,
    'status',            r.status
  );

  if v_can_manage or v_member then
    return jsonb_build_object(
      'access', 'full', 'presence', v_safe,
      'role', v_role, 'can_publish_as', coalesce(v_can_publish, false),
      'can_manage', v_can_manage);
  end if;

  if r.status <> 'active' then
    return jsonb_build_object('access', 'unavailable');
  end if;

  if r.visibility = 'public_preview' then
    if v_me is null and not coalesce(r.public_preview_enabled, true) then
      return jsonb_build_object('access', 'locked');
    end if;
    return jsonb_build_object(
      'access', 'full', 'presence', v_safe,
      'role', null, 'can_publish_as', false, 'can_manage', false);
  elsif r.visibility = 'member_only' then
    if v_me is null then
      return jsonb_build_object('access', 'locked');
    end if;
    return jsonb_build_object(
      'access', 'full', 'presence', v_safe,
      'role', null, 'can_publish_as', false, 'can_manage', false);
  else
    return jsonb_build_object('access', 'unavailable');
  end if;
end;
$$;

grant execute on function public.get_presence_page_by_slug(text) to anon, authenticated;

notify pgrst, 'reload schema';

select 'business-value fields ready' as status;
