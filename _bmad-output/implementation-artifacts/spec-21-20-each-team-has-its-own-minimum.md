---
title: '21.20 Each team has its own minimum'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '25f38d31a74048f6c25a65a8fd5505a3818a7ea0'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: done. PR #383, squash `ebfa939`, merged 2026-11-26 with `CI passed` green (run 45780072431 at `979fb10`). CI run 1 (45777662906 at `bf7b30d`) failed `test/concurrent-writes.test.ts`' trigger inventory: the catalog reads trigger columns ordered by `attname`, so 0082's widened triggers answer `archived, minimum_members, off_on_holidays`; fixed for CI by `979fb10`. The injected `layout.spec.ts` rows carried `minimum_members: null` from the start. Every case this spec lists as unrun ran green in run 45780072431. Migration `0082`. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Short-staffed is judged against one organization-wide *Najmanje ljudi u smjeni*. The pilot's 4-person 24-hour crews, its 2-person day teams and its 1-person *Jutarnji* team cannot share one number: the pilot set none, so nothing is ever flagged.

**Approach:** Migration 0082 adds `teams.minimum_members` (nullable, `>= 1`, AD-27). The domain's `minimumOf(input, teamId)` gives a team's own minimum, else the organization's (R10.2 as amended, E-1), and every staffing derivation reads it. The browser carries each active team's minimum into the one staffing input, so every surface (save blocks, calendar marks and day line, *Danas*, the resolution strip, the AD-5 previews of holidays and staffing groups) follows. The team dialog gains *Najmanje ljudi* (UX-DR79) on its own save, checked first.

## Boundaries & Constraints

**Always:**
- `teams.minimum_members smallint`, nullable, no default, `teams_minimum_members_check (>= 1)`; `authenticated` gains UPDATE on it alone under 0009's policy; 0035's two teams triggers re-created `before update of archived, off_on_holidays, minimum_members`. No function, policy or assembly change; nothing seeded (DI-8); nothing notifies (E-3).
- Domain: `StaffingInput.teamMinimums?` (team id → whole number from 1) and exported `minimumOf`. Each short shift (Scheduled Shift or staffing group, R14.6) carries its team's minimum. No minimum anywhere: nothing. A bad team minimum throws a `RangeError` naming the team. Absent or `{}`: byte-identical.
- Web: `TeamRow.minimumMembers` required on every teams read (`TEAMS_COLUMNS`), so `DEVICE_SNAPSHOT_SHAPE` 8; `teamMinimumsOfCalendar` (active teams only, `undefined` for none) spread into `staffingInputOf` only when present; `staffingAppliesOf` replaces every `minimumOfCalendar(…) === null` gate.
- The team dialog's minimum write (founder's instruction, AD-5 amended): fresh core reads; erasures from today (none can arise; one derived answers unavailable); *Što se mijenja* lists the shifts made short and those cleared, today + 366 days. Shown only when there is something to show; otherwise written at once. Never blocks.
- Resolution cards of a Personal Shift's conflict counted with a team show coverage against the team's minimum, the replace card being the cover's assignment applied (21.7's deferral).

**Ask First:** none (unattended; choices in Design Notes).

**Never:** no change to the organization's minimum card; no minimum in `member_schedule_inputs`, the feed or reminders; no "never flag" state; no team-list column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No team minimum | every team `null` | every output byte-identical; staffing input has no `teamMinimums` key | N/A |
| One-person team | org 3, *Jutarnji* 1, one at work | *Jutarnji* never short; crews still against 3 | N/A |
| Org empty, team set | org `null`, team 3 | only that team's shifts are judged; others nothing | N/A |
| Raise creates short | team 4, 3 at work | preview lists the shift; *Spremi* saves | changed preview shown again |
| Lower clears short | team 1, 2 at work (was 3) | preview lists it under *Više nemaju premalo ljudi* | N/A |
| No effect | change makes/clears nothing | written at once, status line | N/A |
| Bad entry | `0`, `2.5`, `1e1`, text, `32768` | field refused before any read | 23514 `teams_minimum_members_check` → field |
| Stale / refused | team archived or gone / 42501 | stale / refused line, nothing written | zero rows → stale |

## Epic AC Deviations

- "the team dialog … *Najmanje ljudi* … saves (`>= 1`, audited)": met. Narrowed in one respect, widened in another: the save is its own button (*Spremi najmanje ljudi*), not the rename's *Spremi*, and it runs AD-5's check, which the planning (AD-5 2026-11-25) exempted, on the founder's instruction to this build. The spine's AD-5 carries the amendment.
- "every save block, calendar mark and the Danas card uses each team's minimum": met. *Danas*'s calm line names one number only when every active team is held to the same one, else `Nijedna smjena ovaj tjedan nema premalo ljudi.` (reinterpreted: a single number would be false).
- "With no team minimum set, the output is byte-identical": met for every short-staffed read, with ONE listed exception. A Personal Shift's conflict counted with a team now shows coverage on its resolution cards whenever any minimum applies, the organization's alone included, where 21.7 shipped `staffing: null`. That is 21.7's deferral, addressed to this story, answered: the cards gain figures they lacked.
- The instruction that the team minimum's save runs AD-5's check is the founder's, relayed by the orchestrating session in this story's build brief (2026-11-26), not a planning decision; the spine's AD-5 amendment cites it. Founder confirmation at review is welcome.
- Not in the epic but asked: the organization's own minimum card keeps no preview (deferred, `deferred-work.md`).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0082_team_minimum_members.sql` -- the column, grant, triggers.
- `packages/domain/src/staffing.ts` -- `teamMinimums`, `minimumOf`, `checkMinimum(input)`, `shortStaffedOf` per team; `index.ts` exports `minimumOf`.
- `apps/web/src/features/teams/services/list.ts` -- `TEAMS_COLUMNS`, `TeamRow.minimumMembers`, `teamRowOf` (missing or bad value refuses the row). Mappers reading teams: `calendar/services/snapshot.ts` (via `teamRowOf`, changed), `rotation/services/list.ts` (embeds `TEAMS_COLUMNS`, changed by the constant), `schedule-inputs.ts` (left: the assembly carries no minimum), `holiday-check.ts` (left: spreads the row), `lib/offline/persistence.ts` (shape 8).
- `apps/web/src/features/calendar/services/snapshot.ts` -- `teamMinimumsOfCalendar`, `staffingAppliesOf`.
- `apps/web/src/features/calendar/utils/month.ts` -- `staffingInputOf` spreads the team minimums.
- Gates swapped to `staffingAppliesOf`: `staffing/services/short-staffed.ts` (also `coverageAgainstMinimumOf` reads `minimumOf`), `calendar/services/marks.ts`, `calendar/utils/change-preview.ts`, `rotation/services/erasures.ts`, `members/services/{loan,team-move-preview,deactivation-consequence}.ts`, `conflicts/services/resolution-screen.ts`, `today/services/admin-today.ts` (+ calm minimum).
- `apps/web/src/features/conflicts/services/resolution-screen.ts` -- `assignedCoverageOf`, `resolutionStaffingOf(…, form)`.
- `apps/web/src/features/teams/{services/minimum.ts,hooks/use-team-minimum.ts,components/team-minimum.tsx}` -- the field, check, preview and write; composed by `team-edit-body.tsx`; ids in `utils/element-ids.ts`.
- `apps/web/src/features/today/components/short-staffed-card.tsx` -- `calmEach`.
- Catalogs: `test/{provisioning,concurrent-writes,supabase-scaffold,rls-isolation,resource-hygiene,localization-applied}.test.ts`, `pages/{source-guards,key-sources}.fixture.ts`, `screens-sweep.test.ts`, `team-screens.fixture.ts`, `eslint.config.js` (`organization/utils/minimum-members` public to teams). `name-key` not relevant (no name).
- E2E: `e2e/tests/calendar/layout.spec.ts` (injected rows carry `minimum_members: null`), `calendar-short-staffed.spec.ts` (new case), `e2e/pages/teams.page.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Migration 0082 and its scaffold, provisioning, concurrent-writes and rls-isolation cases (unrun DB cases).
- [x] Domain rule and tests (`packages/domain/test/staffing.test.ts`, both fixtures).
- [x] Web reads, gates, input recipe, coverage, *Danas* calm line, persistence shape.
- [x] Team dialog part with check, preview, write; `hr.json`; key/screen sweeps.
- [x] 21.7 deferral: Personal Shift conflict coverage.
- [x] E2E case under the rotation hold; layout injection fixed.
- [x] Spine AD-5 and AD-27 amended; DESIGN.md, EXPERIENCE.md, UX-DR79, epic context, sprint status, deferred-work.

**Acceptance Criteria:**
- Given a team with its own minimum, when any short-staffed surface reads it, then the team is judged against its own and every other team against the organization's.
- Given no team minimum, when any surface derives, then its output is what it was before (the listed resolution-card exception aside).

## Design Notes

1. `teamMinimums` is a record of only the teams that set one, so "absent" means "use the organization's"; a team archived later keeps its value but is never read (`teamMinimumsOfCalendar` takes active teams).
2. The minimum's part is its own set (`TEAM_MINIMUM`), exempt from the edit form's one-field sweeps, with its own latch: rename, archive, flag and minimum are different columns, each serialized by 0035's lock. It takes the edit body's write gate, so the dialog has one offline note.
3. Preview window: today + 366 days (`horizonWindowOf`), as other open-ended changes; past dates change too (AD-2) and are said, not listed.
4. Cleared shifts come from `newlyShortStaffedOf(after, before)` and are listed without counts.
5. A Personal Shift's replace card adds a `SHIFT` assignment for the cover (a placeholder member before a pick), then reads `peopleAtWorkOn` of the collision's type: the domain decides, no arithmetic here. Teamless shifts have no team and so no minimum.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- pass.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/import-cycles.test.ts` -- pass.
- No CSS or token change: theme root files not required.
- Not run locally (STRICT DATABASE RULE, LOCAL E2E STOP RULE): the new `rls-isolation`, `provisioning` and `concurrent-writes` cases and the e2e case; CI is their first run, so "built" is not "verified" until CI is green.
- `test/supabase-scaffold.test.ts`'s migration-contiguity case failed before the rebase onto 21.7 (0081 missing) and passes on it.
- One full `@shift/web` run under load (five reviewers running) failed `today.test.ts` "finds a shift exactly on the horizon"; it passed alone and in every other full run (timing, unrelated to this diff).
- Gitleaks: not run by this subagent; the orchestrator scans before the push.

## Review Triage Log

Five layers (blind, edge-case, verification gap, Epic AC auditor, unrun DB test auditor). No intent_gap or bad_spec; patches applied, re-verified.

- patch: *Natrag* lost what was typed (the form unmounted under the preview) — the form stays mounted, hidden; focus moves to the preview heading.
- patch: the hint read the organization snapshot without subscribing — `useQuery(organizationSnapshotQueryOptions)`.
- patch: a preview *Spremi* whose fresh check is `unchanged` showed an empty "changed" preview — written (nothing sent) instead.
- patch: a null field ref read as "empty" (clearing the minimum) — returns; the invalid entry is refused before the latch (focus kept).
- patch: a failed re-read after a landed save reseeded the old value — the landed value seeds the form.
- patch: the write named no tenant — `.eq('organization_id', fresh reads' own)`.
- patch: preview lede said "od sada" against the past-dates note; preview save renamed *Spremi najmanje ljudi* (no second *Spremi* beside the rename's); `calmEach` scoped to each team's minimum; saved line clears on edit and describes the field; `TeamMinimumRefusal` narrowed; `anyMinimumOf` reads only the teams asked for.
- patch (tests): surfaces with the organization's minimum empty and a team's own set (day detail, deactivation, team move, leave save); a Personal Shift conflict under the organization's minimum alone; a still-short shift whose minimum moves is not previewed; a minimum of a team not asked for.
- patch (spec): the resolution-card exception to byte-identical listed; the founder instruction's source named.
- defer: closing the dialog while the minimum's check or write is in flight (see `deferred-work.md`).
- defer: the *Danas* calm line's `calmEach` branch is asserted on the model, not rendered (no component render harness; an e2e step owed).
- defer: the e2e covers the preview path only (no-effect save, clearing to empty, invalid entry, *Natrag*, changed preview, archived line).
- reject: behavioural lock/re-check cases for the new column (the trigger catalog pins it as 0080's flag was); deploy-order guard (the documented `db push` then SPA order, as 0080); the owner-run check refusal (the CHECK binds every role).
