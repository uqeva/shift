-- 0069_reminder_settings.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 17.1: a member chooses their reminders (CAP-26; FR-85, FR-65; D4,
-- D-S6; AD-2, AD-11 and AD-18 as amended for 17.1).
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `reminder_settings`: one self-owned row per member, on 0044's terms.
--         `leads` holds at most two distinct codes of the closed set
--         `@shift/domain`'s `REMINDER_LEADS` exports (held equal by
--         `test/supabase-scaffold.test.ts`), in that set's order; reminders
--         are on exactly when `cardinality(leads) > 0`, with no separate
--         flag. `email` is the reminder email switch, off by default. NO ROW
--         MEANS OFF, email off (D4, D-S6). A member reads, inserts and updates
--         only their own row: insert names `organization_id, member_id,
--         leads, email`, update `leads, email`. No delete, no admin reads
--         another member's row, `anon` nothing. Writes are update-then-insert,
--         never an upsert (0044's reason: an upsert's `do update` names every
--         column it sends).
--   (ii)  `private.reminder_email_on(member)`: AD-18's ONE email predicate. A
--         recorded non-blank address, the member's own email switch
--         (`notification_settings.email`, no row: on), the organization's
--         `email_notifications`, and the reminder email switch
--         (`reminder_settings.email`, no row: off). Callable by no session
--         role: the screen's read below and, from 17.2, the outbox filter
--         call it as their owner.
--   (iii) `public.reminder_channels()`: the caller's own `{ push, email }`.
--         Push is at least one own device anywhere (what `notify_members`
--         uses), email is the predicate. A caller who is not an active member
--         of the claimed organization is refused 42501
--         `REMINDER_SETTINGS_REFUSED` (19.1's claimless sweep).
--
-- NOT AUDITED (FR-85, FR-78 as amended): a member's own preference, as
-- `notification_settings` and `push_subscriptions`. AD-11 names it excluded,
-- and so does the scaffold pin; no history record.
--
-- NOTHING ELSE. The outbox filter and the claim's settlement of a
-- `SHIFT_REMINDER` row, `reminder_inputs` and `enqueue_shift_reminders` are
-- 17.2's and 17.3's (deferred-work.md, OWNER 17.2).

-- ----------------------------------------------------- (i) the member's choice

create table public.reminder_settings (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  member_id uuid not null,

  -- At most two distinct leads, from the closed set, in its order: the second
  -- conjunct of the check is the order (strictly increasing, so distinct too).
  leads text[] not null default '{}',

  -- The reminder email switch, off by default (D-S6).
  email boolean not null default false,

  updated_at timestamptz not null default now(),

  constraint reminder_settings_pkey primary key (organization_id, member_id),

  -- One dimension, from 1, at most two, every one a lead, in the set's order.
  -- The order clause compares `leads[1]` with `leads[2]` only, so it holds
  -- order and distinctness ONLY because the maximum is 2: a later change to
  -- `MAX_REMINDER_LEADS` must rewrite it (every adjacent pair) in the same
  -- migration that raises the cardinality bound.
  constraint reminder_settings_leads_check check (
    coalesce(array_ndims(leads), 1) = 1
    and coalesce(array_lower(leads, 1), 1) = 1
    and cardinality(leads) <= 2
    and leads <@ array['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']::text[]
    and (
      cardinality(leads) < 2
      or array_position(array['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']::text[], leads[1])
         < array_position(array['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']::text[], leads[2])
    )
  ),

  -- To 0002's unique (organization_id, id): a row naming another tenant's
  -- member is unrepresentable. A choice is the member's own and goes with
  -- them; e2e removes members only with their organization, so its cleanup
  -- needs no new delete.
  constraint reminder_settings_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

alter table public.reminder_settings enable row level security;

-- The own row only, 0044's three rules exactly: the tenant from the claim and
-- from the fresh helper as an ACTIVE account of any role, and the member the
-- caller's own row in that organization, matched by `auth_user_id`.
create policy reminder_settings_select_own on public.reminder_settings
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = reminder_settings.organization_id
         and member.id = reminder_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

create policy reminder_settings_insert_own on public.reminder_settings
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = reminder_settings.organization_id
         and member.id = reminder_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

create policy reminder_settings_update_own on public.reminder_settings
  for update
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = reminder_settings.organization_id
         and member.id = reminder_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = reminder_settings.organization_id
         and member.id = reminder_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

-- The writable columns. Insert names the four facts of the row; update the
-- two choices only, so a row never moves to another member or tenant. No
-- delete: a member turns reminders off by updating `leads` to empty. `anon`
-- reads and writes nothing.
revoke all on table public.reminder_settings from anon;
revoke insert, update, delete, truncate, references, trigger on table public.reminder_settings
  from authenticated;
grant select on table public.reminder_settings to authenticated;
grant insert (organization_id, member_id, leads, email) on table public.reminder_settings
  to authenticated;
grant update (leads, email) on table public.reminder_settings to authenticated;

-- `updated_at` is the server's, on every update: 0044's stamp, whose body
-- names no table.
create trigger reminder_settings_touch
  before update on public.reminder_settings
  for each row execute function private.touch_notification_settings();

-- ------------------------------------------------- (ii) the one email predicate

-- AD-18's one predicate. INVOKER: its callers are definers owned by the
-- migration role (the read below; from 17.2 the outbox filter), which read
-- every row it names past row level security. No session role may call it.
create function private.reminder_email_on(p_member uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.members m
      join public.organizations o
        on o.id = m.organization_id
      join public.reminder_settings r
        on r.organization_id = m.organization_id
       and r.member_id = m.id
     where m.id = p_member
       and m.email is not null
       and pg_catalog.btrim(m.email) <> ''
       and o.email_notifications
       and r.email
       and not exists (
         select 1
           from public.notification_settings s
          where s.organization_id = m.organization_id
            and s.member_id = m.id
            and not s.email
       )
  );
$$;

revoke execute on function private.reminder_email_on(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------- (iii) the channels

-- The caller's own channels, for the screen's line: `push`, at least one own
-- device (anywhere, not only this one); `email`, the predicate above. 0067's
-- `calendar_feed_status` refusal shape.
create function public.reminder_channels()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  own_member uuid;
begin
  if claimed is not null and exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    select m.id
      into own_member
      from public.members m
     where m.organization_id = claimed
       and m.auth_user_id = (select auth.uid());
  end if;

  if own_member is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'REMINDER_SETTINGS_REFUSED';
  end if;

  return pg_catalog.jsonb_build_object(
    'push', exists (
      select 1
        from public.push_subscriptions p
       where p.organization_id = claimed
         and p.member_id = own_member
    ),
    'email', private.reminder_email_on(own_member)
  );
end;
$$;

revoke execute on function public.reminder_channels() from public, anon, service_role;
grant execute on function public.reminder_channels() to authenticated;
