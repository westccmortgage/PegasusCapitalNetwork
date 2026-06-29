-- ============================================================================
-- PEGASUS Migration 065 — Member Updates: media + content types
--
-- Extends the member_signals content layer (migration 064) so a member's update
-- can carry an optional image and an optional link/video URL, and adds the new
-- content types used by the composer (market_view / story / project). The
-- user-facing feature is "Share an update" / "Latest updates" — the table keeps
-- its internal name for compatibility.
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. Requires migration 064 first.
-- The frontend degrades gracefully: it calls the media-aware RPC and falls back
-- to the 064 text-only RPC when this migration has not been applied yet.
-- ============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.member_signals add column if not exists image_url text;
alter table public.member_signals add column if not exists link_url  text;

-- ── Widen the content-type check to include the new types ────────────────────
alter table public.member_signals drop constraint if exists ms_type_check;
alter table public.member_signals add constraint ms_type_check check (signal_type in (
  'working_on','seeking_intro','offering','showcase','referral','update',
  'market_view','story','project'
));

-- ── post_member_signal — now accepts optional image + link ───────────────────
-- Drop the 064 two-arg version so there is exactly one resolvable function.
drop function if exists public.post_member_signal(text, text);

create or replace function public.post_member_signal(
  p_type    text,
  p_content text,
  p_image   text default null,
  p_link    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_type    text := coalesce(nullif(btrim(p_type), ''), 'update');
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_image   text := nullif(btrim(coalesce(p_image, '')), '');
  v_link    text := nullif(btrim(coalesce(p_link, '')), '');
  v_today   int;
  v_id      uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in to post an update.');
  end if;
  if v_content is null then
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'Write a short update first.');
  end if;
  if char_length(v_content) > 280 then v_content := left(v_content, 280); end if;
  if v_image is not null and char_length(v_image) > 600 then v_image := left(v_image, 600); end if;
  if v_link  is not null and char_length(v_link)  > 600 then v_link  := left(v_link, 600);  end if;
  -- Only accept http(s) URLs for media; otherwise drop the value silently.
  if v_image is not null and v_image !~* '^https?://' then v_image := null; end if;
  if v_link  is not null and v_link  !~* '^https?://' then v_link  := null; end if;
  if v_type not in ('working_on','seeking_intro','offering','showcase','referral','update','market_view','story','project') then
    v_type := 'update';
  end if;

  select count(*) into v_today
    from public.member_signals
   where user_id = v_me and created_at > now() - interval '24 hours';
  if v_today >= 20 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'You have posted a lot today — try again later.');
  end if;

  insert into public.member_signals(user_id, signal_type, content, image_url, link_url)
  values (v_me, v_type, v_content, v_image, v_link)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── get_member_signals — now returns media columns ───────────────────────────
drop function if exists public.get_member_signals(uuid, int);
create or replace function public.get_member_signals(
  p_user_id uuid,
  p_limit   int default 6
) returns table (
  id          uuid,
  signal_type text,
  content     text,
  image_url   text,
  link_url    text,
  created_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.signal_type, s.content, s.image_url, s.link_url, s.created_at
    from public.member_signals s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ── get_my_recent_signals — now returns media columns ────────────────────────
drop function if exists public.get_my_recent_signals(int);
create or replace function public.get_my_recent_signals(
  p_limit int default 6
) returns table (
  id          uuid,
  signal_type text,
  content     text,
  image_url   text,
  link_url    text,
  created_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.signal_type, s.content, s.image_url, s.link_url, s.created_at
    from public.member_signals s
   where s.user_id = auth.uid()
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant execute on function public.post_member_signal(text, text, text, text) to authenticated;
grant execute on function public.get_member_signals(uuid, int)              to anon, authenticated;
grant execute on function public.get_my_recent_signals(int)                 to authenticated;
