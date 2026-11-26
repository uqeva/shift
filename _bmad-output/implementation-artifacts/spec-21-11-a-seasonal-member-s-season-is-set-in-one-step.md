---
title: "21.11 A seasonal member's season is set in one step"
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: 'b1959e02e3b9fcba605b7a4a677fa61310decd7e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
---

Status: done. PR #388, squash `a2d8fe8`, merged 2026-11-26 with `CI passed` green on the PR's only run (45850893676 at `1b4fe94`). Every case this spec lists as unrun (the provisioning grantees entry, the three rls-isolation season cases, `e2e/tests/people/member-season.spec.ts`) ran green there; `0085` was never applied locally. Migration `0085`. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Member status is versioned (0008), but its insert policy admits a version only while the member's latest one is in effect, so a seasonal worker's start and end cannot both be scheduled: the admin has to come back on the season's first day to set its end.

**Approach:** Migration 0085 relaxes the rule as AD-26 *Seasons* states: a version may be dated after a scheduled one, provided it still follows the latest in date order and changes something (alternation); only the latest stays cancellable, and Q6 and every trigger are unchanged. The member page's status card gains *Sezona* (a dialog: *Od*, *Do*, the versions it writes, the requests it closes, AD-5's erasure guard) and *Nova osoba* gains optional *Sezona od–do*; each writes its versions in ONE PostgREST insert.

## Boundaries & Constraints

**Always:**
- 0085 `alter policy member_status_versions_insert_by_own_active_admin … with check`: 0008's conjuncts kept (claim tenant, active admin, `created_by`, today or later, not the caller's own row, the last-admin rule with `public.member_active_from`) and the date-order and changes-something reads moved into a NEW `private.member_status_version_appendable(organization, member, effective_from, active)` (`plpgsql volatile security definer`, `search_path = ''`, `authenticated` alone, false unless the caller is an active admin of that tenant): after the member's latest version, `active` differing from the latest state (none is active). The one-scheduled conjunct goes. The delete policy is untouched (only the latest, while ahead). No new trigger, no notification.
- A season `[od, do]` from the member's history (latest version L, its state A, earliest date `e` = the later of today and L+1): `od ≥ e`, `do ≥ od`, `do < 9999-12-31`. Rows: when A is active and `od > e`, inactive from `e`; when A is inactive, active from `od`; then inactive from `do + 1`. Each row alternates.
- The status card lists every scheduled change (not only the latest); *Ljudi*'s status cell and sort name the NEXT one. *Povuci* still withdraws only the latest.
- The season's write is guarded like a deactivation: the fresh erasure check over the snapshot with every row applied (from the first row's date), erasures confirmed in the shared dialog, the last-admin refusal before it (the first inactive row's date), and the member's pending leave requests the rows close (0041) named in the dialog. One insert of the rows; a refusal is read as 0008's (42501 → the named refusal or stale).
- *Nova osoba*: both dates or neither; checked before the create; after a landed create, the season's rows (inactive from today when `od` is later) in one insert. A refused season keeps the credential step and says the person was added without the season.
- Copy in `hr.json`; the catalogs (`provisioning` grantees, `rls-isolation` cases written unrun, `supabase-scaffold`, `localization-applied`, key-sources, source-guards, `resource-hygiene`) follow. E2E reads rows in SQL, holds the rotation lock and removes everything it wrote.

**Ask First:** none (unattended; decisions in Design Notes).

**Never:** no DB-connecting test, e2e or `supabase` command run locally; no change to 0008's readers, the delete policy, 0023/0041/0049/0067's triggers, `admin-auth` or the schedule source's table; no inline form on the member page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inactive member, future season | no future version, inactive; od 01.06., do 30.09. | active 01.06., inactive 01.10., one insert | — |
| Active member, season later | active, no version ahead; od > today | inactive today, active od, inactive do+1 | erasure dialog first when a conflict would go |
| Active member, season from today | od = today | inactive do+1 only | — |
| After a scheduled change | latest ahead on D | od ≥ D+1; rows appended | od ≤ D: refused before sending |
| Bad range | do < od, a past od, a missing date | refused in the dialog, nothing sent | the date field focused |
| Last admin | the only other admin; target admin | refused before the erasure dialog | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Database | a direct multi-row insert that does not alternate | refused | 42501 |
| New member | *Nova osoba* with od > today | inactive today, active od, inactive do+1 | refused: credential shown, season line |

## Epic AC Deviations

- AC 2 "**And** EXPERIENCE.md documents a seasonal member as an ordinary member with a season and a personal rotation or grid plan": met in EXPERIENCE.md; the *Sezona* dialog does not set the schedule source itself — *Raspored osobe* (21.10) is the card beside it, and the dialog's hint points there (Design Note 2).
- AC 1 "inactive until the start, when needed": read as "when the member's state before the season is active": that version is dated the earliest date the history admits (today, or the day after a scheduled change), so on the member page it is a deactivation from today, shown and guarded as one.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0085_member_seasons.sql` -- NEW: the helper and the altered policy (0008:437-477 is the policy re-stated).
- `supabase/migrations/0008_member_status.sql` -- read-only: readers, delete policy, Q6. `0023:198-265` re-check (multi-row: sees every row; unchanged). `0041:120-170`, `0049:786-830` close only what no later version governs; `0067:520-555` revokes on an in-effect inactive or any reactivation — all already handle a later version.
- `test/supabase-scaffold.test.ts:1055-1090,4845-4880` -- the 0008 policy pins: count stays 3 (an `alter`, not a second `create`); 0008's pins stay on its declaration (commented) and a new describe pins 0085's `alter` and helper. `test/provisioning.test.ts:3409` -- grantees entry. `test/rls-isolation.test.ts:6187-6240` -- "refuses a second change while one is scheduled" becomes the season's cases.
- `apps/web/src/features/members/services/list.ts:689-724` -- `MemberStatus.upcoming`; `statusCellOf`/`statusRankOf` (1388-1407) read the next one.
- `apps/web/src/features/members/services/season.ts` -- NEW: the plan, refusals, closed requests, the one insert and its failure.
- `apps/web/src/features/members/services/member-erasures.ts` -- `MEMBER_CHANGE_SEASON` (append every row).
- `apps/web/src/features/members/hooks/use-member-season.ts`, `components/member-season-dialog.tsx` -- NEW (the schedule-source hook's latch/check/erasure shape). `components/member-status-card.tsx` -- *Sezona* button, every scheduled line. `hooks/use-member-edit.ts` -- `season`.
- `apps/web/src/features/members/components/member-add-dialog.tsx`, `hooks/use-member-create.ts` -- the two optional dates and the post-create insert.
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi.season.*` (the dialog's, and *Nova osoba*'s `addLegend`, `addHint`, `addUnsaved`).
- `e2e/tests/people/member-season.spec.ts` NEW; `e2e/utils/database-helper.ts` `statusVersionsOfInSql`; `e2e/pages/people.page.ts` getters.

## Tasks & Acceptance

**Execution:**
- [x] `0085` and the DB-test catalogs (scaffold, provisioning, rls-isolation cases unrun).
- [x] `list.ts` upcoming; `season.ts` and its tests; `member-erasures.ts` and its test.
- [x] Hook, dialog, card, page wiring; *Nova osoba*; `hr.json`; the key and localization catalogs.
- [x] E2E spec and helper.
- [x] Spine AD-26 *Seasons* `Amended 2026-11-26 (story 21.11)`; EXPERIENCE/DESIGN (UX-DR76's *Sezona od–do*); epic context; `sprint-status.yaml` 21.11 `review`.

**Acceptance Criteria:**
- Given the matrix, when the season service tests run, then each row's rows or refusal are as stated.
- Given typecheck, lint, build, the domain/ICS/web suites and the DB-free root tests, when run, then they pass.

## Spec Change Log

No bad_spec loop.

## Review Triage Log

### 2026-11-26 — Review pass 1

- Layers: blind, edge-case, verification-gap, epic AC, unrun DB test (5 of 5), each a context-free subagent over the diff at `3ca1520`.
- intent_gap: 0. bad_spec: 0. Epic AC: AC 1 and AC 2 met (AC 1's "inactive until the start" under the listed reading); one unlisted gap noted, *Nova osoba*'s create and season being two requests, which the AC's "the status versions are written in one request" does not forbid (Design Note 3, deferred-work).
- patch (applied in the second commit):
  - `[high]` `[patch]` *Nova osoba* awaited the season insert before showing the one-time credential, and a throw building its client lost the credential of a created member: the credential is shown first, the season written after it inside its own `try` (blind, edge-case, verification gap).
  - `[medium]` `[patch]` The season's erasure snapshot checked dates only: a first row repeating the fresh latest state (planned over a change since withdrawn) is now stale, as 0085 refuses it (blind, edge-case).
  - `[medium]` `[patch]` The rows written could differ from the rows listed (a midnight, a re-read): the save's subject is `seasonAskOf` in `season.ts`, which answers stale unless its rows are the ones shown, and is unit-tested with the last-admin and own-row refusals (blind, verification gap).
  - `[low]` `[patch]` *Nova osoba*: an unread organization zone reads as unavailable, not "enter both dates"; an end refusal focuses *Sezona do*. The status card's action and *Poništi* wait for a season write too; the card header re-indented. The requests line says cancelling a season does not reopen them. A stale cross-reference in `list.ts`, a test assertion that could not fail, the e2e's substring match of `aktivna od` inside `neaktivna od`, and a mid-statement non-alternating case in rls-isolation; the spec's paths, tasks and status.
- defer: 4 (deferred-work.md, "Deferred from: story 21.11"): 0067's revocation at insert for a reactivation behind a scheduled deactivation; no whole-season cancel (and the day-D-alone and today's-row cases); the e2e and hook coverage gaps and *Nova osoba*'s last-admin check; plus the planning-time entries (CI, the dialog's other consequence lines, *Nova osoba* not atomic).
- reject: the lingering *Sezona je spremljena.* beside a later status line (both are true), per-field `aria-invalid` in the dialog (the alert names the field and focus moves to it), the cleanup-order comment (the 21.10 spec's order, which runs), the code-specific *Nova osoba* unsaved line (one action fixes every cause: set it on the member page).

## Design Notes

1. **Why the helper is narrow.** 0023's concurrent case "a deactivation that waited while the only other admin was demoted" expects the policy to read `members` on the statement's snapshot and the AFTER re-check to raise 23514. Moving the last-admin conjunct into a definer would change that code, so only the rule this story changes moves; the remaining readers are 0008's functions (no direct read of the table, no 42P17).
2. **Schedule source.** A seasonal member is an ordinary member (R16.5): the season is status, their work is *Raspored osobe* (a personal rotation from the season's start) or *Ručni raspored*. Writing both from one dialog would be two tables in two requests with two guards; the dialog names the card instead.
3. **New member.** `admin-auth` stays as is (AD-26 says "may"): the create is unchanged and the browser writes the season right after it, as the caller, through the same policy. The account cannot sign in before then (the credential is only on screen).

## Verification

**Commands:** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test`, and the DB-free root files by name (`resource-hygiene`, `supabase-scaffold`, `localization-applied`, `localization-guard`, `feature-boundaries`, …).

**Run 2026-11-26 (after the review patches):** typecheck and lint clean; build clean; domain 28 files, 1219 tests; ICS 35; web 212 files, 7549 tests (`season.test.ts`, the erasure and list cases); the 33 DB-free root files by name (`supabase-scaffold`, `resource-hygiene`, `localization-applied`, the theme files after `pnpm build`, …), 5739 tests. No CSS or token changed.

**Not run locally (STRICT DATABASE RULE):** `0085` was never applied; `test/provisioning.test.ts` (the grantees entry), `test/rls-isolation.test.ts` (three season cases) and `e2e/tests/people/member-season.spec.ts` run first in CI. A local failure caused by the unapplied migration would be expected.

**Process:** the implementation ran in this session (21.1's, 21.9's and 21.10's precedent), not a context-free subagent: the story spans a migration, the member page's guarded status machinery and eight test catalogs whose pins needed the investigation's context.
