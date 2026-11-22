import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { FIXTURES, connect, inRolledBackTransaction, noDatabase, organizationId } from './database.ts';

/**
 * STORY 19.5 (AD-25, D-S7; checklist rows F1, F2, F3): the daily
 * `housekeeping` job deletes unconfirmed accounts after 7 days and confirmed
 * accounts that never founded an organization after 30, and NEVER an account
 * that has a `members` row, a synthesized (username) account, or an account
 * with no readable address.
 *
 * DB-CONNECTING, and written UNRUN (the STRICT DATABASE RULE): CI's fresh
 * stack is its first run. Every case but the two lock races runs in ONE
 * rolled-back transaction, so the job's deletions there are never committed;
 * the races commit one account on their own connection and delete it in
 * `finally`, best-effort. Every scene is built as the owner (no case switches
 * role: the job is executable by no session role, which the catalog case
 * proves).
 */

const PILOT = FIXTURES[0];
const OTHER = FIXTURES[1];

interface Counts {
  readonly unconfirmed_accounts: number;
  readonly confirmed_accounts: number;
  readonly organization_attempts: number;
  readonly failed: number;
}

const NOTHING: Counts = { unconfirmed_accounts: 0, confirmed_accounts: 0, organization_attempts: 0, failed: 0 };

/**
 * An account as the OWNER, created `createdDaysAgo` days ago and confirmed
 * `confirmedDaysAgo` days ago (null: unconfirmed), with its email identity
 * row, as GoTrue would leave it. `sentDaysAgo` is its last confirmation link
 * (a repeat signup re-sends it and keeps `created_at`), and `neverSent`
 * leaves `confirmation_sent_at` null; `banned` bans it for a year.
 */
async function account(
  client: Client,
  email: string | null,
  createdDaysAgo: number,
  confirmedDaysAgo: number | null,
  options: { sentDaysAgo?: number; neverSent?: boolean; banned?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, email_confirmed_at, confirmation_sent_at, banned_until,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       case when $4::int is null then null else now() - make_interval(days => $4::int) end,
       case when $7::boolean then null else now() - make_interval(days => coalesce($5::int, $3::int)) end,
       case when $6::boolean then now() + interval '1 year' end,
       '{}'::jsonb, '{}'::jsonb, now() - make_interval(days => $3::int), now(), '', '', '', ''
     )`,
    [
      id,
      email?.replace('<id>', id) ?? null,
      createdDaysAgo,
      confirmedDaysAgo,
      options.sentDaysAgo ?? null,
      options.banned ?? false,
      options.neverSent ?? false,
    ],
  );
  await client.query(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text), 'email', now(), now())`,
    [id],
  );
  return id;
}

/**
 * A member row for an email identity, as the owner: through 0071's founding
 * setting (D5), with the username its address derives (0068), as
 * `create_organization` writes it.
 */
async function memberFor(client: Client, organization: string, authUserId: string): Promise<void> {
  await client.query("select set_config('shift.founding_account', $1, true)", [authUserId]);
  await client.query(
    `insert into members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)
     select $1, u.id, 'Housekeeping Case', private.email_identity_username(u.email), null, 'member_role', 20
       from auth.users u
      where u.id = $2`,
    [organization, authUserId],
  );
  await client.query("select set_config('shift.founding_account', '', true)");
}

async function housekeeping(client: Client): Promise<Counts> {
  const { rows } = await client.query<{ counts: Counts }>('select private.delete_abandoned_accounts() as counts');
  return rows[0]?.counts ?? { unconfirmed_accounts: -1, confirmed_accounts: -1, organization_attempts: -1, failed: -1 };
}

/**
 * What the job should delete, counted as the owner just before it runs, by
 * the rule AD-25 (as amended by 19.5) states: the counts it returns must
 * equal these exactly, so a count attributed to the wrong kind fails.
 */
async function expectedCounts(client: Client): Promise<Counts> {
  const { rows } = await client.query<Counts>(
    `select count(*) filter (where u.email_confirmed_at is null)::int as unconfirmed_accounts,
            count(*) filter (where u.email_confirmed_at is not null)::int as confirmed_accounts,
            (select count(*)::int from private.organization_attempts a where a.attempted_at < now() - interval '30 days') as organization_attempts,
            0 as failed
       from auth.users u
      where private.address_kind(u.email) = 'email'
        and (u.banned_until is null or u.banned_until <= now())
        and not exists (select 1 from members m where m.auth_user_id = u.id)
        and not exists (select 1 from organizations o where o.founded_by = u.id)
        and ((u.email_confirmed_at is null
              and greatest(u.created_at, coalesce(u.confirmation_sent_at, u.created_at)) < now() - interval '7 days')
             or u.email_confirmed_at < now() - interval '30 days')`,
  );
  return rows[0] ?? NOTHING;
}

async function exists(client: Client, id: string): Promise<boolean> {
  const { rows } = await client.query<{ found: boolean }>('select exists (select 1 from auth.users where id = $1) as found', [id]);
  return rows[0]?.found ?? false;
}

async function countOf(client: Client, sql: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(sql);
  return rows[0]?.n ?? -1;
}

describe('the housekeeping job (story 19.5, AD-25, D-S7)', () => {
  it.skipIf(noDatabase)('deletes a stale email identity with no member row, past 7 days unconfirmed or 30 days confirmed, and nothing else (F1)', async () => {
    await inRolledBackTransaction(async (client) => {
      const pilot = await organizationId(client, PILOT.slug);
      const other = await organizationId(client, OTHER.slug);
      const tag = randomUUID().slice(0, 8);
      // THE SCENE, AS THE OWNER.
      const doomed = {
        unconfirmed8: await account(client, `hk-u8-<id>@example.com`, 8, null),
        confirmed31: await account(client, `hk-c31-<id>@example.com`, 40, 31),
        // A link re-sent 9 days ago is as stale as the account.
        resentLongAgo: await account(client, `hk-rs9-<id>@example.com`, 40, null, { sentDaysAgo: 9 }),
        // No link recorded: the 7 days run from the creation alone.
        neverSent8: await account(client, `hk-ns8-<id>@example.com`, 8, null, { neverSent: true }),
      };
      const kept = {
        unconfirmed6: await account(client, `hk-u6-<id>@example.com`, 6, null),
        neverSent6: await account(client, `hk-ns6-<id>@example.com`, 6, null, { neverSent: true }),
        // A repeat signup re-sent the link 2 days ago: its owner holds a live link.
        resentRecently: await account(client, `hk-rs2-<id>@example.com`, 40, null, { sentDaysAgo: 2 }),
        // An account the operator banned keeps its evidence.
        bannedConfirmed: await account(client, `hk-bc-<id>@example.com`, 40, 31, { banned: true }),
        bannedUnconfirmed: await account(client, `hk-bu-<id>@example.com`, 40, null, { banned: true }),
        confirmed29: await account(client, `hk-c29-<id>@example.com`, 40, 29),
        // Created long ago but confirmed recently: the 30 days run from the confirmation.
        confirmedLate: await account(client, `hk-cl-<id>@example.com`, 90, 2),
        memberConfirmed: await account(client, `hk-mc-<id>@example.com`, 40, 31),
        memberUnconfirmed: await account(client, `hk-mu-<id>@example.com`, 40, null),
        synthesizedUnconfirmed: await account(client, `hk-su-${tag}@${PILOT.slug}.shift.invalid`, 40, null),
        synthesizedConfirmed: await account(client, `hk-sc-${tag}@${OTHER.slug}.shift.invalid`, 40, 31),
        synthesizedOdd: await account(client, `HK-SO-${tag}@Sub.Shift.Invalid.`, 40, 31),
        synthesizedMember: await account(client, `hk-sm-${tag}@${PILOT.slug}.shift.invalid`, 40, 31),
        noAddress: await account(client, null, 40, null),
        malformed: await account(client, 'not-an-address-<id>', 40, null),
        founder: await account(client, `hk-f-<id>@example.com`, 40, 31),
      };
      await memberFor(client, pilot, kept.memberConfirmed);
      await memberFor(client, pilot, kept.memberUnconfirmed);
      await client.query(
        `insert into members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)
         values ($1, $2, 'Housekeeping Case', $3, null, 'member_role', 20)`,
        [pilot, kept.synthesizedMember, `hk-sm-${tag}`],
      );
      // An organization founded by an account that holds no member row (its
      // founder's row gone): "never founded an organization" is false.
      await client.query('update organizations set founded_by = $1 where id = $2', [kept.founder, other]);
      await client.query(
        `insert into private.organization_attempts (auth_user_id, attempted_at)
         values ($1, now() - interval '31 days'), ($1, now() - interval '29 days')`,
        [kept.founder],
      );

      const memberAccounts = await client.query<{ id: string }>('select auth_user_id::text as id from members order by 1');
      const members = await countOf(client, 'select count(*)::int as n from members');
      const organizations = await countOf(client, 'select count(*)::int as n from organizations');
      const synthesized = await countOf(client, "select count(*)::int as n from auth.users where private.address_kind(email) = 'synthesized'");

      const expected = await expectedCounts(client);
      expect(expected.unconfirmed_accounts, 'this case’s unconfirmed doomed accounts are not candidates').toBeGreaterThanOrEqual(2);
      expect(expected.confirmed_accounts).toBeGreaterThanOrEqual(1);
      const counts = await housekeeping(client);
      expect(counts, 'the job’s counts are not exactly what it deleted, by kind').toEqual(expected);

      for (const [label, id] of Object.entries(doomed)) expect(await exists(client, id), `${label} survived`).toBe(false);
      for (const [label, id] of Object.entries(kept)) expect(await exists(client, id), `${label} was deleted`).toBe(true);
      // GoTrue's foreign keys took the identities with the accounts.
      expect(await countOf(client, 'select count(*)::int as n from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id)')).toBe(0);
      // Every account with a member row, every member and organization, every synthesized account.
      expect((await client.query<{ id: string }>('select auth_user_id::text as id from members order by 1')).rows).toEqual(memberAccounts.rows);
      expect(await countOf(client, 'select count(*)::int as n from members')).toBe(members);
      expect(await countOf(client, 'select count(*)::int as n from organizations')).toBe(organizations);
      expect(await countOf(client, "select count(*)::int as n from auth.users where private.address_kind(email) = 'synthesized'")).toBe(synthesized);
      // The attempts: older than 30 days gone, the rest kept.
      const { rows: attempts } = await client.query<{ recent: boolean }>(
        "select attempted_at > now() - interval '30 days' as recent from private.organization_attempts where auth_user_id = $1",
        [kept.founder],
      );
      expect(attempts).toEqual([{ recent: true }]);

      // A second run finds nothing left to delete.
      expect(await housekeeping(client)).toEqual(NOTHING);
      for (const [label, id] of Object.entries(kept)) expect(await exists(client, id), `${label} was deleted on the second run`).toBe(true);
    });
  });

  it.skipIf(noDatabase)('counts an account whose delete fails as failed, and still deletes the rest (one subtransaction each)', async () => {
    await inRolledBackTransaction(async (client) => {
      const poisoned = await account(client, `hk-poison-<id>@example.com`, 8, null);
      const doomed = await account(client, `hk-poison-ok-<id>@example.com`, 8, null);
      // A row restricting the delete, as a future foreign key without a
      // cascade would: the account's delete raises 23503. (A temporary table
      // may not reference auth.users; this one goes with the rollback.)
      await client.query('create table private.housekeeping_poison (user_id uuid references auth.users (id))');
      await client.query('insert into private.housekeeping_poison (user_id) values ($1)', [poisoned]);
      const expected = await expectedCounts(client);
      const counts = await housekeeping(client);
      expect(counts).toEqual({ ...expected, unconfirmed_accounts: expected.unconfirmed_accounts - 1, failed: 1 });
      expect(await exists(client, poisoned), 'the failing account was deleted').toBe(true);
      expect(await exists(client, doomed), 'one failing account undid the others').toBe(false);
    });
  });

  it.skipIf(noDatabase)('deletes nothing and fails HOUSEKEEPING_HALTED above its ceiling, and runs once the operator raises it (circuit breaker)', async () => {
    await inRolledBackTransaction(async (client) => {
      const stale = await account(client, `hk-halt-<id>@example.com`, 8, null);
      const attempt = await account(client, `hk-halt-a-<id>@example.com`, 2, null);
      await client.query(
        "insert into private.organization_attempts (auth_user_id, attempted_at) values ($1, now() - interval '31 days')",
        [attempt],
      );
      const candidates = (await expectedCounts(client)).unconfirmed_accounts + (await expectedCounts(client)).confirmed_accounts;
      expect(candidates).toBeGreaterThanOrEqual(1);
      // One below the count: the job must refuse, deleting nothing at all.
      await client.query("select set_config('shift.housekeeping_ceiling', $1, true)", [String(candidates - 1)]);
      await client.query('savepoint halted');
      const refused = await client.query('select private.delete_abandoned_accounts()').then(
        () => null,
        (cause: unknown) => cause as { code?: string; message?: string; detail?: string },
      );
      await client.query('rollback to savepoint halted');
      expect(refused?.code).toBe('23514');
      expect(refused?.message).toBe('HOUSEKEEPING_HALTED');
      expect(refused?.detail).toBe(`${candidates} candidates, ceiling ${candidates - 1}`);
      expect(await exists(client, stale), 'a halted run deleted an account').toBe(true);
      expect(await countOf(client, `select count(*)::int as n from private.organization_attempts where auth_user_id = '${attempt}'`)).toBe(1);
      // At the count exactly, it runs.
      await client.query("select set_config('shift.housekeeping_ceiling', $1, true)", [String(candidates)]);
      const counts = await housekeeping(client);
      expect(counts.unconfirmed_accounts + counts.confirmed_accounts).toBe(candidates);
      expect(await exists(client, stale)).toBe(false);
      await client.query("select set_config('shift.housekeeping_ceiling', '', true)");
    });
  });

  it.skipIf(noDatabase)('never deletes a Founding Admin made by create_organization, however old its confirmation (its member row keeps it; F1)', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('update private.signup_settings set open = true, organizations_per_day = 1000, attempts_per_account = 1000 where id');
      const founder = await account(client, `hk-founder-<id>@example.com`, 60, 45);
      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: founder, role: 'authenticated' }),
      ]);
      await client.query('set local role authenticated');
      const { rows } = await client.query<{ answer: { code: string } }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6, $7, $8) as answer`,
        ['Udruga Primjer', `hk-${randomUUID().slice(0, 8)}`, 'Udruga', 'Europe/Zagreb', 1, 1, 'Ivana Horvat', 20],
      );
      await client.query('reset role');
      await client.query("select set_config('request.jwt.claims', '', true)");
      expect(rows[0]?.answer.code).toBe('ORGANIZATION_CREATED');

      await housekeeping(client);
      expect(await exists(client, founder)).toBe(true);
      expect(await countOf(client, `select count(*)::int as n from members where auth_user_id = '${founder}'`)).toBe(1);
    });
  });

  it.skipIf(noDatabase)('skips an account another transaction holds, as create_organization’s step 1 or a member insert would (F2)', async () => {
    const owner = await connect();
    const holder = await connect();
    let candidate = '';
    try {
      // Committed, so the second connection sees it: a stale, confirmed email
      // identity, written in one transaction so a failure leaves nothing behind.
      await owner.query('begin');
      const made = await account(owner, `hk-race-<id>@example.com`, 40, 31);
      await owner.query('commit');
      candidate = made;
      const pilot = await organizationId(owner, PILOT.slug);

      for (const hold of [
        // AD-23 step 1: `create_organization` locks the caller's row first.
        async () => {
          await holder.query('select id from auth.users where id = $1 for update', [candidate]);
        },
        // A member insert's foreign key check holds a key share lock on the account.
        async () => {
          await memberFor(holder, pilot, candidate);
        },
      ]) {
        await holder.query('begin');
        await hold();
        await inRolledBackTransaction(async (client) => {
          await housekeeping(client);
          expect(await exists(client, candidate), 'a held account was deleted').toBe(true);
        });
        await holder.query('rollback');
      }

      // Released, the same account is deleted (rolled back: the finally removes it).
      await inRolledBackTransaction(async (client) => {
        await housekeeping(client);
        expect(await exists(client, candidate)).toBe(false);
      });
    } finally {
      await holder.query('rollback').catch(() => undefined);
      // Outside a transaction this only warns; inside a failed one it ends it.
      await owner.query('rollback').catch(() => undefined);
      if (candidate !== '') {
        try {
          await owner.query('delete from auth.users where id = $1', [candidate]);
        } catch (cause) {
          console.error('housekeeping race cleanup (account)', cause);
        }
      }
      await Promise.allSettled([owner.end(), holder.end()]);
    }
  }, 30_000);

  it.skipIf(noDatabase)('is executable by no session role and scheduled daily at 03:15 UTC (F3)', async () => {
    const client = await connect();
    try {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const { rows } = await client.query<{ granted: boolean }>(
          "select has_function_privilege($1, 'private.delete_abandoned_accounts()', 'execute') as granted",
          [role],
        );
        expect(rows[0]?.granted, `${role} may execute the job`).toBe(false);
      }
      const { rows: definer } = await client.query<{ definer: boolean; config: string[] | null }>(
        "select prosecdef as definer, proconfig as config from pg_proc where oid = 'private.delete_abandoned_accounts()'::regprocedure",
      );
      expect(definer[0]?.definer).toBe(true);
      expect(definer[0]?.config).toContain('search_path=""');
      const { rows: job } = await client.query<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'housekeeping'",
      );
      expect(job).toEqual([{ schedule: '15 3 * * *', command: 'select private.delete_abandoned_accounts()' }]);
      // pg_cron runs the job as the role that scheduled it: that role, the
      // definer's owner, must be able to delete accounts.
      const { rows: runner } = await client.query<{ deletes: boolean; owns: boolean }>(
        `select has_table_privilege(j.username, 'auth.users', 'delete') as deletes,
                pg_get_userbyid(p.proowner) = j.username as owns
           from cron.job j, pg_proc p
          where j.jobname = 'housekeeping' and p.oid = 'private.delete_abandoned_accounts()'::regprocedure`,
      );
      expect(runner).toEqual([{ deletes: true, owns: true }]);
    } finally {
      await client.end();
    }
  });
});
