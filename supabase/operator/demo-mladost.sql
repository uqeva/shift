-- demo-mladost.sql — OPERATOR TASK, LOCAL AND STAGING ONLY. NEVER PRODUCTION.
--
-- Creates a second demo organization, `dvd-mladost`, that reproduces one
-- volunteer fire department's paper schedule for NOVEMBER 2026, so the founder
-- can lay the calendar beside the paper and compare them day by day. Like
-- `demo-organization.sql` it is what a human looks at, never a test fixture,
-- and it touches no other organization (`dvd-demo` included).
--
-- Needs the schema through 0082 (personal assignments 0077, job roles 0078,
-- schedule versions 0079, organization holidays 0080, teamless conflicts 0081,
-- team minimums 0082).
--
-- THE PEOPLE ARE A PARAMETER. This file holds the STRUCTURE of the schedule
-- (crews, positions, ranks, job roles, rotations, exceptions, leave) keyed by
-- an abstract person key (`S1-ZAP`, `A1`, `ST3`, …). Who those people are — a
-- display name, a username and a password each — comes from a session
-- setting, so no name and no password is ever in the repository. The operator
-- invents FICTIONAL names; the paper's real names never reach the repository,
-- a database or a log.
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
-- to it cascades, whatever was added to it by hand) and every auth user under
-- `@dvd-mladost.shift.invalid` are deleted and created again, in one
-- transaction (one `do` block, for the reason `provision-organization.sql`
-- gives). The auth.users recipe is that file's, as `demo-organization.sql`
-- uses it.
--
-- THE MODEL, and how the paper maps onto it (Epic 21's tools; no carrier
-- team, no shift-type override and no roster override):
--
--   * Shift types Dan 07–19, Noć 19–07, 1. smjena 06–14, 2. smjena 14–22
--     (working) and Slobodno (non-working). Hour bands Dan from 06:00, Noć
--     from 22:00.
--   * Four crews, Smjena 1–4, on one team rotation [Dan, Noć, Slobodno,
--     Slobodno] anchored on 2026-11-01: Smjena 3 has Dan on Nov 1, Smjena 1
--     on Nov 2, Smjena 2 on Nov 3, Smjena 4 on Nov 4. Each crew is a
--     commander, a driver and two more, and needs 4 (its own minimum, 0082).
--     Positions and fire ranks: commander `officer`, driver `firefighter_1`,
--     the paper's "Vod" a firefighter of rank `nco`, Vatrogasac a
--     `firefighter`. Each also holds the job role (0078) of the same name:
--     Zapovjednik, Vozač, Vod, Vatrogasac. `S1-ZAP` is the organization's
--     admin; everyone else is a member.
--   * One day team, Dnevni, OFF ON HOLIDAYS (0080) and minimum 1, with no
--     rotation of its own. Its members each have a PERSONAL ROTATION (0079)
--     from Monday 2026-11-02, counted with Dnevni:
--       - the four dispatchers (job role Dispečer): A1 and A2 on
--         [1. smjena ×5, Slobodno ×2, 2. smjena ×5, Slobodno ×2] at its first
--         step, B1 and B2 on the same pattern a week later (its eighth step);
--       - the cleaner (job role Čistačica), J1, on [1. smjena ×5, Slobodno ×2].
--   * Holidays: the Croatian list for 2026 (0080, as *Uvezi državne blagdane*
--     imports it), so 18 November empties the Dnevni rotations by the holiday
--     rule (R13), and the crews work it as usual.
--   * Students (job role Student) are MANUAL ONLY (0079) and on no team. Each
--     paper day of theirs is a PERSONAL ASSIGNMENT (0077) of that shift type
--     with no team, except where it covers a leave (below).
--   * Per-person exceptions are personal assignments: B1 works 2. smjena on
--     Nov 23–27 and 1. smjena on Nov 30 (A1's and A2's weeks), and A1 is off
--     (`OFF`) on Nov 30.
--   * Annual leave is plain `leave_records` (Godišnji odmor, 0052), created
--     by the admin: B2 Nov 9–13, S2-VAT Nov 15–25, S4-VOD Nov 1–4, S1-VOZ2
--     Nov 1–6. ST3 covers B2's 1. smjena on Nov 9 and 11: that is 0081's
--     replacement by assignment, ST3's assignment counted with Dnevni and a
--     `replace_member` resolution naming it, as `resolve_with_personal_
--     assignment` writes them. Every other collision with leave stays open
--     for the admin (*Za odluku*).
--
-- Members have no notification email and the organization's email switch is
-- off, so seeding sends nothing.
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
    job_role  text not null,
    team      text,
    position  text
  ) on commit drop;

  -- The structure: who is where, in the paper's order.
  insert into mladost_person (ordinal, key, role, fire_rank, job_role, team, position) values
    ( 1, 'S1-ZAP',  'admin',       'officer',       'Zapovjednik', 'Smjena 1', 'commander'),
    ( 2, 'S1-VOZ1', 'member_role', 'firefighter_1', 'Vozač',       'Smjena 1', 'driver'),
    ( 3, 'S1-VOZ2', 'member_role', 'firefighter_1', 'Vozač',       'Smjena 1', 'driver'),
    ( 4, 'S1-VOD',  'member_role', 'nco',           'Vod',         'Smjena 1', 'firefighter'),
    ( 5, 'S2-ZAP',  'member_role', 'officer',       'Zapovjednik', 'Smjena 2', 'commander'),
    ( 6, 'S2-VOZ',  'member_role', 'firefighter_1', 'Vozač',       'Smjena 2', 'driver'),
    ( 7, 'S2-VOD',  'member_role', 'nco',           'Vod',         'Smjena 2', 'firefighter'),
    ( 8, 'S2-VAT',  'member_role', 'firefighter',   'Vatrogasac',  'Smjena 2', 'firefighter'),
    ( 9, 'S3-ZAP',  'member_role', 'officer',       'Zapovjednik', 'Smjena 3', 'commander'),
    (10, 'S3-VOZ',  'member_role', 'firefighter_1', 'Vozač',       'Smjena 3', 'driver'),
    (11, 'S3-VAT',  'member_role', 'firefighter',   'Vatrogasac',  'Smjena 3', 'firefighter'),
    (12, 'S3-VOD',  'member_role', 'nco',           'Vod',         'Smjena 3', 'firefighter'),
    (13, 'S4-ZAP',  'member_role', 'officer',       'Zapovjednik', 'Smjena 4', 'commander'),
    (14, 'S4-VOZ',  'member_role', 'firefighter_1', 'Vozač',       'Smjena 4', 'driver'),
    (15, 'S4-VOD',  'member_role', 'nco',           'Vod',         'Smjena 4', 'firefighter'),
    (16, 'S4-VAT',  'member_role', 'firefighter',   'Vatrogasac',  'Smjena 4', 'firefighter'),
    (17, 'A1',      'member_role', 'firefighter',   'Dispečer',    'Dnevni',   null),
    (18, 'A2',      'member_role', 'firefighter',   'Dispečer',    'Dnevni',   null),
    (19, 'B1',      'member_role', 'firefighter',   'Dispečer',    'Dnevni',   null),
    (20, 'B2',      'member_role', 'firefighter',   'Dispečer',    'Dnevni',   null),
    (21, 'J1',      'member_role', 'firefighter',   'Čistačica',   'Dnevni',   null),
    (22, 'ST1',     'member_role', 'trainee',       'Student',     null,       null),
    (23, 'ST2',     'member_role', 'trainee',       'Student',     null,       null),
    (24, 'ST3',     'member_role', 'trainee',       'Student',     null,       null),
    (25, 'ST4',     'member_role', 'trainee',       'Student',     null,       null);

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
    -- None for the organization: each team has its own (0082).
    null,
    false
  )
  returning id into demo_organization;

  -- ------------------------------------------------------------ teams
  -- Teams in display order; `created_at` ascending keeps it. The admin's
  -- auth user is created below with `demo_admin` as its id.
  insert into teams (organization_id, name, off_on_holidays, minimum_members, created_by, created_at)
  select demo_organization, team.name, team.off_on_holidays, team.minimum_members, demo_admin,
         t0 + team.ordinal * interval '1 millisecond'
    from (values
      (1, 'Smjena 1', false, 4), (2, 'Smjena 2', false, 4),
      (3, 'Smjena 3', false, 4), (4, 'Smjena 4', false, 4),
      (5, 'Dnevni', true, 1)
    ) as team (ordinal, name, off_on_holidays, minimum_members);

  -- ------------------------------------------------------------ job roles
  insert into job_roles (organization_id, name, created_by, created_at)
  select demo_organization, job_role.name, demo_admin, t0 + (20 + job_role.ordinal) * interval '1 millisecond'
    from (values
      (1, 'Zapovjednik'), (2, 'Vozač'), (3, 'Vod'), (4, 'Vatrogasac'),
      (5, 'Dispečer'), (6, 'Čistačica'), (7, 'Student')
    ) as job_role (ordinal, name);

  if (select count(*) from mladost_person mp
       where not exists (select 1 from job_roles r where r.organization_id = demo_organization and r.name = mp.job_role)) > 0 then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = 'a person names a job role not written';
  end if;

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

    insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days, fire_rank, job_role_id)
    select demo_organization, seeded_user, btrim(seeded.full_name), seeded.username, seeded.role, 20, seeded.fire_rank, r.id
      from job_roles r
     where r.organization_id = demo_organization and r.name = seeded.job_role
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

  -- Person key -> member id, for everything below.
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

  -- ------------------------------------------------------------ holidays
  -- The Croatian list for 2026, with the names *Uvezi državne blagdane*
  -- writes (`hr.json` `holidays.national`, `nationalHolidaysOf('HR', 2026)`).
  insert into organization_holidays (organization_id, date, name, created_by, created_at)
  select demo_organization, h.date::date, h.name, demo_admin, t0 + interval '50 milliseconds'
    from (values
      ('2026-01-01', 'Nova godina'),
      ('2026-01-06', 'Bogojavljenje ili Sveta tri kralja'),
      ('2026-04-05', 'Uskrs'),
      ('2026-04-06', 'Uskrsni ponedjeljak'),
      ('2026-05-01', 'Praznik rada'),
      ('2026-05-30', 'Dan državnosti'),
      ('2026-06-04', 'Tijelovo'),
      ('2026-06-22', 'Dan antifašističke borbe'),
      ('2026-08-05', 'Dan pobjede i domovinske zahvalnosti i Dan hrvatskih branitelja'),
      ('2026-08-15', 'Velika Gospa'),
      ('2026-11-01', 'Svi sveti'),
      ('2026-11-18', 'Dan sjećanja na žrtve Domovinskog rata i Dan sjećanja na žrtvu Vukovara i Škabrnje'),
      ('2026-12-25', 'Božić'),
      ('2026-12-26', 'Sveti Stjepan')
    ) as h (date, name);

  get diagnostics written = row_count;
  if written <> 14 then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of 14 holidays written', written);
  end if;

  -- ------------------------------------------------------------ rotations
  -- One pattern per cycle. A team rotation stands on `offset_position` on its
  -- anchor date; a personal rotation on its version's `effective_from`.
  create temporary table mladost_step (cycle text, position integer, shift_type text) on commit drop;
  insert into mladost_step
  select 'crew', s.position, s.shift_type
    from (values (0, 'Dan'), (1, 'Noć'), (2, 'Slobodno'), (3, 'Slobodno')) as s (position, shift_type)
  union all
  select 'day', g, case when g < 5 then '1. smjena' when g < 7 then 'Slobodno' when g < 12 then '2. smjena' else 'Slobodno' end
    from generate_series(0, 13) g
  union all
  select 'morning', g, case when g < 5 then '1. smjena' else 'Slobodno' end
    from generate_series(0, 6) g;

  -- The crews' team rotations.
  create temporary table mladost_assignment (team text, cycle text, offset_position integer, anchor_date date) on commit drop;
  insert into mladost_assignment values
    ('Smjena 3', 'crew', 0, date '2026-11-01'),
    ('Smjena 4', 'crew', 1, date '2026-11-01'),
    ('Smjena 2', 'crew', 2, date '2026-11-01'),
    ('Smjena 1', 'crew', 3, date '2026-11-01');

  -- The Dnevni members' personal rotations (0079 `PERSONAL`).
  create temporary table mladost_personal (key text, cycle text, offset_position integer, effective_from date) on commit drop;
  insert into mladost_personal values
    ('A1', 'day', 0, date '2026-11-02'),
    ('A2', 'day', 0, date '2026-11-02'),
    ('B1', 'day', 7, date '2026-11-02'),
    ('B2', 'day', 7, date '2026-11-02'),
    ('J1', 'morning', 0, date '2026-11-02');

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
        detail = format('%s of the %s team rotations written', written, seeded.cycle);
    end if;

    insert into member_schedule_versions (
      organization_id, member_id, effective_from, source, pattern_id, offset_step_id, created_by, created_at
    )
    select demo_organization, m.member_id, p.effective_from, 'PERSONAL', cycle_pattern, rotation_steps.id, demo_admin,
           t0 + interval '400 milliseconds'
      from mladost_personal p
      join mladost_member m on m.key = p.key
      join rotation_steps on rotation_steps.pattern_id = cycle_pattern and rotation_steps.position = p.offset_position
     where p.cycle = seeded.cycle;

    get diagnostics written = row_count;
    if written <> (select count(*) from mladost_personal where cycle = seeded.cycle) then
      raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
        detail = format('%s of the %s personal rotations written', written, seeded.cycle);
    end if;
  end loop;

  -- The students: manual only (0079 `MANUAL`) from the month's first day.
  insert into member_schedule_versions (organization_id, member_id, effective_from, source, created_by, created_at)
  select demo_organization, m.member_id, anchor, 'MANUAL', demo_admin, t0 + interval '400 milliseconds'
    from mladost_member m
   where m.key like 'ST%';

  get diagnostics written = row_count;
  if written <> 4 then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of 4 manual-only versions written', written);
  end if;

  -- ------------------------------------------------------------ personal assignments
  -- (key, date, kind, shift type, team it counts with or none, note).
  create temporary table mladost_personal_day (
    ordinal serial, key text, date date, kind text, shift_type text, team text, note text
  ) on commit drop;

  -- Every student day. ST3's 1. smjena on Nov 9 and 11 covers B2's leave, so
  -- it counts with Dnevni, the team of the shift it replaces (0081).
  insert into mladost_personal_day (key, date, kind, shift_type, team, note)
  select d.key, d.date::date, 'SHIFT', d.shift_type,
         case when d.key = 'ST3' and d.date in ('2026-11-09', '2026-11-11') then 'Dnevni' end,
         case when d.key = 'ST3' and d.date in ('2026-11-09', '2026-11-11') then 'Zamjena za GO.' else 'Studentska smjena.' end
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
    ) as d (key, date, shift_type)
   order by d.date, d.shift_type, d.key;

  -- B1 works A1's and A2's shift in the week of Nov 23 and on Nov 30, counted
  -- with Dnevni (their effective team, so no team is named); A1 is off on
  -- Nov 30.
  insert into mladost_personal_day (key, date, kind, shift_type, team, note)
  select 'B1', d::date, 'SHIFT', '2. smjena', null, 'Radi u smjeni A.'
    from generate_series(date '2026-11-23', date '2026-11-27', interval '1 day') d
  union all
  select 'B1', date '2026-11-30', 'SHIFT', '1. smjena', null, 'Radi u smjeni A.'
  union all
  select 'A1', date '2026-11-30', 'OFF', null, null, 'Ne radi.';

  insert into personal_assignments (organization_id, member_id, date, kind, shift_type_id, team_id, note, created_by, created_at)
  select demo_organization, m.member_id, d.date, d.kind, shift_types.id, teams.id, d.note, demo_admin,
         t0 + interval '1 second' + d.ordinal * interval '1 millisecond'
    from mladost_personal_day d
    join mladost_member m on m.key = d.key
    left join shift_types on shift_types.organization_id = demo_organization and shift_types.name = d.shift_type
    left join teams on teams.organization_id = demo_organization and teams.name = d.team
   where (d.shift_type is null or shift_types.id is not null)
     and (d.team is null or teams.id is not null);

  get diagnostics written = row_count;
  select count(*) into expected from mladost_personal_day;
  if written <> expected then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of %s personal assignments written', written, expected);
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

  -- ST3 covering B2's leave: the admin's `replace_member` decision on B2's
  -- collision (B2's personal 1. smjena counted with Dnevni), in 0081's second
  -- form, naming ST3's assignment, as `resolve_with_personal_assignment`
  -- writes it. 0031's trigger checks that B2's leave covers the date.
  insert into conflict_resolutions (
    organization_id, member_id, date, team_id, kind, personal_assignment_id, shift_type_id, created_by, created_at
  )
  select demo_organization, absent.member_id, pa.date, pa.team_id, 'replace_member', pa.id, pa.shift_type_id,
         demo_admin, t0 + interval '4 seconds'
    from personal_assignments pa
    join mladost_member cover on cover.key = 'ST3' and cover.member_id = pa.member_id
    join mladost_member absent on absent.key = 'B2'
   where pa.organization_id = demo_organization
     and pa.date in (date '2026-11-09', date '2026-11-11');

  get diagnostics written = row_count;
  if written <> 2 then
    raise exception using errcode = 'raise_exception', message = 'DEMO_MLADOST_INCOMPLETE',
      detail = format('%s of 2 leave covers written', written);
  end if;

  raise notice 'demo organization % (%) replaced on %: % people', demo_slug, demo_organization, demo_target,
    (select count(*) from mladost_member);
end
$$;
