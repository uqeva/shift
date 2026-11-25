import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { REMINDER_LEAD_HOURS } from '../packages/domain/src/index.ts';

import { REMIND_RAN, createHandler, readConfiguration } from '../supabase/functions/remind/handler.ts';
import { FIXTURES, inRolledBackTransaction, noDatabase, refused, type Refusal } from './database.ts';

/**
 * Story 17.2 (0070): the `remind` job's read and write, the outbox filter's
 * reminder email switch and the claim's three reminder settles (AD-14,
 * AD-18; D5, Q25). A database suite, run in CI on its fresh stack (written
 * unrun: the shared local stack never has a migration applied by a story).
 *
 * Every case runs in ONE rolled-back transaction. Every scene is built as
 * the owner before the case's first switch of role, or after an explicit
 * `actAsOwner`; `remind`'s calls are made as `service_role`, the only role
 * granted them. `now()` is the transaction's start throughout, so an instant
 * written as `now() + …` is still ahead of the RPC's own `now()`.
 */

/** 0070's shape refusal, as `enqueue_shift_reminders` raises it. */
const ITEMS_INVALID = { code: '22023', message: 'REMINDER_ITEMS_INVALID' } as const;

/** A device row the table's checks accept (0045), as `test/reminder-settings.test.ts`'s. */
const P256DH = `B${'k'.repeat(86)}`;
const AUTH = 'a'.repeat(22);

interface Member {
  readonly id: string;
  readonly authUserId: string;
  readonly organizationId: string;
}

interface Item {
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly lead: string;
  readonly start: number;
  readonly end: number;
  readonly startsAt: string;
}

async function member(client: Client, slug: string, username: string): Promise<Member> {
  const { rows } = await client.query<Member>(
    `select m.id, m.auth_user_id as "authUserId", m.organization_id as "organizationId"
       from members m join organizations o on o.id = m.organization_id
      where o.slug = $1 and m.username = $2`,
    [slug, username],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`no member ${username} in ${slug}`);
  return found;
}

async function actAsService(client: Client): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ role: 'service_role' })]);
  await client.query('set local role service_role');
}

async function actAs(client: Client, who: Member): Promise<void> {
  const claims = { sub: who.authUserId, role: 'authenticated', organization_id: who.organizationId };
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims)]);
  await client.query('set local role authenticated');
}

async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', '', true)");
}

/** `refused`, for a case that goes on afterwards: a savepoint keeps the transaction usable. */
async function refusedThenContinue(client: Client, work: () => Promise<unknown>): Promise<Refusal> {
  await client.query('savepoint refusal_probe');
  try {
    return await refused(work);
  } finally {
    await client.query('rollback to savepoint refusal_probe').catch(() => undefined);
  }
}

/**
 * Owner scene: `who` can be reminded on both channels, with `leads` on and the
 * reminder email switch as given: an address, a device, no own email switch
 * off, the organization's switch on.
 */
async function remindable(client: Client, who: Member, leads: readonly string[], email: boolean): Promise<void> {
  await client.query('delete from push_subscriptions where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
  await client.query('delete from notification_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
  await client.query("update members set email = 'reminder-job@example.invalid' where id = $1", [who.id]);
  await client.query('update organizations set email_notifications = true where id = $1', [who.organizationId]);
  await client.query(
    `insert into push_subscriptions (organization_id, member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)`,
    [who.organizationId, who.id, `https://fcm.googleapis.com/fcm/send/reminder-job-${who.id}`, P256DH, AUTH],
  );
  await client.query(
    `insert into reminder_settings (organization_id, member_id, leads, email) values ($1, $2, $3::text[], $4)
     on conflict (organization_id, member_id) do update set leads = excluded.leads, email = excluded.email`,
    [who.organizationId, who.id, leads, email],
  );
}

/** Owner scene: a team and a working shift type of the organization, with their names. */
async function teamAndType(client: Client, organization: string): Promise<{ teamId: string; teamName: string; shiftTypeId: string; shiftTypeName: string }> {
  const { rows } = await client.query<{ teamId: string; teamName: string; shiftTypeId: string; shiftTypeName: string }>(
    `select t.id as "teamId", t.name as "teamName", s.id as "shiftTypeId", s.name as "shiftTypeName"
       from teams t join shift_types s on s.organization_id = t.organization_id and s.is_working
      where t.organization_id = $1
      order by t.id, s.id
      limit 1`,
    [organization],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`organization ${organization} has no team or working shift type`);
  return found;
}

/** An instant `offset` (a Postgres interval) from the transaction's now, as the domain writes it. */
async function isoFromNow(client: Client, offset: string): Promise<string> {
  const { rows } = await client.query<{ iso: string }>(
    `select to_char((now() + $1::interval) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as iso`,
    [offset],
  );
  return rows[0]?.iso ?? '';
}

async function todayOf(client: Client, organization: string, plusDays = 0): Promise<string> {
  const { rows } = await client.query<{ date: string }>(`select to_char(organization_today($1) + $2::int, 'YYYY-MM-DD') as date`, [
    organization,
    plusDays,
  ]);
  return rows[0]?.date ?? '';
}

/** The write, by its argument's name as PostgREST calls it; answers the items that passed the re-check, not rows inserted. */
async function enqueue(client: Client, items: unknown): Promise<number> {
  const { rows } = await client.query<{ accepted: number }>('select public.enqueue_shift_reminders(p_items => $1::jsonb) as accepted', [
    JSON.stringify(items),
  ]);
  return rows[0]?.accepted ?? -1;
}

interface OutboxRow {
  readonly id: string;
  readonly channel: string;
  readonly subject: string;
  readonly operands: Record<string, unknown>;
  readonly failure: string | null;
}

async function remindersOf(client: Client, who: Member): Promise<OutboxRow[]> {
  const { rows } = await client.query<OutboxRow>(
    `select id::text, channel, subject_id::text as subject, operands, failure_code as failure
       from notification_outbox
      where code = 'SHIFT_REMINDER' and recipient_member_id = $1
      order by operands ->> 'lead', channel`,
    [who.id],
  );
  return rows;
}

describe.each(FIXTURES)('the $fixture reminder job (0070)', ({ slug, admin, member: memberName, bystander }) => {
  it.skipIf(noDatabase)('lets service_role alone call the read and the write', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await actAs(client, who);
      for (const statement of ['select public.reminder_inputs()', "select public.enqueue_shift_reminders('[]'::jsonb)"]) {
        expect(await refusedThenContinue(client, () => client.query(statement)), statement).toMatchObject({ code: '42501' });
      }
      await actAsOwner(client);
      await actAsService(client);
      const { rows } = await client.query<{ accepted: number }>("select public.enqueue_shift_reminders('[]'::jsonb) as accepted");
      expect(rows).toEqual([{ accepted: 0 }]);
    });
  });

  it.skipIf(noDatabase)('reads the database clock and, per member with a lead on who is active today, the window and the assembly', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const peer = await member(client, slug, bystander);
      const boss = await member(client, slug, admin);
      // Owner scene: who has two leads on; the admin none; the bystander one, deactivated below.
      await remindable(client, who, ['H1', 'EVENING_BEFORE'], false);
      await remindable(client, boss, [], false);
      await remindable(client, peer, ['H2'], false);
      const { rows: clock } = await client.query<{ now: string }>('select (extract(epoch from now()) * 1000)::bigint::text as now');
      const yesterday = await todayOf(client, who.organizationId, -1);
      const tomorrow = await todayOf(client, who.organizationId, 1);
      await actAsService(client);
      const { rows: before } = await client.query<{ answer: { now: number; members: { memberId: string; leads: string[]; window: unknown; inputs: Record<string, unknown> }[] } }>(
        'select public.reminder_inputs() as answer',
      );
      const answer = before[0]?.answer;
      expect(String(answer?.now)).toBe(clock[0]?.now);
      const mine = answer?.members.find((row) => row.memberId === who.id);
      expect(mine?.leads).toEqual(['H1', 'EVENING_BEFORE']);
      expect(mine?.window).toEqual({ from: yesterday, to: tomorrow });
      expect(mine?.inputs['memberId']).toBe(who.id);
      expect(mine?.inputs['organizationId']).toBe(who.organizationId);
      expect(answer?.members.some((row) => row.memberId === boss.id), 'a member with no lead on is read').toBe(false);
      expect(answer?.members.some((row) => row.memberId === peer.id)).toBe(true);

      // Owner scene: the bystander deactivated from today, as the admin's write (`created_by`).
      await actAsOwner(client);
      await client.query(
        `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
         values ($1, $2, false, organization_today($1), $3)`,
        [peer.organizationId, peer.id, boss.authUserId],
      );
      await actAsService(client);
      const { rows: after } = await client.query<{ answer: { members: { memberId: string }[] } }>('select public.reminder_inputs() as answer');
      expect(after[0]?.answer.members.some((row) => row.memberId === peer.id), 'an inactive member is read').toBe(false);
      expect(after[0]?.answer.members.some((row) => row.memberId === who.id)).toBe(true);
    });
  });

  it.skipIf(noDatabase)('writes one row per channel per reminder however often it runs, with the names looked up and the key in SQL', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await remindable(client, who, ['H1', 'EVENING_BEFORE'], true);
      const { teamId, teamName, shiftTypeId, shiftTypeName } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const startsAt = await isoFromNow(client, '1 day');
      const base = { memberId: who.id, date, teamId, shiftTypeId, start: 420, end: 1140, startsAt };
      const items: Item[] = [
        { ...base, lead: 'H1' },
        { ...base, lead: 'EVENING_BEFORE' },
      ];
      await actAsService(client);
      expect(await enqueue(client, items)).toBe(2);
      expect(await enqueue(client, items), 'a rerun is accepted again; the unique key keeps the rows at four').toBe(2);
      await actAsOwner(client);

      const rows = await remindersOf(client, who);
      expect(rows.map((row) => `${String(row.operands['lead'])} ${row.channel}`)).toEqual([
        'EVENING_BEFORE email',
        'EVENING_BEFORE push',
        'H1 email',
        'H1 push',
      ]);
      const { rows: keys } = await client.query<{ lead: string; subject: string }>(
        `select lead, md5('SHIFT_REMINDER:' || $1 || ':' || $2 || ':' || $3 || ':' || lead)::uuid::text as subject
           from unnest(array['H1', 'EVENING_BEFORE']) as lead`,
        [who.id, date, teamId],
      );
      for (const row of rows) {
        expect(row.subject).toBe(keys.find((key) => key.lead === row.operands['lead'])?.subject);
      }
      const h1 = rows.find((row) => row.operands['lead'] === 'H1');
      expect(h1?.operands).toEqual({
        date,
        teamId,
        start: 420,
        end: 1140,
        startsAt,
        lead: 'H1',
        leadHours: REMINDER_LEAD_HOURS.H1,
        shiftTypeName,
        teamName,
      });
      const evening = rows.find((row) => row.operands['lead'] === 'EVENING_BEFORE');
      expect(evening?.operands, 'the evening lead counts no hours').not.toHaveProperty('leadHours');
    });
  });

  it.skipIf(noDatabase)('derives leadHours as the domain does, for every hours lead', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const startsAt = await isoFromNow(client, '1 day');
      for (const [lead, hours] of Object.entries(REMINDER_LEAD_HOURS)) {
        await actAsOwner(client);
        await remindable(client, who, [lead], false);
        await actAsService(client);
        expect(await enqueue(client, [{ memberId: who.id, date, teamId, shiftTypeId, lead, start: 420, end: 1140, startsAt }])).toBe(1);
        await actAsOwner(client);
        const row = (await remindersOf(client, who)).find((one) => one.operands['lead'] === lead);
        expect(row?.operands['leadHours'], lead).toBe(hours);
      }
    });
  });

  it.skipIf(noDatabase)('skips, and does not raise for, an item the state no longer admits', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const peer = await member(client, slug, bystander);
      const boss = await member(client, slug, admin);
      const other = FIXTURES.find((fixture) => fixture.slug !== slug);
      if (other === undefined) throw new Error('one fixture only');
      const foreign = await member(client, other.slug, other.member);
      await remindable(client, who, ['H1'], true);
      await remindable(client, peer, ['H1'], true);
      // Owner scene: the bystander deactivated from today, as the admin's write.
      await client.query(
        `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
         values ($1, $2, false, organization_today($1), $3)`,
        [peer.organizationId, peer.id, boss.authUserId],
      );
      const own = await teamAndType(client, who.organizationId);
      const theirs = await teamAndType(client, foreign.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const item: Item = {
        memberId: who.id,
        date,
        teamId: own.teamId,
        shiftTypeId: own.shiftTypeId,
        lead: 'H1',
        start: 420,
        end: 1140,
        startsAt: await isoFromNow(client, '1 day'),
      };
      const skipped: readonly (readonly [string, Item])[] = [
        ['a lead no longer on', { ...item, lead: 'H3' }],
        ['a shift that has started', { ...item, startsAt: await isoFromNow(client, '-1 minute') }],
        // The whole-second shape truncates now(), so this lands at or before
        // `now()`: the `<=` boundary itself is not pinned (accepted).
        ['a shift starting now', { ...item, startsAt: await isoFromNow(client, '0 seconds') }],
        ['a shift more than two days off', { ...item, startsAt: await isoFromNow(client, '2 days 1 minute') }],
        ['another organization’s team', { ...item, teamId: theirs.teamId }],
        ['another organization’s shift type', { ...item, shiftTypeId: theirs.shiftTypeId }],
        ['an unknown member', { ...item, memberId: '00000000-0000-4000-8000-000000000017' }],
        ['a member inactive today', { ...item, memberId: peer.id }],
      ];
      await actAsService(client);
      for (const [why, one] of skipped) expect(await enqueue(client, [one]), why).toBe(0);
      await actAsOwner(client);
      expect(await remindersOf(client, who)).toEqual([]);
      expect(await remindersOf(client, peer)).toEqual([]);
    });
  });

  // 0075 (founder decision 2026-11-23, epic 17 retro A3 (b)): reverses 17.2's
  // Design Note 9. The account check is the feed's (0067/0073).
  it.skipIf(noDatabase)('reads and writes nothing for a member whose account is banned or deleted, and a lapsed ban is no ban (0075)', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await remindable(client, who, ['H1'], true);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const item: Item = { memberId: who.id, date, teamId, shiftTypeId, lead: 'H1', start: 420, end: 1140, startsAt: await isoFromNow(client, '1 day') };
      const read = async (): Promise<boolean> => {
        const { rows } = await client.query<{ answer: { members: { memberId: string }[] } }>('select public.reminder_inputs() as answer');
        return rows[0]?.answer.members.some((row) => row.memberId === who.id) ?? false;
      };

      for (const [column, value] of [
        ['banned_until', "now() + interval '1 day'"],
        ['deleted_at', 'now()'],
      ] as const) {
        // Owner scene: the account banned (or deleted), before the switch of role.
        await actAsOwner(client);
        await client.query(`update auth.users set ${column} = ${value} where id = $1`, [who.authUserId]);
        await actAsService(client);
        expect(await read(), `a ${column} account is read`).toBe(false);
        expect(await enqueue(client, [item]), `a ${column} account's item is written`).toBe(0);
        await actAsOwner(client);
        expect(await remindersOf(client, who), `a ${column} account has a reminder`).toEqual([]);
        // Owner scene: restored.
        await client.query(`update auth.users set ${column} = null where id = $1`, [who.authUserId]);
      }

      // Owner scene: a ban that has passed, as `current_member_access()` reads it.
      await client.query("update auth.users set banned_until = now() - interval '1 day' where id = $1", [who.authUserId]);
      await actAsService(client);
      expect(await read(), 'a lapsed ban is no ban: the member is read').toBe(true);
      expect(await enqueue(client, [item]), 'a lapsed ban is no ban: the item is written').toBe(1);
      await actAsOwner(client);
      expect((await remindersOf(client, who)).map((row) => row.channel)).toEqual(['email', 'push']);
    });
  });

  it.skipIf(noDatabase)('drops a reminder email while the reminder email switch is off, and keeps the push', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await remindable(client, who, ['H2'], false);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const startsAt = await isoFromNow(client, '1 day');
      await actAsService(client);
      expect(await enqueue(client, [{ memberId: who.id, date, teamId, shiftTypeId, lead: 'H2', start: 420, end: 1140, startsAt }])).toBe(1);
      await actAsOwner(client);
      expect((await remindersOf(client, who)).map((row) => row.channel)).toEqual(['push']);
    });
  });
});

describe('the reminder write refuses a malformed batch whole (0070)', () => {
  it.skipIf(noDatabase)('raises 22023 REMINDER_ITEMS_INVALID for each shape breach, and refuses the whole batch for one bad item', async () => {
    await inRolledBackTransaction(async (client) => {
      const [pilot] = FIXTURES;
      const who = await member(client, pilot.slug, pilot.member);
      await remindable(client, who, ['H1'], true);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const good: Item = { memberId: who.id, date, teamId, shiftTypeId, lead: 'H1', start: 420, end: 1140, startsAt: await isoFromNow(client, '1 day') };
      const withoutMember = Object.fromEntries(Object.entries(good).filter(([key]) => key !== 'memberId'));
      const breaches: readonly (readonly [string, unknown])[] = [
        ['null', null],
        ['an object, not an array', good],
        ['an item that is no object', [1]],
        ['an empty item', [{}]],
        ['a missing key', [withoutMember]],
        ['an extra key', [{ ...good, teamName: 'X' }]],
        ['a lead outside the set', [{ ...good, lead: 'H4' }]],
        ['a lead of another case', [{ ...good, lead: 'h1' }]],
        ['a fractional start', [{ ...good, start: 420.5 }]],
        ['a start as text', [{ ...good, start: '420' }]],
        ['an end before the start', [{ ...good, end: 420 }]],
        ['an end past the next date', [{ ...good, end: 2880 }]],
        ['a date that is no date', [{ ...good, date: '2026-02-30' }]],
        ['a startsAt with an offset', [{ ...good, startsAt: good.startsAt.replace('Z', '+00:00') }]],
        ['a member id that is no uuid', [{ ...good, memberId: 'pilot-m2' }]],
        ['a good item then a bad one', [good, { ...good, lead: 'NOW' }]],
      ];
      await actAsService(client);
      for (const [why, items] of breaches) {
        expect(await refusedThenContinue(client, () => enqueue(client, items)), why).toMatchObject(ITEMS_INVALID);
      }
      // That nothing of a refused batch is kept is Postgres's statement
      // atomicity (any way of catching the raise is a subtransaction too), so
      // it is not asserted here. What is: the mixed batch's refusal was the
      // bad item's, since the good item alone is accepted.
      expect(await enqueue(client, [good]), 'the good item alone is not the refusal').toBe(1);
    });
  });
});

describe('the claim settles a reminder that can no longer be sent (0070)', () => {
  it.skipIf(noDatabase)('settles REMINDER_EXPIRED, REMINDER_TURNED_OFF and EMAIL_TURNED_OFF, and returns only the live one', async () => {
    await inRolledBackTransaction(async (client) => {
      const [pilot] = FIXTURES;
      const who = await member(client, pilot.slug, pilot.member);
      await remindable(client, who, ['H1', 'H2'], true);
      const { teamId } = await teamAndType(client, who.organizationId);
      const ahead = await isoFromNow(client, '1 hour');
      const past = await isoFromNow(client, '-1 minute');
      // Owner scene: five queued reminder rows, as the write would leave them.
      const queue = async (subject: string, channel: string, lead: string, startsAt: unknown): Promise<string> => {
        const { rows } = await client.query<{ id: string }>(
          `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
           values ($1, 'SHIFT_REMINDER', md5($2)::uuid, $3, $4, $5::jsonb) returning id::text`,
          [who.organizationId, subject, who.id, channel, JSON.stringify({ date: '2026-01-01', teamId, start: 420, end: 1140, startsAt, lead })],
        );
        return rows[0]?.id ?? '';
      };
      const live = await queue('live', 'push', 'H1', ahead);
      const expired = await queue('expired', 'push', 'H1', past);
      const unreadable = await queue('unreadable', 'push', 'H1', 'tomorrow');
      const turnedOff = await queue('turned-off', 'push', 'H2', ahead);
      const emailOff = await queue('email-off', 'email', 'H1', ahead);
      // Every OTHER pending row of the transaction out of the claim's way, so
      // a fixture's backlog cannot push these past `claim_notifications(100)`.
      await client.query(
        `update notification_outbox set failed_at = now(), failure_code = 'HIDDEN_BY_TEST'
          where sent_at is null and failed_at is null and id <> all($1::uuid[])`,
        [[live, expired, unreadable, turnedOff, emailOff]],
      );
      // After they were queued: H2 off, the reminder email switch off.
      await client.query(`update reminder_settings set leads = array['H1'], email = false where member_id = $1`, [who.id]);

      await actAsService(client);
      const { rows: claimed } = await client.query<{ id: string }>('select id::text from public.claim_notifications(100)');
      await actAsOwner(client);

      const ids = claimed.map((row) => row.id);
      expect(ids).toContain(live);
      for (const id of [expired, unreadable, turnedOff, emailOff]) expect(ids, id).not.toContain(id);
      const { rows: settled } = await client.query<{ id: string; failure: string | null }>(
        `select id::text, failure_code as failure
           from notification_outbox where id = any($1::uuid[])`,
        [[expired, unreadable, turnedOff, emailOff, live]],
      );
      const failureOf = (id: string): string | null | undefined => settled.find((row) => row.id === id)?.failure;
      expect(failureOf(expired)).toBe('REMINDER_EXPIRED');
      expect(failureOf(unreadable)).toBe('REMINDER_EXPIRED');
      expect(failureOf(turnedOff)).toBe('REMINDER_TURNED_OFF');
      expect(failureOf(emailOff)).toBe('EMAIL_TURNED_OFF');
      expect(failureOf(live)).toBeNull();
    });
  });
});

describe('the claim never sends a reminder that waited too long (0072, story 17.3)', () => {
  it.skipIf(noDatabase)('settles REMINDER_LATE one written 20 minutes ago or 15 minutes past its due instant, claims one written 19 minutes ago, and leaves the expiry and other codes alone', async () => {
    await inRolledBackTransaction(async (client) => {
      const [pilot] = FIXTURES;
      const who = await member(client, pilot.slug, pilot.member);
      await remindable(client, who, ['H1'], true);
      const { teamId } = await teamAndType(client, who.organizationId);
      const ahead = await isoFromNow(client, '3 hours');
      // Owner scene: two queued push reminders, written `age` before the transaction's now.
      const queue = async (subject: string, age: string): Promise<string> => {
        const { rows } = await client.query<{ id: string }>(
          `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands, created_at)
           values ($1, 'SHIFT_REMINDER', md5($2)::uuid, $3, 'push', $4::jsonb, now() - $5::interval) returning id::text`,
          [who.organizationId, subject, who.id, JSON.stringify({ date: '2026-01-01', teamId, start: 420, end: 1140, startsAt: ahead, lead: 'H1' }), age],
        );
        return rows[0]?.id ?? '';
      };
      const late = await queue('late', '20 minutes');
      const fresh = await queue('fresh', '19 minutes');
      // An hours lead 16 minutes past its due instant (H1, starting in 44 minutes), written just now: late.
      const pastDue = await isoFromNow(client, '44 minutes');
      const { rows: duePast } = await client.query<{ id: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
         values ($1, 'SHIFT_REMINDER', md5('past-due')::uuid, $2, 'push', $3::jsonb) returning id::text`,
        [who.organizationId, who.id, JSON.stringify({ date: '2026-01-01', teamId, start: 420, end: 1140, startsAt: pastDue, lead: 'H1', leadHours: 1 })],
      );
      const overdue = duePast[0]?.id ?? '';
      // Late AND already started: the expiry settle runs first and names it.
      const { rows: startedRows } = await client.query<{ id: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands, created_at)
         values ($1, 'SHIFT_REMINDER', md5('late-started')::uuid, $2, 'push', $3::jsonb, now() - interval '1 hour') returning id::text`,
        [who.organizationId, who.id, JSON.stringify({ date: '2026-01-01', teamId, start: 420, end: 1140, startsAt: await isoFromNow(client, '-1 minute'), lead: 'H1' })],
      );
      const started = startedRows[0]?.id ?? '';
      // Another code, written long ago: untouched by the reminder bound.
      const { rows: otherRows } = await client.query<{ id: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands, created_at)
         values ($1, 'LOAN_MADE', md5('old-loan')::uuid, $2, 'push', $3::jsonb, now() - interval '2 hours') returning id::text`,
        [who.organizationId, who.id, JSON.stringify({ startDate: '2026-01-01', endDate: '2026-01-02', teamName: 'T' })],
      );
      const other = otherRows[0]?.id ?? '';
      await client.query(
        `update notification_outbox set failed_at = now(), failure_code = 'HIDDEN_BY_TEST'
          where sent_at is null and failed_at is null and id <> all($1::uuid[])`,
        [[late, fresh, overdue, started, other]],
      );

      await actAsService(client);
      const { rows: claimed } = await client.query<{ id: string }>('select id::text from public.claim_notifications(100)');
      await actAsOwner(client);

      const ids = claimed.map((row) => row.id);
      expect(ids).toContain(fresh);
      expect(ids).not.toContain(late);
      const { rows: settled } = await client.query<{ id: string; failure: string | null }>(
        'select id::text, failure_code as failure from notification_outbox where id = any($1::uuid[])',
        [[late, fresh]],
      );
      expect(settled.find((row) => row.id === late)?.failure).toBe('REMINDER_LATE');
      expect(settled.find((row) => row.id === fresh)?.failure).toBeNull();
      expect(ids).not.toContain(overdue);
      expect(ids).toContain(other);
      const { rows: more } = await client.query<{ id: string; failure: string | null }>(
        'select id::text, failure_code as failure from notification_outbox where id = any($1::uuid[])',
        [[overdue, started, other]],
      );
      expect(more.find((row) => row.id === overdue)?.failure).toBe('REMINDER_LATE');
      expect(more.find((row) => row.id === started)?.failure).toBe('REMINDER_EXPIRED');
      expect(more.find((row) => row.id === other)?.failure).toBeNull();
    });
  });
});

describe('a reminder reaches exactly the channels the member has (D-S6, story 17.3)', () => {
  it.skipIf(noDatabase)('writes push and email, push only, email only, or nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const [pilot] = FIXTURES;
      const who = await member(client, pilot.slug, pilot.member);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const startsAt = await isoFromNow(client, '1 hour');
      const cases: readonly { readonly device: boolean; readonly email: boolean; readonly expected: readonly string[] }[] = [
        { device: true, email: true, expected: ['email', 'push'] },
        { device: true, email: false, expected: ['push'] },
        { device: false, email: true, expected: ['email'] },
        { device: false, email: false, expected: [] },
      ];
      for (const [index, { device, email, expected }] of cases.entries()) {
        // Owner scene: the channels for this case, then one item on a date of its own.
        await actAsOwner(client);
        await remindable(client, who, ['H1'], email);
        if (!device) await client.query('delete from push_subscriptions where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
        const date = await todayOf(client, who.organizationId, 10 + index);
        await actAsService(client);
        // Accepted every time: "no channel" is a channel-level drop, never a skipped item.
        expect(
          await enqueue(client, [{ memberId: who.id, date, teamId, shiftTypeId, lead: 'H1', start: 420, end: 1140, startsAt }]),
          JSON.stringify({ device, email }),
        ).toBe(1);
        await actAsOwner(client);
        const rows = (await remindersOf(client, who)).filter((row) => row.operands['date'] === date);
        expect(rows.map((row) => row.channel).sort(), JSON.stringify({ device, email })).toEqual([...expected]);
      }
    });
  });
});

describe('the remind cron job (0070)', () => {
  it.skipIf(noDatabase)('runs every five minutes, and sends nothing while Vault holds no remind_url', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows: jobs } = await client.query<{ schedule: string; command: string; active: boolean }>(
        `select schedule, command, active from cron.job where jobname = 'remind'`,
      );
      expect(jobs).toEqual([{ schedule: '*/5 * * * *', command: 'select private.invoke_remind()', active: true }]);

      // Hidden for this transaction only, whatever the local Vault holds.
      await client.query(`delete from vault.secrets where name in ('remind_url', 'remind_invoke_secret')`);
      const { rows: before } = await client.query<{ total: number }>('select count(*)::int as total from net.http_request_queue');
      const { rows: answered } = await client.query<{ id: string | null }>('select private.invoke_remind()::text as id');
      const { rows: after } = await client.query<{ total: number }>('select count(*)::int as total from net.http_request_queue');
      expect(answered[0]?.id).toBeNull();
      expect(after[0]?.total).toBe(before[0]?.total);

      // With the URL alone, still nothing: both secrets are needed.
      await client.query(`select vault.create_secret('http://remind.invalid/functions/v1/remind', 'remind_url')`);
      const { rows: half } = await client.query<{ id: string | null }>('select private.invoke_remind()::text as id');
      expect(half[0]?.id).toBeNull();
    });
  });

  // The send branch, as `test/notify-boundary.test.ts`'s for `invoke_notify`:
  // with both secrets, one POST to `remind_url` with the invoke secret as its
  // bearer, which `remind`'s own check lets through. Rolled back, so pg_net's
  // worker never sees it.
  it.skipIf(noDatabase)('queues a POST to remind_url with Authorization: Bearer <remind_invoke_secret> once Vault holds both', async () => {
    await inRolledBackTransaction(async (client) => {
      const target = 'http://remind.invalid/functions/v1/remind';
      const secret = 'r'.repeat(48);
      await client.query(`delete from vault.secrets where name in ('remind_url', 'remind_invoke_secret')`);
      await client.query(`select vault.create_secret($1, 'remind_url')`, [target]);
      await client.query(`select vault.create_secret($1, 'remind_invoke_secret')`, [secret]);

      const { rows: queued } = await client.query<{ id: string | null }>('select private.invoke_remind()::text as id');
      const id = queued[0]?.id;
      expect(id, 'invoke_remind queued nothing').toBeTruthy();
      const { rows } = await client.query<{ url: string; method: string; headers: Record<string, string> }>(
        'select url, method::text as method, headers from net.http_request_queue where id = $1::bigint',
        [id],
      );
      const request = rows[0];
      expect(request).toMatchObject({ url: target, method: 'POST' });
      expect(request?.headers['Authorization']).toBe(`Bearer ${secret}`);

      // The same headers, as the request `remind` receives: past its check, to the read.
      const handle = createHandler(
        readConfiguration((name) =>
          ({ SUPABASE_URL: 'http://supabase-kong:8000', SHIFT_SECRET_KEY: `sb_secret_${'x'.repeat(12)}`, REMIND_INVOKE_SECRET: secret })[name],
        ),
        {
          fetch: () => Promise.resolve(new Response(JSON.stringify({ now: Date.now(), members: [] }), { status: 200 })),
          timeout: () => new AbortController().signal,
          log: () => undefined,
        },
      );
      const response = await handle(new Request(target, { method: 'POST', headers: request?.headers ?? {} }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ code: REMIND_RAN });
    });
  });
});

describe('the reminder read with nobody to remind (0070)', () => {
  // `remind` answers 503 to a read whose `members` is not an array, so the
  // read's empty answer must be `[]`, never null (the aggregate's coalesce).
  it.skipIf(noDatabase)('answers members [] when no member has a lead on', async () => {
    await inRolledBackTransaction(async (client) => {
      // Owner scene: every member's reminders off, for this transaction only.
      await client.query(`update reminder_settings set leads = '{}'::text[]`);
      await actAsService(client);
      const { rows } = await client.query<{ members: unknown }>(`select public.reminder_inputs() -> 'members' as members`);
      expect(rows).toEqual([{ members: [] }]);
    });
  });
});

// ------------------------------------------------ story 21.2: the ASSIGNMENT form

/**
 * STORY 21.2 (`0077`, AD-18 as amended 2026-11-25). An item of a Personal
 * Assignment's shift carries `source: 'ASSIGNMENT'` and its
 * `personalAssignmentId`, and its team may be null. It is written only while
 * that row is live, the member's, a `SHIFT`, and of that date and shift type;
 * its subject is keyed by the assignment; with no team the operands carry
 * neither `teamId` nor `teamName`. The team form is unchanged. Every scene is
 * built as the owner before the service role acts.
 */
describe.each(FIXTURES)('the $fixture reminder of a Personal Assignment (0077)', ({ slug, admin, member: memberName }) => {
  /** Owner scene: one live assignment of `who`, written as `by` would (the save's attribution). */
  async function assignmentOf(
    client: Client,
    who: Member,
    by: Member,
    row: { date: string; kind?: 'SHIFT' | 'OFF'; shiftTypeId: string | null; teamId: string | null },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into personal_assignments (organization_id, member_id, date, kind, shift_type_id, team_id, created_by)
       values ($1, $2, $3::date, $4, $5, $6, $7) returning id::text as id`,
      [who.organizationId, who.id, row.date, row.kind ?? 'SHIFT', row.shiftTypeId, row.teamId, by.authUserId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('the assignment insert returned no id');
    return id;
  }

  it.skipIf(noDatabase)('writes a teamless reminder with neither teamId nor teamName, keyed by the assignment, and a teamed one with both', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const by = await member(client, slug, admin);
      await remindable(client, who, ['H1', 'H2'], true);
      const { teamId, teamName, shiftTypeId, shiftTypeName } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const teamless = await assignmentOf(client, who, by, { date, shiftTypeId, teamId: null });
      const startsAt = await isoFromNow(client, '1 day');
      const base = { memberId: who.id, date, shiftTypeId, start: 420, end: 1140, startsAt };

      await actAsService(client);
      expect(await enqueue(client, [{ ...base, teamId: null, lead: 'H1', source: 'ASSIGNMENT', personalAssignmentId: teamless }])).toBe(1);
      await actAsOwner(client);

      const rows = await remindersOf(client, who);
      expect(rows.map((row) => row.channel)).toEqual(['email', 'push']);
      const { rows: keys } = await client.query<{ subject: string }>(
        `select md5('SHIFT_REMINDER:' || $1 || ':' || $2 || ':a:' || $3 || ':H1')::uuid::text as subject`,
        [who.id, date, teamless],
      );
      for (const row of rows) expect(row.subject).toBe(keys[0]?.subject);
      expect(rows[0]?.operands).toEqual({ date, start: 420, end: 1140, startsAt, lead: 'H1', leadHours: REMINDER_LEAD_HOURS.H1, shiftTypeName });

      // The same member's assignment counted with a team, on another date: both names, still keyed by the assignment.
      await client.query('update personal_assignments set removed_by = $2, removed_at = now() where id = $1', [teamless, by.authUserId]);
      const teamed = await assignmentOf(client, who, by, { date, shiftTypeId, teamId });
      await actAsService(client);
      expect(await enqueue(client, [{ ...base, teamId, lead: 'H2', source: 'ASSIGNMENT', personalAssignmentId: teamed }])).toBe(1);
      await actAsOwner(client);
      const h2 = (await remindersOf(client, who)).find((row) => row.operands['lead'] === 'H2' && row.channel === 'email');
      expect(h2?.operands).toEqual({
        date,
        teamId,
        start: 420,
        end: 1140,
        startsAt,
        lead: 'H2',
        leadHours: REMINDER_LEAD_HOURS.H2,
        shiftTypeName,
        teamName,
      });
      const { rows: teamedKey } = await client.query<{ subject: string }>(
        `select md5('SHIFT_REMINDER:' || $1 || ':' || $2 || ':a:' || $3 || ':H2')::uuid::text as subject`,
        [who.id, date, teamed],
      );
      expect(h2?.subject).toBe(teamedKey[0]?.subject);
    });
  });

  it.skipIf(noDatabase)('skips an ASSIGNMENT item whose row is removed, another member\'s, a day off, or of another date, type or team', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const by = await member(client, slug, admin);
      await remindable(client, who, ['H1'], true);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const { rows: madeType } = await client.query<{ id: string }>(
        `insert into shift_types (organization_id, name, is_working, created_by)
         values ($1, 'Podsjetnik tip ' || gen_random_uuid()::text, true, $2) returning id::text as id`,
        [who.organizationId, by.authUserId],
      );
      const otherType = madeType[0]!.id;
      const { rows: madeTeam } = await client.query<{ id: string }>(
        `insert into teams (organization_id, name, created_by)
         values ($1, 'Podsjetnik tim ' || gen_random_uuid()::text, $2) returning id::text as id`,
        [who.organizationId, by.authUserId],
      );
      const otherTeam = madeTeam[0]!.id;
      const date = await todayOf(client, who.organizationId, 1);
      const nextDate = await todayOf(client, who.organizationId, 2);
      const removed = await assignmentOf(client, who, by, { date, shiftTypeId, teamId: null });
      await client.query('update personal_assignments set removed_by = $2, removed_at = now() where id = $1', [removed, by.authUserId]);
      const off = await assignmentOf(client, who, by, { date: nextDate, kind: 'OFF', shiftTypeId: null, teamId: null });
      const live = await assignmentOf(client, who, by, { date, shiftTypeId, teamId: null });
      const adminsOwn = await assignmentOf(client, by, by, { date, shiftTypeId, teamId: null });
      // A row counted with one team, posted with another.
      const thirdDate = await todayOf(client, who.organizationId, 3);
      const teamed = await assignmentOf(client, who, by, { date: thirdDate, shiftTypeId, teamId });
      const startsAt = await isoFromNow(client, '1 day');
      const item = (personalAssignmentId: string, overrides: Record<string, unknown> = {}) => ({
        memberId: who.id,
        date,
        teamId: null,
        shiftTypeId,
        lead: 'H1',
        start: 420,
        end: 1140,
        startsAt,
        source: 'ASSIGNMENT',
        personalAssignmentId,
        ...overrides,
      });

      await actAsService(client);
      expect(
        await enqueue(client, [
          item(removed),
          item(adminsOwn),
          item(off, { date: nextDate }),
          item(live, { date: nextDate }),
          item(live, { shiftTypeId: otherType }),
          item(teamed, { date: thirdDate, teamId: otherTeam }),
        ]),
      ).toBe(0);
      await actAsOwner(client);
      expect(await remindersOf(client, who)).toEqual([]);
    });
  });

  it.skipIf(noDatabase)('refuses whole a batch with a malformed item form: an explicit TEAM source, no assignment id, a null team on the team form, a stray key', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const { teamId, shiftTypeId } = await teamAndType(client, who.organizationId);
      const date = await todayOf(client, who.organizationId, 1);
      const startsAt = await isoFromNow(client, '1 day');
      const team = { memberId: who.id, date, teamId, shiftTypeId, lead: 'H1', start: 420, end: 1140, startsAt };
      const assignment = { ...team, teamId: null, source: 'ASSIGNMENT', personalAssignmentId: who.id };
      const { personalAssignmentId: _id, ...noId } = assignment;

      await actAsService(client);
      for (const bad of [
        { ...team, source: 'TEAM' },
        { ...team, source: 'PERSONAL_ROTATION' },
        noId,
        { ...assignment, personalAssignmentId: 'not-a-uuid' },
        { ...assignment, teamId: 7 },
        { ...team, teamId: null },
        { ...assignment, note: 'x' },
      ]) {
        const refusal = await refusedThenContinue(client, () => enqueue(client, [bad]));
        expect({ code: refusal.code, message: refusal.message }, JSON.stringify(bad)).toEqual(ITEMS_INVALID);
      }
      await actAsOwner(client);
    });
  });
});
