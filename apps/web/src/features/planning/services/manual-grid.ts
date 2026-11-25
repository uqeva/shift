import {
  PERSONAL_ASSIGNMENT_OFF,
  PERSONAL_ASSIGNMENT_SHIFT,
  activeOn,
  datesOfMonth,
  memberScheduleOfMonth,
  membershipOn,
  type MemberScheduleDay,
  type PersonalAssignment,
} from '@shift/domain';

import type { CalendarMember, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, snapshotScheduleInputOf, typeLettersOf } from '@/features/calendar/utils/month';
import { compareText, formatIsoDayMonth, formatIsoWeekdayShortName } from '@/lib/i18n/format';

/**
 * *RUČNI RASPORED* (story 21.4; UX-DR72, UX-DR73; R14; AD-26): the month as a
 * grid of people by dates, and the DRAFT the admin edits it through, as a
 * `.ts` the node suite executes (AD-15). Codes, ids and dates only; the
 * screen words them from `hr.json`'s `rucniRaspored`.
 *
 * ONE "AFTER" ({@link draftAppliedOf}): the calendar snapshot with the draft
 * applied to each drafted member's `personalAssignments`. The cells draw it
 * through `memberScheduleOfMonth`, and *Što se mijenja* and the erasure check
 * (`manual-save`) derive from the same function over the fresh read, so the
 * grid holds no rule of its own (AD-7): an assignment's day, the counted team
 * and an inactive date are R14's, as the domain decides them.
 *
 * THE DRAFT holds only what differs from the live rows ({@link draftWith}): a
 * cell set back to what is stored leaves it, so the count on the save bar is
 * the number of items the save sends, and 0077 is never asked to write an item
 * equal to its live row (21.2 Design Note 3).
 */

/** A drafted cell: a shift type (working or not, optionally counted with a team), a day off, or no assignment. */
export type ManualValue =
  | { readonly kind: typeof PERSONAL_ASSIGNMENT_SHIFT; readonly shiftTypeId: string; readonly teamId: string | null }
  | { readonly kind: typeof PERSONAL_ASSIGNMENT_OFF }
  | { readonly kind: typeof MANUAL_CLEAR };

/** *Očisti*: the cell has no assignment; the member's schedule source decides the day again. */
export const MANUAL_CLEAR = 'CLEAR';

/** One cell of the grid: a member on a date. */
export interface ManualCellRef {
  readonly memberId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

/** The draft, by {@link draftKeyOf}. */
export type ManualDraft = ReadonlyMap<string, ManualDraftCell>;

export interface ManualDraftCell extends ManualCellRef {
  readonly value: ManualValue;
}

/** The draft's key of a cell. */
export function draftKeyOf(cell: ManualCellRef): string {
  return `${cell.memberId}\u0000${cell.date}`;
}

/** The empty draft. */
export const NO_DRAFT: ManualDraft = new Map();

/** The member's live assignment on `date` in `snapshot`, or `null`. */
export function liveAssignmentOf(snapshot: CalendarSnapshot, cell: ManualCellRef): PersonalAssignment | null {
  const member = snapshot.members.find((candidate) => candidate.id === cell.memberId);

  return member?.personalAssignments.find((assignment) => assignment.date === cell.date) ?? null;
}

/** Whether `value` is what the live row already says (or, for a clear, that there is none). */
export function sameAsLive(live: PersonalAssignment | null, value: ManualValue): boolean {
  switch (value.kind) {
    case MANUAL_CLEAR:
      return live === null;
    case PERSONAL_ASSIGNMENT_OFF:
      return live?.kind === PERSONAL_ASSIGNMENT_OFF;
    case PERSONAL_ASSIGNMENT_SHIFT:
      return (
        live?.kind === PERSONAL_ASSIGNMENT_SHIFT &&
        live.shiftTypeId === value.shiftTypeId &&
        (live.teamId ?? null) === value.teamId
      );
  }
}

/**
 * The draft with `value` set on every one of `cells` — or, where it equals
 * the live row, with that cell left out. A new map.
 */
export function draftWith(
  snapshot: CalendarSnapshot,
  draft: ManualDraft,
  cells: readonly ManualCellRef[],
  value: ManualValue,
): ManualDraft {
  const next = new Map(draft);

  for (const cell of cells) {
    const key = draftKeyOf(cell);

    if (sameAsLive(liveAssignmentOf(snapshot, cell), value)) next.delete(key);
    else next.set(key, { memberId: cell.memberId, date: cell.date, value });
  }

  return next;
}

/**
 * The draft against a newer read: every cell still differing from the live
 * rows, the others left out (a landed save, or another admin's, has made them
 * equal). The same map when nothing drops out.
 */
export function draftAgainst(snapshot: CalendarSnapshot, draft: ManualDraft): ManualDraft {
  // A MEMBER THE READ NO LONGER HOLDS (deleted meanwhile) takes their cells
  // with them (review): no row shows them, and 0077 would refuse the save.
  const members = new Set(snapshot.members.map((member) => member.id));
  const kept = [...draft].filter(
    ([, cell]) => members.has(cell.memberId) && !sameAsLive(liveAssignmentOf(snapshot, cell), cell.value),
  );

  return kept.length === draft.size ? draft : new Map(kept);
}

/** One item of `save_personal_assignments` (0077), as sent. */
export type ManualSaveItem =
  | {
      readonly memberId: string;
      readonly date: string;
      readonly set:
        | { readonly kind: typeof PERSONAL_ASSIGNMENT_SHIFT; readonly shiftTypeId: string; readonly teamId?: string }
        | { readonly kind: typeof PERSONAL_ASSIGNMENT_OFF };
    }
  | { readonly memberId: string; readonly date: string; readonly clear: true };

/** The draft as 0077's items, by member and then date: only keys 0077 admits, a counted team only when one is named. */
export function draftItemsOf(draft: ManualDraft): readonly ManualSaveItem[] {
  return [...draft.values()]
    .sort((first, second) =>
      first.memberId === second.memberId ? compareIso(first.date, second.date) : first.memberId < second.memberId ? -1 : 1,
    )
    .map((cell): ManualSaveItem => {
      const { memberId, date, value } = cell;

      switch (value.kind) {
        case MANUAL_CLEAR:
          return { memberId, date, clear: true };
        case PERSONAL_ASSIGNMENT_OFF:
          return { memberId, date, set: { kind: PERSONAL_ASSIGNMENT_OFF } };
        case PERSONAL_ASSIGNMENT_SHIFT:
          return {
            memberId,
            date,
            set:
              value.teamId === null
                ? { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: value.shiftTypeId }
                : { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: value.shiftTypeId, teamId: value.teamId },
          };
      }
    });
}

function compareIso(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

/** The first and last drafted date, or `null` for an empty draft. */
export function draftWindowOf(draft: ManualDraft): { readonly from: string; readonly to: string } | null {
  const dates = [...draft.values()].map((cell) => cell.date).sort(compareIso);
  const from = dates[0];
  const to = dates.at(-1);

  return from === undefined || to === undefined ? null : { from, to };
}

/** The drafted members' ids, in draft order, once each. */
export function draftMembersOf(draft: ManualDraft): readonly string[] {
  return [...new Set([...draft.values()].map((cell) => cell.memberId))];
}

/** A drafted assignment's id in the "after": no stored row (a uuid) carries it. */
export function draftAssignmentIdOf(cell: ManualCellRef): string {
  return `draft:${cell.memberId}:${cell.date}`;
}

/** The member's assignments with the draft applied: the drafted dates replaced, by date. */
function assignmentsAfter(member: Pick<CalendarMember, 'id' | 'personalAssignments'>, draft: ManualDraft): readonly PersonalAssignment[] {
  const drafted = [...draft.values()].filter((cell) => cell.memberId === member.id);

  if (drafted.length === 0) return member.personalAssignments;

  const dates = new Set(drafted.map((cell) => cell.date));
  const kept = member.personalAssignments.filter((assignment) => !dates.has(assignment.date));
  const added = drafted.flatMap((cell): PersonalAssignment[] => {
    const id = draftAssignmentIdOf(cell);

    switch (cell.value.kind) {
      case MANUAL_CLEAR:
        return [];
      case PERSONAL_ASSIGNMENT_OFF:
        return [{ id, date: cell.date, kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null }];
      case PERSONAL_ASSIGNMENT_SHIFT:
        return [{ id, date: cell.date, kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: cell.value.shiftTypeId, teamId: cell.value.teamId }];
    }
  });

  return [...kept, ...added].sort((first, second) => compareIso(first.date, second.date));
}

/**
 * THE "AFTER": `calendar` with the draft applied to each drafted member's
 * assignments, and to the viewer's when the viewer is one of them. A new
 * object, so every per-snapshot standing is worked out afresh; `calendar`
 * itself for an empty draft.
 */
export function draftAppliedOf(calendar: CalendarSnapshot, draft: ManualDraft): CalendarSnapshot {
  if (draft.size === 0) return calendar;

  const members = new Set(draftMembersOf(draft));

  return {
    ...calendar,
    members: calendar.members.map((member) =>
      members.has(member.id) ? { ...member, personalAssignments: assignmentsAfter(member, draft) } : member,
    ),
    viewer: members.has(calendar.viewer.memberId)
      ? {
          ...calendar.viewer,
          personalAssignments: assignmentsAfter(
            { id: calendar.viewer.memberId, personalAssignments: calendar.viewer.personalAssignments },
            draft,
          ),
        }
      : calendar.viewer,
  };
}

/** A member the fresh read no longer holds, or a shift type or team it lacks: the screen is behind. */
export const MANUAL_STALE = 'stale';
/** A shift type or team archived meanwhile: 0077 refuses the whole save (21.2 Design Note 3). */
export const MANUAL_ARCHIVED = 'archived';
/** More items than 0077 takes in one save. */
export const MANUAL_TOO_MANY = 'tooMany';

export type ManualDraftRefusal = typeof MANUAL_STALE | typeof MANUAL_ARCHIVED | typeof MANUAL_TOO_MANY;

/** The most items one save sends (0077's bound). */
export const MANUAL_MAX_ITEMS = 5000;

/**
 * What 0077 would refuse anyway, read against `calendar` (the fresh read): a
 * member, type or team it lacks, an archived type or team, more than
 * {@link MANUAL_MAX_ITEMS} items. `null` when the draft may be sent.
 */
export function draftRefusalOf(calendar: CalendarSnapshot, draft: ManualDraft): ManualDraftRefusal | null {
  if (draft.size > MANUAL_MAX_ITEMS) return MANUAL_TOO_MANY;

  const members = new Set(calendar.members.map((member) => member.id));
  let archived = false;

  for (const cell of draft.values()) {
    if (!members.has(cell.memberId)) return MANUAL_STALE;
    if (cell.value.kind !== PERSONAL_ASSIGNMENT_SHIFT) continue;

    const { shiftTypeId, teamId } = cell.value;
    const type = calendar.types.find((candidate) => candidate.id === shiftTypeId);
    const team = teamId === null ? null : calendar.teams.find((candidate) => candidate.id === teamId);

    if (type === undefined || team === undefined) return MANUAL_STALE;
    if (type.archived || team?.archived === true) archived = true;
  }

  return archived ? MANUAL_ARCHIVED : null;
}

// ------------------------------------------------------------------ the grid

/** Where a row's days come from (UX-DR73). *osobna rotacija* arrives with story 21.9/21.10. */
export const SOURCE_TEAM = 'team';
export const SOURCE_MANUAL = 'manual';
export type ManualRowSource = typeof SOURCE_TEAM | typeof SOURCE_MANUAL;

/** What a cell draws: an assignment (solid, a pencil), a rotation or override shift (muted, a glyph), or nothing. */
export const CELL_ASSIGNED = 'assigned';
export const CELL_ROTATION = 'rotation';
export const CELL_EMPTY = 'empty';
export type ManualCellSource = typeof CELL_ASSIGNED | typeof CELL_ROTATION | typeof CELL_EMPTY;

export interface ManualCell extends ManualCellRef {
  readonly source: ManualCellSource;
  /** `true` for an assigned plain day off (*Slobodno*). */
  readonly off: boolean;
  /** The shift type shown, or `null` (a day off, nothing). */
  readonly shiftTypeId: string | null;
  /** Its letters (`D`, `N`), or `null`. */
  readonly letter: string | null;
  /** Whether that type is a working one. */
  readonly working: boolean;
  /** The team an assignment names to count with, when it is not the member's own that date; else `null`. */
  readonly countedTeamId: string | null;
  /** The member is active that date (R7). An inactive date's assignment derives nothing (R14.3). */
  readonly active: boolean;
  /** Changed in the draft. */
  readonly changed: boolean;
  /** More than one working shift that date (a double booking an override made). */
  readonly more: boolean;
}

export interface ManualRow {
  readonly memberId: string;
  readonly name: string;
  readonly source: ManualRowSource;
  readonly cells: readonly ManualCell[];
}

export interface ManualGroup {
  /** The team as at the month's first date, or `null` for the no-team rows (last). */
  readonly teamId: string | null;
  readonly name: string | null;
  readonly rows: readonly ManualRow[];
}

export interface ManualDate {
  readonly date: string;
  /** `12.` */
  readonly day: string;
  /** `12.11.` */
  readonly dayMonth: string;
  /** `pon` */
  readonly weekday: string;
  readonly weekend: boolean;
  readonly today: boolean;
}

export interface ManualLegendEntry {
  readonly letter: string;
  readonly name: string;
}

export interface ManualMonth {
  readonly month: string;
  readonly dates: readonly ManualDate[];
  readonly groups: readonly ManualGroup[];
  /** Every row, in the grid's order: what the keyboard and selection walk. */
  readonly rows: readonly ManualRow[];
  /** The letters the month's cells use, in the types' order. */
  readonly legend: readonly ManualLegendEntry[];
}

/** The weekday of a civil date (no zone): 0 is Sunday, 6 Saturday. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Sakamoto's method.
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  const y = month < 3 ? year - 1 : year;

  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + (offsets[month - 1] ?? 0) + day) % 7;
}

/** Saturday or Sunday, by the civil date alone (no zone). */
export function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);

  return weekday === 0 || weekday === 6;
}

/** Whether `teamId` has a rotation version in effect on or before `last` (the row's *rotacija tima*). */
function hasRotation(calendar: CalendarSnapshot, teamId: string, last: string): boolean {
  return calendar.assignments.some((assignment) => assignment.teamId === teamId && assignment.effectiveFrom <= last);
}

/** The shift types' letters by id, over every type (so a letter never changes as types come and go from the month). */
function lettersOf(calendar: CalendarSnapshot): ReadonlyMap<string, string> {
  const letters = typeLettersOf(calendar.types.map((type) => type.name));

  return new Map(calendar.types.map((type, index) => [type.id, letters[index] ?? type.name]));
}

function cellOf(
  calendar: CalendarSnapshot,
  day: MemberScheduleDay,
  memberId: string,
  ownTeamId: string | null,
  letters: ReadonlyMap<string, string>,
  draft: ManualDraft,
): ManualCell {
  const ref = { memberId, date: day.date };
  const changed = draft.has(draftKeyOf(ref));
  const assignment = day.personalAssignment;
  const typeOf = (id: string | null) => (id === null ? undefined : calendar.types.find((type) => type.id === id));

  if (assignment !== undefined) {
    const type = typeOf(assignment.shiftTypeId);

    return {
      ...ref,
      source: CELL_ASSIGNED,
      off: assignment.kind === PERSONAL_ASSIGNMENT_OFF,
      shiftTypeId: assignment.shiftTypeId,
      letter: assignment.shiftTypeId === null ? null : (letters.get(assignment.shiftTypeId) ?? null),
      working: type?.isWorking === true,
      countedTeamId: assignment.teamId !== null && assignment.teamId !== ownTeamId ? assignment.teamId : null,
      active: day.active,
      changed,
      more: day.shifts.filter((candidate) => typeOf(candidate.shiftTypeId)?.isWorking === true).length > 1,
    };
  }

  const shift = day.shifts.find((candidate) => candidate.shiftTypeId !== null);

  if (shift === undefined || shift.shiftTypeId === null) {
    return { ...ref, source: CELL_EMPTY, off: false, shiftTypeId: null, letter: null, working: false, countedTeamId: null, active: day.active, changed, more: false };
  }

  return {
    ...ref,
    source: CELL_ROTATION,
    off: false,
    shiftTypeId: shift.shiftTypeId,
    letter: letters.get(shift.shiftTypeId) ?? null,
    working: typeOf(shift.shiftTypeId)?.isWorking === true,
    countedTeamId: null,
    active: day.active,
    changed,
    more: day.shifts.filter((candidate) => typeOf(candidate.shiftTypeId)?.isWorking === true).length > 1,
  };
}

/**
 * The month as the grid draws it, from `calendar` (the live read) with
 * `draft` applied ({@link draftAppliedOf}):
 * - rows are the members active on at least one date of the month, grouped by
 *   their team as at its first date (`membershipOn`, the home team), the
 *   teams in the snapshot's order, the no-team rows last; by name inside a
 *   group;
 * - a row names its source: *rotacija tima* when its team has a rotation
 *   version in effect by the month's last date, else *ručno*;
 * - each cell is the member's day of the "after" (`memberScheduleOfMonth`).
 *
 * @throws RangeError on any precondition of the domain's derivations, or a month that is not `YYYY-MM`.
 */
export function manualMonthOf(calendar: CalendarSnapshot, month: string, today: string, draft: ManualDraft): ManualMonth {
  const after = draftAppliedOf(calendar, draft);
  const dates = datesOfMonth(month);
  const first = dates[0] as string;
  const last = dates.at(-1) as string;
  const shared = snapshotScheduleInputOf(after);
  const letters = lettersOf(after);
  const used = new Set<string>();
  const byTeam = new Map<string | null, ManualRow[]>();

  for (const member of after.members) {
    if (!dates.some((date) => activeOn(member.statuses, date))) continue;

    const teamId = membershipOn(member.memberships, first)?.teamId ?? null;
    const days = memberScheduleOfMonth(
      memberScheduleInputOf(after, { memberId: member.id, memberships: member.memberships, statuses: member.statuses }, shared),
      month,
    );
    const cells = days.map((day) => cellOf(after, day, member.id, membershipOn(member.memberships, day.date)?.teamId ?? null, letters, draft));

    for (const cell of cells) if (cell.shiftTypeId !== null) used.add(cell.shiftTypeId);

    const row: ManualRow = {
      memberId: member.id,
      name: member.name,
      source: teamId !== null && hasRotation(after, teamId, last) ? SOURCE_TEAM : SOURCE_MANUAL,
      cells,
    };
    const list = byTeam.get(teamId);

    if (list === undefined) byTeam.set(teamId, [row]);
    else list.push(row);
  }

  const byName = (first: ManualRow, second: ManualRow): number => compareText(first.name, second.name);
  const groups: ManualGroup[] = [];

  for (const team of after.teams) {
    const rows = byTeam.get(team.id);

    if (rows !== undefined) groups.push({ teamId: team.id, name: team.name, rows: [...rows].sort(byName) });
  }

  // A team the read lacks (none should be) keeps its rows, after the named ones.
  for (const [teamId, rows] of byTeam) {
    if (teamId !== null && !after.teams.some((team) => team.id === teamId)) {
      groups.push({ teamId, name: null, rows: [...rows].sort(byName) });
    }
  }

  const teamless = byTeam.get(null);

  if (teamless !== undefined) groups.push({ teamId: null, name: null, rows: [...teamless].sort(byName) });

  return {
    month,
    dates: dates.map((date) => ({
      date,
      day: `${String(Number(date.slice(8, 10)))}.`,
      dayMonth: formatIsoDayMonth(date) ?? date,
      weekday: formatIsoWeekdayShortName(date) ?? '',
      weekend: isWeekend(date),
      today: date === today,
    })),
    groups,
    rows: groups.flatMap((group) => group.rows),
    legend: after.types
      .filter((type) => used.has(type.id))
      .map((type) => ({ letter: letters.get(type.id) ?? type.name, name: type.name })),
  };
}

/** The shift types the picker offers: every one not archived, working first, in the snapshot's order. */
export function pickableTypesOf(calendar: CalendarSnapshot): readonly { readonly id: string; readonly name: string; readonly working: boolean }[] {
  const live = calendar.types.filter((type) => !type.archived);

  return [...live.filter((type) => type.isWorking), ...live.filter((type) => !type.isWorking)].map((type) => ({
    id: type.id,
    name: type.name,
    working: type.isWorking,
  }));
}

/** The teams *Računaj u tim…* offers: every one not archived, in the snapshot's order. */
export function pickableTeamsOf(calendar: CalendarSnapshot): readonly { readonly id: string; readonly name: string }[] {
  return calendar.teams.filter((team) => !team.archived).map((team) => ({ id: team.id, name: team.name }));
}

// --------------------------------------------------------------- selection

/** A cell's place in the grid: its row in {@link ManualMonth.rows} and its column (date index). */
export interface ManualPosition {
  readonly row: number;
  readonly column: number;
}

/** The cells of the rectangle between two positions, both corners included, row by row. */
export function rectangleOf(month: ManualMonth, from: ManualPosition, to: ManualPosition): readonly ManualCellRef[] {
  const cells: ManualCellRef[] = [];
  const [top, bottom] = from.row <= to.row ? [from.row, to.row] : [to.row, from.row];
  const [left, right] = from.column <= to.column ? [from.column, to.column] : [to.column, from.column];

  for (let row = top; row <= bottom; row += 1) {
    const member = month.rows[row];

    if (member === undefined) continue;

    for (let column = left; column <= right; column += 1) {
      const date = month.dates[column];

      if (date !== undefined) cells.push({ memberId: member.memberId, date: date.date });
    }
  }

  return cells;
}

/** The position of a cell in `month`, or `null` when the month does not show it. */
export function positionOf(month: ManualMonth, cell: ManualCellRef): ManualPosition | null {
  const row = month.rows.findIndex((candidate) => candidate.memberId === cell.memberId);
  const column = month.dates.findIndex((candidate) => candidate.date === cell.date);

  return row < 0 || column < 0 ? null : { row, column };
}

/** `selected` with `cell` added, or taken out when it was in. A new list. */
export function toggledOf(selected: readonly ManualCellRef[], cell: ManualCellRef): readonly ManualCellRef[] {
  const key = draftKeyOf(cell);

  return selected.some((candidate) => draftKeyOf(candidate) === key)
    ? selected.filter((candidate) => draftKeyOf(candidate) !== key)
    : [...selected, cell];
}

/** Whether `cell` is among `selected`. */
export function isSelected(selected: ReadonlySet<string>, cell: ManualCellRef): boolean {
  return selected.has(draftKeyOf(cell));
}

/** Arrow keys and Home/End: the next position, kept inside the grid. `null` for any other key. */
export function movedOf(month: ManualMonth, at: ManualPosition, key: string): ManualPosition | null {
  const lastRow = month.rows.length - 1;
  const lastColumn = month.dates.length - 1;
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

  switch (key) {
    case 'ArrowUp':
      return { row: clamp(at.row - 1, lastRow), column: at.column };
    case 'ArrowDown':
      return { row: clamp(at.row + 1, lastRow), column: at.column };
    case 'ArrowLeft':
      return { row: at.row, column: clamp(at.column - 1, lastColumn) };
    case 'ArrowRight':
      return { row: at.row, column: clamp(at.column + 1, lastColumn) };
    case 'Home':
      return { row: at.row, column: 0 };
    case 'End':
      return { row: at.row, column: lastColumn };
    default:
      return null;
  }
}

/** The month's first date, for a member's active check on the phone's member list. */
export function activeInMonthOf(member: Pick<CalendarMember, 'statuses'>, month: string): boolean {
  return datesOfMonth(month).some((date) => activeOn(member.statuses, date));
}
