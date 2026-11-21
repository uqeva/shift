/**
 * THE RUNTIME-PARITY PROBE (story 16.2; AD-7, AD-19 test 2): one JSON of
 * everything a server projection computes, over the parity fixture, for
 * both fixtures — R12 for every member over the parity window, the month
 * schedule and every member's hours of every month of that window, `zone.ts`'s
 * conversions and transitions, every reminder lead's due instant on the
 * transition dates and the reminders due around them (story 17.2), and a
 * WebCrypto SHA-256 of the token vector.
 *
 * The same probe runs twice and the two answers must be byte-identical:
 * `test/runtime-parity.test.ts` runs it under Node over the built `dist`, and
 * CI's `runtime-parity` job runs it under the pinned `edge-runtime`
 * (`deploy/parity/index.ts`, which imports `@shift/domain` through its
 * `deno.json` map onto that same `dist`, as a function does), with no
 * network. That is the 2026-11-21 spike made permanent.
 *
 * IT IMPORTS NOTHING AT RUN TIME: the domain, the fixture and WebCrypto are
 * handed in, so the one file loads unchanged under both runtimes. The type
 * import below is erased; it names `src/` for the type checker only.
 */

import type * as Domain from '../src/index.js';
import type * as Fixtures from './fixtures.js';

/** The fixture module's shape, as both runtimes import it. */
type ParityFixtures = typeof Fixtures;

/** As much of WebCrypto's `SubtleCrypto` as the probe uses. */
export interface ParityDigest {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

/** Hex of a digest. */
function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Local minutes probed on each transition date: midnight, the gap and the overlap, and a night shift's end. */
const PROBED_MINUTES = [0, 59, 60, 119, 120, 150, 179, 180, 1439, 1440 + 420];

/** The four transition dates of Europe/Zagreb in 2026 and 2027. */
const TRANSITION_DATES = ['2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31'];

/** Worked start minutes probed for every lead: midnight, the gap, the morning, the evening, and a night's second half. */
const REMINDER_MINUTES = [0, 120, 150, 180, 360, 420, 1140, 1320, 1500];

/** The clocks the selection is probed at (UTC date and minute), each with its window, the date either side. */
const REMINDER_CLOCKS = [
  { date: '2026-03-29', utcMinute: 120, from: '2026-03-28', to: '2026-03-30' },
  { date: '2026-03-28', utcMinute: 1140, from: '2026-03-27', to: '2026-03-29' },
  { date: '2026-10-25', utcMinute: 180, from: '2026-10-24', to: '2026-10-26' },
  { date: '2026-10-25', utcMinute: 1020, from: '2026-10-24', to: '2026-10-26' },
  { date: '2027-03-27', utcMinute: 1140, from: '2027-03-26', to: '2027-03-28' },
  { date: '2027-10-31', utcMinute: 0, from: '2027-10-30', to: '2027-11-01' },
];

/**
 * The probe's JSON, as one string. Throws whatever the domain throws: a
 * breached precondition is a failed probe on either runtime.
 */
export async function runtimeParityProbe(
  domain: typeof Domain,
  fixtures: ParityFixtures,
  subtle: ParityDigest,
): Promise<string> {
  const { PARITY_FIXTURES, PARITY_MONTHS, PARITY_WINDOW, PARITY_VECTOR, inputsOf } = fixtures;

  const organizations = PARITY_FIXTURES.map(({ fixture, organization, bands }) => {
    const working = organization.shiftTypes.filter((entry) => entry.type.isWorking).map((entry) => entry.type.id);
    const shared = {
      assignments: organization.assignments,
      steps: organization.steps,
      overrides: domain.overrideStandingOf(organization.assignmentStamps, organization.overrides).inForce,
      members: organization.members,
      rosterOverrides: domain.overrideStandingOf(organization.assignmentStamps, organization.rosterOverrides).inForce,
      workingShiftTypeIds: working,
    };

    const schedules = PARITY_MONTHS.map((month) => ({
      month,
      rows: domain.scheduleOfMonth({ ...shared, teamIds: organization.teams.map((team) => team.id) }, month),
    }));

    const members = organization.members.map((member) => {
      const inputs: Domain.ScheduleInputs = inputsOf(organization, member.id);
      const halfDays = inputs.leave.flatMap((record) => (record.half === undefined ? [] : [{ date: record.from, half: record.half }]));
      const hours = PARITY_MONTHS.map((month) => ({
        month,
        hours: domain.memberHoursOfMonth(
          {
            ...shared,
            memberId: member.id,
            memberships: member.memberships,
            statuses: member.statuses,
            loans: member.loans,
            bands,
            shiftTypes: organization.shiftTypes,
            halfDays,
          },
          month,
        ),
      }));
      return {
        memberId: member.id,
        atWork: domain.atWorkShiftsOf(inputs, PARITY_WINDOW.from, PARITY_WINDOW.to),
        hours,
      };
    });

    const transitions = domain.zoneTransitionsOf(organization.timeZone, PARITY_WINDOW.from, PARITY_WINDOW.to);
    return { fixture, schedules, members, transitions };
  });

  const zones = ['Europe/Zagreb', 'Australia/Sydney', 'UTC'].map((zone) => {
    const transitions = domain.zoneTransitionsOf(zone, '2026-01-01', '2027-12-31');
    const dates = ['2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31', '2026-04-05', '2026-10-04'];
    return {
      zone,
      transitions: transitions.map((transition) => ({ ...transition, iso: domain.utcIsoOf(transition.instant) })),
      instants: dates.map((date) => ({
        date,
        minutes: PROBED_MINUTES.map((minute) => {
          const instant = domain.instantOf(date, minute, zone);
          return { minute, instant, iso: domain.utcIsoOf(instant), offset: domain.offsetMinutesAt(instant, zone) };
        }),
      })),
    };
  });

  // Story 17.2 (AD-6): every lead's due instant on both transition dates of
  // both years, and the reminders due around them for every member of both
  // fixtures, at six clocks on or the day before each of the four transitions.
  const reminders = {
    dueAt: ['Europe/Zagreb', 'Australia/Sydney', 'UTC'].map((zone) => ({
      zone,
      dates: TRANSITION_DATES.map((date) => ({
        date,
        minutes: REMINDER_MINUTES.map((minute) => ({
          minute,
          leads: domain.REMINDER_LEADS.map((lead) => {
            const instant = domain.reminderDueAt(lead, date, minute, zone);
            return { lead, instant, iso: domain.utcIsoOf(instant) };
          }),
        })),
      })),
    })),
    due: PARITY_FIXTURES.map(({ fixture, organization }) => ({
      fixture,
      clocks: REMINDER_CLOCKS.map(({ date, utcMinute, from, to }) => {
        // The clock as an instant through the domain itself: UTC has no transition.
        const now = domain.instantOf(date, utcMinute, 'UTC');
        return {
          iso: domain.utcIsoOf(now),
          members: organization.members.map((member) => ({
            memberId: member.id,
            reminders: domain.shiftRemindersDueOf(inputsOf(organization, member.id), domain.REMINDER_LEADS, { from, to }, now),
          })),
        };
      }),
    })),
  };

  const tokenHash = hexOf(await subtle.digest('SHA-256', new TextEncoder().encode(PARITY_VECTOR)));

  return JSON.stringify({ organizations, zones, reminders, token: { vector: PARITY_VECTOR, sha256: tokenHash } });
}
