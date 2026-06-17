-- ============================================================================
-- PEGASUS Migration 058 — Public presentations feed (homepage Live Lobby)
--
-- A visibility-safe, anonymous-readable list of recent PUBLIC presentations
-- (opportunities / showcases / projects / listings …) across the whole network,
-- for the public homepage "Inside Pegasus" live preview.
--
-- Strictly public only: the opportunity must be active + public_preview AND its
-- parent business page must be active + public_preview + public_preview_enabled.
-- Never returns member-only/private items, created_by, or any private metadata —
-- only safe display fields + the cover image + presented-by business.
--
-- Purely additive. Depends on 047/054/056/057. IDEMPOTENT.
-- ============================================================================

create or replace function public.get_public_presentations(p_limit int default 12)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_lim int := least(greatest(coalesce(p_limit,12),1),48);
begin
  select coalesce(jsonb_agg(obj order by ord desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
             'title', o.title, 'slug', o.slug,
             'template_type', o.template_type, 'opportunity_type', o.opportunity_type,
             'summary', o.summary, 'amount_label', o.amount_label,
             'location', o.location, 'market', o.market, 'category', o.category,
             'cover_url', case when jsonb_typeof(o.media)='object' then o.media->>'cover_url' else null end,
             'presented_by', jsonb_build_object('name', pr.name, 'slug', pr.slug, 'presence_type', pr.presence_type)
           ) as obj,
           coalesce(o.updated_at, o.created_at) as ord
    from public.opportunities o
    join public.presences pr on pr.id = o.presence_id
    where o.status = 'active' and o.visibility = 'public_preview'
      and pr.status = 'active' and pr.visibility = 'public_preview'
      and coalesce(pr.public_preview_enabled, true) = true
    order by coalesce(o.updated_at, o.created_at) desc nulls last
    limit v_lim
  ) s;
  return v_result;
end; $$;
grant execute on function public.get_public_presentations(int) to anon, authenticated;

notify pgrst, 'reload schema';
select 'public presentations feed ready' as status;
