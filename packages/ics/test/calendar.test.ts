import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { atWorkShiftsOf, instantOf, type AtWorkShift, type ScheduleInputs } from '@shift/domain';

import { PARITY_FIXTURES, inputsOf } from '../../domain/parity/fixtures.js';
import {
  CALENDAR_NAME,
  CRLF,
  DOWNLOAD_UID_DOMAIN,
  FEED_UID_DOMAIN,
  REFRESH_INTERVAL,
  SUMMARY_SEPARATOR,
  calendarOf,
  type CalendarRequest,
} from '../src/index.js';

/**
 * AD-20's golden files. Each is the serializer's whole answer for a fixed
 * request, compared byte for byte. `UPDATE_GOLDEN=1` rewrites them; a
 * rewritten file is read by eye (and by an independent parser, spec
 * Verification) before it is committed.
 */
const golden = (name: string): string => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

function matchesGolden(name: string, text: string): void {
  if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(golden(name), text, 'utf8');
  expect(text).toBe(readFileSync(golden(name), 'utf8'));
}

/** The request instant every golden carries: 2026-11-21 12:34:56.789 UTC. */
const STAMP = Date.UTC(2026, 10, 21, 12, 34, 56, 789);

const MEMBER = '7d9f8a52-4c1e-4f7b-9a43-2b1d6e0c5f11';
const TEAM_A = '1a2b3c4d-0000-4000-8000-00000000000a';
const TEAM_B = '1a2b3c4d-0000-4000-8000-00000000000b';
const DAN = '5e6f7a8b-0000-4000-8000-0000000000d1';
const NOC = '5e6f7a8b-0000-4000-8000-0000000000e2';

/** Names that need escaping and folding: a comma, a semicolon, a backslash, Croatian letters, a long run. */
const NAMED: CalendarRequest['inputs'] = {
  timeZone: 'Europe/Zagreb',
  memberId: MEMBER,
  teams: [
    { id: TEAM_A, name: 'Smjena A', archived: false },
    { id: TEAM_B, name: 'Smjena B, Split; "Jug" \\ Dežurstvo čćđšž ŽĆČĐŠ Vatrogasna postrojba Kaštel Novi', archived: false },
  ],
  shiftTypes: [
    { type: { id: DAN, name: 'Dan', isWorking: true }, versions: [] },
    { type: { id: NOC, name: 'Noć', isWorking: true }, versions: [] },
  ],
};

const shift = (date: string, teamId: string, shiftTypeId: string, startMinute: number, endMinute: number, extra: Partial<AtWorkShift> = {}): AtWorkShift => ({
  date,
  teamId,
  shiftTypeId,
  startMinute,
  endMinute,
  viaOverride: false,
  ...extra,
});

const lines = (text: string): string[] => text.replaceAll(`${CRLF} `, '').split(CRLF).slice(0, -1);

describe('the calendar (AD-20, D-S2)', () => {
  it('serializes both DST transitions, nights crossing them, a half day and escaped, folded names (golden)', () => {
    const text = calendarOf({
      inputs: NAMED,
      window: { from: '2026-03-20', to: '2026-10-31' },
      stamp: STAMP,
      uidDomain: FEED_UID_DOMAIN,
      shifts: [
        shift('2026-03-20', TEAM_A, DAN, 420, 1140),
        // The night into the spring-forward date: 19:00 to 07:00 local.
        shift('2026-03-28', TEAM_A, NOC, 1140, 1860),
        shift('2026-03-29', TEAM_A, DAN, 420, 1140),
        // R12.2: the worked second half of a Dan, and of a Noć (starting past midnight).
        shift('2026-06-15', TEAM_A, DAN, 780, 1140, { workedHalf: 'SECOND' }),
        shift('2026-06-16', TEAM_A, NOC, 1500, 1860, { workedHalf: 'SECOND' }),
        // On a loan, on a team whose name needs every escape and a fold.
        shift('2026-07-01', TEAM_B, DAN, 420, 1140, { loanId: 'loan-1' }),
        // The night into the fall-back date: 19:00 to 07:00 local, 13 hours elapsed.
        shift('2026-10-24', TEAM_A, NOC, 1140, 1860),
        shift('2026-10-25', TEAM_A, DAN, 420, 1140),
        // The window's last date: its night ends the day after.
        shift('2026-10-31', TEAM_A, NOC, 1140, 1860),
      ],
    });
    matchesGolden('zagreb-named.ics', text);

    const unfolded = lines(text);
    expect(unfolded.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(9);
    expect(unfolded).toContain(`UID:2026-03-28-${TEAM_A}-${MEMBER}@shift`);
    expect(unfolded).toContain('DTSTART;TZID=Europe/Zagreb:20260328T190000');
    expect(unfolded).toContain('DTEND;TZID=Europe/Zagreb:20260329T070000');
    expect(unfolded).toContain('DTSTART;TZID=Europe/Zagreb:20260617T010000');
    expect(unfolded).toContain(`SUMMARY:Noć${SUMMARY_SEPARATOR}Smjena A`);
    expect(unfolded).toContain(
      'SUMMARY:Dan · Smjena B\\, Split\\; "Jug" \\\\ Dežurstvo čćđšž ŽĆČĐŠ Vatrogasna postrojba Kaštel Novi',
    );
    expect(unfolded.filter((line) => line.startsWith('DTSTAMP:'))).toEqual(Array(9).fill('DTSTAMP:20261121T123456Z'));
    for (const line of text.split(CRLF)) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('holds the calendar properties and nothing an event must not carry (FR-81)', () => {
    const text = calendarOf({
      inputs: NAMED,
      window: { from: '2026-11-01', to: '2026-11-30' },
      stamp: STAMP,
      uidDomain: FEED_UID_DOMAIN,
      shifts: [shift('2026-11-02', TEAM_A, DAN, 420, 1140)],
    });
    const unfolded = lines(text);
    expect(unfolded.slice(0, 11)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Shift//calendar-feed//HR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `NAME:${CALENDAR_NAME}`,
      `X-WR-CALNAME:${CALENDAR_NAME}`,
      'X-WR-TIMEZONE:Europe/Zagreb',
      // AD-20 amended by 16.5: the poll hints, the feed's alone.
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
      'BEGIN:VTIMEZONE',
    ]);
    expect(REFRESH_INTERVAL).toBe('PT1H');
    expect(unfolded.at(-1)).toBe('END:VCALENDAR');
    expect(text).not.toMatch(/DESCRIPTION|LOCATION|ATTENDEE|ORGANIZER|RRULE|URL[:;]/);
    const event = unfolded.slice(unfolded.indexOf('BEGIN:VEVENT'), unfolded.indexOf('END:VEVENT') + 1);
    expect(event.map((line) => line.split(/[:;]/)[0])).toEqual(['BEGIN', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'END']);
  });

  it('writes an empty calendar with its VTIMEZONE when the member works no shift', () => {
    const text = calendarOf({ inputs: NAMED, window: { from: '2026-11-01', to: '2026-11-30' }, stamp: STAMP, uidDomain: FEED_UID_DOMAIN, shifts: [] });
    expect(text).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Zagreb\r\n');
    expect(text).not.toContain('BEGIN:VEVENT');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('leaves out a Personal Shift counted with no team until its own UID form (story 21.1; AD-20 as amended, story 21.2)', () => {
    const window = { from: '2026-11-01', to: '2026-11-30' };
    const kept = shift('2026-11-03', TEAM_A, DAN, 420, 1140);
    const teamless: AtWorkShift = { ...shift('2026-11-04', TEAM_A, DAN, 420, 1140), teamId: null, personalAssignmentId: 'a-1' };
    const both = calendarOf({ inputs: NAMED, window, stamp: STAMP, uidDomain: FEED_UID_DOMAIN, shifts: [kept, teamless] });
    expect(both).toBe(calendarOf({ inputs: NAMED, window, stamp: STAMP, uidDomain: FEED_UID_DOMAIN, shifts: [kept] }));
  });

  it('gives a zone without daylight saving one constant observance (golden)', () => {
    matchesGolden(
      'tokyo.ics',
      calendarOf({
        inputs: { ...NAMED, timeZone: 'Asia/Tokyo', teams: [NAMED.teams[0] ?? { id: '', name: '', archived: false }] },
        window: { from: '2026-01-01', to: '2026-01-31' },
        stamp: STAMP,
        uidDomain: FEED_UID_DOMAIN,
        shifts: [shift('2026-01-05', TEAM_A, NOC, 1260, 1860)],
      }),
    );
  });

  it('keeps the UID stable per member, date and team, and moves only the domain for the download', () => {
    const request = {
      inputs: NAMED,
      window: { from: '2026-11-01', to: '2026-11-30' },
      shifts: [shift('2026-11-02', TEAM_A, DAN, 420, 1140)],
    };
    const first = lines(calendarOf({ ...request, stamp: STAMP, uidDomain: FEED_UID_DOMAIN }));
    const later = lines(calendarOf({ ...request, stamp: STAMP + 86_400_000, uidDomain: FEED_UID_DOMAIN }));
    const uid = (text: string[]) => text.find((line) => line.startsWith('UID:'));
    expect(uid(later)).toBe(uid(first));
    expect(uid(first)).toBe(`UID:2026-11-02-${TEAM_A}-${MEMBER}@shift`);
    expect(uid(lines(calendarOf({ ...request, stamp: STAMP, uidDomain: DOWNLOAD_UID_DOMAIN })))).toBe(
      `UID:2026-11-02-${TEAM_A}-${MEMBER}@shift-download`,
    );
  });

  it('gives the month download (16.5) no refresh hints: a one-off import, not a subscription', () => {
    const request = {
      inputs: NAMED,
      window: { from: '2026-11-01', to: '2026-11-30' },
      stamp: STAMP,
      shifts: [shift('2026-11-02', TEAM_A, DAN, 420, 1140)],
    };
    const feed = lines(calendarOf({ ...request, uidDomain: FEED_UID_DOMAIN }));
    const download = lines(calendarOf({ ...request, uidDomain: DOWNLOAD_UID_DOMAIN }));
    expect(download.join('\n')).not.toMatch(/REFRESH-INTERVAL|X-PUBLISHED-TTL/);
    expect(download[8]).toBe('BEGIN:VTIMEZONE');
    // The same calendar otherwise, line for line, but the UIDs' domain.
    expect(feed.filter((line) => !/^(?:REFRESH-INTERVAL|X-PUBLISHED-TTL)[:;]/.test(line))).toEqual(
      download.map((line) => line.replace('@shift-download', '@shift')),
    );
  });

  it('writes a start in a DST gap or a repeated hour as its nominal wall time, which a client reads as zone.ts does (16.5)', () => {
    // 2026-03-29 02:30 never happens in Zagreb (02:00 → 03:00); 2026-10-25 02:30 happens twice.
    const text = calendarOf({
      inputs: NAMED,
      window: { from: '2026-03-01', to: '2026-10-31' },
      stamp: STAMP,
      uidDomain: FEED_UID_DOMAIN,
      shifts: [shift('2026-03-29', TEAM_A, DAN, 150, 600), shift('2026-10-25', TEAM_A, DAN, 150, 600)],
    });
    const unfolded = lines(text);
    expect(unfolded).toContain('DTSTART;TZID=Europe/Zagreb:20260329T023000');
    expect(unfolded).toContain('DTSTART;TZID=Europe/Zagreb:20261025T023000');
    // RFC 5545 §3.3.5: a skipped time takes the offset before the gap (+01:00,
    // so 01:30Z); a repeated one is its first occurrence (+02:00, so 00:30Z).
    // The app's one conversion says the same instants.
    expect(instantOf('2026-03-29', 150, 'Europe/Zagreb')).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(instantOf('2026-10-25', 150, 'Europe/Zagreb')).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('refuses what R12 never gives: a shift outside the window, an unknown team or type, a repeated UID, a reversed interval', () => {
    const base = { inputs: NAMED, window: { from: '2026-11-01', to: '2026-11-30' }, stamp: STAMP, uidDomain: FEED_UID_DOMAIN } as const;
    for (const shifts of [
      [shift('2026-10-31', TEAM_A, DAN, 420, 1140)],
      [shift('2026-12-01', TEAM_A, DAN, 420, 1140)],
      [shift('2026-11-02', 'no-such-team', DAN, 420, 1140)],
      [shift('2026-11-02', TEAM_A, 'no-such-type', 420, 1140)],
      [shift('2026-11-02', TEAM_A, DAN, 420, 1140), shift('2026-11-02', TEAM_A, NOC, 1140, 1860)],
      [shift('2026-11-02', TEAM_A, DAN, 1140, 1140)],
    ]) {
      expect(() => calendarOf({ ...base, shifts })).toThrow(RangeError);
    }
    expect(() => calendarOf({ ...base, inputs: { ...NAMED, timeZone: 'Europe/Zagreb;X' }, shifts: [] })).toThrow(RangeError);
    expect(() => calendarOf({ ...base, inputs: { ...NAMED, timeZone: 'Mars/Olympus' }, shifts: [] })).toThrow(RangeError);
  });
});

/**
 * A reader of the FILE alone, independent of the serializer's code: it takes
 * the VTIMEZONE's observances as written and resolves each event's local
 * DTSTART/DTEND to a UTC instant the way a client does (the last observance
 * whose onset is at or before the local time; its TZOFFSETTO). The instant is
 * then formatted back in the zone through Node's own `Intl` (the tz
 * database), which must read the same wall clock.
 */
function eventsAsAClientReadsThem(text: string): { start: number; end: number; local: [string, string] }[] {
  const unfolded = lines(text);
  const toMs = (basic: string): number =>
    Date.UTC(
      Number(basic.slice(0, 4)),
      Number(basic.slice(4, 6)) - 1,
      Number(basic.slice(6, 8)),
      Number(basic.slice(9, 11)),
      Number(basic.slice(11, 13)),
      Number(basic.slice(13, 15)),
    );
  const offsetMs = (value: string): number =>
    (value.startsWith('-') ? -1 : 1) * (Number(value.slice(1, 3)) * 60 + Number(value.slice(3, 5))) * 60_000;
  const observances: { onsetLocal: number; from: number; to: number }[] = [];
  for (let index = 0; index < unfolded.length; index += 1) {
    if (unfolded[index] === 'BEGIN:STANDARD' || unfolded[index] === 'BEGIN:DAYLIGHT') {
      const value = (key: string) => unfolded.slice(index, index + 5).find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1) ?? '';
      observances.push({ onsetLocal: toMs(value('DTSTART')), from: offsetMs(value('TZOFFSETFROM')), to: offsetMs(value('TZOFFSETTO')) });
    }
  }
  const resolve = (basic: string): number => {
    const local = toMs(basic);
    // The onset is local in the offset it leaves, so compare instants.
    const inForce = observances.filter((observance) => observance.onsetLocal - observance.from <= local - observance.to).at(-1);
    if (inForce === undefined) throw new Error(`no observance covers ${basic}`);
    return local - inForce.to;
  };
  const events: { start: number; end: number; local: [string, string] }[] = [];
  for (const line of unfolded) {
    if (line.startsWith('DTSTART;TZID=')) events.push({ start: resolve(line.slice(-15)), end: 0, local: [line.slice(-15), ''] });
    if (line.startsWith('DTEND;TZID=')) {
      const last = events.at(-1);
      if (last !== undefined) {
        last.end = resolve(line.slice(-15));
        last.local[1] = line.slice(-15);
      }
    }
  }
  return events;
}

function wallClockIn(zone: string, instant: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}T${part('hour')}${part('minute')}${part('second')}`;
}

describe('the golden files as a client reads them (AD-20)', () => {
  it('resolves the nights across both transitions to the instants Zagreb’s clock means', () => {
    const events = eventsAsAClientReadsThem(readFileSync(golden('zagreb-named.ics'), 'utf8'));
    const byStart = new Map(events.map((event) => [event.local[0], event]));
    // Spring: 19:00 CET to 07:00 CEST is 18:00Z to 05:00Z, eleven hours.
    expect(byStart.get('20260328T190000')).toMatchObject({ start: Date.UTC(2026, 2, 28, 18), end: Date.UTC(2026, 2, 29, 5) });
    // Autumn: 19:00 CEST to 07:00 CET is 17:00Z to 06:00Z, thirteen hours.
    expect(byStart.get('20261024T190000')).toMatchObject({ start: Date.UTC(2026, 9, 24, 17), end: Date.UTC(2026, 9, 25, 6) });
    // The worked second half of a summer night starts at 01:00 CEST, 23:00Z the day before.
    expect(byStart.get('20260617T010000')?.start).toBe(Date.UTC(2026, 5, 16, 23));
  });

  it('agrees with the tz database for every event of every golden file', () => {
    for (const [name, zone] of [
      ['zagreb-named.ics', 'Europe/Zagreb'],
      ['parity-pilot.ics', 'Europe/Zagreb'],
      ['tokyo.ics', 'Asia/Tokyo'],
    ] as const) {
      const events = eventsAsAClientReadsThem(readFileSync(golden(name), 'utf8'));
      expect(events.length, name).toBeGreaterThan(0);
      for (const event of events) {
        expect(wallClockIn(zone, event.start), `${name} ${event.local[0]}`).toBe(event.local[0]);
        expect(wallClockIn(zone, event.end), `${name} ${event.local[1]}`).toBe(event.local[1]);
        expect(event.end, `${name} ${event.local[0]}`).toBeGreaterThan(event.start);
      }
    }
  });
});

describe('the calendar of R12 over both parity fixtures (AD-15)', () => {
  const WINDOW = { from: '2026-03-20', to: '2026-10-31' };

  it('writes one VEVENT per at-work shift for every member, and only what R12 holds', () => {
    let events = 0;
    for (const { organization } of PARITY_FIXTURES) {
      for (const member of organization.members) {
        const inputs = inputsOf(organization, member.id) as unknown as ScheduleInputs;
        const shifts = atWorkShiftsOf(inputs, WINDOW.from, WINDOW.to);
        const text = calendarOf({ inputs, shifts, window: WINDOW, stamp: STAMP, uidDomain: FEED_UID_DOMAIN });
        const unfolded = lines(text);
        expect(unfolded.filter((line) => line === 'BEGIN:VEVENT'), member.id).toHaveLength(shifts.length);
        const uids = unfolded.filter((line) => line.startsWith('UID:'));
        expect(new Set(uids).size).toBe(uids.length);
        events += shifts.length;
      }
    }
    expect(events, 'the fixtures put nobody at work').toBeGreaterThan(100);
  });

  it('serializes the pilot member with a loan, overrides and both halves across the transitions (golden)', () => {
    const pilot = PARITY_FIXTURES[0]?.organization;
    if (pilot === undefined) throw new Error('no pilot fixture');
    // The member the fixture gives the most kinds of exception.
    const ranked = pilot.members
      .map((member) => {
        const inputs = inputsOf(pilot, member.id) as unknown as ScheduleInputs;
        const shifts = atWorkShiftsOf(inputs, WINDOW.from, WINDOW.to);
        const kinds = new Set(shifts.flatMap((one) => [one.loanId ? 'loan' : '', one.viaOverride ? 'override' : '', one.workedHalf ?? '', one.endMinute > 1440 ? 'night' : '']));
        return { inputs, shifts, score: kinds.size };
      })
      .sort((left, right) => right.score - left.score);
    const chosen = ranked[0];
    if (chosen === undefined) throw new Error('no pilot member');
    matchesGolden(
      'parity-pilot.ics',
      calendarOf({ inputs: chosen.inputs, shifts: chosen.shifts, window: WINDOW, stamp: STAMP, uidDomain: FEED_UID_DOMAIN }),
    );
  });
});
