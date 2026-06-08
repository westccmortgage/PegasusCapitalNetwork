-- ============================================================================
-- PEGASUS Migration 017 — Showcase System (Curated Member Visibility Layer)
-- IDEMPOTENT. Safe to run multiple times.
--
-- A prestige/visibility layer attached to each member profile. NOT an open
-- listing feed. Members publish a LIMITED number of Featured Opportunities,
-- gated by access layer (Starter 1 / Pro 3 / Gold 5). Admins moderate.
--
-- Mirrors the deal-room entitlement pattern: current_tier() -> plan_entitlements
-- -> active_showcase_count() -> can_add_showcase() enforced in the INSERT policy.
-- ============================================================================

-- 1. Entitlement column: max featured showcase items per tier -----------------
alter table public.plan_entitlements add column if not exists max_showcase int not null default 0;

update public.plan_entitlements set max_showcase = 1 where tier = 'starter';
update public.plan_entitlements set max_showcase = 3 where tier = 'pro';
update public.plan_entitlements set max_showcase = 5 where tier = 'gold';

-- 2. showcase_items -----------------------------------------------------------
create table if not exists public.showcase_items (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id) on delete cascade,
  title                text not null,
  summary              text,
  category             text,                       -- opportunity|listing|program|project|service|offering|capital
  location             text,
  image_url            text,
  cta_label            text,
  cta_url              text,
  badge                text not null default 'featured'
                         check (badge in ('off_market','featured','institutional','growth_capital','verified','ambassador_reviewed','none')),
  status               text not null default 'active'
                         check (status in ('active','hidden','flagged','pending')),
  admin_featured       boolean not null default false,   -- admin "Featured Placement"
  ambassador_approved  boolean not null default false,   -- admin approves ambassador-reviewed badge
  sort                 int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_sc_owner    on public.showcase_items(owner_id);
create index if not exists idx_sc_status   on public.showcase_items(status);
create index if not exists idx_sc_featured on public.showcase_items(admin_featured) where admin_featured = true;

-- 3. Tier-gate helpers (parallel to deal-room functions) ----------------------
create or replace function public.active_showcase_count(uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.showcase_items
   where owner_id = uid and status in ('active','pending');
$$;

create or replace function public.can_add_showcase(uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare mx int; cnt int; t text;
begin
  t := public.current_tier(uid);
  select max_showcase into mx from public.plan_entitlements where tier = t;
  if mx is null then
    mx := case t when 'gold' then 5 when 'pro' then 3 else 1 end;   -- null-safe fallback
  end if;
  if mx = -1 then return true; end if;                              -- (unlimited, unused today)
  if mx = 0  then return false; end if;
  select public.active_showcase_count(uid) into cnt;
  return coalesce(cnt,0) < mx;
end; $$;

-- 4. RLS ----------------------------------------------------------------------
alter table public.showcase_items enable row level security;

-- Public discovery: anyone may read ACTIVE items (this is the visibility layer).
-- Owners always see their own (any status); admins see everything.
drop policy if exists sc_select on public.showcase_items;
create policy sc_select on public.showcase_items for select to anon, authenticated
  using (
    status = 'active'
    or owner_id = auth.uid()
    or public.is_admin_user()
  );

-- Insert: owner only, tier-gated, and may not self-assign moderation flags.
drop policy if exists sc_insert on public.showcase_items;
create policy sc_insert on public.showcase_items for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.can_add_showcase(auth.uid())
    and status in ('active','pending')
    and admin_featured = false
    and ambassador_approved = false
  );

-- Update / delete: owner manages own; admins moderate all.
drop policy if exists sc_update on public.showcase_items;
create policy sc_update on public.showcase_items for update to authenticated
  using (owner_id = auth.uid() or public.is_admin_user())
  with check (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists sc_delete on public.showcase_items;
create policy sc_delete on public.showcase_items for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin_user());

-- 5. keep updated_at fresh ----------------------------------------------------
create or replace function public.touch_showcase()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_sc_touch on public.showcase_items;
create trigger trg_sc_touch before update on public.showcase_items
  for each row execute function public.touch_showcase();

-- 6. Admin moderation RPC — feature / hide / approve / restore ---------------
--    (admins also have direct UPDATE via RLS; this RPC is a clean, auditable API)
create or replace function public.moderate_showcase(p_id uuid, p_action text)
returns public.showcase_items
language plpgsql volatile security definer set search_path = public as $$
declare r public.showcase_items%rowtype;
begin
  if not public.is_admin_user() then raise exception 'not_admin'; end if;
  update public.showcase_items set
    status              = case p_action when 'hide' then 'hidden'
                                        when 'restore' then 'active'
                                        when 'flag' then 'flagged'
                                        else status end,
    admin_featured      = case p_action when 'feature' then true
                                        when 'unfeature' then false
                                        else admin_featured end,
    ambassador_approved = case p_action when 'approve_ambassador' then true
                                        else ambassador_approved end,
    badge               = case p_action when 'approve_ambassador' then 'ambassador_reviewed'
                                        else badge end
  where id = p_id
  returning * into r;
  return r;
end; $$;

grant execute on function public.active_showcase_count(uuid) to authenticated;
grant execute on function public.can_add_showcase(uuid)      to authenticated;
grant execute on function public.moderate_showcase(uuid, text) to authenticated;

-- 7. Verify -------------------------------------------------------------------
select tier, max_showcase from public.plan_entitlements order by max_showcase;
