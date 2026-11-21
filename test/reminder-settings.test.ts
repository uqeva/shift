import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { REMINDER_LEADS } from '../packages/domain/src/index.ts';

import { FIXTURES, inRolledBackTransaction, noDatabase, refused, type Refusal } from './database.ts';

/**
 * Story 17.1 (0069): a member chooses their reminders (FR-85, D4, D-S6,
 * AD-18). A database suite, run in CI on its fresh stack (written unrun: the
 * shared local stack never has a migration applied by a story).
 *
 * Every case runs in ONE rolled-back transaction, with claims injected
 * (`request.jwt.claims` and `set local role`), so nothing is committed and no
 * GoTrue token is issued (no PostgREST clock to warm up). Every scene a case
 * builds as the owner is built before its first `actAs`, or after an explicit
 * `actAsOwner`.
 */

/** 0069's check constraint, by name, as Postgres reports its violation. */
const LEADS_CHECK = 'reminder_settings_leads_check';
/** 0069's `reminder_channels` refusal. */
const REFUSED = { code: '42501', message: 'REMINDER_SETTINGS_REFUSED' } as const;

/** A device row the table's checks accept (0045), as `test/notify-boundary.test.ts`'s. */
const P256DH = `B${'k'.repeat(86)}`;
const AUTH = 'a'.repeat(22);

interface Member {
  readonly id: string;
  readonly authUserId: string;
  readonly organizationId: string;
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

/** An authenticated caller of `organization`, or a claimless one with `null`. */
async function actAs(client: Client, authUserId: string, organization: string | null): Promise<void> {
  const claims =
    organization === null
      ? { sub: authUserId, role: 'authenticated' }
      : { sub: authUserId, role: 'authenticated', organization_id: organization };
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims)]);
  await client.query('set local role authenticated');
}

async function actAsAnon(client: Client): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })]);
  await client.query('set local role anon');
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

/** Owner scene: the member's stored row, written past the policies. */
async function storeAsOwner(client: Client, who: Member, leads: readonly string[], email: boolean): Promise<void> {
  await client.query(
    `insert into reminder_settings (organization_id, member_id, leads, email) values ($1, $2, $3::text[], $4)
     on conflict (organization_id, member_id) do update set leads = excluded.leads, email = excluded.email`,
    [who.organizationId, who.id, leads, email],
  );
}

/** The stored row as the owner reads it, or `null`. */
async function storedRow(client: Client, who: Member): Promise<{ leads: string[]; email: boolean } | null> {
  const { rows } = await client.query<{ leads: string[]; email: boolean }>(
    'select leads, email from reminder_settings where organization_id = $1 and member_id = $2',
    [who.organizationId, who.id],
  );
  return rows[0] ?? null;
}

/** The caller's channels, as `who`, back to the owner after. */
async function channelsOf(client: Client, who: Member): Promise<Record<string, unknown>> {
  await actAs(client, who.authUserId, who.organizationId);
  const { rows } = await client.query<{ channels: Record<string, unknown> }>('select public.reminder_channels() as channels');
  await actAsOwner(client);
  return rows[0]?.channels ?? {};
}

/**
 * A status version as an admin session writes it (`test/calendar-feed-tokens.test.ts`'s
 * helper): the four columns 0008 grants, `created_by` from its default.
 * Called while acting as the admin; `plusDays` from the organization's today.
 */
async function insertStatusVersion(client: Client, who: Member, active: boolean, plusDays: number): Promise<void> {
  await client.query(
    `insert into member_status_versions (organization_id, member_id, active, effective_from)
     values ($1, $2, $3, organization_today($1) + $4::int)`,
    [who.organizationId, who.id, active, plusDays],
  );
}

describe('the reminder settings table (0069)', () => {
  it.skipIf(noDatabase)('holds the four facts and a stamp, organization first, RLS on and not forced, three own-row policies', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows: columns } = await client.query<{ name: string; type: string; fallback: string | null }>(
        `select column_name as name, data_type as type, column_default as fallback from information_schema.columns
          where table_schema = 'public' and table_name = 'reminder_settings' order by ordinal_position`,
      );
      expect(columns.map((column) => column.name)).toEqual(['organization_id', 'member_id', 'leads', 'email', 'updated_at']);
      expect(columns.find((column) => column.name === 'leads')?.fallback).toBe("'{}'::text[]");
      expect(columns.find((column) => column.name === 'email')?.fallback).toBe('false');

      const { rows: security } = await client.query<{ enabled: boolean; forced: boolean }>(
        `select relrowsecurity as enabled, relforcerowsecurity as forced from pg_class where oid = 'public.reminder_settings'::regclass`,
      );
      expect(security).toEqual([{ enabled: true, forced: false }]);

      const { rows: policies } = await client.query<{ policy: string }>(
        `select policyname || ' ' || cmd as policy from pg_policies where schemaname = 'public' and tablename = 'reminder_settings' order by 1`,
      );
      expect(policies.map((row) => row.policy)).toEqual([
        'reminder_settings_insert_own INSERT',
        'reminder_settings_select_own SELECT',
        'reminder_settings_update_own UPDATE',
      ]);

      const { rows: triggers } = await client.query<{ definition: string }>(
        `select pg_get_triggerdef(oid) as definition from pg_trigger
          where tgrelid = 'public.reminder_settings'::regclass and not tgisinternal order by 1`,
      );
      expect(triggers.map((row) => row.definition), 'the table is audited, or carries more than its stamp').toEqual([
        'CREATE TRIGGER reminder_settings_touch BEFORE UPDATE ON public.reminder_settings FOR EACH ROW EXECUTE FUNCTION private.touch_notification_settings()',
      ]);
    });
  });

  it.skipIf(noDatabase)('refuses anon a read and a write', async () => {
    const pilot = FIXTURES[0];
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, pilot.slug, pilot.member);
      await actAsAnon(client);
      expect(await refusedThenContinue(client, () => client.query('select leads from reminder_settings'))).toMatchObject({ code: '42501' });
      expect(
        await refusedThenContinue(client, () =>
          client.query("insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, '{H1}')", [
            who.organizationId,
            who.id,
          ]),
        ),
      ).toMatchObject({ code: '42501' });
      expect(await refusedThenContinue(client, () => client.query('select public.reminder_channels()'))).toMatchObject({ code: '42501' });
    });
  });
});

describe.each(FIXTURES)("a $fixture member's reminder choice (0069)", ({ slug, admin, member: memberName, bystander }) => {
  it.skipIf(noDatabase)('is off with no row: nothing to read, and no channel but a device', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await client.query('delete from push_subscriptions where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
      await client.query('delete from reminder_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
      await client.query("update members set email = 'reminder-test@example.invalid' where id = $1", [who.id]);
      // Every other email condition holds, so the missing row is the only reason email is off.
      await client.query('update organizations set email_notifications = true where id = $1', [who.organizationId]);
      await client.query('delete from notification_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);

      await actAs(client, who.authUserId, who.organizationId);
      const { rows } = await client.query('select leads, email from reminder_settings');
      expect(rows, 'a member with no row reads one').toEqual([]);
      await actAsOwner(client);

      // An address, email on, the organization's switch on: no row is still email off (D-S6).
      expect(await channelsOf(client, who)).toEqual({ push: false, email: false });
    });
  });

  it.skipIf(noDatabase)('writes its own row by update-then-insert, in the set\'s order, and never deletes it', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await client.query('delete from reminder_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);

      await actAs(client, who.authUserId, who.organizationId);
      const updated = await client.query("update reminder_settings set leads = '{EVENING_BEFORE}' where member_id = $1", [who.id]);
      expect(updated.rowCount, 'an update with no row changed one').toBe(0);
      const inserted = await client.query<{ leads: string[]; email: boolean }>(
        "insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, '{EVENING_BEFORE}') returning leads, email",
        [who.organizationId, who.id],
      );
      expect(inserted.rows).toEqual([{ leads: ['EVENING_BEFORE'], email: false }]);
      const both = await client.query<{ leads: string[] }>(
        "update reminder_settings set leads = '{H2,EVENING_BEFORE}' where member_id = $1 returning leads",
        [who.id],
      );
      expect(both.rows).toEqual([{ leads: ['H2', 'EVENING_BEFORE'] }]);
      const emailOn = await client.query<{ email: boolean }>(
        'update reminder_settings set email = true where member_id = $1 returning email',
        [who.id],
      );
      expect(emailOn.rows).toEqual([{ email: true }]);
      const off = await client.query<{ leads: string[] }>("update reminder_settings set leads = '{}' where member_id = $1 returning leads", [
        who.id,
      ]);
      expect(off.rows).toEqual([{ leads: [] }]);

      // Neither the row's owner nor its tenant moves, and nothing deletes it.
      expect(
        await refusedThenContinue(client, () =>
          client.query('update reminder_settings set member_id = member_id where member_id = $1', [who.id]),
        ),
      ).toMatchObject({ code: '42501' });
      expect(
        await refusedThenContinue(client, () => client.query('update reminder_settings set updated_at = now() where member_id = $1', [who.id])),
      ).toMatchObject({ code: '42501' });
      expect(
        await refusedThenContinue(client, () => client.query('delete from reminder_settings where member_id = $1', [who.id])),
      ).toMatchObject({ code: '42501' });
      await actAsOwner(client);
      expect(await storedRow(client, who)).toEqual({ leads: [], email: true });
    });
  });

  it.skipIf(noDatabase)('refuses three leads, a duplicate, an unknown code and the set\'s order reversed (23514)', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await client.query('delete from reminder_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);

      await actAs(client, who.authUserId, who.organizationId);
      for (const leads of [['H1', 'H2', 'H3'], ['H1', 'H1'], ['H4'], ['h1'], ['EVENING_BEFORE', 'H2'], ['H12', 'H6'], [null]]) {
        const refusal = await refusedThenContinue(client, () =>
          client.query('insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, $3::text[])', [
            who.organizationId,
            who.id,
            leads,
          ]),
        );
        expect(refusal.code, `${JSON.stringify(leads)} was stored`).toBe('23514');
        expect(refusal.message).toContain(LEADS_CHECK);
      }
      // Every single lead, and every pair in the set's order, is stored.
      for (const [index, first] of REMINDER_LEADS.entries()) {
        for (const leads of [[first], ...REMINDER_LEADS.slice(index + 1).map((second) => [first, second])]) {
          await client.query('savepoint lead_probe');
          const { rows } = await client.query<{ leads: string[] }>(
            'insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, $3::text[]) returning leads',
            [who.organizationId, who.id, leads],
          );
          expect(rows[0]?.leads).toEqual(leads);
          await client.query('rollback to savepoint lead_probe');
        }
      }
    });
  });

  it.skipIf(noDatabase)('is read and written by its member alone: a peer, an admin and a claimless account read nothing and change nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const peer = await member(client, slug, bystander);
      const boss = await member(client, slug, admin);
      await storeAsOwner(client, who, ['H2', 'EVENING_BEFORE'], true);
      await client.query('delete from reminder_settings where organization_id = $1 and member_id = $2', [peer.organizationId, peer.id]);

      const attempts: readonly (readonly [string, Member, string | null])[] = [
        ['a peer', peer, peer.organizationId],
        ['an admin', boss, boss.organizationId],
        ['a claimless account', who, null],
      ];
      for (const [label, caller, claim] of attempts) {
        await actAs(client, caller.authUserId, claim);
        const seen = await client.query('select member_id from reminder_settings where member_id = $1', [who.id]);
        expect(seen.rows, `${label} read the member's row`).toEqual([]);
        const changed = await client.query("update reminder_settings set leads = '{H1}', email = false where member_id = $1", [who.id]);
        expect(changed.rowCount, `${label} changed the member's row`).toBe(0);
        const inserted = await refusedThenContinue(client, () =>
          client.query("insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, '{H1}')", [
            who.organizationId,
            who.id,
          ]),
        );
        expect(inserted.code, `${label} wrote a row for the member`).toBe('42501');
        await actAsOwner(client);
      }

      // The claimless account is the member's own: refused its own channels too (19.1's sweep).
      await actAs(client, who.authUserId, null);
      expect(await refusedThenContinue(client, () => client.query('select public.reminder_channels()'))).toMatchObject(REFUSED);
      await actAsOwner(client);

      expect(await storedRow(client, who), 'the member\'s row changed').toEqual({ leads: ['H2', 'EVENING_BEFORE'], email: true });
    });
  });

  it.skipIf(noDatabase)('gives a member deactivated today nothing: no row read, no write, and the channels refused', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const boss = await member(client, slug, admin);
      // Scenes first, as the owner: the member's row, then the admin's own
      // deactivation of them, in effect today (an RLS write of the admin's).
      await storeAsOwner(client, who, ['H6'], true);
      await actAs(client, boss.authUserId, boss.organizationId);
      await insertStatusVersion(client, who, false, 0);
      await actAsOwner(client);

      await actAs(client, who.authUserId, who.organizationId);
      const seen = await client.query('select member_id from reminder_settings');
      expect(seen.rows, 'an inactive member read their row').toEqual([]);
      const changed = await client.query("update reminder_settings set leads = '{H1}' where member_id = $1", [who.id]);
      expect(changed.rowCount, 'an inactive member changed their row').toBe(0);
      await actAsOwner(client);
      await client.query('delete from reminder_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
      await actAs(client, who.authUserId, who.organizationId);
      const inserted = await refusedThenContinue(client, () =>
        client.query("insert into reminder_settings (organization_id, member_id, leads) values ($1, $2, '{H1}')", [
          who.organizationId,
          who.id,
        ]),
      );
      expect(inserted.code, 'an inactive member wrote a row').toBe('42501');
      expect(await refusedThenContinue(client, () => client.query('select public.reminder_channels()'))).toMatchObject(REFUSED);
      await actAsOwner(client);
      expect(await storedRow(client, who)).toBeNull();
    });
  });

  it.skipIf(noDatabase)('refuses the own row and the channels under another tenant\'s claim', async () => {
    const other = FIXTURES.find((fixture) => fixture.slug !== slug);
    if (other === undefined) throw new Error('only one fixture');
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const foreign = await member(client, other.slug, other.member);
      await storeAsOwner(client, who, ['H1'], false);

      await actAs(client, who.authUserId, foreign.organizationId);
      const seen = await client.query('select member_id from reminder_settings');
      expect(seen.rows, 'a mismatched claim read a row').toEqual([]);
      expect(await refusedThenContinue(client, () => client.query('select public.reminder_channels()'))).toMatchObject(REFUSED);
      await actAsOwner(client);
    });
  });

  it.skipIf(noDatabase)('names a device as push and the predicate as email, each condition of which turns email off', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      await client.query('delete from push_subscriptions where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
      await client.query('delete from notification_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
      await client.query("update members set email = 'reminder-test@example.invalid' where id = $1", [who.id]);
      await client.query('update organizations set email_notifications = true where id = $1', [who.organizationId]);
      await storeAsOwner(client, who, ['H2'], true);

      expect(await channelsOf(client, who), 'every email condition holds').toEqual({ push: false, email: true });

      await client.query(
        `insert into push_subscriptions (organization_id, member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)`,
        [who.organizationId, who.id, `https://fcm.googleapis.com/fcm/send/reminder-test-${who.id}`, P256DH, AUTH],
      );
      expect(await channelsOf(client, who), 'a device does not count as push').toEqual({ push: true, email: true });

      // Each condition alone turns email off; the device keeps push.
      const conditions: readonly (readonly [string, string, unknown[]])[] = [
        ['no address', 'update members set email = null where id = $1', [who.id]],
        ['a blank address', "update members set email = '   ' where id = $1", [who.id]],
        ['the reminder email switch off', 'update reminder_settings set email = false where member_id = $1', [who.id]],
        [
          "the member's email switch off",
          'insert into notification_settings (organization_id, member_id, email) values ($1, $2, false)',
          [who.organizationId, who.id],
        ],
        ["the organization's switch off", 'update organizations set email_notifications = false where id = $1', [who.organizationId]],
      ];
      for (const [label, statement, values] of conditions) {
        await client.query('savepoint condition_probe');
        await client.query(statement, values);
        expect(await channelsOf(client, who), `${label} still reaches email`).toEqual({ push: true, email: false });
        await client.query('rollback to savepoint condition_probe');
      }

      // The member's email switch stored on is the same as no row.
      await client.query('insert into notification_settings (organization_id, member_id, email) values ($1, $2, true)', [
        who.organizationId,
        who.id,
      ]);
      expect(await channelsOf(client, who)).toEqual({ push: true, email: true });
    });
  });

  it.skipIf(noDatabase)('gives no session role the email predicate', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `select role from unnest(array['anon', 'authenticated', 'service_role']) as role
          where has_function_privilege(role, 'private.reminder_email_on(uuid)', 'execute')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
