/**
 * Floaters suggested for an uncovered shift, R16.1–R16.2 (story 21.13; AD-7,
 * AD-8).
 *
 * A FLOATER is a member who covers gaps (a student filling in for absent
 * colleagues), with the job roles they may cover. Being one changes no
 * derivation (R16.1): it only decides who is SUGGESTED for an unresolved
 * conflict. A suggestion never assigns by itself; picking one is the
 * admin's Replace Member (R16.3), which this module does not write.
 *
 * ELIGIBLE (R16.1, {@link floaterEligibleFor}): the absent member has no job
 * role, or the floater lists theirs. A role no floater lists gets nobody.
 *
 * FREE ON d (R16.2, {@link floaterStandingOn}), in this order of precedence:
 *
 *   - active on d (R7, versioned; a seasonal member outside their season is
 *     not, R16.5);
 *   - not on leave of any absence type covering d, a half day's included;
 *   - no at-work shift on d (R12, Personal Shifts included);
 *   - no shift on d−1 or d+1 leaving a rest gap of zero (or less) with the
 *     uncovered shift (R5): a Noć ending as the shift starts, or a shift the
 *     next morning starting as it ends. An uncovered shift with no times
 *     that date has no interval, so no rest gap is read.
 *
 * ORDERED (R16.2, {@link floaterSuggestionsOf}): by fewest at-work shifts in
 * d's calendar month (every at-work shift of it, as planned), then in the
 * order given, which the caller makes the names' order. The absent member is
 * never suggested.
 *
 * Ids, codes and counts only (AD-8): never a name or a formatted string. The
 * caller gives each floater's at-work shifts from `atWorkShiftsOf` (R12.3),
 * at least every one of d's month and of d−1 and d+1.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber } from './calendar.js';
import { MINUTES_PER_DAY } from './bands.js';
import { activeOn, type StatusVersion } from './roster.js';

/** Free on the date: suggested when eligible. */
export const FLOATER_FREE = 'free';
/** Not active on the date (R7, R16.5). */
export const FLOATER_INACTIVE = 'inactive';
/** On leave of any absence type covering the date, a half day's included. */
export const FLOATER_ON_LEAVE = 'on-leave';
/** At work on the date (R12). */
export const FLOATER_WORKING = 'working';
/** A shift on the day before or after leaves no rest with the uncovered shift (R5). */
export const FLOATER_REST_GAP = 'rest-gap';

export type FloaterStanding =
  | typeof FLOATER_FREE
  | typeof FLOATER_INACTIVE
  | typeof FLOATER_ON_LEAVE
  | typeof FLOATER_WORKING
  | typeof FLOATER_REST_GAP;

/**
 * One at-work shift as far as a floater's freedom goes: its start date and its
 * interval, in minutes after the start of `date` (`AtWorkShift` is one).
 */
export interface FloaterShift {
  readonly date: string;
  readonly startMinute: number;
  /** After `startMinute`; at most 2879 (DI-5). */
  readonly endMinute: number;
}

/** One live leave record of the floater, of any absence type: its dates, both inclusive. */
export interface FloaterLeave {
  readonly from: string;
  readonly to: string;
}

/** A floater as R16 reads them. */
export interface Floater {
  readonly id: string;
  /** The job roles they may cover; none covers only an absent member with no role. */
  readonly roleIds: readonly string[];
  /** Every version of their active status; none is always active. */
  readonly statuses: readonly StatusVersion[];
  /** Their at-work shifts (R12): at least d's month, d−1 and d+1. */
  readonly shifts: readonly FloaterShift[];
  /** Their live leave records. */
  readonly leave: readonly FloaterLeave[];
}

/** The uncovered shift: its date, and its interval that date, or `null` for a shift with no times. */
export interface UncoveredShift {
  readonly date: string;
  readonly interval: { readonly startMinute: number; readonly endMinute: number } | null;
}

/** One suggestion: the floater, and their at-work shifts in the uncovered shift's month. */
export interface FloaterSuggestion {
  readonly memberId: string;
  readonly shiftsInMonth: number;
}

/** Everything {@link floaterSuggestionsOf} reads. */
export interface FloaterSuggestionInput {
  /** The member on leave, who is never suggested for their own shift. */
  readonly absentMemberId: string;
  /** Their job role, or `null` for none (then every floater is eligible). */
  readonly absentRoleId: string | null;
  readonly uncovered: UncoveredShift;
  /** The organization's floaters, in the order ties keep (by name). */
  readonly floaters: readonly Floater[];
}

/** @throws RangeError for an interval that is not one of `date`'s (start 0–1439, end after it, at most 2879). */
function checkInterval(what: string, startMinute: number, endMinute: number): void {
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    startMinute >= MINUTES_PER_DAY ||
    endMinute <= startMinute ||
    endMinute >= 2 * MINUTES_PER_DAY
  ) {
    throw new RangeError(`${what} runs ${String(startMinute)}–${String(endMinute)}, not an interval of its date`);
  }
}

/** The absolute minute `minute` after the start of `date`. */
function absoluteOf(date: string, minute: number): number {
  return civilDayNumber(date) * MINUTES_PER_DAY + minute;
}

/**
 * R16.1: whether a floater listing `floaterRoleIds` is eligible for an
 * absent member holding `absentRoleId` (`null` for none).
 */
export function floaterEligibleFor(absentRoleId: string | null, floaterRoleIds: readonly string[]): boolean {
  return absentRoleId === null || floaterRoleIds.includes(absentRoleId);
}

/**
 * R16.2: where `floater` stands for `uncovered` — {@link FLOATER_FREE}, or
 * the first reason they are not, in the module's order. Eligibility is not
 * read here (story 21.14 lists every date of a whole leave by it).
 *
 * @throws RangeError when a date is not a calendar `YYYY-MM-DD`, an interval
 *   is not one of its date's, or on any precondition of `activeOn`.
 */
export function floaterStandingOn(floater: Floater, uncovered: UncoveredShift): FloaterStanding {
  const { date, interval } = uncovered;

  checkDate('the uncovered date', date);
  if (interval !== null) checkInterval(`the uncovered shift on ${date}`, interval.startMinute, interval.endMinute);

  for (const record of floater.leave) {
    checkDate(`a leave start of ${floater.id}`, record.from);
    checkDate(`a leave end of ${floater.id}`, record.to);
    if (record.to < record.from) throw new RangeError(`a leave of ${floater.id} ends ${record.to}, before ${record.from}`);
  }

  const day = civilDayNumber(date);

  for (const shift of floater.shifts) {
    checkDate(`a shift date of ${floater.id}`, shift.date);
    checkInterval(`a shift of ${floater.id} on ${shift.date}`, shift.startMinute, shift.endMinute);
  }

  if (!activeOn(floater.statuses, date)) return FLOATER_INACTIVE;
  if (floater.leave.some((record) => record.from <= date && date <= record.to)) return FLOATER_ON_LEAVE;
  if (floater.shifts.some((shift) => shift.date === date)) return FLOATER_WORKING;

  if (interval !== null) {
    const start = absoluteOf(date, interval.startMinute);
    const end = absoluteOf(date, interval.endMinute);
    const noRest = floater.shifts.some((shift) => {
      const offset = civilDayNumber(shift.date) - day;

      if (offset === -1) return start - absoluteOf(shift.date, shift.endMinute) <= 0;
      if (offset === 1) return absoluteOf(shift.date, shift.startMinute) - end <= 0;

      return false;
    });

    if (noRest) return FLOATER_REST_GAP;
  }

  return FLOATER_FREE;
}

/**
 * R16.2: the floaters suggested for `input.uncovered`: eligible, not the
 * absent member, and {@link FLOATER_FREE}; by fewest at-work shifts in the
 * uncovered date's calendar month, then in the order given. Empty when the
 * organization has none, or none is eligible and free.
 *
 * @throws RangeError when a floater is given twice or has an empty id, and on
 *   any precondition of {@link floaterStandingOn}.
 */
export function floaterSuggestionsOf(input: FloaterSuggestionInput): readonly FloaterSuggestion[] {
  const { absentMemberId, absentRoleId, uncovered, floaters } = input;

  checkDate('the uncovered date', uncovered.date);

  const month = uncovered.date.slice(0, 7);
  const seen = new Set<string>();
  const suggested: FloaterSuggestion[] = [];

  for (const floater of floaters) {
    if (floater.id === '') throw new RangeError('a floater has an empty id');
    if (seen.has(floater.id)) throw new RangeError(`floater ${floater.id} is given twice`);
    seen.add(floater.id);

    // The absent member and the ineligible are left out before their standing is read.
    if (floater.id === absentMemberId || !floaterEligibleFor(absentRoleId, floater.roleIds)) continue;
    if (floaterStandingOn(floater, uncovered) !== FLOATER_FREE) continue;

    suggested.push({
      memberId: floater.id,
      shiftsInMonth: floater.shifts.filter((shift) => shift.date.slice(0, 7) === month).length,
    });
  }

  // A stable sort: ties keep the order given.
  return suggested.sort((left, right) => left.shiftsInMonth - right.shiftsInMonth);
}
