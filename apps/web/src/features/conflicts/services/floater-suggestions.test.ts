import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { assignmentCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { floaterSuggestionsOfConflict } from '@/features/conflicts/services/floater-suggestions';
import {
  HELD_BY_ASSIGNMENT,
  HELD_BY_OVERRIDE,
  REPLACE_BY_ASSIGNMENT,
  REPLACE_BY_OVERRIDE,
  RESOLUTION_READY,
  hasCandidates,
  noSuggestionMessageKey,
  replaceWriteOf,
  replacementOf,
  resolutionScreenOf,
  suggestionLineMessageKey,
  type ResolutionSources,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import { RESOLUTION_HELD, resolutionFailureLineOf } from '@/features/conflicts/services/resolution-write';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { A, ANA, DAN, DORA, NOC, IVA, leaveRowOf, planningSnapshotOf, VIEWER_MEMBER } from '@/features/planning/planning.fixture';
import { calendarPersonalAssignmentRow, memberMembershipRow } from '@/features/rotation/rotation.fixture';
import { initLocalization, t } from '@/lib/i18n';

type Row = Record<string, unknown>;

/**
 * STORY 21.13 (R16.1–R16.3, UX-DR77): *Predložene zamjene* on the resolution
 * screen. Over *Ručni raspored*'s test calendar: Smjena A works Dan on 08.10.,
 * ANA (Smjena A, no role) is on leave that date. DORA (on *Dnevni*, a team
 * with no rotation) and IVA (a student on no team, role *Student*) are the
 * floaters a case names.
 */

const NOW = new Date('2026-10-01T08:00:00Z');
const DATE = '2026-10-08';
const ANA_LEAVE = leaveRowOf('00000000-0000-4000-8000-00000000f201', ANA, DATE, '2026-10-09');
const DORA_EARLIER = calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f202', DORA, '2026-10-02', 'SHIFT', DAN);
const STUDENT = 'pilot-role-student';
const OTHER_ROLE = 'pilot-role-other';

interface FloaterRow {
  readonly id: string;
  readonly roleIds?: readonly string[];
}

function settled(rows: readonly unknown[]) {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

function sourcesOf(
  snapshot: CalendarSnapshot,
  floaters: readonly FloaterRow[],
  leave: readonly Row[] = [ANA_LEAVE],
  resolutions: readonly Row[] = [],
): ResolutionSources {
  const byId = new Map(floaters.map((one) => [one.id, one]));

  return {
    calendar: { snapshot, refusal: null, loading: false },
    records: settled(leave),
    resolutions: settled(resolutions),
    requests: settled([]),
    swaps: settled([]),
    members: {
      members: snapshot.members.map((member) => ({
        id: member.id,
        leaveAllowance: { startingDays: 20, versions: [] },
        isFloater: byId.has(member.id),
        floaterRoleIds: byId.get(member.id)?.roleIds ?? [],
      })),
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

function viewOf(sources: ResolutionSources, memberId = ANA, date = DATE, teamId: string | null = A): ResolutionView {
  const screen = resolutionScreenOf(sources, { memberId, date, teamId }, NOW);

  if (screen.kind !== RESOLUTION_READY) throw new Error(screen.kind);

  return screen.view;
}

function idsOf(view: ResolutionView): readonly string[] {
  return view.candidates.flatMap((group) => group.candidates.map((candidate) => candidate.id));
}

beforeAll(async () => {
  await initLocalization();
});

describe('Predložene zamjene (R16.2)', () => {
  it('Suggested: the free floaters first, by fewest shifts this month, in no other group', async () => {
    const snapshot = await planningSnapshotOf({ assignments: [DORA_EARLIER] });
    const view = viewOf(sourcesOf(snapshot, [{ id: DORA }, { id: IVA }]));

    expect(view.suggestions.map((one) => [one.id, one.shiftsInMonth])).toEqual([
      [IVA, 0],
      [DORA, 1],
    ]);
    expect(view.noSuggestion).toBeNull();
    expect(idsOf(view)).not.toContain(DORA);
    expect(idsOf(view)).not.toContain(IVA);
    expect(hasCandidates(view)).toBe(true);
    expect(replacementOf(view, IVA)?.name).toBe('Iva Ivić');
    expect(t(suggestionLineMessageKey(), { line: 'Dora Dorić', count: 1 })).toBe('Dora Dorić · 1 smjena');
    expect(t(suggestionLineMessageKey(), { line: 'Dora Dorić', count: 3 })).toBe('Dora Dorić · 3 smjene');
  });

  it('Pick saved: a suggested pick is a cover by assignment counted with the team, a rotation shift\'s too (R16.3)', async () => {
    const snapshot = await planningSnapshotOf();
    const view = viewOf(sourcesOf(snapshot, [{ id: IVA }]));

    expect(view.replaceForm).toBe(REPLACE_BY_OVERRIDE);
    expect(replaceWriteOf(view, IVA)).toEqual({ form: REPLACE_BY_ASSIGNMENT });
    // Any other pick keeps the conflict's own form.
    expect(replaceWriteOf(view, DORA)).toEqual({ form: REPLACE_BY_OVERRIDE, teamId: A });
    expect(replaceWriteOf(view)).toEqual({ form: REPLACE_BY_OVERRIDE, teamId: A });
  });

  it('No role: an absent member with no role is covered by any floater, whatever they list', async () => {
    const snapshot = await planningSnapshotOf();

    expect(viewOf(sourcesOf(snapshot, [{ id: IVA, roleIds: [OTHER_ROLE] }])).suggestions.map((one) => one.id)).toEqual([IVA]);
  });

  it('None: a role no free floater lists says so, by the role\'s name', async () => {
    // IVA, a *Student*, works a teamless Dan on 10.10. and is on leave; DORA covers another role.
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f203', IVA, '2026-10-10', 'SHIFT', DAN)],
      memberships: [memberMembershipRow(DORA, null, '2026-10-01')],
    });
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f204', IVA, '2026-10-10', '2026-10-11')];
    const view = viewOf(sourcesOf(snapshot, [{ id: DORA, roleIds: [OTHER_ROLE] }], leave), IVA, '2026-10-10', null);

    expect(view.suggestions).toEqual([]);
    expect(view.noSuggestion).toEqual({ roleName: 'Student' });
    expect(t(noSuggestionMessageKey('Student'), { posao: 'Student' })).toBe('Nema slobodne zamjene za posao Student.');
    expect(t(noSuggestionMessageKey(null))).toBe('Nema slobodne zamjene.');
    // DORA, listing the role, is suggested instead.
    expect(viewOf(sourcesOf(snapshot, [{ id: DORA, roleIds: [STUDENT] }], leave), IVA, '2026-10-10', null).suggestions.map((one) => one.id)).toEqual([
      DORA,
    ]);
  });

  it('Not free: a floater on leave, or working that date, is not suggested', async () => {
    const working = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f205', DORA, DATE, 'SHIFT', DAN)],
    });

    expect(viewOf(sourcesOf(working, [{ id: DORA }])).suggestions).toEqual([]);
    expect(viewOf(sourcesOf(working, [{ id: DORA }])).noSuggestion).toEqual({ roleName: null });

    const snapshot = await planningSnapshotOf();
    const leave = [ANA_LEAVE, leaveRowOf('00000000-0000-4000-8000-00000000f206', DORA, '2026-10-07', '2026-10-09')];

    expect(viewOf(sourcesOf(snapshot, [{ id: DORA }], leave)).suggestions).toEqual([]);
  });

  it('Not free: a Noć on the day before running into the Dan\'s start leaves no rest (R16.2)', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f210', IVA, '2026-10-07', 'SHIFT', NOC)],
    });

    expect(viewOf(sourcesOf(snapshot, [{ id: IVA }])).suggestions).toEqual([]);
    // A Dan the day before ends at 19:00: twelve hours' rest, suggested.
    const rested = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f211', IVA, '2026-10-07', 'SHIFT', DAN)],
    });

    expect(viewOf(sourcesOf(rested, [{ id: IVA }])).suggestions.map((one) => one.id)).toEqual([IVA]);
  });

  it('Not free across a month: a Noć on the last day of October runs into a Dan on 1 November', async () => {
    // Smjena A works Dan on 01.11.; ANA is on leave that date.
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f212', ANA, '2026-11-01', '2026-11-02')];
    const night = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f213', IVA, '2026-10-31', 'SHIFT', NOC)],
    });
    const blocked = viewOf(sourcesOf(night, [{ id: IVA }], leave), ANA, '2026-11-01', A);

    expect(blocked.suggestions).toEqual([]);
    expect(blocked.noSuggestion).toEqual({ roleName: null });
    // Not counted in November either: the October Noć is another month's.
    const free = viewOf(sourcesOf(await planningSnapshotOf(), [{ id: IVA }], leave), ANA, '2026-11-01', A);

    expect(free.suggestions.map((one) => [one.id, one.shiftsInMonth])).toEqual([[IVA, 0]]);
  });

  it('No floaters: the screen is as before, with no block', async () => {
    const snapshot = await planningSnapshotOf();
    const without = viewOf(sourcesOf(snapshot, []));

    expect(without.suggestions).toEqual([]);
    expect(without.noSuggestion).toBeNull();
    expect(idsOf(without)).toContain(IVA);
    expect(idsOf(without)).toContain(DORA);
  });

  it('never widens 21.7\'s candidates: the adapter keeps only whoever a cover by assignment may write', async () => {
    const snapshot = await planningSnapshotOf();
    const records = organizationLeaveRecordsOf([ANA_LEAVE], snapshot.members.map((member) => member.id));

    if (records === null) throw new Error('the leave did not parse');

    const collision = { memberId: ANA, date: DATE, teamId: A, shiftTypeId: DAN, leaveRecordId: records[0]!.id };
    const members = [{ id: DORA, isFloater: true, floaterRoleIds: [] }, { id: VIEWER_MEMBER, isFloater: true, floaterRoleIds: [] }];
    const groups = assignmentCandidatesOf(snapshot, records, ANA, A, DATE, DAN).map((group) => ({
      ...group,
      candidates: group.candidates.filter((candidate) => candidate.id !== DORA),
    }));

    expect(floaterSuggestionsOfConflict(snapshot, records, members, collision, groups)?.suggested.map((one) => one.id)).not.toContain(DORA);
    expect(floaterSuggestionsOfConflict(snapshot, records, [], collision, groups)).toBeNull();
  });
});

describe('a key held by a cover\'s assignment (the 21.7 deferral)', () => {
  it('links Ručni raspored on the cover\'s month, person and date, and says so on a held refusal', async () => {
    const coverId = '00000000-0000-4000-8000-00000000f207';
    // IVA's teamless Dan is covered by DORA's assignment, which counts with *Dnevni*: it no longer applies.
    const snapshot = await planningSnapshotOf({
      assignments: [
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f208', IVA, '2026-10-10', 'SHIFT', DAN),
        calendarPersonalAssignmentRow(coverId, DORA, '2026-10-10', 'SHIFT', DAN),
      ],
    });
    const leave = [leaveRowOf('00000000-0000-4000-8000-00000000f209', IVA, '2026-10-10', '2026-10-11')];
    const held = {
      member_id: IVA,
      date: '2026-10-10',
      team_id: null,
      kind: 'replace_member',
      roster_override_id: null,
      shift_type_id: DAN,
      personal_assignment_id: coverId,
      created_by: 'admin-auth',
      created_at: '2026-10-01T08:00:00Z',
    };
    const view = viewOf(sourcesOf(snapshot, [], leave, [held]), IVA, '2026-10-10', null);

    expect(view.held).toBe(true);
    expect(view.heldBy).toEqual({ kind: HELD_BY_ASSIGNMENT, manual: { mjesec: '2026-10', osoba: DORA, dan: '2026-10-10' } });
    expect(t('zaOdluku.resolution.heldAssignmentAction')).toBe('Ukloni je u Ručnom rasporedu');
    expect(resolutionFailureLineOf(RESOLUTION_HELD, null, true)).toEqual({ key: 'zaOdluku.resolution.heldAssignment' });
    expect(resolutionFailureLineOf(RESOLUTION_HELD, null)).toEqual({ key: 'zaOdluku.resolution.held' });
  });

  it('is nothing while no live decision holds the key', async () => {
    const snapshot = await planningSnapshotOf();

    expect(viewOf(sourcesOf(snapshot, [])).heldBy).toBeNull();
    expect(HELD_BY_OVERRIDE).toBe('override');
  });
});
