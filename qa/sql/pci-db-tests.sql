-- ============================================================================
-- PEGASUS CAPITAL INTELLIGENCE — DB-level proofs (self-verifying)
--
-- Proves the DB-side guarantees that the Node suite (qa/intelligence-audit.js)
-- cannot: atomic commit, edit-aware rollback, non-destructive CRM merge,
-- county-aware property uniqueness, jurisdiction-aware loan uniqueness, and
-- durable source lineage. Every check RAISES on failure, so a non-zero psql
-- exit means a regression.
--
-- HOW TO RUN (throwaway cluster; nothing touches production):
--   initdb -D /tmp/pcipg && pg_ctl -D /tmp/pcipg -o "-p 55432" start
--   psql -v ON_ERROR_STOP=1 -p 55432 -d postgres -f qa/sql/pci-db-tests.sql
--   (order-independent: this file drops+recreates public/auth/storage itself)
-- Requires migrations 067–070 present at supabase/ (paths below are relative to
-- the repo root; run psql from there).
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

drop schema if exists public cascade;  create schema public;
drop schema if exists auth cascade;    create schema auth;
drop schema if exists storage cascade; create schema storage;

-- ── Supabase-shaped stubs ────────────────────────────────────────────────────
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
  full_name text, role text, company_name text, is_admin boolean default false, profile_completion int default 0);
create function public.is_admin_user() returns boolean language sql stable security definer set search_path=public as
  $$ select coalesce((select is_admin or role='admin' from public.profiles where id = auth.uid() limit 1), false) $$;
create table public.crm_contacts(id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(), name text not null, company text, email text, phone text,
  contact_type text, source text not null default 'manual', linked_profile_id uuid,
  tags text[] not null default '{}', notes text, status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.crm_deals(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
  contact_id uuid references public.crm_contacts(id) on delete set null, title text not null);
create table public.crm_reminders(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
  contact_id uuid references public.crm_contacts(id) on delete set null, title text not null, due_at timestamptz default now());
create table public.crm_activities(id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade, kind text default 'note', body text);

-- Seed CRM duplicates + dependents BEFORE 067 (to exercise the safe merge).
insert into public.profiles(id, full_name, is_admin) values ('00000000-0000-0000-0000-0000000000a1','Admin',true);
insert into public.profiles(id, full_name) values ('00000000-0000-0000-0000-0000000000f1','Linked');
insert into public.crm_contacts(id, owner_id, name, company, email, phone, notes, tags, linked_profile_id, created_at) values
 ('00000000-0000-0000-0000-0000000c0001','00000000-0000-0000-0000-0000000000a1','Broker A','Acme','a@acme.com',null,'note1',array['retail'],'00000000-0000-0000-0000-0000000000f1','2026-01-01'),
 ('00000000-0000-0000-0000-0000000c0002','00000000-0000-0000-0000-0000000000a1','Broker A',null,null,'555','note2',array['multi'],'00000000-0000-0000-0000-0000000000f1','2026-02-01');
insert into public.crm_deals(id, owner_id, contact_id, title) values ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000c0002','deal');
insert into public.crm_reminders(id, owner_id, contact_id, title) values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000c0002','rem');
insert into public.crm_activities(id, owner_id, contact_id, body) values ('00000000-0000-0000-0000-0000000f0001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000c0002','act');

-- ── Apply migrations under test ──────────────────────────────────────────────
\i supabase/067_crm_intelligence_fields.sql
\i supabase/068_pci_core.sql
\i supabase/069_pci_import.sql
\i supabase/070_pci_storage_health.sql
-- Idempotency: re-run must not error.
\i supabase/068_pci_core.sql
\i supabase/069_pci_import.sql
\i supabase/070_pci_storage_health.sql

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
declare v int; v_txt text; ok boolean;
begin
  -- ══ BLOCKER 3: non-destructive CRM merge ══
  select count(*) into v from public.crm_contacts;
  if v <> 1 then raise exception 'B3 FAIL: expected 1 merged contact, got %', v; end if;
  select phone into v_txt from public.crm_contacts;  -- filled from loser
  if v_txt <> '555' then raise exception 'B3 FAIL: phone not merged (%)', v_txt; end if;
  select cardinality(tags) into v from public.crm_contacts;
  if v <> 2 then raise exception 'B3 FAIL: tags not unioned (%)', v; end if;
  select count(*) into v from public.crm_deals where contact_id='00000000-0000-0000-0000-0000000c0001';
  if v <> 1 then raise exception 'B3 FAIL: deal not reassigned'; end if;
  select count(*) into v from public.crm_activities where contact_id='00000000-0000-0000-0000-0000000c0002';
  if v <> 0 then raise exception 'B3 FAIL: orphaned activity remains'; end if;
  raise notice 'B3 PASS — CRM merge preserved all data, reassigned dependents, no loss';

  -- ══ pci_check_schema healthy ══
  if not (public.pci_check_schema()->>'ok')::boolean then
    raise exception 'SCHEMA FAIL: %', public.pci_check_schema();
  end if;
  raise notice 'SCHEMA PASS — pci_check_schema ok:true';

  -- ══ ARCH 4: county-aware property uniqueness ══
  insert into public.pci_properties(id, address_line1, normalized_address, city, county, parcel_id)
    values (gen_random_uuid(),'1 A St','1 A ST|WPB|FL|','WPB','Palm Beach','00-1234');
  insert into public.pci_properties(id, address_line1, normalized_address, city, county, parcel_id)
    values (gen_random_uuid(),'2 B St','2 B ST|FTL|FL|','FTL','Broward','00-1234');   -- same parcel, other county: OK
  select count(*) into v from public.pci_properties where parcel_id='00-1234';
  if v <> 2 then raise exception 'A4 FAIL: same parcel two counties did not create 2 rows (%)', v; end if;
  begin
    insert into public.pci_properties(id, address_line1, normalized_address, city, county, parcel_id)
      values (gen_random_uuid(),'3 C St','3 C ST|WPB|FL|','WPB','Palm Beach','00-1234'); -- dup within county
    raise exception 'A4 FAIL: duplicate parcel within a county was allowed';
  exception when unique_violation then null; end;
  raise notice 'A4 PASS — parcel unique per county; cross-county allowed';

  -- ══ ARCH 5: jurisdiction-aware loan uniqueness ══
  declare pid uuid;
  begin
    select id into pid from public.pci_properties where county='Palm Beach' and parcel_id='00-1234' limit 1;
    insert into public.pci_loans(id, property_id, instrument_number, recording_jurisdiction)
      values (gen_random_uuid(), pid, 'SAME-1', 'Palm Beach');
    insert into public.pci_loans(id, property_id, instrument_number, recording_jurisdiction)
      values (gen_random_uuid(), pid, 'SAME-1', 'Broward');   -- same instrument, other jurisdiction: OK
    select count(*) into v from public.pci_loans where instrument_number='SAME-1';
    if v <> 2 then raise exception 'A5 FAIL: same instrument two jurisdictions did not create 2 loans (%)', v; end if;
    begin
      insert into public.pci_loans(id, property_id, instrument_number, recording_jurisdiction)
        values (gen_random_uuid(), pid, 'SAME-1', 'PALM BEACH');  -- same jurisdiction, differ by case → dup
      raise exception 'A5 FAIL: duplicate instrument within a jurisdiction was allowed';
    exception when unique_violation then null; end;
  end;
  raise notice 'A5 PASS — instrument unique per recording jurisdiction; cross-jurisdiction allowed';
end $$;

-- ══ BLOCKER 1: ATOMIC COMMIT (one invalid row aborts everything) ══
insert into public.pci_import_batches(id, filename, file_checksum, status)
  values ('00000000-0000-0000-0000-0000000b0001','atomic.xlsx','chk1','previewed');
insert into public.pci_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data) values
 ('00000000-0000-0000-0000-0000000b0001','Properties',2,'property','insert',
   jsonb_build_object('id','00000000-0000-0000-0000-0000000a1001','address_line1','1 Ok St','normalized_address','1 OK ST|X|FL|','city','X')),
 ('00000000-0000-0000-0000-0000000b0001','Properties',3,'property','insert',
   jsonb_build_object('id','00000000-0000-0000-0000-0000000a1002','address_line1','2 Bad St','normalized_address','2 BAD ST|X|FL|','city','X','opportunity_score',999));
do $$
declare aborted boolean := false; v int;
begin
  begin perform public.pci_commit_import_batch('00000000-0000-0000-0000-0000000b0001','00000000-0000-0000-0000-0000000000a1','{}');
  exception when others then aborted := true; end;
  if not aborted then raise exception 'B1 FAIL: commit did not abort'; end if;
  select count(*) into v from public.pci_properties where id in ('00000000-0000-0000-0000-0000000a1001','00000000-0000-0000-0000-0000000a1002');
  if v <> 0 then raise exception 'B1 FAIL: % live rows after aborted commit', v; end if;
  select count(*) into v from public.pci_change_log where batch_id='00000000-0000-0000-0000-0000000b0001';
  if v <> 0 then raise exception 'B1 FAIL: change-log rows after aborted commit'; end if;
  perform 1 from public.pci_import_batches where id='00000000-0000-0000-0000-0000000b0001' and status='previewed';
  if not found then raise exception 'B1 FAIL: batch was marked committed'; end if;
  raise notice 'B1 PASS — commit is all-or-nothing (0 rows, batch still previewed)';
end $$;

-- ══ BLOCKER 2 + ARCH 6: commit a real batch, verify provenance, then rollback ══
insert into public.pci_import_batches(id, filename, file_checksum, status)
  values ('00000000-0000-0000-0000-0000000b0002','ok.xlsx','chk2','previewed');
insert into public.pci_import_rows(batch_id, sheet_name, row_number, target_type, proposed_action, after_data, source_ref) values
 ('00000000-0000-0000-0000-0000000b0002','Sources',2,'source','insert',
   jsonb_build_object('id','00000000-0000-0000-0000-00000000e001','source_url','https://ex.com/s','normalized_url','ex.com/s'), null),
 ('00000000-0000-0000-0000-0000000b0002','Properties',2,'property','insert',
   jsonb_build_object('id','00000000-0000-0000-0000-00000000d001','address_line1','9 Prov Ave','normalized_address','9 PROV AVE|X|FL|','city','X','asking_price',5000000,'data_confidence','Reported'),
   '00000000-0000-0000-0000-00000000e001'),
 ('00000000-0000-0000-0000-0000000b0002','(provenance)',2,'entity_source','insert',
   jsonb_build_object('id','00000000-0000-0000-0000-00000000c101','entity_type','pci_properties','entity_id','00000000-0000-0000-0000-00000000d001','source_id','00000000-0000-0000-0000-00000000e001','confidence','Reported'), null);
do $$
declare v int; res jsonb;
begin
  res := public.pci_commit_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1','{}');
  if not (res->>'ok')::boolean then raise exception 'B2 setup FAIL: commit not ok (%)', res; end if;
  -- ARCH 6: provenance persisted + change_log.source_id populated.
  select count(*) into v from public.pci_entity_sources where entity_id='00000000-0000-0000-0000-00000000d001' and source_id='00000000-0000-0000-0000-00000000e001';
  if v <> 1 then raise exception 'A6 FAIL: entity_source link not created (%)', v; end if;
  select count(*) into v from public.pci_change_log where entity_id='00000000-0000-0000-0000-00000000d001' and source_id='00000000-0000-0000-0000-00000000e001';
  if v < 1 then raise exception 'A6 FAIL: change_log.source_id not populated'; end if;
  raise notice 'A6 PASS — entity_source link + change_log.source_id populated';

  -- Manual edit (writes NO change-log) then rollback must REFUSE.
  update public.pci_properties set asking_price = 4444444 where id='00000000-0000-0000-0000-00000000d001';
  res := public.pci_rollback_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1');
  if (res->>'ok')::boolean then raise exception 'B2 FAIL: rollback did not refuse after manual edit'; end if;
  if not (res->'blockers') @> '[{"changed_fields":["asking_price"]}]'::jsonb then raise exception 'B2 FAIL: blocker did not name asking_price (%)', res; end if;
  select count(*) into v from public.pci_properties where id='00000000-0000-0000-0000-00000000d001';
  if v <> 1 then raise exception 'B2 FAIL: property removed despite refusal'; end if;
  raise notice 'B2 PASS — rollback refused after manual edit (blocker: asking_price)';

  -- Restore to committed state → rollback succeeds and deletes the insert.
  update public.pci_properties set asking_price = 5000000 where id='00000000-0000-0000-0000-00000000d001';
  res := public.pci_rollback_import_batch('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000a1');
  if not (res->>'ok')::boolean then raise exception 'B2 FAIL: rollback refused after exact restore (%)', res; end if;
  select count(*) into v from public.pci_properties where id='00000000-0000-0000-0000-00000000d001';
  if v <> 0 then raise exception 'B2 FAIL: property not removed on successful rollback'; end if;
  -- entity_source cascades away with its source? source row deleted by rollback → link cascade.
  raise notice 'B2 PASS — rollback succeeds only after exact restore';
end $$;

\echo ''
\echo '════════════════════════════════════════════'
\echo 'ALL DB-LEVEL PROOFS PASSED (B1 B2 B3 A4 A5 A6 + schema + idempotency)'
\echo '════════════════════════════════════════════'
