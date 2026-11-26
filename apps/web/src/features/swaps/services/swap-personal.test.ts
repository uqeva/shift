import { PERSONAL_ASSIGNMENT_OFF, PERSONAL_ASSIGNMENT_SHIFT, type PersonalAssignment } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayDetailOf, swapOfferedOf } from '@/features/calendar/utils/day-detail';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import { DECISIONS_EMBED, SWAP_APPROVED, swapChangedLaterOf, swapShiftsOfRow } from '@/features/swaps/services/organization-swaps';
import { SWAP_DECISION_ARCHIVED, SWAP_DECISION_TAKEN, swapDecisionFailureOf } from '@/features/swaps/services/swap-decision';
import { mySwapsOf, swapStaleOf } from '@/features/swaps/services/my-swaps';
import {
  SWAP_GIVEN_GONE,
  SWAP_NO_RETURN,
  SWAP_NO_TEAM,
  SWAP_PREVIEW_READY,
  SWAP_TAKER_ASSIGNED,
  ownSwapShiftOf,
  swapAlreadyProposedOf,
  swapAppliedOf,
  swapColleaguesOf,
  swapBlockedLineMessageKey,
  swapBlockedMessageKey,
  swapInsertOf,
  swapProposedOf,
  withSwapProposed,
  swapPreviewOf,
  swapReturnOptionsOf,
  swapReturnValueOf,
  swapSendCheckOf,
  swapShiftWorkedBy,
  type SwapShiftKey,
} from '@/features/swaps/services/swap-proposal';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 21.8: swaps give and take Personal Shifts, over 12.2's pilot (the
 * rotation Dan, Noć, Slobodno, Slobodno; A works Dan on 2026-09-10 with the
 * viewer and Karlo, B one step ahead). 2026-09-12 is a day off for A, so a
 * shift the viewer holds that date is their Personal Shift alone.
 */

type Row = Record<string, unknown>;

const TODAY = '2026-09-08';
const OFF_DAY = '2026-09-12';

const IVO = '00000000-0000-4000-8000-0000000000e4';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const LUKA = '00000000-0000-4000-8000-0000000000e6';

function idOf(rows: readonly Row[], index: number): string {
  const id = rows[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no row ${String(index)}`);

  return id;
}

const A = idOf(PILOT.teams, 0);
const B = idOf(PILOT.teams, 1);
const C = idOf(PILOT.teams, 2);

async function pilot(): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'member_role' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
            memberMembershipRow(IVO, B, SEEDED),
            memberMembershipRow(LUKA, C, SEEDED),
          ],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(IVO, 'Ivo Horvat'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
      calendarMemberRow(LUKA, 'Luka Perić'),
    ]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** `snapshot` with `assignments` added to their members (the viewer's own list too), and `teamless` on no team. */
function withAssignments(
  snapshot: CalendarSnapshot,
  assignments: readonly (PersonalAssignment & { readonly memberId: string })[],
  teamless: readonly string[] = [],
): CalendarSnapshot {
  const of = (memberId: string): readonly PersonalAssignment[] =>
    assignments.filter((one) => one.memberId === memberId).map(({ memberId: _member, ...assignment }) => assignment);

  return {
    ...snapshot,
    members: snapshot.members.map((member) => ({
      ...member,
      personalAssignments: [...member.personalAssignments, ...of(member.id)],
      memberships: teamless.includes(member.id) ? [] : member.memberships,
    })),
    viewer: {
      ...snapshot.viewer,
      personalAssignments: [...snapshot.viewer.personalAssignments, ...of(snapshot.viewer.memberId)],
    },
  };
}

let base: CalendarSnapshot;
let day: string;

beforeAll(async () => {
  await initLocalization();
  base = await pilot();

  const working = base.types.find((type) => type.isWorking);

  if (working === undefined) throw new Error('no working type');

  day = working.id;
});

const shiftOf = (memberId: string, id: string, date: string, teamId: string | null = null): PersonalAssignment & { readonly memberId: string } => ({
  memberId,
  id,
  date,
  kind: PERSONAL_ASSIGNMENT_SHIFT,
  shiftTypeId: day,
  teamId,
});

describe('the given shift', () => {
  it('a Personal Shift counted with the viewer’s team is offered from its day detail and named by its type', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY)]);
    const detail = dayDetailOf(snapshot, A, OFF_DAY);

    expect(swapOfferedOf(snapshot, detail, TODAY, [])).toBe(true);

    const given = ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: A }, TODAY, []);

    expect(given?.key).toEqual({ teamId: A, date: OFF_DAY, personal: { shiftTypeId: day } });
    expect(given?.workerIds).toEqual([VIEWER_MEMBER]);
    expect(given?.typeName).not.toBeNull();
    // Another team's URL names nothing.
    expect(ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: B }, TODAY, [])).toBeNull();
    expect(ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: SWAP_NO_TEAM }, TODAY, [])).toBeNull();
  });

  it('a teamless Personal Shift is named by `bez-tima`, never before today and never twice', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY)], [VIEWER_MEMBER]);
    const search = { dan: OFF_DAY, smjena: SWAP_NO_TEAM };
    const given = ownSwapShiftOf(snapshot, search, TODAY, []);

    expect(given?.key).toEqual({ teamId: null, date: OFF_DAY, personal: { shiftTypeId: day } });
    expect(given?.teamName).toBeNull();
    expect(ownSwapShiftOf(snapshot, search, '2026-09-13', [])).toBeNull();

    const proposed = [{ teamId: null, date: OFF_DAY, addresseeId: IVO }];

    expect(ownSwapShiftOf(snapshot, search, TODAY, proposed)).toBeNull();
    expect(swapAlreadyProposedOf(snapshot, search, TODAY, proposed)).toEqual({ colleagueName: 'Ivo Horvat' });
  });

  it('a colleague already holding a working assignment that date is offered but blocked, as 0083 refuses the approval', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY), shiftOf(IVO, 'pa-ivo', OFF_DAY, B)]);
    const given = ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: A }, TODAY, []);

    if (given === null) throw new Error('no given shift');

    const colleagues = swapColleaguesOf(snapshot, given);

    expect(colleagues.find((one) => one.id === IVO)?.blocked).toBe(SWAP_TAKER_ASSIGNED);
    expect(colleagues.find((one) => one.id === KARLO)?.blocked).toBeNull();
    expect(colleagues.some((one) => one.id === VIEWER_MEMBER)).toBe(false);
  });
});

describe('the "after" and the preview', () => {
  it('gives the taker the shift’s type and counted team and the giver OFF, and previews both members’ hours', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY)]);
    const given = ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: A }, TODAY, []);

    if (given === null) throw new Error('no given shift');

    const applied = swapAppliedOf(snapshot, { proposerId: VIEWER_MEMBER, addresseeId: KARLO, given: given.key, returnShift: null });

    if (!applied.ok) throw new Error('refused');

    const karlo = applied.after.members.find((member) => member.id === KARLO)?.personalAssignments;
    const viewer = applied.after.viewer.personalAssignments;

    expect(karlo?.map((one) => [one.date, one.kind, one.shiftTypeId, one.teamId])).toEqual([[OFF_DAY, PERSONAL_ASSIGNMENT_SHIFT, day, A]]);
    expect(viewer.map((one) => [one.date, one.kind])).toEqual([[OFF_DAY, PERSONAL_ASSIGNMENT_OFF]]);
    // The giver works it no more, the taker does.
    expect(swapShiftWorkedBy(applied.after, given.key, VIEWER_MEMBER)).toBe(false);
    expect(swapShiftWorkedBy(applied.after, given.key, KARLO)).toBe(true);

    const preview = swapPreviewOf(snapshot, given, KARLO, null, []);

    expect(preview?.kind).toBe(SWAP_PREVIEW_READY);
    if (preview?.kind !== SWAP_PREVIEW_READY) return;
    expect(preview.lines).toEqual([{ day: given.date, teamName: given.teamName, inId: KARLO, outId: VIEWER_MEMBER }]);
    const delta = (memberId: string) => preview.hours.find((one) => one.memberId === memberId)?.deltaMinutes ?? 0;

    expect(delta(VIEWER_MEMBER)).toBeLessThan(0);
    expect(delta(KARLO)).toBeGreaterThan(0);
    expect(delta(VIEWER_MEMBER)).toBe(-delta(KARLO));
  });
});

describe('the return options', () => {
  it('offers a colleague’s teamless Personal Shift in return, never on the given date, and checks it at send', () => {
    const snapshot = withAssignments(
      base,
      [shiftOf(LUKA, 'pa-luka', '2026-09-15'), shiftOf(LUKA, 'pa-luka-same', '2026-09-10')],
      [LUKA],
    );
    const given = ownSwapShiftOf(snapshot, { dan: '2026-09-10', smjena: A }, TODAY, []);

    if (given === null) throw new Error('no given shift');

    // The viewer gives A's Dan (a team shift), and takes Luka's Personal Shift back.
    expect(given.key.personal).toBeUndefined();

    const options = swapReturnOptionsOf(snapshot, given, LUKA, TODAY);
    const personal = options.filter((one) => one.key.personal !== undefined);

    expect(personal.map((one) => [one.date, one.key.teamId, one.teamName, one.blocked])).toEqual([['2026-09-15', null, null, null]]);

    const back = personal[0];

    if (back === undefined) throw new Error('no option');

    const sent = swapSendCheckOf(snapshot, given.key, { colleagueId: LUKA, returnValue: swapReturnValueOf(back) }, TODAY);

    expect(sent).toMatchObject({ ok: true, returnShift: back.key });
    // A one-way cover still sends no return shift.
    expect(swapSendCheckOf(snapshot, given.key, { colleagueId: LUKA, returnValue: SWAP_NO_RETURN }, TODAY)).toMatchObject({
      ok: true,
      returnShift: null,
    });
  });

  it('refuses a given Personal Shift whose type has changed since', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY)]);
    const stale: SwapShiftKey = { teamId: A, date: OFF_DAY, personal: { shiftTypeId: 'another-type' } };

    expect(swapSendCheckOf(snapshot, stale, { colleagueId: KARLO, returnValue: SWAP_NO_RETURN }, TODAY)).toEqual({
      ok: false,
      code: SWAP_GIVEN_GONE,
    });
  });
});

describe('the stored swap', () => {
  it('inserts 0083’s flags and types only for a personal side, and a team-only swap as before', () => {
    const team = { organizationId: 'org', proposerId: 'p', addresseeId: 'a', given: { teamId: A, date: OFF_DAY }, returnShift: null };

    expect(swapInsertOf(team)).toEqual({
      organization_id: 'org',
      proposer_id: 'p',
      addressee_id: 'a',
      team_id: A,
      date: OFF_DAY,
      return_team_id: null,
      return_date: null,
    });
    expect(
      swapInsertOf({
        ...team,
        given: { teamId: null, date: OFF_DAY, personal: { shiftTypeId: day } },
        returnShift: { teamId: B, date: '2026-09-15', personal: { shiftTypeId: day } },
      }),
    ).toEqual({
      organization_id: 'org',
      proposer_id: 'p',
      addressee_id: 'a',
      team_id: null,
      date: OFF_DAY,
      given_personal: true,
      shift_type_id: day,
      return_team_id: B,
      return_date: '2026-09-15',
      return_personal: true,
      return_shift_type_id: day,
    });
  });

  it('reads a stored teamless swap back on the viewer’s card, live while the giver still holds the shift', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY)], [VIEWER_MEMBER]);
    const row = {
      id: 'swap-1',
      proposer_id: VIEWER_MEMBER,
      addressee_id: KARLO,
      team_id: null,
      date: OFF_DAY,
      given_personal: true,
      shift_type_id: day,
      return_team_id: null,
      return_date: null,
      return_personal: false,
      return_shift_type_id: null,
      answer: null,
      closed_at: null,
      [DECISIONS_EMBED]: [],
    };

    expect(swapShiftsOfRow(row)?.given).toEqual({ teamId: null, date: OFF_DAY, personal: { shiftTypeId: day } });

    const [swap] = mySwapsOf([row], VIEWER_MEMBER) ?? [];

    if (swap === undefined) throw new Error('no swap');

    expect(swapStaleOf(snapshot, swap)).toBe(false);
    // Once the giver holds it no more (cleared in the grid), it no longer applies.
    expect(swapStaleOf(base, swap)).toBe(true);
  });
});

describe('the decision', () => {
  it('reads an approved personal side as changed later once its assignment is no longer live', () => {
    const snapshot = withAssignments(base, [shiftOf(KARLO, 'pa-karlo', OFF_DAY, A)]);
    const decision = {
      outcome: SWAP_APPROVED,
      rosterOverrideId: null,
      returnRosterOverrideId: null,
      personalAssignmentId: 'pa-karlo',
      returnPersonalAssignmentId: null,
      decidedBy: 'admin',
      decidedAt: '2026-09-07T10:00:00+00:00',
    } as const;

    expect(swapChangedLaterOf(snapshot, decision)).toBe(false);
    expect(swapChangedLaterOf(base, decision)).toBe(true);
  });

  it('maps a taker already assigned to taken, and an archived personal type or team to archived', () => {
    expect(swapDecisionFailureOf({ code: '23505', message: 'SWAP_REQUEST_TAKER_ASSIGNED' })).toBe(SWAP_DECISION_TAKEN);
    expect(swapDecisionFailureOf({ code: '22023', message: 'PERSONAL_ASSIGNMENTS_INVALID' })).toBe(SWAP_DECISION_ARCHIVED);
  });

  it('blocks a taker whose own personal rotation or assignment gives them a shift that date', () => {
    const snapshot = withAssignments(base, [shiftOf(VIEWER_MEMBER, 'pa-viewer', OFF_DAY), shiftOf(KARLO, 'pa-karlo', OFF_DAY, A)]);
    const given = ownSwapShiftOf(snapshot, { dan: OFF_DAY, smjena: A }, TODAY, []);

    if (given === null) throw new Error('no given shift');

    expect(swapColleaguesOf(snapshot, given).find((one) => one.id === KARLO)?.blocked).toBe(SWAP_TAKER_ASSIGNED);
  });
});

describe('the words', () => {
  it('says a taker’s assignment apart from a roster refusal', () => {
    expect(swapBlockedLineMessageKey(SWAP_TAKER_ASSIGNED)).toBe('kalendar.swap.takerAssigned');
    expect(swapBlockedMessageKey(SWAP_TAKER_ASSIGNED)).toBe('kalendar.swap.takerAssignedBlocked');
    expect(swapBlockedLineMessageKey('taken')).toBe('kalendar.swap.taken');
    expect(swapBlockedMessageKey('taken')).toBe('kalendar.swap.blocked');
  });

  it('round-trips a teamless proposal’s sent line through router state', () => {
    const proposed = { date: OFF_DAY, teamName: null, colleagueName: 'Karlo Jelić', returnShift: { date: '2026-09-15', teamName: null } };

    expect(swapProposedOf(withSwapProposed({}, proposed))).toEqual(proposed);
  });
});
