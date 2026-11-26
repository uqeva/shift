/**
 * Holidays (story 21.15; R13, AD-27).
 *
 * A Holiday is a civil date of the organization, entered by an admin (R13.1).
 * Names never enter derivation: the engine reads the dates alone, and the
 * teams marked off on holidays. On a holiday such a team works no shift: its
 * scheduled type is none, its projected type kept beside it (R13.2, R13.3).
 * The one function that layers a team's scheduled type applies it
 * (`overrides.ts`'s `applyOverride`), and a personal rotation counted with
 * such a team is emptied the same way (R15.4). A Personal Assignment never
 * is (R14.4).
 *
 * {@link nationalHolidaysOf} proposes a country's list for a year (R13.6). It
 * is only a suggestion an admin accepts: the engine never decides on its own
 * that a date is a holiday (DI-8).
 *
 * Dates are `YYYY-MM-DD` strings; nothing here constructs a `Date`. The
 * engine returns codes, never prose: names are the locale's.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';

/**
 * The holiday rule's two lists, as every schedule input carries them (AD-27).
 * Absent or empty, no date is a holiday, or no team is off on one, and every
 * derivation is exactly what it was before holidays existed (R13.5).
 */
export interface HolidayRule {
  /** The organization's holidays: civil dates, at most one each (R13.1). Their names never enter derivation. */
  readonly holidays?: readonly string[] | undefined;
  /** The ids of the teams off on holidays (R13.2); every other team works its projection on a holiday. */
  readonly teamsOffOnHolidays?: readonly string[] | undefined;
}

/**
 * Whether team `teamId` is off for a holiday on `date`: the date is a holiday
 * and the team is off on holidays. INTERNAL to the package's derivations.
 */
export type HolidayOff = (teamId: string, date: string) => boolean;

/**
 * The rule as a predicate, or `null` when it decides nothing: no holiday or
 * no team off (R13.5). Every derivation takes the `null` path exactly as it
 * did before holidays existed. Both lists are checked either way.
 *
 * @throws RangeError when a holiday is not a calendar `YYYY-MM-DD`, a team id
 *   is empty or not a string, or a date or a team is given twice.
 */
export function holidayOffOf(rule: HolidayRule): HolidayOff | null {
  const holidays = new Set<string>();
  for (const date of rule.holidays ?? []) {
    checkDate('a holiday', date);
    if (holidays.has(date)) throw new RangeError(`the holiday ${date} is given twice; a date holds at most one`);
    holidays.add(date);
  }
  const teams = new Set<string>();
  for (const teamId of rule.teamsOffOnHolidays ?? []) {
    if (typeof teamId !== 'string' || teamId === '') {
      throw new RangeError(`a team off on holidays is ${JSON.stringify(teamId)}, not a team id`);
    }
    if (teams.has(teamId)) throw new RangeError(`team ${teamId} is given twice among the teams off on holidays`);
    teams.add(teamId);
  }
  if (holidays.size === 0 || teams.size === 0) return null;
  return (teamId, date) => teams.has(teamId) && holidays.has(date);
}

/**
 * Whether a holiday empties a personal rotation's shift counted with `teamId`
 * on `date` (R13.2, R15.4): the team is off on holidays and the date is one. A
 * shift counted with no team is never emptied, and a Personal Assignment's
 * shift is never asked: the admin's plan wins (R14.4). INTERNAL.
 */
export function emptiedByHoliday(holidayOff: HolidayOff | null, shift: { readonly teamId: string | null }, date: string): boolean {
  return holidayOff !== null && shift.teamId !== null && holidayOff(shift.teamId, date);
}

/** The first year {@link easterSundayOf} computes: the Gregorian calendar's first full year. The last is 9999, the engine's. */
export const FIRST_GREGORIAN_YEAR = 1583;
const LAST_YEAR = 9999;

/** The first year of Croatia's list in force (R13.6): the dates changed from 2020 on. */
export const FIRST_HR_HOLIDAY_YEAR = 2020;

function checkYear(year: number, first: number): void {
  if (!Number.isInteger(year) || year < first || year > LAST_YEAR) {
    throw new RangeError(`the year is ${String(year)}, not a whole year from ${String(first)} to ${String(LAST_YEAR)}`);
  }
}

function dateOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Easter Sunday of `year` by the Gregorian computus (the anonymous algorithm,
 * Meeus/Jones/Butcher), as `YYYY-MM-DD`.
 *
 * @throws RangeError when `year` is not a whole year from 1583 to 9999.
 */
export function easterSundayOf(year: number): string {
  checkYear(year, FIRST_GREGORIAN_YEAR);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateOf(year, month, day);
}

/** The countries {@link nationalHolidaysOf} knows: Croatia alone (epic 21; other lists are deferred). */
export type HolidayCountry = 'HR';

/** The code of one proposed national holiday; the locale names it. */
export type NationalHolidayCode =
  | 'NEW_YEAR'
  | 'EPIPHANY'
  | 'EASTER_SUNDAY'
  | 'EASTER_MONDAY'
  | 'LABOUR_DAY'
  | 'STATEHOOD_DAY'
  | 'CORPUS_CHRISTI'
  | 'ANTI_FASCIST_STRUGGLE_DAY'
  | 'VICTORY_DAY'
  | 'ASSUMPTION_DAY'
  | 'ALL_SAINTS_DAY'
  | 'REMEMBRANCE_DAY'
  | 'CHRISTMAS_DAY'
  | 'ST_STEPHENS_DAY';

/** One proposed holiday: its date and its code. */
export interface NationalHoliday {
  readonly date: string;
  readonly code: NationalHolidayCode;
}

/** Croatia's fixed holidays in force (R13.6), as month, day and code. */
const HR_FIXED: readonly (readonly [number, number, NationalHolidayCode])[] = [
  [1, 1, 'NEW_YEAR'],
  [1, 6, 'EPIPHANY'],
  [5, 1, 'LABOUR_DAY'],
  [5, 30, 'STATEHOOD_DAY'],
  [6, 22, 'ANTI_FASCIST_STRUGGLE_DAY'],
  [8, 5, 'VICTORY_DAY'],
  [8, 15, 'ASSUMPTION_DAY'],
  [11, 1, 'ALL_SAINTS_DAY'],
  [11, 18, 'REMEMBRANCE_DAY'],
  [12, 25, 'CHRISTMAS_DAY'],
  [12, 26, 'ST_STEPHENS_DAY'],
];

/** The date `days` after `date`. Never past 9999-12-31 here: Corpus Christi is at most in June. */
function plusDays(date: string, days: number): string {
  return dateOfCivilDay(civilDayNumber(date) + days)!;
}

/**
 * The proposed national holidays of `country` in `year` (R13.6), in date
 * order: for Croatia, the eleven fixed dates in force plus Easter Sunday,
 * Easter Monday and Corpus Christi (Easter + 60 days), Easter by
 * {@link easterSundayOf}. Easter falls from 22 March to 25 April, so Easter
 * Sunday and Monday never meet a fixed date. Corpus Christi falls from 21 May
 * to 24 June, so it can fall on 30 May or 22 June. In such a year (2024, for
 * one) the date is listed once, as the fixed holiday, and the list holds 13.
 *
 * It is only a suggestion an admin accepts (R13.1).
 *
 * @throws RangeError when `country` is not `HR`, or `year` is not a whole
 *   year from 2020 (when Croatia's list in force began) to 9999.
 */
export function nationalHolidaysOf(country: HolidayCountry, year: number): readonly NationalHoliday[] {
  if (country !== 'HR') throw new RangeError(`no national holidays are known for ${JSON.stringify(country)}; only HR`);
  checkYear(year, FIRST_HR_HOLIDAY_YEAR);
  const easter = easterSundayOf(year);
  const holidays: NationalHoliday[] = HR_FIXED.map(([month, day, code]) => ({ date: dateOf(year, month, day), code }));
  const fixed = new Set(holidays.map((holiday) => holiday.date));
  for (const holiday of [
    { date: easter, code: 'EASTER_SUNDAY' },
    { date: plusDays(easter, 1), code: 'EASTER_MONDAY' },
    { date: plusDays(easter, 60), code: 'CORPUS_CHRISTI' },
  ] as const) {
    if (!fixed.has(holiday.date)) holidays.push(holiday);
  }
  return holidays.sort((one, other) => (one.date < other.date ? -1 : one.date > other.date ? 1 : 0));
}
