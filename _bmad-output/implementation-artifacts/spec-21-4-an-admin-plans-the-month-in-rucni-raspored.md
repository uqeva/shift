---
title: '21.4 An admin plans the month in Ručni raspored'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: 'e5d3032f26cb8794d5eb8ea256c1e2c6bdfd9313' # built on d23aef6 (#365, 21.2, after #364, 21.3); rebased onto #366 (21.22/21.24, Tim) and #367 (21.23, PageToolbar): the hot files (hr.json, the sweep pins) start from all four merges
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-2-a-personal-assignment-is-a-recorded-exception.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-3-the-calendar-scrolls-with-the-page.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.2 stores Personal Assignments, but no surface writes one. Day workers and students are still planned on paper. The history draws the table as a generic record, one entry per row.

**Approach:** Add *Ručni raspored* (`/rucni-raspored`, admin only). It is a people × dates grid for one month. Rows are grouped by team as at the month's first date, with no-team rows last. It follows 21.3's page scroll: a sticky date strip, a sticky name column, and horizontal scroll only. Cells are edited in a draft through one picker (types, *Slobodno*, *Očisti*, *Računaj u tim…*), for one cell or a selection. *Spremi* reads afresh and shows *Što se mijenja* (AD-5 as amended). Only an erasure blocks. One `save_personal_assignments` call then writes the whole draft. A phone edits one member's month as a day list, with the same picker. The history names the record and groups one save into one entry per member (*Ručni raspored: {n} dana*).

## Boundaries & Constraints

**Always:**
- Rows are members active on at least one date of the month, grouped by `membershipOn(month's first date)`. Teams come in the snapshot's order, by name inside a team. A member's inactive dates are drawn inactive, and they stay editable (R14.3; 21.2 DN7).
- Row source (UX-DR73): *rotacija tima* when the row's team has a rotation version in effect on or before the month's last date. Otherwise *ručno*. *osobna rotacija* arrives with 21.9/21.10.
- A cell shows the "after" (the live data plus the draft) through `memberScheduleOfMonth`:
  - a Personal Assignment is solid, with a pencil mark and `dodijeljeno ručno` in its name;
  - a rotation or override shift is muted, with a rotation glyph;
  - a draft-changed cell is also marked as changed.
  Type letters come from `typeLettersOf`, with a legend. Today and weekends are marked by glyph and tint.
- Selection: a click selects one cell and opens the picker. Shift-click extends a rectangle, Ctrl/Cmd-click toggles a cell, and a drag selects a rectangle. Arrows move, Space toggles, Shift+arrows extend, and Enter opens the picker. The grid is one ARIA grid with one tab stop.
- Picker choices: every active shift type (working or not), *Slobodno* (`OFF`), *Očisti* (clear), and *Računaj u tim…* (own team or any active team). Choosing a type on a rotation cell makes it an assignment. A draft cell equal to the live row is dropped from the draft.
- The sticky save bar shows the change count, *Odbaci* and *Spremi*. Its toolbar holds the month control and an *Uredi odabrano* action only.
- *Spremi* reads the three core reads fresh. It builds "after" from the fresh calendar with the draft applied to each member's `personalAssignments`, from the earliest to the latest changed date. *Što se mijenja* then lists, per member:
  - shifts lost and gained, including teamless ones (*bez tima*);
  - new double bookings (overlapping working legs);
  - new no-rest duties (`dutiesOf` with more than one leg, the teamless shift included);
  - newly short-staffed shifts;
  - roster overrides left inapplicable (listed and kept);
  - new teamless leave conflicts, as a warning that *Za odluku* will not show them yet;
  - erasures (`erasuresOf`).
  Only erasures block, through the shared erasure dialog. Its confirm re-checks fresh, then sends one `save_personal_assignments`.
- The write sends only changed cells (at most 5 000 items, else refused before sending). 42501 means *nemaš ovlasti*. 22023 means the screen is behind: re-read, and the draft is kept. A landed save clears the draft and re-reads the calendar and its dependents. The page is online only: an offline save is gated.
- History: `personal_assignments` → record `personal-assignment` (*Ručni raspored*). `kind` `SHIFT`/`OFF` are worded. A removal and an insert pair on `member_id` and `date`. Every event of one transaction is grouped per member into one entry, action `planned`, `days: n`. It has one `date` line per date (bilo → sada, an assignment operand), and the list is collapsible.
- Every word is in `hr.json`. The key and hygiene sweeps are updated. DESIGN.md and EXPERIENCE.md record the screen. The product wording uses *Tim/Timovi* (21.22).

**Ask First:** none (unattended; decisions in Design Notes).

**Never:**
- no migration or RPC change (0077 is the write);
- no fill or copy (21.5);
- no web reader of teamless shifts outside this screen (21.6), and no storing or resolving of a teamless collision (21.7);
- no personal rotation (21.9/21.10), and no member-page single date;
- no inner vertical scroll container.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Range set | drag 5 cells of a student, pick *Dan* | 5 draft cells; *Spremi* shows 5 gained *bez tima*; one call with 5 `set` items | none |
| Rotation cell | crew member's rotation *Noć*, pick *Slobodno* | draft `OFF`; preview loses *Noć*, team short-staffed when below the minimum | none |
| Clear | an assigned cell → *Očisti* | `clear` item; a rotation shift comes back in preview as gained | none |
| Unchanged | pick the type a live assignment already has | no draft entry, count unchanged | none |
| Teamless leave | gain a teamless shift on a leave date | warning line naming member and date; save allowed | none |
| Erasure | an `OFF` over a queued conflict | erasure dialog; nothing written until all confirmed | refused while unconfirmed |
| Stale | type archived meanwhile | 22023 → re-read, draft kept, alert | `stale` |
| Phone | < 640 px | member select + that member's day list; same picker | none |
| History | one save, 2 members × 3 dates | 2 entries *Ručni raspored: 3 dana*, each expandable to 3 date lines | none |

## Epic AC Deviations

- AC 1 "each row names its source (*rotacija tima*, *osobna rotacija*, *ručno*)": *osobna rotacija* has no data until 21.9 adds schedule versions, so a row reads *rotacija tima* or *ručno*. DEFERRED to 21.10, which shows it (`deferred-work.md`).
- AC 1 "rows are active members": read as members active on at least one date of the month. Their inactive dates are drawn inactive and stay editable (R14.3, 21.2 DN7).
- AC 3 "erased collisions": a teamless collision cannot be stored or resolved until 21.7, so its erasure is not listed. Instead, a new teamless leave conflict is a preview warning (the deferred-work gate, answered: warn).
- AC 4 "one member's month at a time is editable with the same picker": multi-select (click/drag/keys) is desktop and tablet only. A phone edits one date at a time.
- AC 1 "manual-only rows show only what is assigned" *(added by the review, 2026-11-25)*: a *ručno* row (a member with no team, or whose team has no rotation) shows its assignments, and also any shift a roster override or a loan puts them on, drawn as the team's (muted, rotation glyph). Those are real shifts the member works, and hiding them would hide a double booking. A *Samo ručno* schedule source arrives with 21.9/21.10 (`deferred-work.md`, the 21.10 entry). Reinterpreted.
- UX-DR72 "admin only, under *Raspored*" *(added by the review)*: no *Raspored* destination exists (`/raspored` is 9.1's redirect to *Za odluku*). *Ručni raspored* is its own destination under *Pregled*, after *Za odluku* (Design Note 8). Reinterpreted.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/planning/services/manual-grid.ts` -- NEW, pure. `manualGridOf(snapshot, month, today, draft)`: rows, groups, sources, cells; `draftWith`/`draftItemsOf` (drop cells equal to live); `draftAfterOf(calendar, draft)` replaces drafted members' `personalAssignments` (draft ids `draft:<member>:<date>`); selection helpers (rectangle, toggle, move).
- `apps/web/src/features/planning/services/manual-preview.ts` -- NEW, pure. `manualPreviewOf(before, after, window)`: per member lost/gained (key `team|null`), doubles (`overlappingLegsOf`), rest gaps (`dutiesOf`), inert (`rosterOverridesMadeInertOf`), teamless conflicts (`collisionsOf` over `collisionInputOf`, `teamId === null`, new only). Template: `members/services/loan.ts` `loanPreviewOf`.
- `apps/web/src/features/planning/services/manual-save.ts` -- NEW. `manualCheckOf(read, draft, online)` (`checkedOf`, `erasuresOf`, `configurationReportOf` with the fresh records), `savePersonalAssignments(rpc, items)`, refusal codes and `\w*MessageKey` unions.
- `apps/web/src/features/planning/hooks/use-manual-schedule.ts` -- NEW. Month search, draft, selection, picker, check, erasure confirmation (`useErasureConfirmation`), write, re-read (`refreshAfterWrite`, `MEMBERSHIP_WRITE_DEPENDENTS`).
- `apps/web/src/features/planning/components/{manual-grid,manual-picker,manual-save-bar,manual-preview-dialog,manual-member-days}.tsx` -- NEW. The grid copies 21.3's strip/scroller frame (`calendar/components/calendar-grid.tsx`). The preview reuses `ShortStaffedBlock`, `ErasureDialog` and `memberErasureCopyOf`.
- `apps/web/src/pages/rucni-raspored.tsx`, `router.ts`, `router.test.ts` -- NEW route (`requireAdmin`, `?mjesec=`).
- `apps/web/src/features/navigation/utils/destinations.ts` (+ test), `pages/structural-pins-shell.test.ts`, `navigation/utils/icons.ts` -- destination `nav.rucniRaspored` (admin, *Pregled*, after *Za odluku*).
- `packages/domain/src/history.ts` (+ `test/history.test.ts`) -- record, `AMEND_KEYS`, `planned` action, per-member transaction grouping, `personal-assignment` operand, `HistoryEntry.days?`.
- `apps/web/src/features/history/services/history-rows.ts` (+ test), `components/history-changes.tsx` -- words, `SHIFT`/`OFF` enum, grouped kind line, collapsible changes. `history-export.ts` and `pdf.ts` read `HistoryRow` as is.
- `apps/web/src/lib/i18n/locales/hr.json`, `pages/key-sources.fixture.ts`, `pages/source-guards.fixture.ts`, `test/resource-hygiene.test.ts` -- keys and pins.
- `e2e/` -- grep the admin destination lists and counts; update every spec that asserts them.
- `apps/web/src/features/planning/planning.fixture.ts` -- NEW test calendar (pilot fixture plus a team with no rotation and a student with no team); `features/planning/utils/element-ids.ts` -- the screen's ids and the picker's own-team value (no literal in a swept screen).
- `eslint.config.js` (+ `test/feature-boundaries.test.ts`'s message) -- `members/utils/erasure-copy` public for planning: the erasure dialog words its rows as the member page's do.
- `test/resource-hygiene.test.ts` -- every new key pinned (plural and screen lists); `rucniRaspored.` is a scope where `smjen` is a worked shift (as *Sati*), never the Shift Type's term.
- `e2e/utils/i18n.ts` (`ADMIN_DESTINATIONS`), `e2e/tests/layout/phone-navigation.spec.ts` (*Više* rows, the desktop sidebar) -- the new admin destination, unrun (CI).
- Docs: DESIGN.md/EXPERIENCE.md (*Ručni raspored*), `deferred-work.md` (resolve the 21.4 gate and the history entry; new entry for 21.10 *osobna rotacija*), `sprint-status.yaml` (21.2, 21.3 done; 21.4 review), and the 21.2/21.3 specs' status lines.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/history.ts` + tests -- record, pairs, grouping, operand.
- [x] `features/history` -- words and the collapsible list.
- [x] `features/planning/services/*` + tests -- grid, draft, selection, preview, check, write (every matrix row).
- [x] `features/planning/hooks`, `components`, `pages/rucni-raspored.tsx`, router, destinations -- the screen.
- [x] `hr.json` and the sweep fixtures and pins.
- [x] e2e destination pins; docs; deferred-work; sprint status.

**Acceptance Criteria:**
- Given an admin on `/rucni-raspored`, when the month renders, then the rows, groups, sources and marks match the Always rules, and only the page scrolls vertically.
- Given a draft, when *Spremi* runs, then *Što se mijenja* lists exactly the derived lines, and one RPC call carries only the changed cells.
- Given a member on the route, when they open it, then the admin guard forwards them.
- Given the domain, web and DB-free root suites, typecheck, lint and build, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended, the 21.1 precedent): two deviations were added to the frozen `## Epic AC Deviations` at the epic AC auditor's finding. They are AC 1's "manual-only rows show only what is assigned" (a *ručno* row also shows override and loan shifts) and UX-DR72's "under *Raspored*" (its own destination). Each was already the code's and Design Note 8's choice; listing them changes no intent. No intent_gap, no bad_spec, so no loopback. KEEP: the one "after" (`draftAppliedOf`), the check on fresh reads, and the history grouping by transaction and member.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 5). The unrun DB test auditor has nothing to audit: no DB test, migration function or Edge Function changed.
- The reviewed diff was taken against `origin/main` after #367 (21.23) had merged under the branch, so it showed 21.23 reverted. The branch was rebased onto #367 and #368 before any fix. Its only conflicts were the hot files `key-sources.fixture.ts` and `deferred-work.md`.
- intent_gap: 0. bad_spec: 0 (two deviations listed, see the change log). patch: 13. defer: 3. Rejected: 5.
- addressed_findings:
  - `[medium]` `[patch]` The new page kept the pre-21.23 header and lede. It now uses 21.23's `PageToolbar`: the title, the month control as the lead and *Uredi odabrano* as the control. The lede is gone, and the legend and the selection hint sit at the Card's head (blind, edge-case, verification-gap).
  - `[medium]` `[patch]` The confirm step wrote even when the fresh check's preview differed from the one shown. A changed preview is now shown again and must be confirmed (`manualPreviewKeyOf`) (blind).
  - `[medium]` `[patch]` A month the domain could not derive left the page on "loading" for good. It now shows an alert (`failed`) (blind, edge-case).
  - `[medium]` `[patch]` A drafted cell of a member deleted meanwhile blocked every save as stale. `draftAgainst` now drops it (blind, edge-case).
  - `[medium]` `[patch]` A note-only grid change gave an empty *0 dana* history entry. The note is now part of an assignment operand (`Dnevna (napomena)`), so the change shows. The retro A4 invariant now also runs on the grouped path (blind, verification-gap, edge-case).
  - `[low]` `[patch]` The saved line counted items 0077 found unchanged. It now counts `sent − unchanged` (edge-case).
  - `[low]` `[patch]` A double booking on a date was only in the accessible name. It is now drawn as an underline, and it counts working shifts only (blind).
  - `[low]` `[patch]` Today and weekends: the today column's cells are edged, and a cell's name now says the weekday and *danas* (blind).
  - `[low]` `[patch]` The legend now covers the counted-team `+`, the underline and the inactive hatch (blind).
  - `[low]` `[patch]` *Očisti*'s hint and the rotation word no longer promise a rotation: *raspored tima, ako ga osoba ima*, *iz rasporeda tima* (blind).
  - `[low]` `[patch]` A macOS Ctrl-click toggled a cell and also opened the context menu, which is now suppressed (edge-case).
  - `[low]` `[patch]` Tests were added for the two preview filters (an existing double booking or no-rest duty is not repeated), the grouping (a mid-month team change groups by the first date), the source (a rotation starting after the month reads *ručno*), the counted team on a cell, the member pruning, and the preview key (verification-gap).
  - `[low]` `[patch]` Stray double blank lines were removed (blind).
  - `[medium]` `[defer]` The screen's save flow (*Spremi* → preview → erasure → RPC, the stale re-read keeping the draft) is tested only through its pure halves. No e2e opens `/rucni-raspored` (verification-gap). See `deferred-work.md`.
  - `[low]` `[defer]` An archived-type refusal does not point at the cells to change (blind, edge-case). See `deferred-work.md`.
  - `[low]` `[defer]` The grid does not draw leave (blind). See `deferred-work.md`.
  - Rejected:
    - A planned entry's subject teams come from the rows' `team_id` only. This is the rule every record follows (named ids, never a membership derived for the date: `filteredHistoryEntries`).
    - The *Vrsta* chip reads `Ručni raspored · planirano` while the row reads `Ručni raspored: n dana`. The chip names the kind; the row names the save.
    - A member who joins mid-month is grouped by the first date. That is AC 1's own words.
    - A team-counted shift over leave gets no preview line. It raises a team conflict that *Za odluku* lists today.
    - `plannedKeyOf` without a `member_id`: 0077's rows always carry one (a not-null column).

## Design Notes

1. **Draft as the "after".** Cells, preview and erasures all derive from one snapshot: the live members with the draft applied to their `personalAssignments`. No grid-only rule duplicates R14 (AD-7).
2. **The check runs on *Spremi*, fresh.** *Što se mijenja* derives from the fresh reads, not from the screen's snapshot. Its confirm re-reads again (the erasure loop), so a stale preview never writes unchecked.
3. **Teamless gate (deferred-work, answered).** It warns, never refuses: R14.5 says a leave over a teamless shift is a real conflict, and the admin may intend it. The warning says *Za odluku* will not show it until 21.7 lands.
4. **History grouping** happens after amend pairing, inside `historyEntriesOf`, only for live events (`transactionId` set). Each date gets its before (removed row) and after (inserted row) as `personal-assignment` operands, so the export and PDF print the lines unchanged.

## Design Notes (as built)

5. **The picker is a dialog, not an anchored popover.** The grid's horizontal scroller clips anything positioned inside it, so the picker opens as the app's `Dialog` (a bottom sheet on a phone), titled with the cell or the count. *Računaj u tim…* comes first, so the team is chosen before the type that applies it.
6. **A click opens the picker on one cell; a drag on its rectangle.** Shift-click (rectangle from the anchor) and Ctrl/Cmd-click (toggle) only select; *Uredi odabrano* and Enter open the picker on the selection. A touch that scrolls cancels the press (`pointercancel`), so a tablet still scrolls sideways.
7. **The draft spans months** and is pruned against every newer read (`draftAgainst`), so a landed save, or another admin's equal write, empties the cells it made equal.
9. **Review patches as built.** The preview a confirm writes must equal the one shown (`manualPreviewKeyOf`). A failed month derivation is an alert. The page's toolbar is 21.23's `PageToolbar`, and the legend and the selection hint sit at the Card's head. A history operand carries the note.
8. **The destination** is *Ručni raspored* under *Pregled*, after *Za odluku* (admin daily work; on a phone in *Više*). `/raspored` stays 9.1's redirect to *Za odluku*: UX-DR72's "under *Raspored*" names the planning area, not that URL.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck && pnpm lint && pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- pass; theme files if `index.css` changes.
- Not run locally: DB suites and e2e (STRICT DATABASE RULE); CI is the gate.

**Results (2026-11-25, after review pass 1, on `e5d3032`):** `pnpm --filter @shift/domain build`, `pnpm typecheck` (apps, e2e, smoke, perf) and `pnpm lint` exit 0. `pnpm build` exit 0. Domain: 23 files, 1038 tests. Web: 189 files, 7005 tests. DB-free root files `resource-hygiene`, `supabase-scaffold`, `feature-boundaries`: 2669 tests. All pass. `index.css` and no theme token changed, so the theme root files do not apply. A headless-Chromium render of the real `ManualGrid` and `ManualMemberDays` (static markup, the built CSS) was checked at 1280, 800 and 390 px. At 1280 and 800 px the strip sits at the viewport's top once the page scrolls, the grid has no vertical scroll room, only its scroller moves sideways (the page is never wider than the viewport), and the name column and the group words stay left. At 390 px the day list does not overflow.

**Residual risks:**
- CI run 1 failed in `Test (Vitest, local Supabase)` on `test/localization-applied.test.ts` (every page must be in `SOURCES`): the new page and the planning feature were added there, and the file (DB-free) then passed locally after `pnpm build`, 322 tests.
- No DB, e2e or perf run locally (STRICT DATABASE RULE; CI is the gate). The two e2e files changed (`e2e/utils/i18n.ts`, `phone-navigation.spec.ts`: the tenth destination in the sidebar and *Više*) run first in CI. No e2e opens `/rucni-raspored` (deferred-work).
- The hook's pointer, drag and keyboard wiring is checked by the render and by typecheck only; a touch drag on a tablet is untested.
- Process note: as in 21.1 and 21.2, the implementation ran in the orchestrating session (its investigation was in context), not in a fresh step-03 subagent. Review ran with four context-free subagents.

## Suggested Review Order

**The draft and its one "after"**

- Entry point: the draft applied to each member's assignments, which the cells and the check both read.
  [`manual-grid.ts:218`](../../apps/web/src/features/planning/services/manual-grid.ts#L218)

- A cell set back to its live row leaves the draft; the save bar counts what is sent.
  [`manual-grid.ts:93`](../../apps/web/src/features/planning/services/manual-grid.ts#L93)

- Rows, groups, sources and cells, all through `memberScheduleOfMonth`.
  [`manual-grid.ts:439`](../../apps/web/src/features/planning/services/manual-grid.ts#L439)

**Spremi: fresh check, preview, erasures, one write**

- The check over fresh reads: refusal first, then erasures, preview, short-staffed.
  [`manual-save.ts:69`](../../apps/web/src/features/planning/services/manual-save.ts#L69)

- Per member lost and gained, new doubles and no-rest duties, the teamless gate.
  [`manual-preview.ts:199`](../../apps/web/src/features/planning/services/manual-preview.ts#L199)

- The confirm writes only what the admin saw, else the erasure dialog.
  [`use-manual-schedule.ts:403`](../../apps/web/src/features/planning/hooks/use-manual-schedule.ts#L403)

**The screen**

- 21.3's strip and scroller frame, one ARIA grid, multi-select.
  [`manual-grid.tsx:239`](../../apps/web/src/features/planning/components/manual-grid.tsx#L239)

- The page on 21.23's `PageToolbar`, the phone's day list.
  [`rucni-raspored.tsx:100`](../../apps/web/src/pages/rucni-raspored.tsx#L100)

**History**

- One transaction per member is one `planned` entry with a line per date.
  [`history.ts:1286`](../../packages/domain/src/history.ts#L1286)

**Peripherals**

- Tests over the pilot fixture with a manual team and a student.
  [`manual-grid.test.ts:1`](../../apps/web/src/features/planning/services/manual-grid.test.ts#L1)

- Destination, router, sweep pins, hygiene keys.
  [`destinations.ts:128`](../../apps/web/src/features/navigation/utils/destinations.ts#L128)

