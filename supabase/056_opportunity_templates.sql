-- ============================================================================
-- PEGASUS Migration 056 — Opportunity presentation templates (template_type)
--
-- An "opportunity" is an umbrella. Members present different things: a capital
-- program, a development project, a property/listing, a startup need, a showcase
-- (credibility, not a deal), an event/session, or a partnership request. The
-- guided launch selector lets them pick a format; each format keeps its own
-- fields and language on the frontend, but everything still stores in the one
-- opportunities table — we only add a nullable template_type so pages can show
-- the right badge and language.
--
-- Additive & non-destructive:
--   • opportunities.template_type (nullable; permissive CHECK incl. NULL)
--   • relaxes opportunities_type_check to add showcase/startup/partnership
--   • create_opportunity / update_opportunity gain a p_template_type arg (and
--     derive opportunity_type from the template when not given)
--   • the read RPCs return template_type
--
-- Does NOT break 054/055. IDEMPOTENT. Depends on 054.
-- ============================================================================

-- 1) template_type column ----------------------------------------------------
alter table public.opportunities add column if not exists template_type text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='opportunities_template_check') then
    alter table public.opportunities add constraint opportunities_template_check
      check (template_type is null or template_type in
        ('capital_program','project','property_listing','startup_business_need',
         'showcase','event_session','partnership_request'));
  end if;
end $$;

-- 2) relax opportunity_type CHECK to cover the new presentation kinds ---------
alter table public.opportunities drop constraint if exists opportunities_type_check;
alter table public.opportunities add constraint opportunities_type_check check (opportunity_type in
  ('opportunity','project','listing','property','capital_request','fund','deal','event','other',
   'showcase','startup','partnership'));

-- 3) helper: derive a valid opportunity_type from a template_type ------------
create or replace function public.opportunity_type_for_template(p_template text)
returns text language sql immutable as $$
  select case p_template
    when 'capital_program'        then 'capital_request'
    when 'project'                then 'project'
    when 'property_listing'       then 'property'
    when 'startup_business_need'  then 'startup'
    when 'showcase'               then 'showcase'
    when 'event_session'          then 'event'
    when 'partnership_request'    then 'partnership'
    else 'opportunity' end;
$$;

-- 4) create_opportunity (+ p_template_type) ----------------------------------
drop function if exists public.create_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text);
create or replace function public.create_opportunity(
  p_presence_id uuid, p_title text, p_opportunity_type text default 'opportunity',
  p_summary text default null, p_description text default null, p_category text default null,
  p_location text default null, p_market text default null, p_amount_label text default null,
  p_cta_label text default null, p_cta_url text default null, p_visibility text default 'public_preview',
  p_template_type text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_me uuid:=auth.uid(); v_title text:=btrim(coalesce(p_title,''));
  v_vis text:=coalesce(nullif(btrim(p_visibility),''),'public_preview');
  v_tmpl text:=nullif(btrim(p_template_type),'');
  v_type text:=nullif(btrim(p_opportunity_type),''); v_id uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not (public.can_manage_presence(p_presence_id) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  if v_title = '' then raise exception 'A title is required.'; end if;
  if v_tmpl is not null and v_tmpl not in ('capital_program','project','property_listing','startup_business_need','showcase','event_session','partnership_request')
    then raise exception 'Invalid template_type'; end if;
  -- Derive opportunity_type from the template when the caller didn't set one.
  if v_type is null and v_tmpl is not null then v_type := public.opportunity_type_for_template(v_tmpl); end if;
  if v_type is null then v_type := 'opportunity'; end if;
  if v_type not in ('opportunity','project','listing','property','capital_request','fund','deal','event','other','showcase','startup','partnership')
    then raise exception 'Invalid opportunity_type'; end if;
  if v_vis not in ('public_preview','member_only','private') then raise exception 'Invalid visibility'; end if;
  insert into public.opportunities(presence_id,created_by_user_id,updated_by_user_id,title,slug,opportunity_type,template_type,summary,description,category,location,market,amount_label,cta_label,cta_url,visibility,status)
  values (p_presence_id,v_me,v_me,v_title,public.opportunity_generate_slug(v_title),v_type,v_tmpl,
    nullif(btrim(p_summary),''),nullif(btrim(p_description),''),nullif(btrim(p_category),''),nullif(btrim(p_location),''),nullif(btrim(p_market),''),
    nullif(btrim(p_amount_label),''),nullif(btrim(p_cta_label),''),nullif(btrim(p_cta_url),''),v_vis,'active')
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.create_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- 5) update_opportunity (+ p_template_type) ----------------------------------
drop function if exists public.update_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text,text);
create or replace function public.update_opportunity(
  p_id uuid, p_title text default null, p_opportunity_type text default null,
  p_summary text default null, p_description text default null, p_category text default null,
  p_location text default null, p_market text default null, p_amount_label text default null,
  p_cta_label text default null, p_cta_url text default null, p_visibility text default null,
  p_status text default null, p_template_type text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_me uuid:=auth.uid(); v_pid uuid; v_vis text; v_stat text; v_tmpl text:=nullif(btrim(p_template_type),''); v_type text:=nullif(btrim(p_opportunity_type),'');
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select presence_id into v_pid from public.opportunities where id=p_id;
  if v_pid is null then raise exception 'Opportunity not found'; end if;
  if not (public.can_manage_presence(v_pid) or public.is_admin_user()) then raise exception 'Not authorized'; end if;
  if v_tmpl is not null and v_tmpl not in ('capital_program','project','property_listing','startup_business_need','showcase','event_session','partnership_request')
    then raise exception 'Invalid template_type'; end if;
  if v_tmpl is not null and v_type is null then v_type := public.opportunity_type_for_template(v_tmpl); end if;
  v_vis := coalesce(nullif(btrim(p_visibility),''),(select visibility from public.opportunities where id=p_id));
  v_stat := coalesce(nullif(btrim(p_status),''),(select status from public.opportunities where id=p_id));
  if v_vis not in ('public_preview','member_only','private') then raise exception 'Invalid visibility'; end if;
  if v_stat not in ('draft','active','archived') then raise exception 'Invalid status'; end if;
  if v_type is not null and v_type not in ('opportunity','project','listing','property','capital_request','fund','deal','event','other','showcase','startup','partnership')
    then raise exception 'Invalid opportunity_type'; end if;
  update public.opportunities set
    title=coalesce(nullif(btrim(p_title),''),title),
    opportunity_type=coalesce(v_type,opportunity_type),
    template_type=coalesce(v_tmpl,template_type),
    summary=nullif(btrim(p_summary),''), description=nullif(btrim(p_description),''),
    category=nullif(btrim(p_category),''), location=nullif(btrim(p_location),''), market=nullif(btrim(p_market),''),
    amount_label=nullif(btrim(p_amount_label),''), cta_label=nullif(btrim(p_cta_label),''), cta_url=nullif(btrim(p_cta_url),''),
    visibility=v_vis, status=v_stat, updated_by_user_id=v_me
  where id=p_id;
end; $$;
grant execute on function public.update_opportunity(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- 6) read RPCs now return template_type --------------------------------------
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
    select jsonb_build_object('id',o.id,'title',o.title,'slug',o.slug,'opportunity_type',o.opportunity_type,'template_type',o.template_type,
             'summary',o.summary,'category',o.category,'location',o.location,'market',o.market,
             'amount_label',o.amount_label,'cta_label',o.cta_label,'visibility',o.visibility,'status',o.status,'can_manage',v_can_manage) as obj,
           coalesce(o.updated_at,o.created_at) as ord
    from public.opportunities o
    where o.presence_id=v_pid
      and ( v_can_manage
            or (o.status='active' and (o.visibility='public_preview' or (o.visibility='member_only' and v_me is not null))) )
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_opportunities_for_presence(text) to anon, authenticated;

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

  v_safe := jsonb_build_object('id',o.id,'title',o.title,'slug',o.slug,'opportunity_type',o.opportunity_type,'template_type',o.template_type,
    'summary',o.summary,'description',o.description,'category',o.category,'location',o.location,'market',o.market,
    'amount_label',o.amount_label,'cta_label',o.cta_label,'cta_url',o.cta_url,'visibility',o.visibility,'status',o.status);
  v_by := jsonb_build_object('name',pr.name,'slug',pr.slug,'presence_type',pr.presence_type);

  if v_can_manage then
    return jsonb_build_object('access','full','opportunity',v_safe,'presented_by',v_by,'can_manage',true);
  end if;
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
select 'opportunity templates ready' as status;
