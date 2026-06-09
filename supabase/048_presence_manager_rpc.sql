-- ============================================================================
-- PEGASUS Migration 048 — Presence Manager RPCs (Phase 2)
--
-- Secure, SECURITY DEFINER RPCs so the authenticated frontend can create, edit,
-- and archive presences WITHOUT weakening RLS and WITHOUT a service_role key on
-- the client. Each function re-derives the caller from auth.uid() and enforces
-- the Phase 1 permission helpers internally.
--
-- Guarantees:
--   • create_presence: never creates a 'personal' presence from the UI, validates
--     the type + visibility, generates a unique slug, and atomically inserts the
--     owner membership row.
--   • update_presence_basic: only callers who can_manage_presence() may edit; it
--     never touches id / owner_user_id / created_by / presence_type; it refuses
--     to archive a personal presence.
--   • archive_presence: only managers may archive; personal presences can't be
--     archived (they are managed through the main profile).
--
-- Depends on migration 047 (presences, presence_members, can_manage_presence,
-- presence_generate_slug). IDEMPOTENT — safe to run multiple times.
-- ============================================================================

-- ── create_presence ──────────────────────────────────────────────────────────
create or replace function public.create_presence(
  p_presence_type     text,
  p_name              text,
  p_tagline           text default null,
  p_short_description text default null,
  p_category          text default null,
  p_industry          text default null,
  p_location          text default null,
  p_market            text default null,
  p_website_url       text default null,
  p_public_cta_label  text default null,
  p_public_cta_url    text default null,
  p_visibility        text default 'member_only'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_vis  text := coalesce(nullif(btrim(p_visibility), ''), 'member_only');
  v_slug text;
  v_id   uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  -- Personal presences are created by the system/backfill only — never from UI.
  if p_presence_type = 'personal' then
    raise exception 'Personal presences cannot be created here — they are managed through your profile.';
  end if;
  if p_presence_type not in
     ('company','project','showcase','event','capital_program','property','fund') then
    raise exception 'Invalid presence_type: %', p_presence_type;
  end if;

  if v_name = '' then raise exception 'A name is required.'; end if;

  if v_vis not in ('public_preview','member_only','private') then
    raise exception 'Invalid visibility: %', v_vis;
  end if;

  v_slug := public.presence_generate_slug(v_name, null);

  insert into public.presences
    (presence_type, owner_user_id, created_by_user_id, updated_by_user_id,
     name, slug, tagline, short_description, category, industry, location,
     market, website_url, public_cta_label, public_cta_url, visibility, status)
  values
    (p_presence_type, v_me, v_me, v_me,
     v_name, v_slug,
     nullif(btrim(p_tagline), ''), nullif(btrim(p_short_description), ''),
     nullif(btrim(p_category), ''), nullif(btrim(p_industry), ''),
     nullif(btrim(p_location), ''), nullif(btrim(p_market), ''),
     nullif(btrim(p_website_url), ''), nullif(btrim(p_public_cta_label), ''),
     nullif(btrim(p_public_cta_url), ''), v_vis, 'active')
  returning id into v_id;

  insert into public.presence_members (presence_id, user_id, role, can_publish_as)
  values (v_id, v_me, 'owner', true)
  on conflict (presence_id, user_id) do nothing;

  return v_id;
end;
$$;

-- ── update_presence_basic ────────────────────────────────────────────────────
create or replace function public.update_presence_basic(
  p_presence_id       uuid,
  p_name              text default null,
  p_tagline           text default null,
  p_short_description text default null,
  p_category          text default null,
  p_industry          text default null,
  p_location          text default null,
  p_market            text default null,
  p_website_url       text default null,
  p_public_cta_label  text default null,
  p_public_cta_url    text default null,
  p_visibility        text default null,
  p_status            text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_type text;
  v_vis  text;
  v_stat text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select presence_type into v_type from public.presences where id = p_presence_id;
  if v_type is null then raise exception 'Presence not found'; end if;

  -- Only owner/admin/editor (or platform admin) may edit.
  if not (public.can_manage_presence(p_presence_id) or public.is_admin_user()) then
    raise exception 'Not authorized to edit this presence';
  end if;

  -- Resolve visibility/status, keeping the current value when not supplied.
  v_vis  := coalesce(nullif(btrim(p_visibility), ''),
                     (select visibility from public.presences where id = p_presence_id));
  v_stat := coalesce(nullif(btrim(p_status), ''),
                     (select status from public.presences where id = p_presence_id));

  if v_vis not in ('public_preview','member_only','private') then
    raise exception 'Invalid visibility: %', v_vis;
  end if;
  if v_stat not in ('draft','active','archived') then
    raise exception 'Invalid status: %', v_stat;
  end if;

  -- A personal presence may never be archived through this RPC.
  if v_type = 'personal' and v_stat = 'archived' then
    raise exception 'The personal presence cannot be archived.';
  end if;

  update public.presences set
    name              = coalesce(nullif(btrim(p_name), ''), name),
    tagline           = nullif(btrim(p_tagline), ''),
    short_description = nullif(btrim(p_short_description), ''),
    category          = nullif(btrim(p_category), ''),
    industry          = nullif(btrim(p_industry), ''),
    location          = nullif(btrim(p_location), ''),
    market            = nullif(btrim(p_market), ''),
    website_url       = nullif(btrim(p_website_url), ''),
    public_cta_label  = nullif(btrim(p_public_cta_label), ''),
    public_cta_url    = nullif(btrim(p_public_cta_url), ''),
    visibility        = v_vis,
    status            = v_stat,
    updated_by_user_id = v_me
  where id = p_presence_id;
end;
$$;

-- ── archive_presence ─────────────────────────────────────────────────────────
create or replace function public.archive_presence(p_presence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_type text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select presence_type into v_type from public.presences where id = p_presence_id;
  if v_type is null then raise exception 'Presence not found'; end if;

  if v_type = 'personal' then
    raise exception 'The personal presence cannot be archived.';
  end if;

  if not (public.can_manage_presence(p_presence_id) or public.is_admin_user()) then
    raise exception 'Not authorized to archive this presence';
  end if;

  update public.presences
     set status = 'archived', updated_by_user_id = v_me
   where id = p_presence_id;
end;
$$;

grant execute on function public.create_presence(text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_presence_basic(uuid,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.archive_presence(uuid) to authenticated;

-- Reload PostgREST schema cache (restart the project if RPCs 404 afterward).
notify pgrst, 'reload schema';

select 'presence manager RPCs ready' as status;
