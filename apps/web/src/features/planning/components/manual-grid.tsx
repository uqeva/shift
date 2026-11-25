import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { PencilSimple, Repeat } from '@/components/ui/icon';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MANUAL_HEADING_ID, manualCellIdOf, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import {
  CELL_ASSIGNED,
  CELL_ROTATION,
  SOURCE_TEAM,
  draftKeyOf,
  type ManualCell,
  type ManualDate,
  type ManualGroup,
  type ManualMonth,
  type ManualRow,
} from '@/features/planning/services/manual-grid';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { NO_TEXT } from '@/utils/text';

/** A row's source in words (UX-DR73). */
export function sourceText(row: ManualRow): string {
  return row.source === SOURCE_TEAM ? t('rucniRaspored.source.team') : t('rucniRaspored.source.manual');
}

/** What a cell holds, in words: the type's name, *slobodno*, or nothing. */
function valueText(cell: ManualCell, typeName: (id: string) => string): string {
  if (cell.off) return t('rucniRaspored.cell.off');
  if (cell.shiftTypeId === null) return t('rucniRaspored.cell.empty');

  return typeName(cell.shiftTypeId);
}

/**
 * A cell's accessible name, in full: who, the date, what it holds, where it
 * comes from (`dodijeljeno ručno`, UX-DR73, or the rotation), the team it
 * counts with, a second shift, an unsaved change and an inactive date.
 */
export function cellLabelOf(
  cell: ManualCell,
  name: string,
  date: ManualDate | undefined,
  typeName: (id: string) => string,
  teamName: (id: string) => string,
): string {
  const parts = [
    t('rucniRaspored.cell.label', {
      name,
      weekday: date?.weekday ?? NO_TEXT,
      date: date?.dayMonth ?? cell.date,
      value: valueText(cell, typeName),
    }),
  ];

  if (date?.today === true) parts.push(t('rucniRaspored.cell.today'));

  if (cell.source === CELL_ASSIGNED) parts.push(t('rucniRaspored.cell.assigned'));
  if (cell.source === CELL_ROTATION) parts.push(t('rucniRaspored.cell.rotation'));
  if (cell.countedTeamId !== null) parts.push(t('rucniRaspored.cell.counted', { team: teamName(cell.countedTeamId) }));
  if (cell.more) parts.push(t('rucniRaspored.cell.more'));
  if (cell.changed) parts.push(t('rucniRaspored.cell.changed'));
  if (!cell.active) parts.push(t('rucniRaspored.cell.inactive'));

  return parts.join(t('rucniRaspored.cell.separator'));
}

/**
 * The drawing of a cell, `aria-hidden` beside its name: the type's letter, or
 * the off mark, solid with a pencil when assigned (UX-DR73), muted with the
 * rotation glyph when the rotation gives it; a dashed edge while unsaved, a
 * hatch on a date the member is inactive, and `+` when it counts with another team.
 */
export function CellMark({ cell }: { readonly cell: ManualCell }): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex h-9 min-w-9 items-center justify-center rounded-sm px-1 tabular-nums text-muted-foreground',
        cell.source === CELL_ASSIGNED && 'bg-ink font-semibold text-ink-foreground',
        cell.source === CELL_ROTATION && cell.working && 'bg-muted',
        !cell.active && 'opacity-50 [background-image:repeating-linear-gradient(135deg,transparent_0_4px,var(--border)_4px_5px)]',
        cell.changed && 'outline-2 outline-offset-1 outline-dashed outline-foreground',
        cell.more && 'underline decoration-2 underline-offset-2',
      )}
    >
      {cell.off ? t('rucniRaspored.offMark') : cell.letter}
      {cell.countedTeamId === null ? null : <span className="text-[0.625rem] leading-none">{t('rucniRaspored.countedMark')}</span>}
      {cell.source === CELL_ASSIGNED ? <PencilSimple className="absolute -right-0.5 -top-0.5 size-2.5" /> : null}
      {cell.source === CELL_ROTATION ? <Repeat className="absolute -right-0.5 -top-0.5 size-2.5" /> : null}
    </span>
  );
}

/** A date's column header, in the grid and in the strip's copy alike: the day and its weekday, today and weekends marked. */
function renderDateHead(date: ManualDate): ReactNode {
  return (
    <TableHead
      key={date.date}
      scope="col"
      className={cn(
        'h-11 min-w-11 bg-muted px-0.5 text-center normal-case tracking-normal shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText]',
        date.weekend && 'bg-secondary',
        date.today && 'border-x-2 border-foreground text-foreground',
      )}
    >
      <span className="block text-xs font-semibold tabular-nums text-foreground">{date.day}</span>
      <span className="block text-[0.6875rem] font-normal">{date.weekday}</span>
    </TableHead>
  );
}

/** The header row: the corner (sticky on the left), then a column per date. */
function renderHeaderRow(shown: ManualMonth): ReactNode {
  return (
    <TableRow>
      <TableHead
        scope="col"
        className="sticky left-0 z-30 h-11 w-40 min-w-40 bg-muted shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText]"
      >
        {t('rucniRaspored.column.person')}
      </TableHead>
      {shown.dates.map(renderDateHead)}
    </TableRow>
  );
}

/** A group's heading row: the team as at the month's first date, or *Bez tima*. Its words stay on screen as the grid scrolls sideways. */
function renderGroupHead(group: ManualGroup, columns: number): ReactNode {
  return (
    <TableRow className="hover:bg-transparent">
      <TableHead scope="colgroup" colSpan={columns + 1} className="h-9 bg-card px-0 normal-case tracking-normal">
        <span className="sticky left-0 inline-block px-3 text-sm font-semibold text-foreground">
          {group.name ?? t('rucniRaspored.noTeam')}
        </span>
      </TableHead>
    </TableRow>
  );
}

/** A member's row header: the name and the row's source. */
function renderRowHead(row: ManualRow): ReactNode {
  return (
    <TableHead scope="row" className="sticky left-0 z-10 h-auto w-40 min-w-40 bg-card py-1 normal-case tracking-normal">
      <span className="block truncate text-sm font-medium text-foreground">{row.name}</span>
      <span className="block text-xs font-normal text-muted-foreground">{sourceText(row)}</span>
    </TableHead>
  );
}

/**
 * THE STRIP's table (as 21.3's calendar grid): a visual copy of the grid —
 * the header row and every body row, through the same primitives and
 * classes — so its columns are the grid's widths by construction. No roles,
 * ids or handlers; `inert` inside an `aria-hidden` strip.
 */
function renderStripTable(shown: ManualMonth): ReactNode {
  return (
    <table className="w-full caption-bottom text-sm">
      <TableHeader>{renderHeaderRow(shown)}</TableHeader>
      {shown.groups.map((group) => (
        <TableBody key={group.teamId ?? group.rows[0]?.memberId}>
          {renderGroupHead(group, shown.dates.length)}
          {group.rows.map((row) => (
            <TableRow key={row.memberId}>
              {renderRowHead(row)}
              {row.cells.map((cell) => (
                <TableCell key={cell.date} className="p-1">
                  <CellMark cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      ))}
    </table>
  );
}

/**
 * One data cell: a `gridcell` named in full ({@link cellLabelOf}), selected
 * or not (`aria-selected`), the grid's one tab stop or not, its drawing
 * `aria-hidden` beside it. A press starts a selection or a drag; the picker
 * opens on release (`screen.pointerUp`).
 */
function renderCell(
  screen: ManualScreen,
  row: ManualRow,
  cell: ManualCell,
  date: ManualDate | undefined,
  typeName: (id: string) => string,
  teamName: (id: string) => string,
): ReactNode {
  const ref = { memberId: row.memberId, date: cell.date };
  const selected = screen.selectedKeys.has(draftKeyOf(ref));
  const stop = screen.tabStop !== null && draftKeyOf(screen.tabStop) === draftKeyOf(ref);

  return (
    <TableCell
      key={cell.date}
      id={manualCellIdOf(ref)}
      role="gridcell"
      tabIndex={stop ? 0 : -1}
      aria-selected={selected}
      aria-haspopup="dialog"
      aria-label={cellLabelOf(cell, row.name, date, typeName, teamName)}
      onPointerDown={(event) => {
        screen.pointerDown(ref, event);
      }}
      onPointerEnter={() => {
        screen.pointerEnter(ref);
      }}
      className={cn(
        'scroll-ml-40 scroll-mt-11 cursor-pointer p-1 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        date?.weekend === true && 'bg-secondary/60',
        date?.today === true && 'border-x-2 border-foreground',
        selected && 'bg-accent shadow-[inset_0_0_0_2px_var(--color-primary)]',
      )}
    >
      <CellMark cell={cell} />
    </TableCell>
  );
}

/**
 * *RUČNI RASPORED*'s grid from 640 px (story 21.4; UX-DR71, UX-DR72): a row
 * per member, grouped by team (no team last), a column per date. One ARIA
 * grid, multi-selectable, with one tab stop (`screen.tabStop`); the keys are
 * `screen.gridKey`'s, the pointer's `pointerDown`/`pointerEnter`/`pointerUp`.
 *
 * THE PAGE SCROLLS, NEVER THE GRID (UX-DR71, as 21.3's calendar): no height
 * bound and no vertical scroller. The one scroller is horizontal
 * (`overflow-x-auto overflow-y-hidden`), the name column sticky on it. The
 * date header is a separate sticky STRIP outside it, a visual copy kept in
 * step with the scroller's `scrollLeft`; the grid's real `thead` is pulled up
 * `-mt-11` behind it for assistive technology. The margins are the sizes:
 * the name column is `w-40` (each cell's `scroll-ml-40`), the strip `h-11`
 * (each cell's `scroll-mt-11`).
 */
export function ManualGrid({ screen, shown }: { readonly screen: ManualScreen; readonly shown: ManualMonth }): ReactNode {
  const strip = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const types = new Map((screen.snapshot?.types ?? []).map((type) => [type.id, type.name]));
  const teams = new Map((screen.snapshot?.teams ?? []).map((team) => [team.id, team.name]));
  const typeName = (id: string): string => types.get(id) ?? t('rucniRaspored.cell.unknownType');
  const teamName = (id: string): string => teams.get(id) ?? t('rucniRaspored.noTeam');

  useLayoutEffect(() => {
    if (strip.current !== null && scroller.current !== null) strip.current.scrollLeft = scroller.current.scrollLeft;
  });

  return (
    <div data-grid-frame className="isolate">
      <div
        aria-hidden
        data-grid-strip
        className="sticky top-0 z-20 h-11 bg-muted forced-colors:border-b forced-colors:border-[CanvasText] max-sm:top-[var(--sticky-head,0px)]"
      >
        <div ref={strip} inert data-grid-strip-copy className="h-full overflow-hidden">
          {renderStripTable(shown)}
        </div>
      </div>
      <div
        ref={scroller}
        data-grid-scroller
        className="overflow-x-auto overflow-y-hidden"
        onScroll={(event) => {
          if (strip.current !== null) strip.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <table
          className="-mt-11 w-full caption-bottom select-none text-sm"
          role="grid"
          aria-multiselectable
          aria-labelledby={MANUAL_HEADING_ID}
          onKeyDown={screen.gridKey}
          onPointerUp={screen.pointerUp}
          // A macOS Ctrl-click toggles a cell; it never also opens the context menu.
          onContextMenu={(event) => {
            if (event.ctrlKey) event.preventDefault();
          }}
        >
          <TableHeader>{renderHeaderRow(shown)}</TableHeader>
          {shown.groups.map((group) => (
            <TableBody key={group.teamId ?? group.rows[0]?.memberId}>
              {renderGroupHead(group, shown.dates.length)}
              {group.rows.map((row) => (
                <TableRow key={row.memberId}>
                  {renderRowHead(row)}
                  {row.cells.map((cell, column) => renderCell(screen, row, cell, shown.dates[column], typeName, teamName))}
                </TableRow>
              ))}
            </TableBody>
          ))}
        </table>
      </div>
    </div>
  );
}
