-- ============================================================================
-- 022 — Automated data-integrity health check (scales with the member base)
-- Catches problems like unresolvable profile links, slug collisions, orphaned
-- records, and owner-less deal rooms — BEFORE members run into them.
-- Runs server-side (no browser needed) and notifies admins in-app if anything
-- is wrong. Pair with the weekly pg_cron schedule in schedule_health.sql.
-- ============================================================================

-- Core compute (definer; returns counts + small id samples, no extra PII)
create or replace function public._pegasus_health_compute()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  issues jsonb := '[]'::jsonb;
  v_missing_name int; v_missing_role int; v_no_slug int; v_dup_slug int;
  v_orphan_sc int := 0; v_orphan_ct int := 0; v_orphan_dl int := 0; v_dr_noowner int := 0;
  crit int := 0; warn int := 0; info int := 0;
  add_issue text;
begin
  select count(*) into v_missing_name from public.profiles where coalesce(btrim(full_name),'')='';
  select count(*) into v_missing_role from public.profiles where role is null;
  select count(*) into v_no_slug      from public.profiles where coalesce(btrim(profile_slug),'')='';
  select count(*) into v_dup_slug from (
    select profile_slug from public.profiles
    where coalesce(btrim(profile_slug),'')<>'' group by profile_slug having count(*)>1
  ) d;

  -- orphans (owner no longer exists)
  begin select count(*) into v_orphan_sc from public.showcase_items s
        where not exists (select 1 from auth.users u where u.id=s.owner_id); exception when undefined_table then v_orphan_sc:=0; end;
  begin select count(*) into v_orphan_ct from public.crm_contacts c
        where not exists (select 1 from auth.users u where u.id=c.owner_id); exception when undefined_table then v_orphan_ct:=0; end;
  begin select count(*) into v_orphan_dl from public.crm_deals d
        where not exists (select 1 from auth.users u where u.id=d.owner_id); exception when undefined_table then v_orphan_dl:=0; end;
  begin select count(*) into v_dr_noowner from public.deal_rooms where owner_id is null; exception when undefined_column then v_dr_noowner:=0; when undefined_table then v_dr_noowner:=0; end;

  if v_missing_name>0 then issues := issues || jsonb_build_object('check','profiles_missing_name','severity','warning','count',v_missing_name,'detail','Profiles with no display name (render as a placeholder)'); warn:=warn+1; end if;
  if v_missing_role>0 then issues := issues || jsonb_build_object('check','profiles_missing_role','severity','warning','count',v_missing_role,'detail','Profiles with no role set'); warn:=warn+1; end if;
  if v_dup_slug>0 then issues := issues || jsonb_build_object('check','duplicate_slugs','severity','critical','count',v_dup_slug,'detail','Slugs shared by more than one profile — /u/<slug> would be ambiguous'); crit:=crit+1; end if;
  if v_no_slug>0 then issues := issues || jsonb_build_object('check','profiles_missing_slug','severity','info','count',v_no_slug,'detail','No pretty slug; links fall back to ?id (still works)'); info:=info+1; end if;
  if v_orphan_sc>0 then issues := issues || jsonb_build_object('check','orphan_showcase','severity','warning','count',v_orphan_sc,'detail','Showcase items whose owner no longer exists'); warn:=warn+1; end if;
  if v_orphan_ct>0 then issues := issues || jsonb_build_object('check','orphan_crm_contacts','severity','warning','count',v_orphan_ct,'detail','CRM contacts whose owner no longer exists'); warn:=warn+1; end if;
  if v_orphan_dl>0 then issues := issues || jsonb_build_object('check','orphan_crm_deals','severity','warning','count',v_orphan_dl,'detail','CRM deals whose owner no longer exists'); warn:=warn+1; end if;
  if v_dr_noowner>0 then issues := issues || jsonb_build_object('check','deal_rooms_missing_owner','severity','critical','count',v_dr_noowner,'detail','Deal rooms with no owner_id'); crit:=crit+1; end if;

  return jsonb_build_object(
    'generated_at', now(),
    'status', case when crit>0 then 'critical' when warn>0 then 'degraded' else 'healthy' end,
    'critical', crit, 'warning', warn, 'info', info,
    'profiles_total', (select count(*) from public.profiles),
    'issues', issues
  );
end $$;

-- Admin-facing RPC (guarded)
create or replace function public.pegasus_health_check()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  return public._pegasus_health_compute();
end $$;
grant execute on function public.pegasus_health_check() to authenticated;

-- Scheduled sweep: compute + notify every admin in-app if not healthy.
-- (No email needed — surfaces in the admin notification bell.)
create or replace function public.pegasus_health_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare rep jsonb; a record; body text;
begin
  rep := public._pegasus_health_compute();
  if (rep->>'status') <> 'healthy' then
    body := (rep->>'critical')||' critical, '||(rep->>'warning')||' warning. Open the Admin console to review.';
    for a in select id from public.profiles where is_admin = true or role = 'admin' loop
      perform public.create_notification(a.id, 'health',
        'Health check: '||upper(rep->>'status'), body, '/admin.html');
    end loop;
  end if;
  -- store a report row if the table exists
  begin
    insert into public.health_reports(created_by, status, score, critical_count, warning_count, info_count, report_json, summary)
    values (null,
      case when (rep->>'status')='healthy' then 'healthy' when (rep->>'status')='critical' then 'critical' else 'degraded' end,
      greatest(0, 100 - (rep->>'critical')::int*30 - (rep->>'warning')::int*8),
      (rep->>'critical')::int, (rep->>'warning')::int, (rep->>'info')::int, rep, 'Automated weekly sweep');
  exception when undefined_table then null; end;
  return rep;
end $$;
