-- ============================================================================
-- PEGASUS Migration 081 — Duplicate protection
--
-- Quality guardrail before scaling the network: detect duplicate business pages
-- and profiles.
--   • peg_normalize_name(text)                 — canonical form for matching
--   • check_duplicate_presence(name, exclude?)  — advisory pre-check at creation
--       (authenticated; returns only ACTIVE PUBLIC matches so the UI can warn
--        "this already exists — claim it instead", feeding the claim loop)
--   • get_duplicate_presence_clusters()         — admin cleanup report
--   • get_duplicate_profile_clusters()          — admin cleanup report
--
-- Read-only detection (no auto-merge, no destructive action). Depends on 047
-- (presences), 011 (is_admin_user), 002 (profiles). IDEMPOTENT.
-- ============================================================================

-- Canonical name: lowercase, punctuation→space, drop common company suffixes,
-- collapse whitespace. IMMUTABLE so it can be indexed/compared cheaply.
create or replace function public.peg_normalize_name(p text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', ' ', 'g'),
      '\m(inc|llc|corp|corporation|co|company|ltd|limited|group|holdings|the|llp|lp|plc)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

-- Advisory duplicate check used by the business-creation UI. Returns only active,
-- public matches (safe to surface + link for claiming); never exposes
-- member-only/private pages.
create or replace function public.check_duplicate_presence(p_name text, p_exclude uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_norm text := public.peg_normalize_name(p_name); v_result jsonb;
begin
  if v_norm is null or length(v_norm) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'presence_type',presence_type) order by name), '[]'::jsonb)
    into v_result
  from public.presences
  where presence_type <> 'personal' and status='active' and visibility='public_preview'
    and (p_exclude is null or id <> p_exclude)
    and public.peg_normalize_name(name) = v_norm;
  return v_result;
end; $$;
grant execute on function public.check_duplicate_presence(text,uuid) to authenticated;

-- Admin report: clusters of non-personal presences sharing a normalized name.
create or replace function public.get_duplicate_presence_clusters()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(c order by (c->>'count')::int desc, c->>'key'), '[]'::jsonb) into v_result from (
    select jsonb_build_object('key', k, 'count', count(*),
             'items', jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,
                        'presence_type',presence_type,'status',status,'visibility',visibility,'created_at',created_at) order by created_at)) as c
    from (select id,name,slug,presence_type,status,visibility,created_at, public.peg_normalize_name(name) as k
            from public.presences where presence_type<>'personal') p
    where k is not null
    group by k having count(*) > 1
  ) t;
  return v_result;
end; $$;
grant execute on function public.get_duplicate_presence_clusters() to authenticated;

-- Admin report: clusters of profiles sharing a normalized name or an email.
-- (Name collisions can be genuine namesakes; the email + role help the admin
-- judge. Detection only — nothing is merged automatically.)
create or replace function public.get_duplicate_profile_clusters()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(c order by (c->>'count')::int desc, c->>'key'), '[]'::jsonb) into v_result from (
    select jsonb_build_object('key', k, 'reason', reason, 'count', count(*),
             'items', jsonb_agg(jsonb_build_object('id',id,'name',full_name,'slug',profile_slug,
                        'email',email,'role',role,'created_at',created_at) order by created_at)) as c
    from (
      select id, full_name, profile_slug, email, role, created_at,
             lower(btrim(email)) as k, 'same email' as reason
        from public.profiles where coalesce(btrim(email),'')<>''
      union all
      select id, full_name, profile_slug, email, role, created_at,
             public.peg_normalize_name(full_name) as k, 'same name' as reason
        from public.profiles where public.peg_normalize_name(full_name) is not null
    ) p
    where k is not null
    group by k, reason having count(*) > 1
  ) t;
  return v_result;
end; $$;
grant execute on function public.get_duplicate_profile_clusters() to authenticated;

notify pgrst, 'reload schema';
select 'duplicate protection ready' as status;
