---
title: '21.5 Popuni uzorkom and Kopiraj fill a range'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: 'a5cf067' # main after #369 (21.4); the hot file hr.json and the sweep pins start from 21.4's merge
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-4-an-admin-plans-the-month-in-rucni-raspored.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** *Ručni raspored* (21.4) edits cells one selection and one value at a time. Alternating weeks such as the founder's `1. smjena ×5, Slobodno ×2, 2. smjena ×5, Slobodno ×2` must be clicked in day by day, and last week or last month cannot be repeated.

**Approach:** Add two pure rules to `domain/personal` (AD-26 as amended): `filledAssignmentsOf(steps, offset, memberIds, from, to)` and `copiedAssignmentsOf(source, targetStart, members)`. Both return the items a save would write, and neither is stored as a rule. The screen gets two dialogs. *Popuni uzorkom* takes step rows (a shift type or *Slobodno*, × a count), *Počni od koraka*, the people and Od/Do. *Kopiraj* takes *Tjedan* or *Mjesec*, a source, a target start and the people. Both put their items into the 21.4 draft, so each cell is previewed, stays editable, and is saved by the one *Spremi* flow.

## Boundaries & Constraints

**Always:**
- The pattern is a cycle of days: steps expanded by their counts (length L). The cell `from + i` takes the expanded day `(offset + i) mod L`. *Počni od koraka* picks that 0-based day, shown 1-based with the step's name. Every chosen member gets the same offset.
- A `SHIFT` step counts with the member's own team (`teamId: null`, R14.3). `OFF` is *Slobodno*. Fill offers only active types.
- Copy reads the "after", the live rows with the draft applied (`draftAppliedOf`). It copies only assignments (kind, type, counted team). A source date with none becomes a *clear* of its target. Source and target overlapping is fine: every item comes from the source as it was before the copy.
- *Tjedan* is 7 days from a source date to a target date. *Mjesec* is a source month into a target month, `min(source length, target length)` days from each month's first day.
- **An archived or unknown type or team is left out first** (the 21.2 deferral): that item is not drafted, and the cell keeps what it had. A status line counts the cells put into the draft and the cells left out. An item equal to the live row leaves the draft (`draftWith`'s rule).
- Range ≤ 366 days, at least one person, at least one step with a type, counts are whole numbers 1–366. A copy whose target equals its source is refused. Each refusal is shown in the dialog by field. Nothing is drafted then.
- People: a checkbox list of the shown month's rows. It is pre-checked from the selection's rows (on a phone, the person shown). Od/Do are pre-filled from the selection's dates, else the shown month.
- The dialogs work on every width. They are opened from `PageToolbar`'s controls from 640 px, and from a row above the day list on a phone.
- The e2e owed by 21.4 (deferred-work) is written: a fill and a week copy of a teamless student saved through *Što se mijenja*, an `OFF` over a queued conflict through the erasure dialog, and a 22023 answer that keeps the draft and re-reads, after which the save lands.
- Copy is in `hr.json`, with the key and hygiene sweeps, DESIGN.md/EXPERIENCE.md/UX-DR74 as built, and `test/localization-applied.test.ts` SOURCES for each new screen file.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no migration or RPC change; no stored pattern or rule; no per-member stagger of the offset; no counted team other than own in a fill; no fill/copy of notes; no grid component made screen-specific (21.25 reuses `manual-grid.tsx`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Founder pattern | 2 people, 1.–28., steps A×5, Slobodno×2, B×5, Slobodno×2, offset 0 | 56 draft cells: days 1–5 A, 6–7 OFF, 8–12 B, 13–14 OFF, repeating | none |
| Offset | same, offset 7 | 1. is B | none |
| Week copy | source week has 3 assignments and 4 empty days | 3 sets plus 4 clears at the target (clears of an empty live cell leave the draft) | none |
| Archived | a source cell's type is archived | that target is left out; the line says `1 preskočen` | none |
| Month copy 31 → 30 | Oct → Nov | 30 days copied | none |
| Invalid | no person / Do < Od / > 366 days / empty step | field refusal, draft unchanged | in-dialog alert |
| Save | after a fill | *Spremi* → preview → one RPC | 21.4's |

## Epic AC Deviations

- AC 1 "selected members and a date range": the people come from a checkbox list pre-checked from the grid's selection, so they need not be contiguous rows. Reinterpreted.
- AC 1 "a start offset": one offset for every chosen member, picked as a day of the expanded cycle. A different offset per member is two fills. Narrowed.
- AC 2 "assignments only are copied" *(added by the review, 2026-11-25)*: a source assignment naming an archived or unknown shift type or team is not copied. Its target keeps what it had and is counted as left out on the save bar, because 0077 would refuse the whole save over it (the 21.2 deferral). Narrowed.
- AC 2 "a source week or month and a target start" *(added by the review)*: *Mjesec* takes a target month and copies from each month's first day, `min(source length, target length)` days. *Tjedan* takes any target date. Reinterpreted.

</frozen-after-approval>

## Code Map

- `packages/domain/src/personal.ts` (+ `index.ts`, `test/personal-fill.test.ts`) -- NEW `PatternStep`, `PlannedValue`, `PlannedAssignment` (`{memberId, date, set: {kind, shiftTypeId, teamId} | null}`), `PlannedMember`, `MAX_PLANNED_DAYS` 366, `patternDaysOf`, `filledAssignmentsOf`, `copiedAssignmentsOf` (checks each member's assignments). Dates via `checkDate`/`civilDayNumber`/`dateOfCivilDay` (`calendar.ts`). RangeError on any breach (AD-8).
- `apps/web/src/features/planning/services/manual-fill.ts` (+ test) -- NEW, pure. `plannedDraftOf(snapshot, draft, items)` → `{draft, placed, skipped}` (placed: cells the draft now holds a change for; skipped: an archived or unknown type or team, or a member the read lacks). `filledDraftOf`/`copiedDraftOf` (forms checked field by field: `PlannedRefusal`, the `REFUSED_*` constants, `PLAN_FAILED`), `copyRangeOf` (week, month), `cycleDaysOf`/`isStepCount`, `mondayOf`, `plannedDefaultsOf(rows, dates, selected, phonePerson)`, `plannedRefusalMessageKey`.
- `apps/web/src/features/planning/services/manual-grid.ts` -- `weekdayOf` exported (`isWeekend` reads it).
- `apps/web/src/features/planning/hooks/use-manual-schedule.ts` -- `planning` (`ManualPlanning`, `PLAN_FILL`/`PLAN_COPY`) and `planned` state; `openPlanning(kind, onPhone)`, `closePlanning`, `fill`, `copy` through one `plan()`.
- `apps/web/src/features/planning/components/manual-fill-dialog.tsx`, `manual-copy-dialog.tsx`, `manual-people-field.tsx`, `manual-plan-buttons.tsx` -- NEW; `manual-save-bar.tsx` -- the placed and skipped lines; `apps/web/src/pages/rucni-raspored.tsx` -- the buttons in the toolbar, a row above the phone's day list, both dialogs.
- `apps/web/src/features/planning/utils/element-ids.ts` -- the dialogs' ids; `planning.fixture.ts` -- an archived team.
- `apps/web/src/lib/i18n/locales/hr.json` (`rucniRaspored.fill.*`, `.copy.*`, `.plan.*`), `test/resource-hygiene.test.ts`, `apps/web/src/pages/key-sources.fixture.ts` (118 and 26 strings), `source-guards.fixture.ts` (the files; 11 fields, 18 buttons), `test/localization-applied.test.ts` SOURCES.
- `e2e/tests/planning/rucni-raspored.spec.ts` NEW, `e2e/pages/manual-schedule.page.ts` NEW, `e2e/utils/database-helper.ts` (a read-only `personalAssignmentsOfInSql`) -- unrun (CI).
- Docs: DESIGN.md/EXPERIENCE.md/epics UX-DR74 as built, the AD-26 spine clause (Amended 21.5), `deferred-work.md` (RESOLVED: the 21.2 archived entry; in part: the 21.4 e2e entry; new entries), `sprint-status.yaml` (21.4 done, PR #369 squash a5cf067; 21.5 review), and the 21.4 spec's status and residual risks.

## Tasks & Acceptance

**Execution:**
- [x] domain rules + tests (every matrix row at the domain level).
- [x] `manual-fill.ts` + tests (archived skip, refusals, month lengths, overlap).
- [x] hook, dialogs, page, `hr.json`, the sweeps.
- [x] e2e spec, page object, SQL read helper.
- [x] docs, spine clause, deferred-work, sprint status, 21.4 spec status.

**Acceptance Criteria:**
- Given selected people and a range, when *Popuni* runs, then the grid shows the drafted cells marked changed, each cell can be re-edited with the picker, and *Spremi* sends them in one call.
- Given a copy whose source names an archived type, when it is applied, then that cell is not drafted and the line counts it as left out.
- Given the domain, web and DB-free root suites, typecheck, lint and build, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended, the 21.1 and 21.4 precedent): two deviations were added to the frozen `## Epic AC Deviations` at the epic AC auditor's finding: an archived item is not copied (AC 2), and *Mjesec* copies from each month's first day (AC 2). Each was already the spec's Always rule and the code's choice; listing them changes no intent. The Code Map was rewritten to the names as built (`placed`, `copyRangeOf`, `planning`, `plan()`, `rucniRaspored.plan.*`); the matrix's `1 preskočen` stands for the skipped line as `hr.json` words it. No intent_gap, no bad_spec, so no loopback. KEEP: items go into the 21.4 draft only, archived items are left out first, one offset for all.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 5). The unrun DB test auditor has nothing to audit: no DB test, migration function or Edge Function changed.
- intent_gap: 0. bad_spec: 0 (two deviations listed, see the change log). patch: 13. defer: 3. Rejected: 7.
- addressed_findings:
  - `[high]` `[patch]` On the grid, a fill or copy with no selection pre-checked the first row (the phone's person fallback ran at every width), so a fill would take in someone never chosen and the new e2e would fail. The fallback is the phone's only (`plannedDefaultsOf(…, phonePerson)`, `openPlanning(kind, onPhone)`), unit-tested, and the e2e asserts nobody is pre-checked (verification-gap).
  - `[medium]` `[patch]` `placed` counted items that left the draft (equal to the live row, a clear of an empty cell), so the bar said more days were unsaved than it counted. It now counts the cells the draft holds a change for (blind, edge-case, verification-gap).
  - `[medium]` `[patch]` A chosen person the read lacks was dropped from a copy silently; their days are counted as left out, and the skipped line's words name that case (edge-case, blind).
  - `[medium]` `[patch]` A refusal's alert stayed after the fix: any edit in either dialog clears it; a count's `aria-invalid` marks only the bad rows; the people's `aria-invalid` is on the checkboxes, not the fieldset (blind).
  - `[medium]` `[patch]` An offset kept across a step edit pointed at another step: changing, adding or removing a step resets *Počni od koraka* (edge-case, blind).
  - `[low]` `[patch]` A step type archived by a re-read while the dialog is open is refused as no choice, never skipped day by day (edge-case).
  - `[low]` `[patch]` A count written `1e2`, `0x10` or `+5` is refused (`isStepCount`, digits only) (edge-case).
  - `[low]` `[patch]` *Mjesec* named both the mode and the source: the source is *Izvorni mjesec* (blind).
  - `[low]` `[patch]` The placed line clears on a month or phone-person change, and a failed re-read closes an open fill or copy (edge-case).
  - `[low]` `[patch]` `copiedAssignmentsOf` checks each member's assignments, as its comment says (blind).
  - `[low]` `[patch]` A range at the calendar's very end reads as a bad range, not too long (edge-case).
  - `[low]` `[patch]` The e2e drives a refusal in the dialog (same source and target) and checks that the fill's line goes with the save (verification-gap).
  - `[low]` `[patch]` The key-sources comment's sum and the Code Map's names (blind).
  - `[low]` `[defer]` A draft over 0077's 5 000 items, or outside its year window, is refused only at *Spremi* (blind). See `deferred-work.md`.
  - `[low]` `[defer]` The people are the shown month's rows, with no *select all* or whole-team choice (blind). See `deferred-work.md`.
  - `[low]` `[defer]` No component test renders the two dialogs or the hook (verification-gap). See `deferred-work.md`.
  - Rejected:
    - "`plannedDraftOf` bypasses `draftWith`": it applies the same `sameAsLive` rule in one pass; `draftWith` copies the map per call, quadratic over a 10 000-cell fill. Design Note 1 is reworded.
    - "The e2e cleanup may fail": `removeSeededRotation` deletes the `personal_assignments` naming its types (21.2), `removeLeaveMemberInSql` the member's.
    - "Fill may offer archived types": it uses `pickableTypesOf`, which leaves them out.
    - "`'steps'` cannot happen through the UI": it is the pure function's guard; the dialog keeps at least one row.
    - Sprint status and spec status differ while in review: set as the story leaves review.
    - "Record 21.5 on the 21.4 archived-pointer entry": that entry is about a picker edit archived meanwhile, which is unchanged.
    - "Clear the placed line when a re-read prunes the draft": the line reports the last fill or copy; the count beside it is the draft's.

## Design Notes

1. **Items, not rules.** Both functions return a `PlannedAssignment` per member and date. The web turns each into a `ManualValue` (`null` → `MANUAL_CLEAR`) and drafts it by `draftWith`'s rule (`sameAsLive` drops a cell equal to the live row) in one pass, so the draft stays 21.4's one source of truth.
2. **Archived first, in the web.** The domain knows ids only. `plannedDraftOf` checks each `SHIFT` item against the snapshot's `types`/`teams` (`archived`, or missing) before it is drafted. 0077 would refuse the whole batch over one such item (21.2 DN3), so it never reaches the draft. This answers deferred-work's 21.2 entry, "leave out or warn": both, left out and counted.
3. **Week source is any date.** No Monday snapping: the admin picks the start, defaulted to the Monday of the selection's first date (with none, of the month's first) and the target a week later. *Mjesec* defaults to the shown month into the next.
4. **Pre-checked people** are the selection's rows; on a phone with no selection, the person shown; on the grid with none, nobody (review).
5. **Job roles (coordinator, 2026-11-25).** 21.12 re-owned "each member's job role beside the name, and a *Posao* filter with Ljudi's `?posao=`" to 21.5 if small once it lands. 21.12 (#371) had not merged when 21.5 was pushed, so it is a `deferred-work.md` entry owned by 21.25, which groups the transposed calendar by job role and needs the roles anyway.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck && pnpm lint && pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/feature-boundaries.test.ts` -- pass.
- Not run: e2e and DB suites (rules); CI is the gate.

**Results (2026-11-25, after review pass 1, rebased on `b2e32d1`, #370):** `pnpm --filter @shift/domain build`, `pnpm typecheck` (apps, e2e, smoke, perf) and `pnpm lint` exit 0; `pnpm build` exit 0. Domain: 24 files, 1069 tests. Web: 190 files, 7045 tests. DB-free root files `resource-hygiene`, `supabase-scaffold`, `localization-applied`, `feature-boundaries`: 3037 tests. All pass. `index.css` and no theme token changed, so the theme root files do not apply. The matrix rows are covered by `personal-fill.test.ts` and `manual-fill.test.ts` (both ran).

**Residual risks:**
- The new e2e (`e2e/tests/planning/rucni-raspored.spec.ts`, three tests), its page object and its SQL read helper were written unrun (STRICT DATABASE RULE, no local e2e); CI is their first run. The 22023 case stubs the write with `page.route`, as `conflict-resolution.spec.ts` does.
- The dialogs' wiring is checked by typecheck, the sweeps and the e2e only (deferred-work).
- Gitleaks is the orchestrator's; not run here.
- Process note: as in 21.1, 21.2 and 21.4, the implementation ran in the orchestrating session (its investigation was in context), not in a fresh step-03 subagent. Review ran with four context-free subagents.

## Suggested Review Order

**Items into the 21.4 draft, archived left out first**

- Entry point: every fill and copy item drafted by `sameAsLive`, archived or unknown counted out.
  [`manual-fill.ts:134`](../../apps/web/src/features/planning/services/manual-fill.ts#L134)

- Copy reads the grid's "after" (draft applied); a missing person counts as left out.
  [`manual-fill.ts:288`](../../apps/web/src/features/planning/services/manual-fill.ts#L288)

- Week from any date; a month into a shorter one for its length.
  [`manual-fill.ts:254`](../../apps/web/src/features/planning/services/manual-fill.ts#L254)

**The pure rules (AD-26 as amended)**

- The pattern as a cycle of days, entered at the offset on the first date.
  [`personal.ts:287`](../../packages/domain/src/personal.ts#L287)

- Assignments only; a source day with none plans a clear.
  [`personal.ts:317`](../../packages/domain/src/personal.ts#L317)

**The screen**

- Defaults: the selection's people; the phone's person only on a phone.
  [`use-manual-schedule.ts:232`](../../apps/web/src/features/planning/hooks/use-manual-schedule.ts#L232)

- One `plan()` for both dialogs: a refusal stays in the dialog, an outcome closes it.
  [`use-manual-schedule.ts:256`](../../apps/web/src/features/planning/hooks/use-manual-schedule.ts#L256)

- The fill dialog: steps, the offset reset on any step edit, refusals cleared on edit.
  [`manual-fill-dialog.tsx:71`](../../apps/web/src/features/planning/components/manual-fill-dialog.tsx#L71)

- The copy dialog: *Tjedan* or *Mjesec*, the people.
  [`manual-copy-dialog.tsx:78`](../../apps/web/src/features/planning/components/manual-copy-dialog.tsx#L78)

**Peripherals**

- The owed e2e: fill, copy, refusal, archived skip, erasure, 22023 kept draft.
  [`rucni-raspored.spec.ts:103`](../../e2e/tests/planning/rucni-raspored.spec.ts#L103)

- Unit tests of the matrix rows, over the planning fixture.
  [`manual-fill.test.ts:1`](../../apps/web/src/features/planning/services/manual-fill.test.ts#L1)

- Domain tests of the founder's pattern, offsets and copy edges.
  [`personal-fill.test.ts:1`](../../packages/domain/test/personal-fill.test.ts#L1)
