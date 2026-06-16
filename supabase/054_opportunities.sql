-- ============================================================================
-- PEGASUS Migration 054 — Opportunities (deals/projects/listings owned by a
-- business/project presence)
--
-- Product law: an Opportunity = a deal. It always belongs to a business/project
-- page (presence). It is never attached directly to a personal profile.
--
-- Adds:
--   • public.opportunities table (+ RLS: only managers of the parent presence,
--     or platform admins, can read/write directly; everyone else reads via the
--     SECURITY DEFINER RPCs below, which enforce visibility safely).
--   • create_opportunity / update_opportunity / archive_opportunity  (manager-only)
--   • get_opportunities_for_presence(slug)  — safe list for a business page
--   • get_opportunity_by_slug(slug)         — safe single opportunity page
--
-- Never returns created_by_user_id or any private metadata. Depends on 047
-- (presences, can_manage_presence, is_admin_user). IDEMPOTENT.
-- ============================================================================

create table if not exists public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  presence_id         uuid not null references public.presences(id) on delete cascade,
  created_by_user_id  uuid references auth.users(id) on delete set null,
  updated_by_user_id  uuid references auth.users(id) on delete set null,
  title               text not null,
  slug                text unique not null,
  opportunity_type    text not null default 'opportunity',
  summary             text,
  description         text,
  category            text,
  location            text,
  market              text,
  amount_label        text,
  cta_label           text,
  cta_url             text,
  visibility          text not null default 'public_preview',
  status              text not null default 'active',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  constraint opportunities_type_check check (opportunity_type in
    ('opportunity','project','listing','property','capital_request','fund','deal','event','other')),
  constraint opportunities_visibility_check check (visibility in ('public_preview','member_only','private')),
  constraint opportunities_status_check check (status in ('draft','active','archived'))
);
create index if not exists idx_opportunities_presence on public.opportunities(presence_id);
create index if not exists idx_opportunities_slug     on public.opportunities(slug);

create or replace function public.opportunities_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_opportunities_touch on public.opportunities;
create trigger trg_opportunities_touch before update on public.opportunities
  for each row execute function public.opportunities_touch_updated_at();

-- ── RLS — managers of the parent presence (or admin) manage directly; everyone
--    else reads through the RPCs below. ────────────────────────────────────────
alter table public.opportunities enable row level security;
drop policy if exists opp_manage on public.opportunities;
create policy opp_manage on public.opportunities for all to authenticated
  using (public.can_manage_presence(presence_id) or public.is_admin_user())
  with check (public.can_manage_presence(presence_id) or public.is_admin_user());

-- ── Slug helper (unique within opportunities) ────────────────────────────────
create or replace function public.opportunity_generate_slug(p_title text)
returns text language plpgsql security definer set search_path=public as $$
declare base text; out text;
begin
  base := lower(coalesce(p_title,''));
  base := translate(base,'абвгдежзийклмнопрстуфхцчшщыьэюяё','abvgdezhziklmnoprstufhtschschyeyuyae');
  base := regexp_replace(base,'[^a-z0-9\s\-]','','g');
  base := trim(regexp_replace(base,'\s+','-','g'));
  base := regexp_replace(base,'\-+','-','g');
  base := trim(both '-' from base);
  if base = '' then base := 'opportunity'; end if;
  out := base;
  while exists(select 1 from public.opportunities where slug = out) loop
    out := base || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,4);
  end loop;
  return out;
end; $$;

-- ── create_opportunity ───────────────────────────────────────────────────────
create or replace function public.create_opportunity(
  p_presence_id uuid, p_title text, p_opportunity_type text default 'opportunity',
  p_summary text default null, p_description text default null, p_category text default null,
  p_location text default null, p_market text default null, p_amount_label text default null,
  p_cta_label text default null, p_cta_url text default null, p_visibility text default 'public_preview'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_title text:=btrim(coalesce(p_title,'')); v_vis text:=coalesce(nullif(btrim(p_visibility),''),'public_preview'); v_id uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not (public.can_manage_presence(p_presence_id) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  if v_title = '' then raise exception 'A title is required.'; end if;
  if p_opportunity_type not in ('opportunity','project','listing','property','capital_request','fund','deal','event','other') then raise exception 'Invalid opportunity_type'; end if;
  if v_vis not in ('public_preview','member_only','private') then raise exception 'Invalid visibility'; end if;
  insert into public.opportunities(presence_id,created_by_user_id,updated_by_user_id,title,slug,opportunity_type,summary,description,category,location,market,amount_label,cta_label,cta_url,visibility,status)
  values (p_presence_id,v_me,v_me,v_title,public.opportunity_generate_slug(v_title),p_opportunity_type,
    nullif(btrim(p_summary),''),nullif(btrim(p_description),''),nullif(btrim(p_category),''),nullif(btrim(p_location),''),nullif(btrim(p_market),''),
    nullif(btrim(p_amount_label),''),nullif(btrim(p_cta_label),''),nullif(btrim(p_cta_url),''),v_vis,'active')
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.create_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- ── update_opportunity ───────────────────────────────────────────────────────
create or replace function public.update_opportunity(
  p_id uuid, p_title text default null, p_opportunity_type text default null,
  p_summary text default null, p_description text default null, p_category text default null,
  p_location text default null, p_market text default null, p_amount_label text default null,
  p_cta_label text default null, p_cta_url text default null, p_visibility text default null, p_status text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_pid uuid; v_vis text; v_stat text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select presence_id into v_pid from public.opportunities where id=p_id;
  if v_pid is null then raise exception 'Opportunity not found'; end if;
  if not (public.can_manage_presence(v_pid) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  v_vis := coalesce(nullif(btrim(p_visibility),''),(select visibility from public.opportunities where id=p_id));
  v_stat := coalesce(nullif(btrim(p_status),''),(select status from public.opportunities where id=p_id));
  if v_vis not in ('public_preview','member_only','private') then raise exception 'Invalid visibility'; end if;
  if v_stat not in ('draft','active','archived') then raise exception 'Invalid status'; end if;
  update public.opportunities set
    title=coalesce(nullif(btrim(p_title),''),title),
    opportunity_type=coalesce(nullif(btrim(p_opportunity_type),''),opportunity_type),
    summary=nullif(btrim(p_summary),''), description=nullif(btrim(p_description),''),
    category=nullif(btrim(p_category),''), location=nullif(btrim(p_location),''), market=nullif(btrim(p_market),''),
    amount_label=nullif(btrim(p_amount_label),''), cta_label=nullif(btrim(p_cta_label),''), cta_url=nullif(btrim(p_cta_url),''),
    visibility=v_vis, status=v_stat, updated_by_user_id=v_me
  where id=p_id;
end; $$;
grant execute on function public.update_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- ── archive_opportunity ──────────────────────────────────────────────────────
create or replace function public.archive_opportunity(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_pid uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select presence_id into v_pid from public.opportunities where id=p_id;
  if v_pid is null then raise exception 'Opportunity not found'; end if;
  if not (public.can_manage_presence(v_pid) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  update public.opportunities set status='archived', updated_by_user_id=v_me where id=p_id;
end; $$;
grant execute on function public.archive_opportunity(uuid) to authenticated;

-- ── get_opportunities_for_presence(slug) — safe list for a business page ──────
create or replace function public.get_opportunities_for_presence(p_slug text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_admin boolean:=false; v_pid uuid; v_pvis text; v_pstatus text; v_can_manage boolean:=false; v_result jsonb;
begin
  if p_slug is null or btrim(p_slug)='' then return '[]'::jsonb; end if;
  select id, visibility, status into v_pid, v_pvis, v_pstatus from public.presences where slug=p_slug limit 1;
  if v_pid is null then return '[]'::jsonb; end if;
  if v_me is not null then v_admin:=public.is_admin_user(); v_can_manage := public.can_manage_presence(v_pid) or v_admin; end if;
  if not v_can_manage then
    if v_pstatus <> 'active' then return '[]'::jsonb; end if;
    if v_pvis = 'private' then return '[]'::jsonb; end if;
    if v_pvis = 'member_only' and v_me is null then return '[]'::jsonb; end if;
  end if;
  select coalesce(jsonb_agg(obj order by ord desc),'[]'::jsonb) into v_result from (
    select jsonb_build_object('id',o.id,'title',o.title,'slug',o.slug,'opportunity_type',o.opportunity_type,
             'summary',o.summary,'category',o.category,'location',o.location,'market',o.market,
             'amount_label',o.amount_label,'visibility',o.visibility,'status',o.status,'can_manage',v_can_manage) as obj,
           coalesce(o.updated_at,o.created_at) as ord
    from public.opportunities o
    where o.presence_id=v_pid
      and ( v_can_manage
            or (o.status='active' and (o.visibility='public_preview' or (o.visibility='member_only' and v_me is not null))) )
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_opportunities_for_presence(text) to anon, authenticated;

-- ── get_opportunity_by_slug(slug) — single opportunity page ──────────────────
create or replace function public.get_opportunity_by_slug(p_slug text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_me uuid:=auth.uid(); o record; pr record; v_admin boolean:=false; v_can_manage boolean:=false; v_safe jsonb; v_by jsonb;
begin
  if p_slug is null or btrim(p_slug)='' then return null; end if;
  select * into o from public.opportunities where slug=p_slug limit 1;
  if not found then return null; end if;
  select id, name, slug, presence_type, visibility, status, public_preview_enabled into pr from public.presences where id=o.presence_id limit 1;
  if v_me is not null then v_admin:=public.is_admin_user(); v_can_manage := public.can_manage_presence(o.presence_id) or v_admin; end if;

  v_safe := jsonb_build_object('id',o.id,'title',o.title,'slug',o.slug,'opportunity_type',o.opportunity_type,
    'summary',o.summary,'description',o.description,'category',o.category,'location',o.location,'market',o.market,
    'amount_label',o.amount_label,'cta_label',o.cta_label,'cta_url',o.cta_url,'visibility',o.visibility,'status',o.status);
  v_by := jsonb_build_object('name',pr.name,'slug',pr.slug,'presence_type',pr.presence_type);

  if v_can_manage then
    return jsonb_build_object('access','full','opportunity',v_safe,'presented_by',v_by,'can_manage',true);
  end if;
  -- non-managers: parent business must be active + not private; opp must be active + not private
  if pr.status <> 'active' or pr.visibility='private' or o.status<>'active' or o.visibility='private' then
    return jsonb_build_object('access','unavailable');
  end if;
  if v_me is null then
    if pr.visibility='public_preview' and o.visibility='public_preview' and coalesce(pr.public_preview_enabled,true) then
      return jsonb_build_object('access','full','opportunity',v_safe,'presented_by',v_by,'can_manage',false);
    end if;
    return jsonb_build_object('access','locked');
  end if;
  return jsonb_build_object('access','full','opportunity',v_safe,'presented_by',v_by,'can_manage',false);
end; $$;
grant execute on function public.get_opportunity_by_slug(text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'opportunities ready' as status;
