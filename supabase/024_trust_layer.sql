-- ============================================================================
-- 024 — Reviewed by Pegasus: curated professional trust & visibility layer
-- Levels: Verified Identity → Reviewed by Pegasus → Institutional Visibility.
-- Payment grants eligibility, NOT approval. Review is a human admin decision.
-- ============================================================================
alter table public.profiles add column if not exists verified_identity boolean default false;
alter table public.profiles add column if not exists reviewed_by_pegasus boolean default false;
alter table public.profiles add column if not exists reviewed_at timestamptz;
alter table public.profiles add column if not exists reviewed_by uuid;
alter table public.profiles add column if not exists institutional_visibility boolean default false;
alter table public.profiles add column if not exists review_status text default 'none';
alter table public.profiles add column if not exists review_notes text;

create table if not exists public.trust_reviews(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','denied','more_info','revoked','withdrawn')),
  application jsonb not null default '{}'::jsonb,
  admin_notes text,
  submitted_at timestamptz default now(),
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz default now()
);
create index if not exists idx_trust_reviews_user on public.trust_reviews(user_id);
create index if not exists idx_trust_reviews_status on public.trust_reviews(status);

alter table public.trust_reviews enable row level security;
drop policy if exists tr_sel on public.trust_reviews;
create policy tr_sel on public.trust_reviews for select using (user_id = auth.uid() or public.is_admin_user());
drop policy if exists tr_ins on public.trust_reviews;
create policy tr_ins on public.trust_reviews for insert with check (user_id = auth.uid());
drop policy if exists tr_upd on public.trust_reviews;
create policy tr_upd on public.trust_reviews for update using (public.is_admin_user());

-- Eligibility is advisory (Gold tier). Never auto-approves.
create or replace function public.is_review_eligible(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_tier(uid) = 'gold', false);
$$;
grant execute on function public.is_review_eligible(uuid) to authenticated;

-- Member applies (creates/refreshes an open review)
create or replace function public.apply_for_review(app jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); rid uuid; ex record;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into ex from public.trust_reviews where user_id=uid and status in ('pending','more_info') order by created_at desc limit 1;
  if found then
    update public.trust_reviews set application=coalesce(app,'{}'::jsonb), status='pending', submitted_at=now() where id=ex.id returning id into rid;
  else
    insert into public.trust_reviews(user_id,application,status) values (uid,coalesce(app,'{}'::jsonb),'pending') returning id into rid;
  end if;
  update public.profiles set review_status='pending' where id=uid;
  return jsonb_build_object('ok',true,'review_id',rid,'status','pending');
end $$;
grant execute on function public.apply_for_review(jsonb) to authenticated;

create or replace function public.get_my_review()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); r record;
begin
  if uid is null then return null; end if;
  select status, submitted_at, decided_at, admin_notes into r from public.trust_reviews where user_id=uid order by created_at desc limit 1;
  if not found then return jsonb_build_object('status','none'); end if;
  return jsonb_build_object('status',r.status,'submitted_at',r.submitted_at,'decided_at',r.decided_at,'admin_notes',r.admin_notes);
end $$;
grant execute on function public.get_my_review() to authenticated;

-- Admin: list reviews with profile basics
create or replace function public.admin_list_reviews(p_status text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into res from (
    select tr.id, tr.user_id, tr.status, tr.application, tr.admin_notes, tr.submitted_at, tr.decided_at,
           p.full_name, p.email, p.role, p.company_name,
           p.reviewed_by_pegasus, p.verified_identity, p.institutional_visibility
    from public.trust_reviews tr left join public.profiles p on p.id=tr.user_id
    where (p_status is null or tr.status=p_status)
    order by tr.submitted_at desc
  ) x;
  return res;
end $$;
grant execute on function public.admin_list_reviews(text) to authenticated;

-- Admin: decide (approve / deny / more_info / revoke)
create or replace function public.review_decide(p_review_id uuid, p_decision text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); tr record;
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  if p_decision not in ('approved','denied','more_info','revoked') then raise exception 'Bad decision'; end if;
  select * into tr from public.trust_reviews where id=p_review_id; if not found then raise exception 'Review not found'; end if;
  update public.trust_reviews set status=p_decision, admin_notes=coalesce(p_notes,admin_notes), decided_at=now(), decided_by=uid where id=p_review_id;
  if p_decision='approved' then
    update public.profiles set reviewed_by_pegasus=true, reviewed_at=now(), reviewed_by=uid, review_status='approved', review_notes=p_notes where id=tr.user_id;
  elsif p_decision='revoked' then
    update public.profiles set reviewed_by_pegasus=false, review_status='revoked', review_notes=p_notes where id=tr.user_id;
  elsif p_decision='denied' then
    update public.profiles set review_status='denied', review_notes=p_notes where id=tr.user_id;
  else
    update public.profiles set review_status='more_info', review_notes=p_notes where id=tr.user_id;
  end if;
  begin perform public.create_notification(tr.user_id,'trust','Reviewed by Pegasus update',
    'Your review status is now: '||p_decision, '/profile-edit.html'); exception when others then null; end;
  return jsonb_build_object('ok',true,'status',p_decision);
end $$;
grant execute on function public.review_decide(uuid,text,text) to authenticated;

-- Admin: toggle Level 1 / Level 3 flags directly
create or replace function public.admin_set_trust_flag(p_user uuid, p_flag text, p_value boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then raise exception 'Admins only'; end if;
  if p_flag='verified_identity' then update public.profiles set verified_identity=p_value where id=p_user;
  elsif p_flag='institutional_visibility' then update public.profiles set institutional_visibility=p_value where id=p_user;
  else raise exception 'Bad flag'; end if;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.admin_set_trust_flag(uuid,text,boolean) to authenticated;
