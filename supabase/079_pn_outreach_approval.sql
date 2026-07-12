-- ============================================================================
-- PEGASUS CALIFORNIA PARTNER NETWORK — LinkedIn Outreach Approval Queue (079)
-- ADDITIVE + IDEMPOTENT. Requires 011 (is_admin_user), 072.
--
-- Approval-based outreach workflow. Pegasus NEVER auto-connects or auto-sends
-- on LinkedIn. Outreach requires explicit admin approval; "Open LinkedIn" opens
-- the saved profile and copies the approved note — the human performs the final
-- send. A full audit trail (pn_outreach_events) records every action.
-- ============================================================================

create table if not exists public.pn_outreach_prospects(
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid references public.pn_agents(id) on delete set null,
  escrow_id         uuid references public.pn_escrow_title(id) on delete set null,
  name              text not null,
  company           text,
  title             text,
  linkedin_url      text,
  partner_score     numeric,
  why_relevant      text,
  activity_evidence text,
  connection_note   text,
  follow_up_message text,
  due_date          date,
  status            text not null default 'drafted'
                      check (status in ('drafted','ready_for_approval','approved','opened_in_linkedin',
                                        'sent','connected','replied','follow_up_due','not_interested','do_not_contact')),
  approved_by       uuid,
  approved_at       timestamptz,
  sent_at           timestamptz,
  connected_at      timestamptz,
  replied_at        timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_pn_prospects_status on public.pn_outreach_prospects(status, due_date);
create index if not exists idx_pn_prospects_agent on public.pn_outreach_prospects(agent_id);
drop trigger if exists trg_pn_prospects_touch on public.pn_outreach_prospects;
create trigger trg_pn_prospects_touch before update on public.pn_outreach_prospects
  for each row execute function public.pn_touch();

-- Audit trail: every status change / action on a prospect.
create table if not exists public.pn_outreach_events(
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.pn_outreach_prospects(id) on delete cascade,
  event_type   text not null,     -- generate_draft / edit / approve / reject / open_linkedin / copy_note / mark_sent / ...
  from_status  text,
  to_status    text,
  detail       text,
  actor        uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pn_events_prospect on public.pn_outreach_events(prospect_id, created_at desc);

-- Module settings (LinkedIn sending mode, etc.).
create table if not exists public.pn_settings(
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
insert into public.pn_settings(key, value)
  values ('linkedin_sending_mode', '{"mode":"manual"}'::jsonb)
  on conflict (key) do nothing;   -- default Manual; never auto-set to API

-- RLS: admin-only.
do $$
declare t text;
begin
  foreach t in array array['pn_outreach_prospects','pn_outreach_events','pn_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin_user()) with check (public.is_admin_user())',
      t||'_admin_all', t);
  end loop;
end $$;
