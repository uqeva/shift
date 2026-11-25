import { atWorkShiftsOf } from '@shift/domain';
import { DOWNLOAD_UID_DOMAIN, calendarOf } from '@shift/ics';

import { scheduleInputsOfCalendar, type ScheduleWindow } from '@/features/calendar/services/schedule-inputs';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { leaveRecordsOf } from '@/features/leave/services/leave-list';

/**
 * A month as a `.ics` file (story 16.5; AD-20): the viewer's own at-work
 * shifts (R12) over one calendar month, serialized by the feed's own
 * `calendarOf` under {@link DOWNLOAD_UID_DOMAIN}, so an import beside a
 * subscription duplicates and never collides. No second serializer and no
 * second projection: the browser's one adapter (`scheduleInputsOfCalendar`,
 * AD-19) over the calendar snapshot and the viewer's own live leave, then
 * `atWorkShiftsOf` (R12.3), exactly what the feed's function does with the
 * server's assembly. Pure: the instant is a parameter.
 *
 * Only the viewer's own working shifts are in it, a full leave day dropped and
 * a half day's worked half kept, with no leave, absence type or other member
 * (D-S2). A night on the month's last date ends on the next day.
 */

/** `text/calendar`, as the feed answers. */
export const ICS_MIME = 'text/calendar;charset=utf-8';

/** The month could not be assembled or serialized: the viewer's leave did not parse, or a precondition refused. */
export const MONTH_DOWNLOAD_REFUSED = 'MONTH_DOWNLOAD_REFUSED';
/** The viewer works no shift that month: no file is made. */
export const MONTH_DOWNLOAD_EMPTY = 'MONTH_DOWNLOAD_EMPTY';

export type MonthDownloadFailure = typeof MONTH_DOWNLOAD_REFUSED | typeof MONTH_DOWNLOAD_EMPTY;

export type MonthDownload =
  | { readonly ok: true; readonly fileName: string; readonly text: string; readonly events: number }
  | { readonly ok: false; readonly code: MonthDownloadFailure };

/** How far the month control reaches either side of the current month. */
export const MONTH_DOWNLOAD_REACH = 12;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A `YYYY-MM` month's first and last date. @throws RangeError for anything else. */
export function monthWindowOf(month: string): ScheduleWindow {
  const match = MONTH.exec(month);

  if (match === null) throw new RangeError(`${month} is not a YYYY-MM month`);

  const year = Number(match[1]);
  const index = Number(match[2]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index - 1] ?? 31;

  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}` };
}

/** `smjenko-2026-11.ics`: the product's name and the month, nothing personal (the name since story 21.24). */
export function monthFileNameOf(month: string): string {
  return `smjenko-${month}.ics`;
}

/**
 * The viewer's `month` as a calendar file, from the snapshot and the raw rows
 * `my_leave_records()` answered. Never throws: a row that does not parse as
 * the viewer's, or an assembly the domain refuses, is the refusal, and a month
 * with no working shift is empty; neither makes a file.
 */
export function monthDownloadOf(
  snapshot: CalendarSnapshot,
  ownLeaveRows: readonly unknown[],
  month: string,
  now: number,
): MonthDownload {
  try {
    const window = monthWindowOf(month);
    const leave = leaveRecordsOf(ownLeaveRows, snapshot.viewer.memberId);

    if (leave === null) return { ok: false, code: MONTH_DOWNLOAD_REFUSED };

    const inputs = scheduleInputsOfCalendar(snapshot, leave, window);
    const shifts = atWorkShiftsOf(inputs, window.from, window.to);
    if (shifts.length === 0) return { ok: false, code: MONTH_DOWNLOAD_EMPTY };

    const text = calendarOf({ inputs, shifts, window, stamp: now, uidDomain: DOWNLOAD_UID_DOMAIN });

    return { ok: true, fileName: monthFileNameOf(month), text, events: shifts.length };
  } catch (cause) {
    // The kind only: a precondition's message names dates and ids.
    console.error(MONTH_DOWNLOAD_REFUSED, cause instanceof RangeError ? 'precondition' : 'unexpected');

    return { ok: false, code: MONTH_DOWNLOAD_REFUSED };
  }
}

/** The `YYYY-MM` `count` months after `month` (before, when negative). */
export function monthAfter(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const index = year * 12 + Number(month.slice(5, 7)) - 1 + count;

  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Whether `month` is within {@link MONTH_DOWNLOAD_REACH} months of `current`. */
export function monthWithinReach(month: string, current: string): boolean {
  return month >= monthAfter(current, -MONTH_DOWNLOAD_REACH) && month <= monthAfter(current, MONTH_DOWNLOAD_REACH);
}

/** A month header with its ‹ › stopped at the reach's two ends. */
export function boundedMonthOf<T extends { readonly current: string; readonly previous: string | null; readonly next: string | null }>(
  header: T,
): T {
  const within = (month: string | null) => (month !== null && monthWithinReach(month, header.current) ? month : null);

  return { ...header, previous: within(header.previous), next: within(header.next) };
}

export const MONTH_DOWNLOAD_READY = 'ready';
export const MONTH_DOWNLOAD_LOADING = 'loading';
export const MONTH_DOWNLOAD_UNAVAILABLE = 'unavailable';

/** One read the download stands on, as TanStack answers it. */
export interface MonthDownloadRead {
  readonly held: boolean;
  readonly isError: boolean;
  /** `paused`: offline with nothing on the device — it will not answer until the connection returns. */
  readonly fetchStatus: string;
}

/**
 * Whether the download can build: both reads held; unavailable when either
 * failed or is paused offline with nothing held (never a button disabled for
 * good); otherwise still loading.
 */
export function monthDownloadReadinessOf(
  snapshot: MonthDownloadRead,
  leave: MonthDownloadRead,
): typeof MONTH_DOWNLOAD_READY | typeof MONTH_DOWNLOAD_LOADING | typeof MONTH_DOWNLOAD_UNAVAILABLE {
  if (snapshot.held && leave.held) return MONTH_DOWNLOAD_READY;
  const stuck = (read: MonthDownloadRead) => !read.held && (read.isError || read.fetchStatus === 'paused');

  return stuck(snapshot) || stuck(leave) ? MONTH_DOWNLOAD_UNAVAILABLE : MONTH_DOWNLOAD_LOADING;
}

/** What a download that made no file says. */
export function monthDownloadMessageKey(code: MonthDownloadFailure): 'feed.download.empty' | 'feed.download.failed' {
  return code === MONTH_DOWNLOAD_EMPTY ? 'feed.download.empty' : 'feed.download.failed';
}

