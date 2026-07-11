-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — import pipeline (migration 073)
-- ADDITIVE + IDEMPOTENT. Requires 011 (is_admin_user), 072 (pn_ tables).
--
-- Mirrors the Capital Intelligence pipeline (069) exactly — atomic commit
-- (whole batch or nothing) and edit-aware rollback (compares live rows to the
-- committed state so manual admin edits are detected) — but over the pn_
-- tables and its OWN batch/row/change-log history. Completely separate from the
-- pci_ import history.
--
-- Tables: pn_import_batches, pn_import_rows, pn_change_log.
-- RPCs (service_role EXECUTE only): pn_commit_import_batch, pn_rollback_import_batch.
-- ============================================================================

-- ── pn_import_batches ────────────────────────────────────────────────────────
create table if not exists public.pn_import_batches(
  id                uuid primary key default gen_random_uuid(),
  filename          text,
  file_checksum     text,
  file_storage_path text,
  uploaded_by       uuid,
  status            text not null default 'previewed'
                      check (status in ('uploaded','previewed','approved','committed','rolled_back','rejected','failed')),
  summary           jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  approved_at       timestamptz,
  committed_at      timestamptz,
  rolled_back_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_pn_batches_created on public.pn_import_batches(created_at desc);
create index if not exists idx_pn_batches_checksum on public.pn_import_batches(file_checksum);

-- ── pn_import_rows ───────────────────────────────────────────────────────────
create table if not exists public.pn_import_rows(
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.pn_import_batches(id) on delete cascade,
  sheet_name        text,
  row_number        integer,
  target_type       text,
  dedupe_key        text,
  proposed_action   text check (proposed_action in ('insert','update','unchanged','conflict','invalid')),
  raw_data          jsonb,
  normalized_data   jsonb,
  before_data       jsonb,
  after_data        jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  target_record_id  uuid,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_pn_rows_batch on public.pn_import_rows(batch_id, sheet_name, row_number);
drop trigger if exists trg_pn_import_rows_touch on public.pn_import_rows;
create trigger trg_pn_import_rows_touch before update on public.pn_import_rows
  for each row execute function public.pn_touch();

-- ── pn_change_log ────────────────────────────────────────────────────────────
create table if not exists public.pn_change_log(
  id                uuid primary key default gen_random_uuid(),
  entity_type       text,
  entity_id         uuid,
  field_name        text,
  old_value         jsonb,
  new_value         jsonb,
  confidence_before text,
  confidence_after  text,
  batch_id          uuid references public.pn_import_batches(id) on delete set null,
  changed_by        uuid,
  changed_at        timestamptz not null default now()
);
create index if not exists idx_pn_log_entity on public.pn_change_log(entity_type, entity_id, changed_at desc);
create index if not exists idx_pn_log_batch  on public.pn_change_log(batch_id);

-- ── RLS: admin-only on the three import tables ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pn_import_batches','pn_import_rows','pn_change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;

-- ── Whitelisted import targets ───────────────────────────────────────────────
create or replace function public.pn_target_table(p_type text) returns text
language sql immutable as $$
  select case p_type
    when 'company'          then 'pn_companies'
    when 'agent'            then 'pn_agents'
    when 'escrow_title'     then 'pn_escrow_title'
    when 'activity_signal'  then 'pn_activity_signals'
    when 'outreach_action'  then 'pn_outreach_actions'
    when 'do_not_contact'   then 'pn_do_not_contact'
    else null end
$$;

create or replace function public.pn_conf_col(p_table text) returns text
language sql immutable as $$
  select case p_table
    when 'pn_companies'        then 'data_confidence'
    when 'pn_agents'           then 'data_confidence'
    when 'pn_escrow_title'     then 'data_confidence'
    when 'pn_activity_signals' then 'confidence'
    else '' end
$$;

-- ── Generic apply helper (insert/update from a jsonb column map) ──────────────
create or replace function public.pn_apply_row(
  p_table text, p_action text, p_id uuid, p_data jsonb
) returns uuid
language plpgsql as $$
declare v_cols text; v_id uuid;
begin
  if p_table not in ('pn_companies','pn_agents','pn_escrow_title',
                     'pn_activity_signals','pn_outreach_actions','pn_do_not_contact') then
    raise exception 'pn_apply_row: table % is not an allowed import target', p_table;
  end if;
  select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table and p_data ? c.column_name;
  if v_cols is null then raise exception 'pn_apply_row: no known columns in payload for %', p_table; end if;
  if p_action = 'insert' then
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) t returning id',
      p_table, v_cols, v_cols, p_table) using p_data into v_id;
    return v_id;
  elsif p_action = 'update' then
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) t) where id = $2 returning id',
      p_table, v_cols, v_cols, p_table) using p_data, p_id into v_id;
    return v_id;
  end if;
  raise exception 'pn_apply_row: unknown action %', p_action;
end $$;

-- ── COMMIT: ATOMIC. Whole batch applies or nothing does ──────────────────────
create or replace function public.pn_commit_import_batch(
  p_batch_id uuid, p_admin_id uuid, p_resolutions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b record; r record;
  v_table text; v_action text; v_id uuid;
  v_conf_col text; v_cur_conf text; v_new_conf text; v_res text;
  n_ins int := 0; n_upd int := 0; n_skip int := 0;
  v_err text; v_state text; kv record;
begin
  select * into b from public.pn_import_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'batch not found'); end if;
  if b.status not in ('previewed','approved') then
    return jsonb_build_object('ok', false, 'error', 'batch is '||b.status||' — only a previewed/approved batch can be committed');
  end if;

  for r in
    select * from public.pn_import_rows
     where batch_id = p_batch_id
     order by case target_type            -- parents before children
        when 'company' then 0 when 'agent' then 1 when 'escrow_title' then 2
        when 'do_not_contact' then 3 when 'activity_signal' then 4
        when 'outreach_action' then 5 else 6 end,
       row_number
  loop
    v_res := coalesce(p_resolutions->>r.id::text, '');

    if r.proposed_action in ('unchanged','invalid') then
      update public.pn_import_rows set status='skipped' where id = r.id; n_skip := n_skip+1; continue;
    end if;
    if r.proposed_action = 'conflict' and v_res <> 'apply' then
      update public.pn_import_rows set status = case when v_res='keep' then 'resolved_keep' else 'skipped' end
       where id = r.id;
      n_skip := n_skip+1; continue;
    end if;

    v_table  := public.pn_target_table(r.target_type);
    v_action := case when r.proposed_action = 'insert' then 'insert' else 'update' end;
    if v_table is null then
      raise exception 'Commit aborted — unknown target_type "%" at % row %',
        r.target_type, r.sheet_name, r.row_number;
    end if;

    -- Verified-downgrade backstop (a SKIP, before the apply block).
    if v_action = 'update' then
      v_conf_col := public.pn_conf_col(v_table);
      if v_conf_col <> '' and v_res <> 'apply' then
        execute format('select %I from public.%I where id = $1', v_conf_col, v_table)
          using r.target_record_id into v_cur_conf;
        v_new_conf := r.after_data->>v_conf_col;
        if v_cur_conf = 'Verified'
           and public.pn_confidence_rank(coalesce(v_new_conf,'Unknown')) < public.pn_confidence_rank('Verified') then
          update public.pn_import_rows set proposed_action='conflict', status='skipped',
            validation_errors = validation_errors ||
              jsonb_build_array('blocked: would downgrade Verified data — resolve the conflict explicitly')
           where id = r.id;
          n_skip := n_skip+1; continue;
        end if;
      end if;
    end if;

    begin
      v_id := public.pn_apply_row(v_table, v_action,
                coalesce(r.target_record_id, (r.after_data->>'id')::uuid), r.after_data);
      if v_action = 'insert' then
        insert into public.pn_change_log(entity_type, entity_id, field_name, old_value, new_value,
                                         confidence_after, batch_id, changed_by)
        values (v_table, v_id, '(created)', null, to_jsonb(r.sheet_name||' row '||r.row_number),
                r.after_data->>public.pn_conf_col(v_table), p_batch_id, p_admin_id);
        n_ins := n_ins+1;
      else
        for kv in
          select key, r.before_data->key as old_v, value as new_v
            from jsonb_each(r.after_data)
           where key not in ('id','created_at','updated_at','created_by','updated_by','owner_id')
             and (r.before_data->key) is distinct from value
        loop
          insert into public.pn_change_log(entity_type, entity_id, field_name, old_value, new_value,
                                           confidence_before, confidence_after, batch_id, changed_by)
          values (v_table, v_id, kv.key, kv.old_v, kv.new_v,
                  r.before_data->>public.pn_conf_col(v_table),
                  r.after_data->>public.pn_conf_col(v_table), p_batch_id, p_admin_id);
        end loop;
        n_upd := n_upd+1;
      end if;
      update public.pn_import_rows
         set status = case when v_res='apply' then 'resolved_apply' else 'committed' end,
             target_record_id = v_id
       where id = r.id;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      raise exception 'Commit aborted at % row % (%): % [%]',
        r.sheet_name, r.row_number, r.target_type, v_err, v_state using errcode = 'P0001';
    end;
  end loop;

  update public.pn_import_batches
     set status = 'committed', committed_at = now(), approved_at = coalesce(approved_at, now()),
         summary = summary || jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'failed', 0)
   where id = p_batch_id;
  return jsonb_build_object('ok', true, 'inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'failed', 0);
end $$;

-- ── ROLLBACK: last committed batch only; edit-aware (two passes) ──────────────
create or replace function public.pn_rollback_import_batch(
  p_batch_id uuid, p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b record; r record;
  v_table text; v_live jsonb; v_diff text[]; v_restore jsonb;
  blockers jsonb := '[]'::jsonb;
  ignore text[] := array['id','created_at','updated_at','created_by','updated_by',
                         'owner_id','last_verified_at','completed_at'];
  n_del int := 0; n_rest int := 0;
begin
  select * into b from public.pn_import_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'batch not found'); end if;
  if b.status <> 'committed' then
    return jsonb_build_object('ok', false, 'error', 'only a committed batch can be rolled back (this one is '||b.status||')');
  end if;
  if exists (select 1 from public.pn_import_batches
              where status = 'committed' and committed_at > b.committed_at) then
    return jsonb_build_object('ok', false, 'error',
      'a newer committed batch exists — roll back newer batches first (rollback is last-in-first-out)');
  end if;

  -- PASS 1: detect blockers, mutate nothing.
  for r in
    select * from public.pn_import_rows
     where batch_id = p_batch_id and status in ('committed','resolved_apply')
  loop
    v_table := public.pn_target_table(r.target_type);
    if v_table is null or r.target_record_id is null then continue; end if;
    execute format('select to_jsonb(t) from public.%I t where id = $1', v_table)
      using r.target_record_id into v_live;
    if v_live is null then
      blockers := blockers || jsonb_build_object(
        'table', v_table, 'id', r.target_record_id, 'reason', 'record missing (deleted after import)',
        'sheet', r.sheet_name, 'row', r.row_number);
      continue;
    end if;
    select coalesce(array_agg(k.key), '{}')
      into v_diff
      from jsonb_each(coalesce(r.after_data,'{}'::jsonb)) k
     where not (k.key = any(ignore)) and (v_live->k.key) is distinct from k.value;
    if array_length(v_diff,1) is not null then
      blockers := blockers || jsonb_build_object(
        'table', v_table, 'id', r.target_record_id,
        'changed_fields', to_jsonb(v_diff), 'sheet', r.sheet_name, 'row', r.row_number,
        'action', r.proposed_action);
    end if;
  end loop;

  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false,
      'error', 'unsafe: records were modified after this import — rollback would destroy newer work',
      'blockers', blockers);
  end if;

  -- PASS 2: revert (children before parents).
  for r in
    select * from public.pn_import_rows
     where batch_id = p_batch_id and status in ('committed','resolved_apply')
     order by case target_type
        when 'outreach_action' then 0 when 'activity_signal' then 1 when 'do_not_contact' then 2
        when 'escrow_title' then 3 when 'agent' then 4 when 'company' then 5 else 6 end,
       row_number desc
  loop
    v_table := public.pn_target_table(r.target_type);
    if v_table is null or r.target_record_id is null then continue; end if;
    if r.proposed_action = 'insert' then
      execute format('delete from public.%I where id = $1', v_table) using r.target_record_id;
      n_del := n_del + 1;
    else
      select jsonb_object_agg(k.key, r.before_data->k.key)
        into v_restore
        from jsonb_each(coalesce(r.after_data,'{}'::jsonb)) k
       where not (k.key = any(ignore)) and r.before_data ? k.key;
      if v_restore is not null and v_restore <> '{}'::jsonb then
        perform public.pn_apply_row(v_table, 'update', r.target_record_id, v_restore);
        n_rest := n_rest + 1;
      end if;
    end if;
    insert into public.pn_change_log(entity_type, entity_id, field_name, old_value, new_value, batch_id, changed_by)
    values (v_table, r.target_record_id, '(rollback)',
            to_jsonb(r.proposed_action), to_jsonb('rolled_back'::text), p_batch_id, p_admin_id);
    update public.pn_import_rows set status='rolled_back' where id = r.id;
  end loop;

  update public.pn_import_batches
     set status='rolled_back', rolled_back_at = now(),
         summary = summary || jsonb_build_object('deleted', n_del, 'restored', n_rest)
   where id = p_batch_id;
  return jsonb_build_object('ok', true, 'deleted', n_del, 'restored', n_rest);
end $$;

-- ── Grants: the two write RPCs are service_role-EXECUTE only ──────────────────
revoke all on function public.pn_apply_row(text, text, uuid, jsonb)        from public, anon, authenticated;
revoke all on function public.pn_commit_import_batch(uuid, uuid, jsonb)     from public, anon, authenticated;
revoke all on function public.pn_rollback_import_batch(uuid, uuid)          from public, anon, authenticated;
grant  execute on function public.pn_commit_import_batch(uuid, uuid, jsonb) to service_role;
grant  execute on function public.pn_rollback_import_batch(uuid, uuid)      to service_role;
