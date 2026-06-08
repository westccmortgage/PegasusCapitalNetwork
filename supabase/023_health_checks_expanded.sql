-- ============================================================================
-- 023 — Expanded health checks (billing, entitlements, RLS, referrals, moderation)
-- Redefines _pegasus_health_compute() with the full check set. Resilient: each
-- block is guarded so a missing table never breaks the sweep.
-- ============================================================================
create or replace function public._pegasus_health_compute()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  issues jsonb := '[]'::jsonb;
  crit int := 0; warn int := 0; info int := 0;
  n int; r record; v_rls boolean;
begin
  -- ── Profile data ──────────────────────────────────────────────────────────
  begin select count(*) into n from public.profiles where coalesce(btrim(full_name),'')='';
    if n>0 then issues:=issues||jsonb_build_object('check','profiles_missing_name','severity','warning','count',n,'detail','Profiles with no display name'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.profiles where role is null;
    if n>0 then issues:=issues||jsonb_build_object('check','profiles_missing_role','severity','warning','count',n,'detail','Profiles with no role'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.profiles where coalesce(btrim(email),'')='';
    if n>0 then issues:=issues||jsonb_build_object('check','profiles_missing_email','severity','info','count',n,'detail','Profiles with no email (cannot be notified or recovered)'); info:=info+1; end if; exception when others then null; end;
  begin select count(*) into n from (select profile_slug from public.profiles where coalesce(btrim(profile_slug),'')<>'' group by profile_slug having count(*)>1) d;
    if n>0 then issues:=issues||jsonb_build_object('check','duplicate_slugs','severity','critical','count',n,'detail','Slugs shared by >1 profile — /u/<slug> ambiguous'); crit:=crit+1; end if; exception when others then null; end;
  begin select count(*) into n from public.profiles where coalesce(btrim(profile_slug),'')='';
    if n>0 then issues:=issues||jsonb_build_object('check','profiles_missing_slug','severity','info','count',n,'detail','No pretty slug; links fall back to ?id'); info:=info+1; end if; exception when others then null; end;

  -- ── Orphans / ownerless ───────────────────────────────────────────────────
  begin select count(*) into n from public.showcase_items s where not exists (select 1 from auth.users u where u.id=s.owner_id);
    if n>0 then issues:=issues||jsonb_build_object('check','orphan_showcase','severity','warning','count',n,'detail','Showcase items with no owner'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.crm_contacts c where not exists (select 1 from auth.users u where u.id=c.owner_id);
    if n>0 then issues:=issues||jsonb_build_object('check','orphan_crm','severity','warning','count',n,'detail','CRM contacts with no owner'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.deal_rooms where owner_id is null;
    if n>0 then issues:=issues||jsonb_build_object('check','deal_rooms_missing_owner','severity','critical','count',n,'detail','Deal rooms with no owner_id'); crit:=crit+1; end if; exception when others then null; end;

  -- ── Billing reconciliation ────────────────────────────────────────────────
  begin select count(*) into n from public.subscriptions where status='trialing' and trial_end is not null and trial_end < now();
    if n>0 then issues:=issues||jsonb_build_object('check','lapsed_trials','severity','warning','count',n,'detail','Trials past their end date, still marked trialing'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.subscriptions where status='past_due';
    if n>0 then issues:=issues||jsonb_build_object('check','past_due','severity','warning','count',n,'detail','Subscriptions past due (payment failing)'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.subscriptions where status='active' and tier<>'starter' and coalesce(stripe_subscription_id,'')='';
    if n>0 then issues:=issues||jsonb_build_object('check','paid_no_stripe','severity','warning','count',n,'detail','Active paid tier with no Stripe subscription on file'); warn:=warn+1; end if; exception when others then null; end;

  -- ── Entitlement drift ─────────────────────────────────────────────────────
  begin select count(*) into n from public.subscriptions s join public.memberships m on m.user_id=s.user_id where s.tier<>m.tier;
    if n>0 then issues:=issues||jsonb_build_object('check','tier_mismatch','severity','warning','count',n,'detail','subscriptions.tier and memberships.tier disagree'); warn:=warn+1; end if; exception when others then null; end;
  begin
    select count(*) into n from (
      select s.owner_id, count(*) cnt from public.showcase_items s where s.status in ('active','pending') group by s.owner_id
    ) x join public.plan_entitlements e on e.tier = public.current_tier(x.owner_id) where x.cnt > e.max_showcase;
    if n>0 then issues:=issues||jsonb_build_object('check','showcase_over_cap','severity','critical','count',n,'detail','Members with more live showcase items than their tier allows'); crit:=crit+1; end if;
  exception when others then null; end;

  -- ── RLS verification (private tables must stay locked) ─────────────────────
  for r in select unnest(array['profiles','crm_contacts','crm_deals','crm_activities','crm_reminders','deal_rooms','notifications','subscriptions','memberships','showcase_items','access_codes','code_redemptions']) as t loop
    begin
      select c.relrowsecurity into v_rls from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname=r.t;
      if v_rls is not null and v_rls=false then
        issues:=issues||jsonb_build_object('check','rls_disabled','severity','critical','count',1,'detail','Row-level security is OFF on '||r.t||' — private data exposed');
        crit:=crit+1;
      end if;
    exception when others then null; end;
  end loop;

  -- ── Referral integrity ────────────────────────────────────────────────────
  begin select count(*) into n from public.access_codes c where c.source='member_referral' and c.referred_by is not null and not exists (select 1 from public.profiles p where p.id=c.referred_by);
    if n>0 then issues:=issues||jsonb_build_object('check','referral_orphan','severity','warning','count',n,'detail','Referral codes whose referrer no longer exists'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.access_codes where usage_limit is not null and usage_count > usage_limit;
    if n>0 then issues:=issues||jsonb_build_object('check','code_over_limit','severity','warning','count',n,'detail','Access codes used beyond their usage limit'); warn:=warn+1; end if; exception when others then null; end;

  -- ── Moderation backlog ────────────────────────────────────────────────────
  begin select count(*) into n from public.showcase_items where status='flagged';
    if n>0 then issues:=issues||jsonb_build_object('check','showcase_flagged','severity','warning','count',n,'detail','Flagged showcase items awaiting review'); warn:=warn+1; end if; exception when others then null; end;
  begin select count(*) into n from public.showcase_items where status='pending';
    if n>0 then issues:=issues||jsonb_build_object('check','showcase_pending','severity','info','count',n,'detail','Showcase items pending moderation'); info:=info+1; end if; exception when others then null; end;

  return jsonb_build_object(
    'generated_at', now(),
    'status', case when crit>0 then 'critical' when warn>0 then 'degraded' else 'healthy' end,
    'critical', crit, 'warning', warn, 'info', info,
    'profiles_total', (select count(*) from public.profiles),
    'issues', issues
  );
end $$;
