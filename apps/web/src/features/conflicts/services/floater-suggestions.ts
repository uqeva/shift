import {
  atWorkShiftsOf,
  datesOfMonth,
  deriveShiftTimes,
  floaterSuggestionsOf,
  monthOf,
  shiftTypeVersionOn,
  type Collision,
  type Floater,
  type UncoveredShift,
} from '@shift/domain';

import { scheduleInputsOfCalendar, scheduleLeaveOf } from '@/features/calendar/services/schedule-inputs';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { CandidateGroup, ReplacementCandidate } from '@/features/calendar/utils/replacement-candidates';
import type { OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import { nextIsoDate, previousIsoDate } from '@/lib/i18n/format';

/**
 * *PREDLOŽENE ZAMJENE* (story 21.13; R16.2, UX-DR77): the browser's adapter
 * from what the resolution screen already reads to the domain's
 * `floaterSuggestionsOf`, in a `.ts` that renders nothing (AD-15). Nothing is
 * decided here: eligibility, freedom and order are `domain/floaters`'.
 *
 *   - THE FLOATERS are the member list's (`isFloater`, `floaterRoleIds`,
 *     admin-only, 0084), in the calendar snapshot's order, which is the
 *     names' (the Croatian collation): the domain keeps it on a tie.
 *   - THEIR AT-WORK SHIFTS are R12's one function (`atWorkShiftsOf`, R12.3)
 *     over the browser's one assembly (`scheduleInputsOfCalendar`, AD-19),
 *     each floater's own, with their own leave from the organization's
 *     records, over the conflict's month and the day either side of it.
 *   - THEIR LEAVE is the organization's live records, a half day's included.
 *   - THE ABSENT MEMBER'S ROLE is the snapshot's (`calendar_members()`).
 *   - THE UNCOVERED SHIFT is the conflict's type's times that date, or none.
 *
 * NARROWED, NEVER WIDENED: a suggestion is only ever one of 21.7's
 * `assignmentCandidatesOf` for the conflict (whoever a cover by assignment may
 * write), with that candidate's own line, and its count of shifts.
 */

/** A member of the list as far as floating goes: `MemberListRow`'s two fields (0084), which its parser always sets. */
export interface FloaterMember {
  readonly id: string;
  readonly isFloater: boolean;
  readonly floaterRoleIds: readonly string[];
}

/** A suggested floater: their candidate line, and their at-work shifts in the conflict's month. */
export interface SuggestedCandidate extends ReplacementCandidate {
  readonly shiftsInMonth: number;
}

/** What the screen shows of the floaters: the suggestions, and the role the none line names. */
export interface FloaterSuggestionsView {
  /** The suggested floaters, in the domain's order; empty when nobody is free. */
  readonly suggested: readonly SuggestedCandidate[];
  /** The absent member's role, for `Nema slobodne zamjene za posao {posao}.`; `null` for none. */
  readonly roleName: string | null;
}

/**
 * `date`'s calendar month (the domain's `datesOfMonth`), widened to the day
 * either side of `date`: every at-work shift R16.2 counts or reads a rest gap from.
 *
 * @throws RangeError when `date` is not a calendar date, or is the calendar's first or last day.
 */
function windowOf(date: string): { readonly from: string; readonly to: string } {
  const dates = datesOfMonth(monthOf(date));
  const before = previousIsoDate(date);
  const after = nextIsoDate(date);
  const first = dates[0];
  const last = dates[dates.length - 1];

  if (before === null || after === null || first === undefined || last === undefined) {
    throw new RangeError(`no window around ${date}`);
  }

  return { from: before < first ? before : first, to: after > last ? after : last };
}

/**
 * The uncovered shift: the conflict's date and its type's interval that date.
 *
 * @throws RangeError for a type the snapshot lacks, or on `shiftTypeVersionOn`'s preconditions.
 */
function uncoveredOf(snapshot: CalendarSnapshot, collision: Collision): UncoveredShift {
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

  const version = type.isWorking ? shiftTypeVersionOn(type.versions, collision.date) : null;

  if (version === null) return { date: collision.date, interval: null };

  const { durationMinutes } = deriveShiftTimes(version.startMinute, version.endMinute);

  return { date: collision.date, interval: { startMinute: version.startMinute, endMinute: version.startMinute + durationMinutes } };
}

/**
 * The floaters suggested for `collision`, narrowed to `assignmentCandidates`
 * (21.7's, for this conflict), or `null` when the organization has no floater:
 * then the screen is as before, with no block at all.
 *
 * @throws RangeError on any precondition of the domain's derivation, or for a
 *   member, type or team the snapshot lacks.
 */
export function floaterSuggestionsOfConflict(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  members: readonly FloaterMember[],
  collision: Collision,
  assignmentCandidates: readonly CandidateGroup[],
): FloaterSuggestionsView | null {
  const byId = new Map(members.filter((member) => member.isFloater).map((member) => [member.id, member]));

  if (byId.size === 0) return null;

  const absent = snapshot.members.find((one) => one.id === collision.memberId);

  if (absent === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);

  const window = windowOf(collision.date);
  // ONE ASSEMBLY, reused per floater with their own id and leave (AD-19's adapter, built once).
  const assembly = scheduleInputsOfCalendar(snapshot, [], window);
  const floaters: Floater[] = [];

  // The snapshot's order: the names'.
  for (const member of snapshot.members) {
    const row = byId.get(member.id);

    if (row === undefined) continue;

    const leave = records.filter((record) => record.memberId === member.id);
    const inputs = { ...assembly, memberId: member.id, leave: scheduleLeaveOf(leave, window) };

    floaters.push({
      id: member.id,
      roleIds: row.floaterRoleIds,
      statuses: member.statuses,
      shifts: atWorkShiftsOf(inputs, window.from, window.to),
      leave: leave.map((record) => ({ from: record.from, to: record.to })),
    });
  }

  const offered = new Map(assignmentCandidates.flatMap((group) => group.candidates).map((candidate) => [candidate.id, candidate]));
  const suggested = floaterSuggestionsOf({
    absentMemberId: collision.memberId,
    absentRoleId: absent.jobRole?.id ?? null,
    uncovered: uncoveredOf(snapshot, collision),
    floaters,
  }).flatMap((suggestion) => {
    const candidate = offered.get(suggestion.memberId);

    return candidate === undefined ? [] : [{ ...candidate, shiftsInMonth: suggestion.shiftsInMonth }];
  });

  return { suggested, roleName: absent.jobRole?.name ?? null };
}

/** The groups without the suggested candidates: a suggested floater is listed once, first. */
export function groupsLessSuggested(groups: readonly CandidateGroup[], suggested: readonly SuggestedCandidate[]): readonly CandidateGroup[] {
  if (suggested.length === 0) return groups;

  const ids = new Set(suggested.map((candidate) => candidate.id));

  return groups.map((group) => ({ ...group, candidates: group.candidates.filter((candidate) => !ids.has(candidate.id)) }));
}
