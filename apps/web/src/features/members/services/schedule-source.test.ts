import { memberScheduleOfMonth } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import { dayDetailOf, rosterOffersOf } from '@/features/calendar/utils/day-detail';
import { calendarMonthOf } from '@/features/calendar/utils/month';
import { replacementCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { CHECK_READY, CHECK_REFUSED } from '@/features/conflicts/services/erasure-check';
import {
  CHANGE_CANCEL,
  CHANGE_SET,
  DRAFT_PATTERN_ID,
  EMPTY_SCHEDULE_DRAFT,
  NEW_PATTERN,
  SOURCE_ARCHIVED,
  SOURCE_BAD_ROW,
  SOURCE_NO_PATTERN,
  SOURCE_PAST,
  SOURCE_SCHEDULED,
  SOURCE_STALE,
  SOURCE_TAKEN,
  SOURCE_TOO_LONG,
  SOURCE_UNCHANGED,
  SOURCE_UNCHOSEN,
  SOURCE_WRITE_ARCHIVED,
  SOURCE_WRITE_FAILED,
  SOURCE_WRITE_REFUSED,
  SOURCE_WRITE_TAKEN,
  patternOptionsOf,
  resolvedVersionOf,
  runsOf,
  scheduleChangeAppliedOf,
  scheduleSourceCheckFromReads,
  scheduleSourceFactsOf,
  scheduleSourceMessageKey,
  scheduleSourceRefusalMessageKey,
  scheduleSourceRefusalOf,
  scheduleSourceWriteFailureOf,
  draftWithRow,
  writeScheduleChange,
  type ScheduleSourceDraft,
  type ScheduleSourceTables,
} from '@/features/members/services/schedule-source';
import {
  A,
  ANA,
  ARCHIVED_TYPE,
  DAN,
  DAY_TEAM,
  DORA,
  IVA,
  NOC,
  SLOBODNO,
  TODAY,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  leaveRowOf,
  planningSnapshotOf,
  scheduleVersionRow,
  stepRow,
} from '@/features/planning/planning.fixture';
import { SOURCE_MANUAL, SOURCE_PERSONAL, SOURCE_TEAM, manualMonthOf, NO_DRAFT } from '@/features/planning/services/manual-grid';
import { initLocalization, t } from '@/lib/i18n';

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const draftOf = (draft: Partial<ScheduleSourceDraft>): ScheduleSourceDraft => ({ ...EMPTY_SCHEDULE_DRAFT, ...draft });

/** The pilot's own pattern, `[Dan, Noć, Slobodno, Slobodno]`. */
const PILOT_PATTERN = 'pilot-rotation';

/** One member's working shifts of October 2026 as `date type@team` lines. */
function octoberOf(calendar: CalendarSnapshot, memberId: string): readonly string[] {
  const member = calendar.members.find((one) => one.id === memberId)!;
  const input = memberScheduleInputOf(calendar, { memberId, memberships: member.memberships, statuses: member.statuses });

  return memberScheduleOfMonth(input, '2026-10').flatMap((day) =>
    day.shifts
      .filter((shift) => shift.shiftTypeId === DAN || shift.shiftTypeId === NOC)
      .map((shift) => `${day.date} ${String(shift.shiftTypeId)}@${String(shift.teamId)}${shift.personalRotation === true ? ' p' : ''}`),
  );
}

describe('the patterns a member may stand on', () => {
  it('offers each distinct step sequence once, its runs, and never one with an archived type', async () => {
    const calendar = await planningSnapshotOf({
      steps: [
        // The same sequence as the pilot's: offered once, as the team's own.
        stepRow('copy-0', 'copy', 0, DAN),
        stepRow('copy-1', 'copy', 1, NOC),
        stepRow('copy-2', 'copy', 2, SLOBODNO),
        stepRow('copy-3', 'copy', 3, SLOBODNO),
        // A pattern with an archived type: never offered.
        stepRow('old-0', 'old', 0, ARCHIVED_TYPE),
        // Mornings, five on, two off.
        ...[DAN, DAN, DAN, DAN, DAN, SLOBODNO, SLOBODNO].map((type, position) => stepRow(`morning-${String(position)}`, 'morning', position, type)),
      ],
    });
    const options = patternOptionsOf(calendar);

    expect(options.map((option) => option.patternId)).toEqual([PILOT_PATTERN, 'morning']);
    expect(options[1]?.runs).toEqual([
      { shiftTypeId: DAN, count: 5 },
      { shiftTypeId: SLOBODNO, count: 2 },
    ]);
    expect(runsOf([])).toEqual([]);
  });
});

describe('the refusals before anything is sent (0079 insert policy)', () => {
  it('refuses no date, a past date, a repeat of the source in force, and a scheduled or later version', async () => {
    expect(scheduleSourceRefusalOf(plain, ANA, draftOf({ source: 'MANUAL' }), TODAY)).toBe(SOURCE_UNCHOSEN);
    expect(scheduleSourceRefusalOf(plain, ANA, draftOf({ source: 'MANUAL', effectiveFrom: '2026-09-30' }), TODAY)).toBe(SOURCE_PAST);
    // No version is team rotation (R15.2): TEAM over none repeats it.
    expect(scheduleSourceRefusalOf(plain, ANA, draftOf({ source: 'TEAM', effectiveFrom: TODAY }), TODAY)).toBe(SOURCE_UNCHANGED);
    expect(scheduleSourceRefusalOf(plain, ANA, draftOf({ source: 'MANUAL', effectiveFrom: TODAY }), TODAY)).toBeNull();
    expect(scheduleSourceRefusalOf(plain, 'nobody', draftOf({ source: 'MANUAL', effectiveFrom: TODAY }), TODAY)).toBe(SOURCE_STALE);

    const scheduled = await planningSnapshotOf({ scheduleVersions: [scheduleVersionRow(ANA, '2026-10-20', 'MANUAL')] });
    expect(scheduleSourceRefusalOf(scheduled, ANA, draftOf({ source: 'TEAM', effectiveFrom: '2026-10-25' }), TODAY)).toBe(SOURCE_SCHEDULED);

    const inForce = await planningSnapshotOf({ scheduleVersions: [scheduleVersionRow(ANA, TODAY, 'MANUAL')] });
    expect(scheduleSourceRefusalOf(inForce, ANA, draftOf({ source: 'TEAM', effectiveFrom: TODAY }), TODAY)).toBe(SOURCE_TAKEN);
    expect(scheduleSourceRefusalOf(inForce, ANA, draftOf({ source: 'MANUAL', effectiveFrom: '2026-10-05' }), TODAY)).toBe(SOURCE_UNCHANGED);
    expect(scheduleSourceRefusalOf(inForce, ANA, draftOf({ source: 'TEAM', effectiveFrom: '2026-10-05' }), TODAY)).toBeNull();
  });

  it('refuses a personal rotation with no pattern, a bad row, a long or archived pattern, and a start outside it', () => {
    const personal = (draft: Partial<ScheduleSourceDraft>) =>
      scheduleSourceRefusalOf(plain, IVA, draftOf({ source: 'PERSONAL', effectiveFrom: TODAY, ...draft }), TODAY);

    expect(personal({ patternId: null })).toBe(SOURCE_NO_PATTERN);
    expect(personal({ patternId: 'gone' })).toBe(SOURCE_STALE);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: '', count: '1' }] })).toBe(SOURCE_BAD_ROW);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: '0' }] })).toBe(SOURCE_BAD_ROW);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: 'x' }] })).toBe(SOURCE_BAD_ROW);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: ARCHIVED_TYPE, count: '1' }] })).toBe(SOURCE_ARCHIVED);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: '57' }] })).toBe(SOURCE_TOO_LONG);
    expect(personal({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: '56' }] })).toBeNull();
    expect(personal({ patternId: PILOT_PATTERN, startStep: 4 })).toBe('badStart');
    expect(personal({ patternId: PILOT_PATTERN, startStep: 3 })).toBeNull();
  });
});

describe('what a draft writes', () => {
  it('names an offered pattern and its step, and reuses one for an equal new sequence', () => {
    const offered = resolvedVersionOf(plain, draftOf({ source: 'PERSONAL', effectiveFrom: TODAY, patternId: PILOT_PATTERN, startStep: 1 }));
    expect(offered).toEqual({
      version: { effectiveFrom: TODAY, source: 'PERSONAL', patternId: PILOT_PATTERN, offsetStepId: 'pilot-step-1' },
      newPattern: null,
      startStep: 1,
    });
    const equal = resolvedVersionOf(
      plain,
      draftOf({
        source: 'PERSONAL',
        effectiveFrom: TODAY,
        patternId: NEW_PATTERN,
        rows: [
          { shiftTypeId: DAN, count: '1' },
          { shiftTypeId: NOC, count: '1' },
          { shiftTypeId: SLOBODNO, count: '2' },
        ],
        startStep: 2,
      }),
    );
    expect(equal.newPattern).toBeNull();
    expect(equal.version.offsetStepId).toBe('pilot-step-2');
  });

  it('writes a new sequence first, under synthetic ids the check projects', () => {
    const resolved = resolvedVersionOf(
      plain,
      draftOf({ source: 'PERSONAL', effectiveFrom: TODAY, patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: '2' }, { shiftTypeId: SLOBODNO, count: '1' }], startStep: 1 }),
    );
    expect(resolved.newPattern).toEqual([DAN, DAN, SLOBODNO]);
    expect(resolved.version.patternId).toBe(DRAFT_PATTERN_ID);

    // The student (no team) works the new pattern from step 2: Dan, off, Dan, Dan, off …, counted with no team.
    const after = scheduleChangeAppliedOf(plain, { kind: CHANGE_SET, memberId: IVA, resolved });
    expect(octoberOf(after, IVA).slice(0, 4)).toEqual(['2026-10-01 pilot-dan@null p', '2026-10-03 pilot-dan@null p', '2026-10-04 pilot-dan@null p', '2026-10-06 pilot-dan@null p']);
    expect(octoberOf(plain, IVA)).toEqual([]);
  });
});

describe('the check over fresh reads (AD-5 as amended)', () => {
  it("personal from today: the student's gained shifts in Što se mijenja, no erasure", () => {
    const check = scheduleSourceCheckFromReads(
      { calendar: plain, records: [], resolutions: [] },
      { kind: CHANGE_SET, memberId: IVA, draft: draftOf({ source: 'PERSONAL', effectiveFrom: TODAY, patternId: PILOT_PATTERN, startStep: 0 }) },
      TODAY,
    );

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.rows).toEqual([]);
    expect(check.window).toEqual({ from: TODAY, to: '2027-10-01' });
    expect(check.preview.members.map((member) => member.memberId)).toEqual([IVA]);
    expect(check.preview.members[0]?.shifts[0]).toMatchObject({ side: 'gained', date: TODAY, team: null, type: 'Dan' });
  });

  it('manual only from a future date: the crew member loses their rotation shifts from it, and a leave over one is erased', () => {
    const check = scheduleSourceCheckFromReads(
      { calendar: plain, records: [leaveRowOf('00000000-0000-4000-8000-00000000f101', ANA, '2026-10-08', '2026-10-09')], resolutions: [] },
      { kind: CHANGE_SET, memberId: ANA, draft: draftOf({ source: 'MANUAL', effectiveFrom: '2026-10-05' }) },
      TODAY,
    );

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.rows.map((row) => row.date)).toEqual(['2026-10-08']);
    const lost = check.preview.members[0]?.shifts ?? [];
    expect(lost.every((line) => line.side === 'lost' && line.date >= '2026-10-05')).toBe(true);
    expect(lost).toContainEqual(expect.objectContaining({ date: '2026-10-08', type: 'Dan', team: 'Smjena A' }));
    expect(lost).toContainEqual(expect.objectContaining({ date: '2026-10-09', type: 'Noć', team: 'Smjena A' }));
  });

  it('lists a roster override the personal rotation makes inert (R15.8), and refuses a stale ask', async () => {
    const calendar = await planningSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-1', A, '2026-10-12', ANA, null)],
    });
    const check = scheduleSourceCheckFromReads(
      { calendar, records: [], resolutions: [] },
      { kind: CHANGE_SET, memberId: ANA, draft: draftOf({ source: 'PERSONAL', effectiveFrom: '2026-10-05', patternId: PILOT_PATTERN, startStep: 0 }) },
      TODAY,
    );

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.preview.inert.map((line) => [line.key, line.date])).toEqual([['ro-1', '2026-10-12']]);

    expect(
      scheduleSourceCheckFromReads(
        { calendar, records: [], resolutions: [] },
        { kind: CHANGE_SET, memberId: ANA, draft: draftOf({ source: 'TEAM', effectiveFrom: TODAY }) },
        TODAY,
      ),
    ).toEqual({ kind: CHECK_REFUSED, code: SOURCE_UNCHANGED });
  });

  it('cancels only the latest version while it is ahead, and checks what it restores', async () => {
    const calendar = await planningSnapshotOf({ scheduleVersions: [scheduleVersionRow(ANA, '2026-10-20', 'MANUAL')] });
    const reads = { calendar, records: [], resolutions: [] };
    const check = scheduleSourceCheckFromReads(reads, { kind: CHANGE_CANCEL, memberId: ANA, effectiveFrom: '2026-10-20' }, TODAY);

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.change).toEqual({ kind: CHANGE_CANCEL, memberId: ANA, effectiveFrom: '2026-10-20' });
    expect(check.preview.members[0]?.shifts.every((line) => line.side === 'gained')).toBe(true);
    // In force already (today is its date), or not the latest: refused.
    expect(scheduleSourceCheckFromReads(reads, { kind: CHANGE_CANCEL, memberId: ANA, effectiveFrom: '2026-10-20' }, '2026-10-20')).toEqual({
      kind: CHECK_REFUSED,
      code: SOURCE_STALE,
    });
    expect(scheduleSourceCheckFromReads(reads, { kind: CHANGE_CANCEL, memberId: ANA, effectiveFrom: '2026-10-21' }, TODAY)).toEqual({
      kind: CHECK_REFUSED,
      code: SOURCE_STALE,
    });
  });
});

describe('the card facts', () => {
  it("says today's source and the scheduled one, a personal rotation with its runs and start", async () => {
    const calendar = await planningSnapshotOf({
      scheduleVersions: [scheduleVersionRow(ANA, '2026-09-01', 'PERSONAL', PILOT_PATTERN, 'pilot-step-2'), scheduleVersionRow(ANA, '2026-11-01', 'MANUAL')],
    });

    expect(scheduleSourceFactsOf(calendar, ANA, TODAY)).toEqual({
      current: {
        source: 'PERSONAL',
        effectiveFrom: '2026-09-01',
        runs: [
          { shiftTypeId: DAN, count: 1 },
          { shiftTypeId: NOC, count: 1 },
          { shiftTypeId: SLOBODNO, count: 2 },
        ],
        startStep: 3,
      },
      scheduled: { source: 'MANUAL', effectiveFrom: '2026-11-01', runs: null, startStep: null },
    });
    expect(scheduleSourceFactsOf(plain, IVA, TODAY)).toEqual({
      current: { source: 'TEAM', effectiveFrom: null, runs: null, startStep: null },
      scheduled: null,
    });
    expect(scheduleSourceFactsOf(plain, 'nobody', TODAY)).toBeNull();
  });
});

describe('the readers that follow a schedule source', () => {
  it("names a grid row's source from scheduleSourceOn (UX-DR73)", async () => {
    const calendar = await planningSnapshotOf({
      scheduleVersions: [scheduleVersionRow(ANA, '2026-09-01', 'PERSONAL', PILOT_PATTERN, 'pilot-step-0'), scheduleVersionRow(IVA, '2026-09-01', 'MANUAL')],
    });
    const rows = manualMonthOf(calendar, '2026-10', TODAY, NO_DRAFT).rows;
    const sourceOf = (memberId: string) => rows.find((row) => row.memberId === memberId)?.source;

    expect(sourceOf(ANA)).toBe(SOURCE_PERSONAL);
    expect(sourceOf(IVA)).toBe(SOURCE_MANUAL);
    expect(manualMonthOf(plain, '2026-10', TODAY, NO_DRAFT).rows.find((row) => row.memberId === ANA)?.source).toBe(SOURCE_TEAM);
    // A personal rotation's cells are the rotation's (muted, the rotation glyph), not assignments.
    const anaRow = rows.find((row) => row.memberId === ANA);
    expect(anaRow?.cells.find((cell) => cell.date === '2026-10-03')?.source).toBe('rotation');
  });

  it("puts a personal rotation's member on the team's Sastav as `osobna rotacija`, never offered a roster change (R15.8)", async () => {
    // [Dan, Noć, Slobodno, Slobodno] from step 4 on 09-01: Dan on 10-08, as Smjena A's own Dan.
    const calendar = await planningSnapshotOf({
      scheduleVersions: [scheduleVersionRow(ANA, '2026-09-01', 'PERSONAL', PILOT_PATTERN, 'pilot-step-3')],
    });
    const detail = dayDetailOf(calendar, A, '2026-10-08');
    const ana = detail?.roster.find((member) => member.id === ANA);

    expect(ana?.personalRotation).toBe(true);
    expect(ana?.assigned).toBeUndefined();
    const offers = rosterOffersOf(calendar, detail);
    expect(offers.out.map((one) => one.id)).not.toContain(ANA);
    expect(offers.in.map((one) => one.id)).not.toContain(ANA);
    // Without the version she is the rotation's, and may be taken off.
    expect(rosterOffersOf(plain, dayDetailOf(plain, A, '2026-10-08')).out.map((one) => one.id)).toContain(ANA);
  });

  it("never offers a personal-rotation member to put on their counted team's shift on their own day off, unless an assignment holds the date (R15.8)", async () => {
    // From step 2 on 09-01: 10-08 is Slobodno for Ana, a Dan of Smjena A's own rotation.
    const version = scheduleVersionRow(ANA, '2026-09-01', 'PERSONAL', PILOT_PATTERN, 'pilot-step-1');
    const calendar = await planningSnapshotOf({ scheduleVersions: [version] });
    const inOf = (snapshot: CalendarSnapshot) => rosterOffersOf(snapshot, dayDetailOf(snapshot, A, '2026-10-08')).in.map((one) => one.id);

    expect(dayDetailOf(calendar, A, '2026-10-08')?.roster.map((member) => member.id)).not.toContain(ANA);
    expect(inOf(calendar)).not.toContain(ANA);
    // An assignment (a day off) holds the date: the override applies (the domain's countsWithOn), so she is offered.
    const assigned = await planningSnapshotOf({
      scheduleVersions: [version],
      assignments: [calendarPersonalAssignmentRow('pa-ana-off', ANA, '2026-10-08', 'OFF')],
    });
    expect(inOf(assigned)).toContain(ANA);
  });

  it("draws a personal rotation's staffing group in its counted team's cell on a date with no assignment", async () => {
    // Dora on *Dnevni* (no rotation) works Dan from step 1 on 10-03, and nothing before her version.
    const calendar = await planningSnapshotOf({
      scheduleVersions: [scheduleVersionRow(DORA, '2026-10-03', 'PERSONAL', PILOT_PATTERN, 'pilot-step-0')],
    });
    const month = calendarMonthOf(calendar, { mjesec: '2026-10' }, TODAY);
    const column = month.columns.findIndex((team) => team.id === DAY_TEAM);
    const cellOn = (date: string) => month.rows.find((one) => one.date === date)?.cells[column];

    expect(cellOn('2026-10-03')?.groups?.map((group) => group.shiftTypeId)).toEqual([DAN]);
    expect(cellOn('2026-10-04')?.groups?.map((group) => group.shiftTypeId)).toEqual([NOC]);
    expect(cellOn('2026-10-02')).not.toHaveProperty('groups');
    expect(cellOn('2026-10-05')).not.toHaveProperty('groups');
  });

  it('keeps the start step while a row edit keeps the pattern\'s length, and resets it otherwise', () => {
    const draft = draftOf({ patternId: NEW_PATTERN, rows: [{ shiftTypeId: DAN, count: '2' }, { shiftTypeId: SLOBODNO, count: '1' }], startStep: 2 });

    expect(draftWithRow(draft, 0, { shiftTypeId: NOC }).startStep).toBe(2);
    expect(draftWithRow(draft, 0, { count: '2' }).startStep).toBe(2);
    expect(draftWithRow(draft, 0, { count: '3' })).toMatchObject({ startStep: 0, rows: [{ shiftTypeId: DAN, count: '3' }, { shiftTypeId: SLOBODNO, count: '1' }] });
  });

  it('never offers a member whose own rotation counts with the team as a replacement (R15.8)', async () => {
    const calendar = await planningSnapshotOf({
      scheduleVersions: [scheduleVersionRow(ANA, '2026-09-01', 'PERSONAL', PILOT_PATTERN, 'pilot-step-2')],
    });
    const offered = (snapshot: CalendarSnapshot) =>
      replacementCandidatesOf(snapshot, [], A, '2026-10-08', DAN).flatMap((group) => group.candidates.map((candidate) => candidate.id));

    expect(offered(calendar)).not.toContain(ANA);
  });
});

describe('the writes', () => {
  interface Call {
    readonly table: string;
    readonly verb: string;
    readonly args: readonly unknown[];
  }

  /** Stub tables answering each call in turn from `answers` by table. */
  function tablesOf(answers: Record<string, unknown[]>): { tables: ScheduleSourceTables; calls: Call[] } {
    const calls: Call[] = [];
    const tableOf = (table: string) => {
      const next = () => Promise.resolve(answers[table]?.shift() ?? { data: null, error: { code: 'XX000' } });
      const filtering = (args: unknown[]): unknown => ({
        eq: (...more: unknown[]) => filtering([...args, ...more]),
        select: () => {
          calls.push({ table, verb: 'delete', args });
          const answer = next();
          return Object.assign(answer, { abortSignal: () => answer });
        },
      });

      return {
        insert: (values: unknown) => ({
          select: () => {
            calls.push({ table, verb: 'insert', args: [values] });
            return next();
          },
        }),
        delete: () => filtering([]),
      };
    };

    return {
      tables: { patterns: tableOf('patterns'), steps: tableOf('steps'), versions: tableOf('versions') } as unknown as ScheduleSourceTables,
      calls,
    };
  }

  const NEW = resolvedVersionOfNew();

  function resolvedVersionOfNew() {
    return {
      version: { effectiveFrom: TODAY, source: 'PERSONAL' as const, patternId: DRAFT_PATTERN_ID, offsetStepId: 'draft-step-1' },
      newPattern: [DAN, SLOBODNO],
      startStep: 1,
    };
  }

  it('writes a new pattern, its steps, then the version naming the stored step', async () => {
    const { tables, calls } = tablesOf({
      patterns: [{ data: [{ id: 'p-new' }], error: null }],
      steps: [{ data: [{ id: 's-1', position: 1 }, { id: 's-0', position: 0 }], error: null }],
      versions: [{ data: [{ id: 'v-1' }], error: null }],
    });

    expect(await writeScheduleChange(tables, 'org', { kind: CHANGE_SET, memberId: IVA, resolved: NEW })).toEqual({ ok: true });
    expect(calls.map((call) => `${call.table}:${call.verb}`)).toEqual(['patterns:insert', 'steps:insert', 'versions:insert']);
    expect(calls[2]?.args[0]).toEqual({
      organization_id: 'org',
      member_id: IVA,
      effective_from: TODAY,
      source: 'PERSONAL',
      pattern_id: 'p-new',
      offset_step_id: 's-1',
    });
  });

  it('removes the new pattern after a definite refusal of the version, and names the refusal', async () => {
    const { tables, calls } = tablesOf({
      patterns: [{ data: [{ id: 'p-new' }], error: null }, { data: [{ id: 'p-new' }], error: null }],
      steps: [{ data: [{ id: 's-0', position: 0 }, { id: 's-1', position: 1 }], error: null }, { data: [], error: null }],
      versions: [{ data: null, error: { code: '42501' } }],
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await writeScheduleChange(tables, 'org', { kind: CHANGE_SET, memberId: IVA, resolved: NEW })).toEqual({
      ok: false,
      code: SOURCE_WRITE_REFUSED,
    });
    expect(calls.map((call) => `${call.table}:${call.verb}`)).toEqual(['patterns:insert', 'steps:insert', 'versions:insert', 'steps:delete', 'patterns:delete']);
  });

  it('cancels by tenant, member and date: one row deleted, or refused', async () => {
    const cancel = { kind: CHANGE_CANCEL, memberId: ANA, effectiveFrom: '2026-10-20' } as const;
    const done = tablesOf({ versions: [{ data: [{ id: 'v-1' }], error: null }] });

    expect(await writeScheduleChange(done.tables, 'org', cancel)).toEqual({ ok: true });
    expect(done.calls[0]?.args).toEqual(['organization_id', 'org', 'member_id', ANA, 'effective_from', '2026-10-20']);
    expect(await writeScheduleChange(tablesOf({ versions: [{ data: [], error: null }] }).tables, 'org', cancel)).toEqual({
      ok: false,
      code: SOURCE_WRITE_REFUSED,
    });
  });

  it('names every refusal code, and every refusal has words', () => {
    expect(scheduleSourceWriteFailureOf({ code: '42501' })).toBe(SOURCE_WRITE_REFUSED);
    expect(scheduleSourceWriteFailureOf({ code: '23503' })).toBe(SOURCE_WRITE_REFUSED);
    expect(scheduleSourceWriteFailureOf({ code: '23505' })).toBe(SOURCE_WRITE_TAKEN);
    expect(scheduleSourceWriteFailureOf({ code: '23514', message: 'ROTATION_PATTERN_ARCHIVED_TYPE' })).toBe(SOURCE_WRITE_ARCHIVED);
    // Any other check is a write this card should never send: the service, not "archived".
    expect(
      scheduleSourceWriteFailureOf({ code: '23514', message: 'new row for relation "member_schedule_versions" violates check constraint "member_schedule_versions_pattern_by_source"' }),
    ).toBe(SOURCE_WRITE_FAILED);
    expect(scheduleSourceWriteFailureOf({ code: '57014' })).toBe(SOURCE_WRITE_FAILED);
    for (const code of [
      SOURCE_UNCHOSEN,
      SOURCE_PAST,
      SOURCE_SCHEDULED,
      SOURCE_TAKEN,
      SOURCE_UNCHANGED,
      SOURCE_NO_PATTERN,
      SOURCE_BAD_ROW,
      SOURCE_TOO_LONG,
      SOURCE_ARCHIVED,
      'badStart',
      SOURCE_STALE,
      SOURCE_WRITE_REFUSED,
      SOURCE_WRITE_TAKEN,
      SOURCE_WRITE_ARCHIVED,
      SOURCE_WRITE_FAILED,
    ] as const) {
      expect(t(scheduleSourceRefusalMessageKey(code)), code).not.toMatch(/^rasporedOsobe\./);
    }
    expect(['TEAM', 'PERSONAL', 'MANUAL'].map((source) => t(scheduleSourceMessageKey(source as 'TEAM')))).toEqual([
      'Rotacija tima',
      'Osobna rotacija',
      'Samo ručno',
    ]);
  });
});
