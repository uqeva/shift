/**
 * A member's calendar as RFC 5545 text (AD-20; D-S2, FR-81): the one
 * serializer of the feed (`calendar-feed`, story 16.4) and of the browser's
 * month download (16.5).
 *
 * It writes what it is given and decides nothing: the shifts are R12's
 * (`atWorkShiftsOf`), already projected over the window, and the names come
 * from the same assembly. Each event says only WHEN the member works and the
 * shift type and team it is: no description, location, attendee, organizer,
 * leave, absence type, hours or other member.
 *
 * A start or end whose local time falls in a DST gap or a repeated hour is
 * written as its nominal wall time (16.5): RFC 5545 §3.3.5 reads a skipped
 * time with the offset before the gap and a repeated one as its first
 * occurrence, which is `zone.ts`'s own `instantOf` rule, so a client and the
 * app place it at the same instant.
 */

import { daysBetween, type AtWorkShift, type ScheduleInputs } from '@shift/domain';

import { contentOf, escapeText } from './text.js';
import { localDateTimeOf, timeZoneLines, utcDateTimeOf } from './timezone.js';

/** The feed's UID domain: `<date>-<teamId>-<memberId>@shift`. */
export const FEED_UID_DOMAIN = 'shift';
/** The month download's (16.5): the same UIDs under another domain, so an import beside the feed duplicates, never collides. */
export const DOWNLOAD_UID_DOMAIN = 'shift-download';
export type UidDomain = typeof FEED_UID_DOMAIN | typeof DOWNLOAD_UID_DOMAIN;

/** The fixed product name a client shows as the calendar's name, never the URL. */
export const CALENDAR_NAME = 'Shift';
export const PRODUCT_ID = '-//Shift//calendar-feed//HR';
/** Between the shift type's name and the team's in an event's SUMMARY. */
export const SUMMARY_SEPARATOR = ' · ';
/**
 * How often a subscribing client is asked to poll the feed (AD-20, amended by
 * 16.5): `REFRESH-INTERVAL` (RFC 7986) and `X-PUBLISHED-TTL`, which Apple and
 * Outlook read. Google ignores both and polls on its own schedule. The feed
 * carries them; the month download, a one-off import, carries neither.
 */
export const REFRESH_INTERVAL = 'PT1H';

/** An IANA zone name as it may stand in a TZID: no character a parameter or value would have to quote. */
const ZONE_SHAPE = /^[A-Za-z0-9_+\-/]+$/;

export interface CalendarRequest {
  /** The assembly the shifts were projected from: its zone, its member, its teams' and shift types' names. */
  readonly inputs: Pick<ScheduleInputs, 'timeZone' | 'memberId' | 'teams' | 'shiftTypes'>;
  /** R12's shifts over `window`, in its order. */
  readonly shifts: readonly AtWorkShift[];
  /** The dates the shifts were projected over, both inclusive: the VTIMEZONE covers them. */
  readonly window: { readonly from: string; readonly to: string };
  /** `DTSTAMP`: the request instant, epoch milliseconds. */
  readonly stamp: number;
  readonly uidDomain: UidDomain;
}

/**
 * The calendar's text, CRLF line ends, folded at 75 octets.
 *
 * @throws RangeError when the zone is not one the runtime knows or not a
 *   plain IANA name, a window date is not a calendar date or the window is
 *   reversed, a shift starts outside the window, names a team or shift type
 *   the assembly does not, or repeats another's date and team (its UID).
 */
export function calendarOf(request: CalendarRequest): string {
  const { inputs, shifts, window, stamp, uidDomain } = request;
  const zone = inputs.timeZone;
  if (typeof zone !== 'string' || !ZONE_SHAPE.test(zone)) throw new RangeError(`the time zone is ${JSON.stringify(zone)}, not a plain IANA name`);

  const teamNames = new Map(inputs.teams.map((team) => [team.id, team.name]));
  const typeNames = new Map(inputs.shiftTypes.map((entry) => [entry.type.id, entry.type.name]));
  const stampText = utcDateTimeOf(stamp - (((stamp % 1000) + 1000) % 1000));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-TIMEZONE:${zone}`,
    ...(uidDomain === FEED_UID_DOMAIN
      ? [`REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`, `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`]
      : []),
    ...timeZoneLines(zone, window.from, window.to),
  ];

  const uids = new Set<string>();
  for (const shift of shifts) {
    if (daysBetween(window.from, shift.date) < 0 || daysBetween(shift.date, window.to) < 0) {
      throw new RangeError(`the shift on ${shift.date} starts outside the window ${window.from}–${window.to}`);
    }
    // Story 21.1: a Personal Shift counted with no team has its own UID and SUMMARY (AD-20 as amended), story
    // 21.2's. Until then it is left out, so one such shift never fails the member's whole feed or download.
    if (shift.teamId === null) continue;
    const team = teamNames.get(shift.teamId);
    if (team === undefined) throw new RangeError(`the shift on ${shift.date} names team ${shift.teamId}, which is not given`);
    const type = typeNames.get(shift.shiftTypeId);
    if (type === undefined) {
      throw new RangeError(`the shift on ${shift.date} names shift type ${shift.shiftTypeId}, which is not given`);
    }
    if (!(shift.endMinute > shift.startMinute)) {
      throw new RangeError(`the shift on ${shift.date} ends at ${String(shift.endMinute)}, not after its start`);
    }
    const uid = `${shift.date}-${shift.teamId}-${inputs.memberId}@${uidDomain}`;
    if (uids.has(uid)) throw new RangeError(`two shifts on ${shift.date} on team ${shift.teamId} would share one UID`);
    uids.add(uid);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stampText}`,
      `DTSTART;TZID=${zone}:${localDateTimeOf(shift.date, shift.startMinute)}`,
      `DTEND;TZID=${zone}:${localDateTimeOf(shift.date, shift.endMinute)}`,
      `SUMMARY:${escapeText(`${type}${SUMMARY_SEPARATOR}${team}`)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return contentOf(lines);
}
