-- 0081_teamless_conflicts.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.7: a leave over a personal shift is a conflict, and a replacement
-- is an assignment (AD-4 as amended 2026-11-25; AD-26; R14.5, R16.3).
--
-- A leave record over a WORKING PERSONAL SHIFT is a collision like any other,
-- keyed `(member, date, team)` with the team the shift counts with, which may
-- be NONE (a dispatcher or a student with no team). The browser derives it
-- (`collisionsOf`); this file only lets its decision be stored.
--
--   (i)   `conflict_resolutions.team_id` becomes NULLABLE. 0031's composite
--         key to `teams` still holds a set team to the tenant (MATCH SIMPLE
--         skips a null one).
--   (ii)  The live key `conflict_resolutions_live_key` is re-created NULLS NOT
--         DISTINCT (PostgreSQL 15+), so a teamless key still holds ONE live
--         decision per member and date.
--   (iii) `personal_assignments` gains `unique (organization_id, id)`, the key
--         the link below references, as 0032 gave `roster_overrides` one.
--   (iv)  REPLACE MEMBER'S SECOND FORM: `conflict_resolutions.
--         personal_assignment_id`, a composite key to the same organization's
--         assignment, NO cascade, NO grant. 0032's check is re-stated so a
--         `replace_member` names EXACTLY ONE of the override and the
--         assignment, and any other kind names neither.
--   (v)   0038's `refuse_conflict_resolution_off_leave()` re-created: its
--         supersede compares the team with `is not distinct from`, so a
--         teamless key is superseded like a team's.
--   (vi)  THE LIFETIME (and a note alone keeps it, by a second trigger):
--         removing the linked assignment ends the decision in
--         the same transaction, as 0033 does for an override. An AFTER UPDATE
--         trigger on `personal_assignments` soft-removes the live resolution
--         that names a row the moment its `removed_at` is set, attributed to
--         that removal. `save_personal_assignments` (0077) is the only writer
--         that removes one, so the grid, the fill, copy and (21.8) a swap all
--         end it the same way, with no change to the save.
--   (vii) `resolve_with_personal_assignment(p_items)`: the replacement's
--         assignment (through 0077's one save, so its checks and its ONE
--         `SCHEDULE_ASSIGNED` per member apply) and the resolution that names
--         it, for one item or a whole leave (21.14), in one transaction.
--   (viii) `my_conflict_resolutions()` dropped and re-created with
--         `personal_assignment_id` as its last column; 0038's grants, written
--         again.
--
-- WHETHER A REPLACEMENT BY ASSIGNMENT STILL APPLIES is the browser's question
-- (AD-4, never a roster computed here): it matches while the assignment is
-- live, of the collision's date and shift type, and counted with the
-- collision's team (`replacement-effect.ts`).
--
-- No new table, policy, or table grant.

-- ---------------------------------------------------------- (i) the team

alter table public.conflict_resolutions
  alter column team_id drop not null;

-- ------------------------------------------------------ (ii) the live key

drop index public.conflict_resolutions_live_key;

create unique index conflict_resolutions_live_key
  on public.conflict_resolutions (organization_id, member_id, date, team_id)
  nulls not distinct
  where removed_at is null;

-- --------------------------------------------------- (iii) the link's key

alter table public.personal_assignments
  add constraint personal_assignments_organization_id_id_key unique (organization_id, id);

-- -------------------------------------------------------- (iv) the link

alter table public.conflict_resolutions
  add column personal_assignment_id uuid;

-- NO cascade: an assignment is soft-removed, never deleted.
alter table public.conflict_resolutions
  add constraint conflict_resolutions_personal_assignment_fkey
    foreign key (organization_id, personal_assignment_id)
    references public.personal_assignments (organization_id, id);

-- 0032's rule, with the second form: a replacement names exactly one link,
-- every other kind none. Every stored row satisfies it (0032's check held).
alter table public.conflict_resolutions
  drop constraint conflict_resolutions_replacement_linked;

alter table public.conflict_resolutions
  add constraint conflict_resolutions_replacement_linked
    check (
      pg_catalog.num_nonnulls(roster_override_id, personal_assignment_id)
        = case when kind = 'replace_member' then 1 else 0 end
    );

-- The lifetime trigger reaches a resolution by its assignment without a scan.
create index conflict_resolutions_personal_assignment_idx
  on public.conflict_resolutions (organization_id, personal_assignment_id);

-- No grant on `personal_assignment_id`: the function below is the only way a
-- row naming one is written.

-- ---------------------------------- (v) the born-on-leave trigger, and the supersede

create or replace function public.refuse_conflict_resolution_off_leave() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  -- A session that is not an active admin of the claimed organization, or
  -- writes into another one, is the insert policy's to refuse (42501): no
  -- leave is read for it, and nothing is superseded.
  if (select auth.uid()) is not null and (
    claimed is null
    or new.organization_id is distinct from claimed
    or not exists (
      select 1
        from public.current_member_access() as access
       where access.organization_id = claimed
         and access.is_active
         and access.member_role = 'admin'
    )
  ) then
    return new;
  end if;

  -- The share lock serialises against 0029's soft-remove of the same row:
  -- after a wait, the re-check reads `removed_at` as committed.
  perform 1
     from public.leave_records r
    where r.organization_id = new.organization_id
      and r.member_id = new.member_id
      and r.removed_at is null
      and new.date <@ r.during
      for share;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'CONFLICT_RESOLUTION_NOT_ON_LEAVE';
  end if;

  -- 0038: the live decision of this key made on another shift type no longer
  -- decides anything (the browser ignores it); the new one takes its key.
  -- 0081: the team may be none, so it is compared null-safely, as the live
  -- key now is (NULLS NOT DISTINCT).
  update public.conflict_resolutions c
     set removed_by = new.created_by,
         removed_at = now()
   where c.organization_id = new.organization_id
     and c.member_id = new.member_id
     and c.date = new.date
     and c.team_id is not distinct from new.team_id
     and c.removed_at is null
     and c.shift_type_id is not null
     and new.shift_type_id is not null
     and c.shift_type_id <> new.shift_type_id;

  return new;
end;
$$;

-- ------------------------------------------------------- (vi) the lifetime

-- An assignment removed (its `removed_at` set, by 0077's save) ends the live
-- decision that names it, attributed to that removal, so the key can be
-- decided again. At most one live row names an assignment (the function below
-- writes one resolution per assignment, and the live key holds one per
-- conflict). A trigger function: nothing calls it by hand.
create function private.end_resolution_with_assignment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conflict_resolutions c
     set removed_by = new.removed_by,
         removed_at = new.removed_at
   where c.organization_id = new.organization_id
     and c.personal_assignment_id = new.id
     and c.removed_at is null;

  return null;
end;
$$;

revoke execute on function private.end_resolution_with_assignment() from public, anon, authenticated, service_role;

create trigger personal_assignments_end_resolution
  after update of removed_at on public.personal_assignments
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.end_resolution_with_assignment();

-- A NOTE ALONE IS NO CHANGE OF COVER. 0077's save replaces a row whose note
-- alone changed (an attributed removal, then an insert), and the trigger above
-- has then ended its decision. When the save inserts, in the same transaction,
-- a `SHIFT` of the same member and date equal to the row it just removed
-- (kind, type and team), the decision that removal ended is restored and
-- re-pointed to the new row, as long as its key holds no other live decision.
-- Matched on the transaction's `now()`, which the save's removal and the
-- trigger's ending both wrote; any other change of the cover still ends it.
create function private.relink_resolution_to_assignment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conflict_resolutions c
     set personal_assignment_id = new.id,
         removed_by = null,
         removed_at = null
    from public.personal_assignments old
   where old.organization_id = new.organization_id
     and old.member_id = new.member_id
     and old.date = new.date
     and old.id <> new.id
     and old.removed_at = now()
     and old.kind = new.kind
     and old.shift_type_id is not distinct from new.shift_type_id
     and old.team_id is not distinct from new.team_id
     and c.organization_id = new.organization_id
     and c.personal_assignment_id = old.id
     and c.removed_at = now()
     and not exists (
       select 1
         from public.conflict_resolutions live
        where live.organization_id = c.organization_id
          and live.member_id = c.member_id
          and live.date = c.date
          and live.team_id is not distinct from c.team_id
          and live.removed_at is null
     );

  return null;
end;
$$;

revoke execute on function private.relink_resolution_to_assignment() from public, anon, authenticated, service_role;

create trigger personal_assignments_relink_resolution
  after insert on public.personal_assignments
  for each row
  when (new.kind = 'SHIFT' and new.removed_at is null)
  execute function private.relink_resolution_to_assignment();

-- ------------------------------------------------ (vii) the replacement by assignment

-- `p_items` is a JSON array of 1–366 items (a leave record is at most 366
-- days, `MAX_LEAVE_RANGE_DAYS`), each exactly
--
--   { "memberId": uuid, "date": "YYYY-MM-DD", "teamId": uuid | null,
--     "shiftTypeId": uuid, "replacementId": uuid, "note"?: text | null }
--
-- naming one collision (`memberId`, `date`, `teamId`: the absent member, the
-- date and the team the shift counts with, none for null), the shift type it
-- works, and the member who covers it. For each item, in one transaction:
--
--   * the replacement gets a `SHIFT` assignment of that type counted with that
--     team (null: their effective team, so a teamless collision is covered by
--     a member with none that date, which the browser offers; a direct call
--     naming one with a team writes a decision the browser never counts), through 0077's
--     `save_personal_assignments`, so its checks (an organization member, a
--     type and a team not archived) and its notice (ONE `SCHEDULE_ASSIGNED`
--     per replacement per call, E-3) are the save's. A live assignment of the
--     replacement already EQUAL to it (kind, type, team) is reused; a day off
--     (`OFF`) is replaced; any other `SHIFT` that date refuses the call;
--   * a `replace_member` resolution of the collision's key, naming the type
--     and that assignment. 0031's trigger refuses it off leave and supersedes
--     a live decision made on another type (0038).
--
-- The answer is the resolutions' ids, in the items' order.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   * 42501 `CONFLICT_REPLACEMENT_REFUSED` — not an active admin of the
--     claimed organization (after 0023's lock);
--   * 22023 `CONFLICT_REPLACEMENT_INVALID` — not an array of 1–366 items of
--     that shape, or two items of one key, or of one replacement and date;
--   * 23514 `CONFLICT_REPLACEMENT_IS_ABSENT_MEMBER` — an item's replacement is
--     its absent member;
--   * 23505 `CONFLICT_RESOLUTION_EXISTS` — an item's key is already decided
--     (on its type, or with no stored type), checked before anything is
--     written; `CONFLICT_REPLACEMENT_TAKEN` — the replacement already holds
--     another shift that date, or this one already covers another absence;
--   * 22023 `PERSONAL_ASSIGNMENTS_INVALID` — the save's: the replacement is
--     not the organization's, or the type or team is archived or not its;
--   * P0002 `CONFLICT_RESOLUTION_NOT_ON_LEAVE` — 0031's trigger;
--   * 23503 — a composite key: another tenant's absent member, team or type.
--
-- Any refusal aborts the whole call: no assignment without its decision, and
-- no notice for a call that wrote nothing. Whether the collision exists, and
-- whether the replacement is free, are the browser's questions (AD-4).
create function public.resolve_with_personal_assignment(p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  uuid_shape constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  item jsonb;
  good boolean;
  a_member uuid[] := '{}'::uuid[];
  a_date date[] := '{}'::date[];
  a_team uuid[] := '{}'::uuid[];
  a_type uuid[] := '{}'::uuid[];
  a_replacement uuid[] := '{}'::uuid[];
  a_note text[] := '{}'::text[];
  changes jsonb := '[]'::jsonb;
  i integer;
  live_kind text;
  live_type uuid;
  live_team uuid;
  live_note text;
  assignment_id uuid;
  resolution_id uuid;
  resolved jsonb := '[]'::jsonb;
begin
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
      message = 'CONFLICT_REPLACEMENT_REFUSED';
  end if;

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) not between 1 and 366 then
    raise exception using errcode = 'invalid_parameter_value', message = 'CONFLICT_REPLACEMENT_INVALID';
  end if;

  -- ------------------------------------------------ pass 1: the whole batch

  for item in select e.value from pg_catalog.jsonb_array_elements(p_items) as e loop
    good := pg_catalog.jsonb_typeof(item) = 'object';

    if good then
      good := coalesce(
        (
          (select pg_catalog.array_agg(k collate "C" order by k collate "C") from pg_catalog.jsonb_object_keys(item) as k)
            in (
              array['date', 'memberId', 'replacementId', 'shiftTypeId', 'teamId']::text[],
              array['date', 'memberId', 'note', 'replacementId', 'shiftTypeId', 'teamId']::text[]
            )
        )
        and pg_catalog.jsonb_typeof(item -> 'memberId') = 'string'
        and (item ->> 'memberId') ~* uuid_shape
        and pg_catalog.jsonb_typeof(item -> 'replacementId') = 'string'
        and (item ->> 'replacementId') ~* uuid_shape
        and pg_catalog.jsonb_typeof(item -> 'shiftTypeId') = 'string'
        and (item ->> 'shiftTypeId') ~* uuid_shape
        and (
          pg_catalog.jsonb_typeof(item -> 'teamId') = 'null'
          or (pg_catalog.jsonb_typeof(item -> 'teamId') = 'string' and (item ->> 'teamId') ~* uuid_shape)
        )
        and coalesce(pg_catalog.jsonb_typeof(item -> 'note'), 'null') in ('null', 'string')
        and pg_catalog.jsonb_typeof(item -> 'date') = 'string'
        and (item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_catalog.pg_input_is_valid(item ->> 'date', 'date'),
        false
      );
    end if;

    if good then
      good := pg_catalog.to_char((item ->> 'date')::date, 'YYYY-MM-DD') = (item ->> 'date');
    end if;

    if not coalesce(good, false) then
      raise exception using errcode = 'invalid_parameter_value', message = 'CONFLICT_REPLACEMENT_INVALID';
    end if;

    a_member := a_member || (item ->> 'memberId')::uuid;
    a_date := a_date || (item ->> 'date')::date;
    a_team := a_team || (item ->> 'teamId')::uuid;
    a_type := a_type || (item ->> 'shiftTypeId')::uuid;
    a_replacement := a_replacement || (item ->> 'replacementId')::uuid;
    a_note := a_note || (item ->> 'note');
  end loop;

  -- No key twice, and no replacement twice on one date (one live assignment
  -- per member and date, R14.1).
  if exists (
    select 1
      from rows from (pg_catalog.unnest(a_member), pg_catalog.unnest(a_date), pg_catalog.unnest(a_team)) as w(member_id, day, team_id)
     group by w.member_id, w.day, w.team_id
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
      from rows from (pg_catalog.unnest(a_replacement), pg_catalog.unnest(a_date)) as w(member_id, day)
     group by w.member_id, w.day
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'CONFLICT_REPLACEMENT_INVALID';
  end if;

  -- ------------------------------------- pass 2: the refusals, before any write

  for i in 1 .. pg_catalog.array_length(a_member, 1) loop
    if a_replacement[i] = a_member[i] then
      raise exception using
        errcode = 'check_violation',
        message = 'CONFLICT_REPLACEMENT_IS_ABSENT_MEMBER';
    end if;

    -- Already resolved, as 0038's replacement asks it: a live row decided on
    -- another type does not count (the insert below supersedes it).
    if exists (
      select 1
        from public.conflict_resolutions c
       where c.organization_id = claimed
         and c.member_id = a_member[i]
         and c.date = a_date[i]
         and c.team_id is not distinct from a_team[i]
         and c.removed_at is null
         and not (c.shift_type_id is not null and c.shift_type_id <> a_type[i])
    ) then
      raise exception using
        errcode = 'unique_violation',
        message = 'CONFLICT_RESOLUTION_EXISTS';
    end if;

    live_kind := null;
    live_type := null;
    live_team := null;
    live_note := null;
    select p.kind, p.shift_type_id, p.team_id, p.note
      into live_kind, live_type, live_team, live_note
      from public.personal_assignments p
     where p.organization_id = claimed
       and p.member_id = a_replacement[i]
       and p.date = a_date[i]
       and p.removed_at is null;

    -- Another shift that date, or this very shift already covering another
    -- absence: one assignment is never two covers.
    if live_kind = 'SHIFT' and (
      live_type is distinct from a_type[i]
      or live_team is distinct from a_team[i]
      or exists (
        select 1
          from public.conflict_resolutions c
          join public.personal_assignments p
            on p.organization_id = c.organization_id
           and p.id = c.personal_assignment_id
         where c.organization_id = claimed
           and c.removed_at is null
           and p.member_id = a_replacement[i]
           and p.date = a_date[i]
           and p.removed_at is null
      )
    ) then
      raise exception using
        errcode = 'unique_violation',
        message = 'CONFLICT_REPLACEMENT_TAKEN';
    end if;

    -- An equal live shift is reused as it stands (its note kept); anything
    -- else is written by the save.
    if live_kind is distinct from 'SHIFT' then
      changes := changes || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'memberId', a_replacement[i],
          'date', pg_catalog.to_char(a_date[i], 'YYYY-MM-DD'),
          'set', pg_catalog.jsonb_build_object(
            'kind', 'SHIFT',
            'shiftTypeId', a_type[i],
            'teamId', a_team[i],
            'note', a_note[i]
          )
        )
      );
    end if;
  end loop;

  -- --------------------------------------------- pass 3: the assignments

  -- 0077's one save: the same lock (re-entrant), the same re-check, its whole
  -- batch checked before it writes, and one notice per replacement.
  if pg_catalog.jsonb_array_length(changes) > 0 then
    perform public.save_personal_assignments(changes);
  end if;

  -- --------------------------------------------- pass 4: the decisions

  for i in 1 .. pg_catalog.array_length(a_member, 1) loop
    select p.id
      into assignment_id
      from public.personal_assignments p
     where p.organization_id = claimed
       and p.member_id = a_replacement[i]
       and p.date = a_date[i]
       and p.removed_at is null;

    -- The save wrote it, or it was reused; never a decision linked to nothing.
    if assignment_id is null then
      raise exception using errcode = 'invalid_parameter_value', message = 'CONFLICT_REPLACEMENT_INVALID';
    end if;

    insert into public.conflict_resolutions (organization_id, member_id, date, team_id, kind, shift_type_id, personal_assignment_id)
    values (claimed, a_member[i], a_date[i], a_team[i], 'replace_member', a_type[i], assignment_id)
    returning id into resolution_id;

    resolved := resolved || pg_catalog.jsonb_build_array(resolution_id);
  end loop;

  return resolved;
end;
$$;

revoke execute on function public.resolve_with_personal_assignment(jsonb) from public;
revoke execute on function public.resolve_with_personal_assignment(jsonb) from anon;
revoke execute on function public.resolve_with_personal_assignment(jsonb) from service_role;
grant execute on function public.resolve_with_personal_assignment(jsonb) to authenticated;

-- ------------------------------------------------------ (viii) the member's read

drop function public.my_conflict_resolutions();

-- 0038's read, shaped and pinned the same way, plus the second link: the
-- caller's own LIVE resolutions, `member_id, date, team_id, kind,
-- roster_override_id, shift_type_id, personal_assignment_id`. The team may be
-- null (a teamless key, ordered after a team's on its date). The assignment is
-- one of the caller's own organization's, whose live rows every active member
-- already reads through `calendar_personal_assignments()`.
create function public.my_conflict_resolutions()
returns table (
  member_id uuid,
  date date,
  team_id uuid,
  kind text,
  roster_override_id uuid,
  shift_type_id uuid,
  personal_assignment_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.member_id,
         c.date,
         c.team_id,
         c.kind,
         c.roster_override_id,
         c.shift_type_id,
         c.personal_assignment_id
    from public.conflict_resolutions c
    join public.members m
      on m.organization_id = c.organization_id
     and m.id = c.member_id
   where c.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and c.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
     and c.removed_at is null
   order by c.date, c.team_id
$$;

revoke execute on function public.my_conflict_resolutions() from public;
revoke execute on function public.my_conflict_resolutions() from anon;
revoke execute on function public.my_conflict_resolutions() from service_role;
grant execute on function public.my_conflict_resolutions() to authenticated;
