---
title: '21.25 The calendar reads like paper (Kalendar kao papir)'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '7ddc632' # main after #375 (the personalShiftOn hotfix), #374 (21.6) and #373 (21.9); the hot files hr.json, the sweep pins and the shared filter bar start from 21.6's merge
review_loop_iteration: 1 # pass 1 done
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-3-the-calendar-scrolls-with-the-page.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-4-an-admin-plans-the-month-in-rucni-raspored.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-6-personal-shifts-are-read-wherever-shifts-are-read.md'
---

Status: done. PR #376, squash `b130440`, merged 2026-11-26 with `CI passed` green (run 45727993162 at `2e76731`). CI run 1 (45724396071 at `9b42d92`) failed all four e2e shards on the page object's `cellOf` (a `has:` locator rooted at the grid) and the transposed tab stop, both fixed in the pushed head (see Verification). The rewritten e2e ran green in run 45727993162; `perf/glass-scroll.spec.ts` stays the operator's. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** *Svi timovi* is a grid of dates by teams: a row per date and a column per team. The paper roster the pilot plans with reads the other way, dates across and the crews then the day workers down, and the people with no team's rotation (dispatchers, cleaners, students) are read nowhere on it.

**Approach (founder request, 2026-11-25):** transpose the grid from 640 px. Columns are the dates of the month; rows are first the teams, each its type per date, then the people on a personal or manual schedule, grouped by job role (`CalendarMember.jobRole`, 21.12). Sticky date header and name column, the page scrolls and the grid only sideways (21.3's rule), drawn with *Ručni raspored*'s own frame and heads, moved to `@/components/date-grid` so both grids share them. A cell opens the existing day detail. The phone keeps 21.3's day list. *Filtri* gains *Posao* (`?posao=`, *Ljudi*'s semantics) on the calendar and on *Ručni raspored* (owned here by deferral from 21.12 and 21.5). *Moj raspored* is unchanged. No migration.

## Boundaries & Constraints

**Always:**
- Team rows are every shown column (every active team the filters leave), as the old grid's columns were: a turnus team its type per date, a team with no rotation `—` or its 21.6 staffing groups. A team the filter offers is always a row.
- People rows: members active in the month who are on no active turnus team (`teamHasRotationBy`, the rotation rule *Ručni raspored*'s *ručno* now reads from `month.ts`) on any date they are active: on no team, an archived one, or a team with no rotation. A mid-month joiner of a crew is read on the crew's row. Grouped by role name (Croatian order), *Bez posla* last; by name inside. Each day through `memberScheduleOfMonth` (the shift with a type, its marks through `memberCellMarksOf`, the assigned mark as 21.6 sets it). A person whose days cannot be derived is that row's failure alone (logged, the row says *Raspored nije dostupan*).
- A cell draws the type's letter in its fill with the marks' rings, hatches and glyphs, the pencil for an assigned day, a team's staffing groups as `+N`; its name is `cellLabelOf`'s, in full. A key of letters is above the grid; 21.6's legend adds the pencil.
- A cell opens the day detail: a team row its team; a person's the shift's team, else their own team that date, else the first turnus team shown; none when no team exists.
- Keys: one ARIA grid, one tab stop (initially the first row on today), rows = teams then people, columns = dates (`grid-keys.ts`).
- *Posao*: `all`/`none`/role id, an unknown id is every role, the chip and field only while somebody holds a role or one is chosen. On the calendar it narrows the people to the role and the teams to those somebody holding it is on for the month, combines with *Tim*, and a person chosen replaces it. On *Ručni raspored* it narrows the rows; the draft keeps every row's cells.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no migration or RPC; no change to *Moj raspored*, the day detail or the phone's list; no second strip implementation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Mixed month | 4 crews with rotation, a day team without, a student on no team | 6 team rows (the day team `—` or its groups), then *Student*: the student; *Bez posla*: the day team's member |
| Posao a role held by a teamless student | `?posao=<student role>` | people: the student; no team row |
| Posao none | `?posao=none` | people with no role; the teams their colleagues with no role are on |
| Unknown role | `?posao=gone` | every role, the URL kept |
| Person chosen | `?osoba=…&posao=…` | the person's day list; the role ignored |
| Person's empty day, no team | click | the first turnus team's day detail |
| Unreadable person | a history the domain refuses | that row says so, the month draws |

## Epic AC Deviations

- AC "y axis … first the turnus TEAMS": every shown team is a row, a team with no rotation included (`—`, or its staffing groups). A team the *Tim* filter offers must be a row it can show, and 21.6 draws a day team's staffing groups on its cell. Reinterpreted.
- AC "Clicking a cell opens the existing day detail": a person's cell with no shift and no team opens the first turnus team's day, which does not name them; a teamless day detail does not exist (deferred-work).
- AC "then the people on a personal or manual schedule" *(added by the review, 2026-11-25)*: a person row is a member on no turnus team in the month. A member on a crew who holds Personal Assignments shows on the crew's cells (21.6's `+N`), not on a row of their own, and the web snapshot does not read 21.9's schedule sources yet, so a member made manual or given their own rotation while on a crew (21.10) is not a person either. Narrowed; deferred to 21.10 (deferred-work).
- AC "Visually consistent with *Ručni raspored*": the cells keep the calendar's type fills and marks, drawn as *Ručni raspored*'s 36 px letter boxes; the range is in the cell's name, no longer drawn (deferred-work).

</frozen-after-approval>

## Code Map

- `apps/web/src/components/date-grid.tsx` NEW -- `DateGridFrame` (frame, sticky strip with its inert copy, horizontal scroller, the table pulled up `-mt-11`), `DateGridCorner`, `DateHead` (`aria-current="date"` on the grid's head only), `DateGridRowHead`, `DateGridGroupHead`; `apps/web/src/utils/grid-dates.ts` NEW -- `GridDate`, `gridDatesOf`, `weekdayOf`/`isWeekend` (moved from `manual-grid.ts`, re-exported), `DATE_CELL_SCROLL_CLASS`, `dateCellClassOf`.
- `apps/web/src/features/calendar/utils/month.ts` -- `ROLE_SEARCH_PARAM` (`posao`), `CalendarFilter.roles`/`role`, `CalendarFilterPerson.roleId`, `CalendarMonth.teamRows`/`peopleGroups`, `teamHasRotationBy`, `paperRowCountOf`, `paperCellTargetOf`, `cellFillClassOf`, `personDaysOf` (guarded); 21.6's staffing groups kept on team cells.
- `apps/web/src/features/calendar/components/calendar-grid.tsx` -- rewritten on the shared frame; `calendar-cell.tsx` -- `CalendarLetterBox`; `hooks/use-calendar-screen.ts` -- `posao`, keys over the paper rows; `utils/grid-keys.ts` -- the tab stop by dates; `utils/screen-keys.ts` -- the role resets the tab stop; `utils/filters.ts`, `components/calendar-filters.tsx` -- *Posao*.
- `apps/web/src/utils/filter-bar.ts`, `apps/web/src/components/filter-bar.tsx` -- `FILTER_ROLE`, the model's `roles`/`role`/`summaryRole`, `posao` on every change from a bar offering it, the *Posao* field and picker, `filterSummaryTextOf` (the summary with `· Posao: …`). *Sati* passes no roles and is unchanged.
- `apps/web/src/features/planning/services/manual-grid.ts` -- `ManualRow.jobRoleId`, `manualRoleFilterOf`, `MANUAL_ROLE_CHIP`; `hooks/use-manual-schedule.ts` -- `posao`, `roleFilter`, `chooseRole`; `components/manual-filters.tsx` NEW; `components/manual-grid.tsx` -- on the shared frame; `pages/rucni-raspored.tsx`.
- `hr.json` (`kalendar.paper.*`, `filter.role*`, `filter.allRoles`, `filter.noRole`, `filter.chip.role`, `filter.remove.role`, `filter.summary.withRole`; `kalendar.columnDate` removed), `test/resource-hygiene.test.ts`, `key-sources.fixture.ts` (231, 120, 128, 23 strings), `source-guards.fixture.ts`, `calendar-screen.fixture.ts` (`dateGrid`), `screens-sweep.test.ts`, `snapshot.test.ts`, `calendar-layout.test.ts` (rewritten for the shared frame), `test/localization-applied.test.ts` SOURCES.
- Tests: `paper.test.ts` NEW, `filters.test.ts`, `filter-bar.test.ts`, `grid-keys.test.ts`, `screen-keys.test.ts`, `manual-grid.test.ts`, `month.test.ts`, `loan-marks.test.ts`, `print.test.ts`.
- e2e (unrun, CI): `pages/calendar.page.ts` (`teamHeader`, `teamRows`, `dateCount`, `gridRowCount`, `todayColumnAnywhere`, `todayFirstCell` by `data-today`, `cellOf` by row and day, `focusedCell` by `data-row`/`data-column`, `typeNamed`, `letters`, `activeTeamCount`), `calendar.spec.ts`, `layout.spec.ts`, `calendar-conflicts.spec.ts`, `conflicts-queue.spec.ts`, `calendar-paper.spec.ts` NEW (rotation hold, own team and members, every write removed in `afterEach`, the hold released last); `perf/glass-scroll.spec.ts` scrolls the grid sideways too.

## Design Notes

1. **Every team is a row.** Only turnus teams was the request's wording; a team with no rotation is kept so the *Tim* filter never offers a team the grid cannot draw, and so 21.6's staffing groups on a day team stay visible. Its members are people rows too (*ručno*), as on *Ručni raspored*.
2. **Letters, not names.** 31 columns cannot hold names or ranges. A cell draws the letter (`typeLettersOf`, over the month's types including the people's), the full words are the cell's name and the key.
3. **One frame.** 21.3's strip mechanism moved out of `calendar-grid.tsx` into `@/components/date-grid`, used by both grids; `calendar-layout.test.ts` pins it there, and each grid's copy branch carries no live attribute.
4. **What a person's cell opens** (see the deviation): the day detail is a team's day.
5. **Posao on the shared bar.** `FilterBarModel` gained an optional role facet; *Sati* passes none, so its changes carry no `posao` and its tests are unchanged. A role combines with a team and is replaced by a person, as the team is.

## Verification

**Commands (2026-11-26, on `7ddc632` + this change):** `pnpm typecheck` (apps, e2e, smoke, perf) exit 0; `pnpm lint` exit 0; `pnpm --filter web build` exit 0. Web unit tests run by folder (`vitest run src/features/... src/pages src/utils src/components src/hooks src/lib src/router.test.ts`): all pass. DB-free root files `resource-hygiene`, `supabase-scaffold`, `localization-applied` (after the build), `feature-boundaries`, `import-cycles`, `key-hygiene`, `localization-guard`, `e2e-plural`, `typography-coverage` and the four theme files: 4586 passed. No `index.css` or token change (the theme files ran anyway).

**Printed:** the same render emulating print at an A4 landscape width: the table is 997 px in a 1047 px page (the date heads lose their 44 px minimum on paper, the name column narrows to `w-28`), and the PDF rasterized with `pdftoppm` shows the whole month on one page, letters, key and marks legible.

**Rendered:** the real `CalendarGrid`, `CalendarTeamDays` and `ManualGrid` were rendered to static markup with the built CSS in headless Chromium over the planning fixture (crews A–D, *Dnevni* and *Kasni* with no rotation, a teamless student and a day-team member with assignments): at 1280 px (light and dark) and 800 px the page never scrolls sideways, the grid has no vertical scroll room and only its scroller moves sideways, the strip's columns equal the grid's, the strip's copy carries no role, tab stop or `aria-current`, today's head is the one `aria-current="date"`; 21.6's staffing groups read as `+N` with the pencil on the crews' cells; the phone list at 390 px does not overflow; *Ručni raspored* draws as before on the shared frame.

**The CI locator fix, checked:** over the same render, the old `teamRows.filter({ has: <grid-rooted rowheader> })` finds 0 rows and the fixed one 1; `personRow` finds the student's row; the tab stop is `data-row="0"` on today's column.

**Not run locally:** e2e and perf (CI is their first run; see deferred-work), and every DB-connecting root test (none changed).

## Spec Change Log

- 2026-11-26, CI run 1 (`gh run view 45724396071 --log-failed`): the e2e failed across four shards, 64 of them on "the grid has no row for Smjena …". ROOT CAUSE: the page object's `cellOf` filtered the team rows with `has: this.teamHeader(name)`, a locator rooted at the grid; Playwright matches `has` INSIDE each row, where no grid is, so it matched nothing, though `teamHeader` alone was visible. Fixed with a bare rowheader locator; `calendar-paper.spec.ts` had the same pattern for the student's row (now `personRow`). Second cause: `expectTabStopOnToday` still asserted `data-column="0"`; on the transposed grid the tab stop is the first ROW (`data-row="0"`) on today's column. The history PDF-failure and *Nova osoba* failures touch nothing this change touches and are left to the rerun. Rebased onto `7ddc632`, which carries the `personalShiftOn` fix this branch also made (dropped as a duplicate).

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind hunter with verification gap, edge-case hunter, epic AC auditor. The unrun DB test auditor: no DB test, migration function or Edge Function changed.
- intent_gap: 0. bad_spec: 1 (the narrowed people rule, now a listed deviation). patch: 13. defer: 4. Rejected: 6.
- addressed_findings:
  - `[high]` `[patch]` The letters were worked out over the FILTERED people, so a *Tim* or *Posao* filter could change a team's letter; they are worked out over every person row first (`paper.test.ts` pins it) (edge-case).
  - `[high]` `[patch]` A crew member seeded from today was a person row (the rule read the month's first date), which `calendar-paper.spec.ts` would have failed on: a member on an active turnus team on any active date is that team's (blind, edge-case).
  - `[medium]` `[patch]` A staffing group's letter was missing from the key (blind, edge-case).
  - `[medium]` `[patch]` *Dodaj smjenu*'s `?dan=` read the role-narrowed rows (a false "no row") and its cleanup dropped `posao`: it reads every row, keeps the role, and drops it only when it hides the member (blind, edge-case).
  - `[medium]` `[patch]` A role changed by Back or a pasted URL kept a selection of hidden rows on *Ručni raspored*: any change of the applied role clears it (blind).
  - `[medium]` `[patch]` An unreadable person's cells were named *nema smjene* and opened a team's day: they are named *Raspored nije dostupan* and open nothing (blind, edge-case).
  - `[medium]` `[patch]` The phone with no team but people said a filter left nothing: it says there is no team; with no team and no person anywhere, the old notice; `kalendar.paper.nothing` was unreachable and is gone (blind, edge-case).
  - `[medium]` `[patch]` The printed month: the date heads kept their 44 px minimum on paper; `print:min-w-0` and a `w-28` name column, checked by a print render (blind).
  - `[medium]` `[patch]` `cellsMarkedConflictOrLeave` counted person rows (their own leave): scoped to the team rows (blind).
  - `[medium]` `[patch]` `coverFirstColumn` scrolled 20 px, no longer near the tab stop: it scrolls the tab stop partly under the name column (blind).
  - `[low]` `[patch]` The perf proxy took a sideways scroll for a vertical one: down first, across only where nothing scrolled down (blind).
- Deferred: the narrowed people rule (21.10); no *Posao* e2e; the group heading rows' `th scope="colgroup"` in the grid (shared with *Ručni raspored* since 21.4); a person row for a crew member who leaves for a day team mid-month. See `deferred-work.md`.
- Rejected:
  - "A stale `?posao=` stays in the URL while nobody holds a role": *Ljudi*'s semantics, an unknown id is every role and the URL keeps it; `FILTERS_CLEARED` drops it.
  - "The tab stop is an index, not an identity": as the 21.3 grid's; it resets on every month and filter change (`gridFocusKeyOf`).
  - "Two roles or types with one name": the names are the organization's data, as on *Ljudi* and *Ručni raspored*.
  - "Memoize the person labels": 31 × the people per render, measured cheap in the render; no change.
  - "Assert the team count, not a team row": the counts are re-read within one test, as the old column count was; parallel specs serialize on the rotation lock.
  - "No `manualSearchOf` unit test": the hook module renders React; `posao` parsing mirrors `osoba`'s and the calendar's (`paper.test.ts`).
