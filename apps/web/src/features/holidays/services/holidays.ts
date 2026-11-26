import { FIRST_HR_HOLIDAY_YEAR, nationalHolidaysOf, type NationalHolidayCode } from '@shift/domain';

import type { CalendarHoliday, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { isIsoDate } from '@/lib/i18n/format';
import { NAME_MAX_LENGTH, enteredName, hasControlCharacter } from '@/utils/name';

/**
 * *BLAGDANI* (story 21.17; R13, AD-27, UX-DR78): what the *Organizacija*
 * card shows of a year, what *Uvezi državne blagdane* proposes, and the
 * refusals of a holiday entered by hand — as a `.ts` the node suite executes
 * (AD-15). The card and its dialogs only draw what this module decides.
 *
 * THE SNAPSHOT'S HOLIDAYS, NEVER A READ OF THEIR OWN (Design Note 1): the
 * calendar snapshot carries every holiday with its name (21.16), by date, at
 * most one per date. A year's view filters it; nothing is re-derived.
 *
 * THE IMPORT PROPOSAL is 21.15's `nationalHolidaysOf('HR', year)`, each code
 * named by the locale (`organization.holidays.national.<CODE>`), from 2020 on
 * (the list in force, R13.6): before that, `null`, and the card says why. A
 * date the organization already holds is marked *već upisano* and keeps its
 * stored name; the import sends only the missing ones. A date before the
 * organization's today is marked past: a warning, never a refusal (AD-2,
 * Design Note 3). Corpus Christi on a fixed holiday is listed once, under the
 * fixed holiday's code and name (Design Note 2).
 */

/** 0080's table. */
export const HOLIDAYS_TABLE = 'organization_holidays';

/** The first year the import offers: the first of Croatia's list in force (R13.6). */
export const FIRST_IMPORT_YEAR = FIRST_HR_HOLIDAY_YEAR;

/** The country the import proposes the list of: Croatia alone (epic 21). */
export const IMPORT_COUNTRY = 'HR';

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** What the card is drawn from: the snapshot, or why not. */
export interface HolidaysSurfaceState {
  readonly calendar: CalendarSnapshot | null;
  /** The snapshot could not be read (or is paused with nothing to show): the card says so. */
  readonly unavailable: boolean;
  readonly loading: boolean;
}

/**
 * The calendar snapshot's answer as the card draws it, by the job roles'
 * rule: failed, or pending on a paused fetch, is unavailable; pending
 * otherwise is loading.
 */
export function holidaysSurfaceStateOf(answer: {
  readonly data: CalendarSnapshot | undefined;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly fetchStatus: string;
}): HolidaysSurfaceState {
  const calendar = answer.data ?? null;

  if (answer.isError || (answer.isPending && answer.fetchStatus === FETCH_PAUSED)) {
    return { calendar, unavailable: calendar === null, loading: false };
  }

  return { calendar, unavailable: false, loading: answer.isPending };
}

/** The first and the last year the picker steps to (the engine's 0001–9999). */
export const FIRST_PICKED_YEAR = 1;
export const LAST_PICKED_YEAR = 9999;

/** `year` stepped by `by`, kept inside the picker's years. */
export function steppedYearOf(year: number, by: number): number {
  return Math.min(LAST_PICKED_YEAR, Math.max(FIRST_PICKED_YEAR, year + by));
}

/** The card's one dialog adds a holiday … */
export const HOLIDAY_OPENING_ADD = 'add';
/** … or renames one. */
export const HOLIDAY_OPENING_RENAME = 'rename';

/** The year of an ISO date. */
export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** The holidays of `year`, by date, as the snapshot holds them. */
export function holidaysOfYear(calendar: Pick<CalendarSnapshot, 'holidays'>, year: number): readonly CalendarHoliday[] {
  const prefix = `${String(year).padStart(4, '0')}-`;

  return calendar.holidays.filter((holiday) => holiday.date.startsWith(prefix));
}

/** The holiday the snapshot holds on `date`, or `null`. */
export function holidayOn(calendar: Pick<CalendarSnapshot, 'holidays'>, date: string): CalendarHoliday | null {
  return calendar.holidays.find((holiday) => holiday.date === date) ?? null;
}

/** Whether `date` is before the organization's `today`: a warning only. */
export function isPastDate(date: string, today: string | null): boolean {
  return today !== null && date < today;
}

// --------------------------------------------------------------- the import

/** One date the import proposes. */
export interface ProposedHoliday {
  readonly date: string;
  readonly code: NationalHolidayCode;
  /** The locale's official name for the code: what the import stores. */
  readonly name: string;
  /** The holiday already stored on that date (its name kept), or `null`: only these are not sent. */
  readonly stored: CalendarHoliday | null;
  /** Before the organization's today: warned, never refused. */
  readonly past: boolean;
}

/** What *Uvezi državne blagdane za {godina}* proposes. */
export interface ImportProposal {
  readonly year: number;
  /** Every proposed date, by date. */
  readonly rows: readonly ProposedHoliday[];
  /** The proposed dates no holiday holds yet: what the one insert sends. */
  readonly missing: readonly ProposedHoliday[];
}

/**
 * The import of `year`: every proposed date with its name, whether the
 * organization already holds one there, and whether it is past. `null` for a
 * year before {@link FIRST_IMPORT_YEAR} or past 9999: no import is offered.
 * `nameOf` is the locale's name of each code.
 */
export function importProposalOf(
  calendar: Pick<CalendarSnapshot, 'holidays'>,
  year: number,
  today: string | null,
  nameOf: (code: NationalHolidayCode) => string,
): ImportProposal | null {
  if (!Number.isInteger(year) || year < FIRST_IMPORT_YEAR || year > 9999) return null;

  const rows = nationalHolidaysOf(IMPORT_COUNTRY, year).map(
    ({ date, code }): ProposedHoliday => ({
      date,
      code,
      name: nameOf(code),
      stored: holidayOn(calendar, date),
      past: isPastDate(date, today),
    }),
  );

  return { year, rows, missing: rows.filter((row) => row.stored === null) };
}

/** The locale key of a code's official name. Exhaustive. */
export function nationalHolidayMessageKey(
  code: NationalHolidayCode,
):
  | 'organization.holidays.national.NEW_YEAR'
  | 'organization.holidays.national.EPIPHANY'
  | 'organization.holidays.national.EASTER_SUNDAY'
  | 'organization.holidays.national.EASTER_MONDAY'
  | 'organization.holidays.national.LABOUR_DAY'
  | 'organization.holidays.national.STATEHOOD_DAY'
  | 'organization.holidays.national.CORPUS_CHRISTI'
  | 'organization.holidays.national.ANTI_FASCIST_STRUGGLE_DAY'
  | 'organization.holidays.national.VICTORY_DAY'
  | 'organization.holidays.national.ASSUMPTION_DAY'
  | 'organization.holidays.national.ALL_SAINTS_DAY'
  | 'organization.holidays.national.REMEMBRANCE_DAY'
  | 'organization.holidays.national.CHRISTMAS_DAY'
  | 'organization.holidays.national.ST_STEPHENS_DAY' {
  switch (code) {
    case 'NEW_YEAR':
      return 'organization.holidays.national.NEW_YEAR';
    case 'EPIPHANY':
      return 'organization.holidays.national.EPIPHANY';
    case 'EASTER_SUNDAY':
      return 'organization.holidays.national.EASTER_SUNDAY';
    case 'EASTER_MONDAY':
      return 'organization.holidays.national.EASTER_MONDAY';
    case 'LABOUR_DAY':
      return 'organization.holidays.national.LABOUR_DAY';
    case 'STATEHOOD_DAY':
      return 'organization.holidays.national.STATEHOOD_DAY';
    case 'CORPUS_CHRISTI':
      return 'organization.holidays.national.CORPUS_CHRISTI';
    case 'ANTI_FASCIST_STRUGGLE_DAY':
      return 'organization.holidays.national.ANTI_FASCIST_STRUGGLE_DAY';
    case 'VICTORY_DAY':
      return 'organization.holidays.national.VICTORY_DAY';
    case 'ASSUMPTION_DAY':
      return 'organization.holidays.national.ASSUMPTION_DAY';
    case 'ALL_SAINTS_DAY':
      return 'organization.holidays.national.ALL_SAINTS_DAY';
    case 'REMEMBRANCE_DAY':
      return 'organization.holidays.national.REMEMBRANCE_DAY';
    case 'CHRISTMAS_DAY':
      return 'organization.holidays.national.CHRISTMAS_DAY';
    case 'ST_STEPHENS_DAY':
      return 'organization.holidays.national.ST_STEPHENS_DAY';
  }
}

// ------------------------------------------------------- a holiday by hand

/** No date was entered, or it is not a calendar date. */
export const HOLIDAY_DATE_EMPTY = 'dateEmpty';
/** A date written as one (`YYYY-MM-DD`) that names no day of the calendar (`2026-02-31`). */
export const HOLIDAY_DATE_INVALID = 'dateInvalid';
/** The name was empty once trimmed (client-side, or `organization_holidays_name_not_blank`). */
export const HOLIDAY_NAME_EMPTY = 'nameEmpty';
/** The name is longer than `NAME_MAX_LENGTH` (client-side, or `organization_holidays_name_length`). */
export const HOLIDAY_NAME_TOO_LONG = 'nameTooLong';
/** A line break or another control character inside the name (client-side, or `organization_holidays_name_characters`). */
export const HOLIDAY_NAME_CONTROL = 'nameControl';
/** The date already holds a holiday (client-side, or 23505 `organization_holidays_organization_date_key`). */
export const HOLIDAY_TAKEN = 'taken';

export type HolidayDraftRefusal =
  | typeof HOLIDAY_DATE_EMPTY
  | typeof HOLIDAY_DATE_INVALID
  | typeof HOLIDAY_NAME_EMPTY
  | typeof HOLIDAY_NAME_TOO_LONG
  | typeof HOLIDAY_NAME_CONTROL
  | typeof HOLIDAY_TAKEN;

/** A date's written shape, whether or not it names a day. */
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** How long a name is as `char_length` counts it: in code points. */
function codePoints(value: string): number {
  return [...value].length;
}

export type EnteredHolidayName =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly code: typeof HOLIDAY_NAME_EMPTY | typeof HOLIDAY_NAME_TOO_LONG | typeof HOLIDAY_NAME_CONTROL };

/**
 * The name as it will be sent (`@/utils/name`'s rules: trimmed, 1–100 code
 * points, no control character inside), or the first refusal.
 */
export function enteredHolidayNameOf(name: string): EnteredHolidayName {
  const stored = enteredName(name);

  if (stored === null) return { ok: false, code: HOLIDAY_NAME_EMPTY };
  if (codePoints(stored) > NAME_MAX_LENGTH) return { ok: false, code: HOLIDAY_NAME_TOO_LONG };
  if (hasControlCharacter(stored)) return { ok: false, code: HOLIDAY_NAME_CONTROL };

  return { ok: true, name: stored };
}

/** A holiday entered in *Dodaj blagdan*: its date and name, checked. */
export interface EnteredHoliday {
  readonly date: string;
  readonly name: string;
}

/**
 * *Dodaj blagdan*'s draft as it will be sent, or the first refusal: the date
 * (a calendar date, not one that already holds a holiday) and then the name.
 * A past date is no refusal ({@link isPastDate}).
 */
export function enteredHolidayOf(
  calendar: Pick<CalendarSnapshot, 'holidays'>,
  date: string,
  name: string,
):
  | { readonly ok: true; readonly holiday: EnteredHoliday }
  | { readonly ok: false; readonly code: HolidayDraftRefusal } {
  if (date.trim() === '') return { ok: false, code: HOLIDAY_DATE_EMPTY };
  if (!isIsoDate(date)) return { ok: false, code: ISO_DATE_SHAPE.test(date) ? HOLIDAY_DATE_INVALID : HOLIDAY_DATE_EMPTY };
  if (holidayOn(calendar, date) !== null) return { ok: false, code: HOLIDAY_TAKEN };

  const entered = enteredHolidayNameOf(name);

  if (!entered.ok) return entered;

  return { ok: true, holiday: { date, name: entered.name } };
}
