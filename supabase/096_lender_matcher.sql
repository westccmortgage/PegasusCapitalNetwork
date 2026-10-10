-- ============================================================================
-- PEGASUS Migration 096 — Lender Matcher (applied to the live project 2026-10-10)
--
--   match_lenders(p_deal jsonb, p_limit)  anon — scores directory lenders for a
--     deal {type, amount, state}: category fit per deal type, 2025 HMDA volume
--     (residential), typical HMDA loan size vs amount, HQ in the deal state,
--     lender-published programs (lender_appetite_profiles of page managers →
--     "verified"), U.S. lenders only for U.S. deals. Returns reasons[].
--   pn_deal_requests / pn_deal_request_targets  (RLS on, no policies)
--   submit_deal_request(p_deal, p_slugs[], p_share_contact)  signed-in, ≤10
--     lenders, ≤5/day; notifies managers of claimed targets + admins.
--   get_presence_request_count(slug, days)  anon — claim prompt on pages.
--   get_my_lender_requests(limit)  lender inbox (contact only when shared).
--   admin_list_deal_requests(limit)  admin.
--
-- Function bodies: see the live database (pg_get_functiondef); this file
-- records the objects and grants for reproducibility.
-- ============================================================================
create table if not exists public.pn_deal_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  deal jsonb not null,
  share_contact boolean not null default false,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.pn_deal_request_targets (
  request_id uuid not null references public.pn_deal_requests(id) on delete cascade,
  presence_id uuid not null references public.presences(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, presence_id)
);
alter table public.pn_deal_requests enable row level security;
alter table public.pn_deal_request_targets enable row level security;
create index if not exists idx_pdrt_presence on public.pn_deal_request_targets(presence_id, created_at desc);

grant execute on function public.match_lenders(jsonb, int) to anon, authenticated;
grant execute on function public.get_presence_request_count(text, int) to anon, authenticated;
grant execute on function public.submit_deal_request(jsonb, text[], boolean), public.get_my_lender_requests(int), public.admin_list_deal_requests(int) to authenticated;
revoke execute on function public.submit_deal_request(jsonb, text[], boolean), public.get_my_lender_requests(int), public.admin_list_deal_requests(int) from anon;
