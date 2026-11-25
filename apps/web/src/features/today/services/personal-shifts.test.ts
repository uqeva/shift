import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  A,
  ANA,
  DAN,
  NOC,
  DAY_TEAM,
  DORA,
  IVA,
  SLOBODNO,
  VIEWER_MEMBER,
  calendarPersonalAssignmentRow,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import { adminTodayViewOf, coverageRowKeyOf } from '@/features/today/services/admin-today';
import { NOTE_OWN } from '@/features/today/services/today-duty';
import { CASE_DUTY, CASE_WORKING, TODAY_READY, todayViewOf } from '@/features/today/services/today';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 21.6 on *Danas*: a teamless Personal Shift names no team (the card
 * says `bez tima`), and admin *Danas*'s coverage reads each staffing group as
 * a row of its own, over *Ručni raspored*'s test calendar.
 */

const DATE = '2026-10-15';
const NOON = new Date(`${DATE}T10:00:00Z`);

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await planningSnapshotOf({
    assignments: [
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f201', DORA, DATE, 'SHIFT', DAN),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f202', IVA, DATE, 'SHIFT', DAN, DAY_TEAM),
      calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000f203', ANA, DATE, 'SHIFT', DAN, DAY_TEAM),
    ],
  });
});

/** The viewer on no team, holding `kind`'s assignment on {@link DATE}: the snapshot as a student's would read. */
function teamlessViewerOf(shiftTypeId: string): CalendarSnapshot {
  const memberships = [{ teamId: null, position: null, effectiveFrom: '2020-01-01' }];
  const personalAssignments = [{ id: '00000000-0000-4000-8000-00000000f204', date: DATE, kind: 'SHIFT' as const, shiftTypeId, teamId: null }];

  return {
    ...snapshot,
    viewer: { ...snapshot.viewer, memberships, personalAssignments },
    members: snapshot.members.map((member) =>
      member.id === VIEWER_MEMBER ? { ...member, memberships, personalAssignments } : member,
    ),
  };
}

describe('Danas reads a teamless Personal Shift', () => {
  it('row 1: today’s teamless *Dan* is the working case, its team `null` (`bez tima`), marked assigned', () => {
    const today = todayViewOf(teamlessViewerOf(DAN), [], NOON);

    expect(today.kind).toBe(TODAY_READY);
    if (today.kind !== TODAY_READY) return;

    expect(today.view.todayCase.kind).toBe(CASE_WORKING);
    if (today.view.todayCase.kind !== CASE_WORKING) return;

    expect(today.view.todayCase.shifts).toEqual([
      expect.objectContaining({ teamId: null, teamName: null, name: 'Dan', assigned: true, fromYesterday: false }),
    ]);
  });

  it('a non-working type reads as off: no shift', () => {
    const today = todayViewOf(teamlessViewerOf(SLOBODNO), [], NOON);

    expect(today.kind).toBe(TODAY_READY);
    if (today.kind !== TODAY_READY) return;

    expect(today.view.todayCase.kind).not.toBe(CASE_WORKING);
  });
});

describe('a duty joins a teamless Personal Shift to a team’s shift', () => {
  it('the teamless *Noć* 11.10. and Smjena A’s *Dan* 12.10. are one duty; its legs say `bez tima` (marked) and the team, and the next shift skips the joined leg', () => {
    // The viewer is on no team until 12.10., then on Smjena A (which works Dan 12.10., Noć 13.10.).
    const memberships = [
      { teamId: null, position: null, effectiveFrom: '2020-01-01' },
      { teamId: A, position: null, effectiveFrom: '2026-10-12' },
    ];
    const personalAssignments = [
      { id: '00000000-0000-4000-8000-00000000f205', date: '2026-10-11', kind: 'SHIFT' as const, shiftTypeId: NOC, teamId: null },
    ];
    const joined: CalendarSnapshot = {
      ...snapshot,
      viewer: { ...snapshot.viewer, memberships, personalAssignments },
      members: snapshot.members.map((member) =>
        member.id === VIEWER_MEMBER ? { ...member, memberships, personalAssignments } : member,
      ),
    };
    // 20:00 in Zagreb on 11.10., inside the *Noć*.
    const today = todayViewOf(joined, [], new Date('2026-10-11T18:00:00Z'));

    expect(today.kind).toBe(TODAY_READY);
    if (today.kind !== TODAY_READY) throw new Error(today.kind);

    expect(today.view.todayCase.kind).toBe(CASE_DUTY);
    if (today.view.todayCase.kind !== CASE_DUTY) throw new Error(today.view.todayCase.kind);

    expect(today.view.todayCase.duty.legs.map((leg) => [leg.name, leg.note])).toEqual([
      ['Noć', { kind: NOTE_OWN, team: null, assigned: true }],
      ['Dan', { kind: NOTE_OWN, team: 'Smjena A' }],
    ]);
    // The *Dan* 12.10. is the duty's leg, never the next shift: that is Smjena A's *Noć* 13.10.
    expect(today.view.next).toMatchObject({ name: 'Noć', inDays: 2 });
  });
});

describe('admin Danas coverage reads the groups as rows', () => {
  it('row 3: a day team with no rotation is its group’s row of three, never also “no rotation”', () => {
    const { coverage } = adminTodayViewOf(snapshot, [], [], [], 0, NOON);
    const group = coverage.rows.find((row) => row.teamId === DAY_TEAM);

    expect(coverage.noRotation).not.toContain('Dnevni');
    expect(coverage.off).not.toContain('Dnevni');
    expect(group).toMatchObject({ shiftTypeName: 'Dan', total: 3, present: 3, groupTypeId: DAN });
    expect(group === undefined ? null : coverageRowKeyOf(group)).toBe(`${DAY_TEAM}|${DAN}`);
  });

  it('no assignment: no row is a group, and the day team is named as having no rotation', async () => {
    const plain = await planningSnapshotOf();
    const { coverage } = adminTodayViewOf(plain, [], [], [], 0, NOON);

    for (const row of coverage.rows) expect(row).not.toHaveProperty('groupTypeId');
    expect(coverage.noRotation).toContain('Dnevni');
  });
});
