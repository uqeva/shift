/**
 * The reminders that fall due (story 17.2; AD-7, AD-14, AD-18; D5, Q25).
 *
 * `remind` computes nothing itself: it reads `reminder_inputs()` and hands
 * each member's assembly, leads and window here, with the DATABASE's clock,
 * and writes what comes back through `enqueue_shift_reminders`. So the
 * selection is pure and its DST and midnight cases run in Vitest.
 *
 * THE RULE. For each of the member's at-work shifts (R12, `atWorkShiftsOf`)
 * in the window that has not started (`startsAt > now`), and each lead they
 * have on, the reminder is due at `reminderDueAt` (`zone.ts`, the one
 * local-to-UTC conversion). It is kept when that instant falls in
 * `[now − 15 min, now + 5 min)`: first computed at most 5 minutes before it
 * is due, from the schedule as it stands then (within D5's 15), and still
 * computed up to 15 minutes after, so a missed run or two loses nothing. The
 * window is four runs wide, so EVERY pair is kept by about four consecutive
 * runs, not only on an overlap: the outbox's unique key makes every write
 * after the first nothing (Q25), and `accepted` counts each of them again.
 *
 * The `startsAt > now` test cannot drop a pair whose due instant is in the
 * window (every lead falls due at least an hour before the start); it is the
 * rule stated once, and the RPC's own started-shift skip is the guard that
 * matters.
 *
 * Codes and values only: no name, no text. This module names no `Intl` and no
 * built-in date object (`test/purity.test.ts`).
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { atWorkShiftsOf, type ScheduleInputs } from './at-work.js';
import { isReminderLead, type ReminderLead } from './reminders.js';
import { instantOf, reminderDueAt, utcIsoOf } from './zone.js';

/** How long before `now` a due instant is still kept: 15 minutes (D5). */
export const REMINDER_WINDOW_BEFORE_MS = 15 * 60 * 1000;
/** How far after `now` a due instant is already kept: 5 minutes, one run's interval. */
export const REMINDER_WINDOW_AFTER_MS = 5 * 60 * 1000;

/**
 * One reminder that falls due: `enqueue_shift_reminders`' item, exactly
 * (AD-14). `teamId` is the effective team after loans; `start` and `end` are
 * the worked minutes after the start of `date` (the worked half on a
 * Half-day Record; past 1440 runs into the next date); `startsAt` is the
 * shift's real start instant as ISO UTC.
 */
export interface ShiftReminder {
  readonly memberId: string;
  readonly date: string;
  /**
   * `null` for a Personal Shift counted with no team (story 21.1, R14.3),
   * which only the `ASSIGNMENT` form carries.
   */
  readonly teamId: string | null;
  readonly shiftTypeId: string;
  readonly lead: ReminderLead;
  readonly start: number;
  readonly end: number;
  readonly startsAt: string;
  /**
   * Story 21.2 (AD-18 as amended): `ASSIGNMENT` for the shift of a Personal
   * Assignment, which `enqueue_shift_reminders` writes only while that row is
   * live and keys by its id. ABSENT for a team shift, the item's original
   * eight keys (R14.7). 21.9 adds `PERSONAL_ROTATION`.
   */
  readonly source?: typeof SHIFT_REMINDER_SOURCE_ASSIGNMENT;
  /** The assignment's id, with `source` only. */
  readonly personalAssignmentId?: string;
}

/** The reminder item's form for a Personal Assignment's shift (AD-18 as amended, story 21.2). */
export const SHIFT_REMINDER_SOURCE_ASSIGNMENT = 'ASSIGNMENT';

/**
 * The (shift, lead) pairs of `inputs.memberId` due in
 * `[now − 15 min, now + 5 min)` whose shift has not started at `now`, over the
 * at-work shifts from `window.from` through `window.to`, in shift order and,
 * within a shift, in `leads` order.
 *
 * @throws RangeError when `now` is not a safe integer, when a lead is not one
 *   of the leads or is given twice, on any precondition of `atWorkShiftsOf`,
 *   and when `inputs.timeZone` is not a zone the runtime knows.
 */
export function shiftRemindersDueOf(
  inputs: ScheduleInputs,
  leads: readonly ReminderLead[],
  window: { readonly from: string; readonly to: string },
  now: number,
): readonly ShiftReminder[] {
  if (!Number.isSafeInteger(now)) throw new RangeError(`the clock is ${String(now)}, not a whole number of epoch milliseconds`);
  const seen = new Set<ReminderLead>();
  for (const lead of leads) {
    if (!isReminderLead(lead)) throw new RangeError(`the reminder lead is ${JSON.stringify(lead)}, not one of the leads`);
    if (seen.has(lead)) throw new RangeError(`the reminder lead ${lead} is given twice`);
    seen.add(lead);
  }
  if (leads.length === 0) return [];

  const reminders: ShiftReminder[] = [];
  for (const shift of atWorkShiftsOf(inputs, window.from, window.to)) {
    const startsAt = instantOf(shift.date, shift.startMinute, inputs.timeZone);
    if (startsAt <= now) continue;
    for (const lead of leads) {
      const due = reminderDueAt(lead, shift.date, shift.startMinute, inputs.timeZone);
      if (due < now - REMINDER_WINDOW_BEFORE_MS || due >= now + REMINDER_WINDOW_AFTER_MS) continue;
      reminders.push({
        memberId: inputs.memberId,
        date: shift.date,
        teamId: shift.teamId,
        shiftTypeId: shift.shiftTypeId,
        lead,
        start: shift.startMinute,
        end: shift.endMinute,
        startsAt: utcIsoOf(startsAt),
        ...(shift.personalAssignmentId === undefined
          ? {}
          : { source: SHIFT_REMINDER_SOURCE_ASSIGNMENT, personalAssignmentId: shift.personalAssignmentId }),
      });
    }
  }
  return reminders;
}
