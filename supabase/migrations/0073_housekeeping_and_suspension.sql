-- 0073_housekeeping_and_suspension.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- NUMBERING. 0071 is story 19.3's; 0072 is story 17.3's (built in parallel);
-- this story takes 0073. Its claim is re-created from 0072's (the late
-- settle kept), so it applies only after 0072: this branch is rebased onto
-- 17.3's merge before it merges.
--
-- Story 19.5: abandoned signups are cleaned up and the operator keeps control
-- (AD-25, AD-10 as amended by Architect pass 2; FR-101, D-S7; checklist E3,
-- E4, F1–F4). In order:
--
--   (i)    `organizations.suspended`, `not null default false`. No request
--          can write it: `authenticated` holds no UPDATE on it (0004 revoked
--          the table-wide grant and grants columns by name, never this one),
--          and `anon` keeps Supabase's default table grant but has no update
--          policy, so row level security refuses it. `service_role` is the
--          secret key's role (AD-17), trusted and past row level security, as
--          for `founded_by` (0071); no Edge Function writes it. So only the
--          operator's scripts do. Recorded by
--          0061's triggers and hidden from the history (AD-11,
--          `HISTORY_HIDDEN_COLUMNS`): suspension is not a user-facing surface
--          (FR-101).
--   (ii)   `private.organization_live(p_organization)`: the ONE function that
--          names the column (AD-10; a scaffold pin fails any other body that
--          does). An unknown or null organization is not live: it fails
--          closed. Executable by nobody: its callers are definers.
--   (iii)  Its callers, each re-created from its latest definition with the
--          check added and nothing else changed (the scaffold diffs each one
--          against its source, word for word):
--            * `current_member_access()` (0008) yields no row, so every
--              policy and every definer that re-reads its caller refuses;
--            * `custom_access_token_hook` (0008) refuses a sign-in or a
--              refresh with the existing 403 `SIGN_IN_REFUSED`;
--            * `private.calendar_feed_member_live` (0067), so the lookup
--              `calendar_feed_inputs` answers null (the feed's one 404) and
--              the state reads not live;
--            * `reminder_inputs` and `enqueue_shift_reminders` (0070) read
--              and write nothing for it;
--            * `private.notify_members` (0045) queues nothing;
--            * `push_devices_for_send` (0046) answers `inactive`, so `notify`
--              posts nothing and settles the row failed;
--            * `claim_notifications` (0072, story 17.3) settles the organization's queued
--              rows `ORGANIZATION_SUSPENDED` and never returns one;
--            * `swap_parties_active` (0049), the one definer reachable by
--              `authenticated` that read the claim without
--              `current_member_access()`, answers false.
--   (iv)   `private.delete_abandoned_accounts()` and the `housekeeping` cron
--          job, daily at 03:15 UTC (AD-25, D-S7). It deletes an `auth.users`
--          row only when ALL of these hold, read again under the row's lock:
--            * its address is an email identity's (`private.address_kind` is
--              `email`): a synthesized (username) account, or one with no
--              readable address, is never a candidate;
--            * it is not banned now: an account the operator banned stays,
--              with its attempts' evidence until they age out;
--            * no `members` row names it, in any organization;
--            * no organization names it `founded_by`;
--            * unconfirmed, and both created and last sent a confirmation
--              link more than 7 days ago (a repeat signup re-sends the link
--              and keeps `created_at`), or confirmed more than 30 days ago.
--          Each account is its own subtransaction: one that fails is logged
--          (`HOUSEKEEPING_SKIPPED`), counted as `failed` and tried again the
--          next night, and never undoes the others.
--          It takes each candidate `for update skip locked`, so an account
--          inside `create_organization` (which locks it first, AD-23 step 1)
--          or inside a `members` insert (whose foreign key check holds a key
--          share lock on it) is skipped. After the lock a NEW statement checks
--          again that no `members` row exists, so a member committed since the
--          candidates were read is seen. While the lock is held, a `members`
--          insert naming the account waits, then fails its foreign key. GoTrue's
--          own foreign keys cascade the identities, sessions and tokens. It
--          also deletes `private.organization_attempts` rows older than 30
--          days. It answers the counts and writes them to the server log.
--          Executable by nobody: pg_cron runs it as the migration role.
--
-- NOT CHANGED, decided here (19.5's required inputs):
--   * Revoked `calendar_feed_tokens` rows are KEPT. A revocation is the
--     repository's removal pair, as every other removal; a revoked row's hash
--     authorizes nothing (the lookup reads unrevoked rows only); and AD-25's
--     job deletes no domain row. They go with their member or organization.
--   * Suspension deletes nothing, and unsuspending restores access as it was.
--     Notifications settled while suspended are not sent again.
--
-- DEPLOY ORDER: `db push` alone. No SPA or Edge Function change.

-- ------------------------------------------------------ (i) the column

alter table public.organizations add column suspended boolean not null default false;

-- ------------------------------------------------------ (ii) the one reader

create function private.organization_live(p_organization uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.organizations o
     where o.id = p_organization
       and not o.suspended
  );
$$;

revoke execute on function private.organization_live(uuid) from public;
revoke execute on function private.organization_live(uuid) from anon;
revoke execute on function private.organization_live(uuid) from authenticated;
revoke execute on function private.organization_live(uuid) from service_role;

-- ------------------------------------------------------ (iii) its callers

-- 0008's helper, with the check. `create or replace` keeps its owner, its
-- grants (restated below) and its return shape.
create or replace function public.current_member_access()
returns table (organization_id uuid, member_role text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id,
         m.role,
         (u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()))
           and public.member_active_on(m.id, public.organization_today(m.organization_id))
    from public.members m
    join auth.users u on u.id = m.auth_user_id
   where m.auth_user_id = (select auth.uid())
     -- 0073 (AD-10, story 19.5): a suspended organization's member has no access.
     and private.organization_live(m.organization_id)
$$;

revoke execute on function public.current_member_access() from public;
revoke execute on function public.current_member_access() from anon;
revoke execute on function public.current_member_access() from service_role;
grant execute on function public.current_member_access() to authenticated;

-- 0008's hook, with the check after the claimless branch: an account with no
-- `members` row is still answered with no claim, as before.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signer_claims       jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  signer_organization uuid;
  signer_member       uuid;
begin
  select m.organization_id, m.id
    into signer_organization, signer_member
    from public.members m
   where m.auth_user_id = (event ->> 'user_id')::uuid;

  if signer_organization is null then
    return jsonb_set(event, '{claims}', signer_claims - 'organization_id');
  end if;

  -- 0073 (AD-10, story 19.5): a member of a suspended organization gets no
  -- token either, with the same refusal and the same 403.
  if not private.organization_live(signer_organization) then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 403, 'message', 'SIGN_IN_REFUSED')
    );
  end if;

  if not public.member_active_on(
    signer_member,
    coalesce(public.organization_today(signer_organization), (now() at time zone 'UTC')::date)
  ) then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 403, 'message', 'SIGN_IN_REFUSED')
    );
  end if;

  return jsonb_set(
    event,
    '{claims}',
    jsonb_set(signer_claims, '{organization_id}', to_jsonb(signer_organization::text))
  );
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
revoke execute on function public.custom_access_token_hook(jsonb) from service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- 0067's liveness, read by the lookup and by both state reads.
create or replace function private.calendar_feed_member_live(p_organization uuid, p_member uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.members m
      join auth.users u on u.id = m.auth_user_id
     where m.organization_id = p_organization
       and m.id = p_member
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
       and public.member_active_on(m.id, public.organization_today(m.organization_id))
       -- 0073 (AD-10, story 19.5): and its organization is not suspended.
       and private.organization_live(m.organization_id)
  )
$$;

revoke execute on function private.calendar_feed_member_live(uuid, uuid) from public, anon, authenticated, service_role;

-- 0070's read and write for `remind`.
create or replace function public.reminder_inputs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  answer jsonb;
begin
  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'memberId', due.member_id,
               'leads', pg_catalog.to_jsonb(due.leads),
               'window', pg_catalog.jsonb_build_object('from', due.today - 1, 'to', due.today + 1),
               'inputs', private.member_schedule_inputs(due.member_id, due.today - 1, due.today + 1)
             )
             order by due.organization_id, due.member_id
           ),
           '[]'::jsonb
         )
    into answer
    from (
      select r.organization_id, r.member_id, r.leads, public.organization_today(r.organization_id) as today
        from public.reminder_settings r
        join public.members m
          on m.organization_id = r.organization_id
         and m.id = r.member_id
       where pg_catalog.cardinality(r.leads) > 0
    ) due
   where due.today is not null
     and public.member_active_on(due.member_id, due.today)
     -- 0073 (AD-10, story 19.5): no suspended organization's member.
     and private.organization_live(due.organization_id);

  return pg_catalog.jsonb_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'members', answer
  );
end;
$$;

revoke execute on function public.reminder_inputs() from public, anon, authenticated;
grant execute on function public.reminder_inputs() to service_role;

create or replace function public.enqueue_shift_reminders(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_member uuid;
  v_date date;
  v_team uuid;
  v_shift_type uuid;
  v_lead text;
  v_start integer;
  v_end integer;
  v_starts_at timestamptz;
  v_organization uuid;
  v_team_name text;
  v_shift_type_name text;
  v_operands jsonb;
  v_today date;
  -- Items that passed the write-time re-check, NOT rows inserted: an item
  -- whose rows the unique key already holds (a later run of the about four
  -- that send each item) counts again.
  accepted integer := 0;
begin
  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) > 10000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
  end if;

  for item in select e.value from pg_catalog.jsonb_array_elements(p_items) as e loop
    -- THE SHAPE: exactly the eight keys, each of its type. A breach anywhere
    -- raises, and the transaction writes nothing. Null anywhere (a missing
    -- key) counts as a breach: `coalesce(…, true)`.
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;
    if coalesce(
       (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 8
       or not (item ?& array['memberId', 'date', 'teamId', 'shiftTypeId', 'lead', 'start', 'end', 'startsAt'])
       or pg_catalog.jsonb_typeof(item -> 'memberId') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'teamId') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'shiftTypeId') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'date') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'lead') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'startsAt') <> 'string'
       or pg_catalog.jsonb_typeof(item -> 'start') <> 'number'
       or pg_catalog.jsonb_typeof(item -> 'end') <> 'number'
       or (item ->> 'memberId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (item ->> 'teamId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (item ->> 'shiftTypeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (item ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or (item ->> 'startsAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
       or (item ->> 'start') !~ '^\d{1,4}$'
       or (item ->> 'end') !~ '^\d{1,4}$'
       or not ((item ->> 'lead') = any(array['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE']::text[])),
       true
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;

    begin
      v_member := (item ->> 'memberId')::uuid;
      v_team := (item ->> 'teamId')::uuid;
      v_shift_type := (item ->> 'shiftTypeId')::uuid;
      v_date := (item ->> 'date')::date;
      v_starts_at := (item ->> 'startsAt')::timestamptz;
      v_start := (item ->> 'start')::integer;
      v_end := (item ->> 'end')::integer;
      v_lead := item ->> 'lead';
    exception
      when others then
        raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end;

    -- A worked interval in minutes after the start of `date`, into the next date at most (DI-5).
    if coalesce(
         v_start < 0 or v_end <= v_start or v_end > 2879
         or pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> (item ->> 'date'),
         true
       ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'REMINDER_ITEMS_INVALID';
    end if;

    -- THE RE-CHECK, at write time: what changed since the read is skipped.
    v_organization := null;
    select m.organization_id
      into v_organization
      from public.members m
     where m.id = v_member;

    v_today := case when v_organization is null then null else public.organization_today(v_organization) end;

    if v_organization is null
       -- 0073 (AD-10, story 19.5): a suspended organization's item is skipped.
       or not private.organization_live(v_organization)
       or v_today is null
       or not public.member_active_on(v_member, v_today)
       or not private.reminder_lead_on(v_organization, v_member, v_lead)
       or v_starts_at <= now()
       or v_starts_at > now() + interval '2 days' then
      continue;
    end if;

    v_team_name := null;
    select t.name
      into v_team_name
      from public.teams t
     where t.organization_id = v_organization
       and t.id = v_team;

    v_shift_type_name := null;
    select s.name
      into v_shift_type_name
      from public.shift_types s
     where s.organization_id = v_organization
       and s.id = v_shift_type;

    if v_team_name is null or v_shift_type_name is null then
      continue;
    end if;

    v_operands := pg_catalog.jsonb_build_object(
      'date', pg_catalog.to_char(v_date, 'YYYY-MM-DD'),
      'teamId', v_team,
      'start', v_start,
      'end', v_end,
      'startsAt', pg_catalog.to_char(v_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'lead', v_lead,
      'shiftTypeName', v_shift_type_name,
      'teamName', v_team_name
    ) || case
           when v_lead = 'EVENING_BEFORE' then '{}'::jsonb
           else pg_catalog.jsonb_build_object('leadHours', pg_catalog.substr(v_lead, 2)::integer)
         end;

    perform private.notify_members(
      v_organization,
      'SHIFT_REMINDER',
      pg_catalog.md5(
        'SHIFT_REMINDER:' || v_member::text || ':' || pg_catalog.to_char(v_date, 'YYYY-MM-DD') || ':' || v_team::text || ':' || v_lead
      )::uuid,
      array[v_member],
      v_operands
    );

    accepted := accepted + 1;
  end loop;

  return accepted;
end;
$$;

revoke execute on function public.enqueue_shift_reminders(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_shift_reminders(jsonb) to service_role;

-- 0045's writer, which every event and every reminder writes through.
create or replace function private.notify_members(
  p_organization uuid,
  p_code text,
  p_subject uuid,
  p_recipients uuid[],
  p_operands jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.organization_today(p_organization);
begin
  if today is null or p_recipients is null or pg_catalog.cardinality(p_recipients) = 0 then
    return;
  end if;

  -- 0073 (AD-10, story 19.5): a suspended organization queues nothing.
  if not private.organization_live(p_organization) then
    return;
  end if;

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  select p_organization, p_code, p_subject, m.id, 'email', p_operands
    from public.members m
   where m.organization_id = p_organization
     and m.id = any(p_recipients)
     and m.email is not null
     and pg_catalog.btrim(m.email) <> ''
     and m.auth_user_id is distinct from (select auth.uid())
     and public.member_active_on(m.id, today)
  on conflict on constraint notification_outbox_once_key do nothing;

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  select p_organization, p_code, p_subject, m.id, 'push', p_operands
    from public.members m
   where m.organization_id = p_organization
     and m.id = any(p_recipients)
     and exists (
       select 1
         from public.push_subscriptions s
        where s.organization_id = m.organization_id
          and s.member_id = m.id
     )
     and m.auth_user_id is distinct from (select auth.uid())
     and public.member_active_on(m.id, today)
  on conflict on constraint notification_outbox_once_key do nothing;
end;
$$;

revoke execute on function private.notify_members(uuid, text, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;

-- 0046's send-time read of a push row's devices.
create or replace function public.push_devices_for_send(p_id uuid, p_claimed_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  row_organization uuid;
  row_recipient uuid;
begin
  select o.organization_id, o.recipient_member_id
    into row_organization, row_recipient
    from public.notification_outbox o
   where o.id = p_id
     and o.claimed_at = p_claimed_at
     and o.channel = 'push'
     and o.sent_at is null
     and o.failed_at is null;

  if row_organization is null then
    return pg_catalog.jsonb_build_object('status', 'lease_lost', 'devices', '[]'::jsonb);
  end if;

  -- 0073 (AD-10, story 19.5): a suspended organization's row is posted to no
  -- device. It reads as `inactive`, so `notify` settles it failed, unchanged.
  if not private.organization_live(row_organization) then
    return pg_catalog.jsonb_build_object('status', 'inactive', 'devices', '[]'::jsonb);
  end if;

  if not public.member_active_on(row_recipient, public.organization_today(row_organization)) then
    return pg_catalog.jsonb_build_object('status', 'inactive', 'devices', '[]'::jsonb);
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'devices', coalesce((
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                 'member_id', s.member_id
               )
               order by s.created_at, s.id
             )
        from public.push_subscriptions s
       where s.organization_id = row_organization
         and s.member_id = row_recipient
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.push_devices_for_send(uuid, timestamptz) from public;
revoke execute on function public.push_devices_for_send(uuid, timestamptz) from anon;
revoke execute on function public.push_devices_for_send(uuid, timestamptz) from authenticated;
grant execute on function public.push_devices_for_send(uuid, timestamptz) to service_role;

-- 0072's claim (17.3), with the suspended settle and the belt-and-braces check.
create or replace function public.claim_notifications(p_limit integer)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  subject_id uuid,
  recipient_member_id uuid,
  channel text,
  operands jsonb,
  attempts smallint,
  claimed_at timestamptz,
  email text,
  locale text,
  timezone text,
  slug text,
  organization_name text,
  subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'NOTIFICATION_LIMIT_INVALID';
  end if;

  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'ATTEMPTS_EXHAUSTED'
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.attempts >= 5
        and c.claimed_at < now() - interval '10 minutes'
      for update skip locked
   );

  -- 0073 (AD-10, story 19.5): a pending row, either channel, of a suspended
  -- organization is never sent, before the settles below, so it is the reason
  -- recorded. Not in flight, as below.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'ORGANIZATION_SUSPENDED',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not private.organization_live(c.organization_id)
      for update skip locked
   );

  -- 0046 (A3): a pending row, either channel, whose recipient is not active
  -- today in their organization is never sent. Not in flight, as below.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'RECIPIENT_INACTIVE',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not public.member_active_on(c.recipient_member_id, public.organization_today(c.organization_id))
      for update skip locked
   );

  -- 0070: a pending reminder whose shift has started (or whose `startsAt`
  -- cannot be read) is never sent.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'REMINDER_EXPIRED',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.code = 'SHIFT_REMINDER'
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not coalesce(now() < private.reminder_starts_at(c.operands), false)
      for update skip locked
   );

  -- 0072: a pending reminder 15 minutes past its due instant (or written 20
  -- minutes ago) is never sent: it would arrive saying "in 2 hours" when it
  -- is not (story 17.3). Comparisons of instants, no zone arithmetic.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'REMINDER_LATE',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.code = 'SHIFT_REMINDER'
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and private.reminder_late(c.operands, c.created_at)
      for update skip locked
   );

  -- 0070: a pending reminder whose lead the member turned off is never sent.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'REMINDER_TURNED_OFF',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.code = 'SHIFT_REMINDER'
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not private.reminder_lead_on(c.organization_id, c.recipient_member_id, c.operands ->> 'lead')
      for update skip locked
   );

  -- 0070: a pending reminder email whose switch went off after it was
  -- queued (0069's predicate) is never sent.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'EMAIL_TURNED_OFF',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.code = 'SHIFT_REMINDER'
        and c.channel = 'email'
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not private.reminder_email_on(c.recipient_member_id)
      for update skip locked
   );

  -- 0044: a pending email row whose recipient or organization turned email
  -- off is never sent.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'EMAIL_TURNED_OFF',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel = 'email'
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and (
          exists (
            select 1
              from public.organizations org
             where org.id = c.organization_id
               and not org.email_notifications
          )
          or exists (
            select 1
              from public.notification_settings s
             where s.organization_id = c.organization_id
               and s.member_id = c.recipient_member_id
               and not s.email
          )
        )
      for update skip locked
   );

  -- 0045: a pending push row whose member has no device left (turned off on
  -- the last one, signed out, or every one gone) has nowhere to go. Not in
  -- flight, as above.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'PUSH_NO_SUBSCRIPTION',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel = 'push'
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not exists (
          select 1
            from public.push_subscriptions s
           where s.organization_id = c.organization_id
             and s.member_id = c.recipient_member_id
        )
      for update skip locked
   );

  return query
  with claimed as (
    update public.notification_outbox o
       set claimed_at = pg_catalog.clock_timestamp(),
           attempts = o.attempts + 1
     where o.id in (
       select c.id
         from public.notification_outbox c
        where c.sent_at is null
          and c.failed_at is null
          and c.channel in ('email', 'push')
          and c.attempts < 5
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
          -- Belt and braces, as 0044: a row the settles above skipped (locked
          -- by a concurrent run) is still never returned while its channel
          -- cannot deliver, nor (0046) while its recipient is inactive, nor
          -- (0070) while it is a reminder that expired, was turned off, or
          -- whose email switch is off, nor (0072) one that waited too long.
          -- 0073 (AD-10, story 19.5): nor while its organization is suspended.
          and private.organization_live(c.organization_id)
          and public.member_active_on(c.recipient_member_id, public.organization_today(c.organization_id))
          and (
            c.code <> 'SHIFT_REMINDER'
            or (
              coalesce(now() < private.reminder_starts_at(c.operands), false)
              and not private.reminder_late(c.operands, c.created_at)
              and private.reminder_lead_on(c.organization_id, c.recipient_member_id, c.operands ->> 'lead')
              and (c.channel <> 'email' or private.reminder_email_on(c.recipient_member_id))
            )
          )
          and (
            c.channel <> 'email'
            or (
              not exists (
                select 1
                  from public.organizations org
                 where org.id = c.organization_id
                   and not org.email_notifications
              )
              and not exists (
                select 1
                  from public.notification_settings s
                 where s.organization_id = c.organization_id
                   and s.member_id = c.recipient_member_id
                   and not s.email
              )
            )
          )
          and (
            c.channel <> 'push'
            or exists (
              select 1
                from public.push_subscriptions s
               where s.organization_id = c.organization_id
                 and s.member_id = c.recipient_member_id
            )
          )
        order by c.created_at, c.id
        limit p_limit
        for update skip locked
     )
    returning o.id, o.organization_id, o.code, o.subject_id, o.recipient_member_id,
              o.channel, o.operands, o.attempts, o.claimed_at, o.created_at
  )
  select claimed.id, claimed.organization_id, claimed.code, claimed.subject_id,
         claimed.recipient_member_id, claimed.channel, claimed.operands, claimed.attempts,
         claimed.claimed_at,
         member.email, organization.locale, organization.timezone, organization.slug,
         organization.name,
         case when claimed.channel = 'push' then (
           select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                      'member_id', s.member_id
                    )
                    order by s.created_at, s.id
                  )
             from public.push_subscriptions s
            where s.organization_id = claimed.organization_id
              and s.member_id = claimed.recipient_member_id
         ) end
    from claimed
    join public.members member
      on member.organization_id = claimed.organization_id
     and member.id = claimed.recipient_member_id
    join public.organizations organization
      on organization.id = claimed.organization_id
   order by claimed.created_at, claimed.id;
end;
$$;

revoke execute on function public.claim_notifications(integer) from public;
revoke execute on function public.claim_notifications(integer) from anon;
revoke execute on function public.claim_notifications(integer) from authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- 0049's swap insert check, the one definer reachable by `authenticated` that
-- reads the claim without `current_member_access()`.
create or replace function public.swap_parties_active(
  p_organization uuid,
  p_proposer uuid,
  p_addressee uuid,
  p_given date,
  p_returned date
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is null or p_organization is distinct from claimed then
    return false;
  end if;

  -- 0073 (AD-10, story 19.5): nothing is active in a suspended organization.
  if not private.organization_live(claimed) then
    return false;
  end if;

  if p_given is not null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = p_addressee
     )
     and public.member_inactive_within(p_addressee, pg_catalog.daterange(p_given, p_given, '[]')) then
    return false;
  end if;

  if p_returned is not null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = p_proposer
     )
     and public.member_inactive_within(p_proposer, pg_catalog.daterange(p_returned, p_returned, '[]')) then
    return false;
  end if;

  return true;
end;
$$;

revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from public;
revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from anon;
revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from service_role;
grant execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) to authenticated;

-- ------------------------------------------------------ (iv) housekeeping

create function private.delete_abandoned_accounts()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate uuid;
  was_confirmed boolean;
  unconfirmed_deleted integer := 0;
  confirmed_deleted integer := 0;
  attempts_deleted integer := 0;
  failed integer := 0;
  answer jsonb;
begin
  -- The candidates, read once. Each is taken again below, under its lock.
  for candidate in
    select u.id
      from auth.users as u
     where private.address_kind(u.email) = 'email'
       and (u.banned_until is null or u.banned_until <= pg_catalog.now())
       and not exists (select 1 from public.members as m where m.auth_user_id = u.id)
       and not exists (select 1 from public.organizations as o where o.founded_by = u.id)
       and (
         (u.email_confirmed_at is null
          and greatest(u.created_at, coalesce(u.confirmation_sent_at, u.created_at)) < pg_catalog.now() - interval '7 days')
         or (u.email_confirmed_at is not null and u.email_confirmed_at < pg_catalog.now() - interval '30 days')
       )
     order by u.created_at, u.id
  loop
    -- One account per subtransaction: a row that fails for any reason is
    -- logged and left for the next night, and never undoes the others.
    begin
      -- The lock, with every condition read again on the row as it is now. A
      -- row another transaction holds (`create_organization`'s step 1, or a
      -- `members` insert's foreign key check) is skipped, never waited for.
      was_confirmed := null;
      select u.email_confirmed_at is not null
        into was_confirmed
        from auth.users as u
       where u.id = candidate
         and private.address_kind(u.email) = 'email'
         and (u.banned_until is null or u.banned_until <= pg_catalog.now())
         and not exists (select 1 from public.members as m where m.auth_user_id = u.id)
         and not exists (select 1 from public.organizations as o where o.founded_by = u.id)
         and (
           (u.email_confirmed_at is null
            and greatest(u.created_at, coalesce(u.confirmation_sent_at, u.created_at)) < pg_catalog.now() - interval '7 days')
           or (u.email_confirmed_at is not null and u.email_confirmed_at < pg_catalog.now() - interval '30 days')
         )
         for update of u skip locked;

      if was_confirmed is null then
        continue;
      end if;

      -- The re-check, a new statement and so a new snapshot: a `members` row
      -- committed after the lookup above is seen here.
      if exists (select 1 from public.members as m where m.auth_user_id = candidate)
         or exists (select 1 from public.organizations as o where o.founded_by = candidate) then
        continue;
      end if;

      delete from auth.users as u
       where u.id = candidate
         and not exists (select 1 from public.members as m where m.auth_user_id = u.id);

      if found then
        if was_confirmed then
          confirmed_deleted := confirmed_deleted + 1;
        else
          unconfirmed_deleted := unconfirmed_deleted + 1;
        end if;
      end if;
    exception
      when others then
        failed := failed + 1;
        raise warning 'HOUSEKEEPING_SKIPPED % %', candidate, sqlstate;
    end;
  end loop;

  delete from private.organization_attempts as a
   where a.attempted_at < pg_catalog.now() - interval '30 days';
  get diagnostics attempts_deleted = row_count;

  answer := pg_catalog.jsonb_build_object(
    'unconfirmed_accounts', unconfirmed_deleted,
    'confirmed_accounts', confirmed_deleted,
    'organization_attempts', attempts_deleted,
    'failed', failed
  );

  -- pg_cron's `job_run_details` keeps the statement's status, not its value:
  -- the counts go to the server log, which the operator reads.
  raise log 'HOUSEKEEPING %', answer::text;

  return answer;
end;
$$;

revoke execute on function private.delete_abandoned_accounts() from public;
revoke execute on function private.delete_abandoned_accounts() from anon;
revoke execute on function private.delete_abandoned_accounts() from authenticated;
revoke execute on function private.delete_abandoned_accounts() from service_role;

-- Daily at 03:15 UTC (pg_cron's zone), clear of the nightly backup
-- (AD-25). `cron.schedule` with a name replaces a job of that name, so
-- re-running this statement leaves one job.
select cron.schedule('housekeeping', '15 3 * * *', 'select private.delete_abandoned_accounts()');
