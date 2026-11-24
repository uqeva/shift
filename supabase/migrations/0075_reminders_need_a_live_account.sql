-- 0075_reminders_need_a_live_account.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Founder decision 2026-11-23 (epic 17 retro A3 (b)): REVERSES story 17.2's
-- Design Note 9. A member whose auth account is banned or deleted gets NO
-- shift reminders, as their calendar feed is already not served (16.3's
-- `private.calendar_feed_member_live`, 0067 as re-created by 0073). Before,
-- the reminder job followed `notify_members`' one rule (active today, an
-- address, a device) and a banned account whose member was still active was
-- reminded of its own shifts.
--
-- THE ACCOUNT CHECK, word for word the feed's: the member's `auth.users` row
-- exists, `deleted_at is null`, and `banned_until` is null or already passed
-- (a lapsed ban is no ban, `current_member_access()`'s own clause). An
-- account removed outright (no row) fails it too: the `exists` finds nothing.
--
-- Its two callers, each re-created from 0073's definition with the check
-- added and nothing else changed (the scaffold diffs each one word for word):
--   * `reminder_inputs` reads no member whose account is not live, so
--     `remind` builds no reminder for them;
--   * `enqueue_shift_reminders` re-checks it at write time and skips such an
--     item, as it skips every other item the state no longer admits.
-- Inlined, not a new predicate: no function is added, so the provisioning
-- inventories are unchanged, and the grants of both are re-stated as 0073
-- left them.
--
-- NOT CHANGED: every other notification (a change, a decision, a loan) still
-- follows `notify_members`' rule, as before; and a reminder row already
-- queued when the ban lands is sent or settled by the claim as before, which
-- bounds it (0072: 15 minutes past an hours lead's due instant, or 20 minutes
-- after it was written). The decision is about reminders.
--
-- DEPLOY ORDER: `db push` alone. No SPA or Edge Function change: `remind`
-- reads whatever members `reminder_inputs` answers.

-- 0073's read for `remind`, with the account check.
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
         -- 0075 (founder decision 2026-11-23): only a live account, as the feed's.
         and exists (
           select 1
             from auth.users u
            where u.id = m.auth_user_id
              and u.deleted_at is null
              and (u.banned_until is null or u.banned_until <= now())
         )
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

-- 0073's write for `remind`, with the account check in the re-check.
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
       -- 0075 (founder decision 2026-11-23): and a banned or deleted account's.
       or not exists (
         select 1
           from public.members m
           join auth.users u on u.id = m.auth_user_id
          where m.id = v_member
            and u.deleted_at is null
            and (u.banned_until is null or u.banned_until <= now())
       )
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
