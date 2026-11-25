import type { ReactNode } from 'react';

import { PencilSimple } from '@/components/ui/icon';
import { ModifierGlyphs } from '@/features/calendar/components/modifier-glyphs';
import { modifierNamesTextOf, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import {
  COMPRESSED_CELL_CLASS,
  DAY_CELL_CLASS,
  DAY_RANGE_CLASS,
  GRID_RANGE_CLASS,
  NO_ROTATION_SHOWN,
  type CalendarCell,
  type CalendarCellGroup,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { t } from '@/lib/i18n';

/** A cell's name or letter; in the grid, every part `aria-hidden` and the letter first. */
function renderCellName(cell: CalendarCell, inGrid: boolean): ReactNode {
  if (cell.name === null) {
    // STORY 21.6: a team with no rotation but a staffing group shows the group alone.
    if (cell.groups !== undefined) return null;

    return (
      <>
        <span aria-hidden>{NO_ROTATION_SHOWN}</span>
        {inGrid ? null : <span className="sr-only">{t('kalendar.noRotation')}</span>}
      </>
    );
  }

  if (!inGrid) {
    return <span>{cell.name}</span>;
  }

  return (
    <>
      <span aria-hidden className="sm:hidden">
        {cell.letter}
      </span>
      <span aria-hidden className="hidden sm:inline">
        {cell.name}
      </span>
    </>
  );
}

/** STORY 21.6 (UX-DR73): the assigned pencil, as *Ručni raspored* draws it; always `aria-hidden`. */
function renderPencil(): ReactNode {
  return <PencilSimple aria-hidden className="size-3 shrink-0" />;
}

/**
 * STORY 21.6: a day list's Personal Shift — the pencil and `ručno`, then
 * `bez tima` when it counts with no team. The day list's words, never the grid's.
 */
function renderAssigned(cell: CalendarCell, noTeam: boolean, labelled: boolean): ReactNode {
  if (cell.assigned !== true && !noTeam) return null;

  return (
    <span className="flex items-center gap-1 font-normal">
      {cell.assigned === true ? (
        <>
          {renderPencil()}
          {/* UX-DR73: `dodijeljeno ručno` in the accessible name. A label
              around the cell (the day list's button) already names it, so
              the words are added only where nothing labels the cell. */}
          <span aria-hidden={labelled ? undefined : true}>{t('kalendar.cell.assignedShort')}</span>
          {labelled ? null : <span className="sr-only">{t('kalendar.cell.assigned')}</span>}
        </>
      ) : null}
      {noTeam ? <span>{t('kalendar.cell.noTeamShown')}</span> : null}
    </span>
  );
}

/**
 * STORY 21.6 (R14.6): one staffing group of a grid cell — its letter (or
 * its name from 640 px up), the pencil, and its range where the cell shows
 * one. In the grid every part is `aria-hidden`, the gridcell's label naming it.
 * Outside the grid it is drawn by the phone's team list (`CalendarTeamDays`),
 * whose button's label names it; unlabelled, it says `dodijeljeno ručno`.
 */
function renderGroup(group: CalendarCellGroup, inGrid: boolean, labelled: boolean): ReactNode {
  return (
    <span key={group.shiftTypeId} aria-hidden={inGrid ? true : undefined} className="flex items-center gap-1 font-normal">
      {inGrid ? (
        <>
          <span className="sm:hidden">{group.letter}</span>
          <span className="hidden sm:inline">{group.name}</span>
        </>
      ) : (
        <span>{group.name}</span>
      )}
      {renderPencil()}
      {inGrid || labelled ? null : <span className="sr-only">{t('kalendar.cell.assigned')}</span>}
      {group.range === null ? null : <span className={inGrid ? GRID_RANGE_CLASS : DAY_RANGE_CLASS}>{group.range}</span>}
    </span>
  );
}

/**
 * THE ONE CELL RENDERER, for the grid (full and compressed) and the day
 * list: the type's fill, any modifier's ring or hatch over it, and the
 * glyphs beside the name or letter. In the grid every part is `aria-hidden`,
 * because the `gridcell`'s label names it in full; in the day list the
 * marks' names are there for a screen reader.
 *
 * STORY 21.6: a Personal Shift adds the pencil and `ručno` (and `bez tima`
 * with `noTeam`), and a grid cell's staffing groups each add a line.
 */
export function CalendarCellBox({
  cell,
  inGrid,
  noTeam = false,
  labelled = false,
}: {
  readonly cell: CalendarCell;
  readonly inGrid: boolean;
  /** STORY 21.6: a day list's Personal Shift counted with no team. */
  readonly noTeam?: boolean;
  /** STORY 21.6: an element around the cell names it in full (`aria-label`), so the cell adds no words for a screen reader. */
  readonly labelled?: boolean;
}): ReactNode {
  const treatment = modifierTreatmentOf(cell.modifiers);

  return (
    <div className={`${cell.className} ${inGrid ? COMPRESSED_CELL_CLASS : DAY_CELL_CLASS} ${treatment.className}`}>
      {treatment.glyphs.length === 0 ? (
        renderCellName(cell, inGrid)
      ) : (
        <span className="flex items-center gap-1">
          {renderCellName(cell, inGrid)}
          <ModifierGlyphs glyphs={treatment.glyphs} />
        </span>
      )}
      {cell.range === null ? null : (
        <span
          aria-hidden={inGrid ? true : undefined}
          className={inGrid ? GRID_RANGE_CLASS : DAY_RANGE_CLASS}
        >
          {cell.range}
        </span>
      )}
      {inGrid ? null : renderAssigned(cell, noTeam, labelled)}
      {(cell.groups ?? []).map((group) => renderGroup(group, inGrid, labelled))}
      {inGrid || treatment.modifiers.length === 0 ? null : (
        <span className="sr-only">{modifierNamesTextOf(treatment.modifiers, translateCellLabel)}</span>
      )}
    </div>
  );
}
