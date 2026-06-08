-- ============================================================================
-- 037 — admin_generate_missing_slugs()
--
-- Generates profile_slug for every profile where it is NULL or empty.
-- Runs as SECURITY DEFINER so it bypasses row-level security and can
-- update any profile regardless of who the caller is.
--
-- Called by the Platform Health "Fix All" button so the admin can fix
-- all missing public URL slugs in one click without needing to edit
-- each user's profile individually.
--
-- Slug rules:
--   - Derived from full_name (lowercase, spaces → hyphens, non-ASCII stripped)
--   - Cyrillic characters transliterated to Latin
--   - If a collision exists, appends the first 4 chars of the profile UUID
--   - Falls back to "member-<first 6 chars of id>" if name produces empty slug
--
-- Returns: integer count of profiles updated
-- ============================================================================

create or replace function public.admin_generate_missing_slugs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec         record;
  base_slug   text;
  final_slug  text;
  counter     integer := 0;
  collision   integer;
begin
  -- Caller must be admin
  if not coalesce(public.is_admin_user(), false) then
    raise exception 'Admin access required';
  end if;

  for rec in
    select id, full_name
    from   public.profiles
    where  (profile_slug is null or profile_slug = '')
      and  full_name is not null
      and  full_name <> ''
  loop
    -- Build base slug from full_name
    -- 1. Lowercase
    base_slug := lower(rec.full_name);

    -- 2. Cyrillic → Latin transliteration
    base_slug := translate(base_slug,
      'абвгдежзийклмнопрстуфхцчшщыьэюяё',
      'abvgdezhziklmnoprstufhtschschyeyuyae');

    -- 3. Replace non-alphanumeric (except hyphens/spaces) with nothing
    base_slug := regexp_replace(base_slug, '[^a-z0-9\s\-]', '', 'g');

    -- 4. Collapse spaces and hyphens
    base_slug := trim(regexp_replace(base_slug, '\s+', '-', 'g'));
    base_slug := regexp_replace(base_slug, '\-+', '-', 'g');
    base_slug := trim(both '-' from base_slug);

    -- 5. Fallback
    if base_slug = '' then
      base_slug := 'member-' || left(rec.id::text, 6);
    end if;

    -- 6. Collision check
    final_slug := base_slug;
    select count(*) into collision
    from public.profiles
    where profile_slug = final_slug
      and id <> rec.id;

    if collision > 0 then
      final_slug := base_slug || '-' || left(rec.id::text, 4);
    end if;

    -- 7. Update
    update public.profiles
    set    profile_slug = final_slug
    where  id = rec.id;

    counter := counter + 1;
  end loop;

  return counter;
end;
$$;

grant execute on function public.admin_generate_missing_slugs() to authenticated;

select 'admin_generate_missing_slugs() ready' as status;
