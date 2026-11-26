---
title: '21.13 Floaters are suggested for an uncovered shift, by role'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '8c23b400cbbcf2db23e7b2b279bb435127a43e89'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: done. Merged with 21.14 as PR #387, squash `b1959e0`, 2026-11-26, with `CI passed` green (run 45838771823 at `b9f4254`). CI run 1 (45834966836 at `ddd31af`) failed e2e shard 2 on `history.spec.ts:137` (the PDF-failure case): the shared e2e organization's history had reached 2,078 rows, past the export's 2,000-row limit, so the export refused before loading the writer; fixed for CI by `b9f4254` (narrowed to the fixture's team). `kalendar-na-mobitelu.spec.ts:58` (a 502) and `layout.spec.ts:224` failed in that run and passed on retry, with no fix. Every `0084` case this spec lists as unrun (provisioning, rls-isolation, concurrent-writes, `floater-suggestions.spec.ts`) ran green in run 45838771823. Migration `0084`. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A leave that uncovers a shift leaves the admin to scan every candidate by hand. The pilot's floaters (students who cover gaps) and the jobs each may cover are recorded nowhere, so *Za odluku* cannot offer them (R16.1–R16.3, UX-DR77).

**Approach:** Migration `0084` adds `members.is_floater` and `floater_roles` (admin-only), and tightens 0081's cover RPC. `domain/floaters` decides R16.2 (eligible, active, free, ordered). The member page gains a *Zamjena* card with a dialog (and *Timovi i raspored*'s people rows a button to it). Every resolution screen lists *Predložene zamjene* first; a pick is written as 21.7's replacement by assignment.

## Boundaries & Constraints

**Always:**
- `0084`: `members.is_floater boolean not null default false` (UPDATE granted on the column; 0023/0035's members lock and re-check widened to `update of is_floater, role`). `floater_roles(organization_id, id, member_id, job_role_id, created_by, created_at)`: composite keys to `members` and `job_roles` (no cascade), `unique (organization_id, member_id, job_role_id)`, RLS with three policies (select, insert, delete) for an active admin through `current_member_access()`, none reading its own table; insert pins `created_by`; grants select, insert (organization_id, member_id, job_role_id), delete; TRUNCATE revoked from every role; the lock and the re-check; AD-3's two audit triggers. Nothing seeded, nothing notifies, no AD-5 guard.
- `resolve_with_personal_assignment` re-created (same signature and grants): an item whose replacement is inactive that date is 23514 `CONFLICT_REPLACEMENT_INACTIVE`; a teamless item whose replacement has a team or a live loan that date is 23514 `CONFLICT_REPLACEMENT_ON_TEAM` (the 21.7 deferral). No plpgsql alias `old`/`new`, no variable named after a column.
- R16.2 in `packages/domain/src/floaters.ts`: eligible (absent has no role, or the floater lists it), not the absent member, active, no at-work shift on d, no leave of any type covering d, no shift on d−1 or d+1 leaving a zero (or negative) rest gap with the uncovered shift; ordered by at-work shifts in d's month, then the given (name) order. Ids and counts only. A per-floater standing (free, inactive, working, on leave, rest gap) is exported for 21.14.
- The suggestions are the domain's list narrowed to 21.7's `assignmentCandidatesOf` (never widened). A suggested pick writes `resolveWithPersonalAssignment` with one item counted with the collision's team, for a team rotation shift too (R16.3); any other pick keeps the collision's form.
- No floater in the organization: every screen is as before.

**Ask First:** none (unattended).

**Never:** a floater or role in `member_schedule_inputs`, the snapshot, the feed or reminders; a suggestion that assigns by itself; DB-connecting tests, e2e or `supabase` commands run locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Suggested | absent *Dispečer*; floater A lists it, free; B lists it, 3 shifts this month; A 1 | *Predložene zamjene*: A · 1 smjena, B · 3 smjene, first; neither in the other groups | — |
| No role | absent has no role | every free floater | — |
| None | absent *Čistačica*, no floater lists it | `Nema slobodne zamjene za posao Čistačica.` | — |
| Not free | floater on leave, working d, or a Noć ending as the shift starts | not suggested | — |
| No floaters | organization has none | no block | — |
| Pick saved | suggested floater picked on a rotation shift | one cover assignment counted with the team + resolution, one notice | taken → `taken` line |
| Direct RPC | teamless item, cover on a team / inactive | refused | 23514 named codes |
| Held by assignment | cover's assignment no longer applies | `Ukloni je u Ručnom rasporedu`, linking the cover's cell | — |

## Epic AC Deviations

- "`members.is_floater` and `floater_roles` store it (audited, admin-only read)": `floater_roles` is admin-only; `members.is_floater` is a column of `members`, whose 0003/0011 policy also lets a member read their own row, so a member can read their own flag (never anyone else's).
- "fewest shifts this month first": R16.2's "in the month so far" is read as d's calendar month as planned (every at-work shift of it), which is what *Predložene zamjene* shows.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0081_teamless_conflicts.sql:280-520` -- the RPC re-created in `0084` with two refusals; `0078_job_roles.sql`, `0080_organization_holidays.sql` -- table, policy, grant, trigger shapes; `0023`/`0035` -- the members triggers widened.
- NEW `packages/domain/src/floaters.ts` (+ test, `index.ts` exports) -- `floaterEligibleFor`, `floaterStandingOn`, `floaterSuggestionsOf`; reads `AtWorkShift` intervals (`absoluteMinuteOf`).
- `packages/domain/src/history.ts` (+ test) -- record `floater-role` (`floater_roles`), field `isFloater` (`is_floater`).
- `apps/web/src/features/members/services/list.ts` -- `MEMBERS_COLUMNS` + `is_floater,floater_roles(job_role_id)`; `MemberListRow.isFloater`, `.floaterRoleIds` (sorted); parser strict. As built: `lib/offline/persistence.ts` `DEVICE_SNAPSHOT_SHAPE` 8 → 9, because the persisted `members` entry's rows gained both fields (a shape-8 row would hydrate with `floaterRoleIds` undefined); the calendar entry is unchanged, so no floater fact is in the calendar snapshot. Mappers: every `MemberListRow` fixture (`rotation/rotation.fixture.ts` and the member/settings/setup tests) gains both; `calendar/services/snapshot.ts` reads `calendar_members()` (untouched).
- NEW `features/members/services/floater.ts` (+ test) -- the dialog's facts, options and `saveMemberFloater` (update the flag, delete the dropped roles, insert the new ones; refusals).
- NEW `features/members/hooks/use-member-floater.ts`, `components/member-floater-card.tsx` -- *Zamjena* card + dialog, and `MemberFloaterButton` for `pages/timovi-i-raspored.tsx`'s people rows. `pages/ljudi.$id.tsx` composes the card.
- `features/teams/services/dependents.ts` -- `MEMBER_FLOATER_SAVE_DEPENDENTS` (the member list).
- NEW `features/conflicts/services/floater-suggestions.ts` (+ test) -- the web adapter: floaters from the member list, at-work shifts from `scheduleInputsOfCalendar` per floater, leave from the organization's records, narrowed to `assignmentCandidatesOf`.
- `features/conflicts/services/resolution-screen.ts` -- `ResolutionSources.members` already holds the list; view `suggestions`, `noSuggestion` (role name or none), `heldBy`; groups less the suggested; `replaceWriteOf(view, replacementId)`; `replacementOf` finds suggested picks. `hooks/use-conflict-resolution.ts`, `components/replacement-picker.tsx`, `conflict-resolution-body.tsx` -- the group, the line, the held link. `resolution-write.ts` -- the held line's assignment form.
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi.floater.*`, `zaOdluku.resolution.suggestions*`, `heldAssignment*`, history names; catalogs `pages/key-sources.fixture.ts`, `source-guards.fixture.ts`, `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts` SOURCES, structural pins as they fail.
- Root DB tests, unrun: `test/provisioning.test.ts` (RLS, AUDITED, grantees, table and column privileges), `test/rls-isolation.test.ts` (AUDITED_TABLES, floater_roles cases, the two RPC refusals), `test/concurrent-writes.test.ts` (trigger catalog, columns by name), `test/supabase-scaffold.test.ts` (policies, audited list, guards).
- e2e: `e2e/utils/database-helper.ts` -- every cleanup deleting members or job roles deletes their `floater_roles` first; NEW `e2e/tests/conflicts/floater-suggestions.spec.ts` (shared locks, full cleanup).

## Tasks & Acceptance

**Execution:**
- [x] `0084_floaters.sql` and the DB catalogs, cases written unrun.
- [x] Domain `floaters.ts`, history; tests incl. the matrix rows.
- [x] Members read, floater service, hook, card, dialog, setup button.
- [x] Resolution screen: suggestions, none line, pick write, held by assignment.
- [x] Copy and catalogs; e2e helper and spec.
- [x] Spine AD-26 `Amended 2026-11-26 (story 21.13)`; epic context; DESIGN/EXPERIENCE; `deferred-work.md` (the held hint and the direct-RPC entries RESOLVED); sprint status `review`.

**Acceptance Criteria:**
- Given no floater, when the suites run, then every resolution screen, member page and digest is unchanged.
- Given typecheck, lint, build, the domain/ICS/web suites and the DB-free root files, when run, then they pass.

## Design Notes

1. **Suggestions on every collision.** R16.3 writes the floater's assignment counted with the conflict's team; 0081's second form matches any collision of that date, type and team, so a 24-hour crew's rotation shift is covered the same way. Other candidates keep the shift's own form (an override on a rotation shift).
2. **Reads.** The floater flag and roles ride on the member list the screen already reads (admin only), so no new query key or freshness entry.
3. **Held hint (21.7 deferral).** A key held by an unapplied replacement by assignment links *Ručni raspored* on the cover's month, person and date.
4. **Direct RPC (21.7 deferral).** The membership and loan rule for "has a team" is SQL's `member_team_on` and the live loans; the browser offers neither case, so only a direct call meets the refusals.
5. **Write order.** Three PostgREST calls, no RPC, in the order Design Note 7 gives (amended in review pass 1): a partial failure is shown and re-read, and the next save completes it. Turning the flag off drops every role.
6. **Build notes (the coordinator's brief).** ABSOLUTE RULES, verbatim: "Follow every rule in `_bmad/custom/bmad-build.toml`, including the theme tests on CSS changes. Never run `pnpm exec vitest run` without explicit file arguments. Never run DB-connecting tests, e2e or `supabase` commands; never touch docker containers, staging or the stopped manual-test stack; never `pkill`. Allowed: typecheck, lint, `pnpm build`, the package and web unit tests, the DB-free root tests by name, and headless Chromium renders. Do not run gitleaks. The repo is PUBLIC: no IPs, hostnames, real names or secrets." Toolchain: Node and pnpm from the user-local bin directory on `PATH`. The migration's root catalogs: `provisioning` (AUDITED, RLS, grantees, column privileges), `rls-isolation` AUDITED_TABLES, `concurrent-writes` trigger columns (its catalog query sorts columns by name), `name-key` if any, `notify-boundary` operands for new notification codes (none here); `localization-applied` SOURCES, key-sources, `source-guards`, `resource-hygiene`. Any e2e or page-object code that injects member rows by hand carries the new columns. e2e takes the shared locks (`e2e/utils/*` lock helpers, as `rucni-raspored.spec.ts`) and cleans up fully. A dialog a host opens on mount must survive StrictMode's effect replay (open it on the commit after mount, as `member-dialogs-host.tsx`); this story's dialogs open on a press. Keep the repo's local git identity; do not commit (the coordinator commits).

7. **Inert role rows (review pass 1).** Role rows of a member whose flag is off are inert: eligibility reads the flag first (`floater-suggestions.ts` keeps only `isFloater` members), so no database tie between `is_floater` and `floater_roles` is needed. The save writes roles then the flag when the flag turns on, the flag then the roles when it turns off, so a partial save never makes a floater cover a role nobody chose.

## Verification

**Commands:**
- `pnpm build`, `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- The DB-free root files by name (resource-hygiene, supabase-scaffold, localization-*, key-hygiene, feature-boundaries, import-cycles, …) -- pass.
- Not run (STRICT DATABASE RULE): `0084` never applied locally; provisioning, rls-isolation, concurrent-writes and the e2e spec are CI's first run.

**As run (2026-11-26, the implementation, before commit):**
- `pnpm typecheck` (root, e2e, smoke, perf and every workspace), `pnpm lint`, `pnpm build` -- clean.
- `pnpm --filter @shift/domain test` 1209 passed (28 files, `floaters.test.ts` new); `pnpm --filter @shift/ics test` 35 passed; `pnpm --filter ./apps/web test` 7490 passed (209 files).
- DB-free root files by name: `resource-hygiene`, `supabase-scaffold` (a 0084 block added), `localization-applied`, `localization-guard`, `feature-boundaries`, `import-cycles`, `key-hygiene`, `e2e-plural`, `no-jsdom`, `typography-coverage`, `workspace-isolation` -- pass.
- No CSS or token changed, so the theme root files were not required.
- Not run (STRICT DATABASE RULE): `0084` never applied locally; `test/provisioning.test.ts` (floater_roles privileges, keys, policies, triggers; `members.is_floater`; the members UPDATE columns; AUDITED 27), `test/rls-isolation.test.ts` (policies, AUDITED_TABLES, the floater_roles cases, the two RPC refusals), `test/concurrent-writes.test.ts` (trigger catalog) and `e2e/tests/conflicts/floater-suggestions.spec.ts` are CI's first run.

**As run (2026-11-26, after the review patches):** typecheck, lint and build clean; domain 1210, ICS 35, web 7496 (210 files) passed; the 12 DB-free root files above plus `e2e-midnight-guard` pass (3860 tests). The DB cases (now with a cross-tenant and a team-item INACTIVE case) and the e2e spec (four cases) remain CI's first run. Gitleaks: not run by this build (the coordinator's brief forbids it; the orchestrator scans before push).

## Review Triage Log

### 2026-11-26 — Review pass 1 (no bad_spec loop)

- Layers: blind, edge-case, verification-gap, epic AC, unrun DB test (5 of 5), each a context-free subagent over the diff against `8c23b40`.
- intent_gap: 0. bad_spec: 0. Epic AC: AC 1 and 2 partly, both listed above; AC 3 met in code (CI verifies it).
- patch (applied):
  - `[high]` The save order could leave a floater with no roles, eligible for every role-less absence. Now: turning on writes roles first and the flag last; turning off writes the flag first (blind, edge-case).
  - `[medium]` A role delete RLS filtered silently read as saved: rows are read back and a short delete is denied. The dialog diffs against the member as opened and refuses a stale save (blind, edge-case).
  - `[medium]` The RPC's new refusals ran before the cover was confirmed as the tenant's member, so they could leak another tenant's member status: a membership check (22023 `CONFLICT_REPLACEMENT_INVALID`) comes first, all after EXISTS and TAKEN; two DB cases added (blind, edge-case).
  - `[medium]` One floater's bad row made the screen unavailable: suggestions guarded (no block, logged); the domain skips ineligible floaters before reading them; one missing staffing figure drops only its own entry (blind, edge-case).
  - `[medium]` Inputs assembled once (`scheduleLeaveOf`); the window uses the date helpers; adapter tests for a Noć on d−1 and across a month edge (blind, verification gap).
  - `[medium]` `suggestions` required in `replaceWriteOf`; the embed FK-hinted (`floater_roles!floater_roles_member_fkey`).
  - `[medium]` e2e: role eligibility and the member page's *Zamjena* save (verification gap). The held-by-assignment link is covered by service tests only.
  - `[low]` Plural copy (*za posao*/*za poslove*), *Nemaš ovlasti*, loading and partly-unknown lines; the hint described, focus to Spremi on a refusal, the setup button names the state; comments, a shared `ManualSearch`; DB-test messages; anon probes; RESOLVED lines say "built, pending CI".
- Two DB cases are green through 0035's stale-admin row trigger before the policy (unrun DB auditor): their comments say so; the policy alone cannot be reached past that trigger.
- defer: none beyond the implementation's two entries (the day-detail roster dialog; the unrun CI cases).
- reject: the none line when the only floater is the absent member (still true); the pick switching form while the list loads (the screen waits on the member list); civil-minute rest gaps across DST (R5's reading everywhere); suggestions on *Danas* and the queue (beyond UX-DR77).

## Suggested Review Order

**Who may be suggested (R16.2)**

- Entry point: eligibility, standing and order; ids and counts only.
  [`floaters.ts:197`](../../packages/domain/src/floaters.ts#L197)

- Free: active, not working, not on leave, no zero rest gap.
  [`floaters.ts:147`](../../packages/domain/src/floaters.ts#L147)

- The browser adapter: R12 per floater, narrowed to 21.7's candidates.
  [`floater-suggestions.ts:108`](../../apps/web/src/features/conflicts/services/floater-suggestions.ts#L108)

**The resolution screen**

- A suggested pick is always the assignment form, counted with the team.
  [`resolution-screen.ts:240`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L240)

- Suggestions guarded, groups less the suggested, the none line.
  [`resolution-screen.ts:1142`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L1142)

- A key held by an assignment links *Ručni raspored* (21.7 deferral).
  [`resolution-screen.ts:1292`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L1292)

- *Predložene zamjene* first, in the one radio group.
  [`replacement-picker.tsx:56`](../../apps/web/src/features/conflicts/components/replacement-picker.tsx#L56)

**The stored setting (0084)**

- `floater_roles`: admin-only, composite keys, no self-reading policy.
  [`0084_floaters.sql:88`](../../supabase/migrations/0084_floaters.sql#L88)

- The cover RPC's tenant, inactive and on-team refusals.
  [`0084_floaters.sql:427`](../../supabase/migrations/0084_floaters.sql#L427)

**Marking a floater**

- The ordered save and its refusals.
  [`floater.ts:290`](../../apps/web/src/features/members/services/floater.ts#L290)

- *Zamjena* card and dialog; the setup page's button.
  [`member-floater-card.tsx:70`](../../apps/web/src/features/members/components/member-floater-card.tsx#L70)

**Peripherals**

- e2e, unrun: suggested pick, on leave, role eligibility, the member page's save.
  [`floater-suggestions.spec.ts:110`](../../e2e/tests/conflicts/floater-suggestions.spec.ts#L110)

