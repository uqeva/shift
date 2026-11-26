import { describe, expect, it } from 'vitest';

import {
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_PERSONAL,
  LEAVE_HALF_FIRST,
  LEAVE_HALF_SECOND,
  PERSONAL_ASSIGNMENT_OFF,
  PERSONAL_ASSIGNMENT_SHIFT,
  SCHEDULE_SOURCE_MANUAL,
  SCHEDULE_SOURCE_PERSONAL,
  SCHEDULE_SOURCE_TEAM,
  atWorkShiftsOf,
  checkScheduleVersions,
  collisionsOf,
  datesOfMonth,
  explainMemberHours,
  leaveCostOf,
  memberScheduleOfMonth,
  personalShiftOn,
  reminderDueAt,
  rosterOn,
  scheduleOfMonth,
  scheduleSourceOn,
  shiftRemindersDueOf,
  SHIFT_REMINDER_SOURCE_PERSONAL_ROTATION,
  shiftRoster,
  staffingOn,
  type MemberHoursInput,
  type PersonalAssignment,
  type RosterMember,
  type RosterOverride,
  type ScheduleInputs,
  type ScheduleVersion,
  type ShiftTypeOverride,
  type StaffingInput,
} from '../src/index.js';
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
  type Organization,
} from './derivation.js';

/**
 * STORY 21.9 — the schedule-source rule (R15). THE GUARD (R15.6): with no
 * schedule version, every figure is identical to what it was before schedule
 * sources existed, over both fixtures, Personal Assignments included.
 */

/**
 * {@link membersOf} with Personal Assignments over the window, so the guard
 * also holds where R15.3's first step decides: the member on no team works t1
 * with no team on three dates, each team's member 1 is off on the 4th, and
 * each team's member 4 works a shift counted with the next team on the 18th.
 */
function assignedMembersOf(fixture: Fixture): readonly RosterMember[] {
  const [first] = workingOf(fixture);
  const ids = fixture.teams.map((team) => team.id);
  return membersOf(fixture).map((member): RosterMember => {
    const assignments: PersonalAssignment[] = [];
    if (member.id === 'teamless') {
      for (const date of ['2026-03-02', '2026-03-21', '2026-04-04']) {
        assignments.push({ id: `teamless-${date}`, date, kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: first!, teamId: null });
      }
    }
    const index = ids.findIndex((id) => member.id.startsWith(`${id}-`));
    if (index >= 0 && member.id.endsWith('-1')) {
      assignments.push({ id: `${member.id}-off`, date: '2026-03-04', kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null });
    }
    if (index >= 0 && member.id.endsWith('-4')) {
      const next = ids[(index + 1) % ids.length]!;
      assignments.push({ id: `${member.id}-lend`, date: '2026-03-18', kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: first!, teamId: next });
    }
    return assignments.length === 0 ? member : { ...member, personalAssignments: assignments };
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


/** R12 for every member of both parity fixtures (their Personal Assignments included), over the whole parity window. */
function atWorkOf(organizationOf: (organization: ParityOrganization) => object) {
  return PARITY_FIXTURES.map(({ fixture, organization: given }) => {
    // Story 21.16 gave the fixtures holidays after this file's baseline was pinned: stripped, so the digest stays
    // the claim about schedule sources alone.
    const { holidays: _holidays, teamsOffOnHolidays: _off, ...stripped } = given;
    const organization = {
      ...stripped,
      overrides: stripped.overrides.filter((one) => !HOLIDAY_ROWS.has(one.id)),
      members: stripped.members.map((member) => ({
        ...member,
        personalAssignments: member.personalAssignments.filter((one) => !HOLIDAY_ROWS.has(one.id)),
      })),
    };
    // The fixtures' own row types are narrower than a changed member's versions; the assembly is the same shape.
    const changed = organizationOf(organization as ParityOrganization) as ParityOrganization;
    return {
      fixture,
      atWork: changed.members.map((member) => atWorkShiftsOf(inputsOf(changed, member.id), PARITY_WINDOW.from, PARITY_WINDOW.to)),
    };
  });
}

/**
 * The digests of {@link guardedFiguresOf} for each fixture with and without
 * {@link assignedMembersOf}'s assignments, and of {@link atWorkOf}, computed
 * on the engine BEFORE schedule sources existed (commit e1b6a65, the base of
 * story 21.9). A change that moves any figure of an organization with no
 * schedule version changes a digest.
 */
const BEFORE_SCHEDULE_SOURCE: Readonly<Record<string, string>> = {
  pilot: '8c6b0e0d8333ba6955f6ec7b1097d4812e50b970ecd5ab45a633e2b5cd069d3e',
  'pilot assigned': '6cfeac1aef9a949a6aae4d1884bdfd3e0794c12f7df735c3eb49e764686fb87b',
  'UJ-5': '9020ab27dd6b7af0639255ef07c1a363ec788e42ec85f52400e7594ad0af0993',
  'UJ-5 assigned': '65c95cb491155f81dbcb989ae3f996ddd9e89ddfd6ab91bcbdc83017e62cd3fc',
  'at-work': 'be22b42f7febe9590b0a4c03c97a07668d02ae5cd2c45e999e6a8aab4e44d531',
};

describe('R15.6 — with no schedule version, every derived figure is what it was before', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: every figure, with and without Personal Assignments, digests as before`, () => {
      const plain = guardedFiguresOf({ fixture, members: membersOf(fixture) });
      const assigned = guardedFiguresOf({ fixture, members: assignedMembersOf(fixture) });
      // Non-trivial: the assignments move figures, and the organization has collisions and short-staffed shifts.
      expect(digestOf(assigned)).not.toBe(digestOf(plain));
      expect(assigned.derived.collisions.some((collision) => collision.teamId === null)).toBe(true);
      expect(assigned.derived.shortStaffed.length).toBeGreaterThan(0);
      expect(digestOf(plain)).toBe(BEFORE_SCHEDULE_SOURCE[fixture.name]);
      expect(digestOf(assigned)).toBe(BEFORE_SCHEDULE_SOURCE[`${fixture.name} assigned`]);
    });
  }

  it("both parity fixtures: every member's at-work shifts (R12) digest as before", () => {
    // Story 21.10 gave the fixtures versions; with none (`[]`, R15.6) the digest is the baseline's.
    const withoutVersions = (organization: ParityOrganization): object => ({
      ...organization,
      members: organization.members.map((member) => ({ ...member, scheduleVersions: [] })),
    });
    expect(digestOf(atWorkOf(withoutVersions))).toBe(BEFORE_SCHEDULE_SOURCE['at-work']);
    // And with them, the fixtures' versions move R12 (non-trivial).
    expect(digestOf(atWorkOf((organization) => organization))).not.toBe(BEFORE_SCHEDULE_SOURCE['at-work']);
  });
});

const team = (effectiveFrom: string): ScheduleVersion => ({ effectiveFrom, source: SCHEDULE_SOURCE_TEAM, patternId: null, offsetStepId: null });
const manual = (effectiveFrom: string): ScheduleVersion => ({ effectiveFrom, source: SCHEDULE_SOURCE_MANUAL, patternId: null, offsetStepId: null });
const personal = (effectiveFrom: string, patternId: string, offsetStepId: string): ScheduleVersion => ({
  effectiveFrom,
  source: SCHEDULE_SOURCE_PERSONAL,
  patternId,
  offsetStepId,
});

describe('R15.6 — versions that decide nothing in the window derive exactly as none', () => {
  /** Versions that leave every date of the window on the team's rotation: none, empty, `TEAM`, or later than the window. */
  const neutralOf = (patternId: string, offsetStepId: string, after: string): readonly (readonly ScheduleVersion[])[] => [
    [],
    [team('2020-01-01')],
    [personal(after, patternId, offsetStepId)],
    [team('2020-01-01'), manual(after)],
  ];

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: with and without Personal Assignments, every figure digests as before`, () => {
      const { patternId, offsetStepId } = fixture.assignments[0]!;
      for (const versions of neutralOf(patternId, offsetStepId, '2026-05-01')) {
        const plain = membersOf(fixture).map((member) => ({ ...member, scheduleVersions: versions }));
        const assigned = assignedMembersOf(fixture).map((member) => ({ ...member, scheduleVersions: versions }));
        expect(digestOf(guardedFiguresOf({ fixture, members: plain }))).toBe(BEFORE_SCHEDULE_SOURCE[fixture.name]);
        expect(digestOf(guardedFiguresOf({ fixture, members: assigned }))).toBe(BEFORE_SCHEDULE_SOURCE[`${fixture.name} assigned`]);
      }
    });
  }

  it('both parity fixtures: R12 digests as before', () => {
    const after = '2027-11-01';
    // The "later" versions must stay outside the parity window, or they would decide dates in it.
    expect(after > PARITY_WINDOW.to).toBe(true);
    for (const index of neutralOf('p', 's', after).keys()) {
      const changed = atWorkOf((organization) => {
        const { patternId, offsetStepId } = organization.assignments[0]!;
        const versions = neutralOf(patternId, offsetStepId, after)[index]!;
        return { ...organization, members: organization.members.map((member) => ({ ...member, scheduleVersions: versions })) };
      });
      expect(digestOf(changed)).toBe(BEFORE_SCHEDULE_SOURCE['at-work']);
    }
  });

  it('adds no `personalRotation` key at all where no personal rotation is (the digest cannot see one)', () => {
    for (const fixture of FIXTURES) {
      const organization = { fixture, members: assignedMembersOf(fixture) };
      for (const member of organization.members) {
        for (const month of MONTHS) {
          const input = { memberId: member.id, memberships: member.memberships, statuses: member.statuses, ...shared(organization) };
          for (const day of memberScheduleOfMonth(input, month)) {
            for (const one of day.shifts) expect(Object.hasOwn(one, 'personalRotation')).toBe(false);
          }
        }
      }
    }
    // The parity fixtures with their versions emptied (story 21.10 gave them some).
    const withoutVersions = (organization: ParityOrganization): object => ({
      ...organization,
      members: organization.members.map((member) => ({ ...member, scheduleVersions: [] })),
    });
    for (const { atWork } of atWorkOf(withoutVersions)) {
      for (const one of atWork.flat()) expect(Object.hasOwn(one, 'personalRotation')).toBe(false);
    }
  });
});

/**
 * R15.7's organization. Day team D has no rotation. 24-hour team K works
 * [Dan, Noć, Slobodno, Slobodno] from 2026-03-01 (Dan on the 1st, 5th, 9th,
 * …). Pattern `w` is [1. smjena ×5, Slobodno ×2, 2. smjena ×5, Slobodno ×2].
 * Monday is 2026-03-02.
 */
const at = (hour: number): number => hour * 60;
const R157 = {
  types: [
    { id: 't1', name: '1. smjena', isWorking: true },
    { id: 't2', name: '2. smjena', isWorking: true },
    { id: 'dan', name: 'Dan', isWorking: true },
    { id: 'noc', name: 'Noć', isWorking: true },
    { id: 'off', name: 'Slobodno', isWorking: false },
  ],
  versions: [
    { shiftTypeId: 't1', effectiveFrom: '2020-01-01', startMinute: at(6), endMinute: at(14) },
    { shiftTypeId: 't2', effectiveFrom: '2020-01-01', startMinute: at(14), endMinute: at(22) },
    { shiftTypeId: 'dan', effectiveFrom: '2020-01-01', startMinute: at(7), endMinute: at(19) },
    { shiftTypeId: 'noc', effectiveFrom: '2020-01-01', startMinute: at(19), endMinute: at(7) },
  ],
  steps: [
    { id: 'k0', patternId: 'k', position: 0, shiftTypeId: 'dan' },
    { id: 'k1', patternId: 'k', position: 1, shiftTypeId: 'noc' },
    { id: 'k2', patternId: 'k', position: 2, shiftTypeId: 'off' },
    { id: 'k3', patternId: 'k', position: 3, shiftTypeId: 'off' },
    ...['t1', 't1', 't1', 't1', 't1', 'off', 'off', 't2', 't2', 't2', 't2', 't2', 'off', 'off'].map((shiftTypeId, position) => ({
      id: `w${String(position)}`,
      patternId: 'w',
      // Positions with gaps: the steps are read by order, never by value (R1).
      position: position * 10,
      shiftTypeId,
    })),
  ],
  assignments: [{ teamId: 'K', patternId: 'k', offsetStepId: 'k0', anchorDate: '2026-03-01', effectiveFrom: '2020-01-01' }],
  bands: [{ id: 'dan', name: 'Dan', startMinute: at(6) }],
};
const WORKING = ['t1', 't2', 'dan', 'noc'];
const inD = [{ teamId: 'D', position: null, effectiveFrom: '2020-01-01' }];
const inK = [{ teamId: 'K', position: null, effectiveFrom: '2020-01-01' }];
const dayOff = (id: string, date: string): PersonalAssignment => ({ id, date, kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null });
const shiftOf = (id: string, date: string, shiftTypeId: string, teamId: string | null = null): PersonalAssignment => ({
  id,
  date,
  kind: PERSONAL_ASSIGNMENT_SHIFT,
  shiftTypeId,
  teamId,
});

/**
 * W on a personal rotation in D from the 2nd, off on the 10th; k1 manual only
 * from the 15th, given Dan on the 21st; k2 on a personal rotation inside K
 * from the 1st; k3 on K's rotation; a member on no team on the same personal
 * rotation; and V, inactive from the 25th, on it in D.
 */
function r157Members(): readonly RosterMember[] {
  return [
    { id: 'w', memberships: inD, statuses: [], personalAssignments: [dayOff('w-10', '2026-03-10')], scheduleVersions: [personal('2026-03-02', 'w', 'w0')] },
    { id: 'k1', memberships: inK, statuses: [], personalAssignments: [shiftOf('k1-21', '2026-03-21', 'dan')], scheduleVersions: [manual('2026-03-15')] },
    { id: 'k2', memberships: inK, statuses: [], scheduleVersions: [personal('2026-03-01', 'w', 'w0')] },
    { id: 'k3', memberships: inK, statuses: [] },
    { id: 'solo', memberships: [], statuses: [], scheduleVersions: [personal('2026-03-02', 'w', 'w0')] },
    { id: 'v', memberships: inD, statuses: [{ active: false, effectiveFrom: '2026-03-25' }], scheduleVersions: [personal('2026-03-02', 'w', 'w0')] },
  ];
}

function r157Shared(members: readonly RosterMember[], rosterOverrides: readonly RosterOverride[] = [], overrides: readonly ShiftTypeOverride[] = []) {
  return { assignments: R157.assignments, steps: R157.steps, overrides, members, rosterOverrides, workingShiftTypeIds: WORKING };
}

const r157ShiftTypes = R157.types.map((type) => ({ type, versions: R157.versions.filter((version) => version.shiftTypeId === type.id) }));

function r157Hours(
  members: readonly RosterMember[],
  memberId: string,
  rosterOverrides: readonly RosterOverride[] = [],
  overrides: readonly ShiftTypeOverride[] = [],
): MemberHoursInput {
  const member = members.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    ...r157Shared(members, rosterOverrides, overrides),
    bands: R157.bands,
    shiftTypes: r157ShiftTypes,
  };
}

function r157Staffing(members: readonly RosterMember[], overrides: readonly ShiftTypeOverride[] = []): StaffingInput {
  return { teamIds: ['D', 'K'], ...r157Shared(members, [], overrides), leaveRecords: [], minimumMembers: null };
}

function r157Inputs(members: readonly RosterMember[], memberId: string): ScheduleInputs {
  return {
    organizationId: 'org',
    timeZone: 'Europe/Zagreb',
    memberId,
    teams: [
      { id: 'D', name: 'D', archived: false },
      { id: 'K', name: 'K', archived: false },
    ],
    shiftTypes: r157ShiftTypes,
    steps: R157.steps,
    assignments: R157.assignments,
    assignmentStamps: [{ teamId: 'K', effectiveFrom: '2020-01-01', createdAt: 1 }],
    members: members.map((member) => ({ ...member, loans: member.loans ?? [] })),
    overrides: [],
    rosterOverrides: [],
    leave: [],
  };
}

/** One member's month as `date type@team marks` lines. */
function monthLines(input: MemberHoursInput, month = '2026-03'): readonly string[] {
  return memberScheduleOfMonth(input, month).flatMap((day) =>
    day.shifts
      .filter((one) => one.shiftTypeId !== null)
      .map((one) =>
        [
          day.date,
          `${String(one.shiftTypeId)}@${one.teamId ?? '-'}`,
          one.personalRotation === true ? 'rotation' : '',
          one.personalAssignmentId === undefined ? '' : 'assigned',
          one.viaOverride ? 'override' : '',
        ]
          .filter((part) => part !== '')
          .join(' '),
      ),
  );
}

const range = (from: number, to: number): readonly string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `2026-03-${String(from + index).padStart(2, '0')}`);

describe('R15.7 — the worked example', () => {
  const members = r157Members();

  it('W works mornings in weeks one and three and afternoons in weeks two and four, all with D; the 10th is free, the 11th follows the pattern', () => {
    const lines = (dates: readonly string[], type: string) => dates.map((date) => `${date} ${type}@D rotation`);
    expect(monthLines(r157Hours(members, 'w'))).toEqual([
      ...lines(range(2, 6), 't1'),
      ...lines(['2026-03-09', ...range(11, 13)], 't2'),
      ...lines(range(16, 20), 't1'),
      ...lines(range(23, 27), 't2'),
      ...lines(range(30, 31), 't1'),
    ]);
    const tenth = memberScheduleOfMonth(r157Hours(members, 'w'), '2026-03').find((day) => day.date === '2026-03-10')!;
    expect(tenth.personalAssignment?.kind).toBe(PERSONAL_ASSIGNMENT_OFF);
    expect(tenth.shifts).toEqual([]);
  });

  it("W's hours are PERSONAL, and a week of W's leave costs the five dates the rotation works", () => {
    const total = explainMemberHours(r157Hours(members, 'w'), '2026-03', { code: HOURS_FIGURE_TOTAL });
    expect(total.operands.length).toBe(21);
    expect(new Set(total.operands.map((operand) => operand.source))).toEqual(new Set([HOURS_SOURCE_PERSONAL]));
    expect(total.minutes).toBe(21 * at(8));
    expect(leaveCostOf(r157Hours(members, 'w'), '2026-03-02', '2026-03-08')).toBe(5);
  });

  it("a 24-hour team's member set to manual only leaves its base roster from that date and has only what is assigned", () => {
    // K works Dan on the 1st, 5th, 9th, 13th, 17th, 21st, 25th, 29th and Noć the day after each.
    expect(shiftRoster(members, 'K', '2026-03-13').map((entry) => entry.memberId)).toEqual(['k1', 'k3']);
    expect(shiftRoster(members, 'K', '2026-03-17').map((entry) => entry.memberId)).toEqual(['k3']);
    expect(monthLines(r157Hours(members, 'k1')).filter((line) => line >= '2026-03-15')).toEqual(['2026-03-21 dan@K assigned']);
    expect(monthLines(r157Hours(members, 'k1')).filter((line) => line < '2026-03-15' && !line.includes('off@'))).toEqual(
      ['01 dan', '02 noc', '05 dan', '06 noc', '09 dan', '10 noc', '13 dan', '14 noc'].map((cell) => {
        const [day, type] = cell.split(' ');
        return `2026-03-${day!} ${type!}@K`;
      }),
    );
  });

  it("R12 carries the rotation's shifts with their times and the mark, and no assignment id", () => {
    const shifts = atWorkShiftsOf(r157Inputs(members, 'w'), '2026-03-09', '2026-03-11');
    expect(shifts).toEqual([
      { date: '2026-03-09', teamId: 'D', shiftTypeId: 't2', viaOverride: false, personalRotation: true, startMinute: at(14), endMinute: at(22) },
      { date: '2026-03-11', teamId: 'D', shiftTypeId: 't2', viaOverride: false, personalRotation: true, startMinute: at(14), endMinute: at(22) },
    ]);
  });
});

describe('R15.3, R15.4 — the matrix', () => {
  const members = r157Members();

  it("a team's Shift Type Override changes its cell, never a personal rotation's shift counted with it", () => {
    const overrides: readonly ShiftTypeOverride[] = [{ teamId: 'K', date: '2026-03-03', shiftTypeId: 'dan' }];
    const before = monthLines(r157Hours(members, 'k2'));
    expect(monthLines(r157Hours(members, 'k2', [], overrides))).toEqual(before);
    expect(before).toContain('2026-03-03 t1@K rotation');
    const cell = scheduleOfMonth({ teamIds: ['K'], ...r157Shared(members, [], overrides) }, '2026-03')[2]!.cells[0]!;
    expect(cell).toMatchObject({ shiftTypeId: 'dan', overridden: true });
    // k2's 1. smjena on K's overridden Dan is its own group; k1 and k3 are on the Dan.
    expect(staffingOn(r157Staffing(members, overrides), 'K', '2026-03-03')).toEqual([
      { shiftTypeId: 'dan', atWork: 2 },
      { shiftTypeId: 't1', atWork: 1 },
    ]);
  });

  it('a personal rotation of the same type as the Scheduled Shift is counted on it, once', () => {
    // On the 5th K works Dan with k1 and k3; k2's rotation (from the 1st) has 1. smjena: a group of its own.
    expect(staffingOn(r157Staffing(members), 'K', '2026-03-05')).toEqual([
      { shiftTypeId: 'dan', atWork: 2 },
      { shiftTypeId: 't1', atWork: 1 },
    ]);
    const sameType = members.map((member) => (member.id === 'k2' ? { ...member, scheduleVersions: [personal('2026-03-01', 'k', 'k0')] } : member));
    expect(staffingOn(r157Staffing(sameType), 'K', '2026-03-05')).toEqual([{ shiftTypeId: 'dan', atWork: 3 }]);
  });

  it('an inactive date has no shift, and a member on no team has shifts with no team, raising a collision with none', () => {
    expect(monthLines(r157Hours(members, 'v')).at(-1)).toBe('2026-03-24 t2@D rotation');
    expect(monthLines(r157Hours(members, 'solo')).slice(0, 2)).toEqual(['2026-03-02 t1@- rotation', '2026-03-03 t1@- rotation']);
    const collisions = collisionsOf({ ...r157Shared(members), leaveRecords: [{ id: 'leave-solo', memberId: 'solo', from: '2026-03-06', to: '2026-03-07' }] });
    expect(collisions).toEqual([{ memberId: 'solo', date: '2026-03-06', teamId: null, shiftTypeId: 't1', leaveRecordId: 'leave-solo' }]);
  });

  it('roster overrides: onto the team a rotation counts with is inert, onto another team applies, taking off is inert, and manual only is put on', () => {
    const overrides: readonly RosterOverride[] = [
      { id: 'k2-on-k', teamId: 'K', date: '2026-03-05', memberOutId: null, memberInId: 'k2' },
      { id: 'w-on-k', teamId: 'K', date: '2026-03-05', memberOutId: 'k3', memberInId: 'w' },
      { id: 'k2-off-k', teamId: 'K', date: '2026-03-09', memberOutId: 'k2', memberInId: null },
      { id: 'k1-on-k', teamId: 'K', date: '2026-03-17', memberOutId: null, memberInId: 'k1' },
    ];
    expect(rosterOn(members, overrides, 'K', '2026-03-05').applied.map((one) => one.id)).toEqual(['w-on-k']);
    expect(rosterOn(members, overrides, 'K', '2026-03-09').applied).toEqual([]);
    expect(rosterOn(members, overrides, 'K', '2026-03-17').applied.map((one) => one.id)).toEqual(['k1-on-k']);
    expect(monthLines(r157Hours(members, 'k2', overrides)).filter((line) => line.startsWith('2026-03-05'))).toEqual(['2026-03-05 t1@K rotation']);
    // A double booking: W's own 1. smjena with D, and K's Dan an override put them on.
    expect(monthLines(r157Hours(members, 'w', overrides)).filter((line) => line.startsWith('2026-03-05'))).toEqual([
      '2026-03-05 t1@D rotation',
      '2026-03-05 dan@K override',
    ]);
    expect(monthLines(r157Hours(members, 'k1', overrides)).filter((line) => line.startsWith('2026-03-17'))).toEqual(['2026-03-17 dan@K override']);
  });

  it('`personalShiftOn` gives an assignment before the rotation, the rotation over `steps`, and none on manual only', () => {
    const working = new Set(WORKING);
    const w = members.find((member) => member.id === 'w')!;
    expect(personalShiftOn(w, '2026-03-02', working, R157.steps)).toEqual({ personalRotation: true, date: '2026-03-02', shiftTypeId: 't1', teamId: 'D' });
    expect(personalShiftOn(w, '2026-03-07', working, R157.steps)).toBeNull();
    expect(personalShiftOn(w, '2026-03-10', working, R157.steps)).toBeNull();
    expect(personalShiftOn(w, '2026-03-01', working, R157.steps)).toBeNull();
    const k1 = members.find((member) => member.id === 'k1')!;
    expect(personalShiftOn(k1, '2026-03-21', working, R157.steps)).toMatchObject({ personalAssignmentId: 'k1-21', teamId: 'K' });
    expect(personalShiftOn(k1, '2026-03-22', working, R157.steps)).toBeNull();
  });

  it('`scheduleSourceOn` selects by date, `TEAM` before the first version', () => {
    const versions = [manual('2026-04-01'), personal('2026-03-02', 'w', 'w3'), team('2026-05-01')];
    expect(scheduleSourceOn(versions, '2026-03-01').source).toBe(SCHEDULE_SOURCE_TEAM);
    expect(scheduleSourceOn(versions, '2026-03-02')).toEqual(personal('2026-03-02', 'w', 'w3'));
    expect(scheduleSourceOn(versions, '2026-04-30').source).toBe(SCHEDULE_SOURCE_MANUAL);
    expect(scheduleSourceOn(versions, '2026-05-01').source).toBe(SCHEDULE_SOURCE_TEAM);
    expect(scheduleSourceOn([], '2026-05-01').source).toBe(SCHEDULE_SOURCE_TEAM);
  });

  it('a version change from a personal rotation to the team rotation returns the member to its base roster', () => {
    const back = members.map((member) => (member.id === 'k2' ? { ...member, scheduleVersions: [personal('2026-03-01', 'w', 'w0'), team('2026-03-17')] } : member));
    expect(shiftRoster(back, 'K', '2026-03-13').map((entry) => entry.memberId)).toEqual(['k1', 'k3']);
    expect(shiftRoster(back, 'K', '2026-03-17').map((entry) => entry.memberId)).toEqual(['k2', 'k3']);
  });

  it('an offset step other than the first starts the member mid-pattern from the effective date', () => {
    const mid = members.map((member) => (member.id === 'w' ? { ...member, scheduleVersions: [personal('2026-03-02', 'w', 'w7')] } : member));
    expect(monthLines(r157Hours(mid, 'w')).slice(0, 9)).toEqual([
      ...range(2, 6).map((date) => `${date} t2@D rotation`),
      // The 10th is W's assigned day off.
      ...['2026-03-09', ...range(11, 13)].map((date) => `${date} t1@D rotation`),
    ]);
    expect(personalShiftOn(mid.find((member) => member.id === 'w')!, '2026-03-16', new Set(WORKING), R157.steps)).toMatchObject({ shiftTypeId: 't2' });
  });

  it("a team with no rotation is staffed by its members' rotation groups, and an inactive member leaves them", () => {
    expect(staffingOn(r157Staffing(members), 'D', '2026-03-02')).toEqual([{ shiftTypeId: 't1', atWork: 2 }]);
    expect(staffingOn(r157Staffing(members), 'D', '2026-03-24')).toEqual([{ shiftTypeId: 't2', atWork: 2 }]);
    // V is inactive from the 25th: W alone.
    expect(staffingOn(r157Staffing(members), 'D', '2026-03-26')).toEqual([{ shiftTypeId: 't2', atWork: 1 }]);
    expect(personalShiftOn(members.find((member) => member.id === 'v')!, '2026-03-26', new Set(WORKING), R157.steps)).toBeNull();
    expect(staffingOn(r157Staffing(members), 'D', '2026-03-07')).toEqual([]);
  });

  it('a loan moves the team a personal rotation counts with, and an assignment counted with another team replaces the day', () => {
    const changed = members.map((member): RosterMember =>
      member.id === 'w'
        ? {
            ...member,
            loans: [{ id: 'loan-w', teamId: 'K', from: '2026-03-16', to: '2026-03-17' }],
            personalAssignments: [...member.personalAssignments!, shiftOf('w-03', '2026-03-03', 'dan', 'K')],
          }
        : member,
    );
    const lines = monthLines(r157Hours(changed, 'w'));
    expect(lines.filter((line) => line.startsWith('2026-03-03'))).toEqual(['2026-03-03 dan@K assigned']);
    expect(lines.filter((line) => line >= '2026-03-16' && line < '2026-03-19')).toEqual([
      '2026-03-16 t1@K rotation',
      '2026-03-17 t1@K rotation',
      '2026-03-18 t1@D rotation',
    ]);
    expect(staffingOn(r157Staffing(changed), 'K', '2026-03-16')).toContainEqual({ shiftTypeId: 't1', atWork: 2 });
  });

  it("a half-day record keeps a personal rotation's worked half (R12.2)", () => {
    const inputs: ScheduleInputs = { ...r157Inputs(members, 'w'), leave: [{ id: 'half', from: '2026-03-02', to: '2026-03-02', half: LEAVE_HALF_FIRST, absenceTypeId: 'a' }] };
    expect(atWorkShiftsOf(inputs, '2026-03-02', '2026-03-02')).toEqual([
      { date: '2026-03-02', teamId: 'D', shiftTypeId: 't1', viaOverride: false, personalRotation: true, startMinute: at(10), endMinute: at(14), workedHalf: LEAVE_HALF_SECOND },
    ]);
  });

  it('`remind` gets the PERSONAL_ROTATION item for a personal rotation (21.10), and a team shift its usual eight keys', () => {
    const due = reminderDueAt('H1', '2026-03-02', at(6), 'Europe/Zagreb');
    expect(atWorkShiftsOf(r157Inputs(members, 'w'), '2026-03-02', '2026-03-02')).toHaveLength(1);
    expect(shiftRemindersDueOf(r157Inputs(members, 'w'), ['H1'], { from: '2026-03-02', to: '2026-03-02' }, due)).toEqual([
      {
        memberId: 'w',
        date: '2026-03-02',
        teamId: 'D',
        shiftTypeId: 't1',
        lead: 'H1',
        start: at(6),
        end: at(14),
        startsAt: '2026-03-02T05:00:00Z',
        source: SHIFT_REMINDER_SOURCE_PERSONAL_ROTATION,
      },
    ]);
    const teamDue = reminderDueAt('H1', '2026-03-01', at(7), 'Europe/Zagreb');
    expect(shiftRemindersDueOf(r157Inputs(members, 'k3'), ['H1'], { from: '2026-03-01', to: '2026-03-01' }, teamDue)).toEqual([
      expect.objectContaining({ memberId: 'k3', date: '2026-03-01', teamId: 'K', shiftTypeId: 'dan', lead: 'H1' }),
    ]);
    const [team] = shiftRemindersDueOf(r157Inputs(members, 'k3'), ['H1'], { from: '2026-03-01', to: '2026-03-01' }, teamDue);
    expect(Object.keys(team ?? {}).sort()).toEqual(['date', 'end', 'lead', 'memberId', 'shiftTypeId', 'start', 'startsAt', 'teamId']);
  });
});

describe('R15.2 — malformed versions and patterns are refused', () => {
  const refused = (versions: readonly unknown[]) => () => checkScheduleVersions(versions as readonly ScheduleVersion[]);

  it('refuses a bad date, two versions on one date, an unknown source, and a pattern on the wrong source', () => {
    expect(refused([team('2026-02-30')])).toThrow(RangeError);
    expect(refused([team('2026-03-01'), manual('2026-03-01')])).toThrow(/two schedule versions/);
    expect(refused([{ effectiveFrom: '2026-03-01', source: 'ROTATION', patternId: null, offsetStepId: null }])).toThrow(/neither TEAM, PERSONAL nor MANUAL/);
    expect(refused([{ effectiveFrom: '2026-03-01', source: SCHEDULE_SOURCE_PERSONAL, patternId: null, offsetStepId: 'w0' }])).toThrow(/no rotation pattern/);
    expect(refused([{ effectiveFrom: '2026-03-01', source: SCHEDULE_SOURCE_PERSONAL, patternId: 'w', offsetStepId: '' }])).toThrow(/no offset step/);
    expect(refused([{ effectiveFrom: '2026-03-01', source: SCHEDULE_SOURCE_MANUAL, patternId: 'w', offsetStepId: null }])).toThrow(/names a rotation pattern/);
    expect(refused([team('2026-03-01'), personal('2026-03-02', 'w', 'w0')])).not.toThrow();
  });

  it('refuses a personal rotation whose pattern has no steps, or whose offset step is not of the pattern', () => {
    const withVersion = (version: ScheduleVersion) =>
      r157Members().map((member) => (member.id === 'w' ? { ...member, scheduleVersions: [version] } : member));
    expect(() => memberScheduleOfMonth(r157Hours(withVersion(personal('2026-03-02', 'none', 'n0')), 'w'), '2026-03')).toThrow(/has no steps/);
    expect(() => memberScheduleOfMonth(r157Hours(withVersion(personal('2026-03-02', 'w', 'k0')), 'w'), '2026-03')).toThrow(/not a step of rotation pattern w/);
  });

  it("refuses a month input whose versions differ from the member's entry", () => {
    const members = r157Members();
    expect(() => memberScheduleOfMonth({ ...r157Hours(members, 'w'), scheduleVersions: [manual('2026-03-02')] }, '2026-03')).toThrow(/differ from those of their entry/);
    expect(monthLines({ ...r157Hours(members, 'w'), scheduleVersions: [personal('2026-03-02', 'w', 'w0')] })).toEqual(monthLines(r157Hours(members, 'w')));
  });
});
