-- ============================================================================
-- PEGASUS Migration 071 — Capital Intelligence "Analyst" staff role
-- IDEMPOTENT + ADDITIVE. Safe to run repeatedly. Requires 011 (is_admin_user),
-- 068 (pci_ core + RLS), 069 (import tables + RLS).
--
-- WHAT THIS ADDS
--   A second, lower-privilege staff role for the private Capital Intelligence
--   module, WITHOUT touching the binary admin model (profiles.is_admin /
--   role = 'admin') that guards the rest of the platform.
--
--   • profiles.pci_role — currently only 'analyst' (NULL = not staff).
--   • pci_is_staff()  — admin OR analyst. May READ every pci_ table.
--   • pci_can_edit()  — admin OR analyst. May INSERT/UPDATE the two entities an
--                       analyst curates by hand: pci_properties and
--                       pci_lender_programs.
--
--   CAPABILITY MATRIX
--     capability                         admin   analyst
--     ----------------------------------------------------
--     read all pci_ tables                yes      yes
--     add / edit properties (manual)      yes      yes
--     add / edit lender programs (manual) yes      yes
--     delete any pci_ row                 yes      NO
--     add loans/tenants/contacts/scores/  yes      NO
--       distress/actions/documents
--     import preview / commit / rollback  yes      NO   (service-role RPCs +
--                                                        full-admin functions)
--
--   The existing "<table>_admin_all" FOR ALL policies from 068/069 are LEFT
--   INTACT. Postgres ORs permissive policies, so the policies added here only
--   *widen* access for staff; admins keep everything they had. Analysts never
--   gain DELETE (only admin_all covers DELETE) and never gain write on any
--   table other than the two named above.
--
--   The import pipeline stays admin-only by construction: the commit/rollback
--   RPCs are EXECUTE-able only by service_role, and the Netlify functions
--   independently require is_admin / role='admin' (analysts get HTTP 403).
-- ============================================================================

-- 1. The staff-role column (never touched by profile editing; distinct from role).
alter table public.profiles
  add column if not exists pci_role text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
     where table_schema = 'public' and table_name = 'profiles'
       and constraint_name = 'profiles_pci_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_pci_role_check
      check (pci_role is null or pci_role in ('analyst'));
  end if;
end $$;

create index if not exists idx_profiles_pci_role
  on public.profiles(pci_role) where pci_role is not null;

-- 2. SECURITY DEFINER helpers — single source of truth, callable from RLS.
--    Mirrors is_admin_user() (011): reads the current user's own profile row.
create or replace function public.pci_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or role = 'admin' or pci_role = 'analyst'
       from public.profiles
      where id = auth.uid()
      limit 1),
    false
  );
$$;

-- Who may manually create/edit properties and lender programs.
-- (Same population as staff today; kept as its own function so the write
--  surface can diverge from the read surface later without touching RLS.)
create or replace function public.pci_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or role = 'admin' or pci_role = 'analyst'
       from public.profiles
      where id = auth.uid()
      limit 1),
    false
  );
$$;

-- 3. READ access for staff on every pci_ table (additive to *_admin_all).
do $$
declare t text;
begin
  foreach t in array array[
    'pci_properties','pci_property_contacts','pci_loans','pci_tenants',
    'pci_listings','pci_distress_signals','pci_lender_programs','pci_sources',
    'pci_scores','pci_daily_actions',
    'pci_import_batches','pci_import_rows','pci_change_log','pci_entity_sources'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_staff_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.pci_is_staff())',
      t||'_staff_select', t);
  end loop;
end $$;

-- 4. MANUAL WRITE access for staff on the two curated entities only.
--    INSERT + UPDATE (never DELETE — DELETE remains admin-only via *_admin_all).
do $$
declare t text;
begin
  foreach t in array array['pci_properties','pci_lender_programs'] loop
    execute format('drop policy if exists %I on public.%I', t||'_staff_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.pci_can_edit())',
      t||'_staff_insert', t);
    execute format('drop policy if exists %I on public.%I', t||'_staff_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.pci_can_edit()) with check (public.pci_can_edit())',
      t||'_staff_update', t);
  end loop;
end $$;

-- 5. Promote analysts by email here (optional — you can also run the UPDATE
--    yourself whenever you onboard someone). Left commented so this migration
--    grants nobody by default.
--
--    update public.profiles set pci_role = 'analyst'
--     where lower(email) = 'analyst@example.com';
--
--    To revoke:  update public.profiles set pci_role = null where lower(email) = '...';
--    To promote an analyst to full admin: set is_admin = true (pci_role is ignored once admin).

-- 6. Verify — who is staff, and at what level.
select id, email, role, is_admin, pci_role,
       (is_admin or role = 'admin')            as full_admin,
       (is_admin or role = 'admin'
        or pci_role = 'analyst')               as pci_staff
  from public.profiles
 where is_admin = true or role = 'admin' or pci_role is not null
 order by full_admin desc, email;
