-- 0082_team_minimum_members.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.20: each team has its own minimum (CAP-21 as amended, FR-115, R10.2
-- as amended, AD-27; founder decision E-1, 2026-11-25).
--
-- One column, and nothing else: `teams.minimum_members`, how many people a
-- working shift of THIS team needs. `packages/domain` derives from it, on read,
-- which shifts are short-staffed (`domain/staffing`, `minimumOf`): a team's own
-- minimum when set, else the organization's (`organizations.minimum_members`,
-- 0048). No table holds a count or a state (AD-1).
--
-- NULLABLE, WITH NO DEFAULT. Null is "this team has not set one", and then the
-- organization's applies, so with no team minimum set every derivation is what
-- it was before. There is no "no minimum on this team" state: a team that
-- should never be flagged sets 1. Nothing is seeded (DI-8).
--
-- CURRENT-STATE (AD-2, AD-27): no history and no versions, so a change re-reports
-- past dates too, as 0048's does. The team's change history records it through
-- its existing audit triggers (0061).
--
-- A POSITIVE WHOLE NUMBER, by shape. `smallint` holds every number the client
-- offers (1–32767); zero or a negative is refused by the named check, which the
-- team dialog maps to its field (`teams_minimum_members_check`, 23514).
--
-- WRITTEN through `teams`' own update policy (0009: an active admin of the
-- organization, an archived team frozen by the SPA's `archived = false` filter),
-- by the column grant below, as 0056 grants each writable column. A change
-- changes which of the team's shifts are short-staffed, so it is SERIALIZED and
-- RE-CHECKED as an archive and 0080's holiday flag are: 0035's two `teams`
-- triggers are re-created `before update of archived, off_on_holidays,
-- minimum_members`, same functions and levels.
--
-- NOT CARRIED by `private.member_schedule_inputs` (AD-19 as amended): R12, the
-- feed and the reminders read no minimum. Nothing notifies (E-3).
--
-- DEPLOY ORDER: `db push`, then the SPA. The SPA selects the new column on every
-- teams read: deployed first, those reads are unavailable until the push lands.
--
-- A refused write arrives as one of:
--
--   * 23514 — `teams_minimum_members_check`: zero or a negative;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, or a stale admin (0035's re-check).

alter table public.teams
  add column minimum_members smallint
    constraint teams_minimum_members_check check (minimum_members >= 1);

-- 0056's rule: each writable column is granted by name; `teams`' own update
-- policy (0009) decides who.
grant update (minimum_members) on table public.teams to authenticated;

-- 0035's lock and re-check, widened from 0080's `archived, off_on_holidays` to
-- the minimum too: the same functions, the same levels (the lock per statement,
-- the re-check per row).
drop trigger if exists teams_serialize_organization_writes on public.teams;
create trigger teams_serialize_organization_writes
  before update of archived, off_on_holidays, minimum_members on public.teams
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists teams_refuse_write_by_stale_admin on public.teams;
create trigger teams_refuse_write_by_stale_admin
  before update of archived, off_on_holidays, minimum_members on public.teams
  for each row
  execute function public.refuse_write_by_stale_admin();
