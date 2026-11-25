import { queryOptions } from '@tanstack/react-query';

import { compareText } from '@/lib/i18n/format';

/**
 * The job role list: one organization's roles, read once, and everything
 * *Organizacija*'s *Poslovi* card and the member page's *Posao* picker derive
 * from them (story 21.12).
 *
 * `0078` holds a role as a NAME and whether it is ARCHIVED, and nothing else.
 * Every active member reads the table (archived roles included); only an
 * active admin writes it, and nobody deletes a role. NOTHING DERIVES ANYTHING
 * FROM A ROLE: no rule, no notification, no guard reads one.
 *
 * EVERYTHING THE SURFACES DECIDE IS HERE, for the reason
 * `@/features/absence-types/services/list` gives: a `.tsx` is collected by no
 * test (AD-15), so the parsing, the order, the picker's options and the
 * surface state are pure functions the node suite executes.
 *
 * NOTHING NAMES A ROLE (DI-8): a role's name is data that is only shown.
 *
 * `select` AND NOTHING ELSE. Writing is `@/features/job-roles/services/write`.
 */

/** The relation both job role modules name. */
export const JOB_ROLES_TABLE = 'job_roles';

/** The single query key the job roles are read under. */
export const JOB_ROLES_LIST_KEY = ['jobRoles'] as const;

/**
 * The columns this read selects. `organization_id` renders nowhere and is the
 * tripwire {@link readJobRoles} uses to refuse an answer spanning two tenants.
 */
export const JOB_ROLES_COLUMNS = 'organization_id,id,name,archived';

/** The exact count, so a truncated answer is caught rather than rendered. */
export const JOB_ROLES_COUNT: JobRolesCountOptions = { count: 'exact' };

/** Five minutes, the bound `ABSENCE_TYPES_READ_STALE_MS` sets, for the same reason. */
export const JOB_ROLES_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const JOB_ROLES_FETCH_PAUSED = 'paused';

/**
 * The list could not be read, or what came back cannot be trusted as one.
 * The only failure: an organization with no role answers an empty list, which
 * is an answer the card draws, not a refusal.
 */
export const JOB_ROLES_UNAVAILABLE = 'JOB_ROLES_UNAVAILABLE';

export type JobRolesFailure = typeof JOB_ROLES_UNAVAILABLE;

export type JobRolesOutcome =
  | { readonly ok: true; readonly roles: readonly JobRoleRow[] }
  | { readonly ok: false; readonly code: JobRolesFailure };

/** As much of a PostgREST error as this module reads. */
export interface JobRolesReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface JobRolesCountOptions {
  readonly count: 'exact';
}

export interface JobRolesAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: JobRolesReadFailure | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface JobRolesTable {
  select(columns: string, options: JobRolesCountOptions): PromiseLike<JobRolesAnswer>;
}

/** One stored role, as every surface sees it. */
export interface JobRoleRow {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

/**
 * One PostgREST row as a role, or `null` — validated field by field rather
 * than cast, so a malformed row refuses the answer.
 */
export function jobRoleRowOf(row: unknown): JobRoleRow | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;
  const id = textAt(fields, 'id');
  const name = textAt(fields, 'name');
  const archived = fields['archived'];

  if (id === null || id === '' || name === null || typeof archived !== 'boolean') return null;

  return { id, name, archived };
}

/**
 * The order every surface lists roles in: live roles first, then archived
 * ones, each by name in Croatian collation (`compareText`), the id breaking a
 * tie so the order never depends on the answer's.
 */
export function compareJobRoles(first: JobRoleRow, second: JobRoleRow): number {
  const archived = Number(first.archived) - Number(second.archived);

  if (archived !== 0) return archived;

  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/** The roles in the card's order, as a new array. */
export function orderedJobRoles(roles: readonly JobRoleRow[]): JobRoleRow[] {
  return [...roles].sort(compareJobRoles);
}

/**
 * Every role this session reaches, in the card's order, or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * `data` that is not an array, on a missing exact count or one that disagrees
 * with the rows, on a row that does not validate, on two rows sharing an id,
 * and on an answer spanning two organizations.
 */
export async function readJobRoles(table: JobRolesTable): Promise<JobRolesOutcome> {
  let answered: JobRolesAnswer;

  try {
    answered = await table.select(JOB_ROLES_COLUMNS, JOB_ROLES_COUNT);
  } catch (cause) {
    console.error(JOB_ROLES_UNAVAILABLE, cause);

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(JOB_ROLES_UNAVAILABLE, typeof answered);

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(JOB_ROLES_UNAVAILABLE, answered.error.code);

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  if (answered.data !== null && !Array.isArray(answered.data)) {
    console.error(JOB_ROLES_UNAVAILABLE, 'data');

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  const rows: readonly unknown[] = answered.data ?? [];

  if (answered.count === null || answered.count !== rows.length) {
    console.error(JOB_ROLES_UNAVAILABLE, answered.count, rows.length);

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  const roles: JobRoleRow[] = [];
  const organizations = new Set<unknown>();

  for (const row of rows) {
    const role = jobRoleRowOf(row);

    if (role === null) {
      console.error(JOB_ROLES_UNAVAILABLE, 'row');

      return { ok: false, code: JOB_ROLES_UNAVAILABLE };
    }

    organizations.add((row as Record<string, unknown>)['organization_id']);
    roles.push(role);
  }

  if (new Set(roles.map((role) => role.id)).size !== roles.length) {
    console.error(JOB_ROLES_UNAVAILABLE, 'ids');

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  if (organizations.size > 1 || [...organizations].some((organization) => typeof organization !== 'string')) {
    console.error(JOB_ROLES_UNAVAILABLE, 'organizations');

    return { ok: false, code: JOB_ROLES_UNAVAILABLE };
  }

  return { ok: true, roles: orderedJobRoles(roles) };
}

// ------------------------------------------------------------ the picker

/** The *Posao* picker's value for *Bez posla*: the column stores `null`. */
export const NO_JOB_ROLE = '';

/**
 * The roles the member page's *Posao* picker offers, after *Bez posla*: every
 * live role, plus the member's own role whatever its state. THE HELD ROLE IS
 * ALWAYS OFFERED, from the member's own row when the cached list lacks it (a
 * stale read, or a role archived or added since): a picker without it would
 * open on *Bez posla*, and a save of any other field would clear the role.
 * An archived role nobody holds is hidden.
 */
export function jobRoleOptionsFor(roles: readonly JobRoleRow[], held: JobRoleRow | null): JobRoleRow[] {
  const offered = roles.filter((role) => !role.archived || role.id === held?.id);
  const listed = held === null || offered.some((role) => role.id === held.id);

  return orderedJobRoles(listed || held === null ? offered : [...offered, held]);
}

/** The picker's value for a held role: its id, or {@link NO_JOB_ROLE}. */
export function jobRoleInitialValue(heldId: string | null): string {
  return heldId ?? NO_JOB_ROLE;
}

/**
 * The role id a picker value IS among the options, `null` for *Bez posla*, or
 * `undefined` for a value outside them (a stale option): never a cast, and
 * never a write of an id the picker did not offer.
 */
export function chosenJobRoleId(value: string, options: readonly JobRoleRow[]): string | null | undefined {
  if (value === NO_JOB_ROLE) return null;

  return options.find((role) => role.id === value)?.id;
}

/**
 * The job role a basics save writes, or `undefined` for "leave it alone".
 *
 * ONLY A CHANGED PICK WRITES. `openedWith` is the picker's value when the
 * dialog opened; a pick equal to it is untouched, so a save of the name or
 * the address never writes the role back, and a role another admin set
 * meanwhile is not undone by a stale dialog. A pick that is no longer among
 * the options (a stale option) is untouched too. *Bez posla* is `null`.
 */
export function jobRoleEditOf(
  openedWith: string,
  picked: string,
  options: readonly JobRoleRow[],
): string | null | undefined {
  if (picked === openedWith) return undefined;

  return chosenJobRoleId(picked, options);
}

/**
 * The value a *Posao* picker opened with, off its `data-opened-with`
 * attribute; with none, its current value (so nothing reads as changed).
 */
export function jobRoleOpenedWithOf(picker: { readonly dataset: DOMStringMap; readonly value: string }): string {
  return picker.dataset['openedWith'] ?? picker.value;
}

/**
 * Whether the member page names a role at all: the member holds one, or the
 * organization has a live one to give. With neither, the page is as it was
 * before roles existed.
 */
export function jobRolesOffered(roles: readonly JobRoleRow[] | null, heldId: string | null): boolean {
  if (heldId !== null) return true;

  return roles !== null && roles.some((role) => !role.archived);
}

// ------------------------------------------------------------ the messages

/** The message a read failure renders as. Exhaustive. */
export function jobRolesMessageKey(failure: JobRolesFailure): 'organization.jobRoles.error.unavailable' {
  if (failure === JOB_ROLES_UNAVAILABLE) return 'organization.jobRoles.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition every surface reads {@link JOB_ROLES_LIST_KEY}
 * with. UNAVAILABLE REJECTS, and the table is resolved inside the query
 * function, for the reasons `absenceTypesQueryOptions` gives.
 */
export function jobRolesQueryOptions(table: () => JobRolesTable) {
  return queryOptions({
    queryKey: JOB_ROLES_LIST_KEY,
    queryFn: async (): Promise<readonly JobRoleRow[]> => {
      const outcome = await readJobRoles(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.roles;
    },
    staleTime: JOB_ROLES_READ_STALE_MS,
    refetchOnWindowFocus: false,
    // One retry, one second apart, as `absenceTypesQueryOptions` and for its reason.
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface JobRolesQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: readonly JobRoleRow[] | undefined;
}

export interface JobRolesSurfaceState {
  /** The roles to draw, or `null` when there is no answer to draw. */
  readonly roles: readonly JobRoleRow[] | null;
  readonly refusal: JobRolesFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
  /** A refetch paused offline over cached rows; never a refusal. */
  readonly paused: boolean;
}

/** One query result as what the card shows, by `absenceTypesSurfaceStateOf`'s rule. */
export function jobRolesSurfaceStateOf(answer: JobRolesQueryAnswer): JobRolesSurfaceState {
  const roles = answer.data ?? null;
  const pausedFetch = answer.fetchStatus === JOB_ROLES_FETCH_PAUSED;

  if (answer.isError || (answer.isPending && pausedFetch)) {
    return { roles, refusal: JOB_ROLES_UNAVAILABLE, loading: false, paused: false };
  }

  return { roles, refusal: null, loading: answer.isPending, paused: pausedFetch };
}

/** What the card announces, by `absenceTypesNoticeOf`'s rule. */
export function jobRolesNoticeOf(state: JobRolesSurfaceState): JobRolesFailure | null {
  return state.refusal ?? (state.paused ? JOB_ROLES_UNAVAILABLE : null);
}
