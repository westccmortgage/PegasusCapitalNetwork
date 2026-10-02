-- ============================================================================
-- PEGASUS Migration 080 — Entity claims ("Is this your business?")
--
-- Lets a signed-in member request ownership of an existing business/project/
-- event page (a presence). An admin reviews; on approval the claimant is added
-- to presence_members as a manager. Conversion mechanism for the growth loop.
--
-- NOTE: the entity_claims table uses a GENERIC entity model
-- (entity_type / entity_id / claimant_id …) so it can later cover more than
-- presences. v1 writes entity_type='presence'. This migration matches the table
-- already present in production; `create table if not exists` is a no-op there
-- and recreates the same shape on a fresh database.
--
-- Depends on 047 (presences, presence_members, can_manage_presence),
-- 011 (is_admin_user), 021 (create_notification), 002 (profiles). IDEMPOTENT.
-- ============================================================================

create table if not exists public.entity_claims (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null,
  entity_id      uuid not null,
  entity_slug    text,
  claimant_id    uuid not null references auth.users(id) on delete cascade,
  claimant_name  text,
  claimant_email text,
  relationship   text,
  evidence       text,
  status         text not null default 'pending',
  admin_notes    text,
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint entity_claims_status_check check (status in ('pending','approved','rejected','withdrawn'))
);
create index if not exists idx_entity_claims_entity   on public.entity_claims(entity_type, entity_id, status);
create index if not exists idx_entity_claims_claimant on public.entity_claims(claimant_id, created_at desc);
create index if not exists idx_entity_claims_status   on public.entity_claims(status, created_at desc);

create or replace function public.peg_entity_claims_touch()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_entity_claims_touch on public.entity_claims;
create trigger trg_entity_claims_touch before update on public.entity_claims
  for each row execute function public.peg_entity_claims_touch();

-- RLS — claimant sees own; admins see all. Writes go through the RPCs below.
alter table public.entity_claims enable row level security;
drop policy if exists entity_claims_select_own_or_admin on public.entity_claims;
create policy entity_claims_select_own_or_admin on public.entity_claims for select to authenticated
  using (claimant_id = auth.uid() or public.is_admin_user());
drop policy if exists entity_claims_update_own_or_admin on public.entity_claims;
create policy entity_claims_update_own_or_admin on public.entity_claims for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- ── create_entity_claim(presence_id, evidence, contact_note) ──────────────────
create or replace function public.create_entity_claim(
  p_presence_id uuid, p_evidence text default null, p_contact_note text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); pr record; v_id uuid; v_name text; v_email text; mgr record;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select id, name, slug, presence_type into pr from public.presences where id=p_presence_id limit 1;
  if pr.id is null then raise exception 'Page not found'; end if;
  if pr.presence_type = 'personal' then raise exception 'Personal profiles cannot be claimed here.'; end if;
  if public.can_manage_presence(p_presence_id) or public.is_admin_user() then
    raise exception 'You already manage this page.'; end if;
  select id into v_id from public.entity_claims
    where claimant_id=v_me and entity_type='presence' and entity_id=p_presence_id and status='pending' limit 1;
  if v_id is not null then return v_id; end if;
  select coalesce(nullif(btrim(full_name),''),'A member'), email into v_name, v_email from public.profiles where id=v_me;
  insert into public.entity_claims(entity_type, entity_id, entity_slug, claimant_id, claimant_name, claimant_email, evidence, status)
    values ('presence', p_presence_id, pr.slug, v_me, v_name,
            coalesce(nullif(btrim(p_contact_note),''), v_email), nullif(btrim(p_evidence),''), 'pending')
    returning id into v_id;
  for mgr in select id from public.profiles where is_admin=true or role='admin' loop
    perform public.create_notification(mgr.id,'claim','New page claim to review',
      v_name||' is claiming '||coalesce(pr.name,'a page')||'.', '/admin.html#claims');
  end loop;
  return v_id;
end; $$;
grant execute on function public.create_entity_claim(uuid,text,text) to authenticated;

-- ── my_entity_claims() ────────────────────────────────────────────────────────
create or replace function public.my_entity_claims()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_result jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(obj order by ord desc),'[]'::jsonb) into v_result from (
    select jsonb_build_object('id',e.id,'status',e.status,'created_at',e.created_at,
             'presence', jsonb_build_object('name',coalesce(pr.name,e.entity_slug),
                          'slug',coalesce(pr.slug,e.entity_slug),'presence_type',pr.presence_type)) as obj,
           e.created_at as ord
    from public.entity_claims e
    left join public.presences pr on pr.id=e.entity_id and e.entity_type='presence'
    where e.claimant_id=v_me
  ) s;
  return v_result;
end; $$;
grant execute on function public.my_entity_claims() to authenticated;

-- ── get_entity_claims_pending() (admin) ───────────────────────────────────────
create or replace function public.get_entity_claims_pending()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(obj order by ord asc),'[]'::jsonb) into v_result from (
    select jsonb_build_object('id',e.id,'status',e.status,'created_at',e.created_at,
             'evidence',coalesce(e.evidence,e.relationship),'contact_note',e.claimant_email,
             'presence', jsonb_build_object('id',pr.id,'name',coalesce(pr.name,e.entity_slug),
                          'slug',coalesce(pr.slug,e.entity_slug),'presence_type',pr.presence_type),
             'claimant', jsonb_build_object('name',coalesce(nullif(btrim(e.claimant_name),''),'Member'),
                          'email',e.claimant_email)) as obj,
           e.created_at as ord
    from public.entity_claims e
    left join public.presences pr on pr.id=e.entity_id and e.entity_type='presence'
    where e.status='pending'
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_entity_claims_pending() to authenticated;

-- ── review_entity_claim(id, decision, note) (admin) ───────────────────────────
create or replace function public.review_entity_claim(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); e record; pr record;
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select * into e from public.entity_claims where id=p_id;
  if e.id is null then raise exception 'Claim not found'; end if;
  if e.status <> 'pending' then raise exception 'Claim already reviewed'; end if;
  select id, name, slug into pr from public.presences where id=e.entity_id limit 1;
  update public.entity_claims
     set status=p_decision, reviewed_by=v_me, reviewed_at=now(), admin_notes=nullif(btrim(p_note),'')
   where id=p_id;
  if p_decision='approved' and e.entity_type='presence' and pr.id is not null then
    insert into public.presence_members(presence_id, user_id, role)
      values (e.entity_id, e.claimant_id, 'owner')
      on conflict (presence_id, user_id) do update set role='owner';
    perform public.create_notification(e.claimant_id,'claim','Your page claim was approved',
      'You now manage '||coalesce(pr.name,'the page')||'. Edit it anytime.', '/my-presences.html');
  elsif p_decision='approved' then
    perform public.create_notification(e.claimant_id,'claim','Your claim was approved','Your claim was approved.', '/dashboard.html');
  else
    perform public.create_notification(e.claimant_id,'claim','Your page claim was not approved',
      'We could not verify your claim for '||coalesce(pr.name,'the page')||'.'||
        case when nullif(btrim(p_note),'') is not null then ' Note: '||btrim(p_note) else '' end, '/');
  end if;
end; $$;
grant execute on function public.review_entity_claim(uuid,text,text) to authenticated;

-- ── count_entity_claims_pending() (admin badge) ───────────────────────────────
create or replace function public.count_entity_claims_pending()
returns integer language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then return 0; end if;
  return (select count(*) from public.entity_claims where status='pending');
end; $$;
grant execute on function public.count_entity_claims_pending() to authenticated;

notify pgrst, 'reload schema';
select 'entity_claims ready' as status;
