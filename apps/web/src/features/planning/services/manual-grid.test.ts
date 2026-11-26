import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  A,
  ANA,
  ARCHIVED_TYPE,
  C,
  DAN,
  DAY_TEAM,
  DORA,
  IVA,
  LATE_TEAM,
  assignmentRow,
  memberMembershipRow,
  MONTH,
  NOC,
  SLOBODNO,
  TODAY,
  VIEWER_MEMBER,
  calendarPersonalAssignmentRow,
  holidayRow,
  leaveRowOf,
  planningSnapshotOf,
  statusRow,
} from '@/features/planning/planning.fixture';
import { cellLabelOf } from '@/features/planning/components/manual-grid';
import {
  CELL_ASSIGNED,
  CELL_EMPTY,
  CELL_ROTATION,
  MANUAL_ARCHIVED,
  MANUAL_CLEAR,
  MANUAL_MAX_ITEMS,
  MANUAL_STALE,
  MANUAL_TOO_MANY,
  NO_DRAFT,
  NO_MANUAL_LEAVE,
  SOURCE_MANUAL,
  SOURCE_TEAM,
  draftAgainst,
  draftAppliedOf,
  draftAssignmentIdOf,
  draftItemsOf,
  draftRefusalOf,
  draftWindowOf,
  draftWith,
  isWeekend,
  manualLeaveOf,
  manualMonthOf,
  manualRoleFilterOf,
  movedOf,
  pickableTeamsOf,
  pickableTypesOf,
  positionOf,
  rectangleOf,
  toggledOf,
  type ManualDraft,
  type ManualMonth,
} from '@/features/planning/services/manual-grid';
import { initLocalization } from '@/lib/i18n';

const IVA_DAN = '00000000-0000-4000-8000-00000000f001';

let plain: CalendarSnapshot;
let planned: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
  planned = await planningSnapshotOf({
    assignments: [calendarPersonalAssignmentRow(IVA_DAN, IVA, '2026-10-10', 'SHIFT', DAN)],
  });
});

function cellOf(month: ManualMonth, memberId: string, date: string) {
  const cell = month.rows.find((row) => row.memberId === memberId)?.cells.find((candidate) => candidate.date === date);

  if (cell === undefined) throw new Error(`no cell ${memberId} ${date}`);

  return cell;
}

describe('the grid draws leave (story 21.7, deferred from 21.4)', () => {
  const LEAVE = [leaveRowOf('00000000-0000-4000-8000-00000000f0a1', IVA, '2026-10-09', '2026-10-11')];

  it('marks each date a live record of the member covers, over a shift or none, and no other cell', () => {
    const month = manualMonthOf(planned, MONTH, TODAY, NO_DRAFT, manualLeaveOf(planned, LEAVE));

    expect(cellOf(month, IVA, '2026-10-09')).toMatchObject({ onLeave: true, source: CELL_EMPTY });
    expect(cellOf(month, IVA, '2026-10-10')).toMatchObject({ onLeave: true, source: CELL_ASSIGNED });
    expect(cellOf(month, IVA, '2026-10-11').onLeave).toBe(false);
    expect(cellOf(month, ANA, '2026-10-10').onLeave).toBe(false);
  });

  it('draws none while the leave is not known, or when its rows cannot be trusted', () => {
    expect(manualLeaveOf(planned, undefined)).toBe(NO_MANUAL_LEAVE);
    expect(manualLeaveOf(planned, [{ id: 'x', member_id: 'nobody', during: '[2026-10-09,2026-10-10)' }])).toBe(NO_MANUAL_LEAVE);
    expect(cellOf(manualMonthOf(planned, MONTH, TODAY, NO_DRAFT), IVA, '2026-10-10').onLeave).toBe(false);
  });
});

describe('the month as the grid draws it (UX-DR72, UX-DR73)', () => {
  it('groups the active members by their team as at the first date, in the teams order, no team last, by name inside', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);

    expect(month.groups.map((group) => [group.teamId, group.rows.map((row) => row.memberId)])).toEqual([
      [A, [ANA]],
      ['pilot-smjena-b', [VIEWER_MEMBER]],
      [DAY_TEAM, [DORA]],
      [null, [IVA]],
    ]);
    expect(month.rows.map((row) => row.memberId)).toEqual([ANA, VIEWER_MEMBER, DORA, IVA]);
    expect(month.dates).toHaveLength(31);
    expect(month.dates[0]).toMatchObject({ date: '2026-10-01', day: '1.', today: true, weekend: false });
    expect(month.dates[2]).toMatchObject({ date: '2026-10-03', weekend: true });
  });

  it("carries each row's job role, or none (story 21.12's entry, built by 21.5)", () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);

    expect(month.rows.map((row) => [row.memberId, row.jobRole])).toEqual([
      [ANA, null],
      [VIEWER_MEMBER, null],
      [DORA, null],
      [IVA, 'Student'],
    ]);
  });

  it('narrows the rows by Posao on Ljudi’s semantics (story 21.25): a role, nobody’s, or every role for an unknown id', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);
    const all = manualRoleFilterOf(month, undefined);

    expect(all.options).toEqual([
      { value: 'all', roleName: '', count: 4 },
      { value: 'pilot-role-student', roleName: 'Student', count: 1 },
      { value: 'none', roleName: '', count: 3 },
    ]);
    expect(all.applied).toBe('all');
    expect(all.shown).toBe(month);

    const student = manualRoleFilterOf(month, 'pilot-role-student');

    expect(student.applied).toBe('pilot-role-student');
    expect(student.shown.groups.map((group) => [group.teamId, group.rows.map((row) => row.memberId)])).toEqual([[null, [IVA]]]);
    expect(student.shown.rows.map((row) => row.memberId)).toEqual([IVA]);
    expect(student.shown.dates).toBe(month.dates);

    expect(manualRoleFilterOf(month, 'none').shown.rows.map((row) => row.memberId)).toEqual([ANA, VIEWER_MEMBER, DORA]);
    expect(manualRoleFilterOf(month, 'gone')).toMatchObject({ applied: 'all', shown: month });
    expect(month.rows.map((row) => row.jobRoleId)).toEqual([null, null, null, 'pilot-role-student']);
  });

  it('names each row its source: rotacija tima for a team with a rotation, ručno otherwise and with no team', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);

    expect(month.rows.map((row) => [row.memberId, row.source])).toEqual([
      [ANA, SOURCE_TEAM],
      [VIEWER_MEMBER, SOURCE_TEAM],
      [DORA, SOURCE_MANUAL],
      [IVA, SOURCE_MANUAL],
    ]);
  });

  it('draws a rotation shift muted with its letter, an assignment solid, and a manual-only row only what is assigned', () => {
    const month = manualMonthOf(planned, MONTH, TODAY, NO_DRAFT);

    expect(cellOf(month, ANA, '2026-10-08')).toMatchObject({ source: CELL_ROTATION, shiftTypeId: DAN, letter: 'D', working: true, changed: false });
    expect(cellOf(month, ANA, '2026-10-09')).toMatchObject({ source: CELL_ROTATION, shiftTypeId: NOC, letter: 'N' });
    expect(cellOf(month, IVA, '2026-10-10')).toMatchObject({ source: CELL_ASSIGNED, shiftTypeId: DAN, off: false, countedTeamId: null });
    expect(cellOf(month, IVA, '2026-10-11')).toMatchObject({ source: CELL_EMPTY, shiftTypeId: null, letter: null });
    expect(cellOf(month, DORA, '2026-10-08')).toMatchObject({ source: CELL_EMPTY });
    expect(month.legend).toEqual([
      { letter: 'D', name: 'Dan' },
      { letter: 'N', name: 'Noć' },
      { letter: 'SL', name: 'Slobodno' },
    ]);
  });

  it('keeps a member inactive for part of the month, with those dates marked inactive, and leaves out one inactive all month', async () => {
    const snapshot = await planningSnapshotOf({
      statuses: [statusRow(DORA, false, '2026-10-15'), statusRow(IVA, false, '2026-09-01')],
    });
    const month = manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT);

    expect(month.rows.map((row) => row.memberId)).not.toContain(IVA);
    expect(cellOf(month, DORA, '2026-10-14').active).toBe(true);
    expect(cellOf(month, DORA, '2026-10-15').active).toBe(false);
  });

  it('marks Saturdays and Sundays as the weekend', () => {
    expect(['2026-10-03', '2026-10-04', '2026-10-05', '2024-02-29', '2000-01-01'].map(isWeekend)).toEqual([true, true, false, false, true]);
  });
});

describe('story 21.18: a holiday on the manual grid (UX-DR78)', () => {
  const HOLIDAY = '2026-10-08';
  const holidays = [holidayRow('h-1', HOLIDAY, 'Dan sjećanja')];

  it('no holiday: no new key on the month, its dates or its cells', () => {
    const month = manualMonthOf(planned, MONTH, TODAY, NO_DRAFT);

    expect(month).not.toHaveProperty('holidays');
    expect(month.dates.some((date) => Object.hasOwn(date, 'holiday'))).toBe(false);
    expect(month.rows.some((row) => row.cells.some((cell) => Object.hasOwn(cell, 'holiday')))).toBe(false);
  });

  it("an emptied member's cell is `holiday` with no type; the date is named; an assignment on the holiday draws as before", async () => {
    const off = await planningSnapshotOf({
      holidays,
      offTeams: [A],
      assignments: [calendarPersonalAssignmentRow(IVA_DAN, IVA, HOLIDAY, 'SHIFT', DAN)],
    });
    const month = manualMonthOf(off, MONTH, TODAY, NO_DRAFT);
    const cell = cellOf(month, ANA, HOLIDAY);

    expect(cell).toMatchObject({ source: CELL_EMPTY, shiftTypeId: null, letter: null, holiday: true });
    expect(cellOf(month, ANA, '2026-10-09')).not.toHaveProperty('holiday');
    expect(cellOf(month, IVA, HOLIDAY)).toMatchObject({ source: CELL_ASSIGNED, shiftTypeId: DAN });
    expect(cellOf(month, IVA, HOLIDAY)).not.toHaveProperty('holiday');
    expect(month.holidays).toEqual([{ date: HOLIDAY, dayMonth: '08.10.', name: 'Dan sjećanja' }]);
    const date = month.dates.find((one) => one.date === HOLIDAY);
    expect(date?.holiday).toBe('Dan sjećanja');
    // The cell's name: `blagdan {name}` after the date, and the value *blagdan*.
    expect(cellLabelOf(cell, 'Ana', date, () => 'Dan', () => 'Smjena A')).toContain('08.10., blagdan Dan sjećanja: blagdan');
  });

  it('a holiday with nobody off names the date and empties no cell', async () => {
    const month = manualMonthOf(await planningSnapshotOf({ holidays }), MONTH, TODAY, NO_DRAFT);

    expect(month.dates.find((one) => one.date === HOLIDAY)?.holiday).toBe('Dan sjećanja');
    expect(cellOf(month, ANA, HOLIDAY)).toMatchObject({ source: CELL_ROTATION, shiftTypeId: DAN });
    expect(cellOf(month, ANA, HOLIDAY)).not.toHaveProperty('holiday');
  });
});

describe('the grouping and the source read the month as the spec says (review)', () => {
  it('groups a member who changes team mid-month under the team of the first date', async () => {
    const snapshot = await planningSnapshotOf({ memberships: [memberMembershipRow(DORA, A, '2026-10-15')] });
    const month = manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT);

    expect(month.groups.find((group) => group.teamId === DAY_TEAM)?.rows.map((row) => row.memberId)).toEqual([DORA]);
    expect(month.groups.find((group) => group.teamId === A)?.rows.map((row) => row.memberId)).toEqual([ANA]);
  });

  it('reads a team whose rotation starts after the month as ručno, and one starting inside it as rotacija tima', async () => {
    const after = await planningSnapshotOf({
      memberships: [memberMembershipRow(DORA, LATE_TEAM, '2026-09-01')],
      rotations: [assignmentRow(LATE_TEAM, 'pilot-rotation', 'pilot-step-0', '2026-11-01', '2026-11-01')],
    });
    const inside = await planningSnapshotOf({
      memberships: [memberMembershipRow(DORA, LATE_TEAM, '2026-09-01')],
      rotations: [assignmentRow(LATE_TEAM, 'pilot-rotation', 'pilot-step-0', '2026-10-31', '2026-10-31')],
    });
    const sourceOf = (snapshot: CalendarSnapshot) => manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT).rows.find((row) => row.memberId === DORA)?.source;

    expect(sourceOf(after)).toBe(SOURCE_MANUAL);
    expect(sourceOf(inside)).toBe(SOURCE_TEAM);
  });

  it('marks a shift counted with another team with that team, and none counted with the own team', () => {
    const counted = draftWith(plain, NO_DRAFT, [{ memberId: ANA, date: '2026-10-20' }], { kind: 'SHIFT', shiftTypeId: NOC, teamId: C });
    const own = draftWith(plain, NO_DRAFT, [{ memberId: ANA, date: '2026-10-20' }], { kind: 'SHIFT', shiftTypeId: NOC, teamId: A });

    expect(cellOf(manualMonthOf(plain, MONTH, TODAY, counted), ANA, '2026-10-20').countedTeamId).toBe(C);
    expect(cellOf(manualMonthOf(plain, MONTH, TODAY, own), ANA, '2026-10-20').countedTeamId).toBeNull();
  });
});

describe('the draft (matrix: range set, rotation cell, clear, unchanged)', () => {
  it('turns a rotation cell into an assignment, even to the type the rotation gives (editing makes it an assignment)', () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }], { kind: 'SHIFT', shiftTypeId: DAN, teamId: null });
    const month = manualMonthOf(plain, MONTH, TODAY, draft);

    expect(draft.size).toBe(1);
    expect(cellOf(month, ANA, '2026-10-08')).toMatchObject({ source: CELL_ASSIGNED, shiftTypeId: DAN, changed: true });
  });

  it('sets a range of cells at once, and sends each as one set item, a counted team only when one is named', () => {
    const cells = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((date) => ({ memberId: IVA, date }));
    const draft = draftWith(plain, NO_DRAFT, cells, { kind: 'SHIFT', shiftTypeId: DAN, teamId: null });
    const counted = draftWith(plain, draft, [{ memberId: ANA, date: '2026-10-20' }], { kind: 'SHIFT', shiftTypeId: NOC, teamId: C });

    expect(draftItemsOf(counted)).toEqual([
      { memberId: ANA, date: '2026-10-20', set: { kind: 'SHIFT', shiftTypeId: NOC, teamId: C } },
      ...cells.map((cell) => ({ ...cell, set: { kind: 'SHIFT', shiftTypeId: DAN } })),
    ]);
    expect(draftWindowOf(counted)).toEqual({ from: '2026-10-05', to: '2026-10-20' });
  });

  it('drops a cell set back to its live row, and a clear where nothing is assigned', () => {
    const same = draftWith(planned, NO_DRAFT, [{ memberId: IVA, date: '2026-10-10' }], { kind: 'SHIFT', shiftTypeId: DAN, teamId: null });
    const nothing = draftWith(planned, NO_DRAFT, [{ memberId: IVA, date: '2026-10-11' }], { kind: MANUAL_CLEAR });
    const there = draftWith(planned, NO_DRAFT, [{ memberId: IVA, date: '2026-10-10' }], { kind: 'OFF' });
    const back = draftWith(planned, there, [{ memberId: IVA, date: '2026-10-10' }], { kind: 'SHIFT', shiftTypeId: DAN, teamId: null });

    expect([same.size, nothing.size, there.size, back.size]).toEqual([0, 0, 1, 0]);
    expect(draftItemsOf(there)).toEqual([{ memberId: IVA, date: '2026-10-10', set: { kind: 'OFF' } }]);
  });

  it('clears a live assignment as a clear item, and the rotation then decides the cell again', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(IVA_DAN, ANA, '2026-10-08', 'OFF')],
    });
    const draft = draftWith(snapshot, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }], { kind: MANUAL_CLEAR });

    expect(cellOf(manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT), ANA, '2026-10-08')).toMatchObject({ source: CELL_ASSIGNED, off: true });
    expect(draftItemsOf(draft)).toEqual([{ memberId: ANA, date: '2026-10-08', clear: true }]);
    expect(cellOf(manualMonthOf(snapshot, MONTH, TODAY, draft), ANA, '2026-10-08')).toMatchObject({ source: CELL_ROTATION, shiftTypeId: DAN, changed: true });
  });

  it('applies the draft to the drafted members alone, and to the viewer when the viewer is one', () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: VIEWER_MEMBER, date: '2026-10-02' }, { memberId: IVA, date: '2026-10-02' }], { kind: 'OFF' });
    const after = draftAppliedOf(plain, draft);
    const off = (memberId: string) => [{ id: draftAssignmentIdOf({ memberId, date: '2026-10-02' }), date: '2026-10-02', kind: 'OFF', shiftTypeId: null, teamId: null }];

    expect(after.members.find((member) => member.id === IVA)?.personalAssignments).toEqual(off(IVA));
    expect(after.members.find((member) => member.id === ANA)).toBe(plain.members.find((member) => member.id === ANA));
    expect(after.viewer.personalAssignments).toEqual(off(VIEWER_MEMBER));
    expect(draftAppliedOf(plain, NO_DRAFT)).toBe(plain);
  });

  it('keeps against a newer read only the cells that still differ from it', async () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: IVA, date: '2026-10-10' }, { memberId: IVA, date: '2026-10-11' }], {
      kind: 'SHIFT',
      shiftTypeId: DAN,
      teamId: null,
    });
    const kept = draftAgainst(planned, draft);

    expect([...kept.values()].map((cell) => cell.date)).toEqual(['2026-10-11']);
    expect(draftAgainst(plain, draft)).toBe(draft);
  });

  it('drops against a newer read the cells of a member it no longer holds (review)', () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: 'gone-member', date: '2026-10-02' }, { memberId: IVA, date: '2026-10-02' }], { kind: 'OFF' });

    expect([...draftAgainst(plain, draft).values()].map((cell) => cell.memberId)).toEqual([IVA]);
  });
});

describe('what 0077 would refuse anyway, read against the fresh calendar', () => {
  const one = (snapshot: CalendarSnapshot, shiftTypeId: string, teamId: string | null = null): ManualDraft =>
    draftWith(snapshot, NO_DRAFT, [{ memberId: IVA, date: '2026-10-02' }], { kind: 'SHIFT', shiftTypeId, teamId });

  it('refuses a member, type or team the read lacks as stale, an archived type as archived, and passes the rest', () => {
    expect(draftRefusalOf(plain, one(plain, DAN))).toBeNull();
    expect(draftRefusalOf(plain, one(plain, ARCHIVED_TYPE))).toBe(MANUAL_ARCHIVED);
    expect(draftRefusalOf(plain, one(plain, 'gone-type'))).toBe(MANUAL_STALE);
    expect(draftRefusalOf(plain, one(plain, DAN, 'gone-team'))).toBe(MANUAL_STALE);
    expect(
      draftRefusalOf(plain, draftWith(plain, NO_DRAFT, [{ memberId: 'gone-member', date: '2026-10-02' }], { kind: 'OFF' })),
    ).toBe(MANUAL_STALE);
  });

  it('refuses more items than one save takes', () => {
    const cells = Array.from({ length: MANUAL_MAX_ITEMS + 1 }, (_, index) => ({ memberId: `m-${String(index)}`, date: '2026-10-02' }));

    expect(draftRefusalOf(plain, draftWith(plain, NO_DRAFT, cells, { kind: 'OFF' }))).toBe(MANUAL_TOO_MANY);
  });

  it('offers every type not archived, working first, and every team not archived', () => {
    expect(pickableTypesOf(plain).map((type) => type.id)).toEqual([DAN, NOC, SLOBODNO]);
    expect(pickableTeamsOf(plain).map((team) => team.id)).toContain(DAY_TEAM);
  });
});

describe('selection (UX-DR72: click, shift-click, drag, arrows and Space)', () => {
  it('selects the rectangle between two cells, both corners included, in either direction', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);
    const from = positionOf(month, { memberId: ANA, date: '2026-10-02' });
    const to = positionOf(month, { memberId: VIEWER_MEMBER, date: '2026-10-03' });

    if (from === null || to === null) throw new Error('not shown');

    const cells = rectangleOf(month, to, from);

    expect(cells).toEqual([
      { memberId: ANA, date: '2026-10-02' },
      { memberId: ANA, date: '2026-10-03' },
      { memberId: VIEWER_MEMBER, date: '2026-10-02' },
      { memberId: VIEWER_MEMBER, date: '2026-10-03' },
    ]);
    expect(positionOf(month, { memberId: 'nobody', date: '2026-10-02' })).toBeNull();
  });

  it('toggles one cell in and out', () => {
    const cell = { memberId: IVA, date: '2026-10-02' };
    const once = toggledOf([], cell);

    expect(once).toEqual([cell]);
    expect(toggledOf(once, { ...cell })).toEqual([]);
  });

  it('moves by the arrows, Home and End, kept inside the grid, and ignores other keys', () => {
    const month = manualMonthOf(plain, MONTH, TODAY, NO_DRAFT);

    expect(movedOf(month, { row: 0, column: 0 }, 'ArrowUp')).toEqual({ row: 0, column: 0 });
    expect(movedOf(month, { row: 0, column: 0 }, 'ArrowDown')).toEqual({ row: 1, column: 0 });
    expect(movedOf(month, { row: 3, column: 30 }, 'ArrowRight')).toEqual({ row: 3, column: 30 });
    expect(movedOf(month, { row: 1, column: 5 }, 'Home')).toEqual({ row: 1, column: 0 });
    expect(movedOf(month, { row: 1, column: 5 }, 'End')).toEqual({ row: 1, column: 30 });
    expect(movedOf(month, { row: 1, column: 5 }, 'a')).toBeNull();
  });
});
