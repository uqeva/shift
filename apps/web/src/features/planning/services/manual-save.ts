import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  MANUAL_ARCHIVED,
  MANUAL_MAX_ITEMS,
  MANUAL_STALE,
  MANUAL_TOO_MANY,
  draftAppliedOf,
  draftItemsOf,
  draftMembersOf,
  draftRefusalOf,
  draftWindowOf,
  type ManualDraft,
  type ManualDraftRefusal,
  type ManualSaveItem,
} from '@/features/planning/services/manual-grid';
import { manualPreviewOf, type ManualPreview } from '@/features/planning/services/manual-preview';
import { configurationReportOf, unknownReportOf, type ShortStaffedReport } from '@/features/staffing/services/short-staffed';

/**
 * *SPREMI* OF *RUČNI RASPORED* (story 21.4; AD-5 as amended 2026-11-25): the
 * check over fresh reads and the one write, as a `.ts` the node suite
 * executes (AD-15).
 *
 * THE CHECK ({@link manualCheckOf}) reads the three core reads afresh
 * (`use-erasure-reads`), builds the "after" from the FRESH calendar with the
 * draft applied (`draftAppliedOf`), and derives from it, over the draft's
 * window (its first to its last date): *Što se mijenja* (`manual-preview`),
 * the short-staffed block over the same fresh leave, and the erasures
 * (`erasuresOf`, from the window's first date). What 0077 would refuse anyway
 * is refused first (`draftRefusalOf`). Never throws: anything that goes wrong
 * is unavailable, and logged — nothing is written unchecked.
 *
 * THE WRITE ({@link saveManualSchedule}) is 0077's one definer,
 * `save_personal_assignments(p_changes)`, with every drafted cell: one call,
 * one transaction, one notice per member (E-3).
 */

/** 0077's definer: the grid's one write. */
export const SAVE_PERSONAL_ASSIGNMENTS_FUNCTION = 'save_personal_assignments';

/** Logged when a check or write, or a re-read after it, could not be settled. */
export const MANUAL_UNAVAILABLE = 'MANUAL_SCHEDULE_UNAVAILABLE';

/** What the fresh check derived: the erasures to confirm, the preview, the short-staffed block and the items it was derived for. */
export interface ManualReady {
  readonly kind: typeof CHECK_READY;
  readonly rows: readonly ErasureRow[];
  readonly preview: ManualPreview;
  readonly shortStaffed: ShortStaffedReport | null;
  /** The draft the check stood on: the write sends exactly its items. */
  readonly draft: ManualDraft;
}

export type ManualCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: ManualDraftRefusal }
  | ManualReady;

/** The check's decision over reads already fetched (see the module's header). */
export function manualCheckFromReads(reads: ErasureReads, draft: ManualDraft): ManualCheck {
  const { calendar, records, resolutions } = reads;
  const window = draftWindowOf(draft);

  if (window === null) return { kind: CHECK_UNAVAILABLE };

  const refusal = draftRefusalOf(calendar, draft);

  if (refusal !== null) return { kind: CHECK_REFUSED, code: refusal };

  const after = draftAppliedOf(calendar, draft);
  const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, after, window.from, records, resolutions));

  if (!outcome.ok) return { kind: CHECK_UNAVAILABLE };

  const leave = organizationLeaveRecordsOf(
    records,
    calendar.members.map((member) => member.id),
  );

  return {
    kind: CHECK_READY,
    rows: outcome.rows,
    preview: manualPreviewOf(calendar, after, draftMembersOf(draft), window, leave),
    shortStaffed: shortStaffedOf(calendar, after, window, records),
    draft,
  };
}

/**
 * What *Što se mijenja* says for a ready check, as one comparable key: the
 * member blocks, the inert overrides and the short-staffed block. *Spremi*
 * in the dialog writes only when a fresh check says the same as the one
 * shown (review: a stale preview is never written unseen).
 */
export function manualPreviewKeyOf(check: Pick<ManualReady, 'preview' | 'shortStaffed'>): string {
  return JSON.stringify([check.preview, check.shortStaffed]);
}

/** The short-staffed block over the fresh leave: `null` with no minimum, unknown (logged) on a `RangeError`. */
function shortStaffedOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  window: { readonly from: string; readonly to: string },
  records: readonly unknown[],
): ShortStaffedReport | null {
  try {
    return configurationReportOf(before, after, window, { isPending: false, isError: false, data: records });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return unknownReportOf(cause);
  }
}

/** THE CHECK, over `read`'s fresh answer. Never throws. */
export function manualCheckOf(read: () => Promise<ErasureReads>, draft: ManualDraft, online: boolean): Promise<ManualCheck> {
  return checkedOf(read, (reads) => manualCheckFromReads(reads, draft), online);
}

// ------------------------------------------------------------------ the write

/** The caller may not save (42501): not an active admin. */
export const MANUAL_DENIED = 'denied';
/** Anything else: try again. */
export const MANUAL_FAILED = 'failed';

/** What the write answers when it is refused: 0077's 22023 is the screen being behind ({@link MANUAL_STALE}). */
export type ManualWriteFailure = typeof MANUAL_STALE | typeof MANUAL_DENIED | typeof MANUAL_FAILED;

export type ManualRefusal = ManualDraftRefusal | ManualWriteFailure;

export interface ManualWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface ManualRpcAnswer {
  readonly data?: unknown;
  readonly error: ManualWriteError | null;
}

/** The one call and nothing else. */
export interface ManualRpc {
  rpc(fn: typeof SAVE_PERSONAL_ASSIGNMENTS_FUNCTION, args: { p_changes: readonly ManualSaveItem[] }): PromiseLike<ManualRpcAnswer>;
}

/** What a landed save wrote, as 0077 counts it. */
export interface ManualSaved {
  readonly inserted: number;
  readonly removed: number;
  readonly unchanged: number;
}

export type ManualWriteOutcome = { readonly ok: true; readonly saved: ManualSaved } | { readonly ok: false; readonly code: ManualWriteFailure };

const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER = '22023';

/** A refused call as this screen's own failure: 42501 denied, 22023 behind (a member, type or team changed meanwhile), else failed. */
export function manualWriteFailureOf(error: ManualWriteError): ManualWriteFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return MANUAL_DENIED;
  if (error.code === INVALID_PARAMETER) return MANUAL_STALE;

  return MANUAL_FAILED;
}

function countOf(data: unknown, key: string): number | null {
  if (typeof data !== 'object' || data === null) return null;

  const value = (data as Record<string, unknown>)[key];

  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Save `draft` through 0077's `save_personal_assignments`, every item in one
 * call. An empty draft or one of more than 0077 takes is {@link MANUAL_FAILED}
 * without a request; an answer that is not the three counts is
 * {@link MANUAL_FAILED} too. Failures are logged; a refusal's code is not a fault.
 */
export async function saveManualSchedule(client: ManualRpc, draft: ManualDraft): Promise<ManualWriteOutcome> {
  const items = draftItemsOf(draft);

  if (items.length === 0 || items.length > MANUAL_MAX_ITEMS) {
    console.error(MANUAL_FAILED, 'nothing to send, or too much');

    return { ok: false, code: MANUAL_FAILED };
  }

  let answered: ManualRpcAnswer;

  try {
    answered = await client.rpc(SAVE_PERSONAL_ASSIGNMENTS_FUNCTION, { p_changes: items });
  } catch (cause) {
    console.error(MANUAL_FAILED, cause);

    return { ok: false, code: MANUAL_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(MANUAL_FAILED, typeof answered);

    return { ok: false, code: MANUAL_FAILED };
  }

  const error: unknown = answered.error;

  if (error !== null) {
    if (typeof error !== 'object') {
      console.error(MANUAL_FAILED, typeof error);

      return { ok: false, code: MANUAL_FAILED };
    }

    const code = manualWriteFailureOf(error as ManualWriteError);

    if (code === MANUAL_FAILED) console.error(code, (error as ManualWriteError).code);

    return { ok: false, code };
  }

  const inserted = countOf(answered.data, 'inserted');
  const removed = countOf(answered.data, 'removed');
  const unchanged = countOf(answered.data, 'unchanged');

  if (inserted === null || removed === null || unchanged === null) {
    console.error(MANUAL_FAILED, 'not the three counts');

    return { ok: false, code: MANUAL_FAILED };
  }

  return { ok: true, saved: { inserted, removed, unchanged } };
}

// --------------------------------------------------------------- the messages

/** The alert a refusal says. */
export function manualRefusalMessageKey(
  code: ManualRefusal,
):
  | 'rucniRaspored.error.stale'
  | 'rucniRaspored.error.archived'
  | 'rucniRaspored.error.tooMany'
  | 'rucniRaspored.error.denied'
  | 'rucniRaspored.error.failed' {
  switch (code) {
    case MANUAL_STALE:
      return 'rucniRaspored.error.stale';
    case MANUAL_ARCHIVED:
      return 'rucniRaspored.error.archived';
    case MANUAL_TOO_MANY:
      return 'rucniRaspored.error.tooMany';
    case MANUAL_DENIED:
      return 'rucniRaspored.error.denied';
    case MANUAL_FAILED:
      return 'rucniRaspored.error.failed';
  }
}
