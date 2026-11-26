import { PERSONAL_ASSIGNMENT_SHIFT, personalShiftOn, rosterOn, scheduledShiftTypeOn, type PersonalShift } from '@shift/domain';

import {
  holidayRuleOfCalendar,
  type CalendarHolidayRule,
  type CalendarMember,
  type CalendarRosterOverride,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import {
  overrideStandingOfCalendar,
  rosterStandingOfCalendar,
  workingShiftTypeIdsOf,
} from '@/features/calendar/utils/month';
import { REPLACE_MEMBER, type ConflictResolution } from '@/features/conflicts/services/resolutions';

/**
 * WHETHER A REPLACEMENT APPLIES (story 5.5d; human, 2026-10-05), in a `.ts`
 * that renders nothing (AD-15): the one test every surface asks of a
 * `replace_member` resolution's linked roster override.
 *
 * A replacement STOPS COUNTING only when the snapshot holds the override it
 * names (0032's `roster_override_id`) and that override does not apply:
 *
 *   * PENDING — a later rotation save left it out of force
 *     (`rosterStandingOfCalendar`);
 *   * INERT — `rosterOn` does not apply it on its team and date (the
 *     replacement inactive that day, already on the default roster, a
 *     take-off-only override, or the team off that day).
 *
 * Then the shift is really uncovered, and {@link effectiveResolutionsOf}
 * drops the resolution before any key is matched, so the conflict shows again
 * on the queue, the resolution screen, the calendar's marks and *Sati*, for an
 * admin and a member alike. `accept_uncovered` (and every other kind) is
 * untouched.
 *
 * A LINK TO AN OVERRIDE THE SNAPSHOT DOES NOT HOLD IS UNKNOWN, NOT INERT. The
 * snapshot lists live overrides only, so "missing" is either removed — which
 * 0033 ends the resolution with, so a re-read drops it — or written after the
 * snapshot was read (the resolutions re-read can land before the snapshot's,
 * right after `replace_conflict_member`). Either way it keeps counting, so a
 * conflict just resolved never flashes back; {@link unknownReplacementLinksOf}
 * names such links so the surface re-reads the snapshot once
 * (`useReplacementLinkRefresh`). A replacement with no link at all — a
 * member's read from before 0033 — is unknown the same way.
 *
 * A LINK THAT DISAGREES with the override it names on the team or the date
 * (0032 writes both from one key, so this is a broken row) is logged and does
 * not count: one bad row never makes a whole surface unavailable.
 *
 * A DECISION MADE ON ANOTHER SHIFT DECIDES NOTHING (0038; deferred work,
 * dormant-key revival). A resolution stores the shift type its key had when
 * it was decided. When the team's schedule has another type (or none) on that
 * date today, {@link effectiveResolutionsOf} drops it, of every kind, so a
 * dormant decision never re-applies to a different shift. A new decision on
 * the key supersedes it in the database (0038's trigger), so it never holds
 * the key ({@link heldByReplacement}). A row with no stored type (before 0038)
 * matches its key as before.
 *
 * STORY 21.7 (0081; AD-4 as amended 2026-11-25): A REPLACEMENT BY ASSIGNMENT.
 * A `replace_member` of the second form names the replacement's Personal
 * Assignment (`personalAssignmentId`) instead of an override. It counts while
 * the snapshot holds that assignment and it gives its member a Personal Shift
 * on the resolution's date, of its stored type, counted with its team (none
 * for a teamless key) — {@link assignmentStandingIn}. An assignment the
 * snapshot does not hold is unknown, and counts, as an override's is: 0081
 * ends the resolution when the save removes its assignment. And A DECISION ON
 * A PERSONAL SHIFT is compared with the member's own shift that date (its
 * type, counted with the key's team), not the team's rotation, so a decision
 * on a dispatcher's day shift is not dropped because their team's crew works
 * nights ({@link decidedOnAnotherShiftIn}).
 *
 * Nothing here computes a roster in the database (AD-4); the leave screen's
 * replacement guard (5.4e) asks the same question through
 * {@link replacementContextOf} and {@link replacementStandingIn}.
 */

/** What a replacement's link names: the conflict's team and date, and the override. */
export interface ReplacementOverrideLink {
  readonly teamId: string;
  readonly date: string;
  readonly rosterOverrideId: string;
}

/** What is logged when a link disagrees with the override it names: never shown. */
export const REPLACEMENT_LINK_MISMATCH = 'REPLACEMENT_LINK_MISMATCH';

/** The override is live, in force and applied: the replacement counts. */
export const REPLACEMENT_APPLIED = 'applied';
/** The snapshot does not hold the override: unknown, so the replacement keeps counting. */
export const REPLACEMENT_UNKNOWN = 'unknown';
/** The snapshot holds the override, pending or inert: the replacement does not count. */
export const REPLACEMENT_NOT_APPLIED = 'notApplied';
/** The link and the override disagree on the team or the date: a broken row, which does not count. */
export const REPLACEMENT_MISMATCH = 'mismatch';

export type ReplacementStanding =
  | { readonly kind: typeof REPLACEMENT_APPLIED; readonly override: CalendarRosterOverride }
  | { readonly kind: typeof REPLACEMENT_UNKNOWN }
  | { readonly kind: typeof REPLACEMENT_NOT_APPLIED; readonly override: CalendarRosterOverride }
  | { readonly kind: typeof REPLACEMENT_MISMATCH; readonly override: CalendarRosterOverride };

/** A snapshot's answers the test reads, worked out once and reused for every link. */
export interface ReplacementContext {
  readonly snapshot: CalendarSnapshot;
  readonly working: ReadonlySet<string>;
  readonly typeInForce: ReturnType<typeof overrideStandingOfCalendar>['inForce'];
  readonly rosterInForce: ReturnType<typeof rosterStandingOfCalendar>['inForce'];
  readonly overrides: ReadonlyMap<string, CalendarRosterOverride>;
  /** STORY 21.16: the snapshot's holiday rule, built once for the context. */
  readonly holidays: CalendarHolidayRule;
}

/**
 * The context for {@link replacementStandingIn}: the standings, the working
 * types and the live overrides by id, once per snapshot read.
 *
 * @throws RangeError on any precondition of the standings.
 */
export function replacementContextOf(snapshot: CalendarSnapshot): ReplacementContext {
  return {
    snapshot,
    working: new Set(workingShiftTypeIdsOf(snapshot)),
    typeInForce: overrideStandingOfCalendar(snapshot).inForce,
    rosterInForce: rosterStandingOfCalendar(snapshot).inForce,
    overrides: new Map(snapshot.rosterOverrides.map((override) => [override.id, override])),
    holidays: holidayRuleOfCalendar(snapshot),
  };
}

/**
 * Where `link`'s override stands in the context's snapshot. Logs nothing:
 * the caller decides what a mismatch means.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function replacementStandingIn(context: ReplacementContext, link: ReplacementOverrideLink): ReplacementStanding {
  const { snapshot } = context;
  const override = context.overrides.get(link.rosterOverrideId);

  if (override === undefined) return { kind: REPLACEMENT_UNKNOWN };

  // THE LINK AND ITS OVERRIDE MUST AGREE: 0032 writes both from one key.
  if (override.teamId !== link.teamId || override.date !== link.date) return { kind: REPLACEMENT_MISMATCH, override };

  if (override.memberInId === null) return { kind: REPLACEMENT_NOT_APPLIED, override };

  const { teamId, date } = override;
  const scheduled = scheduledShiftTypeOn(
    snapshot.assignments.filter((assignment) => assignment.teamId === teamId),
    snapshot.steps,
    context.typeInForce,
    teamId,
    date,
    context.holidays,
  );

  // STORY 21.16: a team a holiday empties (`shiftTypeId: null`) works no shift, so no replacement applies on it.
  if (scheduled === null || scheduled.shiftTypeId === null || !context.working.has(scheduled.shiftTypeId)) {
    return { kind: REPLACEMENT_NOT_APPLIED, override };
  }

  const applied = rosterOn(snapshot.members, context.rosterInForce, teamId, date).applied;

  return applied.some((one) => one.id === override.id)
    ? { kind: REPLACEMENT_APPLIED, override }
    : { kind: REPLACEMENT_NOT_APPLIED, override };
}

/**
 * The override `link` names when it is live, in force and applied on a
 * working shift of its team and date; `null` otherwise — unknown, pending,
 * inert or a mismatch alike.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function appliedReplacementOverrideOf(
  snapshot: CalendarSnapshot,
  link: ReplacementOverrideLink,
): CalendarRosterOverride | null {
  const standing = replacementStandingIn(replacementContextOf(snapshot), link);

  return standing.kind === REPLACEMENT_APPLIED ? standing.override : null;
}

/**
 * STORY 21.7: `memberId`'s Personal Shift on `date` when it counts with
 * `teamId` (none for `null`), else `null`. A member the snapshot lacks has none.
 *
 * @throws RangeError on any precondition of `personalShiftOn`.
 */
export function personalShiftCountedWith(
  context: Pick<ReplacementContext, 'snapshot' | 'working' | 'holidays'>,
  memberId: string,
  teamId: string | null,
  date: string,
): PersonalShift | null {
  const member = context.snapshot.members.find((one) => one.id === memberId);

  if (member === undefined) return null;

  const shift = personalShiftOn(member, date, context.working, context.snapshot.steps, context.holidays);

  return shift !== null && shift.teamId === teamId ? shift : null;
}

/**
 * Whether `resolution` was decided on a shift type other than the one its
 * team's schedule has on its date today, or on a date the team does not work
 * (0038). Never for a row with no stored type. STORY 21.7: when the member's
 * own Personal Shift that date counts with the key's team, or the key has no
 * team, that shift's type is the one compared (none: another shift).
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
function decidedOnAnotherShiftIn(context: ReplacementContext, resolution: ConflictResolution): boolean {
  if (resolution.shiftTypeId === null) return false;

  const personal = personalShiftCountedWith(context, resolution.memberId, resolution.teamId, resolution.date);

  if (personal !== null) return personal.shiftTypeId !== resolution.shiftTypeId;
  if (resolution.teamId === null) return true;

  const { snapshot } = context;
  const scheduled = scheduledShiftTypeOn(
    snapshot.assignments.filter((assignment) => assignment.teamId === resolution.teamId),
    snapshot.steps,
    context.typeInForce,
    resolution.teamId,
    resolution.date,
    // STORY 21.16: a holiday the team is off on leaves no type, which is another shift than the stored one.
    context.holidays,
  );

  return scheduled?.shiftTypeId !== resolution.shiftTypeId;
}

/**
 * STORY 21.7: where a replacement by assignment stands in the context's
 * snapshot — unknown when no member's live assignments hold its id; applied
 * when it gives its member a Personal Shift on the resolution's date, of the
 * stored type (when one is stored), counted with the resolution's team; not
 * applied otherwise (the replacement inactive, moved onto a team, or the type
 * made non-working).
 *
 * @throws RangeError on any precondition of `personalShiftOn`.
 */
export function assignmentStandingIn(
  context: Pick<ReplacementContext, 'snapshot' | 'working' | 'holidays'>,
  resolution: Pick<ConflictResolution, 'date' | 'teamId' | 'shiftTypeId'> & { readonly personalAssignmentId: string },
): typeof REPLACEMENT_APPLIED | typeof REPLACEMENT_UNKNOWN | typeof REPLACEMENT_NOT_APPLIED {
  const holder = context.snapshot.members.find((member) =>
    member.personalAssignments.some((assignment) => assignment.id === resolution.personalAssignmentId),
  );

  if (holder === undefined) return REPLACEMENT_UNKNOWN;

  const shift = personalShiftCountedWith(context, holder.id, resolution.teamId, resolution.date);

  return shift !== null &&
    shift.personalAssignmentId === resolution.personalAssignmentId &&
    (resolution.shiftTypeId === null || shift.shiftTypeId === resolution.shiftTypeId)
    ? REPLACEMENT_APPLIED
    : REPLACEMENT_NOT_APPLIED;
}

/** Whether `resolution` still decides its conflict, in `context`: every kind but a replacement the snapshot holds unapplied. */
function countsIn(context: ReplacementContext, resolution: ConflictResolution): boolean {
  if (resolution.kind === REPLACE_MEMBER && resolution.personalAssignmentId !== null) {
    return assignmentStandingIn(context, { ...resolution, personalAssignmentId: resolution.personalAssignmentId }) !== REPLACEMENT_NOT_APPLIED;
  }

  if (resolution.kind !== REPLACE_MEMBER || resolution.rosterOverrideId === null || resolution.teamId === null) return true;

  const standing = replacementStandingIn(context, {
    teamId: resolution.teamId,
    date: resolution.date,
    rosterOverrideId: resolution.rosterOverrideId,
  });

  if (standing.kind === REPLACEMENT_MISMATCH) {
    console.error(REPLACEMENT_LINK_MISMATCH, standing.override.id);

    return false;
  }

  return standing.kind !== REPLACEMENT_NOT_APPLIED;
}

/**
 * The resolutions that still decide their conflict, in the order given: none
 * decided on another shift type than its key has today (0038), every other
 * kind but `replace_member` as it is, and a `replace_member` unless the
 * snapshot holds its override pending or inert, or the link disagrees with it
 * (logged). A link the snapshot does not hold, and no link at all, count; so
 * does a row with no stored type.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function effectiveResolutionsOf<Resolution extends ConflictResolution>(
  snapshot: CalendarSnapshot,
  resolutions: readonly Resolution[],
): readonly Resolution[] {
  if (!resolutions.some((resolution) => resolution.kind === REPLACE_MEMBER || resolution.shiftTypeId !== null)) {
    return resolutions;
  }

  const context = replacementContextOf(snapshot);

  return resolutions.filter((resolution) => !decidedOnAnotherShiftIn(context, resolution) && countsIn(context, resolution));
}

/**
 * Whether `resolution` is a replacement the snapshot holds and does not
 * apply (story 5.5d): pending, inert or a broken link — what keeps a
 * conflict's key HELD while the conflict shows again. A link the snapshot
 * does not hold is unknown, never held; nor is a replacement decided on
 * another shift type (0038), which a new decision supersedes.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function heldByReplacement(snapshot: CalendarSnapshot, resolution: ConflictResolution): boolean {
  if (resolution.kind !== REPLACE_MEMBER) return false;
  // No link at all (a member's read from before 0033), or an override link on no team: nothing holds the key.
  if (resolution.personalAssignmentId === null && (resolution.rosterOverrideId === null || resolution.teamId === null)) return false;

  const context = replacementContextOf(snapshot);

  if (decidedOnAnotherShiftIn(context, resolution)) return false;

  // STORY 21.7: an assignment the snapshot holds unapplied holds the key the same way.
  if (resolution.personalAssignmentId !== null) {
    return assignmentStandingIn(context, { ...resolution, personalAssignmentId: resolution.personalAssignmentId }) === REPLACEMENT_NOT_APPLIED;
  }

  if (resolution.rosterOverrideId === null || resolution.teamId === null) return false;

  const standing = replacementStandingIn(context, {
    teamId: resolution.teamId,
    date: resolution.date,
    rosterOverrideId: resolution.rosterOverrideId,
  });

  return standing.kind === REPLACEMENT_NOT_APPLIED || standing.kind === REPLACEMENT_MISMATCH;
}

/**
 * STORY 21.14 (the 21.7 deferral): the cover a SUPERSEDED decision left with
 * its shift — the member whose live `SHIFT` assignment a replacement by
 * assignment names, when that decision was made on another shift type than
 * its key has today (0038), so it decides nothing while the cover still holds
 * the shift. `null` for every other resolution, and for one whose assignment
 * the snapshot no longer holds as a `SHIFT`.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function supersededCoverOf(snapshot: CalendarSnapshot, resolution: ConflictResolution): CalendarMember | null {
  if (resolution.kind !== REPLACE_MEMBER || resolution.personalAssignmentId === null) return null;
  if (!decidedOnAnotherShiftIn(replacementContextOf(snapshot), resolution)) return null;

  const id = resolution.personalAssignmentId;

  return (
    snapshot.members.find((member) =>
      member.personalAssignments.some((assignment) => assignment.id === id && assignment.kind === PERSONAL_ASSIGNMENT_SHIFT),
    ) ?? null
  );
}

const KIND_COLUMN = 'kind';
const LINK_COLUMN = 'roster_override_id';
const ASSIGNMENT_LINK_COLUMN = 'personal_assignment_id';

/**
 * The override ids that `replace_member` rows link and the snapshot does not
 * hold, sorted and once each — the fetch-skew case a surface re-reads the
 * snapshot for. Reads the rows as they came back, unparsed, and never
 * throws: what cannot be read names nothing.
 */
export function unknownReplacementLinksOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): readonly string[] {
  // STORY 21.7: an assignment a replacement names is held when some member's live assignments carry it.
  const held = new Set([
    ...snapshot.rosterOverrides.map((override) => override.id),
    ...snapshot.members.flatMap((member) => member.personalAssignments.map((assignment) => assignment.id)),
  ]);
  const unknown = new Set<string>();

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;

    const record = row as Record<string, unknown>;
    if (record[KIND_COLUMN] !== REPLACE_MEMBER) continue;

    for (const link of [record[LINK_COLUMN], record[ASSIGNMENT_LINK_COLUMN]]) {
      if (typeof link === 'string' && link !== '' && !held.has(link)) unknown.add(link);
    }
  }

  return [...unknown].sort();
}
