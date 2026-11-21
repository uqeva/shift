-- Story 19.2 (AD-12 and AD-16 as amended by Architect pass 2; checklist C2):
-- an email identity's username follows its address, and nothing renames it.
--
-- NUMBERING. 0066 is 19.1's signup door and 0067 is 16.3's feed tokens; this
-- follows both.
--
-- WHY. A Founding Admin (19.3) signs in with the verified address it signed up
-- with, and its username is a handle derived from that address. `admin-auth`'s
-- `updateUserById` renames a member by writing `members.username` first and
-- then the auth address to `<username>@<slug>.shift.invalid`. For an email
-- identity that second write would turn the account into a username identity
-- with a synthesized address: the person could no longer sign in with their
-- email, and recovery by email would stop. This trigger is the one owner of the
-- rule: `admin-auth` maps its refusal to 409 `SIGN_IN_IS_EMAIL` and makes no
-- auth call, and a direct PostgREST PATCH meets the same refusal.
--
-- THE DERIVATION is 0066's hook's, exactly: the local part of the trimmed
-- address, lower-cased ASCII-only (`translate` over A–Z, 19.1's D5), not
-- `lower()`, so an address the hook let through can never disagree with the
-- username derived from it on a non-ASCII letter. 19.3's `create_organization`
-- derives the Founding Admin's username with the same function
-- (deferred-work, OWNER 19.3).
--
-- A USERNAME IDENTITY'S RENAME IS UNCHANGED: the trigger reads the member's
-- auth address and lets it through only when it is synthesized (0066's
-- `private.address_kind`). FAIL CLOSED (security review of 19.2): an address
-- the predicate calls malformed, or none at all, is held as an email
-- identity's, so an account made outside the hook and `admin-auth` can never
-- be renamed into a synthesized address. No such member exists: every
-- `admin-auth` account is synthesized, and the hook refuses a malformed one.

create function private.email_identity_username(address text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.translate(
    pg_catalog.split_part(
      pg_catalog.btrim(address, pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
                                || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(32)),
      '@', 1),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
$$;

revoke execute on function private.email_identity_username(text) from public;
revoke execute on function private.email_identity_username(text) from anon;
revoke execute on function private.email_identity_username(text) from authenticated;
revoke execute on function private.email_identity_username(text) from service_role;

-- A definer: it reads `auth.users`, which no session role may read, and it
-- reads nothing else and computes nothing beyond the derivation above.
--
-- REVIEW OF 19.2 MADE IT STRICTER than the spine's first wording ("refuses any
-- new value other than the derived one"). `admin-auth`'s rename writes the row
-- first and then ALWAYS rewrites the auth address to the synthesized one, so a
-- rename to the derived value itself would have passed the row and still
-- turned the account into a username identity. So, for any account whose
-- address is not synthesized (an email identity, or fail-closed, a malformed
-- or missing address):
-- - an UPDATE that names `username` or `auth_user_id` is refused, whatever
--   the value (the address can then never be rewritten by `admin-auth`, and a
--   row can neither be re-pointed to nor away from an email identity);
-- - an INSERT must carry the derived username (19.3's `create_organization`
--   writes exactly that; anything else is refused).
create function private.refuse_username_change_of_email_identity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  address  text;
  previous text;
begin
  if new.auth_user_id is not null then
    select u.email into address from auth.users u where u.id = new.auth_user_id;
  end if;

  if tg_op = 'INSERT' then
    if private.address_kind(address) <> 'synthesized'
       and new.username is distinct from private.email_identity_username(address) then
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

revoke execute on function private.refuse_username_change_of_email_identity() from public;
revoke execute on function private.refuse_username_change_of_email_identity() from anon;
revoke execute on function private.refuse_username_change_of_email_identity() from authenticated;
revoke execute on function private.refuse_username_change_of_email_identity() from service_role;

-- AD-3's inventory: BEFORE INSERT, and BEFORE UPDATE OF `username` or
-- `auth_user_id`. An update that names neither column never fires it, so
-- every other edit of an email identity's member row is unchanged.
create trigger members_username_follows_email_identity
  before insert or update of username, auth_user_id on public.members
  for each row
  execute function private.refuse_username_change_of_email_identity();
