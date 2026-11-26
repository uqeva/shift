import {
  useLayoutEffect,
  useRef,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
} from 'react';

import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { GridDate } from '@/utils/grid-dates';

/**
 * THE PAPER GRID'S FRAME (stories 21.3, 21.4, 21.25): rows of people or
 * teams, a column per date, as the paper roster reads. *Ručni raspored* and
 * *Kalendar*'s *Sve smjene* draw their month through these pieces, so the
 * two grids scroll, stick and look the same.
 *
 * THE PAGE SCROLLS, NEVER THE GRID (UX-DR71). No height bound and no vertical
 * scroller: a month is as tall as its rows, and the page scrolls it. The one
 * scroller is HORIZONTAL (`overflow-x-auto overflow-y-hidden`), so a month
 * wider than the window scrolls sideways inside it and the page never does;
 * the first column is sticky on that axis.
 *
 * THE DATE HEADER IS A SEPARATE STRIP. An `overflow-x: auto` box is a sticky
 * element's scroll container on BOTH axes, so a header inside the scroller
 * could never stick to the page. The strip sits outside it in the same
 * ISOLATED frame: sticky at the viewport's top, `h-11`, clipping a VISUAL
 * COPY of the table — its header row and its body, drawn by the same
 * renderers with `copy` set, so auto table layout gives it the grid's column
 * widths by construction — to the header row, kept in step with the
 * scroller's `scrollLeft`. The copy has no roles, ids, handlers or
 * `aria-current` (each renderer leaves them out under `copy`), is `inert`,
 * and the strip is `aria-hidden`: the grid's own `thead`, pulled up `-mt-11`
 * behind the strip, is what assistive technology and print read. A press on
 * the strip lands on the strip itself (an inert box is no pointer target),
 * never on a cell scrolled under it. In print the strip is not drawn and the
 * pull-up is lifted: the one table prints whole.
 *
 * Below 640 px the screens draw a list instead; the strip's
 * `max-sm:top-[var(--sticky-head,0px)]` is a guard for the fractional gap
 * between `usePhone()`'s `(max-width: 639px)` and `max-sm`.
 *
 * THE MARGINS ARE THE SIZES: the first column is `w-40` and each cell's
 * `scroll-margin-left` is `40` (`DATE_CELL_SCROLL_CLASS`, `@/utils/grid-dates`); the strip is
 * `h-11` and each cell's `scroll-margin-top` is `11`, so a cell revealed by
 * the keys lands clear of both.
 */
export function DateGridFrame({
  header,
  body,
  labelledBy,
  multiselectable = false,
  className,
  tableRef,
  onKeyDown,
  onKeyUp,
  onPointerUp,
  onContextMenu,
}: {
  /** The header row, drawn twice: in the grid (`copy: false`) and in the strip's copy (`copy: true`). */
  readonly header: (copy: boolean) => ReactNode;
  /** The `tbody` sections, drawn twice as {@link header} is. */
  readonly body: (copy: boolean) => ReactNode;
  /** The id of the heading that names the grid: the month's. */
  readonly labelledBy: string;
  /** *Ručni raspored*'s grid selects cells; *Kalendar*'s reads (`aria-readonly`). */
  readonly multiselectable?: boolean;
  readonly className?: string;
  readonly tableRef?: Ref<HTMLTableElement>;
  readonly onKeyDown?: KeyboardEventHandler<HTMLTableElement>;
  readonly onKeyUp?: KeyboardEventHandler<HTMLTableElement>;
  readonly onPointerUp?: PointerEventHandler<HTMLTableElement>;
  readonly onContextMenu?: MouseEventHandler<HTMLTableElement>;
}): ReactNode {
  const strip = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The strip follows the scroller after every render too: a month or a
  // filter that changes the width can move `scrollLeft` with no scroll event.
  useLayoutEffect(() => {
    if (strip.current !== null && scroller.current !== null) strip.current.scrollLeft = scroller.current.scrollLeft;
  });

  return (
    // The frame ISOLATES the sticky layers' stacking from the page's.
    <div data-grid-frame className="isolate">
      <div
        aria-hidden
        data-grid-strip
        className="sticky top-0 z-20 h-11 bg-muted forced-colors:border-b forced-colors:border-[CanvasText] max-sm:top-[var(--sticky-head,0px)] print:hidden"
      >
        <div ref={strip} inert data-grid-strip-copy className="h-full overflow-hidden">
          <table className="w-full caption-bottom text-sm">
            <TableHeader>{header(true)}</TableHeader>
            {body(true)}
          </table>
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
          ref={tableRef}
          role="grid"
          aria-multiselectable={multiselectable ? true : undefined}
          aria-readonly={multiselectable ? undefined : true}
          aria-labelledby={labelledBy}
          className={cn('-mt-11 w-full caption-bottom text-sm print:mt-0', className)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
        >
          <TableHeader>{header(false)}</TableHeader>
          {body(false)}
        </table>
      </div>
    </div>
  );
}

/** The corner over the first column: sticky on the left, `w-40`, the strip's height. */
export function DateGridCorner({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <TableHead
      scope="col"
      className="sticky left-0 z-30 h-11 w-40 min-w-40 bg-muted shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText] print:h-auto print:w-28 print:min-w-0 print:border-b"
    >
      {children}
    </TableHead>
  );
}

/**
 * A date's column head: the day over its short weekday, a weekend tinted and
 * today edged — and, in the grid, not its copy, today's named
 * `aria-current="date"`.
 */
export function DateHead({ date, copy }: { readonly date: GridDate; readonly copy: boolean }): ReactNode {
  return (
    <TableHead
      scope="col"
      aria-current={!copy && date.today ? 'date' : undefined}
      className={cn(
        'h-11 min-w-11 bg-muted px-0.5 text-center normal-case tracking-normal shadow-[inset_0_-1px_0_var(--border)] forced-colors:border-b forced-colors:border-[CanvasText] print:h-auto print:min-w-0 print:border-b print:px-0',
        date.weekend && 'bg-secondary',
        date.today && 'border-x-2 border-foreground text-foreground',
      )}
    >
      <span className="block text-xs font-semibold tabular-nums text-foreground">{date.day}</span>
      <span className="block text-[0.6875rem] font-normal">{date.weekday}</span>
    </TableHead>
  );
}

/** A row's head in the first column: its name, and a muted line under it when there is one. */
export function DateGridRowHead({ name, line }: { readonly name: string; readonly line: string | null }): ReactNode {
  return (
    <TableHead scope="row" className="sticky left-0 z-10 h-auto w-40 min-w-40 bg-card py-1 normal-case tracking-normal">
      <span className="block truncate text-sm font-medium text-foreground">{name}</span>
      {line === null ? null : <span className="block truncate text-xs font-normal text-muted-foreground">{line}</span>}
    </TableHead>
  );
}

/** A group's heading row across the grid: its words stay on screen as the grid scrolls sideways. */
export function DateGridGroupHead({ name, columns }: { readonly name: string; readonly columns: number }): ReactNode {
  return (
    <TableRow className="hover:bg-transparent">
      <TableHead scope="colgroup" colSpan={columns + 1} className="h-9 bg-card px-0 normal-case tracking-normal">
        <span className="sticky left-0 inline-block px-3 text-sm font-semibold text-foreground">{name}</span>
      </TableHead>
    </TableRow>
  );
}
