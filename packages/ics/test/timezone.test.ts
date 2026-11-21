import { describe, expect, it } from 'vitest';

import {
  CONSTANT_OFFSET_START,
  dateAfter,
  localDateTimeOf,
  observancesOf,
  timeZoneLines,
  utcDateTimeOf,
  utcOffsetOf,
} from '../src/index.js';

describe('the wall-clock forms', () => {
  it('writes a local date-time as nominal minutes over the start date, a night ending on the next date (DI-5)', () => {
    expect(localDateTimeOf('2026-10-24', 1140)).toBe('20261024T190000');
    expect(localDateTimeOf('2026-10-24', 1860)).toBe('20261025T070000');
    expect(localDateTimeOf('2026-12-31', 1500)).toBe('20270101T010000');
    expect(localDateTimeOf('2028-02-28', 1440)).toBe('20280229T000000');
    expect(() => localDateTimeOf('2026-10-24', 2880)).toThrow(RangeError);
    expect(() => localDateTimeOf('2026-10-24', 1.5)).toThrow(RangeError);
    expect(() => localDateTimeOf('2026-02-30', 0)).toThrow(RangeError);
  });

  it('writes DTSTAMP in UTC to the second, and offsets with a sign', () => {
    expect(utcDateTimeOf(Date.UTC(2026, 10, 21, 12, 34, 56))).toBe('20261121T123456Z');
    expect(utcOffsetOf(60)).toBe('+0100');
    expect(utcOffsetOf(120)).toBe('+0200');
    expect(utcOffsetOf(0)).toBe('+0000');
    expect(utcOffsetOf(-210)).toBe('-0330');
    expect(utcOffsetOf(345)).toBe('+0545');
    expect(utcOffsetOf(60.5)).toBe('+010030');
  });

  it('moves a date by days across months and years', () => {
    expect(dateAfter('2026-03-01', -366)).toBe('2025-02-28');
    expect(dateAfter('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('the observances (AD-20, from zone.ts)', () => {
  it('opens Zagreb’s window with the last transition before it, then each inside, each local in the offset it leaves', () => {
    expect(observancesOf('Europe/Zagreb', '2026-03-20', '2026-10-31')).toEqual([
      { kind: 'STANDARD', start: '20251026T030000', offsetFromMinutes: 120, offsetToMinutes: 60 },
      { kind: 'DAYLIGHT', start: '20260329T020000', offsetFromMinutes: 60, offsetToMinutes: 120 },
      { kind: 'STANDARD', start: '20261025T030000', offsetFromMinutes: 120, offsetToMinutes: 60 },
    ]);
  });

  it('covers the day after the window, where a night starting on its last date ends', () => {
    // The window ends the day before the autumn transition: the observance
    // in force when that night ends is still included.
    expect(observancesOf('Europe/Zagreb', '2026-06-01', '2026-10-24').map((observance) => observance.start)).toEqual([
      '20260329T020000',
      '20261025T030000',
    ]);
  });

  it('gives a zone without daylight saving one STANDARD observance at its offset, from 1970', () => {
    expect(observancesOf('Asia/Tokyo', '2026-01-01', '2026-07-31')).toEqual([
      { kind: 'STANDARD', start: CONSTANT_OFFSET_START, offsetFromMinutes: 540, offsetToMinutes: 540 },
    ]);
    expect(observancesOf('UTC', '2026-01-01', '2026-01-31')).toEqual([
      { kind: 'STANDARD', start: CONSTANT_OFFSET_START, offsetFromMinutes: 0, offsetToMinutes: 0 },
    ]);
  });

  it('reads the southern hemisphere and the Americas by the direction of the change', () => {
    expect(observancesOf('Australia/Sydney', '2026-03-01', '2026-10-31')).toEqual([
      { kind: 'DAYLIGHT', start: '20251005T020000', offsetFromMinutes: 600, offsetToMinutes: 660 },
      { kind: 'STANDARD', start: '20260405T030000', offsetFromMinutes: 660, offsetToMinutes: 600 },
      { kind: 'DAYLIGHT', start: '20261004T020000', offsetFromMinutes: 600, offsetToMinutes: 660 },
    ]);
    expect(observancesOf('America/New_York', '2026-01-01', '2026-12-31').map((observance) => [observance.kind, observance.start])).toEqual([
      ['STANDARD', '20251102T020000'],
      ['DAYLIGHT', '20260308T020000'],
      ['STANDARD', '20261101T020000'],
    ]);
  });

  it('refuses an unknown zone and a reversed window', () => {
    expect(() => observancesOf('Mars/Olympus', '2026-01-01', '2026-01-31')).toThrow(RangeError);
    expect(() => observancesOf('Europe/Zagreb', '2026-02-01', '2026-01-31')).toThrow(RangeError);
  });

  it('writes the VTIMEZONE with explicit observances and no RRULE', () => {
    const lines = timeZoneLines('Europe/Zagreb', '2026-11-01', '2026-11-30');
    expect(lines).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Zagreb',
      'BEGIN:STANDARD',
      'DTSTART:20261025T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
    expect(lines.join('\n')).not.toMatch(/RRULE|RDATE/);
  });
});
