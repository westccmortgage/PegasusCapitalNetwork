-- ============================================================================
-- PEGASUS Migration 049 — Presence Page access (Phase 3)
--
-- One SECURITY DEFINER RPC that powers the public/member/owner presence page at
-- presence.html?slug=…. It resolves a presence by slug and returns ONLY safe
-- fields, applying visibility rules server-side so the frontend never has to
-- (and so private columns are never shipped to the client).
--
-- NEVER returned by this function: owner_user_id, created_by_user_id,
-- updated_by_user_id, metadata, or any presence_members row data other than the
-- *caller's own* role / can_publish_as.
--
-- Return shape (jsonb), discriminated by "access":
--   { access:'full',        presence:{…safe…}, role, can_publish_as, can_manage }
--   { access:'locked' }        -- member_only viewed anonymously
--   { access:'unavailable' }   -- private/archived and caller not associated
--   null                       -- slug missing or not found
--
-- Visibility matrix (caller NOT associated with the presence):
--   public_preview + enabled : everyone → full
--   public_preview + disabled: anon → locked, member → full
--   member_only              : anon → locked, member → full
--   private                  : → unavailable
--   non-active (archived…)   : → unavailable
-- Associated callers (owner/admin/editor/representative/viewer) and platform
-- admins always get full (any visibility/status), with can_manage set for
-- owner/admin/editor (+ platform admin).
--
-- Depends on 047 (presences, presence_members, is_admin_user). IDEMPOTENT.
-- Does NOT alter RLS or any existing object.
-- ============================================================================

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

  -- Safe payload — explicitly whitelisted columns only.
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
    'visibility',        r.visibility,
    'status',            r.status
  );

  -- Associated callers (or platform admin) always get the full view.
  if v_can_manage or v_member then
    return jsonb_build_object(
      'access', 'full', 'presence', v_safe,
      'role', v_role, 'can_publish_as', coalesce(v_can_publish, false),
      'can_manage', v_can_manage);
  end if;

  -- Caller is NOT associated from here on.
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

  else  -- private
    return jsonb_build_object('access', 'unavailable');
  end if;
end;
$$;

grant execute on function public.get_presence_page_by_slug(text) to anon, authenticated;

-- Reload PostgREST schema cache (restart the project if the RPC 404s afterward).
notify pgrst, 'reload schema';

select 'get_presence_page_by_slug ready' as status;
