---
title: '21.9 The schedule-source rule in the domain'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: 'e1b6a65826f7564729928776ce1a227140a33415'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: done. PR #373 merged 2026-11-25 as squash `0163497`, CI green (branch `feat/21-9-schedule-source-rule`; rebased on 21.5 (#372)). Set done by 21.15. Baseline: `main` at `e1b6a65` (21.12 merged). 21.6 (web readers) is built in parallel; this story touches `packages/domain` and documents only, no hot file.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every member without a Personal Assignment follows their effective team's rotation. Dispatchers who alternate weekly between 1. and 2. smjena, cleaners on mornings only, and day workers grouped in a team without its rotation need their own schedule source (R15, AD-26): team rotation, a personal rotation, or manual only, set from a date and versioned.

**Approach:** Schedule versions ride on the member (`scheduleVersions`), as loans and assignments do. `domain/personal` gains `scheduleSourceOn` and the personal-rotation projection (R1, anchored on the version's `effectiveFrom`). `shiftRoster` keeps only team-rotation members on a base roster. `personalShiftOn` and `memberScheduleOfMonth` give a personal rotation's working step as a Personal Shift counted with the effective team, below an assignment (R15.3). Digests pinned on the unchanged engine prove R15.6 over both fixtures, and R15.7 runs as a test.

## Boundaries & Constraints

**Always:**
- R15.2: the version in effect is the one with the greatest `effectiveFrom` on or before the date. None in effect means `TEAM`. Malformed versions throw `RangeError` (a bad date, two on one date, an unknown source, `PERSONAL` without a pattern and offset step, `TEAM`/`MANUAL` with either).
- R15.3: assignment first. Then the source: `TEAM` is today's rule. `PERSONAL` is the member's own projection, where a working step of an active member is a Personal Shift counted with the effective team (R11.1), else none. `MANUAL` gives nothing. Roster overrides apply on top.
- R15.4: a team's Shift Type Override never changes a personal rotation's shift. A team's Scheduled Shift (`scheduleOfMonth`) never changes.
- A personal rotation's shift reaches everything that reads a member's shifts: hours (source `PERSONAL`), leave cost, collisions, R12 and staffing groups (R14.5, R14.6).
- R15.6: with no version (absent, `[]`, only `TEAM`, or effective after the window), every output is byte-identical. New fields are ABSENT, never `null` or `false`.
- Pure, ids and codes only (AD-7, AD-8).

**Ask First:** none (unattended; decisions recorded in Design Notes).

**Never:** no migration, table, RPC, snapshot read, assembly or parity-fixture change, and no UI (21.10). No reminder item form, `:p:` subject or `-p-` UID (21.10: see Design Note 5). No holiday rule (21.15). No change outside `packages/domain` and the documents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| None | both fixtures (with and without assignments); versions absent, `[]`, `TEAM` only, or effective after the window | every digest equals its baseline | none |
| R15.7 | W in rotation-less D, `PERSONAL` from 03-02 on [t1×5, off×2, t2×5, off×2] at the first step; `OFF` assignment on 03-10 | t1 in weeks one and three, t2 in weeks two and four, all `@D`, hours `PERSONAL`; the 10th free, the 11th t2 again | none |
| Manual only | 24-hour team member `MANUAL` from mid-month | on the team's base roster before, on none from that date on; only assigned shifts after | none |
| Override of the team | team Shift Type Override on a personal-rotation date | the member's shift unchanged; the team's cell changed | none |
| Not active / no team | inactive date; member on no team | no shift; shift `teamId: null` | none |
| Roster overrides | one putting a `PERSONAL` member on the team they count with / on another team; one taking them off; one putting a `MANUAL` member on their team | inert / applies (double booking) / inert / applies | none |
| Malformed | bad version as listed above; pattern steps missing; offset step not in the pattern | — | `RangeError` |

## Epic AC Deviations

- Epic rule "a new input to the projection reaches the browser's read, `member_schedule_inputs` and both parity fixtures in the same story (AD-19)": `scheduleVersions` is optional here and nothing fills it. The table, the reads, the assembly and the parity fixtures are 21.10's, as its own AC says ("the assembly and parity fixtures carry versions"). This follows the epic's story split and is not deferred.
- AC 1 "its working shifts are Personal Shifts counted with the effective team": as R14.3, a member on no team has a Personal Shift with no team (`teamId: null`). This reading is narrowed, not deferred.
- AD-18/AD-20's personal-rotation forms (deferred-work, "OWNER story 21.9 (with 21.10)"): the reminder item `PERSONAL_ROTATION`, its `:p:` subject and the `-p-` UID ship with 21.10, the first change that feeds a version to the server. This story adds the domain marker they read. DEFERRED to 21.10 (`deferred-work.md`).
- AC 1 "assignment, then source, then roster overrides": roster overrides still apply on top, except one that puts a personal-rotation member on the team their rotation counts with. That override is inert on every date of the rotation, whatever the step (R15.8, Design Note 3), as R14.9 makes one inert for an assignment counted with that team. One taking them off is inert because they are on no base roster (R14.2). The admin changes such a day with a Personal Assignment, which is step 1. This reading is narrowed, not deferred. The calendar flows that would still offer such an override are 21.10's (`deferred-work.md`). Founder confirmation is asked in the report. *(Added by the review, 2026-11-25.)*

</frozen-after-approval>

## Code Map

- `packages/domain/src/personal.ts` -- NEW `SCHEDULE_SOURCE_TEAM|PERSONAL|MANUAL`, `ScheduleVersion` `{ effectiveFrom, source, patternId, offsetStepId }` (no `memberId`: it rides on the member), `checkScheduleVersions`, `scheduleSourceOn(versions, date)` (WeakMap-cached, like `indexOf`), `personalRotationShiftTypeOf(version, steps, date)` (R1 through `projection.ts`'s `stepOnDate`, anchor = `effectiveFrom`, ordered steps cached per list and pattern) and `personalRotationShiftOf` (projects before the activity check, so a bad pattern is refused on any date). `PersonalShift` becomes a union: `personalAssignmentId` or `personalRotation: true`. Imports `projection.ts` (which imports only `calendar.ts`: no cycle).
- `packages/domain/src/projection.ts` -- the R1 formula extracted as the internal `stepOnDate`, shared by teams and members. Team messages unchanged.
- `packages/domain/src/roster.ts` -- `RosterMember.scheduleVersions?`. `shiftRoster` also skips a member whose source is not `TEAM`. `personalShiftOn(member, date, working, steps)` (`steps` required, so every caller passes them): the assignment's shift, else the personal rotation's. `countsWithOn` (R14.9) treats a `PERSONAL` member as counting with their effective team (Design Note 3).
- `packages/domain/src/schedule.ts` -- `MemberScheduleInput.scheduleVersions?`, read like loans (`scheduleVersionsOf`, a mismatch throws). In `memberScheduleOfMonth`: with no assignment, `PERSONAL` gives the Personal Shift (`personalRotation: true`, `projectedShiftTypeId: null`), and `MANUAL` gives none. `MemberShift.personalRotation?: true`.
- `packages/domain/src/staffing.ts` -- `personalShiftsIndexOf` also indexes members with any schedule version (a `TEAM`-only list gives no shift) and passes `input.steps`.
- `packages/domain/src/hours.ts` -- `sourceOf` gives `PERSONAL` for `personalRotation` too.
- `packages/domain/src/at-work.ts` -- `ScheduleMember.scheduleVersions?`, passed to the month. `AtWorkShift.personalRotation?: true` carried.
- `packages/domain/src/collisions.ts` -- mapper passes `scheduleVersions`. `leave.ts`: unchanged (it follows through the month).
- `packages/domain/src/shift-reminders.ts` -- skips a `personalRotation` shift until 21.10 ships its item form (Design Note 5).
- `packages/domain/src/index.ts` -- exports.
- `packages/domain/test/derivation.ts` -- NEW: `personal.test.ts`'s fixture organization and `derivedFiguresOf`, moved with their bodies unchanged and now exported, so both tests share them.
- `packages/domain/test/schedule-source.test.ts` -- NEW: R15.6 digests pinned on the baseline before any source edit (both fixtures with assignments; parity R12 as 21.2 left it; `staffingOn`), the R15.7 example and the matrix.
- Web (`apps/web` mappers spread `...member` or pass `members`, so they follow; deliberately left), ICS, Edge: unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/test/derivation.ts`, `personal.test.ts`, `schedule-source.test.ts` -- move the helpers, then write and pin the R15.6 digests on the unchanged engine.
- [x] `packages/domain/src/{personal,roster,schedule,staffing,hours,at-work,collisions,index}.ts` -- the rule as mapped.
- [x] `packages/domain/test/schedule-source.test.ts` -- R15.7, every matrix row, key-absence, staffing group, collision `teamId`, R12 marker.
- [x] `_bmad-output/specs/spec-shift/engine-rules.md` -- R15.8, the domain's decisions (Design Notes 1–4).
- [x] `ARCHITECTURE-SPINE.md` -- AD-26 `Amended 2026-11-25 (story 21.9)`: the shape as built.
- [x] `deferred-work.md` -- the 21.9 (with 21.10) entry `RESOLVED in part` (the marker), the rest owned by 21.10. `epic-21-context.md`: the shape. `sprint-status.yaml`: 21.9 `review` (built, CI pending).

**Acceptance Criteria:**
- Given no schedule version, when every figure is derived over both fixtures, then each digest equals the one pinned at the baseline.
- Given R15.7 and the matrix, when derived, then the results match each row.
- Given the domain, ICS and web suites and the DB-free root tests, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended, the 21.1 precedent): one deviation was added to the frozen `## Epic AC Deviations` at the epic AC auditor's finding: R15.8's inert roster override, narrowing AC 1's "then roster overrides". It was already in Design Note 3, R15.8 and `deferred-work.md`, so listing it changes no intent. Known-bad state avoided: an unlisted deviation. KEEP: the R15.6 digests pinned on the baseline engine, versions riding on the member, and no steps in a roster read.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4 that apply). The unrun-DB-test layer had nothing to audit: no DB test, migration function or Edge Function changed.
- intent_gap: 0. bad_spec: 0 (the deviation addition is recorded above).
- patch: 12 (high 0, medium 5, low 7). defer: 0 new (the 21.10 entries were written in planning and widened). reject: 7.
- addressed_findings:
  - `[medium]` `[patch]` No test projected an offset step other than the first, so dropping the offset term passed. Added a `w7` case: W starts on 2. smjena, and the 16th is 2. smjena (verification-gap).
  - `[medium]` `[patch]` Staffing never saw a personal-rotation member on an inactive date, nor a rotation-less team's groups. Added D's groups on the 2nd, 24th and 26th (V inactive from the 25th), and `personalShiftOn` null for V (verification-gap, blind).
  - `[medium]` `[patch]` `personalShiftOn`'s `steps = []` default would throw for any caller that left it out. `steps` is now required (edge-case, blind).
  - `[medium]` `[patch]` An early version would send a teamed personal-rotation shift as a team reminder, or a teamless one would refuse the chunk. `shiftRemindersDueOf` now skips them until 21.10, with a test that a team shift still gets its item (edge-case, blind).
  - `[medium]` `[patch]` AC 1's roster-override narrowing was missing from the deviations. It is now listed, and founder confirmation is asked in the report (epic AC, blind).
  - `[low]` `[patch]` The R1 formula was copied. It is now `projection.ts`'s `stepOnDate`, shared, with each pattern's ordered steps cached per list (blind, edge-case).
  - `[low]` `[patch]` A bad pattern was refused only on active dates. It is now projected first (blind).
  - `[low]` `[patch]` `PersonalShift` is a union, so exactly one of `personalAssignmentId` and `personalRotation` is set (blind).
  - `[low]` `[patch]` `steps` docs now name schedule versions' patterns. The 21.10 entry says the assembly must carry a pattern no team uses (edge-case).
  - `[low]` `[patch]` Added tests: a loan moving the counted team, an assignment counted with another team on a rotation date, and a half-day record's worked half (blind).
  - `[low]` `[patch]` The tests no longer hard-code the neutral cases' count, and they assert that the "later" date is after the parity window. The local `figuresOf` was renamed `guardedFiguresOf`. The R15.4 citation for roster overrides now cites R15.8 (blind).
  - `[low]` `[patch]` The sprint status read `in-progress` while the spec said review. It is now `review` (built, CI pending) (blind, epic AC).
  - Rejected:
    - Freezing the inputs or keying the caches on content: the domain's inputs are read-only by contract, and 21.1's `WeakMap` index does the same.
    - Treating an `undefined` `patternId` as `null` on `TEAM`/`MANUAL`: the type is `string | null`, and the assembly writes SQL nulls.
    - Refusing a month input's versions when the member has no `members` entry: this is the loans rule (18.1), and a member with no entry is on no roster either.
    - Skipping a personal rotation in `@shift/ics`: it is outside this story's package, and the teamed UID cannot collide (Design Note 5).
    - Splitting the 21.2 deferred entry: the `RESOLVED in part … Original:` form is the repository's convention. The new text corrects the original's stale "RangeError" claim.
    - A spec status `in-review` against the sprint's `review`: two lifecycles, as in 18.1 and 21.1.
    - Blank lines and unused imports left in `personal.test.ts`: `tsc` (no unused locals) and `pnpm lint` are clean.

## Design Notes

1. **Rides on the member**, read like loans: `MemberScheduleInput.scheduleVersions` must equal the member's entry. No `memberId` and no anchor column: the offset step is the step the member stands on at `effectiveFrom` (R15.1: "projected from its effective date").
2. **A personal rotation's shift** is a Personal Shift (R15.3). It has `projectedShiftTypeId: null` and is never `overridden` or `rosterChanged` (R14.9). It carries `personalRotation: true` and no `personalAssignmentId`. A non-working step is a day off.
3. **Roster overrides onto the team a personal rotation counts with are inert** on every date of that source, whatever the step. This mirrors R14.9: the member's days with that team are their rotation's, and the admin changes one with a Personal Assignment (R15.3, step 1). An override onto another team applies (a double booking). One taking them off a base roster they are not on is inert. A `MANUAL` member has no team plan, so an override putting them on applies. This needs no steps in a roster read, so `rosterOn`'s web callers follow unchanged.
4. **Staffing** reads `input.steps` for the groups. Each member is counted once per shift, as R14.9 says.
5. **No producer yet.** Nothing outside the tests sets `scheduleVersions` until 21.10's table and assembly. So no personal-rotation shift reaches the feed or `remind` here. All the same, `shiftRemindersDueOf` skips one, so an early version cannot send a team-form item or refuse a chunk. In the feed (`@shift/ics`, outside this story's package), a teamless one is left out. A teamed one would get the team UID `<date>-<team>-<member>`. It cannot collide with a team shift of that member, team and date, because the member is on no base roster and an override onto that team is inert (R15.8). The reminder form, its SQL and the UID read `AtWorkShift.personalRotation` and ship with 21.10's assembly in one change, as 21.2 did for assignments. 21.10 removes the skip.
6. **`steps` holds the patterns of schedule versions too.** A pattern no team uses must still be in the input, or the member's month throws (`has no steps`), as a team's would. 21.10's assembly owes this (`deferred-work.md`).

## Verification

**Commands (run 2026-11-25, after the review patches):**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test` -- 24 files, 1068 tests passed (`schedule-source.test.ts`, 26 tests, with its five baseline digests, and `personal.test.ts` with 21.1's three).
- `pnpm --filter @shift/ics test` -- 4 files, 33 tests passed.
- `pnpm --filter ./apps/web test` -- 191 files, 7068 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 2 files, 2600 tests passed.
- Digest provenance: `BEFORE_SCHEDULE_SOURCE` was computed by `schedule-source.test.ts` with `packages/domain/src` untouched at `e1b6a65` (only the helper move in `test/` done). 21.1's `BEFORE_PERSONAL` digests still pass after the move.
- Rebased on 21.5 (#372) and re-run: typecheck and lint clean; domain 25 files, 1099 tests; ICS 33; web 193 files, 7113 tests; DB-free root 2647; the R15.6 and R14.7 digests unchanged. CI on the pre-rebase head (#373) was green, 14 of 14.
- Not run locally: the DB-connecting root tests, read and runtime parity, and e2e (STRICT DATABASE RULE). No migration, parity fixture, assembly or surface changed. CI ran them: run 45693482874 (head `4bc25ad`, before the rebase) and run 45696214982 (head `c4f06f6`, the merged head) both passed, with no failed run and no CI-only fix. `CI passed` was green on the merged head, with Test (Vitest, local Supabase), Runtime parity (Node and edge-runtime) and E2E shards 1–4 all successful.

**Residual risks:**
- R15.8, the inert roster override onto a personal rotation's own team (even on its day off), is a product decision taken unattended. It mirrors R14.9 and is listed for the founder to confirm.
- Process note: the implementation ran in the orchestrating session, as 21.1's did, so the digests could be pinned on the unchanged engine first. Review ran with four context-free subagents.

## Suggested Review Order

**The rule (R15.2, R15.3)**

- Entry point: a member's day, assignment first, then the source; manual only gives nothing.
  [`schedule.ts:563`](../../packages/domain/src/schedule.ts#L563)

- Only team-rotation members join a base roster, so every roster reader follows.
  [`roster.ts:299`](../../packages/domain/src/roster.ts#L299)

- The version in effect on a date; none means `TEAM`.
  [`personal.ts:269`](../../packages/domain/src/personal.ts#L269)

- R1 for a member, anchored on the version's `effectiveFrom`.
  [`personal.ts:313`](../../packages/domain/src/personal.ts#L313)

- The one R1 formula, now shared by teams and members.
  [`projection.ts:208`](../../packages/domain/src/projection.ts#L208)

- Staffing's view of a member's own shift: assignment, else personal rotation.
  [`roster.ts:343`](../../packages/domain/src/roster.ts#L343)

**Roster overrides on top (R15.8)**

- An override onto the team a personal rotation counts with is inert.
  [`roster.ts:517`](../../packages/domain/src/roster.ts#L517)

**What reads it**

- Versions read like loans; a mismatch with the member's entry throws.
  [`schedule.ts:400`](../../packages/domain/src/schedule.ts#L400)

- Staffing groups receive the steps.
  [`staffing.ts:160`](../../packages/domain/src/staffing.ts#L160)

- Hours tag the shift `PERSONAL`.
  [`hours.ts:315`](../../packages/domain/src/hours.ts#L315)

- R12 carries the `personalRotation` mark, absent otherwise.
  [`at-work.ts:288`](../../packages/domain/src/at-work.ts#L288)

- Reminders skip it until 21.10 ships the item form.
  [`shift-reminders.ts:104`](../../packages/domain/src/shift-reminders.ts#L104)

- The shift's type: exactly one of an assignment id and the rotation mark.
  [`personal.ts:80`](../../packages/domain/src/personal.ts#L80)

**Proof**

- R15.6 digests pinned on the baseline engine.
  [`schedule-source.test.ts:119`](../../packages/domain/test/schedule-source.test.ts#L119)

- R15.7 and the matrix.
  [`schedule-source.test.ts:343`](../../packages/domain/test/schedule-source.test.ts#L343)
