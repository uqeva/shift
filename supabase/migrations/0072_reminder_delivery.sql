-- 0072_reminder_delivery.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- NUMBERING. 0071 is story 19.3's; this story takes 0072 (story 19.5 runs in
-- parallel with 0073).
--
-- Story 17.3: reminders reach the member by push or email (AD-18 as amended
-- by 17.3; D5; 17.2's deferred "late reminder").
--
-- `notify` renders `SHIFT_REMINDER` from this story on, and a reminder says
-- when the shift is ("Za 2 h radiš: …"). One written by `remind` but held by a
-- `notify` backlog or a retry must not go out long after it fell due: 0070's
-- claim expires a reminder only once its shift has started, so an `H12` row
-- could still be sent hours late.
--
-- WHAT THIS FILE DOES:
--
--   (i)   `private.reminder_late(operands, created_at)`, no session role may
--         call it: a reminder is late once it is 15 minutes past its due
--         instant, which for an `H<n>` lead is `startsAt − n hours` (real
--         hours, AD-6: a subtraction, no zone), or, for any lead (the evening
--         before's due instant needs the zone, so it has only this), once it
--         was written (`created_at`) 20 minutes ago. `remind` writes a row at
--         most 5 minutes before it is due, so a row retried once (10 minutes)
--         still goes. An unreadable `startsAt` is not "late": 0070's expiry
--         settles it first.
--   (ii)  0070's claim with ONE settle more and its guard: a pending
--         `SHIFT_REMINDER` row that is late is settled `REMINDER_LATE` and
--         never returned. Every other clause, the signature, the return type
--         and the grants are 0070's. The push's TTL (`notify`: never past the
--         start, never past due + 15 minutes, at most 15 minutes) bounds an
--         offline device on the same terms, so an `H<n>` reminder reaches a
--         device no later than 15 minutes past its due instant, and an
--         evening-before one at most about 35 minutes after it was written.
--
-- NO TABLE, NO COLUMN, NO VAULT VALUE. Arming the `remind` job is DEPLOY.md
-- §3b's, an operator's Vault write; no migration writes a secret.

-- (i) Whether a reminder row waited too long to be sent.
create function private.reminder_late(p_operands jsonb, p_created_at timestamptz)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  starts_at timestamptz := private.reminder_starts_at(p_operands);
  hours text := p_operands ->> 'leadHours';
begin
  if p_created_at is not null and p_created_at <= now() - interval '20 minutes' then
    return true;
  end if;
  if starts_at is not null
     and (p_operands ->> 'lead') ~ '^H(1|2|3|6|12)$'
     and hours is not null
     and hours = pg_catalog.substr(p_operands ->> 'lead', 2) then
    return now() >= starts_at - pg_catalog.make_interval(hours => hours::integer) + interval '15 minutes';
  end if;
  return false;
end;
$$;

revoke execute on function private.reminder_late(jsonb, timestamptz) from public, anon, authenticated, service_role;

-- (ii) 0070's claim, with the late settle. Same signature and return type, so
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
