import type { ReactNode } from 'react';

import {
  DateGridCorner,
  DateGridFrame,
  DateGridGroupHead,
  DateGridRowHead,
  DateHead,
} from '@/components/date-grid';
import { TableBody, TableCell, TableRow } from '@/components/ui/table';
import { CalendarLetterBox } from '@/features/calendar/components/calendar-cell';
import { CalendarTeamDays } from '@/features/calendar/components/calendar-day-list';
import { CalendarLegend } from '@/features/calendar/components/calendar-legend';
import type { CalendarScreenState } from '@/features/calendar/hooks/use-calendar-screen';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { DAY_DETAIL_POPUP } from '@/features/calendar/utils/day-detail';
import { MONTH_HEADING_ID, gridTabStopOf, isSameGridPosition, type GridPosition } from '@/features/calendar/utils/grid-keys';
import { LABEL_SEPARATOR, cellLabelOf } from '@/features/calendar/utils/modifiers';
import {
  paperRowCountOf,
  type CalendarCell,
  type CalendarMonth,
  type CalendarPersonCell,
  type CalendarPersonRow,
} from '@/features/calendar/utils/month';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DATE_CELL_SCROLL_CLASS, dateCellClassOf, gridDatesOf, type GridDate } from '@/utils/grid-dates';
import { NO_TEXT } from '@/utils/text';

/** What one data cell opens, and how it is named. */
interface LiveCell {
  readonly label: string | undefined;
  /** The team whose day the cell opens on its date, or `null`: it opens nothing. */
  readonly teamId: string | null;
}

/**
 * One data cell. In the grid: a `gridcell` named in full, at its position
 * (`data-row`, `data-column`), the one tab stop or not, opening its day on a
 * click. In the strip's copy (`copy`): the drawing alone — no role, position,
 * name, handler or tab stop.
 */
function renderCell(
  screen: CalendarScreenState,
  month: string,
  date: GridDate,
  live: LiveCell,
  position: GridPosition,
  tabStop: GridPosition,
  drawing: ReactNode,
  copy: boolean,
): ReactNode {
  if (copy) {
    return (
      <TableCell
        key={date.date}
        className={cn(
          DATE_CELL_SCROLL_CLASS,
          'p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring print:p-px',
          live.teamId !== null && 'cursor-pointer',
          dateCellClassOf(date),
        )}
      >
        {drawing}
      </TableCell>
    );
  }

  return (
    <TableCell
      key={date.date}
      role="gridcell"
      data-row={position.row}
      data-column={position.column}
      data-today={date.today ? true : undefined}
      tabIndex={isSameGridPosition(position, tabStop) ? 0 : -1}
      aria-label={live.label}
      aria-haspopup={live.teamId === null ? undefined : DAY_DETAIL_POPUP}
      onFocus={(event) => {
        screen.remember(month, position);
        screen.reveal(event.currentTarget);
      }}
      onClick={(event) => {
        if (live.teamId !== null) screen.openDay(live.teamId, date.date, event.currentTarget);
      }}
      className={cn(
        DATE_CELL_SCROLL_CLASS,
        'p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring print:p-px',
        live.teamId !== null && 'cursor-pointer',
        dateCellClassOf(date),
      )}
    >
      {drawing}
    </TableCell>
  );
}

/**
 * A person's cell named in full, as a team's is (`cellLabelOf`): the date,
 * the person, the type with its times (or *slobodno*, or *nema smjene*), each
 * mark, *dodijeljeno ručno* for an assigned day and an inactive date.
 */
function personLabelOf(row: CalendarPersonRow, cell: CalendarPersonCell, date: { readonly weekday: string; readonly dayMonth: string }): string {
  const name = cell.cell?.name ?? (cell.off ? t('kalendar.paper.cell.off') : t('kalendar.paper.cell.none'));
  const parts = [
    cellLabelOf(
      {
        weekday: date.weekday,
        dayMonth: date.dayMonth,
        teamName: row.name,
        name,
        range: cell.cell?.range ?? null,
        modifiers: cell.cell?.modifiers ?? [],
        // STORY 21.6 (UX-DR73): an assigned day is named `dodijeljeno ručno`, as everywhere.
        assigned: cell.assigned,
      },
      translateCellLabel,
    ),
  ];

  if (!cell.active) parts.push(t('kalendar.paper.cell.inactive'));
  if (row.unavailable) parts.push(t('kalendar.paper.unavailable'));

  return parts.join(LABEL_SEPARATOR);
}

/** The letters the month draws, once each in the types' own order (`order`, by id), with the type's name: the paper's key. */
function lettersOf(
  cells: readonly (CalendarCell | null)[],
  order: readonly string[],
): readonly { readonly letter: string; readonly name: string }[] {
  const seen = new Map<string, { readonly letter: string; readonly name: string; readonly place: number }>();

  const add = (shiftTypeId: string | null, letter: string | null, name: string | null): void => {
    if (shiftTypeId === null || letter === null || name === null || seen.has(letter)) return;

    const place = order.indexOf(shiftTypeId);

    seen.set(letter, { letter, name, place: place === -1 ? order.length : place });
  };

  for (const cell of cells) {
    if (cell === null) continue;
    add(cell.shiftTypeId, cell.letter, cell.name);
    // STORY 21.6: a staffing group's letter is drawn too, so the key names it.
    for (const group of cell.groups ?? []) add(group.shiftTypeId, group.letter, group.name);
  }

  return [...seen.values()].sort((one, other) => one.place - other.place);
}

/**
 * *Sve smjene*'s grid (stories 3.1, 3.2b; since story 21.25, UX-DR83, *KALENDAR
 * KAO PAPIR*): the month as the paper roster reads it — a column per date,
 * and in rows first the teams (`teamRows`), each its type per date,
 * then the people on a personal or manual schedule (`peopleGroups`), grouped
 * by job role. One ARIA grid with one tab stop that the arrows, Home and End
 * move by `@/features/calendar/utils/grid-keys`; a cell — clicked, or Enter
 * or Space on it — opens the day detail. The key of letters and the legend of
 * marks are above it.
 *
 * Below 640 px (`usePhone()`) it is not drawn: the phone keeps 21.3's day
 * list of every shown team (`CalendarTeamDays`), so a phone never scrolls
 * sideways. Exactly one form is in the DOM.
 *
 * THE PAGE SCROLLS, NEVER THE GRID (story 21.3, UX-DR71): the frame, the
 * sticky date strip and the sticky name column are *Ručni raspored*'s own
 * pieces (`@/components/date-grid`), so the two grids read and scroll alike.
 * Each renderer here draws the strip's copy too (`copy`), with none of the
 * live attributes: `renderCell` returns the copy's cell before it sets any.
 */
export function CalendarGrid({
  shown,
  screen,
}: {
  readonly shown: CalendarMonth;
  readonly screen: CalendarScreenState;
}): ReactNode {
  const isPhone = usePhone();

  const filtered = shown.filter.chosen !== null || shown.filter.role !== null;

  // No active team at all: on a phone always (its list is the teams'), from 640 px while nobody is shown either.
  if (shown.filter.teams.length === 0 && (isPhone || (shown.peopleGroups.length === 0 && !filtered))) {
    // STORY 19.4 (UX-DR70): the fact, and where a schedule comes from.
    return (
      <div className="grid gap-1 px-4 pb-4 text-sm">
        <p className="text-muted-foreground">{t('kalendar.noTeams')}</p>
        <p className="text-muted-foreground">{t('kalendar.noTeamsWhy')}</p>
      </div>
    );
  }

  if (isPhone) {
    return shown.columns.length === 0 ? (
      <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.paper.empty')}</p>
    ) : (
      <CalendarTeamDays shown={shown} labels={screen.labels} openDay={screen.openDay} />
    );
  }

  const rows = paperRowCountOf(shown);

  // Every active team is a row, so no row is a filter that leaves nothing.
  if (rows === 0) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.paper.empty')}</p>;
  }

  const dates = gridDatesOf(
    shown.rows.map((row) => row.date),
    shown.rows.find((row) => row.isToday)?.date ?? NO_TEXT,
  );
  const tabStop = gridTabStopOf(screen.gridFocus, shown.month, dates, rows);
  const people = shown.peopleGroups.flatMap((group) => group.rows);
  const personCells = people.flatMap((row) => row.cells.map((cell) => cell.cell));
  const teamCells = shown.teamRows.flatMap((row) => row.cells);
  const letters = lettersOf([...teamCells, ...personCells], (screen.snapshot?.types ?? []).map((type) => type.id));
  const anyOff = people.some((row) => row.cells.some((cell) => cell.off));
  const peopleStart = shown.teamRows.length;
  const rowOf = new Map(people.map((row, index) => [row.memberId, peopleStart + index]));

  return (
    <>
      {/* THE PAPER'S KEY: what each letter is and *Slobodno*'s mark; the assigned pencil is the legend's (story 21.6). */}
      <ul
        aria-label={t('kalendar.paper.letters')}
        className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 px-4 pb-3 text-sm text-muted-foreground"
      >
        {letters.map((entry) => (
          <li key={entry.letter}>{t('kalendar.paper.letter', { letter: entry.letter, name: entry.name })}</li>
        ))}
        {anyOff ? <li>{t('kalendar.paper.off', { mark: t('kalendar.paper.offMark') })}</li> : null}
      </ul>
      <CalendarLegend cells={[...teamCells, ...personCells]} />
      <DateGridFrame
        header={(copy) => (
          <TableRow>
            <DateGridCorner>{t('kalendar.paper.corner')}</DateGridCorner>
            {dates.map((date) => (
              <DateHead key={date.date} date={date} copy={copy} />
            ))}
          </TableRow>
        )}
        body={(copy) => (
          <>
            {shown.teamRows.length === 0 ? null : (
              <TableBody>
                <DateGridGroupHead name={t('kalendar.paper.teams')} columns={dates.length} />
                {shown.teamRows.map((teamRow, row) => (
                  <TableRow key={teamRow.team.id} data-team-row className="print:break-inside-avoid">
                    <DateGridRowHead name={teamRow.team.name} line={null} />
                    {teamRow.cells.map((cell, column) => {
                      const date = dates[column];

                      return date === undefined
                        ? null
                        : renderCell(
                            screen,
                            shown.month,
                            date,
                            { label: screen.labels?.[column]?.[teamRow.column], teamId: teamRow.team.id },
                            { row, column },
                            tabStop,
                            <CalendarLetterBox cell={cell} />,
                            copy,
                          );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            )}
            {shown.peopleGroups.map((group) => (
              <TableBody key={group.roleId ?? group.rows[0]?.memberId}>
                <DateGridGroupHead name={group.roleName ?? t('kalendar.paper.noRole')} columns={dates.length} />
                {group.rows.map((person) => (
                  <TableRow key={person.memberId} className="print:break-inside-avoid">
                    <DateGridRowHead
                      name={person.name}
                      line={person.unavailable ? t('kalendar.paper.unavailable') : (person.teamName ?? t('kalendar.paper.noTeam'))}
                    />
                    {person.cells.map((cell, column) => {
                      const date = dates[column];
                      const row = shown.rows[column];

                      return date === undefined || row === undefined
                        ? null
                        : renderCell(
                            screen,
                            shown.month,
                            date,
                            { label: copy ? undefined : personLabelOf(person, cell, row), teamId: cell.teamId },
                            { row: rowOf.get(person.memberId) ?? peopleStart, column },
                            tabStop,
                            <CalendarLetterBox cell={cell.cell} off={cell.off} assigned={cell.assigned} inactive={!cell.active} />,
                            copy,
                          );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            ))}
          </>
        )}
        tableRef={screen.gridRef}
        labelledBy={MONTH_HEADING_ID}
        className="print:table-fixed"
        onKeyDown={(event) => {
          screen.moveGridFocus(event, shown);
        }}
        onKeyUp={(event) => {
          screen.openOnKeyUp(event, shown);
        }}
      />
    </>
  );
}
