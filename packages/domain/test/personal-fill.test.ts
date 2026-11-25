import { describe, expect, it } from 'vitest';

import {
  MAX_PLANNED_DAYS,
  PERSONAL_ASSIGNMENT_OFF,
  PERSONAL_ASSIGNMENT_SHIFT,
  copiedAssignmentsOf,
  filledAssignmentsOf,
  patternDaysOf,
  type PatternStep,
  type PersonalAssignment,
} from '../src/index.js';

/**
 * Story 21.5: *Popuni uzorkom* and *Kopiraj* as pure rules (AD-26 as amended,
 * AD-7). Both return the items a save would write; nothing is stored as a rule.
 */

const FIRST = 'type-first';
const SECOND = 'type-second';

/** The founder's example: `1. smjena ×5, Slobodno ×2, 2. smjena ×5, Slobodno ×2`. */
const FOUNDER: readonly PatternStep[] = [
  { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: FIRST, count: 5 },
  { kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count: 2 },
  { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: SECOND, count: 5 },
  { kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count: 2 },
];

/** The letters of a member's items, in date order: `A` first, `B` second, `-` off, `.` cleared. */
function lettersOf(items: readonly { readonly set: { readonly shiftTypeId: string | null } | null }[]): string {
  return items
    .map((item) => (item.set === null ? '.' : item.set.shiftTypeId === FIRST ? 'A' : item.set.shiftTypeId === SECOND ? 'B' : '-'))
    .join('');
}

describe('patternDaysOf', () => {
  it('expands each step by its count into one cycle', () => {
    expect(lettersOf(patternDaysOf(FOUNDER).map((set) => ({ set })))).toBe('AAAAA--BBBBB--');
  });

  it.each([
    ['no step', []],
    ['a zero count', [{ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count: 0 }]],
    ['a fractional count', [{ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count: 1.5 }]],
    ['a count over the bound', [{ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, count: MAX_PLANNED_DAYS + 1 }]],
    ['a shift with no type', [{ kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: null, count: 1 }]],
    ['a day off naming a type', [{ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: FIRST, count: 1 }]],
    ['another kind', [{ kind: 'LEAVE', shiftTypeId: null, count: 1 }]],
  ])('refuses %s', (_what, steps) => {
    expect(() => patternDaysOf(steps as readonly PatternStep[])).toThrow(RangeError);
  });
});

describe('filledAssignmentsOf', () => {
  it('fills the founder pattern over four weeks for two people, from day one', () => {
    const items = filledAssignmentsOf(FOUNDER, 0, ['ana', 'ivo'], '2026-12-01', '2026-12-28');

    expect(items).toHaveLength(56);
    for (const memberId of ['ana', 'ivo']) {
      const own = items.filter((item) => item.memberId === memberId);

      expect(own.map((item) => item.date)[0]).toBe('2026-12-01');
      expect(own.at(-1)?.date).toBe('2026-12-28');
      expect(lettersOf(own)).toBe('AAAAA--BBBBB--AAAAA--BBBBB--');
    }
    // A shift counts with the member's own team; a day off names nothing.
    expect(items[0]?.set).toEqual({ kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: FIRST, teamId: null });
    expect(items[5]?.set).toEqual({ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null });
  });

  it('enters the cycle at the offset on the first date', () => {
    expect(lettersOf(filledAssignmentsOf(FOUNDER, 7, ['ana'], '2026-12-01', '2026-12-14'))).toBe('BBBBB--AAAAA--');
    expect(lettersOf(filledAssignmentsOf(FOUNDER, 13, ['ana'], '2026-12-01', '2026-12-03'))).toBe('-AA');
  });

  it('crosses a month and a year end', () => {
    const items = filledAssignmentsOf(FOUNDER, 0, ['ana'], '2026-12-30', '2027-01-02');

    expect(items.map((item) => item.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('fills one day when the range is one day', () => {
    expect(filledAssignmentsOf(FOUNDER, 5, ['ana'], '2026-12-01', '2026-12-01')).toEqual([
      { memberId: 'ana', date: '2026-12-01', set: { kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null } },
    ]);
  });

  it('plans nothing for no member', () => {
    expect(filledAssignmentsOf(FOUNDER, 0, [], '2026-12-01', '2026-12-31')).toEqual([]);
  });

  it.each([
    ['a negative offset', -1, ['ana'], '2026-12-01', '2026-12-02'],
    ['an offset past the cycle', 14, ['ana'], '2026-12-01', '2026-12-02'],
    ['a fractional offset', 0.5, ['ana'], '2026-12-01', '2026-12-02'],
    ['a repeated member', 0, ['ana', 'ana'], '2026-12-01', '2026-12-02'],
    ['an empty member id', 0, [''], '2026-12-01', '2026-12-02'],
    ['a range ending before it starts', 0, ['ana'], '2026-12-02', '2026-12-01'],
    ['a bad date', 0, ['ana'], '2026-02-30', '2026-03-01'],
    ['a range over 366 days', 0, ['ana'], '2026-01-01', '2027-01-02'],
  ])('refuses %s', (_what, offset, members, from, to) => {
    expect(() => filledAssignmentsOf(FOUNDER, offset, members, from, to)).toThrow(RangeError);
  });

  it('takes a range of exactly 366 days', () => {
    expect(filledAssignmentsOf(FOUNDER, 0, ['ana'], '2028-01-01', '2028-12-31')).toHaveLength(366);
  });
});

function assignment(date: string, shiftTypeId: string | null, teamId: string | null = null): PersonalAssignment {
  return {
    id: `id-${date}`,
    date,
    kind: shiftTypeId === null ? PERSONAL_ASSIGNMENT_OFF : PERSONAL_ASSIGNMENT_SHIFT,
    shiftTypeId,
    teamId,
  };
}

describe('copiedAssignmentsOf', () => {
  const week = { from: '2026-12-07', to: '2026-12-13' };
  const ana = {
    memberId: 'ana',
    personalAssignments: [
      assignment('2026-12-07', FIRST),
      assignment('2026-12-08', FIRST, 'team-dispatch'),
      assignment('2026-12-09', null),
    ],
  };

  it('copies assignments only, and clears a target whose source had none', () => {
    const items = copiedAssignmentsOf(week, '2026-12-14', [ana]);

    expect(items.map((item) => item.date)).toEqual([
      '2026-12-14',
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
      '2026-12-19',
      '2026-12-20',
    ]);
    expect(lettersOf(items)).toBe('AA-....');
    // The counted team travels with the assignment.
    expect(items[1]?.set).toEqual({ kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: FIRST, teamId: 'team-dispatch' });
    expect(items[2]?.set).toEqual({ kind: PERSONAL_ASSIGNMENT_OFF, shiftTypeId: null, teamId: null });
  });

  it('copies a member with no assignment as clears', () => {
    expect(lettersOf(copiedAssignmentsOf(week, '2026-12-21', [{ memberId: 'ivo', personalAssignments: [] }]))).toBe('.......');
  });

  it('copies the source as it was when the target overlaps it', () => {
    const items = copiedAssignmentsOf({ from: '2026-12-07', to: '2026-12-09' }, '2026-12-08', [ana]);

    expect(items.map((item) => item.date)).toEqual(['2026-12-08', '2026-12-09', '2026-12-10']);
    expect(lettersOf(items)).toBe('AA-');
  });

  it('copies a month backwards too', () => {
    const items = copiedAssignmentsOf({ from: '2026-12-07', to: '2026-12-07' }, '2026-11-07', [ana]);

    expect(items).toEqual([
      { memberId: 'ana', date: '2026-11-07', set: { kind: PERSONAL_ASSIGNMENT_SHIFT, shiftTypeId: FIRST, teamId: null } },
    ]);
  });

  it.each([
    ['a bad target', week, '2026-13-01', [ana]],
    ['a target past the calendar', { from: '9999-12-30', to: '9999-12-31' }, '9999-12-31', [ana]],
    ['a repeated member', week, '2026-12-14', [ana, ana]],
    ['a range over 366 days', { from: '2026-01-01', to: '2027-01-02' }, '2027-01-03', [ana]],
  ])('refuses %s', (_what, source, target, members) => {
    expect(() => copiedAssignmentsOf(source, target, members)).toThrow(RangeError);
  });

  it('refuses a member whose assignments break their preconditions', () => {
    const broken = { memberId: 'ana', personalAssignments: [assignment('2026-12-07', FIRST), assignment('2026-12-07', SECOND)] };

    expect(() => copiedAssignmentsOf(week, '2026-12-14', [broken])).toThrow(RangeError);
  });
});
