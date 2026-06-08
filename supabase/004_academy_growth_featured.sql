-- ============================================================================
-- PEGASUS v70 — Academy, Live Capital Sessions, Growth Capital, Featured/Ambassador.
-- Idempotent. Run after 001 + 002 (+003 seed). Compliance-safe language only.
-- ============================================================================
create extension if not exists pgcrypto;

-- ── FEATURED / AMBASSADOR placement (profiles extension) ────────────────────
alter table public.profiles add column if not exists featured boolean default false;
alter table public.profiles add column if not exists featured_kind text;        -- 'ambassador' | 'featured' | 'speaker' | 'authority'
alter table public.profiles add column if not exists featured_rank int default 0;
alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists credibility_line text;

-- ── ACADEMY: speakers, sessions, registrations ──────────────────────────────
create table if not exists public.speakers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null, title text, organization text, bio text,
  avatar_color text, credentials text[] default '{}', is_featured boolean default false,
  created_at timestamptz default now()
);
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  kind text default 'live_capital_session'
    check (kind in ('live_capital_session','institutional_briefing','investor_roundtable','market_intelligence','capital_formation_workshop')),
  title text not null, summary text,
  speaker_id uuid references public.speakers(id) on delete set null,
  starts_at timestamptz, duration_min int default 60,
  min_tier text default 'pro' check (min_tier in ('starter','pro','gold')),  -- tier access requirement
  status text default 'scheduled' check (status in ('scheduled','live','replay','archived')),
  replay_url text, ai_summary text, seats_remaining int,
  created_at timestamptz default now()
);
create table if not exists public.session_registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text, email text, status text default 'reserved',
  created_at timestamptz default now(),
  unique(session_id, user_id)
);
alter table public.speakers enable row level security;
alter table public.sessions enable row level security;
alter table public.session_registrations enable row level security;
do $$ begin
  create policy spk_read on public.speakers for select using (true);
  create policy ses_read on public.sessions for select using (true);
  create policy sreg_self on public.session_registrations for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── GROWTH CAPITAL / EMERGING COMPANIES (compliance-safe) ───────────────────
-- Member-directed strategic capital relationships. NOT a public offering.
create table if not exists public.founder_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  company_name text not null, founder_name text, email text,
  sector text, stage text, location text,
  capital_sought numeric(14,2), use_of_funds text, traction text,
  deck_url text,                          -- Supabase Storage hook (no public offering docs)
  status text default 'submitted' check (status in ('submitted','reviewing','approved','declined')),
  admin_notes text, created_at timestamptz default now()
);
create table if not exists public.investor_appetite_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  is_showcase boolean default false,
  name text, sectors text[] default '{}', stages text[] default '{}',
  check_min numeric(14,2), check_max numeric(14,2), geographies text[] default '{}',
  thesis text, active boolean default true, created_at timestamptz default now()
);
-- Growth deal rooms reuse public.deal_rooms via a 'kind' tag
alter table public.deal_rooms add column if not exists kind text default 'real_estate'
  check (kind in ('real_estate','growth'));
alter table public.founder_submissions enable row level security;
alter table public.investor_appetite_profiles enable row level security;
do $$ begin
  create policy fs_owner on public.founder_submissions for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy iap_read on public.investor_appetite_profiles for select to authenticated
    using (active or user_id = auth.uid());
  create policy iap_write on public.investor_appetite_profiles for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- strategic alignment score for growth (reuses the pattern; informational only)
create or replace function public.score_growth(fnd public.founder_submissions, inv public.investor_appetite_profiles)
returns int language plpgsql immutable as $$
declare pts numeric:=0; mx numeric:=0;
begin
  mx:=40; if inv.sectors @> array[fnd.sector] then pts:=pts+40; end if;
  mx:=mx+30; if inv.stages @> array[fnd.stage] then pts:=pts+30; end if;
  mx:=mx+30; if fnd.capital_sought is null or (fnd.capital_sought>=coalesce(inv.check_min,0) and fnd.capital_sought<=coalesce(inv.check_max,1e12)) then pts:=pts+30; end if;
  return round((pts/mx)*100);
end $$;

-- ── EMAIL / NOTIFICATION HOOKS ──────────────────────────────────────────────
-- Pegasus has no standalone email service in v68; notifications are the in-app
-- layer (public.notifications + notify()). Outbound email is wired as a thin
-- hook: a row in email_outbox is picked up by a provider function/automation
-- (e.g., Supabase Edge `send-email` or Resend/SendGrid). This keeps a single
-- clean integration point instead of inventing a new system.
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null, template text not null,        -- welcome|payment_failed|deal_interest|match_found|seat_reserved|founder_received|admin_approval|verification_update
  payload jsonb default '{}', status text default 'queued' check (status in ('queued','sent','failed')),
  created_at timestamptz default now(), sent_at timestamptz
);
alter table public.email_outbox enable row level security;  -- service-role only (no client policy)
create or replace function public.queue_email(p_to text, p_template text, p_payload jsonb)
returns void language sql security definer set search_path=public as $$
  insert into public.email_outbox(to_email,template,payload) values (p_to,p_template,p_payload);
$$;

-- ── SEED: one upcoming Live Capital Session + featured speaker ──────────────
insert into public.speakers (name,title,organization,bio,avatar_color,is_featured)
values ('Dr. Elaine Hartmann','Professor of Real Estate Finance','Former Institutional Capital Allocator',
  'Two decades allocating institutional capital across development and structured credit.','#0E1A28',true)
on conflict do nothing;
insert into public.sessions (kind,title,summary,starts_at,min_tier,status,seats_remaining)
values ('live_capital_session','How Institutional Investors Evaluate Development Risk in 2026',
  'A market intelligence briefing on underwriting development risk in the current rate environment.',
  now() + interval '3 days', 'pro', 'scheduled', 40)
on conflict do nothing;
