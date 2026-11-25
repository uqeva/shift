import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { CaretDown } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * THE COMPACT PAGE TOOLBAR (story 21.23, UX-DR82): one row holding the
 * page's `<h1>`, its `lead` (a search, or *Kalendar*'s month control), and
 * its `controls` at the right — `Filtri` with its count, `Prikaz ▾` where the
 * page has view options, `Izvoz ▾` where it exports, and the primary action
 * last. Under it, `below`: the one-line result count and the active chips.
 * The content starts right after; closed, the filters never take more than
 * the toolbar row and that line.
 *
 * BELOW 640 PX it wraps to two compact rows at most: the title with the
 * controls, drawn as 44 px icon buttons (their words visually hidden, so
 * every name stays the same at every width), and the `lead` on its own full
 * row under them. From 640 px the `lead` sits between the title and the
 * controls, the order it has in the DOM.
 *
 * LAYOUT ONLY: no copy and no state. The screen's filter bar draws it with
 * its own parts, or the screen draws it alone where nothing is filtered.
 */
export function PageToolbar({
  title,
  lead,
  controls,
  below,
  className,
}: {
  readonly title?: ReactNode;
  readonly lead?: ReactNode;
  readonly controls?: ReactNode;
  readonly below?: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <div className={cn('grid min-w-0 gap-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {title === undefined ? null : <div className="min-w-min flex-1 sm:flex-none">{title}</div>}
        {lead === undefined || lead === null ? null : (
          <div className="order-last min-w-0 basis-full sm:order-none sm:min-w-56 sm:max-w-sm sm:flex-1 sm:basis-auto">
            {lead}
          </div>
        )}
        {controls === undefined || controls === null ? null : (
          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">{controls}</div>
        )}
      </div>
      {below}
    </div>
  );
}

/**
 * A toolbar button's words: visually hidden below 640 px, where the button
 * is its icon alone, and still its accessible name at every width.
 */
export function ToolbarLabel({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="sr-only sm:not-sr-only">{children}</span>;
}

/**
 * A TOOLBAR MENU (story 21.23): `Prikaz ▾` and `Izvoz ▾`. An outline 44 px
 * button with its icon, its words (hidden on a phone) and a caret, opening a
 * small `Popover` of the page's options under it, right-aligned. Opening
 * focuses the menu's first enabled control — its pressed one where it has
 * one; Escape, a press outside and every pick close it and put focus back on
 * the button; tabbing out closes it where focus went. `menu(done)` is the
 * content; `done` closes it.
 */
export function ToolbarMenu({
  label,
  icon,
  menuLabel,
  busy = false,
  menu,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  /** The popover's name, e.g. `Prikaz kalendara`. */
  readonly menuLabel: string;
  /** Something the menu started is still in flight (`aria-busy` on the button). */
  readonly busy?: boolean;
  readonly menu: (done: () => void) => ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const done = useCallback(() => {
    setOpen(false);
    // No scroll: a press outside, far down the page, closes it too.
    trigger.current?.focus({ preventScroll: true });
  }, []);

  // Opening focuses the pressed option, else the first enabled control.
  useEffect(() => {
    if (!open) return;

    const controls = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
    const pressed = panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]:not([disabled])');

    (pressed ?? controls?.[0])?.focus();
  }, [open]);

  /** Focus leaving the button and its menu closes the menu where focus went. */
  function closeOnLeave(event: FocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget;

    if (open && to !== null && !event.currentTarget.contains(to)) setOpen(false);
  }

  return (
    <div ref={region} className="relative shrink-0" onBlur={closeOnLeave}>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="h-11 min-w-11 shrink-0 gap-2 px-3"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy}
        onClick={() => {
          if (open) done();
          else setOpen(true);
        }}
      >
        {icon}
        <ToolbarLabel>{label}</ToolbarLabel>
        <CaretDown aria-hidden className="hidden sm:block" />
      </Button>
      <Popover id={menuId} open={open} onClose={done} region={region} aria-label={menuLabel} className="left-auto right-0 w-60">
        <div ref={panel} className="grid min-w-0 gap-1">
          {menu(done)}
        </div>
      </Popover>
    </div>
  );
}
