-- ============================================================================
-- PEGASUS NETWORK v69 — Platform Systems Schema (002)
-- Extends 001_pegasus_membership.sql. Idempotent. Run after 001.
-- Adds: profile system, lender appetite, financing requests, match results,
-- notifications, messaging, expanded Deal Room workflow, server-side scoring.
-- ============================================================================
create extension if not exists pgcrypto;

-- ── PROFILES (ensure exists + platform extensions) ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text check (role in ('borrower','lender','broker','agent','insurance','rwa_partner','business_funding_provider','investor','developer','admin')),
  company_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists markets text[] default '{}';
alter table public.profiles add column if not exists specialties text[] default '{}';
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists website text;
alter table public.profiles add column if not exists avatar_color text;
alter table public.profiles add column if not exists verification_status text default 'unverified'
  check (verification_status in ('unverified','pending','verified','rejected'));
alter table public.profiles add column if not exists onboarding_complete boolean default false;
alter table public.profiles add column if not exists profile_completion int default 20;
alter table public.profiles enable row level security;
do $$ begin
  create policy prof_read   on public.profiles for select to authenticated using (true);
  create policy prof_self_u on public.profiles for update to authenticated using (id = auth.uid());
  create policy prof_self_i on public.profiles for insert to authenticated with check (id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── DEAL ROOM WORKFLOW: expand to 9 named states (adds Underwriting) ────────
alter table public.deal_rooms drop constraint if exists deal_rooms_stage_check;
alter table public.deal_rooms add column if not exists workflow_state text not null default 'draft';
alter table public.deal_rooms drop constraint if exists deal_rooms_wf_check;
alter table public.deal_rooms add constraint deal_rooms_wf_check
  check (workflow_state in ('draft','submitted','reviewing','matched','docs_requested','underwriting','term_sheet','funded','closed'));
-- canonical ordered states (index = stage)
create or replace function public.wf_states() returns text[] language sql immutable as
$$ select array['draft','submitted','reviewing','matched','docs_requested','underwriting','term_sheet','funded','closed'] $$;
create or replace function public.wf_stage(state text) returns int language sql immutable as
$$ select coalesce(array_position(public.wf_states(), state) - 1, 0) $$;
-- keep numeric stage synced with workflow_state
create or replace function public.sync_wf_stage() returns trigger language plpgsql as $$
begin new.stage := public.wf_stage(new.workflow_state); return new; end $$;
drop trigger if exists trg_dr_wf on public.deal_rooms;
create trigger trg_dr_wf before insert or update of workflow_state on public.deal_rooms
  for each row execute function public.sync_wf_stage();

-- ── LENDER APPETITE PROFILES ────────────────────────────────────────────────
create table if not exists public.lender_appetite_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  is_showcase boolean default false,           -- seedable, visible pre-signup
  name text not null,
  loan_types text[] not null default '{}',
  states text[] not null default '{}',          -- 'ALL' = nationwide
  asset_types text[] not null default '{}',
  min_loan numeric(14,2) default 0,
  max_loan numeric(14,2) default 0,
  max_ltv int default 0,
  dscr_min numeric(5,2) default 0,
  construction_ok boolean default false,
  bridge_ok boolean default false,
  pref_sponsor_years int default 0,
  rate_from text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.lender_appetite_profiles enable row level security;
do $$ begin
  create policy lap_read on public.lender_appetite_profiles for select to authenticated
    using (active or user_id = auth.uid());
  create policy lap_anon on public.lender_appetite_profiles for select to anon using (is_showcase);
  create policy lap_write on public.lender_appetite_profiles for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── FINANCING REQUESTS (borrower deals) ─────────────────────────────────────
create table if not exists public.financing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_room_id uuid references public.deal_rooms(id) on delete set null,
  loan_type text, amount numeric(14,2) default 0, state text, asset_type text,
  ltv int default 0, dscr numeric(5,2) default 0,
  construction_stage text, timeline text, exit_strategy text,
  sponsor_years int default 0, docs_ready int default 0,
  notes text, status text default 'open' check (status in ('open','matching','matched','closed')),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.financing_requests enable row level security;
do $$ begin
  create policy fr_owner on public.financing_requests for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── MATCH RESULTS (scored alignment of request × appetite) ──────────────────
create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.financing_requests(id) on delete cascade,
  appetite_id uuid not null references public.lender_appetite_profiles(id) on delete cascade,
  alignment int default 0, strength int default 0, funding int default 0,
  docs int default 0, risk text, fit text, flags text[] default '{}',
  created_at timestamptz default now(),
  unique(request_id, appetite_id)
);
alter table public.match_results enable row level security;
do $$ begin
  create policy mr_owner on public.match_results for select to authenticated using (
    exists (select 1 from public.financing_requests f where f.id = request_id and f.user_id = auth.uid())
    or exists (select 1 from public.lender_appetite_profiles a where a.id = appetite_id and a.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- ── NOTIFICATIONS ───────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,        -- lender_interest|match_found|deal_room_update|doc_requested|billing|admin_review|ai_recommendation|onboarding
  title text not null, body text, link text,
  deal_room_id uuid references public.deal_rooms(id) on delete cascade,
  read boolean default false,
  created_at timestamptz default now()
);
alter table public.notifications enable row level security;
do $$ begin
  create policy notif_owner on public.notifications for select to authenticated using (user_id = auth.uid());
  create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
create index if not exists idx_notif_user_unread on public.notifications(user_id) where not read;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_room uuid)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id,kind,title,body,link,deal_room_id)
  values (p_user,p_kind,p_title,p_body,p_link,p_room);
$$;
create or replace function public.unread_count(uid uuid) returns int language sql stable security definer set search_path=public as $$
  select count(*)::int from public.notifications where user_id=uid and not read $$;

-- ── MESSAGING (institutional, deal-room linked) ─────────────────────────────
create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid references public.deal_rooms(id) on delete cascade,
  subject text, created_at timestamptz default now()
);
create table if not exists public.thread_participants (
  thread_id uuid references public.message_threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (thread_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_system boolean default false,    -- system activity events vs member messages
  created_at timestamptz default now()
);
create table if not exists public.message_reads (
  message_id uuid references public.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (message_id, user_id)
);
alter table public.message_threads enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
create or replace function public.in_thread(t uuid, uid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.thread_participants where thread_id=t and user_id=uid) $$;
do $$ begin
  create policy mt_read  on public.message_threads for select to authenticated using (public.in_thread(id, auth.uid()));
  create policy tp_read  on public.thread_participants for select to authenticated using (user_id=auth.uid() or public.in_thread(thread_id,auth.uid()));
  create policy msg_read on public.messages for select to authenticated using (public.in_thread(thread_id, auth.uid()));
  create policy msg_send on public.messages for insert to authenticated with check (public.in_thread(thread_id, auth.uid()) and sender_id = auth.uid());
  create policy mrd_self on public.message_reads for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
exception when duplicate_object then null; end $$;

-- ── SERVER-SIDE MATCH SCORING (mirrors js/pegasus-match.js) ─────────────────
create or replace function public.score_match(req public.financing_requests, ap public.lender_appetite_profiles)
returns public.match_results language plpgsql immutable as $$
declare r public.match_results; pts numeric:=0; mx numeric:=0; s numeric:=0; rk int:=0; al int;
begin
  -- alignment (weighted)
  mx:=20; if ap.loan_types @> array[req.loan_type] then pts:=pts+20; end if;
  mx:=mx+14; if 'ALL'=any(ap.states) or ap.states @> array[req.state] then pts:=pts+14; end if;
  mx:=mx+14; if req.amount>=ap.min_loan and req.amount<=ap.max_loan then pts:=pts+14; end if;
  mx:=mx+12; if ap.asset_types @> array[req.asset_type] then pts:=pts+12; end if;
  mx:=mx+14; if req.ltv<=ap.max_ltv then pts:=pts+14; end if;
  mx:=mx+12; if req.dscr>=ap.dscr_min then pts:=pts+12; end if;
  mx:=mx+7;  if req.loan_type<>'Construction' or ap.construction_ok then pts:=pts+7; end if;
  mx:=mx+7;  if req.loan_type<>'Bridge' or ap.bridge_ok then pts:=pts+7; end if;
  al:=round((pts/mx)*100); r.alignment:=al;
  -- strength
  s:=least(30,greatest(0,(req.dscr-1.0)/0.6*30))
   + least(28,greatest(0,(0.85-req.ltv::numeric/100)/0.35*28))
   + least(24,(req.sponsor_years::numeric/15)*24)
   + (case when coalesce(req.exit_strategy,'Undefined')<>'Undefined' then 18 else 6 end);
  r.strength:=round(least(100,s));
  r.funding:=round(al*0.6 + r.strength*0.4);
  r.docs:=coalesce(req.docs_ready,0);
  if req.ltv>80 then rk:=rk+2; elsif req.ltv>70 then rk:=rk+1; end if;
  if req.dscr<1.15 then rk:=rk+2; elsif req.dscr<1.25 then rk:=rk+1; end if;
  if req.sponsor_years<3 then rk:=rk+1; end if;
  r.risk:=case when rk>=4 then 'Elevated' when rk>=2 then 'Moderate' else 'Low' end;
  r.fit:=case when al>=85 then 'High Alignment' when al>=70 then 'Strong Fit'
              when al>=50 then 'Conditional Fit' else 'Manual Review' end;
  return r;
end $$;

-- run a financing request against all active appetites, persist results, notify
create or replace function public.run_match(p_request uuid)
returns int language plpgsql security definer set search_path=public as $$
declare req public.financing_requests; ap public.lender_appetite_profiles; sc public.match_results; n int:=0;
begin
  select * into req from public.financing_requests where id=p_request;
  if not found then return 0; end if;
  for ap in select * from public.lender_appetite_profiles where active loop
    sc:=public.score_match(req, ap);
    insert into public.match_results(request_id,appetite_id,alignment,strength,funding,docs,risk,fit,flags)
    values (req.id, ap.id, sc.alignment, sc.strength, sc.funding, sc.docs, sc.risk, sc.fit, '{}')
    on conflict (request_id,appetite_id) do update set
      alignment=excluded.alignment, strength=excluded.strength, funding=excluded.funding,
      docs=excluded.docs, risk=excluded.risk, fit=excluded.fit;
    if sc.alignment>=70 and ap.user_id is not null then
      perform public.notify(ap.user_id,'match_found','New aligned opportunity',
        sc.fit||' · alignment '||sc.alignment, '/match-engine.html', req.deal_room_id);
    end if;
    n:=n+1;
  end loop;
  update public.financing_requests set status='matching', updated_at=now() where id=req.id;
  if req.user_id is not null then
    perform public.notify(req.user_id,'match_found','Matching complete',
      n||' lender appetites scored', '/match-engine.html', req.deal_room_id);
  end if;
  return n;
end $$;

-- notify owner when a lender expresses interest
create or replace function public.on_lender_interest() returns trigger language plpgsql security definer set search_path=public as $$
declare owner uuid;
begin
  select owner_id into owner from public.deal_rooms where id=new.deal_room_id;
  if owner is not null then
    perform public.notify(owner,'lender_interest','New lender interest',
      coalesce(new.lender_name,'A lender')||' expressed interest', '/deal-room.html?id='||new.deal_room_id, new.deal_room_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_li_notify on public.lender_interest;
create trigger trg_li_notify after insert on public.lender_interest
  for each row execute function public.on_lender_interest();

-- notify participants on deal room workflow change
create or replace function public.on_dr_state() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.workflow_state is distinct from old.workflow_state then
    insert into public.notifications(user_id,kind,title,body,link,deal_room_id)
    select p.user_id,'deal_room_update', new.name||' advanced',
      'Now in '||replace(new.workflow_state,'_',' '), '/deal-room.html?id='||new.id, new.id
    from public.deal_room_participants p where p.deal_room_id=new.id;
    insert into public.deal_room_activity(deal_room_id,actor_id,body)
    values (new.id, auth.uid(), 'Workflow advanced to '||replace(new.workflow_state,'_',' '));
  end if;
  return new;
end $$;
drop trigger if exists trg_dr_state on public.deal_rooms;
create trigger trg_dr_state after update on public.deal_rooms
  for each row execute function public.on_dr_state();

-- profile completion + onboarding helper
create or replace function public.recompute_profile_completion() returns trigger language plpgsql as $$
declare c int:=20;
begin
  if coalesce(new.full_name,'')<>'' then c:=c+15; end if;
  if coalesce(new.role,'')<>'' then c:=c+15; end if;
  if coalesce(new.headline,'')<>'' then c:=c+10; end if;
  if coalesce(new.bio,'')<>'' then c:=c+15; end if;
  if array_length(new.markets,1)>0 then c:=c+10; end if;
  if array_length(new.specialties,1)>0 then c:=c+10; end if;
  if new.verification_status='verified' then c:=c+5; end if;
  new.profile_completion:=least(100,c);
  new.onboarding_complete:=(new.profile_completion>=70);
  return new;
end $$;
drop trigger if exists trg_prof_complete on public.profiles;
create trigger trg_prof_complete before insert or update on public.profiles
  for each row execute function public.recompute_profile_completion();

-- onboarding: create profile row + welcome notification on new auth user
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,full_name,role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'role',''))
  on conflict (id) do nothing;
  perform public.notify(new.id,'onboarding','Welcome to Pegasus',
    'Complete your profile to improve match quality.', '/profile-edit.html', null);
  return new;
end $$;
drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user after insert on auth.users
  for each row execute function public.handle_new_user();
