-- ============================================================================
-- PEGASUS Migration 047 — PRESENCE GRAPH, Phase 1 (foundation only)
--
-- Adds the database foundation for multiple professional "presences" per login:
--   one trusted user identity → many separate presences (personal, company,
--   project, showcase, event, capital_program, property, fund) with controlled
--   visibility and a future "Publish As" capability.
--
-- PHASE 1 SCOPE — DB + architecture ONLY. No frontend changes. Nothing here
-- alters, drops, or repoints any EXISTING table, policy, view, or function:
--   • Only NEW objects are created (presences, presence_members, helper fns,
--     a safe public view, RLS on the two new tables, and a data backfill).
--   • Existing profiles, slugs, login, directory, deal rooms, etc. are untouched.
--
-- IDEMPOTENT — safe to run multiple times.
--
-- NOTE on filename: the brief suggested supabase/migrations/040_..., but this
-- repo keeps migrations flat in supabase/ and 040 is already taken, so this is
-- 047 to follow the existing convention.
--
-- NOTE on FK delete rules: every reference to auth.users carries an explicit
-- ON DELETE rule so this table does NOT reintroduce the "Database error
-- deleting user" problem fixed in migration 046.
-- ============================================================================

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.presences (
  id                            uuid primary key default gen_random_uuid(),
  presence_type                 text not null,
  owner_user_id                 uuid not null references auth.users(id) on delete cascade,
  created_by_user_id            uuid references auth.users(id) on delete set null,
  updated_by_user_id            uuid references auth.users(id) on delete set null,
  parent_presence_id            uuid references public.presences(id) on delete set null,
  name                          text not null,
  slug                          text unique not null,
  tagline                       text,
  short_description             text,
  category                      text,
  industry                      text,
  location                      text,
  market                        text,
  website_url                   text,
  public_cta_label              text,
  public_cta_url                text,
  visibility                    text not null default 'public_preview',
  status                        text not null default 'active',
  public_preview_enabled        boolean default true,
  member_details_enabled        boolean default true,
  show_owner_publicly           boolean default false,
  show_representatives_publicly boolean default false,
  metadata                      jsonb default '{}'::jsonb,
  created_at                    timestamptz default now(),
  updated_at                    timestamptz default now(),
  constraint presences_type_check check (presence_type in
    ('personal','company','project','showcase','event','capital_program','property','fund')),
  constraint presences_visibility_check check (visibility in
    ('public_preview','member_only','private')),
  constraint presences_status_check check (status in
    ('draft','active','archived'))
);

create table if not exists public.presence_members (
  id                       uuid primary key default gen_random_uuid(),
  presence_id              uuid not null references public.presences(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  role                     text not null,
  is_public_representative boolean default false,
  show_on_personal_profile boolean default false,
  can_publish_as           boolean default false,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  constraint presence_members_role_check check (role in
    ('owner','admin','editor','representative','viewer')),
  constraint presence_members_unique unique (presence_id, user_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_presences_owner   on public.presences(owner_user_id);
create index if not exists idx_presences_type     on public.presences(presence_type);
create index if not exists idx_presences_parent   on public.presences(parent_presence_id);
create index if not exists idx_presences_public   on public.presences(status, visibility, public_preview_enabled);
create index if not exists idx_pmembers_presence  on public.presence_members(presence_id);
create index if not exists idx_pmembers_user      on public.presence_members(user_id);

-- ── updated_at trigger ───────────────────────────────────────────────────────
create or replace function public.presence_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_presences_touch on public.presences;
create trigger trg_presences_touch before update on public.presences
  for each row execute function public.presence_touch_updated_at();

drop trigger if exists trg_pmembers_touch on public.presence_members;
create trigger trg_pmembers_touch before update on public.presence_members
  for each row execute function public.presence_touch_updated_at();

-- ── Safe slug generation ─────────────────────────────────────────────────────
-- Reuses the rules from migration 037 (lowercase, Cyrillic→Latin, strip,
-- collapse hyphens) and guarantees uniqueness WITHIN the presences namespace.
-- Presence slugs are a SEPARATE namespace from profiles.profile_slug, so this
-- never touches or collides with existing user slugs.
create or replace function public.presence_generate_slug(p_name text, p_fallback text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug  text;
  final_slug text;
begin
  base_slug := lower(coalesce(p_name, ''));
  -- Cyrillic → Latin transliteration (same map as 037)
  base_slug := translate(base_slug,
    'абвгдежзийклмнопрстуфхцчшщыьэюяё',
    'abvgdezhziklmnoprstufhtschschyeyuyae');
  base_slug := regexp_replace(base_slug, '[^a-z0-9\s\-]', '', 'g');
  base_slug := trim(regexp_replace(base_slug, '\s+', '-', 'g'));
  base_slug := regexp_replace(base_slug, '\-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  -- Fallback to the local-part of an email if the name produced nothing
  if base_slug = '' and p_fallback is not null then
    base_slug := lower(regexp_replace(split_part(p_fallback, '@', 1), '[^a-z0-9]+', '-', 'g'));
    base_slug := trim(both '-' from base_slug);
  end if;
  if base_slug = '' then
    base_slug := 'presence';
  end if;

  -- Ensure uniqueness by appending a short random suffix on collision
  final_slug := base_slug;
  while exists (select 1 from public.presences where slug = final_slug) loop
    final_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  return final_slug;
end;
$$;

-- ── Permission helpers ───────────────────────────────────────────────────────
-- All SECURITY DEFINER so they can be called safely from RLS without recursing
-- into presence_members' own policies.

-- owner / admin / editor → may manage (edit) the presence
create or replace function public.can_manage_presence(p_presence_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.presence_members m
    where m.presence_id = p_presence_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','editor')
  );
$$;

-- owner / admin → may manage the member roster
create or replace function public.can_admin_presence(p_presence_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.presence_members m
    where m.presence_id = p_presence_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;

-- owner / admin / editor always; representative only if can_publish_as = true
create or replace function public.can_publish_as_presence(p_presence_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.presence_members m
    where m.presence_id = p_presence_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner','admin','editor')
        or (m.role = 'representative' and m.can_publish_as = true)
      )
  );
$$;

-- every presence the current user belongs to
create or replace function public.get_my_presences()
returns setof public.presences
language sql stable security definer set search_path = public
as $$
  select p.*
  from public.presences p
  join public.presence_members m on m.presence_id = p.id
  where m.user_id = auth.uid()
  order by p.created_at;
$$;

-- create (idempotently) the personal presence for a user
create or replace function public.create_personal_presence_for_user(p_user_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_existing uuid;
  v_name     text;
  v_email    text;
  v_slug     text;
  v_pid      uuid;
begin
  if p_user_id is null then raise exception 'p_user_id is required'; end if;

  -- A signed-in caller may only create their OWN personal presence; service-side
  -- callers (auth.uid() is null, e.g. the backfill below) and admins may create
  -- for anyone.
  if auth.uid() is not null and auth.uid() <> p_user_id and not public.is_admin_user() then
    raise exception 'Not authorized';
  end if;

  -- Already has one? return it (idempotent).
  select id into v_existing
  from public.presences
  where owner_user_id = p_user_id and presence_type = 'personal'
  limit 1;
  if v_existing is not null then return v_existing; end if;

  select full_name, email into v_name, v_email from public.profiles where id = p_user_id;
  if coalesce(btrim(v_name), '') = '' then v_name := 'Member'; end if;

  v_slug := public.presence_generate_slug(v_name, v_email);

  -- Personal presences default to member_only: today profiles are visible to
  -- signed-in members but NOT to anonymous visitors (privacy gate + the anon
  -- lock-down in migration 045). member_only mirrors that exactly.
  insert into public.presences
    (presence_type, owner_user_id, created_by_user_id, updated_by_user_id,
     name, slug, visibility, status)
  values
    ('personal', p_user_id, p_user_id, p_user_id,
     v_name, v_slug, 'member_only', 'active')
  returning id into v_pid;

  insert into public.presence_members
    (presence_id, user_id, role, can_publish_as, show_on_personal_profile)
  values
    (v_pid, p_user_id, 'owner', true, true)
  on conflict (presence_id, user_id) do nothing;

  return v_pid;
end;
$$;

grant execute on function public.presence_generate_slug(text, text)        to authenticated;
grant execute on function public.can_manage_presence(uuid)                 to authenticated;
grant execute on function public.can_admin_presence(uuid)                  to authenticated;
grant execute on function public.can_publish_as_presence(uuid)             to authenticated;
grant execute on function public.get_my_presences()                        to authenticated;
grant execute on function public.create_personal_presence_for_user(uuid)   to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.presences        enable row level security;
alter table public.presence_members enable row level security;

-- presences: NO anon policy on the base table — anonymous visitors get the
-- safe, column-limited public_presence_previews VIEW instead, never the raw row
-- (so owner_user_id, metadata, etc. are never exposed publicly).
drop policy if exists presences_auth_read on public.presences;
create policy presences_auth_read on public.presences for select to authenticated
  using (
    (status = 'active' and visibility in ('public_preview','member_only'))
    or owner_user_id = auth.uid()
    or exists (select 1 from public.presence_members m
               where m.presence_id = id and m.user_id = auth.uid())
    or public.is_admin_user()
  );

drop policy if exists presences_insert on public.presences;
create policy presences_insert on public.presences for insert to authenticated
  with check (owner_user_id = auth.uid() or public.is_admin_user());

drop policy if exists presences_update on public.presences;
create policy presences_update on public.presences for update to authenticated
  using      (public.can_manage_presence(id) or public.is_admin_user())
  with check (public.can_manage_presence(id) or public.is_admin_user());

drop policy if exists presences_delete on public.presences;
create policy presences_delete on public.presences for delete to authenticated
  using (owner_user_id = auth.uid() or public.is_admin_user());

-- presence_members
drop policy if exists pmembers_read on public.presence_members;
create policy pmembers_read on public.presence_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_presence(presence_id)
    or public.is_admin_user()
  );

-- insert: presence owners/admins, the platform admin, OR the presence's owner
-- adding their own first membership row (bootstrap right after creation).
drop policy if exists pmembers_insert on public.presence_members;
create policy pmembers_insert on public.presence_members for insert to authenticated
  with check (
    public.can_admin_presence(presence_id)
    or public.is_admin_user()
    or (user_id = auth.uid()
        and exists (select 1 from public.presences p
                    where p.id = presence_id and p.owner_user_id = auth.uid()))
  );

drop policy if exists pmembers_update on public.presence_members;
create policy pmembers_update on public.presence_members for update to authenticated
  using      (public.can_admin_presence(presence_id) or public.is_admin_user())
  with check (public.can_admin_presence(presence_id) or public.is_admin_user());

drop policy if exists pmembers_delete on public.presence_members;
create policy pmembers_delete on public.presence_members for delete to authenticated
  using (public.can_admin_presence(presence_id) or public.is_admin_user());

-- ── Safe public view ─────────────────────────────────────────────────────────
-- Exposes ONLY non-sensitive columns, and only for active public-preview
-- presences. Intentionally runs with the view owner's rights (it is the public
-- read surface), so the WHERE clause is the access boundary. No owner_user_id,
-- created_by, metadata, or role data here.
create or replace view public.public_presence_previews as
  select
    id, presence_type, name, slug, tagline, short_description,
    category, industry, location, market,
    public_cta_label, public_cta_url, status
  from public.presences
  where status = 'active'
    and public_preview_enabled = true
    and visibility = 'public_preview';

grant select on public.public_presence_previews to anon, authenticated;

-- ── Backfill: one personal presence per existing user ────────────────────────
-- Idempotent (create_personal_presence_for_user returns early if one exists).
-- Each user wrapped so one bad row never aborts the whole backfill. Reads
-- existing profile data; writes ONLY into the new tables — never modifies
-- profiles or any existing object.
do $$
declare r record;
begin
  for r in select id from public.profiles where id is not null loop
    begin
      perform public.create_personal_presence_for_user(r.id);
    exception when others then
      raise notice 'presence backfill skipped for %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- ── Reload PostgREST schema cache ────────────────────────────────────────────
-- If new RPCs 404 afterward, restart the project (Settings → General → Restart).
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
select
  (select count(*) from public.presences)                              as presences_total,
  (select count(*) from public.presences where presence_type='personal') as personal_presences,
  (select count(*) from public.presence_members where role='owner')    as owner_memberships,
  (select count(*) from public.profiles)                               as profiles_total;
