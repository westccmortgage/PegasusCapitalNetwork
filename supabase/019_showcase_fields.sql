-- ============================================================================
-- 019 — Showcase editor enhancements: price/size/status/tags + draft support
-- Safe/additive. Lets members stage drafts (don't count toward the featured cap)
-- and publish when they have room.
-- ============================================================================
alter table public.showcase_items add column if not exists price              text;
alter table public.showcase_items add column if not exists size_detail        text;
alter table public.showcase_items add column if not exists opportunity_status text;
alter table public.showcase_items add column if not exists tags               text[] not null default '{}';

-- allow 'draft' as a status
alter table public.showcase_items drop constraint if exists showcase_items_status_check;
alter table public.showcase_items add constraint showcase_items_status_check
  check (status in ('active','hidden','flagged','pending','draft'));

-- drafts/hidden can be saved without consuming the featured cap;
-- only active/pending publishing is gated by can_add_showcase()
drop policy if exists sc_insert on public.showcase_items;
create policy sc_insert on public.showcase_items for insert to authenticated
  with check (
    owner_id = auth.uid()
    and admin_featured = false
    and ambassador_approved = false
    and (
      status in ('draft','hidden')
      or (status in ('active','pending') and public.can_add_showcase(auth.uid()))
    )
  );
