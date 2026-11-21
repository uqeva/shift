import type { Session } from '@supabase/supabase-js';

/**
 * THE ONE TEST SESSION, written once rather than once per test file (six
 * copies had accreted, with two different user ids).
 *
 * Enough of a session to be distinguishable from `null` and to carry the one
 * field the reads use: `user.id`, which a read filters `auth_user_id` by.
 */
/**
 * A token whose payload names an organization (AD-10's claim): since story
 * 19.3 `sessionDestination` signs a claimless session with no email
 * identity's address out, so the test session carries the claim a real
 * member's has. Header and signature are never read.
 */
export const CLAIMED_TOKEN = `e30.${btoa(JSON.stringify({ sub: 'auth-user-id', organization_id: '00000000-0000-4000-8000-000000000001' })).replace(/=+$/, '')}.signature`;

export const SESSION = {
  access_token: CLAIMED_TOKEN,
  user: { id: 'auth-user-id' },
} as unknown as Session;
