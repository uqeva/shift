---
title: '21.18 Holidays show on the calendar, the schedule and the grid'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '69ef8fc631ed39f2db6567fa1bf6af7e61bee874'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-16-holidays-are-organization-data.md'
---

Status: done. Merged with 21.19 as PR #382, squash `f0af532`, 2026-11-26, with `CI passed` green on the PR's only run (45769395192 at `81faaa6`). The e2e and DB-connecting suites this spec lists as CI's ran green there. No migration. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 21.16 a holiday empties the teams off on holidays, but no surface says so: an emptied cell draws as "no rotation" (`—`), and no date carries the holiday's name, so an empty day team reads as a gap.

**Approach:** One recipe reads the holiday names from `calendar.holidays` (never from `holidayRuleOfCalendar`, which is `{}` with no team off). The month model, the day detail, *Danas* and *Ručni raspored* carry the date's holiday name and mark a cell the holiday emptied (the domain's `offForHoliday`); every surface draws a star glyph plus the name, and an emptied cell reads *blagdan*. All new fields are absent with no holiday, so every existing output is unchanged key for key.

## Boundaries & Constraints

**Always:**
- The name comes from the snapshot's `holidays` (`{ id, date, name }`), one memoized `ReadonlyMap<date, name>` beside `holidayRuleOfCalendar`. A holiday a team works still names the date.
- Never colour alone: a `Star` icon (Phosphor fill, added to `components/ui/icon.tsx`) beside visible words, `aria-hidden`, the words in the accessible name.
- Emptied cell (`offForHoliday` on the domain's `ScheduleCell` or `MemberShift`): the day lists (*Moj raspored*, a person, the phone's team list, *Danas*' week) draw the star and *blagdan* where `—` was; the paper grid's letter box, *Danas*' admin week cell and *Ručni raspored*'s mark draw the star (a 36 px box), and their accessible names say *blagdan*. The projected type is read in the day detail.
- A date's holiday: the paper grids' date heads (*Kalendar*, *Ručni raspored*, shared `DateHead`) draw the star with the name for screen readers, and the grid's key lists each holiday of the month visibly (`★ 18.11. {name}`); day lists, the day detail's title area, *Danas*' today card and week list show the star and the name; every cell label after the date reads `blagdan {name}`.
- Day detail on an emptied day: `{team} ne radi na blagdan.` and `Prema rotaciji: {type}.` (the projected type kept by R13.3); the override form keeps offering it (21.16).
- Deferred input (21.16 entry): `override-erasures.ts`'s amend preflight compares with the holiday-layered type (no override, the rule applied), so amending an override to the projected type on an emptied holiday is allowed; elsewhere unchanged.
- Print draws what the screen draws (the key lines print).
- New copy through the sweeps: `localization-applied` SOURCES, `key-sources.fixture.ts`, `source-guards.fixture.ts`, `test/resource-hygiene.test.ts`, and any structural pin that counts.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no migration, parser, snapshot shape or domain change; no hours (21.19); no notification; no CSS token or `index.css` change; no new e2e row injection (no parser changes, so injected rows keep their shape).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No holiday | snapshot `holidays: []` | every month, day list, detail, Danas and manual output equal to before (no new key) | none |
| Holiday, no team off | H named, nobody off | H's row/day/date head carry the name; no cell `offForHoliday`; cells draw their types | none |
| Off team emptied | D off on H, D projects Dan | D's cell `offForHoliday`, label `…, blagdan {name}, D, blagdan`; day detail says D does not work, `Prema rotaciji: Dan` | none |
| Override wins | override on D's H | the override's type, no `offForHoliday`, the date still named | none |
| Personal rotation emptied | rotation counted with D on H | no shift; the day names H | none |
| Manual grid | D's member on H, no assignment | cell `holiday`, star, label value *blagdan*; an assignment on H draws as before | none |
| Amend to projected | override on D's H, amend to Dan | allowed (not `sameAsProjected`); on a non-holiday still refused | none |

## Epic AC Deviations

- AC "a team cell the holiday emptied reads *blagdan*": the day lists, the phone's team list and the day detail show the word; the 36 px boxes of the paper grid, *Danas*' admin week and *Ručni raspored* show the star glyph, with *blagdan* in their accessible names and the key naming the glyph. Reinterpreted for width, not deferred.
- AC "a glyph plus the holiday's name" on the grids' date heads: the head draws the glyph (its name for screen readers); the name is visible in the grid's key line under the letters. Reinterpreted for width.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/services/snapshot.ts:890` -- beside `holidayRuleOfCalendar` (WeakMap memo), add `holidayNamesOfCalendar(snapshot): ReadonlyMap<string, string>`.
- `apps/web/src/components/ui/icon.tsx` -- add `Star` (`@phosphor-icons/core/fill/star-fill.svg?raw`, paths only) in the same pattern as `TreePalm`.
- NEW `apps/web/src/features/calendar/components/holiday-mark.tsx` -- `HolidayMark({ name })`: star + name (`text-xs`), the shared drawing.
- `apps/web/src/features/calendar/utils/month.ts` -- `CalendarRow.holiday?`, `CalendarDay.holiday?` (name), `CalendarCell.offForHoliday?: true`; `cellOf`'s null-type branch takes it from `CellSource`; `calendarMonthOf` rows (from `schedule` cells' `offForHoliday`), `calendarDayListOf` (from `shift.offForHoliday`), `personCellOf` unchanged (date head carries it). Also add `holidays` of the month for the key: `CalendarMonth.holidays?: readonly { date, dayMonth, name }[]` (absent with none).
- `apps/web/src/features/calendar/utils/modifiers.ts:310,390,412` -- `CellLabelSource.holiday?: string`, `offForHoliday?: boolean`; `cellLabelOf` puts `blagdan {name}` after the date and *blagdan* in the type slot for an emptied cell; new keys in `CellLabelKey` (`kalendar.holiday.word`); `gridCellLabelsOf`, `dayListLabelsOf` pass them. `calendar-grid.tsx`'s `personLabelOf` passes the row's holiday.
- `apps/web/src/features/calendar/components/calendar-cell.tsx` -- `renderCellName`: emptied → star + *blagdan* (sr-only too where unlabelled); `CalendarLetterBox`: emptied → star.
- `apps/web/src/utils/grid-dates.ts:43` -- `gridDatesOf(dates, today, holidays?)`; `GridDate.holiday?` (absent otherwise). `apps/web/src/components/date-grid.tsx` `DateHead` -- star + `sr-only` name.
- `apps/web/src/features/calendar/components/calendar-grid.tsx` -- pass the month's names to `gridDatesOf`; the key `ul` lists `CalendarMonth.holidays`.
- `apps/web/src/features/calendar/components/calendar-day-list.tsx` -- `renderDay` and `CalendarTeamDays` show `HolidayMark` under the weekday.
- `apps/web/src/features/calendar/utils/day-detail.ts:438+` -- `DayDetail.holiday?: string`, `holidayOff?: { projectedTypeName }` on the emptied branch (`scheduled.shiftTypeId === null`). `components/day-detail-dialog.tsx:463,663` -- the holiday line under the title; the emptied sentence and the projected type in place of `dayNotWorkingMessageKey`.
- `apps/web/src/features/conflicts/services/override-erasures.ts:137` -- `projectedTypeIdOf` → the holiday-layered "same" type (`scheduledShiftTypeOn(…, [], teamId, date, holidayRuleOfCalendar(calendar))?.shiftTypeId ?? null`); rename accordingly; test in its `.test.ts`.
- `apps/web/src/features/today/services/today.ts:237,316` -- `TodayView.holiday?`; `components/today-card.tsx` (a `holiday` prop) and `today-body.tsx`; `components/week-list.tsx` reads `day.holiday`.
- `apps/web/src/features/today/services/admin-today.ts:331,343,933` -- `WeekDay.holiday?`, `WeekCell.offForHoliday?` from the month's rows; `Week.holidays?` for the legend; `components/week-grid.tsx` draws them.
- `apps/web/src/features/planning/services/manual-grid.ts:395,505` -- `ManualCell.holiday?: true` (no assignment, a shift with `offForHoliday`); `gridDatesOf(dates, today, names)`; `ManualMonth.holidays?` for the legend. `components/manual-grid.tsx` (`cellLabelOf` value *blagdan* and the date's holiday; `CellMark` star), `manual-member-days.tsx` (phone: `HolidayMark`), `pages/rucni-raspored.tsx` `ManualLegend` (holiday lines).
- `apps/web/src/lib/i18n/locales/hr.json` -- `kalendar.holiday.*` (word *blagdan*, label, key line, the day detail's two sentences), `rucniRaspored.cell.holiday`, `danas` lines as needed.
- Tests: `features/calendar/utils/holidays.test.ts` (21.16's matrix file: extend with the model fields and labels), `override-erasures.test.ts`, `today.test.ts`/`admin-today.test.ts`, `manual-grid.test.ts`, `grid-dates` test if one exists.
- Sweeps: `test/localization-applied.test.ts` SOURCES (`holiday-mark.tsx`), `pages/key-sources.fixture.ts`, `pages/source-guards.fixture.ts`, `test/resource-hygiene.test.ts`, structural pins that fail (`apps/web/src/pages/structural-pins-*.test.ts`).
- e2e: grep `e2e/` for any assertion on an emptied holiday cell (none expected; 21.17's spec works on *Organizacija*); page objects that inject calendar rows are unaffected (no parser change).
- Docs: `DESIGN.md`, `EXPERIENCE.md` (UX-DR78 as built), spine AD-27 `Amended 2026-11-26 (story 21.18)`, `epic-21-context.md`, `deferred-work.md` (both 21.18 entries RESOLVED; a new entry for the route split, below), `sprint-status.yaml` (21.18 `review`; 21.16, 21.17 `done` with their specs' Status and CI lines rewritten: PR #380, squash `69ef8fc`; run 45756975501 failed on `layout.spec.ts`' injected teams lacking `off_on_holidays`, fixed by `523deb7`; run 45758802426 green).

## Tasks & Acceptance

**Execution:**
- [x] `snapshot.ts`, `icon.tsx`, `holiday-mark.tsx` -- the names recipe, the glyph, the shared mark.
- [x] `month.ts`, `modifiers.ts`, `calendar-cell.tsx`, `grid-dates.ts`, `date-grid.tsx`, `calendar-grid.tsx`, `calendar-day-list.tsx` -- Kalendar's grid, phone list, day lists and labels.
- [x] `day-detail.ts`, `day-detail-dialog.tsx`, `override-erasures.ts` -- the detail and the amend.
- [x] `today.ts`, `admin-today.ts` and their components -- *Danas*.
- [x] `manual-grid.ts`, `manual-grid.tsx`, `manual-member-days.tsx`, `rucni-raspored.tsx` -- *Ručni raspored*.
- [x] Unit tests for every matrix row; `hr.json` and the sweeps; docs and status as mapped.

**Acceptance Criteria:**
- Given no holiday, when every web suite runs, then every existing assertion holds unchanged.
- Given typecheck, lint, `pnpm build`, the domain, ICS and web suites and the DB-free root tests, when run, then they pass, and the entry chunk grows by under 10 kB.

## Design Notes

1. **Names apart from the rule.** `holidayRuleOfCalendar` stays `{}` without an off team (R13.5); the names map holds every holiday, so a 24-hour crew's worked holiday is named too.
2. **The emptied cell keeps no type.** `CalendarCell.name` stays `null`; `offForHoliday` is what turns `—` into *blagdan*, so every reader that treats a null type as no shift is still right.
3. **Bundle.** A route split of the admin pages is not cheap here: `router.test.ts` pins each route's component by identity and the structural pins read each `pages/<slug>.tsx` for its controls and keys, so moving a screen out of its page file rewrites both. It is left as a `deferred-work.md` entry (owner: a later chore), with the measured entry chunk.

## Verification

**Commands (run 2026-11-26, re-run after review pass 1):**
- `pnpm typecheck` -- clean (every project: root, e2e, smoke, perf, landing, domain, ics, web). `pnpm lint` -- clean.
- `pnpm build` -- clean. Entry chunk `apps/web/dist/assets/index-*.js`: 2 135 415 bytes after the review patches (2 134 993 before them), precache 2321.61 KiB in 15 entries. Baseline: 2 129 256 bytes, measured by the orchestrator building `69ef8fc` in this worktree before any change. Growth: 6 159 bytes, under the 10 kB criterion.
- `pnpm --filter @shift/domain test` -- 26 files, 1155 tests. The two full runs after the patches each had cases time out at 5 s (`schedule-source.test.ts` R15.6, `holidays.test.ts` R13.5; the host's load average was about 7). Re-run alone, `schedule-source.test.ts` and `holidays.test.ts` passed: 2 files, 69 tests. No domain file changed. `pnpm --filter @shift/ics test` -- 4 files, 35 tests passed.
- `pnpm --filter ./apps/web test` -- 202 files, 7311 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/static-hosting.test.ts test/import-cycles.test.ts test/typography-coverage.test.ts` -- 6 files, 3260 tests passed (DB-free; after `pnpm build`).
- No `index.css`, token, print or forced-colours block changed (Tailwind utilities only), so the theme root files were not needed.
- Not run: DB-connecting root tests, e2e (CI), gitleaks (orchestrator). No migration, parser or snapshot shape changed, so no injected e2e row (`layout.spec.ts`' teams included) needs a new field; `e2e/` holds no assertion on an emptied holiday cell or on a date head's name.

**Matrix coverage:**
- No holiday -- `holidays.test.ts` (story 21.18 block: no `holidays` on the month, no `holiday` on a row, day or detail, no `offForHoliday` on a cell, no `holidayOff`, `gridDatesOf` key-free, `monthHolidaysOf` `[]`); `manual-grid.test.ts` (no key on the month, its dates or cells); `today.test.ts` and `admin-today.test.ts` (no key on the view, its week, its days or cells); every pre-existing web assertion holds (the 21.16 R13.5 cases compare with the names set aside: a holiday names its date with no team off, by design).
- Holiday, no team off -- `holidays.test.ts` (the rule `{}`, the names map, the month's key line, the row, day and detail named, no cell emptied, the cell label `…, blagdan Dan sjećanja, Smjena A, Dan, …`); `manual-grid.test.ts`; `today.test.ts` (the card names it, today's case unchanged); the 21.16 working-team case (B's detail and day equal to before plus the name).
- Off team emptied -- `holidays.test.ts` (A's cell `offForHoliday` with no type or name, the grid and day-list labels `četvrtak 08.10., blagdan Dan sjećanja, Smjena A, blagdan`, the paper row's cell, the detail's `holidayOff: { projectedTypeName: 'Dan' }`); `today.test.ts` (today free, its shift `offForHoliday`); `admin-today.test.ts` (the week's cell, day and legend).
- Override wins -- `holidays.test.ts` (the override's type, no `offForHoliday`, the date named, no `holidayOff`).
- Personal rotation emptied -- `holidays.test.ts` (DORA's day: no shift, the holiday named).
- Manual grid -- `manual-grid.test.ts` (ANA's cell `holiday` with no type, the date head named, the month's legend list, the label `08.10., blagdan Dan sjećanja: blagdan`, an assignment on the holiday drawn as before).
- Amend to projected -- `override-erasures.test.ts` (allowed on a holiday that empties the team, the "after" holding the amend; still `sameAsProjected` on a holiday the team works, and the existing non-holiday case unchanged).

**Deviations from the Code Map, as built:**
- `holiday-mark.tsx` also exports `HolidayOffWord` (the star and *blagdan* of an emptied cell in a day list or the today card), and `month.ts` exports `MonthHoliday`, `monthHolidaysOf` and `holidayFieldOf`, shared by *Kalendar*, *Danas* and *Ručni raspored*.
- `TodayShift.offForHoliday` is added (not mapped): *Danas*' today card would otherwise name an emptied shift "no rotation".
- `Week.holidays` and `WeekDay.holiday` are read off each date's month row (`CalendarRow.holiday`), not from a second names read.
- No `danas.*` or extra `rucniRaspored.*` legend key: *Danas*' week and *Ručni raspored*'s legend reuse `kalendar.holiday.word`/`label`/`keyLine`; the one `rucniRaspored` key is `rucniRaspored.cell.holiday`. *Danas*' admin week cell puts `, blagdan {name}` in its label's date slot.
- `holiday-mark.tsx` reaches `localization-applied`'s SOURCES through `CALENDAR_SCREEN_PARTS` (`calendar-screen.fixture.ts`, which `CALENDAR_SOURCES_REQUIRED` reads; the calendar's components are also read off the folder), so `test/localization-applied.test.ts` itself is unchanged; `source-guards.fixture.ts` is unchanged (no field or button count moved). `key-sources.fixture.ts`' counts moved: Danas 109 → 114, Kalendar 233 → 240, the modifier vocabulary 8 → 9, *Ručni raspored* 129 → 136.
- `eslint.config.js`' `FEATURE_PUBLIC.calendar` gains `components/holiday-mark` (for *Danas* and *Ručni raspored*).
- There is no `grid-dates` test file; `gridDatesOf`'s names are tested in `holidays.test.ts`. `manual-grid.test.ts` imports the component's `cellLabelOf` for the label case.
- The 21.16 cases in `holidays.test.ts` that compared a holiday-with-no-team-off month, detail and day list with the holiday-free ones now set the names aside on their known paths alone (`rowsUnnamed`, `daysUnnamed`, `detailUnnamed`) and assert the name separately.
- After review pass 1: `day-detail.ts` gains `holidayOffMessageKey` (`kalendar.holiday.dayOffGroups` with a staffing group) and exports `sameTypeOf`, which `change-preview.ts` now uses; `override-erasures.ts` exports `sameTypeIdOf`; `week-grid.tsx` exports `cellName` and `calendar-grid.tsx` exports `personLabelOf` for the tests; `month.ts`' person cells carry an emptied team shift as an `offForHoliday` cell. The rotation review's same-type rule is NOT changed (see the triage log and `deferred-work.md`).
- The key lines keep `keyLine` (`{dayMonth} {name}`) visible, with the word before it `sr-only` and followed by a space.

## Review Triage Log

**Review pass 1 (2026-11-26).** Layers: blind, edge-case, verification-gap, epic AC. The unrun-DB-test layer had nothing to audit (no migration, root DB test or Edge Function changed). The epic AC auditor found no unlisted deviation.

Patched:
1. An emptied team cell with a staffing group (21.6): `renderCellName` and `CalendarLetterBox` draw the star (and *blagdan* in a day list) before the groups, and the group's letter keeps its `+` there; `cellLabelOf` keeps the `blagdan` slot before the groups; the day detail picks `{tim} ne radi na blagdan. Ručno dodijeljeni rade:` with a group (`holidayOffMessageKey`, `kalendar.holiday.dayOffGroups`). Tested in `holidays.test.ts`.
2. The rotation review's amend (`override-disposition.ts`): NOT patched. Its snapshot (`RotationSnapshot`) holds no holiday dates, so the holiday-layered rule would need the calendar snapshot's (a new read). The 21.16 deferred entry is now `RESOLVED in part (the calendar's preflight) by 21.18`, naming the review as still open.
3. `change-preview.ts`' `overridePreviewOf` and `overrideShortStaffedOf` use the day detail's `sameTypeOf`, so the projected type offered on an emptied day gets its preview. Tested.
4. *Kalendar*'s person rows: an emptied team shift is an `offForHoliday` cell, and `personLabelOf` reads `blagdan` in its slot. Tested (a member on an archived team that still projects a rotation).
5. *Danas*' free case picks the shift the holiday emptied ahead of `shifts[0]`. No fixture reaches a day whose emptied shift is not first (the own team's shift comes first), so the existing free-case test pins the result, not the ordering.
6. The key lines (*Kalendar*, *Danas*' admin week, *Ručni raspored*): the `sr-only` word is followed by a space.
7. `week-grid.tsx`' `cellName` uses `LABEL_SEPARATOR`; it and `personLabelOf` are exported, and their holiday labels are asserted (`admin-today.test.ts`, `holidays.test.ts`).
8. `holidays.test.ts` strips names only on the known paths (rows, days, the detail).
9. `admin-today.ts`' `weekOf` builds its legend through `monthHolidaysOf`.
10. `holidayNamesOfCalendar` reads `calendar.holidays` directly, its `WeakMap` declared before it.
11. `override-erasures.test.ts`: an amend to another working type and to a non-working type on an emptied holiday; `holidays.test.ts`: `sameTypeIdOf` equals the day detail's `sameTypeOf` on worked and emptied dates.
12. Pinned: a holiday on a date the off team projects Slobodno empties the cell all the same (`offForHoliday`), and the detail says `Prema rotaciji: Slobodno.`. The code is unchanged.
13. `deferred-work.md`: an `OWNER the founder (confirm)` entry for 21.18's three unattended readings; the 21.16 spec's Status line no longer says 21.17 "follows on the same branch".
14. Verification records the orchestrator's `69ef8fc` baseline (2 129 256 bytes) and the size after the patches.

Rejected: parser-guaranteed holiday-row checks, blank names, render tests, print assertions, refusal wording, mid-word wrapping.

## Suggested Review Order

**The names, apart from the rule**

- Entry point: every holiday's name by date, from `calendar.holidays`, never the rule (`{}` with no team off).
  [`snapshot.ts:935`](../../apps/web/src/features/calendar/services/snapshot.ts#L935)

- The month model carries the date's name and the emptied cell's mark, absent otherwise.
  [`month.ts:599`](../../apps/web/src/features/calendar/utils/month.ts#L599)

- Labels: `blagdan {name}` after the date, *blagdan* in an emptied cell's type slot.
  [`modifiers.ts:359`](../../apps/web/src/features/calendar/utils/modifiers.ts#L359)

**Drawing**

- The shared star plus name.
  [`holiday-mark.tsx:13`](../../apps/web/src/features/calendar/components/holiday-mark.tsx#L13)

- The paper grids' date head: the star, the name for screen readers.
  [`date-grid.tsx:151`](../../apps/web/src/components/date-grid.tsx#L151)

- The 36 px box: the star on an emptied cell, before any staffing group.
  [`calendar-cell.tsx:170`](../../apps/web/src/features/calendar/components/calendar-cell.tsx#L170)

**The day detail and the amend**

- The emptied day's sentence, with or without a working group.
  [`day-detail.ts:148`](../../apps/web/src/features/calendar/utils/day-detail.ts#L148)

- One "same type" rule for the form, the preview and the amend preflight.
  [`day-detail.ts:812`](../../apps/web/src/features/calendar/utils/day-detail.ts#L812)
  [`override-erasures.ts:140`](../../apps/web/src/features/conflicts/services/override-erasures.ts#L140)

**Proof**

- The matrix, the labels and the R13.5 guard.
  [`holidays.test.ts:1`](../../apps/web/src/features/calendar/utils/holidays.test.ts#L1)
