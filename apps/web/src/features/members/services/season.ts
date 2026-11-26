import {
  REQUEST_PENDING,
  organizationLeaveRequestsOf,
  type ReviewedLeaveRequest,
} from '@/features/leave/services/leave-request-list';
import {
  memberActiveFrom,
  type MemberListRow,
  type MemberStatusVersion,
} from '@/features/members/services/list';
import {
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
  type PostgrestFailure,
} from '@/features/members/services/wire';
import { MEMBER_CHANGE_SEASON, type MemberChange } from '@/features/members/services/member-erasures';
import { isIsoDate, nextIsoDate } from '@/lib/i18n/format';

/**
 * A SEASON SET IN ONE STEP (story 21.11; AD-26 *Seasons*, R16.5): the status
 * versions that make a member active from a season's first day to its last,
 * and inactive outside it, written as ONE PostgREST insert of every row.
 *
 * `0085` admits a version dated after a scheduled one while the history still
 * alternates: each row is dated after the one before it and changes the state
 * it follows. So the rows are, from the member's latest state:
 *
 * - ACTIVE before the season and the season later than the earliest date the
 *   history admits: INACTIVE from that earliest date ("inactive until the
 *   start"), then ACTIVE from the start;
 * - ACTIVE and the season starting on that earliest date: nothing before it
 *   (they are active already);
 * - INACTIVE before the season: ACTIVE from the start;
 * - and always INACTIVE from the day after the season's last day.
 *
 * The earliest date is the later of the organization's today and the day
 * after the member's latest version (versions append in date order). Every
 * rule of the write is the database's; this module only names what it will
 * be sent, what it refuses first, and what its answer means. Renders nothing
 * and declares no key but its own refusals' (AD-15).
 */

/** No start or no end entered, or one that is no date. */
export const SEASON_DATES_MISSING = 'SEASON_DATES_MISSING';
/** The start is before the organization's today. */
export const SEASON_START_PAST = 'SEASON_START_PAST';
/** The start is on or before the member's latest version (a scheduled change). */
export const SEASON_START_BEFORE_SCHEDULED = 'SEASON_START_BEFORE_SCHEDULED';
/** The end is before the start. */
export const SEASON_END_BEFORE_START = 'SEASON_END_BEFORE_START';
/** The end is the last date a version can name, so nothing can follow it. */
export const SEASON_END_TOO_LATE = 'SEASON_END_TOO_LATE';

export type SeasonEntryRefusal =
  | typeof SEASON_DATES_MISSING
  | typeof SEASON_START_PAST
  | typeof SEASON_START_BEFORE_SCHEDULED
  | typeof SEASON_END_BEFORE_START
  | typeof SEASON_END_TOO_LATE;

/** What a written season can come back refused as. */
export type SeasonWriteFailure =
  | SeasonEntryRefusal
  | typeof MEMBER_STATUS_SELF
  | typeof MEMBER_STATUS_DATE_TAKEN
  | typeof MEMBER_STATUS_STALE
  | typeof ORGANIZATION_WOULD_HAVE_NO_ADMIN
  | typeof MEMBER_WRITE_INVALID
  | typeof MEMBER_WRITE_UNAVAILABLE;

/** One status version the season writes. */
export type SeasonRow = MemberStatusVersion;

export type SeasonPlan =
  | { readonly ok: true; readonly rows: readonly SeasonRow[] }
  | { readonly ok: false; readonly code: SeasonEntryRefusal };

/**
 * The earliest date a season may start for a member with `versions` (in date
 * order): the later of `today` and the day after the latest version, or
 * `null` when the latest is on the last date a version can name.
 */
export function seasonEarliestOf(versions: readonly MemberStatusVersion[], today: string): string | null {
  const latest = versions[versions.length - 1];

  if (latest === undefined) return today;

  const after = nextIsoDate(latest.effectiveFrom);

  if (after === null) return null;

  return after > today ? after : today;
}

/**
 * The rows a season from `start` to `end` (both included, ISO dates) writes
 * for a member whose versions are `versions` (in date order), as at the
 * organization's `today`, or the refusal it already earns.
 */
export function seasonPlanOf(
  versions: readonly MemberStatusVersion[],
  today: string,
  start: string,
  end: string,
): SeasonPlan {
  if (!isIsoDate(start) || !isIsoDate(end)) return { ok: false, code: SEASON_DATES_MISSING };
  if (start < today) return { ok: false, code: SEASON_START_PAST };

  const earliest = seasonEarliestOf(versions, today);

  if (earliest === null || start < earliest) return { ok: false, code: SEASON_START_BEFORE_SCHEDULED };
  if (end < start) return { ok: false, code: SEASON_END_BEFORE_START };

  const after = nextIsoDate(end);

  if (after === null) return { ok: false, code: SEASON_END_TOO_LATE };

  const activeBefore = versions[versions.length - 1]?.active ?? true;
  const rows: SeasonRow[] = [];

  if (!activeBefore) rows.push({ active: true, effectiveFrom: start });
  else if (start > earliest) rows.push({ active: false, effectiveFrom: earliest }, { active: true, effectiveFrom: start });

  rows.push({ active: false, effectiveFrom: after });

  return { ok: true, rows };
}

/** The first inactive row's date: the day from which the season first leaves the member out. */
export function seasonFirstOutOf(rows: readonly SeasonRow[]): string | null {
  return rows.find((row) => !row.active)?.effectiveFrom ?? null;
}

/**
 * Whether the season would leave some date with no active admin, by the
 * list's reading (`0008`'s rule): a target ADMIN made inactive from a date
 * needs another admin active on every date from it on. The first inactive
 * row decides it: the rule from a later one asks less.
 */
export function seasonLeavesNoAdmin(
  target: MemberListRow,
  members: readonly MemberListRow[],
  rows: readonly SeasonRow[],
): boolean {
  const out = seasonFirstOutOf(rows);

  if (target.role !== 'admin' || out === null) return false;

  return !members.some(
    (candidate) => candidate.role === 'admin' && candidate.id !== target.id && memberActiveFrom(candidate, out),
  );
}

/**
 * The member's pending leave requests the season's inactive rows close
 * (0041's trigger, whole): a request is closed by an inactive row when it
 * reaches that row's date or later and starts before the next row (a later
 * version governs what lies wholly after it). `null` — the dialog names
 * none — while the read is not answered or cannot be trusted. Never a gate.
 */
export function seasonClosedRequestsOf(
  read: readonly unknown[] | null,
  memberId: string,
  rows: readonly SeasonRow[],
): readonly ReviewedLeaveRequest[] | null {
  if (read === null) return null;

  const requests = organizationLeaveRequestsOf(read);

  if (requests === null) return null;

  return requests.filter(
    (request) =>
      request.memberId === memberId &&
      request.status === REQUEST_PENDING &&
      rows.some((row, index) => {
        if (row.active || request.to < row.effectiveFrom) return false;

        const following = rows[index + 1];

        return following === undefined || request.from < following.effectiveFrom;
      }),
  );
}

/** What a season's save checks and writes: its rows, and the guarded change they make. */
export interface SeasonAsk {
  readonly rows: readonly SeasonRow[];
  readonly change: MemberChange;
}

/**
 * The season `[start, end]` of `target` as *Spremi sezonu* sends it, judged at
 * the organization's `today` as at the save, or the refusal it earns first:
 * an unknown today, the caller's own row, the entry's refusals, the last-admin
 * rule — and rows other than the `shown` ones the dialog listed (a midnight or
 * a re-read moved them: the admin is told, never written past).
 */
export function seasonAskOf(
  target: MemberListRow,
  members: readonly MemberListRow[],
  callerAuthUserId: string | null,
  today: string | null,
  entered: { readonly start: string; readonly end: string; readonly shown: readonly SeasonRow[] | null },
): { readonly ok: true; readonly ask: SeasonAsk } | { readonly ok: false; readonly code: SeasonWriteFailure } {
  if (today === null || callerAuthUserId === null) return { ok: false, code: MEMBER_WRITE_UNAVAILABLE };
  if (target.authUserId === callerAuthUserId) return { ok: false, code: MEMBER_STATUS_SELF };

  const planned = seasonPlanOf(target.statusVersions, today, entered.start, entered.end);

  if (!planned.ok) return planned;

  const first = planned.rows[0];
  const same =
    entered.shown !== null &&
    entered.shown.length === planned.rows.length &&
    entered.shown.every(
      (row, index) => row.active === planned.rows[index]?.active && row.effectiveFrom === planned.rows[index]?.effectiveFrom,
    );

  if (first === undefined || !same) return { ok: false, code: MEMBER_STATUS_STALE };
  if (seasonLeavesNoAdmin(target, members, planned.rows)) return { ok: false, code: ORGANIZATION_WOULD_HAVE_NO_ADMIN };

  return {
    ok: true,
    ask: {
      rows: planned.rows,
      change: { kind: MEMBER_CHANGE_SEASON, memberId: target.id, day: first.effectiveFrom, versions: planned.rows },
    },
  };
}

/** The rows as the insert sends them: the four columns a session may name. */
export function seasonInsertOf(
  organizationId: string,
  memberId: string,
  rows: readonly SeasonRow[],
): readonly Readonly<Record<string, unknown>>[] {
  return rows.map((row) => ({
    organization_id: organizationId,
    member_id: memberId,
    active: row.active,
    effective_from: row.effectiveFrom,
  }));
}

/** The one call a season makes: a multi-row insert, named structurally so it can be stubbed. */
export interface SeasonTable {
  insert(values: readonly Readonly<Record<string, unknown>>[]): PromiseLike<{ readonly error: PostgrestFailure | null }>;
}

/** Everything a refused season is read against: the member and the list as last drawn. */
export interface SeasonContext {
  readonly member: MemberListRow;
  readonly members: readonly MemberListRow[];
  readonly callerAuthUserId: string;
  readonly today: string;
}

/**
 * A refused season, as this application's failure. Every rule of `0085`'s
 * policy arrives as 42501, so it is read against what was sent: a refusal the
 * entry already earns on the list's history, the caller's own row, the
 * last-admin rule, else the list is behind the database (stale).
 */
export function seasonFailureOf(
  error: PostgrestFailure,
  rows: readonly SeasonRow[],
  start: string,
  end: string,
  context: SeasonContext,
): SeasonWriteFailure {
  if (error.code === '23505') return MEMBER_STATUS_DATE_TAKEN;
  if (`${error.message ?? ''} ${error.details ?? ''}`.includes(ORGANIZATION_WOULD_HAVE_NO_ADMIN)) {
    return ORGANIZATION_WOULD_HAVE_NO_ADMIN;
  }
  if (error.code === '42501') {
    if (context.member.authUserId === context.callerAuthUserId) return MEMBER_STATUS_SELF;

    const named = seasonPlanOf(context.member.statusVersions, context.today, start, end);

    if (!named.ok) return named.code;
    if (seasonLeavesNoAdmin(context.member, context.members, rows)) return ORGANIZATION_WOULD_HAVE_NO_ADMIN;

    return MEMBER_STATUS_STALE;
  }
  if (error.code !== undefined && ['22', '23'].includes(error.code.slice(0, 2))) return MEMBER_WRITE_INVALID;

  return MEMBER_WRITE_UNAVAILABLE;
}

export type SeasonWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly code: SeasonWriteFailure };

/**
 * The season's one insert. Nothing is sent without a row; a thrown call is
 * unavailable. `context` reads a refusal ({@link seasonFailureOf}); `null`
 * (a member just created, whose row the list does not hold yet) reads every
 * refusal as stale.
 */
export async function writeSeason(
  table: SeasonTable,
  organizationId: string,
  memberId: string,
  season: { readonly rows: readonly SeasonRow[]; readonly start: string; readonly end: string },
  context: SeasonContext | null,
): Promise<SeasonWriteOutcome> {
  if (season.rows.length === 0) return { ok: false, code: MEMBER_WRITE_INVALID };

  let error: PostgrestFailure | null;

  try {
    ({ error } = await table.insert(seasonInsertOf(organizationId, memberId, season.rows)));
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: MEMBER_WRITE_UNAVAILABLE };
  }

  if (error === null) return { ok: true };

  console.error(MEMBER_WRITE_UNAVAILABLE, error.code);

  if (context === null) {
    return { ok: false, code: error.code === '42501' ? MEMBER_STATUS_STALE : MEMBER_WRITE_UNAVAILABLE };
  }

  return { ok: false, code: seasonFailureOf(error, season.rows, season.start, season.end, context) };
}

/** The message key a season refusal is said with. */
export function seasonRefusalMessageKey(
  code: SeasonWriteFailure,
):
  | 'ljudi.season.error.dates'
  | 'ljudi.season.error.past'
  | 'ljudi.season.error.scheduled'
  | 'ljudi.season.error.order'
  | 'ljudi.season.error.tooLate'
  | 'ljudi.season.error.self'
  | 'ljudi.season.error.stale'
  | 'ljudi.season.error.lastAdmin'
  | 'ljudi.season.error.unavailable' {
  switch (code) {
    case SEASON_DATES_MISSING:
      return 'ljudi.season.error.dates';
    case SEASON_START_PAST:
      return 'ljudi.season.error.past';
    case SEASON_START_BEFORE_SCHEDULED:
      return 'ljudi.season.error.scheduled';
    case SEASON_END_BEFORE_START:
      return 'ljudi.season.error.order';
    case SEASON_END_TOO_LATE:
      return 'ljudi.season.error.tooLate';
    case MEMBER_STATUS_SELF:
      return 'ljudi.season.error.self';
    case MEMBER_STATUS_DATE_TAKEN:
    case MEMBER_STATUS_STALE:
      return 'ljudi.season.error.stale';
    case ORGANIZATION_WOULD_HAVE_NO_ADMIN:
      return 'ljudi.season.error.lastAdmin';
    case MEMBER_WRITE_INVALID:
    case MEMBER_WRITE_UNAVAILABLE:
      return 'ljudi.season.error.unavailable';
  }
}

/** Whether a refusal is the dates' to fix: focus goes back to the start. */
export function seasonRefusalIsDates(code: SeasonWriteFailure): boolean {
  return (
    code === SEASON_DATES_MISSING ||
    code === SEASON_START_PAST ||
    code === SEASON_START_BEFORE_SCHEDULED ||
    code === SEASON_END_BEFORE_START ||
    code === SEASON_END_TOO_LATE
  );
}

/** The line a written row is said with in the dialog. */
export function seasonRowMessageKey(row: SeasonRow): 'ljudi.season.rowActive' | 'ljudi.season.rowInactive' {
  return row.active ? 'ljudi.season.rowActive' : 'ljudi.season.rowInactive';
}
