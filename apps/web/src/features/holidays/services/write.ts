import type { CalendarHoliday } from '@/features/calendar/services/snapshot';
import {
  CHANGE_ADD,
  CHANGE_FLAG,
  CHANGE_REMOVE,
  HOLIDAY_NOTHING_NEW,
  HOLIDAY_NO_IMPORT,
  HOLIDAY_STALE,
  type HolidayChange,
  type HolidayRefusal,
} from '@/features/holidays/services/holiday-check';
import {
  HOLIDAY_DATE_EMPTY,
  HOLIDAY_DATE_INVALID,
  HOLIDAY_NAME_CONTROL,
  HOLIDAY_NAME_EMPTY,
  HOLIDAY_NAME_TOO_LONG,
  HOLIDAY_TAKEN,
  HOLIDAYS_TABLE,
  enteredHolidayNameOf,
} from '@/features/holidays/services/holidays';

/**
 * A holiday's and a team flag's writes (story 21.17; AD-27): plain PostgREST,
 * no RPC and no server function (0080's policies and grants decide).
 *
 *   - *Dodaj blagdan*: one insert of `(organization_id, date, name)`.
 *   - *Uvezi*: ONE insert of the missing dates with `Prefer:
 *     resolution=ignore-duplicates` on `(organization_id, date)` —
 *     `upsert(…, { onConflict: 'organization_id,date', ignoreDuplicates: true })`
 *     — so a date stored meanwhile is skipped and a second import adds
 *     nothing. The rows answered are the ones inserted; none is no refusal.
 *   - *Preimenuj*: `update({ name })` by id (the column grant admits `name`
 *     alone); zero rows is stale.
 *   - *Ukloni*: `delete()` by id; zero rows is stale.
 *   - *Ne radi na blagdane*: `teams.update({ off_on_holidays })` by id; zero
 *     rows is stale.
 *
 * A holiday notifies nobody (E-3). Codes, never messages:
 * {@link holidayMessageKey} and {@link teamHolidayFlagMessageKey} are the edges.
 */

/** The database refused the write outright (42501). */
export const HOLIDAY_WRITE_REFUSED = 'refused';
/** The service, not the person: try again. */
export const HOLIDAY_WRITE_UNAVAILABLE = 'unavailable';
/** The check could not be derived (a read failed): nothing was written. */
export const HOLIDAY_UNCHECKED = 'unchecked';

export type HolidayWriteFailure =
  | typeof HOLIDAY_TAKEN
  | typeof HOLIDAY_NAME_EMPTY
  | typeof HOLIDAY_NAME_TOO_LONG
  | typeof HOLIDAY_NAME_CONTROL
  | typeof HOLIDAY_STALE
  | typeof HOLIDAY_WRITE_REFUSED
  | typeof HOLIDAY_WRITE_UNAVAILABLE;

/** Every failure a holiday surface says: the check's refusals, the writes', and an unchecked change. */
export type HolidayFailure = HolidayRefusal | HolidayWriteFailure | typeof HOLIDAY_UNCHECKED;

export type HolidayWriteOutcome =
  | { readonly ok: true; readonly rows: number }
  | { readonly ok: false; readonly code: HolidayWriteFailure };

// ----------------------------------------------------------------- the seams

export interface HolidayWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface HolidayWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: HolidayWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<HolidayWriteAnswer>;
}

interface ById {
  eq(column: string, value: string): Selecting;
}

interface ByIdAndLive {
  eq(column: string, value: string): { eq(column: string, value: boolean): Selecting };
}

/** The import's upsert options: skip a date already held, never update it. */
export interface IgnoreDuplicates {
  readonly onConflict: string;
  readonly ignoreDuplicates: true;
}

/** The calls on `organization_holidays`, named structurally so they can be stubbed. */
export interface HolidaysWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  upsert(values: readonly Readonly<Record<string, unknown>>[], options: IgnoreDuplicates): Selecting;
  update(values: Readonly<Record<string, unknown>>): ById;
  delete(): ById;
}

/** The one call on `teams`: the flag's update by id, of a live team only. */
export interface TeamFlagTable {
  update(values: Readonly<Record<string, unknown>>): ByIdAndLive;
}

export interface HolidayWriteTables {
  readonly holidays: HolidaysWriteTable;
  readonly teams: TeamFlagTable;
}

/** The two tables through one client's `from`. */
export function holidayWriteTablesOf(client: { from(table: string): unknown }): HolidayWriteTables {
  return {
    holidays: client.from(HOLIDAYS_TABLE) as HolidaysWriteTable,
    teams: client.from('teams') as TeamFlagTable,
  };
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';
const ARCHIVED_COLUMN = 'archived';
/** 0080's unique key, as `on_conflict` names it. */
export const HOLIDAYS_CONFLICT_COLUMNS = 'organization_id,date';

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** 0080's constraint names, as PostgreSQL quotes them in `message`. */
const NAME_CHECK = '"organization_holidays_name_not_blank"';
const NAME_LENGTH_CHECK = '"organization_holidays_name_length"';
const NAME_CHARACTERS_CHECK = '"organization_holidays_name_characters"';

/**
 * A PostgREST refusal as this module's own failure: 23505 the date taken;
 * 23514 by 0080's name constraints only (read from `message`, never
 * `details`, which holds the values typed), any other check the service;
 * 42501 refused; anything else unavailable.
 */
export function holidayWriteFailureOf(error: HolidayWriteError): HolidayWriteFailure {
  const message = error.message ?? '';

  if (error.code === UNIQUE_VIOLATION) return HOLIDAY_TAKEN;
  if (error.code === CHECK_VIOLATION) {
    if (message.includes(NAME_CHECK)) return HOLIDAY_NAME_EMPTY;
    if (message.includes(NAME_LENGTH_CHECK)) return HOLIDAY_NAME_TOO_LONG;
    if (message.includes(NAME_CHARACTERS_CHECK)) return HOLIDAY_NAME_CONTROL;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return HOLIDAY_WRITE_REFUSED;

  return HOLIDAY_WRITE_UNAVAILABLE;
}

/**
 * Settle one write: a thrown call or a malformed answer is the service, an
 * error its failure, and zero rows `noRows` (`null`: zero rows is an answer).
 */
async function settled(
  write: () => PromiseLike<HolidayWriteAnswer>,
  noRows: HolidayWriteFailure | null,
): Promise<HolidayWriteOutcome> {
  let answered: HolidayWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: HOLIDAY_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(HOLIDAY_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: HOLIDAY_WRITE_UNAVAILABLE };
  }

  if (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data)) {
    console.error(HOLIDAY_WRITE_UNAVAILABLE, 'data');

    return { ok: false, code: HOLIDAY_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = holidayWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  const rows = (answered.data ?? []).length;

  if (rows === 0 && noRows !== null) return { ok: false, code: noRows };

  return { ok: true, rows };
}

/**
 * Write what the check stood on: the one insert of a holiday added by hand,
 * the import's ONE insert that skips the dates already present, the delete
 * of a removed one, or the team's flag. `organizationId` is the fresh
 * calendar's own. Nothing is notified.
 */
export async function writeHolidayChange(
  tables: HolidayWriteTables,
  organizationId: string,
  change: HolidayChange,
): Promise<HolidayWriteOutcome> {
  switch (change.kind) {
    case CHANGE_ADD: {
      const rows = change.holidays.map((holiday) => ({ organization_id: organizationId, date: holiday.date, name: holiday.name }));
      const [one] = rows;

      if (change.year === null && rows.length === 1 && one !== undefined) {
        return settled(() => tables.holidays.insert(one).select(RETURNED_COLUMNS), HOLIDAY_WRITE_UNAVAILABLE);
      }

      return settled(
        () =>
          tables.holidays
            .upsert(rows, { onConflict: HOLIDAYS_CONFLICT_COLUMNS, ignoreDuplicates: true })
            .select(RETURNED_COLUMNS),
        null,
      );
    }
    case CHANGE_REMOVE:
      return settled(() => tables.holidays.delete().eq(ID_COLUMN, change.id).select(RETURNED_COLUMNS), HOLIDAY_STALE);
    case CHANGE_FLAG:
      return settled(
        () =>
          tables.teams
            .update({ off_on_holidays: change.value })
            .eq(ID_COLUMN, change.teamId)
            // An archived team answers zero rows: stale, never a write to a frozen team.
            .eq(ARCHIVED_COLUMN, false)
            .select(RETURNED_COLUMNS),
        HOLIDAY_STALE,
      );
  }
}

/** *Preimenuj*: the name alone, checked first (AD-5 exempt: no date changes). */
export async function renameHoliday(
  table: HolidaysWriteTable,
  holiday: Pick<CalendarHoliday, 'id'>,
  name: string,
): Promise<HolidayWriteOutcome> {
  const entered = enteredHolidayNameOf(name);

  if (!entered.ok) return entered;

  return settled(() => table.update({ name: entered.name }).eq(ID_COLUMN, holiday.id).select(RETURNED_COLUMNS), HOLIDAY_STALE);
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place a holiday code becomes Croatian. Exhaustive. */
export function holidayMessageKey(
  failure: HolidayFailure,
):
  | 'organization.holidays.error.dateEmpty'
  | 'organization.holidays.error.dateInvalid'
  | 'organization.holidays.error.nameEmpty'
  | 'organization.holidays.error.nameTooLong'
  | 'organization.holidays.error.nameControl'
  | 'organization.holidays.error.taken'
  | 'organization.holidays.error.stale'
  | 'organization.holidays.error.nothingNew'
  | 'organization.holidays.error.noImport'
  | 'organization.holidays.error.refused'
  | 'organization.holidays.error.saveUnavailable'
  | 'organization.holidays.error.unchecked' {
  switch (failure) {
    case HOLIDAY_DATE_EMPTY:
      return 'organization.holidays.error.dateEmpty';
    case HOLIDAY_DATE_INVALID:
      return 'organization.holidays.error.dateInvalid';
    case HOLIDAY_NAME_EMPTY:
      return 'organization.holidays.error.nameEmpty';
    case HOLIDAY_NAME_TOO_LONG:
      return 'organization.holidays.error.nameTooLong';
    case HOLIDAY_NAME_CONTROL:
      return 'organization.holidays.error.nameControl';
    case HOLIDAY_TAKEN:
      return 'organization.holidays.error.taken';
    case HOLIDAY_STALE:
      return 'organization.holidays.error.stale';
    case HOLIDAY_NOTHING_NEW:
      return 'organization.holidays.error.nothingNew';
    case HOLIDAY_NO_IMPORT:
      return 'organization.holidays.error.noImport';
    case HOLIDAY_WRITE_REFUSED:
      return 'organization.holidays.error.refused';
    case HOLIDAY_WRITE_UNAVAILABLE:
      return 'organization.holidays.error.saveUnavailable';
    case HOLIDAY_UNCHECKED:
      return 'organization.holidays.error.unchecked';
  }
}

/** Whether a failure is about the name field, which is then marked invalid. */
export function marksHolidayName(failure: HolidayFailure | null): boolean {
  return failure === HOLIDAY_NAME_EMPTY || failure === HOLIDAY_NAME_TOO_LONG || failure === HOLIDAY_NAME_CONTROL;
}

/** Whether a failure is about the date field, which is then marked invalid. */
export function marksHolidayDate(failure: HolidayFailure | null): boolean {
  return failure === HOLIDAY_DATE_EMPTY || failure === HOLIDAY_DATE_INVALID || failure === HOLIDAY_TAKEN;
}

/** The team dialog's words for a flag failure. Exhaustive over what a flag change can answer. */
export function teamHolidayFlagMessageKey(
  failure: HolidayFailure,
):
  | 'smjene.offOnHolidays.error.stale'
  | 'smjene.offOnHolidays.error.refused'
  | 'smjene.offOnHolidays.error.saveUnavailable'
  | 'smjene.offOnHolidays.error.unchecked' {
  switch (failure) {
    case HOLIDAY_WRITE_REFUSED:
      return 'smjene.offOnHolidays.error.refused';
    case HOLIDAY_UNCHECKED:
      return 'smjene.offOnHolidays.error.unchecked';
    case HOLIDAY_STALE:
      return 'smjene.offOnHolidays.error.stale';
    default:
      return 'smjene.offOnHolidays.error.saveUnavailable';
  }
}

// ---------------------------------------------------- what a write says

/** A holiday added by hand landed. */
export const HOLIDAY_ADDED = 'added';
/** An import landed. */
export const HOLIDAY_IMPORTED = 'imported';
/** A rename landed. */
export const HOLIDAY_RENAMED = 'renamed';
/** A removal landed. */
export const HOLIDAY_REMOVED = 'removed';

export type HolidaySaved = typeof HOLIDAY_ADDED | typeof HOLIDAY_IMPORTED | typeof HOLIDAY_RENAMED | typeof HOLIDAY_REMOVED;

/**
 * Which confirmation a landed change renders on the card. Exhaustive: a
 * flag change is the team dialog's, which says its own.
 *
 * @throws RangeError for a flag change.
 */
export function holidaySavedOf(change: HolidayChange): HolidaySaved {
  switch (change.kind) {
    case CHANGE_REMOVE:
      return HOLIDAY_REMOVED;
    case CHANGE_ADD:
      return change.year === null ? HOLIDAY_ADDED : HOLIDAY_IMPORTED;
    case CHANGE_FLAG:
      throw new RangeError('a flag change has no card confirmation');
  }
}

/** The confirmation a landed write renders on the card. Exhaustive. */
export function holidaySavedMessageKey(
  saved: HolidaySaved,
):
  | 'organization.holidays.added'
  | 'organization.holidays.imported'
  | 'organization.holidays.renamed'
  | 'organization.holidays.removed' {
  switch (saved) {
    case HOLIDAY_ADDED:
      return 'organization.holidays.added';
    case HOLIDAY_IMPORTED:
      return 'organization.holidays.imported';
    case HOLIDAY_RENAMED:
      return 'organization.holidays.renamed';
    case HOLIDAY_REMOVED:
      return 'organization.holidays.removed';
  }
}

/** The name field, read on submit. */
export const HOLIDAY_NAME_FIELD = 'name';
/** The date field, read on submit. */
export const HOLIDAY_DATE_FIELD = 'date';

