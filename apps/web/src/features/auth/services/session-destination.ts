import { addressKind } from '@/features/auth/services/address';
import { claimedOrganizationOf } from '@/lib/supabase/claims';

/**
 * Where a signed-in session goes (AD-24, as far as story 19.2 needs it).
 *
 * ONE FUNCTION, so the `_app` guard, `/postavljanje`'s guard and the sign-in
 * screen can never disagree. 19.2 is where the first claimless EMAIL identity
 * exists: an account that signed up, confirmed its address and has no
 * `members` row yet. Its token carries no `organization_id` (AD-10), so every
 * destination would read nothing; it is sent to `/postavljanje` instead, where
 * 19.3 builds the create-organization form.
 *
 * What it answers, in 19.2:
 * - `app`: a session whose token names an organization, as today. A claimless
 *   USERNAME identity (it lost its `members` row, which no session can delete)
 *   also stays `app` in 19.2, as today; AD-24's sign-out for it is 19.3's.
 * - `setup`: a claimless session whose address is an email identity's (AD-12).
 *
 * The claim is read from the session's own token, never queried, and trusted
 * for nothing: a wrong answer here routes a screen, and the database refuses
 * every read and write the claim does not allow.
 */
export const APP_DESTINATION = 'app';
export const SETUP_DESTINATION = 'setup';

export type SessionDestination = typeof APP_DESTINATION | typeof SETUP_DESTINATION;

/** As much of a session as the decision reads. */
export interface DestinedSession {
  readonly access_token: string;
  readonly user: { readonly email?: string | undefined };
}

export function sessionDestination(session: DestinedSession): SessionDestination {
  if (claimedOrganizationOf(session.access_token) !== null) return APP_DESTINATION;

  return addressKind(session.user.email) === 'email' ? SETUP_DESTINATION : APP_DESTINATION;
}
