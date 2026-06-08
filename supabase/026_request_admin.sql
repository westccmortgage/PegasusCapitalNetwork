-- ============================================================================
-- 026 — Request engine: admin console surface + cron-safe escalation
-- Adds admin-only triage reads/actions and a non-gated internal escalation core
-- that pg_cron can call. Pegasus facilitates introductions; not a party to deals.
-- ============================================================================

-- internal escalation core (no auth gate; restricted grants below)
create or replace function public._escalate_stale(p_hours int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; cnt int := 0; a record;
begin
  for r in (
    select rq.id from public.requests rq
    where rq.status in ('new','routed','active')
      and rq.last_activity_at < now() - make_interval(hours => p_hours)
      and exists (select 1 from public.request_slots s where s.request_id=rq.id and s.status='open')
      and not exists (select 1 from public.request_events e where e.request_id=rq.id and e.kind='escalated'
                      and e.created_at > now() - make_interval(hours => p_hours))
  ) loop
    insert into public.request_events(request_id,kind,actor,detail) values (r.id,'escalated',null,'stale — re-routed to admin');
    cnt := cnt + 1;
    for a in (select id from public.profiles where coalesce(is_admin,false)=true) loop
      begin perform public.create_notification(a.id,'request','Request needs attention',
        'A request has open roles and has gone quiet.', '/admin-requests.html'); exception when others then null; end;
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'escalated',cnt);
end $$;
revoke all on function public._escalate_stale(int) from public;

-- admin manual sweep (gated)
create or replace function public.escalate_stale_requests(p_hours int default 24)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  return public._escalate_stale(p_hours);
end $$;
grant execute on function public.escalate_stale_requests(int) to authenticated;

-- cron-callable sweep (no gate; restricted to backend roles)
create or replace function public.cron_escalate_stale_requests(p_hours int default 24)
returns jsonb language plpgsql security definer set search_path=public as $$
begin return public._escalate_stale(p_hours); end $$;
revoke all on function public.cron_escalate_stale_requests(int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='postgres') then grant execute on function public.cron_escalate_stale_requests(int) to postgres; end if;
  if exists (select 1 from pg_roles where rolname='service_role') then grant execute on function public.cron_escalate_stale_requests(int) to service_role; end if;
end $$;

-- counts by lifecycle bucket (admin)
create or replace function public.admin_request_counts()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  return (select jsonb_build_object(
    'all',     count(*),
    'forming', count(*) filter (where status in ('new','routed','active')),
    'connected', count(*) filter (where status='connected'),
    'closed',  count(*) filter (where status in ('closed','dismissed')),
    'stuck',   count(*) filter (where status in ('new','routed','active')
                 and last_activity_at < now() - interval '24 hours'
                 and exists (select 1 from public.request_slots s where s.request_id=requests.id and s.status='open'))
  ) from public.requests);
end $$;
grant execute on function public.admin_request_counts() to authenticated;

-- list requests with full detail + slot summary (admin)
create or replace function public.admin_list_requests(p_status text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into res from (
    select r.id,r.type,r.location,r.amount_min,r.amount_max,r.timeline,r.note,r.status,
      r.contact_name,r.contact_email,r.contact_phone,r.created_at,r.last_activity_at,
      round(extract(epoch from (now()-r.last_activity_at))/3600.0)::int as idle_hours,
      (exists(select 1 from public.request_slots s where s.request_id=r.id and s.status='open')
        and r.status in ('new','routed','active')
        and r.last_activity_at < now()-interval '24 hours') as stuck,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'slot_id',s.id,'role',s.role,'status',s.status,
          'filled_name',(select coalesce(nullif(p.full_name,''),p.company_name) from public.profiles p where p.id=s.filled_by)
        ) order by s.created_at),'[]'::jsonb)
       from public.request_slots s where s.request_id=r.id) as slots
    from public.requests r
    where (p_status is null
        or (p_status='forming' and r.status in ('new','routed','active'))
        or (p_status='connected' and r.status='connected')
        or (p_status='closed' and r.status in ('closed','dismissed'))
        or (p_status='stuck' and r.status in ('new','routed','active')
            and r.last_activity_at < now()-interval '24 hours'
            and exists(select 1 from public.request_slots s2 where s2.request_id=r.id and s2.status='open')))
    order by r.last_activity_at desc
  ) x;
  return res;
end $$;
grant execute on function public.admin_list_requests(text) to authenticated;

-- full detail incl. timeline (admin)
create or replace function public.admin_request_detail(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; tl jsonb; sl jsonb;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  select * into r from public.requests where id=p_request_id;
  if not found then return jsonb_build_object('found',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'at',e.created_at,
     'actor',(select coalesce(nullif(p.full_name,''),p.company_name) from public.profiles p where p.id=e.actor)) order by e.created_at),'[]'::jsonb)
    into tl from public.request_events e where e.request_id=p_request_id;
  select coalesce(jsonb_agg(jsonb_build_object('role',s.role,'status',s.status,'claimed_at',s.claimed_at,
     'filled_name',(select coalesce(nullif(p.full_name,''),p.company_name) from public.profiles p where p.id=s.filled_by)) order by s.created_at),'[]'::jsonb)
    into sl from public.request_slots s where s.request_id=p_request_id;
  return jsonb_build_object('found',true,'id',r.id,'type',r.type,'location',r.location,'amount_min',r.amount_min,
    'amount_max',r.amount_max,'timeline',r.timeline,'note',r.note,'status',r.status,'contact_name',r.contact_name,
    'contact_email',r.contact_email,'contact_phone',r.contact_phone,'created_at',r.created_at,'slots',sl,'timeline_events',tl);
end $$;
grant execute on function public.admin_request_detail(uuid) to authenticated;

-- manual escalate one request (admin)
create or replace function public.admin_escalate_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  perform public._req_event(p_request_id,'escalated',auth.uid(),'manually escalated by admin');
  for a in (select id from public.profiles where coalesce(is_admin,false)=true) loop
    begin perform public.create_notification(a.id,'request','Request escalated',
      'A request was escalated for attention.', '/admin-requests.html'); exception when others then null; end;
  end loop;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.admin_escalate_request(uuid) to authenticated;

-- close a request (status change, not deletion) (admin)
create or replace function public.admin_close_request(p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  update public.requests set status='closed' where id=p_request_id;
  perform public._req_event(p_request_id,'closed',auth.uid(),coalesce(p_reason,'closed by admin'));
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.admin_close_request(uuid,text) to authenticated;
