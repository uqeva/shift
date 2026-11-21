import type { Session } from '@supabase/supabase-js';

import {
  isEmailEntry,
  normalizeUsername,
  organizationDestination,
  signInAddress,
  signupAddressOf,
} from '@/features/auth/services/address';

/**
 * Credentials in, a session or one stable code out (story 1.3b).
 *
 * The whole of this story's security posture is the MAPPING, and it is a
 * narrowing one: three upstream failures that GoTrue reports differently — a
 * wrong password, a username no member holds, and an account whose
 * `banned_until` is in the future — collapse to a single code, and therefore to
 * a single message. The screen is reachable by anyone with the URL, so a
 * distinguishable "no such user" would answer "does this username exist in this
 * organization?" for an unauthenticated caller. That is the same enumeration
 * oracle an anonymous username-resolution RPC was refused for on 2026-09-07,
 * and it would be no less an oracle for arriving as a friendlier error message.
 * The cost is a less specific message after a legitimate typo, which UX-DR34's
 * "state the problem, keep every entered value" tolerates.
 *
 * A transport or service failure is the one distinction worth drawing, and it
 * discloses nothing: it is true of every caller and every credential alike, and
 * telling someone to try again is the only actionable thing this screen can say.
 *
 * The auth client is a PARAMETER rather than an import, so every row of the
 * story's I/O matrix is executable from the node suite (AD-15) against a stub —
 * no browser, no stack, no environment. The interface is structural and narrow
 * on purpose: it names the one method used and the two fields the mapping reads,
 * so the real `supabase.auth` satisfies it and a stub does not have to
 * impersonate the rest of GoTrue.
 */

/** Refused: wrong password, unknown username, or a deactivated account. */
export const SIGN_IN_REFUSED = 'SIGN_IN_REFUSED';
/** The service could not be reached, or answered that it could not answer. */
export const SIGN_IN_UNAVAILABLE = 'SIGN_IN_UNAVAILABLE';
/**
 * Story 19.2 (AD-12, UX-DR62): an EMAIL sign-in refused, for every cause —
 * an unknown address, a wrong password, a refused token, or an address the
 * page refuses (synthesized, malformed). Its own code because its message
 * names its own kind (`E-mail ili lozinka nisu točni.`): which kind was typed
 * is the person's own fact, so naming it reveals nothing.
 */
export const SIGN_IN_EMAIL_REFUSED = 'SIGN_IN_EMAIL_REFUSED';
/**
 * The address is not confirmed yet. GoTrue says `email_not_confirmed` only
 * for the RIGHT password (AD-22's `/token` row), so saying so tells nobody
 * anything they did not already hold; the screen offers a new link.
 */
export const SIGN_IN_UNCONFIRMED = 'SIGN_IN_UNCONFIRMED';

export type SignInFailure =
  | typeof SIGN_IN_REFUSED
  | typeof SIGN_IN_UNAVAILABLE
  | typeof SIGN_IN_EMAIL_REFUSED
  | typeof SIGN_IN_UNCONFIRMED;

/**
 * The message key each failure renders as.
 *
 * Here rather than as a ternary in the screen, and that placement is the whole
 * point: a `.tsx` is collected by nothing (AD-15), so a mapping written there
 * can only be read as source text — and swapping the two branches of
 * `failure === SIGN_IN_REFUSED ? credentials : unavailable` passes every
 * source-level assertion while a wrong password reports a service outage and a
 * real outage reports wrong credentials. Both are directly actionable and both
 * would be wrong. Executed here instead, one case per code.
 *
 * The return type is the literal union rather than `string`, so `t()` still
 * type-checks the key against `hr.json` (`lib/i18n/index.ts`) and a key deleted
 * from the resource file is a `pnpm typecheck` failure rather than a `⟦…⟧` on
 * screen. Codes are translated only at the edge, and this is the edge.
 */
export function signInMessageKey(
  failure: SignInFailure,
): 'auth.error.credentials' | 'auth.error.unavailable' | 'signup.signIn.error' | 'signup.unconfirmed.body' {
  if (failure === SIGN_IN_UNAVAILABLE) return 'auth.error.unavailable';
  if (failure === SIGN_IN_EMAIL_REFUSED) return 'signup.signIn.error';
  if (failure === SIGN_IN_UNCONFIRMED) return 'signup.unconfirmed.body';

  return 'auth.error.credentials';
}

export type SignInOutcome =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly code: SignInFailure };

/** As much of an `AuthError` as the mapping below reads. */
export interface AuthFailure {
  // `| undefined` on every member, spelled out. `exactOptionalPropertyTypes` is
  // on, and supabase-js declares `status: number | undefined` rather than an
  // optional property — so `status?: number` is NOT a supertype of it and the
  // real client would not satisfy this interface at all.
  readonly name?: string | undefined;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface PasswordAuth {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { session: Session | null };
    error: AuthFailure | null;
  }>;
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
  readonly slug: string;
}

/** GoTrue's own name for "the request never got an answer worth reading". */
const RETRYABLE_ERROR_NAME = 'AuthRetryableFetchError';
const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR_STATUS = 500;

/**
 * Whether a failure is the service's rather than the credential's.
 *
 * A fetch that never completed carries no HTTP status at all — supabase-js
 * raises `AuthRetryableFetchError` with a status of 0 — so "absent or zero" is
 * the offline case, and it must not read as a refusal: telling someone their
 * password is wrong because their train entered a tunnel is both false and the
 * kind of false that makes people change a password that was fine.
 *
 * 5xx is the same claim from the server's side, and 429 joins them because a
 * rate limit says "not now", never "not you".
 */
function isServiceFailure(error: AuthFailure): boolean {
  if (error.name === RETRYABLE_ERROR_NAME) return true;

  const status = error.status;

  if (status === undefined || status === 0) return true;

  return status === TOO_MANY_REQUESTS || status >= FIRST_SERVER_ERROR_STATUS;
}

/**
 * Exchanges an admin-issued username for a session, under one organization.
 *
 * The slug arrives from the form's organization row (the URL) or its field
 * (this device's memory, or what was typed) — story 7.7 — and is judged here
 * either way, exactly as the username is.
 *
 * BOTH halves are normalized before they are judged, and that is a correctness
 * fix rather than a convenience. `/prijava/DVD-Kastel-Novi`, or `DVD-Kastel-Novi`
 * typed into the field, is a slug a person meant, and a URL is shared, typed and
 * autocapitalized by phones — treating it as unusable rendered a working form
 * that refused every correct credential forever, with the message that says the
 * password was wrong. Format validity is not an existence question, so the
 * enumeration-oracle argument never licensed that: normalizing discloses
 * nothing, because it happens before anything is asked of the service.
 *
 * What survives normalization and still cannot name an account is refused
 * LOCALLY, with the ordinary refusal and no request at all. A shape of its own
 * would tell an anonymous caller which slugs and usernames are well formed,
 * which is a smaller oracle than existence but an oracle all the same.
 */
export async function signIn(auth: PasswordAuth, credentials: Credentials): Promise<SignInOutcome> {
  const { username, password, slug } = credentials;

  // STORY 19.2 (AD-12): an entry with an `@` is an email identity's address,
  // signed in as typed (trimmed of ASCII white space) with no slug. A username
  // can never hold an `@` (`members_username_check`), so the kinds never mix.
  if (isEmailEntry(username)) return signInWithEmail(auth, username, password);

  const organization = organizationDestination(slug);
  const account = normalizeUsername(username);

  // AN EMPTY PASSWORD TOO (B298): the form is `noValidate`, so no browser
  // bubble stops it, and no account has one — the same refusal, no request.
  if (organization === null || account === null || password === '') return { ok: false, code: SIGN_IN_REFUSED };

  let answered;

  try {
    answered = await auth.signInWithPassword({
      email: signInAddress(account, organization),
      password,
    });
  } catch {
    // A rejected promise is the transport failing outside supabase-js's own
    // error mapping — a blocked request, an aborted navigation, a DNS failure.
    // It is never evidence about the credential.
    return { ok: false, code: SIGN_IN_UNAVAILABLE };
  }

  if (answered.error !== null) {
    return {
      ok: false,
      code: isServiceFailure(answered.error) ? SIGN_IN_UNAVAILABLE : SIGN_IN_REFUSED,
    };
  }

  const session = answered.data.session;

  // No error and no session is a shape GoTrue does not currently produce. It is
  // mapped rather than trusted, because the alternative is returning `ok: true`
  // with nothing behind it and letting `/` redirect straight back.
  if (session === null) return { ok: false, code: SIGN_IN_REFUSED };

  return { ok: true, session };
}

/** GoTrue's code for a correct password on an address nobody has confirmed. */
const EMAIL_NOT_CONFIRMED = 'email_not_confirmed';

/**
 * The email path (story 19.2, UX-DR62). What the page would refuse — a
 * synthesized address above all, which AD-12 says the SPA refuses locally —
 * is refused here with the email refusal and no request, exactly as the
 * username path refuses an unusable slug: well-formedness is computable by
 * anyone, existence is never answered.
 */
async function signInWithEmail(auth: PasswordAuth, entry: string, password: string): Promise<SignInOutcome> {
  const email = signupAddressOf(entry);

  if (email === null || password === '') return { ok: false, code: SIGN_IN_EMAIL_REFUSED };

  let answered;

  try {
    answered = await auth.signInWithPassword({ email, password });
  } catch {
    return { ok: false, code: SIGN_IN_UNAVAILABLE };
  }

  if (answered.error !== null) {
    if (isServiceFailure(answered.error)) return { ok: false, code: SIGN_IN_UNAVAILABLE };
    if (answered.error.code === EMAIL_NOT_CONFIRMED) return { ok: false, code: SIGN_IN_UNCONFIRMED };

    return { ok: false, code: SIGN_IN_EMAIL_REFUSED };
  }

  const session = answered.data.session;

  if (session === null) return { ok: false, code: SIGN_IN_EMAIL_REFUSED };

  return { ok: true, session };
}
