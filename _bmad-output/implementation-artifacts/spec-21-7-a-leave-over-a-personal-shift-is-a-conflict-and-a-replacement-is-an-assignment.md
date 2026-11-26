---
title: '21.7 A leave over a personal shift is a conflict, and a replacement is an assignment'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '69ef8fc631ed39f2db6567fa1bf6af7e61bee874'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-6-personal-shifts-are-read-wherever-shifts-are-read.md'
---

Status: review, built, CI pending (no PR yet; branch `feat/21-7-teamless-conflicts`). Baseline: `main` at `69ef8fc` (21.16/21.17 merged, `0080`). Migration `0081`. Touches `hr.json` (hot): the parallel 21.18/21.19 story has no migration; rebase on conflict. Run unattended (the coordinator's brief): both checkpoints self-approved, decisions in Design Notes.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.1 made a leave over a working Personal Shift a collision (`teamId` may be null), but the web drops teamless ones in five places, `conflict_resolutions.team_id` is `not null`, and Replace Member only puts someone on a team's roster by override. So a student's or a dispatcher's leave is silently uncovered, the grid shows no leave, and 21.4 only warns.

**Approach:** Migration `0081`: `team_id` nullable under a `NULLS NOT DISTINCT` live key; Replace Member's second form `personal_assignment_id`; `resolve_with_personal_assignment(p_items)` writes the replacements' assignments (through 0077's save) and the resolutions in one transaction; removing the assignment ends the resolution (trigger). The web lists, resolves, marks and guards every collision, opens a teamless one at `/za-odluku/…/bez-tima`, replaces a Personal Shift by assignment, and the grid draws leave.

## Boundaries & Constraints

**Always:**
- Teamless keys: one live decision per `(member, date, team)` incl. null; 0038's supersede and every key match null-safe.
- Second form: `replace_member` names exactly one of override / assignment (re-stated check). It counts while the snapshot holds the assignment and it gives its member a Personal Shift on the date, of the stored type, counted with the key's team; an assignment the snapshot lacks is unknown (counts, re-read), as an override.
- `resolve_with_personal_assignment(p_items jsonb)`: lock, active admin (42501 `CONFLICT_REPLACEMENT_REFUSED`), 1–366 items of exact shape (22023 `CONFLICT_REPLACEMENT_INVALID`), absent ≠ replacement (23514), key not decided (23505 `CONFLICT_RESOLUTION_EXISTS`), replacement holding another `SHIFT` that date (23505 `CONFLICT_REPLACEMENT_TAKEN`; an equal one reused, an `OFF` replaced); the assignments through `save_personal_assignments` (one `SCHEDULE_ASSIGNED` per replacement per call); P0002 off leave; answer the resolution ids.
- A Personal Shift's collision (team or none) is replaced by assignment; a team rotation shift's stays the override form. Teamless candidates have no effective team that date.
- A decision on a Personal Shift is compared (0038) with the member's own shift that date, not the team's rotation.
- RLS: no new policy or table; new functions in both provisioning inventories; e2e cleanups delete resolutions naming an assignment first; copy in `hr.json` with the catalogs.

**Ask First:** none (unattended).

**Never:** no DB-connecting test, e2e or `supabase` command run locally; no change to `save_personal_assignments`; swaps (21.8), floater suggestion (21.13) and whole-leave cover UI (21.14) are out.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teamless listed | student's teamless Dan over leave | *Za odluku* row `… · bez tima`, link `/bez-tima` | — |
| Accept / amend | teamless key | resolved / handed to the leave card, as a team's | — |
| Replace by assignment | cover with no team | cover's `SHIFT` assignment + resolution, one call, one notice | taken → `taken` line |
| Assignment changed | cover's type changed or cleared in the grid | resolution ended in the same save; conflict open again | — |
| Cover on a team | assignment counts with their team | resolution does not count; key held | — |
| Erasure | change removes an unresolved teamless conflict | listed, named `bez tima` | — |
| Grid | member on leave | cell hatched, `odsutnost` in its name | leave unknown: none drawn |

## Epic AC Deviations

- AC 3 "accept-uncovered and amend-leave … behave as for a team shift": narrowed in one figure, recorded after review (the coordinator ran this story unattended): the three cards of a Personal Shift's conflict (team or none) show no coverage against the minimum (`staffing: null`, the shipped terms), because `coverageAgainstMinimumOf` is a team rotation shift's figure. The decisions themselves behave as a team shift's. DEFERRED (`deferred-work.md`, "Deferred from: story 21.7", owner 21.20 or 21.13).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0081_teamless_conflicts.sql` -- NEW: nullable team, live key NULLS NOT DISTINCT, `personal_assignments_organization_id_id_key`, `conflict_resolutions.personal_assignment_id` (+ FK, index, re-stated `conflict_resolutions_replacement_linked`), 0038's trigger re-created null-safe, `private.end_resolution_with_assignment()` + `personal_assignments_end_resolution`, `public.resolve_with_personal_assignment(jsonb)`, `my_conflict_resolutions()` + `personal_assignment_id`.
- `packages/domain/src/collisions.ts` -- `CollisionResolution.teamId: string | null`. `history.ts` -- `personal_assignment_id` hidden (bookkeeping).
- `apps/web/src/features/conflicts/services/resolutions.ts` -- parse null team and the second link; `ReplacementLink` skips it. `replacement-effect.ts` -- `personalShiftCountedWith`, `assignmentStandingIn`, personal 0038 comparison, unknown assignment links. `conflicts-queue.ts` -- `unresolvedOf` all collisions; `NO_TEAM_PARAM`, `teamParamOf`, `teamIdOfParam`. `resolution-screen.ts` -- `shiftOfCollision`, `REPLACE_BY_ASSIGNMENT`, `replaceForm`, `teamId`, null team name, no-team coworker keys. `resolution-write.ts` -- `resolveWithPersonalAssignment(client, items, held)` (21.13/21.14's write). `erasures.ts`, `resolved-conflicts.ts` -- teamless rows.
- `apps/web/src/features/calendar/utils/replacement-candidates.ts` -- `assignmentCandidatesOf` (shared grouping). `utils/month.ts` -- member cell marks read teamless collisions.
- `apps/web/src/features/leave/services/leave-conflicts.ts`, `hours/services/hours-conflicts.ts` -- filters dropped. `leave/services/leave-section-base.ts` -- a teamless member with assignments or a schedule version is scheduled (the screen's balance). `leave-section-handoff.ts` -- null origin team.
- `apps/web/src/features/planning/services/manual-preview.ts` -- `newConflictsOf` (every team; the 21.4 line now says *Za odluku* lists it). `manual-grid.ts` -- `ManualCell.onLeave`, `manualLeaveOf`; `hooks/use-manual-schedule.ts` reads leave; `components/manual-grid.tsx`, `pages/rucni-raspored.tsx` -- hatch, label, legend.
- Links: `conflicts-list.tsx`, `needs-you-card.tsx`, `day-detail-dialog.tsx`, `use-conflict-resolution.ts`, `pages/za-odluku.$memberId.$date.$teamId.tsx`; components naming `bez tima`.
- Tests/catalogs: `teamless-conflicts.test.ts` (NEW), resolutions/manual-grid/manual-preview/screen tests, `key-sources.fixture.ts`, `resource-hygiene`, domain collisions/personal/history tests; DB, unrun: `provisioning` (grantees + definers, FKs, check, indexes, column privileges), `rls-isolation` (my_conflict_resolutions shape, four cases), `concurrent-writes` (lock list); e2e `database-helper.ts` (cleanups, `seedPersonalAssignmentInSql`, `conflictResolutionsOfInSql`), `rucni-raspored.spec.ts` (one case).
- Deliberately left: `calendar/utils/day-detail.ts` `dayConflictsOf` (a team's day detail; a teamless day detail is the 21.25 deferral), `swaps/services/swap-proposal.ts` (21.8), `replace_conflict_member` (never called with no team).

## Tasks & Acceptance

**Execution:**
- [x] `0081` and the DB catalogs, cases written unrun.
- [x] Domain widening, history column; their tests.
- [x] Web: parse, effect, queue, screen, write, candidates, erasures, resolved list, marks, leave/hours, links, copy.
- [x] Grid leave; 21.4's line updated.
- [x] e2e helpers, cleanups and one case.
- [x] Spine AD-4 `Amended 2026-11-26 (story 21.7)`; epic context; DESIGN/EXPERIENCE; `deferred-work.md` entries marked; sprint status `review`.

**Acceptance Criteria:**
- Given no Personal Assignment, when the suites run, then every collision, resolution and pinned digest is unchanged.
- Given typecheck, lint, build, the domain/ICS/web suites and the 35 DB-free root files, when run, then they pass.

## Spec Change Log

### 2026-11-26 — review pass 1 (no bad_spec loop)

- The Epic AC auditor found AC 3's unlisted narrowing (no minimum figures on a Personal Shift's cards); it is listed above rather than re-derived, as the code matched the deferral already written. KEEP: the decisions' behaviour.
- Two RPC rules were tightened as patches, not spec changes: an equal live `SHIFT` already naming another live decision is `CONFLICT_REPLACEMENT_TAKEN` (one assignment is never two covers), and a note alone keeps a decision (Design Note 4).

### 2026-11-26 — CI run 1 on the pushed branch (`ba70a3a`)

- The Vitest database job failed the whole 21.7 block and 21.2's `save_personal_assignments` cases with 42702 `column reference "old.organization_id" is ambiguous`: `private.relink_resolution_to_assignment()` aliased `personal_assignments` as `old`, which in a trigger function is also the OLD record, and the trigger fires on every insert, so every save failed; e2e shard 4 failed downstream (the grid's save). Fixed in `0081` (never applied anywhere): the alias is `removed`. New DB-free guard in `test/supabase-scaffold.test.ts`: no plpgsql body in any migration aliases a relation `old` or `new`, and no plpgsql variable declared from 0081 on is named after a table column (both pass on every migration; the alias rule fails on the pushed `0081`).

### 2026-11-26 — CI run 2 on the pushed branch (`1cf0051`)

- The database job was green. e2e shard 4 failed `rucni-raspored.spec.ts` (story 21.7): after a teamless cover was saved, *Za odluku* showed no status line. The save landed, but `resolutionSavedOf`, which reads the decision back from router state, refused a saved fact whose `teamName` is `null`, so the queue had nothing to announce. Fixed: it reads `null` as no team, which the line then says as *bez tima*, and still refuses any other type. Unit tests in `teamless-conflicts.test.ts` round-trip a teamless replacement and a teamless acceptance through the state and pin the line's text with the cover's name. The flaky `answer-swap.spec.ts:165` in the same shard is outside this story.

### 2026-11-26 — rebased onto 21.18/21.19 (`f0af532`, #382)

- Conflicts resolved by keeping both sides: *Ručni raspored*'s cell carries 21.18's `holiday` and 21.7's `onLeave`; the day detail imports both; `resource-hygiene` holds both cell keys; `key-sources.fixture.ts` counts *Danas* 115 and *Ručni raspored* 138 (21.18's and 21.7's strings); `deferred-work.md` keeps both stories' sections. No migration from 21.18/21.19, so `0081` stays the next number. After the rebase: build, typecheck and lint clean; web 203 files, 7349 tests; ICS green; domain green (two digest tests timed out at 5 s under load in the full run and passed alone); the 35 DB-free root files, 5613 tests.

## Review Triage Log

### 2026-11-26 — Review pass 1

- Layers: blind, edge-case, verification-gap, epic AC, unrun DB test (5 of 5), each a context-free subagent over the diff against `69ef8fc`.
- intent_gap: 0. bad_spec: 0. Epic AC: AC 1 and 2 met, AC 3 partly (listed above, deferred).
- patch (applied):
  - `[high]` `[patch]` provisioning's sorted FK list had the new key out of order; it would fail in CI (unrun DB test auditor).
  - `[medium]` `[patch]` A note alone on the cover's assignment ended the decision (0077 replaces the row): `private.relink_resolution_to_assignment()` (AFTER INSERT) restores and re-points it when the save inserts an equal `SHIFT` in the same transaction (blind, edge-case).
  - `[medium]` `[patch]` One assignment could cover two absences through the reuse path: refused as `CONFLICT_REPLACEMENT_TAKEN` (blind, edge-case); a decision linked to nothing now raises `CONFLICT_REPLACEMENT_INVALID` instead of a raw 23514 (blind).
  - `[medium]` `[patch]` A team-counted Personal Shift off the team's roster with no matching group made the screen unavailable: its roster is built as the teamless one (edge-case).
  - `[medium]` `[patch]` A teamless erasure read "bez tima taj dan bez …": it names the member's *osobni raspored* (blind, edge-case, verification gap).
  - `[low]` `[patch]` The dead date filter in `newConflictsOf`; the leave hatch over an inactive hatch (the inactive one wins, both named); the no-team coworker lines lost a doubled "isto"; `heldByReplacement`'s cheap early return restored; the write's form decided once (`replaceWriteOf`); a misplaced JSDoc and import order in tests.
  - `[medium]` `[patch]` Tests that could not fail: the team-keyed Personal Shift decision (0038 reads the member's own shift), the hand-off origin with no team, *Odlučeno*'s teamless row and its cover's name, `unknownReplacementLinksOf` for an assignment, the write dispatch; DB cases for an `OFF` replaced, an equal shift reused and never twice, one notice per cover, a note alone keeping the decision, and the null-safe supersede (verification gap).
- defer: 7 (deferred-work.md, "Deferred from: story 21.7").
- reject: the "bez tima" word borrowed from `kalendar.*` (the established practice, as *Danas*), the e2e helper not proving the snapshot read (the e2e asserts the grid and *Za odluku* read it), the hook's import order (lint is clean), the repeated-key reopening on a type change (0038's rule, not this story's).

## Design Notes

1. **Which form.** The shift decides: the absent member's own Personal Shift that date, of the collision's type, counted with its team (`personalShiftCountedWith`) is replaced by assignment; anything else (a rotation or override shift) by override, as before. A teamless shift has no roster an override could join.
2. **Built for 21.13/21.14.** `resolveWithPersonalAssignment` and the RPC take a list (≤ 366, a leave's longest range) with an optional note per item, and the save notifies each replacement once per call. `assignmentCandidatesOf` is the eligible list 21.13 narrows by role and freedom; 21.14 calls the RPC once over the covered dates.
3. **Teamless cover.** An assignment with no team counts with the replacement's effective team (R14.3), so only a member with none that date can cover a teamless shift; a member with a team gets the collision's team written explicitly when the key has one.
4. **Lifetime by trigger.** An AFTER UPDATE of `removed_at` on `personal_assignments` ends the linked resolution, so 0077's save stays unchanged and every writer (grid, fill, copy, 21.8's swap) ends it the same way. A note alone is no change of cover: an AFTER INSERT trigger restores the decision onto the equal row the same save inserts (matched on the transaction's `now()`), unless its key was decided again meanwhile.
5. **Leave balance.** A teamless member with assignments or a schedule version was "unscheduled" for the leave card; the resolution screen needs the balance, so such a member is now scheduled (their leave costs, R14.5).
6. **Held hint.** A key held by an unapplied assignment says the shared "Ukloni je u kalendaru" line; the assignment is removed in *Ručni raspored*. Recorded as a deferral.

## Verification

**Commands:** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test`, and the 35 DB-free root files by name.

**Run 2026-11-26 (before review):** build, typecheck and lint clean; domain 26 files, 1156 tests; ICS 4 files, 35 tests; web 203 files, 7310 tests; the 35 DB-free root files, 5603 tests (theme files included; no CSS or token changed).

**Run 2026-11-26 (after the review patches):** build, typecheck and lint clean; web 203 files, 7315 tests (`teamless-conflicts.test.ts` 20); domain and ICS unchanged since the run above; the 35 DB-free root files pass (the theme files and `localization-applied` after a fresh `pnpm build`).

**Not run locally (STRICT DATABASE RULE):** `0081` was never applied. The `provisioning` (inventories, keys, check, indexes, privileges), `rls-isolation` (the `my_conflict_resolutions` shape and six cases), `concurrent-writes` (the lock entry) cases and the e2e case (`rucni-raspored.spec.ts`, story 21.7) run first in CI.

## Suggested Review Order

**The stored decision (0081)**

- Entry point: one writer for the replacement by assignment, through 0077's save, refusals first.
  [`0081_teamless_conflicts.sql:296`](../../supabase/migrations/0081_teamless_conflicts.sql#L296)

- A teamless key is one key: the live index NULLS NOT DISTINCT.
  [`0081_teamless_conflicts.sql:62`](../../supabase/migrations/0081_teamless_conflicts.sql#L62)

- The lifetime: removal ends the decision; a note alone restores it onto the equal row.
  [`0081_teamless_conflicts.sql:205`](../../supabase/migrations/0081_teamless_conflicts.sql#L205)

**Whether a decision still counts (browser, AD-4)**

- The second form counts while the assignment gives its member that shift, counted with the key's team.
  [`replacement-effect.ts:247`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L247)

- 0038's comparison reads the member's own Personal Shift, not the team's rotation.
  [`replacement-effect.ts:215`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L215)

- Every collision, teamless ones included, through the one funnel.
  [`conflicts-queue.ts:425`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L425)

**The resolution screen**

- The shift decides the form: a Personal Shift by assignment, a rotation shift by override.
  [`resolution-screen.ts:756`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L756)

- One dispatch of the write.
  [`resolution-screen.ts:213`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L213)

- Who may cover by assignment: the list 21.13 narrows.
  [`replacement-candidates.ts:191`](../../apps/web/src/features/calendar/utils/replacement-candidates.ts#L191)

- The list write 21.14 calls over a leave's dates.
  [`resolution-write.ts:266`](../../apps/web/src/features/conflicts/services/resolution-write.ts#L266)

**The grid draws leave**

- The organization's leave, by member, or none when unknown.
  [`manual-grid.ts:338`](../../apps/web/src/features/planning/services/manual-grid.ts#L338)

**Peripherals**

- The new web suite for the story.
  [`teamless-conflicts.test.ts:1`](../../apps/web/src/features/conflicts/services/teamless-conflicts.test.ts#L1)

- DB cases, unrun: the RPC, the lifetime, the refusals, the live key.
  [`rls-isolation.test.ts:1`](../../test/rls-isolation.test.ts#L1)

- e2e: the grid's leave, *Za odluku*'s teamless row and a cover by assignment.
  [`rucni-raspored.spec.ts:1`](../../e2e/tests/planning/rucni-raspored.spec.ts#L1)
