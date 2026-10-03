-- ============================================================================
-- PEGASUS Migration 083 — Bulk company-stub importer (finance directory)
--
-- Admin-run bulk import: takes an array of company rows (from an uploaded CSV —
-- NMLS, private-lender / hard-money / funding-provider directories, etc.) and
-- creates public, claimable "unclaimed" business pages. De-duplicated (within
-- the batch and against existing presences, by normalized name). Only public
-- business fields; each row's optional external_id is kept in metadata.
--
-- Pairs with the Admin → Directory CSV uploader. Depends on 047 (presences),
-- 011 (is_admin_user), 081 (peg_normalize_name). IDEMPOTENT per name.
-- ============================================================================

create or replace function public.import_company_stubs(p_rows jsonb, p_default_type text default 'Finance / Lending')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_me uuid := auth.uid(); r jsonb;
  v_name text; v_norm text; v_type text; v_web text; v_slug text;
  v_created int := 0; v_skipped int := 0; v_seen text[] := '{}';
begin
  if not public.is_admin_user() then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_name := btrim(coalesce(r->>'name',''));
    if v_name = '' then v_skipped := v_skipped + 1; continue; end if;
    v_norm := public.peg_normalize_name(v_name);
    if v_norm is null or length(v_norm) < 2 then v_skipped := v_skipped + 1; continue; end if;
    if v_norm = any(v_seen) then v_skipped := v_skipped + 1; continue; end if;      -- intra-batch dup
    if exists (select 1 from public.presences p
                where p.presence_type <> 'personal'
                  and public.peg_normalize_name(p.name) = v_norm) then                 -- existing dup
      v_skipped := v_skipped + 1; continue;
    end if;
    v_seen := v_seen || v_norm;
    v_type := coalesce(nullif(btrim(r->>'type'),''), p_default_type);
    v_web  := nullif(btrim(r->>'website'),'');
    v_slug := left(regexp_replace(regexp_replace(lower(v_name),'[^a-z0-9]+','-','g'),'(^-+|-+$)','','g'), 60)
              || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,5);
    insert into public.presences
      (presence_type, owner_user_id, created_by_user_id, name, slug, category, industry,
       location, market, website_url, public_cta_label, public_cta_url,
       visibility, status, public_preview_enabled, metadata)
    values ('company', v_me, v_me, v_name, v_slug, v_type, v_type,
       nullif(btrim(coalesce(r->>'city','')||', '||coalesce(r->>'state','')), ','),
       nullif(btrim(r->>'state'),''),
       v_web, case when v_web is not null then 'Visit website' else null end, v_web,
       'public_preview','active', true,
       jsonb_build_object('unclaimed', true, 'source', coalesce(nullif(btrim(r->>'source'),''),'csv_import'),
                          'external_id', nullif(btrim(r->>'external_id'),'')));
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end; $$;
grant execute on function public.import_company_stubs(jsonb,text) to authenticated;

notify pgrst, 'reload schema';
select 'company stub importer ready' as status;
