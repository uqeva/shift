---
title: 'Story 21.3: the calendar scrolls with the page (Kalendar bez unutarnjeg scrolla)'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '0c119338f43c509736b10acda0dc039c00a5f5db'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
---

Status: done. Merged as #364, squash `9ea215f` (2026-11-25), after `CI passed` went green on `033de0c` (run 45630509774: every job SUCCESS, the four E2E shards and Test (Vitest, local Supabase) included). Rewritten by story 21.4, which set the sprint status `done`.

Baseline: `origin/main` at `0c11933` (#362). Touches the hot file `apps/web/src/index.css`; no other 21.x story in flight touches it (21.1 is `packages/domain` only).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** *Sve smjene*'s grid scrolls inside its own box, bounded to 70 svh (smaller on a phone), so the month has a second vertical scroll inside the page. The founder wants one scroll: the page's.

**Approach:** The grid has no vertical scroll container. The page scrolls; the team header row is a separate sticky strip under the shell's chrome (top of the viewport from 640 px, under the phone's sticky month head below it), kept in step with the grid's horizontal scroll, and the date column stays sticky on the horizontal axis. Below 640 px *Sve smjene* draws the month as a day list (each date with every shown team's shift), so a phone never scrolls sideways.

## Boundaries & Constraints

**Always:**
- One native `<table role="grid">` stays the grid: its `thead` columnheaders, `tbody` rowheaders and gridcells, one tab stop and the arrow keys (UX-DR33) are unchanged. The sticky strip is a visual copy, `aria-hidden` and `inert`, with no ids and no focusable element.
- The strip's column widths equal the grid's by construction (the same content laid out in a table of the same width), never by measuring and copying widths.
- Horizontal overflow only, in a scroller with `overflow-y: hidden` and no height bound; the page never scrolls sideways.
- Print (16.1) prints the one table whole with its header row repeated; the strip is not printed. Forced colours keep the header's edge.
- The phone's day list is the grid's form: the same cells, marks and full labels (each a button opening that team's day, `aria-haspopup="dialog"`), named by the month heading, wrapping with no horizontal overflow; `usePhone()` puts exactly one form in the DOM.
- DESIGN.md and EXPERIENCE.md lines this changes are updated in the same change; e2e specs asserting the inner scroller or the phone's compressed grid are updated in the same change (CI runs them).

**Ask First:** changing *Moj raspored*, the person view, *Danas*'s week grid or the rotation preview (out of scope).

**Never:** a `max-height` or vertical overflow on the grid; JS-driven vertical positioning of the header; a second scroll container around the grid; touching `packages/domain` or `components/ui/*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop, month fits | 1280 px, few teams | page scrolls; strip sticks at the viewport's top; no horizontal scrollbar | N/A |
| Desktop, wide month | 800 px, 13+ teams | only the grid scrolls sideways; the strip follows its `scrollLeft`; the date column and the strip's corner stay left | N/A |
| Keyboard | focus moved by arrows/Tab/close | the cell is revealed clear of the strip (scroll-margin-top = header height), the date column and, on a phone, the bottom bar | N/A |
| Phone | < 640 px, *Sve smjene*, any team count | day list of every shown team per date, no horizontal overflow; one team filter narrows it; a person keeps the person view | N/A |
| Print | *Ispiši* | the one table, header repeated per page, no strip | N/A |

## Epic AC Deviations

- "the phone uses the day list with no horizontal overflow" (given a month wider than the viewport): the phone uses the day list for every month in *Sve smjene*, not only a wide one. Why: whether a month fits at 320–639 px depends on the team count (at 390 px only four compressed columns fit), and a form that flips with it is unpredictable for users and for tests; the proposal's line is "phone day list". *Danas*'s week keeps its own letter grid.
- "the day header row sticks under the shell's chrome (UX-DR71)" at phone widths: below 640 px there is no grid and so no header row; each team's name is drawn in its button, and the month toolbar stays the phone's sticky head. UX-DR71 itself gives the phone the day list. The strip sticks from 640 px.
- "keyboard navigation (UX-DR33) still holds": holds from 640 px (one tab stop, arrows, Home/End, unchanged). On a phone the day list is a plain list of buttons, as *Moj raspored* and the person view already are (UX-DR33: "The day list stays a plain list"), so each team-day is a tab stop.
- "print (16.1) still holds": from 640 px the one table prints whole, header repeated. Printed from a viewport under 640 px, the month prints as the day list it shows (its `print:` classes keep it compact), not as the table.
- "the glass budget (NFR-22, `pnpm test:perf`)": not run here (on demand against a deployed build, never in CI). The perf spec measures the phone's day list and, at 800×600, the grid with its strip; the run is the operator's (deferred-work entry).

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/components/calendar-grid.tsx` -- the grid; today `Table` primitive (its wrapper is the overflow-auto scroller) inside `data-grid-bound` with `[&>div]:max-h-[70svh]`; header cells `sticky top-0`. Rebuild here.
- `apps/web/src/features/calendar/components/calendar-day-list.tsx` -- day lists (`renderDay`, `CalendarDays`, `CalendarPerson`); add the all-teams phone list here, reusing `CalendarCellBox` and `DAY_DETAIL_POPUP`.
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts:389,485` -- `labels` (`gridCellLabelsOf`) and `reveal` (`scrollIntoView(GRID_REVEAL)`): reused unchanged.
- `apps/web/src/hooks/viewport.ts` -- `usePhone()`.
- `apps/web/src/index.css:~987-1004` -- `[data-grid-bound] > div` phone bound (E816): removed. `html` scroll-padding (phone `--sticky-head`) stays and clears the strip's top.
- `apps/web/src/components/sticky-head.tsx`, `apps/web/src/pages/kalendar.tsx` -- doc comments name the grid's scroller bound; update the words only.
- `apps/web/src/features/calendar/calendar-layout.test.ts` -- source pins of the bound; rewrite to pin the new layout.
- `e2e/tests/calendar/layout.spec.ts`, `e2e/tests/calendar/calendar.spec.ts` (phone letters test, 320 px test), `e2e/pages/calendar.page.ts`, `perf/glass-scroll.spec.ts` (`openGrid` on a phone) -- e2e/perf that assume the inner scroller or the phone grid.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md:297-298`, `EXPERIENCE.md` calendar lines -- the layout rule.
- `_bmad-output/implementation-artifacts/deferred-work.md:825` -- E816 "revisit if the inner scroll is cramped": resolved.

## Tasks & Acceptance

**Execution:**
- [x] `calendar-grid.tsx` -- frame (`isolate`) holding: the sticky strip (`aria-hidden`, `inert`, `overflow-hidden`, `h-11`, `top-0 max-sm:top-[var(--sticky-head,0px)]`, `print:hidden`) with a copy table (header row + body rows, no roles or handlers); the scroller (`overflow-x-auto overflow-y-hidden`, `onScroll` → strip `scrollLeft`) holding the real grid table pulled up `-mt-11` under the strip (`print:mt-0`). On a phone render the team day list instead -- one page scroll, header always in view.
- [x] `calendar-day-list.tsx` -- `CalendarTeamDays`: per date an `li` (today `aria-current`), each shown team a button with the team's name over `CalendarCellBox`, `aria-label` from `screen.labels`, wrapping -- the phone's form.
- [x] `index.css` -- drop the E816 grid bound; adjust comments.
- [x] `calendar-layout.test.ts` -- pin: no `max-h`/vertical overflow in the grid, scroller `overflow-x-auto overflow-y-hidden`, strip sticky under `--sticky-head` on a phone, `aria-hidden` + `inert` + `print:hidden`, the pull-up equals the header height and is lifted in print, the scroll margins equal the sticky sizes, the phone form is chosen by `usePhone()`.
- [x] e2e and perf files above -- rewrite the layout assertions for page scroll (strip at the viewport top / under the head after scrolling, no vertical scroller, horizontal-only scroll with synced strip at a desktop width, focused-cell clearance); phone tests use the team day list.
- [x] DESIGN.md, EXPERIENCE.md, `kalendar.tsx`/`sticky-head.tsx` comments, deferred-work E816 entry -- record the rule.

**Acceptance Criteria:**
- Given *Kalendar* in either mode at any width, when the month is taller than the viewport, then only the page scrolls vertically and the team header stays in view under the chrome.
- Given the wide grid from 640 px, when it is scrolled sideways, then the strip's columns stay aligned with the grid's and the date column stays at the left.
- Given UX-DR33, print and forced colours, when this ships, then the keyboard, the printed month and the header edge behave as before.

## Spec Change Log

- Review loop 1 (2026-11-25), Epic AC Auditor and Blind Hunter: the phone's consequences of the listed day-list deviation (no sticky header row, the list's own tab order, phone-width print) were not listed, and the Deviations section sat outside the frozen block contrary to `bmad-build.toml`. Amended: the section moved to the end of the frozen block with those three items and the perf line updated (made unattended; the founder reviews them in the PR). No code re-derived. KEEP: the strip-plus-copy layout, `usePhone()` choosing one form, horizontal-only scroller.

## Design Notes

The strip is `aria-hidden` and not `inert`; the copy inside it is `inert`. An inert box takes no pointer events, so a press on an inert strip fell through to the cell scrolled under it and opened that day; the non-inert strip takes the press and does nothing, and nothing in it is focusable.


Why a strip: any `overflow-x: auto` ancestor becomes the sticky header's scroll container on both axes, so a header inside the horizontal scroller can never stick to the page. The strip sits outside the scroller; its copy table holds the same rows, so auto table layout gives the same column widths without measuring. The real `thead` stays in the grid for assistive technology and print, pulled up behind the strip (the scroller clips it); in its natural position it coincides with the strip.

Epic AC "the e2e month snapshots are unchanged apart from layout": there are no screenshot snapshots; the e2e assertions on content are kept and only layout ones change.

## Verification

**Commands:**
- `pnpm --filter @shift/web test` -- expected: all pass.
- `pnpm typecheck` and `pnpm lint` -- expected: clean.
- `pnpm build` then `pnpm exec vitest run test/theme-tokens.test.ts test/theme-contrast.test.ts test/theme-fidelity.test.ts test/theme-applied.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: pass.
- e2e (`layout.spec.ts`, `calendar.spec.ts`) and perf: CI / operator only.

**Results (2026-11-25, after review loop 1):** `pnpm typecheck` exit 0 (apps, e2e, smoke, perf); `pnpm lint` exit 0; `pnpm --filter @shift/web test` 6925 passed; `pnpm build` exit 0; the four theme root files with `resource-hygiene` and `supabase-scaffold` 3562 passed (`index.css` changed, so the theme files ran). The real `CalendarGrid` and `CalendarTeamDays` were rendered to static HTML with the built CSS in headless Chromium: at 1280 px (3 teams) and 800 px (14 teams) the strip's column widths equal the grid's and stay aligned after a sideways scroll, the strip sits at the viewport's top once the page scrolls, the grid has no vertical scroll room and the page none sideways; the phone list at 320 and 390 px does not overflow (at 320 px with a 32 px root font it does by 5 px, shared with *Moj raspored*: deferred-work). e2e and `pnpm test:perf` never ran locally: CI is their first run (layout.spec.ts and calendar.spec.ts rewritten), perf is the operator's (deferred-work).

**Residual risk (rewritten by story 21.4 from CI):** CI settled the e2e. Run 1 on PR #364 (45626785892) failed in `E2E (Playwright, shard 2/4)` on one step of `layout.spec.ts`'s wide-grid case ("the corner left the viewport's top": the probe scrolled less than the strip's own offset). The fix pushed only for CI was `033de0c` ("scroll past the strip's own offset before probing"). Run 2 (45630509774) was green: every E2E shard passed, the erasure specs that resize to 390 px with a day dialog open included. `pnpm test:perf` (NFR-22) is still unmeasured; it is the operator's (deferred-work), and CI does not settle it.

## Suggested Review Order

**The page scrolls, the header is a strip**

- Entry point: the frame, the sticky strip and the horizontal-only scroller.
  [`calendar-grid.tsx:206`](../../apps/web/src/features/calendar/components/calendar-grid.tsx#L206)

- The copy table that gives the strip the grid's column widths without measuring.
  [`calendar-grid.tsx:104`](../../apps/web/src/features/calendar/components/calendar-grid.tsx#L104)

- The real grid pulled up behind the strip, lifted in print.
  [`calendar-grid.tsx:223`](../../apps/web/src/features/calendar/components/calendar-grid.tsx#L223)

- Strip kept in step with `scrollLeft`, on scroll and after each render.
  [`calendar-grid.tsx:175`](../../apps/web/src/features/calendar/components/calendar-grid.tsx#L175)

**The phone's form**

- `usePhone()` swaps the grid for the team day list.
  [`calendar-grid.tsx:189`](../../apps/web/src/features/calendar/components/calendar-grid.tsx#L189)

- Every shown team per date, wrapping, named by the gridcell label.
  [`calendar-day-list.tsx:136`](../../apps/web/src/features/calendar/components/calendar-day-list.tsx#L136)

**Rules and docs**

- The E816 bound removed; scroll-padding comment.
  [`index.css:565`](../../apps/web/src/index.css#L565)

- The layout rule as designed.
  [`DESIGN.md:299`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L299)

**Tests**

- Source pins of the new layout.
  [`calendar-layout.test.ts:42`](../../apps/web/src/features/calendar/calendar-layout.test.ts#L42)

- e2e: page scroll, phone list, wide grid at 800 px, print.
  [`layout.spec.ts:136`](../../e2e/tests/calendar/layout.spec.ts#L136)

- Perf: the phone list and the grid at 800 px.
  [`glass-scroll.spec.ts:184`](../../perf/glass-scroll.spec.ts#L184)
