import { beforeAll, describe, expect, it } from 'vitest';

import { manualSearchOf } from '@/features/planning/hooks/use-manual-schedule';
import { DAN, IVA, MONTH, TODAY, planningSnapshotOf, statusRow } from '@/features/planning/planning.fixture';
import { NO_DRAFT, draftItemsOf, draftWith, manualMonthOf } from '@/features/planning/services/manual-grid';
import {
  SINGLE_CELL_NO_ROW,
  SINGLE_CELL_OPEN,
  addShiftSearchOf,
  singleCellOf,
} from '@/features/planning/services/single-cell';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 21.6 — *DODAJ SMJENU*: the member page sends one member and one date
 * to *Ručni raspored*, whose own picker opens on that one cell (matrix row 6).
 */

beforeAll(async () => {
  await initLocalization();
});

describe('Dodaj smjenu', () => {
  it('row 6: the member page’s date is the grid’s month, member and day', () => {
    expect(addShiftSearchOf(IVA, '2026-12-06')).toEqual({ mjesec: '2026-12', osoba: IVA, dan: '2026-12-06' });
  });

  it('the route keeps a real `dan` and drops one that is no date', () => {
    expect(manualSearchOf({ mjesec: '2026-12', osoba: IVA, dan: '2026-12-06' })).toEqual({
      mjesec: '2026-12',
      osoba: IVA,
      dan: '2026-12-06',
    });
    expect(manualSearchOf({ mjesec: '2026-12', osoba: IVA, dan: '2026-12-32' })).toEqual({ mjesec: '2026-12', osoba: IVA });
    expect(manualSearchOf({ dan: 6 })).toEqual({});
  });

  it('the grid opens the picker on that one cell, and its save is one item', async () => {
    const snapshot = await planningSnapshotOf();
    const month = manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT);
    const found = singleCellOf(month, IVA, '2026-10-10');

    expect(found).toEqual({ kind: SINGLE_CELL_OPEN, cell: { memberId: IVA, date: '2026-10-10' } });
    if (found.kind !== SINGLE_CELL_OPEN) return;

    // The grid's own draft and items: one cell, one `set`.
    const draft = draftWith(snapshot, NO_DRAFT, [found.cell], { kind: 'SHIFT', shiftTypeId: DAN, teamId: null });

    expect(draftItemsOf(draft)).toHaveLength(1);
  });

  it('a date the member is inactive on is an alert too: they have a row, but no day to edit there', async () => {
    const snapshot = await planningSnapshotOf({ statuses: [statusRow(IVA, false, '2026-10-15')] });
    const month = manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT);

    expect(month.rows.some((row) => row.memberId === IVA)).toBe(true);
    expect(singleCellOf(month, IVA, '2026-10-10').kind).toBe(SINGLE_CELL_OPEN);
    expect(singleCellOf(month, IVA, '2026-10-20')).toEqual({ kind: SINGLE_CELL_NO_ROW });
  });

  it('a member with no row that month is an alert, never a picker', async () => {
    const snapshot = await planningSnapshotOf({ statuses: [statusRow(IVA, false, '2026-09-01')] });
    const month = manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT);

    expect(singleCellOf(month, IVA, '2026-10-10')).toEqual({ kind: SINGLE_CELL_NO_ROW });
    // Nobody named, or a date outside the month, opens nothing either.
    expect(singleCellOf(month, undefined, '2026-10-10')).toEqual({ kind: SINGLE_CELL_NO_ROW });
    expect(singleCellOf(manualMonthOf(snapshot, MONTH, TODAY, NO_DRAFT), month.rows[0]?.memberId, '2026-11-01')).toEqual({
      kind: SINGLE_CELL_NO_ROW,
    });
  });
});
