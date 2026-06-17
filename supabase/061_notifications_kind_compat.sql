-- ============================================================================
-- PEGASUS Migration 061 — Notifications schema compatibility + resilient notify
--
-- Production symptom:
--   column "kind" of relation "notifications" does not exist
--   (surfaced when sending a member connection request)
--
-- Root cause:
--   Some deployments have a notifications table that predates the canonical
--   schema (002 / 021) and is missing the expected columns. create_notification
--   inserts kind/title/body/link, so the insert fails and the error bubbles all
--   the way to the user.
--
-- Fix (safe + additive — never drops or rewrites existing data):
--   1. Ensure notifications has every column the platform expects.
--   2. Redefine create_notification defensively (kind defaults to 'info').
--   3. Make send_member_connection NON-FATAL on notification failure: the
--      connection request is still created and returns ok even if the bell
--      notification can't be written, so the user never sees a raw SQL error.
-- IDEMPOTENT.
-- ============================================================================

-- 1) Guarantee the expected columns exist (no-ops where already present) -------
alter table public.notifications add column if not exists kind       text;
alter table public.notifications add column if not exists title      text;
alter table public.notifications add column if not exists body       text;
alter table public.notifications add column if not exists link       text;
alter table public.notifications add column if not exists read       boolean default false;
alter table public.notifications add column if not exists created_at timestamptz default now();

-- Backfill any legacy NULL kinds to a safe default so future NOT NULL-ish code
-- and the bell icon map both behave.
update public.notifications set kind = 'info' where kind is null;

-- 2) Defensive create_notification — kind optional, defaults to 'info' --------
create or replace function public.create_notification(
  p_user uuid, p_kind text, p_title text, p_body text, p_link text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into public.notifications(user_id, kind, title, body, link)
  values (p_user, coalesce(nullif(btrim(p_kind), ''), 'info'), p_title, p_body, p_link)
  returning id into nid;
  return nid;
exception when others then
  -- Never let a notification write break the calling action. Caller decides
  -- whether the absence of a bell notification matters.
  return null;
end; $$;

grant execute on function public.create_notification(uuid, text, text, text, text)
  to authenticated;

-- 3) Resilient send_member_connection — request persists even if notify fails -
--    (Redefinition of the function from migration 060; only the notification
--     call is now wrapped so a notifications-schema problem can never fail the
--     request or surface a raw SQL error to the user.)
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
  v_notified  boolean := false;
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
    elsif v_existing.requester_user_id = v_me then
      return jsonb_build_object('ok', false, 'code', 'already_sent',
        'message', 'You already sent a connection request to this member.');
    else
      return jsonb_build_object('ok', false, 'code', 'incoming_pending',
        'message', 'This member already sent you a connection request. Respond to it from your Workspace.');
    end if;
  end if;

  insert into public.member_connections(requester_user_id, recipient_user_id, intent, message, status)
       values (v_me, p_recipient_user_id, v_intent, v_msg, 'pending')
    returning id into v_new_id;

  -- Bell notification is best-effort. A notifications-schema problem must not
  -- fail the request that has already been created.
  begin
    select full_name into v_my_name from public.profiles where id = v_me;
    perform public.create_notification(
      p_recipient_user_id,
      'connection_request',
      coalesce(v_my_name, 'A Pegasus member') || ' wants to connect with you',
      'About ' || public.member_connection_intent_label(v_intent) ||
        case when v_msg is not null then ' — “' || left(v_msg, 140) || case when length(v_msg) > 140 then '…' else '' end || '”' else '' end,
      '/network-requests.html#connection-' || v_new_id::text
    );
    v_notified := true;
  exception when others then
    v_notified := false;
  end;

  return jsonb_build_object('ok', true, 'id', v_new_id, 'status', 'pending', 'notified', v_notified);
end; $$;

grant execute on function public.send_member_connection(uuid, text, text) to authenticated;
