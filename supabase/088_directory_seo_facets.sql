-- ============================================================================
-- PEGASUS Migration 088 — Directory SEO facets (state landing pages + HMDA)
--
-- Extends the public business directory view (084) with the columns the SEO
-- layer needs — no new tables, no changes to presences:
--   state_code / city      parsed from presences.location ("City, ST")
--   hmda_rank / _volume_usd / _count   from metadata (hmda_2025_top1000 import)
--   unclaimed              metadata flag (claimable stub)
-- and a small facet view for "<category> in <state>" landing pages.
--
-- ADDITIVE + IDEMPOTENT (CREATE OR REPLACE appends columns; existing readers
-- keep working). Depends on 084.
-- ============================================================================

create or replace view public.public_business_directory as
select
  p.id, p.presence_type, p.name, p.slug, p.tagline, p.short_description,
  p.category, p.industry, p.location, p.market,
  p.public_cta_label, p.public_cta_url, p.status,
  coalesce(c.slug,  'other') as cat_slug,
  coalesce(c.label, 'Other') as cat_label,
  coalesce(s.slug,  'other') as section_slug,
  coalesce(s.label, 'Other') as section_label,
  coalesce(s.sort,  99)      as section_sort,
  coalesce(c.sort,  99)      as cat_sort,
  nullif(upper(btrim(split_part(p.location, ',', 2))), '') as state_code,
  nullif(btrim(split_part(p.location, ',', 1)), '')        as city,
  (p.metadata->>'rank')::int                       as hmda_rank,
  (p.metadata->>'origination_volume_usd')::numeric as hmda_volume_usd,
  (p.metadata->>'origination_count')::int          as hmda_count,
  coalesce((p.metadata->>'unclaimed')::boolean, false) as unclaimed
from public.presences p
left join public.pn_category_aliases a on a.alias = lower(btrim(p.category))
left join public.pn_categories c       on c.slug  = a.cat_slug
left join public.pn_sections   s       on s.slug  = c.section_slug
where p.presence_type = 'company'
  and p.status = 'active'
  and p.public_preview_enabled = true
  and p.visibility = 'public_preview';

-- "<category> in <state>" facet counts (anon-safe; only public company pages).
create or replace view public.public_business_state_facets as
select state_code, section_slug, section_label, section_sort, cat_slug, cat_label, cat_sort, count(*)::int as n
from public.public_business_directory
where state_code is not null and state_code ~ '^[A-Z]{2}$'
group by state_code, section_slug, section_label, section_sort, cat_slug, cat_label, cat_sort;

grant select on public.public_business_directory, public.public_business_facets, public.public_business_state_facets to anon, authenticated;

notify pgrst, 'reload schema';
