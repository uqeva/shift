import { describe, expect, it } from 'vitest';

import {
  FIRST_HR_HOLIDAY_YEAR,
  PERSONAL_ASSIGNMENT_SHIFT,
  SCHEDULE_SOURCE_MANUAL,
  SCHEDULE_SOURCE_PERSONAL,
  atWorkShiftsOf,
  collisionsOf,
  datesOfMonth,
  easterSundayOf,
  leaveCostOf,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  nationalHolidaysOf,
  peopleAtWorkOn,
  personalShiftOn,
  rosterOverridesMadeInertOf,
  scheduleOfMonth,
  scheduledShiftTypeOn,
  staffingOn,
  type HolidayCountry,
  type HolidayRule,
  type MemberHoursInput,
  type PersonalAssignment,
  type RosterMember,
  type RosterOverride,
  type ScheduleInputs,
  type ScheduleVersion,
  type ShiftTypeOverride,
} from '../src/index.js';
import { civilDayNumber } from '../src/calendar.js';
import { PARITY_FIXTURES, PARITY_WINDOW, inputsOf } from '../parity/fixtures.js';
import {
  FIXTURES,
  MINIMUM_MEMBERS,
  MONTHS,
  derivedFiguresOf,
  digestOf,
  leaveRecordsOf,
  membersOf,
  shared,
  workingOf,
  type Fixture,
  type HolidayLists,
  type Organization,
} from './derivation.js';

/**
 * STORY 21.15 — the holiday rule (R13). THE GUARD (R13.5): with no holiday,
 * or no team off on holidays, every figure is identical to what it was before
 * holidays existed, over both fixtures, Personal Assignments and schedule
 * sources included.
 */

/**
 * {@link membersOf} with every way a member's day is decided (R15.3): the
 * member on no team works the first working type on three dates (an
 * assignment, no team), the first team's member 1 is on a personal rotation
 * from 2026-03-16, and the third team's member 1 is manual only from
 * 2026-04-01.
 */
function plannedMembersOf(fixture: Fixture): readonly RosterMember[] {
  const [first] = workingOf(fixture);
  const [a, , c] = fixture.teams;
  const { patternId, offsetStepId } = fixture.assignments[0]!;
  const rotation: ScheduleVersion = { effectiveFrom: '2026-03-16', source: SCHEDULE_SOURCE_PERSONAL, patternId, offsetStepId };
  const manual: ScheduleVersion = { effectiveFrom: '2026-04-01', source: SCHEDULE_SOURCE_MANUAL, patternId: null, offsetStepId: null };
  return membersOf(fixture).map((member): RosterMember => {
    if (member.id === 'teamless') {
      const assignments: PersonalAssignment[] = ['2026-03-02', '2026-03-21', '2026-04-04'].map((date) => ({
        id: `teamless-${date}`,
        date,
        kind: PERSONAL_ASSIGNMENT_SHIFT,
        shiftTypeId: first!,
        teamId: null,
      }));
      return { ...member, personalAssignments: assignments };
    }
    if (member.id === `${a!.id}-1`) return { ...member, scheduleVersions: [rotation] };
    if (member.id === `${c!.id}-1`) return { ...member, scheduleVersions: [manual] };
    return member;
  });
}

/** {@link derivedFiguresOf}, plus every team's every staffed shift (R14.6's groups) on each date. */
function guardedFiguresOf(organization: Organization) {
  const { fixture } = organization;
  const teamIds = fixture.teams.map((team) => team.id);
  const input = { teamIds, ...shared(organization), leaveRecords: leaveRecordsOf(fixture), minimumMembers: MINIMUM_MEMBERS };
  return {
    derived: derivedFiguresOf(organization),
    staffing: MONTHS.flatMap((month) =>
      datesOfMonth(month).flatMap((date) => teamIds.map((teamId) => staffingOn(input, teamId, date))),
    ),
  };
}

type ParityOrganization = (typeof PARITY_FIXTURES)[number]['organization'];

/** Story 21.16's fixture rows that only a holiday makes meaningful: the override on A's holiday and m2's assignment on B's. */
const HOLIDAY_ROWS = new Set(['pilot-holiday-override', 'uj5-holiday-assignment']);


/**
 * R12 for every member of both parity fixtures, over the whole parity window, with `lists` in each assembly.
 * Story 21.10 gave the fixtures schedule versions after this file's baseline (b130440) was pinned, so they are
 * emptied here (`[]` derives exactly as none, R15.6): the digest stays the claim about holidays alone. Story
 * 21.16 gave them a holiday rule of their own, which is stripped, so `lists` is the only rule.
 */
function atWorkOf(listsOf: (organization: ParityOrganization) => HolidayLists | undefined) {
  return PARITY_FIXTURES.map(({ fixture, organization: fixtureOrganization }) => {
    // Story 21.16 gave the fixtures their own holiday rule; stripped, so `lists` alone decides.
    const { holidays: _holidays, teamsOffOnHolidays: _off, ...given } = fixtureOrganization;
    const organization = {
      ...given,
      // And its two companions, the override on A's holiday and m2's assignment on B's.
      overrides: given.overrides.filter((one) => !HOLIDAY_ROWS.has(one.id)),
      members: given.members.map((member) => ({
        ...member,
        scheduleVersions: [],
        personalAssignments: member.personalAssignments.filter((one) => !HOLIDAY_ROWS.has(one.id)),
      })),
    } as unknown as ParityOrganization;
    const lists = listsOf(organization);
    return {
      fixture,
      atWork: organization.members.map((member) =>
        atWorkShiftsOf({ ...inputsOf(organization, member.id), ...lists }, PARITY_WINDOW.from, PARITY_WINDOW.to),
      ),
    };
  });
}

/**
 * The digests of {@link guardedFiguresOf} for each fixture with
 * {@link plannedMembersOf}'s members, and of {@link atWorkOf}, computed on the
 * engine BEFORE holidays existed (commit b130440, the base of story 21.15). A
 * change that moves any figure of an organization with no holiday or no team
 * off on holidays changes a digest.
 */
const BEFORE_HOLIDAYS: Readonly<Record<string, string>> = {
  pilot: '2ccbf436d85974ee6b1d9147be299b8807969c3888885a600b31fb28178aa0e6',
  'UJ-5': '26f60bce262eca0901a69ef85ce49086651297b716dc2ed7569ec92fe80b73fb',
  'at-work': 'be22b42f7febe9590b0a4c03c97a07668d02ae5cd2c45e999e6a8aab4e44d531',
};

/** Holidays inside the window: one where the second team has a shift-type override (03-05), Easter Sunday and Monday 2026. */
const IN_WINDOW = ['2026-03-05', '2026-04-05', '2026-04-06'];

/** Rules that decide nothing in the window: none, empty, holidays with no team off, teams off with no holiday, a holiday after the window, an unknown team off. */
function neutralOf(teamIds: readonly string[], after: string): readonly (HolidayLists | undefined)[] {
  return [
    undefined,
    { holidays: [], teamsOffOnHolidays: [] },
    { holidays: IN_WINDOW },
    { holidays: IN_WINDOW, teamsOffOnHolidays: [] },
    { teamsOffOnHolidays: teamIds },
    { holidays: [], teamsOffOnHolidays: teamIds },
    { holidays: [after], teamsOffOnHolidays: teamIds },
    { holidays: IN_WINDOW, teamsOffOnHolidays: ['no-such-team'] },
  ];
}

describe('R13.5 — with no holiday or no team off on holidays, every derived figure is what it was before', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: every figure, under every neutral rule, digests as before`, () => {
      const teamIds = fixture.teams.map((team) => team.id);
      const members = plannedMembersOf(fixture);
      for (const holidays of neutralOf(teamIds, '2026-05-30')) {
        const organization = holidays === undefined ? { fixture, members } : { fixture, members, holidays };
        expect(digestOf(guardedFiguresOf(organization))).toBe(BEFORE_HOLIDAYS[fixture.name]);
      }
    });
  }

  it("both parity fixtures: every member's at-work shifts (R12) digest as before, under every neutral rule", () => {
    const after = '2027-11-18';
    // The "later" holiday must stay outside the parity window, or it would decide a date in it.
    expect(after > PARITY_WINDOW.to).toBe(true);
    for (const index of neutralOf([], after).keys()) {
      const digest = digestOf(
        atWorkOf((organization) => neutralOf(organization.teams.map((team) => team.id), after)[index]),
      );
      expect(digest).toBe(BEFORE_HOLIDAYS['at-work']);
    }
  });
});

describe('R13.5 — the guard is not vacuous', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: every team off on the window's holidays moves figures, and only the holidays' cells carry marks`, () => {
      const teamIds = fixture.teams.map((team) => team.id);
      const members = plannedMembersOf(fixture);
      const figures = guardedFiguresOf({ fixture, members, holidays: { holidays: IN_WINDOW, teamsOffOnHolidays: teamIds } });
      expect(digestOf(figures)).not.toBe(BEFORE_HOLIDAYS[fixture.name]);
      for (const row of figures.derived.schedule.flat()) {
        for (const cell of row.cells) {
          const marked = Object.hasOwn(cell, 'holiday');
          expect(marked).toBe(IN_WINDOW.includes(row.date) && cell.projectedShiftTypeId !== null);
          expect(Object.hasOwn(cell, 'offForHoliday')).toBe(marked && !cell.overridden);
        }
      }
    });
  }

  it("both parity fixtures: every team off on the window's holidays moves R12", () => {
    const holidays = ['2026-04-05', '2026-11-18', '2027-05-30'];
    const digest = digestOf(atWorkOf((organization) => ({ holidays, teamsOffOnHolidays: organization.teams.map((team) => team.id) })));
    expect(digest).not.toBe(BEFORE_HOLIDAYS['at-work']);
  });
});

describe('story 21.16 — the parity fixtures carry a holiday rule of their own', () => {
  it("R12: the off team's shifts on its holidays are gone, and every other shift is as before", () => {
    for (const { fixture, organization } of PARITY_FIXTURES) {
      const { holidays: _holidays, teamsOffOnHolidays: _off, ...stripped } = organization;
      const holidays = new Set(organization.holidays);
      const off = new Set(organization.teamsOffOnHolidays);
      const removed: string[] = [];
      for (const member of organization.members) {
        const before = atWorkShiftsOf(inputsOf(stripped, member.id), PARITY_WINDOW.from, PARITY_WINDOW.to);
        const after = atWorkShiftsOf(inputsOf(organization, member.id), PARITY_WINDOW.from, PARITY_WINDOW.to);
        // An override on the date wins (R13.3) and an assignment is never emptied (R14.4).
        const overridden = (shift: (typeof before)[number]) =>
          organization.overrides.some((one) => one.teamId === shift.teamId && one.date === shift.date);
        const emptied = (shift: (typeof before)[number]) =>
          holidays.has(shift.date) &&
          shift.teamId !== null &&
          off.has(shift.teamId) &&
          shift.personalAssignmentId === undefined &&
          !overridden(shift);
        expect(after, `${fixture} ${member.id}`).toEqual(before.filter((shift) => !emptied(shift)));
        removed.push(...before.filter(emptied).map((shift) => `${member.id} ${shift.date} ${String(shift.teamId)}`));
      }
      // Not vacuous: each fixture's holiday empties at least one shift.
      expect(removed.length, fixture).toBeGreaterThan(0);
    }
  });

  it('pins which shifts go: the pilot\'s m1 on A\'s Noć of 2027-08-05; UJ-5\'s B on 2027-06-22 and m2\'s rotation on 2027-08-15', () => {
    const [pilot, uj5] = PARITY_FIXTURES;
    const datesOf = (organization: ParityOrganization, memberId: string, from: string, to: string) =>
      atWorkShiftsOf(inputsOf(organization, memberId), from, to).map((shift) => `${shift.date} ${String(shift.teamId)}`);
    expect(datesOf(pilot!.organization, 'pilot-m1', '2027-08-05', '2027-08-05')).toEqual([]);
    // B is not off on holidays: m5 works its Dan on the second holiday.
    expect(datesOf(pilot!.organization, 'pilot-m5', '2027-08-15', '2027-08-15')).toEqual(['2027-08-15 pilot-smjena-b']);
    expect(datesOf(uj5!.organization, 'uj5-m2', '2027-08-15', '2027-08-15')).toEqual([]);
    expect(datesOf(uj5!.organization, 'uj5-m2', '2027-08-16', '2027-08-16')).toEqual(['2027-08-16 uj5-smjena-b']);
    // The override wins on A's holiday: m1 works its Noć. m2's assignment on B's holiday stays.
    expect(
      atWorkShiftsOf(inputsOf(pilot!.organization, 'pilot-m1'), '2027-08-15', '2027-08-15').map((shift) => [shift.teamId, shift.shiftTypeId]),
    ).toEqual([['pilot-smjena-a', 'pilot-noc']]);
    expect(
      atWorkShiftsOf(inputsOf(uj5!.organization, 'uj5-m2'), '2027-06-22', '2027-06-22').map((shift) => [
        shift.teamId,
        shift.shiftTypeId,
        shift.personalAssignmentId,
      ]),
    ).toEqual([['uj5-smjena-b', 'uj5-jutarnja', 'uj5-holiday-assignment']]);
  });
});

/**
 * R13.8's organization. Day team D, off on holidays, works [1. smjena
 * 06:00–14:00 ×5, Slobodno ×2] from Monday 2026-11-16. 24-hour team K works
 * [Dan, Noć, Slobodno, Slobodno] with Dan on Wednesday 2026-11-18, the
 * holiday (Remembrance Day).
 */
const at = (hour: number): number => hour * 60;
const HOLIDAY = '2026-11-18';
const R138 = {
  types: [
    { id: 't1', name: '1. smjena', isWorking: true },
    { id: 'dan', name: 'Dan', isWorking: true },
    { id: 'noc', name: 'Noć', isWorking: true },
    { id: 'off', name: 'Slobodno', isWorking: false },
  ],
  versions: [
    { shiftTypeId: 't1', effectiveFrom: '2020-01-01', startMinute: at(6), endMinute: at(14) },
    { shiftTypeId: 'dan', effectiveFrom: '2020-01-01', startMinute: at(7), endMinute: at(19) },
    { shiftTypeId: 'noc', effectiveFrom: '2020-01-01', startMinute: at(19), endMinute: at(7) },
  ],
  steps: [
    ...['t1', 't1', 't1', 't1', 't1', 'off', 'off'].map((shiftTypeId, position) => ({
      id: `d${String(position)}`,
      patternId: 'd',
      position,
      shiftTypeId,
    })),
    { id: 'k0', patternId: 'k', position: 0, shiftTypeId: 'dan' },
    { id: 'k1', patternId: 'k', position: 1, shiftTypeId: 'noc' },
    { id: 'k2', patternId: 'k', position: 2, shiftTypeId: 'off' },
    { id: 'k3', patternId: 'k', position: 3, shiftTypeId: 'off' },
  ],
  assignments: [
    { teamId: 'D', patternId: 'd', offsetStepId: 'd0', anchorDate: '2026-11-16', effectiveFrom: '2020-01-01' },
    { teamId: 'K', patternId: 'k', offsetStepId: 'k0', anchorDate: HOLIDAY, effectiveFrom: '2020-01-01' },
  ],
  bands: [{ id: 'dan', name: 'Dan', startMinute: at(6) }],
};
const WORKING = ['t1', 'dan', 'noc'];
const inD = [{ teamId: 'D', position: null, effectiveFrom: '2020-01-01' }];
const inK = [{ teamId: 'K', position: null, effectiveFrom: '2020-01-01' }];
const rotationOnD: ScheduleVersion = { effectiveFrom: '2026-11-16', source: SCHEDULE_SOURCE_PERSONAL, patternId: 'd', offsetStepId: 'd0' };

/**
 * D1 and D2 on D's rotation; K1 on K's; P on a personal rotation counted with
 * D, Q on the same one counted with K, S on it with no team; A in D holding a
 * Personal Assignment of 1. smjena on the holiday.
 */
const R138_MEMBERS: readonly RosterMember[] = [
  { id: 'd1', memberships: inD, statuses: [] },
  { id: 'd2', memberships: inD, statuses: [] },
  { id: 'k1', memberships: inK, statuses: [] },
  { id: 'p', memberships: inD, statuses: [], scheduleVersions: [rotationOnD] },
  { id: 'q', memberships: inK, statuses: [], scheduleVersions: [rotationOnD] },
  { id: 's', memberships: [], statuses: [], scheduleVersions: [rotationOnD] },
  {
    id: 'a',
    memberships: inD,
    statuses: [],
    personalAssignments: [{ id: 'a-holiday', date: HOLIDAY, kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: 't1', teamId: null }],
  },
];

const OFF_D: HolidayRule = { holidays: [HOLIDAY], teamsOffOnHolidays: ['D'] };

function r138Shared(rule: HolidayRule = OFF_D, overrides: readonly ShiftTypeOverride[] = [], rosterOverrides: readonly RosterOverride[] = []) {
  return {
    assignments: R138.assignments,
    steps: R138.steps,
    overrides,
    members: R138_MEMBERS,
    rosterOverrides,
    workingShiftTypeIds: WORKING,
    ...rule,
  };
}

const r138ShiftTypes = R138.types.map((type) => ({ type, versions: R138.versions.filter((version) => version.shiftTypeId === type.id) }));

function r138Hours(
  memberId: string,
  rule: HolidayRule = OFF_D,
  overrides: readonly ShiftTypeOverride[] = [],
  rosterOverrides: readonly RosterOverride[] = [],
): MemberHoursInput {
  const member = R138_MEMBERS.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    ...r138Shared(rule, overrides, rosterOverrides),
    bands: R138.bands,
    shiftTypes: r138ShiftTypes,
  };
}

function r138Staffing(rule: HolidayRule = OFF_D) {
  return { teamIds: ['D', 'K'], ...r138Shared(rule), leaveRecords: [], minimumMembers: 2 };
}

function r138Inputs(memberId: string, rule: HolidayRule = OFF_D): ScheduleInputs {
  return {
    organizationId: 'org',
    timeZone: 'Europe/Zagreb',
    memberId,
    teams: [
      { id: 'D', name: 'D', archived: false },
      { id: 'K', name: 'K', archived: false },
    ],
    shiftTypes: r138ShiftTypes,
    steps: R138.steps,
    assignments: R138.assignments,
    assignmentStamps: R138.assignments.map((one) => ({ teamId: one.teamId, effectiveFrom: one.effectiveFrom, createdAt: 1 })),
    members: R138_MEMBERS.map((member) => ({ ...member, loans: [] })),
    overrides: [],
    rosterOverrides: [],
    leave: [],
    ...rule,
  };
}

function cellsOn(
  date: string,
  rule: HolidayRule = OFF_D,
  overrides: readonly ShiftTypeOverride[] = [],
  rosterOverrides: readonly RosterOverride[] = [],
) {
  return scheduleOfMonth({ teamIds: ['D', 'K'], ...r138Shared(rule, overrides, rosterOverrides) }, '2026-11').find((row) => row.date === date)!
    .cells;
}

function dayOf(
  memberId: string,
  date: string,
  rule: HolidayRule = OFF_D,
  overrides: readonly ShiftTypeOverride[] = [],
  rosterOverrides: readonly RosterOverride[] = [],
) {
  return memberScheduleOfMonth(r138Hours(memberId, rule, overrides, rosterOverrides), '2026-11').find((day) => day.date === date)!;
}

const labelsOf = (memberId: string, date: string, rule: HolidayRule = OFF_D): readonly string[] =>
  dayOf(memberId, date, rule).shifts.map((one) => `${String(one.shiftTypeId)}@${String(one.teamId)}`);

const atWorkDates = (memberId: string, rule: HolidayRule = OFF_D): readonly string[] =>
  atWorkShiftsOf(r138Inputs(memberId, rule), '2026-11-16', '2026-11-20').map((shift) => shift.date);

describe('R13.8 — the worked example', () => {
  it('D works nothing on the holiday, its projected type kept; K works its Dan with no mark; the days around it are unchanged', () => {
    expect(cellsOn(HOLIDAY)).toEqual([
      { teamId: 'D', shiftTypeId: null, projectedShiftTypeId: 't1', overridden: false, holiday: true, offForHoliday: true, rosterChanged: false },
      { teamId: 'K', shiftTypeId: 'dan', projectedShiftTypeId: 'dan', overridden: false, rosterChanged: false },
    ]);
    expect(cellsOn('2026-11-17')).toEqual(cellsOn('2026-11-17', {}));
    // R13.3: the rotation continues the next date as if the holiday had been worked.
    expect(cellsOn('2026-11-19')).toEqual(cellsOn('2026-11-19', {}));
    expect(cellsOn('2026-11-19')[0]).toMatchObject({ shiftTypeId: 't1' });
  });

  it("a D member's day keeps D's emptied shift with its marks, and loses it from R12, hours and collisions", () => {
    expect(dayOf('d1', HOLIDAY).shifts).toEqual([
      {
        teamId: 'D',
        shiftTypeId: null,
        projectedShiftTypeId: 't1',
        overridden: false,
        holiday: true,
        offForHoliday: true,
        rosterChanged: false,
        viaOverride: false,
      },
    ]);
    expect(atWorkDates('d1')).toEqual(['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20']);
    expect(atWorkDates('d1', {})).toEqual(['2026-11-16', '2026-11-17', HOLIDAY, '2026-11-19', '2026-11-20']);
    const hours = memberHoursOfMonth(r138Hours('d1'), '2026-11');
    const before = memberHoursOfMonth(r138Hours('d1', {}), '2026-11');
    expect(before.totalMinutes - hours.totalMinutes).toBe(at(8));
    expect(before.shiftCount - hours.shiftCount).toBe(1);
    const leave = [{ id: 'leave-d1', memberId: 'd1', from: '2026-11-16', to: '2026-11-22' }];
    expect(collisionsOf({ ...r138Shared(), leaveRecords: leave }).map((one) => one.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-19',
      '2026-11-20',
    ]);
  });

  it("a week of a D member's leave over the holiday costs four days, not five; K's member's leave on it costs a day", () => {
    expect(leaveCostOf(r138Hours('d1'), '2026-11-16', '2026-11-22')).toBe(4);
    expect(leaveCostOf(r138Hours('d1', {}), '2026-11-16', '2026-11-22')).toBe(5);
    expect(leaveCostOf(r138Hours('k1'), HOLIDAY, HOLIDAY)).toBe(1);
  });

  it("D's roster works no shift on the holiday; K's Dan is staffed as on any date", () => {
    expect(peopleAtWorkOn(r138Staffing(), 'D', HOLIDAY)).toBeNull();
    expect(peopleAtWorkOn(r138Staffing({}), 'D', HOLIDAY)).toEqual({ shiftTypeId: 't1', atWork: 4 });
    expect(peopleAtWorkOn(r138Staffing(), 'K', HOLIDAY)).toEqual({ shiftTypeId: 'dan', atWork: 1 });
  });
});

describe('R13.2, R13.3, R15.4 — the matrix', () => {
  it('a Shift Type Override wins on the holiday, marked `holiday` and not emptied', () => {
    const overrides: readonly ShiftTypeOverride[] = [{ teamId: 'D', date: HOLIDAY, shiftTypeId: 't1' }];
    expect(cellsOn(HOLIDAY, OFF_D, overrides)[0]).toEqual({
      teamId: 'D',
      shiftTypeId: 't1',
      projectedShiftTypeId: 't1',
      overridden: true,
      holiday: true,
      rosterChanged: false,
    });
    expect(dayOf('d1', HOLIDAY, OFF_D, overrides).shifts.map((one) => one.shiftTypeId)).toEqual(['t1']);
    // Without the holiday rule the overridden cell carries no mark.
    expect(Object.hasOwn(cellsOn(HOLIDAY, {}, overrides)[0]!, 'holiday')).toBe(false);
  });

  it('a 24-hour team marked off is emptied too; a date before any rotation version carries no mark', () => {
    expect(cellsOn(HOLIDAY, { holidays: [HOLIDAY], teamsOffOnHolidays: ['D', 'K'] })[1]).toEqual({
      teamId: 'K',
      shiftTypeId: null,
      projectedShiftTypeId: 'dan',
      overridden: false,
      holiday: true,
      offForHoliday: true,
      rosterChanged: false,
    });
    const early = scheduleOfMonth(
      { teamIds: ['D'], ...r138Shared({ holidays: ['2019-11-18'], teamsOffOnHolidays: ['D'] }), assignments: [] },
      '2019-11',
    );
    expect(early.find((row) => row.date === '2019-11-18')!.cells[0]).toEqual({
      teamId: 'D',
      shiftTypeId: null,
      projectedShiftTypeId: null,
      overridden: false,
      rosterChanged: false,
    });
  });

  it('a personal rotation counted with D is emptied; with K or with no team it is kept; an assignment is kept', () => {
    expect(dayOf('p', HOLIDAY).shifts).toEqual([]);
    expect(labelsOf('p', HOLIDAY, {})).toEqual(['t1@D']);
    expect(labelsOf('q', HOLIDAY)).toEqual(['t1@K']);
    expect(labelsOf('s', HOLIDAY)).toEqual(['t1@null']);
    expect(dayOf('a', HOLIDAY).shifts).toMatchObject([{ teamId: 'D', shiftTypeId: 't1', personalAssignmentId: 'a-holiday' }]);
    expect(atWorkDates('p')).toEqual(['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20']);
    expect(atWorkDates('q')).toContain(HOLIDAY);
    expect(atWorkDates('s')).toContain(HOLIDAY);
    expect(atWorkDates('a')).toEqual(['2026-11-16', '2026-11-17', HOLIDAY, '2026-11-19', '2026-11-20']);
    expect(leaveCostOf(r138Hours('p'), HOLIDAY, HOLIDAY)).toBe(0);
    expect(leaveCostOf(r138Hours('a'), HOLIDAY, HOLIDAY)).toBe(1);

    const p = R138_MEMBERS.find((member) => member.id === 'p')!;
    const working = new Set(WORKING);
    expect(personalShiftOn(p, HOLIDAY, working, R138.steps, OFF_D)).toBeNull();
    expect(personalShiftOn(p, HOLIDAY, working, R138.steps)).toMatchObject({ shiftTypeId: 't1', teamId: 'D', personalRotation: true });
    expect(personalShiftOn(p, '2026-11-19', working, R138.steps, OFF_D)).toMatchObject({ shiftTypeId: 't1', teamId: 'D' });
  });

  it("staffing: D's holiday holds only the assignment's group; K's Dan and Q's group are as on any date", () => {
    expect(staffingOn(r138Staffing(), 'D', HOLIDAY)).toEqual([{ shiftTypeId: 't1', atWork: 1 }]);
    expect(staffingOn(r138Staffing({}), 'D', HOLIDAY)).toEqual([{ shiftTypeId: 't1', atWork: 4 }]);
    expect(staffingOn(r138Staffing(), 'K', HOLIDAY)).toEqual([
      { shiftTypeId: 'dan', atWork: 1 },
      { shiftTypeId: 't1', atWork: 1 },
    ]);
  });

  it("a roster override putting a member on D's holiday is inert, and the holiday is what makes it so", () => {
    const putOn: readonly RosterOverride[] = [{ id: 'k1-on-d', teamId: 'D', date: HOLIDAY, memberOutId: null, memberInId: 'k1' }];
    expect(cellsOn(HOLIDAY, OFF_D, [], putOn)[0]).toMatchObject({ shiftTypeId: null, rosterChanged: false });
    expect(dayOf('k1', HOLIDAY, OFF_D, [], putOn).shifts.map((one) => one.teamId)).toEqual(['K']);
    expect(dayOf('k1', HOLIDAY, {}, [], putOn).shifts.map((one) => one.teamId)).toEqual(['K', 'D']);
    const before = { teamIds: ['D', 'K'], ...r138Shared({}, [], putOn) };
    const after = { teamIds: ['D', 'K'], ...r138Shared(OFF_D, [], putOn) };
    expect(rosterOverridesMadeInertOf(before, after, '2026-11-01', '2026-11-30')).toEqual(putOn);
  });

  it('`scheduledShiftTypeOn` with no holiday rule is the type with no holiday, exactly as before', () => {
    const versions = R138.assignments.filter((one) => one.teamId === 'D');
    const plain = { shiftTypeId: 't1', projectedShiftTypeId: 't1', overridden: false };
    expect(scheduledShiftTypeOn(versions, R138.steps, [], 'D', HOLIDAY)).toStrictEqual(plain);
    // The sixth argument left out, given as `undefined`, or a rule that decides nothing: the same value (R13.5).
    expect(scheduledShiftTypeOn(versions, R138.steps, [], 'D', HOLIDAY, undefined)).toStrictEqual(plain);
    for (const rule of [{}, { holidays: [HOLIDAY] }, { teamsOffOnHolidays: ['D'] }, { holidays: [HOLIDAY], teamsOffOnHolidays: ['K'] }]) {
      expect(scheduledShiftTypeOn(versions, R138.steps, [], 'D', HOLIDAY, rule), JSON.stringify(rule)).toStrictEqual(plain);
    }
  });

  it('`scheduledShiftTypeOn` given the rule (story 21.16): an emptied team answers a null type, its projected type kept', () => {
    const d = R138.assignments.filter((one) => one.teamId === 'D');
    const k = R138.assignments.filter((one) => one.teamId === 'K');
    expect(scheduledShiftTypeOn(d, R138.steps, [], 'D', HOLIDAY, OFF_D)).toStrictEqual({
      shiftTypeId: null,
      projectedShiftTypeId: 't1',
      overridden: false,
      holiday: true,
      offForHoliday: true,
    });
    // The day after the holiday, and a team that works the holiday: as with no rule.
    expect(scheduledShiftTypeOn(d, R138.steps, [], 'D', '2026-11-19', OFF_D)).toStrictEqual(
      scheduledShiftTypeOn(d, R138.steps, [], 'D', '2026-11-19'),
    );
    expect(scheduledShiftTypeOn(k, R138.steps, [], 'K', HOLIDAY, OFF_D)).toStrictEqual({
      shiftTypeId: 'dan',
      projectedShiftTypeId: 'dan',
      overridden: false,
    });
    // An override still wins on the holiday (R13.3), marked `holiday` alone.
    const override: readonly ShiftTypeOverride[] = [{ teamId: 'D', date: HOLIDAY, shiftTypeId: 't1' }];
    expect(scheduledShiftTypeOn(d, R138.steps, override, 'D', HOLIDAY, OFF_D)).toStrictEqual({
      shiftTypeId: 't1',
      projectedShiftTypeId: 't1',
      overridden: true,
      holiday: true,
    });
    // No rotation in effect: null, whatever the rule says.
    expect(scheduledShiftTypeOn([], R138.steps, [], 'D', HOLIDAY, OFF_D)).toBeNull();
    // The rule's own preconditions are checked.
    expect(() => scheduledShiftTypeOn(d, R138.steps, [], 'D', HOLIDAY, { holidays: [HOLIDAY, HOLIDAY] })).toThrow(/given twice/);
  });

  it('refuses a holiday that is not a calendar date, and a date or a team given twice', () => {
    const month = (rule: HolidayRule) => () => scheduleOfMonth({ teamIds: ['D'], ...r138Shared(rule) }, '2026-11');
    expect(month({ holidays: ['2026-02-30'] })).toThrow(RangeError);
    expect(month({ holidays: [HOLIDAY, HOLIDAY], teamsOffOnHolidays: ['D'] })).toThrow(/given twice/);
    expect(month({ holidays: [HOLIDAY], teamsOffOnHolidays: ['D', 'D'] })).toThrow(/given twice/);
    expect(month({ holidays: [HOLIDAY], teamsOffOnHolidays: [''] })).toThrow(/not a team id/);
    // Checked even when the other list is empty, so a bad list never waits for its pair.
    expect(month({ holidays: ['18.11.2026.'], teamsOffOnHolidays: [] })).toThrow(RangeError);
    expect(() => memberScheduleOfMonth(r138Hours('d1', { holidays: ['2026-13-01'] }), '2026-11')).toThrow(RangeError);
    const p = R138_MEMBERS.find((member) => member.id === 'p')!;
    expect(() => personalShiftOn(p, HOLIDAY, new Set(WORKING), R138.steps, { holidays: ['x'] })).toThrow(RangeError);
  });
});

describe('R13.6 — the proposed Croatian list', () => {
  const january = (year: number) => [
    { date: `${String(year)}-01-01`, code: 'NEW_YEAR' },
    { date: `${String(year)}-01-06`, code: 'EPIPHANY' },
  ];

  it('2026: the eleven fixed dates, Easter Sunday 04-05, Easter Monday 04-06 and Corpus Christi 06-04, in date order', () => {
    expect(nationalHolidaysOf('HR', 2026)).toEqual([
      ...january(2026),
      { date: '2026-04-05', code: 'EASTER_SUNDAY' },
      { date: '2026-04-06', code: 'EASTER_MONDAY' },
      { date: '2026-05-01', code: 'LABOUR_DAY' },
      { date: '2026-05-30', code: 'STATEHOOD_DAY' },
      { date: '2026-06-04', code: 'CORPUS_CHRISTI' },
      { date: '2026-06-22', code: 'ANTI_FASCIST_STRUGGLE_DAY' },
      { date: '2026-08-05', code: 'VICTORY_DAY' },
      { date: '2026-08-15', code: 'ASSUMPTION_DAY' },
      { date: '2026-11-01', code: 'ALL_SAINTS_DAY' },
      { date: '2026-11-18', code: 'REMEMBRANCE_DAY' },
      { date: '2026-12-25', code: 'CHRISTMAS_DAY' },
      { date: '2026-12-26', code: 'ST_STEPHENS_DAY' },
    ]);
  });

  it('2027: Easter Sunday 03-28, Easter Monday 03-29 and Corpus Christi 05-27', () => {
    expect(nationalHolidaysOf('HR', 2027)).toEqual([
      ...january(2027),
      { date: '2027-03-28', code: 'EASTER_SUNDAY' },
      { date: '2027-03-29', code: 'EASTER_MONDAY' },
      { date: '2027-05-01', code: 'LABOUR_DAY' },
      { date: '2027-05-27', code: 'CORPUS_CHRISTI' },
      { date: '2027-05-30', code: 'STATEHOOD_DAY' },
      { date: '2027-06-22', code: 'ANTI_FASCIST_STRUGGLE_DAY' },
      { date: '2027-08-05', code: 'VICTORY_DAY' },
      { date: '2027-08-15', code: 'ASSUMPTION_DAY' },
      { date: '2027-11-01', code: 'ALL_SAINTS_DAY' },
      { date: '2027-11-18', code: 'REMEMBRANCE_DAY' },
      { date: '2027-12-25', code: 'CHRISTMAS_DAY' },
      { date: '2027-12-26', code: 'ST_STEPHENS_DAY' },
    ]);
  });

  it('every year from 2020 holds its dates once each, in order, fourteen unless Corpus Christi falls on a fixed date', () => {
    for (let year = FIRST_HR_HOLIDAY_YEAR; year <= 2100; year += 1) {
      const list = nationalHolidaysOf('HR', year);
      const dates = list.map((one) => one.date);
      expect(new Set(dates).size).toBe(dates.length);
      expect([...dates].sort()).toEqual(dates);
      expect(dates.every((date) => date.startsWith(`${String(year)}-`))).toBe(true);
      expect(list.length).toBe(list.some((one) => one.code === 'CORPUS_CHRISTI') ? 14 : 13);
    }
    // 2024: Easter on 03-31, so Corpus Christi is 05-30, held once as Statehood Day.
    const list2024 = nationalHolidaysOf('HR', 2024);
    expect(list2024.find((one) => one.date === '2024-05-30')?.code).toBe('STATEHOOD_DAY');
    expect(list2024).toHaveLength(13);
  });

  it('refuses another country, a year before 2020 or past 9999, and a fraction', () => {
    expect(() => nationalHolidaysOf('SI' as HolidayCountry, 2026)).toThrow(RangeError);
    expect(() => nationalHolidaysOf('HR', 2019)).toThrow(RangeError);
    expect(() => nationalHolidaysOf('HR', 10000)).toThrow(RangeError);
    expect(() => nationalHolidaysOf('HR', 2026.5)).toThrow(RangeError);
    expect(nationalHolidaysOf('HR', 9999).length).toBeGreaterThanOrEqual(13);
  });
});

describe('Easter by the Gregorian computus', () => {
  it.each([
    [1583, '1583-04-10'],
    [1818, '1818-03-22'],
    [1943, '1943-04-25'],
    [2000, '2000-04-23'],
    [2008, '2008-03-23'],
    [2011, '2011-04-24'],
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'],
  ])('%i: %s', (year, date) => {
    expect(easterSundayOf(year)).toBe(date);
  });

  it('falls on a Sunday from 22 March to 25 April every year, and refuses a year outside 1583–9999', () => {
    const sunday = civilDayNumber('2026-04-05');
    for (let year = 1583; year <= 9999; year += 1) {
      const date = easterSundayOf(year);
      const monthDay = date.slice(5);
      expect(monthDay >= '03-22' && monthDay <= '04-25').toBe(true);
      expect((((civilDayNumber(date) - sunday) % 7) + 7) % 7).toBe(0);
    }
    expect(() => easterSundayOf(1582)).toThrow(RangeError);
    expect(() => easterSundayOf(10000)).toThrow(RangeError);
  });
});

describe('R13.9 — the review matrix', () => {
  it('a personal rotation counted with D is emptied even when D has no rotation, or an override makes D work the holiday', () => {
    // A rotation-less day team is the pilot's shape (R15.7): its members' personal rotations stop on its holidays.
    const noRotation = memberScheduleOfMonth({ ...r138Hours('p'), assignments: R138.assignments.filter((one) => one.teamId === 'K') }, '2026-11');
    expect(noRotation.find((day) => day.date === HOLIDAY)!.shifts).toEqual([]);
    expect(noRotation.find((day) => day.date === '2026-11-19')!.shifts.map((one) => one.shiftTypeId)).toEqual(['t1']);
    // R15.4: a team's override never changes a personal rotation's shift, so it does not bring one back either.
    const overrides: readonly ShiftTypeOverride[] = [{ teamId: 'D', date: HOLIDAY, shiftTypeId: 't1' }];
    expect(dayOf('p', HOLIDAY, OFF_D, overrides).shifts).toEqual([]);
  });

  it('an override to a non-working type on the holiday is marked `holiday`, works nothing and costs nothing', () => {
    const overrides: readonly ShiftTypeOverride[] = [{ teamId: 'D', date: HOLIDAY, shiftTypeId: 'off' }];
    expect(cellsOn(HOLIDAY, OFF_D, overrides)[0]).toEqual({
      teamId: 'D',
      shiftTypeId: 'off',
      projectedShiftTypeId: 't1',
      overridden: true,
      holiday: true,
      rosterChanged: false,
    });
    expect(leaveCostOf(r138Hours('d1', OFF_D, overrides), HOLIDAY, HOLIDAY)).toBe(0);
    expect(peopleAtWorkOn({ ...r138Staffing(), overrides }, 'D', HOLIDAY)).toBeNull();
  });

  it('a loan decides the team: a D member lent to K works the holiday; a K member lent to D is emptied, keeping the loan', () => {
    const lent: readonly RosterMember[] = R138_MEMBERS.map((member) => {
      if (member.id === 'd2') return { ...member, loans: [{ id: 'loan-d2', teamId: 'K', from: HOLIDAY, to: HOLIDAY }] };
      if (member.id === 'k1') return { ...member, loans: [{ id: 'loan-k1', teamId: 'D', from: HOLIDAY, to: HOLIDAY }] };
      if (member.id === 'q') return { ...member, loans: [{ id: 'loan-q', teamId: 'D', from: HOLIDAY, to: HOLIDAY }] };
      return member;
    });
    const day = (memberId: string) => {
      const member = lent.find((one) => one.id === memberId)!;
      const input = { ...r138Hours(memberId), members: lent, loans: member.loans ?? [] };
      return memberScheduleOfMonth(input, '2026-11').find((one) => one.date === HOLIDAY)!.shifts;
    };
    expect(day('d2')).toMatchObject([{ teamId: 'K', shiftTypeId: 'dan', loanId: 'loan-d2' }]);
    expect(day('k1')).toEqual([
      {
        teamId: 'D',
        shiftTypeId: null,
        projectedShiftTypeId: 't1',
        overridden: false,
        holiday: true,
        offForHoliday: true,
        rosterChanged: false,
        viaOverride: false,
        loanId: 'loan-k1',
      },
    ]);
    // Q's personal rotation counts with D through the loan that date, so the holiday empties it.
    expect(day('q')).toEqual([]);
  });

  it('collisions over the holiday: none for an emptied personal rotation, one for an assignment; R12 reads the rule from the assembly', () => {
    const leave = [
      { id: 'leave-p', memberId: 'p', from: HOLIDAY, to: HOLIDAY },
      { id: 'leave-a', memberId: 'a', from: HOLIDAY, to: HOLIDAY },
    ];
    expect(collisionsOf({ ...r138Shared(), leaveRecords: leave }).map((one) => `${one.memberId}@${String(one.teamId)}`)).toEqual(['a@D']);
    expect(collisionsOf({ ...r138Shared({}), leaveRecords: leave }).map((one) => one.memberId)).toEqual(['a', 'p']);
    expect(atWorkShiftsOf(r138Inputs('p'), HOLIDAY, HOLIDAY)).toEqual([]);
    expect(atWorkShiftsOf(r138Inputs('p', {}), HOLIDAY, HOLIDAY)).toHaveLength(1);
  });

  it('`rosterOverridesMadeInertOf`: a holiday present on both sides reports nothing; removing it reports nothing', () => {
    const putOn: readonly RosterOverride[] = [{ id: 'k1-on-d', teamId: 'D', date: HOLIDAY, memberOutId: null, memberInId: 'k1' }];
    const withRule = { teamIds: ['D', 'K'], ...r138Shared(OFF_D, [], putOn) };
    const without = { teamIds: ['D', 'K'], ...r138Shared({}, [], putOn) };
    expect(rosterOverridesMadeInertOf(withRule, withRule, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(rosterOverridesMadeInertOf(withRule, without, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
