import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  CALENDAR_CELL_CLASS,
  ROLE_SEARCH_PARAM,
  calendarMonthOf,
  calendarSearchOf,
  calendarSearchTo,
  cellFillClassOf,
  paperCellTargetOf,
  paperRowCountOf,
  teamHasRotationBy,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import {
  A,
  ANA,
  ARCHIVED_TYPE,
  DAN,
  DAY_TEAM,
  DORA,
  IVA,
  LATE_TEAM,
  MONTH,
  TODAY,
  VIEWER_MEMBER,
  calendarPersonalAssignmentRow,
  memberMembershipRow,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 21.25 (UX-DR83), *KALENDAR KAO PAPIR*, executed (AD-15): the month as
 * the paper roster — the turnus teams' rows, then the people on a personal
 * or manual schedule grouped by job role — the *Posao* filter on *Ljudi*'s
 * semantics, and what a cell opens. Over *Ručni raspored*'s fixture: four
 * pilot crews on a rotation, DORA on *Dnevni* (no rotation), IVA a student
 * on no team, ANA and the viewer on the crews.
 */

const STUDENT = 'pilot-role-student';
const B = 'pilot-smjena-b';
const D = 'pilot-smjena-d';

let plain: CalendarSnapshot;
let planned: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
  planned = await planningSnapshotOf({
    assignments: [
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f101', IVA, '2026-10-05', 'SHIFT', DAN, A),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f102', IVA, '2026-10-06', 'OFF'),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f103', DORA, '2026-10-07', 'SHIFT', DAN),
    ],
  });
});

function monthOf(snapshot: CalendarSnapshot, search: Record<string, unknown> = {}): CalendarMonth {
  return calendarMonthOf(snapshot, calendarSearchOf({ mjesec: MONTH, ...search }), TODAY);
}

describe('the teams are the first rows (story 21.25)', () => {
  it('draws a row per shown team, a day team with no rotation too, its cells the grid’s, date by date', () => {
    const month = monthOf(plain);

    expect(month.teamRows.map((row) => row.team.id)).toEqual([DAY_TEAM, LATE_TEAM, A, B, 'pilot-smjena-c', D]);
    expect(month.teamRows.map((row) => row.team.id)).toEqual(month.columns.map((team) => team.id));
    for (const row of month.teamRows) {
      expect(row.cells).toHaveLength(month.rows.length);
      month.rows.forEach((date, index) => {
        expect(row.cells[index]).toBe(date.cells[row.column]);
      });
    }
  });

  it('knows a turnus team by a rotation version in effect by a date', () => {
    expect(teamHasRotationBy(plain, A, '2026-10-31')).toBe(true);
    expect(teamHasRotationBy(plain, DAY_TEAM, '2026-10-31')).toBe(false);
    expect(teamHasRotationBy(plain, LATE_TEAM, '2026-10-31')).toBe(false);
  });
});

describe('the people on a personal or manual schedule, by job role (story 21.25)', () => {
  it('groups the people whose team has no rotation, or who are on none, by role name, no role last', () => {
    const month = monthOf(plain);

    expect(month.peopleGroups.map((group) => [group.roleName, group.rows.map((row) => row.memberId)])).toEqual([
      ['Student', [IVA]],
      [null, [DORA]],
    ]);
    // A crew's member is read on their crew's row, never as a person.
    const people = month.peopleGroups.flatMap((group) => group.rows.map((row) => row.memberId));
    expect(people).not.toContain(ANA);
    expect(people).not.toContain(VIEWER_MEMBER);
    expect(month.peopleGroups[1]?.rows[0]?.teamName).toBe('Dnevni');
    expect(month.peopleGroups[0]?.rows[0]?.teamName).toBeNull();
  });

  it('reads a member on a turnus team on any active date of the month on that team’s row, a mid-month joiner too', async () => {
    const joiner = await planningSnapshotOf({ memberships: [memberMembershipRow(IVA, A, '2026-10-15')] });
    const people = monthOf(joiner).peopleGroups.flatMap((group) => group.rows.map((row) => row.memberId));

    expect(people).toEqual([DORA]);
  });

  it("draws a person's day: an assigned shift with its letter and team, an assigned day off, and nothing", () => {
    const month = monthOf(planned);
    const iva = month.peopleGroups[0]?.rows[0];
    const dora = month.peopleGroups[1]?.rows[0];
    const at = (date: string) => iva?.cells.find((cell) => cell.date === date);

    expect(at('2026-10-05')).toMatchObject({ assigned: true, off: false, active: true, teamId: A });
    expect(at('2026-10-05')?.cell).toMatchObject({ shiftTypeId: DAN, name: 'Dan', letter: 'D' });
    expect(at('2026-10-06')).toMatchObject({ cell: null, off: true, assigned: true });
    // Nothing that date, and no team of their own: the first crew's day.
    expect(at('2026-10-07')).toMatchObject({ cell: null, off: false, assigned: false, teamId: A });
    // A shift counted with no team opens their own team's day (Dnevni, active).
    expect(dora?.cells.find((cell) => cell.date === '2026-10-07')).toMatchObject({ assigned: true, teamId: DAY_TEAM });
    expect(dora?.cells.find((cell) => cell.date === '2026-10-07')?.cell?.letter).toBe('D');
  });

  it('fills a letter box from the fill alone, never the cell’s shape', () => {
    const cell = monthOf(planned).teamRows.find((row) => row.team.id === A)?.cells.find((one) => one.shiftTypeId === DAN);

    expect(cell?.className.startsWith(CALENDAR_CELL_CLASS)).toBe(true);
    expect(cellFillClassOf(cell ?? { className: '' })).not.toContain('min-h-[30px]');
    expect(cellFillClassOf(cell ?? { className: '' }).length).toBeGreaterThan(0);
    expect(cellFillClassOf({ className: 'bg-card' })).toBe('bg-card');
  });

  it('narrows the people by the team chosen; a team with no rotation is its own row, its member a person', () => {
    const month = monthOf(plain, { smjena: DAY_TEAM });

    expect(month.teamRows.map((row) => row.team.id)).toEqual([DAY_TEAM]);
    expect(month.peopleGroups.flatMap((group) => group.rows.map((row) => row.memberId))).toEqual([DORA]);
  });
});

describe('Posao (story 21.25, on Ljudi’s semantics)', () => {
  it('never changes a team’s letter: the letters are worked out over every person row, filtered or not', async () => {
    // IVA's `Staro` widens `Slobodno`'s letter; hiding IVA by her role must not narrow it back.
    const staro = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f201', IVA, '2026-10-05', 'SHIFT', ARCHIVED_TYPE)],
    });
    const letterOf = (month: CalendarMonth): string | null | undefined =>
      month.teamRows.find((row) => row.team.id === A)?.cells.find((cell) => cell.name === 'Slobodno')?.letter;
    const all = monthOf(staro);
    const none = monthOf(staro, { posao: 'none' });

    expect(none.peopleGroups.flatMap((group) => group.rows.map((row) => row.memberId))).not.toContain(IVA);
    expect(letterOf(all)).not.toBe('S');
    expect(letterOf(none)).toBe(letterOf(all));
  });

  it('offers every role, each role held by name, and no role, with the people each would show', () => {
    expect(monthOf(plain).filter.roles).toEqual([
      { value: 'all', roleName: '', count: 4 },
      { value: STUDENT, roleName: 'Student', count: 1 },
      { value: 'none', roleName: '', count: 3 },
    ]);
    expect(monthOf(plain).filter.role).toBeNull();
  });

  it('narrows the people to the role, and the teams to those somebody holding it is on', () => {
    const student = monthOf(plain, { posao: STUDENT });

    expect(student.filter.role).toBe(STUDENT);
    expect(student.peopleGroups.map((group) => group.roleName)).toEqual(['Student']);
    // IVA is on no team: no team is shown.
    expect(student.columns).toEqual([]);
    expect(student.teamRows).toEqual([]);

    const none = monthOf(plain, { posao: 'none' });

    expect(none.peopleGroups.map((group) => group.rows.map((row) => row.memberId))).toEqual([[DORA]]);
    expect(none.teamRows.map((row) => row.team.id)).toEqual([DAY_TEAM, A, B]);
    expect(none.columns.map((team) => team.id)).toEqual([DAY_TEAM, A, B]);
  });

  it('reads an unknown role as every role, and a person chosen as no role, keeping the URL', () => {
    expect(monthOf(plain, { posao: 'gone' }).filter.role).toBeNull();
    expect(monthOf(plain, { posao: 'gone' }).teamRows).toHaveLength(6);
    expect(monthOf(plain, { posao: STUDENT, osoba: ANA }).filter.role).toBeNull();
    expect(calendarSearchOf({ posao: STUDENT })).toEqual({ posao: STUDENT });
    expect(calendarSearchOf({ posao: '' })).toEqual({});
    expect(calendarSearchTo({ mjesec: MONTH, posao: STUDENT }, { mjesec: '2026-11' })).toEqual({
      mjesec: '2026-11',
      [ROLE_SEARCH_PARAM]: STUDENT,
    });
    expect(calendarSearchTo({ posao: STUDENT }, { smjena: null, osoba: null, posao: null })).toEqual({});
  });
});

describe('the paper grid’s cells, as the keys walk them (story 21.25)', () => {
  it('counts the rows, teams then people, and opens a team’s day or the day a person’s cell names', () => {
    const month = monthOf(planned);

    expect(paperRowCountOf(month)).toBe(8);
    expect(paperCellTargetOf(month, 2, 4)).toEqual({ teamId: A, date: '2026-10-05' });
    expect(paperCellTargetOf(month, 5, 0)).toEqual({ teamId: D, date: '2026-10-01' });
    // Row 6 is IVA (Student), row 7 DORA (no role); IVA's empty day opens the first turnus team.
    expect(paperCellTargetOf(month, 6, 4)).toEqual({ teamId: A, date: '2026-10-05' });
    expect(paperCellTargetOf(month, 6, 6)).toEqual({ teamId: A, date: '2026-10-07' });
    expect(paperCellTargetOf(month, 7, 6)).toEqual({ teamId: DAY_TEAM, date: '2026-10-07' });
    expect(paperCellTargetOf(month, 8, 0)).toBeNull();
    expect(paperCellTargetOf(month, 0, 31)).toBeNull();
  });
});
