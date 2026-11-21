/**
 * The synthesized sign-in address (AD-12), built here and nowhere else.
 *
 * Accounts are usable with no email, so the credential an admin issues is a
 * username — and GoTrue authenticates against an email address. AD-12 closes
 * that gap by synthesizing one per account, namespaced by the organization's
 * slug: `ivan.maric@dvd-kastel-novi.shift.invalid`. `supabase/seed.sql` builds
 * exactly this string with `username || '@' || slug || '.shift.invalid'`, and
 * story 1.5 will build it again when it issues further credentials, so the
 * expression has one home and this is it.
 *
 * Why here rather than either obvious alternative: `pages/literal-sweep.test.ts` makes every
 * non-import string literal in a screen an offence, so a `.tsx` cannot hold the
 * `'@'` or the domain; and `packages/domain` is pure by construction
 * (`eslint.config.js`, `packages/domain/test/purity.test.ts`), which is a rule
 * about dependencies rather than about this — but AD-12's address is an
 * authentication-transport detail, not a domain term, and putting it there would
 * make the domain package the place people look for auth wiring.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, which is the point:
 * these addresses are identifiers, never mailboxes. Nothing is ever sent to one,
 * and a typo cannot deliver mail to a real domain.
 *
 * No runtime dependency and no client import, deliberately — this module is a
 * pure function of two strings, so the whole of it is executable from the node
 * suite (AD-15) with nothing running.
 */

/** The reserved domain every synthesized address sits under (RFC 2606). */
export const ADDRESS_DOMAIN = 'shift.invalid';

/** Thrown by `signInAddress` when the slug is not a legal DNS label. */
export const INVALID_ORGANIZATION_SLUG = 'INVALID_ORGANIZATION_SLUG';

/** Thrown by `signInAddress` when the username cannot be a local part. */
export const INVALID_USERNAME = 'INVALID_USERNAME';

/**
 * The slug rule, verbatim from `0002_organizations_and_members.sql`.
 *
 * Two halves, and both are load-bearing. The pattern is what a DNS label may
 * hold — lowercase alphanumerics in hyphen-separated runs, so no leading,
 * trailing or doubled hyphen — and 63 is the DNS label length limit. Without the
 * length half the pattern admits a slug that cannot appear in a hostname, and
 * the first thing built from it is the domain part of every sign-in address.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 63;

/** Whether a URL segment could be an organization slug at all. */
export function isOrganizationSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * The slug rule applied to what somebody typed or what a URL carries: the
 * normalized slug, or `null` for "this can never name an organization".
 *
 * Extracted from the screens rather than written inside them, for the reason
 * `apps/web/src/lib/i18n/boot.ts` was extracted from `main.tsx`: AD-15 bans jsdom
 * and `.tsx` files are not collected, so a decision left in a component can
 * only ever be regexed, and a regex over source cannot tell a guard that runs
 * from a guard that was written and then bypassed. Here the decision is
 * executed, one case per outcome.
 *
 * Trimming and lowercasing before the check rather than rejecting on them: a
 * slug is a DNS label, and the two things a person does to one while typing it
 * are add a space and hold shift. Neither is a mistake worth a refusal.
 *
 * THREE CALLERS, and two are security-relevant rather than cosmetic, so
 * changing this function's behaviour for one caller's sake changes the auth
 * path too. `sign-in.ts` asks it whether to make an authentication request at
 * all — for the organization the sign-in form's row or field supplies (story
 * 7.7) — and `prijava.tsx`'s `beforeLoad` asks it whether the form should
 * render for this URL. `last-organization.ts` asks it what to remember after a
 * successful sign-in and whether a stored value may prefill the field. Its
 * name says "destination" because the old organization prompt came first —
 * read it as the slug rule, and add a case here only if every caller wants it.
 */
export function organizationDestination(typed: string): string | null {
  const slug = typed.trim().toLowerCase();

  return isOrganizationSlug(slug) ? slug : null;
}

/**
 * A username cannot carry whitespace or a second `@`: either makes the address
 * built from it something other than the address the account holds.
 */
const UNBUILDABLE_IN_A_LOCAL_PART = /[\s@]/;

/**
 * What somebody typed into the username field, as the account's local part —
 * or `null` for "this can never name an account".
 *
 * Trimmed and lowercased, for exactly the reason `organizationDestination`
 * trims and lowercases the other half: the two things a person does to an
 * identifier while typing it are add a space and hold shift, and neither is a
 * mistake. Without this, `Ivan.Maric` and a pasted ` ivan.maric ` build
 * addresses no account holds, and the answer is the ordinary refusal — which is
 * unrecoverable, because it is indistinguishable from a wrong password and the
 * screen may not say which.
 *
 * Rejection is deliberately narrow. Story 1.5 issues usernames and this module
 * must not decide their shape a story early, so what is refused here is only
 * what makes the ADDRESS wrong: nothing at all, and characters that cannot sit
 * in a local part.
 */
export function normalizeUsername(username: string): string | null {
  const normalized = username.trim().toLowerCase();

  if (normalized === '' || UNBUILDABLE_IN_A_LOCAL_PART.test(normalized)) return null;

  return normalized;
}

/**
 * AD-12's address for one member of one organization.
 *
 * Both halves are NORMALIZED and then checked, rather than trusted: the slug
 * arrives from the URL and the username from a text field, and anything can be
 * typed into either. A caller that wants to decide what an unusable value means
 * — and the sign-in path does, since it must disclose nothing about which
 * organizations or usernames exist — asks `organizationDestination` and
 * `normalizeUsername` first and never sees these throws.
 *
 * The throws remain because this function has a second caller shape ahead of it
 * (story 1.5 issues credentials against the same expression) and an address
 * built from an unusable part is worse than no address: it authenticates
 * nothing, silently, forever.
 */
export function signInAddress(username: string, slug: string): string {
  const account = normalizeUsername(username);

  if (account === null) throw new Error(INVALID_USERNAME);

  const organization = organizationDestination(slug);

  if (organization === null) throw new Error(INVALID_ORGANIZATION_SLUG);

  return `${account}@${organization}.${ADDRESS_DOMAIN}`;
}

/**
 * The organization a session's synthesized address names (AD-12), or `null`
 * when the address is not one this module would build.
 *
 * The inverse of `signInAddress`, for one reader: `/prijava/$slug` asks which
 * organization the visitor is signed in to, to tell a link for that
 * organization (followed, as before) from a link for another one (offered,
 * retro 10 A5). The session's `user.email` is GoTrue's copy of the address
 * the person signed in with, so the slug is its domain less
 * {@link ADDRESS_DOMAIN}. Normalized and checked by the same slug rule, so the
 * answer compares equal to `organizationDestination` of a URL's segment.
 *
 * `null` for anything else — no address, a real mailbox, a malformed label —
 * and the caller then keeps its earlier behaviour: an address that does not
 * parse never decides anything on its own.
 */
export function organizationOfAddress(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;

  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf('@');

  if (at <= 0) return null;

  const domain = address.slice(at + 1);
  const suffix = `.${ADDRESS_DOMAIN}`;

  if (!domain.endsWith(suffix)) return null;

  const slug = domain.slice(0, -suffix.length);

  return isOrganizationSlug(slug) ? slug : null;
}

// ------------------------------------------------------- the two identity kinds

/**
 * AD-12's predicate, the SPA's home of it (story 19.2). The other two homes are
 * `private.address_kind` (0066) and the function rendered into Kong's mail
 * route; all three run `test/fixtures/synthesized-addresses.json`.
 *
 * Normalization first, exactly as the other homes do it: trim ASCII white
 * space (tab, line feed, vertical tab, form feed, carriage return, space) and
 * lower-case ASCII letters ONLY (19.1's D5), so a Unicode case fold can never
 * make the homes disagree. Malformed is no `@`, more than one `@`, a double or
 * single quote, or an empty part. The domain loses one trailing `.`.
 */
export type AddressKind = 'synthesized' | 'email' | 'malformed';

const ASCII_WHITESPACE = '\t\n\v\f\r ';

/** Trims ASCII white space only: `String.prototype.trim` would also take a no-break space. */
export function trimAsciiWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && ASCII_WHITESPACE.includes(text.charAt(start))) start += 1;
  while (end > start && ASCII_WHITESPACE.includes(text.charAt(end - 1))) end -= 1;

  return text.slice(start, end);
}

/** Lower-cases A–Z and nothing else. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** The kind of an auth address: synthesized (a username identity), email, or malformed. */
export function addressKind(address: string | null | undefined): AddressKind {
  if (typeof address !== 'string') return 'malformed';

  const normalized = asciiLower(trimAsciiWhitespace(address));

  if (normalized.includes('"') || normalized.includes("'")) return 'malformed';

  const parts = normalized.split('@');

  if (parts.length !== 2) return 'malformed';

  const local = parts[0] ?? '';
  const rawDomain = parts[1] ?? '';
  const domain = rawDomain.endsWith('.') ? rawDomain.slice(0, -1) : rawDomain;

  if (local === '' || domain === '') return 'malformed';
  if (domain === ADDRESS_DOMAIN || domain.endsWith(`.${ADDRESS_DOMAIN}`)) return 'synthesized';

  return 'email';
}

/** Whether an address is a username identity's (AD-12). */
export function isSynthesizedAddress(address: string | null | undefined): boolean {
  return addressKind(address) === 'synthesized';
}

/**
 * GoTrue v2.196.0's own address check, read from the pinned binary
 * (`badoux/checkmail`'s pattern, ASCII-only and anchored), with the apostrophe
 * taken out of the local part: every home refuses `'` (19.1's D9, kept by
 * 19.2). GoTrue also refuses an address longer than 255.
 */
const GOTRUE_ADDRESS_PATTERN =
  /^[a-zA-Z0-9.!#$%&*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const GOTRUE_ADDRESS_MAX_LENGTH = 255;

/**
 * What a signup, resend, recovery or email sign-in sends: the address trimmed
 * of ASCII white space, or `null` when the SPA must refuse it on the page.
 *
 * WHY REFUSE HERE. Kong answers every mail request `200 {}` (AD-22) and relays
 * only an email identity's address in printable ASCII; GoTrue then refuses
 * what its own pattern refuses, unseen. Anything this function lets through is
 * an address the gateway relays and GoTrue accepts, so the masked answer never
 * strands someone who typed something plausible (deferred-work, OWNER 19.2).
 * A synthesized address is refused too: it is never a mailbox.
 */
export function signupAddressOf(typed: string): string | null {
  const address = trimAsciiWhitespace(typed);

  if (addressKind(address) !== 'email') return null;
  if (address.length > GOTRUE_ADDRESS_MAX_LENGTH) return null;
  if (!GOTRUE_ADDRESS_PATTERN.test(address)) return null;

  return address;
}

/**
 * Whether a sign-in entry is an email address (AD-12): it holds an `@`. A
 * username never can (`members_username_check`), so the two kinds can never be
 * confused.
 */
export function isEmailEntry(entry: string): boolean {
  return entry.includes('@');
}
