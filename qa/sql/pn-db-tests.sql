-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — DB-level proofs (self-verifying)
--
-- Proves the pn_ pipeline's DB-side guarantees: atomic commit (whole batch or
-- nothing), edit-aware rollback (manual edits detected), and admin-only RLS
-- enforced as the real `authenticated` role. Every check RAISES on failure.
--
-- HOW TO RUN (throwaway cluster; nothing touches production):
--   initdb -D /tmp/pnpg && pg_ctl -D /tmp/pnpg -o "-p 55432" start
--   psql -v ON_ERROR_STOP=1 -p 55432 -d postgres -f qa/sql/pn-db-tests.sql
-- Requires migrations 072–074 present at supabase/ (run psql from repo root).
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

drop schema if exists public cascade;  create schema public;
drop schema if exists auth cascade;    create schema auth;
drop schema if exists storage cascade; create schema storage;

create extension if not exists pgcrypto;
create table auth.users(id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets(id text primary key, name text, public boolean default false);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.profiles(id uuid primary key default gen_random_uuid(),
  full_name text, email text, role text, is_admin boolean default false);
create function public.is_admin_user() returns boolean language sql stable security definer set search_path=public as
  $$ select coalesce((select is_admin or role='admin' from public.profiles where id = auth.uid() limit 1), false) $$;
-- Minimal crm_contacts stub (pn_agents.linked_contact_id references it).
create table public.crm_contacts(id uuid primary key default gen_random_uuid(),
  owner_id uuid, name text, email text);

insert into public.profiles(id, full_name, email, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1','Admin','admin@example.com', true),
  ('00000000-0000-0000-0000-0000000000a3','Member','m@example.com', false);

\i supabase/072_pn_core.sql
\i supabase/073_pn_import.sql
\i supabase/074_pn_storage_health.sql
\i supabase/075_pn_import_mapper.sql
\i supabase/077_pn_research_fields.sql
\i supabase/078_pn_enrichment.sql
\i supabase/079_pn_outreach_approval.sql
-- Idempotency: re-run must not error.
\i supabase/072_pn_core.sql
\i supabase/073_pn_import.sql
\i supabase/074_pn_storage_health.sql
\i supabase/075_pn_import_mapper.sql
\i supabase/077_pn_research_fields.sql
\i supabase/078_pn_enrichment.sql
\i supabase/079_pn_outreach_approval.sql

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- pn_check_schema healthy.
do $$ begin
  if not (public.pn_check_schema()->>'ok')::boolean then raise exception 'PN SCHEMA FAIL: %', public.pn_check_schema(); end if;
  raise notice 'PN SCHEMA PASS — pn_check_schema ok:true';
end $$;

-- ══ ATOMIC COMMIT: one bad row aborts the whole batch ══
insert into public.pn_import_batches(id, filename, status) values
  ('00000000-0000-0000-0000-0000000b0001','atomic.xlsx','previewed');
-- Row 1: valid company insert.
insert into public.pn_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data)
  values ('00000000-0000-0000-0000-0000000b0001','Companies',2,'company','insert',
          jsonb_build_object('id','00000000-0000-0000-0000-00000000c001','company_name','Good Co'));
-- Row 2: invalid company insert (company_name is NOT NULL) → apply fails → abort.
insert into public.pn_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data)
  values ('00000000-0000-0000-0000-0000000b0001','Companies',3,'company','insert',
          jsonb_build_object('id','00000000-0000-0000-0000-00000000c002','city','Nowhere'));

do $$
declare res jsonb; v int;
begin
  res := public.pn_commit_import_batch('00000000-0000-0000-0000-0000000b0001','00000000-0000-0000-0000-0000000000a1','{}');
  raise exception 'B1 FAIL: commit did not abort on the invalid row (%).', res;
exception
  when others then
    -- Expected: the invalid row aborts the whole transaction.
    if sqlstate = 'P0001' and sqlerrm like 'Commit aborted at %' then
      raise notice 'B1 PASS(part) — commit aborted with context: %', sqlerrm;
    else raise; end if;
end $$;

do $$
declare v int; st text;
begin
  select count(*) into v from public.pn_companies; if v <> 0 then raise exception 'B1 FAIL: % live companies after aborted commit', v; end if;
  select count(*) into v from public.pn_change_log; if v <> 0 then raise exception 'B1 FAIL: change-log rows exist after abort'; end if;
  select status into st from public.pn_import_batches where id='00000000-0000-0000-0000-0000000b0001';
  if st <> 'previewed' then raise exception 'B1 FAIL: batch is % (expected previewed)', st; end if;
  raise notice 'B1 PASS — atomic: nothing applied, no change-log, batch still previewed';
end $$;

-- ══ EDIT-AWARE ROLLBACK ══
insert into public.pn_import_batches(id, filename, status) values
  ('00000000-0000-0000-0000-0000000b0002','clean.xlsx','previewed');
insert into public.pn_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data)
  values ('00000000-0000-0000-0000-0000000b0002','Companies',2,'company','insert',
          jsonb_build_object('id','00000000-0000-0000-0000-00000000c010','company_name','Rollback Co','city','San Jose'));
insert into public.pn_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data)
  values ('00000000-0000-0000-0000-0000000b0002','Agents',2,'agent','insert',
          jsonb_build_object('id','00000000-0000-0000-0000-00000000a010','full_name','Rollback Agent'));

do $$
declare res jsonb; v int;
begin
  res := public.pn_commit_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1','{}');
  if not (res->>'ok')::boolean then raise exception 'B2 setup FAIL: clean commit not ok (%)', res; end if;
  select count(*) into v from public.pn_companies; if v <> 1 then raise exception 'B2 setup FAIL: expected 1 company (%)', v; end if;

  -- Manual edit (writes NO change-log) → rollback must REFUSE.
  update public.pn_companies set city = 'Oakland' where id='00000000-0000-0000-0000-00000000c010';
  res := public.pn_rollback_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1');
  if (res->>'ok')::boolean then raise exception 'B2 FAIL: rollback did not refuse after manual edit'; end if;
  if not (res->'blockers') @> '[{"changed_fields":["city"]}]'::jsonb then raise exception 'B2 FAIL: blocker did not name city (%)', res; end if;
  raise notice 'B2 PASS(part) — rollback refused after manual edit (blocker: city)';

  -- Restore to committed state → rollback succeeds and deletes the inserts.
  update public.pn_companies set city = 'San Jose' where id='00000000-0000-0000-0000-00000000c010';
  res := public.pn_rollback_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1');
  if not (res->>'ok')::boolean then raise exception 'B2 FAIL: rollback refused after exact restore (%)', res; end if;
  select count(*) into v from public.pn_companies; if v <> 0 then raise exception 'B2 FAIL: company not removed on rollback (%)', v; end if;
  select count(*) into v from public.pn_agents; if v <> 0 then raise exception 'B2 FAIL: agent not removed on rollback (%)', v; end if;
  raise notice 'B2 PASS — edit-aware rollback: refused after edit, succeeded after restore';
end $$;

-- ══ ADMIN-ONLY RLS (as the real authenticated role) ══
reset role;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into public.pn_companies(id, company_name) values ('00000000-0000-0000-0000-00000000c020','Visible Only To Admin');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';  -- non-admin member
do $$
declare v int;
begin
  select count(*) into v from public.pn_companies; if v <> 0 then raise exception 'RLS FAIL: member saw % companies', v; end if;
  select count(*) into v from public.pn_agents;    if v <> 0 then raise exception 'RLS FAIL: member saw agents'; end if;
  begin
    insert into public.pn_companies(id, company_name) values (gen_random_uuid(),'Hacker Co');
    raise exception 'RLS FAIL: member inserted a company';
  exception when insufficient_privilege then null; end;
  raise notice 'RLS PASS — non-admin sees zero pn_ rows and cannot write';
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- admin
do $$
declare v int;
begin
  select count(*) into v from public.pn_companies; if v <> 1 then raise exception 'RLS FAIL: admin cannot read pn_companies (%)', v; end if;
  insert into public.pn_companies(id, company_name) values (gen_random_uuid(),'Admin Co');
  raise notice 'RLS PASS — admin reads + writes pn_ tables';
end $$;
reset role;

-- ══ PN-MAP: Universal Import Mapper — mapped batches commit atomically and
--    roll back edit-aware, using the SAME RPCs + provenance columns (075). ══
reset role;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- Profiles table is admin-writable and stores a mapping + fingerprints.
insert into public.pn_import_profiles(id, name, fingerprints, sheet_name_hints, mapping)
  values ('00000000-0000-0000-0000-00000000f001','LinkedIn Agent Export',
          array['company|dre|email|name'], array['linkedinexport'],
          '{"sheets":[{"sheet":"Sheet1","entity":"Agents"}]}'::jsonb);

-- Mapped batch with provenance columns populated.
insert into public.pn_import_batches(id, filename, original_filename, status, source_kind,
                                     import_profile_id, mapping, mapping_version)
  values ('00000000-0000-0000-0000-0000000b0f01','linkedin.csv','linkedin.csv','previewed','mapped',
          '00000000-0000-0000-0000-00000000f001','{"sheets":[]}'::jsonb, 1);
insert into public.pn_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data,
                                  source_sheet, source_row, source_raw, import_profile_id, mapping_version)
  values ('00000000-0000-0000-0000-0000000b0f01','Agents',2,'agent','insert',
          jsonb_build_object('id','00000000-0000-0000-0000-00000000a901','full_name','Mapped Agent','company_name_snapshot','Coastal'),
          'Sheet1', 2, '{"Agent Name":"Mapped Agent","Brokerage":"Coastal"}'::jsonb,
          '00000000-0000-0000-0000-00000000f001', 1);

do $$
declare res jsonb; v int; sraw jsonb;
begin
  res := public.pn_commit_import_batch('00000000-0000-0000-0000-0000000b0f01','00000000-0000-0000-0000-0000000000a1','{}');
  if not (res->>'ok')::boolean then raise exception 'PN-MAP FAIL: mapped commit not ok (%)', res; end if;
  select count(*) into v from public.pn_agents where id='00000000-0000-0000-0000-00000000a901';
  if v <> 1 then raise exception 'PN-MAP FAIL: mapped agent not inserted'; end if;
  -- provenance survived on the committed row
  select source_raw into sraw from public.pn_import_rows where batch_id='00000000-0000-0000-0000-0000000b0f01';
  if sraw->>'Agent Name' <> 'Mapped Agent' then raise exception 'PN-MAP FAIL: provenance source_raw lost (%)', sraw; end if;
  -- edit-aware rollback still applies to mapped batches
  update public.pn_agents set company_name_snapshot='Edited' where id='00000000-0000-0000-0000-00000000a901';
  res := public.pn_rollback_import_batch('00000000-0000-0000-0000-0000000b0f01','00000000-0000-0000-0000-0000000000a1');
  if (res->>'ok')::boolean then raise exception 'PN-MAP FAIL: rollback did not refuse after manual edit'; end if;
  update public.pn_agents set company_name_snapshot='Coastal' where id='00000000-0000-0000-0000-00000000a901';
  res := public.pn_rollback_import_batch('00000000-0000-0000-0000-0000000b0f01','00000000-0000-0000-0000-0000000000a1');
  if not (res->>'ok')::boolean then raise exception 'PN-MAP FAIL: rollback refused after restore (%)', res; end if;
  select count(*) into v from public.pn_agents where id='00000000-0000-0000-0000-00000000a901';
  if v <> 0 then raise exception 'PN-MAP FAIL: mapped agent not removed on rollback'; end if;
  raise notice 'PN-MAP PASS — mapped batch: atomic commit, provenance retained, edit-aware rollback';
end $$;

\echo ''
\echo '════════════════════════════════════════════'
\echo 'ALL PN DB-LEVEL PROOFS PASSED (atomic commit · edit-aware rollback · admin RLS · schema · idempotency · PN-MAP mapper)'
\echo '════════════════════════════════════════════'
