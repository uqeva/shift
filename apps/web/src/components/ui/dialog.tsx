import * as React from "react"

import { Button } from "@/components/ui/button"
import { X } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

// The one modal (design refresh C), on the NATIVE `<dialog>` and its
// `showModal()`: the browser supplies the focus trap, the inert page behind
// it, Escape to close, the top layer and the return of focus to whatever
// opened it — four behaviours a hand-rolled overlay gets subtly wrong and no
// dependency is needed for. `open` is the screen's state; the element follows
// it, and every way the browser closes it (Escape, `close()`) reports back
// through `onOpenChange(false)`.
//
// A click on the BACKDROP closes it too: the backdrop is the dialog element
// itself outside its content box, so only a click whose target is the element
// counts. The content fills the element, so a click inside never is.
//
// CLOSED MEANS HIDDEN, NOT UNMOUNTED. A closed `<dialog>` is `display: none`
// and its children stay mounted, so an uncontrolled form inside keeps its
// refs and, after a refusal, its values (UX-DR34).
//
// GLASS SINCE STORY 15.2: the panel is `glass-panel` (the reading alpha, ≥ .85,
// blurred, with the opaque and forced-colours fallbacks in `index.css`) over a
// `glass-scrim` backdrop, tinted and never blurred. `docked` is the phone's
// bottom sheet (*Više*, the filter sheet): full width at the bottom edge,
// rounded on top, padded clear of the safe area. Screens pass `docked` and
// never restyle the panel.
//
// `docked anchor` IS THE FILTER PANEL (story 21.23, replacing 15.7's side
// sheet): the same bottom sheet below 1024 px, and from `lg:` a dropdown
// panel under its trigger, right-aligned to it, over a clear backdrop. Still
// the native modal: the focus trap, Escape and the return of focus are the
// browser's at every width. The trigger's place is read as the panel opens
// and on every resize while it is open, into two custom properties the
// classes below read — classes only, so the one sheet primitive is still
// restyled once, here.
//
// ONE BLURRED PANEL AT A TIME. A dialog opened over another (a change from the
// day detail) marks every open panel beneath it `data-covered`, and
// `glass-panel` draws a covered panel opaque and unblurred: a phone shows the
// tab bar, the sticky head and one panel blurred, never more.
//
// No copy and no `t()`: the close button's name is the screen's `closeLabel`.

/** Every open Dialog, bottom to top: the order `showModal()` stacks them in. */
const openPanels: HTMLDialogElement[] = []

function restack(): void {
  openPanels.forEach((panel, index) => {
    panel.toggleAttribute("data-covered", index < openPanels.length - 1)
  })
}

/**
 * On top: a `showModal()` puts the dialog above every other open one.
 * IDEMPOTENT: a dialog already in the stack keeps its place, so an effect that
 * runs again (StrictMode, Fast Refresh) never reorders it. A dialog that
 * really re-opens was released by its `close` first, so it lands on top.
 */
function raise(panel: HTMLDialogElement): void {
  if (!openPanels.includes(panel)) openPanels.push(panel)
  restack()
}

function release(panel: HTMLDialogElement): void {
  const at = openPanels.indexOf(panel)

  if (at === -1) return
  openPanels.splice(at, 1)
  panel.removeAttribute("data-covered")
  restack()
}

export interface DialogProps
  extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, "open"> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * `false` while something is in flight: Escape (however often it is
   * pressed) and the backdrop then do nothing, and a native close that gets
   * through anyway is undone, so a request cannot lose the dialog that
   * reports its outcome.
   */
  dismissible?: boolean
  /** The phone's bottom sheet: docked to the bottom edge, full width. */
  docked?: boolean
  /**
   * With `docked`: that bottom sheet below 1024 px, and from it a dropdown
   * panel under this element, right-aligned to it (the filter panel, story
   * 21.23).
   */
  anchor?: React.RefObject<HTMLElement | null> | undefined
}

/** The bottom sheet's geometry. */
const DOCKED_BOTTOM =
  "mb-0 mt-auto w-full max-w-none rounded-b-none rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)]"

/**
 * From 1024 px, the anchored panel's geometry, over the bottom one: under the
 * trigger (`--anchor-top`), its right edge on the trigger's
 * (`--anchor-right`), never taller than the room below it, over a clear
 * backdrop — a dropdown, not a sheet.
 */
const DOCKED_ANCHORED =
  "lg:mb-auto lg:ml-auto lg:mr-[var(--anchor-right)] lg:mt-[var(--anchor-top)] lg:max-h-[calc(100dvh-var(--anchor-top)-1rem)] lg:w-[24rem] lg:max-w-[calc(100vw-2rem)] lg:rounded-lg lg:pb-0 lg:backdrop:bg-transparent"

/** The gutter the anchored panel keeps from the viewport's edges, in px. */
const ANCHOR_GUTTER = 16

/** The gap between the trigger and the anchored panel, in px. */
const ANCHOR_GAP = 8

/** Where the anchored panel goes for a trigger at `rect` in a viewport `width` wide. */
function anchorPlaceOf(rect: DOMRect, width: number): React.CSSProperties {
  return {
    "--anchor-top": `${String(Math.max(Math.round(rect.bottom + ANCHOR_GAP), ANCHOR_GUTTER))}px`,
    "--anchor-right": `${String(Math.max(Math.round(width - rect.right), ANCHOR_GUTTER))}px`,
  } as React.CSSProperties
}

function Dialog({
  open,
  onOpenChange,
  dismissible = true,
  docked = false,
  anchor,
  className,
  style,
  children,
  ...props
}: DialogProps) {
  const element = React.useRef<HTMLDialogElement>(null)
  const [place, setPlace] = React.useState<React.CSSProperties | null>(null)

  // THE TRIGGER'S PLACE, read before the panel shows and on every resize while
  // it is open, and on every scroll: a native modal does not lock the page's
  // scroll, and a scrolled trigger would leave the panel behind.
  React.useLayoutEffect(() => {
    if (!open || anchor === undefined) return

    const measure = (): void => {
      const trigger = anchor.current

      // The top layer's box excludes a classic scrollbar; `innerWidth` does not.
      if (trigger !== null) setPlace(anchorPlaceOf(trigger.getBoundingClientRect(), document.documentElement.clientWidth))
    }

    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, { passive: true, capture: true })
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, { capture: true })
    }
  }, [open, anchor])

  React.useEffect(() => {
    const dialog = element.current

    if (dialog === null) return

    // `raise` whenever open, not only on the `showModal()`: a dialog that
    // mounts open and whose effects re-run (StrictMode, Fast Refresh) is
    // released by the cleanup below while still open, and must rejoin.
    if (open) {
      if (!dialog.open) dialog.showModal()
      raise(dialog)
    } else {
      if (dialog.open) dialog.close()
      release(dialog)
    }
  }, [open])

  // Unmounted while open (a ConfirmDialog is open for as long as it renders):
  // the element leaves the top layer, so it leaves the stack too.
  React.useEffect(() => {
    const dialog = element.current

    return () => {
      if (dialog !== null) release(dialog)
    }
  }, [])

  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- a native modal <dialog>; the keydown only cancels Escape (below).
    <dialog
      ref={element}
      // NOT DISMISSIBLE MEANS NO CLOSE REQUEST AT ALL. Chrome's CloseWatcher
      // lets a first Escape be cancelled, but a second one without user
      // activation between is not cancelable, so `onCancel` alone lets a
      // double Escape close the dialog mid-request. Cancelling the KEYDOWN
      // stops the browser from making the close request in the first place.
      onKeyDown={(event) => {
        if (!dismissible && event.key === "Escape") event.preventDefault()
      }}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault()
      }}
      onClose={() => {
        const dialog = element.current

        // A close event queued before the dialog was opened again must not
        // release a dialog that is open now.
        if (dialog !== null && !dialog.open) release(dialog)
        if (!open) return
        // A native close that still got through while not dismissible is
        // undone: the dialog reopens and the screen's state is never told.
        if (!dismissible) {
          dialog?.showModal()
          if (dialog !== null) raise(dialog)

          return
        }
        onOpenChange(false)
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange(false)
      }}
      className={cn(
        "glass-panel p-0 text-foreground backdrop:bg-glass-scrim",
        docked ? DOCKED_BOTTOM : "m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg",
        docked && anchor !== undefined && DOCKED_ANCHORED,
        className
      )}
      style={anchor === undefined || place === null ? style : { ...place, ...style }}
      {...props}
    >
      {/* ONE SHRINKABLE COLUMN: without it the grid grows to its widest
          child — a long, unwrapped button label — and the prompt overflows. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-6">{children}</div>
    </dialog>
  )
}

function DialogHeader({
  className,
  closeLabel,
  closeRef,
  onClose,
  children,
}: {
  className?: string
  /** The close button's accessible name, from the screen's `t()`. */
  closeLabel: string
  /** For a screen that must move focus to the close button, e.g. after a removal. */
  closeRef?: React.Ref<HTMLButtonElement>
  onClose: () => void
  children?: React.ReactNode
}) {
  return (
    <div className={cn("-mr-3 -mt-3 flex items-start justify-between gap-4", className)}>
      <div className="grid min-w-0 gap-1.5 pt-3">{children}</div>
      <Button
        ref={closeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("font-heading text-lg font-bold leading-tight tracking-tight", className)}
    {...props}
  >
    {children}
  </h2>
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = "DialogDescription"

const DialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full",
      className
    )}
    {...props}
  />
))
DialogFooter.displayName = "DialogFooter"

/**
 * A confirmation as its own small modal: open for as long as the screen
 * renders it, so a screen keeps its "armed" state exactly as it had it and
 * renders this where the inline confirmation used to be. The children are the
 * prompt (the element `aria-labelledby` names) and a `DialogFooter` with the
 * cancel and the confirm. Escape and the backdrop cancel — except while
 * `busy`, when nothing but the request's end closes it.
 */
function ConfirmDialog({
  busy,
  onCancel,
  children,
  ...props
}: Omit<DialogProps, "open" | "onOpenChange" | "dismissible" | "docked" | "anchor"> & {
  busy: boolean
  onCancel: () => void
}) {
  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
      dismissible={!busy}
      {...props}
    >
      {children}
    </Dialog>
  )
}

export { Dialog, ConfirmDialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
