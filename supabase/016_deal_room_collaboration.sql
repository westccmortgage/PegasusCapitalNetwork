-- ============================================================================
-- PEGASUS Migration 016 — Deal Room Collaboration Layer
-- IDEMPOTENT. Safe to run multiple times.
-- Run AFTER 015_reconcile_deal_rooms_columns.sql.
--
-- Adds the operational-workspace layer on top of the reconciled deal_rooms:
--   1. Structured opportunity fields (objective, structure_type, timeline,
--      target_outcome, visibility).
--   2. deal_room_messages — high-signal, threaded, kind-tagged communication
--      (NOT an open chat). Scoped to room members via existing is_room_member().
--   3. RPCs: post_room_message() and request_introduction() — both write an
--      activity entry + owner notification so the timeline stays the source of
--      truth.
--
-- COMPLIANCE NOTE: visibility + invite gating keep rooms PROTECTED by default
-- (owner + invited participants only). Nothing here makes Pegasus a party to a
-- deal, a recommender, or a matchmaker — visibility is member-directed.
-- ============================================================================

-- 1. Structured opportunity fields on deal_rooms ----------------------------
alter table public.deal_rooms add column if not exists objective       text;
alter table public.deal_rooms add column if not exists structure_type  text;
alter table public.deal_rooms add column if not exists timeline        text;
alter table public.deal_rooms add column if not exists target_outcome  text;
alter table public.deal_rooms add column if not exists visibility      text not null default 'invite_only';

do $$ begin
  alter table public.deal_rooms add constraint deal_rooms_visibility_chk
    check (visibility in ('private','invite_only','ambassador_reviewed','institutional','aligned_only'));
exception when duplicate_object then null; end $$;

-- 2. deal_room_messages — structured, threaded, high-signal ------------------
create table if not exists public.deal_room_messages (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  parent_id    uuid references public.deal_room_messages(id) on delete cascade, -- thread root = null
  kind         text not null default 'update'
                 check (kind in ('update','introduction','diligence','note')),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_drm_room   on public.deal_room_messages(deal_room_id, created_at desc);
create index if not exists idx_drm_thread on public.deal_room_messages(parent_id);

alter table public.deal_room_messages enable row level security;

-- Read: any room member (owner or invited participant). Protected by default.
drop policy if exists drm_select on public.deal_room_messages;
create policy drm_select on public.deal_room_messages for select to authenticated
  using (public.is_room_member(deal_room_id, auth.uid()));

-- Write: a member may post as themselves only.
drop policy if exists drm_insert on public.deal_room_messages;
create policy drm_insert on public.deal_room_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_room_member(deal_room_id, auth.uid()));

-- Edit/delete: author only (keeps the record honest).
drop policy if exists drm_update on public.deal_room_messages;
create policy drm_update on public.deal_room_messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists drm_delete on public.deal_room_messages;
create policy drm_delete on public.deal_room_messages for delete to authenticated
  using (author_id = auth.uid());

-- 3. post_room_message — insert message + mirror to activity timeline --------
create or replace function public.post_room_message(p_room uuid, p_kind text, p_body text, p_parent uuid default null)
returns public.deal_room_messages
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.deal_room_messages%rowtype; owner uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_room_member(p_room, uid) then raise exception 'not_a_member'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'empty_body'; end if;

  insert into public.deal_room_messages(deal_room_id, author_id, parent_id, kind, body)
    values (p_room, uid, p_parent, coalesce(p_kind,'update'), p_body)
    returning * into m;

  -- Timeline mirror (activity is the canonical room ledger)
  insert into public.deal_room_activity(deal_room_id, actor_id, message, kind)
    values (p_room, uid, left(p_body, 140), 'message');

  -- Notify the owner if someone else posts
  select owner_id into owner from public.deal_rooms where id = p_room;
  if owner is not null and owner <> uid then
    insert into public.notifications(user_id, kind, title, body, link, deal_room_id)
      values (owner, 'deal_room_update', 'New workspace update',
              left(p_body, 120), '/deal-room.html?id='||p_room, p_room);
  end if;
  return m;
end; $$;

-- 4. request_introduction — member-directed intro request (NOT a Pegasus match)
create or replace function public.request_introduction(p_room uuid, p_note text)
returns public.deal_room_messages
language plpgsql volatile security definer set search_path = public as $$
declare m public.deal_room_messages%rowtype;
begin
  m := public.post_room_message(
    p_room, 'introduction',
    coalesce(nullif(btrim(p_note),''), 'Requested a structured introduction within this workspace.'),
    null);
  return m;
end; $$;

grant execute on function public.post_room_message(uuid, text, text, uuid) to authenticated;
grant execute on function public.request_introduction(uuid, text)          to authenticated;

-- 5. Verify -----------------------------------------------------------------
select 'deal_room_messages' as obj, count(*)::text as detail from public.deal_room_messages
union all
select 'deal_rooms.visibility default', visibility from public.deal_rooms limit 1;
