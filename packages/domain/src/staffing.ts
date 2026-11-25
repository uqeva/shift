/**
 * Short-staffed shifts (story 11.1; CAP-21; engine rules R10.1–R10.5; AD-1,
 * AD-2, AD-7, AD-8).
 *
 * The ONE staffing rule. How many people are at work on a working Scheduled
 * Shift, and whether that is fewer than the organization's Minimum Members, is
 * derived here, on read, and nowhere else: nothing stores a count or a state
 * (AD-1, R10.3), and nothing "resolves" one — it ends only when the roster,
 * the absence or the setting changes.
 *
 * PEOPLE AT WORK (R10.1): the shift's roster after the roster overrides
 * ({@link rosterOn}: the default roster less each member an applying override
 * takes off, plus each member one puts on), less every member ON THAT LIST
 * whose leave record covers the date. A member a replacement took off is no
 * longer on the list, so their leave is never subtracted twice; a replacement
 * who is on leave themselves is subtracted. Every leave record counts as an
 * absence, whatever its type, except a half-day record (story 13.5, R10.1): a
 * member on a half day counts as at work.
 *
 * SHORT-STAFFED (R10.2): the scheduled shift type is a working one AND the
 * people at work number fewer than `minimumMembers`. A non-working day, a team
 * whose rotation has not started, and a `minimumMembers` of `null` are never
 * short-staffed. Minimum Members is current-state (AD-2), so the same input
 * with another minimum re-reports past dates too (R10.4).
 *
 * PERSONAL SHIFTS (story 21.1, R14.6, amending R10.1): the shifts of team T on
 * a date are T's working Scheduled Shift, if any, and one GROUP for each other
 * working shift type among the Personal Shifts counted with T that date. The
 * people at work on the Scheduled Shift are its roster after the roster
 * overrides plus the Personal Shifts counted with T of the same type; those in
 * a group are its Personal Shifts; both less everyone absent, each member
 * counted once. Each is short-staffed by R10.2. With no Personal Assignment,
 * every team has its Scheduled Shift alone, exactly as before (R14.7). A
 * personal rotation's shifts (story 21.9, R15.3) are Personal Shifts too, and
 * join the same groups; a member on one is on no base roster.
 *
 * Results are ids, codes and numbers only (AD-8): no name and no text, and
 * nothing here reads a fire rank or a team position (FR-18a) — a roster entry's
 * position is carried by `roster.ts` and never looked at.
 *
 * Ranges are inclusive `from`–`to` calendar dates. Dates are `YYYY-MM-DD`
 * strings: no `Date`, no time zone. The caller bounds the window. Every
 * breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate } from './calendar.js';
import type { CollisionLeaveRecord } from './collisions.js';
import { checkRange, isHalfDay } from './leave.js';
import type { PersonalShift } from './personal.js';
import { personalShiftOn, rosterOn, type RosterMember } from './roster.js';
import { adjacentMonth, monthOf, scheduleOfMonth, type ScheduleInput } from './schedule.js';

export const SHORT_STAFFED = 'SHORT_STAFFED';

/**
 * What staffing is derived from: the schedule's configuration
 * ({@link ScheduleInput} — the teams asked for, rotations, shift-type and
 * roster overrides, every member, the working types), every live leave record
 * and the organization's Minimum Members.
 */
export interface StaffingInput extends ScheduleInput {
  /** Every live leave record, of any member, in any order. */
  readonly leaveRecords: readonly CollisionLeaveRecord[];
  /** The organization's Minimum Members: a whole number from 1, or `null` when the setting is empty. */
  readonly minimumMembers: number | null;
}

/** A working shift's staffing: the type it works and the people at work on it. */
export interface Staffing {
  readonly shiftTypeId: string;
  readonly atWork: number;
}

/**
 * One short-staffed shift (R10.4's report): the date, the team, the working
 * type it works, the people at work and the minimum they fall short of.
 */
export interface ShortStaffedShift {
  readonly code: typeof SHORT_STAFFED;
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly atWork: number;
  readonly minimum: number;
}

/**
 * THE SHORT-STAFFED PREDICATE (R10.2), for a working shift's people at work:
 * fewer than the minimum. A `null` minimum (the setting empty) is never short.
 * The one comparison every caller reads — the report here, a resolution
 * strip's coverage term in the web layer (story 11.2) — so it lives once (AD-7).
 */
export function isShortStaffed(atWork: number, minimum: number | null): boolean {
  return minimum !== null && atWork < minimum;
}

/**
 * @throws RangeError when `minimumMembers` is neither `null` nor a whole
 *   number of at least 1.
 */
function checkMinimum(minimumMembers: number | null): void {
  if (minimumMembers === null) return;
  if (!Number.isInteger(minimumMembers) || minimumMembers < 1) {
    throw new RangeError(`the minimum members is ${String(minimumMembers)}, not a whole number of at least 1 or empty`);
  }
}

/** Whether `date` is covered by one of `records`. */
type LeaveIndex = (memberId: string, date: string) => boolean;

/**
 * The leave records indexed by member, each checked.
 *
 * @throws RangeError when two records share an id, or a record's start or end
 *   is not a calendar `YYYY-MM-DD`, it ends before it starts, or it is longer
 *   than `MAX_LEAVE_RANGE_DAYS`.
 */
function leaveIndexOf(records: readonly CollisionLeaveRecord[]): LeaveIndex {
  const ids = new Set<string>();
  const byMember = new Map<string, CollisionLeaveRecord[]>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new RangeError(`leave record ${JSON.stringify(record.id)} is given twice`);
    }
    ids.add(record.id);
    checkRange(`leave record ${JSON.stringify(record.id)}`, record);
    // A member on a half day is at work (R10.1, story 13.5).
    if (isHalfDay(record)) continue;
    const known = byMember.get(record.memberId);
    if (known === undefined) byMember.set(record.memberId, [record]);
    else known.push(record);
  }
  return (memberId, date) => (byMember.get(memberId) ?? []).some((record) => record.from <= date && date <= record.to);
}

/**
 * @throws RangeError when `from` or `to` is not a calendar `YYYY-MM-DD`, or
 *   `to` is before `from`.
 */
function checkWindow(from: string, to: string): void {
  checkDate('the start of the window', from);
  checkDate('the end of the window', to);
  if (to < from) {
    throw new RangeError(`the window runs from ${JSON.stringify(from)} to ${JSON.stringify(to)}, which ends before it starts`);
  }
}

/** One member's Personal Shift, by the member. */
type MemberPersonalShift = PersonalShift & { readonly memberId: string };

/**
 * The Personal Shifts counted with a team on a date (R14.3, R14.6, R15.3), in
 * the order of `members`, computed once per date and only over the members who
 * hold any assignment or schedule version: with none, every lookup is empty
 * and nothing is read. A personal rotation projects over `steps`.
 */
function personalShiftsIndexOf(
  members: readonly RosterMember[],
  working: ReadonlySet<string>,
  steps: ScheduleInput['steps'],
): (date: string, teamId: string) => readonly MemberPersonalShift[] {
  const assigned = members.filter(
    (member) => (member.personalAssignments ?? []).length > 0 || (member.scheduleVersions ?? []).length > 0,
  );
  const byDate = new Map<string, ReadonlyMap<string, readonly MemberPersonalShift[]>>();
  return (date, teamId) => {
    if (assigned.length === 0) return [];
    let byTeam = byDate.get(date);
    if (byTeam === undefined) {
      const indexed = new Map<string, MemberPersonalShift[]>();
      for (const member of assigned) {
        const shift = personalShiftOn(member, date, working, steps);
        if (shift === null || shift.teamId === null) continue;
        const entry = { ...shift, memberId: member.id };
        const known = indexed.get(shift.teamId);
        if (known === undefined) indexed.set(shift.teamId, [entry]);
        else known.push(entry);
      }
      byTeam = indexed;
      byDate.set(date, byTeam);
    }
    return byTeam.get(teamId) ?? [];
  };
}

/**
 * One staffed shift of a team on a date: the team's Scheduled Shift
 * (`group: false`), or a group of Personal Shifts of one other working type
 * counted with it (`group: true`, R14.6).
 */
interface StaffedShift extends Staffing {
  readonly date: string;
  readonly teamId: string;
  readonly group: boolean;
}

/**
 * Every working shift of the teams of `input.teamIds` from `from` to `to`, with
 * its people at work, soonest first, then in the order of `teamIds`, and
 * within a team on a date its Scheduled Shift first, then its groups in the
 * order their first Personal Shift's member appears in `members`.
 */
function staffedShiftsOf(input: StaffingInput, from: string, to: string): readonly StaffedShift[] {
  const onLeave = leaveIndexOf(input.leaveRecords);
  const working = new Set(input.workingShiftTypeIds);
  const personalOf = personalShiftsIndexOf(input.members, working, input.steps);
  const shifts: StaffedShift[] = [];
  // Each member once: a member put on by an override who also holds a Personal Shift of the type is one person.
  const atWorkOf = (memberIds: readonly string[], date: string): number =>
    [...new Set(memberIds)].filter((memberId) => !onLeave(memberId, date)).length;

  const last = monthOf(to);
  for (let month: string | null = monthOf(from); month !== null; month = month === last ? null : adjacentMonth(month, 1)) {
    for (const row of scheduleOfMonth(input, month)) {
      if (row.date < from || row.date > to) continue;
      for (const cell of row.cells) {
        const personal = personalOf(row.date, cell.teamId);
        const scheduled = cell.shiftTypeId !== null && working.has(cell.shiftTypeId) ? cell.shiftTypeId : null;
        if (scheduled !== null) {
          const { roster } = rosterOn(input.members, input.rosterOverrides, cell.teamId, row.date);
          const people = [
            ...roster.map((entry) => entry.memberId),
            ...personal.filter((shift) => shift.shiftTypeId === scheduled).map((shift) => shift.memberId),
          ];
          shifts.push({ date: row.date, teamId: cell.teamId, shiftTypeId: scheduled, atWork: atWorkOf(people, row.date), group: false });
        }
        const groups = new Map<string, string[]>();
        for (const shift of personal) {
          if (shift.shiftTypeId === scheduled) continue;
          const known = groups.get(shift.shiftTypeId);
          if (known === undefined) groups.set(shift.shiftTypeId, [shift.memberId]);
          else known.push(shift.memberId);
        }
        for (const [shiftTypeId, memberIds] of groups) {
          shifts.push({ date: row.date, teamId: cell.teamId, shiftTypeId, atWork: atWorkOf(memberIds, row.date), group: true });
        }
      }
    }
  }
  return shifts;
}

/**
 * The staffing of `teamId`'s shift on `date` (R10.1): the working type it
 * works and the people at work on it, or `null` when the team works no working
 * shift that day — a non-working type, or no rotation version yet. Does not
 * read `minimumMembers` beyond checking it. `teamId` need not be in
 * `input.teamIds`.
 *
 * With `shiftTypeId` (story 21.1, R14.6), the team's shift of that type that
 * date: its Scheduled Shift when it works that type, else the group of
 * Personal Shifts of that type counted with it, else `null`. Without it, the
 * Scheduled Shift alone, as before; {@link staffingOn} gives every one.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, on any
 *   precondition of the leave records or the minimum, and on any of
 *   {@link scheduleOfMonth}, {@link rosterOn} or `personalShiftOn`.
 */
export function peopleAtWorkOn(input: StaffingInput, teamId: string, date: string, shiftTypeId?: string): Staffing | null {
  checkDate('the date', date);
  checkMinimum(input.minimumMembers);
  const shifts = staffedShiftsOf({ ...input, teamIds: [teamId] }, date, date);
  const shift = shiftTypeId === undefined ? shifts.find((one) => !one.group) : shifts.find((one) => one.shiftTypeId === shiftTypeId);
  return shift === undefined ? null : { shiftTypeId: shift.shiftTypeId, atWork: shift.atWork };
}

/**
 * Every shift of `teamId` on `date` with its people at work (story 21.1,
 * R14.6): its working Scheduled Shift first, if it has one, then one group per
 * other working type among the Personal Shifts counted with it. Empty when it
 * has neither. With no Personal Assignment, at most the Scheduled Shift, as
 * {@link peopleAtWorkOn} gives it.
 *
 * @throws RangeError on any precondition of {@link peopleAtWorkOn}.
 */
export function staffingOn(input: StaffingInput, teamId: string, date: string): readonly Staffing[] {
  checkDate('the date', date);
  checkMinimum(input.minimumMembers);
  return staffedShiftsOf({ ...input, teamIds: [teamId] }, date, date).map((shift) => ({
    shiftTypeId: shift.shiftTypeId,
    atWork: shift.atWork,
  }));
}

/** {@link shortStaffedShiftsOf} with each shift's `group` flag kept, for matching across a change. */
function shortStaffedOf(input: StaffingInput, from: string, to: string): readonly (ShortStaffedShift & { readonly group: boolean })[] {
  checkWindow(from, to);
  checkMinimum(input.minimumMembers);
  const minimum = input.minimumMembers;
  if (minimum === null) return [];
  return staffedShiftsOf(input, from, to)
    .filter((shift) => isShortStaffed(shift.atWork, minimum))
    .map((shift) => ({
      code: SHORT_STAFFED,
      date: shift.date,
      teamId: shift.teamId,
      shiftTypeId: shift.shiftTypeId,
      atWork: shift.atWork,
      minimum,
      group: shift.group,
    }));
}

/**
 * Every short-staffed shift from `from` to `to` (R10.2) of the teams of
 * `input.teamIds`: each working shift — a Scheduled Shift or a group of
 * Personal Shifts (R14.6) — whose people at work number fewer than
 * `input.minimumMembers`. None at all when the minimum is `null`. Soonest
 * first, then in the order of `teamIds`, then a team's Scheduled Shift before
 * its groups. Reads its input and writes nothing.
 *
 * @throws RangeError when the window is not two calendar dates in order, when
 *   the minimum is neither `null` nor a whole number of at least 1, on any
 *   precondition of the leave records, and on any of {@link scheduleOfMonth},
 *   {@link rosterOn} or `personalShiftOn`.
 */
export function shortStaffedShiftsOf(input: StaffingInput, from: string, to: string): readonly ShortStaffedShift[] {
  return shortStaffedOf(input, from, to).map(({ group: _group, ...shift }) => shift);
}

/** A short-staffed shift's keys: by type, and, for a Scheduled Shift, by team and date alone. */
function typeKeyOf(shift: Pick<ShortStaffedShift, 'date' | 'teamId' | 'shiftTypeId'>): string {
  return JSON.stringify(['TYPE', shift.date, shift.teamId, shift.shiftTypeId]);
}

function scheduledKeyOf(shift: Pick<ShortStaffedShift, 'date' | 'teamId'>): string {
  return JSON.stringify(['SCHEDULED', shift.date, shift.teamId]);
}

/**
 * THE CHANGE'S REPORT (R10.4): the shifts from `from` to `to` that `after` makes
 * short-staffed and `before` did not — each one as `after` derives it, in
 * {@link shortStaffedShiftsOf}'s order. A shift short-staffed in both, or only
 * in `before`, is not returned. A shift is matched by its team and date, so
 * one whose type a change turns from one working type to another, and stays
 * short, is not newly short. Reads its inputs and writes nothing.
 *
 * Story 21.1 (R14.6): a group of Personal Shifts is matched by its date, team
 * and type, since a team may have several groups on one date; a Scheduled
 * Shift also matches a group of its own type, so a short group that becomes the
 * Scheduled Shift's type (or the reverse) is not newly short either.
 *
 * `before` and `after` are one organization before and after ONE change, so
 * they ask for the same `teamIds`: a team only `after` asks for would report
 * each of its short shifts as new. The minimum may differ between them (it is
 * current-state, R10.4), and then every shift the new minimum makes short is
 * new, as the change it is.
 *
 * @throws RangeError on any precondition of {@link shortStaffedShiftsOf} for
 *   either input.
 */
export function newlyShortStaffedOf(before: StaffingInput, after: StaffingInput, from: string, to: string): readonly ShortStaffedShift[] {
  const already = new Set<string>();
  for (const shift of shortStaffedOf(before, from, to)) {
    already.add(typeKeyOf(shift));
    if (!shift.group) already.add(scheduledKeyOf(shift));
  }
  return shortStaffedOf(after, from, to)
    .filter((shift) => !already.has(typeKeyOf(shift)) && (shift.group || !already.has(scheduledKeyOf(shift))))
    .map(({ group: _group, ...shift }) => shift);
}
