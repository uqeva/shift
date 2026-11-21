import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { FIXTURES, connect, inRolledBackTransaction, localApiEndpoint, localSecretKey, noDatabase, organizationId } from './database.ts';

/**
 * STORY 19.2 (AD-12, AD-21, AD-22; checklist A5, B5, C2, C6; deferred-work's
 * live probe), and STORY 19.3's C8 (confirmation forgets the password) and D5
 * (only `create_organization` inserts an email identity's member row): a stranger creates an account on the local stack, through the
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
  }, 30_000);

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
  }, 30_000);

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

        // STORY 19.3 (C8, 0071): confirmation forgot the signup's password, so
        // it signs nothing in now, with the one neutral refusal.
        const forgotten = await auth('token?grant_type=password', { email: address, password: secret });
        expect(forgotten.status).toBe(400);
        expect(forgotten.body['error_code'] ?? forgotten.body['code']).toBe('invalid_credentials');

        // `/potvrda` sets the first password with `PUT /user` on the verified
        // session: no current password is asked for, because none is held.
        const chosen = password();
        const set = await fetch(`${endpoint().url}/auth/v1/user`, {
          method: 'PUT',
          headers: { apikey: endpoint().key, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ password: chosen }),
        });
        expect(set.status, await set.clone().text()).toBe(200);

        // B5: an unknown address and a wrong password answer alike, the wrong one
        // compared against a hash the account now holds (review of 19.3).
        const unknown = await auth('token?grant_type=password', {
          email: `nobody-${randomUUID()}@example.com`,
          password: password(),
        });
        const wrong = await auth('token?grant_type=password', { email: address, password: password() });
        expect(unknown.status).toBe(400);
        expect(wrong.status).toBe(unknown.status);
        expect(wrong.body['error_code'] ?? wrong.body['code']).toBe(unknown.body['error_code'] ?? unknown.body['code']);
        expect(unknown.body['error_code'] ?? unknown.body['code']).toBe('invalid_credentials');

        // And that one signs the email identity in, as typed in another case.
        const signedIn = await auth('token?grant_type=password', { email: address.toUpperCase(), password: chosen });
        expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
      } finally {
        await removeAccounts(address);
      }
    },
    // Six GoTrue round trips, the mail catcher's poll and the token warm-up:
    // the live siblings' budget (claimless-account.test.ts), not vitest's 5 s.
    60_000,
  );

  it.skipIf(noAdminApi)(
    "leaves a stranger's earlier signup password nothing to sign in with once the owner confirms (C8)",
    async () => {
      // GoTrue v2.196.0 keeps the FIRST signup's password on a repeat signup
      // of an unconfirmed address. The stranger signs up first; the owner
      // signs up again (answered or throttled, either way), confirms from the
      // mail and sets a password on `/potvrda`.
      const address = `signup-${randomUUID()}@example.com`;
      const stranger = password();
      const owner = password();
      try {
        const first = await auth('signup', { email: address, password: stranger });
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        await auth('signup', { email: address, password: owner });
        expect(await accountsAt(address)).toHaveLength(1);

        const mail = await mailTo(address);
        const tokenHash = /\/potvrda\?token_hash=([0-9a-f]+)&amp;type=signup/.exec(mail.html)?.[1] ?? '';
        const verified = await auth('verify', { token_hash: tokenHash, type: 'signup' });
        expect(verified.status, JSON.stringify(verified.body)).toBe(200);
        const token = String(verified.body['access_token'] ?? '');

        // The hash is gone, in GoTrue's own confirming UPDATE.
        const client = await connect();
        try {
          const { rows } = await client.query<{ hashed: boolean }>(
            "select coalesce(encrypted_password, '') <> '' as hashed from auth.users where lower(email) = lower($1)",
            [address],
          );
          expect(rows[0]?.hashed).toBe(false);
        } finally {
          await client.end();
        }
        for (const tried of [stranger, owner]) {
          const refused = await auth('token?grant_type=password', { email: address, password: tried });
          expect(refused.status).toBe(400);
          expect(refused.body['error_code'] ?? refused.body['code']).toBe('invalid_credentials');
        }

        const chosen = password();
        const set = await fetch(`${endpoint().url}/auth/v1/user`, {
          method: 'PUT',
          headers: { apikey: endpoint().key, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ password: chosen }),
        });
        expect(set.status, await set.clone().text()).toBe(200);
        expect((await auth('token?grant_type=password', { email: address, password: chosen })).status).toBe(200);
        expect((await auth('token?grant_type=password', { email: address, password: stranger })).status).toBe(400);
      } finally {
        await removeAccounts(address);
      }
    },
    60_000,
  );
});

describe('confirmation forgets the password, in the database (story 19.3, 0071, C8)', () => {
  async function account(client: Client, address: string, confirmed: boolean): Promise<string> {
    const id = randomUUID();
    await client.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new
       ) values (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
         extensions.crypt($3, extensions.gen_salt('bf', 4)), case when $4::boolean then now() end,
         '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
       )`,
      [id, address.replace('<id>', id), password(), confirmed],
    );
    return id;
  }

  async function hashed(client: Client, id: string): Promise<boolean> {
    const { rows } = await client.query<{ hashed: boolean }>(
      'select encrypted_password is not null as hashed from auth.users where id = $1',
      [id],
    );
    return rows[0]?.hashed ?? false;
  }

  it.skipIf(noDatabase)("nulls an email identity's hash when it is first confirmed, and nothing else", async () => {
    await inRolledBackTransaction(async (client) => {
      const fresh = await account(client, 'owner.<id>@example.com', false);
      const synthesized = await account(client, `ivan.<id>@${PILOT.slug}.shift.invalid`, false);
      const confirmed = await account(client, 'member.<id>@example.com', true);

      await client.query('update auth.users set email_confirmed_at = now() where id = any($1::uuid[])', [[fresh, synthesized, confirmed]]);

      expect(await hashed(client, fresh), 'a first confirmation kept the hash').toBe(false);
      expect(await hashed(client, synthesized), "a username identity's confirmation lost its hash").toBe(true);
      expect(await hashed(client, confirmed), 'a re-confirmation lost the hash').toBe(true);

      // A password set after confirmation stays.
      await client.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1", [
        fresh,
        password(),
      ]);
      await client.query('update auth.users set email_confirmed_at = now() where id = $1', [fresh]);
      expect(await hashed(client, fresh)).toBe(true);

      // An UPDATE that confirms AND sets a password (an admin's
      // `updateUserById({ password, email_confirm })`) keeps the one it sets.
      const both = await account(client, 'both.<id>@example.com', false);
      const { rows: before } = await client.query<{ hash: string }>('select encrypted_password as hash from auth.users where id = $1', [both]);
      await client.query(
        "update auth.users set email_confirmed_at = now(), encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1",
        [both, password()],
      );
      const { rows: after } = await client.query<{ hash: string | null }>('select encrypted_password as hash from auth.users where id = $1', [both]);
      expect(after[0]?.hash, 'a password set while confirming was forgotten').not.toBeNull();
      expect(after[0]?.hash).not.toBe(before[0]?.hash);
    });
  });
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
  // STORY 19.3 (D5, 0071): only `create_organization` inserts an email
  // identity's row, and it names the account in this setting first, as here.
  await client.query("select set_config('shift.founding_account', $1, true)", [id]);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2::uuid, 'Founder Probe', $3, 'member_role', 20)
     returning id`,
    [organization, id, `founder.${id}`],
  );
  await client.query("select set_config('shift.founding_account', '', true)");
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
      // The founding setting names it, so the refusal below is the username's.
      await client.query("select set_config('shift.founding_account', $1, true)", [id]);
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

  it.skipIf(noDatabase)("refuses an admin's insert of an email identity's row, and the owner's without the founding setting (story 19.3, D5)", async () => {
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      // The scene, as the owner: a confirmed stranger's email account.
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
        [id, `stranger.${id}@example.com`],
      );
      const insert = `insert into public.members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
                      values ($1, $2::uuid, 'Stranger', $3, 'member_role', 20)`;

      // The owner, with the derived username and no founding setting.
      expect(await refusal(client, insert, [organization, id, `stranger.${id}`])).toEqual({ code: '23514', message: 'SIGN_IN_IS_EMAIL' });

      // The pilot's admin, adopting the stranger.
      await actAsAdmin(client, organization, PILOT.admin);
      expect(await refusal(client, insert, [organization, id, `stranger.${id}`])).toEqual({ code: '23514', message: 'SIGN_IN_IS_EMAIL' });
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
      // A policy's silent refusal also raises nothing: read the rename back.
      const renamed = await client.query<{ username: string }>('select username from public.members where id = $1', [bystander]);
      expect(renamed.rows[0]?.username).toBe(`${PILOT.bystander}.2`);
    });
  });

  it.skipIf(noDatabase)('refuses re-pointing a row to an email identity, or away from one, even as the owner', async () => {
    // Security review of 19.2: the `auth_user_id` half of the trigger's column list.
    await inRolledBackTransaction(async (client) => {
      const organization = await organizationId(client, PILOT.slug);
      const { member } = await emailIdentityMember(client, organization);
      const account = async (address: string): Promise<string> => {
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
          [id, address.replace('<id>', id)],
        );
        return id;
      };
      const { rows } = await client.query<{ id: string }>(
        'select id from public.members where organization_id = $1 and username = $2',
        [organization, PILOT.bystander],
      );
      const bystander = rows[0]?.id ?? '';
      const claimlessEmail = await account('stranger.<id>@example.com');
      const freshSynthesized = await account(`moved.<id>@${PILOT.slug}.shift.invalid`);

      // A username identity's row onto a stranger's email account.
      expect(
        await refusal(client, 'update public.members set auth_user_id = $2::uuid where id = $1', [bystander, claimlessEmail]),
      ).toEqual({ code: '23514', message: 'SIGN_IN_IS_EMAIL' });
      // An email identity's row onto a synthesized account.
      expect(
        await refusal(client, 'update public.members set auth_user_id = $2::uuid where id = $1', [member, freshSynthesized]),
      ).toEqual({ code: '23514', message: 'SIGN_IN_IS_EMAIL' });
    });
  });
});
