---
title: '21.6 Personal shifts are read wherever shifts are read'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: 'fdedebc56c57f98141093cc97605a74d4cb9eb60' # built on b2e32d1 (#369 21.4, #370 21.21); rebased onto #371 (21.12, 0078) before review and onto #372 (21.5) before push; the hot files (hr.json, the sweep pins, use-manual-schedule.ts) start from those merges
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-4-an-admin-plans-the-month-in-rucni-raspored.md'
---

Status: done. PR #374, squash `d09fffb`, merged 2026-11-25 with `CI passed` green (run 45698249225 at `f985d2c`). The first CI run (45695288965 at `8dbde2a`) failed one e2e case in shard 3 (`people/leave` cost, `toHaveCount`), passed on the rebased push with no fix of its own; the day detail's missing rotation steps were fixed after the merge by #375 (`7ddc632`). Set `done` and this line written by story 21.8.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.1 derives Personal Shifts and 21.4 writes them, but the web readers built before them skip a shift counted with no team (`teamId: null`), and read only a team's Scheduled Shift. A student's Saturday is missing from *Moj raspored*, *Danas* and the person filter. A day team with no rotation reads as having no shift, though its staffing groups are working. The hours explanation is unavailable for a teamless shift. The member page has no way to give one person one shift.

**Approach:** Read every Personal Shift through the domain's existing answers (`memberScheduleOfMonth`, `personalShiftOn`, `staffingOn`, `peopleAtWorkOn(…, type)`), and mark it as assigned (UX-DR73). Add *Dodaj smjenu* to the member page as the grid's single-cell case: it opens *Ručni raspored* on that member and date with the picker open, so the same picker, check and save write one assignment.

## Boundaries & Constraints

**Always:**
- A Personal Shift shows its type, its time and its counted team, or *bez tima*. It is marked assigned: a pencil glyph, `ručno` in the text, and `dodijeljeno ručno` in the accessible name.
- Day list (*Moj raspored*, the *Osoba* filter, and *Danas*, which reads it): a teamless shift is a row of its own. It is not a button, because a day detail is a team on a date. A shift counted with a team opens that team's day.
- Team grid cell: the Scheduled Shift as before. Each staffing group (another working type among the Personal Shifts counted with the team, `staffingOn`) is added to the cell with its letter or name and a pencil. Its label names it. A team with no rotation but a group shows the group.
- Day detail: a member whose Personal Shift counts with the team in the day's working type is on *Sastav*, marked `ručno`. Each group is its own section (type, range, people, staffing line through `peopleAtWorkOn(…, type)`). A no-rotation or off day still shows its groups.
- Admin *Danas* coverage reads the groups as rows too. Resolution coverage reads the collision's own type.
- Hours explanation: a teamless line reads `bez tima`, with the source *osobni raspored*. Excel export columns are unchanged.
- Loan preview and the roster overlap hint read teamless shifts.
- *Dodaj smjenu* (admin, member page): a date, then `/rucni-raspored?mjesec&osoba&dan`. The grid opens the picker on that cell once, then drops `dan` from the URL. A member with no row that month gets an alert, not a picker.
- Every word in `hr.json`; key and hygiene sweeps, `localization-applied` SOURCES and the structural pins updated. DESIGN.md/EXPERIENCE.md record the marks.

**Ask First:** none (unattended; the decisions are in Design Notes).

**Never:**
- no migration or RPC change, and no snapshot shape change;
- no collision with no team in *Za odluku*, its erasure or its resolution (21.7), and no swap of a Personal Shift (21.8);
- no change to the calendar's layout (21.25 transposes it), and no seventh modifier: the assigned mark is a cell field;
- no change to the history, which 21.4 built (AC 3's history clause is met).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student, no team | assignment *Dan* on Saturday | *Moj raspored* row `Dan · ručno · bez tima`, not a button; *Danas* names *bez tima* | none |
| Counted with team | crew member, *Dan* counted with Tim B | the day list row opens Tim B's day; Tim B's detail lists them under *Dan · ručno* | none |
| Day team, no rotation | 3 assignments *Dan* with Tim C | Tim C's cell shows *Dan* with a pencil; the detail shows the group, `rade 3 od najmanje N` | none |
| Same type as rotation | assignment *Noć* with Tim A on Tim A's *Noć* | on *Sastav*, marked `ručno`; no group | none |
| Hours | teamless *Dan* worked | the line reads `bez tima · Dan (osobni raspored)`; never unavailable | none |
| Dodaj smjenu | member page, 2026-12-06 | grid at 2026-12, picker on that cell; *Spremi* writes one item | the member has no row that month: alert |

## Epic AC Deviations

- AC 2 "the same picker and save as the grid write one assignment": *Dodaj smjenu* opens the grid on that one cell with the picker open, rather than a dialog inside the member page. The picker, the check, the erasure confirmation and the write are then the grid's own, not a copy. Reinterpreted.
- AC 1 "marked as assigned (UX-DR73)": *osobna rotacija* has no data until 21.9, so a Personal Shift reads `ručno`. The rotation word is 21.10's (deferred-work, the existing 21.10 entry).
- AC 3 "the change history words assignment events from codes, grouped per member and save": built by 21.4. Not changed here.
- AC 1 "the team grid … marked as assigned" *(added by the review, 2026-11-25)*: a Personal Shift of the team's own scheduled type adds no group, so its grid cell shows the Scheduled Shift unmarked. The grid names a team's shift, not its people; the member is on *Sastav*, marked `ručno`, in the day detail. Reinterpreted.
- AC 1 "Danas" *(added by the review)*: admin *Danas*'s week grid draws its own cells from the Scheduled Shifts and shows no staffing group yet. The coverage card, the today card, the week list and the duty block do read Personal Shifts. DEFERRED (`deferred-work.md`, the 21.6 week-grid entry).
- AC 1, conflict marks *(added by the review)*: a collision with no team marks no calendar cell and is not in the day detail's conflicts. It is 21.7's (`deferred-work.md`, the 21.1 entries, still open). Deferred.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/utils/month.ts` -- `CalendarCell` gains `assigned` and `groups`; `CalendarDayShift.teamId: string | null`; `calendarDayListOf` drops the `hasTeam` filter at :1147; member marks key by a nullable team; grid cells add `staffingOn` groups (`staffingInputOf`, leave `[]`, the type ids only).
- `apps/web/src/features/calendar/utils/modifiers.ts` -- `cellLabelOf` gains the assigned word and the group parts; `dayListLabelsOf` names a teamless shift *bez tima*.
- `apps/web/src/features/calendar/components/{calendar-cell,calendar-day-list,calendar-legend}.tsx` -- the pencil, the `ručno` word, the group lines, the teamless row, the legend entry.
- `apps/web/src/features/calendar/utils/day-detail.ts` -- `DayDetailMember.assigned?`, `DayDetail.groups`; `personalShiftOn` over `snapshot.members`; `rosterOverlapOf` (:1007) reads teamless legs. `components/day-detail-dialog.tsx` draws them.
- `apps/web/src/features/staffing/services/short-staffed.ts` -- `coverageAgainstMinimumOf`/`dayStaffingOf` take an optional type. `conflicts/services/resolution-screen.ts` passes `collision.shiftTypeId`.
- `apps/web/src/features/today/services/{today,admin-today,today-duty}.ts` + components -- a nullable team (`bez tima`), group coverage rows.
- `apps/web/src/features/hours/services/hours-explanation.ts` -- `namesOf` (:200) reads `bez tima`.
- `apps/web/src/features/members/services/loan.ts` (`workingOf` :525) + `member-loan-dialog.tsx` -- a nullable team.
- `apps/web/src/features/planning/hooks/use-manual-schedule.ts`, `pages/rucni-raspored.tsx` -- `?dan=` opens the picker once.
- `apps/web/src/features/planning/components/member-add-shift-card.tsx` -- NEW; `pages/ljudi.$id.tsx` mounts it.
- `hr.json`, `pages/key-sources.fixture.ts`, `pages/source-guards.fixture.ts`, `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, structural pins -- keys and pins.
- Docs: DESIGN.md, EXPERIENCE.md, `deferred-work.md` (resolve the 21.6 reader entry and the snapshot entry, answer the 21.4 leave-in-grid entry), `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `calendar/utils/month.ts`, `modifiers.ts` + tests -- day list, assigned mark, groups, labels (matrix rows 1–3).
- [x] `calendar/utils/day-detail.ts` + dialog + tests -- *Sastav* marks, groups, staffing per group, overlap legs.
- [x] `staffing`, `conflicts`, `today` services + tests -- typed coverage, group rows, teamless *Danas*.
- [x] `hours-explanation.ts`, `loan.ts` + tests -- `bez tima`.
- [x] `planning` hook, page, new card, member page + tests -- *Dodaj smjenu*.
- [x] `hr.json`, sweeps, pins; docs; deferred-work; sprint status.

**Acceptance Criteria:**
- Given no Personal Assignment, when any surface renders, then its output is unchanged (every existing test passes as it was).
- Given the domain, web and DB-free root suites, typecheck, lint and build, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended, the 21.4 precedent): three deviations were added to the frozen `## Epic AC Deviations` at the epic AC auditor's finding: the same-type grid cell, admin *Danas*'s week grid, and teamless conflict marks. Each was already the code's choice and had a deferred-work entry or owner; listing them changes no intent. No intent_gap and no bad_spec, so no loopback. KEEP: the domain answers as the only source (`staffingOn` for groups, checked equal to the detail's), the assigned mark as a cell field, *Dodaj smjenu* as the grid's own cell.

- 2026-11-25, CI on the pushed branch: e2e `people.spec.ts:597` (both widths) and `leave.spec.ts:260` failed on `mainForms` having a count of 1: the *Dodaj smjenu* card mounted its date form on the member page, against story 7.11's rule that each change on that page opens its own dialog and no form is mounted outside one. The card is now a header button (*Dodaj smjenu*) that opens a dialog holding the date, *Odustani* and *Odaberi smjenu*; the form renders only while the dialog is open. Pins: the member edit form 218 strings, 18 fields, 46 buttons; two keys (`rucniRaspored.addShift.cancel`, `.close`). `member-directory.spec.ts:50` (waiting for the team region) also failed; the directory's code is untouched by this story (it reads the members list, not the calendar's day list), and the same test has failed and passed on retry on other branches, so it is read as flaky. KEEP: the hand-off to the grid's own picker.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC. The unrun DB test auditor had nothing to audit: no DB test, migration function or Edge Function changed.
- The branch was rebased onto #371 (21.12) before review; the only conflicts were the pin counts in `key-sources.fixture.ts` and `source-guards.fixture.ts`.
- intent_gap: 0. bad_spec: 0 (three deviations listed). patch: 11 groups. defer: 0 new (the week grid was already logged). Rejected: 6.
- Patched: the off/no-rotation sentence over a working group (and admin *Danas* listing such a team as off); roster overrides offered on `ručno` members; `dodijeljeno ručno` missing from unlabelled cells; the duty block's mark; the `?dan=` hand-off (waits for a fresh read, never while saving, inactive date, the alert cleared and worded generically); a repeatable React key; a short group with no mark on a no-rotation cell; a lent assigned member's mark; duplicated constant and import order; tests for grid/detail group agreement, typed resolution coverage, swaps through an assignment, the swap control, the groups legend, the teamless loan preview and duty leg, and the stricter row 2 and overlap cases.
- Rejected: admin coverage keying replacements by team (AD-4's key is member, date and team; an assigned member is off the base roster); a member on *Sastav* and in a group at once (R14.9 makes such an override inert); one shared "bez tima" key (cosmetic); hiding *Dodaj smjenu* for an inactive member (a seasonal member may be active later; the grid says so); a teamless coverage row on *Danas* (R14.6: a teamless shift joins no staffing); the window decision as a founder question (asked by the orchestrator; it changes nothing before 2028 and is reported for confirmation).

## Design Notes

1. **The snapshot window (deferred-work, 21.2's entry, answered).** Decided: the read is bounded to assignments dated on or after 1 January of the previous calendar year in the organization's zone. That keeps the leave year, last year's hours and their export. At 35 people that is at most about 25 months, roughly 27 000 rows and 6 MB. Building it needs a migration (`calendar_personal_assignments` takes no argument) and an explicit "older months not loaded" state on *Kalendar*, *Sati* and the export. A cut snapshot would otherwise show an old month's rotation as if no assignment existed. No row can fall outside the window before 2028-01-01, since the pilot's first assignments are dated 2026-12. So the build is deferred, with that date as its deadline (deferred-work, owner: a story before 2028). 0078 is 21.12's (merged as #371), so the build takes the next free number then.
2. **Leave in the grid (21.4's entry).** Not taken here. It is a grid change that touches 21.5's files in flight, so it stays with 21.7, as its entry allows.
3. **Assigned is a cell field, not a modifier.** The five modifiers are rings, hatches and an edge, pinned by the typography proof. An assignment is a source, and it is drawn as the grid draws it (`PencilSimple`). The legend adds one entry for it.
4. **Groups come from `staffingOn`** with no leave (`staffingInputOf(snapshot, [])`), so the cell names the types and never counts people. The day detail's group roster is `personalShiftOn` over the active members, ordered by name, as *Sastav* is.

## Design Notes (as built)

5. **Absent means unchanged.** `CalendarCell.assigned`, `CalendarCell.groups`, `DayDetailMember.assigned`, `DayDetail.groups`, `TodayShift.assigned` and `CoverageRow.groupTypeId` are ABSENT (never `false` or `[]`) when there is nothing to say, so every existing whole-object assertion holds as it was. A grid row's cells are `CalendarTeamCell` (`teamId: string`); only a day list's cell may have `teamId: null`.
6. **Groups are asked only on a date some member holds an assignment** (`staffingGroupsOf`), so a month with none calls `staffingOn` nowhere and its type letters are unchanged.
7. **A Personal Shift is never a swap** here (`swapOfferedOf`, `swap-proposal.ts`'s `works`): an assigned member on *Sastav* is skipped, as 21.8 owns that swap.
8. **`?dan=`** is read once per member and date (a ref), then replaced out of the URL; a date outside the month, or a member with no row, raises the alert (`singleCellOf`). The card's route is `{ mjesec: monthOf(dan), osoba, dan }` (`addShiftSearchOf`).
9. **Words.** `kalendar.cell.{assigned,assignedShort,noTeam,noTeamShown}`, `kalendar.legendAssigned`, `kalendar.detail.group`, `rucniRaspored.addShift.*`, and (review) `kalendar.detail.{offGroups,noRotationGroups}`. The hours line reuses `sati.organization.noTeamWord`.
10. **Review pass 1 as built.** An off or no-rotation day with a group says its rotation gives no shift (`dayNotWorkingMessageKey`), and admin *Danas* lists such a team in its group rows only, never also as off or with no rotation. A member on *Sastav* through an assignment is neither taken off nor put on by a roster override (`rosterOffersOf`). A no-rotation cell with a group carries its marks (a short group is short-staffed). An assigned member shows a loan's `posudba iz tima` as a rotation member would. A cell outside a labelled button (*Danas*'s week list) adds `dodijeljeno ručno` for a screen reader; one inside does not double it (`labelled`). A duty leg from a Personal Shift is marked (`DutyLegNote.assigned`). `?dan=` waits for a fresh read and no save in flight, an inactive date is the alert too, and the alert clears on a person, a picker or a save; its copy says the person has no day to edit there. `NO_GROUP_STAFFING` is one constant (`short-staffed.ts`). The non-grid branch of a cell's group is kept: the phone's team list (`CalendarTeamDays`) draws grid cells outside the grid.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck && pnpm lint && pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/feature-boundaries.test.ts test/localization-applied.test.ts` -- pass; theme files if `index.css` changes.
- Not run locally: DB suites and e2e (STRICT DATABASE RULE); CI is the gate.

**Results (2026-11-25, after review pass 1, rebased on `e1b6a65`):** `pnpm --filter @shift/domain build`, `pnpm typecheck`, `pnpm lint` and `pnpm build` exit 0. Domain: 23 files, 1042 tests. Web: 194 files, 7103 tests (story 21.6's: `calendar/utils/personal-shifts.test.ts`, `today/services/personal-shifts.test.ts`, `planning/services/single-cell.test.ts`, the I/O matrix's six rows and the review's cases). DB-free root files `resource-hygiene`, `supabase-scaffold`, `feature-boundaries`, `localization-applied` (after `pnpm build`): 3048 tests. All pass. `index.css` and no theme token changed, so the theme root files do not apply. e2e was grepped for the member page's labels and counts and for the day list's, day detail's and coverage card's words: no spec asserts what changed (no e2e fixture holds a Personal Assignment).

**Results on the final base (2026-11-25, rebased on `fdedebc`, #372 21.5, before push):** the conflicts were the pin counts (*Ručni raspored* destination strings 120), `element-ids.ts`, `use-manual-schedule.ts` (21.5's fill and copy state beside the `?dan=` effect, both kept), `localization-applied` SOURCES, DESIGN.md and the status files. `pnpm typecheck`, `pnpm lint`, `pnpm build` exit 0. Domain: 24 files, 1073 tests. Web: 196 files, 7148 tests. DB-free root files (the four above): 3095 tests. All pass. Gitleaks is the orchestrator's; not run here.

**Residual risks:**
- No DB, e2e or perf run locally (STRICT DATABASE RULE). CI settled the DB and e2e jobs: green on run 45698249225 (PR #374). No migration or RPC changed. Perf was never run (it runs in no CI job).
- Admin *Danas*'s week grid draws no group: a deferred-work entry (story 21.6's section).
- The member page's card and the grid's `?dan=` opening are checked by their pure halves (`single-cell`, `manualSearchOf`), the structural pins and typecheck; no render or e2e drives the hand-off.

## Suggested Review Order

**The calendar month: day list and grid cells**

- Entry point: the day list keeps teamless Personal Shifts and marks each one assigned.
  [`month.ts:1202`](../../apps/web/src/features/calendar/utils/month.ts#L1202)

- A team cell's staffing groups, straight from the domain's `staffingOn`.
  [`month.ts:1496`](../../apps/web/src/features/calendar/utils/month.ts#L1496)

- Labels name `dodijeljeno ručno` and each group; the legend gains the pencil.
  [`modifiers.ts:346`](../../apps/web/src/features/calendar/utils/modifiers.ts#L346)

- The pencil, `ručno` and `bez tima`, with sr-only words only where no label names them.
  [`calendar-cell.tsx:57`](../../apps/web/src/features/calendar/components/calendar-cell.tsx#L57)

**The day detail**

- Personal Shifts counted with the team, by member, with their type.
  [`day-detail.ts:316`](../../apps/web/src/features/calendar/utils/day-detail.ts#L316)

- Groups of other working types, also on off and no-rotation days.
  [`day-detail.ts:363`](../../apps/web/src/features/calendar/utils/day-detail.ts#L363)

- An assigned member keeps a loan mark and is never offered to a roster override.
  [`day-detail.ts:903`](../../apps/web/src/features/calendar/utils/day-detail.ts#L903)

**Staffing, Danas, hours, loans**

- Coverage takes the shift's own type (resolution strip, group lines).
  [`short-staffed.ts:354`](../../apps/web/src/features/staffing/services/short-staffed.ts#L354)

- Admin coverage rows per group; a group-only team is not listed as off.
  [`admin-today.ts:721`](../../apps/web/src/features/today/services/admin-today.ts#L721)

- A duty leg from an assignment: `bez tima` and the mark.
  [`today-duty.ts:207`](../../apps/web/src/features/today/services/today-duty.ts#L207)

- The hours explanation reads `bez tima` instead of failing.
  [`hours-explanation.ts:205`](../../apps/web/src/features/hours/services/hours-explanation.ts#L205)

- The loan preview reads teamless shifts.
  [`loan.ts:526`](../../apps/web/src/features/members/services/loan.ts#L526)

**Dodaj smjenu**

- The member page card hands one date to the grid.
  [`member-add-shift-card.tsx:20`](../../apps/web/src/features/planning/components/member-add-shift-card.tsx#L20)

- The one cell to open, or why none can be.
  [`single-cell.ts:29`](../../apps/web/src/features/planning/services/single-cell.ts#L29)

- The grid opens its own picker once after a fresh read, then drops `dan`.
  [`use-manual-schedule.ts:186`](../../apps/web/src/features/planning/hooks/use-manual-schedule.ts#L186)

**Peripherals**

- The matrix rows over a pilot fixture with assignments.
  [`personal-shifts.test.ts:1`](../../apps/web/src/features/calendar/utils/personal-shifts.test.ts#L1)

- *Danas* with a teamless shift and a teamless duty leg.
  [`personal-shifts.test.ts:1`](../../apps/web/src/features/today/services/personal-shifts.test.ts#L1)
