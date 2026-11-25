import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { CalendarCellBox } from '@/features/calendar/components/calendar-cell';
import { CalendarLegend } from '@/features/calendar/components/calendar-legend';
import { DAY_DETAIL_POPUP } from '@/features/calendar/utils/day-detail';
import { dayListLabelsOf } from '@/features/calendar/utils/modifiers';
import type {
  CalendarCell,
  CalendarDay,
  CalendarDayListOutcome,
  CalendarMonth,
  CalendarPersonMonth,
} from '@/features/calendar/utils/month';
import { dayEmptyMessageKey, dayListEmptyMessageKey } from '@/features/calendar/utils/empty-day';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { calendarMessageKey, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { PERSON_HEADING_ID } from '@/features/calendar/utils/element-ids';
import { MONTH_HEADING_ID } from '@/features/calendar/utils/grid-keys';
import { t } from '@/lib/i18n';

/** Opens `teamId` on `date`, `opener` getting focus back on close. */
type OpenDay = (teamId: string, date: string, opener: HTMLElement) => void;

/** A day on a team, as a button that opens that team's detail on that date (story 3.4b). */
function renderDayButton(
  openDay: OpenDay,
  teamId: string,
  date: string,
  cell: CalendarCell,
  label: string | null,
): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-11 min-w-0 flex-1 items-stretch whitespace-normal p-0 text-left print:min-h-0"
      aria-label={label ?? undefined}
      aria-haspopup={DAY_DETAIL_POPUP}
      onClick={(event) => {
        openDay(teamId, date, event.currentTarget);
      }}
    >
      <CalendarCellBox cell={cell} inGrid={false} labelled={label !== null} />
    </Button>
  );
}

/**
 * STORY 21.6: a Personal Shift counted with no team — a row of its own, not
 * a button, since a day detail is a team on a date. Named in full by its
 * label (`bez tima`, `dodijeljeno ručno`), as a button would be.
 */
function renderTeamlessShift(cell: CalendarCell, label: string | null): ReactNode {
  return (
    <span role="group" aria-label={label ?? undefined} className="flex min-h-11 min-w-0 flex-1 items-stretch print:min-h-0">
      <CalendarCellBox cell={cell} inGrid={false} noTeam labelled={label !== null} />
    </span>
  );
}

function renderDay(openDay: OpenDay, day: CalendarDay, labels: readonly (string | null)[]): ReactNode {
  return (
    <li
      key={day.date}
      aria-current={day.isToday ? 'date' : undefined}
      className={
        day.isToday
          ? 'flex min-h-11 items-center gap-3 border-l-4 border-foreground py-1 pl-2 pr-1 font-bold print:min-h-0 print:break-inside-avoid print:py-px'
          : 'flex min-h-11 items-center gap-3 py-1 pl-3 pr-1 print:min-h-0 print:break-inside-avoid print:py-px'
      }
    >
      <span className="w-20 shrink-0 text-sm print:w-28 print:text-xs">
        <span className="block tabular-nums print:inline">{day.dayMonth}</span>
        <span className="block text-xs font-normal text-muted-foreground print:ml-1 print:inline">{day.weekday}</span>
      </span>
      {day.shifts.length === 0 ? (
        <span className="text-sm text-muted-foreground">{t(dayEmptyMessageKey(day))}</span>
      ) : (
        // STORY 3.6a: one row per shift — the member's own team's, then each
        // one a roster override put them on.
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {day.shifts.map((shift, index) => (
            <span key={`${String(index)}-${String(shift.teamId)}`} className="flex min-w-0">
              {shift.teamId === null
                ? renderTeamlessShift(shift.cell, labels[index] ?? null)
                : renderDayButton(openDay, shift.teamId, day.date, shift.cell, labels[index] ?? null)}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/**
 * A day list — the viewer's, or the person chosen — or its own failure, or
 * the explanation `empty` gives when there is no team all month, or the
 * member is inactive all month (B449), never an empty list. The list is named
 * by the month's heading, after the person's when it is theirs.
 */
function renderDayList(
  snapshot: CalendarSnapshot | null,
  openDay: OpenDay,
  days: CalendarDayListOutcome,
  empty: (inactive: boolean) => string,
  ofPerson: boolean,
): ReactNode {
  // The day list's own failure: the alert and no list. The grid is unaffected.
  if (!days.ok) {
    return (
      <div className="px-4 pb-4">
        <Notice role="alert">{t(calendarMessageKey(days.code))}</Notice>
      </div>
    );
  }

  if (days.days === null) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{empty(days.inactive)}</p>;
  }

  // The button's name is the grid cell's full label: the date, the team,
  // the type, the times and each mark.
  const labels = snapshot === null ? [] : dayListLabelsOf(days.days, snapshot.teams, translateCellLabel);

  return (
    <>
      <CalendarLegend cells={days.days.flatMap((day) => day.shifts.map((shift) => shift.cell))} />
      <ol
        aria-labelledby={ofPerson ? `${PERSON_HEADING_ID} ${MONTH_HEADING_ID}` : MONTH_HEADING_ID}
        className="divide-y divide-border px-4 pb-4">
        {days.days.map((day, index) => renderDay(openDay, day, labels[index] ?? []))}
      </ol>
    </>
  );
}

/**
 * *Sve smjene* ON A PHONE (story 21.3): the grid's month as a day list, so a
 * phone never scrolls sideways, whatever the team count. Per date an `li`
 * (today `aria-current`), and in it every shown team — the grid's columns, so
 * one team filter narrows it — as a button: the team's name over the grid's
 * cell, its marks included, named in full by the gridcell's own label
 * (`screen.labels`) and opening that team's day. The buttons wrap, as many
 * to a line as fit at 6.5 rem each (one at 320 px), a track never wider than
 * the row however large the root font, and their words wrap inside them.
 * The list is named by the month's heading. `CalendarGrid` draws it in the
 * grid's place, by `usePhone()`.
 */
export function CalendarTeamDays({
  shown,
  labels,
  openDay,
}: {
  readonly shown: CalendarMonth;
  readonly labels: readonly (readonly string[])[] | null;
  readonly openDay: OpenDay;
}): ReactNode {
  return (
    <>
      <CalendarLegend cells={shown.rows.flatMap((row) => row.cells)} />
      <ol aria-labelledby={MONTH_HEADING_ID} className="divide-y divide-border px-4 pb-4">
        {shown.rows.map((row, rowIndex) => (
          <li
            key={row.date}
            aria-current={row.isToday ? 'date' : undefined}
            className={
              row.isToday
                ? 'flex min-w-0 items-start gap-3 border-l-4 border-foreground py-2 pl-2 pr-1 font-bold print:break-inside-avoid print:py-px'
                : 'flex min-w-0 items-start gap-3 py-2 pl-3 pr-1 print:break-inside-avoid print:py-px'
            }
          >
            <span className="w-20 shrink-0 pt-1 text-sm print:w-28 print:text-xs">
              <span className="block tabular-nums print:inline">{row.dayMonth}</span>
              <span className="block text-xs font-normal text-muted-foreground print:ml-1 print:inline">{row.weekday}</span>
            </span>
            {/* The row's remaining width is a CONTAINER, so a track is
                never wider than it (`100cqi`) however large the root font. */}
            <span className="@container min-w-0 flex-1">
              <span className="grid grid-cols-[repeat(auto-fill,minmax(min(6.5rem,100cqi),1fr))] gap-1">
                {row.cells.map((cell, column) => (
                  <Button
                    key={cell.teamId}
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-11 min-w-0 flex-col items-stretch gap-0.5 whitespace-normal p-0 text-left [overflow-wrap:anywhere] [&_div]:whitespace-normal print:min-h-0"
                    aria-label={labels?.[rowIndex]?.[column]}
                    aria-haspopup={DAY_DETAIL_POPUP}
                    onClick={(event) => {
                      openDay(cell.teamId, row.date, event.currentTarget);
                    }}
                  >
                    <span className="px-1 text-xs text-muted-foreground">{shown.columns[column]?.name}</span>
                    <CalendarCellBox cell={cell} inGrid={false} labelled />
                  </Button>
                ))}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** *Moj raspored* (story 3.2a): the viewer's own day list. */
export function CalendarDays({
  snapshot,
  days,
  openDay,
}: {
  readonly snapshot: CalendarSnapshot | null;
  readonly days: CalendarDayListOutcome;
  readonly openDay: OpenDay;
}): ReactNode {
  // What is true, never an empty list: the viewer is on no team, or inactive, this month.
  return renderDayList(snapshot, openDay, days, (inactive) => t(dayListEmptyMessageKey(inactive, false)), false);
}

/** The person chosen in *Sve smjene* (story 3.3b): their name, then their day list. */
export function CalendarPerson({
  snapshot,
  person,
  openDay,
}: {
  readonly snapshot: CalendarSnapshot | null;
  readonly person: CalendarPersonMonth;
  readonly openDay: OpenDay;
}): ReactNode {
  return (
    <>
      <h3 id={PERSON_HEADING_ID} className="px-4 pb-3 font-heading text-lg font-semibold">
        {person.name}
      </h3>
      {renderDayList(
        snapshot,
        openDay,
        person.days,
        (inactive) => t(dayListEmptyMessageKey(inactive, true), { name: person.name }),
        true,
      )}
    </>
  );
}
