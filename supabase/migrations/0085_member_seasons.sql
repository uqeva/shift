-- 0085_member_seasons.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.11 (AD-26, *Seasons*; R16.5): a seasonal member's season is set in
-- one step.
--
-- 0008 admits a status version only while the member's latest one is already
-- in effect, so at most one change is ever scheduled. A season needs two (or
-- three) ahead at once — active from its start, inactive from the day after
-- its end, and inactive until the start when the member is active before it —
-- so an admin had to come back on the season's first day to set its end.
--
-- WHAT CHANGES: one conjunct of one policy. The insert policy
-- `member_status_versions_insert_by_own_active_admin` is ALTERED (its name,
-- roles and command stay; only WITH CHECK is restated) without the
-- one-scheduled-change conjunct. Every other rule of 0008 holds:
--
--   * the tenant, from the signed claim and from the fresh helper, as an
--     active admin; the attribution pinned to the caller; today or later in
--     the organization's zone; never the caller's own row; and the last-admin
--     rule, read exactly as 0008 reads it (`members` inline, on the
--     statement's snapshot, and `public.member_active_from`), so 0023's
--     re-check still raises its own 23514 for an admin demoted while the
--     write waited;
--   * VERSIONS STILL APPEND IN DATE ORDER AND EACH ONE CHANGES SOMETHING:
--     dated after the member's latest version, and `active` differing from
--     the latest state. So the history still alternates, and a season's rows
--     are admitted one after another, in one multi-row insert or in several;
--   * ONLY THE LATEST VERSION IS CANCELLABLE: the delete policy is untouched.
--     Cancelling a season is withdrawing its rows latest first.
--
-- THE TWO READS OF THE MEMBER'S OWN HISTORY are one `private` definer,
-- `member_status_version_appendable`, rather than 0008's public readers in
-- the policy. A definer reads the table past RLS, so it answers only for an
-- active admin of the tenant it is given (false for anybody else) and tells
-- no other caller anything. VOLATILE PL/pgSQL, as 0008's readers: each of its
-- queries takes a fresh snapshot, so a row of a multi-row insert is judged
-- against the rows the same statement wrote before it, and a write behind
-- 0023's lock reads what was committed while it waited.
--
-- WHAT NEEDS NO CHANGE, and why:
--
--   * 0002/0008's zero-admins constraint trigger and 0023's AFTER ROW re-check
--     read every admin's versions on every date from the change on, so any
--     number of scheduled versions is judged as one;
--   * 0041's and 0049's closes on deactivation already leave a request or a
--     swap that a LATER version governs alone (an owner write could always
--     produce one); a season's end closes what reaches past it, and its
--     "inactive until the start" closes only what starts before the start;
--   * 0067's feed revocation fires on an inactive version in effect and on
--     any reactivation, which is what a season's rows are;
--   * the calendar, the assembly and the domain read every version.
--
-- No new trigger, no notification, no grant on the table changes.

-- ------------------------------------------------------------------- the helper

-- Whether a version dated `p_effective_from` with `p_active` may follow the
-- member's history: after their latest version, and changing their latest
-- state (a member with no version is active). False for a caller who is not an
-- active admin of `p_organization`.
create function private.member_status_version_appendable(
  p_organization uuid,
  p_member uuid,
  p_effective_from date,
  p_active boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  admin_organization uuid;
  latest_from date;
  latest_state boolean;
begin
  select access.organization_id
    into admin_organization
    from public.current_member_access() as access
   where access.is_active
     and access.member_role = 'admin';

  if admin_organization is null or admin_organization <> p_organization then
    return false;
  end if;

  select v.effective_from, v.active
    into latest_from, latest_state
    from public.member_status_versions v
   where v.organization_id = p_organization
     and v.member_id = p_member
   order by v.effective_from desc
   limit 1;

  if latest_from is null then
    return p_active is not true;
  end if;

  return p_effective_from > latest_from
     and p_active is distinct from latest_state;
end;
$$;

-- A policy runs as its caller, so `authenticated` executes it; nobody else.
revoke execute on function private.member_status_version_appendable(uuid, uuid, date, boolean) from public, anon, service_role;
grant execute on function private.member_status_version_appendable(uuid, uuid, date, boolean) to authenticated;

-- ------------------------------------------------------------------- the policy

-- 0008's insert, every conjunct kept but the one-scheduled-change rule, and the
-- date-order and changes-something reads through the helper above.
alter policy member_status_versions_insert_by_own_active_admin on public.member_status_versions
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
    and private.member_status_version_appendable(organization_id, member_id, effective_from, active)
    and not exists (
      select 1
        from public.members self
       where self.id = member_status_versions.member_id
         and self.auth_user_id = (select auth.uid())
    )
    and (
      active
      or not exists (
        select 1
          from public.members target
         where target.id = member_status_versions.member_id
           and target.role = 'admin'
      )
      or exists (
        select 1
          from public.members admin
         where admin.organization_id = member_status_versions.organization_id
           and admin.role = 'admin'
           and admin.id <> member_status_versions.member_id
           and public.member_active_from(admin.id, member_status_versions.effective_from)
      )
    )
  );
