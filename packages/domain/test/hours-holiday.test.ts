import { describe, expect, it } from 'vitest';

import {
  HOURS_FIGURE_HOLIDAY,
  HOURS_SOURCE_CHANGE,
  HOURS_SOURCE_PERSONAL,
  HOURS_SOURCE_REPLACEMENT,
  PERSONAL_ASSIGNMENT_SHIFT,
  HOURS_FIGURE_TOTAL,
  explainMemberHours,
  memberHoursOfMonth,
  type HolidayRule,
  type MemberHours,
  type MemberHoursInput,
  type RosterMember,
} from '../src/index.js';

/**
 * Story 21.19 (R13.7) — holiday hours: a worked shift's minutes inside a
 * holiday's civil date, a view over the total that changes no other figure.
 *
 * R13.8's shape: 24-hour teams on [Dan 07–19, Noć 19–07, Slobodno, Slobodno].
 * K works Dan on the holiday H (2026-11-18), L works Noć on H−1, N works Noć
 * on 2026-12-31. Day team D works 06–14 ×5, then two days off.
 */
const at = (hour: number): number => hour * 60;
const H = '2026-11-18';

const TYPES = [
  { id: 'd6', name: '1. smjena', isWorking: true },
  { id: 'dan', name: 'Dan', isWorking: true },
  { id: 'noc', name: 'Noć', isWorking: true },
  { id: 'off', name: 'Slobodno', isWorking: false },
  // Working, but timed only from 2027: untimed on any holiday here.
  { id: 'late', name: 'Kasna', isWorking: true },
];
const VERSIONS = [
  { shiftTypeId: 'd6', effectiveFrom: '2020-01-01', startMinute: at(6), endMinute: at(14) },
  { shiftTypeId: 'dan', effectiveFrom: '2020-01-01', startMinute: at(7), endMinute: at(19) },
  { shiftTypeId: 'noc', effectiveFrom: '2020-01-01', startMinute: at(19), endMinute: at(7) },
  { shiftTypeId: 'late', effectiveFrom: '2027-01-01', startMinute: at(14), endMinute: at(22) },
];
const STEPS = [
  ...['d6', 'd6', 'd6', 'd6', 'd6', 'off', 'off'].map((shiftTypeId, position) => ({
    id: `d${String(position)}`,
    patternId: 'd',
    position,
    shiftTypeId,
  })),
  ...['dan', 'noc', 'off', 'off'].map((shiftTypeId, position) => ({ id: `k${String(position)}`, patternId: 'k', position, shiftTypeId })),
];
const ASSIGNMENTS = [
  { teamId: 'D', patternId: 'd', offsetStepId: 'd0', anchorDate: '2026-11-16', effectiveFrom: '2020-01-01' },
  { teamId: 'K', patternId: 'k', offsetStepId: 'k0', anchorDate: H, effectiveFrom: '2020-01-01' },
  { teamId: 'L', patternId: 'k', offsetStepId: 'k0', anchorDate: '2026-11-16', effectiveFrom: '2020-01-01' },
  { teamId: 'N', patternId: 'k', offsetStepId: 'k0', anchorDate: '2026-12-30', effectiveFrom: '2020-01-01' },
];
const MEMBERS: readonly RosterMember[] = [
  ...['D', 'K', 'L', 'N'].map((teamId) => ({
    id: teamId.toLowerCase(),
    memberships: [{ teamId, position: null, effectiveFrom: '2020-01-01' }],
    statuses: [],
  })),
  // In D, with a Personal Assignment of D's 06–14 on the holiday (R14.4: never removed by it).
  {
    id: 'a',
    memberships: [{ teamId: 'D', position: null, effectiveFrom: '2020-01-01' }],
    statuses: [],
    personalAssignments: [{ id: 'a-holiday', date: H, kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: 'd6', teamId: null }],
  },
];

function input(memberId: string, rule: HolidayRule, extra: Partial<MemberHoursInput> = {}): MemberHoursInput {
  const member = MEMBERS.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    assignments: ASSIGNMENTS,
    steps: STEPS,
    overrides: [],
    members: MEMBERS,
    rosterOverrides: [],
    workingShiftTypeIds: ['d6', 'dan', 'noc', 'late'],
    bands: [
      { id: 'dnevni', name: 'Dnevni', startMinute: at(6) },
      { id: 'nocni', name: 'Noćni', startMinute: at(22) },
    ],
    shiftTypes: TYPES.map((type) => ({ type, versions: VERSIONS.filter((version) => version.shiftTypeId === type.id) })),
    ...rule,
    ...extra,
  };
}

/** Every figure but the holiday one. */
const withoutHoliday = ({ holidayMinutes: _holiday, ...rest }: MemberHours): Omit<MemberHours, 'holidayMinutes'> => rest;

describe('R13.7 — holiday hours, a view over the total', () => {
  it('R13.8: K Dan on H gives 720, L Noć on H−1 gives 420; every other figure is unchanged', () => {
    for (const [memberId, minutes] of [
      ['k', 720],
      ['l', 420],
    ] as const) {
      const hours = memberHoursOfMonth(input(memberId, { holidays: [H] }), '2026-11');
      expect(hours.holidayMinutes, memberId).toBe(minutes);
      expect(withoutHoliday(hours)).toEqual(memberHoursOfMonth(input(memberId, {}), '2026-11'));
    }
  });

  it('with no holiday, the figure is absent and the output identical', () => {
    for (const memberId of ['d', 'k', 'l', 'n', 'a']) {
      const before = memberHoursOfMonth(input(memberId, {}), '2026-11');
      expect(before).not.toHaveProperty('holidayMinutes');
      expect(JSON.stringify(memberHoursOfMonth(input(memberId, { holidays: [] }), '2026-11'))).toBe(JSON.stringify(before));
      // A holiday nobody works is no figure: K's off date, or another month's.
      expect(JSON.stringify(memberHoursOfMonth(input(memberId, { holidays: ['2026-10-01'] }), '2026-11'))).toBe(JSON.stringify(before));
    }
  });

  it('a holiday not worked adds nothing: D off for it, K on leave on it', () => {
    const off = memberHoursOfMonth(input('d', { holidays: [H], teamsOffOnHolidays: ['D'] }), '2026-11');
    expect(off).not.toHaveProperty('holidayMinutes');
    const leave = memberHoursOfMonth(input('k', { holidays: [H] }, { leaveShifts: [{ date: H, teamId: 'K' }] }), '2026-11');
    expect(leave).not.toHaveProperty('holidayMinutes');
    expect(leave.leaveMinutes).toBe(at(12));
    // D working the holiday (not off on holidays) counts its 8 hours.
    expect(memberHoursOfMonth(input('d', { holidays: [H] }), '2026-11').holidayMinutes).toBe(at(8));
  });

  it('a half day on H counts only the worked half inside H', () => {
    const first = memberHoursOfMonth(input('k', { holidays: [H] }, { halfDays: [{ date: H, half: 'FIRST' }] }), '2026-11');
    expect(first.holidayMinutes).toBe(at(6));
    // L's Noć on H−1, second half absent: the worked half is 19:00–01:00, one hour of it on H.
    const second = memberHoursOfMonth(input('l', { holidays: [H] }, { halfDays: [{ date: '2026-11-17', half: 'SECOND' }] }), '2026-11');
    expect(second.holidayMinutes).toBe(at(1));
    // The same Noć, FIRST half absent: the worked half is 01:00–07:00, all of it on H.
    const firstAbsent = memberHoursOfMonth(input('l', { holidays: [H] }, { halfDays: [{ date: '2026-11-17', half: 'FIRST' }] }), '2026-11');
    expect(firstAbsent.holidayMinutes).toBe(at(6));
  });

  it('an untimed working shift and a non-working type add nothing', () => {
    // K's Dan on H changed to a type with no times yet: counted as a shift, never in minutes.
    const untimed = memberHoursOfMonth(input('k', { holidays: [H] }, { overrides: [{ teamId: 'K', date: H, shiftTypeId: 'late' }] }), '2026-11');
    expect(untimed.untimedShiftCount).toBe(1);
    expect(untimed).not.toHaveProperty('holidayMinutes');
    // 2026-11-21 is K's second Slobodno, and its Noć of the 19th ends on the 20th.
    expect(memberHoursOfMonth(input('k', { holidays: ['2026-11-21'] }), '2026-11')).not.toHaveProperty('holidayMinutes');
  });

  it('a changed shift, a replacement and a Personal Assignment on H count, each with its source', () => {
    const changed = input('k', { holidays: [H] }, { overrides: [{ teamId: 'K', date: H, shiftTypeId: 'd6' }] });
    expect(memberHoursOfMonth(changed, '2026-11').holidayMinutes).toBe(at(8));
    expect(explainMemberHours(changed, '2026-11', { code: HOURS_FIGURE_HOLIDAY }).operands).toEqual([
      { date: H, teamId: 'K', shiftTypeId: 'd6', source: HOURS_SOURCE_CHANGE, minutes: at(8) },
    ]);
    // N works Noć on H−1 and is off on H; a roster override puts it on D's 06–14 in place of d. The
    // Noć's operand is dated by its start, the day before the holiday, with its 7 hours past midnight.
    const replaced = input('n', { holidays: [H] }, { rosterOverrides: [{ id: 'r1', teamId: 'D', date: H, memberOutId: 'd', memberInId: 'n' }] });
    expect(explainMemberHours(replaced, '2026-11', { code: HOURS_FIGURE_HOLIDAY }).operands).toEqual([
      { date: '2026-11-17', teamId: 'N', shiftTypeId: 'noc', source: 'ROTATION', minutes: at(7) },
      { date: H, teamId: 'D', shiftTypeId: 'd6', source: HOURS_SOURCE_REPLACEMENT, minutes: at(8) },
    ]);
    // D off on holidays: d works nothing, a's assignment is kept and counts.
    const offD = { holidays: [H], teamsOffOnHolidays: ['D'] };
    expect(memberHoursOfMonth(input('d', offD), '2026-11')).not.toHaveProperty('holidayMinutes');
    const assigned = input('a', offD);
    expect(memberHoursOfMonth(assigned, '2026-11').holidayMinutes).toBe(at(8));
    expect(explainMemberHours(assigned, '2026-11', { code: HOURS_FIGURE_HOLIDAY }).operands).toEqual([
      // Counted with the member's own team (R14.3), which the holiday does not empty an assignment for.
      { date: H, teamId: 'D', shiftTypeId: 'd6', source: HOURS_SOURCE_PERSONAL, minutes: at(8) },
    ]);
  });

  it("a Noć on 31 December counts its 7 hours of 1 January in December's figure", () => {
    expect(memberHoursOfMonth(input('n', { holidays: ['2027-01-01'] }), '2026-12').holidayMinutes).toBe(at(7));
    // The shift and the holiday both: 5 hours on 31 December and 7 on 1 January.
    expect(memberHoursOfMonth(input('n', { holidays: ['2026-12-31', '2027-01-01'] }), '2026-12').holidayMinutes).toBe(at(12));
  });

  it('the explanation is one operand per shift, summing to the figure', () => {
    const hoursInput = input('k', { holidays: [H, '2026-11-19'] });
    const hours = memberHoursOfMonth(hoursInput, '2026-11');
    // Dan on H (12 h) and Noć on 11-19 until midnight (5 h).
    expect(hours.holidayMinutes).toBe(at(17));
    const explanation = explainMemberHours(hoursInput, '2026-11', { code: HOURS_FIGURE_HOLIDAY });
    expect(explanation).toEqual({
      figure: { code: HOURS_FIGURE_HOLIDAY },
      minutes: at(17),
      operands: [
        { date: H, teamId: 'K', shiftTypeId: 'dan', source: 'ROTATION', minutes: at(12) },
        { date: '2026-11-19', teamId: 'K', shiftTypeId: 'noc', source: 'ROTATION', minutes: at(5) },
      ],
    });
    expect(explainMemberHours(input('k', {}), '2026-11', { code: HOURS_FIGURE_HOLIDAY })).toEqual({
      figure: { code: HOURS_FIGURE_HOLIDAY },
      minutes: 0,
      operands: [],
    });
    expect(explainMemberHours(hoursInput, '2026-11', { code: HOURS_FIGURE_TOTAL }).minutes).toBe(hours.totalMinutes);
  });

  it('refuses a holiday that is not a date, or one given twice', () => {
    expect(() => memberHoursOfMonth(input('k', { holidays: ['2026-13-01'] }), '2026-11')).toThrow(RangeError);
    expect(() => memberHoursOfMonth(input('k', { holidays: [H, H] }), '2026-11')).toThrow(RangeError);
    expect(() => explainMemberHours(input('k', { holidays: ['nope'] }), '2026-11', { code: HOURS_FIGURE_HOLIDAY })).toThrow(RangeError);
  });
});
