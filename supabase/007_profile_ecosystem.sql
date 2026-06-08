-- ============================================================================
-- 007 — Profile Ecosystem layer (additive, safe to re-run)
-- Adds media + reputation columns and a Supabase Storage bucket for uploads.
-- Does NOT alter existing columns, policies, or tables beyond ADD COLUMN.
-- ============================================================================

-- ── Media + identity columns ────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists professional_title text;
alter table public.profiles add column if not exists current_focus text;
alter table public.profiles add column if not exists credentials jsonb default '[]';
alter table public.profiles add column if not exists featured_modules jsonb default '[]';

-- ── Reputation columns ──────────────────────────────────────────────────────
alter table public.profiles add column if not exists ambassador_status boolean default false;
alter table public.profiles add column if not exists featured_status boolean default false;
alter table public.profiles add column if not exists reputation_tags text[] default '{}';
-- Lightweight activity log (member-owned, append-only feel)
create table if not exists public.profile_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,            -- 'session_joined','deal_room_opened','lender_interest', etc.
  label text not null,
  meta jsonb default '{}',
  created_at timestamptz default now()
);
alter table public.profile_activity enable row level security;
do $$ begin
  create policy pa_owner_read on public.profile_activity for select to authenticated
    using (user_id = auth.uid());
  create policy pa_public_read on public.profile_activity for select to anon using (true);
  create policy pa_owner_write on public.profile_activity for insert to authenticated
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
create index if not exists idx_pa_user on public.profile_activity(user_id, created_at desc);

-- ── Storage bucket for avatars/banners/media (public read) ──────────────────
insert into storage.buckets (id, name, public)
values ('profile-media', 'profile-media', true)
on conflict (id) do nothing;

-- Storage RLS: anyone can read; owner can write to their own folder {uid}/...
do $$ begin
  create policy "profile-media public read" on storage.objects for select
    using (bucket_id = 'profile-media');
  create policy "profile-media owner write" on storage.objects for insert to authenticated
    with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "profile-media owner update" on storage.objects for update to authenticated
    using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "profile-media owner delete" on storage.objects for delete to authenticated
    using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

select 'profile ecosystem migration complete' as status;

-- ── Public anon read policy — required for member directory & public profiles ──
-- Visitors can read profiles without logging in.
do $$ begin
  create policy profiles_public_read on public.profiles
    for select to anon using (true);
exception when duplicate_object then null; end $$;

-- Public slugs readable anonymously
create index if not exists idx_profile_slug on public.profiles(profile_slug) where profile_slug is not null;

-- ── Homepage Events table (Event of the Month) ────────────────────────────
create table if not exists public.homepage_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type text default 'webinar',  -- webinar, session, workshop, summit, roundtable
  event_date date,
  event_time time,
  host text,
  speaker text,
  description text,
  cta_label text default 'Register →',
  cta_url text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.homepage_events enable row level security;
do $$ begin
  create policy hpe_public_read on public.homepage_events for select to anon using (active = true);
  create policy hpe_admin_all on public.homepage_events for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Seed: insert placeholder event of the month so the card shows immediately
insert into public.homepage_events (title, event_type, event_date, event_time, host, description, cta_label, cta_url, active)
values (
  'Private Credit Strategies for Residential Brokers',
  'webinar',
  current_date + interval '6 days',
  '14:00',
  'Pegasus Capital Intelligence · Hosted by Anatoliy Kanevsky',
  'Join this live session covering alternative financing structures, bridge loan mechanics, and how residential brokers can tap private credit networks in today''s rate environment. Q&A included.',
  'Register Free →',
  '/webinars.html',
  true
)
on conflict do nothing;
