import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MEMBER_SIGN_IN_IS_EMAIL,
  WIRE_CODES,
  memberWriteFailureOf,
  memberWriteMessageKey,
} from '../apps/web/src/features/members/services/wire.ts';
import {
  CHECK_VIOLATION,
  OPERATION_CODES,
  SIGN_IN_IS_EMAIL,
  USERNAME_TAKEN,
  membersRefusal,
  resetAttributes,
  updateUserById,
  type CallerClient,
  type PostgrestAnswer,
  type PrivilegedAccounts,
} from '../supabase/functions/admin-auth/operations.ts';

/**
 * STORY 19.2 (AD-12, AD-16 as amended; checklist C2, C3): `admin-auth`'s
 * rename and reset never rewrite an email identity's address.
 *
 * DB-FREE: `updateUserById` runs against stand-ins for the caller's PostgREST
 * client and GoTrue's admin API, as `test/admin-auth-boundary.test.ts` does.
 * The database's half — 0068's trigger refusing the rename, and a direct
 * PATCH meeting the same refusal — is `test/signup-account.test.ts`'s, which
 * CI runs on its fresh stack.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const MEMBER = '5d1c6b3e-2f4a-4c8e-9b7d-1a2b3c4d5e6f';
const ACCOUNT = 'auth-user-founder';

/** The caller's client: the member read, the slug read, the access check, and one update answer. */
function callerAnswering(update: PostgrestAnswer): { client: CallerClient; updates: Record<string, unknown>[] } {
  const updates: Record<string, unknown>[] = [];
  const reads: Record<string, PostgrestAnswer> = {
    members: {
      data: [{ organization_id: 'organization-1', auth_user_id: ACCOUNT, username: 'ana.horvat' }],
      error: null,
    },
    organizations: { data: [{ slug: 'tvrtka-primjer' }], error: null },
  };
  const client: CallerClient = {
    rpc() {
      return Promise.resolve({ data: [{ organization_id: 'organization-1', member_role: 'admin', is_active: true }], error: null });
    },
    from(table) {
      return {
        select() {
          return { eq: () => ({ limit: () => Promise.resolve(reads[table] ?? { data: [], error: null }) }) };
        },
        insert() {
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
        update(values) {
          return {
            eq() {
              return {
                select() {
                  updates.push(values);
                  return Promise.resolve(update);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, updates };
}

/** GoTrue's admin API, recording every call; none is expected. */
function accountsRecording(): { client: PrivilegedAccounts; calls: string[] } {
  const calls: string[] = [];
  const answer = () => Promise.resolve({ data: { user: { id: ACCOUNT } }, error: null });
  return {
    calls,
    client: {
      auth: {
        getUser: () => {
          calls.push('getUser');
          return answer();
        },
        admin: {
          createUser: () => {
            calls.push('createUser');
            return answer();
          },
          updateUserById: () => {
            calls.push('updateUserById');
            return answer();
          },
          deleteUser: () => {
            calls.push('deleteUser');
            return Promise.resolve({ error: null });
          },
        },
      },
    },
  };
}

describe("admin-auth and an email identity's username (story 19.2, C2)", () => {
  it('maps 0068’s refusal to 409 SIGN_IN_IS_EMAIL, and only that check violation', () => {
    expect(membersRefusal({ code: CHECK_VIOLATION, message: SIGN_IN_IS_EMAIL })).toEqual({
      status: 409,
      body: { code: SIGN_IN_IS_EMAIL },
    });
    expect(membersRefusal({ code: CHECK_VIOLATION, message: 'members_username_check' }).body).not.toEqual({
      code: SIGN_IN_IS_EMAIL,
    });
    expect(membersRefusal({ code: '23505' }).body).toEqual({ code: USERNAME_TAKEN });
  });

  it('makes no auth call when the database refuses the rename', async () => {
    const caller = callerAnswering({ data: null, error: { code: CHECK_VIOLATION, message: SIGN_IN_IS_EMAIL } });
    const accounts = accountsRecording();

    const reply = await updateUserById(
      { privileged: accounts.client, caller: caller.client },
      { memberId: MEMBER, username: 'ana.novak' },
    );

    expect(reply).toEqual({ status: 409, body: { code: SIGN_IN_IS_EMAIL } });
    expect(caller.updates).toEqual([{ username: 'ana.novak' }]);
    expect(accounts.calls, 'the address was rewritten anyway').toEqual([]);
  });

  it('puts the code on the wire and gives the SPA its own message', () => {
    expect(OPERATION_CODES).toContain(SIGN_IN_IS_EMAIL);
    expect(WIRE_CODES).toContain(SIGN_IN_IS_EMAIL);
    expect(memberWriteFailureOf(SIGN_IN_IS_EMAIL)).toBe(MEMBER_SIGN_IN_IS_EMAIL);
    expect(memberWriteMessageKey(MEMBER_SIGN_IN_IS_EMAIL)).toBe('ljudi.form.error.signInIsEmail');
  });

  it('matches the message 0068 raises, word for word', () => {
    const migration = readFileSync(join(repoRoot, 'supabase', 'migrations', '0068_email_identity_username.sql'), 'utf8');

    expect(migration).toContain(`raise exception using errcode = '${CHECK_VIOLATION}', message = '${SIGN_IN_IS_EMAIL}';`);
    expect(migration).toMatch(
      /create trigger members_username_follows_email_identity\s+before insert or update of username, auth_user_id on public\.members/,
    );
  });
});

describe('resetPassword never sends an address (story 19.2, C3)', () => {
  it('resets the password and the first-sign-in flag only', () => {
    const attributes = resetAttributes('n'.repeat(16));

    expect(Object.keys(attributes).sort()).toEqual(['app_metadata', 'password']);
    expect(attributes).not.toHaveProperty('email');
  });
});
