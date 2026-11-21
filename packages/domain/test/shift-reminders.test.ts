import { describe, expect, it } from 'vitest';

import {
  REMINDER_WINDOW_AFTER_MS,
  REMINDER_WINDOW_BEFORE_MS,
  atWorkShiftsOf,
  reminderDueAt,
  shiftRemindersDueOf,
  type ScheduleInputs,
  type ShiftReminder,
} from '../src/index.js';
import { PARITY_FIXTURES, inputsOf } from '../parity/fixtures.js';

/**
 * Story 17.2: which reminders fall due, over the parity fixture (AD-15),
 * whose scene sits on the daylight-saving transitions. The clock is an
 * argument (the database's, in `remind`), so every case pins its instant.
 */

const [pilot] = PARITY_FIXTURES;
if (pilot === undefined) throw new Error('the parity fixture lost a fixture');

const pilotOf = (memberId: string): ScheduleInputs => inputsOf(pilot.organization, memberId);
const at = (iso: string): number => Date.parse(iso);
const MINUTE = 60 * 1000;

/** One reminder as `date team lead start end startsAt`, the team without its fixture prefix. */
function line(reminder: ShiftReminder): string {
  return [
    reminder.date,
    reminder.teamId.replace(/^pilot-smjena-/, ''),
    reminder.lead,
    reminder.start,
    reminder.end,
    reminder.startsAt,
  ].join(' ');
}

describe('shiftRemindersDueOf', () => {
  const m2 = pilotOf('pilot-m2');
  const january = { from: '2026-01-03', to: '2026-01-05' };

  it('keeps a due reminder with the item enqueue_shift_reminders takes (winter)', () => {
    // 2026-01-04 B's day shift starts 07:00 local, 06:00Z; H2 is due 04:00Z.
    const due = shiftRemindersDueOf(m2, ['H2'], january, at('2026-01-04T04:00:00Z'));
    expect(due).toEqual([
      {
        memberId: 'pilot-m2',
        date: '2026-01-04',
        teamId: 'pilot-smjena-b',
        shiftTypeId: expect.any(String) as string,
        lead: 'H2',
        start: 420,
        end: 1140,
        startsAt: '2026-01-04T06:00:00Z',
      },
    ]);
    const shift = atWorkShiftsOf(m2, '2026-01-04', '2026-01-04')[0];
    expect(due[0]?.shiftTypeId).toBe(shift?.shiftTypeId);
    expect(Object.keys(due[0] ?? {}).sort()).toEqual(
      ['date', 'end', 'lead', 'memberId', 'shiftTypeId', 'start', 'startsAt', 'teamId'].sort(),
    );
  });

  it('keeps a due instant 15 minutes behind the clock and drops one 5 minutes ahead', () => {
    const dueAt = at('2026-01-04T04:00:00Z');
    expect(REMINDER_WINDOW_BEFORE_MS).toBe(15 * MINUTE);
    expect(REMINDER_WINDOW_AFTER_MS).toBe(5 * MINUTE);
    expect(shiftRemindersDueOf(m2, ['H2'], january, dueAt + 15 * MINUTE).map(line)).toEqual([
      '2026-01-04 b H2 420 1140 2026-01-04T06:00:00Z',
    ]);
    expect(shiftRemindersDueOf(m2, ['H2'], january, dueAt + 15 * MINUTE + 1)).toEqual([]);
    expect(shiftRemindersDueOf(m2, ['H2'], january, dueAt - 5 * MINUTE)).toEqual([]);
    expect(shiftRemindersDueOf(m2, ['H2'], january, dueAt - 5 * MINUTE + 1).map(line)).toEqual([
      '2026-01-04 b H2 420 1140 2026-01-04T06:00:00Z',
    ]);
  });

  it('never reminds of a shift that has started', () => {
    for (const lead of ['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE'] as const) {
      const reminders = shiftRemindersDueOf(m2, [lead], january, at('2026-01-04T06:00:00Z'));
      expect(reminders.filter((reminder) => reminder.date === '2026-01-04'), lead).toEqual([]);
    }
  });

  it('counts real hours across the spring transition', () => {
    // 2026-03-29 A's day shift starts 07:00 CEST, 05:00Z: H3 is due 02:00Z.
    const m5 = pilotOf('pilot-m5');
    const window = { from: '2026-03-28', to: '2026-03-30' };
    expect(shiftRemindersDueOf(m5, ['H3'], window, at('2026-03-29T02:00:00Z')).map(line)).toEqual([
      '2026-03-29 a H3 420 1140 2026-03-29T05:00:00Z',
    ]);
    // Wall-clock arithmetic would make it due an hour later.
    expect(shiftRemindersDueOf(m5, ['H3'], window, at('2026-03-29T03:00:00Z'))).toEqual([]);
  });

  it('reminds the evening before at 20:00 local, the day before the start date', () => {
    const m5 = pilotOf('pilot-m5');
    const window = { from: '2026-03-27', to: '2026-03-29' };
    expect(
      shiftRemindersDueOf(m5, ['EVENING_BEFORE'], window, at('2026-03-28T19:00:00Z'))
        .filter((reminder) => reminder.date === '2026-03-29')
        .map(line),
    ).toEqual(['2026-03-29 a EVENING_BEFORE 420 1140 2026-03-29T05:00:00Z']);
  });

  it("counts a night's worked second half from 01:00 the next day", () => {
    const inputs: ScheduleInputs = {
      ...m2,
      leave: [{ id: 'night-half', from: '2026-01-01', to: '2026-01-01', half: 'FIRST', absenceTypeId: 'annual' }],
    };
    const window = { from: '2025-12-31', to: '2026-01-02' };
    expect(shiftRemindersDueOf(inputs, ['H1'], window, at('2026-01-01T23:00:00Z')).map(line)).toEqual([
      '2026-01-01 b H1 1500 1860 2026-01-02T00:00:00Z',
    ]);
    // The evening before is still the start date's.
    expect(shiftRemindersDueOf(inputs, ['EVENING_BEFORE'], window, at('2025-12-31T19:00:00Z')).map(line)).toEqual([
      '2026-01-01 b EVENING_BEFORE 1500 1860 2026-01-02T00:00:00Z',
    ]);
  });

  it('answers the same items for the same clock, in shift then lead order', () => {
    // 2026-01-05 B's night starts 19:00 local, 18:00Z: H1 due 17:00Z. Nothing
    // else is due at that clock (no shift on 2026-01-06 to remind of).
    const now = at('2026-01-05T17:00:00Z');
    const first = shiftRemindersDueOf(m2, ['H1', 'EVENING_BEFORE'], january, now);
    expect(first.map(line)).toEqual(['2026-01-05 b H1 1140 1860 2026-01-05T18:00:00Z']);
    expect(shiftRemindersDueOf(m2, ['H1', 'EVENING_BEFORE'], january, now)).toEqual(first);
  });

  it("reminds only of shifts whose date is in the window, whatever the clock", () => {
    // 2026-01-08 B's day shift starts 07:00 local, 06:00Z: H12 due 2026-01-07T18:00Z.
    const now = at('2026-01-07T18:00:00Z');
    expect(shiftRemindersDueOf(m2, ['H12'], { from: '2026-01-06', to: '2026-01-07' }, now)).toEqual([]);
    expect(shiftRemindersDueOf(m2, ['H12'], { from: '2026-01-06', to: '2026-01-08' }, now).map(line)).toEqual([
      '2026-01-08 b H12 420 1140 2026-01-08T06:00:00Z',
    ]);
  });

  it('gives a member on no team nothing on a date they are not lent, and the loan its reminder', () => {
    const m4 = pilotOf('pilot-m4');
    // B's members are reminded at this clock; m4, on no team, is not.
    expect(shiftRemindersDueOf(m4, ['H2'], january, at('2026-01-04T04:00:00Z'))).toEqual([]);
    // 2027-03-27: lent to D for its night, 19:00 local (18:00Z); H1 due 17:00Z.
    expect(
      shiftRemindersDueOf(m4, ['H1'], { from: '2027-03-26', to: '2027-03-28' }, at('2027-03-27T17:00:00Z')).map(line),
    ).toEqual(['2027-03-27 d H1 1140 1860 2027-03-27T18:00:00Z']);
  });

  it('gives a member nothing for a date of a full-day Leave Record, at a clock their lead would be due', () => {
    const m1 = pilotOf('pilot-m1');
    const window = { from: '2026-10-24', to: '2026-10-26' };
    const withoutLeave: ScheduleInputs = {
      ...m1,
      leave: m1.leave.filter((record) => !(record.from <= '2026-10-25' && record.to >= '2026-10-25')),
    };
    const shift = atWorkShiftsOf(withoutLeave, '2026-10-25', '2026-10-25')[0];
    if (shift === undefined) throw new Error('the fixture lost m1\'s 2026-10-25 shift');
    const now = reminderDueAt('H1', shift.date, shift.startMinute, withoutLeave.timeZone);
    expect(shiftRemindersDueOf(withoutLeave, ['H1'], window, now).map((reminder) => reminder.date)).toContain('2026-10-25');
    expect(shiftRemindersDueOf(m1, ['H1'], window, now).filter((reminder) => reminder.date === '2026-10-25')).toEqual([]);
  });

  it('answers nothing with no lead on, and refuses a malformed lead list or clock', () => {
    expect(shiftRemindersDueOf(m2, [], january, at('2026-01-04T04:00:00Z'))).toEqual([]);
    expect(() => shiftRemindersDueOf(m2, ['H4' as never], january, 0)).toThrow(RangeError);
    expect(() => shiftRemindersDueOf(m2, ['H1', 'H1'], january, 0)).toThrow(RangeError);
    expect(() => shiftRemindersDueOf(m2, ['H1'], january, 1.5)).toThrow(RangeError);
    expect(() => shiftRemindersDueOf(m2, ['H1'], { from: '2026-01-05', to: '2026-01-03' }, 0)).toThrow(RangeError);
  });
});
