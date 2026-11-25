/**
 * Personal Assignments (story 21.1; engine rules R14) and a member's schedule
 * source (story 21.9; engine rules R15); AD-26, AD-7, AD-8.
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
 * THE SCHEDULE SOURCE (story 21.9, R15): below an assignment, a member's day
 * follows their schedule source on the date, a versioned rule riding on the
 * member (`RosterMember.scheduleVersions`) as their assignments do:
 *
 * - `TEAM`, the default and what a member with no version has: they are on
 *   their effective team's base roster (R11.2), as before;
 * - `PERSONAL`: a rotation pattern and an offset step of their own, projected
 *   from the version's `effectiveFrom` exactly as a team's rotation is (R1,
 *   {@link personalRotationShiftTypeOf}). A working step of an active member is
 *   a Personal Shift counted with their effective team, else with none;
 * - `MANUAL`: nothing. They have only what is assigned to them.
 *
 * A member whose source is not `TEAM` is on no team's base roster. With no
 * version anywhere, every derivation is what it was before (R15.6).
 *
 * This module holds the assignment, its checks and the pure shift rule. The
 * composition with a member's versions (`personalShiftOn`) is in `roster.ts`,
 * which this module never imports.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { orderedSteps, stepOnDate, type RotationStep } from './projection.js';

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
 * One Personal Shift (R14.3, R15.3): a working assignment of an active member,
 * or a working step of their personal rotation; its type and the team it
 * counts with (`null`: none). An assignment's carries `personalAssignmentId`;
 * a personal rotation's carries `personalRotation: true` instead (story 21.9).
 */
export type PersonalShift = {
  readonly date: string;
  readonly shiftTypeId: string;
  readonly teamId: string | null;
} & (
  | { readonly personalAssignmentId: string; readonly personalRotation?: undefined }
  | { readonly personalRotation: true; readonly personalAssignmentId?: undefined }
);

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

/** Schedule source (R15.1): the member is on their effective team's base roster. The default. */
export const SCHEDULE_SOURCE_TEAM = 'TEAM';
/** Schedule source (R15.1): a rotation pattern and an offset step of the member's own. */
export const SCHEDULE_SOURCE_PERSONAL = 'PERSONAL';
/** Schedule source (R15.1): no rotation at all; only what is assigned. */
export const SCHEDULE_SOURCE_MANUAL = 'MANUAL';

export type ScheduleSource = typeof SCHEDULE_SOURCE_TEAM | typeof SCHEDULE_SOURCE_PERSONAL | typeof SCHEDULE_SOURCE_MANUAL;

/**
 * One stored version of a member's schedule source (`member_schedule_versions`,
 * story 21.10; R15.2): from `effectiveFrom` on, until the member's next
 * version, their source is `source`. A `PERSONAL` version names its rotation
 * pattern and the step the member stands on AT `effectiveFrom`, the version's
 * anchor (R15.1: "projected from its effective date"); both are `null` on
 * `TEAM` and `MANUAL`. The member is the one whose `scheduleVersions` hold it.
 */
export interface ScheduleVersion {
  readonly effectiveFrom: string;
  readonly source: ScheduleSource;
  readonly patternId: string | null;
  readonly offsetStepId: string | null;
}

/** The source before a member's first version, or with none: `TEAM` (R15.2). */
const TEAM_DEFAULT: ScheduleVersion = { effectiveFrom: '0001-01-01', source: SCHEDULE_SOURCE_TEAM, patternId: null, offsetStepId: null };

/** Each checked list, ordered by `effectiveFrom`. The inputs are read-only, so a list is checked once. */
const orderedSchedules = new WeakMap<readonly ScheduleVersion[], readonly ScheduleVersion[]>();

/** @throws RangeError on any precondition of {@link checkScheduleVersions}. */
function orderedScheduleVersions(versions: readonly ScheduleVersion[]): readonly ScheduleVersion[] {
  const known = orderedSchedules.get(versions);
  if (known !== undefined) return known;
  const seen = new Set<string>();
  for (const version of versions) {
    checkDate('a schedule version is effective from', version.effectiveFrom);
    const what = `the schedule version from ${version.effectiveFrom}`;
    if (seen.has(version.effectiveFrom)) throw new RangeError(`two schedule versions are effective from ${version.effectiveFrom}`);
    seen.add(version.effectiveFrom);
    if (version.source === SCHEDULE_SOURCE_PERSONAL) {
      if (typeof version.patternId !== 'string' || version.patternId === '') {
        throw new RangeError(`${what} is a personal rotation and names no rotation pattern`);
      }
      if (typeof version.offsetStepId !== 'string' || version.offsetStepId === '') {
        throw new RangeError(`${what} is a personal rotation and names no offset step`);
      }
    } else if (version.source === SCHEDULE_SOURCE_TEAM || version.source === SCHEDULE_SOURCE_MANUAL) {
      if (version.patternId !== null || version.offsetStepId !== null) {
        throw new RangeError(`${what} is ${version.source} and names a rotation pattern or an offset step`);
      }
    } else {
      throw new RangeError(`${what} is of source ${JSON.stringify(version.source)}, neither TEAM, PERSONAL nor MANUAL`);
    }
  }
  const ordered = [...versions].sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1));
  orderedSchedules.set(versions, ordered);
  return ordered;
}

/**
 * Every precondition of one member's schedule versions (R15.2): each
 * `effectiveFrom` a calendar date and no two equal, each `source` one of the
 * three, and a pattern and an offset step on `PERSONAL` only. Whether the step
 * belongs to the pattern is checked where it is projected, as a team's is.
 *
 * @throws RangeError on the first breach, naming it.
 */
export function checkScheduleVersions(versions: readonly ScheduleVersion[]): void {
  orderedScheduleVersions(versions);
}

/**
 * THE SCHEDULE SOURCE of a member on `date` (R15.2): the version with the
 * greatest `effectiveFrom` on or before it; before their first version, or
 * with none, `TEAM` (`effectiveFrom` `0001-01-01`, no pattern).
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, and on any
 *   precondition of {@link checkScheduleVersions}.
 */
export function scheduleSourceOn(versions: readonly ScheduleVersion[], date: string): ScheduleVersion {
  checkDate('the date', date);
  if (versions.length === 0) return TEAM_DEFAULT;
  let found = TEAM_DEFAULT;
  for (const version of orderedScheduleVersions(versions)) {
    if (version.effectiveFrom > date) break;
    found = version;
  }
  return found;
}

/**
 * Each pattern's steps ordered by position, per `steps` list. The inputs are
 * read-only, so a pattern's steps are filtered, checked and ordered once per
 * list, not once per member and date.
 */
const orderedPatterns = new WeakMap<readonly RotationStep[], Map<string, readonly RotationStep[]>>();

/** @throws RangeError on any precondition of `orderedSteps`. */
function patternStepsOf(steps: readonly RotationStep[], patternId: string): readonly RotationStep[] {
  let byPattern = orderedPatterns.get(steps);
  if (byPattern === undefined) {
    byPattern = new Map();
    orderedPatterns.set(steps, byPattern);
  }
  let ordered = byPattern.get(patternId);
  if (ordered === undefined) {
    ordered = orderedSteps(steps.filter((step) => step.patternId === patternId), patternId);
    byPattern.set(patternId, ordered);
  }
  return ordered;
}

/**
 * THE PERSONAL ROTATION (R15.1, R1): the shift type a `PERSONAL` version
 * projects on `date`, `steps[(offsetIndex + daysBetween(effectiveFrom, date))
 * mod cycleLength]`, its pattern's steps ordered by position. Whether the
 * version is in effect on `date` is {@link scheduleSourceOn}'s question.
 * `steps` may hold the steps of several patterns; only the version's are read.
 *
 * @throws RangeError when the version is not `PERSONAL`, when `date` is not a
 *   calendar `YYYY-MM-DD`, when its pattern has no steps among `steps` or they
 *   are malformed (`orderedSteps`), or when the offset step is not one of them.
 */
export function personalRotationShiftTypeOf(version: ScheduleVersion, steps: readonly RotationStep[], date: string): string {
  const { patternId, offsetStepId } = version;
  if (version.source !== SCHEDULE_SOURCE_PERSONAL || patternId === null || offsetStepId === null) {
    throw new RangeError(`the schedule version from ${version.effectiveFrom} is not a personal rotation`);
  }
  checkDate('the date', date);
  return stepOnDate(patternStepsOf(steps, patternId), patternId, offsetStepId, version.effectiveFrom, date).shiftTypeId;
}

/**
 * THE SHIFT RULE of a personal rotation (R15.3, R14.3) on `date`, for a
 * `PERSONAL` version in effect that date: a Personal Shift of the projected
 * type when it is a WORKING one and the member is `active`, counted with
 * `effectiveTeamId` (their effective team, R11.1, or `null`); otherwise
 * `null`, a day off.
 *
 * @throws RangeError on any precondition of {@link personalRotationShiftTypeOf}.
 */
export function personalRotationShiftOf(
  version: ScheduleVersion,
  steps: readonly RotationStep[],
  date: string,
  active: boolean,
  effectiveTeamId: string | null,
  workingShiftTypeIds: ReadonlySet<string>,
): PersonalShift | null {
  // Projected first, on an inactive date too, so a malformed pattern is refused whatever the member's status.
  const shiftTypeId = personalRotationShiftTypeOf(version, steps, date);
  if (!active || !workingShiftTypeIds.has(shiftTypeId)) return null;
  return { personalRotation: true, date, shiftTypeId, teamId: effectiveTeamId };
}
