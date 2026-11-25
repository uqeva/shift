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

import { checkDate } from './calendar.js';

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
