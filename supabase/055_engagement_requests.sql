-- ============================================================================
-- PEGASUS Migration 055 — Engagement Requests (the "How to engage" layer)
--
-- A logged-in member expresses interest in a business page (presence) or a
-- specific opportunity. The request is recorded and the managers of that
-- presence are notified (in-app bell via create_notification). Pegasus mediates
-- the introduction — a member's private contact details are NEVER exposed. The
-- requester consents to share their public identity (name + profile link) only.
--
-- Product law:
--   • Engagement always targets a business/project page (presence), optionally
--     scoped to one of that page's opportunities. Never a personal profile.
--   • You cannot engage a page you manage (that's your own page).
--   • Managers see requests addressed to their presences (private operations →
--     the Workspace). Requesters see what they have sent.
--
-- Adds:
--   • public.engagement_requests (+ RLS)
--   • create_engagement_request(presence_id, opportunity_id, intent, message)
--   • get_engagement_requests_received(presence_id?)  — manager inbox (safe)
--   • get_engagement_requests_sent()                  — requester's outbox
--   • update_engagement_request_status(id, status)    — manager triage
--   • count_engagement_requests_new()                 — badge count
--
-- Depends on 047 (presences, presence_members, can_manage_presence,
-- is_admin_user), 054 (opportunities), 021 (notifications + create_notification),
-- 002/006 (profiles + profile_slug). IDEMPOTENT.
-- ============================================================================

create table if not exists public.engagement_requests (
  id              uuid primary key default gen_random_uuid(),
  presence_id     uuid not null references public.presences(id) on delete cascade,
  opportunity_id  uuid references public.opportunities(id) on delete cascade,
  from_user_id    uuid not null references auth.users(id) on delete cascade,
  intent          text not null default 'interested',
  message         text,
  status          text not null default 'new',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  constraint engagement_intent_check check (intent in
    ('interested','introduction','have_capital','need_financing','have_deal','partner','contact')),
  constraint engagement_status_check check (status in
    ('new','seen','accepted','declined','archived'))
);
create index if not exists idx_engagement_presence on public.engagement_requests(presence_id, status, created_at desc);
create index if not exists idx_engagement_from     on public.engagement_requests(from_user_id, created_at desc);
create index if not exists idx_engagement_opp      on public.engagement_requests(opportunity_id);

create or replace function public.engagement_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_engagement_touch on public.engagement_requests;
create trigger trg_engagement_touch before update on public.engagement_requests
  for each row execute function public.engagement_touch_updated_at();

-- ── RLS — requester sees own; managers of the target presence (or admin) see
--    requests addressed to their presence. Inserts only via the RPC below. ─────
alter table public.engagement_requests enable row level security;
drop policy if exists engagement_select on public.engagement_requests;
create policy engagement_select on public.engagement_requests for select to authenticated
  using (from_user_id = auth.uid() or public.can_manage_presence(presence_id) or public.is_admin_user());
drop policy if exists engagement_update on public.engagement_requests;
create policy engagement_update on public.engagement_requests for update to authenticated
  using (public.can_manage_presence(presence_id) or public.is_admin_user())
  with check (public.can_manage_presence(presence_id) or public.is_admin_user());

-- ── Human-readable intent label (used in notifications) ──────────────────────
create or replace function public.engagement_intent_label(p_intent text)
returns text language sql immutable as $$
  select case p_intent
    when 'interested'    then 'is interested'
    when 'introduction'  then 'requested an introduction'
    when 'have_capital'  then 'has capital'
    when 'need_financing'then 'needs financing'
    when 'have_deal'     then 'has a deal'
    when 'partner'       then 'wants to partner'
    when 'contact'       then 'wants to connect'
    else 'is interested' end;
$$;

-- ── create_engagement_request ────────────────────────────────────────────────
create or replace function public.create_engagement_request(
  p_presence_id uuid, p_opportunity_id uuid default null,
  p_intent text default 'interested', p_message text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_me uuid := auth.uid();
  v_intent text := coalesce(nullif(btrim(p_intent),''),'interested');
  v_msg text := nullif(btrim(p_message),'');
  pr record; o record; v_pid uuid := p_presence_id; v_id uuid; v_name text; v_link text; v_what text; mgr record;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if v_intent not in ('interested','introduction','have_capital','need_financing','have_deal','partner','contact')
    then raise exception 'Invalid intent'; end if;

  -- The opportunity page knows the opportunity but not the parent presence — so
  -- derive the presence from the opportunity when only the opportunity is given.
  if v_pid is null then
    if p_opportunity_id is null then raise exception 'Nothing to engage with.'; end if;
    select presence_id into v_pid from public.opportunities where id = p_opportunity_id limit 1;
    if v_pid is null then raise exception 'Opportunity not found.'; end if;
  end if;

  select id, name, slug, presence_type, visibility, status into pr
    from public.presences where id = v_pid limit 1;
  if pr.id is null then raise exception 'Business page not found'; end if;
  if pr.presence_type = 'personal' then raise exception 'Opportunities and engagement live on business pages, not personal profiles.'; end if;
  if public.can_manage_presence(v_pid) or public.is_admin_user()
    then raise exception 'You manage this page — you cannot send yourself a request.'; end if;
  -- The member must be able to see the page: active + not private (member_only
  -- is fine because the requester is authenticated).
  if pr.status <> 'active' or pr.visibility = 'private' then raise exception 'This page is not available.'; end if;

  v_what := pr.name;
  if p_opportunity_id is not null then
    select id, presence_id, title, slug, status, visibility into o
      from public.opportunities where id = p_opportunity_id limit 1;
    if o.id is null or o.presence_id <> v_pid then raise exception 'Opportunity not found for this page.'; end if;
    if o.status <> 'active' or o.visibility = 'private' then raise exception 'This opportunity is not available.'; end if;
    v_what := coalesce(o.title, pr.name);
  end if;

  -- Collapse duplicates: an identical open request from the same member returns
  -- the existing one instead of stacking up.
  select id into v_id from public.engagement_requests
    where from_user_id = v_me and presence_id = v_pid
      and coalesce(opportunity_id,'00000000-0000-0000-0000-000000000000') = coalesce(p_opportunity_id,'00000000-0000-0000-0000-000000000000')
      and intent = v_intent and status in ('new','seen')
    limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.engagement_requests(presence_id, opportunity_id, from_user_id, intent, message)
  values (v_pid, p_opportunity_id, v_me, v_intent, v_msg)
  returning id into v_id;

  -- Notify every manager of the presence (owner/admin/editor) via the in-app bell.
  select coalesce(nullif(btrim(full_name),''),'A Pegasus member') into v_name from public.profiles where id = v_me;
  v_link := '/dashboard.html#requests';
  for mgr in
    select user_id from public.presence_members
    where presence_id = v_pid and role in ('owner','admin','editor')
  loop
    perform public.create_notification(
      mgr.user_id, 'engagement',
      v_name || ' ' || public.engagement_intent_label(v_intent),
      'On ' || coalesce(v_what,'your page') ||
        case when v_msg is not null then ' — “' || left(v_msg, 140) || '”' else '' end,
      v_link);
  end loop;

  return v_id;
end; $$;
grant execute on function public.create_engagement_request(uuid,uuid,text,text) to authenticated;

-- ── get_engagement_requests_received(presence_id?) — manager inbox (safe) ─────
-- Returns requests addressed to presences the current user manages. Includes a
-- safe public identity of the requester (name + profile link), never private
-- contact (email/phone are never selected).
create or replace function public.get_engagement_requests_received(p_presence_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_me uuid := auth.uid(); v_admin boolean := false; v_result jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;
  v_admin := public.is_admin_user();
  select coalesce(jsonb_agg(obj order by ord desc), '[]'::jsonb) into v_result from (
    select jsonb_build_object(
             'id', e.id, 'intent', e.intent, 'message', e.message, 'status', e.status,
             'created_at', e.created_at,
             'presence', jsonb_build_object('name', pr.name, 'slug', pr.slug, 'presence_type', pr.presence_type),
             'opportunity', case when o.id is not null
                then jsonb_build_object('title', o.title, 'slug', o.slug) else null end,
             'from_member', jsonb_build_object(
                'name', coalesce(nullif(btrim(fp.full_name),''),'Pegasus member'),
                'slug', fp.profile_slug, 'headline', fp.headline, 'role', fp.role, 'location', fp.location)
           ) as obj,
           e.created_at as ord
    from public.engagement_requests e
    join public.presences pr on pr.id = e.presence_id
    left join public.opportunities o on o.id = e.opportunity_id
    left join public.profiles fp on fp.id = e.from_user_id
    where e.status <> 'archived'
      and (v_admin or public.can_manage_presence(e.presence_id))
      and (p_presence_id is null or e.presence_id = p_presence_id)
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_engagement_requests_received(uuid) to authenticated;

-- ── get_engagement_requests_sent() — the requester's outbox ──────────────────
create or replace function public.get_engagement_requests_sent()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_me uuid := auth.uid(); v_result jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(obj order by ord desc), '[]'::jsonb) into v_result from (
    select jsonb_build_object(
             'id', e.id, 'intent', e.intent, 'message', e.message, 'status', e.status,
             'created_at', e.created_at,
             'presence', jsonb_build_object('name', pr.name, 'slug', pr.slug, 'presence_type', pr.presence_type),
             'opportunity', case when o.id is not null
                then jsonb_build_object('title', o.title, 'slug', o.slug) else null end
           ) as obj,
           e.created_at as ord
    from public.engagement_requests e
    join public.presences pr on pr.id = e.presence_id
    left join public.opportunities o on o.id = e.opportunity_id
    where e.from_user_id = v_me
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_engagement_requests_sent() to authenticated;

-- ── update_engagement_request_status(id, status) — manager triage ────────────
create or replace function public.update_engagement_request_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_me uuid := auth.uid(); v_pid uuid; v_stat text := nullif(btrim(p_status),'');
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if v_stat not in ('new','seen','accepted','declined','archived') then raise exception 'Invalid status'; end if;
  select presence_id into v_pid from public.engagement_requests where id = p_id;
  if v_pid is null then raise exception 'Request not found'; end if;
  if not (public.can_manage_presence(v_pid) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  update public.engagement_requests set status = v_stat where id = p_id;
end; $$;
grant execute on function public.update_engagement_request_status(uuid,text) to authenticated;

-- ── count_engagement_requests_new() — badge count for the Workspace ──────────
create or replace function public.count_engagement_requests_new()
returns integer language plpgsql security definer set search_path=public as $$
declare v_me uuid := auth.uid(); v_admin boolean := false; v_n integer := 0;
begin
  if v_me is null then return 0; end if;
  v_admin := public.is_admin_user();
  select count(*) into v_n from public.engagement_requests e
    where e.status = 'new' and (v_admin or public.can_manage_presence(e.presence_id));
  return coalesce(v_n,0);
end; $$;
grant execute on function public.count_engagement_requests_new() to authenticated;

notify pgrst, 'reload schema';
select 'engagement_requests ready' as status;
