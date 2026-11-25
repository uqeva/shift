-- 0078_job_roles.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 21.12: job roles are organization data (AD-26 as amended, UX-DR76).
--
-- One table and one column. `job_roles` holds the jobs an organization names
-- for its people (a cleaner, a dispatcher, a seasonal worker, a crew's own
-- title): a NAME and whether it is ARCHIVED, and nothing else.
-- `members.job_role_id` names the one role a member holds, or none. Nothing
-- derives anything from a role: no rule in `packages/domain`, no
-- `member_schedule_inputs` field, no notification (E-3) and no AD-5 guard
-- reads it. A fire rank (0014) and a team position (0015) are untouched and
-- orthogonal: a role is a third, organization-defined fact, never required.
--
--   * CURRENT-STATE (AD-2). A role is renamed, archived and restored in place,
--     with no version and no validity range.
--   * ARCHIVE IS REVERSIBLE, unlike a team's (0009): a role carries no history
--     a restore could falsify. An archived role is hidden from the member
--     page's picker and still shown on every member holding it.
--   * NO DELETE: no session holds the privilege or a policy. NOTHING SEEDED
--     (DI-8): an organization names its own roles.
--   * THE NAME follows 0024, 0036 and 0076: non-blank by `private.name_key`,
--     at most 100 characters, no control character inside it, and unique per
--     organization by `private.name_key` AMONG ROLES NOT ARCHIVED, so an
--     archived role never blocks its name.
--   * ATTRIBUTED (AD-11): `created_by`/`created_at` from defaults.
--   * AUDITED: AD-3's two change-history triggers, 0061's shape.
--
-- WHO READS WHAT: every active member of the token's organization reads its
-- roles, archived ones included (the calendar's day detail names a member's
-- role). An active admin inserts, renames, archives and restores. Nobody
-- deletes. `anon` holds nothing. A member's role is written through
-- `members`' own update policy (0003: an active admin), by the column grant
-- below, as 0056 grants each writable column.
--
-- ALSO RE-CREATED: `public.calendar_members()` (0018), with the same scope,
-- pins and grants, returning the member's role id and name beside the rank.
-- It is DROPPED and created, because its returned row type changes.
--
-- DEPLOY ORDER: `db push`, then the SPA. An SPA deployed first reads a
-- `calendar_members()` row without the role keys as no role, and its members
-- read (which embeds `job_roles`) is unavailable until the push lands.
--
-- A refused write arrives as one of:
--
--   * 23505 — `job_roles_organization_name_key`: the name is taken (an insert,
--     a rename, or a restore over a live role of the same name);
--   * 23514 — `job_roles_name_not_blank`, `job_roles_name_length` or
--     `job_roles_name_characters`;
--   * 23503 — `members_job_role_fkey`: a member given another tenant's role,
--     or one that does not exist;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a column the grant does not admit, or a delete.

create table job_roles (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  name text not null,

  -- A flag, as 0009's: nothing reads when a role was archived, only whether.
  archived boolean not null default false,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither, and the insert policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint job_roles_name_not_blank check (private.name_key(name) <> ''),

  constraint job_roles_name_length check (char_length(name) <= 100),

  -- 0076's class: Unicode's control characters and the two separators.
  constraint job_roles_name_characters check (name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]'),

  -- The target of `members_job_role_fkey` (and of 21.13's floater roles), so
  -- a member naming another tenant's role is unrepresentable.
  constraint job_roles_organization_id_id_key unique (organization_id, id)
);

alter table job_roles enable row level security;

-- Q3: every policy below filters by the tenant first.
create index job_roles_organization_id_idx on job_roles (organization_id);

-- Unique per organization by `private.name_key` (0024), and PARTIAL: only
-- roles not archived compete for a name.
create unique index job_roles_organization_name_key
  on public.job_roles (organization_id, private.name_key(name))
  where not archived;

-- ------------------------------------------------------------------ the policies

-- Every active member reads their own organization's roles, archived ones
-- included: a member may still hold an archived role.
create policy job_roles_select_own_organization on public.job_roles
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
create policy job_roles_insert_by_own_active_admin on public.job_roles
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

-- Rename, archive and restore. Archived rows are reachable too: a restore is
-- `archived = false` written back. WITH CHECK pins the tenant.
create policy job_roles_update_by_own_active_admin on public.job_roles
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

-- No delete policy: a role is never deleted.

-- ------------------------------------------------------- the writable columns

-- As 0009: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names a role's tenant and name on insert, and
-- changes its name or archived flag on update; nothing else. No delete, no
-- truncate, and `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.job_roles
  from anon, authenticated;
revoke select on table public.job_roles from anon;
revoke truncate on table public.job_roles from anon, authenticated, service_role;

grant insert (organization_id, name) on table public.job_roles to authenticated;
grant update (name, archived) on table public.job_roles to authenticated;

-- --------------------------------------------------------------- the triggers

-- AD-3's two change-history triggers, in 0061's exact shape.
create trigger job_roles_audit after insert or delete on public.job_roles
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger job_roles_audit_update after update on public.job_roles
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- -------------------------------------------------------- a member's role

-- None until an admin names one. Nullable, with no default: every existing
-- member keeps no role, and every insert path that names none writes none.
alter table public.members
  add column job_role_id uuid;

-- To a role of the member's own organization. NO cascade: a role is never
-- deleted, and an archived one stays held.
alter table public.members
  add constraint members_job_role_fkey
    foreign key (organization_id, job_role_id)
    references public.job_roles (organization_id, id);

-- Serves the foreign key's check and the reads by role.
create index members_organization_job_role_idx
  on public.members (organization_id, job_role_id);

-- 0056's rule: each writable column is granted by name; `members`' own update
-- policy (0003: an active admin of the organization) decides who.
grant update (job_role_id) on table public.members to authenticated;

-- ------------------------------------------------------ the calendar's names

-- 0018's read, with the member's role beside the rank: its id, and its name
-- (an archived role's too), by a left join on the same tenant. Same scope:
-- every member of the caller's own organization, active or not; zero rows
-- unless the caller is active today and the token's organization is their
-- own. SECURITY DEFINER and STABLE for 0018's reasons.
drop function public.calendar_members();

create function public.calendar_members()
returns table (id uuid, name text, fire_rank text, job_role_id uuid, job_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         m.name,
         m.fire_rank,
         m.job_role_id,
         r.name as job_role
    from public.members m
    left join public.job_roles r
      on r.organization_id = m.organization_id
     and r.id = m.job_role_id
   where m.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and m.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
   order by m.id
$$;

-- 0018's explicit grants, for 0018's reason.
revoke execute on function public.calendar_members() from public;
revoke execute on function public.calendar_members() from anon;
revoke execute on function public.calendar_members() from service_role;
grant execute on function public.calendar_members() to authenticated;
