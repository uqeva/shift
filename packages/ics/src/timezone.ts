/**
 * The calendar's one VTIMEZONE (AD-20), and the wall-clock forms its lines
 * are written in, all from the domain's `zone.ts` (AD-6): this package names
 * neither `Intl` nor the built-in date object, and converts no local time to
 * an instant of its own.
 *
 * THE OBSERVANCES. One `STANDARD` or `DAYLIGHT` observance per offset
 * transition, each with an explicit `DTSTART`, `TZOFFSETFROM` and
 * `TZOFFSETTO` and no `RRULE`: from the last transition at or before the
 * window's first instant (looked for up to {@link TRANSITION_LOOKBACK_DAYS}
 * back) through the last one before the end of the day after the window, so a
 * night shift starting on the window's last date has its end covered too. A
 * zone with none in that reach (no daylight saving) gets one `STANDARD`
 * observance at its offset, from 1970. An observance is `DAYLIGHT` when its
 * transition raises the offset, `STANDARD` otherwise.
 *
 * An observance's `DTSTART` is the local time just before its transition, in
 * the offset it leaves (RFC 5545 §3.6.5): Zagreb's spring transition at
 * 01:00Z is `20260329T020000`, its autumn one `20261025T030000`.
 */

import { daysBetween, instantOf, offsetMinutesAt, utcIsoOf, zoneTransitionsOf } from '@shift/domain';

const EPOCH = '1970-01-01';
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 1440 * MS_PER_MINUTE;

/** How far before the window the opening transition is looked for: a year and a day. */
export const TRANSITION_LOOKBACK_DAYS = 366;

/** The `DTSTART` of the one observance of a zone with no transition in reach. */
export const CONSTANT_OFFSET_START = '19700101T000000';

/** `YYYY-MM-DDTHH:MM:SSZ` as RFC 5545's basic form, `YYYYMMDDTHHMMSS` (no zone letter). */
function basicOf(iso: string): string {
  return iso.slice(0, 19).replace(/[-:]/g, '');
}

/** `date` moved by `days` (negative: earlier). */
export function dateAfter(date: string, days: number): string {
  return utcIsoOf((daysBetween(EPOCH, date) + days) * MS_PER_DAY).slice(0, 10);
}

/**
 * The wall-clock date-time `minute` minutes after the start of `date`, in the
 * basic form (`20261025T190000`): nominal arithmetic over a civil day, no
 * zone involved. `minute` may run into the next date (DI-5).
 */
export function localDateTimeOf(date: string, minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute >= 2 * 1440) {
    throw new RangeError(`the local minute is ${String(minute)}, not a whole minute in 0–2879`);
  }
  return basicOf(utcIsoOf(daysBetween(EPOCH, date) * MS_PER_DAY + minute * MS_PER_MINUTE));
}

/** An instant as a UTC date-time to the second (`20261121T121314Z`), as `DTSTAMP` takes it. */
export function utcDateTimeOf(instant: number): string {
  return `${basicOf(utcIsoOf(instant))}Z`;
}

/** An offset in minutes east of UTC as a UTC-OFFSET value: `+0100`, `-0330`, seconds only when not whole minutes. */
export function utcOffsetOf(minutes: number): string {
  if (!Number.isFinite(minutes)) throw new RangeError(`the offset is ${String(minutes)} minutes`);
  const seconds = Math.round(Math.abs(minutes) * 60);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const sign = minutes < 0 ? '-' : '+';
  const hours = Math.floor(seconds / 3600);
  const rest = seconds % 60;
  return `${sign}${pad(hours)}${pad(Math.floor(seconds / 60) % 60)}${rest === 0 ? '' : pad(rest)}`;
}

export type ObservanceKind = 'STANDARD' | 'DAYLIGHT';

/** One observance of the VTIMEZONE: its local start, and the offsets either side. */
export interface Observance {
  readonly kind: ObservanceKind;
  /** Local date-time, basic form, in the offset it leaves. */
  readonly start: string;
  readonly offsetFromMinutes: number;
  readonly offsetToMinutes: number;
}

/**
 * The observances that cover every local time of the window `from`–`to`
 * (inclusive) and the day after it, in order.
 *
 * @throws RangeError when a date is not a calendar date, `to` is before
 *   `from`, or `zone` is not one the runtime knows.
 */
export function observancesOf(zone: string, from: string, to: string): readonly Observance[] {
  if (daysBetween(from, to) < 0) throw new RangeError(`the window ${from}–${to} ends before it starts`);
  const windowStart = instantOf(from, 0, zone);
  const transitions = zoneTransitionsOf(zone, dateAfter(from, -TRANSITION_LOOKBACK_DAYS), dateAfter(to, 1));
  const opening = transitions.filter((transition) => transition.instant <= windowStart).at(-1);
  const inside = transitions.filter((transition) => transition.instant > windowStart);

  const observances: Observance[] = [];
  if (opening === undefined) {
    const offset = offsetMinutesAt(windowStart, zone);
    observances.push({ kind: 'STANDARD', start: CONSTANT_OFFSET_START, offsetFromMinutes: offset, offsetToMinutes: offset });
  }
  for (const transition of opening === undefined ? inside : [opening, ...inside]) {
    observances.push({
      kind: transition.offsetToMinutes > transition.offsetFromMinutes ? 'DAYLIGHT' : 'STANDARD',
      start: basicOf(utcIsoOf(transition.instant + transition.offsetFromMinutes * MS_PER_MINUTE)),
      offsetFromMinutes: transition.offsetFromMinutes,
      offsetToMinutes: transition.offsetToMinutes,
    });
  }
  return observances;
}

/** The VTIMEZONE component's content lines, unfolded. */
export function timeZoneLines(zone: string, from: string, to: string): readonly string[] {
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${zone}`,
    ...observancesOf(zone, from, to).flatMap((observance) => [
      `BEGIN:${observance.kind}`,
      `DTSTART:${observance.start}`,
      `TZOFFSETFROM:${utcOffsetOf(observance.offsetFromMinutes)}`,
      `TZOFFSETTO:${utcOffsetOf(observance.offsetToMinutes)}`,
      `END:${observance.kind}`,
    ]),
    'END:VTIMEZONE',
  ];
}
