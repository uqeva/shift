import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  A,
  ANA,
  C,
  DAN,
  IVA,
  NOC,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  leaveRowOf,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import {
  MANUAL_CLEAR,
  NO_DRAFT,
  draftAppliedOf,
  draftMembersOf,
  draftWindowOf,
  draftWith,
  type ManualCellRef,
  type ManualDraft,
  type ManualValue,
} from '@/features/planning/services/manual-grid';
import {
  MANUAL_GAINED,
  MANUAL_LOST,
  MANUAL_SHOWN_SHIFTS,
  manualInertMessageKey,
  manualPreviewOf,
  manualShiftMessageKey,
  newConflictsOf,
} from '@/features/planning/services/manual-preview';
import { initLocalization } from '@/lib/i18n';

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
});

function previewOf(snapshot: CalendarSnapshot, draft: ManualDraft, leave: readonly Record<string, unknown>[] | null = null) {
  const window = draftWindowOf(draft);

  if (window === null) throw new Error('empty draft');

  const records = leave === null ? null : organizationLeaveRecordsOf(leave, snapshot.members.map((member) => member.id));

  return manualPreviewOf(snapshot, draftAppliedOf(snapshot, draft), draftMembersOf(draft), window, records);
}

function drafted(snapshot: CalendarSnapshot, cells: readonly ManualCellRef[], value: ManualValue): ManualDraft {
  return draftWith(snapshot, NO_DRAFT, cells, value);
}

const DAN_VALUE: ManualValue = { kind: 'SHIFT', shiftTypeId: DAN, teamId: null };

describe('*Što se mijenja* per member (AD-5 as amended; R14.5)', () => {
  it('range set: a student given Dan on five dates gains five shifts with no team (matrix)', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    const preview = previewOf(plain, drafted(plain, dates.map((date) => ({ memberId: IVA, date })), DAN_VALUE));

    expect(preview.members).toHaveLength(1);
    expect(preview.members[0]?.name).toBe('Iva Ivić');
    expect(preview.members[0]?.shifts).toEqual(
      dates.map((date) => ({ side: MANUAL_GAINED, date, team: null, type: 'Dan', range: '07:00–19:00' })),
    );
    expect(preview.members[0]?.shifts.map(manualShiftMessageKey)).toEqual(dates.map(() => 'rucniRaspored.preview.gainedNoTeam'));
  });

  it('rotation cell: a crew member set Slobodno on a rotation Dan loses it, counted with their team (matrix)', () => {
    const preview = previewOf(plain, drafted(plain, [{ memberId: ANA, date: '2026-10-08' }], { kind: 'OFF' }));

    expect(preview.members[0]?.shifts).toEqual([
      { side: MANUAL_LOST, date: '2026-10-08', team: 'Smjena A', type: 'Dan', range: '07:00–19:00' },
    ]);
    expect(manualShiftMessageKey({ side: MANUAL_LOST, date: '2026-10-08', team: 'Smjena A', type: 'Dan', range: '07:00–19:00' })).toBe(
      'rucniRaspored.preview.lost',
    );
  });

  it('clear: removing an assigned day off gives the rotation shift back as gained (matrix)', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f002', ANA, '2026-10-08', 'OFF')],
    });
    const preview = previewOf(snapshot, drafted(snapshot, [{ memberId: ANA, date: '2026-10-08' }], { kind: MANUAL_CLEAR }));

    expect(preview.members[0]?.shifts).toEqual([
      { side: MANUAL_GAINED, date: '2026-10-08', team: 'Smjena A', type: 'Dan', range: '07:00–19:00' },
    ]);
  });

  it('a shift counted with another team is named with that team', () => {
    const preview = previewOf(plain, drafted(plain, [{ memberId: IVA, date: '2026-10-05' }], { kind: 'SHIFT', shiftTypeId: NOC, teamId: C }));

    expect(preview.members[0]?.shifts).toEqual([
      { side: MANUAL_GAINED, date: '2026-10-05', team: 'Smjena C', type: 'Noć', range: '19:00–07:00' },
    ]);
  });

  it('cuts a long block after the shown lines and counts the rest', () => {
    const dates = Array.from({ length: 20 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
    const preview = previewOf(plain, drafted(plain, dates.map((date) => ({ memberId: IVA, date })), DAN_VALUE));

    expect(preview.members[0]?.shifts).toHaveLength(MANUAL_SHOWN_SHIFTS);
    expect(preview.members[0]?.moreShifts).toBe(20 - MANUAL_SHOWN_SHIFTS);
  });

  it('warns of work joined with no rest, the teamless shift included, and only of a duty the save makes', () => {
    const draft = draftWith(plain, drafted(plain, [{ memberId: IVA, date: '2026-10-10' }], { kind: 'SHIFT', shiftTypeId: NOC, teamId: null }), [{ memberId: IVA, date: '2026-10-11' }], DAN_VALUE);
    const preview = previewOf(plain, draft);

    expect(preview.members[0]?.restGaps).toEqual([expect.objectContaining({ date: '2026-10-10', totalMinutes: 24 * 60 })]);
    expect(preview.members[0]?.doubles).toEqual([]);
  });

  it('warns of a double booking: a roster override already puts the student on a team shift the save overlaps', async () => {
    const snapshot = await planningSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('00000000-0000-4000-8000-00000000f003', A, '2026-10-12', null, IVA)],
    });
    const preview = previewOf(snapshot, drafted(snapshot, [{ memberId: IVA, date: '2026-10-12' }], DAN_VALUE));

    expect(preview.members[0]?.doubles).toEqual([
      expect.objectContaining({ date: '2026-10-12', first: expect.objectContaining({ type: 'Dan' }), second: expect.objectContaining({ type: 'Dan' }) }),
    ]);
    expect(
      preview.members[0]?.doubles[0] === undefined
        ? []
        : [preview.members[0].doubles[0].first.team, preview.members[0].doubles[0].second.team].sort(),
    ).toEqual(['Smjena A', null].sort());
  });

  it('lists a roster override the save leaves inapplicable, kept, with the people it names', async () => {
    const snapshot = await planningSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('00000000-0000-4000-8000-00000000f004', A, '2026-10-12', ANA, null)],
    });
    const preview = previewOf(snapshot, drafted(snapshot, [{ memberId: ANA, date: '2026-10-12' }], { kind: 'OFF' }));

    expect(preview.inert).toEqual([
      { key: '00000000-0000-4000-8000-00000000f004', date: '2026-10-12', team: 'Smjena A', out: { name: 'Ana Anić' }, in: null },
    ]);
    expect(manualInertMessageKey(preview.inert[0] as (typeof preview.inert)[number])).toBe('rucniRaspored.preview.inertOut');
  });

  it('says nothing for a member whose working shifts do not change', () => {
    const preview = previewOf(plain, drafted(plain, [{ memberId: IVA, date: '2026-10-05' }], { kind: 'OFF' }));

    expect(preview).toEqual({ members: [], inert: [] });
  });
});

describe('only what the save makes is said (review)', () => {
  it('never repeats a double booking already there before the save', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f007', IVA, '2026-10-12', 'SHIFT', DAN)],
      rosterOverrides: [calendarRosterOverrideRow('00000000-0000-4000-8000-00000000f008', A, '2026-10-12', null, IVA)],
    });
    const preview = previewOf(snapshot, drafted(snapshot, [{ memberId: IVA, date: '2026-10-13' }], DAN_VALUE));

    expect(preview.members[0]?.doubles).toEqual([]);
  });

  it('never repeats a no-rest duty already there before the save', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f009', IVA, '2026-10-10', 'SHIFT', NOC),
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f00a', IVA, '2026-10-11', 'SHIFT', DAN),
      ],
    });
    const preview = previewOf(snapshot, drafted(snapshot, [{ memberId: IVA, date: '2026-10-14' }], DAN_VALUE));

    expect(preview.members[0]?.restGaps).toEqual([]);
    expect(preview.members[0]?.shifts).toHaveLength(1);
  });
});

describe('the new conflicts a save makes over leave (21.4 gate; story 21.7: every team, listed in Za odluku)', () => {
  const LEAVE = [leaveRowOf('00000000-0000-4000-8000-00000000f005', IVA, '2026-10-09', '2026-10-12')];

  it('says, per date, each new conflict with no team the save makes over existing leave', () => {
    const cells = ['2026-10-10', '2026-10-11', '2026-10-15'].map((date) => ({ memberId: IVA, date }));
    const preview = previewOf(plain, drafted(plain, cells, DAN_VALUE), LEAVE);

    expect(preview.members[0]?.newConflicts).toEqual([
      { key: '2026-10-10', date: '2026-10-10' },
      { key: '2026-10-11', date: '2026-10-11' },
    ]);
  });

  it('never repeats one already there, and says one counted with a team too (story 21.7)', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f006', IVA, '2026-10-10', 'SHIFT', DAN)],
    });
    const records = organizationLeaveRecordsOf(LEAVE, snapshot.members.map((member) => member.id)) ?? [];
    const window = { from: '2026-10-10', to: '2026-10-11' };
    const draft = drafted(snapshot, [{ memberId: IVA, date: '2026-10-11' }], { kind: 'SHIFT', shiftTypeId: DAN, teamId: A });

    expect(newConflictsOf(snapshot, draftAppliedOf(snapshot, draft), IVA, window, records)).toEqual([
      { key: '2026-10-11', date: '2026-10-11' },
    ]);

    // 10.10. was a conflict before the save, and is not said again.
    const again = drafted(snapshot, [{ memberId: IVA, date: '2026-10-10' }, { memberId: IVA, date: '2026-10-11' }], DAN_VALUE);

    expect(newConflictsOf(snapshot, draftAppliedOf(snapshot, again), IVA, window, records)).toEqual([
      { key: '2026-10-11', date: '2026-10-11' },
    ]);
  });

  it('says no new-conflict line while the leave is not known', () => {
    const preview = previewOf(plain, drafted(plain, [{ memberId: IVA, date: '2026-10-10' }], DAN_VALUE), null);

    expect(preview.members[0]?.newConflicts).toEqual([]);
  });
});
