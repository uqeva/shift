import { describe, expect, it } from 'vitest';

import {
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_PERSONAL,
  HOURS_SOURCE_ROTATION,
  LEAVE_HALF_FIRST,
  PERSONAL_ASSIGNMENT_OFF,
  PERSONAL_ASSIGNMENT_SHIFT,
  atWorkShiftsOf,
  checkPersonalAssignments,
  collisionsOf,
  datesOfMonth,
  explainMemberHours,
  hasTeam,
  leaveCostOf,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  newlyShortStaffedOf,
  overlappingLegsOf,
  peopleAtWorkOn,
  personalAssignmentOn,
  personalShiftOn,
  reminderDueAt,
  rosterOn,
  rosterOverridesMadeInertOf,
  scheduleOfMonth,
  shiftRemindersDueOf,
  shiftRoster,
  shortStaffedShiftsOf,
  staffingOn,
  type CollisionLeaveRecord,
  type PersonalAssignment,
  type ScheduleInputs,
  type StaffingInput,
  type MemberHoursInput,
  type RosterMember,
  type RosterOverride,
} from '../src/index.js';
import { PARITY_FIXTURES, PARITY_WINDOW, inputsOf } from '../parity/fixtures.js';
import {
  FIXTURES,
  MINIMUM_MEMBERS,
  MONTHS,
  derivedFiguresOf,
  digestOf,
  hoursInputOf,
  leaveRecordsOf,
  membersOf,
  shared,
  workingOf,
} from './derivation.js';
import { SEEDED_EFFECTIVE_FROM } from './fixtures.js';

/**
 * STORY 21.1 — the personal-assignment rule (R14). THE GUARD (R14.7): with no
 * Personal Assignment, every figure is identical to what it was before
 * Personal Assignments existed, over both fixtures.
 */

/**
 * Both parity fixtures as they were before story 21.2 gave them Personal
 * Assignments (and story 21.10 schedule versions): every member's lists removed, so the digest below is still the
 * claim R14.7 makes (no assignment anywhere derives as before).
 */
function withoutAssignments(organization: (typeof PARITY_FIXTURES)[number]['organization']) {
  return {
    ...organization,
    // Story 21.10: and no schedule version, which the fixtures gained after both.
    members: organization.members.map(({ personalAssignments: _dropped, scheduleVersions: _versions, ...member }) => member),
  };
}

/** R12 for every member of both parity fixtures, over the whole parity window. */
function atWorkFiguresOf(organizationOf: (organization: ReturnType<typeof withoutAssignments>) => typeof organization) {
  return PARITY_FIXTURES.map(({ fixture, organization }) => {
    const changed = organizationOf(withoutAssignments(organization));
    return {
      fixture,
      atWork: changed.members.map((member) => atWorkShiftsOf(inputsOf(changed, member.id), PARITY_WINDOW.from, PARITY_WINDOW.to)),
    };
  });
}


/**
 * The digests of {@link derivedFiguresOf} for each fixture, and of
 * {@link atWorkFiguresOf}, computed on the engine BEFORE Personal Assignments
 * existed (commit 0c11933, the base of story 21.1), with this file's
 * organizations, which hold none. A change that moves any figure of an
 * organization with no Personal Assignment changes a digest.
 */
const BEFORE_PERSONAL: Readonly<Record<string, string>> = {
  pilot: 'e19c02df948f2bcf4801c2f4741c2643c94ac0aa14e60705cab4a6b7fb4cdaac',
  'UJ-5': '3a31e69ebb9184374bd0b374294813d71ee2f64f2923125c9bf7c16e340dbf59',
  'at-work': '5b64a59a61764b6b9142fb901327f5f7cdda5b312e4e3e7b41bb3e9545712637',
};

describe('R14.7 — with no Personal Assignment, every derived figure is what it was before', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: rosters, schedules, hours, leave cost, collisions and staffing digest as before`, () => {
      const figures = derivedFiguresOf({ fixture, members: membersOf(fixture) });
      // Non-trivial: the organization has collisions, short-staffed shifts and applied overrides.
      expect(figures.collisions.length).toBeGreaterThan(0);
      expect(figures.shortStaffed.length).toBeGreaterThan(0);
      expect(figures.rosters.some((roster) => roster.applied.length > 0)).toBe(true);
      expect(digestOf(figures)).toBe(BEFORE_PERSONAL[fixture.name]);
    });
  }

  it('both parity fixtures: every member\'s at-work shifts (R12) over the parity window digest as before', () => {
    expect(digestOf(atWorkFiguresOf((organization) => organization))).toBe(BEFORE_PERSONAL['at-work']);
  });
});

describe('R14.7 — an empty or out-of-window assignment list derives exactly as none', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: \`personalAssignments: []\` on every member, and assignments wholly outside the window, digest as before`, () => {
      const empty = membersOf(fixture).map((member) => ({ ...member, personalAssignments: [] }));
      expect(digestOf(derivedFiguresOf({ fixture, members: empty }))).toBe(BEFORE_PERSONAL[fixture.name]);

      const outside = membersOf(fixture).map((member, index) => ({
        ...member,
        personalAssignments: [
          { id: `before-${index}`, date: '2026-02-27', kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null },
          { id: `after-${index}`, date: '2026-05-01', kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: workingOf(fixture)[0]!, teamId: null },
        ] satisfies readonly PersonalAssignment[],
      }));
      expect(digestOf(derivedFiguresOf({ fixture, members: outside }))).toBe(BEFORE_PERSONAL[fixture.name]);
    });
  }

  it('both parity fixtures: `personalAssignments: []`, or assignments wholly outside the window, leave R12 as before', () => {
    const empty = atWorkFiguresOf((organization) => ({
      ...organization,
      members: organization.members.map((member) => ({ ...member, personalAssignments: [] })),
    }));
    expect(digestOf(empty)).toBe(BEFORE_PERSONAL['at-work']);
    const outside = atWorkFiguresOf((organization) => ({
      ...organization,
      members: organization.members.map((member, index) => ({
        ...member,
        personalAssignments: [
          { id: `before-${index}`, date: '2026-02-28', kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null },
          { id: `after-${index}`, date: '2027-11-01', kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null },
        ] satisfies readonly PersonalAssignment[],
      })),
    }));
    expect(digestOf(outside)).toBe(BEFORE_PERSONAL['at-work']);
  });

  it('adds no key at all, not even `undefined`, where no assignment is (the digest cannot see one)', () => {
    for (const fixture of FIXTURES) {
      const organization = { fixture, members: membersOf(fixture) };
      for (const member of organization.members) {
        for (const month of MONTHS) {
          for (const day of memberScheduleOfMonth(hoursInputOf(organization, member), month)) {
            expect(Object.hasOwn(day, 'personalAssignment')).toBe(false);
            for (const one of day.shifts) expect(Object.hasOwn(one, 'personalAssignmentId')).toBe(false);
          }
        }
      }
    }
    for (const { atWork } of atWorkFiguresOf((organization) => organization)) {
      for (const one of atWork.flat()) expect(Object.hasOwn(one, 'personalAssignmentId')).toBe(false);
    }
  });

  it('`staffingOn` is `peopleAtWorkOn` alone, on every team and date, where no assignment is', () => {
    for (const fixture of FIXTURES) {
      const organization = { fixture, members: membersOf(fixture) };
      const input = {
        teamIds: fixture.teams.map((team) => team.id),
        ...shared(organization),
        leaveRecords: leaveRecordsOf(fixture),
        minimumMembers: MINIMUM_MEMBERS,
      };
      for (const date of datesOfMonth('2026-03')) {
        for (const team of fixture.teams) {
          const one = peopleAtWorkOn(input, team.id, date);
          expect(staffingOn(input, team.id, date)).toEqual(one === null ? [] : [one]);
        }
      }
    }
  });
});

/**
 * R14.8's organization. Day team D has no rotation; 24-hour team K works
 * [Dan, Noć, Slobodno, Slobodno] from 2026-03-01, so its Dan dates in March
 * are the 1st, 5th, 9th, 13th, … Monday is 2026-03-02.
 */
const at = (hour: number): number => hour * 60;
const R148 = {
  types: [
    { id: 't1', name: '1. smjena', isWorking: true },
    { id: 't2', name: '2. smjena', isWorking: true },
    { id: 'dan', name: 'Dan', isWorking: true },
    { id: 'noc', name: 'Noć', isWorking: true },
    { id: 'off', name: 'Slobodno', isWorking: false },
  ],
  versions: [
    { shiftTypeId: 't1', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(6), endMinute: at(14) },
    { shiftTypeId: 't2', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(14), endMinute: at(22) },
    { shiftTypeId: 'dan', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(7), endMinute: at(19) },
    { shiftTypeId: 'noc', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(19), endMinute: at(7) },
  ],
  steps: [
    { id: 'k0', patternId: 'k', position: 0, shiftTypeId: 'dan' },
    { id: 'k1', patternId: 'k', position: 1, shiftTypeId: 'noc' },
    { id: 'k2', patternId: 'k', position: 2, shiftTypeId: 'off' },
    { id: 'k3', patternId: 'k', position: 3, shiftTypeId: 'off' },
  ],
  assignments: [{ teamId: 'K', patternId: 'k', offsetStepId: 'k0', anchorDate: '2026-03-01', effectiveFrom: SEEDED_EFFECTIVE_FROM }],
  bands: [
    { id: 'jutro', name: 'Jutro', startMinute: at(6) },
    { id: 'vecer', name: 'Večer', startMinute: at(18) },
  ],
};
const WORKING = ['t1', 't2', 'dan', 'noc'];
const WEEK_ONE = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];
const WEEK_TWO = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'];

const shift = (id: string, date: string, shiftTypeId: string, teamId: string | null = null): PersonalAssignment => ({
  id,
  date,
  kind: PERSONAL_ASSIGNMENT_SHIFT,
  shiftTypeId,
  teamId,
});
const off = (id: string, date: string): PersonalAssignment => ({ id, date, kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null });

const inD = [{ teamId: 'D', position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
const inK = [{ teamId: 'K', position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];

/** D1, D2 and the student as R14.8 plans them; K's three members, k1 off on K's Dan of the 5th. */
function r148Members(): readonly RosterMember[] {
  return [
    {
      id: 'd1',
      memberships: inD,
      statuses: [],
      personalAssignments: [
        ...WEEK_ONE.map((date) => shift(`d1-${date}`, date, 't1')),
        ...WEEK_TWO.map((date) => shift(`d1-${date}`, date, 't2')),
      ],
    },
    {
      id: 'd2',
      memberships: inD,
      statuses: [],
      // R14.8 gives D2 only Wednesday's day off; the rest of week one is D1's, so Monday's group holds both.
      personalAssignments: WEEK_ONE.map((date) => (date === '2026-03-04' ? off(`d2-${date}`, date) : shift(`d2-${date}`, date, 't1'))),
    },
    { id: 'student', memberships: [], statuses: [], personalAssignments: [shift('student-sat', '2026-03-07', 't1')] },
    { id: 'k1', memberships: inK, statuses: [], personalAssignments: [off('k1-dan', '2026-03-05')] },
    { id: 'k2', memberships: inK, statuses: [] },
    { id: 'k3', memberships: inK, statuses: [] },
  ];
}

function r148Shared(members: readonly RosterMember[], rosterOverrides: readonly RosterOverride[] = []) {
  return {
    assignments: R148.assignments,
    steps: R148.steps,
    overrides: [],
    members,
    rosterOverrides,
    workingShiftTypeIds: WORKING,
  };
}

const r148ShiftTypes = R148.types.map((type) => ({ type, versions: R148.versions.filter((version) => version.shiftTypeId === type.id) }));

function r148Hours(members: readonly RosterMember[], memberId: string, rosterOverrides: readonly RosterOverride[] = []): MemberHoursInput {
  const member = members.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    ...r148Shared(members, rosterOverrides),
    bands: R148.bands,
    shiftTypes: r148ShiftTypes,
  };
}

function r148Staffing(
  members: readonly RosterMember[],
  leaveRecords: readonly CollisionLeaveRecord[] = [],
  minimumMembers: number | null = null,
): StaffingInput {
  return { teamIds: ['D', 'K'], ...r148Shared(members), leaveRecords, minimumMembers };
}

function r148Inputs(members: readonly RosterMember[], memberId: string, rosterOverrides: readonly RosterOverride[] = []): ScheduleInputs {
  return {
    organizationId: 'org',
    timeZone: 'Europe/Zagreb',
    memberId,
    teams: [
      { id: 'D', name: 'D', archived: false },
      { id: 'K', name: 'K', archived: false },
    ],
    shiftTypes: r148ShiftTypes,
    steps: R148.steps,
    assignments: R148.assignments,
    assignmentStamps: [{ teamId: 'K', effectiveFrom: SEEDED_EFFECTIVE_FROM, createdAt: 1 }],
    members: members.map((member) => ({ ...member, loans: member.loans ?? [] })),
    overrides: [],
    rosterOverrides: rosterOverrides.map((override) => ({ ...override, writtenAt: 2 })),
    leave: [],
  };
}

/** One member's month as `date type@team marks` lines; a team's empty cell (D has no rotation) is left out. */
function monthLines(input: MemberHoursInput, month = '2026-03'): readonly string[] {
  return memberScheduleOfMonth(input, month).flatMap((day) =>
    day.shifts.filter((one) => one.shiftTypeId !== null).map((one) =>
      [
        day.date,
        `${String(one.shiftTypeId)}@${one.teamId ?? '-'}`,
        one.personalAssignmentId === undefined ? '' : 'personal',
        one.viaOverride ? 'override' : '',
      ]
        .filter((part) => part !== '')
        .join(' '),
    ),
  );
}

describe('R14.8 — the worked example', () => {
  const members = r148Members();

  it("their months carry exactly the shifts planned: D1's two weeks, D2's week less Wednesday, the student's Saturday with no team", () => {
    expect(monthLines(r148Hours(members, 'd1'))).toEqual([
      ...WEEK_ONE.map((date) => `${date} t1@D personal`),
      ...WEEK_TWO.map((date) => `${date} t2@D personal`),
    ]);
    expect(monthLines(r148Hours(members, 'd2'))).toEqual(
      WEEK_ONE.filter((date) => date !== '2026-03-04').map((date) => `${date} t1@D personal`),
    );
    expect(monthLines(r148Hours(members, 'student'))).toEqual(['2026-03-07 t1@- personal']);

    const wednesday = memberScheduleOfMonth(r148Hours(members, 'd2'), '2026-03').find((day) => day.date === '2026-03-04')!;
    expect(wednesday).toEqual({ date: '2026-03-04', active: true, shifts: [], personalAssignment: off('d2-2026-03-04', '2026-03-04') });
  });

  it('a Personal Shift has no projected type, is neither overridden nor changed, and names its assignment', () => {
    const monday = memberScheduleOfMonth(r148Hours(members, 'd1'), '2026-03').find((day) => day.date === '2026-03-02')!;
    expect(monday.shifts).toEqual([
      {
        teamId: 'D',
        shiftTypeId: 't1',
        projectedShiftTypeId: null,
        overridden: false,
        rosterChanged: false,
        viaOverride: false,
        personalAssignmentId: 'd1-2026-03-02',
      },
    ]);
  });

  it('their hours are those shifts, each with the source PERSONAL', () => {
    const hours = memberHoursOfMonth(r148Hours(members, 'd1'), '2026-03');
    expect(hours.shiftCount).toBe(10);
    expect(hours.totalMinutes).toBe(10 * 8 * 60);
    const total = explainMemberHours(r148Hours(members, 'd1'), '2026-03', { code: HOURS_FIGURE_TOTAL });
    expect(total.operands.map((operand) => operand.source)).toEqual(Array<string>(10).fill(HOURS_SOURCE_PERSONAL));
    expect(explainMemberHours(r148Hours(members, 'student'), '2026-03', { code: HOURS_FIGURE_TOTAL }).operands).toEqual([
      { date: '2026-03-07', teamId: null, shiftTypeId: 't1', source: HOURS_SOURCE_PERSONAL, minutes: 480 },
    ]);
  });

  it('their at-work shifts (R12) and reminders carry the same shifts, the teamless one with `teamId: null`', () => {
    expect(atWorkShiftsOf(r148Inputs(members, 'student'), '2026-03-01', '2026-03-31')).toEqual([
      {
        date: '2026-03-07',
        teamId: null,
        shiftTypeId: 't1',
        startMinute: 360,
        endMinute: 840,
        viaOverride: false,
        personalAssignmentId: 'student-sat',
      },
    ]);
    expect(atWorkShiftsOf(r148Inputs(members, 'd1'), '2026-03-01', '2026-03-31').map((one) => `${one.date} ${one.shiftTypeId}`)).toEqual([
      ...WEEK_ONE.map((date) => `${date} t1`),
      ...WEEK_TWO.map((date) => `${date} t2`),
    ]);

    const now = reminderDueAt('H1', '2026-03-07', 360, 'Europe/Zagreb');
    expect(shiftRemindersDueOf(r148Inputs(members, 'student'), ['H1'], { from: '2026-03-07', to: '2026-03-07' }, now)).toEqual([
      expect.objectContaining({ memberId: 'student', date: '2026-03-07', teamId: null, shiftTypeId: 't1', lead: 'H1', start: 360, end: 840 }),
    ]);
  });

  it("D's Monday staffing is one group, 1. smjena, with D1 and D2 at work; Wednesday's has D1 alone", () => {
    const input = r148Staffing(members);
    expect(staffingOn(input, 'D', '2026-03-02')).toEqual([{ shiftTypeId: 't1', atWork: 2 }]);
    expect(staffingOn(input, 'D', '2026-03-04')).toEqual([{ shiftTypeId: 't1', atWork: 1 }]);
    // D has no rotation, so no Scheduled Shift: without a type there is none, with one the group.
    expect(peopleAtWorkOn(input, 'D', '2026-03-02')).toBeNull();
    expect(peopleAtWorkOn(input, 'D', '2026-03-02', 't1')).toEqual({ shiftTypeId: 't1', atWork: 2 });
    expect(peopleAtWorkOn(input, 'D', '2026-03-02', 't2')).toBeNull();
    // The student counts with no team, so joins no team's staffing.
    expect(staffingOn(input, 'D', '2026-03-07')).toEqual([]);
  });

  it("a K member's day off on K's Dan leaves K's roster that date only; K's Scheduled Shift is unchanged and its staffing drops by one", () => {
    const without = members.map((member) => (member.id === 'k1' ? { ...member, personalAssignments: [] } : member));
    expect(shiftRoster(members, 'K', '2026-03-05').map((entry) => entry.memberId)).toEqual(['k2', 'k3']);
    expect(shiftRoster(members, 'K', '2026-03-09').map((entry) => entry.memberId)).toEqual(['k1', 'k2', 'k3']);
    expect(scheduleOfMonth({ teamIds: ['D', 'K'], ...r148Shared(members) }, '2026-03')).toEqual(
      scheduleOfMonth({ teamIds: ['D', 'K'], ...r148Shared(without) }, '2026-03'),
    );
    expect(peopleAtWorkOn(r148Staffing(members), 'K', '2026-03-05')).toEqual({ shiftTypeId: 'dan', atWork: 2 });
    expect(peopleAtWorkOn(r148Staffing(without), 'K', '2026-03-05')).toEqual({ shiftTypeId: 'dan', atWork: 3 });
    expect(monthLines(r148Hours(members, 'k1')).filter((line) => line.startsWith('2026-03-0'))).toEqual([
      '2026-03-01 dan@K',
      '2026-03-02 noc@K',
      '2026-03-03 off@K',
      '2026-03-04 off@K',
      '2026-03-06 noc@K',
      '2026-03-07 off@K',
      '2026-03-08 off@K',
      '2026-03-09 dan@K',
    ]);
  });

  it("a leave over the student's Saturday costs one day and raises one collision with no team", () => {
    const leaveRecords = [{ id: 'leave-student', memberId: 'student', from: '2026-03-07', to: '2026-03-08' }];
    expect(leaveCostOf(r148Hours(members, 'student'), '2026-03-07', '2026-03-08')).toBe(1);
    expect(collisionsOf({ ...r148Shared(members), leaveRecords })).toEqual([
      { memberId: 'student', date: '2026-03-07', teamId: null, shiftTypeId: 't1', leaveRecordId: 'leave-student' },
    ]);
  });
});

describe('R14.2–R14.6 — the matrix', () => {
  const base = r148Members();
  const withAssignments = (memberId: string, assignments: readonly PersonalAssignment[]): readonly RosterMember[] =>
    base.map((member) => (member.id === memberId ? { ...member, personalAssignments: assignments } : member));

  it('a shift naming another team counts with it: in its staffing, and in the month and hours as PERSONAL', () => {
    const members = withAssignments('d2', [shift('d2-k', '2026-03-09', 'dan', 'K')]);
    expect(monthLines(r148Hours(members, 'd2'))).toEqual(['2026-03-09 dan@K personal']);
    expect(peopleAtWorkOn(r148Staffing(members), 'K', '2026-03-09')).toEqual({ shiftTypeId: 'dan', atWork: 4 });
    // K's base roster is unchanged: D2 counts with K and never joins its roster.
    expect(shiftRoster(members, 'K', '2026-03-09').map((entry) => entry.memberId)).toEqual(['k1', 'k2', 'k3']);
  });

  it("a shift naming no team counts with the member's effective team, a loan's included", () => {
    const lent = base.map((member) =>
      member.id === 'k2'
        ? {
            ...member,
            loans: [{ id: 'loan-k2', teamId: 'D', from: '2026-03-14', to: '2026-03-15' }],
            personalAssignments: [shift('k2-t1', '2026-03-14', 't1')],
          }
        : member,
    );
    expect(personalShiftOn(lent.find((member) => member.id === 'k2')!, '2026-03-14', new Set(WORKING), R148.steps)).toEqual({
      personalAssignmentId: 'k2-t1',
      date: '2026-03-14',
      shiftTypeId: 't1',
      teamId: 'D',
    });
    expect(staffingOn(r148Staffing(lent), 'D', '2026-03-14')).toEqual([{ shiftTypeId: 't1', atWork: 1 }]);
  });

  it("a Personal Shift of the Scheduled Shift's type joins it; another type is its own group, after it", () => {
    const members = base.map((member) =>
      member.id === 'd1'
        ? { ...member, personalAssignments: [shift('d1-k-dan', '2026-03-09', 'dan', 'K')] }
        : member.id === 'd2'
          ? { ...member, personalAssignments: [shift('d2-k-t1', '2026-03-09', 't1', 'K')] }
          : member,
    );
    expect(staffingOn(r148Staffing(members), 'K', '2026-03-09')).toEqual([
      { shiftTypeId: 'dan', atWork: 4 },
      { shiftTypeId: 't1', atWork: 1 },
    ]);
    expect(peopleAtWorkOn(r148Staffing(members), 'K', '2026-03-09', 't1')).toEqual({ shiftTypeId: 't1', atWork: 1 });
    // Absence is subtracted from groups too.
    const leave = [{ id: 'leave-d2', memberId: 'd2', from: '2026-03-09', to: '2026-03-09' }];
    expect(staffingOn(r148Staffing(members, leave), 'K', '2026-03-09')).toEqual([
      { shiftTypeId: 'dan', atWork: 4 },
      { shiftTypeId: 't1', atWork: 0 },
    ]);
  });

  it('a group is short-staffed by R10.2, and matched across a change by its date, team and type', () => {
    // K alone: D's own groups are short too, and are not this case.
    const before = { ...r148Staffing(base, [], 2), teamIds: ['K'] };
    const after = { ...r148Staffing(withAssignments('d2', [shift('d2-k-t2', '2026-03-09', 't2', 'K')]), [], 2), teamIds: ['K'] };
    const grouped = { code: 'SHORT_STAFFED', date: '2026-03-09', teamId: 'K', shiftTypeId: 't2', atWork: 1, minimum: 2 };
    expect(shortStaffedShiftsOf(after, '2026-03-09', '2026-03-09')).toEqual([grouped]);
    expect(newlyShortStaffedOf(before, after, '2026-03-01', '2026-03-31')).toEqual([grouped]);
    expect(newlyShortStaffedOf(after, after, '2026-03-01', '2026-03-31')).toEqual([]);
  });

  it("an override putting a member on the team their Personal Shift already counts with is inert (R14.9): one shift, counted once", () => {
    const members = withAssignments('d1', [shift('d1-k', '2026-03-09', 'dan', 'K')]);
    const overrides = [{ id: 'put-d1', teamId: 'K', date: '2026-03-09', memberOutId: null, memberInId: 'd1' }];
    expect(rosterOn(members, overrides, 'K', '2026-03-09').applied).toEqual([]);
    expect(peopleAtWorkOn({ ...r148Staffing(members), rosterOverrides: overrides }, 'K', '2026-03-09')).toEqual({
      shiftTypeId: 'dan',
      atWork: 4,
    });
    expect(monthLines(r148Hours(members, 'd1', overrides))).toEqual(['2026-03-09 dan@K personal']);
    expect(memberHoursOfMonth(r148Hours(members, 'd1', overrides), '2026-03').shiftCount).toBe(1);
    expect(atWorkShiftsOf(r148Inputs(members, 'd1', overrides), '2026-03-09', '2026-03-09')).toHaveLength(1);
    // Counted with K through their effective team (no team named) is the same.
    const viaEffective = base.map((member) =>
      member.id === 'k2' ? { ...member, personalAssignments: [shift('k2-t1', '2026-03-09', 't1')] } : member,
    );
    const putK2 = [{ id: 'put-k2', teamId: 'K', date: '2026-03-09', memberOutId: null, memberInId: 'k2' }];
    expect(rosterOn(viaEffective, putK2, 'K', '2026-03-09').applied).toEqual([]);
  });

  it('a group that becomes the Scheduled Shift of its type across a change is not newly short-staffed', () => {
    // Before: K works Dan, and D2's t1 shift counted with K is a short group. After: a type override makes K work t1.
    const members = withAssignments('d2', [shift('d2-k-t1', '2026-03-09', 't1', 'K')]);
    const quiet = members.map((member) => (member.id.startsWith('k') ? { ...member, statuses: [{ active: false, effectiveFrom: '2026-03-01' }] } : member));
    const before = { ...r148Staffing(quiet, [], 2), teamIds: ['K'] };
    const after = { ...before, overrides: [{ teamId: 'K', date: '2026-03-09', shiftTypeId: 't1' }] };
    expect(shortStaffedShiftsOf(before, '2026-03-09', '2026-03-09').map((one) => one.shiftTypeId)).toEqual(['dan', 't1']);
    expect(shortStaffedShiftsOf(after, '2026-03-09', '2026-03-09').map((one) => one.shiftTypeId)).toEqual(['t1']);
    expect(newlyShortStaffedOf(before, after, '2026-03-09', '2026-03-09')).toEqual([]);
    expect(newlyShortStaffedOf(after, before, '2026-03-09', '2026-03-09')).toEqual([]);
  });

  it('a half-day leave over a Personal Shift keeps its worked half (R12.2), with no team as the shift has none', () => {
    const inputs: ScheduleInputs = {
      ...r148Inputs(base, 'student'),
      leave: [{ id: 'half', from: '2026-03-07', to: '2026-03-07', half: LEAVE_HALF_FIRST, absenceTypeId: 'annual' }],
    };
    expect(atWorkShiftsOf(inputs, '2026-03-07', '2026-03-07')).toEqual([
      {
        date: '2026-03-07',
        teamId: null,
        shiftTypeId: 't1',
        startMinute: 600,
        endMinute: 840,
        viaOverride: false,
        personalAssignmentId: 'student-sat',
        workedHalf: 'SECOND',
      },
    ]);
  });

  it("an override putting an assigned member on another team's shift applies: a double booking, two overlapping legs", () => {
    const overrides = [{ id: 'put-d1', teamId: 'K', date: '2026-03-13', memberOutId: null, memberInId: 'd1' }];
    expect(rosterOn(base, overrides, 'K', '2026-03-13').applied.map((one) => one.id)).toEqual(['put-d1']);
    expect(monthLines(r148Hours(base, 'd1', overrides)).filter((line) => line.startsWith('2026-03-13'))).toEqual([
      '2026-03-13 t2@D personal',
      '2026-03-13 dan@K override',
    ]);
    const legs = atWorkShiftsOf(r148Inputs(base, 'd1', overrides), '2026-03-13', '2026-03-13').map((one) => ({
      date: one.date,
      startMinute: one.startMinute,
      durationMinutes: one.endMinute - one.startMinute,
      teamId: one.teamId,
    }));
    expect(overlappingLegsOf(legs).map(([left, right]) => [left.teamId, right.teamId])).toEqual([['K', 'D']]);
  });

  it('an override taking an assigned member off their own team is inert, and is listed as made inert by the assignment', () => {
    const overrides = [{ id: 'off-k1', teamId: 'K', date: '2026-03-05', memberOutId: 'k1', memberInId: null }];
    expect(rosterOn(base, overrides, 'K', '2026-03-05').applied).toEqual([]);
    const without = base.map((member) => ({ ...member, personalAssignments: [] }));
    const side = (members: readonly RosterMember[]) => ({ teamIds: ['K'], ...r148Shared(members, overrides) });
    expect(rosterOverridesMadeInertOf(side(without), side(base), '2026-03-01', '2026-03-31').map((one) => one.id)).toEqual(['off-k1']);
  });

  it('an assignment on an inactive date, or of a non-working type, is no shift; the member is on no roster', () => {
    const members = base.map((member) =>
      member.id === 'k3'
        ? {
            ...member,
            statuses: [{ active: false, effectiveFrom: '2026-03-20' }],
            personalAssignments: [shift('k3-late', '2026-03-21', 'dan', 'K')],
          }
        : member.id === 'k2'
          ? { ...member, personalAssignments: [shift('k2-off-type', '2026-03-09', 'off')] }
          : member,
    );
    const k3 = memberScheduleOfMonth(r148Hours(members, 'k3'), '2026-03').find((day) => day.date === '2026-03-21')!;
    expect(k3.active).toBe(false);
    expect(k3.shifts).toEqual([]);
    expect(k3.personalAssignment?.id).toBe('k3-late');
    expect(peopleAtWorkOn(r148Staffing(members), 'K', '2026-03-21')).toEqual({ shiftTypeId: 'dan', atWork: 2 });

    const k2 = memberScheduleOfMonth(r148Hours(members, 'k2'), '2026-03').find((day) => day.date === '2026-03-09')!;
    expect(k2.shifts).toEqual([]);
    expect(shiftRoster(members, 'K', '2026-03-09').map((entry) => entry.memberId)).toEqual(['k1', 'k3']);
    expect(leaveCostOf(r148Hours(members, 'k2'), '2026-03-09', '2026-03-09')).toBe(0);
  });

  it('a rotation shift keeps its source ROTATION beside Personal Shifts', () => {
    const operands = explainMemberHours(r148Hours(base, 'k1'), '2026-03', { code: HOURS_FIGURE_TOTAL }).operands;
    expect(new Set(operands.map((operand) => operand.source))).toEqual(new Set([HOURS_SOURCE_ROTATION]));
  });

  it("orders a collision with no team before every team's on its date", () => {
    const members = withAssignments('k2', [shift('k2-none', '2026-03-09', 't1', null)]).map((member) =>
      member.id === 'k2' ? { ...member, memberships: [] } : member,
    );
    const leaveRecords = [
      { id: 'leave-k2', memberId: 'k2', from: '2026-03-09', to: '2026-03-09' },
      { id: 'leave-k3', memberId: 'k3', from: '2026-03-09', to: '2026-03-09' },
    ];
    expect(collisionsOf({ ...r148Shared(members), leaveRecords }).map((one) => [one.memberId, one.teamId])).toEqual([
      ['k2', null],
      ['k3', 'K'],
    ]);
  });

  it('`hasTeam` keeps exactly what counts with a team', () => {
    expect([{ teamId: 'K' }, { teamId: null }].filter(hasTeam)).toEqual([{ teamId: 'K' }]);
  });
});

describe('R14.1 — the assignments are checked', () => {
  const good = shift('a', '2026-03-02', 't1');

  it('accepts one per date, of either kind, and finds the one on a date', () => {
    expect(() => checkPersonalAssignments([good, off('b', '2026-03-03')])).not.toThrow();
    expect(personalAssignmentOn([good], '2026-03-02')).toBe(good);
    expect(personalAssignmentOn([good], '2026-03-03')).toBeNull();
  });

  it.each([
    ['two on one date', [good, off('b', '2026-03-02')], /at most one per date/],
    ['a duplicate id', [good, shift('a', '2026-03-03', 't1')], /two personal assignments have the id/],
    ['a bad date', [shift('a', '2026-02-30', 't1')], /not a calendar date/],
    ['a shift with no type', [{ ...good, shiftTypeId: null }], /names no shift type/],
    ['a day off with a type', [{ ...off('b', '2026-03-03'), shiftTypeId: 't1' }], /day off and names/],
    ['a day off with a team', [{ ...off('b', '2026-03-03'), teamId: 'D' }], /day off and names/],
    ['an unknown kind', [{ ...good, kind: 'MAYBE' as unknown as PersonalAssignment['kind'] }], /neither SHIFT nor OFF/],
    ['an empty id', [{ ...good, id: '' }], /has no id/],
    ['an empty team', [{ ...good, teamId: '' }], /neither a team id nor null/],
    ['an undefined team', [{ ...good, teamId: undefined as unknown as null }], /neither a team id nor null/],
    ['an empty shift type', [{ ...good, shiftTypeId: '' }], /names no shift type/],
  ])('refuses %s, through every derivation that reads them', (_name, assignments: readonly PersonalAssignment[], message: RegExp) => {
    expect(() => checkPersonalAssignments(assignments)).toThrow(message);
    const members = r148Members().map((member) => (member.id === 'd1' ? { ...member, personalAssignments: assignments } : member));
    expect(() => memberScheduleOfMonth(r148Hours(members, 'd1'), '2026-03')).toThrow(RangeError);
    expect(() => shiftRoster(members, 'D', '2026-03-02')).toThrow(RangeError);
  });

  it("reads the member's entry when the input's list is absent, and refuses two different lists", () => {
    const members = r148Members();
    const input = r148Hours(members, 'd1');
    expect(memberScheduleOfMonth({ ...input, personalAssignments: members[0]!.personalAssignments }, '2026-03')).toEqual(
      memberScheduleOfMonth(input, '2026-03'),
    );
    expect(() => memberScheduleOfMonth({ ...input, personalAssignments: [] }, '2026-03')).toThrow(/differ from those of their entry/);
  });

  it('never writes to its input', () => {
    const members = r148Members();
    const copy: unknown = JSON.parse(JSON.stringify(members));
    memberScheduleOfMonth(r148Hours(members, 'd1'), '2026-03');
    staffingOn(r148Staffing(members), 'D', '2026-03-02');
    collisionsOf({ ...r148Shared(members), leaveRecords: [{ id: 'l', memberId: 'd1', from: '2026-03-02', to: '2026-03-03' }] });
    expect(members).toEqual(copy);
  });
});

describe('story 21.2: the parity fixtures carry Personal Assignments, and R12 follows them', () => {
  const [pilot, uj5] = PARITY_FIXTURES;
  const r12Of = (organization: (typeof PARITY_FIXTURES)[number]['organization'], memberId: string, date: string) =>
    atWorkShiftsOf(inputsOf(organization, memberId), date, date);

  it('gives every member a list, as the assembly does', () => {
    for (const { organization } of PARITY_FIXTURES) {
      for (const member of organization.members) expect(Array.isArray(member.personalAssignments), member.id).toBe(true);
    }
  });

  it('a teamless working assignment is a Personal Shift with no team', () => {
    expect(r12Of(pilot!.organization, 'pilot-m4', '2027-03-26')).toEqual([
      {
        date: '2027-03-26',
        teamId: null,
        shiftTypeId: 'pilot-dan',
        viaOverride: false,
        personalAssignmentId: 'pilot-assignment-2',
        startMinute: 420,
        endMinute: 1140,
      },
    ]);
  });

  it('an assignment counted with another team carries that team', () => {
    expect(r12Of(uj5!.organization, 'uj5-m3', '2027-02-10')).toEqual([
      {
        date: '2027-02-10',
        teamId: 'uj5-smjena-a',
        shiftTypeId: 'uj5-popodnevna',
        viaOverride: false,
        personalAssignmentId: 'uj5-assignment-2',
        startMinute: 840,
        endMinute: 1320,
      },
    ]);
  });

  it('a day off, a non-working type and an inactive date are no shift', () => {
    expect(r12Of(pilot!.organization, 'pilot-m2', '2027-01-10')).toEqual([]);
    expect(r12Of(uj5!.organization, 'uj5-m1', '2027-02-11')).toEqual([]);
    expect(r12Of(uj5!.organization, 'uj5-m4', '2027-02-12')).toEqual([]);
  });
});
