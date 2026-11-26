import { createHash } from 'node:crypto';

import {
  HOURS_FIGURE_BAND,
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  LEAVE_HALF_FIRST,
  collisionsOf,
  datesOfMonth,
  explainMemberHours,
  leaveCostOf,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  peopleAtWorkOn,
  rosterOn,
  scheduleOfMonth,
  shortStaffedShiftsOf,
  type CollisionLeaveRecord,
  type HourBand,
  type HoursFigureCode,
  type MemberHoursInput,
  type RosterMember,
  type RosterOverride,
  type RotationAssignment,
  type RotationStep,
  type ShiftType,
  type ShiftTypeOverride,
  type ShiftTypeVersion,
} from '../src/index.js';
import {
  PILOT_HOUR_BANDS,
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_SHIFT_TYPE_VERSIONS,
  PILOT_TEAMS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_HOUR_BANDS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_SHIFT_TYPE_VERSIONS,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * The organization every "absent means byte-identical" guard derives from
 * (stories 21.1 and 21.9): both fixtures, a member per roster path, roster and
 * shift-type overrides, and leave; and every figure the engine derives from
 * it. Moved from `personal.test.ts` unchanged, so its digests still hold.
 */

export interface Fixture {
  readonly name: string;
  readonly bands: readonly HourBand[];
  readonly types: readonly ShiftType[];
  readonly versions: readonly ShiftTypeVersion[];
  readonly teams: readonly { readonly id: string }[];
  readonly steps: readonly RotationStep[];
  readonly assignments: readonly RotationAssignment[];
}

export const FIXTURES: readonly Fixture[] = [
  {
    name: 'pilot',
    bands: PILOT_HOUR_BANDS,
    types: PILOT_SHIFT_TYPES,
    versions: PILOT_SHIFT_TYPE_VERSIONS,
    teams: PILOT_TEAMS,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
  },
  {
    name: 'UJ-5',
    bands: UJ5_HOUR_BANDS,
    types: UJ5_SHIFT_TYPES,
    versions: UJ5_SHIFT_TYPE_VERSIONS,
    teams: UJ5_TEAMS,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
  },
];

export const MONTHS = ['2026-03', '2026-04'] as const;
export const WINDOW = { from: '2026-03-01', to: '2026-04-30' } as const;
export const MINIMUM_MEMBERS = 3;

export const workingOf = (fixture: Fixture): readonly string[] =>
  fixture.types.filter((type) => type.isWorking).map((type) => type.id);

/**
 * An organization on `fixture` exercising every roster path: per team a member
 * with a position, one deactivated mid-window, one who moves to the next team
 * mid-window, one lent to the next team for three days; and one member on no
 * team at all.
 */
export function membersOf(fixture: Fixture): readonly RosterMember[] {
  const { teams } = fixture;
  return [
    ...teams.flatMap((team, index): RosterMember[] => [
      { id: `${team.id}-1`, memberships: [{ teamId: team.id, position: 'voditelj', effectiveFrom: SEEDED_EFFECTIVE_FROM }], statuses: [] },
      {
        id: `${team.id}-2`,
        memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
        statuses: [{ active: false, effectiveFrom: '2026-03-20' }],
      },
      {
        id: `${team.id}-3`,
        memberships: [
          { teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM },
          { teamId: teams[(index + 1) % teams.length]!.id, position: null, effectiveFrom: '2026-04-06' },
        ],
        statuses: [],
      },
      {
        id: `${team.id}-4`,
        memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
        statuses: [],
        loans: [{ id: `loan-${team.id}`, teamId: teams[(index + 1) % teams.length]!.id, from: '2026-04-10', to: '2026-04-12' }],
      },
    ]),
    { id: 'teamless', memberships: [], statuses: [] },
  ];
}

/** On every date of March, the first team's member 1 is replaced by the second team's, and the third team loses member 4. */
export function rosterOverridesOf(fixture: Fixture): readonly RosterOverride[] {
  const [a, b, c] = fixture.teams;
  return datesOfMonth('2026-03').flatMap((date): RosterOverride[] => [
    { id: `swap-${date}`, teamId: a!.id, date, memberOutId: `${a!.id}-1`, memberInId: `${b!.id}-1` },
    { id: `off-${date}`, teamId: c!.id, date, memberOutId: `${c!.id}-4`, memberInId: null },
  ]);
}

export function shiftTypeOverridesOf(fixture: Fixture): readonly ShiftTypeOverride[] {
  const [, b] = fixture.teams;
  const off = fixture.types.find((type) => !type.isWorking)!.id;
  return [
    { teamId: b!.id, date: '2026-03-05', shiftTypeId: off },
    { teamId: b!.id, date: '2026-04-15', shiftTypeId: workingOf(fixture)[0]! },
  ];
}

export function leaveRecordsOf(fixture: Fixture): readonly CollisionLeaveRecord[] {
  const [a, b, c] = fixture.teams;
  return [
    { id: 'leave-a1', memberId: `${a!.id}-1`, from: '2026-03-08', to: '2026-03-14' },
    { id: 'leave-b4', memberId: `${b!.id}-4`, from: '2026-03-25', to: '2026-04-09' },
    { id: 'leave-c3', memberId: `${c!.id}-3`, from: '2026-04-02', to: '2026-04-02', half: LEAVE_HALF_FIRST },
    { id: 'leave-teamless', memberId: 'teamless', from: '2026-03-01', to: '2026-03-03' },
  ];
}

/** The holiday rule's two lists (story 21.15, AD-27), as every schedule input carries them; absent, none. */
export interface HolidayLists {
  readonly holidays?: readonly string[];
  readonly teamsOffOnHolidays?: readonly string[];
}

export interface Organization {
  readonly fixture: Fixture;
  readonly members: readonly RosterMember[];
  /** Spread into every input when given (story 21.15); absent, the inputs are exactly as before. */
  readonly holidays?: HolidayLists;
}

export function shared(organization: Organization) {
  const { fixture, members } = organization;
  return {
    assignments: fixture.assignments,
    steps: fixture.steps,
    overrides: shiftTypeOverridesOf(fixture),
    members,
    rosterOverrides: rosterOverridesOf(fixture),
    workingShiftTypeIds: workingOf(fixture),
    ...organization.holidays,
  };
}

export function hoursInputOf(organization: Organization, member: RosterMember): MemberHoursInput {
  const { fixture } = organization;
  return {
    memberId: member.id,
    memberships: member.memberships,
    statuses: member.statuses,
    ...shared(organization),
    bands: fixture.bands,
    shiftTypes: fixture.types.map((type) => ({ type, versions: fixture.versions.filter((version) => version.shiftTypeId === type.id) })),
  };
}

/** Every figure an hours explanation can be of: the total, each band, and leave. */
export const figuresOf = (fixture: Fixture): readonly HoursFigureCode[] => [
  { code: HOURS_FIGURE_TOTAL },
  ...fixture.bands.map((band) => ({ code: HOURS_FIGURE_BAND, bandId: band.id }) as const),
  { code: HOURS_FIGURE_LEAVE },
];

/** Every figure the engine derives from the schedule, for one organization over the window. */
export function derivedFiguresOf(organization: Organization) {
  const { fixture, members } = organization;
  const teamIds = fixture.teams.map((team) => team.id);
  const leaveRecords = leaveRecordsOf(fixture);
  const scheduleInput = { teamIds, ...shared(organization) };
  const staffingInput = { ...scheduleInput, leaveRecords, minimumMembers: MINIMUM_MEMBERS };
  return {
    schedule: MONTHS.map((month) => scheduleOfMonth(scheduleInput, month)),
    rosters: MONTHS.flatMap((month) =>
      datesOfMonth(month).flatMap((date) => teamIds.map((teamId) => rosterOn(members, rosterOverridesOf(fixture), teamId, date))),
    ),
    members: members.map((member) => {
      const input = hoursInputOf(organization, member);
      return {
        id: member.id,
        schedule: MONTHS.map((month) => memberScheduleOfMonth(input, month)),
        hours: MONTHS.map((month) => memberHoursOfMonth(input, month)),
        explanations: MONTHS.map((month) => figuresOf(fixture).map((figure) => explainMemberHours(input, month, figure))),
        leaveCost: leaveCostOf(input, WINDOW.from, WINDOW.to),
      };
    }),
    collisions: collisionsOf({ ...shared(organization), leaveRecords }),
    staffing: MONTHS.flatMap((month) =>
      datesOfMonth(month).flatMap((date) => teamIds.map((teamId) => peopleAtWorkOn(staffingInput, teamId, date))),
    ),
    shortStaffed: shortStaffedShiftsOf(staffingInput, WINDOW.from, WINDOW.to),
  };
}

export const digestOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
