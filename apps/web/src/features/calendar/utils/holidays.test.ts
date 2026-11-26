import { collisionsOf, scheduleOfMonth } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  DAY_NO_ROTATION,
  DAY_OFF,
  DAY_WORKING,
  OVERRIDE_REFUSED_SAME,
  dayDetailOf,
  overrideEntryOf,
  overrideTypeOptionsOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import {
  calendarDayListOf,
  calendarMonthOf,
  snapshotScheduleInputOf,
  staffingInputOf,
  type CalendarDay,
} from '@/features/calendar/utils/month';
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
  calendarOverrideRow,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  holidayRow,
  leaveRowOf,
  planningSnapshotOf,
  scheduleVersionRow,
} from '@/features/planning/planning.fixture';
import { coverageAgainstMinimumOf } from '@/features/staffing/services/short-staffed';
import { initLocalization } from '@/lib/i18n';

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
      expect(calendarMonthOf(neutral, { mjesec: MONTH }, TODAY).rows).toEqual(calendarMonthOf(plain, { mjesec: MONTH }, TODAY).rows);
      expect(detailOf(neutral, A, HOLIDAY)).toEqual(detailOf(plain, A, HOLIDAY));
      expect(calendarDayListOf(neutral, historyOf(neutral, ANA), MONTH, TODAY)).toEqual(
        calendarDayListOf(plain, historyOf(plain, ANA), MONTH, TODAY),
      );
    }
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
    expect(detailOf(offA, B, HOLIDAY)).toEqual(detailOf(plain, B, HOLIDAY));
    expect(dayOf(calendarDayListOf(offA, historyOf(offA, VIEWER_MEMBER), MONTH, TODAY), HOLIDAY)).toEqual(
      dayOf(calendarDayListOf(plain, historyOf(plain, VIEWER_MEMBER), MONTH, TODAY), HOLIDAY),
    );
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
