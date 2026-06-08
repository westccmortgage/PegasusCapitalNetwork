-- ============================================================================
-- 020 — Member CRM: private per-member contacts, deals pipeline, activity log,
-- follow-up reminders. Every row is owner-scoped via RLS (strictly private).
-- ============================================================================
create extension if not exists pgcrypto;

-- 1. Contacts -----------------------------------------------------------------
create table if not exists public.crm_contacts(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  company text,
  email text,
  phone text,
  contact_type text,                        -- lender / borrower / broker / etc (free text)
  source text not null default 'manual',    -- manual | pegasus_member | signup | import
  linked_profile_id uuid,                    -- optional public profiles.id
  tags text[] not null default '{}',
  notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_contacts_owner on public.crm_contacts(owner_id);

-- 2. Deals (pipeline) ---------------------------------------------------------
create table if not exists public.crm_deals(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  title text not null,
  amount numeric,
  stage text not null default 'lead'
    check (stage in ('lead','contacted','qualified','proposal','closed_won','closed_lost')),
  notes text,
  sort int not null default 0,
  expected_close date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_deals_owner on public.crm_deals(owner_id);
create index if not exists idx_crm_deals_stage on public.crm_deals(owner_id, stage);

-- 3. Activity log -------------------------------------------------------------
create table if not exists public.crm_activities(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','email','call','meeting','stage_change')),
  body text,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_act_owner on public.crm_activities(owner_id, created_at desc);

-- 4. Follow-up reminders ------------------------------------------------------
create table if not exists public.crm_reminders(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  title text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_rem_owner on public.crm_reminders(owner_id, due_at);

-- updated_at touch trigger
create or replace function public.crm_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_crm_contacts_touch on public.crm_contacts;
create trigger trg_crm_contacts_touch before update on public.crm_contacts
  for each row execute function public.crm_touch();
drop trigger if exists trg_crm_deals_touch on public.crm_deals;
create trigger trg_crm_deals_touch before update on public.crm_deals
  for each row execute function public.crm_touch();

-- RLS — strictly owner-only on every table
alter table public.crm_contacts   enable row level security;
alter table public.crm_deals       enable row level security;
alter table public.crm_activities  enable row level security;
alter table public.crm_reminders   enable row level security;

drop policy if exists crm_contacts_all on public.crm_contacts;
create policy crm_contacts_all on public.crm_contacts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists crm_deals_all on public.crm_deals;
create policy crm_deals_all on public.crm_deals for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists crm_activities_all on public.crm_activities;
create policy crm_activities_all on public.crm_activities for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists crm_reminders_all on public.crm_reminders;
create policy crm_reminders_all on public.crm_reminders for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Import other Pegasus members into the caller's CRM.
-- Public-safe fields only (name, company, role) — no emails/phones of other
-- members are exposed; the member fills contact details in themselves.
create or replace function public.crm_import_pegasus()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.crm_contacts(owner_id, name, company, contact_type, source, linked_profile_id)
  select auth.uid(),
         coalesce(nullif(btrim(p.full_name), ''), 'Pegasus Member'),
         p.company_name, p.role, 'pegasus_member', p.id
  from public.profiles p
  where p.id <> auth.uid()
    and not exists (
      select 1 from public.crm_contacts c
      where c.owner_id = auth.uid() and c.linked_profile_id = p.id
    );
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.crm_import_pegasus() to authenticated;
