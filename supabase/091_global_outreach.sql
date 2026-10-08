-- ============================================================================
-- PEGASUS Migration 091 — Global outreach queue (server-sent, ramped, self-pausing)
--
-- Source: "Pegasus Capital Network — Global Professional Prospects" (verified
-- current roles + PUBLISHED business contacts on official company sites).
-- Pipeline:
--   1. pn_outreach_staging is loaded with one row per unique inbox (direct or
--      general), after exclusions: DE/AT/CH/LI (prior-consent jurisdictions),
--      dead domains (no MX/A), personal free-mail addresses.
--   2. Companies → public, claimable company pages (presences), skipping names
--      already in the directory (peg_normalize_name).
--   3. Inboxes → pn_invite_consent (source 'global_2026_10', status 'invited',
--      never sent), skipping anyone already invited, members, do-not-contact.
--   4. outreach-sender (Netlify, hourly) sends one plain-text invitation per
--      inbox at the ramped cap in pn_settings 'outreach_global', checks
--      delivery in Resend and auto-pauses on bounces/complaints.
-- ADDITIVE. Columns are IF NOT EXISTS; steps 2–3 are idempotent (NOT EXISTS).
-- ============================================================================

alter table public.pn_invite_consent
  add column if not exists resend_id text,
  add column if not exists delivery_status text,
  add column if not exists delivery_checked_at timestamptz,
  add column if not exists priority int;

create table if not exists public.pn_outreach_staging (
  email text, first_name text, full_name text, title text, company text, company_website text,
  city text, country text, category text, source_url text, mailbox text, also_at_company int,
  state_code text, location text, cat_label text, descr text
);
alter table public.pn_outreach_staging enable row level security;

insert into public.pn_settings(key, value, updated_at) values ('outreach_global', jsonb_build_object(
  'source','global_2026_10','paused',false,'start_date','2026-10-09',
  'ramp', jsonb_build_array(jsonb_build_object('from_day',0,'cap',30), jsonb_build_object('from_day',3,'cap',50), jsonb_build_object('from_day',7,'cap',80)),
  'send_hours_utc', jsonb_build_array(14,22), 'max_bounce_rate',0.05, 'max_complaints',1, 'min_sample',40), now())
on conflict (key) do nothing;

-- ── 2. Company pages ─────────────────────────────────────────────────────────
insert into public.presences (presence_type, owner_user_id, created_by_user_id, name, slug, short_description,
  category, industry, location, market, website_url, public_cta_label, public_cta_url,
  visibility, status, public_preview_enabled, show_owner_publicly, metadata)
select distinct on (public.peg_normalize_name(s.company))
  'company', '751a15a1-01e9-4f21-a9c8-57f83f12bb82', '751a15a1-01e9-4f21-a9c8-57f83f12bb82',
  btrim(s.company),
  trim(both '-' from left(lower(regexp_replace(btrim(s.company), '[^a-zA-Z0-9]+', '-', 'g')), 60)) || '-' || substr(md5(random()::text), 1, 5),
  s.descr, s.cat_label, 'Real Estate', s.location, coalesce(s.state_code, s.country),
  nullif(s.company_website, ''), case when coalesce(s.company_website,'') <> '' then 'Visit website' end, nullif(s.company_website, ''),
  'public_preview', 'active', true, false,
  jsonb_build_object('source','global_prospects_2026_10','unclaimed',true,'country',s.country,
                     'note','Directory listing — public business info from the company website')
from public.pn_outreach_staging s
where coalesce(btrim(s.company), '') <> ''
  and not exists (select 1 from public.presences p
                   where p.presence_type = 'company'
                     and public.peg_normalize_name(p.name) = public.peg_normalize_name(s.company))
order by public.peg_normalize_name(s.company), (s.mailbox = 'direct') desc;

-- ── 3. Invitation queue ──────────────────────────────────────────────────────
insert into public.pn_invite_consent (token, email, full_name, company, city, state, source, status, metadata, send_count, priority)
select replace(gen_random_uuid()::text, '-', ''), s.email, s.full_name, s.company, s.location, s.country,
       'global_2026_10', 'invited',
       jsonb_build_object('first_name', s.first_name, 'title', s.title, 'mailbox', s.mailbox, 'cat_label', s.cat_label,
                          'presence_slug', pr.slug, 'state_code', s.state_code, 'also_at_company', s.also_at_company,
                          'source_url', s.source_url,
                          'source_domain', lower(regexp_replace(coalesce(s.source_url,''), '^https?://(www\.)?([^/:?#]+).*$', '\2'))),
       0,
       case when s.mailbox = 'direct' and s.country in ('United States','Canada','United Kingdom','Australia','New Zealand','Ireland','Singapore','United Arab Emirates','South Africa','India') then 1
            when s.mailbox = 'direct' then 2
            when s.country in ('United States','Canada','United Kingdom','Australia','New Zealand','Ireland','Singapore','United Arab Emirates','South Africa','India') then 3
            else 4 end
from public.pn_outreach_staging s
left join lateral (
  select p.slug from public.presences p
   where p.presence_type = 'company' and public.peg_normalize_name(p.name) = public.peg_normalize_name(s.company)
   order by p.created_at limit 1) pr on true
where s.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  and not exists (select 1 from public.pn_invite_consent c where lower(c.email) = s.email)
  and not exists (select 1 from public.profiles m where lower(m.email) = s.email)
  and not exists (select 1 from public.pn_do_not_contact d where lower(d.email) = s.email);

-- ── 4. Staging is transient ──────────────────────────────────────────────────
drop table if exists public.pn_outreach_staging;
