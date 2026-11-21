-- 0070_shift_reminders.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 17.2: the `remind` job writes reminders that fall due (CAP-26, FR-85;
-- D5, Q25; AD-14, AD-17 and AD-18 as amended by Architect pass 1 and 17.2).
--
-- A reminder is the one notification no request asserts. The `remind` Edge
-- Function reads every member who asked (`reminder_inputs`), projects R12 and
-- the due instants in `@shift/domain` (no zone arithmetic here), and writes
-- what falls due through `enqueue_shift_reminders`, which re-checks the state
-- at write time and writes through `private.notify_members`, as every other
-- event does. `notify` delivers it (17.3); this file only queues and settles.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)    Two helpers no session role may call: `private.reminder_lead_on`
--          (the member still has the lead on) and `private.reminder_starts_at`
--          (a row's `startsAt` operand, or null when it is unreadable).
--   (ii)   `public.reminder_inputs()`, `service_role` only: the database's
--          `now` (epoch ms) and, per member with at least one lead on who is
--          active in their organization's today, `{ memberId, leads, window,
--          inputs }`, the window today − 1 … today + 1 and AD-19's assembly
--          for it. It is `private.member_schedule_inputs`' gate: the assembly
--          answers for any member id, so only this caller may reach it.
--   (iii)  `public.enqueue_shift_reminders(p_items)`, `service_role` only. A
--          malformed batch raises 22023 `REMINDER_ITEMS_INVALID` and writes
--          nothing. A well-formed item is SKIPPED when its member is unknown
--          or not active today, the lead is no longer on, the shift has
--          started or is more than two days off, or the team or shift type is
--          not the member's organization's. The names are looked up here,
--          never taken from the item. Subject
--          `md5('SHIFT_REMINDER:'||member||':'||date||':'||team||':'||lead)`,
--          so 0042's unique key holds each reminder to one row per channel
--          however runs overlap (Q25). Answers the accepted count: the items
--          that passed the write-time re-check, not the rows inserted (an
--          domain's window is four runs wide, so about four consecutive runs
--          send each item: the later ones are accepted and insert nothing).
--   (iv)   The outbox filter, 0044's with one clause more: a `SHIFT_REMINDER`
--          email row is dropped while `private.reminder_email_on(recipient)`
--          (0069's one predicate) is false.
--   (v)    The claim, 0046's with three settles more for a pending
--          `SHIFT_REMINDER` row: `REMINDER_EXPIRED` once `now() >= startsAt`
--          (an unreadable `startsAt` counts as expired), `REMINDER_TURNED_OFF`
--          when the lead is gone, and on email `EMAIL_TURNED_OFF` when the
--          predicate is false; and it never returns such a row. Every earlier
--          clause is kept, grants restated.
--   (vi)   `private.invoke_remind()`, 0042's `invoke_notify` with Vault's
--          `remind_url` and `remind_invoke_secret`, and the `remind` cron job
--          every five minutes. NO MIGRATION WRITES A VAULT SECRET: until 17.3
--          stores both (after a `notify` that renders `SHIFT_REMINDER` is
--          live), the job runs and sends nothing.
--
-- NOT SUSPENSION-AWARE YET. `private.organization_live` does not exist before
-- the suspension story (0067's note), which re-creates these RPCs over it.
--
-- NO TABLE GRANT. Both RPCs are definers owned by the migration role; the
-- reminder table keeps `authenticated`'s own-row policies alone.

-- ---------------------------------------------------------------- (i) helpers

-- The member still has `p_lead` on. INVOKER: its callers are definers.
create function private.reminder_lead_on(p_organization uuid, p_member uuid, p_lead text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.reminder_settings r
     where r.organization_id = p_organization
       and r.member_id = p_member
       and p_lead = any(r.leads)
  );
$$;

revoke execute on function private.reminder_lead_on(uuid, uuid, text) from public, anon, authenticated, service_role;

-- A reminder row's `startsAt`, written by (iii) as `YYYY-MM-DDTHH:MM:SSZ`.
-- Anything else, or a value that does not cast, is null: the claim treats it
-- as expired rather than raising for the whole batch.
create function private.reminder_starts_at(p_operands jsonb)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  raw text := p_operands ->> 'startsAt';
begin
  if raw is null or raw !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then
    return null;
  end if;
  return raw::timestamptz;
exception
  when others then
    return null;
end;
$$;

revoke execute on function private.reminder_starts_at(jsonb) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------ (ii) the read

create function public.reminder_inputs()
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
     and public.member_active_on(due.member_id, due.today);

  return pg_catalog.jsonb_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'members', answer
  );
end;
$$;

revoke execute on function public.reminder_inputs() from public, anon, authenticated;
grant execute on function public.reminder_inputs() to service_role;

-- ----------------------------------------------------------- (iii) the write

create function public.enqueue_shift_reminders(p_items jsonb)
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

-- ------------------------------------------------------ (iv) the outbox filter

-- 0044's filter, with the reminder email switch. Same signature, so
-- `create or replace` keeps the trigger.
create or replace function private.filter_notification_outbox() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'email' then
    if exists (
      select 1
        from public.organizations o
       where o.id = new.organization_id
         and not o.email_notifications
    ) then
      return null;
    end if;

    if exists (
      select 1
        from public.notification_settings s
       where s.organization_id = new.organization_id
         and s.member_id = new.recipient_member_id
         and not s.email
    ) then
      return null;
    end if;

    -- 0070: a reminder email needs its own switch (D-S6), 0069's predicate.
    if new.code = 'SHIFT_REMINDER' and not private.reminder_email_on(new.recipient_member_id) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.filter_notification_outbox() from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- (v) the claim

-- 0046's claim, with the reminder settles. Same signature and return type, so
-- `create or replace`; the grants are restated below.
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
          -- whose email switch is off.
          and public.member_active_on(c.recipient_member_id, public.organization_today(c.organization_id))
          and (
            c.code <> 'SHIFT_REMINDER'
            or (
              coalesce(now() < private.reminder_starts_at(c.operands), false)
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

-- ---------------------------------------------------------- (vi) the schedule

-- 0042's `invoke_notify`, for `remind`: reads the function URL and the invoke
-- secret from Vault, by name, and POSTs with the secret as a bearer token.
-- Answers the pg_net request id, or null, sending nothing, while either
-- secret is absent. The VALUES live in Vault, per environment, written by
-- 17.3's deploy step and never by a migration.
create function private.invoke_remind()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select s.decrypted_secret into target
    from vault.decrypted_secrets s
   where s.name = 'remind_url';
  select s.decrypted_secret into secret
    from vault.decrypted_secrets s
   where s.name = 'remind_invoke_secret';

  if target is null or btrim(target) = '' or secret is null or btrim(secret) = '' then
    return null;
  end if;

  return net.http_post(
    url := btrim(target),
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(secret)
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function private.invoke_remind() from public;
revoke execute on function private.invoke_remind() from anon;
revoke execute on function private.invoke_remind() from authenticated;
revoke execute on function private.invoke_remind() from service_role;

-- Every five minutes, as D5's window assumes. `cron.schedule` with a name
-- replaces a job of that name, so re-running this statement leaves one job.
select cron.schedule('remind', '*/5 * * * *', 'select private.invoke_remind()');
