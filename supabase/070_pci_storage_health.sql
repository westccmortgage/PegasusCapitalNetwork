-- ============================================================================
-- 070 — Pegasus Capital Intelligence: private storage + schema health
--
-- 1. Private bucket `capital-intelligence-private` for daily XLSX imports,
--    OMs, rent rolls, loan documents, broker packages, and research documents.
--    NEVER the public profile-media bucket. Paths:
--      imports/YYYY/MM/<checksum>-<filename>
--      properties/{property_id}/<filename>
--    Admin-only via storage RLS; access from the browser is via signed URLs
--    created by the admin's own session (RLS-checked).
--
-- 2. pci_check_schema() — ADMIN-ONLY intelligence health check. This is kept
--    separate from check_platform_schema() (036) on purpose: that RPC is
--    callable by any authenticated member and must not enumerate the private
--    intelligence schema.
--
-- ADDITIVE + IDEMPOTENT. Requires 068/069.
-- ============================================================================

-- ── 1. Private bucket ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('capital-intelligence-private', 'capital-intelligence-private', false)
on conflict (id) do update set public = false;   -- force private even if it pre-existed

-- Admin-only object policies (service role bypasses RLS for function uploads).
drop policy if exists "pci bucket admin select" on storage.objects;
create policy "pci bucket admin select" on storage.objects for select to authenticated
  using (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
drop policy if exists "pci bucket admin insert" on storage.objects;
create policy "pci bucket admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
drop policy if exists "pci bucket admin update" on storage.objects;
create policy "pci bucket admin update" on storage.objects for update to authenticated
  using (bucket_id = 'capital-intelligence-private' and public.is_admin_user())
  with check (bucket_id = 'capital-intelligence-private' and public.is_admin_user());
drop policy if exists "pci bucket admin delete" on storage.objects;
create policy "pci bucket admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'capital-intelligence-private' and public.is_admin_user());

-- ── 2. Admin-only intelligence schema health ─────────────────────────────────
create or replace function public.pci_check_schema()
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
  v_crm_cols       text[];
begin
  if not public.is_admin_user() then
    raise exception 'Admins only';
  end if;

  v_missing_tables := array(
    select t from unnest(array[
      'pci_properties','pci_property_contacts','pci_loans','pci_tenants',
      'pci_listings','pci_distress_signals','pci_lender_programs','pci_sources',
      'pci_scores','pci_daily_actions','pci_import_batches','pci_import_rows',
      'pci_change_log','pci_entity_sources'
    ]) t
    where not exists (select 1 from pg_tables where schemaname='public' and tablename=t));

  v_missing_rpcs := array(
    select f from unnest(array[
      'pci_commit_import_batch','pci_rollback_import_batch','pci_apply_row',
      'pci_confidence_rank','pci_target_table','is_admin_user'
    ]) f
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f));

  select exists (select 1 from storage.buckets
                  where id = 'capital-intelligence-private' and public = false)
    into v_bucket_ok;

  v_crm_cols := array(
    select c from unnest(array[
      'job_title','website','linkedin_url','address_line1','city','state',
      'postal_code','last_verified_at','data_confidence','source_url','metadata'
    ]) c
    where not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='crm_contacts' and column_name=c));

  return jsonb_build_object(
    'ok', (coalesce(array_length(v_missing_tables,1),0) = 0
           and coalesce(array_length(v_missing_rpcs,1),0) = 0
           and coalesce(array_length(v_crm_cols,1),0) = 0
           and v_bucket_ok),
    'missing_tables',        to_jsonb(v_missing_tables),
    'missing_rpcs',          to_jsonb(v_missing_rpcs),
    'missing_crm_columns',   to_jsonb(v_crm_cols),
    'private_bucket_ok',     v_bucket_ok,
    'checked_at',            now());
end $$;

revoke all on function public.pci_check_schema() from public, anon;
grant execute on function public.pci_check_schema() to authenticated, service_role;
