import { effectiveTeamOn, scheduleOfMonth, type NationalHolidayCode } from '@shift/domain';

import type { CalendarHoliday, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  calendarTodayOf,
  rosterStandingOfCalendar,
  snapshotScheduleInputOf,
  workingShiftTypeIdsOf,
} from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import {
  HOLIDAY_TAKEN,
  enteredHolidayOf,
  importProposalOf,
  isPastDate,
  type EnteredHoliday,
  type HolidayDraftRefusal,
  type ImportProposal,
} from '@/features/holidays/services/holidays';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { manualDateValuesOf, manualPreviewOf, type ManualPreview } from '@/features/planning/services/manual-preview';
import {
  configurationReportOf,
  unknownReportOf,
  type ShortStaffedReport,
  type StaffingWindow,
} from '@/features/staffing/services/short-staffed';

/**
 * THE AD-5 CHECK OF A HOLIDAY WRITE (story 21.17; AD-27, AD-5 as amended
 * 2026-11-25): adding a holiday (*Dodaj blagdan*), importing the official
 * list (*Uvezi državne blagdane*), removing one (*Ukloni*), and changing a
 * team's *Ne radi na blagdane*. A rename changes no date and is exempt.
 *
 * FRESH READS, AN "AFTER" SNAPSHOT (21.16 Design Note 2): the three core reads
 * (`useErasureReads`), and the snapshot with the holidays added or removed,
 * or the team's flag flipped ({@link holidayChangeAppliedOf}). Every
 * derivation follows by construction: 21.16's recipe spreads the rule into
 * every input built from either side.
 *
 * WHAT IT SAYS: the erasures from the earliest changed date (the flag: the
 * earliest holiday) — the one thing that waits for a confirmation; *Što se
 * mijenja* (`manualPreviewOf` over every member the change can touch —
 * {@link touchedMemberIdsOf}; every other one has nothing to say — over the
 * window from the earliest to the latest changed date; the flag: every
 * holiday); the
 * short-staffed block; and the shifts each team off on holidays loses (or
 * gains back) on the changed dates ({@link offTeamLossesOf}). A changed date
 * before the organization's today is listed as past: a warning only.
 *
 * A holiday notifies nobody (E-3): nothing here enqueues anything. Never
 * throws: {@link holidayCheckOf} answers unavailable instead.
 */

/** A holiday added by hand. */
export const ASK_ADD = 'add';
/** The official list of a year imported: its missing dates added. */
export const ASK_IMPORT = 'import';
/** A holiday removed. */
export const ASK_REMOVE = 'remove';
/** A team's *Ne radi na blagdane* changed. */
export const ASK_FLAG = 'flag';

/** What a surface asks to check. */
export type HolidayAsk =
  | { readonly kind: typeof ASK_ADD; readonly date: string; readonly name: string }
  | { readonly kind: typeof ASK_IMPORT; readonly year: number }
  | { readonly kind: typeof ASK_REMOVE; readonly id: string; readonly date: string; readonly name: string }
  | { readonly kind: typeof ASK_FLAG; readonly teamId: string; readonly value: boolean };

/** Holidays added: one by hand (`year: null`), or an import's missing dates (`year`). */
export const CHANGE_ADD = 'add';
/** One holiday removed (its name is said, never sent). */
export const CHANGE_REMOVE = 'remove';
/** A team's flag set to `value`. */
export const CHANGE_FLAG = 'flag';

/** What the write sends: exactly what the check stood on. */
export type HolidayChange =
  | { readonly kind: typeof CHANGE_ADD; readonly holidays: readonly EnteredHoliday[]; readonly year: number | null }
  | { readonly kind: typeof CHANGE_REMOVE; readonly id: string; readonly date: string; readonly name: string }
  | { readonly kind: typeof CHANGE_FLAG; readonly teamId: string; readonly value: boolean };

/** The holiday or the team is not what the screen showed: nothing is written. */
export const HOLIDAY_STALE = 'stale';
/** The year's official list is all stored already: nothing is offered. */
export const HOLIDAY_NOTHING_NEW = 'nothingNew';
/** No import is offered for the year (before 2020). */
export const HOLIDAY_NO_IMPORT = 'noImport';

export type HolidayRefusal =
  | HolidayDraftRefusal
  | typeof HOLIDAY_STALE
  | typeof HOLIDAY_NOTHING_NEW
  | typeof HOLIDAY_NO_IMPORT;

/** The synthetic id of a holiday added in an "after" snapshot (never written). */
export function draftHolidayIdOf(date: string): string {
  return `draft-holiday-${date}`;
}

function byDate(left: { readonly date: string }, right: { readonly date: string }): number {
  return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
}

/**
 * The calendar with `change` applied — a new object, so every per-snapshot
 * memo (the holiday rule among them) is worked out afresh for it — or the
 * refusal when the snapshot no longer matches: an added date that already
 * holds a holiday is taken; a removed holiday the snapshot no longer holds, or
 * a team that is gone, archived or already in the asked state, is stale.
 */
export function holidayChangeAppliedOf(
  calendar: CalendarSnapshot,
  change: HolidayChange,
):
  | { readonly ok: true; readonly after: CalendarSnapshot }
  | { readonly ok: false; readonly code: typeof HOLIDAY_TAKEN | typeof HOLIDAY_STALE } {
  switch (change.kind) {
    case CHANGE_ADD: {
      const held = new Set(calendar.holidays.map((holiday) => holiday.date));

      if (change.holidays.some((holiday) => held.has(holiday.date))) return { ok: false, code: HOLIDAY_TAKEN };
      if (new Set(change.holidays.map((holiday) => holiday.date)).size !== change.holidays.length) {
        return { ok: false, code: HOLIDAY_TAKEN };
      }

      const added: CalendarHoliday[] = change.holidays.map((holiday) => ({ id: draftHolidayIdOf(holiday.date), ...holiday }));

      return { ok: true, after: { ...calendar, holidays: [...calendar.holidays, ...added].sort(byDate) } };
    }
    case CHANGE_REMOVE: {
      const known = calendar.holidays.some((holiday) => holiday.id === change.id && holiday.date === change.date);

      if (!known) return { ok: false, code: HOLIDAY_STALE };

      return { ok: true, after: { ...calendar, holidays: calendar.holidays.filter((holiday) => holiday.id !== change.id) } };
    }
    case CHANGE_FLAG: {
      const team = calendar.teams.find((candidate) => candidate.id === change.teamId);

      if (team === undefined || team.archived || team.offOnHolidays === change.value) return { ok: false, code: HOLIDAY_STALE };

      return {
        ok: true,
        after: {
          ...calendar,
          teams: calendar.teams.map((candidate) => (candidate.id === team.id ? { ...candidate, offOnHolidays: change.value } : candidate)),
        },
      };
    }
  }
}

/** The dates a change changes, by date: the added or removed ones; the flag's, every holiday's. */
export function changedDatesOf(calendar: Pick<CalendarSnapshot, 'holidays'>, change: HolidayChange): readonly string[] {
  switch (change.kind) {
    case CHANGE_ADD:
      return change.holidays.map((holiday) => holiday.date).sort();
    case CHANGE_REMOVE:
      return [change.date];
    case CHANGE_FLAG:
      return calendar.holidays.map((holiday) => holiday.date).sort();
  }
}

// ------------------------------------------------------- the teams' shifts

/** A team lost its shift on a changed date (a holiday emptied it), or gained it back. */
export const TEAM_LOST = 'lost';
export const TEAM_GAINED = 'gained';

/** One line of the teams' shifts: the team, the date and the working type. */
export interface HolidayTeamLine {
  readonly key: string;
  readonly side: typeof TEAM_LOST | typeof TEAM_GAINED;
  readonly teamId: string;
  readonly team: string;
  readonly date: string;
  readonly weekday: string;
  readonly dayMonth: string;
  readonly type: string;
}

/** Each active team's scheduled type on each of `dates`, from `scheduleOfMonth`'s cells (21.16's rule spread in). */
function scheduledTypesOf(calendar: CalendarSnapshot, teamIds: readonly string[], dates: readonly string[]): ReadonlyMap<string, string | null> {
  const types = new Map<string, string | null>();
  const wanted = new Set(dates);
  const input = { ...snapshotScheduleInputOf(calendar), teamIds };

  for (const month of [...new Set(dates.map((date) => date.slice(0, 7)))]) {
    for (const row of scheduleOfMonth(input, month)) {
      if (!wanted.has(row.date)) continue;

      for (const cell of row.cells) types.set(`${cell.teamId}|${row.date}`, cell.shiftTypeId);
    }
  }

  return types;
}

/**
 * Per active team and changed date, the WORKING type `before` schedules that
 * `after` does not (lost) and the one `after` schedules that `before` did not
 * (gained), by date then team. Only a team off on holidays on either side
 * changes, so these are the off teams' shifts. Names from `before` (an added
 * holiday changes no team or type).
 *
 * @throws RangeError on any precondition of the domain's derivation, or a type the snapshot lacks.
 */
export function offTeamLossesOf(before: CalendarSnapshot, after: CalendarSnapshot, dates: readonly string[]): readonly HolidayTeamLine[] {
  if (dates.length === 0) return [];

  const teams = before.teams.filter((team) => !team.archived);
  const teamIds = teams.map((team) => team.id);
  const was = scheduledTypesOf(before, teamIds, dates);
  const now = scheduledTypesOf(after, teamIds, dates);
  const working = new Set([...workingShiftTypeIdsOf(before), ...workingShiftTypeIdsOf(after)]);
  const typeName = (id: string): string => {
    const type = before.types.find((candidate) => candidate.id === id);

    if (type === undefined) throw new RangeError(`shift type ${id} is not in the snapshot`);

    return type.name;
  };
  const lines: HolidayTeamLine[] = [];

  for (const date of [...new Set(dates)].sort()) {
    const { weekday, date: dayMonth } = manualDateValuesOf(date);

    for (const team of teams) {
      const key = `${team.id}|${date}`;
      const from = was.get(key) ?? null;
      const to = now.get(key) ?? null;

      if (from === to) continue;
      if (from !== null && working.has(from)) {
        lines.push({ key: `${TEAM_LOST}|${key}`, side: TEAM_LOST, teamId: team.id, team: team.name, date, weekday, dayMonth, type: typeName(from) });
      }
      if (to !== null && working.has(to)) {
        lines.push({ key: `${TEAM_GAINED}|${key}`, side: TEAM_GAINED, teamId: team.id, team: team.name, date, weekday, dayMonth, type: typeName(to) });
      }
    }
  }

  return lines;
}

/**
 * The members a holiday change can touch: on a changed date, counted with a
 * team off on holidays on either side (their effective team, a loan
 * included), or named by a roster change of such a team that date. A holiday
 * empties only an off team's shifts and never an assignment (R13.2, R14.4),
 * so every other member's days are the same on both sides: *Što se mijenja*,
 * which leaves out a member with nothing to say, says the same over these
 * alone, and is derived for them alone.
 */
export function touchedMemberIdsOf(before: CalendarSnapshot, after: CalendarSnapshot, dates: readonly string[]): readonly string[] {
  const off = new Set([...before.teams, ...after.teams].filter((team) => team.offOnHolidays).map((team) => team.id));

  if (off.size === 0 || dates.length === 0) return [];

  const changed = new Set(dates);
  const named = new Set(
    rosterStandingOfCalendar(before)
      .inForce.filter((override) => off.has(override.teamId) && changed.has(override.date))
      .flatMap((override) => [override.memberOutId, override.memberInId])
      .filter((id): id is string => id !== null),
  );

  return before.members
    .filter(
      (member) =>
        named.has(member.id) ||
        dates.some((date) => {
          const team = effectiveTeamOn(member, date);

          return team !== null && off.has(team.teamId);
        }),
    )
    .map((member) => member.id);
}

// ---------------------------------------------------------------- check

/** What the fresh check derived. */
export interface HolidayCheckReady {
  readonly kind: typeof CHECK_READY;
  /** The erasures: only they wait for a confirmation. */
  readonly rows: readonly ErasureRow[];
  readonly preview: ManualPreview;
  readonly shortStaffed: ShortStaffedReport | null;
  /** The off teams' shifts lost or gained on the changed dates. */
  readonly teams: readonly HolidayTeamLine[];
  /** Every date the change changes, by date (the flag: every holiday). */
  readonly dates: readonly string[];
  /** The changed dates before the organization's today: warned, never refused. */
  readonly past: readonly string[];
  /**
   * The flag's past holidays left out of *Što se mijenja*, the off teams'
   * lines and the short-staffed block (their erasures still count): the
   * warning says those dates change too. `0` for every other change.
   */
  readonly pastNotPreviewed: number;
  /** How many teams are off on holidays on either side: with none, no shift changes. */
  readonly offTeams: number;
  /** The fresh calendar's organization: the write's tenant. */
  readonly organizationId: string;
  /** An import's proposal as freshly read; `null` for every other change. */
  readonly proposal: ImportProposal | null;
  /** The window *Što se mijenja* was derived over; `null` when it covers no date (no holiday, or every flag holiday past). */
  readonly window: StaffingWindow | null;
  /** The change the check stood on: the write sends exactly it. */
  readonly change: HolidayChange;
}

export type HolidayCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: HolidayRefusal }
  | HolidayCheckReady;

/** The change an ask makes against a fresh calendar, or its refusal. */
function changeOf(
  calendar: CalendarSnapshot,
  ask: HolidayAsk,
  today: string,
  nameOf: (code: NationalHolidayCode) => string,
):
  | { readonly ok: true; readonly change: HolidayChange; readonly proposal: ImportProposal | null }
  | { readonly ok: false; readonly code: HolidayRefusal } {
  switch (ask.kind) {
    case ASK_ADD: {
      const entered = enteredHolidayOf(calendar, ask.date, ask.name);

      if (!entered.ok) return entered;

      return { ok: true, change: { kind: CHANGE_ADD, holidays: [entered.holiday], year: null }, proposal: null };
    }
    case ASK_IMPORT: {
      const proposal = importProposalOf(calendar, ask.year, today, nameOf);

      if (proposal === null) return { ok: false, code: HOLIDAY_NO_IMPORT };
      if (proposal.missing.length === 0) return { ok: false, code: HOLIDAY_NOTHING_NEW };

      return {
        ok: true,
        change: {
          kind: CHANGE_ADD,
          holidays: proposal.missing.map(({ date, name }) => ({ date, name })),
          year: ask.year,
        },
        proposal,
      };
    }
    case ASK_REMOVE:
      return { ok: true, change: { kind: CHANGE_REMOVE, id: ask.id, date: ask.date, name: ask.name }, proposal: null };
    case ASK_FLAG:
      return { ok: true, change: { kind: CHANGE_FLAG, teamId: ask.teamId, value: ask.value }, proposal: null };
  }
}

/** The short-staffed block over `window`, or its neutral line when it cannot be derived (a `RangeError`). */
export function holidayShortStaffedOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  window: StaffingWindow,
  records: readonly unknown[],
): ShortStaffedReport | null {
  try {
    return configurationReportOf(before, after, window, { isPending: false, isError: false, data: records });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return unknownReportOf(cause);
  }
}

const NOTHING_PREVIEWED: ManualPreview = { members: [], inert: [] };

/** The teams off on holidays on either side of a change. */
function offTeamCountOf(before: CalendarSnapshot, after: CalendarSnapshot): number {
  return new Set([...before.teams, ...after.teams].filter((team) => team.offOnHolidays).map((team) => team.id)).size;
}

/** The check's decision over reads already fetched (see the module's header). `today` is the organization's. */
export function holidayCheckFromReads(
  reads: ErasureReads,
  ask: HolidayAsk,
  today: string,
  nameOf: (code: NationalHolidayCode) => string,
): HolidayCheck {
  const { calendar, records, resolutions } = reads;
  const decided = changeOf(calendar, ask, today, nameOf);

  if (!decided.ok) return { kind: CHECK_REFUSED, code: decided.code };

  const applied = holidayChangeAppliedOf(calendar, decided.change);

  if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };

  const { after } = applied;
  const dates = changedDatesOf(calendar, decided.change);
  const first = dates[0];

  if (first === undefined) {
    return {
      kind: CHECK_READY,
      rows: [],
      dates,
      past: [],
      pastNotPreviewed: 0,
      offTeams: offTeamCountOf(calendar, after),
      organizationId: calendar.organizationId,
      preview: NOTHING_PREVIEWED,
      shortStaffed: null,
      teams: [],
      proposal: decided.proposal,
      window: null,
      change: decided.change,
    };
  }

  // THE ERASURES FROM THE EARLIEST CHANGED DATE, past ones included: bounded by the leave there is (AD-5).
  const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, after, first, records, resolutions));

  if (!outcome.ok) return { kind: CHECK_UNAVAILABLE };

  const past = dates.filter((date) => isPastDate(date, today));
  // THE FLAG'S PREVIEW from today on: every holiday the organization ever stored would
  // otherwise be derived per member; the warning says the older ones change too.
  const previewed = decided.change.kind === CHANGE_FLAG ? dates.filter((date) => !isPastDate(date, today)) : dates;
  const from = previewed[0];
  const to = previewed.at(-1);
  const common = {
    kind: CHECK_READY,
    rows: outcome.rows,
    dates,
    past,
    pastNotPreviewed: dates.length - previewed.length,
    offTeams: offTeamCountOf(calendar, after),
    organizationId: calendar.organizationId,
    proposal: decided.proposal,
    change: decided.change,
  } as const;

  if (from === undefined || to === undefined) return { ...common, preview: NOTHING_PREVIEWED, shortStaffed: null, teams: [], window: null };

  const window: StaffingWindow = { from, to };
  const leave = organizationLeaveRecordsOf(
    records,
    calendar.members.map((member) => member.id),
  );

  return {
    ...common,
    preview: manualPreviewOf(calendar, after, touchedMemberIdsOf(calendar, after, previewed), window, leave),
    shortStaffed: holidayShortStaffedOf(calendar, after, window, records),
    teams: offTeamLossesOf(calendar, after, previewed),
    window,
  };
}

/** THE CHECK, over `read`'s fresh answer, today the organization's at `now`. Never throws. */
export function holidayCheckOf(
  read: () => Promise<ErasureReads>,
  ask: HolidayAsk,
  now: Date,
  online: boolean,
  nameOf: (code: NationalHolidayCode) => string,
): Promise<HolidayCheck> {
  return checkedOf(read, (reads) => holidayCheckFromReads(reads, ask, calendarTodayOf(reads.calendar, now), nameOf), online);
}

/** What *Što se mijenja* says, as one comparable key: a stale preview is never written unseen. */
export function holidayPreviewKeyOf(
  check: Pick<
    HolidayCheckReady,
    'preview' | 'shortStaffed' | 'teams' | 'past' | 'pastNotPreviewed' | 'offTeams' | 'proposal' | 'change' | 'rows' | 'window'
  >,
): string {
  return JSON.stringify([
    check.preview,
    check.shortStaffed,
    check.teams,
    check.past,
    check.pastNotPreviewed,
    check.offTeams,
    check.proposal,
    check.change,
    check.rows.map((row) => row.key),
    check.window,
  ]);
}

/** The preview changed since it was shown: shown again, and said so. */
export const CONFIRM_SHOW_AGAIN = 'again';
/** The same preview, with erasures: they wait for their own confirmation. */
export const CONFIRM_ERASURES = 'erasures';
/** The same preview, nothing erased: written at once. */
export const CONFIRM_WRITE = 'write';

export type HolidayConfirmStep = typeof CONFIRM_SHOW_AGAIN | typeof CONFIRM_ERASURES | typeof CONFIRM_WRITE;

/**
 * *Što se mijenja*'s *Spremi*, over the fresh check `ready` and the preview
 * `shown`: a changed preview is shown again (never written unseen); the same
 * one waits for its erasures' confirmation, or is written. Both surfaces
 * (the *Blagdani* card and the team dialog) decide through this.
 */
export function holidayConfirmStepOf(shown: HolidayCheckReady, ready: HolidayCheckReady): HolidayConfirmStep {
  if (holidayPreviewKeyOf(ready) !== holidayPreviewKeyOf(shown)) return CONFIRM_SHOW_AGAIN;

  return ready.rows.length > 0 ? CONFIRM_ERASURES : CONFIRM_WRITE;
}
