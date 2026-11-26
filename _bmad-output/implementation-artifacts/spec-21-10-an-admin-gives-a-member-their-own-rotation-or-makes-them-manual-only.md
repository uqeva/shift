---
title: '21.10 An admin gives a member their own rotation, or makes them manual only'
type: 'feature'
created: '2026-11-25'
status: 'in-review'
baseline_commit: 'd09fffb90f0bb967be10b4a08e3588e44050c640'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-9-the-schedule-source-rule-in-the-domain.md'
---

Status: built, CI pending (branch `feat/21-10-member-schedule-versions`, no PR yet). Baseline: `main` at `d09fffb` (21.6 merged; 21.9 merged at `0163497`). Migration `0079`. Touches `hr.json` (hot): no other in-flight story touches it except 21.25 (UI only; rebase on conflict).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 21.9 built the schedule-source rule (R15) in the domain, but nothing stores or reads a member's schedule version. Dispatchers who alternate weekly between 1. and 2. smjena, cleaners on mornings only and manual-only students still need a team rotation or per-date workarounds.

**Approach:** Migration 0079 adds `member_schedule_versions` (AD-26: versioned like `rotation_assignments`, written by an active admin under RLS, from the organization's today on, a scheduled one cancellable). The calendar snapshot and `member_schedule_inputs` carry every member's versions, so every derivation, the feed (`-p-` UID) and the reminders (`PERSONAL_ROTATION`, `:p:`) follow. The member page gets a *Raspored osobe* card whose dialog sets *Rotacija tima*, *Osobna rotacija* (an existing pattern, or step rows that define a new one; a start step; *Vrijedi od*) or *Samo ručno*, shows *Što se mijenja* and the AD-5 erasure check, and saves one row. The member is told once, `SCHEDULE_SOURCE_CHANGED { effectiveFrom, source }`.

## Boundaries & Constraints

**Always:**
- Table: `organization_id` first; `member_id`, `pattern_id`, `offset_step_id` composite keys (the step a step OF that pattern, AD-3); `source` `TEAM|PERSONAL|MANUAL`; pattern and step both set iff `PERSONAL` (named checks); `unique (organization_id, member_id, effective_from)`; dates in years 0001–9999; AD-11 `created_by`/`created_at`.
- Writes as 0016's rotation versions: insert by an active admin with `effective_from >= organization_today`, after the member's latest version, while no version is scheduled after today, and not equal to the source in force at that date (a `TEAM`/`MANUAL` row repeating it); delete only the member's latest version while it is after today. 0023's lock, 0035's stale-admin re-check and 0039's archived-type refusal are attached; `rotation_pattern_in_use` and the shift-type archive refusal also count member versions. RLS, both audit triggers, TRUNCATE revoked; every active member reads the rows.
- Notify: one `SCHEDULE_SOURCE_CHANGED { effectiveFrom, source }` to the member on an insert, and on a cancel with the source then in force from that date (E-3).
- Assembly and snapshot carry EVERY member's versions, whole (versioned rules are not windowed); `steps` keep every step of the organization, so a pattern no team uses projects. `DEVICE_SNAPSHOT_SHAPE` 6.
- Reminder `source: 'PERSONAL_ROTATION'` (nine keys, team or null), subject `md5('SHIFT_REMINDER:'||member||':'||date||':p:'||lead)`; the RPC skips it unless the member's version in force that date is `PERSONAL` and no live assignment holds that date. 21.9's skip in `shiftRemindersDueOf` goes.
- ICS: a personal-rotation shift is `<date>-p-<memberId>@<domain>`, teamless SUMMARY allowed.
- R15.8: the calendar's roster add flow and the conflict replacement candidates leave out a member whose source that date is `PERSONAL` and whose effective team is the shift's team. *Što se mijenja* lists the overrides the version makes inert.
- *Ručni raspored*'s row word from `scheduleSourceOn` on the month's last date: `PERSONAL` *osobna rotacija*, `MANUAL` *ručno*, `TEAM` today's rule. The day detail names a personal-rotation member `osobna rotacija`, not `ručno`.
- Copy in `hr.json`; the catalogs (`provisioning`, `rls-isolation` AUDITED_TABLES, `supabase-scaffold`, `notify-boundary`, `localization-applied`, key-sources, source-guards, `resource-hygiene`) follow.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no DB-connecting test, e2e or `supabase` command run locally; no change to `personal_assignments` or its save; no holiday rule; no Ljudi directory column (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Personal from today | admin, `PERSONAL`, a pattern, step 2, today | row inserted; member's month follows the pattern from step 2; one notice | — |
| Define a pattern | step rows `1. smjena ×7, 2. smjena ×7` | a new pattern and its 14 steps, then the version | definite version failure: the new pattern is removed best-effort |
| Manual only | `MANUAL` from a future date | on no base roster from that date; only assignments | — |
| Cancel | the latest version, after today | deleted; notice with the source then in force | in force already: refused (42501) |
| Past / second scheduled / repeat | before today; one already after today; `MANUAL` over `MANUAL` | refused | 42501 (policy); the dialog says why first |
| Archived type in pattern | pattern names an archived type | refused | 23514 `ROTATION_PATTERN_ARCHIVED_TYPE` |
| Erasure | the version ends a queued conflict's shift | confirmation before the write | — |

## Epic AC Deviations

- AC 3 "Given *Ručni raspored* and the directory … the row's source label and cells follow it": the grid's row label and cells follow; the *Ljudi* directory shows no source. DEFERRED (`deferred-work.md`): Ljudi's read and table are a separate change on hot sweep files.
- AC 1 "*Osobna rotacija* (an existing rotation pattern …)": widened, not narrowed — the dialog also defines a new pattern from step rows (the founder's dispatcher and cleaner patterns exist on no team). It is still a `rotation_patterns` row (R15.5).
- AC 1 "the member is notified `SCHEDULE_SOURCE_CHANGED`": a cancel notifies too, with the source in force after it (Design Note 3).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0079_member_schedule_versions.sql` -- NEW. Table, policies (inline subqueries, no new helper), triggers: `public.serialize_organization_writes`, `public.refuse_write_by_stale_admin` (0071's, unchanged: no team column), `public.refuse_assignment_on_archived_type` (0039's, reads `new.pattern_id`, null-safe), NEW `private.notify_schedule_version()`; re-created `public.rotation_pattern_in_use` (0016) and `public.refuse_archive_in_rotation` (0037), `private.member_schedule_inputs` and `public.enqueue_shift_reminders` (0077's, + additions).
- `packages/domain/src/shift-reminders.ts` -- `SHIFT_REMINDER_SOURCE_PERSONAL_ROTATION`, item form, skip removed. `packages/ics/src/calendar.ts:105-120` -- `-p-` UID.
- `packages/domain/parity/fixtures.ts` -- a `PERSONAL` version on a pattern no team uses, a `MANUAL` then `TEAM` pair, in 2027 outside the ICS golden and reminder clocks; tests pinning the pre-version engine strip them (`schedule-source.test.ts` `atWorkOf`).
- `apps/web/src/features/calendar/services/snapshot.ts` -- embed `member_schedule_versions(...)`, `CalendarMember.scheduleVersions`, viewer's too, checked by `checkScheduleVersions`. `services/schedule-inputs.ts` -- adapter carries them. `lib/offline/persistence.ts` -- shape 6.
- `apps/web/src/features/calendar/utils/day-detail.ts:317,324,905-960` -- personal rotation members join (steps passed: fixes main's TS2554), marked `personalRotation`; R15.8 in `rosterOffersOf`. `utils/month.ts:1499` -- staffing groups not prefiltered away for personal rotations. `utils/replacement-candidates.ts:130` -- R15.8.
- `apps/web/src/features/planning/services/manual-grid.ts:281,472` -- `SOURCE_PERSONAL`, row word.
- `apps/web/src/features/members/services/schedule-source.ts` -- NEW: the card's facts, the draft's refusals, the pattern list (by step sequence, archived types left out), `scheduleChangeAppliedOf` (a set or a cancel), the check (`manualPreviewOf` over `horizonWindowOf`, `erasuresOf`, short-staffed) and the writes. `hooks/use-member-schedule-source.ts`, `components/member-schedule-source-card.tsx` -- NEW, the card and its dialog (7.11: no form while closed). Page: `pages/ljudi.$id.tsx`.
- `supabase/functions/notify/messages.ts` -- `SCHEDULE_SOURCE_CHANGED` with a per-source variant. `packages/domain/src/history.ts` -- record `schedule-version`.
- `apps/web/src/features/calendar/components/day-detail-dialog.tsx` -- `osobna rotacija` beside such a member. `planning/components/manual-grid.tsx` -- the row's word. `planning/components/manual-preview-dialog.tsx` -- `ManualPreviewBody` exported for the card. `eslint.config.js` -- `FEATURE_PUBLIC` widened deliberately (planning's preview, rotation's write).
- Tests and catalogs as listed in Boundaries, plus `test/concurrent-writes.test.ts` (the trigger inventory), `packages/domain/test/history.test.ts` (26 audited tables), the web sweep pins (`key-sources`, `source-guards`, `screens-sweep`, `structural-pins-controls`); `e2e/utils/database-helper.ts` cleanup and `scheduleVersionsOfInSql`; `e2e/pages/people.page.ts` getters; NEW `e2e/tests/people/member-schedule-source.spec.ts`.
- Deliberately left: the calendar's day list, *Moj raspored* and *Danas* draw a personal rotation's shift as a rotation shift with no word (deferred-work, 21.4's entry, the open part); *Ljudi* (deferred).

## Tasks & Acceptance

**Execution:**
- [x] `0079` and the DB-test catalogs (`provisioning`, `rls-isolation` cases written unrun, `supabase-scaffold`, `schedule-inputs-parity`, `shift-reminders`, `notify-*`).
- [x] Domain reminder form, ICS UID, parity fixtures, their tests.
- [x] Snapshot, adapter, persistence; the day detail, month, candidates and grid readers.
- [x] *Raspored osobe* service, hook, card, page; `hr.json`; the key and localization catalogs.
- [x] History record; e2e spec and cleanup.
- [x] Spine AD-26/AD-18/AD-19/AD-20 `Amended 2026-11-25 (story 21.10)`; DESIGN/EXPERIENCE UX-DR75; epic context; `deferred-work.md` (resolved entries marked, the directory deferral); `sprint-status.yaml` 21.10 `review`.

**Acceptance Criteria:**
- Given no version anywhere, when every domain, ICS and web suite runs, then pinned digests and goldens hold.
- Given the matrix, when the service tests run, then each row's refusal or applied snapshot is as stated.
- Given typecheck, lint, build, the domain/ICS/web suites and the DB-free root tests, when run, then they pass.

## Spec Change Log

No bad_spec loop. One reading of the frozen matrix is recorded here instead of edited: its *Cancel* row says a cancel of a version already in force is "refused (42501)"; a DELETE that RLS filters matches 0 rows and raises nothing, which `writeScheduleChange` reads as refused (`SOURCE_WRITE_REFUSED`) and the database case asserts as `rowCount` 0.

## Review Triage Log

### 2026-11-26 — Review pass 1

- Layers: blind, edge-case, verification-gap, epic AC, unrun DB test (5 of 5), each a context-free subagent over the diff at `2a437b7`.
- intent_gap: 0. bad_spec: 0. Epic AC: AC 1 and 2 met, AC 3 partly, listed and deferred.
- patch (applied in the second commit):
  - `[high]` `[patch]` Read parity's "manual only" assertion would fail on about half of CI's dates: the scene's roster override puts the bystander on `home`'s shift, which applies to a manual-only member (R15.8). It now leaves out `viaOverride` shifts (unrun DB test auditor).
  - `[medium]` `[patch]` Swaps still offered a personal-rotation member on *Sastav*: `swap-proposal.ts` `works()` now leaves out `personalRotation` as it leaves out `assigned` (blind).
  - `[medium]` `[patch]` The R15.8 offer filters were wider than the domain's `countsWithOn`: a member an assignment holds that date (a day off, another team) is the assignment's, and is offered again (`rosterOffersOf`, `replacementCandidatesOf`) (edge-case).
  - `[medium]` `[patch]` *Natrag na uređivanje* dropped the draft: it reopens the form on the draft as left, and *Promijeni raspored* no longer resets it (only a landed save or another member does) (blind, edge-case).
  - `[medium]` `[patch]` The step rows' edits read the render's draft: now functional updates; a type-only edit keeps the start step (`draftWithRow`) (blind, edge-case).
  - `[medium]` `[patch]` Every 23514 read as "archived type": only 0039's message is; any other check is the service (blind, edge-case).
  - `[medium]` `[patch]` A changed preview could be written after the erasure confirmation unseen: the changed preview is shown first (edge-case).
  - `[medium]` `[patch]` A service or owner delete of a future version wrote a cancel notice, which the e2e clean-ups' order then leaked: 0079's cancel notice now needs a request session (`role = 'authenticated'`) (blind, edge-case, unrun DB test).
  - `[medium]` `[patch]` Tests that could not fail: the R15.8 put-on filter on the member's own day off (and its assignment exception), a personal rotation's staffing group in a calendar cell, the history's three source words, and the in-force cancel tried while it is the latest (verification gap, unrun DB test).
  - `[low]` `[patch]` An answer for a member the page no longer shows is dropped; `today` unknown says the check is unavailable; the TEAM notice no longer says "opet … tvog tima" (a teamless member, a cancel); `hint.manual` is ungendered; staffing groups are asked from the earliest personal version on, not every date; the reminder case writes a real `TEAM` version; the e2e asserts the scheduled fact; the spine records the reminder re-check's accepted limit; history's global `source` field is commented.
- defer: 5 (deferred-work.md, "Deferred from: story 21.10"): UI hook and card tests and a wider e2e; a `PERSONAL` no-op version; the card's endless loading on a failed read; `ručno` for both *Samo ručno* and no rotation in the grid; the database refusal paths not covered.
- reject: the e2e page-object and focus-on-the-bad-row nits, the 56 written in copy (the same constant's value, as other limits in `hr.json`), the patterns reused across teams (intended: R15.5 shares patterns), the hotfix overlap (resolved by the rebase, below).

## Design Notes

1. **Patterns.** A personal rotation names a `rotation_patterns` row (R15.5). The dialog offers each distinct step sequence among the organization's patterns with no archived type, and *Novi uzorak* step rows (a shift type, working or not, × a count; at most 56 days). An unsaved sequence equal to an offered one reuses it; otherwise the save writes a pattern, its steps, then the version (rotation's three writes, not atomic; a definite version failure removes the new pattern, as `discardUnassignedPattern`).
2. **The offset is the version's anchor** (21.9 DN1): *Početni korak* is the step the member stands on at *Vrijedi od*.
3. **Cancel notice.** E-3 names one code. A cancel restores the earlier source from that date, so the same code says which source applies from it, as an insert does.
4. **Window.** *Što se mijenja*, the inert overrides and short-staffed read `horizonWindowOf(effectiveFrom)` (366 days, the team move's); erasures from `effectiveFrom` on.

## Verification

**Commands:** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test`, and every DB-free root test file by name (`test/resource-hygiene`, `supabase-scaffold`, `localization-applied`, `notify-reminder`, `calendar-feed`, `remind`, `feature-boundaries`, the theme files, …: the 35 files that open no database).

**Run 2026-11-26 (after the review patches):** typecheck and lint clean; build clean; domain 25 files, 1106 tests; ICS 34; web 197 files, 7177 tests (`schedule-source.test.ts` 20); the 35 DB-free root files, 5476 tests.

**Run 2026-11-26 (before review):** typecheck and lint clean; build clean; domain 25 files, 1106 tests; ICS 34; web 197 files, 7174 tests (the new `schedule-source.test.ts` 17); the 35 DB-free root files, 5476 tests. No CSS or token changed, so the theme files ran only as part of the 35.

**Not run locally (STRICT DATABASE RULE; CI is their first run):** `test/provisioning.test.ts` (RLS and audited lists, the table's privileges, keys and triggers, `notify_schedule_version` in the grantees inventory), `test/rls-isolation.test.ts` (the policy list, `AUDITED_TABLES`, three new cases), `test/concurrent-writes.test.ts` (the trigger inventory), `test/notify-boundary.test.ts` (the new code), `test/schedule-inputs-parity.test.ts` (a bystander's versions per fixture), `test/shift-reminders.test.ts` (the form, and a stale expectation that `PERSONAL_ROTATION` with eight keys is refused), runtime parity, and the e2e spec. The migration was never applied locally.

**Process:** the implementation ran in this session (21.1's and 21.9's precedent), not a context-free subagent: the story spans a migration, two packages, the web app and nine test catalogs whose pins needed the investigation's context. Main at `d09fffb` did not typecheck (`day-detail.ts` called `personalShiftOn` without 21.9's `steps`); this branch passes `snapshot.steps`, as the coordinator's hotfix does.
