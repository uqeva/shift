import { ALL_ROLES } from '@/features/members/services/list';
import type { CalendarMonth } from '@/features/calendar/utils/month';
import { filterBarOf, type FilterBarModel } from '@/utils/filter-bar';

/**
 * *Kalendar*'s filter bar (story 7.5), from the month shown: the Smjena chip's
 * options are every active team in column order, each with the people it
 * holds for the month; the Osoba chip's every person active in the month;
 * and since story 21.25 the *Posao* chip's every role held (and no role),
 * each with the people it would show, on *Ljudi*'s semantics.
 *
 * A PERSON REPLACES THE TEAM AND THE ROLE (story 3.3b): `combine: false`, so
 * the bar draws the Osoba chip alone while a person is chosen, and choosing
 * a person drops both. A team and a role combine. The people shown are the
 * chosen team's holding the chosen role, the one person, or everybody — what
 * `Prikaži {n} osoba` counts.
 */
export function calendarFilterBarOf(month: CalendarMonth): FilterBarModel {
  const { filter } = month;
  const countOf = (teamId: string): number => filter.teamCounts[teamId] ?? 0;
  const { roles, role } = filter;
  const shownCount =
    filter.person !== null
      ? 1
      : role !== null
        ? (roles.find((option) => option.value === role)?.count ?? 0)
        : filter.chosen !== null
          ? countOf(filter.chosen)
          : filter.people.length;

  return filterBarOf({
    combine: false,
    teams: filter.teams.map((team) => ({ id: team.id, name: team.name, count: countOf(team.id) })),
    team: filter.chosen,
    people: filter.people,
    person: filter.person,
    shownCount,
    roles: roles
      .filter((option) => option.value !== ALL_ROLES)
      .map((option) => ({ id: option.value, name: option.roleName, count: option.count })),
    role,
  });
}
