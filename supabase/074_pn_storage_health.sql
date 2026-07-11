-- ============================================================================
-- 074 — California Partner Network: private storage + schema health
--
-- 1. Private bucket `partner-network-private` for the daily partner XLSX
--    imports (originals). Paths: imports/YYYY/MM/<checksum>-<filename>.
--    Admin-only via storage RLS; browser access via signed URLs from the
--    admin's own session. Separate from the Capital Intelligence bucket.
--
-- 2. pn_check_schema() — ADMIN-ONLY partner-network health check, kept separate
--    from pci_check_schema() and the member-callable check_platform_schema().
--
-- ADDITIVE + IDEMPOTENT. Requires 072/073.
-- ============================================================================

-- ── 1. Private bucket ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('partner-network-private', 'partner-network-private', false)
on conflict (id) do update set public = false;

drop policy if exists "pn bucket admin select" on storage.objects;
create policy "pn bucket admin select" on storage.objects for select to authenticated
  using (bucket_id = 'partner-network-private' and public.is_admin_user());
drop policy if exists "pn bucket admin insert" on storage.objects;
create policy "pn bucket admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-network-private' and public.is_admin_user());
drop policy if exists "pn bucket admin update" on storage.objects;
create policy "pn bucket admin update" on storage.objects for update to authenticated
  using (bucket_id = 'partner-network-private' and public.is_admin_user())
  with check (bucket_id = 'partner-network-private' and public.is_admin_user());
drop policy if exists "pn bucket admin delete" on storage.objects;
create policy "pn bucket admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-network-private' and public.is_admin_user());

-- ── 2. Admin-only partner-network schema health ──────────────────────────────
create or replace function public.pn_check_schema()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_missing_tables text[];
  v_missing_rpcs   text[];
  v_bucket_ok      boolean;
begin
  if not public.is_admin_user() then
    raise exception 'Admins only';
  end if;

  v_missing_tables := array(
    select t from unnest(array[
      'pn_companies','pn_agents','pn_escrow_title','pn_activity_signals',
      'pn_outreach_actions','pn_do_not_contact',
      'pn_import_batches','pn_import_rows','pn_change_log'
    ]) t
    where not exists (select 1 from pg_tables where schemaname='public' and tablename=t));

  v_missing_rpcs := array(
    select f from unnest(array[
      'pn_commit_import_batch','pn_rollback_import_batch','pn_apply_row',
      'pn_confidence_rank','pn_target_table','is_admin_user'
    ]) f
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f));

  select exists (select 1 from storage.buckets
                  where id = 'partner-network-private' and public = false)
    into v_bucket_ok;

  return jsonb_build_object(
    'ok', (coalesce(array_length(v_missing_tables,1),0) = 0
           and coalesce(array_length(v_missing_rpcs,1),0) = 0
           and v_bucket_ok),
    'missing_tables',    to_jsonb(v_missing_tables),
    'missing_rpcs',      to_jsonb(v_missing_rpcs),
    'private_bucket_ok', v_bucket_ok,
    'checked_at',        now());
end $$;

revoke all on function public.pn_check_schema() from public, anon;
grant execute on function public.pn_check_schema() to authenticated, service_role;
