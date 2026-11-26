import {
  collisionKeyOf,
  collisionsOf,
  dutiesOf,
  memberScheduleOfMonth,
  monthOf,
  overlappingLegsOf,
  rosterOverridesMadeInertOf,
  type DutyLeg,
  type MemberScheduleDay,
  type ScheduleInput,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, shiftLegOn, snapshotScheduleInputOf, typeRangeOn } from '@/features/calendar/utils/month';
import { collisionInputOf } from '@/features/conflicts/services/conflicts-queue';
import type { OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import { compareText, formatIsoDayMonth, formatIsoWeekdayShortName, nextIsoDate, previousIsoDate } from '@/lib/i18n/format';

/**
 * *ŠTO SE MIJENJA* OF A *RUČNI RASPORED* SAVE (story 21.4; AD-5 as amended
 * 2026-11-25; R14.5): per member, from the calendar `before` and its one
 * "after" (`draftAppliedOf`), as data. The dialog words it from `hr.json`'s
 * `rucniRaspored.preview`. Built on the loan's (`members/services/loan.ts`
 * `loanPreviewOf`), with one difference that is the point of this story: a
 * Personal Shift counted with NO team is read, never skipped — it is lost or
 * gained, it double-books and it joins a no-rest duty like any other shift
 * (R14.5, R14.9), and a leave over it is a conflict like any other. STORY
 * 21.7: *Za odluku* lists it (with a team or none), so the line says where the
 * new conflict goes ({@link ManualNewConflict}), for every team.
 *
 * Only what the save MAKES is said: a double booking, a no-rest duty or a
 * conflict already there before is not repeated. Nothing here
 * blocks; only an erasure does (`manual-save`).
 */

/** How many shift lines one member's block shows before `i još {n}`. */
export const MANUAL_SHOWN_SHIFTS = 12;

/** How many days either side of the window the legs are read, so a no-rest run crossing its edge keeps its whole total. */
export const MANUAL_DUTY_REACH_DAYS = 7;

/** A working shift a member loses on a date, or gains. */
export const MANUAL_LOST = 'lost';
export const MANUAL_GAINED = 'gained';
export type ManualShiftSide = typeof MANUAL_LOST | typeof MANUAL_GAINED;

/** One shift as a line names it: the team (`null`: *bez tima*), the type and its range (`null`: no times that date). */
export interface ManualShift {
  readonly date: string;
  readonly team: string | null;
  readonly type: string;
  readonly range: string | null;
}

export interface ManualShiftLine extends ManualShift {
  readonly side: ManualShiftSide;
}

/** Two working shifts at once (double booking), the earlier first. */
export interface ManualDoubleLine {
  readonly key: string;
  readonly date: string;
  readonly first: { readonly team: string | null; readonly type: string };
  readonly second: { readonly team: string | null; readonly type: string };
}

/** Working shifts joined with no rest: one duty, FR-26's total. */
export interface ManualRestGapLine {
  readonly key: string;
  readonly date: string;
  readonly totalMinutes: number;
}

/** A date the save puts a working shift over the member's existing leave: a new conflict *Za odluku* lists (story 21.7). */
export interface ManualNewConflict {
  readonly key: string;
  readonly date: string;
}

/** One member's block of *Što se mijenja*. */
export interface ManualMemberPreview {
  readonly memberId: string;
  readonly name: string;
  readonly shifts: readonly ManualShiftLine[];
  readonly moreShifts: number;
  readonly doubles: readonly ManualDoubleLine[];
  readonly restGaps: readonly ManualRestGapLine[];
  readonly newConflicts: readonly ManualNewConflict[];
}

/** A roster override that applies before and no longer would: kept, listed (the admin removes it in *Kalendar*). */
export interface ManualInertLine {
  readonly key: string;
  readonly date: string;
  readonly team: string;
  /** The member taken off (`name: null` for one the read does not name), or `null` for none. */
  readonly out: { readonly name: string | null } | null;
  readonly in: { readonly name: string | null } | null;
}

export interface ManualPreview {
  /** The members whose days change, by name; a member with nothing to say is left out. */
  readonly members: readonly ManualMemberPreview[];
  readonly inert: readonly ManualInertLine[];
}

/** Every date from `from` to `to`, both included. */
function datesBetween(from: string, to: string): readonly string[] {
  const dates: string[] = [];

  for (let date: string | null = from; date !== null && date <= to; date = nextIsoDate(date)) dates.push(date);

  return dates;
}

/** `count` dates stepping from `date` (not included). */
function reach(date: string, step: (date: string) => string | null, count: number): readonly string[] {
  const dates: string[] = [];

  for (let at = step(date), n = 0; at !== null && n < count; at = step(at), n += 1) dates.push(at);

  return dates;
}

/** The member's day on each of `dates` in `snapshot`, one derivation per month. */
function daysOf(snapshot: CalendarSnapshot, memberId: string, dates: readonly string[]): ReadonlyMap<string, MemberScheduleDay> {
  const member = snapshot.members.find((candidate) => candidate.id === memberId);

  if (member === undefined) throw new RangeError(`member ${memberId} is not in the snapshot`);

  const input = memberScheduleInputOf(snapshot, { memberId, memberships: member.memberships, statuses: member.statuses });
  const days = new Map<string, MemberScheduleDay>();

  for (const month of new Set(dates.map((date) => monthOf(date)))) {
    for (const day of memberScheduleOfMonth(input, month)) days.set(day.date, day);
  }

  return days;
}

/** The working shifts of a day, keyed `team|type` (a teamless one keyed by the empty team). */
function workingOf(
  snapshot: CalendarSnapshot,
  day: MemberScheduleDay | undefined,
): ReadonlyMap<string, { readonly teamId: string | null; readonly shiftTypeId: string }> {
  const working = new Map<string, { readonly teamId: string | null; readonly shiftTypeId: string }>();

  for (const shift of day?.shifts ?? []) {
    if (shift.shiftTypeId === null || !day?.active) continue;

    const type = snapshot.types.find((candidate) => candidate.id === shift.shiftTypeId);

    if (type?.isWorking !== true) continue;

    working.set(JSON.stringify([shift.teamId, shift.shiftTypeId]), { teamId: shift.teamId, shiftTypeId: shift.shiftTypeId });
  }

  return working;
}

function teamNameOf(snapshot: CalendarSnapshot, teamId: string | null): string | null {
  if (teamId === null) return null;

  const team = snapshot.teams.find((candidate) => candidate.id === teamId);

  if (team === undefined) throw new RangeError(`team ${teamId} is not in the snapshot`);

  return team.name;
}

function typeNameOf(snapshot: CalendarSnapshot, shiftTypeId: string): string {
  const type = snapshot.types.find((candidate) => candidate.id === shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the snapshot`);

  return type.name;
}

interface ManualLeg extends DutyLeg {
  readonly teamId: string | null;
  readonly shiftTypeId: string;
}

function legKeyOf(leg: ManualLeg): string {
  return JSON.stringify([leg.date, leg.teamId, leg.shiftTypeId]);
}

/** A snapshot's schedule input as `rosterOverridesMadeInertOf` reads it. */
function scheduleInputOf(snapshot: CalendarSnapshot): ScheduleInput {
  return { teamIds: snapshot.teams.map((team) => team.id), ...snapshotScheduleInputOf(snapshot) };
}

/**
 * One member's block over `window`: the working shifts lost and gained on
 * each date, by team and type; and, over the legs read
 * {@link MANUAL_DUTY_REACH_DAYS} days either side, every new double booking
 * and every new no-rest duty with a leg in `[from − 1, to + 1]`; and every new
 * leave conflict inside the window, with a team or none.
 */
function memberPreviewOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  memberId: string,
  window: { readonly from: string; readonly to: string },
  records: readonly OrganizationLeaveRecord[] | null,
): ManualMemberPreview {
  const covered = datesBetween(window.from, window.to);
  const edges = [previousIsoDate(window.from), nextIsoDate(window.to)].filter((date): date is string => date !== null);
  const reported = new Set([...covered, ...edges]);
  const span = [
    ...new Set([
      ...reach(window.from, previousIsoDate, MANUAL_DUTY_REACH_DAYS),
      ...covered,
      ...reach(window.to, nextIsoDate, MANUAL_DUTY_REACH_DAYS),
    ]),
  ].sort();
  const was = daysOf(before, memberId, span);
  const will = daysOf(after, memberId, span);
  const lines: ManualShiftLine[] = [];
  const shiftOf = (snapshot: CalendarSnapshot, teamId: string | null, shiftTypeId: string, date: string): ManualShift => {
    const type = snapshot.types.find((candidate) => candidate.id === shiftTypeId);

    if (type === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the snapshot`);

    return { date, team: teamNameOf(snapshot, teamId), type: type.name, range: typeRangeOn(type, date) };
  };

  for (const date of covered) {
    const lost = workingOf(before, was.get(date));
    const gained = workingOf(after, will.get(date));

    for (const [key, shift] of lost) {
      if (!gained.has(key)) lines.push({ side: MANUAL_LOST, ...shiftOf(before, shift.teamId, shift.shiftTypeId, date) });
    }
    for (const [key, shift] of gained) {
      if (!lost.has(key)) lines.push({ side: MANUAL_GAINED, ...shiftOf(after, shift.teamId, shift.shiftTypeId, date) });
    }
  }

  const legsOf = (snapshot: CalendarSnapshot, days: ReadonlyMap<string, MemberScheduleDay>): ManualLeg[] =>
    span.flatMap((date) =>
      [...workingOf(snapshot, days.get(date)).values()].flatMap((shift): ManualLeg[] => {
        const leg = shiftLegOn(snapshot, shift.shiftTypeId, date);

        return leg === null ? [] : [{ ...leg, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId }];
      }),
    );
  const pairKey = ([first, second]: readonly [ManualLeg, ManualLeg]): string => JSON.stringify([legKeyOf(first), legKeyOf(second)].sort());
  const dutyKey = (duty: { readonly legs: readonly ManualLeg[] }): string => JSON.stringify(duty.legs.map(legKeyOf));
  const inReported = (legs: readonly ManualLeg[]): boolean => legs.some((leg) => reported.has(leg.date));
  const legsBefore = legsOf(before, was);
  const legsAfter = legsOf(after, will);
  const pairsBefore = new Set(overlappingLegsOf(legsBefore).map(pairKey));
  const dutiesBefore = new Set(dutiesOf(legsBefore).map(dutyKey));
  const named = (leg: ManualLeg) => ({ team: teamNameOf(after, leg.teamId), type: typeNameOf(after, leg.shiftTypeId) });
  const doubles = overlappingLegsOf(legsAfter)
    .filter((pair) => inReported(pair) && !pairsBefore.has(pairKey(pair)))
    .map((pair): ManualDoubleLine => ({ key: pairKey(pair), date: pair[0].date, first: named(pair[0]), second: named(pair[1]) }));
  const restGaps = dutiesOf(legsAfter)
    .filter((duty) => inReported(duty.legs) && !dutiesBefore.has(dutyKey(duty)))
    .map((duty): ManualRestGapLine => ({ key: dutyKey(duty), date: (duty.legs[0] as ManualLeg).date, totalMinutes: duty.totalMinutes }));

  return {
    memberId,
    name: after.members.find((member) => member.id === memberId)?.name ?? '',
    shifts: lines.slice(0, MANUAL_SHOWN_SHIFTS),
    moreShifts: Math.max(lines.length - MANUAL_SHOWN_SHIFTS, 0),
    doubles,
    restGaps,
    newConflicts: records === null ? [] : newConflictsOf(before, after, memberId, window, records),
  };
}

/**
 * THE NEW CONFLICTS (story 21.4's gate, widened by story 21.7): every date in
 * `window` on which the "after" raises a conflict for `memberId` that
 * `before` did not — a working shift saved over their existing leave, with a
 * team or none. Said, never refused (R14.5 makes it a real conflict, and the
 * admin may mean it); since 21.7 *Za odluku* lists every one, and the line
 * says so.
 */
export function newConflictsOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  memberId: string,
  window: { readonly from: string; readonly to: string },
  records: readonly OrganizationLeaveRecord[],
): readonly ManualNewConflict[] {
  const own = records.filter((record) => record.memberId === memberId && record.from <= window.to && window.from <= record.to);

  if (own.length === 0) return [];

  // By key, so a shift moved from one team to another on a date still on leave is a new conflict too.
  const conflicts = (snapshot: CalendarSnapshot): ReadonlyMap<string, string> =>
    new Map(
      collisionsOf(collisionInputOf(snapshot, own))
        .filter((collision) => collision.date >= window.from && collision.date <= window.to)
        .map((collision) => [collisionKeyOf(collision), collision.date]),
    );
  const was = conflicts(before);

  return [...new Set([...conflicts(after)].filter(([key]) => !was.has(key)).map(([, date]) => date))]
    .sort()
    .map((date) => ({ key: date, date }));
}

/**
 * *Što se mijenja* of a save: a block per drafted member (by name, a member
 * with nothing to say left out), and the roster overrides in force in the
 * window that apply before and not after (`rosterOverridesMadeInertOf`),
 * listed and kept. `records` is the organization's leave as freshly read, or
 * `null` when it is not known (then no new-conflict line is said).
 *
 * @throws RangeError on any precondition of the domain's derivations, or a
 *   member, team or shift type the snapshots lack.
 */
export function manualPreviewOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  memberIds: readonly string[],
  window: { readonly from: string; readonly to: string },
  records: readonly OrganizationLeaveRecord[] | null,
): ManualPreview {
  const members = memberIds
    .map((memberId) => memberPreviewOf(before, after, memberId, window, records))
    .filter(
      (block) =>
        block.shifts.length > 0 || block.doubles.length > 0 || block.restGaps.length > 0 || block.newConflicts.length > 0,
    )
    .sort((first, second) => compareText(first.name, second.name));
  const names = new Map(before.members.map((member) => [member.id, member.name]));
  const inert = rosterOverridesMadeInertOf(scheduleInputOf(before), scheduleInputOf(after), window.from, window.to).map(
    (override): ManualInertLine => ({
      key: override.id,
      date: override.date,
      team: teamNameOf(before, override.teamId) ?? '',
      out: override.memberOutId === null ? null : { name: names.get(override.memberOutId) ?? null },
      in: override.memberInId === null ? null : { name: names.get(override.memberInId) ?? null },
    }),
  );

  return { members, inert };
}

/** A shift line's key: lost or gained, with a team or *bez tima*, with its range or without. */
export function manualShiftMessageKey(
  line: ManualShiftLine,
):
  | 'rucniRaspored.preview.lost'
  | 'rucniRaspored.preview.lostNoRange'
  | 'rucniRaspored.preview.lostNoTeam'
  | 'rucniRaspored.preview.lostNoTeamNoRange'
  | 'rucniRaspored.preview.gained'
  | 'rucniRaspored.preview.gainedNoRange'
  | 'rucniRaspored.preview.gainedNoTeam'
  | 'rucniRaspored.preview.gainedNoTeamNoRange' {
  if (line.side === MANUAL_LOST) {
    if (line.team === null) return line.range === null ? 'rucniRaspored.preview.lostNoTeamNoRange' : 'rucniRaspored.preview.lostNoTeam';

    return line.range === null ? 'rucniRaspored.preview.lostNoRange' : 'rucniRaspored.preview.lost';
  }

  if (line.team === null) return line.range === null ? 'rucniRaspored.preview.gainedNoTeamNoRange' : 'rucniRaspored.preview.gainedNoTeam';

  return line.range === null ? 'rucniRaspored.preview.gainedNoRange' : 'rucniRaspored.preview.gained';
}

/** A date as a line reads it: `čet` and `01.10.` (the ISO date only for one that cannot be formatted, which none here is). */
export function manualDateValuesOf(date: string): { readonly weekday: string; readonly date: string } {
  return { weekday: formatIsoWeekdayShortName(date) ?? date, date: formatIsoDayMonth(date) ?? date };
}

/** An inert override's key: by which sides it names. */
export function manualInertMessageKey(
  line: ManualInertLine,
): 'rucniRaspored.preview.inertSwap' | 'rucniRaspored.preview.inertOut' | 'rucniRaspored.preview.inertIn' {
  if (line.out !== null && line.in !== null) return 'rucniRaspored.preview.inertSwap';

  return line.out !== null ? 'rucniRaspored.preview.inertOut' : 'rucniRaspored.preview.inertIn';
}
