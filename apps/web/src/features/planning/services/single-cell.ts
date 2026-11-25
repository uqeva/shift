import { monthOf } from '@shift/domain';

import type { ManualCellRef, ManualMonth } from '@/features/planning/services/manual-grid';

/**
 * *DODAJ SMJENU* (story 21.6, epic AC 2 as reinterpreted): one person, one
 * date — the grid's single-cell case. The member page sends the admin to
 * *Ručni raspored* on that member and date ({@link addShiftSearchOf}), and the
 * grid opens its own picker on that one cell ({@link singleCellOf}), so the
 * picker, the check, the erasure confirmation and the write are the grid's,
 * never a copy. PURE, executed by the node suite (AD-15).
 */

/** The cell is in the month: the picker opens on it. */
export const SINGLE_CELL_OPEN = 'open';

/**
 * The member has no day to edit there: no row that month (inactive on every
 * date of it, or unknown), the date not in the month, or the member inactive
 * on that date (R14.3: an assignment there derives nothing). An alert.
 */
export const SINGLE_CELL_NO_ROW = 'noRow';

export type SingleCell =
  | { readonly kind: typeof SINGLE_CELL_OPEN; readonly cell: ManualCellRef }
  | { readonly kind: typeof SINGLE_CELL_NO_ROW };

/** The cell `?osoba=&dan=` names in `month`, or why the picker cannot open on it. */
export function singleCellOf(month: ManualMonth, memberId: string | undefined, date: string): SingleCell {
  const row = memberId === undefined ? undefined : month.rows.find((one) => one.memberId === memberId);

  const cell = row?.cells.find((one) => one.date === date);

  if (row === undefined || cell === undefined || !cell.active) return { kind: SINGLE_CELL_NO_ROW };

  return { kind: SINGLE_CELL_OPEN, cell: { memberId: row.memberId, date } };
}

/** `/rucni-raspored`'s search for one member's date: its month, the member and the day the picker opens on. */
export function addShiftSearchOf(memberId: string, date: string): { readonly mjesec: string; readonly osoba: string; readonly dan: string } {
  return { mjesec: monthOf(date), osoba: memberId, dan: date };
}
