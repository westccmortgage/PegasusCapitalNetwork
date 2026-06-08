-- ============================================================================
-- PEGASUS Migration 043 — connect_member() for the ACTUAL (flat) messages table
--
-- Reality check: the messages table in THIS database is a flat direct-message
-- table, NOT thread-based:
--   messages(id, sender_id, receiver_id, subject, body, is_read, created_at)
-- There are no message_threads / thread_participants tables. (Migrations 040 &
-- 042 assumed a thread schema that was never deployed here.)
--
-- This migration rewrites connect_member() to insert one direct message under
-- SECURITY DEFINER (so it works regardless of RLS), adds correct RLS policies
-- for self read / insert / mark-read, and reloads the PostgREST cache.
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================================

-- ── RLS policies for the flat messages table ────────────────────────────────
alter table public.messages enable row level security;

do $$ begin
  create policy msg_sel_flat on public.messages for select to authenticated
    using (sender_id = auth.uid() or receiver_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy msg_ins_flat on public.messages for insert to authenticated
    with check (sender_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy msg_upd_flat on public.messages for update to authenticated
    using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── connect_member() — flat insert ───────────────────────────────────────────
create or replace function public.connect_member(
  p_recipient uuid,
  p_message   text default null
)
returns uuid                      -- returns the new message id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_myname text;
  v_body   text;
  v_id     uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_recipient is null or p_recipient = v_me then raise exception 'Invalid recipient'; end if;

  select full_name into v_myname from public.profiles where id = v_me;
  v_body := coalesce(
    nullif(btrim(p_message), ''),
    'Hi! I found your profile on Pegasus and would like to connect.'
      || case when v_myname is not null then ' I''m ' || v_myname || '.' else '' end
  );

  insert into public.messages(sender_id, receiver_id, subject, body, is_read)
    values (v_me, p_recipient, 'Connection request', v_body, false)
    returning id into v_id;

  -- Notify recipient if a notify() helper exists; never fail the connect on this
  if exists (select 1 from pg_proc where proname = 'notify') then
    begin
      perform public.notify(
        p_recipient, 'lender_interest', 'New connection request',
        coalesce(v_myname, 'A Pegasus member') || ' wants to connect with you.',
        '/messages.html', null
      );
    exception when others then null;
    end;
  end if;

  return v_id;
end;
$$;

grant execute on function public.connect_member(uuid, text) to authenticated;

-- ── Reload PostgREST schema cache ────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc where proname = 'connect_member';
