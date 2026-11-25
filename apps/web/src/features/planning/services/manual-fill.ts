import {
  MAX_PLANNED_DAYS,
  PERSONAL_ASSIGNMENT_OFF,
  PERSONAL_ASSIGNMENT_SHIFT,
  copiedAssignmentsOf,
  datesOfMonth,
  filledAssignmentsOf,
  type PatternStep,
  type PlannedAssignment,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { isCalendarMonth } from '@/features/calendar/utils/month';
import {
  MANUAL_CLEAR,
  draftAppliedOf,
  draftKeyOf,
  sameAsLive,
  weekdayOf,
  type ManualCellRef,
  type ManualDraft,
  type ManualDraftCell,
  type ManualValue,
} from '@/features/planning/services/manual-grid';
import { isIsoDate, previousIsoDate } from '@/lib/i18n/format';
import { datesFrom } from '@/utils/dates';

/**
 * *POPUNI UZORKOM* AND *KOPIRAJ* (story 21.5; UX-DR74; AD-26 as amended), as
 * a `.ts` the node suite executes (AD-15): the two dialogs' forms checked
 * field by field, their items planned by `domain/personal`
 * (`filledAssignmentsOf`, `copiedAssignmentsOf`), and the items put into
 * 21.4's draft ({@link plannedDraftOf}), where each cell is previewed, stays
 * editable and is saved by the one *Spremi*. Nothing is stored as a rule.
 *
 * ARCHIVED FIRST (deferred-work, 21.2): 0077 refuses a whole save when any
 * item names an archived shift type or team, even one equal to its live row.
 * An item naming one, or one the read lacks, is never drafted: its cell keeps
 * what it had, and the outcome counts it as left out.
 */

/** *Slobodno* as a step's choice (no type id is empty). */
export const STEP_OFF = 'OFF';
/** A step with nothing chosen yet (O3: the dialog pre-selects nothing). */
export const STEP_NONE = '';

/** One step row as the dialog holds it: the choice (a type id, {@link STEP_OFF} or {@link STEP_NONE}) and the count as typed. */
export interface FillStepForm {
  readonly choice: string;
  readonly count: string;
}

export interface FillForm {
  readonly memberIds: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly steps: readonly FillStepForm[];
  /** The 0-based day of the cycle the first date takes (*Počni od koraka*). */
  readonly offset: number;
}

export const COPY_WEEK = 'week';
export const COPY_MONTH = 'month';
export type CopyMode = typeof COPY_WEEK | typeof COPY_MONTH;

export interface CopyForm {
  readonly mode: CopyMode;
  readonly memberIds: readonly string[];
  /** A week's first date (`YYYY-MM-DD`), or a month (`YYYY-MM`). */
  readonly source: string;
  /** The same, for the target. */
  readonly target: string;
}

/** A field the dialog refuses, by what is wrong with it. */
export type PlannedRefusal =
  | 'people'
  | 'range'
  | 'tooLong'
  | 'steps'
  | 'stepType'
  | 'stepCount'
  | 'source'
  | 'target'
  | 'same'
  | typeof PLAN_FAILED;

/** The read could not be planned over (a domain precondition broken; logged): nothing is drafted. */
export const PLAN_FAILED = 'failed';

/** The refusals a dialog marks a field for, by name (the screens hold no literal). */
export const REFUSED_PEOPLE: PlannedRefusal = 'people';
export const REFUSED_RANGE: PlannedRefusal = 'range';
export const REFUSED_TOO_LONG: PlannedRefusal = 'tooLong';
export const REFUSED_STEP_TYPE: PlannedRefusal = 'stepType';
export const REFUSED_STEP_COUNT: PlannedRefusal = 'stepCount';
export const REFUSED_SOURCE: PlannedRefusal = 'source';
export const REFUSED_TARGET: PlannedRefusal = 'target';
export const REFUSED_SAME: PlannedRefusal = 'same';

/** A step's count before one is typed. */
export const NO_COUNT = '';

/**
 * What putting items into the draft did: the new draft, the cells it now
 * holds a change for (`placed`), and the items left out (`skipped`: an
 * archived or unknown type or team, or a member the read lacks).
 */
export interface PlannedDraft {
  readonly draft: ManualDraft;
  readonly placed: number;
  readonly skipped: number;
}

export type PlannedOutcome = { readonly ok: true; readonly planned: PlannedDraft } | { readonly ok: false; readonly code: PlannedRefusal };

/** A planned item as the draft's value: `null` is *Očisti*. */
function valueOf(item: PlannedAssignment): ManualValue | null {
  const set = item.set;

  if (set === null) return { kind: MANUAL_CLEAR };
  if (set.kind === PERSONAL_ASSIGNMENT_OFF) return { kind: PERSONAL_ASSIGNMENT_OFF };
  if (set.shiftTypeId === null) return null;

  return { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: set.shiftTypeId, teamId: set.teamId };
}

/**
 * THE ITEMS INTO THE DRAFT: each cell takes its item's value, or leaves the
 * draft where that equals the live row (21.4's `draftWith` rule). An item
 * naming an archived or unknown shift type or team, or a member the read
 * lacks, is left out first, and counted.
 */
export function plannedDraftOf(snapshot: CalendarSnapshot, draft: ManualDraft, items: readonly PlannedAssignment[]): PlannedDraft {
  const members = new Map(snapshot.members.map((member) => [member.id, member]));
  const liveTypes = new Set(snapshot.types.filter((type) => !type.archived).map((type) => type.id));
  const liveTeams = new Set(snapshot.teams.filter((team) => !team.archived).map((team) => team.id));
  const next = new Map<string, ManualDraftCell>(draft);
  let placed = 0;
  let skipped = 0;

  for (const item of items) {
    const member = members.get(item.memberId);
    const value = valueOf(item);

    if (
      member === undefined ||
      value === null ||
      (value.kind === PERSONAL_ASSIGNMENT_SHIFT &&
        (!liveTypes.has(value.shiftTypeId) || (value.teamId !== null && !liveTeams.has(value.teamId))))
    ) {
      skipped += 1;
      continue;
    }

    const cell: ManualCellRef = { memberId: item.memberId, date: item.date };
    const key = draftKeyOf(cell);
    const live = member.personalAssignments.find((assignment) => assignment.date === item.date) ?? null;

    // PLACED COUNTS WHAT THE DRAFT NOW HOLDS for this cell (review): a value
    // equal to the live row, or a clear of an empty cell, leaves the draft
    // and is no unsaved day.
    if (sameAsLive(live, value)) {
      next.delete(key);
    } else {
      next.set(key, { ...cell, value });
      placed += 1;
    }
  }

  return { draft: next, placed, skipped };
}

/** The number of dates from `from` to `to`, both included; `null` when either is no date or `to` is before `from`; over the bound, the bound plus one. */
function lengthOf(from: string, to: string): number | null {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return null;

  const dates = datesFrom(from, MAX_PLANNED_DAYS + 1);
  const index = dates.indexOf(to);

  // Not found: beyond the bound it is too long; where the calendar ran out first (9999-12-31), `to` is no reachable date.
  if (index >= 0) return index + 1;

  return dates.length > MAX_PLANNED_DAYS ? MAX_PLANNED_DAYS + 1 : null;
}

/** Whether a count as typed is a whole number of days from 1 to {@link MAX_PLANNED_DAYS}, in digits only (no `1e2`, `0x10` or `+5`). */
export function isStepCount(count: string): boolean {
  const typed = count.trim();

  return /^\d+$/.test(typed) && Number(typed) >= 1 && Number(typed) <= MAX_PLANNED_DAYS;
}

/** The pattern's steps, or the refusal of the first bad row. */
function stepsOf(rows: readonly FillStepForm[]): readonly PatternStep[] | PlannedRefusal {
  if (rows.length === 0) return 'steps';

  const steps: PatternStep[] = [];

  for (const row of rows) {
    if (row.choice === STEP_NONE) return 'stepType';

    if (!isStepCount(row.count)) return 'stepCount';

    const count = Number(row.count.trim());

    steps.push(
      row.choice === STEP_OFF
        ? { kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count }
        : { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: row.choice, count },
    );
  }

  return steps;
}

/** The cycle's length of the rows as typed, or `0` while any row is incomplete: what *Počni od koraka* offers. */
export function cycleLengthOf(rows: readonly FillStepForm[]): number {
  const steps = stepsOf(rows);

  return typeof steps === 'string' ? 0 : steps.reduce((total, step) => total + step.count, 0);
}

/** The cycle's days as the offset's options: each day's position (0-based) and the step row it belongs to. */
export function cycleDaysOf(rows: readonly FillStepForm[]): readonly { readonly day: number; readonly step: number }[] {
  const steps = stepsOf(rows);

  if (typeof steps === 'string') return [];

  return steps.flatMap((step, index) => Array.from({ length: step.count }, () => index)).map((step, day) => ({ day, step }));
}

/** *Popuni*: the form checked field by field (people, range, steps), then the pattern's items into the draft. */
export function filledDraftOf(snapshot: CalendarSnapshot, draft: ManualDraft, form: FillForm): PlannedOutcome {
  if (form.memberIds.length === 0) return { ok: false, code: 'people' };

  const length = lengthOf(form.from, form.to);

  if (length === null) return { ok: false, code: 'range' };
  if (length > MAX_PLANNED_DAYS) return { ok: false, code: 'tooLong' };

  const steps = stepsOf(form.steps);

  if (typeof steps === 'string') return { ok: false, code: steps };

  const cycle = steps.reduce((total, step) => total + step.count, 0);
  const offset = form.offset >= 0 && form.offset < cycle ? form.offset : 0;
  const items = filledAssignmentsOf(steps, offset, form.memberIds, form.from, form.to);

  return { ok: true, planned: plannedDraftOf(snapshot, draft, items) };
}

/** A copy's source range and target start, or the refusal of the field that is wrong. */
export function copyRangeOf(form: Pick<CopyForm, 'mode' | 'source' | 'target'>):
  | { readonly ok: true; readonly from: string; readonly to: string; readonly target: string }
  | { readonly ok: false; readonly code: PlannedRefusal } {
  if (form.mode === COPY_WEEK) {
    if (!isIsoDate(form.source)) return { ok: false, code: 'source' };
    if (!isIsoDate(form.target)) return { ok: false, code: 'target' };
    if (form.source === form.target) return { ok: false, code: 'same' };

    const week = datesFrom(form.source, 7);
    const targetWeek = datesFrom(form.target, 7);

    // THE END OF THE CALENDAR: a week that runs out of dates is no week.
    if (week.length < 7) return { ok: false, code: 'source' };
    if (targetWeek.length < 7) return { ok: false, code: 'target' };

    return { ok: true, from: form.source, to: week[6] as string, target: form.target };
  }

  if (!isCalendarMonth(form.source)) return { ok: false, code: 'source' };
  if (!isCalendarMonth(form.target)) return { ok: false, code: 'target' };
  if (form.source === form.target) return { ok: false, code: 'same' };

  // A MONTH INTO A SHORTER ONE: as many days as the shorter month has, from each first.
  const source = datesOfMonth(form.source);
  const length = Math.min(source.length, datesOfMonth(form.target).length);

  return { ok: true, from: source[0] as string, to: source[length - 1] as string, target: `${form.target}-01` };
}

/**
 * *Kopiraj*: the people's assignments over the source as the grid shows them
 * — the live rows with the draft applied, so a week just filled can be
 * copied — planned at the target (`copiedAssignmentsOf`), then into the draft.
 */
export function copiedDraftOf(snapshot: CalendarSnapshot, draft: ManualDraft, form: CopyForm): PlannedOutcome {
  if (form.memberIds.length === 0) return { ok: false, code: 'people' };

  const range = copyRangeOf(form);

  if (!range.ok) return range;

  const after = draftAppliedOf(snapshot, draft);
  const byId = new Map(after.members.map((member) => [member.id, member]));
  // A CHOSEN PERSON THE READ NO LONGER HOLDS (review) is planned with no
  // assignments, so `plannedDraftOf` counts each of their days as left out.
  const members = form.memberIds.map((memberId) => ({
    memberId,
    personalAssignments: byId.get(memberId)?.personalAssignments ?? [],
  }));
  const items = copiedAssignmentsOf({ from: range.from, to: range.to }, range.target, members);

  return { ok: true, planned: plannedDraftOf(snapshot, draft, items) };
}

/** The Monday on or before `date`, or `date` itself when it is no calendar date. */
export function mondayOf(date: string): string {
  if (!isIsoDate(date)) return date;

  const back = (weekdayOf(date) + 6) % 7;
  let monday = date;

  // The calendar's first days have no Monday before them: the first date stands.
  for (let step = 0; step < back; step += 1) monday = previousIsoDate(monday) ?? monday;

  return monday;
}

/** What a dialog opens with: the selection's people (in the grid's order) and its first and last date, else the month's. */
export function plannedDefaultsOf(
  rows: readonly { readonly memberId: string }[],
  dates: readonly { readonly date: string }[],
  selected: readonly ManualCellRef[],
  /** On a phone, the person shown: pre-checked when nothing is selected. `null` on the grid, where nobody is pre-checked then (review). */
  phonePerson: string | null = null,
): { readonly memberIds: readonly string[]; readonly from: string; readonly to: string } {
  const chosen = new Set(selected.map((cell) => cell.memberId));
  const days = selected.map((cell) => cell.date).sort();
  const memberIds = rows.filter((row) => chosen.has(row.memberId)).map((row) => row.memberId);

  return {
    memberIds: memberIds.length === 0 && phonePerson !== null ? [phonePerson] : memberIds,
    from: days[0] ?? dates[0]?.date ?? '',
    to: days.at(-1) ?? dates.at(-1)?.date ?? '',
  };
}

/** The dialog's alert for a refused field. */
export function plannedRefusalMessageKey(
  code: PlannedRefusal,
):
  | 'rucniRaspored.plan.error.people'
  | 'rucniRaspored.plan.error.range'
  | 'rucniRaspored.plan.error.tooLong'
  | 'rucniRaspored.plan.error.steps'
  | 'rucniRaspored.plan.error.stepType'
  | 'rucniRaspored.plan.error.stepCount'
  | 'rucniRaspored.plan.error.source'
  | 'rucniRaspored.plan.error.target'
  | 'rucniRaspored.plan.error.same'
  | 'rucniRaspored.plan.error.failed' {
  switch (code) {
    case PLAN_FAILED:
      return 'rucniRaspored.plan.error.failed';
    case 'people':
      return 'rucniRaspored.plan.error.people';
    case 'range':
      return 'rucniRaspored.plan.error.range';
    case 'tooLong':
      return 'rucniRaspored.plan.error.tooLong';
    case 'steps':
      return 'rucniRaspored.plan.error.steps';
    case 'stepType':
      return 'rucniRaspored.plan.error.stepType';
    case 'stepCount':
      return 'rucniRaspored.plan.error.stepCount';
    case 'source':
      return 'rucniRaspored.plan.error.source';
    case 'target':
      return 'rucniRaspored.plan.error.target';
    case 'same':
      return 'rucniRaspored.plan.error.same';
  }
}
