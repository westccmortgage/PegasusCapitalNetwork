-- ============================================================================
-- PEGASUS Migration 082 — Publish unclaimed company directory pages
--
-- Turns imported companies (pn_companies) into public, claimable business pages
-- ("unclaimed" directory stubs, Yelp/Crunchbase style). Admin-run, repeatable,
-- and de-duplicated against existing presences by normalized name. Only PUBLIC
-- business fields are published (name, type, city/state, website) — never phone
-- or email. Each stub is owned by the admin who published it (a directory
-- holder) until a real owner claims it via the claim flow (migration 080).
--
-- Depends on 047 (presences), 011 (is_admin_user), 081 (peg_normalize_name),
-- and the pn_companies table. IDEMPOTENT (re-running skips already-published).
-- ============================================================================

create or replace function public.count_publishable_company_stubs()
returns integer language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin_user() then return 0; end if;
  return (
    select count(distinct public.peg_normalize_name(c.company_name)) from public.pn_companies c
    where c.company_name is not null and btrim(c.company_name) <> ''
      and not exists (
        select 1 from public.presences p
        where p.presence_type <> 'personal'
          and public.peg_normalize_name(p.name) = public.peg_normalize_name(c.company_name))
  );
end; $$;
grant execute on function public.count_publishable_company_stubs() to authenticated;

create or replace function public.publish_unclaimed_company_stubs(p_limit int default 50)
returns integer language plpgsql security definer set search_path=public as $$
declare v_me uuid := auth.uid(); v_count int;
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  with dedup as (
    -- one row per normalized name (collapse intra-batch duplicates)
    select distinct on (public.peg_normalize_name(c.company_name)) c.*
    from public.pn_companies c
    where c.company_name is not null and btrim(c.company_name) <> ''
    order by public.peg_normalize_name(c.company_name), c.created_at
  ), src as (
    select d.* from dedup d
    where not exists (
        select 1 from public.presences p
        where p.presence_type <> 'personal'
          and public.peg_normalize_name(p.name) = public.peg_normalize_name(d.company_name))
    order by d.created_at
    limit greatest(1, least(coalesce(p_limit,50), 500))
  ), ins as (
    insert into public.presences
      (presence_type, owner_user_id, created_by_user_id, name, slug, category, industry,
       location, market, website_url, public_cta_label, public_cta_url,
       visibility, status, public_preview_enabled, metadata)
    select 'company', v_me, v_me, c.company_name,
           regexp_replace(regexp_replace(lower(c.company_name),'[^a-z0-9]+','-','g'),'(^-+|-+$)','','g')
             || '-' || substr(replace(c.id::text,'-',''),1,5),
           c.company_type, c.company_type,
           nullif(btrim(coalesce(c.city,'')||', '||coalesce(c.state,'')), ','), c.state,
           nullif(c.website,''), case when nullif(c.website,'') is not null then 'Visit website' else null end, nullif(c.website,''),
           'public_preview','active', true,
           jsonb_build_object('unclaimed', true, 'source','pn_companies', 'source_id', c.id)
    from src c
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end; $$;
grant execute on function public.publish_unclaimed_company_stubs(int) to authenticated;

notify pgrst, 'reload schema';
select 'company stub publisher ready' as status;
