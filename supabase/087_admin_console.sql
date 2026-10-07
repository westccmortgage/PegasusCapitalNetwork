-- ============================================================================
-- PEGASUS Migration 087 — Admin Console: real data for every tab
--
-- 1. Admin SELECT policies so the Admin Console can read across all members:
--    subscriptions, financing_requests, match_results, lender_appetite_profiles
--    (previously owner-only → the tabs were always empty for the admin) and
--    pn_invite_consent (invite campaign funnel; previously no policy at all).
-- 2. member_log: table had an admin-read policy (045) but no SELECT grant.
-- 3. admin_platform_stats(): one admin-gated RPC that returns the live numbers
--    the Analytics tab renders (replaces the hardcoded demo bars).
--
-- ADDITIVE + IDEMPOTENT. Requires is_admin_user() (migration 011).
-- ============================================================================

-- ── Admin read policies ──────────────────────────────────────────────────────
drop policy if exists sub_admin_read on public.subscriptions;
create policy sub_admin_read on public.subscriptions
  for select to authenticated using (public.is_admin_user());

drop policy if exists fr_admin_read on public.financing_requests;
create policy fr_admin_read on public.financing_requests
  for select to authenticated using (public.is_admin_user());

drop policy if exists mr_admin_read on public.match_results;
create policy mr_admin_read on public.match_results
  for select to authenticated using (public.is_admin_user());

drop policy if exists lap_admin_read on public.lender_appetite_profiles;
create policy lap_admin_read on public.lender_appetite_profiles
  for select to authenticated using (public.is_admin_user());

drop policy if exists pic_admin_read on public.pn_invite_consent;
create policy pic_admin_read on public.pn_invite_consent
  for select to authenticated using (public.is_admin_user());

grant select on public.member_log to authenticated;

-- ── admin_platform_stats ─────────────────────────────────────────────────────
create or replace function public.admin_platform_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin_user() then
    return jsonb_build_object('ok', false, 'message', 'Admin access required.');
  end if;
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'members_total', (select count(*) from public.profiles where deleted_at is null),
    'members_30d', (select count(*) from public.profiles where deleted_at is null and created_at > now() - interval '30 days'),
    'members_by_month', (select coalesce(jsonb_agg(jsonb_build_object('m', to_char(m, 'Mon YY'), 'n', n) order by m), '[]'::jsonb)
                          from (select date_trunc('month', created_at) m, count(*) n from public.profiles
                                 where created_at >= date_trunc('month', now()) - interval '11 months' group by 1) x),
    'members_by_role', (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(nullif(role,''), 'member'), 'n', n) order by n desc), '[]'::jsonb)
                         from (select role, count(*) n from public.profiles where deleted_at is null group by 1) x),
    'signups_by_source', (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(nullif(signup_source,''), 'direct'), 'n', n) order by n desc), '[]'::jsonb)
                           from (select signup_source, count(*) n from public.profiles where deleted_at is null group by 1) x),
    'presences_by_type', (select coalesce(jsonb_agg(jsonb_build_object('k', presence_type || ' · ' || visibility, 'n', n) order by n desc), '[]'::jsonb)
                           from (select presence_type, visibility, count(*) n from public.presences where status = 'active' group by 1, 2) x),
    'public_pages', (select count(*) from public.presences where status = 'active' and visibility = 'public_preview'),
    'feed_posts', (select count(*) from public.member_signals),
    'feed_posts_7d', (select count(*) from public.member_signals where created_at > now() - interval '7 days'),
    'feed_by_type', (select coalesce(jsonb_agg(jsonb_build_object('k', signal_type, 'n', n) order by n desc), '[]'::jsonb)
                      from (select signal_type, count(*) n from public.member_signals group by 1) x),
    'feed_likes', (select count(*) from public.member_signal_likes),
    'connections', (select count(*) from public.member_connections),
    'subscriptions_by_tier', (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(tier, 'free') || ' · ' || coalesce(status, 'active'), 'n', n) order by n desc), '[]'::jsonb)
                               from (select tier, status, count(*) n from public.subscriptions group by 1, 2) x),
    'invites', (select jsonb_build_object('total', count(*), 'invited', count(*) filter (where status = 'invited'),
                  'consented', count(*) filter (where status = 'consented'), 'opted_out', count(*) filter (where status = 'opted_out'),
                  'provisioned', count(*) filter (where provisioned_at is not null)) from public.pn_invite_consent),
    'pending_claims', (select count(*) from public.entity_claims where status = 'pending'),
    'pending_reviews', (select count(*) from public.trust_reviews where status = 'pending'),
    'deal_rooms', (select count(*) from public.deal_rooms),
    'financing_requests', (select count(*) from public.financing_requests),
    'opportunities', (select count(*) from public.opportunities)
  ) into r;
  return r;
end;
$$;

grant execute on function public.admin_platform_stats() to authenticated;
revoke execute on function public.admin_platform_stats() from anon;
