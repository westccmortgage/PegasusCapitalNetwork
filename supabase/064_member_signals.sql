-- ============================================================================
-- PEGASUS Migration 064 — Member Signals (Daily Signal)
--
-- A lightweight professional-update channel surfaced on the Members Network
-- (right column, between the profile card and the connection board) and on each
-- personal profile ("Recent signals"). This is NOT a social feed: there are no
-- likes, comments, or reposts in this pass — only short, public, professional
-- updates a member chooses to broadcast.
--
-- Product law:
--   • A signal is authored only by the signed-in member (auth.uid() = user_id).
--   • Signals are PUBLIC by design — they appear on the public personal profile,
--     so SELECT is open (anon + authenticated). They contain only what the member
--     typed; no private contact, email, or phone is ever stored or exposed.
--   • Inserts go through post_member_signal() (SECURITY DEFINER) which validates
--     type + length and applies a light daily cap so the channel can't be spammed.
--   • A member may delete their own signal.
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. Touches no existing table.
-- The frontend degrades gracefully when this migration has not been applied:
-- if the RPCs are absent the composer and "Recent signals" sections are hidden,
-- so nothing breaks before the migration runs.
--
-- Adds:
--   • public.member_signals (+ RLS + index)
--   • post_member_signal(p_type, p_content)        -> jsonb {ok, id|code, message}
--   • get_member_signals(p_user_id, p_limit)       -> public, a user's recent
--   • get_my_recent_signals(p_limit)               -> caller's recent
--   • delete_my_signal(p_id)                        -> jsonb {ok}
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists public.member_signals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  signal_type  text not null default 'update',
  content      text not null,
  created_at   timestamptz not null default now(),
  constraint ms_type_check check (signal_type in (
    'working_on','seeking_intro','offering','showcase','referral','update'
  )),
  constraint ms_content_len check (char_length(btrim(content)) between 1 and 280)
);

create index if not exists idx_ms_user_created
  on public.member_signals(user_id, created_at desc);
create index if not exists idx_ms_created
  on public.member_signals(created_at desc);

-- ── RLS — public read (signals are public updates); owner writes/deletes ──────
alter table public.member_signals enable row level security;

drop policy if exists ms_select on public.member_signals;
create policy ms_select on public.member_signals for select
  using (true);

drop policy if exists ms_delete on public.member_signals;
create policy ms_delete on public.member_signals for delete to authenticated
  using (user_id = auth.uid() or public.is_admin_user());

-- Inserts only via the SECURITY DEFINER RPC below (validation + daily cap).

-- ── post_member_signal — author a short professional update ──────────────────
create or replace function public.post_member_signal(
  p_type    text,
  p_content text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_type    text := coalesce(nullif(btrim(p_type), ''), 'update');
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_today   int;
  v_id      uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated',
      'message', 'Sign in to post a signal.');
  end if;
  if v_content is null then
    return jsonb_build_object('ok', false, 'code', 'empty',
      'message', 'Write a short update first.');
  end if;
  if char_length(v_content) > 280 then
    v_content := left(v_content, 280);
  end if;
  if v_type not in ('working_on','seeking_intro','offering','showcase','referral','update') then
    v_type := 'update';
  end if;

  -- Light daily cap (20/day) so the channel stays signal, not noise.
  select count(*) into v_today
    from public.member_signals
   where user_id = v_me and created_at > now() - interval '24 hours';
  if v_today >= 20 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited',
      'message', 'You have posted a lot today — try again later.');
  end if;

  insert into public.member_signals(user_id, signal_type, content)
  values (v_me, v_type, v_content)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── get_member_signals — a member's recent public signals (for profile) ──────
create or replace function public.get_member_signals(
  p_user_id uuid,
  p_limit   int default 6
) returns table (
  id          uuid,
  signal_type text,
  content     text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.signal_type, s.content, s.created_at
    from public.member_signals s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ── get_my_recent_signals — caller's own recent signals (for composer list) ──
create or replace function public.get_my_recent_signals(
  p_limit int default 6
) returns table (
  id          uuid,
  signal_type text,
  content     text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.signal_type, s.content, s.created_at
    from public.member_signals s
   where s.user_id = auth.uid()
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ── delete_my_signal — remove one of the caller's own signals ────────────────
create or replace function public.delete_my_signal(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  delete from public.member_signals where id = p_id and user_id = v_me;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant execute on function public.post_member_signal(text, text)      to authenticated;
grant execute on function public.get_member_signals(uuid, int)       to anon, authenticated;
grant execute on function public.get_my_recent_signals(int)          to authenticated;
grant execute on function public.delete_my_signal(uuid)              to authenticated;

-- ============================================================================
-- HEALTH CHECK (manual reference — see js/health-monitor.js update):
--   • table public.member_signals exists
--   • function post_member_signal(text,text) exists
--   • function get_member_signals(uuid,int) exists
--   • function get_my_recent_signals(int) exists
-- ============================================================================
