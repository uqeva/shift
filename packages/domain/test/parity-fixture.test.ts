import { describe, expect, it } from 'vitest';

import { scheduledShiftTypeOn, type ScheduleInputs } from '../src/index.js';
import { PARITY_FIXTURES, PARITY_MONTHS, PARITY_WINDOW, PARITY_VECTOR, inputsOf } from '../parity/fixtures.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPE_VERSIONS,
  PILOT_SHIFT_TYPES,
  PILOT_TEAMS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPE_VERSIONS,
  UJ5_SHIFT_TYPES,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * The parity fixture (story 16.2) imports nothing, so it is held here to the
 * fixtures every other rule is asserted against (AD-15), and typed as the
 * assembly it stands for.
 */

const [pilot, uj5] = PARITY_FIXTURES;
if (pilot === undefined || uj5 === undefined) throw new Error('the parity fixture lost a fixture');

describe('the parity fixture', () => {
  it('is an assembly for every member of both fixtures', () => {
    for (const { organization } of PARITY_FIXTURES) {
      for (const member of organization.members) {
        const inputs: ScheduleInputs = inputsOf(organization, member.id);
        expect(inputs.memberId).toBe(member.id);
      }
    }
  });

  it('holds the pilot\'s configuration exactly', () => {
    expect(pilot.organization.teams.map(({ id, name }) => ({ id, name }))).toEqual(PILOT_TEAMS);
    expect(pilot.organization.shiftTypes.map((entry) => entry.type)).toEqual(PILOT_SHIFT_TYPES);
    expect(pilot.organization.shiftTypes.flatMap((entry) => entry.versions)).toEqual(PILOT_SHIFT_TYPE_VERSIONS);
    // Story 21.10: the team rotation's steps, and beside them only the steps of a pattern no team uses
    // and some member's schedule version names (the assembly carries every step).
    const pilotTeamPatterns = new Set(pilot.organization.assignments.map((one) => one.patternId));
    expect(pilot.organization.steps.filter((step) => pilotTeamPatterns.has(step.patternId))).toEqual(PILOT_ROTATION_STEPS);
    const pilotVersionPatterns = new Set(pilot.organization.members.flatMap((member) => member.scheduleVersions.map((one) => one.patternId)));
    for (const step of pilot.organization.steps.filter((one) => !pilotTeamPatterns.has(one.patternId))) {
      expect(pilotVersionPatterns.has(step.patternId), step.id).toBe(true);
    }
    expect(pilot.organization.assignments).toEqual(PILOT_ROTATION_ASSIGNMENTS);
  });

  it('holds UJ-5\'s configuration exactly', () => {
    expect(uj5.organization.teams.map(({ id, name }) => ({ id, name }))).toEqual(UJ5_TEAMS);
    expect(uj5.organization.shiftTypes.map((entry) => entry.type)).toEqual(UJ5_SHIFT_TYPES);
    expect(uj5.organization.shiftTypes.flatMap((entry) => entry.versions)).toEqual(UJ5_SHIFT_TYPE_VERSIONS);
    // Story 21.10: the team rotation's steps, and beside them only the steps of a pattern no team uses
    // and some member's schedule version names (the assembly carries every step).
    const uj5TeamPatterns = new Set(uj5.organization.assignments.map((one) => one.patternId));
    expect(uj5.organization.steps.filter((step) => uj5TeamPatterns.has(step.patternId))).toEqual(UJ5_ROTATION_STEPS);
    const uj5VersionPatterns = new Set(uj5.organization.members.flatMap((member) => member.scheduleVersions.map((one) => one.patternId)));
    for (const step of uj5.organization.steps.filter((one) => !uj5TeamPatterns.has(one.patternId))) {
      expect(uj5VersionPatterns.has(step.patternId), step.id).toBe(true);
    }
    expect(uj5.organization.assignments).toEqual(UJ5_ROTATION_ASSIGNMENTS);
  });

  it('puts every exception kind into the scene (AD-19)', () => {
    const all = PARITY_FIXTURES.map((fixture) => fixture.organization);
    const leave = all.flatMap((organization) => organization.members.flatMap((member) => inputsOf(organization, member.id).leave));

    expect(all.flatMap((organization) => organization.members.flatMap((member) => member.loans)).length).toBeGreaterThan(0);
    expect(all.flatMap((organization) => organization.overrides).length).toBeGreaterThan(0);
    expect(all.flatMap((organization) => organization.rosterOverrides).length).toBeGreaterThan(0);
    expect(leave.some((record) => record.half === undefined)).toBe(true);
    expect(leave.some((record) => record.half !== undefined)).toBe(true);
    // Story 21.10: a schedule version of each source, and a personal rotation with and without a team.
    const versions = all.flatMap((organization) => organization.members.flatMap((member) => member.scheduleVersions));
    expect(new Set(versions.map((one) => one.source))).toEqual(new Set(['TEAM', 'PERSONAL', 'MANUAL']));
    const personal = all.flatMap((organization) =>
      organization.members.filter((member) => member.scheduleVersions.some((one) => one.source === 'PERSONAL')),
    );
    expect(personal.some((member) => member.memberships.length === 0)).toBe(true);
    expect(personal.some((member) => member.memberships.length > 0)).toBe(true);
  });

  it('holds, in each fixture, a team off on holidays and a holiday that team would work (story 21.16, AD-19)', () => {
    for (const { fixture, organization } of PARITY_FIXTURES) {
      const teamIds = new Set(organization.teams.map((team) => team.id));
      // By date and by id, each once, as the assembly carries them; inside the parity window.
      expect(organization.holidays, fixture).toEqual([...new Set(organization.holidays)].sort());
      expect(organization.teamsOffOnHolidays, fixture).toEqual([...new Set(organization.teamsOffOnHolidays)].sort());
      expect(organization.holidays.every((date) => date >= PARITY_WINDOW.from && date <= PARITY_WINDOW.to)).toBe(true);
      expect(organization.teamsOffOnHolidays.length, fixture).toBeGreaterThan(0);
      expect(organization.teamsOffOnHolidays.every((id) => teamIds.has(id))).toBe(true);
      // A team works its projection on a holiday when that team is not off; with the rule, the off team works nothing.
      const worked = organization.holidays.some((date) =>
        organization.teamsOffOnHolidays.some((teamId) => {
          const versions = organization.assignments.filter((one) => one.teamId === teamId);
          const plain = scheduledShiftTypeOn(versions, organization.steps, [], teamId, date);
          const working = organization.shiftTypes.find((entry) => entry.type.id === plain?.shiftTypeId)?.type.isWorking === true;
          const ruled = scheduledShiftTypeOn(versions, organization.steps, [], teamId, date, organization);
          return working && ruled?.shiftTypeId === null && ruled.projectedShiftTypeId === plain?.shiftTypeId;
        }),
      );
      expect(worked, fixture).toBe(true);
      // And a holiday some team not off works, so the rule is seen to keep a working team's shift.
      const kept = organization.holidays.some((date) =>
        organization.teams
          .filter((team) => !organization.teamsOffOnHolidays.includes(team.id))
          .some((team) => {
            const versions = organization.assignments.filter((one) => one.teamId === team.id);
            const ruled = scheduledShiftTypeOn(versions, organization.steps, [], team.id, date, organization);
            return organization.shiftTypes.find((entry) => entry.type.id === ruled?.shiftTypeId)?.type.isWorking === true;
          }),
      );
      expect(kept, fixture).toBe(true);
    }
    // The two rows a holiday never empties: an override on the pilot's off team's holiday (R13.3), and a
    // Personal Assignment on UJ-5's off team's holiday (R14.4).
    const [pilotOrganization, uj5Organization] = PARITY_FIXTURES.map((one) => one.organization);
    expect(
      pilotOrganization!.overrides.some(
        (one) => pilotOrganization!.teamsOffOnHolidays.includes(one.teamId) && pilotOrganization!.holidays.includes(one.date),
      ),
    ).toBe(true);
    const assignedOnHoliday = uj5Organization!.members.flatMap((member) =>
      member.personalAssignments.filter((one) => uj5Organization!.holidays.includes(one.date)).map(() => member.memberships.at(-1)?.teamId),
    );
    expect(assignedOnHoliday.some((teamId) => teamId !== undefined && uj5Organization!.teamsOffOnHolidays.includes(teamId))).toBe(true);
  });

  it('spans both transitions of both years', () => {
    expect(PARITY_WINDOW.from <= '2026-03-29' && PARITY_WINDOW.to >= '2027-10-31').toBe(true);
    // Every month of the window, so the schedule and the hours cover every date of it.
    expect(PARITY_MONTHS).toHaveLength(20);
    expect(PARITY_MONTHS[0]).toBe(PARITY_WINDOW.from.slice(0, 7));
    expect(PARITY_MONTHS.at(-1)).toBe(PARITY_WINDOW.to.slice(0, 7));
    expect(PARITY_MONTHS).toEqual(expect.arrayContaining(['2026-03', '2026-10', '2026-12', '2027-01', '2027-03', '2027-10']));
    expect(new Set(PARITY_MONTHS).size).toBe(20);
  });

  it('holds a canonical 43-character token as its vector', () => {
    expect(PARITY_VECTOR).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
  });
});
