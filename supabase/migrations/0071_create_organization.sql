-- 0071_create_organization.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- NUMBERING. 0070 is story 17.2's (the reminder job); this story takes 0071.
--
-- Story 19.3: a verified account creates its organization (AD-23, AD-12,
-- AD-10, AD-11; checklist C8, B6, B7, D1–D7, E4). In order:
--
--   (i)    `private.is_known_timezone(text)`: the operator script's timezone
--          rule moved into one function (AD-23 step 3). The script and
--          `create_organization` both call it.
--   (ii)   `organizations.founded_by`: the founding account, a nullable uuid
--          with a UNIQUE index and no foreign key, an attribution like
--          `created_by`. Null for an operator-provisioned organization. One
--          account founds at most one organization by shape (AD-3). E4, as
--          the grants stand (review of 19.3): `authenticated` holds no UPDATE
--          on it (0004 revoked the table-wide grant and grants columns by
--          name, never this one); `anon` keeps Supabase's default table grant
--          but has no update policy, so row level security refuses it; and
--          `service_role` is the secret key's role (AD-17), trusted and past
--          row level security, as for every other column. No policy inserts an
--          organization.
--          Recorded by 0061's triggers, hidden from the history (AD-11,
--          `HISTORY_HIDDEN_COLUMNS`).
--   (iii)  `organizations_slug_not_reserved`: the reserved slugs (AD-23 step
--          6), a check, so the operator script cannot provision one either.
--          The migration first refuses to run if an existing slug is one.
--   (iv)   `private.organization_attempts`: one row per call that got past the
--          caller's state and its input (AD-23 step 5). No foreign key: an
--          account housekeeping (AD-25) deletes leaves its rows to age out. No
--          session role holds a privilege on it; it has no `organization_id`,
--          so it is outside the change history (AD-11 names it excluded).
--   (v)    `public.create_organization(…)`: AD-23 in full, its eight steps in
--          order. A definer with `search_path = ''`, every name qualified, no
--          dynamic SQL (D7). Executable by `authenticated` only.
--   (vi)   0068's trigger function, replaced (D5, deferred-work OWNER 19.3):
--          an email identity's member row is inserted ONLY by
--          `create_organization`, which names the founding account in the
--          transaction-local setting `shift.founding_account` first. An
--          admin's insert, or the owner's, of an email identity's row is
--          refused with 23514 `SIGN_IN_IS_EMAIL`. PostgREST runs no SQL a
--          session writes, so no session can set that setting.
--   (vii)  C8 (founder decision, 2026-11-21): CONFIRMATION FORGETS THE
--          PASSWORD. `private.forget_password_on_confirmation()`, BEFORE
--          UPDATE OF `email_confirmed_at` on `auth.users`: when an address that
--          was unconfirmed becomes confirmed, and it is not synthesized,
--          `encrypted_password` becomes null in GoTrue's own UPDATE. Read from
--          GoTrue v2.196.0's pinned source, with no GoTrue change:
--            * `User.Confirm` writes `UpdateOnly(confirmation_token,
--              email_confirmed_at)`, then `raw_user_meta_data` alone; both
--              `signupVerify` and `recoverVerify` reload the row before
--              issuing the session, so nothing writes the old hash back;
--            * `User.Authenticate` answers false for a nil or empty hash, so
--              no password signs the account in until one is set;
--            * `PUT /user` sets a first password with no current-password
--              check (`HasPassword` is false) and logs out the other sessions.
--          GoTrue v2.196.0 keeps the FIRST signup's password on a repeat
--          signup of an unconfirmed address, so a stranger who signed the
--          address up first could otherwise sign into the account its owner
--          confirms. Now whatever password anyone chose before confirmation
--          stops working at confirmation, and the account holds only the one
--          set on `/potvrda`. Synthesized accounts are exempt: `admin-auth`'s
--          `createUser` confirms by an UPDATE after its INSERT (admin.go), and
--          the operator script inserts its row confirmed.
--
--          ONLY A HASH THE SAME UPDATE LEAVES UNCHANGED (review of 19.3): an
--          UPDATE that confirms and sets a password together (the operator's
--          SQL) keeps the password it sets. GoTrue's `User.Confirm` writes
--          two columns only, so its UPDATE never carries a new hash, and the
--          old one is nulled. Read against admin.go (review 2 of 19.3):
--          `updateUserById({ password, email_confirm })` confirms first
--          (nulling the old hash), then writes the new one in
--          `UpdatePassword`'s own UPDATE, which this trigger ignores, so the
--          password it sets is kept; `createUser({ email, password,
--          email_confirm })` of a REAL address INSERTs the hash and then
--          confirms, so that password is forgotten and must be set again by
--          an update that confirms nothing (`test/claimless-account.test.ts`).
--          An invite's verify writes GoTrue's temporary random password and
--          then confirms, so the invitee holds none, and sets one anyway.
--          Nothing in the product creates a real address through the admin
--          API: `admin-auth` creates synthesized ones only.
--
--          TWO OTHER EDGES, recorded (review of 19.3):
--            * AUTOCONFIRM. With `GOTRUE_MAILER_AUTOCONFIRM`, `/signup`
--              confirms in its own request (an UPDATE after the INSERT), so
--              every signup password would be forgotten at once. AD-21's auth
--              entrypoint refuses autoconfirm while signup is open, and
--              `config.toml` pins confirmations on; a stack with signup shut
--              creates no email identity at all.
--            * IDENTITY UNLINK. GoTrue resets `email_confirmed_at` when a
--              linked identity is removed, and a later re-confirmation would
--              forget the password again. `/user/identities` is not on Kong's
--              allow-list (AD-22), so no session reaches it.
--
--          GoTrue v2.196.0's `migrations/` only add columns and indexes to
--          `auth.users`; none drops or recreates the table or its triggers,
--          and one dropping `email_confirmed_at` would fail on this trigger's
--          column dependency rather than drop it silently. Accounts confirmed
--          before 0071 are untouched: only the null-to-set transition acts.
--
--   (viii) 0064's `public.refuse_write_by_stale_admin()`, restated word for
--          word with one early exit: the Founding Admin's INSERT that
--          `create_organization` names in `shift.founding_account`.

-- ------------------------------------------------------------ (i) the timezone

-- The script's rule, word for word: an IANA `Area/Location` name the database
-- knows. An abbreviation (`CET`, `UTC`), a POSIX string, or a `posix/` or
-- `right/` alias is refused, because Postgres and the browser's `Intl` would
-- read it differently, and the timezone cannot be changed in the product
-- afterwards. STABLE, not immutable: `pg_timezone_names` is not.
--
-- NO `Etc/…` (review of 19.3): those zones carry POSIX's inverted sign
-- (the zone named GMT plus one is UTC minus one), an organization would read its offset backwards,
-- and the zone is locked afterwards. A stricter rule than the operator script
-- had, so the script now refuses them too.
-- `test/fixtures/known-timezones.json` is its parity vector.
create function private.is_known_timezone(zone text) returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select zone is not null
     and zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
     and zone !~ '^(posix|right)/'
     and zone !~ '^Etc/'
     and exists (select 1 from pg_catalog.pg_timezone_names as z where z.name = zone);
$$;

revoke execute on function private.is_known_timezone(text) from public;
revoke execute on function private.is_known_timezone(text) from anon;
revoke execute on function private.is_known_timezone(text) from authenticated;
revoke execute on function private.is_known_timezone(text) from service_role;

-- ----------------------------------------------------------- (ii) founded_by

alter table public.organizations add column founded_by uuid;

-- UNIQUE, nulls distinct: any number of operator-provisioned organizations,
-- and one per founding account.
create unique index organizations_founded_by_key on public.organizations (founded_by);

-- ------------------------------------------------------- (iii) reserved slugs

do $$
declare
  reserved text;
begin
  select pg_catalog.string_agg(o.slug, ', ' order by o.slug) into reserved
    from public.organizations as o
   where o.slug in ('admin', 'api', 'app', 'auth', 'postavljanje', 'prijava', 'registracija', 'shift', 'staging', 'www');
  if reserved is not null then
    raise exception using
      errcode = 'check_violation',
      message = 'ORGANIZATION_SLUG_RESERVED',
      detail = reserved,
      hint = 'Rename these organizations by hand before applying 0071.';
  end if;
end;
$$;

alter table public.organizations
  add constraint organizations_slug_not_reserved check (
    slug not in ('admin', 'api', 'app', 'auth', 'postavljanje', 'prijava', 'registracija', 'shift', 'staging', 'www')
  );

-- ------------------------------------------------------------ (iv) attempts

create table private.organization_attempts (
  auth_user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index organization_attempts_auth_user_id_attempted_at_idx
  on private.organization_attempts (auth_user_id, attempted_at);

alter table private.organization_attempts enable row level security;

revoke all on table private.organization_attempts from public;
revoke all on table private.organization_attempts from anon;
revoke all on table private.organization_attempts from authenticated;
revoke all on table private.organization_attempts from service_role;

-- --------------------------------------------------- (v) create_organization

create function public.create_organization(
  p_name text,
  p_slug text,
  p_organization_type text,
  p_timezone text,
  p_leave_year_start_month integer,
  p_leave_year_start_day integer,
  p_admin_name text,
  p_admin_leave_allowance_days integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- The class `private.name_key` strips (0024), as the operator script trims
  -- (`test/supabase-scaffold.test.ts` holds the copies equal).
  white_space constant text := U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';

  -- The one shipped locale (NFR-8), pinned to the SPA's resource file by
  -- `test/supabase-scaffold.test.ts`.
  shipped_locale constant text := 'hr';

  -- AD-23 step 4: the two-argument advisory lock, under a namespace of its own.
  lock_namespace constant integer := 19003;
  lock_key constant integer := 1;

  -- 0036's name length, and the ceiling of `members.leave_allowance_days`.
  name_max_length constant integer := 100;
  allowance_max constant integer := 32767;

  -- D4: the one PostgREST path that may reach this function.
  own_path constant text := '/rpc/create_organization';

  caller        uuid := auth.uid();
  account       record;
  request_path  text := pg_catalog.current_setting('request.path', true);
  settings      private.signup_settings%rowtype;

  org_name      text;
  org_slug      text;
  org_type      text;
  org_timezone  text;
  admin_name    text;

  recent_attempts       bigint;
  recent_organizations  bigint;

  violated      text;
  candidate     text;
  suffix        text;
  proposal      text;
  alphabet      constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  new_organization_id uuid;
begin
  -- D4 (deferred-work, OWNER 19.3): PostgREST's `rpc/graphql` would go around
  -- Kong's per-IP route. A call through PostgREST carries its path; a direct
  -- SQL call (a test, the operator) carries none.
  if request_path is not null and request_path <> '' and request_path <> own_path then
    raise exception using errcode = '42501', message = 'ORGANIZATION_NOT_CREATABLE';
  end if;

  -- 1. Lock the caller: AD-25's housekeeping takes the same row `for update
  --    skip locked`, so an account inside this call is never deleted.
  select u.id, u.email, u.email_confirmed_at, u.banned_until, u.deleted_at, u.raw_app_meta_data
    into account
    from auth.users as u
   where u.id = caller
     for update;
  if not found then
    raise exception using errcode = '42501', message = 'ORGANIZATION_NOT_CREATABLE';
  end if;

  -- 2. The caller's state, facts about the caller alone, one refusal.
  if account.email_confirmed_at is null
     or (account.banned_until is not null and account.banned_until > pg_catalog.now())
     or account.deleted_at is not null
     or private.address_kind(account.email) <> 'email'
     or coalesce(account.raw_app_meta_data ->> 'must_set_password', '') = 'true'
     or exists (select 1 from public.members as m where m.auth_user_id = caller)
  then
    raise exception using errcode = '42501', message = 'ORGANIZATION_NOT_CREATABLE';
  end if;

  -- 3. The input, before anything is counted: it reveals nothing about anyone
  --    else (D10). Trimmed as the operator script trims, kept as written.
  org_name := pg_catalog.btrim(coalesce(p_name, ''), white_space);
  org_slug := pg_catalog.btrim(coalesce(p_slug, ''), white_space);
  org_type := pg_catalog.btrim(coalesce(p_organization_type, ''), white_space);
  org_timezone := pg_catalog.btrim(coalesce(p_timezone, ''), white_space);
  admin_name := pg_catalog.btrim(coalesce(p_admin_name, ''), white_space);

  if private.name_key(org_name) = '' or pg_catalog.char_length(org_name) > name_max_length then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'name';
  end if;
  -- 0002's rule.
  if not (org_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and pg_catalog.length(org_slug) <= 63) then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'slug';
  end if;
  if private.name_key(org_type) = '' or pg_catalog.char_length(org_type) > name_max_length then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'organization_type';
  end if;
  if p_leave_year_start_month is null or p_leave_year_start_month not between 1 and 12
     or p_leave_year_start_day is null or p_leave_year_start_day not between 1 and 28
  then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'leave_year_start';
  end if;
  if private.name_key(admin_name) = '' or pg_catalog.char_length(admin_name) > name_max_length then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'admin_name';
  end if;
  if p_admin_leave_allowance_days is null or p_admin_leave_allowance_days not between 0 and allowance_max then
    raise exception using errcode = '22023', message = 'ORGANIZATION_INPUT_INVALID', detail = 'admin_leave_allowance_days';
  end if;
  if not private.is_known_timezone(org_timezone) then
    raise exception using errcode = '22023', message = 'ORGANIZATION_TIMEZONE_UNKNOWN';
  end if;

  -- 4. Serialize every founding, so the ceiling's count is exact.
  perform pg_catalog.pg_advisory_xact_lock(lock_namespace, lock_key);

  -- 5. The limits. The attempt row is written first and every limit is
  --    RETURNED, never raised, so the row commits with the answer.
  insert into private.organization_attempts (auth_user_id) values (caller);

  select s.* into settings from private.signup_settings as s where s.id;
  if not found or not settings.open then
    return pg_catalog.jsonb_build_object('code', 'TRY_LATER');
  end if;

  select pg_catalog.count(*) into recent_attempts
    from private.organization_attempts as a
   where a.auth_user_id = caller
     and a.attempted_at > pg_catalog.now() - interval '24 hours';
  if recent_attempts > settings.attempts_per_account then
    return pg_catalog.jsonb_build_object('code', 'TRY_LATER');
  end if;

  select pg_catalog.count(*) into recent_organizations
    from public.organizations as o
   where o.founded_by is not null
     and o.created_at > pg_catalog.now() - interval '24 hours';
  if recent_organizations >= settings.organizations_per_day then
    return pg_catalog.jsonb_build_object('code', 'TRY_LATER');
  end if;

  -- 6 and 7. The slug, and the write. Both rows in one block, so a slug that
  --    is taken (`organizations_slug_key`) or reserved
  --    (`organizations_slug_not_reserved`) undoes the block alone: the attempt
  --    row above stays, and the answer is the same for both.
  begin
    insert into public.organizations (
      slug, name, organization_type, timezone, locale,
      leave_year_start_month, leave_year_start_day, founded_by
    ) values (
      org_slug, org_name, org_type, org_timezone, shipped_locale,
      p_leave_year_start_month::smallint, p_leave_year_start_day::smallint, caller
    )
    returning id into new_organization_id;

    -- The Founding Admin: the operator script's domain rows for its admin,
    -- with `email` from the account and the username AD-12 derives (0068's
    -- function). D5: the setting names this account for 0068's trigger, and
    -- is cleared once the row is in.
    perform pg_catalog.set_config('shift.founding_account', caller::text, true);
    insert into public.members (
      organization_id, auth_user_id, name, username, email, role, leave_allowance_days
    ) values (
      new_organization_id, caller, admin_name, private.email_identity_username(account.email),
      account.email, 'admin', p_admin_leave_allowance_days::smallint
    );
    perform pg_catalog.set_config('shift.founding_account', '', true);
  exception
    when unique_violation or check_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = 'organizations_founded_by_key' then
        -- A race of one account with itself.
        raise exception using errcode = '42501', message = 'ORGANIZATION_NOT_CREATABLE';
      end if;
      if violated is distinct from 'organizations_slug_key' and violated is distinct from 'organizations_slug_not_reserved' then
        raise;
      end if;

      -- The proposal: the first free `<base>-2` … `<base>-9`, else `<base>-`
      -- and four random `[a-z0-9]`. The base is cut so the proposal fits 63
      -- characters. A proposal has a hyphen, so it is never reserved. It is
      -- not held for the caller.
      proposal := null;
      for n in 2..9 loop
        candidate := pg_catalog.rtrim(pg_catalog.left(org_slug, 61), '-') || '-' || n::text;
        if not exists (select 1 from public.organizations as o where o.slug = candidate) then
          proposal := candidate;
          exit;
        end if;
      end loop;
      -- Bounded (review of 19.3): the advisory lock is held, so a run of taken
      -- random proposals may not hold every other founding. After twenty the
      -- answer is the neutral limit, and the attempt row stays.
      for tries in 1..20 loop
        exit when proposal is not null;
        suffix := '';
        for i in 1..4 loop
          suffix := suffix || pg_catalog.substr(
            alphabet,
            1 + (pg_catalog.get_byte(extensions.gen_random_bytes(1), 0) % 36),
            1
          );
        end loop;
        candidate := pg_catalog.rtrim(pg_catalog.left(org_slug, 58), '-') || '-' || suffix;
        if not exists (select 1 from public.organizations as o where o.slug = candidate) then
          proposal := candidate;
        end if;
      end loop;
      if proposal is null then
        return pg_catalog.jsonb_build_object('code', 'TRY_LATER');
      end if;

      -- Never says that an organization holds the slug.
      return pg_catalog.jsonb_build_object('code', 'SLUG_UNAVAILABLE', 'proposal', proposal);
  end;

  -- 8. The answer. The SPA refreshes the session, and the hook stamps the claim.
  return pg_catalog.jsonb_build_object(
    'code', 'ORGANIZATION_CREATED',
    'organizationId', new_organization_id,
    'slug', org_slug
  );
end;
$$;

-- `authenticated` alone. Supabase's defaults grant EXECUTE on a new `public`
-- function to each request role one by one, so each other one is revoked by
-- name.
revoke execute on function public.create_organization(text, text, text, text, integer, integer, text, integer) from public;
revoke execute on function public.create_organization(text, text, text, text, integer, integer, text, integer) from anon;
revoke execute on function public.create_organization(text, text, text, text, integer, integer, text, integer) from service_role;
grant execute on function public.create_organization(text, text, text, text, integer, integer, text, integer) to authenticated;

-- ------------------------------------- (vi) 0068's trigger, the founding setting

-- 0068's function, with one change: an INSERT of an email identity's row must
-- also be `create_organization`'s, which names the row's account in
-- `shift.founding_account` (D5). Every other branch is 0068's, word for word.
-- `create or replace` keeps 0068's revokes and its trigger.
create or replace function private.refuse_username_change_of_email_identity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  address  text;
  previous text;
begin
  if new.organization_id is null or new.auth_user_id is null then
    return new;
  end if;

  select u.email into address from auth.users u where u.id = new.auth_user_id;
  if not found then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if private.address_kind(address) <> 'synthesized'
       and (new.username is distinct from private.email_identity_username(address)
            or pg_catalog.current_setting('shift.founding_account', true) is distinct from new.auth_user_id::text)
    then
      raise exception using errcode = '23514', message = 'SIGN_IN_IS_EMAIL';
    end if;
    return new;
  end if;

  if old.auth_user_id is not null then
    select u.email into previous from auth.users u where u.id = old.auth_user_id;
  end if;

  if private.address_kind(address) <> 'synthesized' or private.address_kind(previous) <> 'synthesized' then
    raise exception using errcode = '23514', message = 'SIGN_IN_IS_EMAIL';
  end if;

  return new;
end;
$$;

-- -------------------------------------------- (vii) C8: confirmation forgets

-- A definer: GoTrue's role (`supabase_auth_admin`) holds no usage on `private`,
-- and the predicate is there. It reads nothing and writes only NEW.
create function private.forget_password_on_confirmation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and new.encrypted_password is not distinct from old.encrypted_password
     and private.address_kind(new.email) <> 'synthesized'
  then
    new.encrypted_password := null;
  end if;
  return new;
end;
$$;

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is created,
-- not when it fires.
revoke execute on function private.forget_password_on_confirmation() from public;
revoke execute on function private.forget_password_on_confirmation() from anon;
revoke execute on function private.forget_password_on_confirmation() from authenticated;
revoke execute on function private.forget_password_on_confirmation() from service_role;

create trigger users_forget_password_on_confirmation
  before update of email_confirmed_at on auth.users
  for each row
  execute function private.forget_password_on_confirmation();

-- ------------------------- (viii) the founding insert past the stale-admin re-check

-- 0064's `public.refuse_write_by_stale_admin()`, word for word, with one early
-- exit before 0023's gate: the Founding Admin's INSERT that
-- `create_organization` names in `shift.founding_account`. `create or replace`
-- keeps every trigger that calls it; its revokes are restated.
create or replace function public.refuse_write_by_stale_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  if tg_op = 'DELETE' then
    changed := old;
  else
    changed := new;
  end if;

  -- STORY 19.3 (0071, review BLOCKER): `create_organization` inserts its
  -- Founding Admin as the owner, but `role` stays the session's
  -- `authenticated` inside a definer and the trigger depth is 1, so the
  -- re-check below would ask `current_member_access()` for an admin row the
  -- founder cannot have yet. The definer names the row's account in the
  -- transaction-local `shift.founding_account` (D5), which no session can set
  -- through PostgREST, so that one INSERT passes. Everything else is 0064's.
  -- Nested, as 0064 nests `new.team_id`: `auth_user_id` is only read on `members`.
  if tg_op = 'INSERT' and tg_table_name = 'members' then
    if new.auth_user_id::text = pg_catalog.current_setting('shift.founding_account', true) then
      return new;
    end if;
  end if;

  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The caller, re-read. The policy read it on the statement's snapshot.
  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = changed.organization_id
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
  end if;

  -- The team, re-read: the insert policies read `archived` inline. Nested, so
  -- `new.team_id` is only read on the two tables that have it.
  if tg_op = 'INSERT' and tg_table_name in ('team_membership_versions', 'rotation_assignments') then
    if new.team_id is not null and exists (
      select 1
        from public.teams team
       where team.organization_id = new.organization_id
         and team.id = new.team_id
         and team.archived
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  -- The step's type, re-read: 0016's step policy reads `archived` inline.
  if tg_op = 'INSERT' and tg_table_name = 'rotation_steps' then
    if exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = new.organization_id
         and shift_type.id = new.shift_type_id
         and shift_type.archived
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  -- 0064: the loan's team, re-read: 0062's policy reads both conjuncts inline.
  if tg_op = 'INSERT' and tg_table_name = 'team_loans' then
    if private.team_loan_team_refused(new.organization_id, new.member_id, new.team_id, new.during) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_write_by_stale_admin() from public;
revoke execute on function public.refuse_write_by_stale_admin() from anon;
revoke execute on function public.refuse_write_by_stale_admin() from authenticated;
revoke execute on function public.refuse_write_by_stale_admin() from service_role;
