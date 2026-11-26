import { formatIsoDayMonth, formatIsoWeekdayShortName } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

/**
 * THE DATE COLUMNS OF A PAPER GRID (stories 21.4, 21.25): *Ručni raspored*
 * and *Kalendar*'s *Sve smjene* both read a month the way the paper roster
 * does, a column per date. What each column head says, and which dates are a
 * weekend or today, is decided here once, so the two grids cannot disagree.
 * Pure (AD-15); the screens draw it through `@/components/date-grid`.
 */

/** One date column: the day, the date and its short weekday, a weekend and today marked. */
export interface GridDate {
  readonly date: string;
  /** `12.` */
  readonly day: string;
  /** `12.11.` */
  readonly dayMonth: string;
  /** `pon` */
  readonly weekday: string;
  readonly weekend: boolean;
  readonly today: boolean;
  /** STORY 21.18 (UX-DR78): the date's holiday name, its head drawing the star. ABSENT on every other date. */
  readonly holiday?: string;
}

/** The weekday of a civil date (no zone): 0 is Sunday, 6 Saturday. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Sakamoto's method.
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  const y = month < 3 ? year - 1 : year;

  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + (offsets[month - 1] ?? 0) + day) % 7;
}

/** Saturday or Sunday, by the civil date alone (no zone). */
export function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);

  return weekday === 0 || weekday === 6;
}

/**
 * The date columns of `dates` (`YYYY-MM-DD`, in order), `today` marked, and
 * each holiday among `holidays` (story 21.18: its names by date) named.
 */
export function gridDatesOf(
  dates: readonly string[],
  today: string,
  holidays: ReadonlyMap<string, string> = NO_HOLIDAYS,
): readonly GridDate[] {
  return dates.map((date) => {
    const holiday = holidays.get(date);

    return {
      date,
      day: `${String(Number(date.slice(8, 10)))}.`,
      dayMonth: formatIsoDayMonth(date) ?? date,
      weekday: formatIsoWeekdayShortName(date) ?? '',
      weekend: isWeekend(date),
      today: date === today,
      ...(holiday === undefined ? {} : { holiday }),
    };
  });
}

const NO_HOLIDAYS: ReadonlyMap<string, string> = new Map();

/**
 * The scroll margins every data cell of a paper grid carries: the first
 * column's width (`w-40`) and the sticky date strip's height (`h-11`), so a
 * cell revealed by the keys lands clear of both (`@/components/date-grid`).
 */
export const DATE_CELL_SCROLL_CLASS = 'scroll-ml-40 scroll-mt-11';

/** A data cell's column marks: a weekend tinted, today's column edged. */
export function dateCellClassOf(date: GridDate | undefined): string {
  return cn(date?.weekend === true && 'bg-secondary/60', date?.today === true && 'border-x-2 border-foreground');
}
