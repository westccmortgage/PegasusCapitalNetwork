-- ============================================================================
-- PEGASUS NETWORK v69 — Seed (003). Structured, believable reference data.
-- Showcase lender appetite profiles render in directory + Match Engine
-- without requiring signup. Idempotent on name.
-- ============================================================================
insert into public.lender_appetite_profiles
  (is_showcase,name,loan_types,states,asset_types,min_loan,max_loan,max_ltv,dscr_min,construction_ok,bridge_ok,pref_sponsor_years,rate_from,active)
values
 (true,'Velocity Capital Partners', '{Construction,Bridge,DSCR}','{TX,FL,AZ}','{Multifamily,Mixed-Use,Retail}',1000000,15000000,80,1.20,true,true,3,'10.25%',true),
 (true,'Meridian Non-QM Fund',      '{DSCR,Bridge}','{ALL}','{Multifamily,SFR,Retail}',500000,5000000,80,1.10,false,true,1,'7.00%',true),
 (true,'Lone Star Construction',    '{Construction}','{TX}','{Multifamily,Mixed-Use}',2000000,25000000,82,1.15,true,false,5,'10.50%',true),
 (true,'Pacific Multifamily Capital','{DSCR,Permanent}','{ALL}','{Multifamily}',1000000,30000000,75,1.25,false,false,2,'7.25%',true),
 (true,'Keystone Bridge & DSCR',    '{Bridge,DSCR}','{ALL}','{Multifamily,Mixed-Use,Office}',500000,10000000,78,1.15,false,true,2,'7.50%',true),
 (true,'Atlas Capital Group',       '{Mezz,Equity,Bridge}','{ALL}','{Multifamily,Mixed-Use}',2000000,50000000,90,1.10,true,true,4,'12.00%',true)
on conflict do nothing;

-- ensure plan_entitlements exist (defined in 001; safe re-assert)
insert into public.plan_entitlements(tier,deal_rooms,ai_queries,match_requests,match_engine,analytics,featured)
values ('starter',0,20,2,'none','basic',false),
       ('pro',2,-1,20,'standard','enhanced',false),
       ('gold',-1,-1,-1,'full','institutional',true)
on conflict (tier) do nothing;
