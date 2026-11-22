import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  argumentsFor,
  attempt,
  call,
  executableFunctions,
  publicRelations,
  refusedWrite,
  saysNothing,
  snapshot,
  unsweepable,
  UNSWEPT_ALLOWED,
  type Arguments,
  type Callable,
} from './catalog-sweep.ts';
import { FIXTURES, inRolledBackTransaction, noDatabase, organizationId } from './database.ts';

/**
 * STORY 19.5 (AD-10 and AD-25 as amended by Architect pass 2; FR-101;
 * checklist rows E3, E4, F4): a suspended organization reads nothing, through
 * `private.organization_live` alone, and unsuspending it changes no record.
 *
 * DB-CONNECTING, and written UNRUN (the STRICT DATABASE RULE): CI's fresh
 * stack is its first run. Locally it skips with no stack. Every case runs in
 * ONE rolled-back transaction, so the suspension it makes is never committed.
 * Every scene (the suspension included: it is the operator's script, run as
 * the owner) is built before the case's first switch of role, or after an
 * explicit `actAsOwner` (bmad-build's scene rule). The suspension is made by
 * `supabase/operator/suspend-organization.sql` itself, never by a hand-written
 * UPDATE, so the script is what is proved.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const operator = (name: string): string => readFileSync(join(repoRoot, 'supabase', 'operator', name), 'utf8');

const PILOT = FIXTURES[0];
const OTHER = FIXTURES[1];

/** The hook's refusal (0008, kept by 0073), word for word. */
const SIGN_IN_REFUSED = { error: { http_code: 403, message: 'SIGN_IN_REFUSED' } };

/** A device row the table's checks accept (0045), as `test/shift-reminders.test.ts`'s. */
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

/** The operator's script, as the owner, inside the case's transaction. */
async function runOperatorScript(client: Client, script: string, slug: string): Promise<void> {
  await client.query("select set_config('shift.organization_slug', $1, true)", [slug]);
  await client.query(operator(script));
}

async function actAs(client: Client, who: Member): Promise<void> {
  const claims = { sub: who.authUserId, role: 'authenticated', organization_id: who.organizationId };
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims)]);
  await client.query('set local role authenticated');
}

async function actAsAnon(client: Client): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })]);
  await client.query('set local role anon');
}

async function actAsService(client: Client): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ role: 'service_role' })]);
  await client.query('set local role service_role');
}

async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', '', true)");
}

async function suspended(client: Client, organization: string): Promise<boolean> {
  const { rows } = await client.query<{ suspended: boolean }>('select suspended from organizations where id = $1', [organization]);
  return rows[0]?.suspended ?? false;
}

/** What the session reads of its own organization: members, the organization row, its access. */
async function readsOfSession(client: Client, who: Member): Promise<number> {
  await actAs(client, who);
  const { rows } = await client.query<{ n: number }>(
    `select ((select count(*) from members) + (select count(*) from organizations)
             + (select count(*) from current_member_access()))::int as n`,
  );
  await actAsOwner(client);
  return rows[0]?.n ?? -1;
}

/** The hook's answer for `who`, as GoTrue would call it (as the owner here: it is a definer). */
async function hookFor(client: Client, who: Member): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ answer: Record<string, unknown> }>(
    'select public.custom_access_token_hook($1::jsonb) as answer',
    [JSON.stringify({ user_id: who.authUserId, claims: { sub: who.authUserId, role: 'authenticated' } })],
  );
  return rows[0]?.answer ?? {};
}

/** Owner scene: `who` holds a live feed token whose text is `token`; answers the lookup's hex. */
async function liveFeedToken(client: Client, who: Member, token: string): Promise<string> {
  await client.query(
    `update calendar_feed_tokens set removed_by = $3, removed_at = now()
      where organization_id = $1 and member_id = $2 and removed_at is null`,
    [who.organizationId, who.id, who.authUserId],
  );
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await client.query(
    'insert into calendar_feed_tokens (organization_id, member_id, token_hash, created_by) values ($1, $2, $3, $4)',
    [who.organizationId, who.id, hash, who.authUserId],
  );
  return hash.toString('hex');
}

async function feedAnswers(client: Client, hex: string): Promise<boolean> {
  await actAsAnon(client);
  const { rows } = await client.query<{ hit: boolean }>('select public.calendar_feed_inputs($1) is not null as hit', [hex]);
  await actAsOwner(client);
  return rows[0]?.hit ?? false;
}

/** Owner scene, as `test/shift-reminders.test.ts`'s: reminders on both channels with `leads` on. */
async function remindable(client: Client, who: Member, leads: readonly string[]): Promise<void> {
  await client.query('delete from push_subscriptions where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
  await client.query('delete from notification_settings where organization_id = $1 and member_id = $2', [who.organizationId, who.id]);
  await client.query("update members set email = 'suspension-case@example.invalid' where id = $1", [who.id]);
  await client.query('update organizations set email_notifications = true where id = $1', [who.organizationId]);
  await client.query(
    'insert into push_subscriptions (organization_id, member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)',
    [who.organizationId, who.id, `https://fcm.googleapis.com/fcm/send/suspension-case-${who.id}`, P256DH, AUTH],
  );
  await client.query(
    `insert into reminder_settings (organization_id, member_id, leads, email) values ($1, $2, $3::text[], true)
     on conflict (organization_id, member_id) do update set leads = excluded.leads, email = excluded.email`,
    [who.organizationId, who.id, leads],
  );
}

async function remindedMembers(client: Client): Promise<string[]> {
  await actAsService(client);
  const { rows } = await client.query<{ answer: { members: { memberId: string }[] } }>('select public.reminder_inputs() as answer');
  await actAsOwner(client);
  return rows[0]?.answer.members.map((row) => row.memberId) ?? [];
}

/** One well-formed reminder item for `who`, an hour from now, on the organization's first team and working type. */
async function reminderItem(client: Client, who: Member): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ teamId: string; shiftTypeId: string; date: string; startsAt: string }>(
    `select t.id as "teamId", s.id as "shiftTypeId",
            to_char(organization_today($1) + 1, 'YYYY-MM-DD') as date,
            to_char((now() + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "startsAt"
       from teams t join shift_types s on s.organization_id = t.organization_id and s.is_working
      where t.organization_id = $1
      order by t.id, s.id
      limit 1`,
    [who.organizationId],
  );
  const found = rows[0];
  if (found === undefined) throw new Error('the organization has no team or working shift type');
  return { memberId: who.id, date: found.date, teamId: found.teamId, shiftTypeId: found.shiftTypeId, lead: 'H1', start: 420, end: 1140, startsAt: found.startsAt };
}

async function enqueue(client: Client, items: readonly unknown[]): Promise<number> {
  await actAsService(client);
  const { rows } = await client.query<{ accepted: number }>('select public.enqueue_shift_reminders(p_items => $1::jsonb) as accepted', [
    JSON.stringify(items),
  ]);
  await actAsOwner(client);
  return rows[0]?.accepted ?? -1;
}

async function outboxCount(client: Client, who: Member): Promise<number> {
  const { rows } = await client.query<{ n: number }>('select count(*)::int as n from notification_outbox where recipient_member_id = $1', [who.id]);
  return rows[0]?.n ?? -1;
}

// ------------------------------------------------------------------ the suite

describe('a suspended organization reads nothing (story 19.5, AD-10, E3)', () => {
  it.skipIf(noDatabase)('lets its admin read zero rows from every table and view, and refuses every write', async () => {
    await inRolledBackTransaction(async (client) => {
      // THE SCENE, AS THE OWNER, before any actAs: the operator suspends the pilot.
      const admin = await member(client, PILOT.slug, PILOT.admin);
      const relations = await publicRelations(client);
      expect(await readsOfSession(client, admin), 'the admin must read their organization before the suspension').toBeGreaterThan(0);
      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      expect(await suspended(client, admin.organizationId)).toBe(true);
      const before = await snapshot(client);
      expect(before['public.members'] ?? 0, 'the fixtures must be loaded, or zero rows proves nothing').toBeGreaterThan(0);

      await actAs(client, admin);
      const offences: string[] = [];
      for (const relation of relations) {
        const read = await attempt<{ n: number }>(client, `select count(*)::int as n from public."${relation.name}"`);
        if ('rows' in read && (read.rows[0]?.n ?? 0) !== 0) offences.push(`${relation.name}: reads ${String(read.rows[0]?.n)} rows`);
        if ('refused' in read && read.refused !== '42501') offences.push(`${relation.name}: a read ended ${read.refused}, not 42501`);

        const inserted = refusedWrite(relation, 'insert', await attempt(client, `insert into public."${relation.name}" default values`));
        if (inserted !== null) offences.push(inserted);
        if (relation.firstColumn !== null) {
          const column = relation.firstColumn;
          const updated = refusedWrite(relation, 'update', await attempt(client, `update public."${relation.name}" set "${column}" = "${column}"`));
          if (updated !== null) offences.push(updated);
        }
        const deleted = refusedWrite(relation, 'delete', await attempt(client, `delete from public."${relation.name}"`));
        if (deleted !== null) offences.push(deleted);
      }
      // The claim is still in the token: the database refuses it.
      const claim = await attempt<{ claim: string | null }>(client, `select (select auth.jwt()) ->> 'organization_id' as claim`);
      expect('rows' in claim ? claim.rows[0]?.claim : 'refused').toBe(admin.organizationId);
      const access = await attempt<{ n: number }>(client, 'select count(*)::int as n from public.current_member_access()');
      expect('rows' in access ? access.rows[0]?.n : -1, 'current_member_access names an access').toBe(0);

      await actAsOwner(client);
      expect(offences).toEqual([]);
      expect(await snapshot(client), 'a write as the suspended admin landed').toEqual(before);
    }, 'repeatable read');
  });

  it.skipIf(noDatabase)('gets the same answer from every function it may execute whether its organization’s ids exist or not', async () => {
    await inRolledBackTransaction(async (client) => {
      // THE SCENE, AS THE OWNER: the suspension, the catalog, the real ids.
      const admin = await member(client, PILOT.slug, PILOT.admin);
      const organization = await organizationId(client, PILOT.slug);
      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      // No exemption: `create_organization` refuses an account with a member row.
      const all = await executableFunctions(client);
      expect(all.length, 'too few functions were read for the sweep to mean anything').toBeGreaterThan(30);
      const unswept = all
        .map((callable) => ({ callable, reason: unsweepable(callable) }))
        .filter(({ reason }) => reason !== null)
        .map(({ callable, reason }) => `${callable.name}: ${reason ?? ''}`);
      expect(
        unswept.filter((entry) => !(entry.slice(0, entry.indexOf(':')) in UNSWEPT_ALLOWED)),
        'a function the sweep cannot call is not named, with its reason, in UNSWEPT_ALLOWED',
      ).toEqual([]);
      const functions = all.filter((callable) => unsweepable(callable) === null);
      const calls: { callable: Callable; real: Arguments; absent: Arguments }[] = [];
      for (const callable of functions) {
        calls.push({
          callable,
          real: await argumentsFor(client, callable, organization, true),
          absent: await argumentsFor(client, callable, organization, false),
        });
      }
      const realIds = calls.reduce((sum, { real }) => sum + real.realIds, 0);
      const exercised = calls.filter(({ real }) => real.realIds > 0).map(({ callable }) => callable.name);
      expect(realIds, 'too few uuid arguments named a real row of the suspended organization').toBeGreaterThanOrEqual(20);
      expect(new Set(exercised).size, `too few functions were called with a real id: ${exercised.join(', ')}`).toBeGreaterThanOrEqual(15);
      const before = await snapshot(client);

      await actAs(client, admin);
      const differing: string[] = [];
      for (const { callable, real, absent } of calls) {
        const signature = `${callable.name}(${callable.types.join(', ')})`;
        const withReal = await call(client, callable, real.values);
        if (!callable.types.includes('uuid')) {
          if (!saysNothing(withReal)) differing.push(`${signature}: answered ${withReal}`);
          continue;
        }
        const withAbsent = await call(client, callable, absent.values);
        if (withReal !== withAbsent) differing.push(`${signature}: ${withReal} ≠ ${withAbsent}`);
      }

      await actAsOwner(client);
      expect(differing, 'a function answered a suspended admin from a row of its organization').toEqual([]);
      expect(await snapshot(client), 'a function wrote as the suspended admin').toEqual(before);
    }, 'repeatable read');
  });

  it.skipIf(noDatabase)('reads no Storage object and cannot write a logo', async () => {
    await inRolledBackTransaction(async (client) => {
      const admin = await member(client, PILOT.slug, PILOT.admin);
      // Owner scene: a logo the admin can read before the suspension.
      await client.query(
        `insert into storage.objects (bucket_id, name, owner) values ('organization-logos', $1, $2::uuid)
         on conflict do nothing`,
        [`${admin.organizationId}/logo`, admin.authUserId],
      );
      await actAs(client, admin);
      const visible = await attempt<{ n: number }>(client, 'select count(*)::int as n from storage.objects');
      await actAsOwner(client);
      expect('rows' in visible ? visible.rows[0]?.n : 0, 'the admin cannot read its own logo before the suspension').toBeGreaterThan(0);
      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      const before = await snapshot(client);

      await actAs(client, admin);
      const objects = await attempt<{ n: number }>(client, 'select count(*)::int as n from storage.objects');
      const written = await attempt(
        client,
        `insert into storage.objects (bucket_id, name, owner) values ('organization-logos', $1, $2::uuid)`,
        [`${admin.organizationId}/logo`, admin.authUserId],
      );

      await actAsOwner(client);
      expect('rows' in objects ? objects.rows[0]?.n : -1, 'a suspended admin read Storage').toBe(0);
      expect(refusedWrite({ name: 'storage.objects', kind: 'r', firstColumn: null }, 'insert', written), 'a suspended admin wrote a logo').toBeNull();
      expect(await snapshot(client)).toEqual(before);
    }, 'repeatable read');
  });

  it.skipIf(noDatabase)('refuses its sign-in and refresh with the deactivation’s refusal, and leaves every other account’s claim alone', async () => {
    await inRolledBackTransaction(async (client) => {
      const admin = await member(client, PILOT.slug, PILOT.admin);
      const colleague = await member(client, PILOT.slug, PILOT.member);
      const elsewhere = await member(client, OTHER.slug, OTHER.admin);
      const claimOf = (answer: Record<string, unknown>): unknown => (answer['claims'] as Record<string, unknown> | undefined)?.['organization_id'];
      expect(claimOf(await hookFor(client, admin))).toBe(admin.organizationId);

      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      expect(await hookFor(client, admin)).toEqual(SIGN_IN_REFUSED);
      expect(await hookFor(client, colleague)).toEqual(SIGN_IN_REFUSED);
      expect(claimOf(await hookFor(client, elsewhere)), 'another organization signs in as before').toBe(elsewhere.organizationId);

      // A claimless account is answered as before: no claim, no refusal.
      const id = randomUUID();
      const claimless = await hookFor(client, { id, authUserId: id, organizationId: '' });
      expect(claimless['error']).toBeUndefined();
      expect(claimOf(claimless)).toBeUndefined();

      await runOperatorScript(client, 'unsuspend-organization.sql', PILOT.slug);
      expect(claimOf(await hookFor(client, admin))).toBe(admin.organizationId);
    });
  });

  it.skipIf(noDatabase)('answers its members’ feeds with the one miss, and serves them again once unsuspended', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, PILOT.slug, PILOT.member);
      const elsewhere = await member(client, OTHER.slug, OTHER.member);
      const hex = await liveFeedToken(client, who, `suspension-feed-${randomUUID()}`);
      const otherHex = await liveFeedToken(client, elsewhere, `suspension-feed-${randomUUID()}`);
      expect(await feedAnswers(client, hex)).toBe(true);

      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      expect(await feedAnswers(client, hex), 'a suspended organization’s feed answered').toBe(false);
      expect(await feedAnswers(client, otherHex)).toBe(true);
      const { rows } = await client.query<{ live: number }>(
        'select count(*)::int as live from calendar_feed_tokens where member_id = $1 and removed_at is null',
        [who.id],
      );
      expect(rows[0]?.live, 'suspension revoked the token: it must delete and revoke nothing').toBe(1);

      // Both state reads share the liveness helper: read it as the owner (a
      // suspended member's own read is refused before it gets there).
      const stateOf = async (): Promise<unknown> =>
        (await client.query<{ live: unknown }>("select private.calendar_feed_state($1, $2) ->> 'live' as live", [who.organizationId, who.id])).rows[0]?.live;
      expect(await stateOf()).toBe('false');

      await runOperatorScript(client, 'unsuspend-organization.sql', PILOT.slug);
      expect(await feedAnswers(client, hex)).toBe(true);
      expect(await stateOf()).toBe('true');
    });
  });

  it.skipIf(noDatabase)('reads and writes no reminder and queues no notification for it', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, PILOT.slug, PILOT.member);
      const elsewhere = await member(client, OTHER.slug, OTHER.member);
      await remindable(client, who, ['H1']);
      await remindable(client, elsewhere, ['H1']);
      const item = await reminderItem(client, who);
      expect(await remindedMembers(client)).toContain(who.id);

      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      const reminded = await remindedMembers(client);
      expect(reminded, 'a suspended organization’s member was read').not.toContain(who.id);
      expect(reminded).toContain(elsewhere.id);
      expect(await enqueue(client, [item]), 'a suspended organization’s reminder was accepted').toBe(0);
      expect(await outboxCount(client, who)).toBe(0);
      // Every event writes through `notify_members`: nothing is queued.
      await client.query(
        "select private.notify_members($1, 'LEAVE_REQUEST_DECIDED', $2, array[$3::uuid], '{}'::jsonb)",
        [who.organizationId, randomUUID(), who.id],
      );
      expect(await outboxCount(client, who)).toBe(0);

      await runOperatorScript(client, 'unsuspend-organization.sql', PILOT.slug);
      expect(await enqueue(client, [item]), 'unsuspended, the same item is accepted').toBe(1);
      expect(await outboxCount(client, who)).toBe(2);
    });
  });

  it.skipIf(noDatabase)('settles its queued rows ORGANIZATION_SUSPENDED, posts to no device, and sends none again once unsuspended', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, PILOT.slug, PILOT.member);
      await remindable(client, who, []);
      // Owner scene: one pending email row, one push row claimed by an earlier run.
      const { rows: queued } = await client.query<{ id: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
         values ($1, 'LEAVE_REQUEST_DECIDED', $2, $3, 'email', '{}'::jsonb) returning id::text`,
        [who.organizationId, randomUUID(), who.id],
      );
      const { rows: inFlight } = await client.query<{ id: string; claimed: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands, claimed_at, attempts)
         values ($1, 'LEAVE_REQUEST_DECIDED', $2, $3, 'push', '{}'::jsonb, now(), 1) returning id::text, claimed_at::text as claimed`,
        [who.organizationId, randomUUID(), who.id],
      );
      const pending = queued[0]?.id ?? '';
      const push = inFlight[0];
      // The member has also turned email off, so 0044's settle matches the
      // pending row too: the suspension's runs first and is the reason recorded (D3).
      await client.query(
        `insert into notification_settings (organization_id, member_id, email) values ($1, $2, false)
         on conflict (organization_id, member_id) do update set email = false`,
        [who.organizationId, who.id],
      );

      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      await actAsService(client);
      const { rows: devices } = await client.query<{ read: { status: string; devices: unknown[] } }>(
        'select public.push_devices_for_send($1::uuid, $2::timestamptz) as read',
        [push?.id, push?.claimed],
      );
      expect(devices[0]?.read).toEqual({ status: 'inactive', devices: [] });
      const { rows: claimed } = await client.query<{ id: string }>('select id::text from public.claim_notifications(100)');
      await actAsOwner(client);
      expect(claimed.map((row) => row.id), 'a suspended organization’s row was claimed').not.toContain(pending);
      const { rows: settled } = await client.query<{ failure: string | null; next: string | null }>(
        'select failure_code as failure, next_attempt_at::text as next from notification_outbox where id = $1',
        [pending],
      );
      expect(settled).toEqual([{ failure: 'ORGANIZATION_SUSPENDED', next: null }]);

      await runOperatorScript(client, 'unsuspend-organization.sql', PILOT.slug);
      await actAsService(client);
      const { rows: again } = await client.query<{ id: string }>('select id::text from public.claim_notifications(100)');
      await actAsOwner(client);
      expect(again.map((row) => row.id), 'a settled row was sent after unsuspending').not.toContain(pending);
      // Delivery is restored: a row queued after unsuspending is claimed.
      await client.query('update notification_settings set email = true where organization_id = $1 and member_id = $2', [
        who.organizationId,
        who.id,
      ]);
      const { rows: fresh } = await client.query<{ id: string }>(
        `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
         values ($1, 'LEAVE_REQUEST_DECIDED', $2, $3, 'email', '{}'::jsonb) returning id::text`,
        [who.organizationId, randomUUID(), who.id],
      );
      await actAsService(client);
      const { rows: restored } = await client.query<{ id: string }>('select id::text from public.claim_notifications(100)');
      await actAsOwner(client);
      expect(restored.map((row) => row.id), 'an unsuspended organization’s row was not claimed').toContain(fresh[0]?.id);
    });
  });
});

describe('only the operator suspends, and unsuspending changes no record (story 19.5, FR-101, E4, F4)', () => {
  it.skipIf(noDatabase)('lets no session role write suspended', async () => {
    await inRolledBackTransaction(async (client) => {
      const admin = await member(client, PILOT.slug, PILOT.admin);
      const { rows: grants } = await client.query<{ granted: boolean }>(
        "select has_column_privilege('authenticated', 'public.organizations', 'suspended', 'UPDATE') as granted",
      );
      expect(grants[0]?.granted, 'authenticated holds UPDATE on suspended').toBe(false);
      // The secret key's role is trusted past every policy (AD-17), as for
      // `founded_by`: recorded here, so a change to it is a decision.
      const { rows: service } = await client.query<{ granted: boolean }>(
        "select has_column_privilege('service_role', 'public.organizations', 'suspended', 'UPDATE') as granted",
      );
      expect(service[0]?.granted).toBe(true);

      await actAs(client, admin);
      const asAdmin = await attempt(client, 'update public.organizations set suspended = true where id = $1', [admin.organizationId]);
      await actAsOwner(client);
      expect(refusedWrite({ name: 'organizations', kind: 'r', firstColumn: null }, 'update', asAdmin)).toBeNull();

      await actAsAnon(client);
      const asAnon = await attempt(client, 'update public.organizations set suspended = true where id = $1', [admin.organizationId]);
      await actAsOwner(client);
      expect(refusedWrite({ name: 'organizations', kind: 'r', firstColumn: null }, 'update', asAnon)).toBeNull();
      expect(await suspended(client, admin.organizationId)).toBe(false);
    });
  });

  it.skipIf(noDatabase)('suspends and unsuspends by slug, changing that column alone, and refuses an unknown or missing slug', async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const rowOf = async (): Promise<Record<string, unknown>> => {
        const { rows } = await client.query<{ row: Record<string, unknown> }>('select to_jsonb(o) - $2 as row from organizations o where id = $1', [
          organization,
          'suspended',
        ]);
        return rows[0]?.row ?? {};
      };
      const row = await rowOf();
      const counts = await snapshot(client, ['public', 'private', 'storage']);

      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      expect(await suspended(client, organization)).toBe(true);
      // A second suspension changes nothing and refuses nothing.
      await runOperatorScript(client, 'suspend-organization.sql', PILOT.slug);
      await runOperatorScript(client, 'unsuspend-organization.sql', PILOT.slug);
      expect(await suspended(client, organization)).toBe(false);
      expect(await rowOf(), 'the scripts changed another column').toEqual(row);
      // The change history gained the two updates (AD-11) and nothing else changed.
      const after = await snapshot(client, ['public', 'private', 'storage']);
      expect({ ...after, 'public.audit_events': 0 }).toEqual({ ...counts, 'public.audit_events': 0 });
      expect((after['public.audit_events'] ?? 0) - (counts['public.audit_events'] ?? 0)).toBe(2);

      for (const [slug, code] of [
        [`unknown-${randomUUID().slice(0, 8)}`, 'ORGANIZATION_UNKNOWN'],
        ['', 'ORGANIZATION_SLUG_MISSING'],
      ] as const) {
        await client.query('savepoint script');
        const failure = await runOperatorScript(client, 'suspend-organization.sql', slug).then(
          () => null,
          (cause: unknown) => (cause as { message?: string }).message ?? 'UNKNOWN',
        );
        await client.query('rollback to savepoint script');
        expect(failure, slug).toBe(code);
      }
    });
  });

  it.skipIf(noDatabase)('reports signups and organizations founded per day against the ceilings, and writes nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await snapshot(client);
      const { rows } = await client.query<{ report: string }>(operator('signup-report.sql'));
      const report = JSON.parse(rows[0]?.report ?? '{}') as Record<string, unknown>;
      expect(Object.keys(report).sort()).toEqual([
        'accounts_by_day',
        'door',
        'generated_at',
        'last_24_hours',
        'most_attempts',
        'organizations_by_day',
        'organizations_founded_by_signup',
        'recent_accounts',
      ]);
      expect(report['door']).toMatchObject({ organizations_per_day: expect.any(Number) as number, accounts_per_day: expect.any(Number) as number });
      expect(report['last_24_hours']).toMatchObject({ organizations_ceiling: expect.any(Number) as number });
      // The fixtures are operator-provisioned: none is listed as founded by signup.
      const founded = report['organizations_founded_by_signup'] as { slug: string }[];
      expect(founded.map((entry) => entry.slug)).not.toContain(PILOT.slug);
      expect(await snapshot(client)).toEqual(before);
    });
  });

  it.skipIf(noDatabase)('counts a known scene exactly as the ceilings count it, and lists the signup-founded organization (AC3)', async () => {
    await inRolledBackTransaction(async (client) => {
      type Report = {
        last_24_hours: { accounts_without_member: number; organizations_founded: number };
        recent_accounts: { email: string; with_member: boolean; confirmed_at: string | null }[];
        organizations_by_day: { founded: number }[];
        accounts_by_day: { created: number; confirmed: number; with_member: number }[];
        organizations_founded_by_signup: { slug: string; suspended: boolean; members: number }[];
        most_attempts: { account: string; attempts_24_hours: number; attempts_30_days: number }[];
      };
      const report = async (): Promise<Report> =>
        JSON.parse((await client.query<{ report: string }>(operator('signup-report.sql'))).rows[0]?.report ?? '{}') as Report;
      const sum = (rows: Report['accounts_by_day'], key: 'created' | 'confirmed' | 'with_member'): number =>
        rows.reduce((total, row) => total + row[key], 0);
      const before = await report();

      // THE SCENE, AS THE OWNER: two fresh email identities (one confirmed),
      // one fresh synthesized account, all memberless; the OTHER fixture
      // marked as founded by the confirmed one, then suspended; attempts.
      const tag = randomUUID().slice(0, 8);
      const make = async (email: string, confirmed: boolean): Promise<string> => {
        const id = randomUUID();
        await client.query(
          `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                   created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
           values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                   case when $3::boolean then now() end, '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')`,
          [id, email, confirmed],
        );
        return id;
      };
      await make(`report-u-${tag}@example.com`, false);
      const founder = await make(`report-c-${tag}@example.com`, true);
      await make(`report-s-${tag}@${PILOT.slug}.shift.invalid`, true);
      const other = await organizationId(client, OTHER.slug);
      // Created now too, so the 24-hour and per-day organization figures see it.
      await client.query('update organizations set founded_by = $1, created_at = now() where id = $2', [founder, other]);
      await runOperatorScript(client, 'suspend-organization.sql', OTHER.slug);
      await client.query(
        `insert into private.organization_attempts (auth_user_id, attempted_at)
         select $1, now() - make_interval(mins => n) from generate_series(1, 25) as n`,
        [founder],
      );
      const after = await report();

      // The hook's ceiling counts every memberless account, the synthesized one too.
      expect(after.last_24_hours.accounts_without_member - before.last_24_hours.accounts_without_member).toBe(3);
      // The organization ceiling's figures count it, once (`founded_by` set, created now).
      expect(after.last_24_hours.organizations_founded - before.last_24_hours.organizations_founded).toBe(1);
      const foundedOf = (rows: Report['organizations_by_day']): number => rows.reduce((total, row) => total + row.founded, 0);
      expect(foundedOf(after.organizations_by_day) - foundedOf(before.organizations_by_day)).toBe(1);
      // `founded_by` alone makes an organization signup-founded here.
      const listed = after.organizations_founded_by_signup.find((entry) => entry.slug === OTHER.slug);
      expect(listed?.suspended).toBe(true);
      expect(listed?.members).toBeGreaterThan(0);
      // The email identities only, with their state.
      // (Both share the transaction's now(), so they are compared by address.)
      const recent = after.recent_accounts
        .filter((entry) => entry.email.endsWith(`-${tag}@example.com`))
        .sort((left, right) => left.email.localeCompare(right.email));
      expect(recent.map((entry) => [entry.email, entry.confirmed_at !== null, entry.with_member])).toEqual([
        [`report-c-${tag}@example.com`, true, false],
        [`report-u-${tag}@example.com`, false, false],
      ]);
      expect(after.recent_accounts.some((entry) => entry.email.includes('.shift.invalid'))).toBe(false);
      expect(sum(after.accounts_by_day, 'created') - sum(before.accounts_by_day, 'created')).toBe(2);
      expect(sum(after.accounts_by_day, 'confirmed') - sum(before.accounts_by_day, 'confirmed')).toBe(1);
      expect(sum(after.accounts_by_day, 'with_member') - sum(before.accounts_by_day, 'with_member')).toBe(0);
      expect(after.most_attempts[0]).toMatchObject({ account: founder, attempts_24_hours: 25, attempts_30_days: 25 });
    });
  });
});
