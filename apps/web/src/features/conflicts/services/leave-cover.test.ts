import { FLOATER_INACTIVE, FLOATER_ON_LEAVE, FLOATER_REST_GAP, FLOATER_WORKING, PERSONAL_ASSIGNMENT_SHIFT } from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import {
  COVER_GONE,
  COVER_HELD,
  COVER_MODEL_LOADING,
  COVER_MODEL_NONE,
  COVER_MODEL_READY,
  COVER_MODEL_UNAVAILABLE,
  COVER_NONE,
  COVER_NOT_CANDIDATE,
  STEP_CHANGED,
  STEP_ERASURES,
  STEP_REFUSED,
  STEP_UNAVAILABLE,
  STEP_WRITE,
  coverConfirmStepOf,
  coverErasureSubjectOf,
  leaveCoverBoundOf,
  leaveCoverCheckFromReads,
  leaveCoverCheckOf,
  leaveCoverDraftOf,
  leaveCoverFailureLineOf,
  leaveCoverItemsOf,
  leaveCoverKeyOf,
  leaveCoverModelOf,
  leaveCoverNoneMessageKey,
  leaveCoverOffered,
  leaveCoverReasonMessageKey,
  leaveCoverRefusalMessageKey,
  leaveCoverViewOf,
  type LeaveCoverReads,
  type LeaveCoverReady,
  type LeaveCoverView,
} from '@/features/conflicts/services/leave-cover';
import {
  LEAVE_COVER_SAVED,
  RESOLUTION_READY,
  resolutionSavedLineOf,
  resolutionSavedMessageKey,
  resolutionSavedOf,
  resolutionScreenOf,
  withResolutionSaved,
  type ResolutionSources,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import {
  PERSONAL_COVER_MAX_ITEMS,
  RESOLUTION_DENIED,
  RESOLUTION_HELD,
  RESOLUTION_TAKEN,
} from '@/features/conflicts/services/resolution-write';
import { MANUAL_TOO_MANY } from '@/features/planning/services/manual-grid';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  NO_REPLACEMENTS,
  REPLACEMENTS_KNOWN,
  REPLACEMENTS_UNKNOWN,
  isCoverWarning,
  replacementGuardOf,
} from '@/features/leave/services/leave-section';
import {
  A,
  ANA,
  DAN,
  DAY_TEAM,
  DORA,
  IVA,
  NOC,
  VIEWER_MEMBER,
  calendarPersonalAssignmentRow,
  calendarRosterOverrideRow,
  leaveRowOf,
  planningSnapshotOf,
} from '@/features/planning/planning.fixture';
import { initLocalization, t } from '@/lib/i18n';

type Row = Record<string, unknown>;

/**
 * STORY 21.14 (R16.4, UX-DR77): *Pokrij cijelo odsustvo*. Over *Ručni
 * raspored*'s test calendar: Smjena A works Dan 08.10., Noć 09.10., Dan 12.10.
 * and Noć 13.10. ANA (Smjena A, no role) is on leave from 08.10. up to
 * 14.10. (the row's bound is exclusive: 08.–13.10. inclusive), so the record
 * has four unresolved conflicts. IVA (a student on no team) and DORA (on
 * *Dnevni*) are the floaters a case names.
 */

const NOW = new Date('2026-10-01T08:00:00Z');
const LEAVE_ID = '00000000-0000-4000-8000-00000000c101';
const ANA_LEAVE = leaveRowOf(LEAVE_ID, ANA, '2026-10-08', '2026-10-14');
const DATES = ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'];

const FLOATERS = [
  { id: IVA, isFloater: true, floaterRoleIds: [] },
  { id: DORA, isFloater: true, floaterRoleIds: [] },
  { id: VIEWER_MEMBER, isFloater: false, floaterRoleIds: [] },
];

function recordsOf(snapshot: CalendarSnapshot, rows: readonly Row[]) {
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new Error('the leave did not parse');

  return records;
}

function viewOf(snapshot: CalendarSnapshot, rows: readonly Row[] = [ANA_LEAVE], resolutions: readonly Row[] = [], members = FLOATERS) {
  const view = leaveCoverViewOf(snapshot, recordsOf(snapshot, rows), resolutions, members, { memberId: ANA, leaveRecordId: LEAVE_ID });

  if (view === null) throw new Error('no cover view');

  return view;
}

function floaterOf(view: LeaveCoverView, id: string) {
  const floater = view.floaters.find((one) => one.id === id);

  if (floater === undefined) throw new Error(`${id} is not offered`);

  return floater;
}

/** A `replace_member` of the second form (0081), naming a cover's assignment. */
function coverRow(date: string, assignmentId: string, shiftTypeId: string = DAN): Row {
  return {
    member_id: ANA,
    date,
    team_id: A,
    kind: 'replace_member',
    roster_override_id: null,
    shift_type_id: shiftTypeId,
    personal_assignment_id: assignmentId,
    created_by: 'admin-auth',
    created_at: '2026-10-01T08:00:00Z',
  };
}

beforeAll(async () => {
  await initLocalization();
});

describe('the dates and the floaters offered (R16.4)', () => {
  it('Whole week: the record\'s unresolved conflicts in date order, each covered by a free floater', async () => {
    const view = viewOf(await planningSnapshotOf());

    expect(view.absentName).toBe('Ana Anić');
    expect(view.dateCount).toBe(4);
    // A tie on covered dates and on shifts this month keeps the names' order.
    expect(view.floaters.map((one) => one.id)).toEqual([DORA, IVA]);

    const iva = floaterOf(view, IVA);

    expect(iva.dates.map((date) => [date.collision.date, date.collision.shiftTypeId, date.covered])).toEqual([
      [DATES[0], DAN, true],
      [DATES[1], NOC, true],
      [DATES[2], DAN, true],
      [DATES[3], NOC, true],
    ]);
    expect(iva.covered).toBe(4);
    expect(iva.dates[0]?.teamName).toBe('Smjena A');
  });

  it('lists a date the floater is not free on with its reason, and orders by covered dates first', async () => {
    // IVA works a Dan on 12.10. and DORA is on leave 08.10.
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c102', IVA, '2026-10-12', 'SHIFT', DAN)],
    });
    const view = viewOf(snapshot, [ANA_LEAVE, leaveRowOf('00000000-0000-4000-8000-00000000c103', DORA, '2026-10-08', '2026-10-09')]);
    const iva = floaterOf(view, IVA);
    const dora = floaterOf(view, DORA);

    expect(iva.dates.map((date) => date.reason)).toEqual([null, null, FLOATER_WORKING, null]);
    expect(dora.dates.map((date) => date.reason)).toEqual([FLOATER_ON_LEAVE, null, null, null]);
    // Both cover three: the tie keeps 21.13's order — fewest shifts over the leave's months (DORA has none), then the names'.
    expect(view.floaters.map((one) => [one.id, one.covered])).toEqual([
      [DORA, 3],
      [IVA, 3],
    ]);
    expect(t(leaveCoverReasonMessageKey(FLOATER_WORKING))).toBe('taj dan radi');
    expect(t(leaveCoverReasonMessageKey(FLOATER_ON_LEAVE))).toBe('taj dan je na odsutnosti');
    expect(t(leaveCoverReasonMessageKey(FLOATER_INACTIVE))).toBe('taj dan nije u aktivnom statusu');
    expect(t(leaveCoverReasonMessageKey(null))).toBe('pokriva');
  });

  it('Rest gap: a Noć of the floater\'s own ending as the Dan starts leaves that date open', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c104', IVA, '2026-10-11', 'SHIFT', NOC)],
    });
    const iva = floaterOf(viewOf(snapshot), IVA);

    expect(iva.dates[2]).toMatchObject({ covered: false, reason: FLOATER_REST_GAP });
    expect(t(leaveCoverReasonMessageKey(FLOATER_REST_GAP))).toBe('premalo odmora između smjena');
  });

  it('Held key: a date held by an unapplied cover is left open, waiting for the old one\'s removal', async () => {
    // DORA's Dan on 12.10. counts with *Dnevni*, so the cover it names no longer applies to Smjena A's key.
    const coverId = '00000000-0000-4000-8000-00000000c105';
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(coverId, DORA, '2026-10-12', 'SHIFT', DAN, DAY_TEAM)],
    });
    const iva = floaterOf(viewOf(snapshot, [ANA_LEAVE], [coverRow('2026-10-12', coverId)]), IVA);

    expect(iva.dates.map((date) => date.reason)).toEqual([null, null, COVER_HELD, null]);
    expect(t(leaveCoverReasonMessageKey(COVER_HELD))).toBe('čeka uklanjanje stare zamjene');
  });

  it('a floater who cannot take a shift (on a team, for a teamless one) leaves it open', async () => {
    // IVA's own teamless Dan on 10.10., on leave 10.10.: a teamless conflict is covered only by a member on no team.
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c106', IVA, '2026-10-10', 'SHIFT', DAN)],
    });
    const leaveId = '00000000-0000-4000-8000-00000000c107';
    const records = recordsOf(snapshot, [leaveRowOf(leaveId, IVA, '2026-10-10', '2026-10-11')]);
    // DORA covers IVA's role (*Student*), and is on *Dnevni* that date.
    const members = [{ id: DORA, isFloater: true, floaterRoleIds: ['pilot-role-student'] }];
    const view = leaveCoverViewOf(snapshot, records, [], members, { memberId: IVA, leaveRecordId: leaveId });

    expect(view?.floaters.map((one) => [one.id, one.covered, one.dates[0]?.reason])).toEqual([[DORA, 0, COVER_NOT_CANDIDATE]]);
    expect(t(leaveCoverReasonMessageKey(COVER_NOT_CANDIDATE))).toBe('ne može preuzeti tu smjenu');
  });

  it('None free: the floater is listed covering nothing', async () => {
    const view = viewOf(await planningSnapshotOf(), [ANA_LEAVE, leaveRowOf('00000000-0000-4000-8000-00000000c108', IVA, '2026-10-01', '2026-10-31')]);

    expect(floaterOf(view, IVA).covered).toBe(0);
    expect(view.floaters.at(-1)?.id).toBe(IVA);
    expect(t('zaOdluku.cover.noneCovered', { name: 'Iva Ivić' })).toBe('Iva Ivić: nema slobodnih datuma u ovoj odsutnosti.');
  });

  it('offers only the eligible floaters: by the absent member\'s role, never the absent member', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c109', IVA, '2026-10-10', 'SHIFT', DAN)],
    });
    const leaveId = '00000000-0000-4000-8000-00000000c110';
    const records = recordsOf(snapshot, [leaveRowOf(leaveId, IVA, '2026-10-10', '2026-10-11')]);
    // IVA is a *Student*: DORA lists another role, and IVA herself is a floater.
    const members = [
      { id: IVA, isFloater: true, floaterRoleIds: [] },
      { id: DORA, isFloater: true, floaterRoleIds: ['pilot-role-other'] },
    ];

    const view = leaveCoverViewOf(snapshot, records, [], members, { memberId: IVA, leaveRecordId: leaveId });

    expect(view?.floaters).toEqual([]);
    expect(view?.roleName).toBe('Student');
    expect(t(leaveCoverNoneMessageKey('Student'), { posao: 'Student' })).toBe('Nema zamjene za posao Student.');
    expect(t(leaveCoverNoneMessageKey(null))).toBe('Nema zamjene koja može preuzeti ovu odsutnost.');
    // Offered only with an eligible floater who is not the absent member (role-aware).
    expect(leaveCoverOffered(members, IVA, 'pilot-role-student')).toBe(false);
    expect(leaveCoverOffered([...members, { id: ANA, isFloater: true, floaterRoleIds: ['pilot-role-student'] }], IVA, 'pilot-role-student')).toBe(
      true,
    );
  });

  it('orders by the floater\'s shifts across every month the leave spans', async () => {
    // Smjena A works Dan 28.10., Noć 29.10., Dan 01.11. and Noć 02.11.; ANA is on leave 28.10.–02.11.
    // IVA works two days in November, DORA one in October: across both months DORA has fewer.
    const snapshot = await planningSnapshotOf({
      assignments: [
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c120', IVA, '2026-11-10', 'SHIFT', DAN),
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c121', IVA, '2026-11-15', 'SHIFT', DAN),
        calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c122', DORA, '2026-10-05', 'SHIFT', DAN),
      ],
    });
    const view = viewOf(snapshot, [leaveRowOf(LEAVE_ID, ANA, '2026-10-28', '2026-11-03')]);

    expect(view.floaters.map((one) => [one.id, one.covered, one.shiftsInSpan])).toEqual([
      [DORA, 4, 1],
      [IVA, 4, 2],
    ]);
  });

  it('No floater: nothing offered, and the screen is as 21.13 left it', async () => {
    const snapshot = await planningSnapshotOf();

    expect(leaveCoverOffered([{ id: IVA, isFloater: false, floaterRoleIds: [] }], ANA, null)).toBe(false);
    expect(leaveCoverOffered(FLOATERS, ANA, null)).toBe(true);
    // The absent member as the only floater offers nothing.
    expect(leaveCoverOffered([{ id: ANA, isFloater: true, floaterRoleIds: [] }], ANA, null)).toBe(false);
    expect(leaveCoverViewOf(snapshot, recordsOf(snapshot, [ANA_LEAVE]), [], [], { memberId: ANA, leaveRecordId: LEAVE_ID })).toBeNull();
  });

  it('the model waits for its reads, and says unavailable for a row it cannot trust', async () => {
    const snapshot = await planningSnapshotOf();
    const collision = { memberId: ANA, leaveRecordId: LEAVE_ID };

    expect(leaveCoverModelOf(null, [ANA_LEAVE], [], FLOATERS, collision)).toEqual({ kind: COVER_MODEL_LOADING });
    expect(leaveCoverModelOf(snapshot, [ANA_LEAVE], [], null, collision)).toEqual({ kind: COVER_MODEL_LOADING });
    expect(leaveCoverModelOf(snapshot, [ANA_LEAVE], [], [], collision)).toEqual({ kind: COVER_MODEL_NONE });
    expect(leaveCoverModelOf(snapshot, [ANA_LEAVE], [], FLOATERS, collision).kind).toBe(COVER_MODEL_READY);
    expect(leaveCoverModelOf(snapshot, [{ id: 'x' }], [], FLOATERS, collision)).toEqual({ kind: COVER_MODEL_UNAVAILABLE });
  });
});

describe('the draft and the one write', () => {
  it('drafts a SHIFT of each covered conflict\'s type counted with its team, and one item per covered date', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c111', IVA, '2026-10-12', 'SHIFT', DAN)],
    });
    const iva = floaterOf(viewOf(snapshot), IVA);
    const draft = leaveCoverDraftOf(iva);

    expect([...draft.values()]).toEqual([
      { memberId: IVA, date: DATES[0], value: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: DAN, teamId: A } },
      { memberId: IVA, date: DATES[1], value: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: NOC, teamId: A } },
      { memberId: IVA, date: DATES[3], value: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: NOC, teamId: A } },
    ]);
    expect(leaveCoverItemsOf(iva)).toEqual([
      { memberId: ANA, date: DATES[0], teamId: A, shiftTypeId: DAN, replacementId: IVA },
      { memberId: ANA, date: DATES[1], teamId: A, shiftTypeId: NOC, replacementId: IVA },
      { memberId: ANA, date: DATES[3], teamId: A, shiftTypeId: NOC, replacementId: IVA },
    ]);
    expect(PERSONAL_COVER_MAX_ITEMS).toBe(366);
    // More than one call takes is refused, never thrown (0081's bound).
    const item = leaveCoverItemsOf(iva)[0]!;

    expect(leaveCoverBoundOf(Array.from({ length: 366 }, () => item))).toBeNull();
    expect(leaveCoverBoundOf(Array.from({ length: 367 }, () => item))).toBe(MANUAL_TOO_MANY);
    expect(t(leaveCoverRefusalMessageKey(MANUAL_TOO_MANY))).toBe('Previše datuma za jedno spremanje.');
  });
});

describe('the check (AD-5)', () => {
  async function readsOf(
    setup: Parameters<typeof planningSnapshotOf>[0] = {},
    resolutions: readonly Row[] = [],
    members = FLOATERS,
  ): Promise<LeaveCoverReads> {
    return { calendar: await planningSnapshotOf(setup), records: [ANA_LEAVE], resolutions, members };
  }

  const ASK = { memberId: ANA, leaveRecordId: LEAVE_ID, floaterId: IVA };

  function readyOf(check: ReturnType<typeof leaveCoverCheckFromReads>): LeaveCoverReady {
    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    return check;
  }

  it('derives the grid\'s preview over the draft, with the items the write sends', async () => {
    const ready = readyOf(leaveCoverCheckFromReads(await readsOf(), ASK));

    expect(ready.items).toHaveLength(4);
    expect(ready.rows).toEqual([]);
    expect(ready.preview.members.map((block) => block.memberId)).toEqual([IVA]);
    expect(ready.draft.size).toBe(4);
    expect(ready.absentName).toBe('Ana Anić');
  });

  it('Stale: a check over changed reads says something else than the one shown', async () => {
    const shown = readyOf(leaveCoverCheckFromReads(await readsOf(), ASK));
    const fresh = readyOf(
      leaveCoverCheckFromReads(
        await readsOf({
          assignments: [calendarPersonalAssignmentRow('00000000-0000-4000-8000-00000000c112', IVA, '2026-10-12', 'SHIFT', DAN)],
        }),
        ASK,
      ),
    );

    expect(leaveCoverKeyOf(fresh)).not.toBe(leaveCoverKeyOf(shown));
    expect(leaveCoverKeyOf(readyOf(leaveCoverCheckFromReads(await readsOf(), ASK)))).toBe(leaveCoverKeyOf(shown));
  });

  it('is keyed on the record: covers the dates still open, and is gone only with none left', async () => {
    // 08.10. was accepted meanwhile: the other three are still open, and covered.
    const accepted = { ...coverRow(DATES[0]!, 'unused'), kind: 'accept_uncovered', personal_assignment_id: null };
    const ready = readyOf(leaveCoverCheckFromReads(await readsOf({}, [accepted]), ASK));

    expect(ready.items.map((item) => item.date)).toEqual(DATES.slice(1));

    const reads = await readsOf();

    expect(leaveCoverCheckFromReads({ ...reads, records: [] }, ASK)).toEqual({ kind: CHECK_REFUSED, code: COVER_GONE });
    expect(leaveCoverCheckFromReads(reads, { ...ASK, floaterId: VIEWER_MEMBER })).toEqual({ kind: CHECK_REFUSED, code: COVER_NONE });
    expect(t(leaveCoverRefusalMessageKey(COVER_NONE))).toBe('Ova zamjena više ne pokriva nijedan datum. Odaberi drugu.');
  });

  it('reads eligibility fresh: a floater un-flagged, or without the role, covers nothing', async () => {
    const unflagged = await readsOf({}, [], [{ id: IVA, isFloater: false, floaterRoleIds: [] }]);

    expect(leaveCoverCheckFromReads(unflagged, ASK)).toEqual({ kind: CHECK_REFUSED, code: COVER_NONE });
  });

  it('is unavailable offline or on a read that fails, never throwing', async () => {
    const reads = await readsOf();

    expect(await leaveCoverCheckOf(() => Promise.resolve(reads), ASK, false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await leaveCoverCheckOf(() => Promise.reject(new Error('down')), ASK, true)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect((await leaveCoverCheckOf(() => Promise.resolve(reads), ASK, true)).kind).toBe(CHECK_READY);
  });
});

describe('Spremi\'s decision (coverConfirmStepOf)', () => {
  const ASK = { memberId: ANA, leaveRecordId: LEAVE_ID, floaterId: IVA };

  async function shownOf(): Promise<LeaveCoverReady> {
    const check = leaveCoverCheckFromReads(
      { calendar: await planningSnapshotOf(), records: [ANA_LEAVE], resolutions: [], members: FLOATERS },
      ASK,
    );

    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    return check;
  }

  const erasing = (ready: LeaveCoverReady): LeaveCoverReady => ({ ...ready, rows: [{ key: 'row' } as unknown as ErasureRow] });
  const other = (ready: LeaveCoverReady): LeaveCoverReady => ({ ...ready, items: ready.items.slice(1) });

  it('writes a fresh check that says the same', async () => {
    const shown = await shownOf();

    expect(coverConfirmStepOf(shown, shown)).toEqual({ kind: STEP_WRITE, check: shown });
  });

  it('sends erasures to the confirmation', async () => {
    const shown = await shownOf();

    expect(coverConfirmStepOf(shown, erasing(shown)).kind).toBe(STEP_ERASURES);
  });

  it('Stale first: a changed check is shown again, erasures or not', async () => {
    const shown = await shownOf();

    expect(coverConfirmStepOf(shown, other(shown)).kind).toBe(STEP_CHANGED);
    expect(coverConfirmStepOf(shown, erasing(other(shown))).kind).toBe(STEP_CHANGED);
  });

  it('says a refused or unavailable check', async () => {
    const shown = await shownOf();

    expect(coverConfirmStepOf(shown, { kind: CHECK_REFUSED, code: COVER_GONE })).toEqual({ kind: STEP_REFUSED, code: COVER_GONE });
    expect(coverConfirmStepOf(shown, { kind: CHECK_UNAVAILABLE })).toEqual({ kind: STEP_UNAVAILABLE });
  });

  it('confirming erasures writes only what the preview shown said', async () => {
    const shown = await shownOf();

    expect(coverErasureSubjectOf(shown, erasing(shown))).not.toBeNull();
    expect(coverErasureSubjectOf(shown, other(shown))).toBeNull();
  });

  it('says taken and held as the cover\'s own lines, every other as the screen\'s', () => {
    const taken = leaveCoverFailureLineOf(RESOLUTION_TAKEN, 'Iva Ivić');

    expect(taken).toEqual({ key: 'zaOdluku.cover.error.taken', values: { name: 'Iva Ivić' } });
    expect(t('zaOdluku.cover.error.taken', { name: 'Iva Ivić' })).toBe('Iva Ivić već ima smjenu na jedan od tih datuma. Provjeri ponovno.');
    expect(leaveCoverFailureLineOf(RESOLUTION_HELD, 'Iva Ivić')).toEqual({ key: 'zaOdluku.cover.error.held' });
    expect(leaveCoverFailureLineOf(RESOLUTION_DENIED, 'Iva Ivić')).toEqual({ key: 'zaOdluku.resolution.error.denied' });
  });
});

describe('the resolution screen (story 21.14)', () => {
  function settled(rows: readonly unknown[]) {
    return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
  }

  function screenOf(snapshot: CalendarSnapshot, floaters: readonly string[], resolutions: readonly Row[] = []): ResolutionView {
    const sources: ResolutionSources = {
      calendar: { snapshot, refusal: null, loading: false },
      records: settled([ANA_LEAVE]),
      resolutions: settled(resolutions),
      requests: settled([]),
      swaps: settled([]),
      members: {
        members: snapshot.members.map((member) => ({
          id: member.id,
          leaveAllowance: { startingDays: 20, versions: [] },
          isFloater: floaters.includes(member.id),
          floaterRoleIds: [],
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
    const screen = resolutionScreenOf(sources, { memberId: ANA, date: DATES[0]!, teamId: A }, NOW);

    if (screen.kind !== RESOLUTION_READY) throw new Error(screen.kind);

    return screen.view;
  }

  it('offers Pokrij cijelo odsustvo only with a floater', async () => {
    const snapshot = await planningSnapshotOf();

    expect(screenOf(snapshot, [IVA]).leaveCover).toBe(true);
    // The absent member alone as a floater offers nothing.
    expect(screenOf(snapshot, [ANA]).leaveCover).toBe(false);
    expect(screenOf(snapshot, []).leaveCover).toBe(false);
    expect(screenOf(snapshot, []).supersededCovers).toEqual([]);
  });

  it('names a superseded decision\'s cover who still holds its shift, linking Ručni raspored', async () => {
    // A cover decided on Noć (0038): Smjena A works Dan on 08.10., so the decision decides nothing, and IVA keeps the shift.
    const coverId = '00000000-0000-4000-8000-00000000c113';
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(coverId, IVA, DATES[0], 'SHIFT', NOC, A)],
    });
    const view = screenOf(snapshot, [], [coverRow(DATES[0]!, coverId, NOC)]);

    expect(view.supersededCovers).toEqual([
      { key: coverId, name: 'Iva Ivić', date: '08.10.', manual: { mjesec: '2026-10', osoba: IVA, dan: DATES[0] } },
    ]);
    expect(t('zaOdluku.cover.superseded', { name: 'Iva Ivić', date: '08.10.', action: 'Ukloni je u Ručnom rasporedu' })).toBe(
      'Iva Ivić i dalje ima smjenu 08.10. iz odluke donesene za drugu smjenu. Ukloni je u Ručnom rasporedu ako više ne treba.',
    );
  });

  it('says a whole leave covered on the queue, read back from router state', () => {
    const saved = { kind: LEAVE_COVER_SAVED, memberName: 'Ana Anić', replacementName: 'Iva Ivić', days: 3 } as const;
    const state = withResolutionSaved({}, saved);

    expect(resolutionSavedOf(state)).toEqual(saved);
    expect(resolutionSavedOf(withResolutionSaved({}, { ...saved, days: 0 }))).toBeNull();
    expect(resolutionSavedMessageKey(LEAVE_COVER_SAVED)).toBe('zaOdluku.savedCover');

    const line = resolutionSavedLineOf(saved, 'bez tima');

    expect(t(line.key, line.values)).toBe('Odsutnost pokrivena: Iva Ivić preuzima 3 smjene umjesto osobe Ana Anić.');
  });
});

describe('the leave guard names a cover who stays (the 21.7 deferral)', () => {
  const COVER = '00000000-0000-4000-8000-00000000c114';
  const RANGE = { from: DATES[0]!, to: DATES[3]! };
  const answered = (data: readonly unknown[]) => ({ isPending: false, isError: false, fetchStatus: 'idle', data });

  it('Leave shortened: an amend that uncovers a covered date names the cover\'s shift, a removal too', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(COVER, IVA, DATES[0], 'SHIFT', DAN, A)],
    });
    const read = answered([coverRow(DATES[0]!, COVER)]);
    const line = { assignmentId: COVER, name: 'Iva Ivić', date: '08.10.' };

    expect(replacementGuardOf(read, snapshot, ANA, RANGE, { from: DATES[1]!, to: DATES[3]! })).toEqual({
      kind: REPLACEMENTS_KNOWN,
      lines: [line],
    });
    expect(replacementGuardOf(read, snapshot, ANA, RANGE, null)).toEqual({ kind: REPLACEMENTS_KNOWN, lines: [line] });
    expect(isCoverWarning(line)).toBe(true);
    // An amend that still covers the date leaves no line.
    expect(replacementGuardOf(read, snapshot, ANA, RANGE, { from: DATES[0]!, to: DATES[2]! })).toEqual(NO_REPLACEMENTS);
    expect(t('ljudi.leaveRecord.coverStays', line)).toBe(
      'Iva Ivić i dalje ima smjenu 08.10. kao zamjena. Ukloni je u Ručnom rasporedu ako više ne treba.',
    );
  });

  it('names no cover whose assignment no longer applies, and says unknown for a row it cannot trust', async () => {
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(COVER, IVA, DATES[0], 'SHIFT', DAN, DAY_TEAM)],
    });
    const pending = { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined };

    expect(replacementGuardOf(answered([coverRow(DATES[0]!, COVER)]), snapshot, ANA, RANGE, null)).toEqual(NO_REPLACEMENTS);
    expect(replacementGuardOf(answered([coverRow('2026-13-01', COVER)]), snapshot, ANA, RANGE, null)).toEqual({
      kind: REPLACEMENTS_UNKNOWN,
    });
    expect(replacementGuardOf(pending, snapshot, ANA, RANGE, null)).toEqual({ kind: REPLACEMENTS_UNKNOWN });
    // A replacement naming an assignment that is not text cannot be trusted.
    expect(replacementGuardOf(answered([{ ...coverRow(DATES[0]!, COVER), personal_assignment_id: 5 }]), snapshot, ANA, RANGE, null)).toEqual({
      kind: REPLACEMENTS_UNKNOWN,
    });
  });

  it('names an override and a cover on one date, the override first', async () => {
    // DORA is put on Smjena A's Dan 08.10. by an override, and IVA covers the same date by assignment.
    const snapshot = await planningSnapshotOf({
      assignments: [calendarPersonalAssignmentRow(COVER, IVA, DATES[0], 'SHIFT', DAN, A)],
      rosterOverrides: [calendarRosterOverrideRow('ro-dora-08', A, DATES[0]!, null, DORA)],
    });
    const override = { ...coverRow(DATES[0]!, COVER), roster_override_id: 'ro-dora-08', personal_assignment_id: null };
    const guard = replacementGuardOf(answered([coverRow(DATES[0]!, COVER), override]), snapshot, ANA, RANGE, null);

    expect(guard).toEqual({
      kind: REPLACEMENTS_KNOWN,
      lines: [
        { overrideId: 'ro-dora-08', name: 'Dora Dorić', team: 'Smjena A', date: '08.10.' },
        { assignmentId: COVER, name: 'Iva Ivić', date: '08.10.' },
      ],
    });
  });
});
