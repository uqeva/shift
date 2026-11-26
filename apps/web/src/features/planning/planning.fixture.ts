import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  holidayRow,
  loansAnswerOf,
  assignmentRow,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  personalAssignmentsAnswerOf,
  rosterOverridesAnswerOf,
  scheduleVersionRow,
  stepRow,
  statusRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * *Ručni raspored*'s test calendar (story 21.4), over the pilot fixture —
 * `[Dan, Noć, Slobodno, Slobodno]` from 2020-01-01 — in October 2026:
 * Smjena A works Dan 08., 12., 16. and Noć 09., 13. ANA is on Smjena A, the
 * viewer (an admin) on Smjena B, DORA on *Dnevni* (a team with no rotation),
 * and IVA, a student, on no team.
 */

export const ANA = '00000000-0000-4000-8000-0000000000a1';
export const DORA = '00000000-0000-4000-8000-0000000000d1';
export const IVA = '00000000-0000-4000-8000-0000000000e1';
export const A = 'pilot-smjena-a';
export const B = 'pilot-smjena-b';
export const C = 'pilot-smjena-c';
export const DAY_TEAM = 'pilot-dnevni';
/** A team with no member, whose rotation a test may start after the month. */
export const LATE_TEAM = 'pilot-kasni';
/** An archived team with no member (story 21.5: a copied assignment counted with it is left out). */
export const ARCHIVED_TEAM = 'pilot-stari';
export const DAN = 'pilot-dan';
export const NOC = 'pilot-noc';
export const SLOBODNO = 'pilot-slobodno';
export const ARCHIVED_TYPE = 'pilot-staro';
export const MONTH = '2026-10';
export const TODAY = '2026-10-01';

export { VIEWER_MEMBER, assignmentRow, calendarOverrideRow, holidayRow, calendarPersonalAssignmentRow, calendarRosterOverrideRow, memberMembershipRow, scheduleVersionRow, statusRow, stepRow };

type Row = Record<string, unknown>;

export interface PlanningSetup {
  readonly assignments?: readonly Row[];
  readonly rosterOverrides?: readonly Row[];
  readonly statuses?: readonly Row[];
  readonly minimumMembers?: number;
  /** More team membership versions (`memberMembershipRow`). */
  readonly memberships?: readonly Row[];
  /** More rotation versions (`assignmentRow`), beside the pilot's. */
  readonly rotations?: readonly Row[];
  /** STORY 21.10: members' schedule versions (`scheduleVersionRow`). */
  readonly scheduleVersions?: readonly Row[];
  /** STORY 21.10: more rotation steps (`stepRow`), beside the pilot's. */
  readonly steps?: readonly Row[];
  /** STORY 21.16: the organization's holidays (`holidayRow`). */
  readonly holidays?: readonly Row[];
  /** STORY 21.16: the ids of the teams off on holidays. */
  readonly offTeams?: readonly string[];
  /** STORY 21.16: live shift-type overrides (`calendarOverrideRow`). */
  readonly overrides?: readonly Row[];
}

/** The calendar as `readCalendar` reads it from the fixture's rows. */
export async function planningSnapshotOf({
  assignments = [],
  rosterOverrides = [],
  statuses = [],
  minimumMembers,
  memberships = [],
  rotations = [],
  scheduleVersions = [],
  steps = [],
  holidays = [],
  offTeams = [],
  overrides = [],
}: PlanningSetup = {}): Promise<CalendarSnapshot> {
  const teams = [...PILOT.teams, teamRow(DAY_TEAM, 'Dnevni'), teamRow(LATE_TEAM, 'Kasni'), teamRow(ARCHIVED_TEAM, 'Stari', { archived: true })];
  const rows = {
    ...PILOT,
    teams: teams.map((team) => ({ ...team, off_on_holidays: offTeams.includes(team['id'] as string) })),
    assignments: [...PILOT.assignments, ...rotations],
    steps: [...PILOT.steps, ...steps],
    types: [...PILOT.types, typeRow(ARCHIVED_TYPE, 'Staro', '2026-09-25T20:07:49.339741+00:00', { archived: true, times: ['08:00:00', '16:00:00'] })],
  };
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(B, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, B, SEEDED),
            memberMembershipRow(ANA, A, SEEDED),
            memberMembershipRow(DORA, DAY_TEAM, SEEDED),
            ...memberships,
          ],
          statuses,
          minimumMembers,
          scheduleVersions,
          holidays,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Anić'),
      calendarMemberRow(DORA, 'Dora Dorić'),
      calendarMemberRow(IVA, 'Iva Ivić', null, { id: 'pilot-role-student', name: 'Student' }),
    ]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
    loansAnswerOf([]),
    personalAssignmentsAnswerOf(assignments),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
export function leaveRowOf(id: string, memberId: string, from: string, toExclusive: string): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}
