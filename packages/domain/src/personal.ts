/**
 * Personal Assignments (story 21.1; engine rules R14; AD-26, AD-7, AD-8).
 *
 * A Personal Assignment gives ONE member, on ONE date, one of three things: a
 * working shift type, a non-working shift type, or a plain day off (R14.1). It
 * is an exception, like a Loan: dated, never versioned, removed rather than
 * edited, and at most one live per member and date. It rides on the member
 * (`RosterMember.personalAssignments`), as their loans do.
 *
 * THE RULE, in the order of AD-26 (R14.2–R14.4):
 *
 * - on a date with an assignment, the member is on NO base roster — neither
 *   their own team's nor a loan team's (`shiftRoster`). Roster overrides still
 *   apply on top by their one rule, so one that puts them on a team's shift
 *   applies (a double booking), and one that takes them off a base roster they
 *   are no longer on is inert;
 * - a working assignment is a PERSONAL SHIFT of its type ({@link personalShiftOf}),
 *   counted with the team it names, else with the member's effective team
 *   that date (R11.1), else with no team. A non-working type and a day off are
 *   no shift: the member is off;
 * - a member inactive on the date has no personal shift (R14.3);
 * - a team's Scheduled Shift is never changed by an assignment (R14.4).
 *
 * With no assignment anywhere, every derivation is what it was before (R14.7).
 *
 * This module holds the assignment, its checks and the pure shift rule. The
 * composition with a member's versions (`personalShiftOn`) is in `roster.ts`,
 * which this module never imports.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';

/** A Personal Assignment of a shift type, working or not. */
export const PERSONAL_ASSIGNMENT_SHIFT = 'SHIFT';
/** A Personal Assignment of a plain day off. */
export const PERSONAL_ASSIGNMENT_OFF = 'OFF';

export type PersonalAssignmentKind = typeof PERSONAL_ASSIGNMENT_SHIFT | typeof PERSONAL_ASSIGNMENT_OFF;

/**
 * One live Personal Assignment of a member (R14.1): on `date`, a shift of
 * `shiftTypeId` (`kind` `SHIFT`), or a day off (`kind` `OFF`, with no type and
 * no team). A `SHIFT` may name `teamId`, the team it counts with; `null` means
 * the member's effective team that date (R14.3). No note and no author: the
 * engine reads neither (AD-26).
 */
export interface PersonalAssignment {
  readonly id: string;
  readonly date: string;
  readonly kind: PersonalAssignmentKind;
  readonly shiftTypeId: string | null;
  readonly teamId: string | null;
}

/**
 * One Personal Shift (R14.3): a working assignment of an active member, its
 * type and the team it counts with (`null`: none).
 */
export interface PersonalShift {
  readonly personalAssignmentId: string;
  readonly date: string;
  readonly shiftTypeId: string;
  readonly teamId: string | null;
}

/**
 * Every precondition of one member's live assignments (R14.1): ids non-empty
 * and distinct, each date a calendar date and no two on one date, a `SHIFT`
 * naming a type and counting with a team id or `null`, and an `OFF` naming
 * neither a type nor a team. Whether the type is working is not a breach: a
 * non-working one reads as off.
 *
 * @throws RangeError on the first breach, naming it.
 */
export function checkPersonalAssignments(assignments: readonly PersonalAssignment[]): void {
  indexOf(assignments);
}

/**
 * Each checked list, indexed by date. The engine's inputs are read-only, so a
 * list is checked once, and a roster read per member, team and date costs one
 * lookup rather than a re-check of the whole list.
 */
const indexes = new WeakMap<readonly PersonalAssignment[], ReadonlyMap<string, PersonalAssignment>>();

/** @throws RangeError on any precondition of {@link checkPersonalAssignments}. */
function indexOf(assignments: readonly PersonalAssignment[]): ReadonlyMap<string, PersonalAssignment> {
  const known = indexes.get(assignments);
  if (known !== undefined) return known;
  const ids = new Set<string>();
  const byDate = new Map<string, PersonalAssignment>();
  for (const assignment of assignments) {
    if (typeof assignment.id !== 'string' || assignment.id === '') throw new RangeError('a personal assignment has no id');
    const what = `personal assignment ${JSON.stringify(assignment.id)}`;
    checkDate(`${what} is dated`, assignment.date);
    if (ids.has(assignment.id)) throw new RangeError(`two personal assignments have the id ${JSON.stringify(assignment.id)}`);
    ids.add(assignment.id);
    if (byDate.has(assignment.date)) {
      throw new RangeError(`two personal assignments share ${JSON.stringify(assignment.date)}; a member has at most one per date`);
    }
    byDate.set(assignment.date, assignment);
    if (assignment.kind === PERSONAL_ASSIGNMENT_SHIFT) {
      if (typeof assignment.shiftTypeId !== 'string' || assignment.shiftTypeId === '') {
        throw new RangeError(`${what} is a shift and names no shift type`);
      }
      if (assignment.teamId !== null && (typeof assignment.teamId !== 'string' || assignment.teamId === '')) {
        throw new RangeError(`${what} counts with team ${JSON.stringify(assignment.teamId)}, neither a team id nor null`);
      }
    } else if (assignment.kind === PERSONAL_ASSIGNMENT_OFF) {
      if (assignment.shiftTypeId !== null || assignment.teamId !== null) {
        throw new RangeError(`${what} is a day off and names a shift type or a team`);
      }
    } else {
      throw new RangeError(`${what} is of kind ${JSON.stringify(assignment.kind)}, neither SHIFT nor OFF`);
    }
  }
  indexes.set(assignments, byDate);
  return byDate;
}

/**
 * The assignment of `assignments` on `date`, or `null` when there is none.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, and on any
 *   precondition of {@link checkPersonalAssignments}.
 */
export function personalAssignmentOn(assignments: readonly PersonalAssignment[], date: string): PersonalAssignment | null {
  checkDate('the date', date);
  return indexOf(assignments).get(date) ?? null;
}

/**
 * THE SHIFT RULE (R14.3) for one assignment already checked: a Personal Shift
 * when it is a `SHIFT` of a WORKING type and the member is `active`, counted
 * with the team it names, else `effectiveTeamId` (the member's effective team
 * that date, R11.1, or `null` when they have none); otherwise `null` — a
 * non-working type, a day off, or an inactive date are no shift.
 */
export function personalShiftOf(
  assignment: PersonalAssignment,
  active: boolean,
  effectiveTeamId: string | null,
  workingShiftTypeIds: ReadonlySet<string>,
): PersonalShift | null {
  if (!active || assignment.kind !== PERSONAL_ASSIGNMENT_SHIFT || assignment.shiftTypeId === null) return null;
  if (!workingShiftTypeIds.has(assignment.shiftTypeId)) return null;
  return {
    personalAssignmentId: assignment.id,
    date: assignment.date,
    shiftTypeId: assignment.shiftTypeId,
    teamId: assignment.teamId ?? effectiveTeamId,
  };
}

/**
 * Whether a shift, collision or operand counts with a team: the type guard a
 * reader that cannot yet show a Personal Shift counted with no team (R14.3)
 * filters by. With no Personal Assignment, every one does.
 */
export function hasTeam<Counted extends { readonly teamId: string | null }>(
  counted: Counted,
): counted is Counted & { readonly teamId: string } {
  return counted.teamId !== null;
}

// ------------------------------------------------------------ fill and copy

/**
 * The longest range one fill or copy covers (story 21.5): a year and a day,
 * so a leap year fits. 0077 takes at most 5 000 items in one save anyway.
 */
export const MAX_PLANNED_DAYS = 366;

/**
 * One step of a *Popuni uzorkom* pattern (story 21.5; UX-DR74): a shift type
 * (`kind` `SHIFT`, working or not) or *Slobodno* (`kind` `OFF`, no type), for
 * `count` days in a row.
 */
export interface PatternStep {
  readonly kind: PersonalAssignmentKind;
  readonly shiftTypeId: string | null;
  readonly count: number;
}

/** What a planned cell would hold: the assignment's kind, type and counted team. */
export interface PlannedValue {
  readonly kind: PersonalAssignmentKind;
  readonly shiftTypeId: string | null;
  readonly teamId: string | null;
}

/**
 * One item a fill or copy plans for a member on a date (AD-26 as amended
 * 2026-11-25): the value a save would write, or `null` — no assignment, the
 * cell cleared. Never stored as a rule: the caller drafts it like any cell.
 */
export interface PlannedAssignment {
  readonly memberId: string;
  readonly date: string;
  readonly set: PlannedValue | null;
}

/** A member and their live (or drafted) assignments, as a copy reads them. */
export interface PlannedMember {
  readonly memberId: string;
  readonly personalAssignments: readonly PersonalAssignment[];
}

/**
 * The dates from `from` to `to`, both included.
 *
 * @throws RangeError on a bad date, `to` before `from`, or more than {@link MAX_PLANNED_DAYS}.
 */
function plannedDatesOf(from: string, to: string): readonly string[] {
  checkDate('the first date', from);
  checkDate('the last date', to);
  const first = civilDayNumber(from);
  const last = civilDayNumber(to);
  if (last < first) throw new RangeError(`the range ends on ${JSON.stringify(to)}, before it starts on ${JSON.stringify(from)}`);
  if (last - first + 1 > MAX_PLANNED_DAYS) {
    throw new RangeError(
      `the range from ${JSON.stringify(from)} to ${JSON.stringify(to)} is longer than ${String(MAX_PLANNED_DAYS)} days`,
    );
  }
  const dates: string[] = [];
  for (let day = first; day <= last; day += 1) dates.push(dateOfCivilDay(day) as string);
  return dates;
}

/** @throws RangeError on an empty, repeated or non-text member id. */
function checkMemberIds(memberIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of memberIds) {
    if (typeof id !== 'string' || id === '') throw new RangeError('a planned member has no id');
    if (seen.has(id)) throw new RangeError(`the member ${JSON.stringify(id)} is named twice`);
    seen.add(id);
  }
}

/**
 * The pattern as a cycle of days (story 21.5): each step repeated `count`
 * times, in order. Its length is the cycle's.
 *
 * @throws RangeError on no step, a count that is not a whole number from 1 to
 *   {@link MAX_PLANNED_DAYS}, a `SHIFT` naming no type, or an `OFF` naming one.
 */
export function patternDaysOf(steps: readonly PatternStep[]): readonly PlannedValue[] {
  if (steps.length === 0) throw new RangeError('the pattern has no step');
  const days: PlannedValue[] = [];
  for (const [index, step] of steps.entries()) {
    const what = `pattern step ${String(index + 1)}`;
    if (!Number.isInteger(step.count) || step.count < 1 || step.count > MAX_PLANNED_DAYS) {
      throw new RangeError(
        `${what} repeats ${JSON.stringify(step.count)} times, not a whole number from 1 to ${String(MAX_PLANNED_DAYS)}`,
      );
    }
    let value: PlannedValue;
    if (step.kind === PERSONAL_ASSIGNMENT_SHIFT) {
      if (typeof step.shiftTypeId !== 'string' || step.shiftTypeId === '') {
        throw new RangeError(`${what} is a shift and names no shift type`);
      }
      value = { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: step.shiftTypeId, teamId: null };
    } else if (step.kind === PERSONAL_ASSIGNMENT_OFF) {
      if (step.shiftTypeId !== null) throw new RangeError(`${what} is a day off and names a shift type`);
      value = { kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null };
    } else {
      throw new RangeError(`${what} is of kind ${JSON.stringify(step.kind)}, neither SHIFT nor OFF`);
    }
    for (let repeat = 0; repeat < step.count; repeat += 1) days.push(value);
  }
  return days;
}

/**
 * *POPUNI UZORKOM* (story 21.5; UX-DR74; AD-26 as amended): for every member
 * of `memberIds` and every date from `from` to `to`, the pattern's day — the
 * cycle of {@link patternDaysOf} entered at its 0-based day `offset` on
 * `from`, one day per date. A shift counts with the member's own team
 * (`teamId` `null`, R14.3). The items, by member then date; nothing is
 * stored as a rule.
 *
 * @throws RangeError on any precondition of {@link patternDaysOf}, an offset
 *   outside the cycle, a bad or repeated member id, or a bad range.
 */
export function filledAssignmentsOf(
  steps: readonly PatternStep[],
  offset: number,
  memberIds: readonly string[],
  from: string,
  to: string,
): readonly PlannedAssignment[] {
  const days = patternDaysOf(steps);
  if (!Number.isInteger(offset) || offset < 0 || offset >= days.length) {
    throw new RangeError(`the offset ${JSON.stringify(offset)} is not a day of the ${String(days.length)}-day cycle`);
  }
  checkMemberIds(memberIds);
  const dates = plannedDatesOf(from, to);
  return memberIds.flatMap((memberId) =>
    dates.map((date, index) => ({ memberId, date, set: days[(offset + index) % days.length] as PlannedValue })),
  );
}

/**
 * *KOPIRAJ* (story 21.5; AD-26 as amended): for every member of `members` and
 * every date of the source range, the member's assignment there (its kind,
 * type and counted team), put on the date as far from `targetStart` as the
 * source date is from `source.from`. A source date with no assignment plans
 * `null`: the target is cleared. Only assignments are copied, never what a
 * rotation gives. Every item is read from `members` as given, so a target
 * overlapping the source copies the source as it was.
 *
 * @throws RangeError on a bad range or target, a bad or repeated member id, a
 *   target past 9999-12-31, or any precondition of {@link checkPersonalAssignments}.
 */
export function copiedAssignmentsOf(
  source: { readonly from: string; readonly to: string },
  targetStart: string,
  members: readonly PlannedMember[],
): readonly PlannedAssignment[] {
  const dates = plannedDatesOf(source.from, source.to);
  checkDate('the target start', targetStart);
  checkMemberIds(members.map((member) => member.memberId));
  for (const member of members) checkPersonalAssignments(member.personalAssignments);
  const shift =civilDayNumber(targetStart) - civilDayNumber(source.from);
  const targets = dates.map((date) => {
    const target = dateOfCivilDay(civilDayNumber(date) + shift);
    if (target === null || target > '9999-12-31') {
      throw new RangeError(`the copy of ${JSON.stringify(date)} falls outside the calendar`);
    }
    return target;
  });
  return members.flatMap((member) =>
    dates.map((date, index): PlannedAssignment => {
      const assignment = personalAssignmentOn(member.personalAssignments, date);
      return {
        memberId: member.memberId,
        date: targets[index] as string,
        set:
          assignment === null
            ? null
            : { kind: assignment.kind, shiftTypeId: assignment.shiftTypeId, teamId: assignment.teamId },
      };
    }),
  );
}
