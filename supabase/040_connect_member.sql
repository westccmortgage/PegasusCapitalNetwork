-- ============================================================================
-- PEGASUS Migration 040 — connect_member() RPC (fixes the dashboard "Connect")
-- IDEMPOTENT — safe to run multiple times.
--
-- WHY:
--   The dashboard "Connect" button inserted into public.messages with columns
--   that don't exist (recipient_id, content) and no thread_id/body, and RLS
--   (msg_send) requires the sender to already be a thread participant. So every
--   Connect click failed silently.
--
--   Messaging is thread-based: message_threads → thread_participants (both
--   users) → messages. This RPC does that setup atomically under SECURITY
--   DEFINER, then notifies the recipient. The caller only needs the target id.
--
--   Reuses an existing 1:1 thread between the two users if one already exists
--   (a thread with exactly those two participants and no deal_room_id).
-- ============================================================================

create or replace function public.connect_member(
  p_recipient uuid,
  p_message   text default null
)
returns uuid                       -- returns the thread id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_thread  uuid;
  v_body    text;
  v_myname  text;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_recipient is null or p_recipient = v_me then
    raise exception 'Invalid recipient';
  end if;

  -- Find an existing direct (non-deal-room) thread between exactly these two users
  select t.id into v_thread
  from public.message_threads t
  where t.deal_room_id is null
    and exists (select 1 from public.thread_participants p
                 where p.thread_id = t.id and p.user_id = v_me)
    and exists (select 1 from public.thread_participants p
                 where p.thread_id = t.id and p.user_id = p_recipient)
    and (select count(*) from public.thread_participants p
          where p.thread_id = t.id) = 2
  limit 1;

  -- Create the thread + participants if none exists
  if v_thread is null then
    insert into public.message_threads(subject) values ('Member connection')
      returning id into v_thread;
    insert into public.thread_participants(thread_id, user_id)
      values (v_thread, v_me), (v_thread, p_recipient)
      on conflict do nothing;
  end if;

  -- Insert the opening message
  select full_name into v_myname from public.profiles where id = v_me;
  v_body := coalesce(
    nullif(btrim(p_message), ''),
    'Hi! I found your profile on Pegasus and would like to connect.'
       || case when v_myname is not null then ' I''m ' || v_myname || '.' else '' end
  );

  insert into public.messages(thread_id, sender_id, body)
    values (v_thread, v_me, v_body);

  -- Notify the recipient (best-effort; ignore failures)
  begin
    perform public.notify(
      p_recipient,
      'lender_interest',
      'New connection request',
      coalesce(v_myname, 'A Pegasus member') || ' wants to connect with you.',
      '/messages.html',
      null
    );
  exception when others then null;
  end;

  return v_thread;
end;
$$;

grant execute on function public.connect_member(uuid, text) to authenticated;

-- Verify
select proname, pronargs
  from pg_proc
 where proname = 'connect_member';
