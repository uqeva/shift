---
title: '21.15 The holiday rule in the domain'
type: 'feature'
created: '2026-11-26'
status: 'in-review'
baseline_commit: 'b130440313e475fbb52252785b82ec2298a9c532'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: built, CI pending (branch `feat/21-15-holiday-rule`, no PR yet). Baseline: `main` at `b130440` (21.6, 21.9 and 21.25 merged). Domain and documents only, no hot file, no migration (21.16 adds the table). 21.10 (migration 0079) may merge first; rebase and keep it.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A holiday empties day teams today only by a shift-type override per team and date (the staging workaround). R13 makes it one rule: on an organization holiday, a team marked off on holidays works nothing, its projected type kept beside it; 24-hour teams work as usual. Admins also need the Croatian list proposed for a year.

**Approach:** Holidays and the off teams enter the domain as two optional lists (dates, team ids) on every schedule input (AD-27). The one internal function that layers a team's scheduled type applies R13.3 (override, else holiday-off, else projection), so rosters, roster overrides, hours, R12, collisions, staffing and leave cost follow. A personal rotation counted with an off team is emptied the same way (R15.4); an assignment never is. `domain/holidays` adds `nationalHolidaysOf('HR', year)` with Easter by the Gregorian computus. Digests pinned on the unchanged engine prove R13.5 over both fixtures; R13.8 runs as a test.

## Boundaries & Constraints

**Always:**
- R13.3: `override ?? (holiday ∧ off ? none : projection)`; a date with no rotation in effect stays `null`. The holiday changes no phase.
- An emptied cell or member shift: `shiftTypeId: null`, `projectedShiftTypeId` kept, `overridden: false`, `holiday: true`, `offForHoliday: true`. An override that wins on such a date: its cell as today plus `holiday: true`. Both keys ABSENT everywhere else, so a team that works the holiday carries no mark.
- R13.2/R15.4: a personal rotation's working step counted with an off team on a holiday gives no shift; a Personal Assignment is never emptied.
- R13.5: holidays or off teams absent or empty → every output byte-identical (digests pinned before any source edit, over both fixtures with assignments and schedule versions, plus parity R12).
- Precondition breaches throw `RangeError`: a holiday that is not a calendar date, a date or team given twice.
- `nationalHolidaysOf('HR', year)`: the eleven fixed dates (01-01, 01-06, 05-01, 05-30, 06-22, 08-05, 08-15, 11-01, 11-18, 12-25, 12-26) plus Easter Sunday, Easter Monday and Corpus Christi (Easter + 60), `{ date, code }` in date order, for years 2020–9999 (the list in force since 2020); another country or year throws.
- Pure, ids and codes only (AD-7, AD-8).

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no migration, table, snapshot read, assembly, parity-fixture, `hr.json` or UI change. No holiday hours (21.19). No change outside `packages/domain` and the documents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Guard | both fixtures; rule absent, `[]`/`[]`, holidays without off teams, off teams without holidays, holidays outside the window | every digest equals its baseline | none |
| R13.8 | D off, [06–14 ×5, off ×2]; K 24-hour; holiday Wed 2026-11-18 | D's cell empty (projected kept, marks); D's roster empty; a week's leave costs 4; K works Dan, no mark | none |
| Override wins | D off, override on the holiday | cell works the override, `holiday: true`, no `offForHoliday` | none |
| Personal | rotation counted with D / with K / no team; assignment on the holiday | emptied / kept / kept / kept | none |
| Roster override | put-on onto D's holiday | inert (not working) | none |
| Bad input | `2026-02-30`; date twice; team twice; country `SI`; year 2019 | — | `RangeError` |

## Epic AC Deviations

- AC 1 "Cells carry `holiday` and `offForHoliday`": the marks are set only on a cell the holiday rule touched (the team is off on holidays and has a rotation that date), and absent on a team that works it. A date's holiday as such is read from the holiday list (21.16, 21.18). This keeps R13.5 strictly byte-identical with holidays and no team off. Reinterpreted, not deferred.
- AC 2 "as codes (R13.6)": met. AD-27's "names in `hr.json`" is the import UI's, so the keys land with 21.17 (hot file). DEFERRED to 21.17 (`deferred-work.md`).
- AC 1 "a team's scheduled type is layered … override, else holiday-off (none), else projection": every month derivation layers it, but the exported single-date `scheduledShiftTypeOn` (web day detail and conflict services) takes no rule yet and applies no holiday. Nothing fills the lists before 21.16, so nothing reads differently today. DEFERRED to 21.16 (`deferred-work.md`), with `personalShiftOn`'s optional `holidays` in the day detail. *(Added by the review, 2026-11-26.)*
- Epic rule "a new input to the projection reaches the browser's read, `member_schedule_inputs` and both parity fixtures in the same story (AD-19)": the lists are optional and nothing fills them yet. The table, reads, assembly and parity are 21.16's own AC. This follows the epic's split, as 21.9 did.

</frozen-after-approval>

## Code Map

- `packages/domain/src/holidays.ts` -- NEW: `HolidayRule` `{ holidays?, teamsOffOnHolidays? }`, internal `holidayOffOf(rule)` (checks, `null` when either list is empty: the fast path), `easterSundayOf(year)`, `nationalHolidaysOf(country, year)`, the code union.
- `packages/domain/src/overrides.ts` -- `applyOverride` (internal: `schedule.ts` and `scheduledShiftTypeOn`) gains the holiday operand and returns `LayeredShiftType` (`ScheduledShiftType` with optional `holiday`, or the emptied form). `scheduledShiftTypeOn` (exported; web day detail and conflict services call it) left unchanged: see Design Note 3.
- `packages/domain/src/schedule.ts` -- `ScheduleInput`/`MemberScheduleInput` extend `HolidayRule`; `ScheduleCell`/`MemberShift` gain `holiday?`/`offForHoliday?`; `scheduleOfMonth`, `rosterOverridesMadeInertOf`, `memberScheduleOfMonth` (team and personal-rotation branches), `appliedRosterOverrides` (null type is not working).
- `packages/domain/src/roster.ts` -- `personalShiftOn(…, steps, holidays?)` (over the internal `personalShiftWith`, which takes the built rule) empties a personal rotation's shift counted with an off team on a holiday.
- `packages/domain/src/staffing.ts` -- `personalShiftsIndexOf` passes the rule.
- `packages/domain/src/collisions.ts` -- the `Pick` and the mapper carry the two lists. `at-work.ts`: `ScheduleInputs` gains them, passed to the month. `hours.ts`, `leave.ts`: follow through `MemberScheduleInput` (no change).
- `packages/domain/src/index.ts` -- exports.
- `packages/domain/test/derivation.ts` -- `Organization.holidays?` spread by `shared` (absent → unchanged, so 21.1/21.9 digests hold).
- `packages/domain/test/holidays.test.ts` -- NEW: R13.5 digests pinned on the baseline engine, R13.8, matrix, computus, list.
- Web (`apps/web` spreads or passes inputs; the lists stay absent), ICS, Edge: unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/test/derivation.ts`, `holidays.test.ts` -- write the guard and pin its digests on the unchanged engine.
- [x] `packages/domain/src/{holidays,overrides,schedule,roster,staffing,collisions,at-work,index}.ts` -- the rule as mapped.
- [x] `packages/domain/test/holidays.test.ts` -- R13.8, every matrix row, key absence, list for 2026 and 2027, Easter across known years.
- [x] `engine-rules.md` -- R13.9, the domain's decisions. `ARCHITECTURE-SPINE.md` -- AD-27 `Amended 2026-11-26 (story 21.15)`: the shape as built.
- [x] `deferred-work.md` -- 21.16: browser callers of `scheduledShiftTypeOn`/`personalShiftOn` and the assembly pass the rule; 21.17: `hr.json` names. `epic-21-context.md`: the shape. `sprint-status.yaml`: 21.15 `review` (built, CI pending); 21.9 `done` with its spec's Status and CI lines rewritten (the toml's DONE rule).

**Acceptance Criteria:**
- Given no holiday or no team off, when every figure is derived over both fixtures, then each digest equals the one pinned at the baseline.
- Given R13.8 and the matrix, when derived, then the results match each row.
- Given the domain, ICS and web suites and the DB-free root tests, when run, then they pass.

## Spec Change Log

- 2026-11-26, review pass 1 (unattended, the 21.9 precedent): the epic AC auditor found `scheduledShiftTypeOn`'s holiday-free layering unlisted. A deviation was added to the frozen `## Epic AC Deviations` (it was already in Design Note 3 and `deferred-work.md`), and the Approach's "id lists" now reads "lists (dates, team ids)". No intent changed. Known-bad state avoided: an unlisted deviation. KEEP: the R13.5 digests pinned on the baseline engine, marks absent on a team that works the holiday, the one layer in `applyOverride`.

## Review Triage Log

### 2026-11-26 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4 that apply). The unrun-DB-test layer had nothing to audit: no DB test, migration function or Edge Function changed.
- intent_gap: 0. bad_spec: 0 (the deviation addition is recorded above).
- patch: 12 (high 0, medium 4, low 8). defer: 0 new (the 21.16/21.17 entries were written in planning and widened). reject: 6.
- addressed_findings:
  - `[medium]` `[patch]` A personal rotation counted with an off team with no rotation, or one an override makes work, was emptied by an unwritten rule. R13.9 now says so (the rotation-less day team is the pilot's case; R15.4), with tests (edge-case, blind).
  - `[medium]` `[patch]` `scheduledShiftTypeOn`'s holiday-free layering was an unlisted epic AC deviation. It is listed now (epic AC).
  - `[medium]` `[patch]` Staffing rebuilt and rechecked the rule per member and date. It now builds it once and reads the internal `personalShiftWith` (edge-case, blind).
  - `[medium]` `[patch]` No test for loans, a non-working override, collisions of an emptied personal rotation, or `rosterOverridesMadeInertOf` with the holiday on both sides or removed. Added (blind).
  - `[low]` `[patch]` An empty or non-string team id was accepted. It is refused now, and an unknown team id is a neutral guard case (edge-case, blind).
  - `[low]` `[patch]` Code Map: `personalShiftOn`'s argument is `holidays`; `applyOverride` also serves `scheduledShiftTypeOn` (verification-gap, blind).
  - `[low]` `[patch]` "id lists" was wrong for dates (spec, spine, context) (blind).
  - `[low]` `[patch]` `nationalHolidaysOf`'s doc contradicted itself on Corpus Christi; the 21.17 entry now says the second code is dropped in such a year (blind).
  - `[low]` `[patch]` `MemberShift`/`MemberScheduleDay` docs now name the emptied shift; the narrowing comment in `scheduledShiftTypeOn` says what it is (blind).
  - `[low]` `[patch]` The Easter weekday test used `Date`; it now uses `civilDayNumber` (blind).
  - `[low]` `[patch]` Import and export order in `staffing.ts` and `index.ts` (blind).
  - `[low]` `[patch]` The unattended decisions now have a founder entry in `deferred-work.md`, and 21.18 has an entry for the emptied personal rotation's day (blind).
  - Rejected:
    - Setting 21.6 and 21.25 `done`: each is set done, with its spec rewritten, by its own next story (21.7; 21.25 has none in this track). 21.9 is this story's dependency.
    - Exporting `LAST_YEAR`: the bound is documented on `easterSundayOf`.
    - `holidayOffOf`, `emptiedByHoliday` exported from `holidays.ts`: package-internal, as `applyOverride` is; not in `index.ts`.
    - Recording the 21.9 spec edit as a boundary breach: the toml's DONE rule requires it in the change that sets 21.9 done; it is now in the Tasks.
    - Refusing a team id that names no team: the domain has no team list here, as `teamIds` do not bound `assignments`.
    - The Easter loop's length: 8 400 years in well under a second.

## Design Notes

1. **One layer.** `applyOverride` is the only place a team's scheduled type is composed (`schedule.ts` and `scheduledShiftTypeOn`, which passes no rule), so every reader (cells, member days, put-on overrides, inertness, staffing) follows. An emptied type is `null`, which every reader already treats as no working shift (as before a rotation starts).
2. **Personal rotation on a holiday** gives no shift at all, as its non-working step does. The member day still says the date is a holiday through 21.18's list.
3. **`scheduledShiftTypeOn` stays holiday-free.** Its web callers (day detail, conflict services) get the rule when 21.16 brings holidays to the browser (`deferred-work.md`), the same change that fills the lists.
4. **Years.** Croatia's current list is in force since 2020; earlier years had other dates, so they are refused rather than proposed wrongly. `easterSundayOf` takes 1583–9999 (Meeus/Jones/Butcher).

## Verification

**Commands (run 2026-11-26):**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test` -- 26 files, 1139 tests passed (`holidays.test.ts`, 40 tests, with its three baseline digests; 21.1's and 21.9's digests unchanged). Re-run after the review patches, with every other command below.
- `pnpm --filter @shift/ics test` -- 33 tests passed.
- `pnpm --filter ./apps/web test` -- 197 files, 7172 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 2682 tests passed.
- Digest provenance: `BEFORE_HOLIDAYS` was computed by `holidays.test.ts` with `packages/domain/src` untouched at `b130440` (only `test/derivation.ts`'s optional spread added, which the baseline engine ignores). The at-work digest equals 21.9's `BEFORE_SCHEDULE_SOURCE['at-work']`.
- Not run locally: the DB-connecting root tests, read and runtime parity, and e2e (STRICT DATABASE RULE). No migration, parity fixture, assembly or surface changed. CI is their gate.

**Residual risks:**
- R13.9's readings were taken unattended and are listed for the founder in `deferred-work.md`: the cell marks are absent on a team that works the holiday; the Croatian list has a 2020 floor and holds a shared Corpus Christi date once; and a personal rotation is emptied even when its off team has no rotation or is overridden to work.

## Suggested Review Order

**The layer (R13.3)**

- Entry point: override, else holiday-off (none, projected kept), else projection.
  [`overrides.ts:108`](../../packages/domain/src/overrides.ts#L108)

- The rule as a predicate; `null` when either list is empty keeps every path byte-identical.
  [`holidays.ts:51`](../../packages/domain/src/holidays.ts#L51)

- The month's cells read it once per month.
  [`schedule.ts:207`](../../packages/domain/src/schedule.ts#L207)

- An emptied type is no working shift, so no roster override applies.
  [`schedule.ts:241`](../../packages/domain/src/schedule.ts#L241)

**A member's day (R13.2, R15.4)**

- The team branch and put-on overrides share the layered type.
  [`schedule.ts:584`](../../packages/domain/src/schedule.ts#L584)

- A personal rotation counted with an off team is dropped; an assignment never reaches this.
  [`schedule.ts:615`](../../packages/domain/src/schedule.ts#L615)

- Staffing's view of the same rule, built once.
  [`roster.ts:362`](../../packages/domain/src/roster.ts#L362)

- Staffing builds the predicate once per read.
  [`staffing.ts:209`](../../packages/domain/src/staffing.ts#L209)

**Inputs carried through**

- Collisions and R12 pass the two lists to the member's month.
  [`collisions.ts:197`](../../packages/domain/src/collisions.ts#L197)

- The AD-19 assembly's lists reach R12.
  [`at-work.ts:260`](../../packages/domain/src/at-work.ts#L260)

**The Croatian list (R13.6)**

- Fixed dates plus Easter, Easter Monday and Corpus Christi; a shared date listed once.
  [`holidays.ts:182`](../../packages/domain/src/holidays.ts#L182)

- The Gregorian computus.
  [`holidays.ts:103`](../../packages/domain/src/holidays.ts#L103)

**Proof**

- R13.5 digests pinned on the baseline engine.
  [`holidays.test.ts:121`](../../packages/domain/test/holidays.test.ts#L121)

- R13.8, the matrix and the review's cases.
  [`holidays.test.ts:340`](../../packages/domain/test/holidays.test.ts#L340)
