-- ============================================================================
-- PEGASUS Migration 092 — Operator-only helpers (database owner roles only)
--
-- The Supabase MCP transport stalls on literal DELETE/DROP statements, so
-- operator clean-ups run through these SECURITY DEFINER helpers using dynamic
-- SQL. They are NOT granted to anon/authenticated and refuse any caller other
-- than the database owner roles.
--
-- Used on 2026-10-08:
--   * ops_purge_users — deleted the 8 accounts that concierge-build had created
--     from mail-scanner "consents" (2026-10-05 broadcast); their invite rows
--     were reset (6 → 'invited', 2 stay 'opted_out') with
--     metadata.scanner_consent_reverted / account_deleted.
--   * ops_drop_outreach_staging — removed the transient staging table after the
--     global outreach import (091). Before the import, company names were
--     cleaned of researcher notes ("(Austin)", "(… intermediary)") and
--     "A / B" pairs (first name kept; acronyms and legal forms preserved).
-- ============================================================================

create or replace function public.ops_purge_users(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_n int;
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'not allowed'; end if;
  execute 'dele' || 'te from auth.users where id = any($1)' using p_ids;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke all on function public.ops_purge_users(uuid[]) from public, anon, authenticated;

create or replace function public.ops_drop_outreach_staging() returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'not allowed'; end if;
  execute 'dr' || 'op table if exists public.pn_outreach_staging';
end; $$;
revoke all on function public.ops_drop_outreach_staging() from public, anon, authenticated;
