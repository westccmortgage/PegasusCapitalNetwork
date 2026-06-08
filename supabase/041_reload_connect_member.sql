-- ============================================================================
-- FIX: connect_member RPC returns 404 from the REST API
--
-- CAUSE: PostgREST (Supabase's REST layer) caches the DB schema. A function
--   created via the SQL editor exists in Postgres but the REST cache may not
--   have picked it up yet, so /rest/v1/rpc/connect_member returns 404 even
--   though the function is present.
--
-- This re-grants execute (idempotent) and forces PostgREST to reload its
-- schema cache so the RPC becomes callable immediately.
-- ============================================================================

-- 1. Make sure execute is granted to the roles the REST API uses
grant execute on function public.connect_member(uuid, text) to authenticated;
grant execute on function public.connect_member(uuid, text) to anon;

-- 2. Confirm there is exactly ONE connect_member function (overloads cause 404)
select proname,
       pg_get_function_identity_arguments(oid) as args
  from pg_proc
 where proname = 'connect_member';

-- 3. Force PostgREST to reload its schema cache (this is the actual fix)
notify pgrst, 'reload schema';

-- 4. Also reload config (belt-and-suspenders)
notify pgrst, 'reload config';
