-- ============================================================================
-- 027 — New member notification log
-- Trigger on auth.users fires on signup → inserts into public.member_log
-- → Supabase Database Webhook calls Netlify function → Resend email to admin
-- ============================================================================

create table if not exists public.member_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  created_at timestamptz default now()
);

create index if not exists idx_member_log_created on public.member_log(created_at desc);

-- trigger function: copies email from auth.users on every new signup
create or replace function public._on_new_auth_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.member_log(user_id, email) values (NEW.id, NEW.email);
  return NEW;
end $$;

-- attach to auth.users (idempotent: drop first)
drop trigger if exists on_new_auth_user on auth.users;
create trigger on_new_auth_user
  after insert on auth.users
  for each row execute function public._on_new_auth_user();
