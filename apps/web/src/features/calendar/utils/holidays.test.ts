import { collisionsOf, scheduleOfMonth } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  holidayNamesOfCalendar,
  holidayRuleOfCalendar,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import {
  DAY_NO_ROTATION,
  DAY_OFF,
  DAY_WORKING,
  OVERRIDE_REFUSED_SAME,
  dayDetailOf,
  holidayOffMessageKey,
  overrideEntryOf,
  sameTypeOf,
  overrideTypeOptionsOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { dayListLabelsOf, gridCellLabelsOf } from '@/features/calendar/utils/modifiers';
import {
  calendarDayListOf,
  calendarMonthOf,
  monthHolidaysOf,
  snapshotScheduleInputOf,
  staffingInputOf,
  type CalendarDay,
  type CalendarRow,
} from '@/features/calendar/utils/month';
import { personLabelOf } from '@/features/calendar/components/calendar-grid';
import { overridePreviewOf } from '@/features/calendar/utils/change-preview';
import { sameTypeIdOf } from '@/features/conflicts/services/override-erasures';
import { ITEM_COLLISION, collisionInputOf, liveResolutionsOf } from '@/features/conflicts/services/conflicts-queue';
import { erasuresOf } from '@/features/conflicts/services/erasures';
import {
  appliedReplacementOverrideOf,
  effectiveResolutionsOf,
  heldByReplacement,
} from '@/features/conflicts/services/replacement-effect';
import { resolvedConflictsViewOf, type ResolvedConflictRow } from '@/features/conflicts/services/resolved-conflicts';
import {
  A,
  ANA,
  B,
  DAN,
  DORA,
  MONTH,
  NOC,
  TODAY,
  DAY_TEAM,
  VIEWER_MEMBER,
  ARCHIVED_TEAM,
  assignmentRow,
  calendarOverrideRow,
  memberMembershipRow,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  holidayRow,
  leaveRowOf,
  planningSnapshotOf,
  scheduleVersionRow,
} from '@/features/planning/planning.fixture';
import { coverageAgainstMinimumOf } from '@/features/staffing/services/short-staffed';
import { initLocalization } from '@/lib/i18n';
import { gridDatesOf } from '@/utils/grid-dates';

/**
 * STORY 21.16 — HOLIDAYS ARE ORGANIZATION DATA, read by every derivation the
 * browser makes from the calendar snapshot, over *Ručni raspored*'s test
 * calendar (October 2026; Smjena A works Dan on the 8th, ANA on it; Smjena B,
 * the viewer's, works Noć that date). Each case is a row of the spec's I/O
 * matrix: the holiday H is 2026-10-08, the off team D is Smjena A, and the
 * working team K is Smjena B.
 */

const HOLIDAY = '2026-10-08';

let plain: CalendarSnapshot;
let offA: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf({ minimumMembers: 1 });
  offA = await planningSnapshotOf({
    minimumMembers: 1,
    holidays: [holidayRow('h-1', HOLIDAY, 'Blagdan'), holidayRow('h-2', '2026-12-25', 'Božić')],
    offTeams: [A],
  });
});

function historyOf(of: CalendarSnapshot, memberId: string) {
  const member = of.members.find((one) => one.id === memberId);

  if (member === undefined) throw new Error(`no member ${memberId}`);

  return { memberId, memberships: member.memberships, statuses: member.statuses };
}

function detailOf(of: CalendarSnapshot, teamId: string, date: string): DayDetail {
  const detail = dayDetailOf(of, teamId, date);

  if (detail === null) throw new Error(`no day ${teamId} ${date}`);

  return detail;
}

function gridCellOf(of: CalendarSnapshot, teamId: string, date: string) {
  const month = calendarMonthOf(of, { mjesec: MONTH }, TODAY);
  const column = month.columns.findIndex((team) => team.id === teamId);
  const cell = month.rows.find((one) => one.date === date)?.cells[column];

  if (cell === undefined) throw new Error(`no cell ${teamId} ${date}`);

  return cell;
}

/**
 * STORY 21.18: the holiday NAME set aside on its known paths alone — a row's,
 * a day's and the day detail's `holiday` — so the R13.5 comparisons keep
 * their strength everywhere else. A name is display only (Design Note 1): a
 * date is named whether or not a team is off.
 */
function rowsUnnamed(rows: readonly CalendarRow[]): readonly CalendarRow[] {
  return rows.map(({ holiday: _name, ...row }) => row);
}

function daysUnnamed(days: readonly CalendarDay[] | null): readonly CalendarDay[] | null {
  return days === null ? null : days.map(({ holiday: _name, ...day }) => day);
}

function detailUnnamed({ holiday: _name, ...detail }: DayDetail): DayDetail {
  return detail;
}

function dayOf(days: readonly CalendarDay[] | null, date: string): CalendarDay {
  const day = days?.find((one) => one.date === date);

  if (day === undefined) throw new Error(`no day ${date}`);

  return day;
}

describe('no holiday: every derivation is as before (R13.5)', () => {
  it('none stored, every team not off: the snapshot carries `[]` and every flag false', () => {
    expect(plain.holidays).toEqual([]);
    expect(plain.teams.every((team) => !team.offOnHolidays)).toBe(true);
    // The shared input carries no holiday key at all, so every input built from it is key for key as before.
    const shared = snapshotScheduleInputOf(plain);
    expect(Object.hasOwn(shared, 'holidays')).toBe(false);
    expect(Object.hasOwn(shared, 'teamsOffOnHolidays')).toBe(false);
  });

  it('a holiday with no team off, or a team off with no holiday, derives the same month, day detail and day list', async () => {
    const holidayOnly = await planningSnapshotOf({ minimumMembers: 1, holidays: [holidayRow('h-1', HOLIDAY)] });
    const offOnly = await planningSnapshotOf({ minimumMembers: 1, offTeams: [A] });

    for (const neutral of [holidayOnly, offOnly]) {
      expect(snapshotScheduleInputOf(neutral)).toStrictEqual(snapshotScheduleInputOf(plain));
      // Every cell as before; the columns differ only in the team's own flag, which is data, not a derivation.
      // STORY 21.18: the holiday still NAMES its date (display only), so the names are set aside here.
      expect(rowsUnnamed(calendarMonthOf(neutral, { mjesec: MONTH }, TODAY).rows)).toEqual(calendarMonthOf(plain, { mjesec: MONTH }, TODAY).rows);
      expect(detailUnnamed(detailOf(neutral, A, HOLIDAY))).toEqual(detailOf(plain, A, HOLIDAY));
      expect(daysUnnamed(calendarDayListOf(neutral, historyOf(neutral, ANA), MONTH, TODAY))).toEqual(
        calendarDayListOf(plain, historyOf(plain, ANA), MONTH, TODAY),
      );
    }
    // The team off with no holiday names nothing; the holiday with no team off is named, and empties nothing.
    expect(calendarMonthOf(offOnly, { mjesec: MONTH }, TODAY)).toEqual(
      expect.not.objectContaining({ holidays: expect.anything() }),
    );
    expect(calendarMonthOf(holidayOnly, { mjesec: MONTH }, TODAY).rows.find((row) => row.date === HOLIDAY)?.holiday).toBe(
      holidayOnly.holidays[0]?.name,
    );
  });
});

describe('the off team on the holiday works nothing, its projected type kept (R13.2, R13.3)', () => {
  it('the month cell: no type that date, and the days around it as before', () => {
    expect(gridCellOf(plain, A, HOLIDAY).shiftTypeId).toBe(DAN);
    expect(gridCellOf(offA, A, HOLIDAY)).toMatchObject({ shiftTypeId: null, name: null });
    for (const date of ['2026-10-07', '2026-10-09', '2026-10-12']) {
      expect(gridCellOf(offA, A, date), date).toEqual(gridCellOf(plain, A, date));
    }
    // The domain's month, from the same recipe, keeps the projected type beside the emptied one.
    const shared = snapshotScheduleInputOf(offA);
    const row = scheduleOfMonth({ teamIds: [A], ...shared }, MONTH).find((one) => one.date === HOLIDAY);
    expect(row?.cells[0]).toMatchObject({ shiftTypeId: null, projectedShiftTypeId: DAN, holiday: true, offForHoliday: true });
  });

  it('the day detail: a day off with no type and no roster, the projected type kept', () => {
    expect(detailOf(plain, A, HOLIDAY)).toMatchObject({ kind: DAY_WORKING, shiftTypeId: DAN });
    expect(detailOf(offA, A, HOLIDAY)).toMatchObject({
      kind: DAY_OFF,
      shiftTypeId: null,
      projectedShiftTypeId: DAN,
      typeName: null,
      range: null,
      roster: [],
      override: null,
      rosterChanges: [],
    });
  });

  it("at work: ANA's day list holds A's emptied day alone, no type and no name; the next one is hers as before", () => {
    const before = calendarDayListOf(plain, historyOf(plain, ANA), MONTH, TODAY);
    const after = calendarDayListOf(offA, historyOf(offA, ANA), MONTH, TODAY);

    expect(dayOf(before, HOLIDAY).shifts.map((one) => one.cell.shiftTypeId)).toEqual([DAN]);
    // Exactly what the day holds: her team's day, emptied (drawn as no shift until 21.18 marks it), nothing else.
    const held = dayOf(after, HOLIDAY).shifts;
    expect(held.map((one) => [one.teamId, one.viaOverride, one.cell.shiftTypeId, one.cell.name, one.cell.range, one.cell.modifiers])).toEqual([
      [A, false, null, null, null, []],
    ]);
    expect(held[0]?.cell).not.toHaveProperty('assigned');
    expect(held[0]?.cell).not.toHaveProperty('groups');
    expect(dayOf(after, '2026-10-12')).toEqual(dayOf(before, '2026-10-12'));
  });

  it('collisions: a leave over the holiday raises none on it; the same leave raises one without the holiday', () => {
    const records = [{ id: 'leave-ana', memberId: ANA, from: HOLIDAY, to: HOLIDAY }];

    expect(collisionsOf(collisionInputOf(plain, records)).map((one) => [one.memberId, one.date, one.teamId])).toEqual([
      [ANA, HOLIDAY, A],
    ]);
    expect(collisionsOf(collisionInputOf(offA, records))).toEqual([]);
  });

  it('staffing: the off team has no shift to staff that date; the working team is staffed as before', () => {
    expect(coverageAgainstMinimumOf(plain, [], A, HOLIDAY)).not.toBeNull();
    expect(coverageAgainstMinimumOf(offA, [], A, HOLIDAY)).toBeNull();
    expect(coverageAgainstMinimumOf(offA, [], B, HOLIDAY)).toEqual(coverageAgainstMinimumOf(plain, [], B, HOLIDAY));
    expect(staffingInputOf(offA, [])).toMatchObject({ holidays: [HOLIDAY, '2026-12-25'], teamsOffOnHolidays: [A] });
  });

  it('the erasure guard: a holiday that empties a conflict lists it, and says the team does not work that date', () => {
    const rows = erasuresOf(plain, offA, TODAY, [leaveRowOf('leave-ana', ANA, HOLIDAY, '2026-10-09')], []);

    expect(rows.map((row) => [row.memberId, row.date, row.teamId, row.teamWorks])).toEqual([[ANA, HOLIDAY, A, false]]);
  });

  it('a replacement on the emptied shift no longer applies', async () => {
    const override = calendarRosterOverrideRow('ro-1', A, HOLIDAY, ANA, DORA);
    const link = { teamId: A, date: HOLIDAY, rosterOverrideId: 'ro-1' };
    const withOverride = await planningSnapshotOf({ minimumMembers: 1, rosterOverrides: [override] });
    const withOverrideOff = await planningSnapshotOf({
      minimumMembers: 1,
      rosterOverrides: [override],
      holidays: [holidayRow('h-1', HOLIDAY)],
      offTeams: [A],
    });

    expect(appliedReplacementOverrideOf(withOverride, link)?.id).toBe('ro-1');
    expect(appliedReplacementOverrideOf(withOverrideOff, link)).toBeNull();
  });
});

describe('the working team on the holiday works its projection, with no mark (R13.2)', () => {
  it("B's cell, day detail and the viewer's day list are what they were", () => {
    expect(gridCellOf(offA, B, HOLIDAY)).toEqual(gridCellOf(plain, B, HOLIDAY));
    expect(gridCellOf(offA, B, HOLIDAY).shiftTypeId).toBe(NOC);
    // STORY 21.18: the worked holiday is still named (Design Note 1); everything else is as it was.
    expect(detailOf(offA, B, HOLIDAY)).toEqual({ ...detailOf(plain, B, HOLIDAY), holiday: 'Blagdan' });
    expect(dayOf(calendarDayListOf(offA, historyOf(offA, VIEWER_MEMBER), MONTH, TODAY), HOLIDAY)).toEqual({
      ...dayOf(calendarDayListOf(plain, historyOf(plain, VIEWER_MEMBER), MONTH, TODAY), HOLIDAY),
      holiday: 'Blagdan',
    });
    // The domain's cell of a team that works the holiday carries neither mark.
    const row = scheduleOfMonth({ teamIds: [B], ...snapshotScheduleInputOf(offA) }, MONTH).find((one) => one.date === HOLIDAY);
    expect(Object.hasOwn(row!.cells[0]!, 'holiday')).toBe(false);
    expect(Object.hasOwn(row!.cells[0]!, 'offForHoliday')).toBe(false);
  });
});

describe('review pass 1: what a holiday never removes, and the override that wins on it (R13.2, R13.3, R14.4, R15.4)', () => {
  const OFF_HOLIDAYS = { holidays: [holidayRow('h-1', HOLIDAY)] } as const;

  it("a personal rotation counted with an off team is absent from that team's groups on the holiday", async () => {
    // DORA, on *Dnevni* (no team rotation), follows the pilot pattern from the holiday at its Dan step.
    const versions = [scheduleVersionRow(DORA, HOLIDAY, 'PERSONAL', 'pilot-rotation', 'pilot-step-0')];
    const working = await planningSnapshotOf({ minimumMembers: 1, scheduleVersions: versions, ...OFF_HOLIDAYS });
    const off = await planningSnapshotOf({ minimumMembers: 1, scheduleVersions: versions, ...OFF_HOLIDAYS, offTeams: [DAY_TEAM] });

    expect(detailOf(working, DAY_TEAM, HOLIDAY).groups?.map((group) => [group.shiftTypeId, group.roster.map((one) => one.id)])).toEqual([
      [DAN, [DORA]],
    ]);
    const emptied = detailOf(off, DAY_TEAM, HOLIDAY);
    expect(emptied.kind).toBe(DAY_NO_ROTATION);
    expect(emptied).not.toHaveProperty('groups');
    // The next date is hers again (Noć on step 1).
    expect(detailOf(off, DAY_TEAM, '2026-10-09').groups?.map((group) => group.shiftTypeId)).toEqual([NOC]);
  });

  it('a Personal Assignment on the holiday stays, in the grid cell and in the day detail', async () => {
    const assigned = await planningSnapshotOf({
      minimumMembers: 1,
      ...OFF_HOLIDAYS,
      offTeams: [A],
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f201', ANA, HOLIDAY, 'SHIFT', DAN, A)],
    });

    const cell = gridCellOf(assigned, A, HOLIDAY);
    expect(cell.shiftTypeId).toBeNull();
    expect(cell.groups?.map((group) => group.shiftTypeId)).toEqual([DAN]);
    const detail = detailOf(assigned, A, HOLIDAY);
    expect(detail).toMatchObject({ kind: DAY_OFF, shiftTypeId: null, projectedShiftTypeId: DAN, roster: [] });
    expect(detail.groups?.map((group) => [group.shiftTypeId, group.roster.map((one) => [one.id, one.assigned])])).toEqual([
      [DAN, [[ANA, true]]],
    ]);
    const day = dayOf(calendarDayListOf(assigned, historyOf(assigned, ANA), MONTH, TODAY), HOLIDAY);
    expect(day.shifts.map((one) => [one.teamId, one.cell.shiftTypeId, one.cell.assigned])).toEqual([[A, DAN, true]]);
  });

  it('a shift-type override on the holiday wins, in the grid cell and in the day detail', async () => {
    const overridden = await planningSnapshotOf({
      minimumMembers: 1,
      ...OFF_HOLIDAYS,
      offTeams: [A],
      overrides: [calendarOverrideRow('ov-1', A, HOLIDAY, NOC)],
    });

    expect(gridCellOf(overridden, A, HOLIDAY)).toMatchObject({ shiftTypeId: NOC, name: 'Noć' });
    const detail = detailOf(overridden, A, HOLIDAY);
    expect(detail).toMatchObject({ kind: DAY_WORKING, shiftTypeId: NOC, projectedShiftTypeId: DAN });
    expect(detail.override).not.toBeNull();
    expect(detail.roster.map((one) => one.id)).toEqual([ANA]);
  });

  it('the override form offers the projected type on an emptied day and does not refuse it as the same', () => {
    const emptied = detailOf(offA, A, HOLIDAY);
    const working = detailOf(plain, A, HOLIDAY);

    expect(overrideTypeOptionsOf(offA, emptied).map((option) => option.id)).toContain(DAN);
    expect(overrideEntryOf(emptied, DAN, 'Radi na blagdan')).toEqual({ ok: true, shiftTypeId: DAN, reason: 'Radi na blagdan' });
    // On a day the team works, the projected type is still the same one.
    expect(overrideTypeOptionsOf(plain, working).map((option) => option.id)).not.toContain(DAN);
    expect(overrideEntryOf(working, DAN, 'x')).toEqual({ ok: false, code: OVERRIDE_REFUSED_SAME });
  });

  it("keeps the holiday's in-force roster overrides visible as inert on the emptied day", async () => {
    const replaced = await planningSnapshotOf({
      minimumMembers: 1,
      ...OFF_HOLIDAYS,
      offTeams: [A],
      rosterOverrides: [calendarRosterOverrideRow('ro-1', A, HOLIDAY, ANA, DORA)],
    });
    const detail = detailOf(replaced, A, HOLIDAY);

    expect(detail.rosterChanges).toEqual([]);
    expect(detail.rosterInert.map((one) => one.id)).toEqual(['ro-1']);
  });

  /** A resolution row as the organization's read answers it. */
  const resolutionRow = (kind: string, shiftTypeId: string | null, link: string | null = null) => ({
    member_id: ANA,
    date: HOLIDAY,
    team_id: A,
    kind,
    roster_override_id: link,
    shift_type_id: shiftTypeId,
    created_by: '00000000-0000-4000-8000-0000000000ad',
    created_at: '2026-10-02T08:00:00+00:00',
  });

  it('the decided tab names no type and no times for a resolution with no stored type on an emptied date', () => {
    const leave = [leaveRowOf('leave-ana', ANA, HOLIDAY, '2026-10-09')];
    const rowsOf = (of: CalendarSnapshot) =>
      resolvedConflictsViewOf(of, leave, [resolutionRow('accept_uncovered', null)], [], [], []).rows.filter(
        (row): row is ResolvedConflictRow => row.item === ITEM_COLLISION,
      );

    expect(rowsOf(plain).map((row) => [row.shiftTypeName, row.times])).toEqual([['Dan', expect.any(String)]]);
    expect(rowsOf(offA).map((row) => [row.shiftTypeName, row.times])).toEqual([[null, null]]);
  });

  it('drops a resolution whose stored type the holiday emptied, and never holds it by its replacement', async () => {
    const override = calendarRosterOverrideRow('ro-1', A, HOLIDAY, ANA, DORA);
    const before = await planningSnapshotOf({ minimumMembers: 1, rosterOverrides: [override] });
    const after = await planningSnapshotOf({ minimumMembers: 1, rosterOverrides: [override], ...OFF_HOLIDAYS, offTeams: [A] });
    // One key holds one resolution, so each kind is read on its own.
    for (const rows of [[resolutionRow('accept_uncovered', DAN)], [resolutionRow('replace_member', DAN, 'ro-1')]]) {
      expect(effectiveResolutionsOf(before, liveResolutionsOf(before, rows)), rows[0]!.kind).toHaveLength(1);
      expect(effectiveResolutionsOf(after, liveResolutionsOf(after, rows)), rows[0]!.kind).toEqual([]);
    }
    const [replacement] = liveResolutionsOf(after, [resolutionRow('replace_member', DAN, 'ro-1')]);
    expect(heldByReplacement(after, replacement!)).toBe(false);
  });
});

/**
 * STORY 21.18 — HOLIDAYS SHOW: the names apart from the rule
 * (`holidayNamesOfCalendar`), each surface's model fields, and the labels.
 * Each case is a row of 21.18's I/O matrix over the same calendar.
 */
describe('story 21.18: the holiday shows on the month, the day lists, the day detail and the labels', () => {
  const NAMED = { holidays: [holidayRow('h-1', HOLIDAY, 'Dan sjećanja')] } as const;
  const rowOf = (of: CalendarSnapshot, date: string) => calendarMonthOf(of, { mjesec: MONTH }, TODAY).rows.find((row) => row.date === date);

  it('no holiday: no new key anywhere — the month, its rows and cells, the day list, the day detail and the date columns', () => {
    const month = calendarMonthOf(plain, { mjesec: MONTH }, TODAY);

    expect(holidayNamesOfCalendar(plain).size).toBe(0);
    expect(month).not.toHaveProperty('holidays');
    expect(month.rows.some((row) => Object.hasOwn(row, 'holiday'))).toBe(false);
    expect(month.rows.some((row) => row.cells.some((cell) => Object.hasOwn(cell, 'offForHoliday')))).toBe(false);
    expect((calendarDayListOf(plain, historyOf(plain, ANA), MONTH, TODAY) ?? []).some((day) => Object.hasOwn(day, 'holiday'))).toBe(false);
    expect(detailOf(plain, A, HOLIDAY)).not.toHaveProperty('holiday');
    expect(detailOf(plain, A, HOLIDAY)).not.toHaveProperty('holidayOff');
    expect(gridDatesOf([HOLIDAY], TODAY).every((date) => !Object.hasOwn(date, 'holiday'))).toBe(true);
    expect(monthHolidaysOf(holidayNamesOfCalendar(plain), [HOLIDAY])).toEqual([]);
  });

  it('a holiday and nobody off: the row, the day and the date head carry the name; no cell is emptied; the key lists it', async () => {
    const named = await planningSnapshotOf({ minimumMembers: 1, ...NAMED });
    const month = calendarMonthOf(named, { mjesec: MONTH }, TODAY);

    // The rule is `{}` with no team off (R13.5), and the names still hold the date (Design Note 1).
    expect(holidayRuleOfCalendar(named)).toEqual({});
    expect([...holidayNamesOfCalendar(named)]).toEqual([[HOLIDAY, 'Dan sjećanja']]);
    expect(month.holidays).toEqual([{ date: HOLIDAY, dayMonth: '08.10.', name: 'Dan sjećanja' }]);
    expect(rowOf(named, HOLIDAY)?.holiday).toBe('Dan sjećanja');
    expect(rowOf(named, '2026-10-09')).not.toHaveProperty('holiday');
    expect(rowOf(named, HOLIDAY)?.cells.some((cell) => Object.hasOwn(cell, 'offForHoliday'))).toBe(false);
    expect(gridCellOf(named, A, HOLIDAY).shiftTypeId).toBe(DAN);
    expect(dayOf(calendarDayListOf(named, historyOf(named, ANA), MONTH, TODAY), HOLIDAY).holiday).toBe('Dan sjećanja');
    expect(detailOf(named, A, HOLIDAY)).toMatchObject({ kind: DAY_WORKING, holiday: 'Dan sjećanja' });
    expect(detailOf(named, A, HOLIDAY)).not.toHaveProperty('holidayOff');
    expect(gridDatesOf([HOLIDAY, '2026-10-09'], TODAY, holidayNamesOfCalendar(named)).map((date) => date.holiday)).toEqual([
      'Dan sjećanja',
      undefined,
    ]);
    // Every cell label of the date reads `blagdan {name}` after it; a working cell keeps its type.
    const labels = gridCellLabelsOf(month, translateCellLabel);
    const index = month.rows.findIndex((row) => row.date === HOLIDAY);
    const column = month.columns.findIndex((team) => team.id === A);
    expect(labels[index]?.[column]).toMatch(/^četvrtak 08\.10\., blagdan Dan sjećanja, Smjena A, Dan, /);
  });

  it('the off team emptied: its cell is `offForHoliday`, labelled `blagdan`, and the day detail says it does not work, with the projected type', async () => {
    const off = await planningSnapshotOf({ minimumMembers: 1, ...NAMED, offTeams: [A] });
    const month = calendarMonthOf(off, { mjesec: MONTH }, TODAY);
    const cell = gridCellOf(off, A, HOLIDAY);

    expect(cell).toMatchObject({ shiftTypeId: null, name: null, offForHoliday: true });
    expect(gridCellOf(off, B, HOLIDAY)).not.toHaveProperty('offForHoliday');
    expect(gridCellOf(off, A, '2026-10-09')).not.toHaveProperty('offForHoliday');
    const index = month.rows.findIndex((row) => row.date === HOLIDAY);
    const column = month.columns.findIndex((team) => team.id === A);
    expect(gridCellLabelsOf(month, translateCellLabel)[index]?.[column]).toBe('četvrtak 08.10., blagdan Dan sjećanja, Smjena A, blagdan');
    // The paper grid's team row reads the same cell.
    expect(month.teamRows.find((row) => row.team.id === A)?.cells[index]).toEqual(cell);
    // The day detail: the date named, the emptied sentence's projected type (R13.3).
    expect(detailOf(off, A, HOLIDAY)).toMatchObject({
      kind: DAY_OFF,
      shiftTypeId: null,
      projectedShiftTypeId: DAN,
      holiday: 'Dan sjećanja',
      holidayOff: { projectedTypeName: 'Dan' },
    });
    // ANA's day list: her team's emptied day reads `blagdan`, the date named.
    const days = calendarDayListOf(off, historyOf(off, ANA), MONTH, TODAY) ?? [];
    const day = dayOf(days, HOLIDAY);
    expect(day.holiday).toBe('Dan sjećanja');
    expect(day.shifts.map((shift) => shift.cell.offForHoliday)).toEqual([true]);
    const dayIndex = days.findIndex((one) => one.date === HOLIDAY);
    expect(dayListLabelsOf(days, off.teams, translateCellLabel)[dayIndex]).toEqual([
      'četvrtak 08.10., blagdan Dan sjećanja, Smjena A, blagdan',
    ]);
  });

  it('an override wins: its type, no `offForHoliday`, the date still named', async () => {
    const overridden = await planningSnapshotOf({
      minimumMembers: 1,
      ...NAMED,
      offTeams: [A],
      overrides: [calendarOverrideRow('ov-1', A, HOLIDAY, NOC)],
    });

    expect(gridCellOf(overridden, A, HOLIDAY)).toMatchObject({ shiftTypeId: NOC, name: 'Noć' });
    expect(gridCellOf(overridden, A, HOLIDAY)).not.toHaveProperty('offForHoliday');
    expect(rowOf(overridden, HOLIDAY)?.holiday).toBe('Dan sjećanja');
    expect(detailOf(overridden, A, HOLIDAY)).toMatchObject({ kind: DAY_WORKING, holiday: 'Dan sjećanja' });
    expect(detailOf(overridden, A, HOLIDAY)).not.toHaveProperty('holidayOff');
  });

  it('a personal rotation emptied: no shift, and the day still names the holiday', async () => {
    const versions = [scheduleVersionRow(DORA, HOLIDAY, 'PERSONAL', 'pilot-rotation', 'pilot-step-0')];
    const off = await planningSnapshotOf({ minimumMembers: 1, scheduleVersions: versions, ...NAMED, offTeams: [DAY_TEAM] });
    const day = dayOf(calendarDayListOf(off, historyOf(off, DORA), MONTH, TODAY), HOLIDAY);

    expect(day.shifts).toEqual([]);
    expect(day.holiday).toBe('Dan sjećanja');
  });
});

describe('story 21.18 review pass 1: groups, previews, person rows, a non-working projection', () => {
  const NAMED = { holidays: [holidayRow('h-1', HOLIDAY, 'Dan sjećanja')] } as const;
  const labelOf = (of: CalendarSnapshot, teamId: string, date: string): string | undefined => {
    const month = calendarMonthOf(of, { mjesec: MONTH }, TODAY);
    const index = month.rows.findIndex((row) => row.date === date);
    const column = month.columns.findIndex((team) => team.id === teamId);

    return gridCellLabelsOf(month, translateCellLabel)[index]?.[column];
  };

  it('an emptied cell with a staffing group reads `blagdan` before the group, and the detail says so with the grouped sentence', async () => {
    const assigned = await planningSnapshotOf({
      minimumMembers: 1,
      ...NAMED,
      offTeams: [A],
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f201', ANA, HOLIDAY, 'SHIFT', DAN, A)],
    });
    const cell = gridCellOf(assigned, A, HOLIDAY);

    expect(cell).toMatchObject({ name: null, offForHoliday: true });
    expect(cell.groups?.map((group) => group.shiftTypeId)).toEqual([DAN]);
    expect(labelOf(assigned, A, HOLIDAY)).toMatch(/^četvrtak 08\.10\., blagdan Dan sjećanja, Smjena A, blagdan, Dan, .+, dodijeljeno ručno$/);
    expect(holidayOffMessageKey(detailOf(assigned, A, HOLIDAY))).toBe('kalendar.holiday.dayOffGroups');
    expect(holidayOffMessageKey(detailOf(offA, A, HOLIDAY))).toBe('kalendar.holiday.dayOff');
    // With no holiday, nothing reads `blagdan`.
    expect(labelOf(plain, A, HOLIDAY)).not.toContain('blagdan');
  });

  it('the projected type offered on an emptied day gets its preview; on a worked day it is the same type and none', () => {
    expect(overridePreviewOf(offA, detailOf(offA, A, HOLIDAY), DAN, [])).not.toBeNull();
    expect(overridePreviewOf(plain, detailOf(plain, A, HOLIDAY), DAN, [])).toBeNull();
  });

  it("the amend preflight's same type agrees with the day detail's, worked or emptied", () => {
    for (const of of [plain, offA]) {
      for (const date of [HOLIDAY, '2026-10-09', '2026-10-10']) {
        expect(sameTypeIdOf(of, A, date), date).toBe(sameTypeOf(detailOf(of, A, date)));
      }
    }
    expect(sameTypeIdOf(offA, A, HOLIDAY)).toBeNull();
  });

  it("a person row's team shift a holiday emptied reads `blagdan`, as a team cell does", async () => {
    // DORA moves onto the archived team, which still projects the pilot rotation: no active turnus team, so a person row.
    const setup = {
      minimumMembers: 1,
      memberships: [memberMembershipRow(DORA, ARCHIVED_TEAM, '2026-10-01')],
      rotations: [assignmentRow(ARCHIVED_TEAM, 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-01-01')],
      ...NAMED,
    } as const;
    const working = await planningSnapshotOf(setup);
    const off = await planningSnapshotOf({ ...setup, offTeams: [ARCHIVED_TEAM] });
    const personOf = (of: CalendarSnapshot) => {
      const month = calendarMonthOf(of, { mjesec: MONTH }, TODAY);
      const row = month.peopleGroups.flatMap((group) => group.rows).find((one) => one.memberId === DORA);
      const cell = row?.cells.find((one) => one.date === HOLIDAY);
      const date = month.rows.find((one) => one.date === HOLIDAY);

      if (row === undefined || cell === undefined || date === undefined) throw new Error('no person cell');

      return { row, cell, date };
    };

    expect(personOf(working).cell.cell?.shiftTypeId).not.toBeNull();
    const { row, cell, date } = personOf(off);
    expect(cell.cell).toMatchObject({ shiftTypeId: null, name: null, offForHoliday: true });
    expect(personLabelOf(row, cell, date)).toBe('četvrtak 08.10., blagdan Dan sjećanja, Dora Dorić, blagdan');
    expect(personLabelOf(personOf(working).row, personOf(working).cell, personOf(working).date)).not.toMatch(/, blagdan$/);
  });

  it('a holiday on a date the off team projects a non-working type: emptied all the same, and the detail names that type', async () => {
    // Smjena A projects Slobodno on 10.10.
    const SLOBODNO_DAY = '2026-10-10';
    const off = await planningSnapshotOf({ minimumMembers: 1, holidays: [holidayRow('h-1', SLOBODNO_DAY, 'Blagdan')], offTeams: [A] });

    expect(gridCellOf(plain, A, SLOBODNO_DAY).name).toBe('Slobodno');
    expect(gridCellOf(off, A, SLOBODNO_DAY)).toMatchObject({ shiftTypeId: null, name: null, offForHoliday: true });
    expect(detailOf(off, A, SLOBODNO_DAY)).toMatchObject({ kind: DAY_OFF, holidayOff: { projectedTypeName: 'Slobodno' } });
  });
});
