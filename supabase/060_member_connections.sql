-- ============================================================================
-- PEGASUS Migration 060 — Member Connections
--
-- Member-to-member connection requests sent from the Members Network connection
-- board. The recipient is notified through the existing bell (create_notification
-- from migration 021) and triages requests inside the Workspace / Network
-- Requests page. Accepted connections appear on each member's personal profile
-- under "My Connections".
--
-- Product law:
--   • Discovery lives in the Members Network. Connections live on each personal
--     profile. Private follow-up lives in the Workspace.
--   • Only logged-in members may send a request.
--   • Self-connection is rejected.
--   • One pending request per (requester, recipient) at a time (no spam).
--   • Recipient decides: accept / decline / dismiss. Sender cannot self-accept.
--   • Accepted = symmetric. The pair is "connected" regardless of direction.
--   • Pegasus never exposes email, phone, or any private metadata through these
--     RPCs — only safe public profile fields (full_name, role, headline,
--     company_name, markets, avatar_url, profile_slug, updated_at).
--   • Existing engagement_requests (business / opportunity engagement) is
--     untouched. This is the parallel "member ↔ member" channel.
--
-- Adds:
--   • public.member_connections (+ RLS + indexes + touch trigger)
--   • send_member_connection(p_recipient_user_id, p_intent, p_message)
--   • respond_member_connection(p_id, p_status)        — accept / decline / dismiss
--   • get_my_connection_requests(p_box)                — 'inbox' | 'sent'
--   • get_my_connections()                             — accepted, both directions
--   • get_member_connections_for_profile(p_profile_slug, p_limit)
--                                                       — public, accepted-only
--   • get_connection_state_with(p_other_user_id)       — for left-list buttons
--   • count_connection_requests_new()                  — bell badge
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists public.member_connections (
  id                  uuid primary key default gen_random_uuid(),
  requester_user_id   uuid not null references auth.users(id) on delete cascade,
  recipient_user_id   uuid not null references auth.users(id) on delete cascade,
  intent              text not null default 'general_networking',
  message             text,
  status              text not null default 'pending',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  responded_at        timestamptz,
  constraint mc_no_self check (requester_user_id <> recipient_user_id),
  constraint mc_intent_check check (intent in (
    'business_connection','capital_financing','real_estate_opportunity',
    'professional_introduction','partnership','general_networking','other'
  )),
  constraint mc_status_check check (status in ('pending','accepted','declined','dismissed'))
);

create index if not exists idx_mc_recipient
  on public.member_connections(recipient_user_id, status, created_at desc);
create index if not exists idx_mc_requester
  on public.member_connections(requester_user_id, status, created_at desc);

-- Block duplicate PENDING requests in either direction (partial unique index).
-- A pair of users can still have multiple historical declined/dismissed rows.
create unique index if not exists ux_mc_pending_pair
  on public.member_connections(
       least(requester_user_id, recipient_user_id),
       greatest(requester_user_id, recipient_user_id)
     )
  where status = 'pending';

create or replace function public.member_connections_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_mc_touch on public.member_connections;
create trigger trg_mc_touch before update on public.member_connections
  for each row execute function public.member_connections_touch_updated_at();

-- ── RLS — requester sees own sent; recipient sees own received; admin sees all
alter table public.member_connections enable row level security;

drop policy if exists mc_select on public.member_connections;
create policy mc_select on public.member_connections for select to authenticated
  using (
    requester_user_id = auth.uid()
    or recipient_user_id = auth.uid()
    or public.is_admin_user()
  );

drop policy if exists mc_update on public.member_connections;
create policy mc_update on public.member_connections for update to authenticated
  using (
    recipient_user_id = auth.uid()
    or public.is_admin_user()
  )
  with check (
    recipient_user_id = auth.uid()
    or public.is_admin_user()
  );

-- Inserts only via SECURITY DEFINER RPC below (no insert policy).

-- ── Intent label helper (used in notifications) ─────────────────────────────
create or replace function public.member_connection_intent_label(p_intent text)
returns text language sql immutable as $$
  select case p_intent
    when 'business_connection'        then 'a business connection'
    when 'capital_financing'          then 'a capital / financing conversation'
    when 'real_estate_opportunity'    then 'a real estate opportunity'
    when 'professional_introduction'  then 'a professional introduction'
    when 'partnership'                then 'a partnership conversation'
    when 'general_networking'         then 'general networking'
    else 'a connection'
  end;
$$;

-- ── send_member_connection — create a pending request + bell notification ───
create or replace function public.send_member_connection(
  p_recipient_user_id uuid,
  p_intent            text,
  p_message           text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_intent    text := coalesce(nullif(btrim(p_intent), ''), 'general_networking');
  v_msg       text := nullif(btrim(coalesce(p_message,'')), '');
  v_existing  public.member_connections;
  v_new_id    uuid;
  v_my_name   text;
  v_my_slug   text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated',
      'message', 'Sign in to send a connection request.');
  end if;
  if p_recipient_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_recipient',
      'message', 'No recipient specified.');
  end if;
  if p_recipient_user_id = v_me then
    return jsonb_build_object('ok', false, 'code', 'self',
      'message', 'You cannot send a connection request to yourself.');
  end if;
  if v_intent not in ('business_connection','capital_financing',
        'real_estate_opportunity','professional_introduction',
        'partnership','general_networking','other') then
    v_intent := 'general_networking';
  end if;
  if length(coalesce(v_msg,'')) > 600 then
    v_msg := left(v_msg, 600);
  end if;

  -- Block duplicate PENDING in either direction; surface useful state for UI.
  select * into v_existing from public.member_connections
    where status in ('pending','accepted')
      and (
        (requester_user_id = v_me and recipient_user_id = p_recipient_user_id) or
        (requester_user_id = p_recipient_user_id and recipient_user_id = v_me)
      )
    order by created_at desc
    limit 1;

  if v_existing.id is not null then
    if v_existing.status = 'accepted' then
      return jsonb_build_object('ok', false, 'code', 'connected',
        'message', 'You are already connected with this member.');
    else
      if v_existing.requester_user_id = v_me then
        return jsonb_build_object('ok', false, 'code', 'already_sent',
          'message', 'You already sent a connection request to this member.');
      else
        return jsonb_build_object('ok', false, 'code', 'incoming_pending',
          'message', 'This member already sent you a connection request. Respond to it from your Workspace.');
      end if;
    end if;
  end if;

  insert into public.member_connections(requester_user_id, recipient_user_id, intent, message, status)
       values (v_me, p_recipient_user_id, v_intent, v_msg, 'pending')
    returning id into v_new_id;

  -- Bell notification — show who, why, and link to the Requests area.
  select full_name, profile_slug into v_my_name, v_my_slug
    from public.profiles where id = v_me;

  perform public.create_notification(
    p_recipient_user_id,
    'connection_request',
    coalesce(v_my_name, 'A Pegasus member') || ' wants to connect with you',
    'About ' || public.member_connection_intent_label(v_intent) ||
      case when v_msg is not null then ' — “' || left(v_msg, 140) || case when length(v_msg) > 140 then '…' else '' end || '”' else '' end,
    '/network-requests.html#connection-' || v_new_id::text
  );

  return jsonb_build_object('ok', true, 'id', v_new_id, 'status', 'pending');
end; $$;

grant execute on function public.send_member_connection(uuid, text, text) to authenticated;

-- ── respond_member_connection — accept / decline / dismiss ──────────────────
create or replace function public.respond_member_connection(
  p_id     uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_row  public.member_connections;
  v_them text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_status not in ('accepted','declined','dismissed') then
    return jsonb_build_object('ok', false, 'code', 'bad_status');
  end if;
  select * into v_row from public.member_connections where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.recipient_user_id <> v_me and not public.is_admin_user() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_resolved', 'status', v_row.status);
  end if;

  update public.member_connections
     set status = p_status, responded_at = now()
   where id = p_id;

  -- Notify the requester when their request was accepted. Decline / dismiss
  -- are intentionally silent (we do not surface rejection to the requester).
  if p_status = 'accepted' then
    select full_name into v_them from public.profiles where id = v_me;
    perform public.create_notification(
      v_row.requester_user_id,
      'connection_accepted',
      coalesce(v_them, 'A Pegasus member') || ' accepted your connection',
      'You are now connected on Pegasus.',
      '/network-requests.html#connections'
    );
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end; $$;

grant execute on function public.respond_member_connection(uuid, text) to authenticated;

-- ── get_my_connection_requests — Workspace / Requests panel ─────────────────
--   p_box = 'inbox'  → requests received (recipient = me)
--   p_box = 'sent'   → requests I sent
create or replace function public.get_my_connection_requests(p_box text default 'inbox')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_box   text := lower(coalesce(p_box, 'inbox'));
  v_data  jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;

  if v_box = 'sent' then
    select coalesce(jsonb_agg(obj order by created_at desc), '[]'::jsonb) into v_data from (
      select jsonb_build_object(
               'id', mc.id, 'status', mc.status, 'intent', mc.intent,
               'message', mc.message, 'created_at', mc.created_at,
               'other', jsonb_build_object(
                 'name', pf.full_name, 'role', pf.role,
                 'company_name', pf.company_name,
                 'avatar_url', pf.avatar_url,
                 'headline', pf.headline,
                 'profile_slug', pf.profile_slug
               )
             ) as obj, mc.created_at
      from public.member_connections mc
      left join public.profiles pf on pf.id = mc.recipient_user_id
      where mc.requester_user_id = v_me
      order by mc.created_at desc
      limit 100
    ) s;
  else
    select coalesce(jsonb_agg(obj order by created_at desc), '[]'::jsonb) into v_data from (
      select jsonb_build_object(
               'id', mc.id, 'status', mc.status, 'intent', mc.intent,
               'message', mc.message, 'created_at', mc.created_at,
               'other', jsonb_build_object(
                 'name', pf.full_name, 'role', pf.role,
                 'company_name', pf.company_name,
                 'avatar_url', pf.avatar_url,
                 'headline', pf.headline,
                 'profile_slug', pf.profile_slug
               )
             ) as obj, mc.created_at
      from public.member_connections mc
      left join public.profiles pf on pf.id = mc.requester_user_id
      where mc.recipient_user_id = v_me
      order by mc.created_at desc
      limit 100
    ) s;
  end if;

  return coalesce(v_data, '[]'::jsonb);
end; $$;

grant execute on function public.get_my_connection_requests(text) to authenticated;

-- ── get_my_connections — accepted connections, both directions ──────────────
create or replace function public.get_my_connections()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_data jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(obj order by responded_at desc nulls last, created_at desc), '[]'::jsonb)
    into v_data
  from (
    select jsonb_build_object(
             'connection_id', mc.id,
             'connected_since', coalesce(mc.responded_at, mc.updated_at),
             'recently_active',
               (coalesce(pf.updated_at, pf.created_at)
                  > (now() - interval '14 days')),
             'name', pf.full_name, 'role', pf.role,
             'company_name', pf.company_name,
             'avatar_url', pf.avatar_url,
             'headline', pf.headline,
             'markets', pf.markets,
             'location', pf.location,
             'profile_slug', pf.profile_slug
           ) as obj,
           coalesce(mc.responded_at, mc.updated_at) as responded_at,
           mc.created_at
    from public.member_connections mc
    join public.profiles pf
      on pf.id = case when mc.requester_user_id = v_me
                       then mc.recipient_user_id
                       else mc.requester_user_id end
    where mc.status = 'accepted'
      and (mc.requester_user_id = v_me or mc.recipient_user_id = v_me)
    order by coalesce(mc.responded_at, mc.updated_at) desc nulls last
    limit 200
  ) s;

  return coalesce(v_data, '[]'::jsonb);
end; $$;

grant execute on function public.get_my_connections() to authenticated;

-- ── get_member_connections_for_profile — PUBLIC, accepted-only display ──────
--   Used by personal-profile pages to render "My Connections" / "Connected
--   Network". Returns ONLY safe public fields. Limit defaults to 12.
create or replace function public.get_member_connections_for_profile(
  p_profile_slug text,
  p_limit        int default 12
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_lim    int := least(greatest(coalesce(p_limit, 12), 1), 48);
  v_data   jsonb;
begin
  if p_profile_slug is null or btrim(p_profile_slug) = '' then
    return '[]'::jsonb;
  end if;
  select id into v_target from public.profiles
    where profile_slug = p_profile_slug limit 1;
  if v_target is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(obj order by since desc nulls last), '[]'::jsonb)
    into v_data
  from (
    select jsonb_build_object(
             'name', pf.full_name, 'role', pf.role,
             'company_name', pf.company_name,
             'avatar_url', pf.avatar_url,
             'headline', pf.headline,
             'location', pf.location,
             'profile_slug', pf.profile_slug,
             'connected_since', coalesce(mc.responded_at, mc.updated_at),
             'recently_active',
               (coalesce(pf.updated_at, pf.created_at)
                  > (now() - interval '14 days'))
           ) as obj,
           coalesce(mc.responded_at, mc.updated_at) as since
    from public.member_connections mc
    join public.profiles pf
      on pf.id = case when mc.requester_user_id = v_target
                       then mc.recipient_user_id
                       else mc.requester_user_id end
    where mc.status = 'accepted'
      and (mc.requester_user_id = v_target or mc.recipient_user_id = v_target)
      and pf.full_name is not null and btrim(pf.full_name) <> ''
    order by coalesce(mc.responded_at, mc.updated_at) desc nulls last
    limit v_lim
  ) s;

  return coalesce(v_data, '[]'::jsonb);
end; $$;

grant execute on function public.get_member_connections_for_profile(text, int)
  to anon, authenticated;

-- ── get_connection_state_with — what button to show in the left list ────────
--   Returns { state: 'none'|'request_sent'|'request_received'|'connected'|'declined', id? }
create or replace function public.get_connection_state_with(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.member_connections;
begin
  if v_me is null then return jsonb_build_object('state','none'); end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    return jsonb_build_object('state','self');
  end if;

  select * into v_row from public.member_connections
    where (
      (requester_user_id = v_me and recipient_user_id = p_other_user_id) or
      (requester_user_id = p_other_user_id and recipient_user_id = v_me)
    )
    order by created_at desc
    limit 1;

  if v_row.id is null then
    return jsonb_build_object('state','none');
  end if;
  if v_row.status = 'accepted' then
    return jsonb_build_object('state','connected','id',v_row.id);
  end if;
  if v_row.status = 'pending' then
    if v_row.requester_user_id = v_me then
      return jsonb_build_object('state','request_sent','id',v_row.id);
    else
      return jsonb_build_object('state','request_received','id',v_row.id);
    end if;
  end if;
  -- declined / dismissed
  return jsonb_build_object('state', v_row.status, 'id', v_row.id);
end; $$;

grant execute on function public.get_connection_state_with(uuid) to authenticated;

-- ── count_connection_requests_new — bell badge / Requests tab badge ─────────
create or replace function public.count_connection_requests_new()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_n int;
begin
  if v_me is null then return 0; end if;
  select count(*) into v_n from public.member_connections
    where recipient_user_id = v_me and status = 'pending';
  return coalesce(v_n, 0);
end; $$;

grant execute on function public.count_connection_requests_new() to authenticated;
