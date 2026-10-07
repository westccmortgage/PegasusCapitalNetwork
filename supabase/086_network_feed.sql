-- ============================================================================
-- PEGASUS Migration 086 — Network Feed (public activity stream)
--
-- Turns member updates (member_signals, migrations 064/065) into a network-wide
-- feed at /feed, LinkedIn-style: every member's posts are visible to the whole
-- network (and to guests), with likes, an optional headline, and two new post
-- types — "event" (webinar / meetup, carries a date → powers the Upcoming
-- Events calendar) and "deal" (deal / offer / looking-for-capital).
--
-- ADDITIVE + IDEMPOTENT. Safe to run repeatedly. Requires 064 + 065.
-- Deliberately NO drops: the 064/065 functions (post_member_signal,
-- get_member_signals, get_my_recent_signals) stay as they are — the profile
-- composer on members.html keeps using them. New, differently-named RPCs carry
-- the feed:
--   post_feed_item       — post with headline / event date / location (≤1000 chars)
--   get_network_feed     — the public stream (keyset-paginated, type filter, permalink)
--   get_upcoming_events  — the calendar (type='event', event_at ascending)
--   get_member_posts     — a member's posts incl. title/event/likes (profile page)
--   toggle_signal_like   — like / unlike
--   delete_signal        — owner OR admin (moderation)
-- Privacy: the feed only exposes profile fields that are already public on
-- /u/<slug> (name, slug, avatar, title, company, location). Never email/phone.
-- ============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.member_signals
  add column if not exists title          text,
  add column if not exists event_at       timestamptz,
  add column if not exists event_location text;

-- ── Constraints (content limit 280 → 1000; new types) ────────────────────────
alter table public.member_signals drop constraint if exists ms_type_check;
alter table public.member_signals add constraint ms_type_check check (signal_type in (
  'working_on','seeking_intro','offering','showcase','referral','update',
  'market_view','story','project','event','deal'
));
alter table public.member_signals drop constraint if exists ms_content_len;
alter table public.member_signals add constraint ms_content_len
  check (char_length(btrim(content)) between 1 and 1000);
alter table public.member_signals drop constraint if exists ms_title_len;
alter table public.member_signals add constraint ms_title_len
  check (title is null or char_length(title) <= 140);
alter table public.member_signals drop constraint if exists ms_event_loc_len;
alter table public.member_signals add constraint ms_event_loc_len
  check (event_location is null or char_length(event_location) <= 160);

create index if not exists idx_ms_event_at on public.member_signals(event_at)
  where signal_type = 'event';
create index if not exists idx_ms_type_created on public.member_signals(signal_type, created_at desc);

-- ── Likes ────────────────────────────────────────────────────────────────────
create table if not exists public.member_signal_likes (
  signal_id  uuid        not null references public.member_signals(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)            on delete cascade,
  created_at timestamptz not null default now(),
  primary key (signal_id, user_id)
);
create index if not exists idx_msl_signal on public.member_signal_likes(signal_id);
alter table public.member_signal_likes enable row level security;
drop policy if exists msl_select on public.member_signal_likes;
create policy msl_select on public.member_signal_likes for select using (true);
-- No insert/delete policies: writes go through toggle_signal_like only.
grant select on public.member_signal_likes to anon, authenticated;

-- ── post_feed_item — headline + event fields, 1000-char body ─────────────────
create or replace function public.post_feed_item(
  p_type           text,
  p_content        text,
  p_image          text        default null,
  p_link           text        default null,
  p_title          text        default null,
  p_event_at       timestamptz default null,
  p_event_location text        default null
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
  v_title   text := nullif(btrim(coalesce(p_title, '')), '');
  v_loc     text := nullif(btrim(coalesce(p_event_location, '')), '');
  v_when    timestamptz := p_event_at;
  v_today   int;
  v_id      uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in to post an update.');
  end if;
  if v_content is null then
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'Write a short update first.');
  end if;
  if char_length(v_content) > 1000 then v_content := left(v_content, 1000); end if;
  if v_title is not null and char_length(v_title) > 140 then v_title := left(v_title, 140); end if;
  if v_loc   is not null and char_length(v_loc)   > 160 then v_loc   := left(v_loc, 160);   end if;
  if v_image is not null and char_length(v_image) > 600 then v_image := left(v_image, 600); end if;
  if v_link  is not null and char_length(v_link)  > 600 then v_link  := left(v_link, 600);  end if;
  -- Only accept http(s) URLs for media; otherwise drop the value silently.
  if v_image is not null and v_image !~* '^https?://' then v_image := null; end if;
  if v_link  is not null and v_link  !~* '^https?://' then v_link  := null; end if;
  if v_type not in ('working_on','seeking_intro','offering','showcase','referral','update','market_view','story','project','event','deal') then
    v_type := 'update';
  end if;
  if v_type = 'event' and v_when is null then
    return jsonb_build_object('ok', false, 'code', 'event_date', 'message', 'Add the event date and time.');
  end if;
  if v_type <> 'event' then
    v_when := null; v_loc := null;
  end if;

  select count(*) into v_today
    from public.member_signals
   where user_id = v_me and created_at > now() - interval '24 hours';
  if v_today >= 20 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'You have posted a lot today — try again later.');
  end if;

  insert into public.member_signals(user_id, signal_type, content, image_url, link_url, title, event_at, event_location)
  values (v_me, v_type, v_content, v_image, v_link, v_title, v_when, v_loc)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── get_network_feed — the public stream ─────────────────────────────────────
-- Keyset-paginated (p_before = created_at of the last row shown). p_type
-- filters one post type; p_id fetches a single post (permalink). Only authors
-- with a live profile are shown. Public profile fields only.
create or replace function public.get_network_feed(
  p_limit  int         default 20,
  p_before timestamptz default null,
  p_type   text        default null,
  p_id     uuid        default null
) returns table (
  id              uuid,
  user_id         uuid,
  signal_type     text,
  title           text,
  content         text,
  image_url       text,
  link_url        text,
  event_at        timestamptz,
  event_location  text,
  created_at      timestamptz,
  like_count      int,
  liked_by_me     boolean,
  author_name     text,
  author_slug     text,
  author_avatar   text,
  author_color    text,
  author_title    text,
  author_company  text,
  author_location text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, s.signal_type, s.title, s.content, s.image_url, s.link_url,
         s.event_at, s.event_location, s.created_at,
         coalesce((select count(*)::int from public.member_signal_likes l where l.signal_id = s.id), 0) as like_count,
         (auth.uid() is not null and exists (select 1 from public.member_signal_likes l where l.signal_id = s.id and l.user_id = auth.uid())) as liked_by_me,
         coalesce(nullif(btrim(p.full_name), ''), 'Pegasus member') as author_name,
         p.profile_slug, p.avatar_url, p.avatar_color,
         coalesce(nullif(btrim(p.professional_title), ''), nullif(btrim(p.headline), ''), p.role) as author_title,
         p.company_name, p.location
    from public.member_signals s
    join public.profiles p on p.id = s.user_id
   where p.deleted_at is null
     and coalesce(p.status, 'active') = 'active'
     and (p_id is null or s.id = p_id)
     and (p_before is null or s.created_at < p_before)
     and (p_type is null or p_type = '' or s.signal_type = p_type
          or (p_type = 'deal' and s.signal_type in ('deal','offering')))
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ── get_upcoming_events — the calendar ───────────────────────────────────────
create or replace function public.get_upcoming_events(
  p_limit int default 8
) returns table (
  id              uuid,
  user_id         uuid,
  title           text,
  content         text,
  link_url        text,
  image_url       text,
  event_at        timestamptz,
  event_location  text,
  created_at      timestamptz,
  author_name     text,
  author_slug     text,
  author_avatar   text,
  author_company  text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, s.title, s.content, s.link_url, s.image_url, s.event_at, s.event_location, s.created_at,
         coalesce(nullif(btrim(p.full_name), ''), 'Pegasus member'), p.profile_slug, p.avatar_url, p.company_name
    from public.member_signals s
    join public.profiles p on p.id = s.user_id
   where s.signal_type = 'event'
     and s.event_at >= now() - interval '6 hours'
     and p.deleted_at is null
     and coalesce(p.status, 'active') = 'active'
   order by s.event_at asc
   limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

-- ── get_member_posts — profile page reader (title/event/likes) ───────────────
create or replace function public.get_member_posts(
  p_user_id uuid,
  p_limit   int default 6
) returns table (
  id             uuid,
  signal_type    text,
  title          text,
  content        text,
  image_url      text,
  link_url       text,
  event_at       timestamptz,
  event_location text,
  created_at     timestamptz,
  like_count     int
)
language sql stable security definer set search_path = public as $$
  select s.id, s.signal_type, s.title, s.content, s.image_url, s.link_url, s.event_at, s.event_location, s.created_at,
         coalesce((select count(*)::int from public.member_signal_likes l where l.signal_id = s.id), 0)
    from public.member_signals s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ── toggle_signal_like ───────────────────────────────────────────────────────
create or replace function public.toggle_signal_like(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_liked boolean;
  v_count int;
  v_n     int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in to like posts.');
  end if;
  if not exists (select 1 from public.member_signals where id = p_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  delete from public.member_signal_likes where signal_id = p_id and user_id = v_me;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_liked := false;
  else
    insert into public.member_signal_likes(signal_id, user_id) values (p_id, v_me);
    v_liked := true;
  end if;
  select count(*)::int into v_count from public.member_signal_likes where signal_id = p_id;
  return jsonb_build_object('ok', true, 'liked', v_liked, 'count', v_count);
end;
$$;

-- ── delete_signal — owner or admin (moderation) ──────────────────────────────
create or replace function public.delete_signal(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_n  int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  delete from public.member_signals
   where id = p_id and (user_id = v_me or public.is_admin_user());
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant execute on function public.post_feed_item(text, text, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.get_network_feed(int, timestamptz, text, uuid)                to anon, authenticated;
grant execute on function public.get_upcoming_events(int)                                      to anon, authenticated;
grant execute on function public.get_member_posts(uuid, int)                                   to anon, authenticated;
grant execute on function public.toggle_signal_like(uuid)                                      to authenticated;
grant execute on function public.delete_signal(uuid)                                           to authenticated;
revoke execute on function public.post_feed_item(text, text, text, text, text, timestamptz, text),
                          public.toggle_signal_like(uuid), public.delete_signal(uuid) from anon;
