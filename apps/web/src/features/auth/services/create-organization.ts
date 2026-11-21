import type { Session } from '@supabase/supabase-js';

import {
  APP_DESTINATION,
  SIGN_OUT_DESTINATION,
  sessionDestination,
  type SessionDestination,
} from '@/features/auth/services/session-destination';
import { formatMonthName, isRenderableTimeZone, supportedTimeZones } from '@/lib/i18n/format';
import { NAME_MAX_LENGTH, enteredName } from '@/utils/name';

/**
 * Story 19.3 (AD-23, AD-24, UX-DR66): step 1 of `/postavljanje`, *Nova
 * organizacija*, as rules and outcomes the screen renders.
 *
 * THE DATABASE IS THE BOUNDARY. `public.create_organization` (0071) takes no
 * id and no address, acts on `auth.uid()` alone, and checks everything here
 * again. The page refuses the same input before sending (D10), so a request
 * that leaves the page can fail only for a reason the person cannot see:
 * a taken or reserved slug, a limit, or a state that is not theirs to fix.
 *
 * The client is a PARAMETER, structural and narrow, so every outcome is
 * executable from the node suite (AD-15) against a stub, as `signup.ts` does.
 */

// --------------------------------------------------------------- the slug

/** 0002's rule: a DNS label, the domain part of every issued sign-in address. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The DNS label limit (0002). */
export const SLUG_MAX_LENGTH = 63;

/** Whether a slug passes 0002's rule. */
export function slugFits(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * The slug proposed from the typed name (UX-DR66), until the person edits it:
 * Croatian letters folded to ASCII (`đ` too, which has no decomposition),
 * every other run of characters a single `-`, cut to 63 characters. A name
 * with no letter or digit proposes nothing.
 */
export function slugProposalOf(name: string): string {
  return foldedToAscii(name.toLocaleLowerCase('hr'))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * Letters NFKD does not decompose to ASCII, mapped by hand (review of 19.3):
 * `đ`, `ł`, `ø`, `æ`, `ß` and the Croatian digraph letters (U+01C4–U+01CC,
 * which NFKD maps to `dž`, `lj`, `nj`, then folded below).
 */
const ASCII_FOLDS: Readonly<Record<string, string>> = {
  đ: 'd',
  ł: 'l',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
  ð: 'd',
  ı: 'i',
};

/** NFKD, combining marks dropped, then the hand-made folds. Lower-cased input. */
function foldedToAscii(lower: string): string {
  return [...lower.normalize('NFKD').replace(/\p{M}/gu, '')].map((letter) => ASCII_FOLDS[letter] ?? letter).join('');
}

// ----------------------------------------------------------- the timezone

/** The operator script's shape (0071's `private.is_known_timezone`): `Area/Location`. */
const ZONE_SHAPE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/;
/** `posix/`, `right/` and `Etc/` (inverted POSIX signs: `Etc/GMT+1` is UTC−1; review of 19.3). */
const ZONE_ALIAS = /^(posix|right|Etc)\//;

/**
 * Whether a zone is one the database could accept and the browser reads: the
 * shape `private.is_known_timezone` holds, and a name `Intl` knows. The
 * database's own `pg_timezone_names` is the last word (`TIMEZONE_UNKNOWN`).
 * `test/fixtures/known-timezones.json` is the parity vector.
 */
export function zoneUsable(zone: string): boolean {
  return ZONE_SHAPE.test(zone) && !ZONE_ALIAS.test(zone) && isRenderableTimeZone(zone);
}

/**
 * The device's zone, proposed and never assumed (D11): the screen shows it
 * with *Potvrdi* and *Odaberi drugu*, because it is locked afterwards. `null`
 * when the device names none the database could take (`UTC`, an abbreviation).
 * The ONE read of the device zone, and the one `Intl` reach outside
 * `lib/i18n/format.ts` (`format.test.ts` names it): that module renders in the
 * organization's zone only and may never ask the runtime for the ambient one.
 */
export function deviceZoneOf(read: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  let zone: string | undefined;

  try {
    zone = read();
  } catch {
    return null;
  }

  return zone !== undefined && zoneUsable(zone) ? zone : null;
}

/**
 * Zones offered where the runtime lists none (`Intl.supportedValuesOf` is
 * missing): a short neutral list, every one usable and none `Etc/` (review
 * of 19.3). The device's zone is added to it.
 */
export const FALLBACK_ZONES: readonly string[] = [
  'Europe/Zagreb',
  'Europe/Ljubljana',
  'Europe/Belgrade',
  'Europe/Sarajevo',
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/**
 * The zones *Odaberi drugu* offers: every one listed that the shape admits,
 * sorted, once each, with the device's proposed zone always among them; the
 * fallback list when the runtime lists none.
 */
export function zoneChoicesOf(listed: readonly string[], proposed: string | null = null): readonly string[] {
  const source = listed.length === 0 ? FALLBACK_ZONES : listed;
  const all = proposed === null ? source : [...source, proposed];

  return [...new Set(all.filter(zoneUsable))].sort((a, b) => a.localeCompare(b, 'en'));
}

/** The browser's own list (`lib/i18n/format.ts`, the one module that lists it). */
export function browserZones(): readonly string[] {
  return supportedTimeZones();
}

// ------------------------------------------------------- the leave year start

/** The last day a leave year may start on (0002: 1–28 in every month). */
export const LEAVE_START_LAST_DAY = 28;

/** `1` to `28`. */
export const LEAVE_START_DAY_OPTIONS: readonly number[] = Array.from({ length: LEAVE_START_LAST_DAY }, (_, index) => index + 1);

const REFERENCE_YEAR = 2001;
const REFERENCE_DAY = 15;
const REFERENCE_ZONE = 'UTC';

/** The twelve months, named in the application's locale. */
export const LEAVE_START_MONTH_OPTIONS: readonly { readonly value: number; readonly label: string }[] = Array.from(
  { length: 12 },
  (_, index) => ({
    value: index + 1,
    label: formatMonthName(new Date(Date.UTC(REFERENCE_YEAR, index, REFERENCE_DAY)), REFERENCE_ZONE),
  }),
);

/** A select with nothing chosen (UX-DR66: nothing pre-selected). */
export const NOTHING_CHOSEN = '';

// ---------------------------------------------------------------- the input

/** `members.leave_allowance_days` is a smallint. */
export const ALLOWANCE_MAX = 32767;

/** What the person typed and chose, as strings. */
export interface OrganizationForm {
  readonly name: string;
  readonly slug: string;
  readonly organizationType: string;
  /** The confirmed or chosen zone; `null` while it is only proposed. */
  readonly timezone: string | null;
  readonly leaveDay: string;
  readonly leaveMonth: string;
  readonly adminName: string;
  readonly allowance: string;
}

export const NAME_MISSING = 'NAME_MISSING';
export const SLUG_INVALID = 'SLUG_INVALID';
export const TYPE_MISSING = 'TYPE_MISSING';
export const TIMEZONE_UNCONFIRMED = 'TIMEZONE_UNCONFIRMED';
export const LEAVE_START_MISSING = 'LEAVE_START_MISSING';
export const ADMIN_NAME_MISSING = 'ADMIN_NAME_MISSING';
export const ALLOWANCE_INVALID = 'ALLOWANCE_INVALID';

export type OrganizationRefusal =
  | typeof NAME_MISSING
  | typeof SLUG_INVALID
  | typeof TYPE_MISSING
  | typeof TIMEZONE_UNCONFIRMED
  | typeof LEAVE_START_MISSING
  | typeof ADMIN_NAME_MISSING
  | typeof ALLOWANCE_INVALID;

/** The values the definer is called with, once the page has refused nothing. */
export interface OrganizationRequest {
  readonly p_name: string;
  readonly p_slug: string;
  readonly p_organization_type: string;
  readonly p_timezone: string;
  readonly p_leave_year_start_month: number;
  readonly p_leave_year_start_day: number;
  readonly p_admin_name: string;
  readonly p_admin_leave_allowance_days: number;
}

function enteredWithin(value: string): string | null {
  const entered = enteredName(value);

  return entered === null || [...entered].length > NAME_MAX_LENGTH ? null : entered;
}

function wholeNumberWithin(value: string, low: number, high: number): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);

  return parsed >= low && parsed <= high ? parsed : null;
}

/** What the page refuses with no request, in the form's order (D10). */
export function organizationRefusalsOf(form: OrganizationForm): readonly OrganizationRefusal[] {
  const refusals: OrganizationRefusal[] = [];

  if (enteredWithin(form.name) === null) refusals.push(NAME_MISSING);
  if (!slugFits(form.slug)) refusals.push(SLUG_INVALID);
  if (enteredWithin(form.organizationType) === null) refusals.push(TYPE_MISSING);
  if (form.timezone === null || !zoneUsable(form.timezone)) refusals.push(TIMEZONE_UNCONFIRMED);
  if (wholeNumberWithin(form.leaveDay, 1, LEAVE_START_LAST_DAY) === null || wholeNumberWithin(form.leaveMonth, 1, 12) === null) {
    refusals.push(LEAVE_START_MISSING);
  }
  if (enteredWithin(form.adminName) === null) refusals.push(ADMIN_NAME_MISSING);
  if (wholeNumberWithin(form.allowance, 0, ALLOWANCE_MAX) === null) refusals.push(ALLOWANCE_INVALID);

  return refusals;
}

/** The request for a form the page refuses nothing of, or `null`. */
export function organizationRequestOf(form: OrganizationForm): OrganizationRequest | null {
  if (organizationRefusalsOf(form).length > 0) return null;

  return {
    p_name: enteredName(form.name) ?? '',
    p_slug: form.slug,
    p_organization_type: enteredName(form.organizationType) ?? '',
    p_timezone: form.timezone ?? '',
    p_leave_year_start_month: Number(form.leaveMonth.trim()),
    p_leave_year_start_day: Number(form.leaveDay.trim()),
    p_admin_name: enteredName(form.adminName) ?? '',
    p_admin_leave_allowance_days: Number(form.allowance.trim()),
  };
}

/** The message key each local refusal renders as. */
export function organizationRefusalMessageKey(
  refusal: OrganizationRefusal,
):
  | 'signup.setup.error.name'
  | 'signup.setup.error.slug'
  | 'signup.setup.error.type'
  | 'signup.setup.error.timezone'
  | 'signup.setup.error.leaveStart'
  | 'signup.setup.error.adminName'
  | 'signup.setup.error.allowance' {
  switch (refusal) {
    case NAME_MISSING:
      return 'signup.setup.error.name';
    case SLUG_INVALID:
      return 'signup.setup.error.slug';
    case TYPE_MISSING:
      return 'signup.setup.error.type';
    case TIMEZONE_UNCONFIRMED:
      return 'signup.setup.error.timezone';
    case LEAVE_START_MISSING:
      return 'signup.setup.error.leaveStart';
    case ADMIN_NAME_MISSING:
      return 'signup.setup.error.adminName';
    case ALLOWANCE_INVALID:
      return 'signup.setup.error.allowance';
  }
}

// -------------------------------------------------------------- the answer

export const ORGANIZATION_CREATED = 'ORGANIZATION_CREATED';
export const SLUG_UNAVAILABLE = 'SLUG_UNAVAILABLE';
export const TRY_LATER = 'TRY_LATER';
export const ORGANIZATION_NOT_CREATABLE = 'ORGANIZATION_NOT_CREATABLE';
export const ORGANIZATION_INPUT_INVALID = 'ORGANIZATION_INPUT_INVALID';
export const ORGANIZATION_TIMEZONE_UNKNOWN = 'ORGANIZATION_TIMEZONE_UNKNOWN';
/** No answer worth reading: offline, a blocked request, a 5xx. Pressing again is safe. */
export const CREATE_UNAVAILABLE = 'CREATE_UNAVAILABLE';

export type CreateOutcome =
  | { readonly code: typeof ORGANIZATION_CREATED; readonly organizationId: string; readonly slug: string }
  | { readonly code: typeof SLUG_UNAVAILABLE; readonly proposal: string }
  | { readonly code: typeof TRY_LATER }
  | { readonly code: typeof ORGANIZATION_NOT_CREATABLE }
  | { readonly code: typeof ORGANIZATION_INPUT_INVALID; readonly refusal: OrganizationRefusal }
  | { readonly code: typeof ORGANIZATION_TIMEZONE_UNKNOWN }
  | { readonly code: typeof CREATE_UNAVAILABLE };

/** As much of a `PostgrestError` as the mapping reads (`exactOptionalPropertyTypes`). */
export interface RpcFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | null | undefined;
}

/** The one call, named structurally so it can be stubbed. */
export interface CreateOrganizationClient {
  rpc(
    name: 'create_organization',
    args: OrganizationRequest,
  ): PromiseLike<{ data: unknown; error: RpcFailure | null; status?: number | undefined }>;
}

const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER = '22023';
const TOO_MANY_REQUESTS = 429;

/** 0071's `detail` for each refused field, mapped to the page's own refusal. */
const FIELD_REFUSALS: Readonly<Record<string, OrganizationRefusal>> = {
  name: NAME_MISSING,
  slug: SLUG_INVALID,
  organization_type: TYPE_MISSING,
  leave_year_start: LEAVE_START_MISSING,
  admin_name: ADMIN_NAME_MISSING,
  admin_leave_allowance_days: ALLOWANCE_INVALID,
};

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];

  return typeof field === 'string' && field !== '' ? field : null;
}

/** What one answer of the definer means. */
export function createOutcomeOf(answer: { data: unknown; error: RpcFailure | null; status?: number | undefined }): CreateOutcome {
  const { data, error } = answer;

  if (error !== null) {
    // Kong's per-IP limit on the route (AD-21): about the network, said as a limit.
    if (answer.status === TOO_MANY_REQUESTS) return { code: TRY_LATER };
    if (error.code === INSUFFICIENT_PRIVILEGE && error.message === ORGANIZATION_NOT_CREATABLE) {
      return { code: ORGANIZATION_NOT_CREATABLE };
    }
    if (error.code === INVALID_PARAMETER && error.message === ORGANIZATION_TIMEZONE_UNKNOWN) {
      return { code: ORGANIZATION_TIMEZONE_UNKNOWN };
    }
    if (error.code === INVALID_PARAMETER && error.message === ORGANIZATION_INPUT_INVALID) {
      const refusal = FIELD_REFUSALS[error.details ?? ''];
      if (refusal !== undefined) return { code: ORGANIZATION_INPUT_INVALID, refusal };
    }

    return { code: CREATE_UNAVAILABLE };
  }

  const code = stringField(data, 'code');

  if (code === ORGANIZATION_CREATED) {
    const organizationId = stringField(data, 'organizationId');
    const slug = stringField(data, 'slug');
    if (organizationId !== null && slug !== null) return { code, organizationId, slug };
  }
  if (code === SLUG_UNAVAILABLE) {
    const proposal = stringField(data, 'proposal');
    if (proposal !== null) return { code, proposal };
  }
  if (code === TRY_LATER) return { code };

  return { code: CREATE_UNAVAILABLE };
}

/**
 * *Stvori organizaciju*. The caller has refused what `organizationRefusalsOf`
 * refuses; this refuses it again (no request).
 */
export async function createOrganization(client: CreateOrganizationClient, form: OrganizationForm): Promise<CreateOutcome> {
  const request = organizationRequestOf(form);

  if (request === null) return { code: CREATE_UNAVAILABLE };

  try {
    return createOutcomeOf(await client.rpc('create_organization', request));
  } catch {
    return { code: CREATE_UNAVAILABLE };
  }
}

/** The message key a refusal from the definer renders as, on the form. */
export function createFailureMessageKey(
  outcome: CreateOutcome,
): 'signup.setup.error.tryLater' | 'signup.setup.error.timezoneUnknown' | 'signup.setup.error.unavailable' | null {
  if (outcome.code === TRY_LATER) return 'signup.setup.error.tryLater';
  if (outcome.code === ORGANIZATION_TIMEZONE_UNKNOWN) return 'signup.setup.error.timezoneUnknown';
  if (outcome.code === CREATE_UNAVAILABLE) return 'signup.setup.error.unavailable';

  return null;
}

// --------------------------------------------- after the definer answers

export const AFTER_NAVIGATE = 'navigate';
export const AFTER_SIGN_OUT = 'signOut';
export const AFTER_NOTICE = 'notice';

export type AfterCreate =
  | { readonly kind: typeof AFTER_NAVIGATE }
  | { readonly kind: typeof AFTER_SIGN_OUT }
  | { readonly kind: typeof AFTER_NOTICE; readonly key: 'signup.setup.error.routing' | 'signup.setup.error.unavailable' };

/**
 * What step 1 does once the session is refreshed after `ORGANIZATION_CREATED`
 * or `ORGANIZATION_NOT_CREATABLE` (AD-23 step 8, AD-24; review of 19.3):
 *
 * - `app`: the claim is there, so navigate to the return target;
 * - `signOut`: end the session on this device and go to *Prijava*;
 * - still `setup`, or no answer (the refresh failed twice): stay, and say so
 *   neutrally, never a silent bounce back to an empty form. After a creation
 *   the notice never says the organization was not created: it says the way
 *   on failed, and a second press only routes.
 */
export function afterCreateOf(
  code: typeof ORGANIZATION_CREATED | typeof ORGANIZATION_NOT_CREATABLE,
  destination: SessionDestination | null,
): AfterCreate {
  if (destination === APP_DESTINATION) return { kind: AFTER_NAVIGATE };
  if (destination === SIGN_OUT_DESTINATION) return { kind: AFTER_SIGN_OUT };

  return { kind: AFTER_NOTICE, key: afterCreateMessageKey(code) };
}

/** The notice's key: a creation whose way on failed, or a refusal still unresolved. */
export function afterCreateMessageKey(
  code: typeof ORGANIZATION_CREATED | typeof ORGANIZATION_NOT_CREATABLE,
): 'signup.setup.error.routing' | 'signup.setup.error.unavailable' {
  return code === ORGANIZATION_CREATED ? 'signup.setup.error.routing' : 'signup.setup.error.unavailable';
}

// ------------------------------------------------------ refresh and route

/** The one refresh call, named structurally. */
export interface RefreshAuth {
  refreshSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
}

/**
 * AD-23 step 8 and AD-24: after `ORGANIZATION_CREATED`, or after
 * `ORGANIZATION_NOT_CREATABLE`, the session is refreshed, so the hook stamps
 * the claim, and `sessionDestination` asks again. A failed refresh is retried
 * ONCE; after a second failure the answer is `null`, and the screen shows
 * `afterCreateOf`'s neutral notice instead of routing (review 1 of 19.3,
 * finding 6): the token it holds is still claimless, so the app's guard would
 * send it straight back here. The next press refreshes again and routes.
 * A refusal of the refresh (a banned account) is answered the same way, not
 * signed out: the spec's recorded deviation from AD-24's fourth answer.
 */
export async function refreshedDestination(auth: RefreshAuth): Promise<SessionDestination | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await auth.refreshSession();

      if (error === null && data.session !== null) return sessionDestination(data.session);
    } catch {
      // The transport; the loop retries once.
    }
  }

  return null;
}

// ------------------------------------------------------------ the screen

/** A text field before anything is typed. */
export const NOTHING_TYPED = '';

/** Each refusal's field, focused when it is the first one. */
export const CREATE_FIELD_IDS: Readonly<Record<OrganizationRefusal, string>> = {
  NAME_MISSING: 'create-organization-name',
  SLUG_INVALID: 'create-organization-slug',
  TYPE_MISSING: 'create-organization-type',
  TIMEZONE_UNCONFIRMED: 'create-organization-timezone',
  LEAVE_START_MISSING: 'create-organization-leave-day',
  ADMIN_NAME_MISSING: 'create-organization-admin-name',
  ALLOWANCE_INVALID: 'create-organization-allowance',
};

/** The form's other element ids: the refusal notice and the hints it describes fields by. */
export const CREATE_ELEMENT_IDS = {
  refusal: 'create-organization-refusal',
  slugHint: 'create-organization-slug-hint',
  slugRule: 'create-organization-slug-rule',
  typeHint: 'create-organization-type-hint',
  timezoneHint: 'create-organization-timezone-hint',
  leaveMonth: 'create-organization-leave-month',
  allowanceHint: 'create-organization-allowance-hint',
  slugProposal: 'create-organization-slug-proposal',
  useProposal: 'create-organization-use-proposal',
} as const;

/** The allowance's longest entry: `32767` (review of 19.3). */
export const ALLOWANCE_MAX_LENGTH = 5;

/** `aria-describedby` from the ids that apply, or none. */
export function describedByOf(ids: readonly (string | null)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== null);

  return present.length === 0 ? undefined : present.join(' ');
}
