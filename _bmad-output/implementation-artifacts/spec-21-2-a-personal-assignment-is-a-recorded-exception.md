---
title: '21.2 A personal assignment is a recorded exception'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '771ce06a4dff467608f98021680ec21d522081d8' # rebased onto 9ea215f (#364, 21.3) before push
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-1-the-personal-assignment-rule-in-the-domain.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.1 put R14 in the domain, but nothing stores a Personal Assignment, nobody can read one, and the server assembly, the feed and the reminders cannot carry one. Until this story, a teamless shift would also abort `enqueue_shift_reminders` (0075 refuses a null `teamId`).

**Approach:** Migration `0077` adds `personal_assignments` (AD-26), written only through the definer `save_personal_assignments(p_changes)`. That definer batches one `SCHEDULE_ASSIGNED` notice per member per save (E-3). Members read through `calendar_personal_assignments()`, with no note or author (E-2). `member_schedule_inputs` carries the assignments through a fifth live helper. `enqueue_shift_reminders` gains the `ASSIGNMENT` item form. The browser snapshot, its adapter and both parity fixtures carry the assignments. The ICS serializer and `notify` gain the personal and teamless forms, all in one change (deferred-work 21.1 (a)–(d)).

## Boundaries & Constraints

**Always:**
- The table: `organization_id` first, RLS on, AD-11's two audit triggers, and composite keys to the member, shift type and team, with no cascade. Named checks: the kind; the type exactly when `SHIFT`; no team on `OFF`; the date in years 0001–9999; a note of 1–200 code points after 0036's trim, or none; and a removal with both columns or neither. A partial unique index keeps at most one live row per member and date. Only an active admin reads the table. Sessions hold no INSERT, UPDATE, DELETE or TRUNCATE.
- The save takes the 0023 lock, then re-reads the caller as an active admin (42501 `PERSONAL_ASSIGNMENTS_REFUSED`). It checks the whole batch before any write (22023 `PERSONAL_ASSIGNMENTS_INVALID`), and accepts:
  - at most 5 000 items;
  - each `{memberId, date, set:{kind, shiftTypeId?, teamId?, note?}}` or `{memberId, date, clear:true}`, with no other key;
  - only the organization's members, and only its shift types and teams that are not archived;
  - only real dates, with no member and date twice.
- Each item replaces the live row: it soft-removes the old one (attributed) and inserts the new one. An item equal to the live row, or a clear with no live row, writes nothing. The save answers `{inserted, removed, unchanged}`.
- Notice: one `SCHEDULE_ASSIGNED` per member through `private.notify_members`, with operands `{from, to, days}` over the member's written dates on or after the organization's today, and one fresh subject per call. A member with no such date gets none.
- `calendar_personal_assignments()` returns the id, member, date, kind, shift type and team of live rows, for an active member of the claimed organization only.
- The assembly carries `personalAssignments: [{id, date, kind, shiftTypeId, teamId}]` on every member, dated in the window and ordered by date, then id. It is always present (`[]` when none), and the browser's adapter builds the same value.
- The reminder item: the team form is unchanged (8 keys). The `ASSIGNMENT` form adds `source: 'ASSIGNMENT'` and `personalAssignmentId`, and its `teamId` may be null. The RPC writes it only while that row is live and is the member's, on the same date and shift type. It keys the subject `…:date:a:<id>:<lead>`. It writes no `teamId` or `teamName` when there is no team.
- ICS: an assignment's UID is `<date>-a-<assignmentId>-<memberId>@<domain>`. Its SUMMARY is the type, followed by ` · <team>` only when there is a team.
- R14.7: with no assignment, every domain, feed and reminder output is byte-identical. New fields are left out entirely, never set to `undefined`.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no surface that writes assignments (21.4), no web reader of teamless shifts or collisions (21.6, 21.7), no personal-rotation item form or UID (21.9), and no history wording for the table (21.4). Do not change the 8-key team item or any team UID.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Batch | admin saves 40 cells for 6 members, all on or after today | 40 rows; exactly 6 `SCHEDULE_ASSIGNED` (email/push per notify rule) | none |
| Past only | one member's cells all before today | rows written, that member not told | none |
| Same again | items equal to the live rows | `inserted: 0`, no audit row, no notice | none |
| Replace / clear | a different type; `clear` | old row removed (attributed), new inserted / none | none |
| Invalid | unknown key, other tenant's member, archived type, `OFF` with a type, 5 001 items, a member and date twice | nothing written | 22023 `PERSONAL_ASSIGNMENTS_INVALID` |
| Not admin | member-role, stale or claimless caller | nothing | 42501 |
| Direct write | session `insert`/`update`/`delete` on the table | refused | 42501 |
| Member read | member-role calls `calendar_personal_assignments()` | live rows, no note, no author | none |
| Teamless reminder | an `ASSIGNMENT` item with `teamId: null` | row written; operands have neither `teamId` nor `teamName`; notify renders the no-team variant, link without `danSmjena` | removed or changed row: skipped |

## Epic AC Deviations

- AC 4 "`remind` writes an `ASSIGNMENT` reminder under AD-18 as amended": built. The `PERSONAL_ROTATION` item form of the same amendment needs 21.9's personal rotation. DEFERRED to 21.9 and 21.10 (`deferred-work.md`).
- AC 4 "the feed's UID and summary follow AD-20 as amended": built for assignments. The personal-rotation UID (`<date>-p-<memberId>`) is DEFERRED to 21.9 (`deferred-work.md`).
- Epic technical decision "History groups a grid save … *Ručni raspored: {n} dana*": until then the history shows the table as a generic record (`other`). Grouping and naming are DEFERRED to 21.4, the first surface that writes (`deferred-work.md`).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0077_personal_assignments.sql` -- NEW. Table and policy (template: `0062_team_loans.sql`); `private.live_personal_assignments` (0065's helper shape); `calendar_personal_assignments()` (as `calendar_team_loans`); `save_personal_assignments(jsonb)` (lock and re-check as 0064's `amend_team_loan`, `private.notify_members`); `private.member_schedule_inputs` re-created from 0065 with `personalAssignments`; `enqueue_shift_reminders` re-created from 0075 with the `ASSIGNMENT` form.
- `packages/domain/src/shift-reminders.ts` -- `ShiftReminder.source?: 'ASSIGNMENT'`, `personalAssignmentId?`, both set only from `AtWorkShift.personalAssignmentId`.
- `packages/domain/parity/fixtures.ts` -- `personalAssignments` on every member. Pilot: m4 (no team) works a teamless Dan on 2027-03-26, and m2 is `OFF` on 2027-01-10. UJ-5: m3 works popodnevna counted with team A on 2027-02-10, m1 has non-working slobodno on 2027-02-11, and m4 has a shift on an inactive date (2027-02-12), which derives nothing. All dates are outside the ICS golden window and the reminder clocks.
- `packages/domain/test/personal.test.ts` -- the parity R12 digests strip `personalAssignments` (R14.7 is a claim about no assignment); new test: the parity fixtures' assignments reach R12.
- `packages/domain/test/shift-reminders.test.ts` -- assignment item form, teamless, absent fields otherwise.
- `packages/ics/src/calendar.ts` (+ test) -- assignment UID/SUMMARY; a teamless shift with no assignment id is still left out (21.1's skip) until 21.9.
- `packages/domain/src/history.ts`, `apps/web/src/features/history/services/history-rows.ts`, `hr.json` `history.field.note`, `key-sources.fixture.ts` (154 strings) -- the audited `note` column is a named field (*Napomena*); the scaffold's audit pin requires it.
- `packages/domain/test/at-work.test.ts` -- pilot-m4's R12 now holds the fixture's teamless Personal Shift.
- `supabase/functions/notify/messages.ts` -- `SCHEDULE_ASSIGNED` → `scheduleAssigned` (link `/kalendar`); `from`/`to` join `DATE_OPERANDS`; reminder `hoursNoTeam`/`eveningBeforeNoTeam` when operands carry neither `teamId` nor `teamName` (one without the other refused); `reminderPathOf` without `danSmjena`.
- `apps/web/src/lib/i18n/locales/hr.json` -- `obavijesti.scheduleAssigned`, `reminders.notice.hoursNoTeam`, `.eveningBeforeNoTeam`; `test/resource-hygiene.test.ts` pins.
- `apps/web/src/features/calendar/services/snapshot.ts` -- fifth rpc `CALENDAR_PERSONAL_ASSIGNMENTS_FUNCTION`; `personalAssignmentsOf` (validate like `loansOf`, `checkPersonalAssignments`); `CalendarMember`/`CalendarViewer.personalAssignments`; refusal `'personalAssignment'`. `rotation.fixture.ts` stub + `snapshot.test.ts`.
- `apps/web/src/lib/offline/persistence.ts` -- `DEVICE_SNAPSHOT_SHAPE` 4.
- `apps/web/src/features/calendar/services/schedule-inputs.ts` -- adapter carries windowed `personalAssignments`.
- Mappers rebuilding a member input from `{memberId, memberships, statuses}` (`month.ts memberScheduleInputOf`, `change-preview.ts`, `day-detail.ts`, `replacement-candidates.ts`, `deactivation-consequence.ts`, `team-move-preview.ts`, `swap-proposal.ts`) -- deliberately LEFT: they pass `members: snapshot.members` and the domain reads each member's own list (21.1 Design Note 1); `member-erasures.ts` and `loan.ts withLoansOf` spread `...member`, so the list rides along. The AD-5 erasure check (`conflicts/services/erasures.ts`) therefore derives over assignments with no change.
- `test/supabase-scaffold.test.ts` (DB-free) -- the policy list (67), the audited tables (23), and a 0077 block: `member_schedule_inputs` equals 0065's plus the one insertion, word for word; the reminder forms; the table's shape; the save's order.
- `test/notify-reminder.test.ts` (DB-free) -- the no-team variants and `SCHEDULE_ASSIGNED`.
- `apps/web/src/features/calendar/services/roster-erasures.test.ts` -- the AD-5 erasure check sees an assignment in the snapshot.
- DB tests (CI-only, written unrun): `test/rls-isolation.test.ts` (policy inventory + new block), `test/provisioning.test.ts` (three inventories), `test/schedule-inputs-parity.test.ts` (an assignment per fixture), `test/shift-reminders.test.ts` (ASSIGNMENT form), `test/notify-boundary.test.ts` (code inventory). `test/catalog-sweep.ts` needs nothing (jsonb argument).
- `e2e/utils/database-helper.ts` -- delete a member's/team's/shift type's `personal_assignments` before the row.
- Docs: spine AD-26/AD-18/AD-19/AD-20 `Amended 2026-11-25 (story 21.2)`; `deferred-work.md`; `sprint-status.yaml`; 21.1 spec set done.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0077_personal_assignments.sql` -- the table, reads, save, assembly, reminder RPC.
- [x] `packages/domain` -- reminder item fields; parity fixtures; tests.
- [x] `packages/ics` -- assignment UID/SUMMARY; tests.
- [x] `supabase/functions/notify/messages.ts`, `hr.json`, hygiene pins -- `SCHEDULE_ASSIGNED`, no-team reminder.
- [x] `apps/web` snapshot, adapter, persistence shape, fixtures and tests.
- [x] Root DB tests and `e2e/utils/database-helper.ts` -- as mapped.
- [x] Docs -- spine amendments, deferred entries (21.1's (a)–(d) RESOLVED; new for 21.4 history, 21.9 forms), sprint status (21.1 done, 21.2 review), 21.1 spec rewritten.

**Acceptance Criteria:**
- Given the matrix, when the DB suites run in CI, then each row holds.
- Given both parity fixtures with their assignments, when runtime parity and read parity run, then both hold, and R12 shows a teamless personal shift.
- Given no assignment, when every domain, ICS and reminder output is derived, then it equals the baseline (R14.7 digests).
- Given the package, web and DB-free root suites, typecheck and lint, when run locally, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended): no intent_gap and no bad_spec, so this was patch only. The frozen block is unchanged. The Code Map and Design Notes 6–8 record the review's patches. KEEP: the 8-key team item, the future-only notice, and riding the assignments on each member.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC, unrun DB test auditor (5 of 5).
- intent_gap: 0. bad_spec: 0. patch: 14. defer: 2 new (21.6: the read grows without bound and is kept offline; 21.5: an archived type refuses a whole fill). Rejected: 8.
- addressed_findings:
  - `[high]` `[patch]` PostgREST's `max_rows` (1000) would cut a set-returning `calendar_personal_assignments()` without an error, so the browser would derive without some assignments and read parity would break. It now returns one jsonb array (blind).
  - `[high]` `[patch]` The jsonb read answered `[]` to a caller with no access, which the claimless and suspended catalog sweeps count as an answer. It now answers NULL (unrun DB auditor).
  - `[medium]` `[patch]` An `ASSIGNMENT` reminder did not check the row's team, so a reminder could name the wrong team. It now must match when the row names one; tested (blind, edge-case).
  - `[medium]` `[patch]` 5 000 items made the batch work quadratic (jsonb concatenation) and opened 5 000 subtransactions. The batch is now held in typed arrays with `pg_input_is_valid` and no exception block, and the scaffold pins that (edge-case).
  - `[medium]` `[patch]` A note was checked trimmed but stored and compared raw. It is now stored trimmed. A note-only replacement no longer tells the member (blind).
  - `[medium]` `[patch]` Nothing tested an inactive admin's save, an inactive member's read, or another tenant's claim. Cases added (verification-gap, blind).
  - `[medium]` `[patch]` The 5 001-item case could pass on the duplicate check. It now uses distinct dates. The read case's admin row count was 3, not 2 (unrun DB auditor).
  - `[low]` `[patch]` The ICS serializer threw on a teamless shift with no assignment id, which would fail the whole feed. It leaves the shift out again, as 21.1 did (blind).
  - `[low]` `[patch]` Indexes added on the shift type and team keys (blind).
  - `[low]` `[patch]` Cases added: foreign type and team, a clear with a stray key, an accepted non-working type, an explicit second type and team in the reminder skip case. The test title was corrected. The Code Map now lists UJ-5's m4 (blind).
  - `[low]` `[patch]` The spine now records: the inactive-member decision, the note trim, the null read, the team check, and the accepted double reminder after a replacement (blind, edge-case).
  - Rejected:
    - The team item's missing `source` key is not listed as an Epic AC deviation (epic AC). It is a refinement of AD-18's wording inside the same amendment. The AC (an `ASSIGNMENT` reminder is written) is met, and the spine records it.
    - Uppercase uuids are accepted. They cast to the same uuid, and duplicate detection uses the cast value.
    - A second R14.7 digest of the fixtures as shipped. New explicit R12 tests pin the assignments' shifts.
    - `from`/`to` joining `DATE_OPERANDS`. No other code writes either operand (grep of the migrations).
    - Text for a single day or non-contiguous days. The text gives the range and the count; 21.4's grid shows the days.
    - The e2e outbox cleanup by team or type. The outbox recipient key cascades (0043), and reminder subjects are hashes, not row ids.
    - Restoring an earlier `notify_suppress` value. This matches 0064's definers, and no caller nests it.
    - Rewriting 21.1's spec in this change. The workflow rule requires it.

## Design Notes

1. **The team item has no `source` field.** An absent `source` means `TEAM`, so the RPC's 8-key contract, the R14.7 digests and the runtime-parity probe stay unchanged. `ASSIGNMENT` is the only new form. 21.9 adds `PERSONAL_ROTATION`.
2. **The notice tells a member only about their own future.** `from`, `to` and `days` count only dates on or after today, so a save that mixes past and future dates never reports a past date. Wording avoids plurals (`izmijenjenih dana: {days}`), since the renderer has no plural rules.
3. **Archived means refused, strictly.** An item that names an archived type or team is invalid, even when it equals the live row. The grid (21.4) sends only the cells that changed.
4. **No lock or re-check trigger on the table.** No session writes it, so the definer takes the lock and re-checks the caller itself, the way 0064's definers do. `concurrent-writes`' trigger inventory is unchanged.
5. **The R14.7 parity digest strips assignments.** The fixtures now hold assignments, so the baseline digest is computed over the same fixtures with `personalAssignments` removed. That is the claim R14.7 makes.
6. **The member read is one jsonb array, NULL for no access** (review). PostgREST caps a set-returning function at `max_rows` (1000) without an error, and a month's grid exceeds that, so the read is a scalar. A caller who is not an active member of the claimed organization gets NULL, which the catalog sweeps count as saying nothing.
7. **A note is stored trimmed, and a note-only replacement tells nobody** (review). The member never sees a note (E-2), so no day changed. An inactive member is accepted (R14.3: such an assignment derives nothing; seasons are planned ahead).
8. **The `ASSIGNMENT` reminder also matches the row's team** when the row names one (review). A replacement keyed by a new id can remind of the same shift twice. This is accepted under D5 and recorded in AD-18.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm --filter @shift/ics build && pnpm typecheck && pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/notify-reminder.test.ts test/remind.test.ts test/calendar-feed.test.ts test/runtime-parity.test.ts` -- pass (DB-free).
- Not run locally: the DB-connecting suites, read parity, e2e (STRICT DATABASE RULE). CI is the gate.

**Results (2026-11-25, after review pass 1):** typecheck and lint clean. Domain: 23 files, 1024 tests. ICS: 4 files, 33 tests. Web: 186 files, 6926 tests (6933 after the rebase onto #364, story 21.3). The six DB-free root files (resource-hygiene, supabase-scaffold, notify-reminder, remind, calendar-feed, runtime-parity): 2558 tests. All pass. No DB suite was run (STRICT DATABASE RULE). If one failed locally because `0077` is not applied, that would be expected.

**Residual risks:**
- CI run 1 on PR #365 failed in `Test (Vitest, local Supabase)` on two pins this story had missed, both fixed for CI. First, `provisioning.test.ts`'s audited-table inventory (22 → 23, `personal_assignments`), together with its RLS list and rls-isolation's `AUDITED_TABLES`. Second, `notify-boundary.test.ts`'s every-code footer case, which lacked `SCHEDULE_ASSIGNED`'s `from`, `to` and `days`. The other DB cases ran in that job. Sprint status stays `review` until the green run. Every DB case (rls-isolation's 0077 block, provisioning's three inventories, read parity with assignments, the reminder `ASSIGNMENT` form, notify-boundary's inventory) runs first in CI.
- Process note: as in 21.1, the implementation ran in the orchestrating session (the investigation was already in its context), not in a fresh step-03 subagent. Review ran with context-free subagents.
