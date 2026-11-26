import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { CANDIDATES_FREE, assignmentCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import {
  CONFLICTS_UNAVAILABLE,
  ITEM_COLLISION,
  NO_TEAM_PARAM,
  conflictsQueueOutcomeOf,
  teamIdOfParam,
  teamParamOf,
  type ConflictRow,
} from '@/features/conflicts/services/conflicts-queue';
import { erasuresOf } from '@/features/conflicts/services/erasures';
import { effectiveResolutionsOf, heldByReplacement, unknownReplacementLinksOf } from '@/features/conflicts/services/replacement-effect';
import { resolvedConflictsViewOf } from '@/features/conflicts/services/resolved-conflicts';
import {
  REPLACE_BY_ASSIGNMENT,
  REPLACE_BY_OVERRIDE,
  RESOLUTION_READY,
  replaceWriteOf,
  resolutionScreenOf,
  type ResolutionSources,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import {
  RESOLUTION_FAILED,
  RESOLUTION_TAKEN,
  RESOLVE_WITH_PERSONAL_ASSIGNMENT_FUNCTION,
  resolveWithPersonalAssignment,
  type ResolutionCoverRpc,
} from '@/features/conflicts/services/resolution-write';
import { conflictResolutionsOf } from '@/features/conflicts/services/resolutions';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { LEAVE_HANDOFF_ORIGIN_STATE, leaveHandoffOriginOf } from '@/features/leave/services/leave-section-handoff';
import { ANA, DAN, DAY_TEAM, DORA, IVA, NOC, leaveRowOf, planningSnapshotOf } from '@/features/planning/planning.fixture';
import { calendarPersonalAssignmentRow, memberMembershipRow } from '@/features/rotation/rotation.fixture';
import { initLocalization } from '@/lib/i18n';

type Row = Record<string, unknown>;

/**
 * STORY 21.7 (AD-4 as amended; 0081): a leave over a Personal Shift is a
 * conflict, with a team or none, and Replace Member covers it with the
 * replacement's own assignment. Over *Ručni raspored*'s test calendar: IVA, a
 * student on no team, works a teamless *Dan* 10.10. and is on leave 09.–10.10.
 * DORA is on *Dnevni* (no rotation); in `teamlessDora` she leaves it from
 * 01.10., a second member with no team.
 */

const NOW = new Date('2026-10-01T08:00:00Z');
const DATE = '2026-10-10';
const IVA_SHIFT = '00000000-0000-4000-8000-00000000f101';
const DORA_SHIFT = '00000000-0000-4000-8000-00000000f102';
const LEAVE: readonly Row[] = [leaveRowOf('00000000-0000-4000-8000-00000000f103', IVA, '2026-10-09', '2026-10-11')];
const IVA_DAN = calendarPersonalAssignmentRow(IVA_SHIFT, IVA, DATE, 'SHIFT', DAN);
const TEAMLESS_DORA = memberMembershipRow(DORA, null, '2026-10-01');

function resolutionRow(fields: Partial<Record<string, unknown>> = {}): Row {
  return {
    member_id: IVA,
    date: DATE,
    team_id: null,
    kind: 'accept_uncovered',
    roster_override_id: null,
    shift_type_id: DAN,
    personal_assignment_id: null,
    created_by: 'admin-auth',
    created_at: '2026-10-01T08:00:00Z',
    ...fields,
  };
}

function collisionRowsOf(snapshot: CalendarSnapshot, resolutions: readonly Row[] = [], leave: readonly Row[] = LEAVE): readonly ConflictRow[] {
  const outcome = conflictsQueueOutcomeOf(snapshot, leave, resolutions, '2026-10-01', [], []);

  if (!outcome.ok) throw new Error(CONFLICTS_UNAVAILABLE);

  return outcome.view.rows.filter((row): row is ConflictRow => row.kind === ITEM_COLLISION);
}

function settled(rows: readonly unknown[]) {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

function sourcesOf(snapshot: CalendarSnapshot, resolutions: readonly Row[] = [], leave: readonly Row[] = LEAVE): ResolutionSources {
  return {
    calendar: { snapshot, refusal: null, loading: false },
    records: settled(leave),
    resolutions: settled(resolutions),
    requests: settled([]),
    swaps: settled([]),
    members: {
      members: snapshot.members.map((member) => ({ id: member.id, leaveAllowance: { startingDays: 20, versions: [] } })),
      refusal: null,
      loading: false,
      paused: false,
    },
    organization: {
      data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
    },
  };
}

function viewOf(snapshot: CalendarSnapshot, memberId: string, teamId: string | null, leave: readonly Row[] = LEAVE): ResolutionView {
  const screen = resolutionScreenOf(sourcesOf(snapshot, [], leave), { memberId, date: DATE, teamId }, NOW);

  if (screen.kind !== RESOLUTION_READY) throw new Error(screen.kind);

  return screen.view;
}

function candidateIdsOf(view: Pick<ResolutionView, 'candidates'>): readonly string[] {
  return view.candidates.flatMap((group) => group.candidates.map((candidate) => candidate.id));
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Za odluku lists a conflict with no team (story 21.7)', () => {
  it('lists IVA’s teamless Dan, keyed with no team and named with none', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [IVA_DAN] });

    expect(collisionRowsOf(snapshot).map((row) => [row.memberId, row.date, row.teamId, row.teamName, row.shiftTypeName])).toEqual([
      [IVA, DATE, null, null, 'Dan'],
    ]);
  });

  it('is resolved by a decision on its teamless key, and not by one on a team’s key', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [IVA_DAN] });

    expect(collisionRowsOf(snapshot, [resolutionRow()])).toEqual([]);
    expect(collisionRowsOf(snapshot, [resolutionRow({ team_id: DAY_TEAM })])).toHaveLength(1);
  });

  it('a decision made on another type decides nothing (0038): IVA works Dan, not Noć', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [IVA_DAN] });

    expect(collisionRowsOf(snapshot, [resolutionRow({ shift_type_id: NOC })])).toHaveLength(1);
  });

  it('a decision on a Personal Shift counted with a team is compared with that shift, not the team’s rotation', async () => {
    // *Dnevni* has no rotation: the 0038 comparison must read DORA's own Dan.
    const snapshot = await planningSnapshotOf({ assignments: [calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)] });
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f108', DORA, DATE, '2026-10-11')];

    expect(collisionRowsOf(snapshot, [], leave).map((row) => [row.memberId, row.teamId])).toEqual([[DORA, DAY_TEAM]]);
    expect(collisionRowsOf(snapshot, [resolutionRow({ member_id: DORA, team_id: DAY_TEAM })], leave)).toEqual([]);
    expect(collisionRowsOf(snapshot, [resolutionRow({ member_id: DORA, team_id: DAY_TEAM, shift_type_id: NOC })], leave)).toHaveLength(1);
  });

  it('a teamless amend keeps its way back: the hand-off origin admits no team', () => {
    expect(leaveHandoffOriginOf({ [LEAVE_HANDOFF_ORIGIN_STATE]: { memberId: IVA, date: DATE, teamId: null } })).toEqual({
      memberId: IVA,
      date: DATE,
      teamId: null,
    });
  });

  it('the route opens a teamless conflict by `bez-tima`, and a team’s by its id', () => {
    expect(teamParamOf(null)).toBe(NO_TEAM_PARAM);
    expect(teamIdOfParam(NO_TEAM_PARAM)).toBeNull();
    expect(teamParamOf(DAY_TEAM)).toBe(DAY_TEAM);
    expect(teamIdOfParam(DAY_TEAM)).toBe(DAY_TEAM);
  });
});

describe('a replacement by assignment (AD-4’s second form)', () => {
  const replacement = resolutionRow({ kind: 'replace_member', personal_assignment_id: DORA_SHIFT });

  it('resolves while DORA’s live assignment gives her a teamless Dan that date', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [IVA_DAN, calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)],
      memberships: [TEAMLESS_DORA],
    });

    expect(collisionRowsOf(snapshot, [replacement])).toEqual([]);
  });

  it('keeps resolving while the snapshot does not hold the assignment yet (unknown, re-read)', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [IVA_DAN], memberships: [TEAMLESS_DORA] });

    expect(collisionRowsOf(snapshot, [replacement])).toEqual([]);
  });

  it('stops resolving, and holds the key, when the assignment counts with another team', async () => {
    // DORA stays on *Dnevni*: her assignment counts with it, never with none.
    const snapshot = await planningSnapshotOf({
      assignments: [IVA_DAN, calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)],
    });
    const parsed = conflictResolutionsOf([replacement], snapshot.members.map((member) => member.id), snapshot.teams.map((team) => team.id));

    if (parsed === null) throw new Error('the row did not parse');

    expect(collisionRowsOf(snapshot, [replacement])).toHaveLength(1);
    expect(effectiveResolutionsOf(snapshot, parsed)).toEqual([]);
    expect(heldByReplacement(snapshot, parsed[0]!)).toBe(true);
  });

  it('stops resolving when the assignment is of another type', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [IVA_DAN, calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', NOC)],
      memberships: [TEAMLESS_DORA],
    });

    expect(collisionRowsOf(snapshot, [replacement])).toHaveLength(1);
  });
});

describe('Odlučeno and the re-read read the second form', () => {
  const replacement = resolutionRow({ kind: 'replace_member', personal_assignment_id: DORA_SHIFT });

  it('names a teamless decision with no team, and the cover by the member who holds the assignment', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [IVA_DAN, calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)],
      memberships: [TEAMLESS_DORA],
    });
    const view = resolvedConflictsViewOf(snapshot, LEAVE, [replacement], [{ auth_user_id: 'admin-auth', name: 'Admin' }], [], []);
    const row = view.rows[0] as { readonly teamName: string | null; readonly replacementName: string | null; readonly shiftTypeName: string | null };

    expect(view.rows).toHaveLength(1);
    expect(row.teamName).toBeNull();
    expect(row.replacementName).toBe('Dora Dorić');
    expect(row.shiftTypeName).toBe('Dan');
  });

  it('asks for the snapshot again for an assignment link it does not hold, and not for one it holds', async () => {
    const without = await planningSnapshotOf({ assignments: [IVA_DAN] });
    const holding = await planningSnapshotOf({ assignments: [IVA_DAN, calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)] });

    expect(unknownReplacementLinksOf(without, [replacement])).toEqual([DORA_SHIFT]);
    expect(unknownReplacementLinksOf(holding, [replacement])).toEqual([]);
  });
});

describe('the resolution screen of a Personal Shift', () => {
  it('writes by assignment for the second form or no team, and by override with the team otherwise', () => {
    expect(replaceWriteOf({ replaceForm: REPLACE_BY_ASSIGNMENT, teamId: DAY_TEAM })).toEqual({ form: REPLACE_BY_ASSIGNMENT });
    expect(replaceWriteOf({ replaceForm: REPLACE_BY_OVERRIDE, teamId: null })).toEqual({ form: REPLACE_BY_ASSIGNMENT });
    expect(replaceWriteOf({ replaceForm: REPLACE_BY_OVERRIDE, teamId: DAY_TEAM })).toEqual({ form: REPLACE_BY_OVERRIDE, teamId: DAY_TEAM });
  });

  it('a teamless conflict is replaced by assignment, names no team, and offers only members with no team', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [IVA_DAN], memberships: [TEAMLESS_DORA] });
    const view = viewOf(snapshot, IVA, null);

    expect(view.replaceForm).toBe(REPLACE_BY_ASSIGNMENT);
    expect(view.teamId).toBeNull();
    expect(view.teamName).toBeNull();
    expect(view.shiftTypeName).toBe('Dan');
    expect(view.total).toBe(1);
    expect(view.coworkers).toEqual([]);
    expect(view.staffing).toBeNull();
    expect(view.heldCalendar).toEqual({ prikaz: 'sve', mjesec: '2026-10' });
    expect(candidateIdsOf(view)).toEqual([DORA]);
    expect(view.candidates.find((group) => group.kind === CANDIDATES_FREE)?.candidates.map((one) => one.id)).toEqual([DORA]);
  });

  it('a Personal Shift counted with a team is replaced by assignment too, and anyone free that date is offered', async () => {
    // DORA's day shift counts with *Dnevni*, which has no rotation.
    const snapshot = await planningSnapshotOf({ assignments: [calendarPersonalAssignmentRow(DORA_SHIFT, DORA, DATE, 'SHIFT', DAN)] });
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f104', DORA, DATE, '2026-10-11')];
    const view = viewOf(snapshot, DORA, DAY_TEAM, leave);

    expect(view.replaceForm).toBe(REPLACE_BY_ASSIGNMENT);
    expect(view.teamName).toBe('Dnevni');
    expect(candidateIdsOf(view)).toContain(IVA);
    expect(candidateIdsOf(view)).not.toContain(DORA);
  });

  it('leaves out a candidate who already holds a shift that date, and keeps one with a day off', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [
        IVA_DAN,
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f105', DORA, DATE, 'OFF'),
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f106', ANA, DATE, 'SHIFT', NOC, DAY_TEAM),
      ],
      memberships: [TEAMLESS_DORA],
    });
    const records = organizationLeaveRecordsOf(LEAVE, snapshot.members.map((member) => member.id)) ?? [];
    const ids = assignmentCandidatesOf(snapshot, records, IVA, DAY_TEAM, DATE, DAN).flatMap((group) => group.candidates.map((one) => one.id));

    expect(ids).toContain(DORA);
    expect(ids).not.toContain(ANA);
    expect(ids).not.toContain(IVA);
  });

  it('a team’s rotation shift keeps the override form', async () => {
    const snapshot = await planningSnapshotOf();
    // ANA is on Smjena A, which works Dan on 08.10.
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f107', ANA, '2026-10-08', '2026-10-09')];
    const screen = resolutionScreenOf(sourcesOf(snapshot, [], leave), { memberId: ANA, date: '2026-10-08', teamId: 'pilot-smjena-a' }, NOW);

    if (screen.kind !== RESOLUTION_READY) throw new Error(screen.kind);

    expect(screen.view.replaceForm).toBe(REPLACE_BY_OVERRIDE);
  });
});

describe('the erasure guard reads a teamless conflict (AD-5)', () => {
  it('lists the unresolved teamless conflict a change takes away, as the member’s own schedule without them', async () => {
    const before = await planningSnapshotOf({ assignments: [IVA_DAN] });
    const after = await planningSnapshotOf();
    const rows = erasuresOf(before, after, '2026-10-01', LEAVE, []);

    expect(rows.map((row) => [row.memberId, row.date, row.teamId, row.teamName, row.shiftTypeName, row.teamWorks])).toEqual([
      [IVA, DATE, null, 'osobni raspored', 'Dan', true],
    ]);
    expect(erasuresOf(before, after, '2026-10-01', LEAVE, [resolutionRow()])).toEqual([]);
  });
});

describe('resolve_with_personal_assignment (0081)', () => {
  function rpcAnswering(answer: unknown): ResolutionCoverRpc & { readonly calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      rpc(fn, args) {
        calls.push([fn, args]);

        return Promise.resolve(answer) as PromiseLike<{ readonly error: null }>;
      },
    };
  }

  const item = { memberId: IVA, date: DATE, teamId: null, shiftTypeId: DAN, replacementId: DORA };

  it('sends every item in one call, its team null for none and no note by default', async () => {
    const client = rpcAnswering({ data: ['r1'], error: null });

    expect(await resolveWithPersonalAssignment(client, [item, { ...item, date: '2026-10-11', teamId: DAY_TEAM, note: 'pokriva' }])).toEqual({ ok: true });
    expect(client.calls).toEqual([
      [
        RESOLVE_WITH_PERSONAL_ASSIGNMENT_FUNCTION,
        {
          p_items: [
            { memberId: IVA, date: DATE, teamId: null, shiftTypeId: DAN, replacementId: DORA, note: null },
            { memberId: IVA, date: '2026-10-11', teamId: DAY_TEAM, shiftTypeId: DAN, replacementId: DORA, note: 'pokriva' },
          ],
        },
      ],
    ]);
    expect(RESOLVE_WITH_PERSONAL_ASSIGNMENT_FUNCTION).toBe('resolve_with_personal_assignment');
  });

  it('maps the replacement holding another shift to taken, and refuses no items or a bad date without a call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await resolveWithPersonalAssignment(rpcAnswering({ error: { code: '23505', message: 'CONFLICT_REPLACEMENT_TAKEN' } }), [item])).toEqual({
      ok: false,
      code: RESOLUTION_TAKEN,
    });

    const unused = rpcAnswering({ error: null });

    expect(await resolveWithPersonalAssignment(unused, [])).toEqual({ ok: false, code: RESOLUTION_FAILED });
    expect(await resolveWithPersonalAssignment(unused, [{ ...item, date: '2026-02-30' }])).toEqual({ ok: false, code: RESOLUTION_FAILED });
    expect(unused.calls).toEqual([]);
  });
});
