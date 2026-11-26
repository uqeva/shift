import {
  FLOATER_FREE,
  FLOATER_INACTIVE,
  FLOATER_ON_LEAVE,
  FLOATER_REST_GAP,
  FLOATER_WORKING,
  PERSONAL_ASSIGNMENT_SHIFT,
  collisionKeyOf,
  floaterEligibleFor,
  leaveCoverOf,
  monthOf,
  type Collision,
  type FloaterStanding,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { assignmentCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, checkedOf, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { liveResolutionsOf, unresolvedOf } from '@/features/conflicts/services/conflicts-queue';
import {
  floaterWindowOf,
  floatersOf,
  uncoveredShiftOf,
  type FloaterMember,
} from '@/features/conflicts/services/floater-suggestions';
import { heldByReplacement } from '@/features/conflicts/services/replacement-effect';
import {
  PERSONAL_COVER_MAX_ITEMS,
  RESOLUTION_HELD,
  RESOLUTION_TAKEN,
  resolutionFailureLineOf,
  type PersonalCoverItem,
  type ResolutionFailureLine,
  type ResolutionWriteFailure,
} from '@/features/conflicts/services/resolution-write';
import { organizationLeaveRecordsOf, type OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import {
  MANUAL_ARCHIVED,
  MANUAL_STALE,
  MANUAL_TOO_MANY,
  draftKeyOf,
  type ManualDraft,
  type ManualDraftCell,
  type ManualDraftRefusal,
} from '@/features/planning/services/manual-grid';
import type { ManualPreview } from '@/features/planning/services/manual-preview';
import { manualCheckFromReads, manualPreviewKeyOf } from '@/features/planning/services/manual-save';
import type { ShortStaffedReport } from '@/features/staffing/services/short-staffed';

/**
 * *POKRIJ CIJELO ODSUSTVO* (story 21.14; R16.4, UX-DR77): one floater covers
 * every unresolved conflict of a leave record in one action, as a `.ts` that
 * renders nothing (AD-15). The rules are the domain's (`leaveCoverOf`,
 * `floaterEligibleFor`) and 21.13's and 21.7's adapters'; this assembles them.
 *
 *   - THE DATES are the record's unresolved conflicts, the queue's own set
 *     (`unresolvedOf`), in date order.
 *   - THE FLOATERS OFFERED are the eligible ones (R16.1, the absent member's
 *     role), other than the absent member; by covered dates, most first, then
 *     21.13's order (fewest at-work shifts across every month the open dates
 *     span, then the names'). One covering no date is listed, and cannot be
 *     saved.
 *   - A DATE IS COVERED when the floater is free that date (R16.2, every
 *     earlier covered date counted as their shift), among 21.7's
 *     `assignmentCandidatesOf` for that conflict, and its key is not held by a
 *     replacement that no longer applies; otherwise it is listed with its
 *     reason and left open, never forced.
 *   - THE CHECK (AD-5) is the grid's: a draft of a `SHIFT` of each covered
 *     conflict's type, counted with its team, through `manualCheckFromReads`
 *     over fresh reads — erasures, *Što se mijenja* and the short-staffed
 *     block. The cover is rebuilt from the same fresh reads, the member list
 *     (the floater flag and roles) among them, so a write sends what the fresh
 *     check stood on. It is keyed on the LEAVE RECORD: the dates still open
 *     are covered, and it is gone only when none is left.
 *   - *SPREMI*'s decision is {@link coverConfirmStepOf}: a check that says
 *     anything else than the one shown is shown again FIRST, erasures or not.
 *   - THE WRITE is one `resolveWithPersonalAssignment` call with every covered
 *     item (at most 366): one notice for the floater.
 */

/** The dialog's heading, which names it. */
export const LEAVE_COVER_HEADING_ID = 'leave-cover-title';
/** The floaters' heading, which names their radio group. */
export const LEAVE_COVER_FLOATERS_ID = 'leave-cover-floaters';
/** The picked floater's dates. */
export const LEAVE_COVER_DATES_ID = 'leave-cover-dates';
/** The picked floater's summary, announced politely (`Ana · pokriva 5 od 7`). */
export const LEAVE_COVER_SUMMARY_ID = 'leave-cover-summary';
/** What describes the floaters' radio group once one is picked: the summary, then the dates. */
export const LEAVE_COVER_PICK_DESCRIBED_BY = `${LEAVE_COVER_SUMMARY_ID} ${LEAVE_COVER_DATES_ID}`;
/** The prefix of the erasure confirmation's ids. */
export const LEAVE_COVER_ERASURES_ID = 'leave-cover-erasures';

/** The button that opens the dialog: where focus returns when it closes. */
export const LEAVE_COVER_OPEN_ID = 'resolution-leave-cover-open';

/** Logged when the dialog's model, its check or its write could not be settled. */
export const LEAVE_COVER_UNAVAILABLE = 'LEAVE_COVER_UNAVAILABLE';

/** The dialog's model is derived. */
export const COVER_MODEL_READY = 'ready';
/** A read the model stands on cannot be trusted, or breaks a precondition: one alert. */
export const COVER_MODEL_UNAVAILABLE = 'unavailable';
/** No eligible floater, or no unresolved conflict: nothing to offer. */
export const COVER_MODEL_NONE = 'none';
/** A read the model stands on is not in yet: a loading line. */
export const COVER_MODEL_LOADING = 'loading';

/** The dialog's model: the floaters and their dates, or that it cannot be derived. */
export type LeaveCoverModel =
  | { readonly kind: typeof COVER_MODEL_READY; readonly view: LeaveCoverView }
  | { readonly kind: typeof COVER_MODEL_UNAVAILABLE }
  | { readonly kind: typeof COVER_MODEL_NONE }
  | { readonly kind: typeof COVER_MODEL_LOADING };

/**
 * The dialog's model over the screen's reads as answered: loading while a
 * read is not in, none with nothing to offer, unavailable (logged) when a row cannot be trusted or the
 * derivation breaks a precondition. Never throws a `RangeError`.
 */
/**
 * The member list's fresh answer as the check reads it: its floater fields.
 *
 * @throws RangeError when the read was refused (the check is then unavailable).
 */
export function leaveCoverMembersOf(
  answer: { readonly ok: true; readonly members: readonly FloaterMember[] } | { readonly ok: false; readonly code: string },
): readonly FloaterMember[] {
  if (!answer.ok) throw new RangeError(`the member list is ${answer.code}`);

  return answer.members;
}

export function leaveCoverModelOf(
  snapshot: CalendarSnapshot | null,
  recordRows: readonly unknown[] | undefined,
  resolutionRows: readonly unknown[] | undefined,
  members: readonly FloaterMember[] | null,
  collision: Pick<Collision, 'memberId' | 'leaveRecordId'> | null,
): LeaveCoverModel {
  if (snapshot === null || recordRows === undefined || resolutionRows === undefined || members === null || collision === null) {
    return { kind: COVER_MODEL_LOADING };
  }

  try {
    const records = organizationLeaveRecordsOf(
      recordRows,
      snapshot.members.map((member) => member.id),
    );

    if (records === null) throw new RangeError('a leave record row cannot be trusted');

    const view = leaveCoverViewOf(snapshot, records, resolutionRows, members, collision);

    return view === null ? { kind: COVER_MODEL_NONE } : { kind: COVER_MODEL_READY, view };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(LEAVE_COVER_UNAVAILABLE, cause);

    return { kind: COVER_MODEL_UNAVAILABLE };
  }
}

/** Not among the conflict's cover candidates (21.7): the cover cannot be written on that shift. */
export const COVER_NOT_CANDIDATE = 'not-candidate';
/** The conflict's key is held by a replacement that no longer applies (story 5.5d, 21.13). */
export const COVER_HELD = 'held';

/** Why a date is left open: the floater's standing, or one of the two the screen adds. */
export type LeaveCoverReason =
  | Exclude<FloaterStanding, typeof FLOATER_FREE>
  | typeof COVER_NOT_CANDIDATE
  | typeof COVER_HELD;

/** One unresolved conflict of the record, as one floater would cover it. */
export interface LeaveCoverDate {
  readonly collision: Collision;
  readonly key: string;
  readonly typeName: string;
  /** `null` with no team (story 21.7). */
  readonly teamName: string | null;
  readonly covered: boolean;
  /** Why it is left open; `null` when covered. */
  readonly reason: LeaveCoverReason | null;
}

/** One floater offered: their name, the dates and how many they cover. */
export interface LeaveCoverFloater {
  readonly id: string;
  readonly name: string;
  readonly covered: number;
  /** Their at-work shifts in every month the open dates span: 21.13's order, over the leave. */
  readonly shiftsInSpan: number;
  readonly dates: readonly LeaveCoverDate[];
}

/** The dialog's model: the absent member and the record, and the floaters offered. */
export interface LeaveCoverView {
  readonly absentId: string;
  readonly absentName: string;
  /** The absent member's role, for the none line; `null` for none. */
  readonly roleName: string | null;
  readonly leaveRecordId: string;
  /** How many unresolved conflicts the record has. */
  readonly dateCount: number;
  readonly floaters: readonly LeaveCoverFloater[];
}

/**
 * Whether the screen offers *Pokrij cijelo odsustvo*: some floater is
 * eligible for the absent member (R16.1, by role) and is not the absent
 * member.
 */
export function leaveCoverOffered(members: readonly FloaterMember[], absentId: string, absentRoleId: string | null): boolean {
  return members.some(
    (member) => member.isFloater && member.id !== absentId && floaterEligibleFor(absentRoleId, member.floaterRoleIds),
  );
}

/** Whether `collision`'s key is held: a live replacement on it the snapshot holds unapplied. */
function heldKeysOf(snapshot: CalendarSnapshot, resolutionRows: readonly unknown[]): ReadonlySet<string> {
  return new Set(
    liveResolutionsOf(snapshot, resolutionRows)
      .filter((resolution) => heldByReplacement(snapshot, resolution))
      .map((resolution) => collisionKeyOf(resolution)),
  );
}

/** A floater's standing as the reason a date is left open. */
function standingReasonOf(standing: FloaterStanding): LeaveCoverReason | null {
  switch (standing) {
    case FLOATER_FREE:
      return null;
    case FLOATER_INACTIVE:
    case FLOATER_ON_LEAVE:
    case FLOATER_WORKING:
    case FLOATER_REST_GAP:
      return standing;
  }
}

/** By date, then by team (no team last): one record's conflicts in date order. */
function byDateThenTeam(left: Collision, right: Collision): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  if (left.teamId === right.teamId) return 0;
  if (left.teamId === null) return 1;
  if (right.teamId === null) return -1;

  return left.teamId < right.teamId ? -1 : 1;
}

/**
 * The record's unresolved conflicts: those of `collision`'s member and leave
 * record among the queue's own set, in date order.
 *
 * @throws RangeError on any precondition of the queue's derivation.
 */
export function recordConflictsOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
  collision: Pick<Collision, 'memberId' | 'leaveRecordId'>,
): readonly Collision[] {
  return unresolvedOf(snapshot, records, resolutionRows)
    .filter((one) => one.memberId === collision.memberId && one.leaveRecordId === collision.leaveRecordId)
    .sort(byDateThenTeam);
}

/**
 * The dialog's model for the leave record of `collision`, or `null` when the
 * organization has no floater, or the record has no unresolved conflict. The
 * held keys and each conflict's cover candidates are derived ONCE, shared by
 * every floater.
 *
 * @throws RangeError on any precondition of the domain's derivation, or for a
 *   member, type or team the snapshot lacks.
 */
export function leaveCoverViewOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
  members: readonly FloaterMember[],
  collision: Pick<Collision, 'memberId' | 'leaveRecordId'>,
): LeaveCoverView | null {
  const byId = new Map(members.filter((member) => member.isFloater).map((member) => [member.id, member]));

  if (byId.size === 0) return null;

  const conflicts = recordConflictsOf(snapshot, records, resolutionRows, collision);
  const first = conflicts[0];
  const last = conflicts.at(-1);

  if (first === undefined || last === undefined) return null;

  const absent = snapshot.members.find((one) => one.id === collision.memberId);

  if (absent === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);

  const absentRoleId = absent.jobRole?.id ?? null;
  // ELIGIBLE (R16.1), never the absent member.
  const eligible = new Map(
    [...byId].filter(([id, row]) => id !== collision.memberId && floaterEligibleFor(absentRoleId, row.floaterRoleIds)),
  );
  const window = { from: floaterWindowOf(first.date).from, to: floaterWindowOf(last.date).to };
  const floaters = floatersOf(snapshot, records, eligible, window);
  const held = heldKeysOf(snapshot, resolutionRows);
  // Per conflict, once: its shift, its candidates (21.7), its names.
  const shifts = conflicts.map((one) => {
    const type = snapshot.types.find((candidate) => candidate.id === one.shiftTypeId);
    const team = one.teamId === null ? null : snapshot.teams.find((candidate) => candidate.id === one.teamId);

    if (type === undefined) throw new RangeError(`shift type ${one.shiftTypeId} is not in the snapshot`);
    if (team === undefined) throw new RangeError(`team ${String(one.teamId)} is not in the snapshot`);

    const key = collisionKeyOf(one);
    const candidates = new Set(
      assignmentCandidatesOf(snapshot, records, one.memberId, one.teamId, one.date, one.shiftTypeId).flatMap((group) =>
        group.candidates.map((candidate) => candidate.id),
      ),
    );

    return {
      collision: one,
      key,
      typeName: type.name,
      teamName: team === null ? null : team.name,
      uncovered: uncoveredShiftOf(snapshot, one),
      candidates,
      held: held.has(key),
    };
  });
  // 21.13's order over the leave: every month the open dates span.
  const months = new Set(conflicts.map((one) => monthOf(one.date)));
  const offered = floaters.map((floater, order): LeaveCoverFloater & { readonly order: number } => {
    const cover = leaveCoverOf(
      floater,
      shifts.map((shift) => ({ ...shift.uncovered, writable: shift.candidates.has(floater.id) && !shift.held })),
    );
    const member = snapshot.members.find((one) => one.id === floater.id);

    if (member === undefined) throw new RangeError(`member ${floater.id} is not in the snapshot`);

    return {
      id: floater.id,
      name: member.name,
      covered: cover.covered,
      shiftsInSpan: floater.shifts.filter((shift) => months.has(monthOf(shift.date))).length,
      order,
      dates: shifts.map((shift, index) => {
        const entry = cover.entries[index];

        if (entry === undefined) throw new RangeError(`no cover entry for ${shift.key}`);

        // THE REASON'S ORDER: the floater's standing, then the shift they cannot take, then the held key.
        const reason = entry.covered
          ? null
          : (standingReasonOf(entry.standing) ?? (shift.candidates.has(floater.id) ? COVER_HELD : COVER_NOT_CANDIDATE));

        return {
          collision: shift.collision,
          key: shift.key,
          typeName: shift.typeName,
          teamName: shift.teamName,
          covered: entry.covered,
          reason,
        };
      }),
    };
  });

  return {
    absentId: absent.id,
    absentName: absent.name,
    roleName: absent.jobRole?.name ?? null,
    leaveRecordId: first.leaveRecordId,
    dateCount: conflicts.length,
    floaters: offered
      .sort(
        (left, right) => right.covered - left.covered || left.shiftsInSpan - right.shiftsInSpan || left.order - right.order,
      )
      .map(({ order: _order, ...floater }) => floater),
  };
}

/** The dates a floater covers. */
function coveredOf(floater: LeaveCoverFloater): readonly LeaveCoverDate[] {
  return floater.dates.filter((date) => date.covered);
}

/**
 * The check's draft: a `SHIFT` of each covered conflict's type for the
 * floater, counted with the conflict's team (none for `null`), as *Ručni
 * raspored* drafts a cell.
 */
export function leaveCoverDraftOf(floater: LeaveCoverFloater): ManualDraft {
  return new Map(
    coveredOf(floater).map((date): [string, ManualDraftCell] => {
      const cell = { memberId: floater.id, date: date.collision.date };

      return [
        draftKeyOf(cell),
        {
          ...cell,
          value: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: date.collision.shiftTypeId, teamId: date.collision.teamId },
        },
      ];
    }),
  );
}

/** The write's items: one per covered conflict, in date order (R16.4). */
export function leaveCoverItemsOf(floater: LeaveCoverFloater): readonly PersonalCoverItem[] {
  return coveredOf(floater).map((date) => ({
    memberId: date.collision.memberId,
    date: date.collision.date,
    teamId: date.collision.teamId,
    shiftTypeId: date.collision.shiftTypeId,
    replacementId: floater.id,
  }));
}

// ------------------------------------------------------------------ the check

/** The record has no open conflict left: resolved meanwhile, or its leave changed. */
export const COVER_GONE = 'gone';
/** The floater is no longer offered, or covers no date on the fresh reads. */
export const COVER_NONE = 'none';

export type LeaveCoverRefusal = ManualDraftRefusal | typeof COVER_GONE | typeof COVER_NONE;

/** What the fresh check derived: the grid's, with the cover it stood on and the items the write sends. */
export interface LeaveCoverReady {
  readonly kind: typeof CHECK_READY;
  readonly rows: readonly ErasureRow[];
  readonly preview: ManualPreview;
  readonly shortStaffed: ShortStaffedReport | null;
  readonly draft: ManualDraft;
  readonly floater: LeaveCoverFloater;
  /** The absent member's name, as the queue's line once the cover lands. */
  readonly absentName: string;
  readonly items: readonly PersonalCoverItem[];
}

export type LeaveCoverCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: LeaveCoverRefusal }
  | LeaveCoverReady;

/** What the check is asked: the absent member's leave record, and the floater picked. */
export interface LeaveCoverAsk {
  readonly memberId: string;
  readonly leaveRecordId: string;
  readonly floaterId: string;
}

/** The check's fresh reads: the three core ones, and the member list's floater fields. */
export interface LeaveCoverReads extends ErasureReads {
  readonly members: readonly FloaterMember[];
}

/**
 * THE CHECK over reads already fetched: the record's open conflicts and the
 * floater's cover rebuilt from them (the floater's flag and roles fresh too),
 * then the grid's check over its draft. Gone only when the record has no
 * open conflict left; none when the floater covers no date any more; too many
 * past one call's bound.
 *
 * @throws RangeError when a row cannot be trusted, or on any precondition of
 *   the derivation (the caller's `checkedOf` answers it unavailable).
 */
export function leaveCoverCheckFromReads(reads: LeaveCoverReads, ask: LeaveCoverAsk): LeaveCoverCheck {
  const { calendar } = reads;
  const records = organizationLeaveRecordsOf(
    reads.records,
    calendar.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const record = { memberId: ask.memberId, leaveRecordId: ask.leaveRecordId };

  if (recordConflictsOf(calendar, records, reads.resolutions, record).length === 0) {
    return { kind: CHECK_REFUSED, code: COVER_GONE };
  }

  // Only the floater asked about: the others' covers are not this check's.
  const view = leaveCoverViewOf(
    calendar,
    records,
    reads.resolutions,
    reads.members.filter((member) => member.id === ask.floaterId),
    record,
  );
  const floater = view?.floaters.find((one) => one.id === ask.floaterId);

  if (view === null || floater === undefined || floater.covered === 0) return { kind: CHECK_REFUSED, code: COVER_NONE };

  const items = leaveCoverItemsOf(floater);
  const bound = leaveCoverBoundOf(items);

  if (bound !== null) return { kind: CHECK_REFUSED, code: bound };

  const draft = leaveCoverDraftOf(floater);
  const check = manualCheckFromReads(reads, draft);

  if (check.kind !== CHECK_READY) return check;

  return { ...check, floater, absentName: view.absentName, items };
}

/** One call's bound (0081): more than {@link PERSONAL_COVER_MAX_ITEMS} items is too many, refused before any write. */
export function leaveCoverBoundOf(items: readonly PersonalCoverItem[]): typeof MANUAL_TOO_MANY | null {
  return items.length > PERSONAL_COVER_MAX_ITEMS ? MANUAL_TOO_MANY : null;
}

/** THE CHECK over `read`'s fresh answer. Never throws. */
export function leaveCoverCheckOf(
  read: () => Promise<LeaveCoverReads>,
  ask: LeaveCoverAsk,
  online: boolean,
): Promise<LeaveCoverCheck> {
  return checkedOf(read, (reads) => leaveCoverCheckFromReads(reads, ask), online);
}

/**
 * What a ready check says, as one comparable key: the grid's *Što se
 * mijenja* and short-staffed block, and every date's cover. *Spremi* writes
 * only when a fresh check says the same as the one shown.
 */
export function leaveCoverKeyOf(check: LeaveCoverReady): string {
  return JSON.stringify([
    manualPreviewKeyOf(check),
    check.floater.dates.map((date) => [date.key, date.covered, date.reason]),
    check.items,
  ]);
}

/** *Spremi* writes the fresh check. */
export const STEP_WRITE = 'write';
/** The fresh check erases decisions: the shared confirmation first. */
export const STEP_ERASURES = 'erasures';
/** The fresh check says something else than the one shown: shown again, nothing written. */
export const STEP_CHANGED = 'changed';
/** The fresh check is refused: its line. */
export const STEP_REFUSED = 'refused';
/** The fresh check could not be derived: the unchecked line. */
export const STEP_UNAVAILABLE = 'unavailable';

export type CoverConfirmStep =
  | { readonly kind: typeof STEP_WRITE; readonly check: LeaveCoverReady }
  | { readonly kind: typeof STEP_ERASURES; readonly check: LeaveCoverReady }
  | { readonly kind: typeof STEP_CHANGED; readonly check: LeaveCoverReady }
  | { readonly kind: typeof STEP_REFUSED; readonly code: LeaveCoverRefusal }
  | { readonly kind: typeof STEP_UNAVAILABLE };

/**
 * *SPREMI*'s decision over the preview `shown` and its `fresh` check. STALE
 * FIRST: a fresh check that says anything else is shown again and nothing is
 * written, even when it erases; then erasures go to the confirmation; then
 * the write.
 */
export function coverConfirmStepOf(shown: LeaveCoverReady, fresh: LeaveCoverCheck): CoverConfirmStep {
  if (fresh.kind === CHECK_UNAVAILABLE) return { kind: STEP_UNAVAILABLE };
  if (fresh.kind === CHECK_REFUSED) return { kind: STEP_REFUSED, code: fresh.code };
  if (leaveCoverKeyOf(fresh) !== leaveCoverKeyOf(shown)) return { kind: STEP_CHANGED, check: fresh };
  if (fresh.rows.length > 0) return { kind: STEP_ERASURES, check: fresh };

  return { kind: STEP_WRITE, check: fresh };
}

/**
 * The erasure confirmation's subject from its fresh check: the check, when it
 * still says what the preview `shown` said; `null` (the preview is shown
 * again, nothing written) when it does not.
 */
export function coverErasureSubjectOf(shown: LeaveCoverReady, fresh: LeaveCoverReady): LeaveCoverReady | null {
  return leaveCoverKeyOf(fresh) === leaveCoverKeyOf(shown) ? fresh : null;
}

// --------------------------------------------------------------- the messages

/** A date's line: covered, or why it is left open. Exhaustive. */
export function leaveCoverReasonMessageKey(
  reason: LeaveCoverReason | null,
):
  | 'zaOdluku.cover.reason.covered'
  | 'zaOdluku.cover.reason.inactive'
  | 'zaOdluku.cover.reason.onLeave'
  | 'zaOdluku.cover.reason.working'
  | 'zaOdluku.cover.reason.restGap'
  | 'zaOdluku.cover.reason.notCandidate'
  | 'zaOdluku.cover.reason.held' {
  switch (reason) {
    case null:
      return 'zaOdluku.cover.reason.covered';
    case FLOATER_INACTIVE:
      return 'zaOdluku.cover.reason.inactive';
    case FLOATER_ON_LEAVE:
      return 'zaOdluku.cover.reason.onLeave';
    case FLOATER_WORKING:
      return 'zaOdluku.cover.reason.working';
    case FLOATER_REST_GAP:
      return 'zaOdluku.cover.reason.restGap';
    case COVER_NOT_CANDIDATE:
      return 'zaOdluku.cover.reason.notCandidate';
    case COVER_HELD:
      return 'zaOdluku.cover.reason.held';
  }
}

/** The none line: with the absent member's role, or with none (as 21.13's). */
export function leaveCoverNoneMessageKey(roleName: string | null): 'zaOdluku.cover.noFloaters' | 'zaOdluku.cover.noFloatersAny' {
  return roleName === null ? 'zaOdluku.cover.noFloatersAny' : 'zaOdluku.cover.noFloaters';
}

/** A write's refusal as the dialog says it: its key, and for the taken line the floater's name. */
export interface LeaveCoverFailureLine {
  readonly key: ReturnType<typeof leaveCoverFailureMessageKey> | ResolutionFailureLine['key'];
  readonly values?: { readonly name: string };
}

/** The cover's own lines for a taken or held write: neither claims "this shift". */
export function leaveCoverFailureMessageKey(
  failure: typeof RESOLUTION_TAKEN | typeof RESOLUTION_HELD,
): 'zaOdluku.cover.error.taken' | 'zaOdluku.cover.error.held' {
  return failure === RESOLUTION_TAKEN ? 'zaOdluku.cover.error.taken' : 'zaOdluku.cover.error.held';
}

/**
 * A write's refusal in the dialog: taken and held say which of the dates is
 * at stake without claiming "this shift" (the next *Provjeri*, over the
 * re-read, leaves that date open); every other is the screen's own line.
 */
export function leaveCoverFailureLineOf(failure: ResolutionWriteFailure, floaterName: string | null): LeaveCoverFailureLine {
  if (failure === RESOLUTION_TAKEN && floaterName !== null) {
    return { key: leaveCoverFailureMessageKey(failure), values: { name: floaterName } };
  }
  if (failure === RESOLUTION_HELD) return { key: leaveCoverFailureMessageKey(failure) };

  return resolutionFailureLineOf(failure, floaterName);
}

/** A refused check's line. Exhaustive. */
export function leaveCoverRefusalMessageKey(
  code: LeaveCoverRefusal,
):
  | 'zaOdluku.cover.error.gone'
  | 'zaOdluku.cover.error.none'
  | 'zaOdluku.cover.error.stale'
  | 'zaOdluku.cover.error.archived'
  | 'zaOdluku.cover.error.tooMany' {
  switch (code) {
    case COVER_GONE:
      return 'zaOdluku.cover.error.gone';
    case COVER_NONE:
      return 'zaOdluku.cover.error.none';
    case MANUAL_STALE:
      return 'zaOdluku.cover.error.stale';
    case MANUAL_ARCHIVED:
      return 'zaOdluku.cover.error.archived';
    case MANUAL_TOO_MANY:
      return 'zaOdluku.cover.error.tooMany';
  }
}
