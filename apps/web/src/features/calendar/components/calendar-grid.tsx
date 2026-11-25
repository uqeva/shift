import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCellBox } from '@/features/calendar/components/calendar-cell';
import { CalendarTeamDays } from '@/features/calendar/components/calendar-day-list';
import { CalendarLegend } from '@/features/calendar/components/calendar-legend';
import type { CalendarScreenState } from '@/features/calendar/hooks/use-calendar-screen';
import { DAY_DETAIL_POPUP } from '@/features/calendar/utils/day-detail';
import { MONTH_HEADING_ID, gridTabStopOf, isSameGridPosition, type GridPosition } from '@/features/calendar/utils/grid-keys';
import type { CalendarMonth, CalendarRow, CalendarTeamCell } from '@/features/calendar/utils/month';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';

/**
 * One data cell: a `gridcell` named in full by `cellLabelOf` (through
 * `gridCellLabelsOf`) — the date, the team, the type, the range and each
 * modifier, never a letter — with its drawing `aria-hidden` beside it.
 */
function renderCell(
  screen: CalendarScreenState,
  month: string,
  date: string,
  cell: CalendarTeamCell,
  label: string | undefined,
  position: GridPosition,
  tabStop: GridPosition,
): ReactNode {
  return (
    <TableCell
      key={cell.teamId}
      role="gridcell"
      data-row={position.row}
      data-column={position.column}
      tabIndex={isSameGridPosition(position, tabStop) ? 0 : -1}
      aria-label={label}
      aria-haspopup={DAY_DETAIL_POPUP}
      onFocus={(event) => {
        screen.remember(month, position);
        screen.reveal(event.currentTarget);
      }}
      onClick={(event) => {
        screen.openDay(cell.teamId, date, event.currentTarget);
      }}
      className="scroll-ml-28 scroll-mt-11 cursor-pointer px-1 py-1 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring print:px-0.5 print:py-px"
    >
      <CalendarCellBox cell={cell} inGrid />
    </TableCell>
  );
}

/** A date's row header, in the grid and in the strip's copy alike. */
function renderRowHeader(row: CalendarRow): ReactNode {
  return (
    <TableHead
      scope="row"
      className={
        row.isToday
          ? 'sticky left-0 z-10 h-auto whitespace-nowrap border-l-4 border-foreground bg-card py-1 text-sm font-bold normal-case tracking-normal text-foreground print:whitespace-normal print:px-1 print:py-px print:text-xs'
          : 'sticky left-0 z-10 h-auto whitespace-nowrap bg-card py-1 text-sm font-medium normal-case tracking-normal text-foreground print:whitespace-normal print:px-1 print:py-px print:text-xs'
      }
    >
      <span className="block tabular-nums print:inline">{row.dayMonth}</span>
      <span className="block text-xs font-normal text-muted-foreground print:ml-1 print:inline">{row.weekday}</span>
    </TableHead>
  );
}

/**
 * The header row, in the grid and in the strip's copy alike: the corner
 * (sticky on the left, which only the strip's ever shows) and a team per
 * column, each `h-11` — the strip's height and the grid's pull-up.
 */
function renderHeaderRow(shown: CalendarMonth): ReactNode {
  return (
    <TableRow>
      <TableHead
        scope="col"
        className="sticky left-0 z-30 h-11 w-28 min-w-28 bg-muted shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText] print:h-auto print:border-b print:px-1 print:py-1"
      >
        {t('kalendar.columnDate')}
      </TableHead>
      {shown.columns.map((team) => (
        <TableHead
          key={team.id}
          scope="col"
          className="h-11 whitespace-nowrap bg-muted normal-case shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText] print:h-auto print:whitespace-normal print:[overflow-wrap:anywhere] print:border-b print:px-1 print:py-1"
        >
          {team.name}
        </TableHead>
      ))}
    </TableRow>
  );
}

/**
 * THE STRIP's table (story 21.3): a VISUAL COPY of the grid — its header row
 * AND its body rows, the same content through the same primitives and
 * classes, in a table as wide as the grid — so auto table layout gives it the
 * grid's column widths by construction, never by measuring. The strip clips
 * everything below the header row. The copy has no roles, ids, handlers or
 * `aria-current`, is `inert`, and the strip around it is `aria-hidden`, so
 * the grid's own `thead` is what assistive technology and print read.
 */
function renderStripTable(shown: CalendarMonth): ReactNode {
  return (
    <table className="w-full caption-bottom text-sm">
      <TableHeader>{renderHeaderRow(shown)}</TableHeader>
      <TableBody>
        {shown.rows.map((row) => (
          <TableRow key={row.date}>
            {renderRowHeader(row)}
            {row.cells.map((cell) => (
              <TableCell key={cell.teamId} className="px-1 py-1">
                <CalendarCellBox cell={cell} inGrid />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </table>
  );
}

/**
 * *Sve smjene*'s grid (stories 3.1, 3.2b): a row per date and a column per
 * active team, an ARIA grid with one tab stop that the arrows, Home and End
 * move by `@/features/calendar/utils/grid-keys`, and the legend above it
 * while a mark is on screen. Below 640 px (`usePhone()`) it is not drawn: the
 * phone reads the same month as a day list of every shown team
 * (`CalendarTeamDays`, story 21.3), so a phone never scrolls sideways.
 * Exactly one form is in the DOM.
 *
 * THE PAGE SCROLLS, NEVER THE GRID (story 21.3). The grid has no height bound
 * and no vertical scroll container: a 28–31-row month is as tall as it is, and
 * the page scrolls it. Its one scroller is HORIZONTAL only
 * (`overflow-x-auto overflow-y-hidden`), so a wide month scrolls sideways
 * inside it and the page never does; the date column is sticky on that axis.
 *
 * THE HEADER IS A SEPARATE STRIP. An `overflow-x: auto` box is a sticky
 * element's scroll container on BOTH axes, so a header inside the scroller
 * could never stick to the page. The strip sits outside it, in the same
 * ISOLATED frame: sticky at the viewport's top, `h-11`, clipping its copy table to the
 * header row, and kept in step with the scroller's `scrollLeft` (its corner
 * is sticky on the left, as the date column is). The grid's real `thead`
 * stays in the table for assistive technology and print, pulled up `-mt-11`
 * behind the strip, where the scroller clips it; in its natural place it
 * coincides with the strip. In print the strip is not drawn and the pull-up is
 * lifted: the one table prints whole, its header row repeated on every page.
 *
 * A phone never draws the grid (it draws the day list), so the strip never
 * meets the phone's sticky head. Its `max-sm:top-[var(--sticky-head,0px)]`
 * is only a GUARD for the fractional gap between `usePhone()`'s
 * `(max-width: 639px)` and the `max-sm` breakpoint (below 640 px): at a
 * width such as 639.5 px the grid is drawn under `max-sm` CSS, and there the
 * strip sits under the head rather than behind it.
 *
 * THE MARGINS ARE THE SIZES: the date column is `w-28` and each cell's
 * `scroll-margin-left` is `28`; the strip is `h-11` and each cell's
 * `scroll-margin-top` is `11`. `useCalendarScreen`'s `reveal` scrolls a focused
 * cell inside them, so it lands clear of both.
 */
export function CalendarGrid({
  shown,
  screen,
}: {
  readonly shown: CalendarMonth;
  readonly screen: CalendarScreenState;
}): ReactNode {
  const isPhone = usePhone();
  const strip = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The strip follows the scroller after every render too: a month or a
  // filter that changes the width can move `scrollLeft` with no scroll event.
  useLayoutEffect(() => {
    if (strip.current !== null && scroller.current !== null) strip.current.scrollLeft = scroller.current.scrollLeft;
  });

  if (shown.columns.length === 0) {
    // STORY 19.4 (UX-DR70): the fact, and where a schedule comes from.
    return (
      <div className="grid gap-1 px-4 pb-4 text-sm">
        <p className="text-muted-foreground">{t('kalendar.noTeams')}</p>
        <p className="text-muted-foreground">{t('kalendar.noTeamsWhy')}</p>
      </div>
    );
  }

  if (isPhone) {
    return <CalendarTeamDays shown={shown} labels={screen.labels} openDay={screen.openDay} />;
  }

  const tabStop = gridTabStopOf(screen.gridFocus, shown.month, shown.rows, shown.columns.length);

  return (
    <>
      <CalendarLegend cells={shown.rows.flatMap((row) => row.cells)} />
      {/* The frame ISOLATES the sticky layers' stacking from the page's. */}
      <div data-grid-frame className="isolate">
        {/* The strip is `aria-hidden`; its copy is `inert`. An inert box is
            no target for a pointer either, so a press on the copy would land
            on the cell scrolled under it: the strip itself, outside the
            inert copy, takes the press and does nothing. */}
        <div
          aria-hidden
          data-grid-strip
          className="sticky top-0 z-20 h-11 bg-muted forced-colors:border-b forced-colors:border-[CanvasText] max-sm:top-[var(--sticky-head,0px)] print:hidden"
        >
          <div ref={strip} inert data-grid-strip-copy className="h-full overflow-hidden">
            {renderStripTable(shown)}
          </div>
        </div>
        <div
          ref={scroller}
          data-grid-scroller
          className="overflow-x-auto overflow-y-hidden print:overflow-visible"
          onScroll={(event) => {
            if (strip.current !== null) strip.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        >
          <table
            ref={screen.gridRef}
            className="-mt-11 w-full caption-bottom text-sm print:mt-0 print:table-fixed"
            role="grid"
            aria-readonly
            aria-labelledby={MONTH_HEADING_ID}
            onKeyDown={(event) => {
              screen.moveGridFocus(event, shown);
            }}
            onKeyUp={(event) => {
              screen.openOnKeyUp(event, shown);
            }}
          >
            <TableHeader>{renderHeaderRow(shown)}</TableHeader>
            <TableBody>
              {shown.rows.map((row, rowIndex) => (
                <TableRow key={row.date} aria-current={row.isToday ? 'date' : undefined} className="print:break-inside-avoid">
                  {renderRowHeader(row)}
                  {row.cells.map((cell, column) =>
                    renderCell(
                      screen,
                      shown.month,
                      row.date,
                      cell,
                      screen.labels?.[rowIndex]?.[column],
                      { row: rowIndex, column },
                      tabStop,
                    ),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </div>
    </>
  );
}
