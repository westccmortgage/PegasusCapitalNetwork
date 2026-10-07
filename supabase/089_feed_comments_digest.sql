-- ============================================================================
-- PEGASUS Migration 089 — Feed comments, like/comment notifications, digest opt-out
--
--   * member_signal_comments  — comments on Network Feed posts (public read;
--                               writes only through RPCs; 60/day cap)
--   * add_signal_comment / get_signal_comments / get_signal_comment_counts /
--     remove_signal_comment (comment author, post author, or admin)
--   * toggle_signal_like now notifies the post author (kind 'feed_like');
--     add_signal_comment notifies with kind 'feed_comment' — both via the
--     existing create_notification(), link → /feed?post=<id>
--   * profiles.digest_opt_out + record_digest_optout_by_email() — weekly
--     digest unsubscribe (/unsubscribe?e=<email>&digest=1)
--
-- ADDITIVE + IDEMPOTENT. Requires 086 (feed) and 021 (notifications).
-- ============================================================================

-- ── Digest opt-out ───────────────────────────────────────────────────────────
alter table public.profiles add column if not exists digest_opt_out boolean not null default false;

create or replace function public.record_digest_optout_by_email(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.profiles set digest_opt_out = true, updated_at = now() where lower(email) = lower(btrim(coalesce(p_email, '')));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- ── Comments ─────────────────────────────────────────────────────────────────
create table if not exists public.member_signal_comments (
  id         uuid primary key default gen_random_uuid(),
  signal_id  uuid not null references public.member_signals(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null check (char_length(btrim(content)) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists idx_msc_signal_created on public.member_signal_comments(signal_id, created_at);
alter table public.member_signal_comments enable row level security;
drop policy if exists msc_select on public.member_signal_comments;
create policy msc_select on public.member_signal_comments for select using (true);
grant select on public.member_signal_comments to anon, authenticated;

create or replace function public.add_signal_comment(p_id uuid, p_content text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_txt text := nullif(btrim(coalesce(p_content, '')), '');
  v_author uuid; v_title text; v_cid uuid; v_name text; v_today int;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in to comment.'); end if;
  if v_txt is null then return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'Write a comment first.'); end if;
  if char_length(v_txt) > 600 then v_txt := left(v_txt, 600); end if;
  select user_id, coalesce(title, left(content, 60)) into v_author, v_title from public.member_signals where id = p_id;
  if v_author is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select count(*) into v_today from public.member_signal_comments where user_id = v_me and created_at > now() - interval '24 hours';
  if v_today >= 60 then return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'You have commented a lot today — try again later.'); end if;
  insert into public.member_signal_comments(signal_id, user_id, content) values (p_id, v_me, v_txt) returning id into v_cid;
  if v_author <> v_me then
    select coalesce(nullif(btrim(full_name), ''), 'A Pegasus member') into v_name from public.profiles where id = v_me;
    begin
      perform public.create_notification(v_author, 'feed_comment', v_name || ' commented on your post',
        left(v_txt, 140) || case when char_length(v_txt) > 140 then '…' else '' end, '/feed?post=' || p_id::text);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'id', v_cid);
end;
$$;

create or replace function public.get_signal_comments(p_id uuid, p_limit int default 50) returns table (
  id uuid, user_id uuid, content text, created_at timestamptz,
  author_name text, author_slug text, author_avatar text, author_color text, author_title text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, c.content, c.created_at,
         coalesce(nullif(btrim(p.full_name), ''), 'Pegasus member'), p.profile_slug, p.avatar_url, p.avatar_color,
         coalesce(nullif(btrim(p.professional_title), ''), nullif(btrim(p.headline), ''), p.role)
    from public.member_signal_comments c
    join public.profiles p on p.id = c.user_id
   where c.signal_id = p_id and p.deleted_at is null
   order by c.created_at asc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.get_signal_comment_counts(p_ids uuid[]) returns table (signal_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select c.signal_id, count(*)::int from public.member_signal_comments c where c.signal_id = any(p_ids) group by c.signal_id;
$$;

-- Comment author, the post's author, or an admin may remove a comment.
create or replace function public.remove_signal_comment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_n int;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  delete from public.member_signal_comments c
   where c.id = p_id
     and (c.user_id = v_me or public.is_admin_user()
          or exists (select 1 from public.member_signals s where s.id = c.signal_id and s.user_id = v_me));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- ── Likes now notify the post author ─────────────────────────────────────────
create or replace function public.toggle_signal_like(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_liked boolean;
  v_count int;
  v_n     int;
  v_author uuid; v_name text; v_title text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in to like posts.');
  end if;
  select user_id, coalesce(title, left(content, 60)) into v_author, v_title from public.member_signals where id = p_id;
  if v_author is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  delete from public.member_signal_likes where signal_id = p_id and user_id = v_me;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_liked := false;
  else
    insert into public.member_signal_likes(signal_id, user_id) values (p_id, v_me);
    v_liked := true;
    if v_author <> v_me then
      select coalesce(nullif(btrim(full_name), ''), 'A Pegasus member') into v_name from public.profiles where id = v_me;
      begin
        perform public.create_notification(v_author, 'feed_like', v_name || ' liked your post', left(v_title, 120), '/feed?post=' || p_id::text);
      exception when others then null;
      end;
    end if;
  end if;
  select count(*)::int into v_count from public.member_signal_likes where signal_id = p_id;
  return jsonb_build_object('ok', true, 'liked', v_liked, 'count', v_count);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant execute on function public.add_signal_comment(uuid, text), public.remove_signal_comment(uuid) to authenticated;
grant execute on function public.get_signal_comments(uuid, int), public.get_signal_comment_counts(uuid[]), public.record_digest_optout_by_email(text) to anon, authenticated;
revoke execute on function public.add_signal_comment(uuid, text), public.remove_signal_comment(uuid) from anon;
