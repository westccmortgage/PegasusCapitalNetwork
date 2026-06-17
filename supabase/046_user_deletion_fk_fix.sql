-- ============================================================================
-- PEGASUS Migration 046 — make admin user-deletion work (FK delete rules)
--
-- PROBLEM: deleting a user from Supabase Auth fails with
-- "Database error deleting user." Several foreign keys that (directly or
-- transitively) reference the user being removed use the default
-- ON DELETE NO ACTION rule, so Postgres refuses to delete the parent row.
--
-- FIX (per product decision):
--   • messages.sender_id / messages.receiver_id   -> ON DELETE SET NULL
--       (keep the conversation; the removed user just shows as "no sender")
--   • badge_proof_submissions.user_id             -> ON DELETE CASCADE
--   • rwa_partner_profiles.user_id                -> ON DELETE CASCADE
--   • rwa_project_intakes.submitter_id            -> ON DELETE CASCADE
--   • profiles.id (defensive)                     -> ON DELETE CASCADE
--
-- IDEMPOTENT and SCHEMA-TOLERANT: every change is guarded by existence checks,
-- so this runs safely even though some of these tables were created out-of-band
-- and are not defined in earlier committed migrations. Constraints that don't
-- exist are skipped with a NOTICE rather than erroring.
--
-- NOTE: after running, if any RPC starts 404-ing, restart the project
-- (Settings -> General -> Restart) — PostgREST's cache reload is unreliable.
-- ============================================================================

-- Helper: re-point one FK constraint to a new ON DELETE rule, preserving its
-- existing column(s) and referenced table. No-op if the constraint is absent.
create or replace function pg_temp.repoint_fk(p_conname text, p_rule text)
returns void language plpgsql as $$
declare
  v_rel regclass;
  v_def text;
begin
  select conrelid::regclass, pg_get_constraintdef(oid)
    into v_rel, v_def
  from pg_constraint
  where conname = p_conname and contype = 'f'
  limit 1;

  if v_rel is null then
    raise notice 'skip % — constraint not found', p_conname;
    return;
  end if;

  -- strip any existing ON DELETE clause, then append the desired rule
  v_def := regexp_replace(
    v_def, '\s+ON DELETE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'i');

  execute format('alter table %s drop constraint %I', v_rel, p_conname);
  execute format('alter table %s add constraint %I %s ON DELETE %s',
                 v_rel, p_conname, v_def, p_rule);
  raise notice 'repointed % -> ON DELETE %', p_conname, p_rule;
end $$;

-- messages.sender_id / receiver_id must be NULLABLE for SET NULL to fire.
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='messages') then
    begin alter table public.messages alter column sender_id   drop not null; exception when others then null; end;
    begin alter table public.messages alter column receiver_id drop not null; exception when others then null; end;
  end if;
end $$;

-- Re-point each blocking FK to the desired delete rule.
select pg_temp.repoint_fk('messages_sender_id_fkey',             'SET NULL');
select pg_temp.repoint_fk('messages_receiver_id_fkey',           'SET NULL');
select pg_temp.repoint_fk('badge_proof_submissions_user_id_fkey','CASCADE');
select pg_temp.repoint_fk('rwa_partner_profiles_user_id_fkey',   'CASCADE');
select pg_temp.repoint_fk('rwa_project_intakes_submitter_id_fkey','CASCADE');
-- Defensive: ensure the profile row itself cascades when the auth user is removed.
select pg_temp.repoint_fk('profiles_id_fkey',                    'CASCADE');

-- Reload the PostgREST schema cache.
notify pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────────────
-- confdeltype: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT
-- Expect: messages_* => n, the others => c.
select conname,
       conrelid::regclass as on_table,
       confdeltype        as on_delete_code
from pg_constraint
where conname in (
  'messages_sender_id_fkey','messages_receiver_id_fkey',
  'badge_proof_submissions_user_id_fkey','rwa_partner_profiles_user_id_fkey',
  'rwa_project_intakes_submitter_id_fkey','profiles_id_fkey'
)
order by conname;
