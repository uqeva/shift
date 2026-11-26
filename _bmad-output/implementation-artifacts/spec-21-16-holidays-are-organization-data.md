---
title: '21.16 Holidays are organization data'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '14b3e58ed2a88b5490a589b798afc5b59a256386'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

Status: done — merged with 21.17 as PR #380, squash `69ef8fc`, `CI passed` green. CI: run 45756975501 failed on `e2e/tests/calendar/layout.spec.ts`, whose hand-injected team rows lacked `off_on_holidays` (the 21.16 parser requires it), fixed for CI by `523deb7`; run 45758802426 green. Baseline: `main` at `14b3e58` (21.15 merged, PR #378; 21.10 merged, PR #377). Migration `0080` (main is at 0079). Hot file `hr.json` (history labels only); 21.17 was built on the same branch and merged with it (PR #380).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.15's holiday rule reads `HolidayRule` on every schedule input, and nothing fills it: there is no table, no team flag, no read and no assembly, so holidays still need a shift-type override per team and date.

**Approach:** Migration 0080 adds `organization_holidays` (one per organization and date) and `teams.off_on_holidays` (AD-27), and re-creates `private.member_schedule_inputs` with the holiday dates in the window and the off teams. The calendar snapshot reads both, one helper turns them into the rule, and every input the browser builds carries it, the previews' before and after included. `scheduledShiftTypeOn` takes the rule optionally, so its browser callers apply it. Both parity fixtures gain a holiday and an off team.

## Boundaries & Constraints

**Always:**
- `organization_holidays`: `organization_id` first; `id`; `date` (0001–9999); `name` non-blank by `private.name_key`, at most 100 characters, 0076's control class; `created_by`/`created_at` (AD-11); `unique (organization_id, date)`; RLS: every active member of the claimed organization reads, an active admin inserts (`created_by` pinned), updates `name` only (column grant) and deletes. No policy reads its own table. 0023's lock and 0035's re-check (insert, update, delete); both audit triggers; TRUNCATE revoked from every role; `anon` nothing.
- `teams.off_on_holidays boolean not null default false`; `authenticated` gains UPDATE on it under the existing policy.
- `member_schedule_inputs` (from 0079, only additions): `holidays` the dates in the window by date, `teamsOffOnHolidays` the flagged team ids (archived too) by id; `[]` for none. The browser adapter answers the same, so read parity holds. Names are never carried.
- Snapshot: `holidays: { id, date, name }[]` by date; `TeamRow.offOnHolidays`; `DEVICE_SNAPSHOT_SHAPE` 7. `holidayRuleOfCalendar(snapshot)` is the one recipe, spread by `snapshotScheduleInputOf`, the month grid and the day detail.
- `scheduledShiftTypeOn(…, holidays?)`: absent, exactly today's answer; given, R13.3, an emptied team answers `shiftTypeId: null` with its projected type kept. Day detail, `resolved-conflicts`, `erasures`, `replacement-effect` pass it; the day detail passes `personalShiftOn`'s `holidays` too.
- Absent or empty lists: every web and domain output is unchanged (R13.5). A holiday notifies nobody (E-3): no trigger enqueues anything.
- Feed and reminders: they read the assembly, so a holiday-off shift has no event and no reminder, with no code of their own.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no admin surface, import, `hr.json` holiday names or team-dialog switch (21.17); no calendar marks or *blagdan* text (21.18); no holiday hours (21.19); no new RPC or server function; no change to the Edge functions' code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No holiday | none stored, no team off | snapshot `holidays: []`, every team `offOnHolidays: false`; every derivation as before | none |
| Off team | D off, holiday H, D projects Dan | month cell, day detail, collisions, staffing, at-work: D works nothing on H; projected kept | none |
| Working team | K not off, holiday H | K works its projection, no mark | none |
| Assembly window | holidays before, in and after the window | only those in it, by date | none |
| Malformed read | a holiday row without a date, or a team without the flag | the calendar read is unavailable | `CALENDAR_UNAVAILABLE` |
| Second holiday same date | insert | refused | 23505 `organization_holidays_organization_date_key` |
| Member write / rename date / truncate | member insert; admin update of `date`; TRUNCATE | refused | 42501 |

## Epic AC Deviations

- AC 1 "RLS (all active members read, an active admin writes, rename by `name` only), audit triggers and the column grant": met; the DB cases are written unrun (STRICT DATABASE RULE) and CI runs them.
- AC 2 "the feed and reminders drop holiday-off shifts with no code of their own": met through the assembly; no new feed or reminder test is pinned beyond the parity fixtures and the domain's own (R12 reads the rule since 21.15).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0080_organization_holidays.sql` -- NEW. Patterns: `0078_job_roles.sql` (table, checks, policies, revokes, grants, audit pair), `0079_member_schedule_versions.sql:286-301` (lock and re-check triggers), `:504-725` (`member_schedule_inputs`, re-created with two keys). `0071`'s `refuse_write_by_stale_admin` is generic (reads `organization_id`).
- `packages/domain/src/overrides.ts:144` -- `scheduledShiftTypeOn` overloads (sixth `holidays`), `holidayOffOf` once; `packages/domain/test/overrides*.test.ts` or `holidays.test.ts` -- the widened call.
- `packages/domain/parity/fixtures.ts` -- PILOT and UJ5 gain `holidays` and `teamsOffOnHolidays` (dates in 2027 summer, after the 21.10 additions; UJ5's off team is B, which m2's personal rotation counts with). Digest tests that pin a pre-holiday engine over the fixtures strip both lists (`holidays.test.ts` `guardedFiguresOf`, `personal.test.ts` `withoutAssignments`, `schedule-source.test.ts` `atWorkOf`, any other that fails); `parity-fixture.test.ts` asserts both fixtures hold an off team and a holiday it works on.
- `apps/web/src/features/teams/services/list.ts:35,84,105` -- `TEAMS_COLUMNS` + `off_on_holidays`; `TeamRow.offOnHolidays` (required boolean); parser refuses a non-boolean. Every `TeamRow` fixture gains it.
- `apps/web/src/features/rotation/services/list.ts` -- deliberately left in code: it embeds `teams(${TEAMS_COLUMNS})` and parses with `teamRowOf`, so the rotation read selects and requires the flag through the shared constant (its test pins the column list). So do the *Timovi* list and every other `TEAMS_COLUMNS` reader.
- `apps/web/src/features/calendar/services/snapshot.ts:172,358,573+` -- embed `organization_holidays(organization_id,id,date,name)`; `CalendarHoliday`; `holidays` checked (tenant, date, name, one per date) under a new refusal `'holiday'`; `holidayRuleOfCalendar`.
- `apps/web/src/features/calendar/services/schedule-inputs.ts` -- `holidays` (in window, sorted), `teamsOffOnHolidays` (flagged, sorted).
- `apps/web/src/lib/offline/persistence.ts` -- shape 7.
- `apps/web/src/features/calendar/utils/month.ts:1261,1493` -- `snapshotScheduleInputOf` and `calendarMonthOf`'s `scheduleOfMonth` spread the rule (so `staffingInputOf`, `memberScheduleInputOf`, `collisionInputOf` and every preview built from an "after" snapshot follow).
- `apps/web/src/features/calendar/utils/day-detail.ts:341,436` -- `personalShiftOn(…, rule)`; `scheduledShiftTypeOn(…, rule)`; an emptied team is `DAY_OFF` with `shiftTypeId: null`, projected kept.
- `apps/web/src/features/conflicts/services/{resolved-conflicts.ts:387,erasures.ts:199,replacement-effect.ts:127,171}` -- pass the rule; a null type is not working. `override-erasures.ts:137` -- deliberately left: it reads the projection alone, which a holiday keeps.
- Previews deliberately unchanged in code (they spread the snapshot recipe): `planning/services/manual-preview.ts`, `manual-save.ts`, `members/services/{schedule-source,loan,team-move-preview,deactivation-consequence}.ts`, `calendar/utils/change-preview.ts`, `hours/*`, `leave/*`, `today/*`, `staffing/*`, `calendar-feed/services/month-download.ts` (the adapter).
- `packages/domain/src/history.ts` -- record `holiday` (`organization_holidays`), field `offOnHolidays` (`off_on_holidays`, boolean); `apps/web/src/features/history/services/history-rows.ts` + `hr.json` -- their labels.
- Root catalogs (written unrun unless DB-free): `test/provisioning.test.ts` (RLS and audited lists, the privilege case, the audited-table count), `test/rls-isolation.test.ts` (policy list, AUDITED_TABLES, new cases), `test/name-key.test.ts` (the name constraints), `test/supabase-scaffold.test.ts` (DB-free: policy list, the migration's text, the audited key map), `test/schedule-inputs-parity.test.ts` (scene: a holiday in the window, one after it, an off team; reset in `afterAll`), `test/concurrent-writes.test.ts` (trigger inventory if it lists lock tables).
- `e2e/utils/database-helper.ts` -- cleanup deletes an organization's holidays and resets the flag (the table references `organizations` only).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0080_organization_holidays.sql` -- the table, column and assembly as in Always.
- [x] `packages/domain` -- `scheduledShiftTypeOn` overload; fixtures; digest tests strip; history record and field.
- [x] `apps/web` -- teams read, snapshot, rule recipe, adapter, persistence, month, day detail, conflict services, history labels; unit tests for the matrix (parser refusals, adapter windowing and order, emptied cell and day detail, erasure `teamWorks`).
- [x] Root catalogs and parity scene, e2e cleanup -- as mapped.
- [x] Docs: spine AD-27 and AD-19 `Amended 2026-11-26 (story 21.16, 0080)` (as shipped); `epic-21-context.md`; `deferred-work.md` (the 21.16 entry RESOLVED); `sprint-status.yaml` 21.16 `review`, 21.15 `done` with its spec's Status and CI lines rewritten.

**Acceptance Criteria:**
- Given no holiday and no team off, when every suite runs, then every digest and snapshot test holds unchanged except where a new field is asserted.
- Given the fixtures with a holiday and an off team, when the domain derives at-work shifts, then the off team's shift on the holiday is gone and every other shift is as before.
- Given the domain, ICS and web suites, typecheck, lint, build and the DB-free root tests, when run, then they pass.

## Design Notes

1. **One recipe.** `holidayRuleOfCalendar` returns `{}` when there is no holiday or no team off, so every input built from a holiday-free snapshot is key-for-key what it was (R13.5 in the browser, and no test snapshot of an input changes).
2. **Previews follow by construction.** An AD-5 "after" is a snapshot; 21.17's holiday and flag writes only need an "after" with the list or the flag changed.
3. **`scheduledShiftTypeOn` overloads.** Without the sixth argument the type and the value are 21.15's; with it the answer is `LayeredShiftType`, so a caller must treat `shiftTypeId: null` as no working shift.
4. **Deploy order.** `db push`, then the SPA: the SPA selects the new column and table. An SPA deployed before the push (or over a rolled-back 0080) loses not only the calendar read but every read that selects `TEAMS_COLUMNS`: the *Timovi* list and the rotation read are unavailable too, until the push lands.

## Verification

**Commands (run 2026-11-26, re-run after review pass 1):**
- `pnpm --filter @shift/domain build && pnpm typecheck && pnpm lint` -- clean (root, e2e, smoke, perf, landing, domain, ics and web projects).
- `pnpm --filter @shift/domain test` -- 26 files, 1155 tests passed. The three pre-holiday digest suites (`holidays.test.ts` `atWorkOf`, `personal.test.ts` `withoutAssignments`, `schedule-source.test.ts` `atWorkOf`) strip the fixtures' new lists and hold their digests unchanged; `history.test.ts` covers the 27 audited tables.
- `pnpm --filter @shift/ics test` -- 4 files, 35 tests passed (the golden window ends 2026-10-31, before the fixtures' 2027 holidays; one new case over the pilot's 2027-08 holidays).
- `pnpm --filter ./apps/web test` -- 199 files, 7230 tests passed.
- `pnpm build` -- clean.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 2 files, 2765 tests passed (the 0080 text block, the seventy-seven policies, the audited key map).
- `pnpm exec vitest run test/localization-applied.test.ts test/import-cycles.test.ts` -- 2 files, 326 tests passed (DB-free; the history key-source count is 176).
- No CSS or token change, so the theme root files were not needed. gitleaks is the orchestrator's (not run here).
- Not run locally (STRICT DATABASE RULE): `test/provisioning.test.ts`, `test/rls-isolation.test.ts`, `test/name-key.test.ts`, `test/concurrent-writes.test.ts`, `test/schedule-inputs-parity.test.ts`, the claimless and suspended sweeps (catalog-driven, no list to extend), and e2e. They fail locally only because 0080 is unapplied; CI's fresh stack is their gate.

**Matrix coverage:**
- No holiday -- `apps/web/src/features/calendar/utils/holidays.test.ts` (`[]`, every flag false, no holiday key on the shared input, a holiday with no team off and a team off with no holiday derive the same month, day detail and day list), `snapshot.test.ts` (`holidayRuleOfCalendar` is `{}`), `schedule-inputs.test.ts` (`[]` for both lists), and the domain's R13.5 guards.
- Off team -- `holidays.test.ts` (web): the month cell, the domain cell keeping `projectedShiftTypeId`, the day detail, ANA's day list (at work), collisions, staffing, the erasure guard's `teamWorks: false` and an unapplied replacement; the domain's parity-fixture cases (`holidays.test.ts`, `parity-fixture.test.ts`) and the adapter's R12 case.
- Working team -- `holidays.test.ts` (web) for B on the holiday, with no mark on the domain cell; `parity-fixture.test.ts` (a team not off works a holiday).
- Assembly window -- `schedule-inputs.test.ts` (in the window, by date; off teams by id; no name), the parity scene (written unrun: before, in and after the window), and the scaffold's text of the re-created assembly.
- Malformed read -- `snapshot.test.ts`: a holiday row without a date, a bad date, a blank or non-text name, one id twice, two on one date, no embed, and a team without the flag or with a non-boolean, each `CALENDAR_UNAVAILABLE`; `list.test.ts` for the team parser.
- Second holiday same date -- `rls-isolation.test.ts` (written unrun): 23505 `organization_holidays_organization_date_key`.
- Member write / rename date / truncate -- `rls-isolation.test.ts` (written unrun): member insert 42501, admin `date` update 42501, TRUNCATE 42501 for admin and member; `provisioning.test.ts` pins the column grants and the truncate refusal for every role.

**Residual risks:**
- SETTLED BY CI (PR #380): every DB-connecting case above (`provisioning`, `rls-isolation`, `name-key`, `concurrent-writes`, the parity scene) passed in run 45758802426, the `pg_get_triggerdef` assumption included. The one CI failure (run 45756975501) was not this story's DB cases: `layout.spec.ts`' injected team rows lacked `off_on_holidays`, fixed by `523deb7`.
- RESOLVED by 21.18: an emptied cell reads *blagdan* with the star, and each holiday is named on its date.

## Review Triage Log

**Review pass 1 (2026-11-26).** Layers: blind, edge-case, verification-gap, epic AC, unrun DB test (5 of 5). The epic AC auditor found no deviation.

Patched:
1. 0080 re-creates `teams_serialize_organization_writes` and `teams_refuse_write_by_stale_admin` as `before update of archived, off_on_holidays` (0035's functions and levels), so a flag change is serialized and re-checked; pinned in `concurrent-writes`, the scaffold's 0080 block, the migration header and the spine.
2. The day detail's override form offers the projected type on a holiday-emptied day and does not refuse it as the same (R13.3); the emptied day keeps its in-force roster overrides as inert. Tested.
3. Web tests added: a personal rotation counted with an off team is absent from its groups; a Personal Assignment on the holiday stays (grid and day detail); an override on the holiday wins (grid and day detail); the decided tab names no type and no times for a null stored type on an emptied date; `effectiveResolutionsOf` drops a resolution whose stored type the holiday emptied and `heldByReplacement` is false for it; ANA's day list on the holiday is pinned exactly.
4. Read parity: the emptied holiday's date is read from the server's R12 of the member before any holiday exists (the first loan date with a shift of the loan team, clear of every other scene date), and the case first asserts the plain R12 holds that shift; `afterAll` restores each flagged team's earlier flag.
5. RLS isolation: a holiday insert, rename and delete each write their `audit_events` row; a team flag change is recorded through `teams`' trigger; a cross-tenant flag write touches no row; a team insert naming the flag is 42501.
6. Parity fixtures: an override on the pilot's off team's holiday and a Personal Assignment on UJ-5's, stripped by the digest tests with the rule (digests unchanged), asserted by `parity-fixture.test.ts`; one reminders case (`shift-reminders.test.ts`) and one ICS case (`calendar.test.ts`): the off team's shift has no reminder and no event.
7. `holidayRuleOfCalendar` is memoized per snapshot (a `WeakMap`); the day detail builds it once per call and the replacement context once per context. `{}` stays for no holiday or no team off.
8. Code Map lists `rotation/services/list.ts`; Design Note 4 and the spine name the *Timovi* list and the rotation read among the reads an early SPA loses.
9. `epic-21-context.md`'s status bullet rewritten as of 2026-11-26.

Rejected:
- `holidayRuleOfCalendar` dropping the dates when no team is off: by design (R13.5). 21.18 and 21.19 read `calendar.holidays`, as the 21.18 deferred entry says.
- Browser-side validation of holiday names: display-only here; 0080 enforces them.
- `cleanUpHolidaysInSql` unused: it is for 21.17's e2e.
- The insert policy's WITH CHECK pre-empted by 0035's re-check for a member-role account: the same 42501, as on 0079's tables.
- The resolved-row wording for a holiday-removed shift (no type, no times): left to 21.18's holiday copy.

## Suggested Review Order

**The table and the flag (AD-27)**

- Entry point: one holiday per organization and date, admin writes, `name` the only update.
  [`0080_organization_holidays.sql:71`](../../supabase/migrations/0080_organization_holidays.sql#L71)

- The flag write now takes 0023's lock and 0035's re-check, as an archive does.
  [`0080_organization_holidays.sql:226`](../../supabase/migrations/0080_organization_holidays.sql#L226)

- The assembly gains the window's dates and the off teams; names never travel.
  [`0080_organization_holidays.sql:436`](../../supabase/migrations/0080_organization_holidays.sql#L436)

**The browser's read**

- The snapshot embeds the holidays; the team row carries its flag.
  [`snapshot.ts:192`](../../apps/web/src/features/calendar/services/snapshot.ts#L192)

- The one recipe, memoized, `{}` when nothing is off (R13.5 key for key).
  [`snapshot.ts:890`](../../apps/web/src/features/calendar/services/snapshot.ts#L890)

- The adapter answers what the assembly answers, for read parity.
  [`schedule-inputs.ts:154`](../../apps/web/src/features/calendar/services/schedule-inputs.ts#L154)

- The flag is strictly required of every team row.
  [`list.ts:116`](../../apps/web/src/features/teams/services/list.ts#L116)

**Every input carries the rule**

- The snapshot-wide schedule input, so staffing, collisions, hours and previews follow.
  [`month.ts:1272`](../../apps/web/src/features/calendar/utils/month.ts#L1272)

- The single-date layer takes the rule as an optional sixth argument.
  [`overrides.ts:148`](../../packages/domain/src/overrides.ts#L148)

- The day detail builds it once; an emptied day still offers the projected type as an override.
  [`day-detail.ts:446`](../../apps/web/src/features/calendar/utils/day-detail.ts#L446)

- The conflict services read a null type as no shift.
  [`replacement-effect.ts:113`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L113)

**Proof**

- Both parity fixtures hold a holiday, an off team, an override and an assignment on one.
  [`fixtures.ts:207`](../../packages/domain/parity/fixtures.ts#L207)

- The browser's matrix: emptied cells, groups, overrides, conflicts.
  [`holidays.test.ts:1`](../../apps/web/src/features/calendar/utils/holidays.test.ts#L1)
