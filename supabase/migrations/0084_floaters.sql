-- 0084_floaters.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.13: floaters are suggested for an uncovered shift, by role (R16.1–
-- R16.3, AD-26 as amended, UX-DR77; founder decision E-8, 2026-11-25).
--
-- One column, one table, and one function re-created.
--
--   (i)   `members.is_floater`: whether the member covers gaps (a student who
--         fills in for absent colleagues). Off by default, NOT NULL, so every
--         existing member is no floater and every screen is what it was.
--   (ii)  `floater_roles`: the job roles (0078) a floater may cover, one row
--         per member and role. An admin's working data: ADMIN-ONLY, read and
--         written by an active admin alone. A floater listing no role covers
--         only an absent member with no role (R16.1).
--   (iii) `resolve_with_personal_assignment(p_items)` (0081) re-created with
--         two refusals the browser never meets (the 21.7 deferral): a cover
--         inactive that date, and a teamless item's cover with a team or a
--         live loan that date.
--
-- NOTHING DERIVES FROM EITHER (R16.1): no rule in `packages/domain` but the
-- suggestion's eligibility (`domain/floaters`), no `member_schedule_inputs`
-- field, no snapshot, feed or reminder. Nothing notifies (E-3) and no AD-5
-- guard reads them. Nothing is seeded (DI-8).
--
--   * CURRENT-STATE (AD-2). The flag changes in place; a role is listed by an
--     insert and dropped by a delete, with no version and no validity range.
--   * ATTRIBUTED (AD-11): `created_by`/`created_at` from defaults, the insert
--     policy pinning `created_by` to the caller.
--   * AUDITED: AD-3's two change-history triggers, 0061's shape. The flag is
--     recorded through `members`' own audit triggers.
--   * SERIALIZED: 0023's organization lock and 0035's (0071's) stale-admin
--     re-check on every write of a floater role, and on an update of the flag:
--     0023's and 0035's two `members` triggers are re-created `before insert
--     or update of is_floater, role or delete`, the same functions and levels.
--
-- WHO READS WHAT. `floater_roles`: an active admin of the token's organization
-- reads, inserts and deletes; nobody updates; `anon` holds nothing; no role
-- holds TRUNCATE. No policy reads its own table (42P17). `members.is_floater`
-- is a column of `members`, whose select policy (0003, 0011) lets every
-- member read their own row too: a member reads their own flag, never anyone
-- else's. It is written through `members`' own update policy (0003: an active
-- admin), by the column grant below, as 0056 grants each writable column.
--
-- DEPLOY ORDER: `db push`, then the SPA. The SPA's member list selects the new
-- column and embeds the new table: deployed first, that read is unavailable
-- until the push lands.
--
-- A refused write arrives as one of:
--
--   * 23505 — `floater_roles_organization_member_role_key`: the role is
--     already listed for that member;
--   * 23503 — `floater_roles_member_fkey` or `floater_roles_job_role_fkey`:
--     another tenant's member or role, or one that does not exist;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a column the grant does not admit, an update, a TRUNCATE,
--     or a stale admin (0035's re-check).

-- --------------------------------------------------------- (i) the flag

alter table public.members
  add column is_floater boolean not null default false;

-- 0056's rule: each writable column is granted by name; `members`' own update
-- policy (0003: an active admin of the organization) decides who.
grant update (is_floater) on table public.members to authenticated;

-- 0023's lock and 0035's re-check, widened from `role` to the flag too: the
-- same functions, the same levels (the lock per statement, the re-check per
-- row). A flag change changes who is suggested, so it serializes with every
-- other admin write of the organization.
drop trigger if exists members_serialize_organization_writes on public.members;
create trigger members_serialize_organization_writes
  before insert or update of is_floater, role or delete on public.members
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists members_refuse_write_by_stale_admin on public.members;
create trigger members_refuse_write_by_stale_admin
  before insert or update of is_floater, role or delete on public.members
  for each row
  execute function public.refuse_write_by_stale_admin();

-- ---------------------------------------------------- (ii) the roles covered

create table floater_roles (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- The floater.
  member_id uuid not null,

  -- A role they may cover (0078).
  job_role_id uuid not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither, and the insert policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- To 0002's unique (organization_id, id), so a row naming another tenant's
  -- member is unrepresentable. NO cascade: a member is not deleted from under
  -- the roles they cover.
  constraint floater_roles_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  -- To 0078's unique (organization_id, id). NO cascade: a role is never
  -- deleted, and an archived one stays listed.
  constraint floater_roles_job_role_fkey
    foreign key (organization_id, job_role_id)
    references job_roles (organization_id, id),

  -- One row per member and role. Also the index the member list's embed and
  -- the member foreign key's check are served by.
  constraint floater_roles_organization_member_role_key unique (organization_id, member_id, job_role_id)
);

alter table floater_roles enable row level security;

-- Serves the role foreign key's check.
create index floater_roles_organization_job_role_idx on public.floater_roles (organization_id, job_role_id);

-- ------------------------------------------------------------------ the policies

-- ADMIN-ONLY: an active admin of the token's organization reads its rows.
create policy floater_roles_select_by_own_active_admin on public.floater_roles
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

-- Insert has no USING clause to fail, so a member-role account or an admin
-- naming another tenant gets 42501. The attribution is pinned to the caller.
create policy floater_roles_insert_by_own_active_admin on public.floater_roles
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

-- A role is dropped outright: the row carries no history a delete could
-- falsify (the change history keeps it, AD-3).
create policy floater_roles_delete_by_own_active_admin on public.floater_roles
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

-- No update policy: a row is never changed, only inserted or deleted.

-- ------------------------------------------------------- the writable columns

-- As 0078 and 0080: Supabase's default privileges grant every table privilege
-- to `anon` and `authenticated`. A session reads, names a row's tenant, member
-- and role on insert, and deletes it; nothing else. No update, no truncate for
-- anyone, and `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.floater_roles
  from anon, authenticated;
revoke select on table public.floater_roles from anon;
revoke truncate on table public.floater_roles from anon, authenticated, service_role;

grant select on table public.floater_roles to authenticated;
grant insert (organization_id, member_id, job_role_id) on table public.floater_roles to authenticated;
grant delete on table public.floater_roles to authenticated;

-- --------------------------------------------------------------- the triggers

-- 0023's organization lock, as 0080 attaches it.
create trigger floater_roles_serialize_organization_writes
  before insert or delete on public.floater_roles
  for each statement
  execute function public.serialize_organization_writes();

-- 0035's re-check of the caller after the lock (0071's definition, unchanged:
-- the table has no team column for its team branch to read).
create trigger floater_roles_refuse_write_by_stale_admin
  before insert or delete on public.floater_roles
  for each row
  execute function public.refuse_write_by_stale_admin();

-- AD-3's two change-history triggers, in 0061's exact shape.
create trigger floater_roles_audit after insert or delete on public.floater_roles
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger floater_roles_audit_update after update on public.floater_roles
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- ------------------------------------- (iii) the replacement by assignment, tightened

-- 0081's function, with the same signature, grants, item shape, answer and
-- refusals, and TWO MORE, checked with the others before anything is written
-- (the 21.7 deferral; the browser offers neither case). They come AFTER 0081's
-- `CONFLICT_RESOLUTION_EXISTS` and `CONFLICT_REPLACEMENT_TAKEN`, so a decided
-- key still reads as decided, and after a check that the cover is a member of
-- the claimed organization (22023 `CONFLICT_REPLACEMENT_INVALID`), so another
-- tenant's member status never leaks through which refusal fires:
--
--   * 23514 `CONFLICT_REPLACEMENT_INACTIVE` — an item's replacement is not
--     active on its date (`member_active_on`, 0008): an inactive member has no
--     Personal Shift (R14.3), so the decision would match nothing;
--   * 23514 `CONFLICT_REPLACEMENT_ON_TEAM` — a TEAMLESS item's replacement has
--     a team that date (`member_team_on`, 0010) or a live loan covering it
--     (0062): their assignment would count with that team (R14.3, R11.1),
--     never with none, so the decision would never match its collision.
--
-- 21.13's floater suggestion writes one item counted with the collision's
-- team (R16.3), a team rotation shift's included; 21.14 passes one per date.
create or replace function public.resolve_with_personal_assignment(p_items jsonb)
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

    -- 0084: the cover is a member of the claimed organization, before any
    -- refusal reads their status, team or loans: another tenant's member is
    -- malformed input, and which refusal fires never says more.
    if not exists (
      select 1
        from public.members m
       where m.organization_id = claimed
         and m.id = a_replacement[i]
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'CONFLICT_REPLACEMENT_INVALID';
    end if;

    -- 0084: an inactive cover has no Personal Shift that date (R14.3).
    if not public.member_active_on(a_replacement[i], a_date[i]) then
      raise exception using
        errcode = 'check_violation',
        message = 'CONFLICT_REPLACEMENT_INACTIVE';
    end if;

    -- 0084: a teamless collision is covered only by a member with no team
    -- that date, their own (0010) or a live loan's (0062, R11.1).
    if a_team[i] is null and (
      public.member_team_on(a_replacement[i], a_date[i]) is not null
      or exists (
        select 1
          from public.team_loans l
         where l.organization_id = claimed
           and l.member_id = a_replacement[i]
           and l.removed_at is null
           and l.during @> a_date[i]
      )
    ) then
      raise exception using
        errcode = 'check_violation',
        message = 'CONFLICT_REPLACEMENT_ON_TEAM';
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
