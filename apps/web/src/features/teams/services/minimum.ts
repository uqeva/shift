import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, dayMonthOf } from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf } from '@/features/conflicts/services/erasures';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { enteredMinimumMembers } from '@/features/organization/utils/minimum-members';
import {
  SHORT_STAFFED_KNOWN,
  SHORT_STAFFED_UNKNOWN,
  horizonWindowOf,
  shortStaffedReportOf,
  type ShortStaffedReport,
  type StaffingWindow,
} from '@/features/staffing/services/short-staffed';

/**
 * A TEAM'S OWN MINIMUM (story 21.20; AD-27, R10.2 as amended, UX-DR79): the
 * team dialog's *Najmanje ljudi*, empty meaning the organization's.
 *
 * THE CHECK BEFORE THE WRITE (AD-5 as amended 2026-11-26, story 21.20): the
 * three fresh core reads (`useErasureReads`), and the calendar with the team's
 * minimum changed ({@link teamMinimumAppliedOf}). It derives:
 *
 *   - THE ERASURES from the organization's today, as every guarded write
 *     does. A collision is a leave over a working shift and reads no minimum,
 *     so a minimum change erases none; were one ever derived, the check is
 *     unavailable and nothing is written, rather than an erasure written
 *     unconfirmed.
 *   - *ŠTO SE MIJENJA*: the shifts the new minimum makes short-staffed and the
 *     ones it clears, from today over {@link horizonWindowOf}'s year, both by
 *     the domain's `newlyShortStaffedOf` (the second with the sides swapped).
 *     The minimum is current-state (AD-2): past dates change too, which the
 *     preview says and never lists.
 *
 * WHEN IT IS SHOWN: only when the change creates or clears a short-staffed
 * shift, or the report cannot be derived (its neutral line). Otherwise the
 * write goes at once. Nothing here blocks on a short-staffed shift (R10.4),
 * and nothing notifies (E-3).
 *
 * THE WRITE: `teams.update({ minimum_members })` by id and the fresh reads'
 * organization, of a live team only;
 * zero rows is stale, 23514 by `teams_minimum_members_check` the field, 42501
 * refused. Codes, never messages: {@link teamMinimumMessageKey} is the edge.
 */

/** The field's value is no whole number from 1 (nor empty). */
export const TEAM_MINIMUM_INVALID = 'invalid';
/** The team is not what the screen showed (gone, archived, or the row stale): nothing is written. */
export const TEAM_MINIMUM_STALE = 'stale';
/** The database refused the write outright (42501). */
export const TEAM_MINIMUM_REFUSED = 'refused';
/** The service, not the person: try again. */
export const TEAM_MINIMUM_UNAVAILABLE = 'unavailable';
/** The check could not be derived (a read failed): nothing was written. */
export const TEAM_MINIMUM_UNCHECKED = 'unchecked';

/** What the check refuses: only a stale team (the field's own refusal comes before any read). */
export type TeamMinimumRefusal = typeof TEAM_MINIMUM_STALE;

export type TeamMinimumFailure =
  | TeamMinimumRefusal
  | typeof TEAM_MINIMUM_INVALID
  | typeof TEAM_MINIMUM_REFUSED
  | typeof TEAM_MINIMUM_UNAVAILABLE
  | typeof TEAM_MINIMUM_UNCHECKED;

/** What the field asks: the team, and its minimum (`null`: the organization's). */
export interface TeamMinimumChange {
  readonly teamId: string;
  readonly value: number | null;
}

/** The field as typed, or its refusal before anything is read or sent. */
export function enteredTeamMinimumOf(
  teamId: string,
  value: FormDataEntryValue | null,
): { readonly ok: true; readonly change: TeamMinimumChange } | { readonly ok: false; readonly code: typeof TEAM_MINIMUM_INVALID } {
  const entered = enteredMinimumMembers(value);

  return entered.ok ? { ok: true, change: { teamId, value: entered.value } } : { ok: false, code: TEAM_MINIMUM_INVALID };
}

/**
 * The calendar with `change` applied — a new object, so every per-snapshot
 * memo is worked out afresh for it — `null` when the team already holds that
 * minimum (nothing to write), or stale when the team is gone or archived.
 */
export function teamMinimumAppliedOf(
  calendar: CalendarSnapshot,
  change: TeamMinimumChange,
): { readonly ok: true; readonly after: CalendarSnapshot | null } | { readonly ok: false; readonly code: typeof TEAM_MINIMUM_STALE } {
  const team = calendar.teams.find((candidate) => candidate.id === change.teamId);

  if (team === undefined || team.archived) return { ok: false, code: TEAM_MINIMUM_STALE };
  if (team.minimumMembers === change.value) return { ok: true, after: null };

  return {
    ok: true,
    after: {
      ...calendar,
      teams: calendar.teams.map((candidate) => (candidate.id === team.id ? { ...candidate, minimumMembers: change.value } : candidate)),
    },
  };
}

/** One shift the new minimum no longer leaves short: `Smjena B, 14.10. Dan`. */
export interface ClearedShiftRow {
  readonly key: string;
  readonly teamName: string;
  readonly dayMonth: string;
  readonly shiftTypeName: string;
}

/** The cleared shifts, as the block lists them: the first rows and how many more, or unknown. */
export type ClearedReport =
  | { readonly kind: typeof SHORT_STAFFED_KNOWN; readonly rows: readonly ClearedShiftRow[]; readonly more: number }
  | { readonly kind: typeof SHORT_STAFFED_UNKNOWN };

/** What the fresh check derived. */
export interface TeamMinimumCheckReady {
  readonly kind: typeof CHECK_READY;
  /** The shifts the new minimum makes short-staffed, from today on; `null` when no minimum applies after. */
  readonly shortStaffed: ShortStaffedReport | null;
  /** The shifts it no longer leaves short, from today on; `null` when none applied before. */
  readonly cleared: ClearedReport | null;
  /** The window both were derived over: today and the year after. */
  readonly window: StaffingWindow;
  /** The fresh calendar's organization: the write's tenant. */
  readonly organizationId: string;
  /** Nothing to write: the team already holds the minimum asked. */
  readonly unchanged: boolean;
  /** The change the check stood on: the write sends exactly it. */
  readonly change: TeamMinimumChange;
}

export type TeamMinimumCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: TeamMinimumRefusal }
  | TeamMinimumCheckReady;

/** The report's rows as cleared rows: the same shifts, said without a count. */
function clearedOf(report: ShortStaffedReport | null): ClearedReport | null {
  if (report === null || report.kind === SHORT_STAFFED_UNKNOWN) return report;

  return {
    kind: SHORT_STAFFED_KNOWN,
    rows: report.rows.map((row) => ({ key: row.key, teamName: row.teamName, dayMonth: row.dayMonth, shiftTypeName: row.shiftTypeName })),
    more: report.more,
  };
}

/** The check's decision over reads already fetched (see the module's header). `today` is the organization's. */
export function teamMinimumCheckFromReads(reads: ErasureReads, change: TeamMinimumChange, today: string): TeamMinimumCheck {
  const { calendar, records, resolutions } = reads;
  const applied = teamMinimumAppliedOf(calendar, change);

  if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };

  const window = horizonWindowOf(today);
  const common = { kind: CHECK_READY, window, organizationId: calendar.organizationId, change } as const;

  if (applied.after === null) return { ...common, shortStaffed: null, cleared: null, unchanged: true };

  const { after } = applied;
  // AD-5: the erasures from today. A minimum reads into no collision, so there are none (see the header).
  const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, after, today, records, resolutions));

  if (!outcome.ok) return { kind: CHECK_UNAVAILABLE };
  if (outcome.rows.length > 0) {
    console.error(TEAM_MINIMUM_UNCHECKED, 'a minimum change derived an erasure');

    return { kind: CHECK_UNAVAILABLE };
  }

  const leave = organizationLeaveRecordsOf(
    records,
    calendar.members.map((member) => member.id),
  );

  return {
    ...common,
    shortStaffed: shortStaffedReportOf({ calendar, records: leave }, { calendar: after, records: leave }, window),
    cleared: clearedOf(shortStaffedReportOf({ calendar: after, records: leave }, { calendar, records: leave }, window)),
    unchanged: false,
  };
}

/** THE CHECK, over `read`'s fresh answer, today the organization's at `now`. Never throws. */
export function teamMinimumCheckOf(
  read: () => Promise<ErasureReads>,
  change: TeamMinimumChange,
  now: Date,
  online: boolean,
): Promise<TeamMinimumCheck> {
  return checkedOf(read, (reads) => teamMinimumCheckFromReads(reads, change, calendarTodayOf(reads.calendar, now)), online);
}

/** Whether a report says something: its neutral line, or a row. */
function saysSomething(report: { readonly kind: string; readonly rows?: readonly unknown[] } | null): boolean {
  return report !== null && (report.kind === SHORT_STAFFED_UNKNOWN || (report.rows ?? []).length > 0);
}

/**
 * Whether *Što se mijenja* is shown: the change creates or clears a
 * short-staffed shift, or cannot say. A shift short before and after (its
 * minimum changed, its people not) is neither: it is not listed, and the save
 * goes at once — its mark stays, only its `od najmanje n` follows.
 */
export function teamMinimumPreviewShownOf(check: TeamMinimumCheckReady): boolean {
  return !check.unchanged && (saysSomething(check.shortStaffed) || saysSomething(check.cleared));
}

/** What *Što se mijenja* says, as one comparable key: a stale preview is never written unseen. */
export function teamMinimumPreviewKeyOf(check: Pick<TeamMinimumCheckReady, 'shortStaffed' | 'cleared' | 'window' | 'change' | 'unchanged'>): string {
  return JSON.stringify([check.shortStaffed, check.cleared, check.window, check.change, check.unchanged]);
}

/** The preview's *Spremi* over the fresh check: the same preview is written, a changed one shown again. */
export function teamMinimumConfirmedOf(shown: TeamMinimumCheckReady, ready: TeamMinimumCheckReady): boolean {
  return teamMinimumPreviewKeyOf(shown) === teamMinimumPreviewKeyOf(ready);
}

/** `14.10.` of a window's first date: the preview's "from today on". */
export function teamMinimumWindowFromOf(check: Pick<TeamMinimumCheckReady, 'window'>): string {
  return dayMonthOf(check.window.from);
}

// ----------------------------------------------------------------- the write

export interface TeamMinimumWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface TeamMinimumWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: TeamMinimumWriteError | null;
}

/** The one call on `teams`: the minimum's update by id, of a live team only. */
export interface TeamMinimumTable {
  update(values: Readonly<Record<string, unknown>>): {
    eq(column: string, value: string): {
      eq(column: string, value: string): { eq(column: string, value: boolean): { select(columns: string): PromiseLike<TeamMinimumWriteAnswer> } };
    };
  };
}

export type TeamMinimumWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly code: TeamMinimumFailure };

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';
/** 0082's constraint, as PostgreSQL quotes it in `message`. */
const MINIMUM_CHECK = '"teams_minimum_members_check"';

/** A PostgREST refusal as this module's failure: 0082's check the field, 42501 refused, anything else the service. */
export function teamMinimumWriteFailureOf(error: TeamMinimumWriteError): TeamMinimumFailure {
  if (error.code === CHECK_VIOLATION && (error.message ?? '').includes(MINIMUM_CHECK)) return TEAM_MINIMUM_INVALID;
  if (error.code === INSUFFICIENT_PRIVILEGE) return TEAM_MINIMUM_REFUSED;

  return TEAM_MINIMUM_UNAVAILABLE;
}

/**
 * Write what the check stood on: `minimum_members` of the live team by id.
 * Zero rows (the team archived or gone meanwhile) is stale. Nothing is notified.
 */
export async function writeTeamMinimum(
  table: TeamMinimumTable,
  organizationId: string,
  change: TeamMinimumChange,
): Promise<TeamMinimumWriteOutcome> {
  let answered: TeamMinimumWriteAnswer;

  try {
    answered = await table
      .update({ minimum_members: change.value })
      .eq('id', change.teamId)
      // The fresh reads' own tenant, beside the policy's.
      .eq('organization_id', organizationId)
      .eq('archived', false)
      .select('id');
  } catch (cause) {
    console.error(TEAM_MINIMUM_UNAVAILABLE, cause);

    return { ok: false, code: TEAM_MINIMUM_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null || (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data))) {
    console.error(TEAM_MINIMUM_UNAVAILABLE, 'answer');

    return { ok: false, code: TEAM_MINIMUM_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = teamMinimumWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  if ((answered.data ?? []).length === 0) return { ok: false, code: TEAM_MINIMUM_STALE };

  return { ok: true };
}

/** The team dialog's words for a minimum failure. Exhaustive. */
export function teamMinimumMessageKey(
  failure: TeamMinimumFailure,
):
  | 'smjene.minimum.error.invalid'
  | 'smjene.minimum.error.stale'
  | 'smjene.minimum.error.refused'
  | 'smjene.minimum.error.saveUnavailable'
  | 'smjene.minimum.error.unchecked' {
  switch (failure) {
    case TEAM_MINIMUM_INVALID:
      return 'smjene.minimum.error.invalid';
    case TEAM_MINIMUM_STALE:
      return 'smjene.minimum.error.stale';
    case TEAM_MINIMUM_REFUSED:
      return 'smjene.minimum.error.refused';
    case TEAM_MINIMUM_UNAVAILABLE:
      return 'smjene.minimum.error.saveUnavailable';
    case TEAM_MINIMUM_UNCHECKED:
      return 'smjene.minimum.error.unchecked';
  }
}
