import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { FIXTURES, connect, inRolledBackTransaction, noDatabase, organizationId } from './database.ts';

/**
 * STORY 19.3 (AD-23, AD-10, AD-11; checklist B6, B7, D1–D7, E4): a verified
 * account founds its organization through `public.create_organization`
 * (0071), and the organization it founds is isolated as any other.
 *
 * DB-CONNECTING, and written UNRUN (the STRICT DATABASE RULE): CI's fresh
 * stack is its first run. Every case but the race runs in one rolled-back
 * transaction; the race commits on two connections and deletes what it made.
 * Every scene that writes `auth.users`, `signup_settings` or past a policy is
 * built as the OWNER, before the case's first `actAs`. Each expected code and
 * message is 0071's own `raise` or constraint.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PILOT = FIXTURES[0];
const OTHER = FIXTURES[1];

const SIGNATURE = 'public.create_organization(text, text, text, text, integer, integer, text, integer)';
const CALL = 'select public.create_organization($1, $2, $3, $4, $5, $6, $7, $8) as answer';

const TIMEZONES = JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', 'known-timezones.json'), 'utf8')) as {
  accepted: string[];
  refused: string[];
};

interface Input {
  name: string | null;
  slug: string | null;
  type: string | null;
  timezone: string | null;
  month: number | null;
  day: number | null;
  admin: string | null;
  allowance: number | null;
}

function input(overrides: Partial<Input> = {}): Input {
  return {
    name: 'Tvrtka Primjer',
    slug: `tvrtka-${randomUUID().slice(0, 8)}`,
    type: 'Udruga',
    timezone: 'Europe/Zagreb',
    month: 1,
    day: 1,
    admin: 'Ivana Horvat',
    allowance: 20,
    ...overrides,
  };
}

function parameters(value: Input): unknown[] {
  return [value.name, value.slug, value.type, value.timezone, value.month, value.day, value.admin, value.allowance];
}

/** A signup's account as the OWNER: confirmed by default, an email identity's address. */
async function account(
  client: Client,
  options: { address?: string; confirmed?: boolean; appMetadata?: Record<string, unknown>; bannedUntil?: string } = {},
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = (options.address ?? 'Founder.<id>@Example.com').replace('<id>', id);
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, email_confirmed_at, banned_until,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       case when $3::boolean then now() end, $4::timestamptz, $5::jsonb, '{}'::jsonb,
       now(), now(), '', '', '', ''
     )`,
    [id, email, options.confirmed ?? true, options.bannedUntil ?? null, JSON.stringify(options.appMetadata ?? {})],
  );
  return { id, email };
}

/** The door open and the limits known, as the owner (rolled back with the case). */
async function door(client: Client, settings: { open?: boolean; perDay?: number; perAccount?: number } = {}): Promise<void> {
  await client.query(
    'update private.signup_settings set open = $1, organizations_per_day = $2, attempts_per_account = $3 where id',
    [settings.open ?? true, settings.perDay ?? 1000, settings.perAccount ?? 1000],
  );
}

/**
 * Become the claimless account, as PostgREST would make it: `set local role
 * authenticated` with the claims (review of 19.3: so 0035's stale-admin
 * re-check, which fires only for `authenticated` at depth 1, runs exactly as
 * through PostgREST). No `request.path`: a direct call.
 */
async function actAs(client: Client, authUserId: string, claims: Record<string, unknown> = {}): Promise<void> {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: authUserId, role: 'authenticated', ...claims }),
  ]);
  await client.query('set local role authenticated');
}

async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
}

type Answer = { answer: Record<string, unknown> } | { code: string; message: string; detail: string | undefined };

async function create(client: Client, value: Input): Promise<Answer> {
  await client.query('savepoint attempt');
  try {
    const { rows } = await client.query<{ answer: Record<string, unknown> }>(CALL, parameters(value));
    await client.query('release savepoint attempt');
    return { answer: rows[0]?.answer ?? {} };
  } catch (cause) {
    await client.query('rollback to savepoint attempt');
    const { code, message, detail } = cause as { code?: string; message?: string; detail?: string };
    return { code: code ?? '', message: message ?? '', detail };
  }
}

async function attempts(client: Client, authUserId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    'select count(*)::int as n from private.organization_attempts where auth_user_id = $1',
    [authUserId],
  );
  return rows[0]?.n ?? 0;
}

const NOT_CREATABLE = { code: '42501', message: 'ORGANIZATION_NOT_CREATABLE', detail: undefined };

describe('create_organization: who may call it (D1, D2)', () => {
  it.skipIf(noDatabase)('takes no id or address, runs as the owner with an empty search path, and is authenticated’s alone', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{
        names: string[];
        definer: boolean;
        config: string[] | null;
        anon: boolean;
        authenticated: boolean;
        service: boolean;
        public: boolean;
      }>(
        `select p.proargnames as names, p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('service_role', p.oid, 'execute') as service,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
           from pg_proc p where p.oid = $1::regprocedure`,
        [SIGNATURE],
      );
      expect(rows[0]?.names).toEqual([
        'p_name',
        'p_slug',
        'p_organization_type',
        'p_timezone',
        'p_leave_year_start_month',
        'p_leave_year_start_day',
        'p_admin_name',
        'p_admin_leave_allowance_days',
      ]);
      expect(rows[0]?.definer).toBe(true);
      expect(rows[0]?.config).toContain('search_path=""');
      expect(rows[0]).toMatchObject({ anon: false, authenticated: true, service: false, public: false });

      // B7 and E4: nothing new for anon, nothing on the attempts, and no session writes founded_by.
      const { rows: privileges } = await client.query<{ role: string; privileged: boolean }>(
        `select r as role,
                has_table_privilege(r, 'private.organization_attempts', 'select')
             or has_table_privilege(r, 'private.organization_attempts', 'insert')
             or has_table_privilege(r, 'private.organization_attempts', 'update')
             or has_table_privilege(r, 'private.organization_attempts', 'delete') as privileged
           from unnest(array['anon', 'authenticated', 'service_role']) as r`,
      );
      expect(privileges.filter((row) => row.privileged)).toEqual([]);
      // E4: `authenticated` holds no UPDATE on founded_by (0004's column grants).
      // `anon` keeps the default table grant and meets no update policy;
      // `service_role` is the secret key's trusted role (AD-17).
      const { rows: founded } = await client.query<{ writable: boolean }>(
        "select has_column_privilege('authenticated', 'public.organizations', 'founded_by', 'update') as writable",
      );
      expect(founded[0]?.writable).toBe(false);
      for (const name of ['is_known_timezone(text)', 'forget_password_on_confirmation()']) {
        const { rows: grants } = await client.query<{ any: boolean }>(
          `select has_function_privilege('anon', $1::regprocedure, 'execute')
               or has_function_privilege('authenticated', $1::regprocedure, 'execute')
               or has_function_privilege('service_role', $1::regprocedure, 'execute') as any`,
          [`private.${name}`],
        );
        expect(grants[0]?.any, name).toBe(false);
      }
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('refuses every caller it may not serve with one code, and counts none of them', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const pilot = await organizationId(client, PILOT.slug);
      const unconfirmed = await account(client, { confirmed: false });
      const username = await account(client, { address: `ivan.<id>@${PILOT.slug}.shift.invalid` });
      const flagged = await account(client, { appMetadata: { must_set_password: true } });
      const banned = await account(client, { bannedUntil: '2999-01-01T00:00:00Z' });
      const member = await account(client);
      await client.query("select set_config('shift.founding_account', $1, true)", [member.id]);
      await client.query(
        `insert into public.members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)
         values ($1, $2, 'Već član', private.email_identity_username($3), $3, 'member_role', 20)`,
        [pilot, member.id, member.email],
      );
      await client.query("select set_config('shift.founding_account', '', true)");

      for (const caller of [unconfirmed, username, flagged, banned, member]) {
        await actAs(client, caller.id);
        expect(await create(client, input()), caller.email).toEqual(NOT_CREATABLE);
        await actAsOwner(client);
        expect(await attempts(client, caller.id), `${caller.email} was counted`).toBe(0);
      }

      // No account at all, and nothing counted for it.
      const nobody = randomUUID();
      await actAs(client, nobody);
      expect(await create(client, input())).toEqual(NOT_CREATABLE);
      await actAsOwner(client);
      expect(await attempts(client, nobody)).toBe(0);
    });
  });

  it.skipIf(noDatabase)('refuses through rpc/graphql, and passes its own route (D4)', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const founder = await account(client);
      await actAs(client, founder.id);
      await client.query("select set_config('request.path', '/rpc/graphql', true)");
      expect(await create(client, input())).toEqual(NOT_CREATABLE);
      await client.query("select set_config('request.path', '/rpc/create_organization', true)");
      const answer = await create(client, input());
      expect('answer' in answer && answer.answer['code']).toBe('ORGANIZATION_CREATED');
    });
  });
});

describe('create_organization: the input (D10), refused before anything is counted', () => {
  it.skipIf(noDatabase).each([
    { field: 'name', overrides: { name: ' \t ' } },
    { field: 'name', overrides: { name: 'a'.repeat(101) } },
    { field: 'slug', overrides: { slug: 'Tvrtka' } },
    { field: 'slug', overrides: { slug: 'a--b' } },
    { field: 'organization_type', overrides: { type: null } },
    { field: 'leave_year_start', overrides: { day: 29 } },
    { field: 'leave_year_start', overrides: { month: null } },
    { field: 'admin_name', overrides: { admin: '' } },
    { field: 'admin_leave_allowance_days', overrides: { allowance: -1 } },
    { field: 'admin_leave_allowance_days', overrides: { allowance: 40000 } },
  ] as { field: string; overrides: Partial<Input> }[])('refuses $field ($overrides)', async ({ field, overrides }) => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const founder = await account(client);
      await actAs(client, founder.id);
      expect(await create(client, input(overrides))).toEqual({ code: '22023', message: 'ORGANIZATION_INPUT_INVALID', detail: field });
      await actAsOwner(client);
      expect(await attempts(client, founder.id)).toBe(0);
    });
  });

  it.skipIf(noDatabase)('refuses a timezone private.is_known_timezone refuses, and agrees with the parity vector', async () => {
    await inRolledBackTransaction(async (client) => {
      for (const zone of TIMEZONES.accepted) {
        const { rows } = await client.query<{ known: boolean }>('select private.is_known_timezone($1) as known', [zone]);
        expect(rows[0]?.known, zone).toBe(true);
      }
      for (const zone of TIMEZONES.refused) {
        const { rows } = await client.query<{ known: boolean }>('select private.is_known_timezone($1) as known', [zone]);
        expect(rows[0]?.known, JSON.stringify(zone)).toBe(false);
      }

      await door(client);
      const founder = await account(client);
      await actAs(client, founder.id);
      expect(await create(client, input({ timezone: 'UTC' }))).toEqual({
        code: '22023',
        message: 'ORGANIZATION_TIMEZONE_UNKNOWN',
        detail: undefined,
      });
    });
  });
});

describe('create_organization: the limits are returned, and their attempt commits (D4 of the checklist)', () => {
  it.skipIf(noDatabase)('answers TRY_LATER for a shut door, and writes the attempt', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client, { open: false });
      const founder = await account(client);
      await actAs(client, founder.id);
      expect(await create(client, input())).toEqual({ answer: { code: 'TRY_LATER' } });
      await actAsOwner(client);
      expect(await attempts(client, founder.id)).toBe(1);
    });
  });

  it.skipIf(noDatabase)('answers TRY_LATER past the account’s attempts, and at the 24-hour ceiling', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client, { perAccount: 1 });
      const founder = await account(client);
      await actAs(client, founder.id);
      // The first attempt is a taken slug (counted); the second is over the limit.
      expect(await create(client, input({ slug: PILOT.slug }))).toMatchObject({ answer: { code: 'SLUG_UNAVAILABLE' } });
      expect(await create(client, input())).toEqual({ answer: { code: 'TRY_LATER' } });
      await actAsOwner(client);
      expect(await attempts(client, founder.id)).toBe(2);

      await door(client, { perDay: 1 });
      const first = await account(client);
      const second = await account(client);
      await actAs(client, first.id);
      expect(await create(client, input())).toMatchObject({ answer: { code: 'ORGANIZATION_CREATED' } });
      await actAsOwner(client);
      await actAs(client, second.id);
      expect(await create(client, input())).toEqual({ answer: { code: 'TRY_LATER' } });
    });
  });
});

describe('create_organization: the slug (B6)', () => {
  it.skipIf(noDatabase)('answers a taken and a reserved slug alike, with a free proposal, and counts both', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const founder = await account(client);
      await actAs(client, founder.id);

      const taken = await create(client, input({ slug: PILOT.slug }));
      const reserved = await create(client, input({ slug: 'admin' }));
      expect(taken).toEqual({ answer: { code: 'SLUG_UNAVAILABLE', proposal: `${PILOT.slug}-2` } });
      expect(reserved).toEqual({ answer: { code: 'SLUG_UNAVAILABLE', proposal: 'admin-2' } });
      expect(Object.keys('answer' in taken ? taken.answer : {}).sort()).toEqual(
        Object.keys('answer' in reserved ? reserved.answer : {}).sort(),
      );
      await actAsOwner(client);
      expect(await attempts(client, founder.id)).toBe(2);
      // The reserved slugs cannot be provisioned either.
      await client.query('savepoint reserved');
      await expect(
        client.query(
          `insert into public.organizations (slug, name, organization_type, timezone, locale, leave_year_start_month, leave_year_start_day)
           values ('www', 'X', 'Y', 'Europe/Zagreb', 'hr', 1, 1)`,
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'organizations_slug_not_reserved' });
      await client.query('rollback to savepoint reserved');
    });
  });

  it.skipIf(noDatabase)('proposes the next free suffix, and a random one when -2 … -9 are taken', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const base = `zauzeto-${randomUUID().slice(0, 6)}`;
      for (const slug of [base, ...Array.from({ length: 8 }, (_, index) => `${base}-${String(index + 2)}`)]) {
        await client.query(
          `insert into public.organizations (slug, name, organization_type, timezone, locale, leave_year_start_month, leave_year_start_day)
           values ($1, 'Zauzeto', 'Tip', 'Europe/Zagreb', 'hr', 1, 1)`,
          [slug],
        );
      }
      const founder = await account(client);
      await actAs(client, founder.id);
      const answer = await create(client, input({ slug: base }));
      expect(answer).toMatchObject({ answer: { code: 'SLUG_UNAVAILABLE' } });
      const proposal = 'answer' in answer ? String(answer.answer['proposal']) : '';
      expect(proposal).toMatch(new RegExp(`^${base}-[a-z0-9]{4}$`));
    });
  });
});

describe('create_organization: the organization it founds (D5 of the checklist, AD-11)', () => {
  it.skipIf(noDatabase)('writes the organization and its Founding Admin, and nothing beyond annual leave', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const founder = await account(client);
      const value = input();
      await actAs(client, founder.id);
      const created = await create(client, value);
      expect(created).toMatchObject({ answer: { code: 'ORGANIZATION_CREATED', slug: value.slug } });
      const organization = 'answer' in created ? String(created.answer['organizationId']) : '';
      // A second call: the account has its row now.
      expect(await create(client, input())).toEqual(NOT_CREATABLE);
      await actAsOwner(client);

      const { rows: org } = await client.query<Record<string, unknown>>(
        `select slug, name, organization_type, timezone, locale, leave_year_start_month, leave_year_start_day,
                founded_by::text, short_name, description, address, contact_email
           from public.organizations where id = $1`,
        [organization],
      );
      expect(org[0]).toEqual({
        slug: value.slug,
        name: 'Tvrtka Primjer',
        organization_type: 'Udruga',
        timezone: 'Europe/Zagreb',
        locale: 'hr',
        leave_year_start_month: 1,
        leave_year_start_day: 1,
        founded_by: founder.id,
        short_name: null,
        description: null,
        address: null,
        contact_email: null,
      });
      const { rows: members } = await client.query<Record<string, unknown>>(
        'select auth_user_id::text, name, username, email, role, leave_allowance_days from public.members where organization_id = $1',
        [organization],
      );
      expect(members).toEqual([
        {
          auth_user_id: founder.id,
          name: 'Ivana Horvat',
          username: `founder.${founder.id}`,
          email: founder.email,
          role: 'admin',
          leave_allowance_days: 20,
        },
      ]);
      const { rows: counts } = await client.query<Record<string, number>>(
        `select (select count(*)::int from public.absence_types where organization_id = $1) as absence_types,
                (select count(*)::int from public.teams where organization_id = $1) as teams,
                (select count(*)::int from public.shift_types where organization_id = $1) as shift_types,
                (select count(*)::int from public.hour_bands where organization_id = $1) as hour_bands,
                (select count(*)::int from public.rotation_patterns where organization_id = $1) as rotation_patterns`,
        [organization],
      );
      expect(counts[0]).toEqual({ absence_types: 1, teams: 0, shift_types: 0, hour_bands: 0, rotation_patterns: 0 });

      // AD-11: both inserts recorded with the founding account as actor.
      const { rows: events } = await client.query<{ table_name: string; actor: string }>(
        `select table_name, actor::text from public.audit_events
          where organization_id = $1 and operation = 'INSERT' and table_name in ('organizations', 'members')
          order by table_name`,
        [organization],
      );
      expect(events).toEqual([
        { table_name: 'members', actor: founder.id },
        { table_name: 'organizations', actor: founder.id },
      ]);

      // The epic AC: the access token hook, called as GoTrue calls it on the
      // refresh, stamps the organization claim for the account just founded.
      const { rows: minted } = await client.query<{ claims: Record<string, unknown> }>(
        `select public.custom_access_token_hook(
                  jsonb_build_object('user_id', $1::text, 'claims', jsonb_build_object('role', 'authenticated'))
                ) -> 'claims' as claims`,
        [founder.id],
      );
      expect(minted[0]?.claims).toEqual({ role: 'authenticated', organization_id: organization });
    });
  });

  it.skipIf(noDatabase)('isolates the founded organization from the pilot, both ways, over every table with an organization', async () => {
    await inRolledBackTransaction(async (client) => {
      await door(client);
      const pilot = await organizationId(client, PILOT.slug);
      const founder = await account(client);
      await actAs(client, founder.id);
      const created = await create(client, input());
      const organization = 'answer' in created ? String(created.answer['organizationId']) : '';
      await actAsOwner(client);
      expect(organization).not.toBe('');

      const { rows: tables } = await client.query<{ name: string }>(
        `select c.table_name as name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'organization_id'
          order by c.table_name`,
      );
      expect(tables.length).toBeGreaterThanOrEqual(25);
      const { rows: admins } = await client.query<{ auth_user_id: string }>(
        "select auth_user_id::text from public.members where organization_id = $1 and username = $2",
        [pilot, PILOT.admin],
      );
      const pilotAdmin = admins[0]?.auth_user_id ?? '';

      for (const [subject, own, other] of [
        [founder.id, organization, pilot],
        [pilotAdmin, pilot, organization],
      ] as const) {
        await actAs(client, subject, { organization_id: own });
        for (const { name } of tables) {
          await client.query('savepoint read');
          try {
            const { rows } = await client.query<{ n: number }>(
              `select count(*)::int as n from public.${name} where organization_id = $1`,
              [other],
            );
            expect(rows[0]?.n, `${subject === founder.id ? 'the founder' : 'the pilot admin'} read ${name} of the other`).toBe(0);
            await client.query('release savepoint read');
          } catch (cause) {
            await client.query('rollback to savepoint read');
            // A refusal reads nothing; anything but a privilege refusal is a fault.
            if ((cause as { code?: string }).code !== '42501') throw cause;
          }
        }
        await actAsOwner(client);
      }
      // The founder reads its own organization, so the zeros above mean something.
      await actAs(client, founder.id, { organization_id: organization });
      const { rows: own } = await client.query<{ n: number }>('select count(*)::int as n from public.members');
      expect(own[0]?.n).toBe(1);
      await actAsOwner(client);
      expect(OTHER?.slug).toBeDefined();
    });
  });
});

describe('create_organization: one account founds one organization (D3)', () => {
  it.skipIf(noDatabase)('lets two concurrent calls from one account found exactly one organization', async () => {
    const owner = await connect();
    const first = await connect();
    const second = await connect();
    let founder = '';
    try {
      const { rows: open } = await owner.query<{ open: boolean }>('select open from private.signup_settings where id');
      expect(open[0]?.open, 'seed.sql no longer opens signup_settings').toBe(true);
      founder = (await account(owner)).id;

      const call = async (client: Client): Promise<Answer> => {
        await client.query('begin');
        await actAs(client, founder);
        const answer = await create(client, input());
        await client.query('commit');
        return answer;
      };
      const answers = await Promise.all([call(first), call(second)]);
      const created = answers.filter((answer) => 'answer' in answer && answer.answer['code'] === 'ORGANIZATION_CREATED');
      expect(created, JSON.stringify(answers)).toHaveLength(1);
      expect(answers.filter((answer) => 'code' in answer && answer.message === 'ORGANIZATION_NOT_CREATABLE')).toHaveLength(1);
      const { rows } = await owner.query<{ n: number }>('select count(*)::int as n from public.organizations where founded_by = $1', [founder]);
      expect(rows[0]?.n).toBe(1);
    } finally {
      // BEST-EFFORT, in foreign-key order, so a failing cleanup never masks
      // the case's own failure (review of 19.3). The organization cascades
      // its members and every scoped row; 0002's zero-admins constraint
      // trigger lets a member go with its organization; the account goes
      // last, and its attempts have no foreign key.
      if (founder !== '') {
        for (const [sql, label] of [
          ['delete from public.organizations where founded_by = $1', 'organization'],
          ['delete from private.organization_attempts where auth_user_id = $1', 'attempts'],
          ['delete from auth.users where id = $1', 'account'],
        ] as const) {
          try {
            await owner.query(sql, [founder]);
          } catch (cause) {
            console.error(`create-organization race cleanup (${label})`, cause);
          }
        }
      }
      await Promise.allSettled([owner.end(), first.end(), second.end()]);
    }
  }, 30_000);
});
