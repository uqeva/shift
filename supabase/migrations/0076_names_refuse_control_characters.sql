-- 0076_names_refuse_control_characters.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Epic 17 retro A4 (deferred-work, code review 2 of 17.3): a team's or a shift
-- type's name is interpolated, as saved, into an email's subject (`notify`:
-- `{teamName}` in the loan and reminder subjects, `{shiftTypeName}` in the
-- reminder subjects). 0009/0013/0024/0036 bound a name's length and refuse a
-- blank one, but not a control character inside it, so a name holding a line
-- break reached Resend's `subject` as is. It travels inside JSON, so no header
-- can be injected, but Resend may refuse the request (a 4xx is a permanent
-- failure) or show a broken subject. REFUSED AT WRITE TIME, here, for every
-- writer (the app, a direct PostgREST call, an operator), so `notify` never
-- meets one and its rendering of every code stays byte for byte as it is.
--
-- THE CLASS: Unicode's control characters (general category Cc: U+0001–001F,
-- U+007F–009F; U+0000 cannot be stored in `text`) and the two line and
-- paragraph separators (U+2028, U+2029), which a mail client may also read as
-- a line break. Written with the regex engine's `\uXXXX` escapes, which name
-- code points, so the range does not follow the collation. The client mirror
-- is `NAME_CONTROL_CHARACTER_CLASS` in `apps/web/src/utils/name.ts`; the scaffold
-- compares the two class strings.
--
-- A name's edges are already trimmed by every client (`enteredName`, in the
-- 0024 white-space class, which holds U+0009–000D, U+001C–001F and U+0085),
-- so a person who pastes `Tim\n` stores `Tim` as before; only a control
-- character INSIDE a name, or one a direct caller did not trim, is refused.
--
-- EXISTING ROWS ARE FOLDED, THEN THE CHECKS ARE ADDED VALIDATED. Every run of
-- the class inside a stored name becomes one space, and the result is trimmed
-- in 0024's white-space class: `Tim\nA` becomes `Tim A`. The pilot's names
-- were typed into single-line inputs, so none is expected; the fold is for a
-- row a direct API caller wrote. A fold is an ordinary update, so 0061's
-- triggers record it in the organization's history (no actor: the
-- migration's own role), the same as an operator's rename.
-- A GUARD comes first, as 0024's did: if a folded name would be blank, or
-- would take the key (`private.name_key`) of another team or type still in
-- use in its organization, or two folded names would take one key, nothing
-- is changed and the migration raises `NAME_CONTROL_FOLD_CONFLICT` naming the
-- table. The operator renames that row by hand and pushes again. So the fold
-- never fails half-way on a unique index or a blank check, and never merges
-- two names silently.
--
-- REFUSALS ARE NAMED. `teams_name_characters` and
-- `shift_types_name_characters`, 23514, which the web app reads by name
-- (`namesCharacterCheck`) as its own failure, beside `_name_length`.
--
-- NOT CHANGED: members' and organizations' names (a member's name reaches a
-- subject too, `{memberName}`, `{proposerName}`, `{addresseeName}`), and hour
-- bands and absence types, which reach no subject. Members are written by
-- `admin-auth` as well as by PostgREST, so their check is a story of its own
-- (deferred-work, epic 17 retro A4, still open in part).
--
-- DEPLOY ORDER: `db push`, then the SPA (which names the refusal). An older
-- SPA reads the refusal as its generic "name cannot be empty" message, which
-- only a name with a control character inside it can meet.

-- ------------------------------------------------------------- the guard

do $$
declare
  conflicts text[] := array[]::text[];
begin
  -- A folded team name that is blank, or that collides with another team in
  -- use (its folded key), in the same organization.
  if exists (
    with folded as (
      select t.id,
             t.organization_id,
             t.archived,
             t.name ~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' as changes,
             private.name_key(pg_catalog.regexp_replace(t.name, '[\u0001-\u001F\u007F-\u009F\u2028\u2029]+', ' ', 'g')) as key
        from public.teams t
    )
    select 1
      from folded f
     where f.changes
       and (
         f.key = ''
         or (
           not f.archived
           and exists (
             select 1
               from folded o
              where o.organization_id = f.organization_id
                and o.id <> f.id
                and not o.archived
                and o.key = f.key
           )
         )
       )
  ) then
    conflicts := conflicts || 'teams'::text;
  end if;

  if exists (
    with folded as (
      select s.id,
             s.organization_id,
             s.archived,
             s.name ~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' as changes,
             private.name_key(pg_catalog.regexp_replace(s.name, '[\u0001-\u001F\u007F-\u009F\u2028\u2029]+', ' ', 'g')) as key
        from public.shift_types s
    )
    select 1
      from folded f
     where f.changes
       and (
         f.key = ''
         or (
           not f.archived
           and exists (
             select 1
               from folded o
              where o.organization_id = f.organization_id
                and o.id <> f.id
                and not o.archived
                and o.key = f.key
           )
         )
       )
  ) then
    conflicts := conflicts || 'shift_types'::text;
  end if;

  if pg_catalog.cardinality(conflicts) > 0 then
    raise exception using
      errcode = 'check_violation',
      message = 'NAME_CONTROL_FOLD_CONFLICT',
      detail = 'rename by hand first: ' || pg_catalog.array_to_string(conflicts, ', ');
  end if;
end;
$$;

-- -------------------------------------------------------------- the fold

update public.teams t
   set name = pg_catalog.btrim(
         pg_catalog.regexp_replace(t.name, '[\u0001-\u001F\u007F-\u009F\u2028\u2029]+', ' ', 'g'),
         U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
       )
 where t.name ~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]';

update public.shift_types s
   set name = pg_catalog.btrim(
         pg_catalog.regexp_replace(s.name, '[\u0001-\u001F\u007F-\u009F\u2028\u2029]+', ' ', 'g'),
         U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
       )
 where s.name ~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]';

-- ------------------------------------------------------------ the checks

alter table public.teams drop constraint if exists teams_name_characters;
alter table public.teams
  add constraint teams_name_characters check (name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]');

alter table public.shift_types drop constraint if exists shift_types_name_characters;
alter table public.shift_types
  add constraint shift_types_name_characters check (name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]');
