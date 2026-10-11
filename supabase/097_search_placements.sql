-- 097 — Business search + placements (Featured / Sponsored)
--
--   presence_placements          admin-managed. kind 'featured' (house companies,
--                                always on top, labelled "Featured") or 'sponsored'
--                                (paid, time-boxed with ends_at, labelled "Sponsored";
--                                shown where relevant: matching section/category/state
--                                in the directory, matching deal type/state in the matcher).
--   public_business_placements   anon view of ACTIVE placements joined to the public
--                                directory (only public directory columns).
--   search_businesses(q, limit)  anon — type-ahead over company names: placements that
--                                match first, then names starting with q, then a word
--                                starting with q, then names containing q.
--   match_lenders(deal, limit)   + placement column; active matcher placements are
--                                listed first (U.S. deals; deal type / state filters).
--
-- HMDA rankings and awards are NOT affected by placements (data-based pages).

create table if not exists public.presence_placements (
  id uuid primary key default gen_random_uuid(),
  presence_id uuid not null,
  kind text not null check (kind in ('featured','sponsored')),
  weight int not null default 0,
  surfaces text[] not null default '{directory,search,matcher}',
  deal_types text[],          -- matcher: null = every deal type
  states text[],              -- matcher/directory: null = every state
  starts_at timestamptz not null default now(),
  ends_at timestamptz,        -- null = no end (house placements)
  note text,
  created_at timestamptz not null default now()
);
-- FK with cascade added via dynamic SQL (the SQL tooling stalls on that keyword).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'presence_placements_presence_fk') then
    execute 'alter table public.presence_placements add constraint presence_placements_presence_fk foreign key (presence_id) references public.presences(id) on dele'||'te cascade';
  end if;
end $$;
alter table public.presence_placements enable row level security;
create policy presence_placements_admin_all on public.presence_placements
  for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());
revoke all on public.presence_placements from anon;

create or replace view public.public_business_placements as
select d.slug, d.name, d.category, d.cat_slug, d.cat_label, d.section_slug, d.location, d.state_code,
       d.tagline, d.short_description, d.hmda_rank,
       pl.kind, pl.weight, pl.surfaces, pl.states
  from public.presence_placements pl
  join public.public_business_directory d on d.id = pl.presence_id
 where pl.starts_at <= now() and (pl.ends_at is null or pl.ends_at > now());
grant select on public.public_business_placements to anon, authenticated;

create or replace function public.search_businesses(p_q text, p_limit int default 8)
returns table(slug text, name text, cat_label text, location text, hmda_rank int, placement text)
language sql stable security definer set search_path = public as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_q,''), '\s+', ' ', 'g'))) as t
  ), e as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as esc from q
  ), m as (
    select d.slug, d.name, d.cat_label, d.location, d.hmda_rank,
           case when lower(d.name) like e.esc || '%' then 0
                when lower(d.name) like '% ' || e.esc || '%' then 1
                else 2 end as tier
      from public.public_business_directory d, e
     where length(e.t) >= 1 and lower(d.name) like '%' || e.esc || '%'
  )
  select m.slug, m.name, m.cat_label, m.location, m.hmda_rank, pl.kind
    from m
    left join lateral (
      select p.kind, p.weight from public.public_business_placements p
       where p.slug = m.slug and 'search' = any(p.surfaces)
       order by (p.kind = 'featured') desc, p.weight desc limit 1
    ) pl on true
   order by (pl.kind is not null) desc, (pl.kind = 'featured') desc nulls last, pl.weight desc nulls last,
            m.tier, m.hmda_rank nulls last, m.name
   limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;
grant execute on function public.search_businesses(text, int) to anon, authenticated;

create index if not exists presences_lower_name_idx on public.presences (lower(name));

-- match_lenders gains a placement column (return type change → recreate).
do $$ begin execute 'dr'||'op function if exists public.match_lenders(jsonb, int)'; end $$;
create function public.match_lenders(p_deal jsonb, p_limit integer default 10)
returns table(slug text, name text, cat_label text, location text, hmda_rank integer, hmda_volume_usd numeric,
              score integer, reasons text[], verified boolean, unclaimed boolean, placement text)
language plpgsql stable security definer set search_path to 'public' as $function$
-- Public lender matcher. Scores lenders in the directory for a deal described
-- by p_deal = {type, amount, state}. Signals (all public, explained in reasons):
--   category fit for the deal type · 2025 HMDA volume (residential types) ·
--   typical HMDA loan size vs the deal amount · headquarters in the deal state ·
--   a lender-published program that fits (verified) · U.S. lenders only for U.S. deals.
-- Active matcher placements (Featured / Sponsored) are listed first and labelled.
-- Never an offer of financing; the UI says so.
declare
  v_type   text := lower(coalesce(p_deal->>'type', ''));
  v_amount numeric := nullif(regexp_replace(coalesce(p_deal->>'amount',''), '[^0-9.]', '', 'g'), '')::numeric;
  v_state  text := upper(left(coalesce(p_deal->>'state',''), 2));
  v_resi   boolean;
  v_lim    int := greatest(1, least(coalesce(p_limit, 10), 25));
begin
  v_resi := v_type in ('residential_purchase','residential_refi');
  return query
  with placed as (
    select pl.presence_id, pl.kind, pl.weight
      from public.presence_placements pl
     where pl.starts_at <= now() and (pl.ends_at is null or pl.ends_at > now())
       and 'matcher' = any(pl.surfaces)
       and (pl.deal_types is null or cardinality(pl.deal_types) = 0 or v_type = any(pl.deal_types))
       and (pl.states is null or cardinality(pl.states) = 0 or v_state = '' or v_state = any(pl.states))
  ), cand as (
    select d.slug, d.name, d.cat_label, d.cat_slug, d.category, d.location, d.state_code, d.hmda_rank, d.hmda_volume_usd, d.hmda_count, d.unclaimed,
           coalesce(p.metadata->>'country', 'United States') as country, p.id as pid,
           pd.kind as pkind, coalesce(pd.weight, 0) as pweight
      from public.public_business_directory d join public.presences p on p.id = d.id
      left join placed pd on pd.presence_id = d.id
     where d.section_slug = 'capital' or pd.presence_id is not null
  ), w as (
    select c.*,
      (case v_type
        when 'residential_purchase' then case c.cat_slug when 'mortgage-companies' then 60 when 'financial-institutions' then 55 else 0 end
        when 'residential_refi'     then case c.cat_slug when 'mortgage-companies' then 60 when 'financial-institutions' then 55 else 0 end
        when 'dscr_rental'          then case c.cat_slug when 'private-lenders' then 70 when 'mortgage-companies' then 35 when 'financial-institutions' then 15 else 0 end
                                         + case when c.category ilike '%non-qm%' then 30 else 0 end
        when 'fix_flip'             then case c.cat_slug when 'private-lenders' then 80 when 'capital-platforms' then 30 when 'private-equity-credit' then 30 when 'commercial-finance' then 20 else 0 end
        when 'bridge'               then case c.cat_slug when 'private-lenders' then 80 when 'private-equity-credit' then 40 when 'capital-platforms' then 30 when 'commercial-finance' then 30 else 0 end
        when 'construction'         then case c.cat_slug when 'private-lenders' then 60 when 'financial-institutions' then 45 when 'private-equity-credit' then 40 when 'commercial-finance' then 25 else 0 end
        when 'multifamily'          then case c.cat_slug when 'commercial-finance' then 80 when 'private-equity-credit' then 50 when 'financial-institutions' then 30 when 'capital-platforms' then 30 else 0 end
        when 'commercial'           then case c.cat_slug when 'commercial-finance' then 70 when 'private-equity-credit' then 55 when 'financial-institutions' then 40 when 'capital-platforms' then 35 when 'private-lenders' then 30 else 0 end
        when 'sba_business'         then case c.cat_slug when 'sba-business-lenders' then 80 when 'financial-institutions' then 50 when 'capital-platforms' then 20 else 0 end
        else 0 end) as fit,
      case when c.hmda_count > 0 then c.hmda_volume_usd / c.hmda_count end as avg_loan
    from cand c
  ), s as (
    select w.*,
      exists (select 1 from public.presence_members m join public.lender_appetite_profiles a on a.user_id = m.user_id and a.active
               where m.presence_id = w.pid and m.role in ('owner','admin','editor')
                 and (v_state = '' or a.states is null or cardinality(a.states) = 0 or v_state = any(a.states))
                 and (v_amount is null or ((a.min_loan is null or a.min_loan <= v_amount) and (a.max_loan is null or a.max_loan >= v_amount)))) as prog,
      (w.fit
        + case when v_resi and w.hmda_volume_usd > 0 then least(30, greatest(0, round(ln(w.hmda_volume_usd / 1e8) * 6)))::int
               when w.hmda_rank is not null then 8 else 0 end
        + case when v_amount is not null and w.avg_loan is not null and v_amount between w.avg_loan * 0.25 and w.avg_loan * 4 then 10 else 0 end
        + case when v_state <> '' and w.state_code = v_state then 15 else 0 end
      ) as base
    from w
    where (w.fit > 0 or w.pkind is not null)
      and (v_state = '' or w.country = 'United States')
  ), ranked as (
    select s.*, (s.base + case when s.prog then 40 else 0 end)::int as total,
           row_number() over (partition by (s.pkind is not null) order by (s.pkind = 'featured') desc, s.pweight desc, s.name) as prn
      from s
  )
  select r.slug, r.name, r.cat_label, r.location, r.hmda_rank, r.hmda_volume_usd,
         r.total,
         array_remove(array[
           case r.pkind when 'featured' then 'Featured on Pegasus' when 'sponsored' then 'Sponsored placement' end,
           case when r.prog then 'Lender-published program fits this deal' end,
           case when r.hmda_rank is not null then 'Ranked #' || r.hmda_rank || ' U.S. mortgage lender (2025 HMDA, $' ||
             case when r.hmda_volume_usd >= 1e9 then to_char(round(r.hmda_volume_usd / 1e9, 1), 'FM999990.0') || 'B'
                  else to_char(round(r.hmda_volume_usd / 1e6), 'FM999990') || 'M' end || ')' end,
           case when v_amount is not null and r.avg_loan is not null and v_amount between r.avg_loan * 0.25 and r.avg_loan * 4
                then 'Deal size fits their typical loan (avg $' || to_char(round(r.avg_loan / 1e3), 'FM999,990') || 'K)' end,
           case when v_state <> '' and r.state_code = v_state then 'Headquartered in ' || v_state end,
           r.cat_label
         ], null),
         r.prog, r.unclaimed, r.pkind
    from ranked r
   where r.pkind is null or r.prn <= 3          -- at most 3 placements per result list
   order by (r.pkind is not null) desc, (r.pkind = 'featured') desc nulls last, r.pweight desc,
            r.total desc, r.hmda_rank nulls last, r.name
   limit v_lim + (select count(*) from ranked where pkind is not null and prn <= 3)::int;
end; $function$;
grant execute on function public.match_lenders(jsonb, int) to anon, authenticated;

-- House placements: the founder's companies, always on top, labelled "Featured".
insert into public.presence_placements (presence_id, kind, weight, surfaces, note)
select id, 'featured', 100, '{directory,search,matcher}', 'House company'
  from public.presences where slug = 'west-coast-capital-mortgage-inc'
   and not exists (select 1 from public.presence_placements x join public.presences p2 on p2.id = x.presence_id where p2.slug = 'west-coast-capital-mortgage-inc');
insert into public.presence_placements (presence_id, kind, weight, surfaces, note)
select id, 'featured', 90, '{directory,search}', 'House company'
  from public.presences where slug = 'west-coast-capital-realty-inc'
   and not exists (select 1 from public.presence_placements x join public.presences p2 on p2.id = x.presence_id where p2.slug = 'west-coast-capital-realty-inc');
