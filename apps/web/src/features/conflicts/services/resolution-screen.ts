import { collisionKeyOf, daysBetween, effectiveTeamOn, deriveShiftTimes, isHalfDay, leaveBalanceOf, leaveRangeCostOf, leaveSpanOf, PERSONAL_ASSIGNMENT_SHIFT, shiftTypeVersionOn, type Collision, type LeaveAllowance, type LeaveHalf } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { dayDetailOf, type DayDetailMember } from '@/features/calendar/utils/day-detail';
import { MODE_SVE, calendarTodayOf, dayMonthOf, typeRangeOn, weekdayOf, type CalendarSearch } from '@/features/calendar/utils/month';
import {
  assignmentCandidatesOf,
  replacementCandidatesOf,
  type CandidateGroup,
  type CandidateGroupKind,
  type ReplacementCandidate,
} from '@/features/calendar/utils/replacement-candidates';
import {
  liveResolutionsOf,
  queueCountOf,
  queueOrderOf,
  queueReadFailed,
  unresolvedOf,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import {
  floaterSuggestionsOfConflict,
  groupsLessSuggested,
  type SuggestedCandidate,
} from '@/features/conflicts/services/floater-suggestions';
import { leaveCoverOffered } from '@/features/conflicts/services/leave-cover';
import {
  heldByReplacement,
  personalShiftCountedWith,
  replacementContextOf,
  supersededCoverOf,
} from '@/features/conflicts/services/replacement-effect';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import type { ManualSearch } from '@/features/planning/services/manual-search';
import {
  leaveRecordFieldsOf,
  organizationLeaveRecordsOf,
  type LeaveRecord,
  type OrganizationLeaveRecord,
} from '@/features/leave/services/leave-list';
import {
  AMEND_ENDS,
  AMEND_REMOVES,
  AMEND_STARTS,
  LEAVE_AMEND_ACTION,
  LEAVE_LOADING,
  LEAVE_PREVIEW_READY,
  LEAVE_READY,
  LEAVE_REMOVE_ACTION,
  amendTargetOf,
  leavePreviewStateOf,
  leaveRangeValuesOf,
  memberLeaveBaseOf,
  type LeaveHandoff,
  type ResolutionAmendKind,
  type ResolutionAmendTarget,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
  type LeaveRecordsInput,
} from '@/features/leave/services/leave-section';
import { positionsShown, rosterPositionMessageKey } from '@/features/members/utils/position';
import { formatIsoDate, previousIsoDate } from '@/lib/i18n/format';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import { durationValuesOf, type DurationValues } from '@/utils/time';
import { ROSTER_CHANGE_SAVE, rosterChangeSnapshotOf } from '@/features/calendar/services/roster-erasures';
import {
  coverageAgainstMinimumOf,
  staffingAppliesOf,
  type CoverageAgainstMinimum,
} from '@/features/staffing/services/short-staffed';

/**
 * One conflict's resolution screen (story 5.4b; CAP-16, UX-DR10, UX-DR11,
 * UX-DR28, UX-DR29), as a pure view model in a `.ts` that renders nothing
 * (AD-15). The hook only wires the reads and the write; the node suite
 * executes this.
 *
 * THE SAME UNRESOLVED SET AS THE QUEUE. The conflict is found among
 * *Za odluku*'s own derivation — `unresolvedOf` over the calendar's one
 * snapshot, the organization's live leave and its live resolutions — in the
 * queue's own order (`queueOrderOf`), so `K od N` and ‹ › are exactly the
 * queue's rows. A conflict that is not among them — already resolved, a URL
 * that names nothing, or a member no longer on leave that date — is
 * {@link RESOLUTION_MISSING}: the screen says it is no longer open, and links
 * back. The way back names the WHOLE queue's count (story 9.5): its
 * collisions, its pending leave requests and (story 12.4) its waiting swaps,
 * as *Za odluku* and *Danas* count them; `K od N` and ‹ › stay over the collisions alone. Nothing here decides whether a collision exists; the domain does.
 *
 * THE FACTS AND THE STRIP are read off the same answers: the shift type and
 * its times on the date, the team, the absent member with rank and position
 * (information only, never used), the causing record's range and what it
 * costs, and who else works that day, from the day detail's roster
 * (`dayDetailOf`) less every member on live leave that date. The strip's
 * three terms are coverage (`covered of total`, the roster with and without
 * the members on leave), the absent member's leave in days (the conflict's
 * date as a day of absence, whatever its type, `leaveRangeCostOf` over that one date with the
 * record's half — `0,5 dana` for a half day (story 13.5): `1 dan
 * odsutnosti` — leave is counted in days, never hours, human 2026-10-10) and
 * the balance, which accepting
 * leaves unchanged — `leaveBalanceOf` through the member card's own recipe
 * (`memberLeaveBaseOf`).
 *
 * AMENDING THE LEAVE (story 5.4d) is the third card, and writes nothing. It
 * states the range that would clear this conflict (rule A, human,
 * 2026-10-02: a date before the record's end moves its start to the day
 * after; its last day moves its end to the day before; a one-day record is
 * removed) — a computation, never a recommendation — and its strip reads the
 * coverage one higher with the absent member working, the shift's hours as
 * work, and the balance in the conflict date's leave year once those days are
 * given back. Its Spremi hands that range to the member page's own amend or
 * removal (`amendHandoffOf`); the conflict clears by derivation once that
 * amend is saved (5.4a).
 *
 * REPLACING (story 5.4c) is the second card. Its candidates are
 * `replacementCandidatesOf`'s three groups for the conflict's team and date,
 * over the same snapshot and leave; its strip reads the coverage one higher
 * (`covered + 1 of total`), never "Nepokriveno", and the same hours and
 * balance as the first card — the replacement's override only adds, so the
 * absent member stays rostered on leave (human, 2026-10-02).
 *
 * A KEY STILL HELD (story 5.5d). A conflict back among the unresolved
 * because the snapshot holds its `replace_member` resolution's override
 * pending after a rotation save, or inert, still has that live row holding
 * 0031's key, so no new decision can be saved on it until the override is
 * removed in the calendar, which 0033 makes end the resolution too.
 * {@link ResolutionView.held} says so: the screen states it as Spremi's hint,
 * with the way to that day in the calendar, and Spremi waits.
 *
 * FLOATERS FIRST (story 21.13; R16.2, UX-DR77). With a floater in the
 * organization, the second card's picker lists *Predložene zamjene* first: the
 * floaters `domain/floaters` suggests (eligible by role, active, free, by
 * fewest shifts in the month, then name), narrowed to 21.7's
 * `assignmentCandidatesOf` for the conflict, and left out of the other
 * groups. None suggested says `Nema slobodne zamjene za posao {posao}.` (or
 * with no role, *Nema slobodne zamjene.*). A suggested pick is written as a
 * Personal Assignment counted with the conflict's team (R16.3,
 * {@link replaceWriteOf}), a team rotation shift's too; any other pick keeps
 * the conflict's own form. With no floater, nothing here changes.
 *
 * A KEY HELD BY AN ASSIGNMENT (story 21.13, the 21.7 deferral): a cover's
 * assignment that no longer applies says to remove it in *Ručni raspored*,
 * linking the cover's month, person and date ({@link ResolutionView.heldBy}).
 *
 * A WHOLE LEAVE (story 21.14; R16.4): with a floater in the organization, the
 * screen offers *Pokrij cijelo odsustvo* ({@link ResolutionView.leaveCover}),
 * a dialog over the record's unresolved conflicts (`leave-cover.ts`). And a
 * SUPERSEDED DECISION'S COVER (the 21.7 deferral): a cover by assignment
 * decided on another shift type (0038) decides nothing, yet its cover still
 * holds that shift; the screen names each one, linking *Ručni raspored*
 * ({@link ResolutionView.supersededCovers}).
 *
 * NEVER A PARTIAL SCREEN. A read that failed or is paused offline, a row that
 * cannot be trusted, and any `RangeError` of a derivation make the screen
 * unavailable, logged, with a retry.
 */

/** Still waiting on a read: the skeleton. */
export const RESOLUTION_LOADING = 'loading';
/** A read failed, or what it answered breaches a rule: one alert with a retry. */
export const RESOLUTION_UNAVAILABLE = 'unavailable';
/** The conflict is not among the unresolved: the screen says so and links back. */
export const RESOLUTION_MISSING = 'missing';
/** Everything read: the facts, the choice and the strip. */
export const RESOLUTION_READY = 'ready';

/** Story 5.4b's outcome, as the radio group's value: fixed position 1. */
export const OPTION_ACCEPT_UNCOVERED = 'accept-uncovered';

/** Story 5.4c's outcome: fixed position 2. */
export const OPTION_REPLACE_MEMBER = 'replace-member';

/** Story 5.4d's outcome: fixed position 3. It records no resolution; it opens the leave amend. */
export const OPTION_AMEND_LEAVE = 'amend-leave';

/** The radio group's value while nothing is chosen: Radix's own "none". */
export const NO_OPTION = '';

/** The outcomes, in their fixed order. */
export const RESOLUTION_OPTIONS = [OPTION_ACCEPT_UNCOVERED, OPTION_REPLACE_MEMBER, OPTION_AMEND_LEAVE] as const;

export type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];

/** The id the choice's heading carries, which names the radio group. */
export const RESOLUTION_CHOICE_HEADING_ID = 'resolution-choice';

/** The ids that name and describe the first card: its title, its sentence and its strip. */
export const RESOLUTION_ACCEPT_TITLE_ID = 'resolution-accept-title';
export const RESOLUTION_ACCEPT_BODY_ID = 'resolution-accept-body';
export const RESOLUTION_ACCEPT_STRIP_ID = 'resolution-accept-strip';
/** The card's description: its sentence, then its strip. */
export const RESOLUTION_ACCEPT_DESCRIBED_BY = `${RESOLUTION_ACCEPT_BODY_ID} ${RESOLUTION_ACCEPT_STRIP_ID}`;

/** The same three for the second card (story 5.4c). */
export const RESOLUTION_REPLACE_TITLE_ID = 'resolution-replace-title';
export const RESOLUTION_REPLACE_BODY_ID = 'resolution-replace-body';
export const RESOLUTION_REPLACE_STRIP_ID = 'resolution-replace-strip';
export const RESOLUTION_REPLACE_DESCRIBED_BY = `${RESOLUTION_REPLACE_BODY_ID} ${RESOLUTION_REPLACE_STRIP_ID}`;

/** The same three for the third card (story 5.4d). */
export const RESOLUTION_AMEND_TITLE_ID = 'resolution-amend-title';
export const RESOLUTION_AMEND_BODY_ID = 'resolution-amend-body';
export const RESOLUTION_AMEND_STRIP_ID = 'resolution-amend-strip';
export const RESOLUTION_AMEND_DESCRIBED_BY = `${RESOLUTION_AMEND_BODY_ID} ${RESOLUTION_AMEND_STRIP_ID}`;

/** The id the candidate picker's heading carries, which names its own radio group (story 5.4c). */
export const RESOLUTION_CANDIDATES_HEADING_ID = 'resolution-candidates';

/** The id one candidate group's heading carries, which names that group. */
export function candidateGroupHeadingId(kind: CandidateGroupKind): string {
  return `resolution-candidates-${kind}`;
}

/** The id *Predložene zamjene*'s heading carries, which names that group (story 21.13). */
export const RESOLUTION_SUGGESTIONS_HEADING_ID = 'resolution-candidates-suggested';

/** The candidate picker's value while nobody is chosen: Radix's own "none". */
export const NO_CANDIDATE = '';
/** The id the save hint carries, which describes the save button. */
export const RESOLUTION_SAVE_HINT_ID = 'resolution-save-hint';

/** The conflict a resolution screen is opened for: the route's three params. */
export interface ResolutionParams {
  readonly memberId: string;
  readonly date: string;
  /** `null` for a collision with no team (story 21.7; the route's `bez-tima`). */
  readonly teamId: string | null;
}

/** Replace Member by a roster override that puts the replacement on the team's shift (story 5.4c, 0032). */
export const REPLACE_BY_OVERRIDE = 'override';
/**
 * STORY 21.7 (AD-4 as amended): Replace Member by a Personal Assignment of the
 * replacement (0081's `resolve_with_personal_assignment`), for a collision over
 * a Personal Shift, with a team or none. 21.13's floater suggestion and 21.14's
 * whole-leave cover write this form too.
 */
export const REPLACE_BY_ASSIGNMENT = 'assignment';

export type ReplaceForm = typeof REPLACE_BY_OVERRIDE | typeof REPLACE_BY_ASSIGNMENT;

/**
 * The one dispatch of a replacement's write (story 21.7): by assignment for
 * the second form, and always for a key with no team (an override needs a
 * team); else by 0032's override, naming the team. STORY 21.13 (R16.3): a
 * suggested floater (`replacementId` among `view.suggestions`) is always
 * covered by assignment, counted with the conflict's team, a team rotation
 * shift's too; any other pick keeps the conflict's form.
 */
export function replaceWriteOf(
  view: Pick<ResolutionView, 'replaceForm' | 'teamId'> & { readonly suggestions: readonly { readonly id: string }[] },
  replacementId: string | null = null,
): { readonly form: typeof REPLACE_BY_ASSIGNMENT } | { readonly form: typeof REPLACE_BY_OVERRIDE; readonly teamId: string } {
  const suggested = replacementId !== null && view.suggestions.some((candidate) => candidate.id === replacementId);

  return suggested || view.replaceForm === REPLACE_BY_ASSIGNMENT || view.teamId === null
    ? { form: REPLACE_BY_ASSIGNMENT }
    : { form: REPLACE_BY_OVERRIDE, teamId: view.teamId };
}

/** An adjacent conflict, for ‹ and ›: where it goes, and the date its label names. */
export interface ResolutionLink extends ResolutionParams {
  /** `01.10.` */
  readonly dayMonth: string;
}

/** A duration as `t()` renders it: `12 h`. */
export interface ResolutionHours {
  readonly key: ReturnType<typeof durationMessageKey>;
  readonly values: DurationValues;
}

/** A leave request approved on its decision screen (story 9.4), as the queue's status line names it. */
export const LEAVE_REQUEST_APPROVED_SAVED = 'leave_request_approved';
/** A leave request rejected on its decision screen (story 9.4). */
export const LEAVE_REQUEST_REJECTED_SAVED = 'leave_request_rejected';

/** The two request decisions the queue's status line can name (story 9.4). */
export type LeaveRequestSavedKind = typeof LEAVE_REQUEST_APPROVED_SAVED | typeof LEAVE_REQUEST_REJECTED_SAVED;

/** A swap approved on its decision screen (story 12.4), as the queue's status line names it. */
export const SWAP_APPROVED_SAVED = 'swap_approved';
/** A swap rejected on its decision screen (story 12.4). */
export const SWAP_REJECTED_SAVED = 'swap_rejected';

/** The two swap decisions the queue's status line can name (story 12.4). */
export type SwapSavedKind = typeof SWAP_APPROVED_SAVED | typeof SWAP_REJECTED_SAVED;

/**
 * The outcomes a landed decision can name on the queue: stories 5.4b and
 * 5.4c, since story 9.4 a leave request's approval and rejection, and since
 * story 12.4 a swap's.
 */
export type ResolutionSavedKind =
  | typeof ACCEPT_UNCOVERED
  | typeof REPLACE_MEMBER
  | LeaveRequestSavedKind
  | SwapSavedKind
  | typeof LEAVE_COVER_SAVED;

/** STORY 21.14: a whole leave covered by one floater (R16.4). */
export const LEAVE_COVER_SAVED = 'leave_cover';

/** What every landed decision names on the queue: the shift, the date and the member, as shown. */
interface ResolutionSavedFacts {
  readonly shiftTypeName: string;
  /** `null` with no team (story 21.7): the line says *bez tima*. */
  readonly teamName: string | null;
  readonly dateShown: string;
  readonly memberName: string;
}

/**
 * What a landed decision names on the queue (stories 5.4b, 5.4c): the
 * outcome and the facts, and for a replacement the replacement's name.
 */
export type ResolutionSaved =
  | (ResolutionSavedFacts & { readonly kind: typeof ACCEPT_UNCOVERED })
  | (ResolutionSavedFacts & { readonly kind: typeof REPLACE_MEMBER; readonly replacementName: string })
  | LeaveRequestSaved
  | SwapSaved
  | LeaveCoverSaved;

/**
 * A whole leave covered in one action (story 21.14), in the same slot: the
 * absent member, the floater, and how many dates the one call covered.
 */
export interface LeaveCoverSaved {
  readonly kind: typeof LEAVE_COVER_SAVED;
  readonly memberName: string;
  readonly replacementName: string;
  readonly days: number;
}

/**
 * A leave request decided on its own screen (story 9.4), in the same slot:
 * the outcome, the member's name, and the range as shown (`05.10.2026`).
 */
export interface LeaveRequestSaved {
  readonly kind: LeaveRequestSavedKind;
  readonly memberName: string;
  readonly from: string;
  readonly to: string;
}

/**
 * A swap decided on its own screen (story 12.4), in the same slot: the
 * outcome, both members' names, and the earlier of its dates as shown,
 * (`12.09.2026`).
 */
export interface SwapSaved {
  readonly kind: SwapSavedKind;
  readonly proposerName: string;
  readonly addresseeName: string;
  readonly date: string;
}

// THE DATE RULE lives beside the leave card that re-applies it on arrival (story 5.4d).
export {
  AMEND_ENDS,
  AMEND_REMOVES,
  AMEND_STARTS,
  amendTargetOf,
  type ResolutionAmendKind,
  type ResolutionAmendTarget,
} from '@/features/leave/services/leave-section';

/**
 * The days before the conflict that rule A's later start drops (D726): the
 * record's first day to the day before the conflict, which the third card
 * names in one non-blocking line, and whether any of them is already past —
 * the amend rewrites those too.
 */
export interface ResolutionAmendDropped {
  /** How many calendar days are dropped before the conflict's date. */
  readonly days: number;
  /** `01.10.`, or `01.10.–02.10.` for more than one day. */
  readonly rangeShown: string;
  /** Whether the dropped run starts before today. */
  readonly past: boolean;
}

/** The third card's figures (story 5.4d): the target, the date it names, and the balance once it is saved. */
/**
 * The amend card's balance change (story 13.2b): what it gives back, or
 * *bez promjene*, as the other cards say it, when it gives back nothing — a
 * record of a type that does not draw the allowance. Never "+0 dana".
 */
export function amendBalanceChangeMessageKey(
  gainedDays: number,
): 'zaOdluku.resolution.balanceGained' | 'zaOdluku.resolution.balanceUnchanged' {
  return gainedDays === 0 ? 'zaOdluku.resolution.balanceUnchanged' : 'zaOdluku.resolution.balanceGained';
}

export interface ResolutionAmend {
  readonly target: ResolutionAmendTarget;
  /** `03.10.`, the date the card and the hint name: the new start or the new end; `null` for a removal. */
  readonly dateShown: string | null;
  /** The balance after it, in the conflict date's leave year. */
  readonly balanceDays: number;
  /** What it gives back: the balance after it less the balance now. */
  readonly gainedDays: number;
  /** The days before the conflict a later start drops; `null` when it drops none but the conflict's own. */
  readonly dropped: ResolutionAmendDropped | null;
}

/**
 * What rule A drops before the conflict's `date` (D726): under a later start
 * every day from the record's `from` to `date − 1` goes with the conflict's
 * own; an earlier end or a removal drops nothing before it. `today` says
 * whether the run reaches into the past.
 */
export function resolutionAmendDroppedOf(
  record: { readonly from: string; readonly to: string },
  date: string,
  target: ResolutionAmendTarget,
  today: string,
): ResolutionAmendDropped | null {
  if (target.kind !== AMEND_STARTS || record.from >= date) return null;

  const last = previousIsoDate(date);

  if (last === null) return null;

  return {
    days: daysBetween(record.from, last) + 1,
    rangeShown: record.from === last ? dayMonthOf(last) : `${dayMonthOf(record.from)}–${dayMonthOf(last)}`,
    past: record.from < today,
  };
}

/**
 * The third card's figures for `record` and the conflict's `date`, over the
 * member's balance input. Both balances are the conflict date's leave year,
 * as the other cards'; the amend's is `leavePreviewStateOf`'s, against every
 * record but this one, and a removal's is the balance without it.
 *
 * @throws RangeError on {@link amendTargetOf}'s, or when the domain will not cost the new range.
 */
export function resolutionAmendOf(input: LeaveRecordsInput, record: LeaveRecord, date: string): ResolutionAmend {
  const target = amendTargetOf(record, date);
  const inYear = { ...input, today: date };
  const before = leaveBalanceOf(inYear).balanceDays;
  let after: number;

  if (target.kind === AMEND_REMOVES) {
    after = leaveBalanceOf({ ...inYear, records: input.records.filter((one) => one.id !== record.id) }).balanceDays;
  } else {
    // The hand-off amends the dates alone: the record keeps its own type (story 13.2b).
    const type = { id: record.absenceTypeId, drawsAllowance: record.drawsAllowance };
    const preview = leavePreviewStateOf(inYear, target.range.from, target.range.to, type, record);

    if (preview.kind !== LEAVE_PREVIEW_READY) throw new RangeError(`the amend of ${record.id} cannot be costed: ${preview.reason}`);

    after = preview.preview.balanceAfterDays;
  }

  return {
    target,
    dateShown:
      target.kind === AMEND_STARTS
        ? dayMonthOf(target.range.from)
        : target.kind === AMEND_ENDS
          ? dayMonthOf(target.range.to)
          : null,
    balanceDays: after,
    gainedDays: after - before,
    dropped: resolutionAmendDroppedOf(record, date, target, input.today),
  };
}

/**
 * The three cards' coverage against the minimum (story 11.2). Never partial:
 * either every figure is known, or the whole is `null` and every card keeps
 * the shipped term, so the two formats never mix on one screen.
 */
export interface ResolutionStaffing {
  readonly accept: CoverageAgainstMinimum;
  /** The replace card before a pick: someone not on leave put on. */
  readonly replace: CoverageAgainstMinimum;
  /** The replace card once a candidate is picked, by their id: their own after, on leave or not. */
  readonly replaceBy: Readonly<Record<string, CoverageAgainstMinimum>>;
  readonly amend: CoverageAgainstMinimum;
}

/** The id the replace card's after puts on the shift before a pick: no member's, so on no leave and active. */
export const STAFFING_REPLACEMENT_ID = 'staffing-replacement';

/**
 * The replace card's figure with `memberInId` put on in the absent member's
 * place: the roster change the replacement writes, as the calendar's erasure
 * "after" builds it (`rosterChangeSnapshotOf`), through the domain's
 * `peopleAtWorkOn`. A candidate on leave that day is not counted — the
 * domain subtracts them. `null` for a change the write would refuse, or on a
 * `RangeError` (logged).
 */
function replacedCoverageOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  collision: Collision & { readonly teamId: string },
  memberInId: string,
): CoverageAgainstMinimum | null {
  try {
    const replaced = rosterChangeSnapshotOf(snapshot, {
      kind: ROSTER_CHANGE_SAVE,
      teamId: collision.teamId,
      date: collision.date,
      memberOutId: collision.memberId,
      memberInId,
    });

    return replaced.ok ? coverageAgainstMinimumOf(replaced.after, records, collision.teamId, collision.date, collision.shiftTypeId) : null;
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(cause);

    return null;
  }
}

/** The id of the assignment the replace card's after gives the cover (no live row's). */
export const STAFFING_ASSIGNMENT_ID = 'staffing-assignment';

/**
 * STORY 21.20 (the 21.7 deferral): the replace card's figure for a Personal
 * Shift's conflict, with `memberInId` given the assignment the cover writes —
 * a `SHIFT` of the collision's type counted with its team that date (R14.3),
 * in place of any assignment they hold that date — through the domain's
 * `peopleAtWorkOn` of that type (the team's Scheduled Shift, or its staffing
 * group, R14.6). Before a pick, a placeholder member holding only that
 * assignment: no member's id, so on no leave, active, on no base roster. A
 * candidate on leave that day is not counted. `null` on a `RangeError`
 * (logged).
 */
function assignedCoverageOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  collision: Collision & { readonly teamId: string },
  memberInId: string,
): CoverageAgainstMinimum | null {
  try {
    const assignment = {
      id: STAFFING_ASSIGNMENT_ID,
      date: collision.date,
      kind: PERSONAL_ASSIGNMENT_SHIFT,
      shiftTypeId: collision.shiftTypeId,
      teamId: collision.teamId,
    } as const;
    const known = snapshot.members.some((one) => one.id === memberInId);
    const members = known
      ? snapshot.members.map((one) =>
          one.id === memberInId
            ? { ...one, personalAssignments: [...one.personalAssignments.filter((held) => held.date !== collision.date), assignment] }
            : one,
        )
      : [
          ...snapshot.members,
          {
            id: memberInId,
            name: memberInId,
            fireRank: null,
            jobRole: null,
            memberships: [],
            statuses: [],
            loans: [],
            personalAssignments: [assignment],
            scheduleVersions: [],
          },
        ];

    return coverageAgainstMinimumOf({ ...snapshot, members }, records, collision.teamId, collision.date, collision.shiftTypeId);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(cause);

    return null;
  }
}

/**
 * {@link ResolutionStaffing} for `collision` over the organization's
 * `records`, or `null` while the minimum is empty — and `null` too when any
 * one figure cannot be derived (a refused change, a `RangeError`, a shift that
 * is not working), so every card falls back to the shipped term together.
 * Every figure is the domain's, over each option's own after: accept leaves
 * the day as read; replace puts someone on in the absent member's place — a
 * placeholder before a pick, and each candidate in `candidateIds` once picked;
 * amend is the records with this one's range amended, or without it.
 *
 * STORY 21.20: `form` {@link REPLACE_BY_ASSIGNMENT}, a Personal Shift's
 * conflict counted with a team: replace is the cover's assignment
 * ({@link assignedCoverageOf}) rather than a roster change, and every figure
 * is the team's shift of the collision's type against the team's own minimum
 * or the organization's.
 */
export function resolutionStaffingOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  collision: Collision & { readonly teamId: string },
  record: LeaveRecord,
  target: ResolutionAmendTarget,
  candidateIds: readonly string[] = [],
  form: ReplaceForm = REPLACE_BY_OVERRIDE,
  /** STORY 21.13: the suggested floaters, whose cover is an assignment whatever `form` is (R16.3). */
  assignedIds: readonly string[] = [],
): ResolutionStaffing | null {
  if (!staffingAppliesOf(snapshot)) return null;

  const replacedOf = form === REPLACE_BY_ASSIGNMENT ? assignedCoverageOf : replacedCoverageOf;
  const accept = coverageAgainstMinimumOf(snapshot, records, collision.teamId, collision.date, collision.shiftTypeId);
  const replace = replacedOf(snapshot, records, collision, STAFFING_REPLACEMENT_ID);
  const others = records.filter((one) => one.id !== record.id);
  const amended =
    target.kind === AMEND_REMOVES
      ? others
      : [...others, { id: record.id, memberId: collision.memberId, from: target.range.from, to: target.range.to }];
  const amend = coverageAgainstMinimumOf(snapshot, amended, collision.teamId, collision.date, collision.shiftTypeId);

  if (accept === null || replace === null || amend === null) return null;

  const replaceBy: Record<string, CoverageAgainstMinimum> = {};

  for (const id of candidateIds) {
    const figure = replacedOf(snapshot, records, collision, id);

    if (figure === null) return null;

    replaceBy[id] = figure;
  }

  // A suggested floater whose figure cannot be derived keeps the card's
  // placeholder figure: only that entry is skipped, never the whole block.
  for (const id of assignedIds) {
    const figure = assignedCoverageOf(snapshot, records, collision, id);

    if (figure !== null) replaceBy[id] = figure;
  }

  return { accept, replace, replaceBy, amend };
}

/** A key held by a replacement's roster override (story 5.5d): removed in the calendar. */
export const HELD_BY_OVERRIDE = 'override';
/** A key held by a cover's Personal Assignment (story 21.13): removed in *Ručni raspored*. */
export const HELD_BY_ASSIGNMENT = 'assignment';

/** *Ručni raspored*'s search for one cell: the month, the person and the date (its route's `mjesec`, `osoba`, `dan`). */
export type HeldManualSearch = ManualSearch & { readonly mjesec: string; readonly dan: string };

export type ResolutionHeldBy =
  | { readonly kind: typeof HELD_BY_OVERRIDE }
  | { readonly kind: typeof HELD_BY_ASSIGNMENT; readonly manual: HeldManualSearch };

/** STORY 21.14: a superseded decision's cover who still holds its shift: who, the date, and where to remove it. */
export interface ResolutionSupersededCover {
  /** The cover's assignment: the line's stable identity. */
  readonly key: string;
  readonly name: string;
  /** `02.10.`, as `dayMonthOf` writes it. */
  readonly date: string;
  readonly manual: HeldManualSearch;
}

/** The screen, ready to render. */
export interface ResolutionView {
  readonly key: string;
  /** How many unresolved conflicts there are: the N of `K od N`. */
  readonly collisionCount: number;
  /**
   * The queue's own count (story 9.5) — conflicts and pending requests, from
   * the queue model (`queueCountOf`) — as the way back names it; null while
   * the queue would not state one (a skew, or a refused queue) or while the
   * request read is not usable (retro 8–9 item 18): the way back then names
   * no number, and the screen stands regardless.
   */
  readonly queueCount: number | null;
  /** This conflict's place in the queue's order, from 1. */
  readonly position: number;
  readonly previous: ResolutionLink | null;
  readonly next: ResolutionLink | null;
  readonly shiftTypeName: string;
  /** `07:00–19:00`, or `null` for a working type with no times on the date. */
  readonly times: string | null;
  /** `null` with no team (story 21.7): the facts say *bez tima*. */
  readonly teamName: string | null;
  /** `četvrtak 10.09.2026`: the day detail's own wording. */
  readonly dateShown: string;
  readonly memberName: string;
  /** The rank's label key, or `null` when none is shown. */
  readonly rankKey: ReturnType<typeof rosterRankMessageKey>;
  /** The position's label key, or `null` when none is shown. */
  readonly positionKey: ReturnType<typeof rosterPositionMessageKey>;
  /** The causing record's range, as the member's leave card writes it. */
  readonly leaveFrom: string;
  readonly leaveTo: string;
  /** STORY 13.7: the causing record's half when it is a half day, or null for a whole day. */
  readonly leaveHalf: LeaveHalf | null;
  /** What that record costs, in days. */
  readonly leaveCostDays: number;
  /**
   * The team's other members who work that day: the roster less every member
   * on live leave (a half day is at work, story 13.5) and less the absent
   * member, by name.
   */
  readonly coworkers: readonly string[];
  /** The roster on that date. */
  readonly total: number;
  /**
   * The roster less every member on live leave that date, as staffing counts
   * it (R10.1): a member on a half day — the absent member's own included —
   * counts at work.
   */
  readonly covered: number;
  /** The shift's duration, as the hours the third card has the absent member work; `null` when the shift has no times. */
  readonly shiftHours: ResolutionHours | null;
  /**
   * The conflict's date as leave, in days: what *Godišnji* charges for it
   * (`leaveRangeCostOf` over the one date, 0.5 for a half day), the first two cards’ leave term.
   */
  readonly leaveDays: number;
  /** The absent member's balance in the leave year that holds the conflict's date, which neither outcome changes. */
  readonly balanceDays: number;
  /**
   * Who may be put on the shift (story 5.4c): the three groups, in their fixed
   * order, each by name — less the suggested floaters (story 21.13), listed
   * once, first, in {@link ResolutionView.suggestions}.
   */
  readonly candidates: readonly CandidateGroup[];
  /**
   * STORY 21.13 (R16.2): *Predložene zamjene*, the floaters suggested, in the
   * domain's order, each with their shifts in the month; empty with no
   * floater in the organization, or none free.
   */
  readonly suggestions: readonly SuggestedCandidate[];
  /**
   * STORY 21.13: the none line, when the organization has a floater and none
   * is suggested — `Nema slobodne zamjene za posao {posao}.` with the absent
   * member's role, or with none (`roleName: null`). `null` with a suggestion,
   * or with no floater at all (no block).
   */
  readonly noSuggestion: { readonly roleName: string | null } | null;
  /** Whether rank and position are shown beside a candidate: where the organization uses them. */
  readonly rankShown: boolean;
  readonly positionShown: boolean;
  /** The coverage once someone is put on in the absent member's place: the coworkers + 1. */
  readonly replaceCovered: number;
  /** `02.10.`, the conflict's date as the third card's sentence names it (story 5.4d). */
  readonly dayMonth: string;
  /** The causing record, which the third card hands to the member page. */
  readonly leaveRecordId: string;
  /** The third card's target and figures (story 5.4d). */
  readonly amend: ResolutionAmend;
  /**
   * Each card's coverage against Minimum Members (story 11.2): the people at
   * work over that option's own after — as read (accept), with a replacement
   * on (replace), with the amended range (amend) — from the domain's
   * `peopleAtWorkOn`. `null` while the setting is empty: the strips stay as
   * shipped. A card whose figure cannot be derived is `null` too.
   */
  readonly staffing: ResolutionStaffing | null;
  /**
   * Whether a live resolution still holds this conflict's key although it is
   * unresolved (story 5.5d): a replacement whose override no longer applies.
   * The screen says to remove the override in the calendar and decide again;
   * a save refused on the key says the same.
   */
  readonly held: boolean;
  /** Where the held line's "Ukloni je u kalendaru" goes: the grid on the conflict's month, narrowed to its team. */
  readonly heldCalendar: CalendarSearch;
  /**
   * STORY 21.13 (the 21.7 deferral): what holds the key while `held` — a
   * roster override (the calendar link, `heldCalendar`) or a cover's
   * assignment, removed in *Ručni raspored* on the cover's month, person and
   * date. `null` while nothing holds it.
   */
  readonly heldBy: ResolutionHeldBy | null;
  /**
   * STORY 21.14 (R16.4): whether *Pokrij cijelo odsustvo* is offered — some
   * floater is eligible for the absent member's role and is not them (the
   * record always has this unresolved conflict). False: the screen is as
   * 21.13 left it.
   */
  readonly leaveCover: boolean;
  /**
   * STORY 21.14 (the 21.7 deferral): each cover a decision on this key made on
   * another shift type (0038) left with its shift, by name; empty for none.
   */
  readonly supersededCovers: readonly ResolutionSupersededCover[];
  /** The insert's columns: the organization and the key. */
  readonly organizationId: string;
  /** The shift type the conflict is on, as derived: stored with the decision (0038). */
  readonly shiftTypeId: string;
  /**
   * STORY 21.7: how Replace Member is written for this conflict — by a roster
   * override for a team's rotation shift, by an assignment for a Personal
   * Shift (with a team or none). The candidates follow it.
   */
  readonly replaceForm: ReplaceForm;
  /** The team the key and an assignment's cover count with: `null` for none (story 21.7). */
  readonly teamId: string | null;
  /** What the queue's status line names once an acceptance lands; a replacement adds its name ({@link replacedSavedOf}). */
  readonly saved: Extract<ResolutionSaved, { readonly kind: typeof ACCEPT_UNCOVERED }>;
}

export type ResolutionScreen =
  | { readonly kind: typeof RESOLUTION_LOADING }
  | { readonly kind: typeof RESOLUTION_UNAVAILABLE }
  /** The queue's own count, as the way back names it, or null when the queue would not state one (story 9.5). */
  | { readonly kind: typeof RESOLUTION_MISSING; readonly queueCount: number | null }
  | { readonly kind: typeof RESOLUTION_READY; readonly view: ResolutionView };

/**
 * The screen's reads: the five it stands on — the queue's calendar, records
 * and resolutions, and the member card's two for the balance — and the
 * request read, which only the back link's count stands on (retro 8–9
 * item 18).
 */
export interface ResolutionSources {
  readonly calendar: CalendarSurfaceState;
  readonly records: LeaveRowsAnswer;
  readonly resolutions: LeaveRowsAnswer;
  /**
   * The organization's leave requests (story 9.5): the pending ones join the
   * back link's count. Never the screen's: failed, paused, uncached or
   * pending, the screen stands and the back link names no number.
   */
  readonly requests: LeaveRowsAnswer;
  /**
   * The organization's swaps (story 12.4): the accepted, open ones join the
   * back link's count, on the request read's terms — never the screen's.
   */
  readonly swaps: LeaveRowsAnswer;
  /** The member list: the allowance, and (story 21.13) who is a floater, covering which roles. */
  readonly members: ResolutionMembersSource;
  /** The organization snapshot: where the leave year begins. */
  readonly organization: LeaveOrganizationSource;
  /** Whether a failed read is being read again ({@link refetchingAfterFailure}): loading, never the alert. */
  readonly refetching?: boolean;
}

/**
 * One member of the list as the screen reads them: the allowance, and the
 * floater fields (story 21.13), which the list's parser always sets.
 */
export interface ResolutionMember {
  readonly id: string;
  readonly leaveAllowance: LeaveAllowance;
  readonly isFloater: boolean;
  readonly floaterRoleIds: readonly string[];
}

/** The member list's state, as the leave card's, over {@link ResolutionMember} rows. */
export interface ResolutionMembersSource extends Omit<LeaveMembersSource, 'members'> {
  readonly members: readonly ResolutionMember[] | null;
}

/** TanStack Query's names for a fetch in flight, and one it has not started (offline). */
const FETCH_FETCHING = 'fetching';
const FETCH_PAUSED = 'paused';

/** Whether the member list failed, is paused offline, or settled with nothing: the balance's allowance. */
function membersReadFailed(members: ResolutionMembersSource): boolean {
  return members.paused || (!members.loading && (members.refusal !== null || members.members === null));
}

/** Whether the organization snapshot failed, is paused offline, or settled with nothing: the balance's leave year. */
function organizationReadFailed(organization: LeaveOrganizationSource): boolean {
  return (
    organization.fetchStatus === FETCH_PAUSED ||
    (!organization.isPending && (organization.isError || organization.data === undefined || !organization.data.ok))
  );
}

/** A read as far as its retry is seen: whether it failed, and whether it is fetching. */
export interface ResolutionReadState {
  readonly isError: boolean;
  readonly fetchStatus: string;
}

/**
 * Whether any read failed and is being read again: the screen's loading, so
 * the retry is seen to work rather than the alert standing unchanged.
 */
export function refetchingAfterFailure(reads: readonly ResolutionReadState[]): boolean {
  return reads.some((read) => read.isError && read.fetchStatus === FETCH_FETCHING);
}

/** An adjacent conflict's link. */
function linkOf(collision: Collision | undefined): ResolutionLink | null {
  if (collision === undefined) return null;

  return {
    memberId: collision.memberId,
    date: collision.date,
    teamId: collision.teamId,
    dayMonth: dayMonthOf(collision.date),
  };
}

/**
 * Whether a live record of `memberId` takes them off work on `date`: it
 * covers the date and is no half day — a member on a half day counts at work,
 * as staffing counts them (R10.1, story 13.5).
 */
function onLeave(records: readonly OrganizationLeaveRecord[], memberId: string, date: string): boolean {
  return records.some((record) => record.memberId === memberId && !isHalfDay(record) && record.from <= date && date <= record.to);
}

/**
 * The shift's duration on its date, in minutes, or `null` for a working type
 * with no version in effect.
 *
 * @throws RangeError for a type the snapshot lacks.
 */
function shiftMinutesOf(snapshot: CalendarSnapshot, collision: Collision): number | null {
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

  const version = shiftTypeVersionOn(type.versions, collision.date);

  return version === null ? null : deriveShiftTimes(version.startMinute, version.endMinute).durationMinutes;
}

/**
 * Everyone whose own Personal Shift on the collision's date is of its type and
 * counts with its team (none for `null`), in the snapshot's order (story 21.7).
 *
 * @throws RangeError on any precondition of `personalShiftOn`.
 */
function personalRosterOf(
  snapshot: CalendarSnapshot,
  context: ReturnType<typeof replacementContextOf>,
  collision: Collision,
): readonly Pick<DayDetailMember, 'id' | 'name' | 'position'>[] {
  return snapshot.members
    .filter(
      (member) => personalShiftCountedWith(context, member.id, collision.teamId, collision.date)?.shiftTypeId === collision.shiftTypeId,
    )
    .map((member) => ({ id: member.id, name: member.name, position: effectiveTeamOn(member, collision.date)?.position ?? null }));
}

/** The shift a conflict is on, as the screen states it (story 21.7). */
interface CollisionShift {
  readonly replaceForm: ReplaceForm;
  /** Everyone on that shift that day, the absent member included. */
  readonly roster: readonly Pick<DayDetailMember, 'id' | 'name' | 'position'>[];
  readonly teamName: string | null;
  readonly dateShown: string;
  readonly typeName: string | null;
  readonly range: string | null;
}

/**
 * THE SHIFT A CONFLICT IS ON (story 21.7). A team's rotation shift is the
 * team's day detail, as before: its roster, name, wording and times, replaced
 * by an override. A PERSONAL SHIFT (the absent member's own shift that date,
 * of the collision's type, counted with its team or none) is replaced by an
 * assignment, and its roster is everyone whose own shift that date is of that
 * type and counts with the same team: the day detail's roster when the
 * member is on it, else its staffing group of the type, and for no team every
 * such member, in the snapshot's order.
 *
 * @throws RangeError for a team the snapshot lacks, or on any precondition of the derivation.
 */
function shiftOfCollision(snapshot: CalendarSnapshot, collision: Collision): CollisionShift {
  const context = replacementContextOf(snapshot);
  const own = personalShiftCountedWith(context, collision.memberId, collision.teamId, collision.date);
  const personal = own !== null && own.shiftTypeId === collision.shiftTypeId;
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

  if (collision.teamId !== null) {
    const detail = dayDetailOf(snapshot, collision.teamId, collision.date);

    if (detail === null) throw new RangeError(`team ${collision.teamId} is not in the snapshot`);

    const onRoster = detail.roster.some((one) => one.id === collision.memberId);
    const group = detail.groups?.find((one) => one.shiftTypeId === collision.shiftTypeId);
    const own = personal && !onRoster;

    return {
      replaceForm: personal ? REPLACE_BY_ASSIGNMENT : REPLACE_BY_OVERRIDE,
      // A Personal Shift off the team's roster: its staffing group, else everyone whose own shift is that one.
      roster: !own ? detail.roster : (group?.roster ?? personalRosterOf(snapshot, context, collision)),
      teamName: detail.teamName,
      dateShown: detail.date,
      typeName: own ? type.name : detail.typeName,
      range: own ? typeRangeOn(type, collision.date) : detail.range,
    };
  }

  const full = formatIsoDate(collision.date);

  if (full === null) throw new RangeError(`the date ${collision.date} could not be formatted`);

  return {
    replaceForm: REPLACE_BY_ASSIGNMENT,
    roster: personalRosterOf(snapshot, context, collision),
    teamName: null,
    dateShown: `${weekdayOf(collision.date)} ${full}`,
    typeName: type.name,
    range: typeRangeOn(type, collision.date),
  };
}

/**
 * STORY 21.13: the floater suggestions, or `null` (no block) when deriving
 * them breaks a precondition: a bad floater row is logged and never makes the
 * whole screen unavailable — the suggestions only inform.
 */
function suggestionsOrNone<T>(derive: () => T | null): T | null {
  try {
    return derive();
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error('floater suggestions', cause);

    return null;
  }
}

/**
 * The conflict among the unresolved, in the queue's order, with its
 * neighbours — or `null` when it is not among them.
 *
 * @throws RangeError when a row cannot be trusted, or on any precondition of
 *   `collisionsOf`.
 */
export function resolutionPlaceOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
  params: ResolutionParams,
  today: string,
): {
  readonly ordered: readonly Collision[];
  readonly index: number;
} {
  const ordered = queueOrderOf(unresolvedOf(snapshot, records, resolutionRows), today);
  const key = collisionKeyOf(params);

  return { ordered, index: ordered.findIndex((collision) => collisionKeyOf(collision) === key) };
}

/**
 * The screen from its five reads, the route's params and `now`: unavailable
 * when any of them failed or is paused offline — first, so a failure is never
 * hidden behind another's skeleton — loading while the queue's reads are
 * pending; missing once they are in and the conflict is not among the
 * unresolved; loading again while the balance's reads are pending; otherwise
 * the screen. A `RangeError` is logged and is unavailable; nothing else is
 * caught. The request read is never waited on nor refused on: it only
 * decides whether the back link names a count (null while it is not usable).
 */
export function resolutionScreenOf(sources: ResolutionSources, params: ResolutionParams, now: Date): ResolutionScreen {
  const { calendar, records, resolutions, requests, swaps, members, organization } = sources;

  // A failed read being read again is loading, not the refusal (as *Sati*'s
  // `hoursConflictsStateOf`): TanStack Query keeps `isError` while the retry
  // is in flight, so the alert would otherwise stand unchanged under the press.
  if (sources.refetching === true) return { kind: RESOLUTION_LOADING };

  if (
    calendar.refusal !== null ||
    (!calendar.loading && calendar.snapshot === null) ||
    queueReadFailed(records) ||
    queueReadFailed(resolutions) ||
    membersReadFailed(members) ||
    organizationReadFailed(organization)
  ) {
    return { kind: RESOLUTION_UNAVAILABLE };
  }

  const snapshot = calendar.snapshot;
  const rows = records.data;
  const resolutionRows = resolutions.data;
  // The count's own reads: rows only when usable, otherwise null — no number.
  const requestRows = queueReadFailed(requests) || requests.data === undefined ? null : requests.data;
  const swapRows = queueReadFailed(swaps) || swaps.data === undefined ? null : swaps.data;

  if (snapshot === null || rows === undefined || resolutionRows === undefined) {
    return { kind: RESOLUTION_LOADING };
  }

  try {
    return resolutionScreenFrom(sources, snapshot, rows, resolutionRows, requestRows, swapRows, params, now);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(RESOLUTION_UNAVAILABLE, cause);

    return { kind: RESOLUTION_UNAVAILABLE };
  }
}

/**
 * {@link resolutionScreenOf} once the queue's three reads are in; the
 * request rows are null while their read is not usable.
 *
 * @throws RangeError when a row cannot be trusted, on any precondition of the
 *   domain, or when the conflict names a member, team or type the inputs lack.
 */
function resolutionScreenFrom(
  sources: ResolutionSources,
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  requestRows: readonly unknown[] | null,
  swapRows: readonly unknown[] | null,
  params: ResolutionParams,
  now: Date,
): ResolutionScreen {
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const today = calendarTodayOf(snapshot, now);
  const { ordered, index } = resolutionPlaceOf(snapshot, records, resolutionRows, params, today);
  const collision = ordered[index];
  // THE QUEUE'S OWN COUNT, from the queue model itself: the conflicts, the pending requests and the waiting swaps.
  const queueCount = queueCountOf(snapshot, rows, resolutionRows, requestRows, today, swapRows);

  if (collision === undefined) return { kind: RESOLUTION_MISSING, queueCount };

  // The balance, through the member card's own recipe: the member's records
  // here are the organization's read, filtered to them.
  const base = memberLeaveBaseOf(
    {
      members: sources.members,
      calendar: { snapshot, loading: false },
      organization: sources.organization,
      records: {
        records: records
          .filter((record) => record.memberId === collision.memberId)
          .map((one) => leaveRecordFieldsOf(one)),
        loading: false,
        refreshing: false,
      },
    },
    collision.memberId,
    now,
  );

  if (base.kind === LEAVE_LOADING) return { kind: RESOLUTION_LOADING };
  if (base.kind !== LEAVE_READY) throw new RangeError(`the balance of ${collision.memberId} is ${base.kind}`);

  const record = base.rows.find((row) => row.record.id === collision.leaveRecordId);

  if (record === undefined) throw new RangeError(`leave record ${collision.leaveRecordId} was not read`);

  const member = snapshot.members.find((one) => one.id === collision.memberId);
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);

  if (member === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);
  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

  const shift = shiftOfCollision(snapshot, collision);
  const absent = shift.roster.find((one) => one.id === collision.memberId);

  // A collision is a shift the member is rostered on (R6.1): one the day's
  // roster does not hold is a derivation that disagrees with itself.
  if (absent === undefined) {
    throw new RangeError(`member ${collision.memberId} is not on the roster of ${collision.teamId ?? 'no team'} on ${collision.date}`);
  }

  // ONE LIST for the coverage and the names: the roster less every member on
  // live leave, a member on a half day counting at work (R10.1, story 13.5).
  // The names leave out the absent member, who is the screen's subject.
  const working = shift.roster.filter((one) => !onLeave(records, one.id, collision.date));
  const coworkers = working.filter((one) => one.id !== collision.memberId).map((one) => {
    if (one.name === null) throw new RangeError(`member ${one.id} is rostered but has no name in the snapshot`);

    return one.name;
  });
  const minutes = shiftMinutesOf(snapshot, collision);
  const teamId = collision.teamId;
  const byAssignment = shift.replaceForm === REPLACE_BY_ASSIGNMENT || teamId === null;
  const assignmentGroups = assignmentCandidatesOf(snapshot, records, collision.memberId, teamId, collision.date, collision.shiftTypeId);
  const groups = byAssignment
    ? assignmentGroups
    : replacementCandidatesOf(snapshot, records, teamId, collision.date, collision.shiftTypeId);
  // STORY 21.13: the floaters suggested, narrowed to whoever a cover by assignment may write (R16.2, R16.3).
  const floaters = suggestionsOrNone(() =>
    floaterSuggestionsOfConflict(snapshot, records, sources.members.members ?? [], collision, assignmentGroups),
  );
  const suggestions = floaters?.suggested ?? [];
  const candidates = groupsLessSuggested(groups, suggestions);
  const range = leaveRangeValuesOf(record.record);
  const dateShown = shift.dateShown;
  const typeName = shift.typeName ?? type.name;
  const key = collisionKeyOf(collision);
  const amend = resolutionAmendOf(base.input, record.record, collision.date);
  // Unresolved, yet a live row holds this key: a replacement the snapshot holds pending or inert.
  const holder = liveResolutionsOf(snapshot, resolutionRows).find(
    (resolution) => collisionKeyOf(resolution) === key && heldByReplacement(snapshot, resolution),
  );
  const held = holder !== undefined;
  const heldBy = holder === undefined ? null : heldByOf(snapshot, holder.personalAssignmentId, collision.date);
  // STORY 21.14: a decision on another type (0038) whose cover still holds that shift.
  const supersededCovers = liveResolutionsOf(snapshot, resolutionRows)
    // The key's holder is the held line's, never named twice.
    .filter((resolution) => collisionKeyOf(resolution) === key && (holder === undefined || holder.personalAssignmentId !== resolution.personalAssignmentId))
    .flatMap((resolution): ResolutionSupersededCover[] => {
      const cover = supersededCoverOf(snapshot, resolution);

      return cover === null || resolution.personalAssignmentId === null
        ? []
        : [
            {
              key: resolution.personalAssignmentId,
              name: cover.name,
              date: dayMonthOf(resolution.date),
              manual: { mjesec: resolution.date.slice(0, 7), osoba: cover.id, dan: resolution.date },
            },
          ];
    });

  return {
    kind: RESOLUTION_READY,
    view: {
      key,
      collisionCount: ordered.length,
      queueCount,
      position: index + 1,
      previous: linkOf(ordered[index - 1]),
      next: linkOf(ordered[index + 1]),
      shiftTypeName: typeName,
      times: shift.range,
      teamName: shift.teamName,
      dateShown,
      memberName: member.name,
      rankKey: rosterRankMessageKey(member.fireRank, ranksShown(snapshot)),
      positionKey: rosterPositionMessageKey(absent.position, positionsShown(snapshot)),
      leaveFrom: range.from,
      leaveTo: range.to,
      leaveHalf: record.record.half ?? null,
      leaveCostDays: record.costDays,
      coworkers,
      total: shift.roster.length,
      covered: working.length,
      shiftHours: minutes === null ? null : { key: durationMessageKey(minutes), values: durationValuesOf(minutes) },
      // A half day's date costs 0.5 (story 13.5).
      leaveDays: leaveRangeCostOf(base.input.input, leaveSpanOf({ ...record.record, from: collision.date, to: collision.date })),
      // THE LEAVE YEAR OF THE CONFLICT'S DATE, not today's: the balance the decision is about.
      balanceDays: leaveBalanceOf({ ...base.input, today: collision.date }).balanceDays,
      candidates,
      suggestions,
      noSuggestion: floaters !== null && suggestions.length === 0 ? { roleName: floaters.roleName } : null,
      rankShown: ranksShown(snapshot),
      positionShown: positionsShown(snapshot),
      replaceCovered: coworkers.length + 1,
      dayMonth: dayMonthOf(collision.date),
      leaveRecordId: record.record.id,
      amend,
      // STORY 21.20 (the 21.7 deferral): a Personal Shift counted with a team is held to its team's
      // minimum too, the cover's assignment applied; one with no team has no minimum and keeps the shipped terms.
      staffing:
        teamId === null
          ? null
          : resolutionStaffingOf(
              snapshot,
              records,
              { ...collision, teamId },
              record.record,
              amend.target,
              candidates.flatMap((group) => group.candidates.map((candidate) => candidate.id)),
              byAssignment ? REPLACE_BY_ASSIGNMENT : REPLACE_BY_OVERRIDE,
              suggestions.map((candidate) => candidate.id),
            ),
      held,
      heldCalendar: heldCalendarSearchOf(collision),
      heldBy,
      // STORY 21.14: only with a floater eligible for this member's role, never the member themselves.
      leaveCover: leaveCoverOffered(sources.members.members ?? [], member.id, member.jobRole?.id ?? null),
      supersededCovers,
      organizationId: snapshot.organizationId,
      shiftTypeId: collision.shiftTypeId,
      replaceForm: byAssignment ? REPLACE_BY_ASSIGNMENT : REPLACE_BY_OVERRIDE,
      teamId,
      saved: { kind: ACCEPT_UNCOVERED, shiftTypeName: typeName, teamName: shift.teamName, dateShown, memberName: member.name },
    },
  };
}

/** The key a radio card's coverage term reads through: covered of total (the first card adds the uncovered mark). */
export function coverageMessageKey(): 'zaOdluku.resolution.coverage' {
  return 'zaOdluku.resolution.coverage';
}

/** The facts line: with the shift's times, or without them for an untimed shift. */
export function shiftFactsMessageKey(times: string | null): 'zaOdluku.resolution.shiftTimed' | 'zaOdluku.resolution.shift' {
  return times === null ? 'zaOdluku.resolution.shift' : 'zaOdluku.resolution.shiftTimed';
}

/** Who else works: the names, or the sentence for nobody. */
export function coworkersMessageKey(
  coworkers: readonly string[],
  noTeam = false,
):
  | 'zaOdluku.resolution.coworkers'
  | 'zaOdluku.resolution.noCoworkers'
  | 'zaOdluku.resolution.coworkersNoTeam'
  | 'zaOdluku.resolution.noCoworkersNoTeam' {
  // STORY 21.7: a shift with no team names no team.
  if (noTeam) return coworkers.length === 0 ? 'zaOdluku.resolution.noCoworkersNoTeam' : 'zaOdluku.resolution.coworkersNoTeam';

  return coworkers.length === 0 ? 'zaOdluku.resolution.noCoworkers' : 'zaOdluku.resolution.coworkers';
}

/**
 * The save hint: why Spremi waits — no card, or the second card with nobody
 * picked (story 5.4c), or with nobody to pick at all, which only another
 * outcome can resolve — or what saving does: records the decision, or, on the
 * third card (story 5.4d), opens the leave amend with its date or the
 * record's removal.
 */
export function saveHintMessageKey(
  choice: ResolutionOption | null,
  replacementId: string | null = null,
  candidatesExist = true,
  amendKind: ResolutionAmendKind | null = null,
):
  | 'zaOdluku.resolution.hintChoose'
  | 'zaOdluku.resolution.hintChooseReplacement'
  | 'zaOdluku.resolution.hintNoCandidates'
  | 'zaOdluku.resolution.hintRecorded'
  | 'zaOdluku.resolution.hintAmend'
  | 'zaOdluku.resolution.hintAmendRemove' {
  if (choice === null) return 'zaOdluku.resolution.hintChoose';
  if (choice === OPTION_REPLACE_MEMBER && !candidatesExist) return 'zaOdluku.resolution.hintNoCandidates';
  if (choice === OPTION_REPLACE_MEMBER && replacementId === null) return 'zaOdluku.resolution.hintChooseReplacement';
  if (choice === OPTION_AMEND_LEAVE) {
    return amendKind === AMEND_REMOVES ? 'zaOdluku.resolution.hintAmendRemove' : 'zaOdluku.resolution.hintAmend';
  }

  return 'zaOdluku.resolution.hintRecorded';
}

/**
 * The calendar's search for the held line's link (story 5.5d): *Sve smjene*
 * on the conflict's month, narrowed to its team. The day itself opens from
 * its cell: which day is open is not in the URL (story 3.4b).
 */
export function heldCalendarSearchOf(conflict: { readonly date: string; readonly teamId: string | null }): CalendarSearch {
  // STORY 21.7: a teamless conflict's month, every team shown.
  if (conflict.teamId === null) return { prikaz: MODE_SVE, mjesec: conflict.date.slice(0, 7) };

  return { prikaz: MODE_SVE, mjesec: conflict.date.slice(0, 7), smjena: conflict.teamId };
}

/**
 * What holds a key (story 21.13): a cover's assignment — linking *Ručni
 * raspored* on the conflict's month and date, narrowed to the cover the
 * snapshot names (none when it no longer holds the row) — or else a roster
 * override.
 */
export function heldByOf(snapshot: CalendarSnapshot, personalAssignmentId: string | null, date: string): ResolutionHeldBy {
  if (personalAssignmentId === null) return { kind: HELD_BY_OVERRIDE };

  const cover = snapshot.members.find((member) => member.personalAssignments.some((one) => one.id === personalAssignmentId));

  return {
    kind: HELD_BY_ASSIGNMENT,
    manual: { mjesec: date.slice(0, 7), ...(cover === undefined ? {} : { osoba: cover.id }), dan: date },
  };
}

/** Where the held hint's link goes in its sentence: a character no translation holds. */
const HELD_ACTION_SLOT = '\u0000';

/**
 * The held hint (story 5.5d) split around its link: what `format` — the
 * sentence `zaOdluku.resolution.heldHint` translated with `action` as its
 * slot — says before the link and after it. The link's own words are
 * `zaOdluku.resolution.heldAction`.
 */
export function heldHintPartsOf(format: (action: string) => string): { readonly before: string; readonly after: string } {
  const [before = '', after = ''] = format(HELD_ACTION_SLOT).split(HELD_ACTION_SLOT);

  return { before, after };
}

/**
 * Whether Spremi can save: a card, and for the second one a candidate (story
 * 5.4c); the third at once (story 5.4d). Never while the key is `held` (story
 * 5.5d): saving is known to fail until the replacement is removed.
 */
export function readyToSave(choice: ResolutionOption | null, replacementId: string | null, held = false): boolean {
  if (held || choice === null) return false;
  if (choice === OPTION_REPLACE_MEMBER) return replacementId !== null;

  return true;
}

/** Where Spremi pressed too early sends focus (story 5.4c). */
export const SAVE_FOCUS_CHOICE = 'choice';
export const SAVE_FOCUS_REPLACE = 'replace';
export const SAVE_FOCUS_CANDIDATES = 'candidates';

/**
 * Where focus goes when Spremi is pressed before it can save: the first card
 * while none is chosen; the first candidate while the second card waits for a
 * pick; the second card itself when there is nobody to pick, so the admin
 * can move to another outcome. `null` once it can save.
 */
export function saveFocusOf(
  choice: ResolutionOption | null,
  replacementId: string | null,
  candidatesExist: boolean,
): typeof SAVE_FOCUS_CHOICE | typeof SAVE_FOCUS_REPLACE | typeof SAVE_FOCUS_CANDIDATES | null {
  if (choice === null) return SAVE_FOCUS_CHOICE;
  if (readyToSave(choice, replacementId)) return null;

  return candidatesExist ? SAVE_FOCUS_CANDIDATES : SAVE_FOCUS_REPLACE;
}

/** The candidate of `view` with `id`, in whichever group, or `null` for none — a pick a re-read took away included. */
export function replacementOf(view: ResolutionView, id: string | null): ReplacementCandidate | null {
  if (id === null) return null;

  // STORY 21.13: a suggested floater first, then the groups.
  const suggested = view.suggestions.find((candidate) => candidate.id === id);

  if (suggested !== undefined) return suggested;

  for (const group of view.candidates) {
    const found = group.candidates.find((candidate) => candidate.id === id);

    if (found !== undefined) return found;
  }

  return null;
}

/** The candidate picker's value as a candidate's id, or `null` for nobody. */
export function candidateIdOf(value: string): string | null {
  return value === NO_CANDIDATE ? null : value;
}

/** Whether there is anybody at all to put on the shift. */
export function hasCandidates(view: ResolutionView): boolean {
  return view.suggestions.length > 0 || view.candidates.some((group) => group.candidates.length > 0);
}

/** A suggested floater's line (story 21.13): `{line} · 1 smjena`, with their at-work shifts in the month. */
export function suggestionLineMessageKey(): 'zaOdluku.resolution.suggestionsLine' {
  return 'zaOdluku.resolution.suggestionsLine';
}

/** The none line (story 21.13): with the absent member's role, or with none. */
export function noSuggestionMessageKey(
  roleName: string | null,
): 'zaOdluku.resolution.suggestionsNone' | 'zaOdluku.resolution.suggestionsNoneAny' {
  return roleName === null ? 'zaOdluku.resolution.suggestionsNoneAny' : 'zaOdluku.resolution.suggestionsNone';
}

/** What the queue's status line names once a replacement by `replacementName` lands (story 5.4c). */
export function replacedSavedOf(
  saved: ResolutionView['saved'],
  replacementName: string,
): Extract<ResolutionSaved, { readonly kind: typeof REPLACE_MEMBER }> {
  return { ...saved, kind: REPLACE_MEMBER, replacementName };
}

/** The third card's sentence (story 5.4d), by its target. Exhaustive. */
export function amendBodyMessageKey(
  kind: ResolutionAmendKind,
):
  | 'zaOdluku.resolution.amendBodyStarts'
  | 'zaOdluku.resolution.amendBodyEnds'
  | 'zaOdluku.resolution.amendBodyRemoves' {
  switch (kind) {
    case AMEND_STARTS:
      return 'zaOdluku.resolution.amendBodyStarts';
    case AMEND_ENDS:
      return 'zaOdluku.resolution.amendBodyEnds';
    case AMEND_REMOVES:
      return 'zaOdluku.resolution.amendBodyRemoves';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** The third card's hours term: the duration as work, or the empty mark for an untimed shift. */
export function workHoursMessageKey(
  hours: ResolutionHours | null,
): 'zaOdluku.resolution.hoursAsWork' | 'zaOdluku.resolution.noHours' {
  return hours === null ? 'zaOdluku.resolution.noHours' : 'zaOdluku.resolution.hoursAsWork';
}

/**
 * The router state the third card's Spremi takes to the member page (story
 * 5.4d): the record, the range or its removal, and the conflict it came from.
 * Nothing goes in the URL, and nothing is written.
 */
export function amendHandoffOf(view: ResolutionView, origin: ResolutionParams): LeaveHandoff {
  const from = { memberId: origin.memberId, date: origin.date, teamId: origin.teamId };
  const target = view.amend.target;

  return target.kind === AMEND_REMOVES
    ? { kind: LEAVE_REMOVE_ACTION, recordId: view.leaveRecordId, origin: from }
    : { kind: LEAVE_AMEND_ACTION, recordId: view.leaveRecordId, range: target.range, origin: from };
}

/**
 * The absent member's leave term: the days as leave, `1 dan odsutnosti`, or
 * the empty mark for a date that charges none. A conflict's date charges 0
 * only when the member is inactive on it (R4.2: a leave day needs the member
 * active, with a working shift — and a conflict always has the shift), a
 * state a collision should not reach but the strip still states truthfully.
 */
export function leaveDaysMessageKey(days: number): 'zaOdluku.resolution.daysAsLeave' | 'zaOdluku.resolution.noDays' {
  return days === 0 ? 'zaOdluku.resolution.noDays' : 'zaOdluku.resolution.daysAsLeave';
}

/** The radio group's value as an option, or `null` for anything else. */
export function resolutionOptionOf(value: string): ResolutionOption | null {
  return (RESOLUTION_OPTIONS as readonly string[]).includes(value) ? (value as ResolutionOption) : null;
}

// ---------------------------------------------------------------- the notice

/** The router state a landed decision returns to the queue with. Never the URL, never storage. */
export const RESOLUTION_SAVED_STATE = 'resolutionSaved';

/**
 * The history entry's state with `saved` added under
 * {@link RESOLUTION_SAVED_STATE}, every other field kept — the router's own
 * keys included.
 */
export function withResolutionSaved<State extends object>(state: State, saved: ResolutionSaved): State {
  return { ...state, [RESOLUTION_SAVED_STATE]: saved };
}

/** The history entry's state without the status line's content: what a reload finds. */
export function withoutResolutionSaved(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};

  const { [RESOLUTION_SAVED_STATE]: _saved, ...rest } = state as Record<string, unknown>;

  return rest;
}

/** What the queue's status line does on one location (story 5.4b): what it shows, and whether the entry is cleared. */
export interface ResolutionSavedStep {
  /** The line shown, or `null` for none. */
  readonly shown: ResolutionSaved | null;
  /** Whether to replace the entry with its state less the line's content, through the router. */
  readonly clear: boolean;
  /** Whether the next location is that replace landing, which keeps the line. */
  readonly clearing: boolean;
}

/**
 * THE STATUS LINE PER LOCATION. A location that brings a saved decision
 * shows it and clears it off its entry (so a reload, or Back to it later,
 * finds none); the replace that clearing makes keeps the line; any other
 * location — a navigation to the same route, the Za odluku tab included —
 * drops it.
 */
export function resolutionSavedStepOf(shown: ResolutionSaved | null, state: unknown, clearing: boolean): ResolutionSavedStep {
  const arrived = resolutionSavedOf(state);

  if (arrived !== null) return { shown: arrived, clear: true, clearing: true };
  if (clearing) return { shown, clear: false, clearing: false };

  return { shown: null, clear: false, clearing: false };
}

/** The status line's content from router state as it came back, or `null` for none or anything malformed. */
export function resolutionSavedOf(state: unknown): ResolutionSaved | null {
  if (typeof state !== 'object' || state === null) return null;

  const saved: unknown = (state as Record<string, unknown>)[RESOLUTION_SAVED_STATE];

  if (typeof saved !== 'object' || saved === null) return null;

  const { kind, shiftTypeName, teamName, dateShown, memberName, replacementName, from, to, proposerName, addresseeName, date, days } =
    saved as Record<string, unknown>;
  const filled = (value: unknown): value is string => typeof value === 'string' && value !== '';

  // STORY 9.4: a leave request's decision names the member and the range alone.
  if (kind === LEAVE_REQUEST_APPROVED_SAVED || kind === LEAVE_REQUEST_REJECTED_SAVED) {
    return filled(memberName) && filled(from) && filled(to) ? { kind, memberName, from, to } : null;
  }

  // STORY 21.14: a whole leave's cover names the absent member, the floater and the dates covered.
  if (kind === LEAVE_COVER_SAVED) {
    return filled(memberName) && filled(replacementName) && typeof days === 'number' && Number.isInteger(days) && days > 0
      ? { kind, memberName, replacementName, days }
      : null;
  }

  // STORY 12.4: a swap's decision names both members and the given shift's date.
  if (kind === SWAP_APPROVED_SAVED || kind === SWAP_REJECTED_SAVED) {
    return filled(proposerName) && filled(addresseeName) && filled(date) ? { kind, proposerName, addresseeName, date } : null;
  }

  if (
    typeof shiftTypeName !== 'string' ||
    // STORY 21.7: a teamless conflict's decision names no team (`null`, said *bez tima*).
    (typeof teamName !== 'string' && teamName !== null) ||
    typeof dateShown !== 'string' ||
    typeof memberName !== 'string'
  ) {
    return null;
  }

  if (kind === ACCEPT_UNCOVERED) return { kind, shiftTypeName, teamName, dateShown, memberName };

  if (kind === REPLACE_MEMBER && typeof replacementName === 'string') {
    return { kind, shiftTypeName, teamName, dateShown, memberName, replacementName };
  }

  return null;
}

/** The queue's status line for a landed decision, by its outcome. Exhaustive. */
export function resolutionSavedMessageKey(
  kind: ResolutionSavedKind,
):
  | 'zaOdluku.saved'
  | 'zaOdluku.savedReplace'
  | 'zaOdluku.savedRequestApproved'
  | 'zaOdluku.savedRequestRejected'
  | 'zaOdluku.savedSwapApproved'
  | 'zaOdluku.savedSwapRejected'
  | 'zaOdluku.savedCover' {
  if (kind === ACCEPT_UNCOVERED) return 'zaOdluku.saved';
  if (kind === LEAVE_COVER_SAVED) return 'zaOdluku.savedCover';
  if (kind === REPLACE_MEMBER) return 'zaOdluku.savedReplace';
  if (kind === LEAVE_REQUEST_APPROVED_SAVED) return 'zaOdluku.savedRequestApproved';
  if (kind === LEAVE_REQUEST_REJECTED_SAVED) return 'zaOdluku.savedRequestRejected';
  if (kind === SWAP_APPROVED_SAVED) return 'zaOdluku.savedSwapApproved';
  if (kind === SWAP_REJECTED_SAVED) return 'zaOdluku.savedSwapRejected';

  const unhandled: never = kind;

  return unhandled;
}

/**
 * The queue's status line as `t()` takes it: its key and the values that key
 * reads — a conflict's facts, a leave request's member and range
 * (`request`), or a swap's members and date (`swap`, story 12.4).
 */
export type ResolutionSavedLine =
  | {
      readonly request: false;
      readonly swap: false;
      readonly key: 'zaOdluku.saved' | 'zaOdluku.savedReplace';
      readonly values: {
        readonly type: string;
        readonly team: string;
        readonly date: string;
        readonly member: string;
        readonly replacement?: string;
      };
    }
  | {
      readonly request: true;
      readonly swap: false;
      readonly key: 'zaOdluku.savedRequestApproved' | 'zaOdluku.savedRequestRejected';
      readonly values: { readonly member: string; readonly from: string; readonly to: string };
    }
  | {
      readonly request: false;
      readonly swap: true;
      readonly key: 'zaOdluku.savedSwapApproved' | 'zaOdluku.savedSwapRejected';
      readonly values: { readonly proposer: string; readonly addressee: string; readonly date: string };
    }
  | {
      readonly request: false;
      readonly swap: false;
      readonly key: 'zaOdluku.savedCover';
      readonly values: { readonly member: string; readonly replacement: string; readonly count: number };
    };

/**
 * The queue's status line for a landed decision (stories 5.4b, 5.4c, 9.4,
 * 12.4): a conflict's names the shift, the team, the date and the member —
 * and a replacement its name — a leave request's the member and the range,
 * and a swap's both members and the given shift's date.
 */
export function resolutionSavedLineOf(saved: ResolutionSaved, noTeam: string): ResolutionSavedLine {
  switch (saved.kind) {
    case LEAVE_REQUEST_APPROVED_SAVED:
      return {
        request: true,
        swap: false,
        key: 'zaOdluku.savedRequestApproved',
        values: { member: saved.memberName, from: saved.from, to: saved.to },
      };
    case LEAVE_REQUEST_REJECTED_SAVED:
      return {
        request: true,
        swap: false,
        key: 'zaOdluku.savedRequestRejected',
        values: { member: saved.memberName, from: saved.from, to: saved.to },
      };
    case SWAP_APPROVED_SAVED:
      return {
        request: false,
        swap: true,
        key: 'zaOdluku.savedSwapApproved',
        values: { proposer: saved.proposerName, addressee: saved.addresseeName, date: saved.date },
      };
    case SWAP_REJECTED_SAVED:
      return {
        request: false,
        swap: true,
        key: 'zaOdluku.savedSwapRejected',
        values: { proposer: saved.proposerName, addressee: saved.addresseeName, date: saved.date },
      };
    case ACCEPT_UNCOVERED:
      return {
        request: false,
        swap: false,
        key: 'zaOdluku.saved',
        // STORY 21.7: `noTeam` (*bez tima*) for a collision with none.
        values: { type: saved.shiftTypeName, team: saved.teamName ?? noTeam, date: saved.dateShown, member: saved.memberName },
      };
    case LEAVE_COVER_SAVED:
      return {
        request: false,
        swap: false,
        key: 'zaOdluku.savedCover',
        values: { member: saved.memberName, replacement: saved.replacementName, count: saved.days },
      };
    case REPLACE_MEMBER:
      return {
        request: false,
        swap: false,
        key: 'zaOdluku.savedReplace',
        values: {
          type: saved.shiftTypeName,
          team: saved.teamName ?? noTeam,
          date: saved.dateShown,
          member: saved.memberName,
          replacement: saved.replacementName,
        },
      };
    default: {
      const unhandled: never = saved;

      return unhandled;
    }
  }
}
