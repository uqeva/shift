import type { Session } from '@supabase/supabase-js';

import { signupAddressOf } from '@/features/auth/services/address';
import { PASSWORD_MIN_LENGTH } from '@/features/auth/services/set-password';

/**
 * Story 19.2 (AD-21, AD-22, UX-DR63, UX-DR64): signup, resend, recovery and
 * the link a mail carries, as outcomes the screens render.
 *
 * THE SPA IS NOT THE BOUNDARY. Kong answers every signup, recover and resend
 * `200 {}` at once and relays in the background (AD-22), so nothing here may
 * read a mail route's body, and nothing here could learn from it anyway. What
 * a mail request can tell the screen is only what is true of every address
 * alike: a per-IP 429 (the network), or no answer at all (the transport).
 * Everything else is the one neutral screen.
 *
 * The auth client is a PARAMETER, structural and narrow, so every outcome is
 * executable from the node suite (AD-15) against a stub, as `sign-in.ts` does.
 */

/** The mail went to the gateway (or the address could not receive it: the same screen). */
export const MAIL_SENT = 'MAIL_SENT';
/** The per-IP limit refused it. About this network, never about the address. */
export const MAIL_THROTTLED = 'MAIL_THROTTLED';
/** No answer worth reading: offline, a blocked request, a 5xx. */
export const MAIL_UNAVAILABLE = 'MAIL_UNAVAILABLE';

export type MailOutcome = typeof MAIL_SENT | typeof MAIL_THROTTLED | typeof MAIL_UNAVAILABLE;

/** As much of an `AuthError` as the mappings below read (`exactOptionalPropertyTypes`). */
export interface MailFailure {
  readonly name?: string | undefined;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

/** The three mail calls, named structurally so they can be stubbed. */
export interface MailAuth {
  signUp(credentials: { email: string; password: string }): Promise<{ error: MailFailure | null }>;
  resend(request: { type: 'signup'; email: string }): Promise<{ error: MailFailure | null }>;
  resetPasswordForEmail(email: string): Promise<{ error: MailFailure | null }>;
}

const RETRYABLE_ERROR_NAME = 'AuthRetryableFetchError';
const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR_STATUS = 500;

/**
 * What one mail request's answer means. The STATUS is read, never the body:
 * 429 is the gateway's per-IP limit, a missing status or a 5xx is the
 * transport, and every other answer (Kong's `200 {}`, or on the CLI's stack
 * GoTrue's own refusals) is the one neutral screen.
 */
export function mailOutcomeOf(error: MailFailure | null): MailOutcome {
  if (error === null) return MAIL_SENT;
  if (error.status === TOO_MANY_REQUESTS) return MAIL_THROTTLED;
  if (error.name === RETRYABLE_ERROR_NAME) return MAIL_UNAVAILABLE;
  if (error.status === undefined || error.status === 0 || error.status >= FIRST_SERVER_ERROR_STATUS) {
    return MAIL_UNAVAILABLE;
  }

  return MAIL_SENT;
}

async function settled(request: () => Promise<{ error: MailFailure | null }>): Promise<MailOutcome> {
  try {
    return mailOutcomeOf((await request()).error);
  } catch {
    // A rejected promise is the transport failing outside supabase-js.
    return MAIL_UNAVAILABLE;
  }
}

// ----------------------------------------------------------------- the form

/** The address cannot be sent (AD-12's shape, the gateway's relay, GoTrue's pattern). */
export const SIGNUP_ADDRESS_INVALID = 'SIGNUP_ADDRESS_INVALID';
/** The password is under the floor (`PASSWORD_MIN_LENGTH`, the set-password step's). */
export const SIGNUP_PASSWORD_TOO_SHORT = 'SIGNUP_PASSWORD_TOO_SHORT';
/** The password is over GoTrue's ceiling, which a masked answer would hide (review of 19.2). */
export const SIGNUP_PASSWORD_TOO_LONG = 'SIGNUP_PASSWORD_TOO_LONG';

/**
 * GoTrue v2.196.0 refuses a password longer than 72 BYTES of UTF-8 (bcrypt's
 * limit; Go's `len`) with a 422. Behind Kong that refusal is masked as
 * `200 {}`, so the page refuses it itself, as it refuses the floor. Bytes, not
 * characters (security review of 19.2): `č`, `ć`, `đ`, `š` and `ž` are two
 * each, so forty of them would pass a character count and strand the signup.
 */
export const PASSWORD_MAX_LENGTH = 72;

/** The password's length as GoTrue and bcrypt count it: UTF-8 bytes. */
export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

export type SignupRefusal =
  | typeof SIGNUP_ADDRESS_INVALID
  | typeof SIGNUP_PASSWORD_TOO_SHORT
  | typeof SIGNUP_PASSWORD_TOO_LONG;

/** Whether a password fits GoTrue's floor and ceiling. */
export function passwordFits(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && passwordBytes(password) <= PASSWORD_MAX_LENGTH;
}

/** What `/registracija` refuses on the page, with no request: both at once, address first. */
export function signupRefusalsOf(email: string, password: string): readonly SignupRefusal[] {
  const refusals: SignupRefusal[] = [];

  if (signupAddressOf(email) === null) refusals.push(SIGNUP_ADDRESS_INVALID);
  if (password.length < PASSWORD_MIN_LENGTH) refusals.push(SIGNUP_PASSWORD_TOO_SHORT);
  if (passwordBytes(password) > PASSWORD_MAX_LENGTH) refusals.push(SIGNUP_PASSWORD_TOO_LONG);

  return refusals;
}

/** The message key each local refusal renders as. */
export function signupRefusalMessageKey(
  refusal: SignupRefusal,
): 'signup.form.error.address' | 'signup.form.error.password' | 'signup.form.error.passwordLong' {
  if (refusal === SIGNUP_ADDRESS_INVALID) return 'signup.form.error.address';
  if (refusal === SIGNUP_PASSWORD_TOO_LONG) return 'signup.form.error.passwordLong';

  return 'signup.form.error.password';
}

/** The message key a mail failure renders as; `null` for the neutral screen. */
export function mailFailureMessageKey(
  outcome: MailOutcome,
): 'signup.error.throttled' | 'signup.error.unavailable' | null {
  if (outcome === MAIL_THROTTLED) return 'signup.error.throttled';
  if (outcome === MAIL_UNAVAILABLE) return 'signup.error.unavailable';

  return null;
}

/**
 * A signup. The caller has already refused what `signupRefusalsOf` refuses;
 * this refuses it again (no request), so no screen can send an address the
 * gateway would silently drop.
 */
export async function requestSignup(auth: MailAuth, typedEmail: string, password: string): Promise<MailOutcome> {
  const email = signupAddressOf(typedEmail);

  if (email === null || !passwordFits(password)) return MAIL_UNAVAILABLE;

  return settled(() => auth.signUp({ email, password }));
}

/** A new confirmation link: after a signup, or for an unconfirmed sign-in. */
export async function requestConfirmationResend(auth: MailAuth, typedEmail: string): Promise<MailOutcome> {
  const email = signupAddressOf(typedEmail);

  if (email === null) return MAIL_UNAVAILABLE;

  return settled(() => auth.resend({ type: 'signup', email }));
}

/** A recovery link (email identities only: a synthesized address is never sent). */
export async function requestRecovery(auth: MailAuth, typedEmail: string): Promise<MailOutcome> {
  const email = signupAddressOf(typedEmail);

  if (email === null) return MAIL_UNAVAILABLE;

  return settled(() => auth.resetPasswordForEmail(email));
}

/** `/zaboravljena-lozinka` refuses an entry with no `@` as such, and any other unsendable one as the shape. */
export function recoveryRefusalMessageKey(typed: string): 'signup.recover.error.address' | 'signup.form.error.address' | null {
  if (signupAddressOf(typed) !== null) return null;

  return typed.includes('@') ? 'signup.form.error.address' : 'signup.recover.error.address';
}

// ------------------------------------------------------------- the throttle

/**
 * UX-DR63: *Pošalji ponovno* waits 60 s after each send, GoTrue's
 * `GOTRUE_SMTP_MAX_FREQUENCY` (AD-21). The copy changes if the limit does.
 */
export const RESEND_WAIT_SECONDS = 60;

/** The seconds left before a resend, from the last send's instant; never negative. */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;

  const left = RESEND_WAIT_SECONDS - Math.floor((now - sentAt) / 1000);

  return Math.max(0, Math.min(RESEND_WAIT_SECONDS, left));
}

/** `0:48`, the countdown in the button's name. */
export function countdownOf(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));

  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

// ----------------------------------------------------------------- the link

/** The link types a Shift mail carries (AD-12): `{{ .SiteURL }}/potvrda?token_hash=…&type=…`. */
export const LINK_TYPES = ['signup', 'recovery', 'email_change'] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export interface MailLink {
  readonly tokenHash: string;
  readonly type: LinkType;
}

/** GoTrue's `token_hash` is hex; Kong's verify passes nothing else (19.1, B4a). */
const TOKEN_HASH_PATTERN = /^[0-9a-f]{1,128}$/i;

/** The link's two values from the URL, or `null` for one no mail of ours carries. */
export function mailLinkOf(tokenHash: unknown, type: unknown): MailLink | null {
  if (typeof tokenHash !== 'string' || !TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  if (typeof type !== 'string' || !(LINK_TYPES as readonly string[]).includes(type)) return null;

  return { tokenHash, type: type as LinkType };
}

/** `/potvrda`'s search: the two values as strings, or absent. Validated only on use. */
export function potvrdaSearchOf(search: Record<string, unknown>): { token_hash?: string; type?: string } {
  const out: { token_hash?: string; type?: string } = {};
  if (typeof search['token_hash'] === 'string') out.token_hash = search['token_hash'];
  if (typeof search['type'] === 'string') out.type = search['type'];

  return out;
}

/**
 * `/potvrda`'s address with the token taken out, or `null` when it carries
 * none (security review of 19.2). The page reads the link once into memory;
 * the address bar, the history entry (and a synced history) then keep only
 * `type`, so an unused recovery link cannot be replayed from them. A reload
 * shows the dead-link page; the mail's link still works.
 */
export function addressWithoutToken(pathname: string, search: string): string | null {
  const parameters = new URLSearchParams(search);
  if (!parameters.has('token_hash')) return null;
  parameters.delete('token_hash');
  const rest = parameters.toString();

  return rest === '' ? pathname : `${pathname}?${rest}`;
}

/** Takes the token out of the address bar and the current history entry, if it is there. */
export function forgetLinkInAddress(
  location: Pick<Location, 'pathname' | 'search'>,
  history: Pick<History, 'state' | 'replaceState'>,
): void {
  const scrubbed = addressWithoutToken(location.pathname, location.search);
  if (scrubbed !== null) history.replaceState(history.state, '', scrubbed);
}

/** `/potvrda`'s remount key: a new link, a new screen. */
export function potvrdaRemountKey(search: { token_hash?: string; type?: string }): string {
  return `${search.token_hash ?? ''}:${search.type ?? ''}`;
}

/** The link worked: a session now exists. */
export const LINK_CONFIRMED = 'LINK_CONFIRMED';
/** Used, expired, or never valid. The page names no address. */
export const LINK_DEAD = 'LINK_DEAD';
/** No answer worth reading; pressing again is safe (nothing was consumed). */
export const LINK_UNAVAILABLE = 'LINK_UNAVAILABLE';

export type LinkOutcome = typeof LINK_CONFIRMED | typeof LINK_DEAD | typeof LINK_UNAVAILABLE;

export interface VerifyAuth {
  verifyOtp(request: { token_hash: string; type: LinkType }): Promise<{
    data: { session: Session | null };
    error: MailFailure | null;
  }>;
}

/**
 * The press on *Potvrdi* or *Spremi novu lozinku*: the one verify, by POST
 * (AD-12). Never called on load, so a mail scanner that runs the page
 * consumes nothing.
 */
export async function verifyLink(auth: VerifyAuth, link: MailLink): Promise<LinkOutcome> {
  let answered;

  try {
    answered = await auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  } catch {
    return LINK_UNAVAILABLE;
  }

  if (answered.error === null) return answered.data.session === null ? LINK_DEAD : LINK_CONFIRMED;

  const outcome = mailOutcomeOf(answered.error);

  return outcome === MAIL_SENT ? LINK_DEAD : LINK_UNAVAILABLE;
}

// -------------------------------------------------------- the recovery save

export interface PasswordUpdateAuth {
  updateUser(attributes: { password: string }): Promise<{ error: MailFailure | null }>;
}

/** The new password was saved; the session continues. */
export const RECOVERY_SAVED = 'RECOVERY_SAVED';
/** Verified, and the save failed: retry the SAVE only (the link is spent). */
export const RECOVERY_NOT_SAVED = 'RECOVERY_NOT_SAVED';
/**
 * Verified, and GoTrue refused THIS password (422: the same as the old one,
 * or over its ceiling). Retrying it can never succeed, so it says what to
 * change rather than "try again" (review of 19.2).
 */
export const RECOVERY_PASSWORD_REFUSED = 'RECOVERY_PASSWORD_REFUSED';

const UNPROCESSABLE = 422;

export type RecoveryOutcome =
  | typeof RECOVERY_SAVED
  | typeof RECOVERY_NOT_SAVED
  | typeof RECOVERY_PASSWORD_REFUSED
  | typeof LINK_DEAD
  | typeof LINK_UNAVAILABLE;

/**
 * *Spremi novu lozinku* is the press that verifies AND saves (UX-DR64). The
 * verify runs once: `verified` says it already succeeded on an earlier press,
 * so a save that failed is retried without spending a link that is gone.
 */
export async function saveRecoveredPassword(
  auth: VerifyAuth & PasswordUpdateAuth,
  link: MailLink,
  password: string,
  verified: boolean,
): Promise<{ readonly outcome: RecoveryOutcome; readonly verified: boolean }> {
  if (!verified) {
    const outcome = await verifyLink(auth, link);

    if (outcome !== LINK_CONFIRMED) return { outcome, verified: false };
  }

  try {
    const { error } = await auth.updateUser({ password });

    if (error === null) return { outcome: RECOVERY_SAVED, verified: true };

    return { outcome: error.status === UNPROCESSABLE ? RECOVERY_PASSWORD_REFUSED : RECOVERY_NOT_SAVED, verified: true };
  } catch {
    return { outcome: RECOVERY_NOT_SAVED, verified: true };
  }
}

/** The message key a link failure renders as, on the press's own form. */
export function linkFailureMessageKey(
  outcome: typeof LINK_UNAVAILABLE | typeof RECOVERY_NOT_SAVED | typeof RECOVERY_PASSWORD_REFUSED,
): 'signup.confirm.error.unavailable' | 'signup.recovery.error.notSaved' | 'signup.recovery.error.refused' {
  if (outcome === LINK_UNAVAILABLE) return 'signup.confirm.error.unavailable';
  if (outcome === RECOVERY_PASSWORD_REFUSED) return 'signup.recovery.error.refused';

  return 'signup.recovery.error.notSaved';
}

/** Whether a link's type is recovery's: the press then also saves a password. */
export function isRecoveryLink(type: unknown): boolean {
  return type === 'recovery';
}

/** Whether a confirmed link goes on to setup (a signup) rather than the app. */
export function confirmsSignup(link: MailLink): boolean {
  return link.type === 'signup';
}

// --------------------------------------------------------- the screens' data

/** Which link the neutral screen sends again. */
export const SENT_SIGNUP = 'signup';
export const SENT_RECOVERY = 'recovery';

export type SentKind = typeof SENT_SIGNUP | typeof SENT_RECOVERY;

/** An address field before anything is typed or kept. */
export const NO_ADDRESS = '';

/** A password field that is not on screen. */
export const NO_PASSWORD = '';

/** `/postavljanje`'s search: `Adresa je potvrđena.` once, on arrival from `/potvrda`. */
export function setupSearchOf(search: Record<string, unknown>): { potvrdeno?: true } {
  return search['potvrdeno'] === true || search['potvrdeno'] === 'true' ? { potvrdeno: true } : {};
}

// -------------------------------------------------------------- the switch

/**
 * AD-21's third switch: `VITE_SIGNUP_ENABLED` renders `/registracija`, the
 * *Prijava* link to it and `/zaboravljena-lozinka`. Cosmetic, not a control:
 * the door is GoTrue's environment and `private.signup_settings`.
 * `require-config.mjs` refuses it for production. Exactly `true` opens it.
 */
export function signupEnabledFrom(value: unknown): boolean {
  return value === 'true';
}

export function signupEnabled(): boolean {
  return signupEnabledFrom(import.meta.env.VITE_SIGNUP_ENABLED);
}
