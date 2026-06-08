-- ============================================================================
-- PEGASUS Migration 042 — create the MESSAGING tables (they were never created)
--
-- ROOT CAUSE of the Connect failure: connect_member() and every messaging path
-- reference public.message_threads / thread_participants / messages /
-- message_reads, but those tables do not exist in this database (error 42P01
-- "relation public.message_threads does not exist"). The messaging block of
-- migration 002 was never applied here.
--
-- This migration creates those tables + the in_thread() helper + RLS policies,
-- then re-creates connect_member() and reloads the PostgREST schema cache.
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────
-- NOTE: deal_room_id FK is added conditionally below so this runs even if the
-- deal_rooms table happens not to exist yet.
create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid,
  subject text,
  created_at timestamptz default now()
);

create table if not exists public.thread_participants (
  thread_id uuid references public.message_threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (thread_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_system boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.message_reads (
  message_id uuid references public.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (message_id, user_id)
);

-- Add the deal_rooms FK only if that table exists (keeps this migration safe)
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='deal_rooms')
     and not exists (select 1 from information_schema.table_constraints
             where constraint_name='message_threads_deal_room_id_fkey'
               and table_name='message_threads') then
    alter table public.message_threads
      add constraint message_threads_deal_room_id_fkey
      foreign key (deal_room_id) references public.deal_rooms(id) on delete cascade;
  end if;
end $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.message_threads     enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages            enable row level security;
alter table public.message_reads       enable row level security;

create or replace function public.in_thread(t uuid, uid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.thread_participants where thread_id=t and user_id=uid)
$$;

do $$ begin
  create policy mt_read on public.message_threads for select to authenticated
    using (public.in_thread(id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tp_read on public.thread_participants for select to authenticated
    using (user_id=auth.uid() or public.in_thread(thread_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy msg_read on public.messages for select to authenticated
    using (public.in_thread(thread_id, auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy msg_send on public.messages for insert to authenticated
    with check (public.in_thread(thread_id, auth.uid()) and sender_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mrd_self on public.message_reads for all to authenticated
    using (user_id=auth.uid()) with check (user_id=auth.uid());
exception when duplicate_object then null; end $$;

-- ── connect_member() (re-create now that the tables exist) ───────────────────
create or replace function public.connect_member(
  p_recipient uuid,
  p_message   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_thread  uuid;
  v_body    text;
  v_myname  text;
  v_has_notify boolean;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_recipient is null or p_recipient = v_me then raise exception 'Invalid recipient'; end if;

  -- Reuse an existing direct (non-deal-room) thread between exactly these two
  select t.id into v_thread
  from public.message_threads t
  where t.deal_room_id is null
    and exists (select 1 from public.thread_participants p where p.thread_id=t.id and p.user_id=v_me)
    and exists (select 1 from public.thread_participants p where p.thread_id=t.id and p.user_id=p_recipient)
    and (select count(*) from public.thread_participants p where p.thread_id=t.id) = 2
  limit 1;

  if v_thread is null then
    insert into public.message_threads(subject) values ('Member connection')
      returning id into v_thread;
    insert into public.thread_participants(thread_id, user_id)
      values (v_thread, v_me), (v_thread, p_recipient)
      on conflict do nothing;
  end if;

  select full_name into v_myname from public.profiles where id = v_me;
  v_body := coalesce(
    nullif(btrim(p_message), ''),
    'Hi! I found your profile on Pegasus and would like to connect.'
      || case when v_myname is not null then ' I''m ' || v_myname || '.' else '' end
  );

  insert into public.messages(thread_id, sender_id, body)
    values (v_thread, v_me, v_body);

  -- Notify recipient only if a notify() helper exists; never fail the connect
  select exists(select 1 from pg_proc where proname='notify') into v_has_notify;
  if v_has_notify then
    begin
      perform public.notify(
        p_recipient, 'lender_interest', 'New connection request',
        coalesce(v_myname,'A Pegasus member') || ' wants to connect with you.',
        '/messages.html', null
      );
    exception when others then null;
    end;
  end if;

  return v_thread;
end;
$$;

grant execute on function public.connect_member(uuid, text) to authenticated;

-- ── Reload PostgREST schema cache ────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('message_threads','thread_participants','messages','message_reads')
 order by table_name;
