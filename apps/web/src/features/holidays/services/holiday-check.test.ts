import type { NationalHolidayCode } from '@shift/domain';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarMonthOf } from '@/features/calendar/utils/month';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import {
  ASK_ADD,
  ASK_FLAG,
  ASK_IMPORT,
  ASK_REMOVE,
  CHANGE_ADD,
  CHANGE_FLAG,
  CHANGE_REMOVE,
  CONFIRM_ERASURES,
  CONFIRM_SHOW_AGAIN,
  CONFIRM_WRITE,
  HOLIDAY_NOTHING_NEW,
  HOLIDAY_NO_IMPORT,
  HOLIDAY_STALE,
  TEAM_GAINED,
  TEAM_LOST,
  holidayChangeAppliedOf,
  holidayCheckFromReads,
  holidayCheckOf,
  holidayConfirmStepOf,
  holidayShortStaffedOf,
  holidayPreviewKeyOf,
  offTeamLossesOf,
  touchedMemberIdsOf,
  type HolidayAsk,
  type HolidayCheck,
  type HolidayCheckReady,
} from '@/features/holidays/services/holiday-check';
import { HOLIDAY_TAKEN, nationalHolidayMessageKey } from '@/features/holidays/services/holidays';
import {
  A,
  ANA,
  B,
  C,
  DORA,
  IVA,
  MONTH,
  TODAY,
  VIEWER_MEMBER,
  calendarLoanRow,
  calendarRosterOverrideRow,
  holidayRow,
  leaveRowOf,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import { manualPreviewOf } from '@/features/planning/services/manual-preview';
import { SHORT_STAFFED_UNKNOWN, configurationReportOf } from '@/features/staffing/services/short-staffed';
import { initLocalization, t } from '@/lib/i18n';

/**
 * STORY 21.17 — THE AD-5 CHECK OF A HOLIDAY WRITE, over *Ručni raspored*'s
 * test calendar (October 2026, today the 1st; Smjena A works Dan on the 8th
 * with ANA on it; Smjena B, the viewer's, works Noć that date). Each case is a
 * row of the spec's I/O matrix: D is Smjena A, off on holidays; H is the 8th.
 */

const H = '2026-10-08';
const nameOf = (code: NationalHolidayCode): string => t(nationalHolidayMessageKey(code));

let plain: CalendarSnapshot;
let offA: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf({ minimumMembers: 1 });
  offA = await planningSnapshotOf({ minimumMembers: 1, offTeams: [A] });
});

function readyOf(check: HolidayCheck): HolidayCheckReady {
  if (check.kind !== CHECK_READY) throw new Error(`not ready: ${JSON.stringify(check)}`);

  return check;
}

function checkOf(calendar: CalendarSnapshot, ask: HolidayAsk, records: readonly unknown[] = []): HolidayCheck {
  return holidayCheckFromReads({ calendar, records, resolutions: [] }, ask, TODAY, nameOf);
}

describe('the import', () => {
  it('a fresh year: the preview lists 14 rows and the change adds all 14', () => {
    const check = readyOf(checkOf(plain, { kind: ASK_IMPORT, year: 2027 }));

    expect(check.proposal?.rows).toHaveLength(14);
    expect(check.change).toMatchObject({ kind: CHANGE_ADD, year: 2027 });
    expect(check.change.kind === CHANGE_ADD ? check.change.holidays : []).toHaveLength(14);
    expect(check.change.kind === CHANGE_ADD ? check.change.holidays[0] : null).toEqual({ date: '2027-01-01', name: 'Nova godina' });
    expect(check.past).toEqual([]);
    // No team is off on holidays: no shift changes, and nothing is erased.
    expect(check.teams).toEqual([]);
    expect(check.rows).toEqual([]);
    expect(check.preview.members).toEqual([]);
    expect(check.window).toEqual({ from: '2027-01-01', to: '2027-12-26' });
  });

  it('again, all stored and one renamed: nothing new is offered', async () => {
    const rows = readyOf(checkOf(plain, { kind: ASK_IMPORT, year: 2027 })).proposal?.rows ?? [];
    const calendar = await planningSnapshotOf({
      holidays: rows.map((row, index) => holidayRow(`h-${String(index)}`, row.date, index === 3 ? 'Preimenovano' : row.name)),
    });

    expect(checkOf(calendar, { kind: ASK_IMPORT, year: 2027 })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_NOTHING_NEW });
    expect(calendar.holidays[3]?.name).toBe('Preimenovano');
  });

  it('partial: 3 of 14 stored are marked, and the change sends the 11 missing', async () => {
    const calendar = await planningSnapshotOf({
      holidays: [holidayRow('h-1', '2027-01-01', 'Novo ljeto'), holidayRow('h-2', '2027-05-01'), holidayRow('h-3', '2027-11-01')],
    });
    const check = readyOf(checkOf(calendar, { kind: ASK_IMPORT, year: 2027 }));

    expect(check.proposal?.rows.filter((row) => row.stored !== null).map((row) => [row.date, row.stored?.name])).toEqual([
      ['2027-01-01', 'Novo ljeto'],
      ['2027-05-01', 'Blagdan'],
      ['2027-11-01', 'Blagdan'],
    ]);
    const added = check.change.kind === CHANGE_ADD ? check.change.holidays.map((holiday) => holiday.date) : [];
    expect(added).toHaveLength(11);
    expect(added).not.toContain('2027-01-01');
  });

  it('before 2020: refused, nothing to send', () => {
    expect(checkOf(plain, { kind: ASK_IMPORT, year: 2019 })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_NO_IMPORT });
  });
});

describe('a holiday added by hand', () => {
  it('on a taken date: refused before any write', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', H)] });

    expect(checkOf(calendar, { kind: ASK_ADD, date: H, name: 'Drugi' })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_TAKEN });
    expect(holidayChangeAppliedOf(calendar, { kind: CHANGE_ADD, holidays: [{ date: H, name: 'Drugi' }], year: null })).toEqual({
      ok: false,
      code: HOLIDAY_TAKEN,
    });
  });

  it('on a past date: warned, and the change still goes', () => {
    const check = readyOf(checkOf(plain, { kind: ASK_ADD, date: '2026-09-15', name: 'Prošli' }));

    expect(check.past).toEqual(['2026-09-15']);
    expect(check.change).toEqual({ kind: CHANGE_ADD, holidays: [{ date: '2026-09-15', name: 'Prošli' }], year: null });
  });

  it("erasure: D off, ANA's unresolved conflict on D's shift on the new holiday is listed", () => {
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f101', ANA, H, '2026-10-09')];
    const check = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }, leave));

    expect(check.rows.map((row) => [row.memberId, row.date, row.teamId, row.teamWorks])).toEqual([[ANA, H, A, false]]);
    // The same leave with no team off erases nothing.
    expect(readyOf(checkOf(plain, { kind: ASK_ADD, date: H, name: 'Blagdan' }, leave)).rows).toEqual([]);
  });

  it('the off team loses its shift: D, H, Dan; and ANA loses it in Što se mijenja', () => {
    const check = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }));

    expect(check.teams.map((line) => [line.side, line.team, line.date, line.type])).toEqual([[TEAM_LOST, 'Smjena A', H, 'Dan']]);
    expect(check.window).toEqual({ from: H, to: H });
    const ana = check.preview.members.find((member) => member.memberId === ANA);
    expect(ana?.shifts).toContainEqual(expect.objectContaining({ side: 'lost', date: H, type: 'Dan', team: 'Smjena A' }));
  });

  it('a holiday notifies nobody: the change is the rows to write, and nothing else', () => {
    const check = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }));

    expect(Object.keys(check.change).sort()).toEqual(['holidays', 'kind', 'year']);
  });
});

describe('a holiday removed', () => {
  it('gives the off team its shift back', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', H)], offTeams: [A] });
    const check = readyOf(checkOf(calendar, { kind: ASK_REMOVE, id: 'h-1', date: H, name: 'Blagdan' }));

    expect(check.change).toEqual({ kind: CHANGE_REMOVE, id: 'h-1', date: H, name: 'Blagdan' });
    expect(check.teams.map((line) => [line.side, line.team, line.type])).toEqual([[TEAM_GAINED, 'Smjena A', 'Dan']]);
  });

  it('removed elsewhere: stale, nothing to write', () => {
    expect(checkOf(plain, { kind: ASK_REMOVE, id: 'h-gone', date: H, name: 'Blagdan' })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_STALE });
  });
});

describe("a team's flag", () => {
  it("on: C's lost shifts on every holiday are listed, and the change sets the flag", async () => {
    // Every date of the month C works: each a holiday.
    const month = calendarMonthOf(plain, { mjesec: MONTH }, TODAY);
    const column = month.columns.findIndex((team) => team.id === C);
    const worked = month.rows.filter((row) => row.cells[column]?.shiftTypeId !== null).map((row) => row.date).slice(0, 2);

    expect(worked).toHaveLength(2);
    const calendar = await planningSnapshotOf({ holidays: worked.map((date, index) => holidayRow(`h-${String(index)}`, date)) });
    const check = readyOf(checkOf(calendar, { kind: ASK_FLAG, teamId: C, value: true }));

    expect(check.change).toEqual({ kind: CHANGE_FLAG, teamId: C, value: true });
    expect(check.teams.length).toBeGreaterThan(0);
    expect(check.teams.every((line) => line.side === TEAM_LOST && line.teamId === C && worked.includes(line.date))).toBe(true);
    expect(check.window).toEqual({ from: worked[0], to: worked[1] });
  });

  it('with no holiday: nothing changes, nothing is derived', () => {
    const check = readyOf(checkOf(plain, { kind: ASK_FLAG, teamId: B, value: true }));

    expect(check.window).toBeNull();
    expect(check.teams).toEqual([]);
    expect(check.rows).toEqual([]);
  });

  it('already in the asked state, or archived, or gone: stale', () => {
    expect(checkOf(offA, { kind: ASK_FLAG, teamId: A, value: true })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_STALE });
    expect(checkOf(plain, { kind: ASK_FLAG, teamId: 'pilot-stari', value: true })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_STALE });
    expect(checkOf(plain, { kind: ASK_FLAG, teamId: 'no-team', value: true })).toEqual({ kind: CHECK_REFUSED, code: HOLIDAY_STALE });
  });

  it('off: the shifts come back', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', H)], offTeams: [A] });
    const check = readyOf(checkOf(calendar, { kind: ASK_FLAG, teamId: A, value: false }));

    expect(check.teams.map((line) => [line.side, line.team, line.date])).toEqual([[TEAM_GAINED, 'Smjena A', H]]);
  });
});

describe('the check as run', () => {
  it('offline or a failed read: unavailable; and the key changes with what is shown', async () => {
    const read = () => Promise.resolve({ calendar: offA, records: [], resolutions: [] });
    const now = new Date('2026-10-01T10:00:00Z');

    expect(await holidayCheckOf(read, { kind: ASK_ADD, date: H, name: 'Blagdan' }, now, false, nameOf)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await holidayCheckOf(() => Promise.reject(new Error('down')), { kind: ASK_ADD, date: H, name: 'Blagdan' }, now, true, nameOf)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });

    const first = readyOf(await holidayCheckOf(read, { kind: ASK_ADD, date: H, name: 'Blagdan' }, now, true, nameOf));
    const other = readyOf(await holidayCheckOf(read, { kind: ASK_ADD, date: '2026-10-09', name: 'Blagdan' }, now, true, nameOf));

    expect(holidayPreviewKeyOf(first)).toBe(holidayPreviewKeyOf(readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }))));
    expect(holidayPreviewKeyOf(first)).not.toBe(holidayPreviewKeyOf(other));
  });

  it('the teams lines ask nothing of a team that works the holiday', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', H)], offTeams: [A] });

    expect(offTeamLossesOf(plain, calendar, [H]).map((line) => line.teamId)).toEqual([A]);
    expect(offTeamLossesOf(plain, plain, [H])).toEqual([]);
    expect(offTeamLossesOf(plain, calendar, [])).toEqual([]);
  });
});

/** Every working shift `team` has on each of `dates` in `of`, read off the month grid (an independent path). */
function gridWorkingOf(of: CalendarSnapshot, teamId: string, dates: readonly string[]): readonly (readonly [string, string, string])[] {
  const working = new Map(of.types.filter((type) => type.isWorking).map((type) => [type.id, type.name]));
  const teamName = of.teams.find((team) => team.id === teamId)?.name ?? '';

  return [...dates].sort().flatMap((date) => {
    const month = calendarMonthOf(of, { mjesec: date.slice(0, 7) }, TODAY);
    const column = month.columns.findIndex((team) => team.id === teamId);
    const type = month.rows.find((row) => row.date === date)?.cells[column]?.shiftTypeId ?? null;
    const name = type === null ? undefined : working.get(type);

    return name === undefined ? [] : [[teamName, date, name] as const];
  });
}

function sidesOf(check: HolidayCheckReady): readonly (readonly [string, string, string, string])[] {
  return check.teams.map((line) => [line.side, line.team, line.date, line.type] as const);
}

describe('the members Što se mijenja is derived for', () => {
  it('says exactly what every member would, with a stand-in from another team and a member on loan into the off team', async () => {
    const calendar = await planningSnapshotOf({
      minimumMembers: 1,
      holidays: [holidayRow('h-1', H), holidayRow('h-2', '2026-10-09')],
      // The viewer (Smjena B) stands in for ANA on Smjena A's shift of the holiday.
      rosterOverrides: [calendarRosterOverrideRow('ro-1', A, H, ANA, VIEWER_MEMBER)],
      // DORA (the day team) is lent to Smjena A over both holidays.
      loans: [calendarLoanRow('l-1', DORA, A, H, '2026-10-09')],
    });
    const applied = holidayChangeAppliedOf(calendar, { kind: CHANGE_FLAG, teamId: A, value: true });

    if (!applied.ok) throw new Error('not applied');

    const window = { from: H, to: '2026-10-09' };
    const touched = touchedMemberIdsOf(calendar, applied.after, [H, '2026-10-09']);

    expect(touched).toEqual(expect.arrayContaining([ANA, DORA, VIEWER_MEMBER]));
    expect(touched).not.toContain(IVA);
    expect(manualPreviewOf(calendar, applied.after, touched, window, [])).toEqual(
      manualPreviewOf(calendar, applied.after, calendar.members.map((member) => member.id), window, []),
    );
    expect(touchedMemberIdsOf(plain, plain, [H])).toEqual([]);
  });
});

describe('the off teams lines, exactly', () => {
  it('a change spanning two months lists every lost shift of the off team, by date', async () => {
    const dates = [H, '2026-10-20', '2026-11-05', '2026-11-18'];
    const calendar = await planningSnapshotOf({ holidays: dates.map((date, index) => holidayRow(`h-${String(index)}`, date)) });
    const check = readyOf(checkOf(calendar, { kind: ASK_FLAG, teamId: A, value: true }));
    const expected = gridWorkingOf(plain, A, dates).map(([team, date, type]) => [TEAM_LOST, team, date, type] as const);

    expect(expected.length).toBeGreaterThan(0);
    expect(new Set(expected.map(([, , date]) => date.slice(0, 7)))).toEqual(new Set(['2026-10', '2026-11']));
    expect(sidesOf(check)).toEqual(expected);
  });

  it('with no team off on holidays: none, and the check says no team is off', () => {
    const check = readyOf(checkOf(plain, { kind: ASK_IMPORT, year: 2027 }));

    expect(check.offTeams).toBe(0);
    expect(check.teams).toEqual([]);
    expect(readyOf(checkOf(offA, { kind: ASK_IMPORT, year: 2027 })).offTeams).toBe(1);
  });
});

describe('a flag over many years of holidays', () => {
  it(
    'previews only the holidays from today on, exactly per year, and says how many past ones it leaves out',
    async () => {
      const dates = [2026, 2027].flatMap((year) => readyOf(checkOf(plain, { kind: ASK_IMPORT, year })).proposal?.rows.map((row) => row.date) ?? []);
      const calendar = await planningSnapshotOf({ holidays: dates.map((date, index) => holidayRow(`h-${String(index)}`, date)) });
      const started = performance.now();
      const check = readyOf(checkOf(calendar, { kind: ASK_FLAG, teamId: A, value: true }));
      const elapsed = performance.now() - started;
      const ahead = dates.filter((date) => date >= TODAY);

      expect(check.dates).toEqual(dates);
      expect(check.pastNotPreviewed).toBe(dates.length - ahead.length);
      expect(check.window).toEqual({ from: ahead[0], to: ahead.at(-1) });
      for (const year of ['2026', '2027']) {
        const ofYear = ahead.filter((date) => date.startsWith(year));

        expect(
          sidesOf(check).filter(([, , date]) => date.startsWith(year)),
          year,
        ).toEqual(gridWorkingOf(plain, A, ofYear).map(([team, date, type]) => [TEAM_LOST, team, date, type] as const));
      }
      // Two years of holidays for the fixture's members: well inside a second on a developer machine.
      expect(elapsed).toBeLessThan(5000);
    },
    20000,
  );

  it('every holiday past: the preview covers none, the erasures still count, and the warning says the past ones change', async () => {
    const calendar = await planningSnapshotOf({ holidays: [holidayRow('h-1', '2026-09-15')] });
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f102', ANA, '2026-09-15', '2026-09-16')];
    const check = readyOf(checkOf(calendar, { kind: ASK_FLAG, teamId: A, value: true }, leave));
    const worked = gridWorkingOf(plain, A, ['2026-09-15']).length > 0;

    expect(check.window).toBeNull();
    expect(check.teams).toEqual([]);
    expect(check.preview).toEqual({ members: [], inert: [] });
    expect(check.past).toEqual(['2026-09-15']);
    expect(check.pastNotPreviewed).toBe(1);
    expect(check.rows.map((row) => row.date)).toEqual(worked ? ['2026-09-15'] : []);
  });
});

describe('the short-staffed block', () => {
  it("is the configuration report over the change's window", async () => {
    const calendar = await planningSnapshotOf({ minimumMembers: 1, offTeams: [A] });
    const check = readyOf(checkOf(calendar, { kind: ASK_ADD, date: H, name: 'Blagdan' }));
    const applied = holidayChangeAppliedOf(calendar, check.change);

    if (!applied.ok) throw new Error('not applied');
    expect(check.shortStaffed).toEqual(
      configurationReportOf(calendar, applied.after, { from: H, to: H }, { isPending: false, isError: false, data: [] }),
    );
    expect(check.shortStaffed).not.toBeNull();
  });

  it('falls back to the neutral line when it cannot be derived', async () => {
    const calendar = await planningSnapshotOf({ minimumMembers: 1, offTeams: [A] });
    // Two holidays on one date: the domain's rule refuses it with a RangeError.
    const broken = { ...calendar, holidays: [{ id: 'x', date: H, name: 'a' }, { id: 'y', date: H, name: 'b' }] };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(holidayShortStaffedOf(calendar, broken, { from: H, to: H }, [])).toEqual({ kind: SHORT_STAFFED_UNKNOWN });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('the add and the import, at the edges', () => {
  it('refuses two holidays on one date inside one add', () => {
    expect(
      holidayChangeAppliedOf(plain, { kind: CHANGE_ADD, holidays: [{ date: H, name: 'a' }, { date: H, name: 'b' }], year: null }),
    ).toEqual({ ok: false, code: HOLIDAY_TAKEN });
  });

  it('a year where Corpus Christi meets a fixed holiday imports 13', () => {
    const check = readyOf(checkOf(plain, { kind: ASK_IMPORT, year: 2024 }));

    expect(check.proposal?.rows).toHaveLength(13);
    expect(check.change.kind === CHANGE_ADD ? check.change.holidays : []).toHaveLength(13);
  });

  it("writes to the fresh reads' own organization", () => {
    expect(readyOf(checkOf(plain, { kind: ASK_ADD, date: H, name: 'Blagdan' })).organizationId).toBe(plain.organizationId);
  });
});

describe("Što se mijenja's Spremi", () => {
  it('shows a changed preview again, waits for erasures, or writes', () => {
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f101', ANA, H, '2026-10-09')];
    const plainCheck = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }));
    const erasing = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }, leave));
    const other = readyOf(checkOf(offA, { kind: ASK_ADD, date: '2026-10-09', name: 'Blagdan' }));

    expect(holidayConfirmStepOf(plainCheck, plainCheck)).toBe(CONFIRM_WRITE);
    expect(holidayConfirmStepOf(erasing, erasing)).toBe(CONFIRM_ERASURES);
    expect(holidayConfirmStepOf(plainCheck, other)).toBe(CONFIRM_SHOW_AGAIN);
    // An erasure that appeared since the preview was shown changes it: shown again first.
    expect(holidayConfirmStepOf(plainCheck, erasing)).toBe(CONFIRM_SHOW_AGAIN);
  });

  it("the preview's key holds the erasures and the window", () => {
    const shown = readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }));

    expect(holidayPreviewKeyOf({ ...shown, window: { from: H, to: '2026-10-09' } })).not.toBe(holidayPreviewKeyOf(shown));
    expect(holidayPreviewKeyOf({ ...shown, rows: [{ ...(readyOf(checkOf(offA, { kind: ASK_ADD, date: H, name: 'Blagdan' }, [leaveRowOf('00000000-0000-4000-8000-00000000f101', ANA, H, '2026-10-09')])).rows[0] as ErasureRow) }] })).not.toBe(
      holidayPreviewKeyOf(shown),
    );
  });
});
