---
title: 'Story 21.23: compact toolbar and filters'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '9ea215f'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
---

Status: done. PR #367, squash `dc02fff`, merged 2026-11-25 with `CI passed` green on the PR's only run (45646006380 at `d176dee`). The e2e and perf files this spec lists as unrun: the e2e ran green there; `perf/glass-scroll.spec.ts` runs in no CI job and stays the operator's. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** on a phone the filters "take over" the screen: a page header with a lede, then a summary card with `Filtri`, a chip row, and only then the list. The founder (2026-11-25) wants a CRM contacts page's pattern: one compact toolbar row, the result count and the chips under it, and the content right after.

**Approach:** one layout component, `PageToolbar` (`components/page-toolbar.tsx`), drawn by the shared filter bars with their own parts: the `<h1>`, a `lead` (the search, or *Kalendar*'s month control from 640 px), then `Filtri` (`FilterTrigger`), `Prikaz ▾` and `Izvoz ▾` (`ToolbarMenu`, a small Popover) and the primary action; under it one line of the result count (the existing summary) and the chips. The *Filtri* panel stays the native modal Dialog: a bottom sheet below 1024 px, and from it a dropdown anchored under `Filtri` (`Dialog anchor`, replacing 15.7's side sheet). Its foot: the live result count, `Očisti`, `Primijeni`. Every filter, chip, default, URL key and focus rule is untouched.

## Boundaries & Constraints

**Always:** presentation only — the hooks, the services and the URL are untouched; every toolbar control is ≥ 44 px with the same accessible name at every width (words `sr-only` on a phone); the panel keeps the browser's focus trap, Escape and focus return, and `Filtri` says `aria-expanded`/`aria-controls`; glass only in the primitives (the panel is the Dialog's `glass-panel`; the menus are the Popover's); copy in `hr.json`; the toolbar is one element for each screen's life, so focus on it survives a change of mode or a refetch.

**Ask First:** changing *Sati*'s layout or *Ljudi*'s member directory; adding a search to a page that has none.

**Never:** buffering picks until `Primijeni` (a semantics change: today every pick writes the URL and Back steps through them); a new dependency; a hand-rolled modal.

## Epic AC Deviations

- "the search where the page searches today": *Kalendar* and *Povijest promjena* have no search (their person filter searches inside its picker), so their toolbar has none. Adding one would be a new filter; the AC is worded to match.
- "`Filtri` with the count of filters on" (founder: "Filteri (2)"): the established word `Filtri` stays (`hr.json`, UX-DR copy, e2e), and the count is 15.7's Badge beside it, the button named `Filtri, aktivno: 2`.
- "`Očisti` and `Primijeni`": `Primijeni` closes the panel; it does not apply anything, because every pick already wrote the URL (kept so Back and live results work — no semantics change). The 15.7 `Prikaži {n} osoba` count is the live result line above the buttons, the screen's own summary (on *Povijest promjena* it now counts changes, not people).
- "a dropdown/popover on desktop": the panel is the native modal `<dialog>` positioned under `Filtri` over a clear backdrop, not a non-modal popover, so the focus trap, Escape and focus return the request asks for are the browser's.
- "`Prikaz ▾` where a page has view options": only *Kalendar* (its two modes). *Ljudi*'s and *Godišnji*'s phone sort control stays in the list (a sort, not a view).
- "`Izvoz ▾` (Excel/PDF) where a page exports": *Kalendar*'s holds *Ispiši* (the browser's print, which saves a PDF; there is no Excel of the month), *Povijest promjena*'s *Izvezi u PDF*. Each menu has one item. The PDF menu stays open while its file is built so the button keeps its focus and pending label (14.3); its outcome lines are under the toolbar in the card.
- "the primary action at the right": *Ljudi* (*Dodaj osobu*, with the teams link before it). *Kalendar*, *Godišnji*'s overview and *Povijest promjena* have none today.
- "the content starts right after": the three ledes (*Ljudi*, *Godišnji*'s overview, *Povijest promjena*) are removed with their keys.
- Pages: *Sati* is not in the founder's list and keeps its summary card in its Card (it gets the shared anchored panel and its new foot); *Ljudi*'s member-role directory keeps its header. DEFERRED to the founder: `deferred-work.md`.
- "two compact rows at most" on a phone: *Kalendar*'s month control is not in the toolbar below 640 px; it stays the Card's sticky head (E816), so the month is in reach while it scrolls. The toolbar rows wrap rather than overflow: a title too long for its row with the buttons (*Povijest promjena* at 320 px, which has no search) puts the buttons on the second row; *Ljudi* and *Godišnji* (short titles, with a search) stay at two rows at 320 px. Nothing caps the rows for a longer future title.
- "forced colours and reduced motion hold": no new colour, token or motion. The panel and the menus are the Dialog's and the Popover's own primitives with their forced-colours (`Canvas`/`CanvasText`) and reduced-transparency fallbacks; the only new class on the backdrop is `bg-transparent` from 1024 px. Checked in code and by the theme root files, not in a forced-colours browser run (e2e's forced-colours specs are CI's).
- "the e2e specs are updated": updated by reading the code; e2e runs in CI only.

</frozen-after-approval>

## Code Map

- `apps/web/src/components/page-toolbar.tsx` -- NEW: `PageToolbar`, `ToolbarLabel`, `ToolbarMenu`.
- `apps/web/src/components/filter-bar.tsx` -- `ToolbarSlots`, `FilterToolbar`, `FilterTrigger`; `FilterBar` takes `toolbar` and a `null` model; chips get the `Aktivni filtri` group; `SheetDialog anchor`; `SheetFooter` (count, `Očisti`, `Primijeni`). The summary card stays for *Sati*.
- `apps/web/src/components/option-filter-bar.tsx` -- always the toolbar form; `absent`; `shownCount` gone.
- `apps/web/src/components/ui/dialog.tsx` -- `anchor` replaces `side`: `DOCKED_ANCHORED`, measured on open and resize.
- `apps/web/src/components/sticky-head.tsx`, `utils/sticky-head.ts` -- `filtersAbove`, `filtersAboveCoveredBy`.
- *Kalendar*: `pages/kalendar.tsx`, `features/calendar/components/calendar-filters.tsx`, `calendar-mode-switch.tsx` (`CalendarModeSwitch` as `Prikaz ▾`, `CalendarExportMenu`).
- *Ljudi*: `pages/ljudi.tsx`, `features/members/components/member-filters.tsx`, `member-table.tsx`.
- *Godišnji*: `pages/godisnji.tsx`, `features/leave/components/leave-overview-filters.tsx`, `leave-overview-body.tsx`.
- *Povijest promjena*: `pages/povijest-promjena.tsx`, `features/history/components/history-body.tsx`, `history-filters.tsx`, `history-export.tsx` (`HistoryExportMenu`, `HistoryExportNotices`), `hooks/use-history-export.ts` (takes `null`).
- `apps/web/src/lib/i18n/locales/hr.json`, `test/resource-hygiene.test.ts` -- `filter.activeLabel`, `filter.sheetApply`, `filter.sheetReset` = `Očisti`, `toolbar.*`; `filter.sheetShow` and the three ledes removed.
- Source pins: `pages/screens-sweep.test.ts`, `literal-sweep.test.ts`, `key-sources.fixture.ts`, `source-guards.fixture.ts`, `structural-pins-shell.test.ts`, `structural-pins-members.test.ts`, `features/calendar/print.test.ts`, `utils/filter-bar.test.ts`, `utils/sticky-head.test.ts`.
- e2e/perf: `e2e/pages/filter-bar.ts`, `calendar.page.ts`, `history.page.ts`; `calendar.spec.ts`, `calendar-conflicts.spec.ts`, `layout.spec.ts`, `history.spec.ts`, `hours.spec.ts`, `people.spec.ts`, `my-leave.spec.ts`; `perf/glass-scroll.spec.ts`.
- Docs: `epics.md` (story 21.23, UX-DR82), `sprint-status.yaml`, DESIGN.md (Dialog, month toolbar, Compact toolbar, Filter chip row, Filter sheet), EXPERIENCE.md, `deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- [x] `PageToolbar` and `ToolbarMenu`; `FilterTrigger`, `FilterToolbar`; the anchored Dialog.
- [x] The four pages on the toolbar; *Kalendar*'s modes and *Ispiši* into menus; the phone sticky head holds the month alone.
- [x] Copy, hygiene list, source pins, e2e page objects and specs, perf.
- [x] DESIGN.md, EXPERIENCE.md, epics, sprint status, deferred work.

**Acceptance Criteria:** as epic story 21.23, read with the deviations above.

## Spec Change Log

- Review loop 1 (2026-11-25), Epic AC Auditor and an adversarial/edge-case review. Amended deviations: the phone month slot, the row ceiling, forced colours. Patched: `people.spec.ts`'s side-sheet geometry (would have failed); `closeModes()` after every assert-only `openModes()` so the open menu cannot cover the next press; the anchored panel re-measures on scroll (a native modal does not lock scroll) and measures against `clientWidth` (classic scrollbars); `ToolbarMenu` refocuses its button without scrolling (a press far down the page closes it); `FilterBar`'s close effect keyed on "no model", not the model object; `FilterSummaryCard`'s dead `leading`/`trailing`; stale doc comments. Kept: `Izvoz ▾` on *Povijest promjena* drawn only while ready (as 14.3's button was); the generic `Traži…` placeholder (the founder's word; the search's label is unchanged); the one-button `Filtri` group (e2e's `bar`).

## Design Notes

The two-group shape (`Filtri` around the trigger, `Aktivni filtri` around the chips) exists because the row's other controls sit between them in the DOM; e2e's `bar` finds both. *Kalendar*'s grid is reached by Tab from `Izvoz ▾` (the toolbar's last control) when no chip is drawn, else from `Očisti sve`.

## Verification

**Commands (2026-11-25):**
- `pnpm typecheck` (apps, e2e, smoke, perf) -- exit 0.
- `pnpm lint` -- exit 0.
- `pnpm --filter @shift/web test` -- 186 files, 6925+ tests passed.
- `pnpm build`, then `pnpm exec vitest run test/theme-tokens.test.ts test/theme-contrast.test.ts test/theme-fidelity.test.ts test/theme-applied.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` and the DB-free `localization-applied`, `localization-guard`, `key-hygiene`, `feature-boundaries`, `import-cycles`, `e2e-plural`, `typography-coverage`, `no-jsdom`, `workspace-isolation`, `e2e-midnight-guard` -- all passed. `index.css` is unchanged; the theme files ran because `theme-contrast` reads `filter-bar.tsx`.
- The real `FilterToolbar`, `FilterTrigger`, `ActiveChips`, `ToolbarMenu` and `PageToolbar` were rendered to static HTML with the built CSS in headless Chromium at 320, 390, 800 and 1280 px: no horizontal overflow; at 390 px *Ljudi*'s toolbar is the title with three icon buttons, the search under it, then the count and chips; from 800 px one row. At 320 px *Povijest promjena*'s title takes its row and the buttons wrap under it, instead of breaking the word.
- e2e and perf never ran locally (CI is their first run).

**Residual risk:** the e2e steps were updated by reading the code: the panel's desktop geometry, the modes now behind `Prikaz ▾`, the export behind `Izvoz ▾` and the Tab path into the grid are unverified until CI.
