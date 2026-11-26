import { describe, expect, it } from 'vitest';

import { calendarFilterBarOf } from '@/features/calendar/utils/filters';
import type { CalendarFilter, CalendarMonth } from '@/features/calendar/utils/month';

/**
 * Story 7.5's Kalendar filter bar, executed (AD-15): the model
 * `calendarMonthOf`'s filter becomes — a person replacing the team (3.3b),
 * each team's count, and the people the sheet's `Prikaži` counts.
 */

function monthWith(filter: Partial<CalendarFilter>): CalendarMonth {
  const teams = ['a', 'b'].map((id) => ({ id, name: `Smjena ${id.toUpperCase()}`, letter: id.toUpperCase() }));

  return {
    filter: {
      teams,
      chosen: null,
      people: [
        { id: 'luka', name: 'Luka Knežević', teamId: 'a', teamName: 'Smjena A' },
        { id: 'ana', name: 'Ana Anić', teamId: 'b', teamName: 'Smjena B' },
        { id: 'iva', name: 'Iva Ivić', teamId: 'b', teamName: 'Smjena B' },
        { id: 'toni', name: 'Toni Bezsmjene', teamId: null, teamName: null },
      ],
      person: null,
      teamCounts: { a: 1, b: 2 },
      roles: [],
      role: null,
      ...filter,
    },
  } as unknown as CalendarMonth;
}

describe("Kalendar's filter bar (story 7.5)", () => {
  it('offers every active team with its count, and everybody', () => {
    const model = calendarFilterBarOf(monthWith({}));

    expect(model.combine).toBe(false);
    expect(model.teams).toEqual([
      { id: 'a', name: 'Smjena A', count: 1 },
      { id: 'b', name: 'Smjena B', count: 2 },
    ]);
    expect(model.people.map((person) => person.id)).toEqual(['luka', 'ana', 'iva', 'toni']);
    expect(model.summary).toEqual({ kind: 'all', teams: 2, people: 4 });
    expect(model.shownCount).toBe(4);
  });

  it("shows a team's people of all, and counts them for Prikaži", () => {
    const model = calendarFilterBarOf(monthWith({ chosen: 'b' }));

    expect(model.summary).toEqual({ kind: 'team', team: 'Smjena B', shown: 2, total: 4 });
    expect(model.shownCount).toBe(2);
  });

  it('draws the Osoba chip alone while a person is chosen, with their own team', () => {
    const model = calendarFilterBarOf(monthWith({ person: 'luka' }));

    expect(model.chips).toEqual([{ key: 'person', value: 'Luka Knežević' }]);
    expect(model.summary).toEqual({ kind: 'person', person: 'Luka Knežević', team: 'Smjena A' });
    expect(model.shownCount).toBe(1);
  });

  describe('Posao (story 21.25)', () => {
    const roles = [
      { value: 'all', roleName: '', count: 4 },
      { value: 'dispecer', roleName: 'Dispečer', count: 2 },
      { value: 'none', roleName: '', count: 2 },
    ];

    it('offers every role held and no role, never "every role", and no chip while none is chosen', () => {
      const model = calendarFilterBarOf(monthWith({ roles }));

      expect(model.roles).toEqual([
        { id: 'dispecer', name: 'Dispečer', count: 2 },
        { id: 'none', name: '', count: 2 },
      ]);
      expect(model.role).toBeNull();
      expect(model.chips.map((chip) => chip.key)).toEqual(['team', 'role', 'person']);
      expect(model.activeCount).toBe(0);
    });

    it('offers no Posao field where nobody holds a role', () => {
      const model = calendarFilterBarOf(monthWith({ roles: [roles[0], roles[2]].filter((one) => one !== undefined) }));

      expect(model.roles).toEqual([]);
      expect(model.chips.map((chip) => chip.key)).toEqual(['team', 'person']);
    });

    it('narrows with a role, counting the people it shows, and combines with a team', () => {
      const model = calendarFilterBarOf(monthWith({ roles, role: 'dispecer', chosen: 'b' }));

      expect(model.chips).toEqual([
        { key: 'team', value: 'Smjena B' },
        { key: 'role', value: 'Dispečer' },
        { key: 'person', value: null },
      ]);
      expect(model.activeCount).toBe(2);
      expect(model.shownCount).toBe(2);
      expect(model.summaryRole).toEqual({ id: 'dispecer', name: 'Dispečer' });
    });

    it('says how many people a role leaves under every team', () => {
      const model = calendarFilterBarOf(monthWith({ roles, role: 'none' }));

      expect(model.summary).toEqual({ kind: 'all', teams: 2, people: 2 });
    });
  });
});

