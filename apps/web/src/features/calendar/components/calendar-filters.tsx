import type { ReactNode } from 'react';

import { FilterBar, activeFilterSummaryOf, type ToolbarSlots } from '@/components/filter-bar';
import { calendarFilterBarOf } from '@/features/calendar/utils/filters';
import type { CalendarFilterChange, CalendarMonth } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';
import { filterSummaryMessageKey, filterSummaryValuesOf } from '@/utils/filter-bar';

/**
 * *Kalendar*'s compact toolbar (stories 7.5, 21.23) with the filters of *Sve
 * smjene*: the shared filter bar's `Filtri` among the toolbar's controls,
 * Smjena and Osoba as chips under it with the summary as the result count.
 * Which team or person is chosen — an unknown or archived id being none — is
 * `calendarMonthOf`'s decision, and the bar's model is
 * `calendarFilterBarOf`'s: a person replaces the team (story 3.3b). The state
 * lives in the URL alone. `shown` is `null` where nothing is filtered —
 * *Moj raspored*, a month not yet read — and the toolbar is then drawn with
 * no filter part, as it is while the month offers no team and nobody.
 */
export function CalendarFilters({
  shown,
  toolbar,
  onFilter,
}: {
  readonly shown: CalendarMonth | null;
  readonly toolbar: ToolbarSlots;
  readonly onFilter: (change: CalendarFilterChange) => void;
}): ReactNode {
  const filtered = shown !== null && (shown.filter.teams.length !== 0 || shown.filter.people.length !== 0);

  return <FilterBar model={filtered ? calendarFilterBarOf(shown) : null} onChange={onFilter} toolbar={toolbar} />;
}

/** The active filters of *Sve smjene* as one line, or `null` with none on: the phone's sticky head repeats it (deferred-work E816). */
export function calendarFilterSummaryOf(shown: CalendarMonth): string | null {
  return activeFilterSummaryOf(calendarFilterBarOf(shown));
}

/**
 * STORY 16.1 (UX-DR56): what *Sve smjene* shows, in words, for the printed
 * month's header — the summary line the bar itself shows, with no filter on
 * too (`Prikazano: sve smjene (4) · 17 osoba`), so the paper says what the
 * screen said.
 */
export function calendarFilterWordsOf(shown: CalendarMonth): string {
  const { summary } = calendarFilterBarOf(shown);

  return t(filterSummaryMessageKey(summary), filterSummaryValuesOf(summary));
}
