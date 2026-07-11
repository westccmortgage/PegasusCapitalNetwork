-- ============================================================================
-- 069 — Pegasus Capital Intelligence: import pipeline + audit trail
--
-- Tables: pci_import_batches, pci_import_rows, pci_change_log.
-- RPCs:   pci_commit_import_batch(), pci_rollback_import_batch()
--
-- ARCHITECTURE: the Netlify preview function does ALL semantic work (parse,
-- validate, normalize, dedupe, resolve FKs, detect conflicts) and stores a
-- fully-resolved column→value map in pci_import_rows.after_data (inserts get a
-- pre-generated id so same-batch children can reference their parent). The
-- commit RPC is a compact GENERIC applier: one transaction, whitelisted target
-- tables, typed via jsonb_populate_record, full change logging, and a hard
-- backstop that never lets lower-confidence data overwrite Verified data
-- without an explicit admin resolution.
--
-- SECURITY: RPCs are EXECUTE-able by service_role ONLY (the Netlify functions
-- verify the caller's admin JWT first, then call with the service key). The
-- tables are RLS admin-only so the admin UI can read import history directly.
--
-- ADDITIVE + IDEMPOTENT. Requires 068.
-- ============================================================================

-- ── K. pci_import_batches ────────────────────────────────────────────────────
create table if not exists public.pci_import_batches(
  id                uuid primary key default gen_random_uuid(),
  filename          text not null,
  file_checksum     text not null,
  file_storage_path text,
  uploaded_by       uuid,
  status            text not null default 'uploaded' check (status in
    ('uploaded','previewed','approved','committed','rejected','rolled_back','failed')),
  summary           jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  approved_at       timestamptz,
  committed_at      timestamptz,
  rolled_back_at    timestamptz
);
create index if not exists idx_pci_batches_created on public.pci_import_batches(created_at desc);
create index if not exists idx_pci_batches_checksum on public.pci_import_batches(file_checksum);

-- ── L. pci_import_rows ───────────────────────────────────────────────────────
create table if not exists public.pci_import_rows(
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.pci_import_batches(id) on delete cascade,
  sheet_name        text not null,
  row_number        integer not null,
  target_type       text not null,
  dedupe_key        text,
  proposed_action   text not null check (proposed_action in ('insert','update','unchanged','conflict','invalid')),
  raw_data          jsonb not null default '{}'::jsonb,
  normalized_data   jsonb not null default '{}'::jsonb,
  before_data       jsonb,
  after_data        jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  status            text not null default 'pending' check (status in
    ('pending','committed','skipped','resolved_keep','resolved_apply','rolled_back','failed')),
  target_record_id  uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_pci_rows_batch on public.pci_import_rows(batch_id, sheet_name, row_number);
drop trigger if exists trg_pci_import_rows_touch on public.pci_import_rows;
create trigger trg_pci_import_rows_touch before update on public.pci_import_rows
  for each row execute function public.pci_touch();

-- ── M. pci_change_log ────────────────────────────────────────────────────────
create table if not exists public.pci_change_log(
  id                uuid primary key default gen_random_uuid(),
  entity_type       text not null,
  entity_id         uuid not null,
  field_name        text not null,
  old_value         jsonb,
  new_value         jsonb,
  confidence_before text,
  confidence_after  text,
  source_id         uuid,
  batch_id          uuid,
  changed_by        uuid,
  changed_at        timestamptz not null default now()
);
create index if not exists idx_pci_log_entity on public.pci_change_log(entity_type, entity_id, changed_at desc);
create index if not exists idx_pci_log_batch  on public.pci_change_log(batch_id);

-- RLS (admin-only; service role bypasses)
do $$
declare t text;
begin
  foreach t in array array['pci_import_batches','pci_import_rows','pci_change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;

-- ── Whitelisted import targets ───────────────────────────────────────────────
create or replace function public.pci_target_table(p_type text) returns text
language sql immutable as $$
  select case p_type
    when 'property'          then 'pci_properties'
    when 'property_update'   then 'pci_properties'
    when 'contact'           then 'crm_contacts'
    when 'property_contact'  then 'pci_property_contacts'
    when 'loan'              then 'pci_loans'
    when 'tenant'            then 'pci_tenants'
    when 'listing'           then 'pci_listings'
    when 'distress_signal'   then 'pci_distress_signals'
    when 'lender_program'    then 'pci_lender_programs'
    when 'score'             then 'pci_scores'
    when 'daily_action'      then 'pci_daily_actions'
    when 'source'            then 'pci_sources'
    else null end
$$;

-- Confidence column name per table ('' = none).
create or replace function public.pci_conf_col(p_table text) returns text
language sql immutable as $$
  select case p_table
    when 'pci_properties'      then 'data_confidence'
    when 'crm_contacts'        then 'data_confidence'
    when 'pci_property_contacts' then 'confidence'
    when 'pci_loans'           then 'confidence'
    when 'pci_tenants'         then 'confidence'
    when 'pci_listings'        then 'confidence'
    when 'pci_distress_signals' then 'confidence'
    when 'pci_lender_programs' then 'confidence'
    else '' end
$$;

-- ── Generic apply helper: insert or update from a jsonb column map ───────────
-- Only columns that really exist on the whitelisted table are applied.
create or replace function public.pci_apply_row(
  p_table  text,
  p_action text,          -- 'insert' | 'update'
  p_id     uuid,          -- target id (update) — inserts carry id in p_data
  p_data   jsonb
) returns uuid
language plpgsql as $$
declare
  v_cols text;
  v_id   uuid;
begin
  if p_table not in ('pci_properties','crm_contacts','pci_property_contacts','pci_loans',
                     'pci_tenants','pci_listings','pci_distress_signals','pci_lender_programs',
                     'pci_scores','pci_daily_actions','pci_sources') then
    raise exception 'pci_apply_row: table % is not an allowed import target', p_table;
  end if;

  select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and p_data ? c.column_name;
  if v_cols is null then raise exception 'pci_apply_row: no known columns in payload for %', p_table; end if;

  if p_action = 'insert' then
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) t returning id',
      p_table, v_cols, v_cols, p_table)
    using p_data into v_id;
    return v_id;
  elsif p_action = 'update' then
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) t) where id = $2 returning id',
      p_table, v_cols, v_cols, p_table)
    using p_data, p_id into v_id;
    return v_id;
  end if;
  raise exception 'pci_apply_row: unknown action %', p_action;
end $$;

-- ── COMMIT: one transaction for the whole batch ──────────────────────────────
-- p_resolutions: { "<row uuid>": "apply" | "keep" } for rows previewed as
-- conflicts. Unresolved conflicts are skipped (status stays 'pending' →
-- marked 'skipped') and reported back; they never block the rest.
create or replace function public.pci_commit_import_batch(
  p_batch_id    uuid,
  p_admin_id    uuid,
  p_resolutions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b            record;
  r            record;
  v_table      text;
  v_action     text;
  v_id         uuid;
  v_conf_col   text;
  v_cur_conf   text;
  v_new_conf   text;
  v_res        text;
  n_ins        int := 0;
  n_upd        int := 0;
  n_skip       int := 0;
  n_fail       int := 0;
  v_err        text;
  kv           record;
begin
  select * into b from public.pci_import_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'batch not found'); end if;
  if b.status not in ('previewed','approved') then
    return jsonb_build_object('ok', false, 'error', 'batch is '||b.status||' — only a previewed/approved batch can be committed');
  end if;

  for r in
    select * from public.pci_import_rows
     where batch_id = p_batch_id
     order by case target_type            -- parents before children
        when 'source' then 0
        when 'contact' then 1
        when 'property' then 2
        when 'property_update' then 3
        when 'lender_program' then 4
        when 'property_contact' then 5
        when 'loan' then 6
        when 'tenant' then 7
        when 'listing' then 8
        when 'distress_signal' then 9
        when 'score' then 10
        when 'daily_action' then 11
        else 12 end,
       row_number
  loop
    v_res := coalesce(p_resolutions->>r.id::text, '');
    if r.proposed_action in ('unchanged','invalid') then
      update public.pci_import_rows set status='skipped' where id = r.id; n_skip := n_skip+1; continue;
    end if;
    if r.proposed_action = 'conflict' and v_res <> 'apply' then
      update public.pci_import_rows set status = case when v_res='keep' then 'resolved_keep' else 'skipped' end
       where id = r.id;
      n_skip := n_skip+1; continue;
    end if;

    v_table  := public.pci_target_table(r.target_type);
    v_action := case when r.proposed_action = 'insert' then 'insert' else 'update' end;
    if v_table is null then
      update public.pci_import_rows set status='failed',
        validation_errors = validation_errors || jsonb_build_array('unknown target_type '||r.target_type)
       where id = r.id;
      n_fail := n_fail+1; continue;
    end if;

    begin
      -- Backstop: NEVER downgrade Verified without explicit 'apply' resolution.
      if v_action = 'update' then
        v_conf_col := public.pci_conf_col(v_table);
        if v_conf_col <> '' and v_res <> 'apply' then
          execute format('select %I from public.%I where id = $1', v_conf_col, v_table)
            using r.target_record_id into v_cur_conf;
          v_new_conf := r.after_data->>v_conf_col;
          if v_cur_conf = 'Verified'
             and public.pci_confidence_rank(coalesce(v_new_conf,'Unknown')) < public.pci_confidence_rank('Verified') then
            update public.pci_import_rows set proposed_action='conflict', status='skipped',
              validation_errors = validation_errors ||
                jsonb_build_array('blocked: would downgrade Verified data — resolve the conflict explicitly')
             where id = r.id;
            n_skip := n_skip+1; continue;
          end if;
        end if;
      end if;

      v_id := public.pci_apply_row(v_table, v_action,
                coalesce(r.target_record_id, (r.after_data->>'id')::uuid), r.after_data);

      -- Change log: inserts log a single 'created' entry; updates log each
      -- genuinely changed field with before/after and confidence context.
      if v_action = 'insert' then
        insert into public.pci_change_log(entity_type, entity_id, field_name, old_value, new_value,
                                          confidence_after, batch_id, changed_by)
        values (v_table, v_id, '(created)', null, to_jsonb(r.sheet_name||' row '||r.row_number),
                r.after_data->>public.pci_conf_col(v_table), p_batch_id, p_admin_id);
        n_ins := n_ins+1;
      else
        for kv in
          select key, r.before_data->key as old_v, value as new_v
            from jsonb_each(r.after_data)
           where key not in ('id','created_at','updated_at','created_by','updated_by','owner_id')
             and (r.before_data->key) is distinct from value
        loop
          insert into public.pci_change_log(entity_type, entity_id, field_name, old_value, new_value,
                                            confidence_before, confidence_after, batch_id, changed_by)
          values (v_table, v_id, kv.key, kv.old_v, kv.new_v,
                  r.before_data->>public.pci_conf_col(v_table),
                  r.after_data->>public.pci_conf_col(v_table),
                  p_batch_id, p_admin_id);
        end loop;
        n_upd := n_upd+1;
      end if;

      update public.pci_import_rows
         set status = case when v_res='apply' then 'resolved_apply' else 'committed' end,
             target_record_id = v_id
       where id = r.id;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.pci_import_rows set status='failed',
        validation_errors = validation_errors || jsonb_build_array('commit: '||v_err)
       where id = r.id;
      n_fail := n_fail+1;
    end;
  end loop;

  update public.pci_import_batches
     set status = 'committed', committed_at = now(), approved_at = coalesce(approved_at, now()),
         summary = summary || jsonb_build_object('inserted', n_ins, 'updated', n_upd,
                                                 'skipped', n_skip, 'failed', n_fail)
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'inserted', n_ins, 'updated', n_upd,
                            'skipped', n_skip, 'failed', n_fail);
end $$;

-- ── ROLLBACK: only the most recent compatible committed batch ────────────────
create or replace function public.pci_rollback_import_batch(
  p_batch_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b        record;
  r        record;
  v_table  text;
  blockers text[] := '{}';
  n_del    int := 0;
  n_rest   int := 0;
begin
  select * into b from public.pci_import_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'batch not found'); end if;
  if b.status <> 'committed' then
    return jsonb_build_object('ok', false, 'error', 'only a committed batch can be rolled back (this one is '||b.status||')');
  end if;
  if exists (select 1 from public.pci_import_batches
              where status = 'committed' and committed_at > b.committed_at) then
    return jsonb_build_object('ok', false, 'error',
      'a newer committed batch exists — roll back newer batches first (rollback is last-in-first-out)');
  end if;

  -- Refuse when anything this batch touched was modified afterwards by
  -- something else (manual edit or another process).
  select coalesce(array_agg(distinct l.entity_type||':'||l.entity_id), '{}') into blockers
    from public.pci_change_log l
    join public.pci_import_rows ir
      on ir.batch_id = p_batch_id
     and ir.status in ('committed','resolved_apply')
     and l.entity_id = ir.target_record_id
   where l.changed_at > b.committed_at
     and coalesce(l.batch_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_batch_id;
  if array_length(blockers,1) is not null then
    return jsonb_build_object('ok', false, 'error',
      'unsafe: records were modified after this import — rollback would destroy newer work',
      'blockers', to_jsonb(blockers));
  end if;

  -- Children before parents (reverse of commit order).
  for r in
    select * from public.pci_import_rows
     where batch_id = p_batch_id and status in ('committed','resolved_apply')
     order by case target_type
        when 'daily_action' then 0 when 'score' then 1 when 'distress_signal' then 2
        when 'listing' then 3 when 'tenant' then 4 when 'loan' then 5
        when 'property_contact' then 6 when 'lender_program' then 7
        when 'property_update' then 8 when 'property' then 9
        when 'contact' then 10 when 'source' then 11 else 12 end,
       row_number desc
  loop
    v_table := public.pci_target_table(r.target_type);
    if v_table is null or r.target_record_id is null then continue; end if;
    if r.proposed_action = 'insert' then
      execute format('delete from public.%I where id = $1', v_table) using r.target_record_id;
      n_del := n_del + 1;
    else
      if r.before_data is not null then
        perform public.pci_apply_row(v_table, 'update', r.target_record_id, r.before_data);
        n_rest := n_rest + 1;
      end if;
    end if;
    insert into public.pci_change_log(entity_type, entity_id, field_name, old_value, new_value, batch_id, changed_by)
    values (v_table, r.target_record_id, '(rollback)',
            to_jsonb(r.proposed_action), to_jsonb('rolled_back'::text), p_batch_id, p_admin_id);
    update public.pci_import_rows set status='rolled_back' where id = r.id;
  end loop;

  update public.pci_import_batches
     set status='rolled_back', rolled_back_at = now(),
         summary = summary || jsonb_build_object('rolled_back_deleted', n_del, 'rolled_back_restored', n_rest)
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'deleted', n_del, 'restored', n_rest);
end $$;

-- ── Permissions: service_role ONLY (functions verify the admin JWT first) ────
revoke all on function public.pci_apply_row(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pci_commit_import_batch(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pci_rollback_import_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pci_commit_import_batch(uuid, uuid, jsonb) to service_role;
grant execute on function public.pci_rollback_import_batch(uuid, uuid) to service_role;
