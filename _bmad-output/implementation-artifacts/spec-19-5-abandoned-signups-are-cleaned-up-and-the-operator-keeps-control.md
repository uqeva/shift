---
title: '19.5 Abandoned signups are cleaned up and the operator keeps control'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: 'b5e0c94df104a638e7332e1abe4191ef643548bb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
---

Status: review, built and reviewed (five layers), CI pending; needs a rebase onto 17.3's merge first (Baseline). Unattended run: the checkpoint was taken as approved, the founder having said not to ask questions; the orchestrating session wrote the spec and implemented it directly rather than through a fresh implementation subagent.

Baseline: `origin/main` at #349 (19.3 merged, 0071). Story 17.3 runs in parallel and takes migration 0072, so this story's migration is **0073**. On the orchestrator's word that 17.3 merges first, 0073's `claim_notifications` is re-created from **0072's** definition (`origin/feat/17-3-reminder-delivery` at `33a1cf4`, the `REMINDER_LATE` settle kept), so this branch must be rebased onto 17.3's merge before CI can pass: without 0072 the migration chain fails at 0073 (`private.reminder_late`) and three scaffold cases fail. No `hr.json` edit (17.3 holds the hot file); no UI change.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Open signup leaves accounts that never confirm or never found an organization, holding an address and a password hash forever (D-S7), and the operator has no way to stop an abusive organization: nothing reads a suspension (AD-10, FR-101), and no query shows what signup is doing.

**Approach:** Migration 0073 adds `organizations.suspended`, read only by `private.organization_live`, and re-creates every consumer over it (the claim path, the feed lookup, the reminder read and write, the notify paths); adds AD-25's `housekeeping` job; ships the operator's suspend, unsuspend and report scripts and DEPLOY.md's runbook with the D-S5 checklist.

## Boundaries & Constraints

**Always:**
- Housekeeping never deletes an account with a `members` row, a synthesized (username) account, an account with no readable address, or an organization's `founded_by`; each condition is read again under the row's lock (`skip locked`), and proven in tests.
- Each re-created function equals its latest definition word for word but for the check, pinned by the scaffold.
- A suspended organization's users get one neutral message: the existing sign-in refusal (`SIGN_IN_REFUSED`, the deactivation's).
- No session role may write `suspended` or execute the job or the predicate.

**Ask First:** none (the founder said decide and record).

**Never:** an `hr.json` or UI change; a self-service suspension or deletion surface; deleting an organization or a domain row; running docker, `supabase`, e2e or DB-connecting tests; a literal host, key or address in the public repository.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale signup | email identity, no member, unconfirmed > 7 d or confirmed > 30 d | deleted with its identities | held by another transaction: skipped, next night |
| Protected | a member row, synthesized, no address, `founded_by`, younger | kept | n/a |
| Suspend | `suspend-organization.sql` with a slug | its sessions read nothing; sign-in, refresh refused; feed 404; nothing queued or sent; queued rows `ORGANIZATION_SUSPENDED` | unknown slug `ORGANIZATION_UNKNOWN`, none `ORGANIZATION_SLUG_MISSING` |
| Unsuspend | `unsuspend-organization.sql` | access as before, no record changed, settled rows not resent | as above |
| Report | `signup-report.sql` | one JSON document against the ceilings | writes nothing |

## Epic AC Deviations

- "deletes unconfirmed accounts after 7 days and confirmed accounts that never founded an organization after 30 days, and never touches an account that has a `members` row": **narrowed, safer.** Synthesized accounts and accounts with no readable address are never candidates either (the founder's rule for this run), and "never founded" is read as no organization naming the account `founded_by`.
- "its claim reads nothing until it is unsuspended": met as AD-10 states it: an issued token keeps its claim until it expires but reads and writes nothing; a refresh is refused.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0073_housekeeping_and_suspension.sql` (new) -- (i) the column; (ii) `private.organization_live`; (iii) re-created over it: `current_member_access` and `custom_access_token_hook` (0008), `private.calendar_feed_member_live` (0067; the lookup and both state reads share it), `reminder_inputs`, `enqueue_shift_reminders` (0070), `claim_notifications` (0072, 17.3), `private.notify_members` (0045), `push_devices_for_send` (0046), `swap_parties_active` (0049); (iv) `private.delete_abandoned_accounts()` and the cron job.
- `supabase/operator/{suspend,unsuspend}-organization.sql`, `signup-report.sql` (new).
- `packages/domain/src/history.ts` + test -- `suspended` hidden (AD-11).
- Tests: `test/housekeeping.test.ts`, `test/suspended-organization.test.ts` (new, DB, unrun); `test/catalog-sweep.ts` (new: 19.1's sweep helpers moved unchanged from `test/claimless-account.test.ts`, which imports them); `test/provisioning.test.ts` (catalog entries, unrun); `test/supabase-scaffold.test.ts` (0073 block; 0066's switch pin lets the report read the switch; 0070's "no later definition" pin names 0073).
- Read, unchanged: `supabase/functions/notify/push.ts:154` (`inactive` settles `RECIPIENT_INACTIVE`), `admin-auth/authorize.ts` (zero access rows refuse), `apps/web/src/features/auth/services/sign-in.ts` (every 4xx but 429 is the one credentials message).
- Docs: DEPLOY.md §9.10; spine AD-10 and AD-25 amended; SECURITY-REVIEW 19.5 evidence (E3, E4, F1–F4) and 19.3's rows rewritten for CI; deferred-work; sprint-status; 19.3's spec set done.

## Tasks & Acceptance

**Execution:**
- [x] `0073` and the three operator scripts, as mapped.
- [x] The history domain hides `suspended`.
- [x] DB tests written unrun; scaffold, provisioning and domain pins.
- [x] DEPLOY.md §9.10, spine amendments (AD-10, AD-25, 2026-11-21 (19.5)), checklist evidence, deferred-work answers, sprint-status, 19.3 set done.

**Acceptance Criteria:**
- Given the repo, when typecheck, lint, build, the web and domain suites and the allowed root files run, then they pass (the no-gap case excepted until 0072 merges).

## Design Notes

Decisions (the founder said decide and record):

- **D1. The predicate's callers.** AD-10's list, plus `swap_parties_active`: a scan of every `public` definer `authenticated` may execute found it the one that read the claim without `current_member_access()` (every policy already reads it). The feed is gated in the shared liveness helper, not in two places.
- **D2. Push at send time** answers `inactive`, which `notify` already settles failed: no Edge Function change while 17.3 works on `notify`.
- **D3. The claim's settle** runs after the exhausted one and before every other, so the recorded reason is the suspension.
- **D4. Housekeeping candidates** (stricter than AD-25): an email identity by `private.address_kind`, not banned now, no member row, no `founded_by`, unconfirmed 7 days from the later of creation and the last confirmation link (a repeat signup re-sends it), confirmed 30 days from confirmation whatever its sign-ins (an email identity has no way into an organization but founding one); listed once, then locked `for update skip locked` with every condition read again, then a new statement re-checks members, then the delete re-checks members itself. A member insert's foreign key holds a key share lock on the account, so it is skipped too; while the job holds the lock, such an insert waits and then fails its foreign key (reasoned from Postgres' row locks, not tested). Each account is its own subtransaction: a failing one is logged `HOUSEKEEPING_SKIPPED` and counted `failed`, and never undoes the rest.
- **D5. Counts** go to the server log (`HOUSEKEEPING {…}`): pg_cron keeps the status only.
- **D6. Revoked feed tokens are kept** (16.3's deferral): a removal pair like every other; a revoked hash authorizes nothing; the job deletes no domain row.
- **D7. `organization_attempts`** older than 30 days are deleted (19.3's retention question).
- **D8. The one message** is the existing refusal: the hook's 403 is the deactivation's, so *Prijava* shows the same credentials message, and no copy names suspension. A live session reads nothing until its token's refresh is refused.
- **D9. The history.** `suspended` is audited and hidden; each suspension and unsuspension leaves one organization entry showing no change.
- **D10. The sweep helpers** moved to `test/catalog-sweep.ts` so the suspended admin runs 19.1's sweep, not a copy.
- **D11. "No session role"** (Boundaries) means the request roles `anon` and `authenticated`. `service_role` is the secret key's trusted role (AD-17) and holds UPDATE on `suspended` as on `founded_by`; the test asserts it, so a change is a decision. No Edge Function writes it.
- **D12. The report** counts the last 24 hours' accounts exactly as the hook's ceiling does (every memberless account), lists the 50 newest email identities (AC3's "recent signups"), puts the ceilings beside each day, and says that days older than a week show what the job left.
- **For the founder before D-S5** (recorded in deferred-work, as the root CLAUDE.md asks for data deletion and security-sensitive choices): D4–D7 and D9, and the suspension residuals (own-account writes by an unexpired token, a device row a suspended member cannot delete, an already-claimed email).

## Verification

**Commands (2026-11-22, after review):**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- pass. `pnpm --filter @shift/domain test` -- 22 files, 975 tests pass. `pnpm --filter ./apps/web test` -- 184 files, 6859 tests pass.
- The eight allowed root files, built first, with 17.3's `0072` copied in uncommitted (the state after the rebase) -- 8 files, 3106 tests pass. Without it (this branch alone) -- 3 scaffold cases fail, as expected: the no-gap case, 0070's "no later definition" case and 0073's word-for-word case (its claim's source is 0072).
- Written unrun, CI is their first run: `test/housekeeping.test.ts`, `test/suspended-organization.test.ts`, the moved sweep in `test/claimless-account.test.ts`, `test/provisioning.test.ts`'s entries.

**Manual checks:**
- In-process PGlite (scratch, not committed) over a stand-in for Supabase's `auth`, `storage`, `cron`, `net` and `vault`: 0001–0073 apply (0072 from 17.3's branch); a re-sent link 9 days old goes, one 2 days old and a banned account stay; a row whose delete raises is counted `failed` and the rest still go; the provision script makes two organizations; the job deletes exactly the 8-day unconfirmed and the 31-day confirmed email identities of twelve, keeps members, synthesized (three spellings), no-address, malformed and `founded_by` accounts, cascades identities, purges one of two attempts, and a second run deletes nothing; the suspend script turns the admin's reads (5 rows) to 0, the hook to `SIGN_IN_REFUSED`, the feed to null, the reminder read to nothing, the swap check to false, a queued row to `ORGANIZATION_SUSPENDED`, `notify_members` to no row, while the other organization is unchanged; unsuspend restores all of it and the settled row stays settled; the report prints.

## Review Findings

Review of 2026-11-22. Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Epic AC Auditor, Unrun DB Test Auditor (all five ran). No intent gap and no bad spec; every finding below patched (frozen text unchanged) or deferred.

1. Patched: an unconfirmed account's 7 days ran from `created_at`, so a repeat signup's fresh link could be deleted under its owner; now from the later of creation and `confirmation_sent_at`. DB case and PGlite.
2. Patched: a banned account was deleted with its evidence; banned accounts are never candidates. DB case and PGlite.
3. Patched: one failing row rolled the whole night back; each account is its own subtransaction, logged and counted `failed`. PGlite (a raising trigger) and scaffold pin.
4. Patched: `pg_catalog.greatest` is not a function (found by PGlite); plain `greatest`.
5. Patched: the report's 24-hour account figure now counts as the hook's ceiling does; `recent_accounts` lists the newest signups; each day carries its ceiling; the job's effect on old days is stated (AC3, Epic AC Auditor).
6. Patched: the job's counts are asserted exactly, by kind, against a pre-run count of the rule, and a second run answers zero; the report is asserted against a known scene (Verification Gap).
7. Patched: the grants of the nine re-created callers are replayed across every migration and pinned unchanged by 0073; the "only `organization_live` names `suspended`" pin now covers every statement of every migration, not only `$$` bodies.
8. Patched: the feed's state read answers not live while suspended; delivery is shown restored after unsuspending; the Storage read is non-vacuous (a logo read before the suspension); `service_role`'s privilege asserted; the cron job runs as the function's owner, who may delete accounts.
9. Patched: `psql -v ON_ERROR_STOP=1` and the local `PGOPTIONS` path in the scripts and DEPLOY.md; where the `HOUSEKEEPING` log line is read; an already-claimed push settles `RECIPIENT_INACTIVE` (stated).
10. Patched: the race's committed account is written in its own transaction, and `finally` ends it; the Founding Admin case's title says what keeps it.
11. Patched (orchestrator): the claim is re-created from 17.3's 0072, so `REMINDER_LATE` survives.
12. Deferred (OWNER the D-S5 review): own-account writes by a suspended member's unexpired token, a device row a suspended member cannot delete, an already-claimed email. Deferred (OWNER the founder): the decisions above.

Rejected, each with its reason: a batch limit on the job (abandoned accounts at staging scale are tens, each row lock is held for one short run, and a skipped row is retried the next night); dropping the two "no change" history entries (AD-11 audits every organizations column; hiding the column is the decision, D9); the sprint-status timestamp a day ahead (it is the local clock, as every earlier entry); rewording `catalog-sweep.ts`'s comments (moved unchanged on purpose, D10).
