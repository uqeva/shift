import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { FIXTURES, connect, inRolledBackTransaction, localApiEndpoint, localSecretKey, noDatabase, organizationId } from './database.ts';

/**
 * STORY 19.2 (AD-12, AD-21, AD-22; checklist A5, B5, C2, C6; deferred-work's
 * live probe): a stranger creates an account on the local stack, through the
 * CLI's GoTrue with 0066's before-user-created hook on, and an email identity's
 * username cannot be renamed away from its address (0068).
 *
 * DB-CONNECTING, and written UNRUN (the STRICT DATABASE RULE): CI's fresh
 * stack, with the mail catcher running since this story, is its first run.
 * Locally it skips with no stack. It reaches GoTrue through the CLI's API
 * gateway, a plain proxy that passes GoTrue's own answers through; that is not
 * the gateway AD-22 describes, whose one answer is
 * `scripts/probe/signup-enumeration.mjs`'s, on 20.1's rehearsal stack and on
 * staging. `seed.sql` opens `private.signup_settings` on the local stack; the
 * first case asserts it, so a refusal below is the rule's and not a shut door.
 *
 * Every scene that writes `auth.users` or past a policy is built as the OWNER,
 * before the case's first `actAs`. Every account a live case creates is
 * deleted as the owner when the case ends.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiEndpoint = localApiEndpoint();
const adminKey = localSecretKey();
const noAdminApi = noDatabase || apiEndpoint === undefined || adminKey === undefined;

/** The CLI's mail catcher (`[local_smtp] port` in `config.toml`), Mailpit's API. */
const MAIL_CATCHER = 'http://127.0.0.1:54324';

const resource = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8'),
) as { signup: { email: { confirmation: { subject: string } } } };

/** A password over the floor, made per case so no literal credential sits in the file. */
function password(): string {
  return `signup-${randomUUID()}`;
}

function endpoint(): { url: string; key: string } {
  if (apiEndpoint === undefined) throw new Error('unreachable: gated by skipIf');
  return apiEndpoint;
}

async function auth(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${endpoint().url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: endpoint().key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed };
}

async function accountsAt(address: string): Promise<{ id: string; confirmed: boolean; members: number }[]> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ id: string; confirmed: boolean; members: number }>(
      `select u.id::text as id, u.email_confirmed_at is not null as confirmed,
              (select count(*)::int from public.members m where m.auth_user_id = u.id) as members
         from auth.users u
        where lower(u.email) = lower($1)`,
      [address],
    );
    return rows;
  } finally {
    await client.end();
  }
}

async function removeAccounts(address: string): Promise<void> {
  const client = await connect();
  try {
    await client.query('delete from auth.users where lower(email) = lower($1)', [address]);
  } finally {
    await client.end();
  }
}

/** The one mail the catcher holds for `address`, once it arrives. */
async function mailTo(address: string): Promise<{ subject: string; html: string }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(`${MAIL_CATCHER}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const found = (await search.json()) as { messages?: { ID: string }[] };
    const id = found.messages?.[0]?.ID;
    if (id !== undefined) {
      const message = (await (await fetch(`${MAIL_CATCHER}/api/v1/message/${id}`)).json()) as {
        Subject?: string;
        HTML?: string;
      };
      return { subject: message.Subject ?? '', html: message.HTML ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no mail reached the catcher for ${address}`);
}

/** As `test/schedule-inputs-parity.test.ts`: show a fresh token to PostgREST until its clock agrees. */
async function usableAfterIssue(token: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${endpoint().url}/rest/v1/organizations?select=id&limit=1`, {
      headers: { apikey: endpoint().key, authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    if (response.ok || !text.includes('PGRST303')) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

describe('a stranger creates an account through the hook (story 19.2, live probe)', () => {
  it.skipIf(noAdminApi)('runs with the local door open, as seed.sql leaves it', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ open: boolean }>('select open from private.signup_settings where id');
      expect(rows[0]?.open, 'seed.sql no longer opens signup_settings: every case below would meet a shut door').toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noAdminApi)('refuses a mixed-case .shift.invalid address with SIGNUP_REFUSED, and creates nothing', async () => {
    const address = `ana-${randomUUID()}@DVD.Shift.Invalid`;
    try {
      const answer = await auth('signup', { email: address, password: password() });

      expect(answer.status, JSON.stringify(answer.body)).toBe(403);
      expect(JSON.stringify(answer.body)).toContain('SIGNUP_REFUSED');
      expect(await accountsAt(address)).toEqual([]);
    } finally {
      await removeAccounts(address);
    }
  });

  it.skipIf(noAdminApi)(
    'creates an unconfirmed claimless account, mails a Croatian /potvrda link, and confirms only on its POST',
    async () => {
      const address = `signup-${randomUUID()}@example.com`;
      const secret = password();
      try {
        const signedUp = await auth('signup', { email: address, password: secret });
        expect(signedUp.status, JSON.stringify(signedUp.body)).toBe(200);

        const created = await accountsAt(address);
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ confirmed: false, members: 0 });

        // The right password on an unconfirmed address: `email_not_confirmed`,
        // which the SPA turns into *Potvrdi adresu e-pošte* (UX-DR63).
        const early = await auth('token?grant_type=password', { email: address, password: secret });
        expect(early.status, JSON.stringify(early.body)).toBe(400);
        expect(early.body['error_code'] ?? early.body['code']).toBe('email_not_confirmed');

        // The mail: the local Croatian template (19.1's deferral, OWNER 19.2).
        const mail = await mailTo(address);
        expect(mail.subject).toBe(resource.signup.email.confirmation.subject);
        const link = /\/potvrda\?token_hash=([0-9a-f]+)&amp;type=signup/.exec(mail.html);
        expect(link, mail.html.slice(0, 400)).not.toBeNull();
        const tokenHash = link?.[1] ?? '';
        expect(mail.html).not.toMatch(/\/auth\/v1\/verify\?/);

        // Nothing is confirmed by receiving the mail; the POST confirms.
        expect((await accountsAt(address))[0]?.confirmed).toBe(false);
        const verified = await auth('verify', { token_hash: tokenHash, type: 'signup' });
        expect(verified.status, JSON.stringify(verified.body)).toBe(200);
        expect((await accountsAt(address))[0]?.confirmed).toBe(true);

        // A claimless session: no organization claim, and PostgREST shows it nothing.
        const token = String(verified.body['access_token'] ?? '');
        const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
          string,
          unknown
        >;
        expect(claims['organization_id']).toBeUndefined();
        await usableAfterIssue(token);
        const read = await fetch(`${endpoint().url}/rest/v1/organizations?select=id`, {
          headers: { apikey: endpoint().key, authorization: `Bearer ${token}` },
        });
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual([]);

        // A spent link is dead.
        const again = await auth('verify', { token_hash: tokenHash, type: 'signup' });
        expect(again.status).toBeGreaterThanOrEqual(400);

        // B5: an unknown address and a wrong password answer alike.
        const unknown = await auth('token?grant_type=password', {
          email: `nobody-${randomUUID()}@example.com`,
          password: password(),
        });
        const wrong = await auth('token?grant_type=password', { email: address, password: password() });
        expect(unknown.status).toBe(400);
        expect(wrong.status).toBe(unknown.status);
        expect(wrong.body['error_code'] ?? wrong.body['code']).toBe(unknown.body['error_code'] ?? unknown.body['code']);
        expect(unknown.body['error_code'] ?? unknown.body['code']).toBe('invalid_credentials');

        // And the right one now signs the email identity in, as typed in another case.
        const signedIn = await auth('token?grant_type=password', { email: address.toUpperCase(), password: secret });
        expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
      } finally {
        await removeAccounts(address);
      }
    },
  );
});

// ------------------------------------------------------------------ 0068, C2

const PILOT = FIXTURES[0];

/** An email identity's account and member row in the pilot, as the OWNER. */
async function emailIdentityMember(client: Client, organization: string): Promise<{ member: string; address: string }> {
  const id = randomUUID();
  const address = `Founder.${id}@Example.com`;
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')), '{}'::jsonb,
       now(), now(), '', '', '', ''
     )`,
    [id, address],
  );
  const { rows } = await client.query<{ id: string }>(
    `insert into public.members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2::uuid, 'Founder Probe', $3, 'member_role', 20)
     returning id`,
    [organization, id, `founder.${id}`],
  );
  const member = rows[0]?.id;
  if (member === undefined) throw new Error('members insert returned no row');
  return { member, address };
}

async function actAsAdmin(client: Client, organization: string, username: string): Promise<void> {
  const { rows } = await client.query<{ auth_user_id: string }>(
    'select auth_user_id::text from public.members where organization_id = $1 and username = $2',
    [organization, username],
  );
  const admin = rows[0]?.auth_user_id;
  if (admin === undefined) throw new Error('no pilot admin');
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: admin, role: 'authenticated', organization_id: organization }),
  ]);
  await client.query('set local role authenticated');
}

async function refusal(
  client: Client,
  sql: string,
  parameters: unknown[],
): Promise<{ code: string | undefined; message: string | undefined } | null> {
  await client.query('savepoint attempt');
  try {
    await client.query(sql, parameters);
    await client.query('release savepoint attempt');
    return null;
  } catch (cause) {
    await client.query('rollback to savepoint attempt');
    const { code, message } = cause as { code?: string; message?: string };
    return { code, message };
  }
}

describe("an email identity's username follows its address (story 19.2, 0068, C2)", () => {
  it.skipIf(noDatabase)('refuses a direct rename as the admin, with 23514 SIGN_IN_IS_EMAIL', async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const { member } = await emailIdentityMember(client, organization);
      await actAsAdmin(client, organization, PILOT.admin);

      expect(await refusal(client, 'update public.members set username = $2 where id = $1', [member, 'novo.ime'])).toEqual({
        code: '23514',
        message: 'SIGN_IN_IS_EMAIL',
      });
    });
  });

  it.skipIf(noDatabase)('refuses even the username its address derives, so admin-auth never reaches the address', async () => {
    // `admin-auth` rewrites the auth address after ANY successful row write, so
    // an email identity's `username` may not be written at all (review of 19.2).
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const { member, address } = await emailIdentityMember(client, organization);
      const derived = address.split('@')[0]?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) ?? '';
      await actAsAdmin(client, organization, PILOT.admin);

      expect(await refusal(client, 'update public.members set username = $2 where id = $1', [member, derived])).toEqual({
        code: '23514',
        message: 'SIGN_IN_IS_EMAIL',
      });
    });
  });

  it.skipIf(noDatabase)('holds an inserted email identity to its derived username, lower-cased ASCII-only', async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      // The helper inserts `founder.<id>` for `Founder.<id>@Example.com`: the derived value, let through.
      const { address } = await emailIdentityMember(client, organization);
      expect(address.startsWith('Founder.')).toBe(true);

      const id = randomUUID();
      await client.query(
        `insert into auth.users (
           instance_id, id, aud, role, email, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change, email_change_token_new
         ) values (
           '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
           '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
         )`,
        [id, `Other.${id}@Example.com`],
      );
      expect(
        await refusal(
          client,
          `insert into public.members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
           values ($1, $2::uuid, 'Other Probe', $3, 'member_role', 20)`,
          [organization, id, `not.derived.${id}`],
        ),
      ).toEqual({ code: '23514', message: 'SIGN_IN_IS_EMAIL' });
    });
  });

  it.skipIf(noDatabase)('refuses the owner too: the trigger is the rule, not a policy', async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const { member } = await emailIdentityMember(client, organization);

      expect(await refusal(client, 'update public.members set username = $2 where id = $1', [member, 'novo.ime'])).toEqual({
        code: '23514',
        message: 'SIGN_IN_IS_EMAIL',
      });
    });
  });

  it.skipIf(noDatabase)("leaves a username identity's rename as it was", async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const { rows } = await client.query<{ id: string }>(
        'select id from public.members where organization_id = $1 and username = $2',
        [organization, PILOT.bystander],
      );
      const bystander = rows[0]?.id ?? '';
      await actAsAdmin(client, organization, PILOT.admin);

      expect(
        await refusal(client, 'update public.members set username = $2 where id = $1', [bystander, `${PILOT.bystander}.2`]),
      ).toBeNull();
    });
  });
});
