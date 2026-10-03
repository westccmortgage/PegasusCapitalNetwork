-- ============================================================================
-- PEGASUS Migration 084 — Business directory taxonomy (sections + categories)
--
-- Turns the flat "Businesses" directory into a capital-stack structure:
--   4 top-level SECTIONS  → canonical CATEGORIES  → companies.
-- Free-text presences.category values are mapped to canonical categories via an
-- alias table, so existing pages fall into the right section automatically and
-- future pages using the canonical labels map cleanly. Unmapped categories fall
-- back to the "Other" section (never dropped).
--
-- Public read surfaces for the directory + its facet counts (anon-safe; only
-- public, active company pages — same filter as public_presence_previews).
--
-- Reference data only (no changes to presences). Depends on 047 (presences).
-- IDEMPOTENT.
-- ============================================================================

-- ── Sections (top-level, capital-stack order) ──────────────────────────────
create table if not exists public.pn_sections (
  slug  text primary key,
  label text not null,
  sort  int  not null default 99
);

insert into public.pn_sections (slug,label,sort) values
  ('capital',   'Capital & Lenders',        1),
  ('advisors',  'Advisors & Brokers',       2),
  ('realestate','Real Estate',              3),
  ('services',  'Transaction & Services',   4),
  ('other',     'Other',                   99)
on conflict (slug) do update set label=excluded.label, sort=excluded.sort;

-- ── Canonical categories ────────────────────────────────────────────────────
create table if not exists public.pn_categories (
  slug         text primary key,
  label        text not null,
  section_slug text not null references public.pn_sections(slug),
  sort         int  not null default 99
);

insert into public.pn_categories (slug,label,section_slug,sort) values
  -- Capital & Lenders
  ('financial-institutions',    'Financial Institutions',          'capital',   1),
  ('mortgage-companies',        'Mortgage Companies',              'capital',   2),
  ('private-lenders',           'Private Lenders & Hard Money',    'capital',   3),
  ('commercial-finance',        'Commercial & Multifamily Finance','capital',   4),
  ('capital-platforms',         'Capital Platforms & Funds',       'capital',   5),
  ('family-offices',            'Family Offices',                  'capital',   6),
  ('private-equity-credit',     'Private Equity & Credit',         'capital',   7),
  ('sba-business-lenders',      'SBA & Business Lenders',          'capital',   8),
  -- Advisors & Brokers
  ('mortgage-brokers',          'Mortgage Brokers',                'advisors',  1),
  ('commercial-mortgage-brokers','Commercial Mortgage Brokers',    'advisors',  2),
  ('capital-advisors',          'Capital Advisors & Placement',    'advisors',  3),
  ('financial-advisors',        'Financial Advisors',              'advisors',  4),
  ('financial-planners',        'Financial Planners',              'advisors',  5),
  ('wealth-management',         'Wealth Management',               'advisors',  6),
  ('investment-banking',        'Investment Banking',              'advisors',  7),
  -- Real Estate
  ('real-estate-brokerages',    'Real Estate Brokerages',          'realestate',1),
  ('developers-builders',       'Developers & Builders',           'realestate',2),
  ('investment-firms',          'Investment Firms & Syndicators',  'realestate',3),
  ('property-management',       'Property Management',             'realestate',4),
  -- Transaction & Services
  ('title-escrow',              'Title & Escrow',                  'services',  1),
  ('appraisal-valuation',       'Appraisal & Valuation',           'services',  2),
  ('insurance',                 'Insurance',                       'services',  3),
  ('legal-1031',                'Legal & 1031 Exchange',           'services',  4),
  ('accounting-tax',            'Accounting & Tax',                'services',  5),
  ('proptech-fintech',          'Proptech / Fintech / AI',         'services',  6),
  -- Other
  ('other',                     'Other',                           'other',     1)
on conflict (slug) do update set label=excluded.label, section_slug=excluded.section_slug, sort=excluded.sort;

-- ── Aliases: lower(trim(free-text category)) → canonical category slug ───────
create table if not exists public.pn_category_aliases (
  alias    text primary key,                       -- already normalized (lower, trimmed)
  cat_slug text not null references public.pn_categories(slug)
);

insert into public.pn_category_aliases (alias,cat_slug) values
  -- existing free-text values in prod
  ('national mortgage lender',      'mortgage-companies'),
  ('mortgage lender & servicer',    'mortgage-companies'),
  ('digital mortgage lender',       'mortgage-companies'),
  ('wholesale mortgage lender',     'mortgage-companies'),
  ('non-qm wholesale lender',       'mortgage-companies'),
  ('bank & mortgage lender',        'financial-institutions'),
  ('credit union & mortgage lender','financial-institutions'),
  ('private lender / hard money',   'private-lenders'),
  ('commercial real estate finance','commercial-finance'),
  ('capital platform',              'capital-platforms'),
  ('real estate debt platform',     'capital-platforms'),
  ('mortgage broker',               'mortgage-brokers'),
  ('real estate brokerage',         'real-estate-brokerages'),
  ('developer',                     'developers-builders'),
  ('artificial intelligence',       'proptech-fintech'),
  ('independent escrow company',    'title-escrow'),
  ('underwritten title company',    'title-escrow'),
  -- canonical labels map to themselves (future pages created with clean labels)
  ('financial institutions',        'financial-institutions'),
  ('mortgage companies',            'mortgage-companies'),
  ('private lenders & hard money',  'private-lenders'),
  ('commercial & multifamily finance','commercial-finance'),
  ('capital platforms & funds',     'capital-platforms'),
  ('family offices',                'family-offices'),
  ('family office',                 'family-offices'),
  ('private equity & credit',       'private-equity-credit'),
  ('private equity',                'private-equity-credit'),
  ('private credit',                'private-equity-credit'),
  ('sba & business lenders',        'sba-business-lenders'),
  ('sba lender',                    'sba-business-lenders'),
  ('commercial mortgage brokers',   'commercial-mortgage-brokers'),
  ('commercial mortgage broker',    'commercial-mortgage-brokers'),
  ('capital advisors & placement',  'capital-advisors'),
  ('capital advisor',               'capital-advisors'),
  ('financial advisors',            'financial-advisors'),
  ('financial advisor',             'financial-advisors'),
  ('financial planners',            'financial-planners'),
  ('financial planner',             'financial-planners'),
  ('wealth management',             'wealth-management'),
  ('wealth manager',                'wealth-management'),
  ('investment banking',            'investment-banking'),
  ('developers & builders',         'developers-builders'),
  ('homebuilder',                   'developers-builders'),
  ('investment firms & syndicators','investment-firms'),
  ('syndicator',                    'investment-firms'),
  ('property management',           'property-management'),
  ('title & escrow',                'title-escrow'),
  ('escrow company',                'title-escrow'),
  ('title company',                 'title-escrow'),
  ('appraisal & valuation',         'appraisal-valuation'),
  ('appraiser',                     'appraisal-valuation'),
  ('insurance',                     'insurance'),
  ('legal & 1031 exchange',         'legal-1031'),
  ('1031 exchange',                 'legal-1031'),
  ('real estate attorney',          'legal-1031'),
  ('accounting & tax',              'accounting-tax'),
  ('cpa',                           'accounting-tax'),
  ('proptech / fintech / ai',       'proptech-fintech'),
  ('proptech',                      'proptech-fintech'),
  ('fintech',                       'proptech-fintech')
on conflict (alias) do update set cat_slug=excluded.cat_slug;

-- ── RLS: reference data is public-read ─────────────────────────────────────
alter table public.pn_sections         enable row level security;
alter table public.pn_categories       enable row level security;
alter table public.pn_category_aliases enable row level security;

drop policy if exists pn_sections_read on public.pn_sections;
create policy pn_sections_read on public.pn_sections for select using (true);
drop policy if exists pn_categories_read on public.pn_categories;
create policy pn_categories_read on public.pn_categories for select using (true);
drop policy if exists pn_category_aliases_read on public.pn_category_aliases;
create policy pn_category_aliases_read on public.pn_category_aliases for select using (true);

grant select on public.pn_sections, public.pn_categories, public.pn_category_aliases to anon, authenticated;

-- ── Public directory view (companies, with section/category resolved) ──────
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
  coalesce(c.sort,  99)      as cat_sort
from public.presences p
left join public.pn_category_aliases a on a.alias = lower(btrim(p.category))
left join public.pn_categories c       on c.slug  = a.cat_slug
left join public.pn_sections   s       on s.slug  = c.section_slug
where p.presence_type = 'company'
  and p.status = 'active'
  and p.public_preview_enabled = true
  and p.visibility = 'public_preview';

-- ── Facet counts for section tabs + category chips (small; anon-safe) ───────
create or replace view public.public_business_facets as
select section_slug, section_label, section_sort, cat_slug, cat_label, cat_sort,
       count(*)::int as n
from public.public_business_directory
group by section_slug, section_label, section_sort, cat_slug, cat_label, cat_sort;

grant select on public.public_business_directory, public.public_business_facets to anon, authenticated;

notify pgrst, 'reload schema';
select 'business taxonomy ready' as status;
