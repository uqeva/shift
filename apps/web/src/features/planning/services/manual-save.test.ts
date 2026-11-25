import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { ANA, ARCHIVED_TYPE, DAN, IVA, leaveRowOf, planningSnapshotOf } from '@/features/planning/planning.fixture';
import { MANUAL_ARCHIVED, MANUAL_STALE, MANUAL_TOO_MANY, NO_DRAFT, draftWith } from '@/features/planning/services/manual-grid';
import {
  MANUAL_DENIED,
  MANUAL_FAILED,
  SAVE_PERSONAL_ASSIGNMENTS_FUNCTION,
  manualCheckFromReads,
  manualCheckOf,
  manualPreviewKeyOf,
  manualRefusalMessageKey,
  manualWriteFailureOf,
  saveManualSchedule,
  type ManualRpc,
} from '@/features/planning/services/manual-save';
import { SHORT_STAFFED_KNOWN } from '@/features/staffing/services/short-staffed';
import { initLocalization, t } from '@/lib/i18n';

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await planningSnapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const IVA_DAN = draftWithPlain();

function draftWithPlain() {
  return { cells: [{ memberId: IVA, date: '2026-10-10' }], value: { kind: 'SHIFT', shiftTypeId: DAN, teamId: null } as const };
}

describe('the check over fresh reads (AD-5 as amended)', () => {
  it('derives the preview, no erasure and no block for a student given a shift', () => {
    const draft = draftWith(plain, NO_DRAFT, IVA_DAN.cells, IVA_DAN.value);
    const check = manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, draft);

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.rows).toEqual([]);
    expect(check.draft).toBe(draft);
    expect(check.preview.members.map((member) => member.memberId)).toEqual([IVA]);
    expect(check.shortStaffed).toBeNull();
  });

  it('lists the conflict a day off erases (erasure, matrix): leave over a rotation Dan, the cell set Slobodno', () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }], { kind: 'OFF' });
    const check = manualCheckFromReads(
      { calendar: plain, records: [leaveRowOf('00000000-0000-4000-8000-00000000f101', ANA, '2026-10-08', '2026-10-09')], resolutions: [] },
      draft,
    );

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.rows.map((row) => [row.memberId, row.date, row.teamName])).toEqual([[ANA, '2026-10-08', 'Smjena A']]);
  });

  it('reports the shift a day off leaves short of the minimum', async () => {
    const snapshot = await planningSnapshotOf({ minimumMembers: 1 });
    const draft = draftWith(snapshot, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }], { kind: 'OFF' });
    const check = manualCheckFromReads({ calendar: snapshot, records: [], resolutions: [] }, draft);

    expect(check.kind).toBe(CHECK_READY);
    if (check.kind !== CHECK_READY) return;
    expect(check.shortStaffed).toMatchObject({ kind: SHORT_STAFFED_KNOWN, rows: [expect.objectContaining({ date: '2026-10-08', teamName: 'Smjena A' })] });
  });

  it('refuses before deriving what 0077 would refuse anyway (stale, archived)', () => {
    const archived = draftWith(plain, NO_DRAFT, IVA_DAN.cells, { kind: 'SHIFT', shiftTypeId: ARCHIVED_TYPE, teamId: null });
    const stale = draftWith(plain, NO_DRAFT, [{ memberId: 'gone', date: '2026-10-10' }], { kind: 'OFF' });

    expect(manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, archived)).toEqual({ kind: CHECK_REFUSED, code: MANUAL_ARCHIVED });
    expect(manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, stale)).toEqual({ kind: CHECK_REFUSED, code: MANUAL_STALE });
  });

  it('is unavailable offline, on a failed read, on an untrusted leave row and for an empty draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const draft = draftWith(plain, NO_DRAFT, IVA_DAN.cells, IVA_DAN.value);
    const reads = () => Promise.resolve({ calendar: plain, records: [], resolutions: [] });

    expect(await manualCheckOf(reads, draft, false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await manualCheckOf(() => Promise.reject(new Error('down')), draft, true)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await manualCheckOf(() => Promise.resolve({ calendar: plain, records: [{ id: 1 }], resolutions: [] }), draft, true)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
    expect(manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, NO_DRAFT)).toEqual({ kind: CHECK_UNAVAILABLE });
  });
});

describe('the confirm step compares the preview it showed (review)', () => {
  it('keys two checks alike when they say the same, apart when a line differs', async () => {
    const draft = draftWith(plain, NO_DRAFT, IVA_DAN.cells, IVA_DAN.value);
    const first = manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, draft);
    const again = manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, draft);
    const minimum = await planningSnapshotOf({ minimumMembers: 1 });
    const off = draftWith(minimum, NO_DRAFT, [{ memberId: ANA, date: '2026-10-08' }], { kind: 'OFF' });
    const plainOff = manualCheckFromReads({ calendar: plain, records: [], resolutions: [] }, off);
    const shortOff = manualCheckFromReads({ calendar: minimum, records: [], resolutions: [] }, off);

    if (first.kind !== CHECK_READY || again.kind !== CHECK_READY || plainOff.kind !== CHECK_READY || shortOff.kind !== CHECK_READY) {
      throw new Error('not ready');
    }
    expect(manualPreviewKeyOf(first)).toBe(manualPreviewKeyOf(again));
    expect(manualPreviewKeyOf(plainOff)).not.toBe(manualPreviewKeyOf(shortOff));
  });
});

describe('the write: one save_personal_assignments call', () => {
  function rpcAnswering(answer: unknown) {
    const calls: unknown[] = [];
    const client = {
      rpc: (fn: string, args: unknown) => {
        calls.push([fn, args]);

        return Promise.resolve(answer);
      },
    } as unknown as ManualRpc;

    return { client, calls };
  }

  it('sends every drafted cell in one call and answers the counts', async () => {
    const draft = draftWith(plain, NO_DRAFT, [{ memberId: IVA, date: '2026-10-10' }, { memberId: ANA, date: '2026-10-08' }], { kind: 'OFF' });
    const { client, calls } = rpcAnswering({ data: { inserted: 2, removed: 0, unchanged: 0 }, error: null });

    expect(await saveManualSchedule(client, draft)).toEqual({ ok: true, saved: { inserted: 2, removed: 0, unchanged: 0 } });
    expect(calls).toEqual([
      [
        SAVE_PERSONAL_ASSIGNMENTS_FUNCTION,
        {
          p_changes: [
            { memberId: ANA, date: '2026-10-08', set: { kind: 'OFF' } },
            { memberId: IVA, date: '2026-10-10', set: { kind: 'OFF' } },
          ],
        },
      ],
    ]);
  });

  it('reads 42501 as denied, 22023 as behind (stale), and anything else as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const draft = draftWith(plain, NO_DRAFT, IVA_DAN.cells, IVA_DAN.value);

    expect(await saveManualSchedule(rpcAnswering({ error: { code: '42501' } }).client, draft)).toEqual({ ok: false, code: MANUAL_DENIED });
    expect(await saveManualSchedule(rpcAnswering({ error: { code: '22023', message: 'PERSONAL_ASSIGNMENTS_INVALID' } }).client, draft)).toEqual({
      ok: false,
      code: MANUAL_STALE,
    });
    expect(await saveManualSchedule(rpcAnswering({ error: { code: '57014' } }).client, draft)).toEqual({ ok: false, code: MANUAL_FAILED });
    expect(await saveManualSchedule(rpcAnswering({ data: { inserted: 1 }, error: null }).client, draft)).toEqual({ ok: false, code: MANUAL_FAILED });
    expect(await saveManualSchedule(rpcAnswering(null).client, draft)).toEqual({ ok: false, code: MANUAL_FAILED });
    expect(manualWriteFailureOf({})).toBe(MANUAL_FAILED);
  });

  it('sends nothing for an empty draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client, calls } = rpcAnswering({ data: null, error: null });

    expect(await saveManualSchedule(client, NO_DRAFT)).toEqual({ ok: false, code: MANUAL_FAILED });
    expect(calls).toEqual([]);
  });

  it('words every refusal', () => {
    for (const code of [MANUAL_STALE, MANUAL_ARCHIVED, MANUAL_TOO_MANY, MANUAL_DENIED, MANUAL_FAILED] as const) {
      const key = manualRefusalMessageKey(code);

      expect(t(key), key).not.toBe(key);
    }
  });
});
