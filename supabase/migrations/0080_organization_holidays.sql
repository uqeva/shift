-- 0080_organization_holidays.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.16: holidays are organization data (R13, AD-27, AD-19, AD-11,
-- AD-3; founder decisions E-3 and E-7, 2026-11-25).
--
-- One table and one column. `organization_holidays` holds the civil dates an
-- organization keeps as holidays, AT MOST ONE PER DATE, each with a NAME and
-- nothing else (R13.1). `teams.off_on_holidays` says whether a team works no
-- shift on such a date (R13.2), off by default. What a holiday derives is
-- `packages/domain`'s alone (`holidays.ts`, `applyOverride`, AD-7): the
-- engine reads the dates and the off teams, NEVER the names.
--
--   * CURRENT-STATE (AD-2). A holiday is inserted, renamed (its `name`, by
--     the column grant) and deleted; its date never changes, so a moved
--     holiday is a delete and an insert. A team's flag is changed in place.
--   * NOTHING SEEDED (DI-8): no organization holds a holiday until an admin
--     enters one; the proposed national list (R13.6, `nationalHolidaysOf`) is only a
--     suggestion the admin accepts (story 21.17).
--   * THE DATE is a calendar date from 0001-01-01 to 9999-12-31, as every
--     other date the engine reads.
--   * THE NAME follows 0024, 0036, 0076 and 0078: non-blank by
--     `private.name_key`, at most 100 characters, no control character inside
--     it. It is never unique: two dates may share a name.
--   * ATTRIBUTED (AD-11): `created_by`/`created_at` from defaults, the insert
--     policy pinning `created_by` to the caller.
--   * AUDITED: AD-3's two change-history triggers, 0061's shape.
--   * SERIALIZED: 0023's organization lock and 0035's (0071's) stale-admin
--     re-check on insert, update and delete, as every admin write of a rule
--     the schedule reads.
--
-- WHO READS WHAT: every active member of the token's organization reads its
-- holidays, as they read its teams (the calendar shows who works). An active
-- admin inserts, renames and deletes. `anon` holds nothing, and no role holds
-- TRUNCATE. No policy reads its own table (42P17), so none needs a definer.
--
-- A TEAM'S FLAG is written through `teams`' own update policy (0009: an
-- active admin of the organization), by the column grant below, as 0056
-- grants each writable column. Every team keeps `false` until an admin sets
-- it, so every derivation is what it was before (R13.5). A flag change
-- changes what the team works on every holiday, so it is SERIALIZED and
-- RE-CHECKED as an archive is: 0035's two `teams` triggers are re-created
-- `before update of archived, off_on_holidays`, same functions and levels.
--
-- NOTICE (E-3): a holiday notifies nobody. No trigger here enqueues anything.
--
-- ALSO RE-CREATED, from its latest definition (0079) with only the additions
-- named: `private.member_schedule_inputs` gains `holidays`, the holidays' dates
-- in the window by date, and `teamsOffOnHolidays`, the ids of the teams off
-- on holidays (archived ones too) by id, `[]` for none (AD-19 as amended).
-- Names are never carried. The feed and the reminders read the assembly, so a
-- holiday-off shift has no event and no reminder with no code of their own.
--
-- DEPLOY ORDER: `db push`, then the SPA. The SPA selects the new column and
-- embeds the new table: deployed first, its calendar read is unavailable
-- until the push lands.
--
-- A refused write arrives as one of:
--
--   * 23505 — `organization_holidays_organization_date_key`: the date already
--     holds a holiday;
--   * 23514 — `organization_holidays_name_not_blank`,
--     `organization_holidays_name_length`, `organization_holidays_name_characters`
--     or `organization_holidays_date_finite`;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a column the grant does not admit (an update of `date`),
--     or a TRUNCATE.

create table organization_holidays (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  date date not null,

  name text not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither, and the insert policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint organization_holidays_date_finite
    check (isfinite(date) and date >= date '0001-01-01' and date < date '10000-01-01'),

  constraint organization_holidays_name_not_blank check (private.name_key(name) <> ''),

  constraint organization_holidays_name_length check (char_length(name) <= 100),

  -- 0076's class: Unicode's control characters and the two separators.
  constraint organization_holidays_name_characters check (name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]'),

  -- R13.1: at most one holiday per date. Also the index every read by
  -- organization and date (the assembly's window) is served by.
  constraint organization_holidays_organization_date_key unique (organization_id, date)
);

alter table organization_holidays enable row level security;

-- ------------------------------------------------------------------ the policies

-- Every active member reads their own organization's holidays.
create policy organization_holidays_select_own_organization on public.organization_holidays
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- Insert has no USING clause to fail, so a member-role account or an admin
-- naming another tenant gets 42501. The attribution is pinned to the caller.
create policy organization_holidays_insert_by_own_active_admin on public.organization_holidays
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and created_by = (select auth.uid())
  );

-- A rename: the column grant admits `name` alone. WITH CHECK pins the tenant.
create policy organization_holidays_update_by_own_active_admin on public.organization_holidays
  for update
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- A holiday is deleted outright: it carries no history a delete could falsify
-- (the change history keeps the row, AD-3).
create policy organization_holidays_delete_by_own_active_admin on public.organization_holidays
  for delete
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- ------------------------------------------------------- the writable columns

-- As 0009 and 0078: Supabase's default privileges grant every table privilege
-- to `anon` and `authenticated`. A session names a holiday's tenant, date and
-- name on insert, changes its name on update, and deletes it; nothing else.
-- No truncate for anyone, and `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.organization_holidays
  from anon, authenticated;
revoke select on table public.organization_holidays from anon;
revoke truncate on table public.organization_holidays from anon, authenticated, service_role;

grant insert (organization_id, date, name) on table public.organization_holidays to authenticated;
grant update (name) on table public.organization_holidays to authenticated;
grant delete on table public.organization_holidays to authenticated;

-- --------------------------------------------------------------- the triggers

-- 0023's organization lock, as 0079 attaches it: a holiday changes what every
-- team works, so its writes serialize with every other write of the schedule.
create trigger organization_holidays_serialize_organization_writes
  before insert or update or delete on public.organization_holidays
  for each statement
  execute function public.serialize_organization_writes();

-- 0035's re-check of the caller after the lock (0071's definition, unchanged:
-- the table has no team column for its team branch to read).
create trigger organization_holidays_refuse_write_by_stale_admin
  before insert or update or delete on public.organization_holidays
  for each row
  execute function public.refuse_write_by_stale_admin();

-- AD-3's two change-history triggers, in 0061's exact shape.
create trigger organization_holidays_audit after insert or delete on public.organization_holidays
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger organization_holidays_audit_update after update on public.organization_holidays
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- ------------------------------------------------------- a team's holiday flag

-- Off by default: every existing team works its projection on every date, as
-- before (R13.5). NOT NULL, so a team is either off on holidays or not.
alter table public.teams
  add column off_on_holidays boolean not null default false;

-- 0056's rule: each writable column is granted by name; `teams`' own update
-- policy (0009: an active admin of the organization) decides who. A team's
-- change history records the flag through its existing audit triggers.
grant update (off_on_holidays) on table public.teams to authenticated;

-- 0035's lock and re-check, widened from `archived` to the flag too: the same
-- functions, the same levels (the lock per statement, the re-check per row).
drop trigger if exists teams_serialize_organization_writes on public.teams;
create trigger teams_serialize_organization_writes
  before update of archived, off_on_holidays on public.teams
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists teams_refuse_write_by_stale_admin on public.teams;
create trigger teams_refuse_write_by_stale_admin
  before update of archived, off_on_holidays on public.teams
  for each row
  execute function public.refuse_write_by_stale_admin();

-- ------------------------------------------------------ the server assembly

-- 0079's assembly, with the holiday rule (AD-19 as amended 2026-11-26): the
-- holidays' dates in the window, by date, and the ids of the teams off on
-- holidays, archived ones too, by id. `[]` for none, which derives exactly as
-- none (R13.5). Names are never carried. The browser adapter answers the same
-- (`schedule-inputs.ts`), so read parity holds.
create or replace function private.member_schedule_inputs(p_member uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
  v_zone text;
  v_window daterange;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = 'invalid_parameter_value', message = 'SCHEDULE_INPUTS_WINDOW';
  end if;

  select m.organization_id, o.timezone
    into v_organization, v_zone
    from public.members m
    join public.organizations o on o.id = m.organization_id
   where m.id = p_member;

  if v_organization is null then
    return null;
  end if;

  v_window := daterange(p_from, p_to, '[]');

  return jsonb_build_object(
    'organizationId', v_organization,
    'timeZone', v_zone,
    'memberId', p_member,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'archived', t.archived) order by t.id)
        from public.teams t
       where t.organization_id = v_organization
    ), '[]'::jsonb),
    'shiftTypes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'type', jsonb_build_object('id', s.id, 'name', s.name, 'isWorking', s.is_working),
                 'versions', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'shiftTypeId', v.shift_type_id,
                              'effectiveFrom', v.effective_from,
                              'startMinute', (extract(hour from v.start_time) * 60 + extract(minute from v.start_time))::integer,
                              'endMinute', (extract(hour from v.end_time) * 60 + extract(minute from v.end_time))::integer
                            )
                            order by v.effective_from
                          )
                     from public.shift_type_versions v
                    where v.organization_id = v_organization
                      and v.shift_type_id = s.id
                 ), '[]'::jsonb)
               )
               order by s.id
             )
        from public.shift_types s
       where s.organization_id = v_organization
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', st.id, 'patternId', st.pattern_id, 'position', st.position, 'shiftTypeId', st.shift_type_id)
               order by st.id
             )
        from public.rotation_steps st
       where st.organization_id = v_organization
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'teamId', a.team_id,
                 'patternId', a.pattern_id,
                 'offsetStepId', a.offset_step_id,
                 'anchorDate', a.anchor_date,
                 'effectiveFrom', a.effective_from
               )
               order by a.team_id, a.effective_from
             )
        from public.rotation_assignments a
       where a.organization_id = v_organization
    ), '[]'::jsonb),
    'assignmentStamps', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'teamId', a.team_id,
                 'effectiveFrom', a.effective_from,
                 'createdAt', (extract(epoch from a.created_at) * 1000000)::bigint
               )
               order by a.team_id, a.effective_from
             )
        from public.rotation_assignments a
       where a.organization_id = v_organization
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', m.id,
                 'memberships', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('teamId', tv.team_id, 'position', tv.position, 'effectiveFrom', tv.effective_from)
                            order by tv.effective_from
                          )
                     from public.team_membership_versions tv
                    where tv.organization_id = v_organization
                      and tv.member_id = m.id
                 ), '[]'::jsonb),
                 'statuses', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('active', sv.active, 'effectiveFrom', sv.effective_from)
                            order by sv.effective_from
                          )
                     from public.member_status_versions sv
                    where sv.organization_id = v_organization
                      and sv.member_id = m.id
                 ), '[]'::jsonb),
                 'loans', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('id', l.id, 'teamId', l.team_id, 'from', lower(l.during), 'to', upper(l.during) - 1)
                            order by lower(l.during), l.id
                          )
                     from private.live_team_loans(v_organization) l
                    where l.member_id = m.id
                      and l.during && v_window
                 ), '[]'::jsonb),
                 -- 0077 (story 21.2): the member's live assignments in the window.
                 'personalAssignments', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'id', p.id,
                              'date', p.date,
                              'kind', p.kind,
                              'shiftTypeId', p.shift_type_id,
                              'teamId', p.team_id
                            )
                            order by p.date, p.id
                          )
                     from private.live_personal_assignments(v_organization) p
                    where p.member_id = m.id
                      and p.date between p_from and p_to
                 ), '[]'::jsonb),
                 -- 0079 (story 21.10): the member's schedule versions, whole.
                 'scheduleVersions', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'effectiveFrom', v.effective_from,
                              'source', v.source,
                              'patternId', v.pattern_id,
                              'offsetStepId', v.offset_step_id
                            )
                            order by v.effective_from
                          )
                     from public.member_schedule_versions v
                    where v.organization_id = v_organization
                      and v.member_id = m.id
                 ), '[]'::jsonb)
               )
               order by m.id
             )
        from public.members m
       where m.organization_id = v_organization
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'teamId', o.team_id,
                 'date', o.date,
                 'shiftTypeId', o.shift_type_id,
                 'writtenAt', (extract(epoch from coalesce(o.confirmed_at, o.created_at)) * 1000000)::bigint
               )
               order by o.id
             )
        from private.live_shift_type_overrides(v_organization) o
       where o.date between p_from and p_to
    ), '[]'::jsonb),
    'rosterOverrides', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'teamId', o.team_id,
                 'date', o.date,
                 'memberOutId', o.member_out_id,
                 'memberInId', o.member_in_id,
                 'writtenAt', (extract(epoch from coalesce(o.confirmed_at, o.created_at)) * 1000000)::bigint
               )
               order by o.id
             )
        from private.live_roster_overrides(v_organization) o
       where o.date between p_from and p_to
    ), '[]'::jsonb),
    -- 0080 (story 21.16): the holidays' dates in the window, by date; never their names.
    'holidays', coalesce((
      select jsonb_agg(h.date order by h.date)
        from public.organization_holidays h
       where h.organization_id = v_organization
         and h.date between p_from and p_to
    ), '[]'::jsonb),
    -- 0080 (story 21.16): every team off on holidays, archived ones too, by id.
    'teamsOffOnHolidays', coalesce((
      select jsonb_agg(t.id order by t.id)
        from public.teams t
       where t.organization_id = v_organization
         and t.off_on_holidays
    ), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', r.id,
                 'from', lower(r.during),
                 'to', upper(r.during) - 1,
                 'absenceTypeId', r.absence_type_id
               )
               || case when r.half is null then '{}'::jsonb else jsonb_build_object('half', r.half) end
               order by lower(r.during), r.id
             )
        from private.live_leave_records(v_organization) r
       where r.member_id = p_member
         and r.during && v_window
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function private.member_schedule_inputs(uuid, date, date) from public, anon, authenticated, service_role;

