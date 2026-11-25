import { atWorkShiftsOf } from '@shift/domain';
import { FEED_UID_DOMAIN, calendarOf, dateAfter } from '@shift/ics';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { scheduleInputsOfCalendar } from '@/features/calendar/services/schedule-inputs';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  ICS_MIME,
  MONTH_DOWNLOAD_EMPTY,
  MONTH_DOWNLOAD_LOADING,
  MONTH_DOWNLOAD_READY,
  MONTH_DOWNLOAD_REFUSED,
  MONTH_DOWNLOAD_UNAVAILABLE,
  boundedMonthOf,
  monthAfter,
  monthDownloadMessageKey,
  monthDownloadOf,
  monthDownloadReadinessOf,
  monthWithinReach,
  monthFileNameOf,
  monthWindowOf,
} from '@/features/calendar-feed/services/month-download';
import { leaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  loansAnswerOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * STORY 16.5: a month as a `.ics` file, R12 over the browser's own assembly
 * (AD-19) and the feed's own serializer (AD-20), on both fixtures (AD-15).
 */

const STAMP = Date.UTC(2026, 10, 21, 12, 34, 56, 789);
const COLLEAGUE = '00000000-0000-4000-8000-0000000000c1';

async function snapshotOf(rows: FixtureRows): Promise<CalendarSnapshot> {
  const first = rows.teams[0]?.['id'] as string;
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(first, SEEDED)])],
          versions: [memberMembershipRow(VIEWER_MEMBER, first, SEEDED), memberMembershipRow(COLLEAGUE, first, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(COLLEAGUE, 'Ana Anić')]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf([]),
    loansAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A `my_leave_records()` row of the viewer: `[from, to+1)`, a type, a flag, a half. */
const leaveRow = (id: string, from: string, toExclusive: string, extra: Record<string, unknown> = {}) => ({
  id,
  member_id: VIEWER_MEMBER,
  during: `[${from},${toExclusive})`,
  absence_type_id: 'sick-type',
  draws_allowance: false,
  half: null,
  ...extra,
});

const lines = (text: string): string[] => text.replaceAll('\r\n ', '').split('\r\n').slice(0, -1);

/** Each VEVENT's lines, unfolded. */
function eventsOf(text: string): string[][] {
  const unfolded = lines(text);
  const events: string[][] = [];
  unfolded.forEach((line, index) => {
    if (line === 'BEGIN:VEVENT') events.push(unfolded.slice(index, unfolded.indexOf('END:VEVENT', index) + 1));
  });
  return events;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the month', () => {
  it('runs from its first date to its last, February’s by the leap year', () => {
    expect(monthWindowOf('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthWindowOf('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthWindowOf('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthWindowOf('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthWindowOf('2100-02').to).toBe('2100-02-28');
    expect(monthWindowOf('2000-02').to).toBe('2000-02-29');
    for (const bad of ['2026-13', '2026-1', '26-01', '2026-11-01', '']) expect(() => monthWindowOf(bad), bad).toThrow(RangeError);
  });

  it('names the file by the product and the month, nothing personal, as text/calendar', () => {
    expect(monthFileNameOf('2026-11')).toBe('smjenko-2026-11.ics');
    expect(ICS_MIME).toBe('text/calendar;charset=utf-8');
  });
});

describe('the download (R12, D-S2)', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ] as const)('serializes the %s viewer’s working shifts of the month under the download’s UIDs, with no refresh hint', (_name, snapshot) => {
    const file = monthDownloadOf(snapshot(), [], '2026-10', STAMP);
    if (!file.ok) throw new Error(file.code);

    const shifts = atWorkShiftsOf(scheduleInputsOfCalendar(snapshot(), [], monthWindowOf('2026-10')), '2026-10-01', '2026-10-31');
    expect(shifts.length).toBeGreaterThan(0);
    expect(file.events).toBe(shifts.length);
    expect(file.fileName).toBe('smjenko-2026-10.ics');

    const events = eventsOf(file.text);
    expect(events).toHaveLength(shifts.length);
    for (const event of events) {
      expect(event.find((line) => line.startsWith('UID:'))).toMatch(new RegExp(`-${VIEWER_MEMBER}@shift-download$`));
      expect(event.find((line) => line.startsWith('DTSTART;TZID=Europe/Zagreb:202610'))).toBeDefined();
    }
    expect(file.text).not.toMatch(/REFRESH-INTERVAL|X-PUBLISHED-TTL|DESCRIPTION|LOCATION|ATTENDEE|ORGANIZER/);
    expect(file.text).not.toMatch(/Ana Anić|Lana|sick-type/);
  });

  it('drops a full leave day, keeps a half day’s worked half, and says neither', () => {
    const plain = monthDownloadOf(pilot, [], '2026-10', STAMP);
    if (!plain.ok) throw new Error(plain.code);
    const shifts = atWorkShiftsOf(scheduleInputsOfCalendar(pilot, [], monthWindowOf('2026-10')), '2026-10-01', '2026-10-31');
    const [full, half] = shifts;
    if (full === undefined || half === undefined) throw new Error('the pilot viewer works fewer than two shifts in October');

    const nextDate = (date: string) => dateAfter(date, 1);
    const rows = [leaveRow('l-full', full.date, nextDate(full.date)), leaveRow('l-half', half.date, nextDate(half.date), { half: 'FIRST' })];
    const file = monthDownloadOf(pilot, rows, '2026-10', STAMP);
    if (!file.ok) throw new Error(file.code);

    const compact = (date: string) => date.replaceAll('-', '');
    const starts = eventsOf(file.text).map((event) => event.find((line) => line.startsWith('DTSTART'))?.slice(-15) ?? '');
    expect(file.events).toBe(shifts.length - 1);
    expect(starts.some((start) => start.startsWith(compact(full.date)))).toBe(false);
    // The worked second half starts later than the whole shift would.
    const halfStart = starts.find((start) => start.startsWith(compact(half.date)) || start.startsWith(compact(nextDate(half.date))));
    expect(halfStart).toBeDefined();
    const wholeStart = `${compact(half.date)}T${String(Math.floor(half.startMinute / 60)).padStart(2, '0')}${String(half.startMinute % 60).padStart(2, '0')}00`;
    expect(halfStart).not.toBe(wholeStart);
    expect(file.text).not.toMatch(/l-full|l-half|odsutn|godišnj/i);
  });

  it('ends a night on the month’s last date on the next day', () => {
    // The month in 2026 whose last date the pilot viewer works a night.
    const month = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`).find((candidate) => {
      const window = monthWindowOf(candidate);
      return atWorkShiftsOf(scheduleInputsOfCalendar(pilot, [], window), window.from, window.to).some(
        (shift) => shift.date === window.to && shift.endMinute > 1440,
      );
    });
    if (month === undefined) throw new Error('the pilot viewer works no night on a month’s last date in 2026');

    const window = monthWindowOf(month);
    const file = monthDownloadOf(pilot, [], month, STAMP);
    if (!file.ok) throw new Error(file.code);
    const last = eventsOf(file.text).find((event) => event.some((line) => line.startsWith(`DTSTART;TZID=Europe/Zagreb:${window.to.replaceAll('-', '')}`)));
    const end = last?.find((line) => line.startsWith('DTEND'))?.slice(-15) ?? '';
    const nextFirst = dateAfter(window.to, 1).replaceAll('-', '');
    expect(end.startsWith(nextFirst)).toBe(true);
  });

  it('refuses, with no file, leave rows that are not the viewer’s and a month that is not one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(monthDownloadOf(pilot, [leaveRow('x', '2026-10-05', '2026-10-06', { member_id: COLLEAGUE })], '2026-10', STAMP)).toEqual({
      ok: false,
      code: MONTH_DOWNLOAD_REFUSED,
    });
    expect(monthDownloadOf(pilot, [], '2026-13', STAMP)).toEqual({ ok: false, code: MONTH_DOWNLOAD_REFUSED });
  });
});

describe('a month with nothing to download, the reach and the reads', () => {
  it('makes no file for a month whose every working day is on leave, and says so', () => {
    const window = monthWindowOf('2026-10');
    const file = monthDownloadOf(pilot, [leaveRow('l-all', window.from, '2026-11-01')], '2026-10', STAMP);
    expect(file).toEqual({ ok: false, code: MONTH_DOWNLOAD_EMPTY });
    expect(monthDownloadMessageKey(MONTH_DOWNLOAD_EMPTY)).toBe('feed.download.empty');
    expect(monthDownloadMessageKey(MONTH_DOWNLOAD_REFUSED)).toBe('feed.download.failed');
  });

  it('reaches twelve months either side of the current one, its ‹ › stopped at both ends', () => {
    expect(monthAfter('2026-11', 12)).toBe('2027-11');
    expect(monthAfter('2026-11', -12)).toBe('2025-11');
    expect(monthAfter('2026-01', -1)).toBe('2025-12');
    expect(monthWithinReach('2027-11', '2026-11')).toBe(true);
    expect(monthWithinReach('2027-12', '2026-11')).toBe(false);
    expect(monthWithinReach('2025-10', '2026-11')).toBe(false);
    const header = (month: string, previous: string, next: string) => ({ month, current: '2026-11', previous, next });
    expect(boundedMonthOf(header('2027-11', '2027-10', '2027-12'))).toMatchObject({ previous: '2027-10', next: null });
    expect(boundedMonthOf(header('2025-11', '2025-10', '2025-12'))).toMatchObject({ previous: null, next: '2025-12' });
    expect(boundedMonthOf(header('2026-11', '2026-10', '2026-12'))).toMatchObject({ previous: '2026-10', next: '2026-12' });
  });

  it('is ready with both reads held, unavailable when one failed or is paused offline with nothing held, else loading', () => {
    const held = { held: true, isError: false, fetchStatus: 'idle' };
    const paused = { held: false, isError: false, fetchStatus: 'paused' };
    const fetching = { held: false, isError: false, fetchStatus: 'fetching' };
    const failed = { held: false, isError: true, fetchStatus: 'idle' };
    expect(monthDownloadReadinessOf(held, held)).toBe(MONTH_DOWNLOAD_READY);
    expect(monthDownloadReadinessOf(held, paused)).toBe(MONTH_DOWNLOAD_UNAVAILABLE);
    expect(monthDownloadReadinessOf(paused, held)).toBe(MONTH_DOWNLOAD_UNAVAILABLE);
    expect(monthDownloadReadinessOf(failed, fetching)).toBe(MONTH_DOWNLOAD_UNAVAILABLE);
    expect(monthDownloadReadinessOf(fetching, held)).toBe(MONTH_DOWNLOAD_LOADING);
    // A held read paused offline is still held: the device builds the file.
    expect(monthDownloadReadinessOf({ ...held, fetchStatus: 'paused' }, held)).toBe(MONTH_DOWNLOAD_READY);
  });
});

describe('the download and the feed agree (AC: they differ only in the UID domain and DTSTAMP)', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ] as const)('writes the %s viewer’s events alike over the same dates', (_name, snapshot) => {
    const rows = [leaveRow('l1', '2026-10-06', '2026-10-08'), leaveRow('l2', '2026-10-15', '2026-10-16', { half: 'SECOND' })];
    const download = monthDownloadOf(snapshot(), rows, '2026-10', STAMP);
    if (!download.ok) throw new Error(download.code);

    // The feed's path: the same R12, through the same serializer, at another instant.
    const window = monthWindowOf('2026-10');
    const records = leaveRecordsOf(rows, VIEWER_MEMBER) ?? [];
    const inputs = scheduleInputsOfCalendar(snapshot(), records, window);
    const feed = calendarOf({
      inputs,
      shifts: atWorkShiftsOf(inputs, window.from, window.to),
      window,
      stamp: STAMP + 3_600_000,
      uidDomain: FEED_UID_DOMAIN,
    });

    const normalized = (text: string) =>
      eventsOf(text).map((event) =>
        event.filter((line) => !line.startsWith('DTSTAMP:')).map((line) => line.replace(/@shift(?:-download)?$/, '@<domain>')),
      );
    expect(eventsOf(download.text).length).toBeGreaterThan(0);
    expect(normalized(download.text)).toEqual(normalized(feed));
    // And they do differ in exactly those two.
    expect(eventsOf(download.text)[0]?.find((line) => line.startsWith('UID:'))).toMatch(/@shift-download$/);
    expect(eventsOf(feed)[0]?.find((line) => line.startsWith('UID:'))).toMatch(/@shift$/);
    expect(eventsOf(download.text)[0]?.find((line) => line.startsWith('DTSTAMP:'))).not.toBe(
      eventsOf(feed)[0]?.find((line) => line.startsWith('DTSTAMP:')),
    );
  });
});
