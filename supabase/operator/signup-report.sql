-- signup-report.sql — OPERATOR TASK, run by hand (story 19.5, AD-25).
--
-- The abuse query. It READS, and writes nothing: one `select`, answering one
-- JSON document (FR-101's list, checklist A10's alert):
--
--   * `door`: `private.signup_settings` as it stands (the switch and the
--     three ceilings);
--   * `last_24_hours`: accounts created with no `members` row against
--     `accounts_per_day`, counted exactly as the hook counts its ceiling
--     (0066: every `auth.users` row of the last 24 hours with no member row,
--     whatever its address), and
--     organizations founded by signup against `organizations_per_day` (the
--     rolling ceiling `create_organization` counts, 0071);
--   * `recent_accounts`: the 50 newest email-identity accounts of the last 7
--     days (address, created, confirmed, whether it has a member row);
--   * `accounts_by_day`: email-identity accounts created on each of the last
--     30 days (UTC), by confirmation state, how many have a member row, and
--     `accounts_per_day` beside them. The housekeeping job (0073) deletes
--     unconfirmed accounts after 7 days and memberless confirmed ones after
--     30, so a day older than 7 shows only the accounts that survived it:
--     read it as what remains, not as what arrived;
--   * `organizations_by_day`: organizations founded by signup on each of the
--     last 30 days (UTC), beside the ceiling;
--   * `organizations_founded_by_signup`: every one, newest first (slug, name,
--     created, suspended, member count);
--   * `most_attempts`: the 20 accounts with the most `create_organization`
--     attempts in the last 30 days (housekeeping keeps 30 days of them),
--     with their address while the account still exists.
--
-- Run it over the tailnet with the database password (DEPLOY.md §9.10):
--
--   psql -v ON_ERROR_STOP=1 "<the stack's database URL>" -At -f supabase/operator/signup-report.sql
--
-- Its output holds addresses: keep it on the operator's machine, never in an
-- issue, a pull request or this repository.

select pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'generated_at', pg_catalog.now(),

  'door', (
    select pg_catalog.jsonb_build_object(
             'open', s.open,
             'accounts_per_day', s.accounts_per_day,
             'organizations_per_day', s.organizations_per_day,
             'attempts_per_account', s.attempts_per_account
           )
      from private.signup_settings as s
     where s.id
  ),

  'last_24_hours', pg_catalog.jsonb_build_object(
    'accounts_without_member', (
      select pg_catalog.count(*)
        from auth.users as u
       where u.created_at > pg_catalog.now() - interval '24 hours'
         and not exists (select 1 from public.members as m where m.auth_user_id = u.id)
    ),
    'accounts_ceiling', (select s.accounts_per_day from private.signup_settings as s where s.id),
    'organizations_founded', (
      select pg_catalog.count(*)
        from public.organizations as o
       where o.founded_by is not null
         and o.created_at > pg_catalog.now() - interval '24 hours'
    ),
    'organizations_ceiling', (select s.organizations_per_day from private.signup_settings as s where s.id)
  ),

  'recent_accounts', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'email', r.email,
             'created_at', r.created_at,
             'confirmed_at', r.email_confirmed_at,
             'with_member', r.with_member
           ) order by r.created_at desc), '[]'::jsonb)
      from (
        select u.email, u.created_at, u.email_confirmed_at,
               exists (select 1 from public.members as m where m.auth_user_id = u.id) as with_member
          from auth.users as u
         where u.created_at > pg_catalog.now() - interval '7 days'
           and private.address_kind(u.email) = 'email'
         order by u.created_at desc
         limit 50
      ) as r
  ),

  'accounts_by_day', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'day', d.day,
             'created', d.created,
             'confirmed', d.confirmed,
             'unconfirmed', d.created - d.confirmed,
             'with_member', d.with_member,
             'ceiling', (select s.accounts_per_day from private.signup_settings as s where s.id)
           ) order by d.day desc), '[]'::jsonb)
      from (
        select (u.created_at at time zone 'UTC')::date as day,
               pg_catalog.count(*) as created,
               pg_catalog.count(*) filter (where u.email_confirmed_at is not null) as confirmed,
               pg_catalog.count(*) filter (where exists (
                 select 1 from public.members as m where m.auth_user_id = u.id
               )) as with_member
          from auth.users as u
         where u.created_at > pg_catalog.now() - interval '30 days'
           and private.address_kind(u.email) = 'email'
         group by 1
      ) as d
  ),

  'organizations_by_day', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'day', d.day,
             'founded', d.founded,
             'ceiling', (select s.organizations_per_day from private.signup_settings as s where s.id)
           ) order by d.day desc), '[]'::jsonb)
      from (
        select (o.created_at at time zone 'UTC')::date as day,
               pg_catalog.count(*) as founded
          from public.organizations as o
         where o.founded_by is not null
           and o.created_at > pg_catalog.now() - interval '30 days'
         group by 1
      ) as d
  ),

  'organizations_founded_by_signup', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'slug', o.slug,
             'name', o.name,
             'created_at', o.created_at,
             'suspended', o.suspended,
             'members', (select pg_catalog.count(*) from public.members as m where m.organization_id = o.id)
           ) order by o.created_at desc, o.slug), '[]'::jsonb)
      from public.organizations as o
     where o.founded_by is not null
  ),

  'most_attempts', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'account', t.auth_user_id,
             'email', (select u.email from auth.users as u where u.id = t.auth_user_id),
             'attempts_24_hours', t.day_count,
             'attempts_30_days', t.month_count,
             'last_attempt', t.last_attempt
           ) order by t.month_count desc, t.last_attempt desc), '[]'::jsonb)
      from (
        select a.auth_user_id,
               pg_catalog.count(*) filter (where a.attempted_at > pg_catalog.now() - interval '24 hours') as day_count,
               pg_catalog.count(*) as month_count,
               pg_catalog.max(a.attempted_at) as last_attempt
          from private.organization_attempts as a
         where a.attempted_at > pg_catalog.now() - interval '30 days'
         group by a.auth_user_id
         order by pg_catalog.count(*) desc, pg_catalog.max(a.attempted_at) desc
         limit 20
      ) as t
  )
)) as report;
