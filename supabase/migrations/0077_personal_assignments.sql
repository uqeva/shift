-- 0077_personal_assignments.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.2: a Personal Assignment is a recorded exception (R14, AD-26, AD-2,
-- AD-11, AD-18, AD-19; founder decisions E-2 and E-3, 2026-11-25).
--
-- One table. `personal_assignments` records that ONE MEMBER, on ONE DATE, has
-- a shift type (working or not) or a plain day off, decided by an admin. It is
-- an EXCEPTION, like a loan: dated, never versioned, removed rather than
-- edited, and at most one LIVE per member and date. What it derives is
-- `packages/domain`'s alone (`personal.ts`, AD-7). Nothing here writes a
-- rotation, membership, status or override row.
--
--   * KIND `SHIFT` names a shift type; `OFF` names none. A `SHIFT` may name the
--     team it counts with; none means the member's effective team (R14.3). An
--     `OFF` names no team.
--   * A NOTE of 1–200 code points after 0036's trim, or none. Shown to admins
--     only: every member reads the live rows WITHOUT note or author (E-2).
--   * ATTRIBUTED (AD-11): `created_by`/`created_at` from defaults; the removal
--     pair `removed_by`/`removed_at`, both or neither.
--   * ONE LIVE ROW PER MEMBER AND DATE: a partial unique index (23505).
--   * AUDITED: AD-3's two change-history triggers.
--
-- WRITES: no session holds INSERT, UPDATE, DELETE or TRUNCATE. The one writer
-- is the definer `save_personal_assignments(p_changes)`, so the grid, the
-- pattern fill, copy, the member page's one date and the floater cover all
-- write one way. It takes 0023's organization lock, re-reads the caller as an
-- active admin (42501 `PERSONAL_ASSIGNMENTS_REFUSED`), checks the WHOLE batch
-- before writing anything (22023 `PERSONAL_ASSIGNMENTS_INVALID`), replaces
-- each live row it changes (an attributed soft-removal, then an insert), and
-- writes ONE `SCHEDULE_ASSIGNED` per affected member per save (E-3).
--
-- READS: an active admin reads the table. Every active member reads the live
-- rows through `calendar_personal_assignments()`; the server assembly reads
-- them through the fifth live helper, `private.live_personal_assignments`.
--
-- ALSO RE-CREATED, each from its latest definition with only the additions
-- named:
--   * `private.member_schedule_inputs` (0065): every member gains
--     `personalAssignments`, dated in the window (AD-19 as amended);
--   * `public.enqueue_shift_reminders` (0075): the `ASSIGNMENT` item form,
--     whose team may be none (AD-18 as amended).
--
-- DEPLOY ORDER: `db push`, then the functions (`remind`, `calendar-feed` and
-- `notify` carry the new forms), then the SPA. No assignment exists until 21.4
-- ships a surface that writes one, so the order is not load-bearing.

create table personal_assignments (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  -- A civil date, never an instant.
  date date not null,

  kind text not null,

  -- Required for `SHIFT`, null for `OFF`. A non-working type is allowed and
  -- reads as off (R14.3).
  shift_type_id uuid,

  -- The team the shift counts with when it is not the member's effective one.
  team_id uuid,

  -- Why. Shown to admins only (E-2).
  note text,

  -- AD-11: defaults no session can reach (it holds no insert privilege).
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  removed_by uuid,
  removed_at timestamptz,

  -- To 0002's unique (organization_id, id). NO cascade.
  constraint personal_assignments_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  constraint personal_assignments_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references shift_types (organization_id, id),

  constraint personal_assignments_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  constraint personal_assignments_kind_check
    check (kind in ('SHIFT', 'OFF')),

  -- A shift names its type; a day off names none.
  constraint personal_assignments_shift_type_by_kind
    check ((kind = 'SHIFT') = (shift_type_id is not null)),

  -- A day off counts with no team.
  constraint personal_assignments_off_has_no_team
    check (kind = 'SHIFT' or team_id is null),

  -- In years 0001–9999, for the reason 0016 gives.
  constraint personal_assignments_date_in_years
    check (date between date '0001-01-01' and date '9999-12-31'),

  -- 0036's trim, by code point and not by collation.
  constraint personal_assignments_note_length
    check (
      note is null
      or char_length(
        pg_catalog.btrim(
          note,
          U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        )
      ) between 1 and 200
    ),

  constraint personal_assignments_removal_complete
    check ((removed_by is null) = (removed_at is null))
);

alter table personal_assignments enable row level security;

-- Q3: every policy below filters by the tenant first.
create index personal_assignments_organization_id_idx on personal_assignments (organization_id);

-- R14.1: at most one LIVE assignment per member and date. A removed row
-- leaves the key, so a replacement is a removal and an insert.
-- The two keys a team or shift type is checked or cleaned up through.
create index personal_assignments_organization_shift_type_idx on personal_assignments (organization_id, shift_type_id);
create index personal_assignments_organization_team_idx on personal_assignments (organization_id, team_id);

create unique index personal_assignments_one_live_per_date
  on personal_assignments (organization_id, member_id, date)
  where removed_at is null;

-- ------------------------------------------------------------------ the policy

-- Only an active admin of the token's organization reads the table: it holds
-- the note and auth user ids. Every member reads the live rows through the
-- function below. No insert, update or delete policy: no session writes.
create policy personal_assignments_select_by_own_active_admin on public.personal_assignments
  for select
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

-- As 0062: Supabase's default privileges grant every table privilege to
-- `anon` and `authenticated`. Here a session writes nothing at all.
revoke insert, update, delete, truncate, references, trigger on table public.personal_assignments
  from anon, authenticated;
revoke select on table public.personal_assignments from anon;
revoke truncate on table public.personal_assignments from anon, authenticated, service_role;

-- --------------------------------------------------------------- the triggers

-- AD-3's two change-history triggers, in 0061's exact shape.
create trigger personal_assignments_audit after insert or delete on public.personal_assignments
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger personal_assignments_audit_update after update on public.personal_assignments
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- ------------------------------------------------------------- the live helper

-- AD-19's fifth "live" helper, 0065's shape: STABLE SQL, invoker, executable
-- by no role. Its callers are definers owned by the migration role.
create function private.live_personal_assignments(p_organization uuid)
returns setof public.personal_assignments
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
    from public.personal_assignments p
   where p.organization_id = p_organization
     and p.removed_at is null
$$;

revoke execute on function private.live_personal_assignments(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------- the member read

-- The LIVE assignments of the caller's own organization, for every active
-- member (E-2): who works what, the same ground the loan read stands on. No
-- note, no author, nothing about a removed row. Every date at once, as the
-- calendar snapshot reads every month at once. Zero rows unless the caller is
-- active today and the token's organization is their own (0018's pins).
--
-- ONE jsonb ARRAY, not a set of rows: PostgREST caps a set-returning
-- function's answer at `max_rows` (1000, `supabase/config.toml`) without an
-- error, and a month's grid passes that, so a row set would be cut silently
-- and the browser would derive without some assignments. A scalar answer is
-- never cut. Each element is `{ id, member_id, date, kind, shift_type_id,
-- team_id }`, by member, date and id; `[]` for none. NULL, saying nothing,
-- for a caller who is not an active member of the claimed organization (a
-- claimless account, a suspended organization, another tenant's claim), as
-- the catalog sweeps (19.1, 19.5) require of every function.
create function public.calendar_personal_assignments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when not exists (
             select 1
               from public.current_member_access() as access
              where access.is_active
                and access.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
           ) then null
           else coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', p.id,
               'member_id', p.member_id,
               'date', p.date,
               'kind', p.kind,
               'shift_type_id', p.shift_type_id,
               'team_id', p.team_id
             )
             order by p.member_id, p.date, p.id
           ),
           '[]'::jsonb
         )
         end
    from private.live_personal_assignments(nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid) p
   where p.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
$$;

revoke execute on function public.calendar_personal_assignments() from public;
revoke execute on function public.calendar_personal_assignments() from anon;
revoke execute on function public.calendar_personal_assignments() from service_role;
grant execute on function public.calendar_personal_assignments() to authenticated;

-- ---------------------------------------------------------------- the one write

-- `p_changes` is a JSON array of at most 5 000 items, each exactly
--
--   { "memberId": uuid, "date": "YYYY-MM-DD", "set": { "kind": "SHIFT" | "OFF",
--     "shiftTypeId"?: uuid, "teamId"?: uuid | null, "note"?: text | null } }
--   { "memberId": uuid, "date": "YYYY-MM-DD", "clear": true }
--
-- A `SHIFT` names a type and may name a team; an `OFF` names neither (absent
-- or null). EVERY item is checked before ANY row is written: the member is the
-- organization's (active or not: an assignment on an inactive date derives
-- nothing, R14.3, and a season is planned ahead, 21.11); the type and team are
-- the organization's and not archived; the date is a calendar date in years
-- 0001–9999; no member and date twice; no other key. Any breach is 22023
-- `PERSONAL_ASSIGNMENTS_INVALID` and nothing is written. A note is stored as
-- 0036 trims it.
--
-- Then, per item: an item equal to the live row (kind, type, team, note), or a
-- `clear` with no live row, writes nothing. Otherwise the live row, if any, is
-- soft-removed (attributed) and, for a `set`, the new row inserted. The answer
-- is `{ inserted, removed, unchanged }`.
--
-- THE NOTICE (E-3, AD-18 as amended): one `SCHEDULE_ASSIGNED` per member whose
-- CHANGED DAYS include one on or after the organization's today, with
-- `{ from, to, days }` over those days only, through `private.notify_members`
-- (its one recipient rule: never the writer, active today, an address for
-- email, a device for push). A replacement that changes only the note changes
-- no day (the member never sees a note, E-2) and tells nobody. One fresh
-- subject per call. 0043's `shift.notify_suppress` flag is held over the
-- writes, so no per-row notifier a later migration attaches can add a notice
-- per cell.
--
-- The batch is held in typed arrays and checked with no exception block per
-- item, so 5 000 items stay linear and open no subtransaction each.
create function public.save_personal_assignments(p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  item jsonb;
  body jsonb;
  good boolean;
  v_clear boolean;
  v_kind text;
  v_shift_type uuid;
  v_team uuid;
  v_note text;
  a_member uuid[] := '{}'::uuid[];
  a_date date[] := '{}'::date[];
  a_clear boolean[] := '{}'::boolean[];
  a_kind text[] := '{}'::text[];
  a_type uuid[] := '{}'::uuid[];
  a_team uuid[] := '{}'::uuid[];
  a_note text[] := '{}'::text[];
  i integer;
  live_id uuid;
  live_kind text;
  live_shift_type uuid;
  live_team uuid;
  live_note text;
  changed_members uuid[] := '{}'::uuid[];
  changed_dates date[] := '{}'::date[];
  inserted integer := 0;
  removed integer := 0;
  unchanged integer := 0;
  v_today date;
  v_subject uuid;
  told record;
begin
  -- 0023's lock first, then the caller re-read on the locked state (0064).
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'PERSONAL_ASSIGNMENTS_REFUSED';
  end if;

  if p_changes is null
     or pg_catalog.jsonb_typeof(p_changes) <> 'array'
     or pg_catalog.jsonb_array_length(p_changes) > 5000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'PERSONAL_ASSIGNMENTS_INVALID';
  end if;

  -- ------------------------------------------------ pass 1: the whole batch

  for item in select e.value from pg_catalog.jsonb_array_elements(p_changes) as e loop
    good := pg_catalog.jsonb_typeof(item) = 'object';

    -- Its keys only once it is an object (a scalar has none to list).
    if good then
      good := coalesce(
        (
          (select pg_catalog.array_agg(k collate "C" order by k collate "C") from pg_catalog.jsonb_object_keys(item) as k)
            in (array['date', 'memberId', 'set']::text[], array['clear', 'date', 'memberId']::text[])
        )
        and pg_catalog.jsonb_typeof(item -> 'memberId') = 'string'
        and (item ->> 'memberId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and pg_catalog.jsonb_typeof(item -> 'date') = 'string'
        and (item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_catalog.pg_input_is_valid(item ->> 'date', 'date'),
        false
      );
    end if;

    -- Both casts are safe here: the uuid matched its shape, and the date is valid input.
    if good then
      good := pg_catalog.to_char((item ->> 'date')::date, 'YYYY-MM-DD') = (item ->> 'date')
        and exists (
          select 1 from public.members m where m.organization_id = claimed and m.id = (item ->> 'memberId')::uuid
        );
    end if;

    v_clear := good and item ? 'clear';
    v_kind := null;
    v_shift_type := null;
    v_team := null;
    v_note := null;

    if good and v_clear then
      good := item -> 'clear' = 'true'::jsonb;
    elsif good then
      body := item -> 'set';
      good := pg_catalog.jsonb_typeof(body) = 'object';
      if good then
        good := not exists (
          select 1
            from pg_catalog.jsonb_object_keys(body) as k
           where k not in ('kind', 'shiftTypeId', 'teamId', 'note')
        )
        and pg_catalog.jsonb_typeof(body -> 'kind') = 'string'
        and (body ->> 'kind') in ('SHIFT', 'OFF')
        and coalesce(pg_catalog.jsonb_typeof(body -> 'note'), 'null') in ('null', 'string')
        and coalesce(pg_catalog.jsonb_typeof(body -> 'teamId'), 'null') in ('null', 'string')
        and coalesce(pg_catalog.jsonb_typeof(body -> 'shiftTypeId'), 'null') in ('null', 'string');
      end if;

      if good then
        v_kind := body ->> 'kind';
        v_note := body ->> 'note';
        good := coalesce(
          (body ->> 'shiftTypeId') is null
          or (body ->> 'shiftTypeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          false
        ) and coalesce(
          (body ->> 'teamId') is null
          or (body ->> 'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          false
        );
      end if;

      if good then
        v_shift_type := (body ->> 'shiftTypeId')::uuid;
        v_team := (body ->> 'teamId')::uuid;
        good := case
          when v_kind = 'SHIFT' then
            v_shift_type is not null
            and exists (
              select 1
                from public.shift_types s
               where s.organization_id = claimed and s.id = v_shift_type and not s.archived
            )
            and (
              v_team is null
              or exists (
                select 1
                  from public.teams t
                 where t.organization_id = claimed and t.id = v_team and not t.archived
              )
            )
          else v_shift_type is null and v_team is null
        end;
      end if;

      -- Stored as 0036 trims it, so a note differing only in surrounding white
      -- space is the same note (and an equal item writes nothing).
      if good and v_note is not null then
        v_note := pg_catalog.btrim(
          v_note,
          U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        );
        good := pg_catalog.char_length(v_note) between 1 and 200;
      end if;
    end if;

    if not coalesce(good, false) then
      raise exception using errcode = 'invalid_parameter_value', message = 'PERSONAL_ASSIGNMENTS_INVALID';
    end if;

    a_member := a_member || (item ->> 'memberId')::uuid;
    a_date := a_date || (item ->> 'date')::date;
    a_clear := a_clear || v_clear;
    a_kind := a_kind || v_kind;
    a_type := a_type || v_shift_type;
    a_team := a_team || v_team;
    a_note := a_note || v_note;
  end loop;

  -- No member and date twice in one batch.
  if exists (
    select 1
      from rows from (pg_catalog.unnest(a_member), pg_catalog.unnest(a_date)) as w(member_id, day)
     group by w.member_id, w.day
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'PERSONAL_ASSIGNMENTS_INVALID';
  end if;

  -- --------------------------------------------------------- pass 2: writes

  perform pg_catalog.set_config('shift.notify_suppress', 'batch', true);

  for i in 1 .. coalesce(pg_catalog.array_length(a_member, 1), 0) loop
    live_id := null;
    live_kind := null;
    live_shift_type := null;
    live_team := null;
    live_note := null;
    select p.id, p.kind, p.shift_type_id, p.team_id, p.note
      into live_id, live_kind, live_shift_type, live_team, live_note
      from public.personal_assignments p
     where p.organization_id = claimed
       and p.member_id = a_member[i]
       and p.date = a_date[i]
       and p.removed_at is null
     for update;

    if a_clear[i] and live_id is null then
      unchanged := unchanged + 1;
      continue;
    end if;

    if not a_clear[i]
       and live_id is not null
       and live_kind = a_kind[i]
       and live_shift_type is not distinct from a_type[i]
       and live_team is not distinct from a_team[i]
       and live_note is not distinct from a_note[i] then
      unchanged := unchanged + 1;
      continue;
    end if;

    if live_id is not null then
      update public.personal_assignments p
         set removed_by = auth.uid(),
             removed_at = now()
       where p.id = live_id;
      removed := removed + 1;
    end if;

    if not a_clear[i] then
      insert into public.personal_assignments (organization_id, member_id, date, kind, shift_type_id, team_id, note)
      values (claimed, a_member[i], a_date[i], a_kind[i], a_type[i], a_team[i], a_note[i]);
      inserted := inserted + 1;
    end if;

    -- The member's day changed, unless only the note did.
    if a_clear[i]
       or live_id is null
       or live_kind <> a_kind[i]
       or live_shift_type is distinct from a_type[i]
       or live_team is distinct from a_team[i] then
      changed_members := changed_members || a_member[i];
      changed_dates := changed_dates || a_date[i];
    end if;
  end loop;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  -- ------------------------------------------- the batched notice (E-3)

  v_today := public.organization_today(claimed);
  if v_today is not null and pg_catalog.cardinality(changed_members) > 0 then
    v_subject := pg_catalog.gen_random_uuid();
    for told in
      select w.member_id,
             pg_catalog.min(w.day) as first_day,
             pg_catalog.max(w.day) as last_day,
             pg_catalog.count(distinct w.day)::integer as days
        from rows from (pg_catalog.unnest(changed_members), pg_catalog.unnest(changed_dates)) as w(member_id, day)
       where w.day >= v_today
       group by w.member_id
       order by w.member_id
    loop
      perform private.notify_members(
        claimed,
        'SCHEDULE_ASSIGNED',
        v_subject,
        array[told.member_id],
        pg_catalog.jsonb_build_object(
          'from', pg_catalog.to_char(told.first_day, 'YYYY-MM-DD'),
          'to', pg_catalog.to_char(told.last_day, 'YYYY-MM-DD'),
          'days', told.days
        )
      );
    end loop;
  end if;

  return pg_catalog.jsonb_build_object('inserted', inserted, 'removed', removed, 'unchanged', unchanged);
end;
$$;

revoke execute on function public.save_personal_assignments(jsonb) from public;
revoke execute on function public.save_personal_assignments(jsonb) from anon;
revoke execute on function public.save_personal_assignments(jsonb) from service_role;
grant execute on function public.save_personal_assignments(jsonb) to authenticated;

-- ------------------------------------------------------ the server assembly

-- 0065's assembly, with every member's live assignments dated in the window
-- (AD-19 as amended 2026-11-25): EVERY member's, because they decide other
-- members' places on base rosters (R14.2), which a roster override's
-- applicability reads. `{ id, date, kind, shiftTypeId, teamId }`, by date and
-- id, never a note or an author; `[]` for a member with none.
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

-- 0075's write, with the `ASSIGNMENT` item form (AD-18 as amended 2026-11-25).
-- Two forms, nothing else:
--
--   * the TEAM form, exactly 0070's eight keys, unchanged: `{ memberId, date,
--     teamId, shiftTypeId, lead, start, end, startsAt }` with a team;
--   * the ASSIGNMENT form, those eight plus `source: 'ASSIGNMENT'` and
--     `personalAssignmentId`, whose `teamId` is a team or null (a Personal
--     Shift counted with no team, R14.3).
--
-- An ASSIGNMENT item is skipped unless that row is still live, the member's,
-- a `SHIFT`, of that date and shift type, and (when the row names a team) of
-- that team. Its subject is
-- `md5('SHIFT_REMINDER:'||member||':'||date||':a:'||assignment||':'||lead)`,
-- so it never collides with a team reminder. With no team, the operands carry
-- neither `teamId` nor `teamName`, and `notify` renders the no-team variant.
-- The personal-rotation form is story 21.9's.
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
