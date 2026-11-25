import { HOURS_FIGURE_TOTAL, HOURS_SOURCE_PERSONAL } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import { ANNUAL_LEAVE_ID } from '@/features/absence-types/services/list';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  DAY_NO_ROTATION,
  DAY_OFF,
  dayDetailOf,
  dayNotWorkingMessageKey,
  rosterOffersOf,
  rosterOverlapOf,
  swapOfferedOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { cellLabelOf, dayListLabelsOf, gridCellLabelsOf, legendAssignedOf } from '@/features/calendar/utils/modifiers';
import { NO_MARKS, calendarDayListOf, calendarMonthOf, monthHeaderOf, type CalendarDay } from '@/features/calendar/utils/month';
import { resolutionStaffingOf } from '@/features/conflicts/services/resolution-screen';
import { EXPLANATION_HOURS, hoursExplanationOf } from '@/features/hours/services/hours-explanation';
import { AMEND_REMOVES } from '@/features/leave/services/leave-section';
import { LOAN_GAINED, LOAN_LOST, loanChangeSnapshotOf, loanPreviewOf } from '@/features/members/services/loan';
import {
  A,
  ANA,
  B,
  DAN,
  DAY_TEAM,
  DORA,
  IVA,
  MONTH,
  NOC,
  TODAY,
  calendarPersonalAssignmentRow,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import { coverageAgainstMinimumOf, dayStaffingOf } from '@/features/staffing/services/short-staffed';
import { swapShiftWorkedBy } from '@/features/swaps/services/swap-proposal';
import { initLocalization, t } from '@/lib/i18n';

/**
 * STORY 21.6 — PERSONAL SHIFTS ARE READ WHEREVER SHIFTS ARE READ, over
 * *Ručni raspored*'s test calendar (October 2026; Smjena A works Dan 08., 12.,
 * 16. and Noć 09., 13.; DORA on *Dnevni*, a team with no rotation; IVA, a
 * student, on no team). Each case is a row of the spec's I/O matrix.
 */

const SATURDAY = '2026-10-10';
const DAY_TEAM_DATE = '2026-10-15';
const A_NIGHT = '2026-10-13';
const COUNTED_DATE = '2026-10-20';
/** Smjena A's *Dan*, which IVA also works with no team. */
const A_DAY = '2026-10-16';
/** Smjena A's *Noć* that ANA works by rotation, with no assignment. */
const A_ROTATION_NIGHT = '2026-10-09';

const id = (n: number): string => `00000000-0000-4000-8000-00000000f1${String(n).padStart(2, '0')}`;

let snapshot: CalendarSnapshot;
let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf({ minimumMembers: 2 });
  snapshot = await planningSnapshotOf({
    minimumMembers: 4,
    assignments: [
      // Row 1: a student, *Dan* on a Saturday, no team.
      calendarPersonalAssignmentRow(id(1), IVA, SATURDAY, 'SHIFT', DAN),
      // Row 2: a crew member's *Dan* counted with Smjena B.
      calendarPersonalAssignmentRow(id(2), ANA, COUNTED_DATE, 'SHIFT', DAN, B),
      // Row 3: three *Dan* with *Dnevni*, a team with no rotation.
      calendarPersonalAssignmentRow(id(3), DORA, DAY_TEAM_DATE, 'SHIFT', DAN),
      calendarPersonalAssignmentRow(id(4), IVA, DAY_TEAM_DATE, 'SHIFT', DAN, DAY_TEAM),
      calendarPersonalAssignmentRow(id(5), ANA, DAY_TEAM_DATE, 'SHIFT', DAN, DAY_TEAM),
      // Row 4: *Noć* with Smjena A on Smjena A's own *Noć*.
      calendarPersonalAssignmentRow(id(6), ANA, A_NIGHT, 'SHIFT', NOC, A),
      // A student's teamless *Dan* on Smjena A's *Dan*: the overlap hint and a loan's preview.
      calendarPersonalAssignmentRow(id(7), IVA, A_DAY, 'SHIFT', DAN),
      // DORA's *Noć* counted with Smjena A on its *Dan*: a group beside a working Scheduled Shift.
      calendarPersonalAssignmentRow(id(8), DORA, A_DAY, 'SHIFT', NOC, A),
    ],
  });
});

function historyOf(of: CalendarSnapshot, memberId: string) {
  const member = of.members.find((one) => one.id === memberId);

  if (member === undefined) throw new Error(`no member ${memberId}`);

  return { memberId, memberships: member.memberships, statuses: member.statuses };
}

/** The day detail of `teamId` on `date`, which the fixture holds. */
function detailOf(teamId: string, date: string): DayDetail {
  const detail = dayDetailOf(snapshot, teamId, date);

  if (detail === null) throw new Error(`no day ${teamId} ${date}`);

  return detail;
}

/** The grid cell of `teamId` on `date`. */
function gridCellOf(month: ReturnType<typeof calendarMonthOf>, teamId: string, date: string) {
  const column = month.columns.findIndex((team) => team.id === teamId);
  const cell = month.rows.find((one) => one.date === date)?.cells[column];

  if (cell === undefined) throw new Error(`no cell ${teamId} ${date}`);

  return cell;
}

function dayOf(days: readonly CalendarDay[] | null, date: string): CalendarDay {
  const day = days?.find((one) => one.date === date);

  if (day === undefined) throw new Error(`no day ${date}`);

  return day;
}

describe('the day list reads every Personal Shift (Moj raspored, Osoba, Danas)', () => {
  it('row 1: a student’s teamless *Dan* is a row of its own, marked assigned, named `bez tima`', () => {
    const days = calendarDayListOf(snapshot, historyOf(snapshot, IVA), MONTH, TODAY);
    const day = dayOf(days, SATURDAY);
    const [shift] = day.shifts;

    expect(day.shifts).toHaveLength(1);
    expect(shift?.teamId).toBeNull();
    expect(shift?.cell).toMatchObject({ teamId: null, shiftTypeId: DAN, name: 'Dan', assigned: true });
    expect(shift?.cell.groups).toBeUndefined();

    const labels = dayListLabelsOf([day], snapshot.teams, (key) => t(key));

    expect(labels[0]?.[0]).toContain('bez tima');
    expect(labels[0]?.[0]).toContain('dodijeljeno ručno');
    expect(legendAssignedOf(day.shifts.map((one) => one.cell))).toBe(true);
  });

  it('row 2: a shift counted with a team opens that team’s day', () => {
    const day = dayOf(calendarDayListOf(snapshot, historyOf(snapshot, ANA), MONTH, TODAY), COUNTED_DATE);

    expect(day.shifts.map((one) => [one.teamId, one.cell.shiftTypeId, one.cell.assigned])).toEqual([[B, DAN, true]]);
  });

  it('no assignment: the day list is as it was, no `assigned` and no `groups` anywhere', () => {
    const days = calendarDayListOf(plain, historyOf(plain, ANA), MONTH, TODAY) ?? [];

    for (const day of days) {
      for (const shift of day.shifts) {
        expect(shift.cell).not.toHaveProperty('assigned');
        expect(shift.cell).not.toHaveProperty('groups');
      }
    }
    expect(legendAssignedOf(days.flatMap((day) => day.shifts.map((one) => one.cell)))).toBe(false);
  });
});

describe('the team grid adds each staffing group to its cell', () => {
  it('row 3: a day team with no rotation shows its group, named by its label', () => {
    const month = calendarMonthOf(snapshot, { mjesec: MONTH }, TODAY);
    const column = month.columns.findIndex((team) => team.id === DAY_TEAM);
    const row = month.rows.findIndex((one) => one.date === DAY_TEAM_DATE);
    const cell = month.rows[row]?.cells[column];

    expect(cell).toMatchObject({ teamId: DAY_TEAM, shiftTypeId: null, name: null });
    expect(cell?.groups?.map((group) => [group.shiftTypeId, group.name])).toEqual([[DAN, 'Dan']]);

    const label = gridCellLabelsOf(month, (key) => t(key))[row]?.[column] ?? '';

    expect(label).toContain('Dnevni');
    expect(label).toContain('Dan');
    expect(label).toContain('dodijeljeno ručno');
    expect(label).not.toContain(t('kalendar.noRotation'));
  });

  it('row 4: an assignment of the rotation’s own type is no group', () => {
    const month = calendarMonthOf(snapshot, { mjesec: MONTH }, TODAY);
    const column = month.columns.findIndex((team) => team.id === A);
    const cell = month.rows.find((one) => one.date === A_NIGHT)?.cells[column];

    expect(cell?.shiftTypeId).toBe(NOC);
    expect(cell).not.toHaveProperty('groups');
  });

  it('no assignment: no grid cell carries `groups` or `assigned`', () => {
    const month = calendarMonthOf(plain, { mjesec: MONTH }, TODAY);

    for (const row of month.rows) {
      for (const cell of row.cells) {
        expect(cell).not.toHaveProperty('groups');
        expect(cell).not.toHaveProperty('assigned');
      }
    }
  });

  it('a label names `dodijeljeno ručno` after the range, before the marks', () => {
    expect(
      cellLabelOf(
        { weekday: 'subota', dayMonth: '10.10.', teamName: 'bez tima', name: 'Dan', range: '07:00–19:00', modifiers: ['leave'], assigned: true },
        (key) => t(key),
      ),
    ).toBe(`subota 10.10., bez tima, Dan, 07:00–19:00, dodijeljeno ručno, ${t('kalendar.modifier.leave')}`);
  });
});

describe('the day detail', () => {
  it('row 3: a no-rotation day shows its group, its people by name, and its own staffing line', () => {
    const detail = dayDetailOf(snapshot, DAY_TEAM, DAY_TEAM_DATE);

    expect(detail?.kind).toBe('noRotation');
    expect(detail?.groups).toHaveLength(1);
    expect(detail?.groups?.[0]?.typeName).toBe('Dan');
    expect(detail?.groups?.[0]?.roster.map((member) => [member.name, member.assigned])).toEqual([
      ['Ana Anić', true],
      ['Dora Dorić', true],
      ['Iva Ivić', true],
    ]);
    // `rade 3 od najmanje 4`: the group's own people, through `peopleAtWorkOn(…, type)`.
    expect(dayStaffingOf(snapshot, [], DAY_TEAM, DAY_TEAM_DATE, DAN)).toEqual({ atWork: 3, minimum: 4, short: true });
    // With no type, the Scheduled Shift alone: there is none.
    expect(dayStaffingOf(snapshot, [], DAY_TEAM, DAY_TEAM_DATE)).toBeNull();
  });

  it('row 4: the rotation’s own type puts the member on *Sastav*, marked, with no group', () => {
    const detail = dayDetailOf(snapshot, A, A_NIGHT);
    const ana = detail?.roster.find((member) => member.id === ANA);

    expect(detail?.kind).toBe('working');
    expect(ana?.assigned).toBe(true);
    expect(detail).not.toHaveProperty('groups');
  });

  it('row 2: Tim B lists the member under its *Dan* group, or on *Sastav* when *Dan* is Tim B’s own type that day', () => {
    const detail = detailOf(B, COUNTED_DATE);
    const onSastav = detail.roster.find((member) => member.id === ANA);
    const dan = detail.groups?.find((group) => group.shiftTypeId === DAN);

    if (detail.kind === 'working' && detail.shiftTypeId === DAN) {
      expect(onSastav?.assigned).toBe(true);
      expect(dan).toBeUndefined();
    } else {
      expect(onSastav).toBeUndefined();
      expect(dan?.typeName).toBe('Dan');
      expect(dan?.roster.map((member) => [member.id, member.assigned])).toEqual([[ANA, true]]);
    }
  });

  it('no assignment: every day detail of the month is the detail it was, with no group and no mark', () => {
    for (const team of plain.teams) {
      for (const date of ['2026-10-08', '2026-10-09', '2026-10-10']) {
        const detail = dayDetailOf(plain, team.id, date);

        expect(detail).not.toHaveProperty('groups');
        for (const member of detail?.roster ?? []) expect(member).not.toHaveProperty('assigned');
      }
    }
  });

  it('a lent member counted with the loan team is shown as a rotation member would be: `posudba iz tima`', () => {
    const span = { memberId: ANA, teamId: B, from: COUNTED_DATE, to: COUNTED_DATE };
    const applied = loanChangeSnapshotOf(snapshot, span);

    if (!applied.ok) throw new Error(applied.code);

    const detail = dayDetailOf(applied.after, B, COUNTED_DATE);
    const listed = [...(detail?.roster ?? []), ...(detail?.groups ?? []).flatMap((group) => group.roster)];
    const ana = listed.find((member) => member.id === ANA);

    expect(ana?.assigned).toBe(true);
    expect(ana?.lentFrom).toBeDefined();
    // A loan holds no position, as on the rotation's roster.
    expect(ana?.position).toBeNull();
  });

  it('a Personal Shift is never offered for a swap here (story 21.8); the same member’s rotation shift is', () => {
    const asAna = { ...snapshot, viewer: { ...snapshot.viewer, memberId: ANA, role: 'member_role' as const } };
    const rotation = detailOf(A, A_ROTATION_NIGHT);

    // The control: ANA works Smjena A's *Noć* 09.10. by rotation, from today on.
    expect(rotation.roster.find((member) => member.id === ANA)).toBeDefined();
    expect(A_ROTATION_NIGHT >= TODAY).toBe(true);
    expect(swapOfferedOf(asAna, rotation, TODAY, [])).toBe(true);
    // On *Noć* 13.10. she is on *Sastav* only through her assignment.
    expect(swapOfferedOf(asAna, detailOf(A, A_NIGHT), TODAY, [])).toBe(false);
  });

  it('a swap’s colleague works the shift by rotation, never through a Personal Assignment alone', () => {
    expect(swapShiftWorkedBy(snapshot, { teamId: A, date: A_ROTATION_NIGHT }, ANA)).toBe(true);
    expect(swapShiftWorkedBy(snapshot, { teamId: A, date: A_NIGHT }, ANA)).toBe(false);
  });

  it('a roster override never takes off or puts on a member there through a Personal Assignment', () => {
    const offers = rosterOffersOf(snapshot, detailOf(A, A_NIGHT));
    const control = rosterOffersOf(snapshot, detailOf(A, A_ROTATION_NIGHT));

    expect(offers.set).toBe(true);
    expect(offers.out.map((one) => one.id)).not.toContain(ANA);
    expect(offers.in.map((one) => one.id)).not.toContain(ANA);
    // The control: on her rotation's *Noć* she is one to take off.
    expect(control.out.map((one) => one.id)).toContain(ANA);
  });

  it('an off or no-rotation day with a group says its rotation gives no shift, never that nobody works', () => {
    const grouped = detailOf(DAY_TEAM, DAY_TEAM_DATE);

    expect(grouped.kind).toBe(DAY_NO_ROTATION);
    expect(dayNotWorkingMessageKey({ kind: DAY_NO_ROTATION, groups: grouped.groups ?? [] })).toBe('kalendar.detail.noRotationGroups');
    expect(dayNotWorkingMessageKey({ kind: DAY_NO_ROTATION })).toBe('kalendar.detail.noRotation');
    expect(dayNotWorkingMessageKey({ kind: DAY_OFF, groups: [{}] })).toBe('kalendar.detail.offGroups');
    expect(dayNotWorkingMessageKey({ kind: DAY_OFF, groups: [] })).toBe('kalendar.detail.off');
  });

  it('the grid’s groups and the day detail’s are the same, team for team and date for date', () => {
    const month = calendarMonthOf(snapshot, { mjesec: MONTH }, TODAY);

    for (const row of month.rows) {
      for (const cell of row.cells) {
        const detail = detailOf(cell.teamId, row.date);

        expect((cell.groups ?? []).map((group) => group.shiftTypeId), `${cell.teamId} ${row.date}`).toEqual(
          (detail.groups ?? []).map((group) => group.shiftTypeId),
        );
      }
    }
    // A group beside a working Scheduled Shift: DORA's *Noć* with Smjena A on its *Dan*.
    expect(gridCellOf(month, A, A_DAY).groups?.map((group) => group.shiftTypeId)).toEqual([NOC]);
  });

  it('the overlap hint reads a teamless leg: `bez tima` is a `null` team', () => {
    // IVA's teamless *Dan* 16.10. is Smjena A's *Dan* that date.
    const detail = detailOf(A, A_DAY);

    expect(detail.shiftTypeId).toBe(DAN);
    expect(rosterOverlapOf(snapshot, detail, IVA)).toMatchObject({ teamName: null, date: A_DAY });
  });
});

describe('the resolution coverage reads the collision’s own type', () => {
  it('a group’s type is its group, not the Scheduled Shift', () => {
    expect(coverageAgainstMinimumOf(snapshot, [], DAY_TEAM, DAY_TEAM_DATE, DAN)).toEqual({ atWork: 3, minimum: 4, short: true });
    expect(coverageAgainstMinimumOf(snapshot, [], DAY_TEAM, DAY_TEAM_DATE)).toBeNull();
  });

  it('the resolution strip of a group member’s collision counts the group’s people', () => {
    const record = { absenceTypeId: ANNUAL_LEAVE_ID, drawsAllowance: true, id: 'leave-dora', from: DAY_TEAM_DATE, to: DAY_TEAM_DATE };
    const records = [{ ...record, memberId: DORA }];
    const collision = { memberId: DORA, date: DAY_TEAM_DATE, teamId: DAY_TEAM, shiftTypeId: DAN, leaveRecordId: record.id };
    const staffing = resolutionStaffingOf(snapshot, records, collision, record, { kind: AMEND_REMOVES });

    // Accepting leaves the group's two others; removing the leave gives back all three.
    expect(staffing === null ? null : { accept: staffing.accept, amend: staffing.amend }).toEqual({
      accept: { atWork: 2, minimum: 4, short: true },
      amend: { atWork: 3, minimum: 4, short: true },
    });
  });
});

describe('the grid cell of a short group', () => {
  it('a no-rotation cell with a group short of the minimum carries the short-staffed mark', () => {
    const month = calendarMonthOf(snapshot, { mjesec: MONTH }, TODAY, { ...NO_MARKS, staffingLeave: [] });
    const cell = gridCellOf(month, DAY_TEAM, DAY_TEAM_DATE);

    expect(cell.shiftTypeId).toBeNull();
    expect(cell.modifiers).toEqual(['shortStaffed']);
    // A no-rotation cell with no group still carries none.
    expect(gridCellOf(month, DAY_TEAM, SATURDAY).modifiers).toEqual([]);
    // The legend's pencil is asked by a grid cell carrying only groups too.
    expect(cell.assigned).toBeUndefined();
    expect(legendAssignedOf([cell])).toBe(true);
  });
});

describe('the loan preview reads a teamless shift', () => {
  it('lending IVA to Smjena A on 16.10. moves her teamless *Dan* to the team: lost `bez tima`, gained Smjena A', () => {
    const span = { memberId: IVA, teamId: A, from: A_DAY, to: A_DAY };
    const applied = loanChangeSnapshotOf(snapshot, span);

    if (!applied.ok) throw new Error(applied.code);

    const preview = loanPreviewOf(snapshot, applied.after, span);

    expect(preview.shifts).toEqual([
      expect.objectContaining({ side: LOAN_LOST, team: null, type: 'Dan', date: A_DAY }),
      expect.objectContaining({ side: LOAN_GAINED, team: 'Smjena A', type: 'Dan', date: A_DAY }),
    ]);
  });
});

describe('the hours explanation', () => {
  it('row 5: a teamless line reads `bez tima`, its source *osobni raspored*, never unavailable', () => {
    const view = hoursExplanationOf(
      snapshot,
      { memberId: IVA, figure: { code: HOURS_FIGURE_TOTAL } },
      monthHeaderOf(MONTH, TODAY),
      [],
      [],
      new Map(),
      [],
    );

    expect(view).not.toBeNull();

    const lines = view?.kind === EXPLANATION_HOURS ? view.lines : [];
    const saturday = lines.find((line) => line.label.startsWith('bez tima'));

    expect(saturday?.source).toBe(HOURS_SOURCE_PERSONAL);
    expect(saturday?.label).toBe(`bez tima · Dan · ${t('sati.explain.source.personal')}`);
  });
});
