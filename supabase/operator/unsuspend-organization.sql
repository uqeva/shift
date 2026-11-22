-- unsuspend-organization.sql — OPERATOR TASK, run by hand (story 19.5, AD-25).
--
-- Restores one suspended organization, named by its slug:
-- `organizations.suspended` becomes false and nothing else changes. Its
-- members sign in again with what they had; nothing was deleted while it was
-- suspended. Notifications settled `ORGANIZATION_SUSPENDED` meanwhile are not
-- sent again, and reminders that fell due meanwhile were never written.
--
-- Run it over the tailnet with the database password (DEPLOY.md §9.10):
--
--   PGOPTIONS="-c shift.organization_slug=<slug>" \
--     psql -v ON_ERROR_STOP=1 "<the stack's database URL>" -f supabase/operator/unsuspend-organization.sql
--
-- Locally: `PGOPTIONS="-c shift.organization_slug=<slug>" supabase db query --local -f <this file>`.
-- One `do $$ … $$;` statement, as `suspend-organization.sql` is.

do $$
declare
  target_slug text := nullif(btrim(coalesce(current_setting('shift.organization_slug', true), '')), '');
  target_id   uuid;
  was         boolean;
begin
  if target_slug is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'ORGANIZATION_SLUG_MISSING';
  end if;

  select o.id, o.suspended
    into target_id, was
    from public.organizations as o
   where o.slug = target_slug
     for update;

  if target_id is null then
    raise exception using errcode = 'no_data_found', message = 'ORGANIZATION_UNKNOWN';
  end if;

  if not was then
    raise notice 'organization % was not suspended; nothing changed', target_slug;
    return;
  end if;

  update public.organizations as o
     set suspended = false
   where o.id = target_id;

  raise notice 'organization % unsuspended', target_slug;
end
$$;
