import type { JobRoleRow } from '@/features/job-roles/services/list';
import { NAME_MAX_LENGTH, enteredName, hasControlCharacter } from '@/utils/name';

/**
 * Adding, renaming, archiving and restoring a job role — every decision the
 * *Poslovi* card makes, in a `.ts` that renders nothing (AD-15, story 21.12).
 *
 * FOUR WRITES, ALL PLAIN POSTGREST, all on `job_roles` alone. `0078`'s
 * policies admit an active admin to insert `(organization_id, name)` and to
 * update `(name, archived)`, archived rows included, so an archive is
 * reversible. Nothing deletes a role: no session holds the privilege, and this
 * module has no call for it. No member row is touched: a member holding an
 * archived role keeps it, and it still shows.
 *
 * ZERO ROWS ON AN UPDATE IS THE STALE REFUSAL: the role is out of this
 * session's reach since the card was drawn. On an insert, zero rows is the
 * service ({@link JOB_ROLE_WRITE_UNAVAILABLE}).
 *
 * A RESTORE OVER A LIVE ROLE OF THE SAME NAME is refused by the partial unique
 * index (23505), and reads as the name being taken, as an insert's does.
 *
 * Codes, never messages: {@link jobRoleWriteMessageKey} is the one edge.
 */

/** The name was empty once trimmed (client-side, or `job_roles_name_not_blank`). */
export const JOB_ROLE_NAME_EMPTY = 'JOB_ROLE_NAME_EMPTY';
/** The name is longer than `NAME_MAX_LENGTH` (client-side, or `job_roles_name_length`). */
export const JOB_ROLE_NAME_TOO_LONG = 'JOB_ROLE_NAME_TOO_LONG';
/** A line break or another control character inside the name (client-side, or `job_roles_name_characters`). */
export const JOB_ROLE_NAME_CONTROL = 'JOB_ROLE_NAME_CONTROL';
/** A live role in this organization carries the name, ignoring case and padding. */
export const JOB_ROLE_NAME_TAKEN = 'JOB_ROLE_NAME_TAKEN';
/** The role changed since the card was drawn (out of reach): zero rows. */
export const JOB_ROLE_STALE = 'JOB_ROLE_STALE';
/** The database refused the write outright (42501). */
export const JOB_ROLE_WRITE_REFUSED = 'JOB_ROLE_WRITE_REFUSED';
/** The service, not the person: try again. */
export const JOB_ROLE_WRITE_UNAVAILABLE = 'JOB_ROLE_WRITE_UNAVAILABLE';

export type JobRoleWriteFailure =
  | typeof JOB_ROLE_NAME_EMPTY
  | typeof JOB_ROLE_NAME_TOO_LONG
  | typeof JOB_ROLE_NAME_CONTROL
  | typeof JOB_ROLE_NAME_TAKEN
  | typeof JOB_ROLE_STALE
  | typeof JOB_ROLE_WRITE_REFUSED
  | typeof JOB_ROLE_WRITE_UNAVAILABLE;

export type JobRoleWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: JobRoleWriteFailure };

// ----------------------------------------------------------------- the seams

export interface JobRoleWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface JobRoleWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: JobRoleWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<JobRoleWriteAnswer>;
}

/** The two calls this module makes, named structurally so they can be stubbed. No delete. */
export interface JobRoleWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  update(values: Readonly<Record<string, unknown>>): {
    eq(column: string, value: string): Selecting;
  };
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';

// ---------------------------------------------------------------- the rules

/** How long a name is as `char_length` counts it: in code points. */
function codePoints(value: string): number {
  return [...value].length;
}

type Entered =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly code: JobRoleWriteFailure };

/**
 * The name as it will be sent, or the first refusal: blank, past
 * {@link NAME_MAX_LENGTH}, or holding a control character inside it.
 */
export function enteredJobRoleOf(name: string): Entered {
  const stored = enteredName(name);

  if (stored === null) return { ok: false, code: JOB_ROLE_NAME_EMPTY };
  if (codePoints(stored) > NAME_MAX_LENGTH) return { ok: false, code: JOB_ROLE_NAME_TOO_LONG };
  if (hasControlCharacter(stored)) return { ok: false, code: JOB_ROLE_NAME_CONTROL };

  return { ok: true, name: stored };
}

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** `0078`'s constraint names, as PostgreSQL quotes them in `message`. */
const NAME_UNIQUE = '"job_roles_organization_name_key"';
const NAME_CHECK = '"job_roles_name_not_blank"';
const NAME_LENGTH_CHECK = '"job_roles_name_length"';
const NAME_CHARACTERS_CHECK = '"job_roles_name_characters"';

/**
 * A PostgREST refusal on `job_roles`, as this application's own failure.
 *
 * BY CONSTRAINT NAME, read from `message` ONLY, where PostgreSQL quotes the
 * constraint, never from `details`, which holds the values typed — a name that
 * spells a constraint must not be read as one. `42501` is refused; anything
 * else, a constraint this module does not know included, is unavailable.
 */
export function jobRoleWriteFailureOf(error: JobRoleWriteError): JobRoleWriteFailure {
  const message = error.message ?? '';

  if (error.code === UNIQUE_VIOLATION && message.includes(NAME_UNIQUE)) return JOB_ROLE_NAME_TAKEN;
  if (error.code === CHECK_VIOLATION) {
    if (message.includes(NAME_CHECK)) return JOB_ROLE_NAME_EMPTY;
    if (message.includes(NAME_LENGTH_CHECK)) return JOB_ROLE_NAME_TOO_LONG;
    if (message.includes(NAME_CHARACTERS_CHECK)) return JOB_ROLE_NAME_CONTROL;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return JOB_ROLE_WRITE_REFUSED;

  return JOB_ROLE_WRITE_UNAVAILABLE;
}

/** Settle one write: a thrown call, an error, zero rows, or one row. */
async function settled(
  write: () => PromiseLike<JobRoleWriteAnswer>,
  noRows: JobRoleWriteFailure,
): Promise<JobRoleWriteOutcome> {
  let answered: JobRoleWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(JOB_ROLE_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: JOB_ROLE_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(JOB_ROLE_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: JOB_ROLE_WRITE_UNAVAILABLE };
  }

  // Rows that are not rows: the service, never the person.
  if (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data)) {
    console.error(JOB_ROLE_WRITE_UNAVAILABLE, 'data');

    return { ok: false, code: JOB_ROLE_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = jobRoleWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  if ((answered.data ?? []).length === 0) return { ok: false, code: noRows };

  return { ok: true };
}

/** Add a role. `organizationId` is the session's own claim; the name is checked before anything is sent. */
export async function createJobRole(
  table: JobRoleWriteTable,
  organizationId: string,
  name: string,
): Promise<JobRoleWriteOutcome> {
  const entered = enteredJobRoleOf(name);

  if (!entered.ok) return entered;

  return settled(
    () => table.insert({ organization_id: organizationId, name: entered.name }).select(RETURNED_COLUMNS),
    JOB_ROLE_WRITE_UNAVAILABLE,
  );
}

/** Rename a role in place; its id never changes. */
export async function renameJobRole(
  table: JobRoleWriteTable,
  role: JobRoleRow,
  name: string,
): Promise<JobRoleWriteOutcome> {
  const entered = enteredJobRoleOf(name);

  if (!entered.ok) return entered;

  return settled(
    () => table.update({ name: entered.name }).eq(ID_COLUMN, role.id).select(RETURNED_COLUMNS),
    JOB_ROLE_STALE,
  );
}

/**
 * Archive a role (`archived: true`) or restore one (`archived: false`). A
 * role already in the asked state is stale: the card was drawn from another.
 */
export async function setJobRoleArchived(
  table: JobRoleWriteTable,
  role: JobRoleRow,
  archived: boolean,
): Promise<JobRoleWriteOutcome> {
  if (role.archived === archived) return { ok: false, code: JOB_ROLE_STALE };

  return settled(
    () => table.update({ archived }).eq(ID_COLUMN, role.id).select(RETURNED_COLUMNS),
    JOB_ROLE_STALE,
  );
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function jobRoleWriteMessageKey(
  failure: JobRoleWriteFailure,
):
  | 'organization.jobRoles.error.nameEmpty'
  | 'organization.jobRoles.error.nameTooLong'
  | 'organization.jobRoles.error.nameControl'
  | 'organization.jobRoles.error.nameTaken'
  | 'organization.jobRoles.error.stale'
  | 'organization.jobRoles.error.refused'
  | 'organization.jobRoles.error.saveUnavailable' {
  if (failure === JOB_ROLE_NAME_EMPTY) return 'organization.jobRoles.error.nameEmpty';
  if (failure === JOB_ROLE_NAME_TOO_LONG) return 'organization.jobRoles.error.nameTooLong';
  if (failure === JOB_ROLE_NAME_CONTROL) return 'organization.jobRoles.error.nameControl';
  if (failure === JOB_ROLE_NAME_TAKEN) return 'organization.jobRoles.error.nameTaken';
  if (failure === JOB_ROLE_STALE) return 'organization.jobRoles.error.stale';
  if (failure === JOB_ROLE_WRITE_REFUSED) return 'organization.jobRoles.error.refused';
  if (failure === JOB_ROLE_WRITE_UNAVAILABLE) return 'organization.jobRoles.error.saveUnavailable';

  const unhandled: never = failure;

  return unhandled;
}

/** The dialog's name field, read on submit. */
export const JOB_ROLE_NAME_FIELD = 'name';

/** Whether a refusal is about the name field, which is then marked invalid. */
export function marksJobRoleName(failure: JobRoleWriteFailure | null): boolean {
  return (
    failure === JOB_ROLE_NAME_EMPTY ||
    failure === JOB_ROLE_NAME_TOO_LONG ||
    failure === JOB_ROLE_NAME_CONTROL ||
    failure === JOB_ROLE_NAME_TAKEN
  );
}

// ---------------------------------------------------- what a write says

/** A new role landed. */
export const JOB_ROLE_ADDED = 'added';
/** A rename landed. */
export const JOB_ROLE_SAVED = 'saved';
/** An archive landed. */
export const JOB_ROLE_ARCHIVED = 'archived';
/** A restore landed. */
export const JOB_ROLE_RESTORED = 'restored';

export type JobRoleSaved =
  | typeof JOB_ROLE_ADDED
  | typeof JOB_ROLE_SAVED
  | typeof JOB_ROLE_ARCHIVED
  | typeof JOB_ROLE_RESTORED;

/** Which confirmation a landed name save renders: an add, or a rename. */
export function jobRoleSavedOf(role: JobRoleRow | null): typeof JOB_ROLE_ADDED | typeof JOB_ROLE_SAVED {
  return role === null ? JOB_ROLE_ADDED : JOB_ROLE_SAVED;
}

/** Which confirmation a landed archive or restore renders. */
export function jobRoleArchiveSavedOf(archived: boolean): typeof JOB_ROLE_ARCHIVED | typeof JOB_ROLE_RESTORED {
  return archived ? JOB_ROLE_ARCHIVED : JOB_ROLE_RESTORED;
}

/** The confirmation a landed write renders on the card. Exhaustive. */
export function jobRoleSavedMessageKey(
  saved: JobRoleSaved,
):
  | 'organization.jobRoles.added'
  | 'organization.jobRoles.saved'
  | 'organization.jobRoles.archivedDone'
  | 'organization.jobRoles.restoredDone' {
  if (saved === JOB_ROLE_ADDED) return 'organization.jobRoles.added';
  if (saved === JOB_ROLE_SAVED) return 'organization.jobRoles.saved';
  if (saved === JOB_ROLE_ARCHIVED) return 'organization.jobRoles.archivedDone';
  if (saved === JOB_ROLE_RESTORED) return 'organization.jobRoles.restoredDone';

  const unhandled: never = saved;

  return unhandled;
}
