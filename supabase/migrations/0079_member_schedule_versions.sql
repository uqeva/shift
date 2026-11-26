-- 0079_member_schedule_versions.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.10: an admin gives a member their own rotation, or makes them
-- manual only (R15, AD-26, AD-2, AD-3, AD-11, AD-18, AD-19, AD-20; founder
-- decision E-3, 2026-11-25).
--
-- One table. `member_schedule_versions` records, FROM A DATE, how ONE MEMBER is
-- scheduled: by their team's rotation (`TEAM`), by a rotation of their own
-- (`PERSONAL`: an organization rotation pattern and the step they stand on
-- at the effective date), or by nothing but their Personal Assignments
-- (`MANUAL`). It is VERSIONED like `rotation_assignments` (AD-2): a version is
-- inserted, never changed, and only the latest one, while it is still ahead,
-- is cancelled. No version means `TEAM` on every date (R15.2). What a version
-- derives is `packages/domain`'s alone (`personal.ts`, AD-7).
--
--   * THE OFFSET IS A STEP OF THAT PATTERN (AD-3): a composite key to
--     `rotation_steps (organization_id, pattern_id, id)`, as 0016's rotation
--     versions have it. The version is its own anchor: the step is the
--     member's on `effective_from` (21.9 Design Note 1), so there is no anchor
--     column. Pattern and step are both set for `PERSONAL` and both null
--     otherwise (named checks).
--   * ONE VERSION PER MEMBER AND DATE: `unique (organization_id, member_id,
--     effective_from)`.
--   * ATTRIBUTED (AD-11) and AUDITED (AD-3's two change-history triggers).
--
-- WRITES are 0016's rotation-version writes, applied to a member: an active
-- admin inserts a version from the organization's today on, after the
-- member's latest one and while none of theirs is scheduled after today, and
-- not one that repeats the source in force (a `TEAM` or `MANUAL` over the
-- same); and deletes only the member's latest version while it is still after
-- today. 0023's organization lock, 0035's stale-admin re-check and 0039's
-- archived-type refusal are attached, unchanged. The pattern a version names
-- is "in use" (0016's `rotation_pattern_in_use`, re-created), so its steps are
-- fixed from then on, and a shift type a member's version in force or
-- scheduled steps through cannot be archived (0037's
-- `refuse_archive_in_rotation`, re-created).
--
-- READS: every active member of the organization reads the versions, as they
-- read the team rotation versions: the calendar shows who works, and a
-- member's source decides other members' places on base rosters.
--
-- NOTICE (E-3, AD-18 as amended): an insert tells the member, once,
-- `SCHEDULE_SOURCE_CHANGED { effectiveFrom, source }`. A cancel tells them the
-- same code with the source in force from that date once it is gone.
--
-- ALSO RE-CREATED, each from its latest definition with only the additions
-- named:
--   * `public.rotation_pattern_in_use` (0016): a member's version uses a pattern too;
--   * `public.refuse_archive_in_rotation` (0037): a member's version in force or
--     scheduled keeps its types unarchived;
--   * `private.member_schedule_inputs` (0077): every member gains
--     `scheduleVersions`, whole (AD-19 as amended);
--   * `public.enqueue_shift_reminders` (0077): the `PERSONAL_ROTATION` item
--     form, its `:p:` subject and its write-time re-check (AD-18 as amended).
--
-- DEPLOY ORDER: `db push`, then the functions (`remind` and `calendar-feed`
-- carry the new forms, `notify` the new code), then the SPA. No version exists
-- until the SPA ships its card, so the order is not load-bearing.

create table member_schedule_versions (
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  effective_from date not null,

  source text not null,

  pattern_id uuid,

  offset_step_id uuid,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint member_schedule_versions_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  constraint member_schedule_versions_pattern_fkey
    foreign key (organization_id, pattern_id)
    references rotation_patterns (organization_id, id),

  -- AD-3: the step is a step OF the version's pattern.
  constraint member_schedule_versions_offset_step_fkey
    foreign key (organization_id, pattern_id, offset_step_id)
    references rotation_steps (organization_id, pattern_id, id),

  constraint member_schedule_versions_source_check
    check (source in ('TEAM', 'PERSONAL', 'MANUAL')),

  constraint member_schedule_versions_pattern_by_source
    check ((source = 'PERSONAL') = (pattern_id is not null)),

  constraint member_schedule_versions_step_with_pattern
    check ((pattern_id is null) = (offset_step_id is null)),

  constraint member_schedule_versions_effective_from_finite
    check (isfinite(effective_from) and effective_from >= date '0001-01-01' and effective_from < date '10000-01-01'),

  constraint member_schedule_versions_member_id_effective_from_key
    unique (organization_id, member_id, effective_from)
);

alter table member_schedule_versions enable row level security;

-- Q3: every policy below filters by the tenant first.
create index member_schedule_versions_organization_id_idx on member_schedule_versions (organization_id);

-- The keys a pattern's use and a shift type's archive are checked through.
create index member_schedule_versions_organization_pattern_idx on member_schedule_versions (organization_id, pattern_id);
create index member_schedule_versions_pattern_id_idx on member_schedule_versions (pattern_id);

-- ------------------------------------------------------------- the policies

-- Every active member of the token's organization reads every version (AD-13
-- as amended: the calendar snapshot carries every member's).
create policy member_schedule_versions_select_own_organization on public.member_schedule_versions
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

-- 0016's rotation-version insert, for one member: from today on, after the
-- member's latest version, none of theirs scheduled after today, and not a
-- repeat of the source in force (none in force is `TEAM`, R15.2). A
-- `PERSONAL` version over a `PERSONAL` one re-anchors the rotation, so it is
-- always a change.
create policy member_schedule_versions_insert_by_own_active_admin on public.member_schedule_versions
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
    and effective_from >= public.organization_today(organization_id)
    and not exists (
      select 1
        from public.member_schedule_versions later
       where later.organization_id = member_schedule_versions.organization_id
         and later.member_id = member_schedule_versions.member_id
         and (
           later.effective_from >= member_schedule_versions.effective_from
           or later.effective_from > public.organization_today(later.organization_id)
         )
    )
    and (
      source = 'PERSONAL'
      or source <> coalesce((
        select latest.source
          from public.member_schedule_versions latest
         where latest.organization_id = member_schedule_versions.organization_id
           and latest.member_id = member_schedule_versions.member_id
         order by latest.effective_from desc
         limit 1
      ), 'TEAM')
    )
  );

-- 0016's cancel: only the member's latest version, while it is still ahead.
create policy member_schedule_versions_delete_scheduled_by_own_active_admin on public.member_schedule_versions
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
    and effective_from > public.organization_today(organization_id)
    and not exists (
      select 1
        from public.member_schedule_versions later
       where later.organization_id = member_schedule_versions.organization_id
         and later.member_id = member_schedule_versions.member_id
         and later.effective_from > member_schedule_versions.effective_from
    )
  );

-- -------------------------------------------------------------- privileges

-- As 0062 and 0078: Supabase's default privileges grant every table privilege
-- to the session roles, so they are taken back and only what the policies
-- above decide is granted again. A version is never updated (AD-2).
revoke insert, update, delete, truncate, references, trigger on table public.member_schedule_versions
  from anon, authenticated;
revoke select on table public.member_schedule_versions from anon;
revoke truncate on table public.member_schedule_versions from anon, authenticated, service_role;

grant insert (
  organization_id,
  member_id,
  effective_from,
  source,
  pattern_id,
  offset_step_id
) on table public.member_schedule_versions to authenticated;
grant delete on table public.member_schedule_versions to authenticated;

-- ---------------------------------------------------------------- triggers

-- 0023's organization lock, as 0035 attaches it to `rotation_assignments`.
create trigger member_schedule_versions_serialize_organization_writes
  before insert or delete on public.member_schedule_versions
  for each statement
  execute function public.serialize_organization_writes();

-- 0035's re-check of the caller after the lock (0071's definition, unchanged:
-- the table has no team column for its team branch to read).
create trigger member_schedule_versions_refuse_write_by_stale_admin
  before insert or delete on public.member_schedule_versions
  for each row
  execute function public.refuse_write_by_stale_admin();

-- 0039's refusal of a version onto a pattern with an archived type
-- (23514 `ROTATION_PATTERN_ARCHIVED_TYPE`); it reads `new.pattern_id`, which
-- a `TEAM` or `MANUAL` version leaves null, so it refuses nothing there.
create trigger member_schedule_versions_refuse_write_while_archived_type
  before insert on public.member_schedule_versions
  for each row
  execute function public.refuse_assignment_on_archived_type();

-- AD-3's two change-history triggers, in 0061's exact shape.
create trigger member_schedule_versions_audit after insert or delete on public.member_schedule_versions
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger member_schedule_versions_audit_update after update on public.member_schedule_versions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- ------------------------------------------------------------------ notice

-- E-3: the member hears of a change to how they are scheduled, once per
-- version. An insert says the version's own source from its date. A cancel
-- (ONLY A REQUEST SESSION'S DIRECT DELETE, of a version still ahead: an
-- organization delete cascades one trigger level deeper, as 0043's rotation
-- cancel guards, and a service or owner clean-up is no admin's cancel) says
-- the source then in force from that date, under a subject of its own so the
-- outbox's once-key never swallows it. `notify_members` skips the actor, a
-- member with no address and one not active today.
create function private.notify_schedule_version() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  if tg_op = 'INSERT' then
    perform private.notify_members(
      new.organization_id,
      'SCHEDULE_SOURCE_CHANGED',
      new.id,
      array[new.member_id],
      pg_catalog.jsonb_build_object(
        'effectiveFrom', pg_catalog.to_char(new.effective_from, 'YYYY-MM-DD'),
        'source', new.source
      )
    );
    return null;
  end if;

  if pg_catalog.pg_trigger_depth() > 1
     or pg_catalog.current_setting('role') <> 'authenticated'
     or old.effective_from <= public.organization_today(old.organization_id) then
    return null;
  end if;

  v_source := coalesce((
    select v.source
      from public.member_schedule_versions v
     where v.organization_id = old.organization_id
       and v.member_id = old.member_id
       and v.effective_from < old.effective_from
     order by v.effective_from desc
     limit 1
  ), 'TEAM');

  perform private.notify_members(
    old.organization_id,
    'SCHEDULE_SOURCE_CHANGED',
    pg_catalog.md5('SCHEDULE_SOURCE_CANCELLED:' || old.id::text)::uuid,
    array[old.member_id],
    pg_catalog.jsonb_build_object(
      'effectiveFrom', pg_catalog.to_char(old.effective_from, 'YYYY-MM-DD'),
      'source', v_source
    )
  );
  return null;
end;
$$;

revoke execute on function private.notify_schedule_version() from public, anon, authenticated, service_role;

create trigger member_schedule_versions_notify_insert
  after insert on public.member_schedule_versions
  for each row
  execute function private.notify_schedule_version();

create trigger member_schedule_versions_notify_delete
  after delete on public.member_schedule_versions
  for each row
  execute function private.notify_schedule_version();

-- ------------------------------------------------- a pattern in use, widened

-- 0016's predicate, with a member's version as a second use: a pattern a
-- member stands on gains or loses no step, and is not deleted (0025).
create or replace function public.rotation_pattern_in_use(pattern uuid) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return exists (
    select 1
      from public.rotation_assignments a
     where a.pattern_id = pattern
  )
  or exists (
    select 1
      from public.member_schedule_versions v
     where v.pattern_id = pattern
  );
end;
$$;

revoke execute on function public.rotation_pattern_in_use(uuid) from public;
revoke execute on function public.rotation_pattern_in_use(uuid) from anon;
revoke execute on function public.rotation_pattern_in_use(uuid) from service_role;
grant execute on function public.rotation_pattern_in_use(uuid) to authenticated;

-- ------------------------------------- no archive under a member's rotation

-- 0037's function, with a member's version as a second reader: a step of the
-- type in a pattern that some member's version in force today, or scheduled
-- after today, names. The same refusal (23514 `SHIFT_TYPE_IN_ROTATION`).
create or replace function public.refuse_archive_in_rotation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  -- A step of the type in a pattern that some team's version in force
  -- today, or scheduled after today, names.
  if exists (
    select 1
      from public.rotation_steps step
      join public.rotation_assignments a
        on a.organization_id = step.organization_id
       and a.pattern_id = step.pattern_id
     where step.organization_id = new.organization_id
       and step.shift_type_id = new.id
       and (
         a.effective_from > public.organization_today(a.organization_id)
         or a.effective_from = (
           select max(b.effective_from)
             from public.rotation_assignments b
            where b.team_id = a.team_id
              and b.effective_from <= public.organization_today(b.organization_id)
         )
       )
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'SHIFT_TYPE_IN_ROTATION';
  end if;

  -- 0079: the same, for a member's own rotation.
  if exists (
    select 1
      from public.rotation_steps step
      join public.member_schedule_versions v
        on v.organization_id = step.organization_id
       and v.pattern_id = step.pattern_id
     where step.organization_id = new.organization_id
       and step.shift_type_id = new.id
       and (
         v.effective_from > public.organization_today(v.organization_id)
         or v.effective_from = (
           select max(w.effective_from)
             from public.member_schedule_versions w
            where w.organization_id = v.organization_id
              and w.member_id = v.member_id
              and w.effective_from <= public.organization_today(w.organization_id)
         )
       )
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'SHIFT_TYPE_IN_ROTATION';
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_archive_in_rotation() from public;
revoke execute on function public.refuse_archive_in_rotation() from anon;
revoke execute on function public.refuse_archive_in_rotation() from authenticated;
revoke execute on function public.refuse_archive_in_rotation() from service_role;

-- ------------------------------------------------------ the server assembly

-- 0077's assembly, with every member's schedule versions, WHOLE (AD-19 as
-- amended 2026-11-25): a versioned rule comes whole, as the rotation versions
-- do, and EVERY member's, because a member's source decides their place on
-- base rosters (R15.3), which other members' roster overrides read.
-- `{ effectiveFrom, source, patternId, offsetStepId }` by date; `[]` for a
-- member with none. `steps` already holds every step of the organization, so
-- a pattern only a member's version names projects too.
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

-- ------------------------------------------------------ the reminder write

-- 0077's write, with the `PERSONAL_ROTATION` item form (AD-18 as amended
-- 2026-11-25). Three forms, nothing else:
--
--   * the TEAM form, exactly 0070's eight keys, unchanged;
--   * the ASSIGNMENT form (0077), unchanged;
--   * the PERSONAL_ROTATION form, the eight keys plus `source:
--     'PERSONAL_ROTATION'`, whose `teamId` is a team or null (a member on no
--     team, R14.3).
--
-- A PERSONAL_ROTATION item is skipped unless the member's schedule version
-- in force on its date is `PERSONAL` and no live Personal Assignment holds
-- that date. Its subject is
-- `md5('SHIFT_REMINDER:'||member||':'||date||':p:'||lead)`, so it never
-- collides with a team or an assignment reminder. Its operands are the team
-- form's, or the no-team variant's with no team (0077).
create or replace function public.enqueue_shift_reminders(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_member uuid;
  v_date date;
  v_team uuid;
  v_shift_type uuid;
  v_assignment uuid;
  v_personal_rotation boolean;
  v_lead text;
  v_start integer;
  v_end integer;
  v_starts_at timestamptz;
  v_organization uuid;
  v_team_name text;
  v_shift_type_name text;
  v_operands jsonb;
  v_today date;
  accepted integer := 0;
begin
  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) > 10000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
  end if;

  for item in select e.value from pg_catalog.jsonb_array_elements(p_items) as e loop
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;
    if not coalesce(
       (
         case
           when not (item ? 'source') then
             (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) = 8
             and item ?& array['memberId', 'date', 'teamId', 'shiftTypeId', 'lead', 'start', 'end', 'startsAt']
             and pg_catalog.jsonb_typeof(item -> 'teamId') = 'string'
             and (item ->> 'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           -- 0077: the assignment form, its team a team or none.
           when pg_catalog.jsonb_typeof(item -> 'source') = 'string' and (item ->> 'source') = 'ASSIGNMENT' then
             (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) = 10
             and item ?& array['memberId', 'date', 'teamId', 'shiftTypeId', 'lead', 'start', 'end', 'startsAt', 'source', 'personalAssignmentId']
             and pg_catalog.jsonb_typeof(item -> 'personalAssignmentId') = 'string'
             and (item ->> 'personalAssignmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             and (
               pg_catalog.jsonb_typeof(item -> 'teamId') = 'null'
               or (
                 pg_catalog.jsonb_typeof(item -> 'teamId') = 'string'
                 and (item ->> 'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               )
             )
           -- 0079: the personal-rotation form, its team a team or none.
           when pg_catalog.jsonb_typeof(item -> 'source') = 'string' and (item ->> 'source') = 'PERSONAL_ROTATION' then
             (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) = 9
             and item ?& array['memberId', 'date', 'teamId', 'shiftTypeId', 'lead', 'start', 'end', 'startsAt', 'source']
             and (
               pg_catalog.jsonb_typeof(item -> 'teamId') = 'null'
               or (
                 pg_catalog.jsonb_typeof(item -> 'teamId') = 'string'
                 and (item ->> 'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               )
             )
           else false
         end
       )
       and pg_catalog.jsonb_typeof(item -> 'memberId') = 'string'
       and pg_catalog.jsonb_typeof(item -> 'shiftTypeId') = 'string'
       and pg_catalog.jsonb_typeof(item -> 'date') = 'string'
       and pg_catalog.jsonb_typeof(item -> 'lead') = 'string'
       and pg_catalog.jsonb_typeof(item -> 'startsAt') = 'string'
       and pg_catalog.jsonb_typeof(item -> 'start') = 'number'
       and pg_catalog.jsonb_typeof(item -> 'end') = 'number'
       and (item ->> 'memberId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and (item ->> 'shiftTypeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and (item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
       and (item ->> 'startsAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
       and (item ->> 'start') ~ '^\d{1,4}$'
       and (item ->> 'end') ~ '^\d{1,4}$'
       and (item ->> 'lead') = any(array['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']::text[]),
       false
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;

    begin
      v_member := (item ->> 'memberId')::uuid;
      v_team := (item ->> 'teamId')::uuid;
      v_shift_type := (item ->> 'shiftTypeId')::uuid;
      v_assignment := (item ->> 'personalAssignmentId')::uuid;
      v_personal_rotation := coalesce(item ->> 'source', '') = 'PERSONAL_ROTATION';
      v_date := (item ->> 'date')::date;
      v_starts_at := (item ->> 'startsAt')::timestamptz;
      v_start := (item ->> 'start')::integer;
      v_end := (item ->> 'end')::integer;
      v_lead := item ->> 'lead';
    exception
      when others then
        raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end;

    if coalesce(
         v_start < 0 or v_end <= v_start or v_end > 2879
         or pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> (item ->> 'date'),
         true
       ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;

    v_organization := null;
    select m.organization_id
      into v_organization
      from public.members m
     where m.id = v_member;

    v_today := case when v_organization is null then null else public.organization_today(v_organization) end;

    if v_organization is null
       or not private.organization_live(v_organization)
       or not exists (
         select 1
           from public.members m
           join auth.users u on u.id = m.auth_user_id
          where m.id = v_member
            and u.deleted_at is null
            and (u.banned_until is null or u.banned_until <= now())
       )
       or v_today is null
       or not public.member_active_on(v_member, v_today)
       or not private.reminder_lead_on(v_organization, v_member, v_lead)
       or v_starts_at <= now()
       or v_starts_at > now() + interval '2 days' then
      continue;
    end if;

    -- 0077: an assignment's reminder only while its row is live and equal.
    if v_assignment is not null and not exists (
      select 1
        from private.live_personal_assignments(v_organization) p
       where p.id = v_assignment
         and p.member_id = v_member
         and p.date = v_date
         and p.kind = 'SHIFT'
         and p.shift_type_id = v_shift_type
         -- A row naming its team names the item's; one naming none counts with
         -- the member's effective team, which only the domain derives.
         and (p.team_id is null or p.team_id is not distinct from v_team)
    ) then
      continue;
    end if;

    -- 0079: a personal rotation's reminder only while that rotation decides
    -- the date: the member's version in force on it is `PERSONAL` (none is
    -- `TEAM`, R15.2), and no live assignment holds the date (R15.3, step 1).
    if v_personal_rotation and (
      coalesce((
        select v.source
          from public.member_schedule_versions v
         where v.organization_id = v_organization
           and v.member_id = v_member
           and v.effective_from <= v_date
         order by v.effective_from desc
         limit 1
      ), 'TEAM') <> 'PERSONAL'
      or exists (
        select 1
          from private.live_personal_assignments(v_organization) p
         where p.member_id = v_member
           and p.date = v_date
      )
    ) then
      continue;
    end if;

    v_team_name := null;
    if v_team is not null then
      select t.name
        into v_team_name
        from public.teams t
       where t.organization_id = v_organization
         and t.id = v_team;
      if v_team_name is null then
        continue;
      end if;
    end if;

    v_shift_type_name := null;
    select s.name
      into v_shift_type_name
      from public.shift_types s
     where s.organization_id = v_organization
       and s.id = v_shift_type;

    if v_shift_type_name is null then
      continue;
    end if;

    v_operands := pg_catalog.jsonb_build_object(
      'date', pg_catalog.to_char(v_date, 'YYYY-MM-DD'),
      'start', v_start,
      'end', v_end,
      'startsAt', pg_catalog.to_char(v_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'lead', v_lead,
      'shiftTypeName', v_shift_type_name
    ) || case
           when v_team is null then '{}'::jsonb
           else pg_catalog.jsonb_build_object('teamId', v_team, 'teamName', v_team_name)
         end
      || case
           when v_lead = 'EVENING_BEFORE' then '{}'::jsonb
           else pg_catalog.jsonb_build_object('leadHours', pg_catalog.substr(v_lead, 2)::integer)
         end;

    perform private.notify_members(
      v_organization,
      'SHIFT_REMINDER',
      case
        -- 0079: a personal rotation's, keyed `:p:` so it never collides with a team's or an assignment's.
        when v_personal_rotation then
          pg_catalog.md5(
            'SHIFT_REMINDER:' || v_member::text || ':' || pg_catalog.to_char(v_date, 'YYYY-MM-DD') || ':p:' || v_lead
          )::uuid
        when v_assignment is null then
          pg_catalog.md5(
            'SHIFT_REMINDER:' || v_member::text || ':' || pg_catalog.to_char(v_date, 'YYYY-MM-DD') || ':' || v_team::text || ':' || v_lead
          )::uuid
        else
          pg_catalog.md5(
            'SHIFT_REMINDER:' || v_member::text || ':' || pg_catalog.to_char(v_date, 'YYYY-MM-DD') || ':a:' || v_assignment::text || ':' || v_lead
          )::uuid
      end,
      array[v_member],
      v_operands
    );

    accepted := accepted + 1;
  end loop;

  return accepted;
end;
$$;

revoke execute on function public.enqueue_shift_reminders(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_shift_reminders(jsonb) to service_role;
