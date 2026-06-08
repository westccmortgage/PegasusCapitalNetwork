-- ============================================================================
-- PEGASUS Migration 044 — referral RPCs (fixes get_or_create_referral_code 404)
--
-- The dashboard calls get_or_create_referral_code() / my_referral_stats() but
-- those functions were never created in this database (404). This is the
-- relevant slice of migration 021, made safe to run on its own.
--
-- It depends on the access_codes / code_redemptions tables. If those don't
-- exist, the functions are still created but return a clear, non-crashing
-- result so the dashboard stops erroring.
-- IDEMPOTENT.
-- ============================================================================
create extension if not exists pgcrypto;

do $$
declare
  has_codes boolean := exists(select 1 from information_schema.tables
                where table_schema='public' and table_name='access_codes');
begin
  if not has_codes then
    raise notice 'access_codes table missing — creating stub referral functions that no-op safely.';
  end if;
end $$;

-- A) Personal member referral code -------------------------------------------
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_uid uuid := auth.uid(); v_try int := 0; v_has_codes boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from information_schema.tables
           where table_schema='public' and table_name='access_codes') into v_has_codes;
  if not v_has_codes then return null; end if;  -- no referral graph yet; don't crash

  select code into v_code from public.access_codes
    where referred_by = v_uid and source = 'member_referral' and active = true
    order by created_at asc limit 1;
  if v_code is not null then return v_code; end if;

  loop
    v_try := v_try + 1;
    v_code := 'PEG-' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
    begin
      insert into public.access_codes(code, source, type, membership_tier, duration_days,
        usage_limit, active, created_by, referred_by, onboarding_flow, notes)
      values (v_code, 'member_referral', 'invitation', 'starter', 30,
        null, true, v_uid, v_uid, 'member_referral', 'Personal member referral link');
      return v_code;
    exception
      when unique_violation then if v_try > 8 then raise; end if;
      when others then return null;  -- column mismatch etc. — fail soft
    end;
  end loop;
end $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- B) Referral stats -----------------------------------------------------------
create or replace function public.my_referral_stats()
returns json language plpgsql security definer set search_path = public as $$
declare v_has_codes boolean; v_result json;
begin
  select exists(select 1 from information_schema.tables
           where table_schema='public' and table_name='access_codes') into v_has_codes;
  if not v_has_codes then
    return json_build_object('code', null, 'joined', 0);
  end if;
  select json_build_object(
    'code', (select code from public.access_codes
               where referred_by = auth.uid() and source='member_referral' and active=true
               order by created_at asc limit 1),
    'joined', coalesce((select count(*) from public.code_redemptions r
               join public.access_codes c on c.id = r.code_id
               where c.referred_by = auth.uid() and c.source='member_referral'),0)
  ) into v_result;
  return v_result;
exception when others then
  return json_build_object('code', null, 'joined', 0);
end $$;
grant execute on function public.my_referral_stats() to authenticated;

-- Reload PostgREST cache ------------------------------------------------------
notify pgrst, 'reload schema';

select proname from pg_proc
 where proname in ('get_or_create_referral_code','my_referral_stats')
 order by proname;
