import type { ReactNode } from 'react';

import {
  DateGridCorner,
  DateGridFrame,
  DateGridGroupHead,
  DateGridRowHead,
  DateHead,
} from '@/components/date-grid';
import { PencilSimple, Repeat, Star } from '@/components/ui/icon';
import { TableBody, TableCell, TableRow } from '@/components/ui/table';
import { HATCH_LEAVE_CLASS } from '@/features/calendar/utils/modifiers';
import { MANUAL_HEADING_ID, manualCellIdOf, type ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import {
  CELL_ASSIGNED,
  CELL_ROTATION,
  SOURCE_PERSONAL,
  SOURCE_TEAM,
  draftKeyOf,
  type ManualCell,
  type ManualDate,
  type ManualMonth,
  type ManualRow,
} from '@/features/planning/services/manual-grid';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DATE_CELL_SCROLL_CLASS, dateCellClassOf } from '@/utils/grid-dates';
import { NO_TEXT } from '@/utils/text';

/**
 * A row's line under the name: its job role, when it has one (story 21.12's
 * entry, built by 21.5), and its source in words (UX-DR73) — `Vod · rotacija
 * tima`, `osobna rotacija` (story 21.10) or `ručno`.
 */
export function sourceText(row: ManualRow): string {
  const source =
    row.source === SOURCE_TEAM
      ? t('rucniRaspored.source.team')
      : row.source === SOURCE_PERSONAL
        ? t('rucniRaspored.source.personal')
        : t('rucniRaspored.source.manual');

  return row.jobRole === null ? source : t('rucniRaspored.rowLine', { role: row.jobRole, source });
}

/** What a cell holds, in words: the type's name, *slobodno*, or nothing. */
function valueText(cell: ManualCell, typeName: (id: string) => string): string {
  if (cell.off) return t('rucniRaspored.cell.off');
  // STORY 21.18: a holiday emptied the member's team shift.
  if (cell.holiday === true) return t('rucniRaspored.cell.holiday');
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
      // STORY 21.18: `blagdan {name}` after the date, as the calendar's cells.
      date:
        date?.holiday === undefined
          ? (date?.dayMonth ?? cell.date)
          : `${date.dayMonth}${t('rucniRaspored.cell.separator')}${t('kalendar.holiday.label', { name: date.holiday })}`,
      value: valueText(cell, typeName),
    }),
  ];

  if (date?.today === true) parts.push(t('rucniRaspored.cell.today'));

  if (cell.source === CELL_ASSIGNED) parts.push(t('rucniRaspored.cell.assigned'));
  if (cell.source === CELL_ROTATION) parts.push(t('rucniRaspored.cell.rotation'));
  if (cell.countedTeamId !== null) parts.push(t('rucniRaspored.cell.counted', { team: teamName(cell.countedTeamId) }));
  if (cell.more) parts.push(t('rucniRaspored.cell.more'));
  // STORY 21.7: the absence the paper shows, named, never colour alone.
  if (cell.onLeave) parts.push(t('rucniRaspored.cell.leave'));
  if (cell.changed) parts.push(t('rucniRaspored.cell.changed'));
  if (!cell.active) parts.push(t('rucniRaspored.cell.inactive'));

  return parts.join(t('rucniRaspored.cell.separator'));
}

/**
 * The drawing of a cell, `aria-hidden` beside its name: the type's letter, or
 * the off mark, solid with a pencil when assigned (UX-DR73), muted with the
 * rotation glyph when the rotation gives it; a dashed edge while unsaved, a
 * hatch on a date the member is inactive, the calendar's leave hatch on a date
 * the member is on leave (story 21.7), and `+` when it counts with another team.
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
        // STORY 21.7: the calendar's own leave hatch, drawn in the cell's foreground.
        // An inactive date keeps its own hatch (both are named in the label).
        cell.onLeave && cell.active && HATCH_LEAVE_CLASS,
      )}
    >
      {cell.off ? t('rucniRaspored.offMark') : cell.holiday === true ? <Star data-holiday-off className="size-3.5" /> : cell.letter}
      {cell.countedTeamId === null ? null : <span className="text-[0.625rem] leading-none">{t('rucniRaspored.countedMark')}</span>}
      {cell.source === CELL_ASSIGNED ? <PencilSimple className="absolute -right-0.5 -top-0.5 size-2.5" /> : null}
      {cell.source === CELL_ROTATION ? <Repeat className="absolute -right-0.5 -top-0.5 size-2.5" /> : null}
    </span>
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
  copy: boolean,
): ReactNode {
  const ref = { memberId: row.memberId, date: cell.date };
  const selected = screen.selectedKeys.has(draftKeyOf(ref));
  const stop = screen.tabStop !== null && draftKeyOf(screen.tabStop) === draftKeyOf(ref);

  // THE STRIP'S COPY: the same drawing, no role, id, handler or tab stop.
  if (copy) {
    return (
      <TableCell key={cell.date} className={cn('p-1', dateCellClassOf(date))}>
        <CellMark cell={cell} />
      </TableCell>
    );
  }

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
        DATE_CELL_SCROLL_CLASS,
        'cursor-pointer p-1 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        dateCellClassOf(date),
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
 * THE PAGE SCROLLS, NEVER THE GRID (UX-DR71): the frame, the sticky date
 * strip, the corner, the date heads and the row heads are the paper grid's
 * shared pieces (`@/components/date-grid`, story 21.25), which *Kalendar*'s
 * *Sve smjene* draws its month with too; each renderer here draws the strip's
 * copy (`copy`) with no role, id, handler or tab stop.
 */
export function ManualGrid({ screen, shown }: { readonly screen: ManualScreen; readonly shown: ManualMonth }): ReactNode {
  const types = new Map((screen.snapshot?.types ?? []).map((type) => [type.id, type.name]));
  const teams = new Map((screen.snapshot?.teams ?? []).map((team) => [team.id, team.name]));
  const typeName = (id: string): string => types.get(id) ?? t('rucniRaspored.cell.unknownType');
  const teamName = (id: string): string => teams.get(id) ?? t('rucniRaspored.noTeam');

  return (
    <DateGridFrame
      header={(copy) => (
        <TableRow>
          <DateGridCorner>{t('rucniRaspored.column.person')}</DateGridCorner>
          {shown.dates.map((date) => (
            <DateHead key={date.date} date={date} copy={copy} />
          ))}
        </TableRow>
      )}
      body={(copy) =>
        shown.groups.map((group) => (
          <TableBody key={group.teamId ?? group.rows[0]?.memberId}>
            <DateGridGroupHead name={group.name ?? t('rucniRaspored.noTeam')} columns={shown.dates.length} />
            {group.rows.map((row) => (
              <TableRow key={row.memberId}>
                <DateGridRowHead name={row.name} line={sourceText(row)} />
                {row.cells.map((cell, column) =>
                  renderCell(screen, row, cell, shown.dates[column], typeName, teamName, copy),
                )}
              </TableRow>
            ))}
          </TableBody>
        ))
      }
      labelledBy={MANUAL_HEADING_ID}
      multiselectable
      className="select-none"
      onKeyDown={screen.gridKey}
      onPointerUp={screen.pointerUp}
      // A macOS Ctrl-click toggles a cell; it never also opens the context menu.
      onContextMenu={(event) => {
        if (event.ctrlKey) event.preventDefault();
      }}
    />
  );
}
