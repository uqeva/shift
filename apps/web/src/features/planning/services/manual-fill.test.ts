import { PERSONAL_ASSIGNMENT_OFF, PERSONAL_ASSIGNMENT_SHIFT } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  A,
  ANA,
  ARCHIVED_TEAM,
  ARCHIVED_TYPE,
  DAN,
  DORA,
  IVA,
  MONTH,
  NOC,
  TODAY,
  calendarPersonalAssignmentRow,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import {
  COPY_MONTH,
  COPY_WEEK,
  STEP_NONE,
  STEP_OFF,
  copiedDraftOf,
  copyRangeOf,
  cycleDaysOf,
  cycleLengthOf,
  filledDraftOf,
  mondayOf,
  plannedDefaultsOf,
  plannedDraftOf,
  plannedRefusalMessageKey,
  type FillForm,
  type FillStepForm,
  type PlannedOutcome,
  type PlannedRefusal,
} from '@/features/planning/services/manual-fill';
import {
  MANUAL_CLEAR,
  NO_DRAFT,
  draftItemsOf,
  draftKeyOf,
  draftWith,
  manualMonthOf,
  CELL_ASSIGNED,
  type ManualDraft,
} from '@/features/planning/services/manual-grid';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 21.5: *Popuni uzorkom* and *Kopiraj* into 21.4's draft, over the
 * planning fixture (October 2026; ANA on Smjena A's rotation, DORA on a day
 * team with no rotation, IVA a student on no team).
 */

const ivaDan = (id: string, date: string, teamId: string | null = null): Record<string, unknown> =>
  calendarPersonalAssignmentRow(id, IVA, date, 'SHIFT', DAN, teamId);

let plain: CalendarSnapshot;
/** IVA has a Dan on 05.10., an OFF on 06.10., a Dan counted with Smjena A on 07.10., a Dan counted with an archived team on 08.10. and the archived type on 09.10. */
let week: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
  week = await planningSnapshotOf({
    assignments: [
      ivaDan('00000000-0000-4000-8000-00000000f005', '2026-10-05'),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f006', IVA, '2026-10-06', 'OFF'),
      ivaDan('00000000-0000-4000-8000-00000000f007', '2026-10-07', A),
      ivaDan('00000000-0000-4000-8000-00000000f008', '2026-10-08', ARCHIVED_TEAM),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f009', IVA, '2026-10-09', 'SHIFT', ARCHIVED_TYPE),
    ],
  });
});

/** The founder's pattern, with the pilot's types: `Dan ×5, Slobodno ×2, Noć ×5, Slobodno ×2`. */
const FOUNDER: readonly FillStepForm[] = [
  { choice: DAN, count: '5' },
  { choice: STEP_OFF, count: '2' },
  { choice: NOC, count: '5' },
  { choice: STEP_OFF, count: '2' },
];

function fill(form: Partial<FillForm>, draft: ManualDraft = NO_DRAFT, snapshot: CalendarSnapshot = plain): PlannedOutcome {
  return filledDraftOf(snapshot, draft, { memberIds: [IVA, DORA], from: '2026-10-01', to: '2026-10-28', steps: FOUNDER, offset: 0, ...form });
}

function planned(outcome: PlannedOutcome) {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);

  return outcome.planned;
}

/** A member's drafted cells as letters by date: `D` Dan, `N` Noć, `-` off, `.` cleared. */
function lettersOf(draft: ManualDraft, memberId: string): string {
  return [...draft.values()]
    .filter((cell) => cell.memberId === memberId)
    .sort((first, second) => (first.date < second.date ? -1 : 1))
    .map((cell) =>
      cell.value.kind === MANUAL_CLEAR
        ? '.'
        : cell.value.kind === PERSONAL_ASSIGNMENT_OFF
          ? '-'
          : cell.value.shiftTypeId === DAN
            ? 'D'
            : cell.value.shiftTypeId === NOC
              ? 'N'
              : '?',
    )
    .join('');
}

describe('Popuni uzorkom (UX-DR74)', () => {
  it("fills the founder's pattern for two people over four weeks, into the draft", () => {
    const { draft, placed, skipped } = planned(fill({}));

    expect(placed).toBe(56);
    expect(skipped).toBe(0);
    expect(draft.size).toBe(56);
    expect(lettersOf(draft, IVA)).toBe('DDDDD--NNNNN--DDDDD--NNNNN--');
    expect(lettersOf(draft, DORA)).toBe('DDDDD--NNNNN--DDDDD--NNNNN--');
    // Own team: a shift names no counted team.
    expect(draft.get(draftKeyOf({ memberId: IVA, date: '2026-10-01' }))?.value).toEqual({
      kind: PERSONAL_ASSIGNMENT_SHIFT,
      shiftTypeId: DAN,
      teamId: null,
    });
  });

  it('enters the cycle at the offset', () => {
    expect(lettersOf(planned(fill({ offset: 7, memberIds: [IVA], to: '2026-10-14' })).draft, IVA)).toBe('NNNNN--DDDDD--');
  });

  it('takes an offset outside the cycle as its first day', () => {
    expect(lettersOf(planned(fill({ offset: 99, memberIds: [IVA], to: '2026-10-02' })).draft, IVA)).toBe('DD');
  });

  it('draws the filled cells as assigned and changed, and each stays editable', () => {
    const { draft } = planned(fill({ memberIds: [IVA], to: '2026-10-03' }));
    const row = manualMonthOf(plain, MONTH, TODAY, draft).rows.find((candidate) => candidate.memberId === IVA);

    expect(row?.cells.slice(0, 3).map((cell) => [cell.source, cell.changed])).toEqual([
      [CELL_ASSIGNED, true],
      [CELL_ASSIGNED, true],
      [CELL_ASSIGNED, true],
    ]);

    // The picker still edits a filled cell.
    const edited = draftWith(plain, draft, [{ memberId: IVA, date: '2026-10-02' }], { kind: PERSONAL_ASSIGNMENT_OFF });

    expect(lettersOf(edited, IVA)).toBe('D-D');
  });

  it('leaves out a cell equal to the live row, as the picker does', () => {
    const { draft, placed } = planned(fill({ memberIds: [IVA], from: '2026-10-05', to: '2026-10-06', steps: [{ choice: DAN, count: '1' }, { choice: STEP_OFF, count: '1' }] }, NO_DRAFT, week));

    // 05.10. is a Dan and 06.10. an OFF already: nothing to send, and no day counted as unsaved.
    expect(placed).toBe(0);
    expect(draft.size).toBe(0);
  });

  it('replaces cells already drafted, and keeps the others', () => {
    const before = draftWith(plain, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }, { memberId: IVA, date: '2026-10-01' }], {
      kind: PERSONAL_ASSIGNMENT_OFF,
    });
    const { draft } = planned(fill({ memberIds: [IVA], to: '2026-10-01' }, before));

    expect(lettersOf(draft, IVA)).toBe('D');
    expect(lettersOf(draft, ANA)).toBe('-');
  });

  it('sends the filled cells as one save’s items', () => {
    const { draft } = planned(fill({ memberIds: [IVA], to: '2026-10-02' }));

    expect(draftItemsOf(draft)).toEqual([
      { memberId: IVA, date: '2026-10-01', set: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: DAN } },
      { memberId: IVA, date: '2026-10-02', set: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: DAN } },
    ]);
  });

  it.each<[string, Partial<FillForm>, PlannedRefusal]>([
    ['no person', { memberIds: [] }, 'people'],
    ['no first date', { from: '' }, 'range'],
    ['a last date before the first', { from: '2026-10-05', to: '2026-10-04' }, 'range'],
    ['a range over 366 days', { from: '2026-01-01', to: '2027-01-02' }, 'tooLong'],
    ['no step', { steps: [] }, 'steps'],
    ['a step with nothing chosen', { steps: [{ choice: STEP_NONE, count: '1' }] }, 'stepType'],
    ['an empty count', { steps: [{ choice: DAN, count: ' ' }] }, 'stepCount'],
    ['a zero count', { steps: [{ choice: DAN, count: '0' }] }, 'stepCount'],
    ['a fractional count', { steps: [{ choice: DAN, count: '1,5' }] }, 'stepCount'],
    ['a count in exponent form', { steps: [{ choice: DAN, count: '1e2' }] }, 'stepCount'],
    ['a signed count', { steps: [{ choice: DAN, count: '+5' }] }, 'stepCount'],
    ['a count over 366', { steps: [{ choice: DAN, count: '367' }] }, 'stepCount'],
  ])('refuses %s, and drafts nothing', (_what, form, code) => {
    expect(fill(form)).toEqual({ ok: false, code });
  });

  it('offers the cycle’s days for *Počni od koraka*, each with its step row', () => {
    expect(cycleLengthOf(FOUNDER)).toBe(14);
    expect(cycleDaysOf(FOUNDER).slice(4, 8)).toEqual([
      { day: 4, step: 0 },
      { day: 5, step: 1 },
      { day: 6, step: 1 },
      { day: 7, step: 2 },
    ]);
    expect(cycleLengthOf([{ choice: STEP_NONE, count: '2' }])).toBe(0);
    expect(cycleDaysOf([{ choice: DAN, count: 'x' }])).toEqual([]);
  });
});

describe('Kopiraj (UX-DR74)', () => {
  it('copies a week of assignments only; a source day with none clears its target', async () => {
    const target = await planningSnapshotOf({
      assignments: [
        ivaDan('00000000-0000-4000-8000-00000000f005', '2026-10-05'),
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f006', IVA, '2026-10-06', 'OFF'),
        // A live assignment on a target date whose source has none: it is cleared.
        ivaDan('00000000-0000-4000-8000-00000000f020', '2026-10-17'),
      ],
    });
    const { draft, placed, skipped } = planned(copiedDraftOf(target, NO_DRAFT, { mode: COPY_WEEK, memberIds: [IVA], source: '2026-10-05', target: '2026-10-12' }));

    expect([placed, skipped]).toEqual([3, 0]);
    // 12.10. Dan, 13.10. off, 17.10. cleared; the other clears had nothing to clear and left the draft.
    expect(lettersOf(draft, IVA)).toBe('D-.');
    expect([...draft.values()].map((cell) => cell.date).sort()).toEqual(['2026-10-12', '2026-10-13', '2026-10-17']);
  });

  it('keeps the counted team, and leaves out a cell naming an archived type or team', () => {
    const { draft, placed, skipped } = planned(copiedDraftOf(week, NO_DRAFT, { mode: COPY_WEEK, memberIds: [IVA], source: '2026-10-05', target: '2026-10-19' }));

    expect([placed, skipped]).toEqual([3, 2]);
    expect(draft.get(draftKeyOf({ memberId: IVA, date: '2026-10-21' }))?.value).toEqual({ kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: DAN, teamId: A });
    // 22.10. (archived team) and 23.10. (archived type) are not drafted: their cells keep what they had.
    expect(draft.has(draftKeyOf({ memberId: IVA, date: '2026-10-22' }))).toBe(false);
    expect(draft.has(draftKeyOf({ memberId: IVA, date: '2026-10-23' }))).toBe(false);
    // Nothing the draft holds would make 0077 refuse the save.
    expect(draftItemsOf(draft).every((item) => !('set' in item) || item.set.kind === PERSONAL_ASSIGNMENT_OFF || item.set.shiftTypeId === DAN)).toBe(true);
  });

  it('copies what the grid shows: the draft applied', () => {
    const filled = planned(fill({ memberIds: [IVA], from: '2026-10-01', to: '2026-10-07' })).draft;
    const { draft } = planned(copiedDraftOf(plain, filled, { mode: COPY_WEEK, memberIds: [IVA], source: '2026-10-01', target: '2026-10-08' }));

    expect(lettersOf(draft, IVA)).toBe('DDDDD--DDDDD--');
  });

  it('copies an overlapping week from the source as it was', () => {
    const { draft } = planned(copiedDraftOf(week, NO_DRAFT, { mode: COPY_WEEK, memberIds: [IVA], source: '2026-10-05', target: '2026-10-06' }));

    // 06.10. takes 05.10.'s Dan, 07.10. takes 06.10.'s OFF (not the Dan just copied).
    expect(draft.get(draftKeyOf({ memberId: IVA, date: '2026-10-06' }))?.value.kind).toBe(PERSONAL_ASSIGNMENT_SHIFT);
    expect(draft.get(draftKeyOf({ memberId: IVA, date: '2026-10-07' }))?.value.kind).toBe(PERSONAL_ASSIGNMENT_OFF);
  });

  it('copies a month into a shorter one for as many days as it has', () => {
    expect(copyRangeOf({ mode: COPY_MONTH, source: '2026-10', target: '2026-11' })).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-30', target: '2026-11-01' });
    expect(copyRangeOf({ mode: COPY_MONTH, source: '2026-02', target: '2026-03' })).toEqual({ ok: true, from: '2026-02-01', to: '2026-02-28', target: '2026-03-01' });

    const { placed } = planned(copiedDraftOf(week, NO_DRAFT, { mode: COPY_MONTH, memberIds: [IVA, ANA], source: '2026-10', target: '2026-11' }));

    // IVA's 05.–07.10. land in November; her two archived days are left out; every other day clears an empty cell.
    expect(placed).toBe(3);
  });

  it.each<[string, Parameters<typeof copyRangeOf>[0], PlannedRefusal]>([
    ['a bad source week', { mode: COPY_WEEK, source: '2026-13-01', target: '2026-10-12' }, 'source'],
    ['a bad target week', { mode: COPY_WEEK, source: '2026-10-05', target: '' }, 'target'],
    ['the same week', { mode: COPY_WEEK, source: '2026-10-05', target: '2026-10-05' }, 'same'],
    ['a week past the calendar', { mode: COPY_WEEK, source: '2026-10-05', target: '9999-12-30' }, 'target'],
    ['a bad source month', { mode: COPY_MONTH, source: '2026-1', target: '2026-11' }, 'source'],
    ['a bad target month', { mode: COPY_MONTH, source: '2026-10', target: 'x' }, 'target'],
    ['the same month', { mode: COPY_MONTH, source: '2026-10', target: '2026-10' }, 'same'],
  ])('refuses %s', (_what, form, code) => {
    expect(copyRangeOf(form)).toEqual({ ok: false, code });
  });

  it('counts every day of a chosen person the read no longer holds as left out', () => {
    const { placed, skipped } = planned(copiedDraftOf(week, NO_DRAFT, { mode: COPY_WEEK, memberIds: ['gone'], source: '2026-10-05', target: '2026-10-12' }));

    expect([placed, skipped]).toEqual([0, 7]);
  });

  it('refuses a copy for no person', () => {
    expect(copiedDraftOf(week, NO_DRAFT, { mode: COPY_WEEK, memberIds: [], source: '2026-10-05', target: '2026-10-12' })).toEqual({ ok: false, code: 'people' });
  });
});

describe('the dialogs’ defaults and words', () => {
  it('opens on the selection’s people in the grid’s order and its first and last date, else the month', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);
    const selection = [
      { memberId: IVA, date: '2026-10-09' },
      { memberId: ANA, date: '2026-10-03' },
    ];
    const defaults = plannedDefaultsOf(month.rows, month.dates, selection);

    expect(defaults.from).toBe('2026-10-03');
    expect(defaults.to).toBe('2026-10-09');
    expect(defaults.memberIds).toEqual(month.rows.map((row) => row.memberId).filter((id) => id === IVA || id === ANA));
    expect(plannedDefaultsOf(month.rows, month.dates, [])).toEqual({ memberIds: [], from: '2026-10-01', to: '2026-10-31' });
    // On a phone, the person shown when nothing is selected; never on the grid (review).
    expect(plannedDefaultsOf(month.rows, month.dates, [], IVA).memberIds).toEqual([IVA]);
    expect(plannedDefaultsOf(month.rows, month.dates, selection, IVA).memberIds).toHaveLength(2);
  });

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28');
    expect(mondayOf('x')).toBe('x');
  });

  it('words every refusal', () => {
    const codes: PlannedRefusal[] = ['people', 'range', 'tooLong', 'steps', 'stepType', 'stepCount', 'source', 'target', 'same', 'failed'];

    for (const code of codes) expect(t(plannedRefusalMessageKey(code))).not.toBe(plannedRefusalMessageKey(code));
  });

  it('counts an item for a member the read lacks as left out', () => {
    const outcome = plannedDraftOf(plain, NO_DRAFT, [{ memberId: 'gone', date: '2026-10-01', set: null }]);

    expect([outcome.draft.size, outcome.placed, outcome.skipped]).toEqual([0, 0, 1]);
  });
});
