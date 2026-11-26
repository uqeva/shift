import { describe, expect, it } from 'vitest';

import {
  FLOATER_FREE,
  FLOATER_INACTIVE,
  FLOATER_ON_LEAVE,
  FLOATER_REST_GAP,
  FLOATER_WORKING,
  floaterEligibleFor,
  floaterStandingOn,
  floaterSuggestionsOf,
  leaveCoverOf,
  type Floater,
  type FloaterShift,
  type LeaveCoverShift,
  type UncoveredShift,
} from '../src/index.js';

/**
 * R16.1–R16.2 (story 21.13): which floaters are suggested for an uncovered
 * shift, and in which order. The spec's I/O matrix rows are the named cases.
 */

const DISPATCHER = 'role-dispatcher';
const CLEANER = 'role-cleaner';
const DATE = '2026-12-10';
/** The uncovered Dan, 07:00–19:00. */
const DAN: UncoveredShift = { date: DATE, interval: { startMinute: 420, endMinute: 1140 } };

function floater(id: string, fields: Partial<Floater> = {}): Floater {
  return { id, roleIds: [DISPATCHER], statuses: [], shifts: [], leave: [], ...fields };
}

function shift(date: string, startMinute = 420, endMinute = 1140): FloaterShift {
  return { date, startMinute, endMinute };
}

describe('R16.1: eligibility', () => {
  it('admits every floater for an absent member with no role', () => {
    expect(floaterEligibleFor(null, [])).toBe(true);
    expect(floaterEligibleFor(null, [CLEANER])).toBe(true);
  });

  it('admits only the floaters who list the absent member\'s role', () => {
    expect(floaterEligibleFor(DISPATCHER, [DISPATCHER, CLEANER])).toBe(true);
    expect(floaterEligibleFor(DISPATCHER, [CLEANER])).toBe(false);
    expect(floaterEligibleFor(DISPATCHER, [])).toBe(false);
  });
});

describe('R16.2: a floater\'s standing on the date', () => {
  it('is free with no shift, no leave and active', () => {
    expect(floaterStandingOn(floater('a'), DAN)).toBe(FLOATER_FREE);
  });

  it('is inactive outside their season (R16.5)', () => {
    expect(floaterStandingOn(floater('a', { statuses: [{ active: false, effectiveFrom: '2026-12-01' }] }), DAN)).toBe(
      FLOATER_INACTIVE,
    );
    expect(floaterStandingOn(floater('a', { statuses: [{ active: false, effectiveFrom: '2026-12-11' }] }), DAN)).toBe(FLOATER_FREE);
  });

  it('is on leave on any record covering the date, a half day\'s too', () => {
    expect(floaterStandingOn(floater('a', { leave: [{ from: '2026-12-08', to: '2026-12-12' }] }), DAN)).toBe(FLOATER_ON_LEAVE);
    expect(floaterStandingOn(floater('a', { leave: [{ from: DATE, to: DATE }] }), DAN)).toBe(FLOATER_ON_LEAVE);
    expect(floaterStandingOn(floater('a', { leave: [{ from: '2026-12-11', to: '2026-12-12' }] }), DAN)).toBe(FLOATER_FREE);
  });

  it('is working with an at-work shift that date, of any hours', () => {
    expect(floaterStandingOn(floater('a', { shifts: [shift(DATE, 1260, 1380)] }), DAN)).toBe(FLOATER_WORKING);
  });

  it('has a rest gap with a Noć ending as the shift starts, and none with a break between', () => {
    // Noć 19:00–07:00 the evening before ends at 07:00 on the date: zero rest.
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-09', 1140, 1860)] }), DAN)).toBe(FLOATER_REST_GAP);
    // One running past the start: less than zero.
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-09', 1200, 1920)] }), DAN)).toBe(FLOATER_REST_GAP);
    // A Dan the day before ends at 19:00: twelve hours' rest.
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-09')] }), DAN)).toBe(FLOATER_FREE);
  });

  it('has a rest gap with a shift the next date starting as the uncovered one ends', () => {
    const noc: UncoveredShift = { date: DATE, interval: { startMinute: 1140, endMinute: 1860 } };

    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-11', 420, 1140)] }), noc)).toBe(FLOATER_REST_GAP);
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-11', 480, 1140)] }), noc)).toBe(FLOATER_FREE);
    // Two days on: never a rest gap.
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-12', 0, 600)] }), noc)).toBe(FLOATER_FREE);
  });

  it('reads no rest gap for an uncovered shift with no times', () => {
    expect(floaterStandingOn(floater('a', { shifts: [shift('2026-12-09', 1140, 1860)] }), { date: DATE, interval: null })).toBe(
      FLOATER_FREE,
    );
  });

  it('takes inactive, then leave, then work, then the rest gap', () => {
    const all = floater('a', {
      statuses: [{ active: false, effectiveFrom: '2026-01-01' }],
      leave: [{ from: DATE, to: DATE }],
      shifts: [shift(DATE), shift('2026-12-09', 1140, 1860)],
    });

    expect(floaterStandingOn(all, DAN)).toBe(FLOATER_INACTIVE);
    expect(floaterStandingOn({ ...all, statuses: [] }, DAN)).toBe(FLOATER_ON_LEAVE);
    expect(floaterStandingOn({ ...all, statuses: [], leave: [] }, DAN)).toBe(FLOATER_WORKING);
    expect(floaterStandingOn({ ...all, statuses: [], leave: [], shifts: [shift('2026-12-09', 1140, 1860)] }, DAN)).toBe(
      FLOATER_REST_GAP,
    );
  });

  it('refuses a malformed date or interval', () => {
    expect(() => floaterStandingOn(floater('a'), { date: '2026-13-01', interval: null })).toThrow(RangeError);
    expect(() => floaterStandingOn(floater('a'), { date: DATE, interval: { startMinute: 600, endMinute: 600 } })).toThrow(RangeError);
    expect(() => floaterStandingOn(floater('a', { shifts: [shift(DATE, 0, 2880)] }), DAN)).toThrow(RangeError);
    expect(() => floaterStandingOn(floater('a', { leave: [{ from: '2026-12-12', to: '2026-12-10' }] }), DAN)).toThrow(RangeError);
  });
});

describe('R16.2: the suggestions', () => {
  it('Suggested: A · 1 smjena before B · 3 smjene, both listing the absent role (matrix row 1)', () => {
    const a = floater('a', { shifts: [shift('2026-12-02')] });
    const b = floater('b', { shifts: [shift('2026-12-01'), shift('2026-12-03'), shift('2026-12-05')] });

    expect(floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: DISPATCHER, uncovered: DAN, floaters: [b, a] })).toEqual([
      { memberId: 'a', shiftsInMonth: 1 },
      { memberId: 'b', shiftsInMonth: 3 },
    ]);
  });

  it('counts every at-work shift of the date\'s month, after the date too, and none of another month', () => {
    const a = floater('a', { shifts: [shift('2026-11-30'), shift('2026-12-20'), shift('2026-12-31'), shift('2027-01-01')] });

    expect(floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: null, uncovered: DAN, floaters: [a] })).toEqual([
      { memberId: 'a', shiftsInMonth: 2 },
    ]);
  });

  it('keeps the given (name) order on a tie', () => {
    const floaters = ['c', 'a', 'b'].map((id) => floater(id));

    expect(
      floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: null, uncovered: DAN, floaters }).map((one) => one.memberId),
    ).toEqual(['c', 'a', 'b']);
  });

  it('No role: every free floater, whatever they list (matrix row 2)', () => {
    const floaters = [floater('a', { roleIds: [] }), floater('b', { roleIds: [CLEANER] }), floater('c')];

    expect(
      floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: null, uncovered: DAN, floaters }).map((one) => one.memberId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('None: a role no floater lists gets nobody (matrix row 3)', () => {
    expect(floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: CLEANER, uncovered: DAN, floaters: [floater('a')] })).toEqual(
      [],
    );
  });

  it('Not free: on leave, working the date, or a Noć ending as it starts (matrix row 4)', () => {
    const floaters = [
      floater('leave', { leave: [{ from: DATE, to: DATE }] }),
      floater('working', { shifts: [shift(DATE)] }),
      floater('night', { shifts: [shift('2026-12-09', 1140, 1860)] }),
      floater('free'),
    ];

    expect(
      floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: DISPATCHER, uncovered: DAN, floaters }).map((one) => one.memberId),
    ).toEqual(['free']);
  });

  it('No floaters: nothing (matrix row 5)', () => {
    expect(floaterSuggestionsOf({ absentMemberId: 'absent', absentRoleId: null, uncovered: DAN, floaters: [] })).toEqual([]);
  });

  it('never suggests the absent member, a floater themselves', () => {
    expect(
      floaterSuggestionsOf({ absentMemberId: 'a', absentRoleId: null, uncovered: DAN, floaters: [floater('a'), floater('b')] }),
    ).toEqual([{ memberId: 'b', shiftsInMonth: 0 }]);
  });

  it('reads no standing of the absent member or an ineligible floater: their data is never checked', () => {
    const broken = { shifts: [shift(DATE, 0, 2880)] };

    expect(
      floaterSuggestionsOf({
        absentMemberId: 'a',
        absentRoleId: DISPATCHER,
        uncovered: DAN,
        floaters: [floater('a', broken), floater('b', { ...broken, roleIds: [CLEANER] }), floater('c')],
      }),
    ).toEqual([{ memberId: 'c', shiftsInMonth: 0 }]);
  });

  it('refuses a floater given twice or with no id', () => {
    expect(() =>
      floaterSuggestionsOf({ absentMemberId: 'x', absentRoleId: null, uncovered: DAN, floaters: [floater('a'), floater('a')] }),
    ).toThrow(RangeError);
    expect(() => floaterSuggestionsOf({ absentMemberId: 'x', absentRoleId: null, uncovered: DAN, floaters: [floater('')] })).toThrow(
      RangeError,
    );
  });
});

describe('R16.4: a whole leave covered by one floater (story 21.14)', () => {
  /** A Dan 07:00–19:00 on `date`, writable unless said otherwise. */
  function dan(date: string, writable = true): LeaveCoverShift {
    return { date, interval: { startMinute: 420, endMinute: 1140 }, writable };
  }

  /** A Noć 19:00–07:00 on `date`. */
  function noc(date: string): LeaveCoverShift {
    return { date, interval: { startMinute: 1140, endMinute: 1860 }, writable: true };
  }

  const WEEK = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];

  it('Whole week: free on five dates, working on one and on leave on another (matrix row 1)', () => {
    const cover = leaveCoverOf(
      floater('a', { shifts: [shift('2026-12-09')], leave: [{ from: '2026-12-12', to: '2026-12-12' }] }),
      WEEK.map((date) => dan(date)),
    );

    expect(cover.covered).toBe(5);
    expect(cover.entries.map((entry) => [entry.standing, entry.covered])).toEqual([
      [FLOATER_FREE, true],
      [FLOATER_FREE, true],
      [FLOATER_WORKING, false],
      [FLOATER_FREE, true],
      [FLOATER_FREE, true],
      [FLOATER_ON_LEAVE, false],
      [FLOATER_FREE, true],
    ]);
  });

  it('Rest gap: a covered Noć leaves no rest for the next morning Dan (matrix row 2)', () => {
    const cover = leaveCoverOf(floater('a'), [noc('2026-12-07'), dan('2026-12-08')]);

    expect(cover.entries.map((entry) => entry.standing)).toEqual([FLOATER_FREE, FLOATER_REST_GAP]);
    expect(cover.covered).toBe(1);
  });

  it('Rest gap: the floater\'s own Noć ending as the shift starts', () => {
    const cover = leaveCoverOf(floater('a', { shifts: [shift('2026-12-06', 1140, 1860)] }), [dan('2026-12-07')]);

    expect(cover.entries[0]).toEqual({ standing: FLOATER_REST_GAP, covered: false });
  });

  it('a shift that cannot be written is free yet not covered, and adds nothing to the day (matrix row 3)', () => {
    const cover = leaveCoverOf(floater('a'), [{ ...noc('2026-12-07'), writable: false }, dan('2026-12-08')]);

    expect(cover.entries).toEqual([
      { standing: FLOATER_FREE, covered: false },
      { standing: FLOATER_FREE, covered: true },
    ]);
  });

  it('a second uncovered shift on a date already covered finds the floater working', () => {
    const cover = leaveCoverOf(floater('a'), [dan('2026-12-07'), { date: '2026-12-07', interval: null, writable: true }]);

    expect(cover.entries.map((entry) => entry.standing)).toEqual([FLOATER_FREE, FLOATER_WORKING]);
  });

  it('a covered shift with no times still makes its date a working one', () => {
    const cover = leaveCoverOf(floater('a'), [{ date: '2026-12-07', interval: null, writable: true }, dan('2026-12-07')]);

    expect(cover.entries.map((entry) => entry.covered)).toEqual([true, false]);
  });

  it('None free: nothing covered (matrix row 4)', () => {
    const cover = leaveCoverOf(floater('a', { statuses: [{ active: false, effectiveFrom: '2026-12-01' }] }), [dan('2026-12-07')]);

    expect(cover).toEqual({ entries: [{ standing: FLOATER_INACTIVE, covered: false }], covered: 0 });
  });

  it('nothing to cover: no entries', () => {
    expect(leaveCoverOf(floater('a'), [])).toEqual({ entries: [], covered: 0 });
  });

  it('refuses shifts out of date order, and a bad date', () => {
    expect(() => leaveCoverOf(floater('a'), [dan('2026-12-08'), dan('2026-12-07')])).toThrow(RangeError);
    expect(() => leaveCoverOf(floater('a'), [dan('2026-13-01')])).toThrow(RangeError);
  });
});
