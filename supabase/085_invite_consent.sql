-- ============================================================================
-- PEGASUS Migration 085 — Invite consent capture (concierge onboarding)
--
-- Opt-in flow: an invited professional clicks "Yes — set up my profile" in the
-- email (a tokenized link). That records EXPLICIT CONSENT; only then do we build
-- a profile for them (concierge). People who do not click are never created.
-- Token = capability (unguessable), so the RPCs are reachable by anon but only
-- act on the row matching the token. No public table access otherwise.
--
-- Depends on: none beyond pgcrypto (gen_random_uuid). IDEMPOTENT.
-- ============================================================================

create table if not exists public.pn_invite_consent (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  email text not null,
  full_name text,
  company text,
  city text,
  state text,
  source text not null default 'invite',
  status text not null default 'invited',   -- invited | consented | opted_out
  consented_at timestamptz,
  opted_out_at timestamptz,
  profile_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_invite_consent_status on public.pn_invite_consent(status);

alter table public.pn_invite_consent enable row level security;
-- No public policies: all access via the SECURITY DEFINER RPCs below.

-- Records explicit consent for the row matching the (unguessable) token.
create or replace function public.record_invite_consent(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pn_invite_consent;
begin
  if p_token is null or length(p_token) < 10 then return jsonb_build_object('ok',false); end if;
  update public.pn_invite_consent
     set status='consented', consented_at=coalesce(consented_at, now())
   where token=p_token and status <> 'opted_out'
   returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false); end if;
  return jsonb_build_object('ok',true,'name',coalesce(v_row.full_name,''));
end; $$;
grant execute on function public.record_invite_consent(text) to anon, authenticated;

-- Records opt-out (unsubscribe) for the row matching the token.
create or replace function public.record_invite_optout(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pn_invite_consent;
begin
  if p_token is null or length(p_token) < 10 then return jsonb_build_object('ok',false); end if;
  update public.pn_invite_consent
     set status='opted_out', opted_out_at=now()
   where token=p_token
   returning * into v_row;
  return jsonb_build_object('ok', v_row.id is not null);
end; $$;
grant execute on function public.record_invite_optout(text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'invite consent ready' as status;
