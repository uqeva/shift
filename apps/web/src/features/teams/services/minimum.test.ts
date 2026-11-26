import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  staffingAppliesOf,
  teamMinimumsOfCalendar,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import type { CalendarMarks } from '@/features/calendar/utils/month';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import {
  SHORT_STAFFED_KNOWN,
  coverageAgainstMinimumOf,
  shortStaffedReportOf,
  dayWindowOf,
  staffingInputOf,
} from '@/features/staffing/services/short-staffed';
import {
  STAFFING_FIXTURES,
  firstWorkingDayOf,
  leaveRow,
  member,
  staffingSnapshotOf,
} from '@/features/staffing/staffing.fixture';
import {
  TEAM_MINIMUM_INVALID,
  TEAM_MINIMUM_REFUSED,
  TEAM_MINIMUM_STALE,
  TEAM_MINIMUM_UNAVAILABLE,
  TEAM_MINIMUM_UNCHECKED,
  enteredTeamMinimumOf,
  teamMinimumAppliedOf,
  teamMinimumCheckFromReads,
  teamMinimumConfirmedOf,
  teamMinimumMessageKey,
  teamMinimumPreviewShownOf,
  writeTeamMinimum,
  type TeamMinimumCheckReady,
  type TeamMinimumTable,
  type TeamMinimumWriteAnswer,
} from '@/features/teams/services/minimum';
import { shortStaffedCardOf } from '@/features/today/services/admin-today';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 21.20 — a team's own minimum, executed (AD-15) over real snapshots of
 * both fixtures: the snapshot's minimums and the staffing input, the gate
 * every staffing surface reads, the resolution strip's coverage, *Danas*'s
 * calm line, and *Najmanje ljudi*'s parse, check, preview decision and write.
 */

const ONE = '00000000-0000-4000-8000-00000000d001';
const TWO = '00000000-0000-4000-8000-00000000d002';

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `snapshot` with `teamId`'s own minimum set to `minimum` (and, optionally, archived). */
function withTeamMinimum(snapshot: CalendarSnapshot, teamId: string, minimum: number | null, archived?: boolean): CalendarSnapshot {
  return {
    ...snapshot,
    teams: snapshot.teams.map((team) =>
      team.id === teamId ? { ...team, minimumMembers: minimum, ...(archived === undefined ? {} : { archived }) } : team,
    ),
  };
}

function ready(check: ReturnType<typeof teamMinimumCheckFromReads>): TeamMinimumCheckReady {
  if (check.kind !== CHECK_READY) throw new Error(`not ready: ${JSON.stringify(check)}`);

  return check;
}

describe.each(STAFFING_FIXTURES)('$name', (fixture) => {
  let four: CalendarSnapshot;
  let empty: CalendarSnapshot;
  let day: { date: string; shiftTypeId: string };

  beforeAll(async () => {
    four = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    empty = await staffingSnapshotOf(fixture, { size: 4, minimum: null });
    day = firstWorkingDayOf(four, fixture);
  });

  describe("the snapshot's minimums", () => {
    it('reads every team with no minimum of its own, as the database answers a row before any is set', () => {
      expect(four.teams.every((team) => team.minimumMembers === null)).toBe(true);
      expect(teamMinimumsOfCalendar(four)).toBeUndefined();
    });

    it("gives the active teams' own minimums by id, and never an archived team's", () => {
      const own = withTeamMinimum(withTeamMinimum(four, fixture.team, 1), fixture.otherTeam, 5, true);

      expect(teamMinimumsOfCalendar(own)).toEqual({ [fixture.team]: 1 });
    });

    it("applies staffing while the organization's or an active team's own minimum is set", () => {
      expect(staffingAppliesOf(four)).toBe(true);
      expect(staffingAppliesOf(empty)).toBe(false);
      expect(staffingAppliesOf(withTeamMinimum(empty, fixture.team, 2))).toBe(true);
      expect(staffingAppliesOf(withTeamMinimum(empty, fixture.team, 2, true))).toBe(false);
    });

    it('builds a staffing input key for key as before with no team minimum, and carries the ones set', () => {
      const records = [{ id: ONE, memberId: member(1), from: day.date, to: day.date }];

      expect(Object.keys(staffingInputOf(four, records))).not.toContain('teamMinimums');
      expect(staffingInputOf(withTeamMinimum(four, fixture.team, 2), records).teamMinimums).toEqual({ [fixture.team]: 2 });
    });
  });

  describe('every staffing surface holds a team to its own minimum', () => {
    it("the coverage line reads the team's own minimum, and none with neither set", () => {
      const records = [{ id: ONE, memberId: member(1), from: day.date, to: day.date }];

      expect(coverageAgainstMinimumOf(four, records, fixture.team, day.date)).toEqual({ atWork: 3, minimum: 3, short: false });
      expect(coverageAgainstMinimumOf(withTeamMinimum(four, fixture.team, 4), records, fixture.team, day.date)).toEqual({
        atWork: 3,
        minimum: 4,
        short: true,
      });
      // The organization's empty, only this team set: the other team has no line.
      const own = withTeamMinimum(empty, fixture.team, 4);
      expect(coverageAgainstMinimumOf(own, records, fixture.team, day.date)).toMatchObject({ minimum: 4, short: true });
      expect(coverageAgainstMinimumOf(own, records, fixture.otherTeam, day.date)).toBeNull();
    });

    it('a one-person team set to 1 is not flagged where the organization would flag it', () => {
      const records = [
        { id: ONE, memberId: member(1), from: day.date, to: day.date },
        { id: TWO, memberId: member(2), from: day.date, to: day.date },
      ];
      const window = dayWindowOf(day.date);
      const beforeLeave = { calendar: four, records: [] };

      const flagged = shortStaffedReportOf(beforeLeave, { calendar: four, records }, window);
      const quiet = shortStaffedReportOf(
        { calendar: withTeamMinimum(four, fixture.team, 1), records: [] },
        { calendar: withTeamMinimum(four, fixture.team, 1), records },
        window,
      );

      expect(flagged?.kind === SHORT_STAFFED_KNOWN && flagged.rows.map((row) => [row.teamId, row.minimum])).toEqual([[fixture.team, 3]]);
      expect(quiet).toEqual({ kind: SHORT_STAFFED_KNOWN, rows: [], more: 0 });
    });

    it("*Danas*'s calm line names the one minimum every team is held to, and none when they differ", () => {
      const marks = { staffingLeave: [] } as unknown as CalendarMarks;
      const dates = [day.date];

      expect(shortStaffedCardOf(four, marks, dates)?.minimum).toBe(3);
      expect(shortStaffedCardOf(withTeamMinimum(four, fixture.team, 1), marks, dates)?.minimum).toBeNull();
      // Every active team set to the same number names it.
      const same = four.teams.reduce((snapshot, team) => withTeamMinimum(snapshot, team.id, 2), four);
      expect(shortStaffedCardOf(same, marks, dates)?.minimum).toBe(2);
      expect(t('danas.admin.shortStaffed.calmEach')).toBe('Nijedna smjena ovaj tjedan nema manje ljudi od najmanjeg broja svojeg tima.');
    });
  });

  describe('*Najmanje ljudi*: the check', () => {
    const readsOf = (calendar: CalendarSnapshot, records: readonly unknown[] = []): ErasureReads => ({
      calendar,
      records,
      resolutions: [],
    });

    it('refuses a team that is gone or archived as stale, and says an unchanged minimum needs no write', () => {
      expect(teamMinimumAppliedOf(four, { teamId: 'gone', value: 2 })).toEqual({ ok: false, code: TEAM_MINIMUM_STALE });
      expect(teamMinimumAppliedOf(withTeamMinimum(four, fixture.team, null, true), { teamId: fixture.team, value: 2 })).toEqual({
        ok: false,
        code: TEAM_MINIMUM_STALE,
      });
      expect(teamMinimumCheckFromReads(readsOf(four), { teamId: 'gone', value: 2 }, day.date)).toEqual({
        kind: CHECK_REFUSED,
        code: TEAM_MINIMUM_STALE,
      });

      const unchanged = ready(teamMinimumCheckFromReads(readsOf(four), { teamId: fixture.team, value: null }, day.date));
      expect(unchanged.unchanged).toBe(true);
      expect(teamMinimumPreviewShownOf(unchanged)).toBe(false);
    });

    it('a raised minimum that makes a shift short shows *Što se mijenja*, and erases nothing', () => {
      const records = [leaveRow(ONE, member(1), day.date, day.date)];
      const check = ready(teamMinimumCheckFromReads(readsOf(four, records), { teamId: fixture.team, value: 4 }, day.date));

      expect(check.window.from).toBe(day.date);
      expect(check.organizationId).toBe(four.organizationId);
      expect(check.shortStaffed?.kind === SHORT_STAFFED_KNOWN && check.shortStaffed.rows.map((row) => [row.date, row.atWork, row.minimum])).toEqual([
        [day.date, 3, 4],
      ]);
      expect(check.cleared).toEqual({ kind: SHORT_STAFFED_KNOWN, rows: [], more: 0 });
      expect(teamMinimumPreviewShownOf(check)).toBe(true);
    });

    it('a lowered minimum that clears a short shift shows it as cleared', () => {
      const records = [leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)];
      const check = ready(teamMinimumCheckFromReads(readsOf(four, records), { teamId: fixture.team, value: 1 }, day.date));

      expect(check.shortStaffed).toEqual({ kind: SHORT_STAFFED_KNOWN, rows: [], more: 0 });
      expect(check.cleared?.kind === SHORT_STAFFED_KNOWN && check.cleared.rows.map((row) => [row.teamName, row.dayMonth])).toEqual([
        [fixture.teamName, expect.any(String)],
      ]);
      expect(teamMinimumPreviewShownOf(check)).toBe(true);
    });

    it('a shift short before and after (only its minimum moves) is neither listed nor previewed', () => {
      const records = [leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)];
      const check = ready(teamMinimumCheckFromReads(readsOf(four, records), { teamId: fixture.team, value: 4 }, day.date));

      expect(check.shortStaffed).toEqual({ kind: SHORT_STAFFED_KNOWN, rows: [], more: 0 });
      expect(check.cleared).toEqual({ kind: SHORT_STAFFED_KNOWN, rows: [], more: 0 });
      expect(teamMinimumPreviewShownOf(check)).toBe(false);
    });

    it('a change that creates and clears nothing is written at once', () => {
      const check = ready(teamMinimumCheckFromReads(readsOf(four), { teamId: fixture.team, value: 2 }, day.date));

      expect(teamMinimumPreviewShownOf(check)).toBe(false);
    });

    it('clearing the only minimum there is clears its short shifts, and none is newly short', () => {
      const own = withTeamMinimum(empty, fixture.team, 4);
      const records = [leaveRow(ONE, member(1), day.date, day.date)];
      const check = ready(teamMinimumCheckFromReads(readsOf(own, records), { teamId: fixture.team, value: null }, day.date));

      expect(check.shortStaffed).toBeNull();
      expect(check.cleared?.kind === SHORT_STAFFED_KNOWN && check.cleared.rows.length).toBe(1);
    });

    it('a leave read that cannot be trusted answers unavailable: nothing is written unchecked', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      expect(teamMinimumCheckFromReads(readsOf(four, [{ id: 'bad' }]), { teamId: fixture.team, value: 4 }, day.date)).toEqual({
        kind: CHECK_UNAVAILABLE,
      });
    });

    it('*Spremi* writes the preview shown, and shows a changed one again', () => {
      const records = [leaveRow(ONE, member(1), day.date, day.date)];
      const shown = ready(teamMinimumCheckFromReads(readsOf(four, records), { teamId: fixture.team, value: 4 }, day.date));
      const same = ready(teamMinimumCheckFromReads(readsOf(four, records), { teamId: fixture.team, value: 4 }, day.date));
      const moved = ready(
        teamMinimumCheckFromReads(readsOf(four, [...records, leaveRow(TWO, member(2), day.date, day.date)]), { teamId: fixture.team, value: 4 }, day.date),
      );

      expect(teamMinimumConfirmedOf(shown, same)).toBe(true);
      expect(teamMinimumConfirmedOf(shown, moved)).toBe(false);
    });
  });
});

describe('*Najmanje ljudi*: the field and the write', () => {
  it('reads empty as the organization\'s, a whole number from 1 as itself, and refuses anything else', () => {
    expect(enteredTeamMinimumOf('t', '')).toEqual({ ok: true, change: { teamId: 't', value: null } });
    expect(enteredTeamMinimumOf('t', '  ')).toEqual({ ok: true, change: { teamId: 't', value: null } });
    expect(enteredTeamMinimumOf('t', '1')).toEqual({ ok: true, change: { teamId: 't', value: 1 } });
    expect(enteredTeamMinimumOf('t', ' 4 ')).toEqual({ ok: true, change: { teamId: 't', value: 4 } });
    for (const typed of ['0', '-1', '2.5', '1e1', 'dva', '32768']) {
      expect(enteredTeamMinimumOf('t', typed), typed).toEqual({ ok: false, code: TEAM_MINIMUM_INVALID });
    }
  });

  function tableAnswering(answer: TeamMinimumWriteAnswer | Promise<never>): TeamMinimumTable & { readonly calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      update(values) {
        calls.push(['update', values]);

        return {
          eq(column, value) {
            calls.push(['eq', column, value]);

            return {
              eq(tenant: string, organization: string) {
                calls.push(['eq', tenant, organization]);

                return {
                  eq(second: string, live: boolean) {
                    calls.push(['eq', second, live]);

                    return {
                      select(columns: string) {
                        calls.push(['select', columns]);

                        return Promise.resolve(answer);
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it("writes minimum_members of the live team by id, `null` for the organization's", async () => {
    const table = tableAnswering({ data: [{ id: 't' }], error: null });

    expect(await writeTeamMinimum(table, 'org', { teamId: 't', value: null })).toEqual({ ok: true });
    expect(table.calls).toEqual([
      ['update', { minimum_members: null }],
      ['eq', 'id', 't'],
      ['eq', 'organization_id', 'org'],
      ['eq', 'archived', false],
      ['select', 'id'],
    ]);
  });

  it('reads 0082\'s check as the field, 42501 as refused, zero rows as stale and anything else as the service', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const change = { teamId: 't', value: 2 };

    expect(
      await writeTeamMinimum(
        tableAnswering({ data: null, error: { code: '23514', message: 'new row for relation "teams" violates check constraint "teams_minimum_members_check"' } }),
        'org',
        change,
      ),
    ).toEqual({ ok: false, code: TEAM_MINIMUM_INVALID });
    expect(await writeTeamMinimum(tableAnswering({ data: null, error: { code: '23514', message: 'another' } }), 'org', change)).toEqual({
      ok: false,
      code: TEAM_MINIMUM_UNAVAILABLE,
    });
    expect(await writeTeamMinimum(tableAnswering({ data: null, error: { code: '42501' } }), 'org', change)).toEqual({
      ok: false,
      code: TEAM_MINIMUM_REFUSED,
    });
    expect(await writeTeamMinimum(tableAnswering({ data: [], error: null }), 'org', change)).toEqual({ ok: false, code: TEAM_MINIMUM_STALE });
    expect(await writeTeamMinimum(tableAnswering(Promise.reject(new Error('offline'))), 'org', change)).toEqual({
      ok: false,
      code: TEAM_MINIMUM_UNAVAILABLE,
    });
  });

  it('words every failure through hr.json', () => {
    for (const failure of [TEAM_MINIMUM_INVALID, TEAM_MINIMUM_STALE, TEAM_MINIMUM_REFUSED, TEAM_MINIMUM_UNAVAILABLE, TEAM_MINIMUM_UNCHECKED] as const) {
      const key = teamMinimumMessageKey(failure);

      expect(t(key), failure).not.toBe(key);
    }
    expect(t('smjene.minimum.hint', { n: 3 })).toBe('Prazno: vrijedi za organizaciju (3)');
  });
});
