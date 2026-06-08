-- ============================================================================
-- 025 — Living Request Engine (Seeker → Client)
-- A guest or member states a need; the request opens role SLOTS; aligned members
-- claim slots and a team assembles; a heartbeat (events) tracks movement; stale
-- requests escalate. Pegasus facilitates connections; it is not a party to any deal.
-- ============================================================================

create table if not exists public.requests(
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid(),
  type text not null check (type in ('property','business','rwa','other')),
  location text, amount_min numeric, amount_max numeric,
  timeline text, note text,
  contact_name text, contact_email text, contact_phone text,
  seeker_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new','routed','active','connected','closed','dismissed')),
  created_at timestamptz default now(),
  last_activity_at timestamptz default now()
);
create index if not exists idx_requests_status on public.requests(status);
create index if not exists idx_requests_seeker on public.requests(seeker_id);
create index if not exists idx_requests_token on public.requests(public_token);

create table if not exists public.request_slots(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  role text not null,
  status text not null default 'open' check (status in ('open','claimed','engaged','closed')),
  filled_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_slots_request on public.request_slots(request_id);
create index if not exists idx_slots_role on public.request_slots(role,status);
create index if not exists idx_slots_filled on public.request_slots(filled_by);

create table if not exists public.request_events(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  kind text not null,
  actor uuid, detail text,
  created_at timestamptz default now()
);
create index if not exists idx_events_request on public.request_events(request_id, created_at);

alter table public.requests enable row level security;
alter table public.request_slots enable row level security;
alter table public.request_events enable row level security;

drop policy if exists req_sel on public.requests;
create policy req_sel on public.requests for select using (seeker_id = auth.uid() or public.is_admin_user());
drop policy if exists slot_sel on public.request_slots;
create policy slot_sel on public.request_slots for select using (
  public.is_admin_user() or filled_by = auth.uid()
  or exists (select 1 from public.requests r where r.id = request_id and r.seeker_id = auth.uid()));
drop policy if exists ev_sel on public.request_events;
create policy ev_sel on public.request_events for select using (
  public.is_admin_user()
  or exists (select 1 from public.requests r where r.id = request_events.request_id and r.seeker_id = auth.uid())
  or exists (select 1 from public.request_slots s where s.request_id = request_events.request_id and s.filled_by = auth.uid()));
-- all writes flow through SECURITY DEFINER functions below

-- which member roles a request type assembles
create or replace function public.request_roles(p_type text)
returns text[] language sql immutable as $$
  select case p_type
    when 'property' then array['agent','lender','insurance']
    when 'business' then array['lender','business_funding_provider']
    when 'rwa'      then array['rwa_partner','lender']
    else array['lender'] end;
$$;

-- internal heartbeat writer
create or replace function public._req_event(p_request uuid, p_kind text, p_actor uuid, p_detail text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.request_events(request_id,kind,actor,detail) values (p_request,p_kind,p_actor,p_detail);
  update public.requests set last_activity_at=now() where id=p_request;
end $$;

-- Seeker (guest or member) creates a request → opens slots → routes
create or replace function public.create_request(
  p_type text, p_location text default null, p_amount_min numeric default null,
  p_amount_max numeric default null, p_timeline text default null, p_note text default null,
  p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rid uuid; tok uuid; roles text[]; rl text; m record; n int:=0;
begin
  if p_type is null or p_type not in ('property','business','rwa','other') then raise exception 'Invalid request type'; end if;
  insert into public.requests(type,location,amount_min,amount_max,timeline,note,contact_name,contact_email,contact_phone,seeker_id,status)
    values (p_type,p_location,p_amount_min,p_amount_max,p_timeline,p_note,p_contact_name,p_contact_email,p_contact_phone,auth.uid(),'new')
    returning id, public_token into rid, tok;
  roles := public.request_roles(p_type);
  foreach rl in array roles loop
    insert into public.request_slots(request_id,role) values (rid,rl);
  end loop;
  update public.requests set status='routed' where id=rid;
  perform public._req_event(rid,'routed',auth.uid(),array_to_string(roles,', '));
  -- notify aligned members (reviewed-first), capped
  for m in (
    select p.id from public.profiles p
    where p.role = any(roles)
    order by coalesce(p.reviewed_by_pegasus,false) desc, coalesce(p.profile_completion,0) desc
    limit 25
  ) loop
    begin perform public.create_notification(m.id,'request','A new request matches your role',
      'A '||p_type||' request is open in the network.', '/network-requests.html'); exception when others then null; end;
    n := n+1;
  end loop;
  return jsonb_build_object('ok',true,'request_id',rid,'public_token',tok,'status','routed','notified',n);
end $$;
grant execute on function public.create_request(text,text,numeric,numeric,text,text,text,text,text) to anon, authenticated;

-- Member claims an open slot matching their role (one member per slot; first qualified wins)
create or replace function public.claim_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); s record; myrole text; seeker uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into s from public.request_slots where id=p_slot_id for update;
  if not found then raise exception 'Slot not found'; end if;
  if s.status <> 'open' then raise exception 'This slot has already been taken'; end if;
  select role into myrole from public.profiles where id=uid;
  if not (public.is_admin_user() or myrole = s.role) then raise exception 'Your role cannot claim this slot'; end if;
  update public.request_slots set status='claimed', filled_by=uid, claimed_at=now() where id=p_slot_id;
  update public.requests set status = case when status in ('new','routed') then 'active' else status end where id=s.request_id;
  perform public._req_event(s.request_id,'claimed',uid,s.role);
  select seeker_id into seeker from public.requests where id=s.request_id;
  if seeker is not null then
    begin perform public.create_notification(seeker,'request','A professional joined your request',
      'A '||s.role||' is now engaged with your request.', '/my-requests.html'); exception when others then null; end;
  end if;
  return jsonb_build_object('ok',true,'request_id',s.request_id,'role',s.role);
end $$;
grant execute on function public.claim_slot(uuid) to authenticated;

-- Claimer marks active engagement; when all slots engaged, request is connected
create or replace function public.engage_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); s record; openc int; seeker uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into s from public.request_slots where id=p_slot_id;
  if not found then raise exception 'Slot not found'; end if;
  if not (public.is_admin_user() or s.filled_by = uid) then raise exception 'Only the assigned member can update this slot'; end if;
  update public.request_slots set status='engaged' where id=p_slot_id;
  perform public._req_event(s.request_id,'engaged',uid,s.role);
  select count(*) into openc from public.request_slots where request_id=s.request_id and status not in ('engaged','closed');
  if openc = 0 then
    update public.requests set status='connected' where id=s.request_id;
    perform public._req_event(s.request_id,'connected',uid,null);
    select seeker_id into seeker from public.requests where id=s.request_id;
    if seeker is not null then begin perform public.create_notification(seeker,'request','Your request is connected',
      'Your team is in place inside Pegasus.', '/my-requests.html'); exception when others then null; end; end if;
  end if;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.engage_slot(uuid) to authenticated;

-- Seeker: my requests (full)
create or replace function public.get_my_requests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into res from (
    select r.id,r.type,r.location,r.amount_min,r.amount_max,r.timeline,r.note,r.status,r.created_at,
      (select coalesce(jsonb_agg(jsonb_build_object('role',sl.role,'status',sl.status) order by sl.created_at),'[]'::jsonb)
       from public.request_slots sl where sl.request_id=r.id) as slots
    from public.requests r where r.seeker_id=uid order by r.created_at desc
  ) x;
  return res;
end $$;
grant execute on function public.get_my_requests() to authenticated;

-- Guest/seeker: follow a request live by its token (NO third-party PII)
create or replace function public.request_status_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; tl jsonb; sl jsonb;
begin
  select * into r from public.requests where public_token=p_token;
  if not found then return jsonb_build_object('found',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'at',e.created_at) order by e.created_at),'[]'::jsonb)
    into tl from public.request_events e where e.request_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('role',s.role,'status',s.status) order by s.created_at),'[]'::jsonb)
    into sl from public.request_slots s where s.request_id=r.id;
  return jsonb_build_object('found',true,'status',r.status,'type',r.type,'location',r.location,
    'timeline',tl,'slots',sl,'created_at',r.created_at);
end $$;
grant execute on function public.request_status_by_token(uuid) to anon, authenticated;

-- Network: open requests matching the member's role (contact masked until claimed)
create or replace function public.network_open_requests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); myrole text; res jsonb;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select role into myrole from public.profiles where id=uid;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into res from (
    select r.id,r.type,r.location,r.amount_min,r.amount_max,r.timeline,r.note,r.status,r.created_at,
      split_part(coalesce(r.contact_name,''),' ',1) as contact_first,
      (select s.id from public.request_slots s where s.request_id=r.id and s.status='open'
        and (public.is_admin_user() or s.role=myrole) order by s.created_at limit 1) as open_slot_id,
      (select s.role from public.request_slots s where s.request_id=r.id and s.status='open'
        and (public.is_admin_user() or s.role=myrole) order by s.created_at limit 1) as open_slot_role
    from public.requests r
    where r.status in ('routed','active')
      and exists (select 1 from public.request_slots s where s.request_id=r.id and s.status='open'
                  and (public.is_admin_user() or s.role=myrole))
    order by r.last_activity_at desc
  ) x;
  return res;
end $$;
grant execute on function public.network_open_requests() to authenticated;

-- A member's claimed/engaged requests (FULL contact — earned by claiming)
create or replace function public.my_claimed_requests()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into res from (
    select distinct r.id,r.type,r.location,r.amount_min,r.amount_max,r.timeline,r.note,r.status,
      r.contact_name,r.contact_email,r.contact_phone,r.created_at,
      s.id as slot_id, s.role as my_role, s.status as my_slot_status
    from public.request_slots s join public.requests r on r.id=s.request_id
    where s.filled_by=uid order by r.created_at desc
  ) x;
  return res;
end $$;
grant execute on function public.my_claimed_requests() to authenticated;

-- Timeline for owner / admin / a member on the request
create or replace function public.request_timeline(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); ok boolean; res jsonb;
begin
  select (public.is_admin_user()
    or exists(select 1 from public.requests r where r.id=p_request_id and r.seeker_id=uid)
    or exists(select 1 from public.request_slots s where s.request_id=p_request_id and s.filled_by=uid)) into ok;
  if not ok then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'actor',e.actor,'at',e.created_at) order by e.created_at),'[]'::jsonb)
    into res from public.request_events e where e.request_id=p_request_id;
  return res;
end $$;
grant execute on function public.request_timeline(uuid) to authenticated;

-- Self-running pulse: escalate requests that have gone quiet with open slots
create or replace function public.escalate_stale_requests(p_hours int default 24)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; cnt int := 0; a record;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
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
grant execute on function public.escalate_stale_requests(int) to authenticated;
