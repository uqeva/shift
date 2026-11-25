-- demo-mladost.sql — OPERATOR TASK, LOCAL AND STAGING ONLY. NEVER PRODUCTION.
--
-- Creates a second demo organization, `dvd-mladost`, that reproduces one
-- volunteer fire department's paper schedule for NOVEMBER 2026, so the founder
-- can lay the calendar beside the paper and compare them day by day. Like
-- `demo-organization.sql` it is what a human looks at, never a test fixture,
-- and it touches no other organization (`dvd-demo` included).
--
-- THE PEOPLE ARE A PARAMETER. This file holds the STRUCTURE of the schedule
-- (crews, positions, ranks, rotations, exceptions, leave) keyed by an abstract
-- person key (`S1-ZAP`, `A1`, `ST3`, …). Who those people are — a display
-- name, a username and a password each — comes from a session setting, so no
-- name and no password is ever in the repository. The operator invents
-- FICTIONAL names; the paper's real names never reach the repository, a
-- database or a log.
--
-- Run it the way DEPLOY.md §7.5 runs the demo, with two session settings:
--
--   * `shift.demo_target`: `local` or `staging`, else DEMO_TARGET_REFUSED.
--   * `shift.demo_people`: a JSON array with one object per key below,
--     `{"key": "S1-ZAP", "name": "…", "username": "ana.horvat",
--     "password": "…"}`. A missing, unknown or repeated key, or a blank name,
--     username or password, is refused with DEMO_PEOPLE_INVALID before
--     anything is written. Each password is used untrimmed. Pass the JSON on
--     psql's stdin (a psql variable, base64 is simplest), never on a command
--     line.
--
-- RE-RUNNING REPLACES IT: the `dvd-mladost` organization (everything scoped
-- to it cascades) and every auth user under `@dvd-mladost.shift.invalid` are
-- deleted and created again, in one transaction (one `do` block, for the
-- reason `provision-organization.sql` gives). The auth.users recipe is that
-- file's, as `demo-organization.sql` uses it.
--
-- THE MODEL, and how the paper maps onto it:
--
--   * Shift types Dan 07–19, Noć 19–07, 1. smjena 06–14, 2. smjena 14–22
--     (working) and Slobodno (non-working). Hour bands Dan from 06:00, Noć
--     from 22:00.
--   * Four crews, Smjena 1–4, on one pattern [Dan, Noć, Slobodno, Slobodno]
--     anchored on 2026-11-01: Smjena 3 has Dan on Nov 1, Smjena 1 on Nov 2,
--     Smjena 2 on Nov 3, Smjena 4 on Nov 4. Each crew is a commander, a
--     driver and two more. The paper's "Vod" (squad leader) has no position
--     of its own: position firefighter, rank `nco`. Zapovjednik is an
--     `officer`, Vozač a `firefighter_1`, Vatrogasac a `firefighter`.
--     `S1-ZAP` is the organization's admin; everyone else is a member.
--   * Day workers, weekdays only: Dnevni A on [1. smjena ×5, Slobodno ×2,
--     2. smjena ×5, Slobodno ×2] anchored Monday 2026-11-02; Dnevni B on the
--     same pattern a week later; Jutarnji on [1. smjena ×5, Slobodno ×2].
--   * The 18 November holiday: the app has no holidays, so each day team
--     gets a shift-type override to Slobodno on that date.
--   * Per-person exceptions are roster overrides on the team's shift: a
--     removal alone takes someone off it, an addition alone puts someone on
--     another team's shift.
--   * Students float: they belong to no team. A student's day is a roster
--     override ADDING them to a shift of the right type. On weekdays that is
--     a day team's shift; on weekends and the holiday no team works a day
--     shift, so two carrier teams, "Studenti 1. smjena" and "Studenti
--     2. smjena", have no members and an all-Slobodno rotation, and get a
--     shift-type override to their shift on each date a student needs it.
--     Where a student covers a member on annual leave, the cover is recorded
--     as the app's own `replace_member` conflict resolution (0032/0038).
--   * Annual leave is plain `leave_records` (Godišnji odmor, 0052), created
--     by the admin.
--
-- Every override is written after the rotation (`created_at` later), so all
-- are in force, never pending (story 3.5c). Members have no notification
-- email and the organization's email switch is off, so seeding sends nothing.
--
-- Every insert that joins by name or key is counted; a short write raises
-- DEMO_MLADOST_INCOMPLETE and rolls everything back.

do $$
declare
  demo_target text := nullif(btrim(coalesce(current_setting('shift.demo_target', true), '')), '');
  people_text text := nullif(btrim(coalesce(current_setting('shift.demo_people', true), '')), '');
  people      jsonb;

  demo_slug   text := 'dvd-mladost';
  demo_domain text := 'dvd-mladost.shift.invalid';
  anchor      date := date '2026-11-01';

  demo_organization uuid;
  demo_admin        uuid := gen_random_uuid();
  t0                timestamptz := now();
  seeded            record;
  seeded_user       uuid;
  seeded_member     uuid;
  seeded_address    text;
  cycle_pattern     uuid;
  written           integer;
  expected          integer;
begin
  -- ------------------------------------------------------------ refusals
  if demo_target is null or demo_target not in ('local', 'staging') then
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_TARGET_REFUSED',
      detail = coalesce(demo_target, '(unset)'),
      hint = 'set shift.demo_target to local or staging; the demo never runs in production';
  end if;

  begin
    people := people_text::jsonb;
  exception when others then
    people := null;
  end;

  create temporary table mladost_person (
    ordinal   integer not null,
    key       text primary key,
    role      text not null,
    fire_rank text not null,
    team      text,
    position  text
  ) on commit drop;

  -- The structure: who is where, in the paper's order.
  insert into mladost_person (ordinal, key, role, fire_rank, team, position) values
    ( 1, 'S1-ZAP',  'admin',       'officer',       'Smjena 1', 'commander'),
    ( 2, 'S1-VOZ1', 'member_role', 'firefighter_1', 'Smjena 1', 'driver'),
    ( 3, 'S1-VOZ2', 'member_role', 'firefighter_1', 'Smjena 1', 'driver'),
    ( 4, 'S1-VOD',  'member_role', 'nco',           'Smjena 1', 'firefighter'),
    ( 5, 'S2-ZAP',  'member_role', 'officer',       'Smjena 2', 'commander'),
    ( 6, 'S2-VOZ',  'member_role', 'firefighter_1', 'Smjena 2', 'driver'),
    ( 7, 'S2-VOD',  'member_role', 'nco',           'Smjena 2', 'firefighter'),
    ( 8, 'S2-VAT',  'member_role', 'firefighter',   'Smjena 2', 'firefighter'),
    ( 9, 'S3-ZAP',  'member_role', 'officer',       'Smjena 3', 'commander'),
    (10, 'S3-VOZ',  'member_role', 'firefighter_1', 'Smjena 3', 'driver'),
    (11, 'S3-VAT',  'member_role', 'firefighter',   'Smjena 3', 'firefighter'),
    (12, 'S3-VOD',  'member_role', 'nco',           'Smjena 3', 'firefighter'),
    (13, 'S4-ZAP',  'member_role', 'officer',       'Smjena 4', 'commander'),
    (14, 'S4-VOZ',  'member_role', 'firefighter_1', 'Smjena 4', 'driver'),
    (15, 'S4-VOD',  'member_role', 'nco',           'Smjena 4', 'firefighter'),
    (16, 'S4-VAT',  'member_role', 'firefighter',   'Smjena 4', 'firefighter'),
    (17, 'A1',      'member_role', 'firefighter',   'Dnevni A', null),
    (18, 'A2',      'member_role', 'firefighter',   'Dnevni A', null),
    (19, 'B1',      'member_role', 'firefighter',   'Dnevni B', null),
    (20, 'B2',      'member_role', 'firefighter',   'Dnevni B', null),
    (21, 'J1',      'member_role', 'firefighter',   'Jutarnji', null),
    (22, 'ST1',     'member_role', 'trainee',       null,       null),
    (23, 'ST2',     'member_role', 'trainee',       null,       null),
    (24, 'ST3',     'member_role', 'trainee',       null,       null),
    (25, 'ST4',     'member_role', 'trainee',       null,       null);

  if people is null or jsonb_typeof(people) <> 'array'
     or jsonb_array_length(people) <> (select count(*) from mladost_person)
     or (select count(distinct p ->> 'key') from jsonb_array_elements(people) p) <> (select count(*) from mladost_person)
     or exists (
       select 1
         from jsonb_array_elements(people) p
        where jsonb_typeof(p) <> 'object'
           or not exists (select 1 from mladost_person mp where mp.key = p ->> 'key')
           or nullif(btrim(coalesce(p ->> 'name', '')), '') is null
           or nullif(btrim(coalesce(p ->> 'username', '')), '') is null
           or nullif(btrim(coalesce(p ->> 'password', '')), '') is null
     )
  then
    -- Never echo the setting: it holds passwords.
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_PEOPLE_INVALID',
      hint = 'set shift.demo_people to a JSON array of {key, name, username, password}, one per person key';
  end if;

  perform pg_advisory_xact_lock(hashtext('shift.dvd-mladost'));

  -- ------------------------------------------------------------ replace
  delete from organizations where slug = demo_slug;
  delete from auth.users where email like '%@' || demo_domain;

  insert into organizations (
    slug, name, organization_type, timezone, locale,
    leave_year_start_month, leave_year_start_day,
    uses_fire_ranks, minimum_members, email_notifications
  ) values (
    demo_slug, 'DVD Mladost (demo)', 'Fire Department', 'Europe/Zagreb', 'hr',
    1, 1, true,
    -- No minimum: it is one number for every team, and here crews are four,
    -- day teams two, Jutarnji one and the student carriers one, so any
    -- value would mark a planned shift as short every day.
    null,
    false
  )
  returning id into demo_organization;

  -- ------------------------------------------------------------ teams
  -- Teams in display order; `created_at` ascending keeps it. The admin's
  -- auth user is created below with `demo_admin` as its id.
  insert into teams (organization_id, name, created_by, created_at)
  select demo_organization, team.name, demo_admin, t0 + team.ordinal * interval '1 millisecond'
    from (values
      (1, 'Smjena 1'), (2, 'Smjena 2'), (3, 'Smjena 3'), (4, 'Smjena 4'),
      (5, 'Dnevni A'), (6, 'Dnevni B'), (7, 'Jutarnji'),
      (8, 'Studenti 1. smjena'), (9, 'Studenti 2. smjena')
    ) as team (ordinal, name);

  -- ------------------------------------------------------------ people
  for seeded in
    select mp.*, p ->> 'name' as full_name, btrim(p ->> 'username') as username, p ->> 'password' as password
      from mladost_person mp
      join jsonb_array_elements(people) p on p ->> 'key' = mp.key
     order by mp.ordinal
  loop
    seeded_user := case when seeded.key = 'S1-ZAP' then demo_admin else gen_random_uuid() end;
    seeded_address := seeded.username || '@' || demo_domain;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', seeded_user, 'authenticated', 'authenticated',
      seeded_address, extensions.crypt(seeded.password, extensions.gen_salt('bf', 10)), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      '{}'::jsonb, now(), now(), '', '', '', ''
    );

    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      seeded_user::text, seeded_user,
      jsonb_build_object('sub', seeded_user::text, 'email', seeded_address,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now()
    );

    insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days, fire_rank)
    values (demo_organization, seeded_user, btrim(seeded.full_name), seeded.username, seeded.role, 20, seeded.fire_rank)
    returning id into seeded_member;

    if seeded.team is not null then
      insert into team_membership_versions (organization_id, member_id, team_id, position, effective_from, created_by)
      select demo_organization, seeded_member, teams.id, seeded.position, anchor, demo_admin
        from teams
       where teams.organization_id = demo_organization and teams.name = seeded.team;

      get diagnostics written = row_count;
      if written <> 1 then
        raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
          detail = format('no team %s for %s', seeded.team, seeded.key);
      end if;
    end if;
  end loop;

  -- Person key -> member id, for every exception below.
  create temporary table mladost_member on commit drop as
  select mp.key, m.id as member_id
    from mladost_person mp
    join jsonb_array_elements(people) p on p ->> 'key' = mp.key
    join members m on m.organization_id = demo_organization and m.username = btrim(p ->> 'username');

  if (select count(*) from mladost_member) <> (select count(*) from mladost_person) then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = 'not every person key resolved to a member';
  end if;

  -- ------------------------------------------------------------ bands and types
  insert into hour_bands (organization_id, name, start_time)
  select demo_organization, band.name, band.start_time::time
    from (values ('Dan', '06:00'), ('Noć', '22:00')) as band (name, start_time);

  insert into shift_types (organization_id, name, is_working, created_by, created_at)
  select demo_organization, shift_type.name, shift_type.is_working, demo_admin,
         t0 + (10 + shift_type.ordinal) * interval '1 millisecond'
    from (values
      (1, 'Dan', true), (2, 'Noć', true), (3, '1. smjena', true), (4, '2. smjena', true),
      (5, 'Slobodno', false)
    ) as shift_type (ordinal, name, is_working);

  insert into shift_type_versions (organization_id, shift_type_id, start_time, end_time, effective_from, created_by)
  select demo_organization, shift_types.id, version.start_time::time, version.end_time::time, anchor, demo_admin
    from shift_types
    join (values
      ('Dan', '07:00', '19:00'), ('Noć', '19:00', '07:00'),
      ('1. smjena', '06:00', '14:00'), ('2. smjena', '14:00', '22:00')
    ) as version (name, start_time, end_time) on version.name = shift_types.name
   where shift_types.organization_id = demo_organization;

  -- ------------------------------------------------------------ rotations
  -- One pattern per cycle; each team stands on `offset_position` on its anchor.
  create temporary table mladost_step (cycle text, position integer, shift_type text) on commit drop;
  insert into mladost_step
  select 'crew', s.position, s.shift_type
    from (values (0, 'Dan'), (1, 'Noć'), (2, 'Slobodno'), (3, 'Slobodno')) as s (position, shift_type)
  union all
  select 'day', g, case when g < 5 then '1. smjena' when g < 7 then 'Slobodno' when g < 12 then '2. smjena' else 'Slobodno' end
    from generate_series(0, 13) g
  union all
  select 'morning', g, case when g < 5 then '1. smjena' else 'Slobodno' end
    from generate_series(0, 6) g
  union all
  select 'off', 0, 'Slobodno';

  create temporary table mladost_assignment (team text, cycle text, offset_position integer, anchor_date date) on commit drop;
  insert into mladost_assignment values
    ('Smjena 3', 'crew', 0, date '2026-11-01'),
    ('Smjena 4', 'crew', 1, date '2026-11-01'),
    ('Smjena 2', 'crew', 2, date '2026-11-01'),
    ('Smjena 1', 'crew', 3, date '2026-11-01'),
    ('Dnevni A', 'day', 0, date '2026-11-02'),
    ('Dnevni B', 'day', 7, date '2026-11-02'),
    ('Jutarnji', 'morning', 0, date '2026-11-02'),
    ('Studenti 1. smjena', 'off', 0, date '2026-11-02'),
    ('Studenti 2. smjena', 'off', 0, date '2026-11-02');

  for seeded in select distinct cycle from mladost_step order by cycle loop
    insert into rotation_patterns (organization_id, created_by, created_at)
    values (demo_organization, demo_admin, t0 + interval '100 milliseconds')
    returning id into cycle_pattern;

    insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by, created_at)
    select demo_organization, cycle_pattern, s.position, shift_types.id, demo_admin,
           t0 + interval '200 milliseconds' + s.position * interval '1 millisecond'
      from mladost_step s
      join shift_types on shift_types.organization_id = demo_organization and shift_types.name = s.shift_type
     where s.cycle = seeded.cycle;

    get diagnostics written = row_count;
    if written <> (select count(*) from mladost_step where cycle = seeded.cycle) then
      raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
        detail = format('%s of the %s steps written', written, seeded.cycle);
    end if;

    insert into rotation_assignments (
      organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from, created_by, created_at
    )
    select demo_organization, teams.id, cycle_pattern, rotation_steps.id, a.anchor_date, anchor, demo_admin,
           t0 + interval '300 milliseconds'
      from mladost_assignment a
      join teams on teams.organization_id = demo_organization and teams.name = a.team
      join rotation_steps on rotation_steps.pattern_id = cycle_pattern and rotation_steps.position = a.offset_position
     where a.cycle = seeded.cycle;

    get diagnostics written = row_count;
    if written <> (select count(*) from mladost_assignment where cycle = seeded.cycle) then
      raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
        detail = format('%s of the %s assignments written', written, seeded.cycle);
    end if;
  end loop;

  -- ------------------------------------------------------------ student days
  -- Each student shift and the team whose shift carries it: Dnevni B's
  -- 1. smjena on the weekdays of B2's leave, a carrier team otherwise.
  create temporary table mladost_student_day (key text, date date, shift_type text, team text) on commit drop;
  insert into mladost_student_day
  select d.key, d.date::date, d.shift_type,
         case
           when extract(isodow from d.date::date) between 1 and 5 and d.date::date <> date '2026-11-18'
             then 'Dnevni B'
           else 'Studenti ' || d.shift_type
         end
    from (values
      ('ST1', '2026-11-01', '1. smjena'), ('ST1', '2026-11-14', '2. smjena'), ('ST1', '2026-11-15', '1. smjena'),
      ('ST1', '2026-11-21', '1. smjena'), ('ST1', '2026-11-22', '2. smjena'),
      ('ST2', '2026-11-01', '2. smjena'), ('ST2', '2026-11-13', '1. smjena'), ('ST2', '2026-11-14', '1. smjena'),
      ('ST2', '2026-11-15', '2. smjena'), ('ST2', '2026-11-21', '2. smjena'), ('ST2', '2026-11-22', '1. smjena'),
      ('ST3', '2026-11-07', '1. smjena'), ('ST3', '2026-11-08', '2. smjena'), ('ST3', '2026-11-09', '1. smjena'),
      ('ST3', '2026-11-11', '1. smjena'), ('ST3', '2026-11-18', '1. smjena'), ('ST3', '2026-11-28', '2. smjena'),
      ('ST3', '2026-11-29', '1. smjena'),
      ('ST4', '2026-11-07', '2. smjena'), ('ST4', '2026-11-08', '1. smjena'), ('ST4', '2026-11-10', '1. smjena'),
      ('ST4', '2026-11-12', '1. smjena'), ('ST4', '2026-11-18', '2. smjena'), ('ST4', '2026-11-28', '1. smjena'),
      ('ST4', '2026-11-29', '2. smjena')
    ) as d (key, date, shift_type);

  -- ------------------------------------------------------------ shift-type overrides
  -- Written after the rotation, so in force. The holiday first, then each
  -- carrier on each date a student needs its shift.
  create temporary table mladost_type_override (team text, date date, shift_type text, reason text) on commit drop;
  insert into mladost_type_override
  select team, date '2026-11-18', 'Slobodno', 'Blagdan, dnevni rad ne radi.'
    from (values ('Dnevni A'), ('Dnevni B'), ('Jutarnji')) as t (team)
  union all
  select distinct team, date, shift_type, 'Studentska smjena.'
    from mladost_student_day
   where team like 'Studenti %';

  insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason, created_by, created_at)
  select demo_organization, teams.id, o.date, shift_types.id, o.reason, demo_admin, t0 + interval '1 second'
    from mladost_type_override o
    join teams on teams.organization_id = demo_organization and teams.name = o.team
    join shift_types on shift_types.organization_id = demo_organization and shift_types.name = o.shift_type;

  get diagnostics written = row_count;
  select count(*) into expected from mladost_type_override;
  if written <> expected then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of %s shift-type overrides written', written, expected);
  end if;

  -- ------------------------------------------------------------ roster overrides
  -- (team, date, taken off, put on, reason); one row each, in this order.
  create temporary table mladost_roster_override (
    ordinal serial, team text, date date, member_out text, member_in text, reason text
  ) on commit drop;

  -- B1 works 2. smjena with Dnevni A in the week of Nov 23, and 1. smjena
  -- with Dnevni A on Nov 30: off Dnevni B's shift, onto Dnevni A's.
  insert into mladost_roster_override (team, date, member_out, member_in, reason)
  select team, d::date, member_out, member_in, reason
    from generate_series(date '2026-11-23', date '2026-11-27', interval '1 day') d
    cross join (values
      ('Dnevni B', 'B1', null, 'Radi s Dnevnim A.'),
      ('Dnevni A', null, 'B1', 'Radi s Dnevnim A.')
    ) as r (team, member_out, member_in, reason)
  union all
  select r.team, date '2026-11-30', r.member_out, r.member_in, r.reason
    from (values
      ('Dnevni B', 'B1', null, 'Radi s Dnevnim A.'),
      ('Dnevni A', null, 'B1', 'Radi s Dnevnim A.'),
      ('Dnevni A', 'A1', null, 'Ne radi.')
    ) as r (team, member_out, member_in, reason);

  -- Every student day: an addition onto its carrying team's shift.
  insert into mladost_roster_override (team, date, member_out, member_in, reason)
  select team, date, null, key,
         case when team = 'Dnevni B' then 'Zamjena za GO.' else 'Studentska smjena.' end
    from mladost_student_day
   order by date, shift_type, key;

  insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by, created_at)
  select demo_organization, teams.id, r.date, member_out.member_id, member_in.member_id, r.reason, demo_admin,
         t0 + interval '2 seconds' + r.ordinal * interval '1 millisecond'
    from mladost_roster_override r
    join teams on teams.organization_id = demo_organization and teams.name = r.team
    left join mladost_member member_out on member_out.key = r.member_out
    left join mladost_member member_in on member_in.key = r.member_in
   where (r.member_out is null or member_out.member_id is not null)
     and (r.member_in is null or member_in.member_id is not null);

  get diagnostics written = row_count;
  select count(*) into expected from mladost_roster_override;
  if written <> expected then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of %s roster overrides written', written, expected);
  end if;

  -- ------------------------------------------------------------ leave
  insert into leave_records (organization_id, member_id, during, created_by, created_at)
  select demo_organization, m.member_id, daterange(l.first_day, l.last_day, '[]'), demo_admin, t0 + interval '3 seconds'
    from (values
      ('B2',      date '2026-11-09', date '2026-11-13'),
      ('S2-VAT',  date '2026-11-15', date '2026-11-25'),
      ('S4-VOD',  date '2026-11-01', date '2026-11-04'),
      ('S1-VOZ2', date '2026-11-01', date '2026-11-06')
    ) as l (key, first_day, last_day)
    join mladost_member m on m.key = l.key;

  get diagnostics written = row_count;
  if written <> 4 then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of 4 leave records written', written);
  end if;

  -- A student covering B2's leave is the admin's `replace_member` decision on
  -- B2's conflict that day (0032, with 0038's shift type), linked to the
  -- addition above. 0031's trigger checks that B2's leave covers the date.
  insert into conflict_resolutions (
    organization_id, member_id, date, team_id, kind, roster_override_id, shift_type_id, created_by, created_at
  )
  select demo_organization, absent.member_id, s.date, teams.id, 'replace_member', ro.id, shift_types.id,
         demo_admin, t0 + interval '4 seconds'
    from mladost_student_day s
    join mladost_member absent on absent.key = 'B2'
    join mladost_member student on student.key = s.key
    join teams on teams.organization_id = demo_organization and teams.name = s.team
    join shift_types on shift_types.organization_id = demo_organization and shift_types.name = s.shift_type
    join roster_overrides ro on ro.organization_id = demo_organization and ro.team_id = teams.id
                            and ro.date = s.date and ro.member_in_id = student.member_id
   where s.team = 'Dnevni B'
     and s.date between date '2026-11-09' and date '2026-11-13';

  get diagnostics written = row_count;
  select count(*) into expected from mladost_student_day
   where team = 'Dnevni B' and date between date '2026-11-09' and date '2026-11-13';
  if written <> expected then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of %s leave covers written', written, expected);
  end if;

  raise notice 'demo organization % (%) replaced on %: % people', demo_slug, demo_organization, demo_target,
    (select count(*) from mladost_member);
end
$$;
