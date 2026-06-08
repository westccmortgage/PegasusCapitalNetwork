-- ============================================================================
-- 021 — Referral engine + notifications
-- Reuses the existing access_codes / code_redemptions referral graph. Each
-- member gets a personal referral code (source='member_referral'); when someone
-- joins through it, the existing redemption flow attributes it and a trigger
-- notifies the referrer. Adds a real notifications table for the in-app bell
-- and the weekly digest.
-- ============================================================================
create extension if not exists pgcrypto;

-- A) Personal member referral code (lazily created, reused thereafter) --------
create or replace function public.get_or_create_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_uid uuid := auth.uid(); v_try int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
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
    exception when unique_violation then
      if v_try > 8 then raise; end if;
    end;
  end loop;
end $$;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- B) Referral stats for the calling member -----------------------------------
create or replace function public.my_referral_stats()
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'code', (select code from public.access_codes
               where referred_by = auth.uid() and source='member_referral' and active=true
               order by created_at asc limit 1),
    'joined', coalesce((select count(*) from public.code_redemptions r
               join public.access_codes c on c.id = r.code_id
               where c.referred_by = auth.uid() and c.source='member_referral'),0)
  );
$$;
grant execute on function public.my_referral_stats() to authenticated;

-- C) Notifications table ------------------------------------------------------
create table if not exists public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on public.notifications(user_id, read, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
-- inserts only via SECURITY DEFINER helpers/triggers below (no insert policy)

create or replace function public.create_notification(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into public.notifications(user_id, kind, title, body, link)
  values (p_user, coalesce(p_kind,'info'), p_title, p_body, p_link) returning id into nid;
  return nid;
end $$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications set read = true where user_id = auth.uid() and read = false;
$$;
grant execute on function public.mark_notifications_read() to authenticated;

-- D) Notify the referrer when their code is redeemed --------------------------
create or replace function public.trg_referral_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_name text;
begin
  select c.referred_by into v_ref from public.access_codes c
    where c.id = new.code_id and c.source = 'member_referral';
  if v_ref is not null and v_ref <> new.user_id then
    select coalesce(nullif(btrim(full_name),''),'A new member') into v_name
      from public.profiles where id = new.user_id;
    perform public.create_notification(v_ref, 'referral',
      'Your referral joined Pegasus',
      coalesce(v_name,'A new member') || ' joined through your invite link.',
      '/get-started.html');
  end if;
  return new;
end $$;
drop trigger if exists referral_notify on public.code_redemptions;
create trigger referral_notify after insert on public.code_redemptions
  for each row execute function public.trg_referral_notify();
