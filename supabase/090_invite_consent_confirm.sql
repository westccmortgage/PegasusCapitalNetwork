-- ============================================================================
-- PEGASUS Migration 090 — Consent must come from a human click
--
-- Finding (2026-10-07): the 2026-10-05 broadcast produced "Yes" clicks 25–121 s
-- after delivery, "Unsubscribe" clicks on the same recipients when the
-- activation email arrived, and "sign-ins" seconds after each activation send —
-- the signature of mail security scanners (Safe Links / Proofpoint) opening
-- every link. GET links therefore recorded consent and burned one-time links.
--
-- Fix:
--   * confirm_invite_consent(token|email) — called ONLY from the POST of the
--     /yes confirmation page; tags metadata.consent_method='confirmed'.
--     concierge-build provisions only confirmed rows.
--   * Concierge-built profiles are created with status='pending' and stay off
--     every public surface (directory, sitemap, /u/ pages, members list) until
--     the person activates via /activate (button → fresh magic link).
--   * Accounts provisioned from the scanner "consents" are set to 'pending'.
--
-- IDEMPOTENT. Requires 085.
-- ============================================================================

create or replace function public.confirm_invite_consent(p_token text default null, p_email text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.pn_invite_consent;
begin
  if p_token is not null and length(p_token) >= 10 then
    update public.pn_invite_consent
       set status = 'consented', consented_at = coalesce(consented_at, now()),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('consent_method', 'confirmed', 'confirmed_at', now())
     where token = p_token and status <> 'opted_out'
     returning * into v_row;
  elsif p_email is not null and position('@' in p_email) > 0 then
    update public.pn_invite_consent
       set status = 'consented', consented_at = coalesce(consented_at, now()),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('consent_method', 'confirmed', 'confirmed_at', now())
     where lower(email) = lower(btrim(p_email)) and status <> 'opted_out'
     returning * into v_row;
  end if;
  if v_row.id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'name', coalesce(v_row.full_name, ''));
end;
$$;
grant execute on function public.confirm_invite_consent(text, text) to anon, authenticated;

-- Hide accounts created from unconfirmed (scanner) consents until activated.
update public.profiles p set status = 'pending', updated_at = now()
  from public.pn_invite_consent c, auth.users u
 where c.profile_id = p.id and u.id = p.id and c.provisioned_at is not null
   and u.invited_at is not null and p.status = 'active'
   and coalesce(c.metadata->>'consent_method', '') <> 'confirmed';
