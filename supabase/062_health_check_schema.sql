-- ============================================================================
-- PEGASUS Migration 062 — Admin schema/RPC health check (read-only introspection)
--
-- Provides health_check_schema(): an ADMIN-ONLY, read-only function that reports
-- whether the tables, columns, and RPC functions the platform depends on exist
-- in this database. The Repair Center (admin.html → Schema & Repair) calls it to
-- detect production glitches like "column kind of relation notifications does not
-- exist" and to surface the safe additive repair SQL.
--
-- Security:
--   • SECURITY DEFINER but gated on public.is_admin_user() — non-admins get a
--     forbidden response and never see schema internals.
--   • Read-only. It NEVER alters anything. Repairs are surfaced to the admin as
--     copy-able SQL only (applied manually in the SQL editor).
-- IDEMPOTENT.
-- ============================================================================

create or replace function public.health_check_schema()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   boolean := false;
  v_tables  jsonb;
  v_cols    jsonb;
  v_funcs   jsonb;
begin
  begin v_admin := public.is_admin_user(); exception when others then v_admin := false; end;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('ok', false, 'code', 'forbidden',
      'message', 'Health check is available to administrators only.');
  end if;

  -- Required tables ----------------------------------------------------------
  select jsonb_agg(jsonb_build_object(
           'name', t,
           'exists', (to_regclass('public.' || t) is not null)
         ) order by t)
    into v_tables
  from unnest(array[
    'profiles','presences','presence_members','opportunities',
    'engagement_requests','notifications','member_connections'
  ]) as t;

  -- Required columns ("table.column") ----------------------------------------
  select jsonb_agg(jsonb_build_object(
           'table',  split_part(c, '.', 1),
           'column', split_part(c, '.', 2),
           'exists', exists(
             select 1 from information_schema.columns ic
             where ic.table_schema = 'public'
               and ic.table_name  = split_part(c, '.', 1)
               and ic.column_name = split_part(c, '.', 2)
           )
         ) order by c)
    into v_cols
  from unnest(array[
    'opportunities.template_type','opportunities.slug','opportunities.presence_id',
    'engagement_requests.status','engagement_requests.intent',
    'engagement_requests.message','engagement_requests.from_user_id',
    'notifications.kind','notifications.title','notifications.body',
    'notifications.link','notifications.read',
    'member_connections.status','member_connections.intent','member_connections.message',
    'member_connections.requester_user_id','member_connections.recipient_user_id',
    'profiles.banner_focal'
  ]) as c;

  -- Required RPC functions ---------------------------------------------------
  select jsonb_agg(jsonb_build_object(
           'name', f,
           'exists', exists(
             select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = f
           )
         ) order by f)
    into v_funcs
  from unnest(array[
    'create_presence','update_presence_basic','archive_presence','get_presence_page_by_slug',
    'create_opportunity','update_opportunity','archive_opportunity',
    'get_opportunities_for_presence','get_opportunity_by_slug',
    'create_engagement_request','get_engagement_requests_received',
    'get_engagement_requests_sent','update_engagement_request_status','count_engagement_requests_new',
    'send_member_connection','respond_member_connection','get_my_connection_requests',
    'get_my_connections','get_member_connections_for_profile','get_connection_state_with',
    'count_connection_requests_new','create_notification','get_recent_network_activity',
    'get_public_presentations','get_profile_business_pages_by_slug'
  ]) as f;

  return jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'tables',    coalesce(v_tables, '[]'::jsonb),
    'columns',   coalesce(v_cols,   '[]'::jsonb),
    'functions', coalesce(v_funcs,  '[]'::jsonb)
  );
end; $$;

grant execute on function public.health_check_schema() to authenticated;
