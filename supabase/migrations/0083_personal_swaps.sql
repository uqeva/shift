-- 0083_personal_swaps.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.8: swaps give and take personal shifts (AD-26 as amended
-- 2026-11-26; R14.3, R15.3; 12.1's record, 0049).
--
-- A PERSONAL SHIFT (a member's live Personal Assignment, or their personal
-- rotation's shift) is named by its MEMBER AND DATE: a member has at most one
-- that date (R14.1). A swap may give one, take one in return, or both. Its
-- side then stores the team the shift COUNTS with (null for none) and the
-- shift TYPE, since the database never projects a roster (AD-1, AD-3) and a
-- personal rotation's type is the browser's to derive. An approval writes
-- Personal Assignments where it writes Roster Overrides for a team shift: the
-- taker gets a `SHIFT` of the stored type and counted team, the giver an
-- `OFF`, all through ONE call of 0077's `save_personal_assignments`, so its
-- checks, its lock and its one `SCHEDULE_ASSIGNED` per member apply, and
-- 0081's lifetime triggers end (or relink) any conflict resolution that
-- named an assignment the save replaces. (Nothing ends an approved swap's own
-- decision when its assignment is later replaced: the browser reads it as
-- changed later, as 0049's overrides are.)
--
-- As 0049's, WHETHER THE GIVER STILL HOLDS the shift is the browser's
-- question (the stale check and the erasure diff before an approval): a
-- direct insert may store a personal side the proposer does not work, and a
-- direct approval writes it. A personal side's archived type or team is
-- 0077's 22023 `PERSONAL_ASSIGNMENTS_INVALID`, never 0036's 23514. The admin's
-- reason is stored on a team side's override alone; an assignment's note is
-- the admin's own (0077), so a personal side carries none.
--
--   (i)   `swap_requests` gains `given_personal` and `return_personal`
--         (boolean, not null, false) and `shift_type_id` and
--         `return_shift_type_id` (composite keys to `shift_types`, NO
--         cascade). `team_id` becomes NULLABLE (a personal shift counted with
--         no team). The checks are re-stated: a side's type is named exactly
--         when the side is personal; only a personal side may have no team;
--         the return shift is named whole or not at all; "never the given
--         shift" binds two team shifts; and a swap with a personal side never
--         names one date twice (the approval would give one member two
--         assignments that date).
--   (ii)  The two partial unique keys are re-created NULLS NOT DISTINCT
--         (PostgreSQL 15+), so a teamless personal shift is still held by
--         ONE open swap per side.
--   (iii) The column grant admits the four new proposal facts.
--   (iv)  `swap_request_decisions` gains `personal_assignment_id` and
--         `return_personal_assignment_id` (composite keys to 0081's
--         `personal_assignments_organization_id_id_key`, NO cascade): the
--         TAKER's assignment an approval wrote on each personal side. An
--         approval names an override OR an assignment on the given side, and
--         at most one on the return side; nothing else names either.
--   (v)   `decide_swap_request(uuid, text, text)` re-created, its signature,
--         grants and every 0049 refusal unchanged. A personal side whose
--         TAKER already holds a live `SHIFT` assignment that date is refused
--         23505 `SWAP_REQUEST_TAKER_ASSIGNED` before anything is written (one
--         personal shift per member and date; the swap stays accepted, to be
--         rejected). 0077's own refusals (22023 `PERSONAL_ASSIGNMENTS_INVALID`
--         for an archived type or team) abort the call the same way.
--
-- 0049's insert policy, `swap_parties_active`, the answer, the withdrawal, the
-- deactivation close and 0050/0051's notices are unchanged: none reads a team
-- or a type. No new table, policy or function.

-- ------------------------------------------------------ (i) the request

alter table public.swap_requests
  alter column team_id drop not null;

alter table public.swap_requests
  add column given_personal boolean not null default false,
  add column shift_type_id uuid,
  add column return_personal boolean not null default false,
  add column return_shift_type_id uuid;

-- To 0013's unique (organization_id, id), so a swap naming another tenant's
-- type is unrepresentable. NO cascade, as 0049's keys.
alter table public.swap_requests
  add constraint swap_requests_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references public.shift_types (organization_id, id),
  add constraint swap_requests_return_shift_type_fkey
    foreign key (organization_id, return_shift_type_id)
    references public.shift_types (organization_id, id);

-- The keys a shift type is cleaned up through.
create index swap_requests_shift_type_idx on public.swap_requests (organization_id, shift_type_id)
  where shift_type_id is not null;
create index swap_requests_return_shift_type_idx on public.swap_requests (organization_id, return_shift_type_id)
  where return_shift_type_id is not null;

alter table public.swap_requests
  drop constraint swap_requests_return_complete,
  drop constraint swap_requests_return_not_given;

alter table public.swap_requests
  -- The given side: a personal shift names its type, a team shift none; only
  -- a personal shift may count with no team.
  add constraint swap_requests_given_type
    check (given_personal = (shift_type_id is not null)),
  add constraint swap_requests_given_team
    check (given_personal or team_id is not null),

  -- The return side, the same way, and named whole or not at all: no date
  -- names no team and no personal shift (so no type either), and a date names
  -- a team shift's team or a personal shift.
  add constraint swap_requests_return_type
    check (return_personal = (return_shift_type_id is not null)),
  add constraint swap_requests_return_complete
    check ((return_date is null) = (return_team_id is null and not return_personal)),

  -- A return team shift is never the given team shift.
  add constraint swap_requests_return_not_given
    check (
      return_date is null
      or given_personal
      or return_personal
      or return_team_id is distinct from team_id
      or return_date is distinct from date
    ),

  -- A swap with a personal side never names one date twice: the approval
  -- would give one member two assignments that date.
  add constraint swap_requests_personal_dates_distinct
    check (return_date is null or return_date <> date or (not given_personal and not return_personal));

-- ---------------------------------------------------- (ii) the open keys

drop index public.swap_requests_open_given_key;
drop index public.swap_requests_open_return_key;

create unique index swap_requests_open_given_key
  on public.swap_requests (organization_id, proposer_id, team_id, date) nulls not distinct
  where closed_at is null;

create unique index swap_requests_open_return_key
  on public.swap_requests (organization_id, addressee_id, return_team_id, return_date) nulls not distinct
  where closed_at is null and return_date is not null;

-- --------------------------------------------------- (iii) the column grant

grant insert (given_personal, shift_type_id, return_personal, return_shift_type_id) on table public.swap_requests
  to authenticated;

-- ---------------------------------------------------- (iv) the decision

alter table public.swap_request_decisions
  add column personal_assignment_id uuid,
  add column return_personal_assignment_id uuid;

alter table public.swap_request_decisions
  add constraint swap_request_decisions_personal_assignment_fkey
    foreign key (organization_id, personal_assignment_id)
    references public.personal_assignments (organization_id, id),
  add constraint swap_request_decisions_return_personal_assignment_fkey
    foreign key (organization_id, return_personal_assignment_id)
    references public.personal_assignments (organization_id, id),
  -- One assignment backs at most one decision. These also index the keys.
  add constraint swap_request_decisions_personal_assignment_key
    unique (organization_id, personal_assignment_id),
  add constraint swap_request_decisions_return_personal_assignment_key
    unique (organization_id, return_personal_assignment_id);

alter table public.swap_request_decisions
  drop constraint swap_request_decisions_roster_override_when_approved;

-- 0049's return rule (`swap_request_decisions_return_roster_override_when_approved`)
-- stands; each side names an override OR an assignment, never both.
alter table public.swap_request_decisions
  add constraint swap_request_decisions_given_written_when_approved
    check ((outcome = 'approved') = (roster_override_id is not null or personal_assignment_id is not null)),
  add constraint swap_request_decisions_given_written_once
    check (roster_override_id is null or personal_assignment_id is null),
  add constraint swap_request_decisions_return_assignment_when_approved
    check (return_personal_assignment_id is null or outcome = 'approved'),
  add constraint swap_request_decisions_return_written_once
    check (return_roster_override_id is null or return_personal_assignment_id is null);

-- ---------------------------------------------------------- (v) the decision

-- 0049's body, with each side written by its form. Unchanged: the claim, the
-- lock, the admin re-check, the outcome check, the close, F1's inactive check
-- and every refusal it names. A team side inserts 0049's roster override; a
-- personal side is ONE item set for each of the two members of the side, and
-- every personal item goes to ONE `save_personal_assignments` call, after the
-- overrides, so a refusal of either aborts the whole call and the swap stays
-- accepted. The answer is the given side's override, or its assignment.
create or replace function public.decide_swap_request(p_request_id uuid, p_outcome text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  swap public.swap_requests;
  given_override uuid;
  return_override uuid;
  given_assignment uuid;
  return_assignment uuid;
  changes jsonb := '[]'::jsonb;
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
      message = 'SWAP_REQUEST_DECISION_REFUSED';
  end if;

  if p_outcome is null or p_outcome not in ('approved', 'rejected') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'SWAP_REQUEST_OUTCOME_UNKNOWN';
  end if;

  -- An open, accepted swap alone. An admin who is a party may decide it.
  update public.swap_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
     and r.answer = 'accepted'
  returning r.* into swap;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SWAP_REQUEST_NOT_OPEN';
  end if;

  if p_outcome = 'approved' then
    -- F1: never put an inactive member on a shift, a scheduled deactivation
    -- included. The raise aborts the call, and the close above with it: the
    -- swap stays accepted, to be rejected.
    if public.member_inactive_within(swap.addressee_id, pg_catalog.daterange(swap.date, swap.date, '[]'))
       or (
         swap.return_date is not null
         and public.member_inactive_within(swap.proposer_id, pg_catalog.daterange(swap.return_date, swap.return_date, '[]'))
       ) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'SWAP_REQUEST_MEMBER_INACTIVE';
    end if;

    -- ONE PERSONAL SHIFT PER MEMBER AND DATE (R14.1): a personal side's taker
    -- (the addressee on the given date, the proposer on the return date) who
    -- already holds a live `SHIFT` assignment that date would lose it to the
    -- save, so the approval is refused before anything is written.
    if (
         swap.given_personal
         and exists (
           select 1
             from public.personal_assignments p
            where p.organization_id = claimed
              and p.member_id = swap.addressee_id
              and p.date = swap.date
              and p.kind = 'SHIFT'
              and p.removed_at is null
         )
       )
       or (
         swap.return_personal
         and exists (
           select 1
             from public.personal_assignments p
            where p.organization_id = claimed
              and p.member_id = swap.proposer_id
              and p.date = swap.return_date
              and p.kind = 'SHIFT'
              and p.removed_at is null
         )
       ) then
      raise exception using
        errcode = 'unique_violation',
        message = 'SWAP_REQUEST_TAKER_ASSIGNED';
    end if;

    -- `created_by` and `created_at` come from 0026's defaults: the approving
    -- admin, now. Any refusal (0026's live keys 23505, its reason check or
    -- 0036's archived team 23514) aborts the call, and the close above with
    -- it: the swap stays accepted.
    if swap.given_personal then
      changes := changes || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'memberId', swap.addressee_id,
          'date', swap.date,
          'set', pg_catalog.jsonb_build_object('kind', 'SHIFT', 'shiftTypeId', swap.shift_type_id, 'teamId', swap.team_id)
        ),
        pg_catalog.jsonb_build_object(
          'memberId', swap.proposer_id,
          'date', swap.date,
          'set', pg_catalog.jsonb_build_object('kind', 'OFF')
        )
      );
    else
      insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
      values (claimed, swap.team_id, swap.date, swap.proposer_id, swap.addressee_id, p_reason)
      returning id into given_override;
    end if;

    if swap.return_personal then
      changes := changes || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'memberId', swap.proposer_id,
          'date', swap.return_date,
          'set', pg_catalog.jsonb_build_object('kind', 'SHIFT', 'shiftTypeId', swap.return_shift_type_id, 'teamId', swap.return_team_id)
        ),
        pg_catalog.jsonb_build_object(
          'memberId', swap.addressee_id,
          'date', swap.return_date,
          'set', pg_catalog.jsonb_build_object('kind', 'OFF')
        )
      );
    elsif swap.return_team_id is not null then
      insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
      values (claimed, swap.return_team_id, swap.return_date, swap.addressee_id, swap.proposer_id, p_reason)
      returning id into return_override;
    end if;

    -- 0077's one save: the same lock (re-entrant), the same admin re-check,
    -- the whole batch checked before it writes (an archived type or team is
    -- 22023 `PERSONAL_ASSIGNMENTS_INVALID`), and one notice per member.
    if pg_catalog.jsonb_array_length(changes) > 0 then
      perform public.save_personal_assignments(changes);
    end if;

    if swap.given_personal then
      select p.id
        into given_assignment
        from public.personal_assignments p
       where p.organization_id = claimed
         and p.member_id = swap.addressee_id
         and p.date = swap.date
         and p.removed_at is null;
    end if;

    if swap.return_personal then
      select p.id
        into return_assignment
        from public.personal_assignments p
       where p.organization_id = claimed
         and p.member_id = swap.proposer_id
         and p.date = swap.return_date
         and p.removed_at is null;
    end if;
  end if;

  -- `decided_by` and `decided_at` from their defaults: the caller, now.
  insert into public.swap_request_decisions (
    organization_id, request_id, outcome,
    roster_override_id, return_roster_override_id,
    personal_assignment_id, return_personal_assignment_id
  )
  values (
    claimed, p_request_id, p_outcome,
    given_override, return_override,
    given_assignment, return_assignment
  );

  return coalesce(given_override, given_assignment);
end;
$$;

-- 0049's grants, written again: `create or replace` keeps them, and this file
-- states them so the provisioning sweep reads one source.
revoke execute on function public.decide_swap_request(uuid, text, text) from public;
revoke execute on function public.decide_swap_request(uuid, text, text) from anon;
revoke execute on function public.decide_swap_request(uuid, text, text) from service_role;
grant execute on function public.decide_swap_request(uuid, text, text) to authenticated;
