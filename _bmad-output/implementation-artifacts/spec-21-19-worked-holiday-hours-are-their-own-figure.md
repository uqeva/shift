---
title: '21.19 Worked holiday hours are their own figure'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: 'b59f8570d5a8c1edfce25b7b7cfc7ee779a8996d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: done. Merged with 21.18 as PR #382, squash `f0af532`, 2026-11-26, with `CI passed` green on the PR's only run (45769395192 at `81faaa6`). No rendered test or e2e draws *Sati na blagdan* (`deferred-work.md`, a later e2e pass); CI did not settle that gap. No migration. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A 24-hour crew works the holidays, and the hour report cannot say how many of its hours fell on one: R13.7 defines *holiday hours*, and nothing computes or shows them.

**Approach:** `memberHoursOfMonth` reports the minutes of each worked shift inside a holiday's civil date (R13.7), from the holiday dates on the input, and `explainMemberHours` explains them as their own figure. *Sati* (the member's figures and the organization's table) and the Excel export show *Sati na blagdan* only when the period holds a worked holiday (E-7: no setting).

## Boundaries & Constraints

**Always:**
- R13.7: a WORKED term's nominal interval (the worked half of a half day included) intersected with `[00:00, 24:00)` of every holiday date it touches: its own date and, for a shift past midnight, the next date. Leave terms, untimed shifts and non-working types add nothing. A view over Total Hours: `totalMinutes`, the bands, `unbandedMinutes`, `shiftCount` and `leaveMinutes` never change.
- `MemberHours.holidayMinutes?: number`, present only when more than 0, so every output with no worked holiday is byte-identical (R13.5). The dates are `MemberHoursInput.holidays` (21.15's `HolidayRule` list), checked as the rule checks them; a holiday after the month counts for a last-date shift running into it.
- `HOURS_FIGURE_HOLIDAY` (`{ code: 'HOLIDAY' }`): operands are the worked shifts with holiday minutes, summing to the figure.
- The web's hours input carries every snapshot holiday date (`calendar.holidays`, not `holidayRuleOfCalendar`, which is `{}` with no team off), absent with none.
- *Sati*, member: a *Sati na blagdan* figure with its ⓘ, only with holiday minutes. Organization: a *Sati na blagdan* column after *Ukupno* (cells, footer, the phone's stacked rows), shown when any row of the month (before the filters) has holiday minutes; not sortable; a row with none reads `—`.
- Excel: the same column, after *Ukupno*, present exactly when the table shows it; a duration cell per row (0 for none) and the footer's sum.
- Leave on a date a holiday emptied costs nothing (21.15's R13.4), and on a 24-hour crew's worked holiday it costs a day: verified by web tests on *Sati*'s leave column and on the leave cost the web shows for a record or request over the holiday (`features/leave`), no new code expected.

**Ask First:** none (unattended).

**Never:** no setting to hide the column (deferred by the proposal); no hours PDF (none exists: the PDF export is the change history's); no migration or snapshot change; no change to the band partition (DI-7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| R13.8 | K Dan 07–19 on holiday H; K Noć 19–07 on H−1 | 720 holiday minutes on H, 420 for H−1's Noć; totals unchanged | none |
| No holiday | `holidays` absent or `[]` | `holidayMinutes` absent; every figure as before | none |
| Holiday not worked | H, member on leave or off | absent; no column | none |
| Half day on H | first half absent | only the worked half's minutes inside H | none |
| Month end | Noć on 12-31, holiday 01-01 next year | 420 in December's figure | none |
| Explanation | the figure's ⓘ | one line per shift, summing to the figure | none |
| Export | a period with a worked holiday / without | the column with durations and footer / no column | none |
| Bad input | a holiday not a date, or twice | — | `RangeError` |

## Epic AC Deviations

- AC 2 "*Sati* and the Excel export": met; the organization's column is not sortable (the table's sort keys are unchanged).

</frozen-after-approval>

## Code Map

- `packages/domain/src/holidays.ts:20+` -- an internal `holidayDatesOf(rule)` (the checks `holidayOffOf` makes on the dates, shared by it).
- `packages/domain/src/hours.ts:255,315,426,482` -- `HoursTerm.holidayMinutes` (worked terms), computed in `walkMonth` by intersecting `[start, start+duration)` with `[0,1440)` when the date is a holiday and `[1440,2880)` when the next date (`dateOfCivilDay(civilDayNumber(date)+1)`, `calendar.ts`) is; `MemberHours.holidayMinutes?`; `HOURS_FIGURE_HOLIDAY` in `HoursFigureCode` and `explainMemberHours`; `index.ts` exports.
- `packages/domain/test/hours*.test.ts` or `holidays.test.ts` -- the matrix rows; the existing hours digests unchanged.
- `apps/web/src/features/hours/services/my-hours.ts:171,463` -- `hoursSnapshotInputOf` adds `holidays` (every `calendar.holidays` date, by date; absent with none); `MyHoursView.holiday?: HoursFigure`.
- `apps/web/src/features/hours/services/organization-hours.ts:109,144,584,616` -- `OrganizationHoursRow.holiday?`, `OrganizationHoursView.holidayColumn?: true`, `columnCount` + 1 with it, `HoursFooter.holidayMinutes?`/`holiday?`.
- `apps/web/src/features/hours/services/hours-explanation.ts:252` -- `figureNameOf` names the holiday figure (`sati.holiday`).
- `apps/web/src/features/hours/services/hours-export.ts` -- the column after *Ukupno* and the footer cell; `xlsx.ts` unchanged (it maps cells).
- `apps/web/src/features/hours/components/{hours-summary.tsx,organization-hours-table.tsx,organization-hours-rows.tsx}` -- draw them, with `ExplainButton` (`HOURS_FIGURE_HOLIDAY`).
- `apps/web/src/lib/i18n/locales/hr.json` -- `sati.holiday` (*Sati na blagdan*) and any explanation copy; the sweeps (`localization-applied` SOURCES, `key-sources.fixture.ts`, `source-guards.fixture.ts`, `test/resource-hygiene.test.ts`, structural pins).
- Tests: `my-hours.test.ts`, `organization-hours.test.ts`, `hours-explanation.test.ts`, `hours-export.test.ts` (column present/absent, durations, footer).
- Docs: spine AD-27 `Amended 2026-11-26 (story 21.19)`, R13.7's "as built" note in `engine-rules.md`, `EXPERIENCE.md` (*Sati*), `epic-21-context.md`, `sprint-status.yaml` (21.19 `review`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/{holidays,hours,index}.ts` + tests -- the figure and its explanation.
- [x] `apps/web/src/features/hours/services/*` + tests -- input, views, export, explanation.
- [x] `apps/web/src/features/hours/components/*`, `hr.json`, sweeps -- the figure and the column.
- [x] A real workbook written from a fixture with a worked holiday and read back (GENERATED FILE rule); docs and status.

**Acceptance Criteria:**
- Given no worked holiday, when every hours suite runs, then every existing assertion holds unchanged.
- Given typecheck, lint, `pnpm build`, the domain, ICS and web suites and the DB-free root tests, when run, then they pass.

## Verification

**Commands:**
- `pnpm --filter @shift/domain --filter @shift/ics build && pnpm typecheck && pnpm lint && pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/static-hosting.test.ts test/import-cycles.test.ts` -- pass.
- Not run: DB-connecting root tests, e2e, gitleaks.

**As run (2026-11-26, worktree of `feat/21-18-21-19-holidays-shown`):**
- `pnpm --filter @shift/domain --filter @shift/ics build && pnpm typecheck && pnpm lint` -- clean (exit 0).
- `pnpm build` -- clean. Entry chunk `apps/web/dist/assets/index-*.js` 2,137,874 bytes (2,135,415 after 21.18: +2,459).
- `pnpm --filter @shift/domain test` -- 27 files, 1162 tests passed (first full run, no timeout).
- `pnpm --filter @shift/ics test` -- 4 files, 35 tests passed.
- `pnpm --filter ./apps/web test` -- 202 files, 7319 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/static-hosting.test.ts test/import-cycles.test.ts` -- 5 files, 3214 tests passed.
- No CSS or token change, so the theme root files were not required. Not run: DB-connecting root tests, e2e, gitleaks (the orchestrator's).

**Generated file (GENERATED FILE rule).** A temporary, never-committed web test (removed after the run) built the pilot organization with ten members on four teams, nine of them with long hyphenated Croatian names (the longest `Aleksandra-Katarina Kovačević-Petrović-Hrvatinović` and an unbroken 45-character surname), a holiday on 2026-09-10, a half day (first half) on it for a night-shift member and a five-day leave over it for another, then wrote September 2026 through `organizationHoursOf` → `hoursExportOf` → `xlsx.ts`'s `sheetDataOf`/`columnWidthsOf` → `write-excel-file/node` (4.1.1) into a `.xlsx` in the session scratchpad (outside the repository). Read back with `uv run --with openpyxl python -I` (sheet `Sati`, 12 rows × 9 columns):
- Header: `Osoba, Tim, Smjene, Dan, Noć, Ukupno, Sati na blagdan, Godišnji odmor (dani), Čeka odluku`, bold: the column stands right after *Ukupno*.
- Rows: every Smjena A member (Dan 07–19 on the holiday) reads 12 h in *Sati na blagdan*; the Smjena B member on Noć that evening reads 5 h (19–24); the Smjena B member whose first half of that Noć is absent reads 0 h (the worked half is 01–07 the next date) with 0,5 leave; both Smjena C members (Noć the evening before) read 7 h (00–07); Smjena D reads 0 h. Every holiday cell is a number in `[h] "h"` (a duration), 0 included; *Ukupno* and the band cells are as without the holiday.
- Footer (bold): `Ukupno za prikazane osobe`, 150 shifts, … *Sati na blagdan* 67 h (4 × 12 + 5 + 2 × 7), leave 3,5 days, 0 conflicts.
- Widths 28, 20, 10, 10, 10, 10, 17, 23, 13: the holiday column is wide enough for its heading, no figure reads `####`.

**Deviations from the Code Map, as built.**
- `packages/domain/test/hours-holiday.test.ts` is a new file for the matrix rows (R13.8 with a second 24-hour team on Noć the evening before, no holiday / `[]` / an unworked one, a team off and a leave shift, the half days, the month end, the explanation, the bad input); `hours.test.ts` is unchanged.
- `holidays.test.ts`'s R13.5 guard fed holidays with no team off, which are worked holidays, so the new figure appears there by design: the guard now asserts the figure is present exactly for the rules that hold an in-window holiday and digests every other figure with `holidayMinutes` stripped, against the unchanged pre-holiday digests. Every assertion with no worked holiday holds unchanged.
- The web tests sit in `organization-hours.test.ts` (one block: the input's dates, the views, the column under a filter, the footer, the export's cells, the ⓘ through `hoursExplanationOf`, the member's own figure, and *Sati*'s leave column over an emptied and a worked holiday) and `features/leave/services/my-leave.test.ts` (the request form's cost over a holiday: 0 when the team is off, 1 when it works it). `my-hours.test.ts`, `hours-explanation.test.ts` and `hours-export.test.ts` are unchanged; no new production code was needed for the leave cost.
- `hoursSnapshotInputOf` sorts the dates (a snapshot's are already by date) so a hand-built snapshot cannot reorder the input.
- Sweeps: `hr.json` gains `sati.holiday` alone (the ⓘ reuses the existing explanation copy); `test/resource-hygiene.test.ts` sanctions it; `key-sources.fixture.ts`'s counts move (Sati 120 → 128, the export 12 → 13, the explanation 14 → 15). No new source file, so `localization-applied` SOURCES and `source-guards.fixture.ts` needed no change. No e2e or page object injects hours rows, and no parser changed.
- Not changed, deliberately: the phone's one-line footer still shows the total alone (as for the bands and leave); `change-preview.ts` reads `totalMinutes` only.

**After review pass 1 (2026-11-26):**
- `pnpm --filter @shift/domain --filter @shift/ics build && pnpm typecheck && pnpm lint` -- clean (exit 0).
- `pnpm build` -- clean. Entry chunk 2,137,893 bytes (+2,478 over 21.18's 2,135,415; +19 over pass 0, the summary ⓘ's guard).
- `pnpm --filter @shift/domain test` -- 27 files, 1164 tests passed (first full run, no timeout).
- `pnpm --filter @shift/ics test` -- 35 passed.
- `pnpm --filter ./apps/web test` -- 202 files, 7323 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/static-hosting.test.ts test/import-cycles.test.ts test/runtime-parity.test.ts` -- 6 files, 3224 tests passed. `runtime-parity.test.ts`'s Node half reads the built `dist` and opens no database or container; its edge-runtime comparison is CI's. The probe (`packages/domain/parity/probe.ts`) builds its hours input without the holiday lists, so its output carries no `holidayMinutes`, and no golden or digest of it needed a change.
- An UNDECIDED leave record over a worked holiday still counts the shift's holiday hours, as it still counts the shift in Total Hours (holiday hours are a view over the total, and a record alone moves no hour). A DECIDED one (accepted as uncovered, or replaced: a leave key) moves the shift to `leaveMinutes`, and the figure goes with it (`organization-hours.test.ts`).
- No CSS or token change: the theme root files were not required.

## Review Triage Log

**Pass 1 (2026-11-26).** Layers: blind hunter, edge-case hunter, verification-gap, Epic AC auditor; the Unrun DB Test Auditor had nothing (no DB test, migration function or Edge Function in the diff). The Epic AC auditor found no unlisted deviation.
- Patched:
  1. Domain matrix widened (`hours-holiday.test.ts`): a Noć the day before a holiday with its FIRST half absent (01–07 on the holiday, counted); an untimed working shift on a holiday and a non-working date (absent); a changed shift (`CHANGE`), a roster replacement (`REPLACEMENT`, beside a Noć operand dated the day before) and a Personal Assignment kept on a holiday its team is off for (`PERSONAL`, counted with the member's team), each with its explanation operand.
  2. The R13.5 guard pins the exact members, months and minutes carrying the figure per fixture (18 pilot, 15 UJ-5), besides digesting the rest with it stripped.
  3. Web: a Noć's ⓘ line dated by its start (11.09., 7 h before a holiday on 12.09.); a decided leave on a worked holiday removes the figure while an undecided record keeps it; `hours-export.test.ts` holds the sheet without a worked holiday equal to the pre-21.19 columns and cells (a holiday outside the month too), and with one the column right after *Ukupno*, every row and the footer as long as the header, every other cell unchanged.
  4. `holidayDatesOf` stays out of `index.ts`, marked `@internal`; `holidayOffOf`'s `@throws` points to it.
  5. The member's tile guards its ⓘ with `figureIsEmpty`, as the total does.
  6. `hoursSnapshotInputOf` documents that its dates win over the passed schedule's and equal the rule's list whenever a team is off.
  7. Docs: EXPERIENCE.md (the tile as drawn, the file's 0 h against the table's `—`, the phone footer, the ⓘ dating), the spine's 21.19 clause (one source, `calendar.holidays`; the phone footer; 0 h; the dating), engine-rules R13.7's note (a holiday on the 1st is reached from the previous month's last Noć only, DI-5).
  8. Runtime parity checked: no change needed (see Verification).
- Rejected: snapshot-shape guards for a missing, malformed or duplicate holiday (the snapshot parser already refuses them); changing the phone's one-line footer; the plain heading's styling; an AD-5 preview mention (holiday hours move no shift).
- Deferred: no rendered test or e2e draws the column, cell, footer cell, stacked field or tile (`deferred-work.md`, "Deferred from: story 21.19"; owner a later e2e pass).

## Suggested Review Order

**The domain figure**
- [`hours.ts:367`](../../packages/domain/src/hours.ts#L367) -- `holidayMinutesOf`: the intersection with the date and the next date.
- [`hours.ts:413`](../../packages/domain/src/hours.ts#L413), [`hours.ts:441`](../../packages/domain/src/hours.ts#L441) -- only worked terms carry it (half day's worked half; full shift).
- [`hours.ts:507`](../../packages/domain/src/hours.ts#L507) -- absent unless more than 0 (R13.5).
- [`hours.ts:534`](../../packages/domain/src/hours.ts#L534) -- `HOURS_FIGURE_HOLIDAY` operands.
- [`holidays.ts:52`](../../packages/domain/src/holidays.ts#L52) -- `holidayDatesOf`, shared with `holidayOffOf`.

**The web input and views**
- [`my-hours.ts:180`](../../apps/web/src/features/hours/services/my-hours.ts#L180) -- every snapshot holiday date into the input.
- [`my-hours.ts:502`](../../apps/web/src/features/hours/services/my-hours.ts#L502) -- the member's figure.
- [`organization-hours.ts:644`](../../apps/web/src/features/hours/services/organization-hours.ts#L644), [`organization-hours.ts:618`](../../apps/web/src/features/hours/services/organization-hours.ts#L618) -- the column decided before the filters; the footer.
- [`hours-explanation.ts:398`](../../apps/web/src/features/hours/services/hours-explanation.ts#L398) -- the figure's name.
- [`hours-summary.tsx:64`](../../apps/web/src/features/hours/components/hours-summary.tsx#L64), [`organization-hours-table.tsx:102`](../../apps/web/src/features/hours/components/organization-hours-table.tsx#L102), [`organization-hours-rows.tsx:141`](../../apps/web/src/features/hours/components/organization-hours-rows.tsx#L141) -- the drawing.

**The export**
- [`hours-export.ts:163`](../../apps/web/src/features/hours/services/hours-export.ts#L163), [`hours-export.ts:178`](../../apps/web/src/features/hours/services/hours-export.ts#L178), [`hours-export.ts:211`](../../apps/web/src/features/hours/services/hours-export.ts#L211) -- row cell, footer cell, heading.

**The proof**
- [`hours-holiday.test.ts:98`](../../packages/domain/test/hours-holiday.test.ts#L98) -- the matrix.
- [`holidays.test.ts:239`](../../packages/domain/test/holidays.test.ts#L239) -- the R13.5 guard with the figure pinned.
- [`organization-hours.test.ts:936`](../../apps/web/src/features/hours/services/organization-hours.test.ts#L936), [`hours-export.test.ts:557`](../../apps/web/src/features/hours/services/hours-export.test.ts#L557), [`my-leave.test.ts:1016`](../../apps/web/src/features/leave/services/my-leave.test.ts#L1016) -- views, file, leave cost.

