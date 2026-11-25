---
title: '21.1 The personal-assignment rule in the domain'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '0c119338f43c509736b10acda0dc039c00a5f5db'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member's day comes only from their (effective) team's rotation. Day workers and students need a shift given by hand (R14, FR-102 to FR-110), and every figure (rosters, member month, hours, leave cost, collisions, staffing, R12) must follow it through the one domain rule (AD-7, AD-26), with nothing moving while no assignment exists (R14.7).

**Approach:** Add `packages/domain/src/personal.ts` (the `PersonalAssignment` type, its checks and the R14.3 shift rule). Assignments ride on the member as an optional `personalAssignments` list, as loans do. `shiftRoster` leaves an assigned member off every base roster (R14.2); `memberScheduleOfMonth` puts the Personal Shift in place of their team's shift, so hours, leave cost, collisions and R12 follow; staffing builds R14.6's groups. A digest pinned on the unchanged engine proves R14.7 over both fixtures and the parity fixtures' R12.

## Boundaries & Constraints

**Always:**
- R14.1: kinds `SHIFT` (a type, working or not; optional counted team) and `OFF`; one per member and date; ids distinct. A breach throws `RangeError`, as malformed loans do.
- R14.2/R14.4: an assigned member is on no base roster that date; roster overrides apply on top by the existing rule; a team's Scheduled Shift (`scheduleOfMonth` cell) never changes.
- R14.3: a working `SHIFT` of an ACTIVE member is a Personal Shift counted with the named team, else the effective team (R11.1), else none (`teamId: null`). Non-working, `OFF` or inactive is no shift.
- R14.5: hours source `PERSONAL`; leave cost, collisions (team may be `null`), R12 (`atWorkShiftsOf`, `shiftRemindersDueOf`) and the duty legs that double booking and rest gap read include it.
- R14.6: a team's Scheduled Shift counts its roster plus same-type Personal Shifts counted with it; each other working type among them is its own group; each member counted once; less everyone absent.
- R14.7: with no assignment (absent, `[]`, or none in the window) every output is byte-identical; new output fields are ABSENT, never `null`.
- Pure, codes and ids only (AD-7, AD-8).

**Ask First:** none (unattended; decisions recorded in Design Notes).

**Never:** no migration, table, RPC, snapshot read, parity-fixture change or UI (21.2, 21.4, 21.6); no ICS UID/summary or reminder-item form (21.2); no collision storage change (21.7). Web, ICS and Edge code changes only to compile against the widened `teamId: string | null`, skipping a teamless shift with no behaviour change while nothing feeds assignments.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| None | both fixtures, no / `[]` / out-of-window assignments | every digest equals baseline | none |
| R14.8 | day team D (no rotation), D1 week one 1. smjena, week two 2. smjena; student 1. smjena on Saturday, no team; D2 off on Wednesday | months, hours (`PERSONAL`), R12 carry exactly those; D's Monday is one group with D1 and D2; leave over the student's Saturday costs 1 and raises one collision with `teamId: null` | none |
| Crew day off | crew member assigned `OFF` on their Dan date | off that team's roster that date only; team cell unchanged; staffing drops by one | none |
| Other team | `SHIFT` naming team C | counts with C; C's staffing includes them | none |
| Override on top | override putting assigned member on another team's shift | applies (double booking, overlapping legs); one taking them off their own team is inert | none |
| Inactive / non-working | assignment on an inactive date, or of a non-working type | no shift; member on no roster | none |
| Malformed | two on one date, duplicate id, bad date, `SHIFT` with no type, `OFF` with a type or team, unknown kind | — | `RangeError` |

## Epic AC Deviations

- AC 2 "swaps … include it": swap validity and the swap's giving/taking of a personal shift are web derivations, built in story 21.8. Here they follow only through `rosterOn` and `memberScheduleOfMonth`. Reinterpreted, not deferred.
- AC 2 "double booking and rest gap": the domain has no member-level rest-gap or double-booking function; the web reads `overlappingLegsOf`/`dutiesOf` over a member's shifts. Proven by a test that a Personal Shift is an at-work leg that `overlappingLegsOf` pairs with an override shift. The surfaces' warnings land with 21.4's preview. Reinterpreted.
- AC 3 "R14.8's worked example passes": R14.8 does not give D2's days besides Wednesday; the test gives D2 D1's week-one shifts, so the Monday group holds both as R14.8 says. Feeds and reminders are checked at R12 (`atWorkShiftsOf`, `shiftRemindersDueOf`); the ICS form is 21.2's.
- AC 2 "collisions (team possibly none)", as the web reads them: the domain raises them, but every web reader keeps only collisions with a team (`unresolvedOf`, the member's own *Sati*, the leave form, the erasure list, the calendar marks), so one is neither shown nor resolvable until 21.7 stores its key. Same for teamless shifts in the day list, day detail, loan check, swap offers and the feed (left out), and the hours explanation (unavailable) until 21.2/21.6. No data reaches them before 21.2. DEFERRED to 21.2, 21.6, 21.7 and 21.8, and gated on 21.4 (`deferred-work.md`). *(Added by the review, 2026-11-25.)*
- Epic rule "a new input to the projection reaches the browser's read, `member_schedule_inputs` and both parity fixtures in the same story (AD-19)": `personalAssignments` is optional and unfilled here; the reads, the assembly and the parity fixtures are 21.2's by the epic's own story split (21.2's AC 4). DEFERRED to 21.2 (`deferred-work.md`). *(Added by the review, 2026-11-25.)*
- AC 2 "double booking and rest gap", the surfaces: the warnings over a member's legs land in 21.4's preview. DEFERRED to 21.4 (`deferred-work.md`). *(Added by the review, 2026-11-25.)*

</frozen-after-approval>

## Code Map

- `packages/domain/src/personal.ts` -- NEW. `PERSONAL_ASSIGNMENT_SHIFT|OFF`, `PersonalAssignment`, `PersonalShift`, `checkPersonalAssignments`, `personalAssignmentOn`, `personalShiftOf` (pure R14.3), `hasTeam` (the type guard the compile-only readers filter by). Each list is checked once and indexed by date (a `WeakMap` over the read-only input). Imports only `calendar.js`, so `roster.ts` may import it with no cycle.
- `packages/domain/src/roster.ts` -- `RosterMember.personalAssignments?`; `shiftRoster` skips an assigned member; NEW `personalShiftOn` (activeOn + effectiveTeamOn + `personalShiftOf`); `rosterOverrideApplies` is inert for a member whose `SHIFT` assignment counts with the override's team (`countsWithOn`, R14.9).
- `packages/domain/src/schedule.ts` -- `MemberScheduleInput.personalAssignments?` read like loans (`personalAssignmentsOf`, mismatch throws); `MemberShift.teamId: string | null`, `personalAssignmentId?`; `MemberScheduleDay.personalAssignment?`. `scheduleOfMonth`, `rosterOverridesMadeInertOf` inherit via `shiftRoster`.
- `packages/domain/src/hours.ts` -- `HOURS_SOURCE_PERSONAL`; `LeaveShift`/`HoursOperand.teamId` nullable.
- `packages/domain/src/collisions.ts` -- `Collision.teamId` nullable (`CollisionResolution.teamId` stays `string` until 21.7 stores a null key); null-first ordering; mapper carries `personalAssignments`.
- `packages/domain/src/staffing.ts` -- R14.6 groups (`personalShiftsIndexOf`, internal `group` flag); `peopleAtWorkOn(…, shiftTypeId?)`; NEW `staffingOn`; `newlyShortStaffedOf` matches a group by date, team and type, and a Scheduled Shift by date and team or by a group of its type.
- `packages/domain/src/at-work.ts`, `shift-reminders.ts` -- `ScheduleMember.personalAssignments?` (optional until 21.2's assembly); `AtWorkShift.teamId` nullable, `personalAssignmentId?`; `ShiftReminder.teamId` nullable.
- `packages/domain/src/leave.ts` -- unchanged; follows through `memberScheduleOfMonth`.
- `packages/domain/src/index.ts` -- exports.
- `packages/domain/test/personal.test.ts` -- NEW: R14.7 digests (pinned at baseline before any source edit), R14.8, matrix rows. Existing domain tests: type-only narrowing.
- Compile-only (skip a `teamId: null` shift/collision; deferred to 21.2/21.6/21.7/21.8 in `deferred-work.md`): `apps/web/src/features/calendar/utils/{month,day-detail}.ts`, `conflicts/services/conflicts-queue.ts` (`unresolvedOf` returns `TeamCollision`; `queueOrderOf` generic), `conflicts/services/{erasures,resolution-screen}.ts`, `hours/services/hours-explanation.ts` (`namesOf` refuses a null team; `PERSONAL` case), `hours/services/hours-conflicts.ts` (member branch) and `leave/services/leave-conflicts.ts` (the same team-only funnel), `members/services/loan.ts`, `swaps/services/swap-proposal.ts`, `packages/ics/src/calendar.ts` (leaves a null-team shift out; test), and the tests that typed `teamId` as `string` (`at-work`, `collisions`, `loans`, `shift-reminders`, `conflicts-queue`).
- `apps/web/src/lib/i18n/locales/hr.json` + `test/resource-hygiene.test.ts` + `apps/web/src/pages/key-sources.fixture.ts` (13 strings) -- `sati.explain.source.personal` = `osobni raspored` (the PRD's word and 21.6's AC), forced by the exhaustive source switch; `hours-explanation.test.ts` asserts it.
- `ARCHITECTURE-SPINE.md` AD-26 *Into the domain* -- `Amended 2026-11-25 (story 21.1)`: the shape as built (on the member, no `baseRosterMembersOn`, no `source` on `AtWorkShift` yet).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/test/personal.test.ts` -- digest test written and pinned on the baseline engine first.
- [x] `packages/domain/src/personal.ts`, `roster.ts`, `schedule.ts`, `hours.ts`, `collisions.ts`, `staffing.ts`, `at-work.ts`, `shift-reminders.ts`, `index.ts` -- the rule as mapped above.
- [x] `packages/domain/test/personal.test.ts` -- R14.8, `[]`/out-of-window digests, every matrix row, `staffingOn`, `newlyShortStaffedOf` on a group, overlapping legs, R12 and reminders.
- [x] Web, ICS, existing tests -- compile-only narrowing listed above; `hr.json` key and its hygiene pin.
- [x] `_bmad-output/specs/spec-shift/engine-rules.md` -- R14.9, this story's domain decisions (Design Notes 2–6).
- [x] `ARCHITECTURE-SPINE.md` -- AD-26's *Into the domain* amended for the shape as built (Design Note 1).
- [x] `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-25-pilot-readiness.md`, `ARCHITECTURE-SPINE.md`, `epics.md`, `sprint-status.yaml` -- record E-1..E-8 ACCEPTED 2026-11-25 (E-6 *Timovi*); 21.22 unblocked; 21.1 `review` (built, CI pending); epic-21 `in-progress`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- entries for 21.2 (assembly carries assignments; ICS/reminder forms read `personalAssignmentId`), 21.6 (teamless shifts in the web readers above; staffing groups on surfaces) and 21.7 (teamless collisions in the conflicts feature).

**Acceptance Criteria:**
- Given both fixtures with no assignment, when every figure is derived, then each digest equals the one pinned at `baseline_commit`.
- Given R14.8, when derived, then months, hours, R12, staffing, leave cost and collisions match the matrix row.
- Given the domain, web and ICS suites and DB-free root tests, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended, the 18.1 precedent): three deviations were added to the frozen `## Epic AC Deviations` at the epic AC auditor's finding. Each was already recorded in the Never boundary, Design Note 2 and `deferred-work.md`; listing them changes no intent. They are: the web's team-only reading of teamless collisions and shifts; the AD-19 epic rule (21.2's); and the double-booking surfaces (21.4's). Known-bad state avoided: an unlisted deviation. KEEP: the R14.7 digests pinned at the baseline, and riding on the member.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4 that apply; the unrun-DB-test layer has nothing to audit: no DB test, migration function or Edge Function changed).
- Digest provenance re-checked by the verification-gap reviewer: `packages/domain` at `0c11933` was extracted on its own and the three `BEFORE_PERSONAL` digests reproduced on it.
- intent_gap: 0. bad_spec: 0 (the deviation additions are recorded above).
- patch: 12 (high 0, medium 6, low 6)
- defer: 0 new beyond the planning entries. Those were widened: 21.2 (d), the remind RPC aborting a chunk on a null team; 21.6, the `peopleAtWorkOn` callers; 21.7, two more readers. There is a new 21.4 gate entry.
- addressed_findings:
  - `[medium]` `[patch]` Same-team double. An override putting an assigned member onto the team their Personal Shift counts with duplicated the shift. Hours and at-work counted it twice, collisions dropped one silently, and the feed got one UID twice. Such an override is now inert (`rosterOverrideApplies`, R14.9), with a test (blind, edge-case).
  - `[medium]` `[patch]` Every roster read re-checked each member's whole list. Each list is now checked once and indexed by date (blind, edge-case).
  - `[medium]` `[patch]` `newlyShortStaffedOf` read a group that becomes the Scheduled Shift's type (or the reverse) as newly short. It now matches across the two, with a test in both directions (blind, edge-case, verification-gap).
  - `[medium]` `[patch]` The feed threw on one teamless shift, so the whole calendar failed. It now leaves the shift out until 21.2, with an ICS test (blind, edge-case).
  - `[medium]` `[patch]` The member's own *Sati* and the leave form counted teamless collisions, while the admin's funnel dropped them. Both now take the same team-only set (verification-gap, edge-case).
  - `[medium]` `[patch]` Unlisted epic AC deviations were added (see the change log), and the 21.4 gate entry was written (epic AC, blind).
  - `[low]` `[patch]` `checkPersonalAssignments` now refuses an empty id, an empty or undefined team, and an empty type, with tests (blind, edge-case).
  - `[low]` `[patch]` The `PERSONAL` source word is now asserted at run time. It became `osobni raspored`, the PRD's and 21.6's AC wording, where the build had used UX-DR73's day-detail word `ručno` (verification-gap, blind).
  - `[low]` `[patch]` A digest cannot see an `undefined` key. A key-presence test now covers the no-assignment days, shifts and at-work shifts. `staffingOn` is now pinned equal to `peopleAtWorkOn` with no assignment. The parity R12 digest now also covers out-of-window assignments (blind).
  - `[low]` `[patch]` The collision tests no longer turn a null team into `''`; they throw (blind).
  - `[low]` `[patch]` Added a half-day test over a teamless Personal Shift (R12.2) (blind).
  - `[low]` `[patch]` Documents: AD-26's shape was amended in the spine. `epic-21-context.md` was corrected (the shape, the parallel list). The E-5 deferral was reworded so it no longer reads as both resolved and open. The founder's acceptance now names its source (blind).
  - Rejected:
    - Counting a double-booked member (two shifts of one team) in both staffing entries. They are two shifts, which R14.6 counts apart; R14.9 says so.
    - The `peopleAtWorkOn` signature. The default stays the Scheduled Shift's, so callers are unchanged; the callers to move are listed for 21.6.
    - The spec status `in-review` against the sprint's `review`. These are two lifecycles, as in 18.1.
    - `rosterOverridesMadeInertOf` in the reverse direction, and `erasedCollisionsOf` with a teamless collision. Both go through the one rule already tested; 21.7 owns the teamless erasure.
    - Recording the founder decisions on a story branch. The orchestrator asked for it on this branch.

## Design Notes

1. **Rides on the member, read like loans.** `personalAssignments` is optional on `RosterMember`, `MemberScheduleInput` and `ScheduleMember`; the month reads the input's list, else the member's entry, and two different lists throw (the 18.1 lesson).
2. **No-team shift is `teamId: null`.** The AC requires collisions with no team; widening the type is the honest shape. Web call sites skip a teamless one until 21.6/21.7 read it; with no data fed, nothing changes.
3. **A Personal Shift has `projectedShiftTypeId: null`, `overridden`/`rosterChanged`/`viaOverride: false`** and carries `personalAssignmentId`; it comes first in the day. A non-working assignment or `OFF` adds no shift; the day carries `personalAssignment` for 21.6's marks.
4. **Staffing groups** are ordered after the Scheduled Shift, by the first member holding one in `members` order. `peopleAtWorkOn` without a type stays the Scheduled Shift's (unchanged callers); `staffingOn` gives all. A group is matched across a change by date, team and type.
5. **A Personal Shift counted with no team joins no staffing** (R14.6 is per team).
6. **An override onto the team a member's Personal Shift already counts with is inert** (R14.9), as one putting a base-roster member on their own shift is. Otherwise the day would hold the same team twice: two hours terms, two at-work legs with one feed UID, one collision dropped. An override onto another team still applies (a double booking).
7. **Unsupported teamless readers leave the shift out, except the hours explanation**, which refuses (reads as unavailable) because leaving an operand out would break DI-7's sum. The feed leaves it out rather than failing the whole calendar.
8. **AD-26's prescribed shape is amended, not followed** (flat `personalAssignments` with `memberId`, `baseRosterMembersOn`, `source` on `AtWorkShift`). Riding on the member keeps one list for rosters and months (the 18.1 rule). A `source` on every at-work shift would move every at-work figure (R14.7). The amendment is in the spine.

## Verification

**Commands (run 2026-11-25, after the review patches):**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test` -- 23 files, 1018 tests passed (`personal.test.ts` among them, its three baseline digests included).
- `pnpm --filter @shift/ics test` -- 4 files, 32 tests passed.
- `pnpm --filter ./apps/web test` -- 186 files, 6918 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 2 files, 2447 tests passed.
- Not run locally: the DB-connecting root tests, read and runtime parity, and e2e (STRICT DATABASE RULE). CI is the gate. No migration, parity fixture or e2e-visible surface changed. Gitleaks is the orchestrator's (not run here).

**Residual risks:**
- CI has not run yet: sprint status `review`, built, CI pending.
- The widened `teamId` is null-safe at every web, ICS and Edge site. With no assignment fed, every web and ICS suite passes unchanged. The first data arrives with 21.2, which must ship the reminder item form at the same time (`deferred-work.md`).
- Process note: the implementation ran in the orchestrating session, as 18.1's did, not in a fresh step-03 subagent. The R14.7 digests had to be pinned on the unchanged engine first. Review ran with four context-free subagents.

## Suggested Review Order

**The rule (R14.2–R14.4)**

- Entry point: an assigned member is on no base roster, so every roster reader follows.
  [`roster.ts:280`](../../packages/domain/src/roster.ts#L280)

- The member's day: the assignment replaces their team's shift; overrides still apply after.
  [`schedule.ts:490`](../../packages/domain/src/schedule.ts#L490)

- R14.3 in one pure function: working, active, counted team or none.
  [`personal.ts:141`](../../packages/domain/src/personal.ts#L141)

- Composition with versions and loans, kept in roster.ts to avoid an import cycle.
  [`roster.ts:309`](../../packages/domain/src/roster.ts#L309)

- R14.9: an override onto the team the Personal Shift counts with is inert.
  [`roster.ts:457`](../../packages/domain/src/roster.ts#L457)

- Checks once per list, indexed by date (performance, malformed input).
  [`personal.ts:89`](../../packages/domain/src/personal.ts#L89)

**What reads it (R14.5, R14.6)**

- Staffing groups, each member counted once per shift.
  [`staffing.ts:199`](../../packages/domain/src/staffing.ts#L199)

- Matching a group and a Scheduled Shift across a change.
  [`staffing.ts:348`](../../packages/domain/src/staffing.ts#L348)

- Hours source `PERSONAL`.
  [`hours.ts:311`](../../packages/domain/src/hours.ts#L311)

- Collisions with no team sort first.
  [`collisions.ts:152`](../../packages/domain/src/collisions.ts#L152)

- R12 carries the assignment's id, absent otherwise.
  [`at-work.ts:273`](../../packages/domain/src/at-work.ts#L273)

**Compile-only boundary (no data fed until 21.2)**

- The one funnel keeps team collisions only until 21.7.
  [`conflicts-queue.ts:410`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L410)

- The feed leaves a teamless shift out rather than failing.
  [`calendar.ts:97`](../../packages/ics/src/calendar.ts#L97)

**Proof**

- R14.7 digests pinned on the baseline engine.
  [`personal.test.ts:261`](../../packages/domain/test/personal.test.ts#L261)

- R14.8 and the matrix.
  [`personal.test.ts:499`](../../packages/domain/test/personal.test.ts#L499)
