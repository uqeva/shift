-- suspend-organization.sql — OPERATOR TASK, run by hand (story 19.5, AD-25).
--
-- Suspends one organization, named by its slug: `organizations.suspended`
-- becomes true and nothing else changes. From the commit on, its members read
-- and write nothing, a sign-in or a token refresh is refused, every member's
-- feed answers the one 404, and no reminder or notification is written or
-- sent; queued rows settle `ORGANIZATION_SUSPENDED` (AD-10, all through
-- `private.organization_live`). A device's offline copy stays readable on that
-- device until it lapses or signs out (AD-13); it cannot sync or write.
--
-- No session role may write the column, so this file is the only way in
-- (FR-101: suspension is an operator action, not a user-facing surface). It
-- deletes nothing: `unsuspend-organization.sql` restores the organization as
-- it was. Run it over the tailnet with the database password (DEPLOY.md §9.10):
--
--   PGOPTIONS="-c shift.organization_slug=<slug>" \
--     psql -v ON_ERROR_STOP=1 "<the stack's database URL>" -f supabase/operator/suspend-organization.sql
--
-- Locally: `PGOPTIONS="-c shift.organization_slug=<slug>" supabase db query --local -f <this file>`.
-- One `do $$ … $$;` statement, as `provision-organization.sql` is, so
-- `supabase db query -f` runs it too. The slug arrives as a session setting
-- and is never interpolated into SQL text.

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

  if was then
    raise notice 'organization % was already suspended; nothing changed', target_slug;
    return;
  end if;

  update public.organizations as o
     set suspended = true
   where o.id = target_id;

  raise notice 'organization % suspended', target_slug;
end
$$;
