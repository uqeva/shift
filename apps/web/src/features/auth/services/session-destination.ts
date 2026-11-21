import { addressKind } from '@/features/auth/services/address';
import { claimedOrganizationOf } from '@/lib/supabase/claims';

/**
 * Where a signed-in session goes (AD-24, as story 19.3 leaves it).
 *
 * ONE FUNCTION, so the `_app` guard, `/postavljanje`'s guard and step 1's
 * refresh-and-route can never disagree. It takes the session, reads its claim
 * from the token and AD-12's kind from its address, and answers:
 *
 * - `app`: a session whose token names an organization. A claimed session
 *   that asks for `/postavljanje` goes to the app too, until 19.4 builds steps
 *   2–7 (D6).
 * - `setup`: a claimless session whose address is an email identity's: a
 *   verified signup with no organization yet. It goes to step 1, the
 *   create-organization form (AD-23).
 * - `signOut`: a claimless USERNAME identity, or an address the predicate
 *   cannot read. A username identity without a claim has lost its `members`
 *   row (no session can delete one), so it can read nothing anywhere; the
 *   guard ends the session on this device and sends it to *Prijava*.
 *
 * The claim is read from the session's own token, never queried, and trusted
 * for nothing: a wrong answer here routes a screen, and the database refuses
 * every read and write the claim does not allow.
 */
export const APP_DESTINATION = 'app';
export const SETUP_DESTINATION = 'setup';
export const SIGN_OUT_DESTINATION = 'signOut';

export type SessionDestination = typeof APP_DESTINATION | typeof SETUP_DESTINATION | typeof SIGN_OUT_DESTINATION;

/** As much of a session as the decision reads. */
export interface DestinedSession {
  readonly access_token: string;
  readonly user: { readonly email?: string | undefined };
}

export function sessionDestination(session: DestinedSession): SessionDestination {
  if (claimedOrganizationOf(session.access_token) !== null) return APP_DESTINATION;

  return addressKind(session.user.email) === 'email' ? SETUP_DESTINATION : SIGN_OUT_DESTINATION;
}
