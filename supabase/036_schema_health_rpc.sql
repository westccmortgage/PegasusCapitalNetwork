-- ============================================================================
-- 036 — Platform schema health RPC
--
-- Creates public.check_platform_schema() which the health monitor calls
-- automatically on every run. Returns JSON listing:
--   missing_tables    — tables referenced by migrations but absent from DB
--   missing_constraints — unique constraints required for ON CONFLICT upserts
--   missing_rpcs      — server functions the frontend calls
--   missing_rls       — tables with RLS disabled (data exposure risk)
--   all_tables        — every public table (for inventory display)
--
-- Callable by any authenticated user; reads pg_catalog only (no data).
-- Idempotent — CREATE OR REPLACE.
-- ============================================================================

create or replace function public.check_platform_schema()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing_tables      text[];
  v_missing_constraints text[];
  v_missing_rpcs        text[];
  v_missing_rls         text[];
  v_all_tables          text[];
begin

  -- ── Tables that must exist ─────────────────────────────────────────────────
  v_missing_tables := array(
    select t
    from unnest(array[
      'profiles',
      'subscriptions',
      'memberships',
      'deal_rooms',
      'deal_room_participants',
      'access_codes',
      'code_redemptions',
      'trust_reviews',
      'lender_appetite_profiles',
      'financing_requests',
      'match_results',
      'admin_grants',
      'upgrade_log',
      'health_reports',
      'member_log',
      'notifications',
      'member_signals'
    ]) t
    where not exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    )
  );

  -- ── Unique constraints required for ON CONFLICT (user_id) upserts ─────────
  v_missing_constraints := array(
    select tbl || '.' || col
    from (values
      ('subscriptions', 'user_id'),
      ('memberships',   'user_id')
    ) as chk(tbl, col)
    where not exists (
      select 1
      from pg_constraint  c
      join pg_class       r  on r.oid  = c.conrelid
      join pg_namespace   n  on n.oid  = r.relnamespace
      join pg_attribute   a  on a.attrelid = c.conrelid
                             and a.attnum   = any(c.conkey)
      where n.nspname            = 'public'
        and r.relname            = tbl
        and a.attname            = col
        and c.contype            = 'u'
        and array_length(c.conkey, 1) = 1
    )
  );

  -- ── RPCs the frontend calls ────────────────────────────────────────────────
  v_missing_rpcs := array(
    select fn
    from unnest(array[
      'redeem_access_code',
      'admin_grant_member_access',
      'is_admin_user',
      'check_platform_schema',
      'get_my_review',
      'is_review_eligible',
      'post_member_signal',
      'get_member_signals',
      'get_my_recent_signals'
    ]) fn
    where not exists (
      select 1
      from   pg_proc       p
      join   pg_namespace  n on n.oid = p.pronamespace
      where  n.nspname = 'public' and p.proname = fn
    )
  );

  -- ── Tables with RLS disabled ───────────────────────────────────────────────
  v_missing_rls := array(
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'profiles', 'subscriptions', 'memberships', 'deal_rooms',
        'trust_reviews', 'access_codes', 'lender_appetite_profiles',
        'financing_requests', 'match_results'
      )
      and not rowsecurity
  );

  -- ── All public tables (for inventory display) ─────────────────────────────
  v_all_tables := array(
    select tablename
    from   pg_tables
    where  schemaname = 'public'
    order  by tablename
  );

  return jsonb_build_object(
    'missing_tables',       v_missing_tables,
    'missing_constraints',  v_missing_constraints,
    'missing_rpcs',         v_missing_rpcs,
    'missing_rls',          v_missing_rls,
    'all_tables',           v_all_tables,
    'checked_at',           now()
  );
end;
$$;

grant execute on function public.check_platform_schema() to authenticated;

select 'check_platform_schema() ready — call from health monitor to detect schema gaps' as status;
