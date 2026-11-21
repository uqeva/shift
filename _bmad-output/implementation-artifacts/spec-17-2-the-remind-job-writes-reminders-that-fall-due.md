---
title: "17.2 The remind job writes reminders that fall due"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: 'e82bb39cd6c9681ca6a8ee78a48dbd3c765c7c11'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

Status: review (built, reviews 1 and 2's patches applied, CI pending). DONE MEANS MERGED WITH GREEN CI: the frontmatter stays `in-review` and the sprint status `review` until the PR merges green. Approved unattended under the founder's standing instruction (decide and record, no questions). ~2.4k tokens, kept whole: one user goal (a due reminder is written once, from the schedule as it stands) across the domain, SQL and one function; splitting the RPCs from the function would ship either half unusable. Baseline: `main` at #347 (17.1). Touches the structural pin tests (no hot UI file). Migration `0070` (19.3 runs in parallel and takes `0071`). Residual risks: the DB suite `test/shift-reminders.test.ts`, the provisioning inventories, the claimless sweep's `remind` call, 0070 on the real stack, the image probe and the runtime-parity job have never run (CI is their first run).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 17.1 stores a member's leads, but nothing turns them into reminders: no due instant (AD-6), no `remind` function, no `reminder_inputs`/`enqueue_shift_reminders`, and the outbox filter and claim know nothing of `SHIFT_REMINDER` (AD-14, AD-17, AD-18; D5, Q25).

**Approach:** `zone.ts` gains `reminderDueAt`; a pure domain function selects the (shift, lead) pairs due in `[now − 15 min, now + 5 min)` whose shift has not started, over R12. Migration `0070` adds the `service_role`-only read and write, the reminder clauses of the outbox filter and claim, and the `remind` cron job (unarmed: Vault holds no `remind_url`). A fourth Edge Function, `remind`, reads, projects through the domain and writes, and nothing else.

## Boundaries & Constraints

**Always:**
- `reminderDueAt(lead, date, startMinute, zone)` in `zone.ts`: `H<n>` is the start instant minus n real hours; `EVENING_BEFORE` is 20:00 local on `date − 1`. `startMinute` is the worked start (past 1440 for a night's second half). No other module converts local time; the new domain module names no `Intl`/`Date`.
- One clock: the database's `now` (epoch ms) in `reminder_inputs()`'s answer is the window's clock; the domain function takes it as an argument.
- `reminder_inputs()`: `service_role` only; `{ now, members: [{ memberId, leads, window: {from: today−1, to: today+1}, inputs }] }` for members with `cardinality(leads) > 0` active in their organization's today; it is `member_schedule_inputs`' gate.
- `enqueue_shift_reminders(p_items jsonb)`: `service_role` only; shape errors raise 22023 `REMINDER_ITEMS_INVALID`; an item is skipped (not raised) when its member is unknown or inactive today, the lead is no longer on, the shift has started (`startsAt <= now()`) or is more than two days off, or the team/shift type is not the member's organization's. Names looked up in SQL. Subject `md5('SHIFT_REMINDER:'||member||':'||date||':'||team||':'||lead)::uuid`; rows through `private.notify_members`. Operands `{ date, teamId, start, end, startsAt, lead, leadHours?, shiftTypeName, teamName }`, `leadHours` absent for `EVENING_BEFORE`. Returns the accepted count.
- The filter drops a `SHIFT_REMINDER` email row while `private.reminder_email_on(recipient)` is false. The claim settles a pending `SHIFT_REMINDER` row `REMINDER_EXPIRED` once `now() >= startsAt` (an unreadable `startsAt` counts as expired), `REMINDER_TURNED_OFF` when the lead is gone, and its email row `EMAIL_TURNED_OFF` when the predicate is false; and never returns such a row. Every earlier clause kept, grants restated.
- `private.invoke_remind()` copies `invoke_notify` with Vault's `remind_url` and `remind_invoke_secret`; `cron.schedule('remind', '*/5 * * * *', …)`. No migration writes a Vault secret.
- `remind`: `verify_jwt = false`; environment `SUPABASE_URL`, `SHIFT_SECRET_KEY`, `REMIND_INVOKE_SECRET` only; POST only; bearer compared in constant time (401 `INVOKE_SECRET_REFUSED` before any call); imports `@shift/domain` only, through its `deno.json` onto `dist`; two `fetch` POSTs with the secret key as `apikey`, each bounded at 10 s; fixed log codes only. One member's broken assembly skips that member, not the run.
- Wired like `calendar-feed`: `config.toml`, router `FUNCTIONS`, Dockerfile, `FUNCTIONS_SOURCES`, the image probe (refuses a missing invoke secret), the compose's functions environment, the claimless sweep's `CALLS`; key hygiene: the secret key only in `admin-auth`, `notify`, `remind`.
- The parity probe covers `reminderDueAt` on both DST dates of 2026 and 2027.
- Required inputs from `deferred-work.md` (16.2's and 17.1's OWNER 17.2 entries) answered in Design Notes and marked.

**Ask First:** none (founder: decide and record).

**Never:** rendering `SHIFT_REMINDER` in `notify`, its `TIME_OPERANDS`, push TTL or variant map, DEPLOY.md, Vault values or arming the job (17.3); a `send_after` column; retracting a reminder; any screen or `hr.json` copy; running DB tests, e2e, `supabase` or docker containers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Due | H2, shift 07:00, clock 05:00 ±window | one item, `startsAt` 06:00Z (winter) | none |
| Window edge | due = now − 15 min / now + 5 min | kept / dropped | none |
| Started | due in window, start ≤ now | dropped (function and RPC) | none |
| DST | H3 before 07:00 on 2026-03-29 / 2026-10-25 | 3 real hours before the instant | none |
| Evening | `EVENING_BEFORE`, shift 2026-03-29 | 2026-03-28 20:00 local | none |
| Night half | worked second half starts 1500 | lead counts from 01:00 next day | none |
| Overlap | two runs, same item | one row per channel | unique key |
| Re-check | lead off / inactive since the read | no row | skipped |
| Claim | started, lead gone, reminder email off | `REMINDER_EXPIRED` / `REMINDER_TURNED_OFF` / `EMAIL_TURNED_OFF` | none |
| Refused | no or wrong bearer | 401 `INVOKE_SECRET_REFUSED`, nothing called | none |
| Read fails | network, non-200, malformed | 503 `REMINDER_INPUTS_UNAVAILABLE`, nothing written | logged code |
| Write fails | enqueue non-200 | 503 `REMINDER_ENQUEUE_FAILED` | logged code |

## Epic AC Deviations

- "a queued reminder whose shift has started is settled `REMINDER_EXPIRED` at claim time and never sent" — met in the claim; "never sent" by a deployed `notify` holds trivially because `remind` stays unarmed until 17.3's `notify` renders the code (AD-14's deploy order).
- "the spine records exactly four Edge Functions" — met (AD-14 already counts four; this story makes the tree match).

</frozen-after-approval>

## Code Map

- `packages/domain/src/zone.ts` -- add `reminderDueAt` beside `instantOf` (reuses `civilDayNumber`/`dateOfCivilDay` from `calendar.ts`).
- `packages/domain/src/reminders.ts` -- add `REMINDER_LEAD_HOURS`, `EVENING_BEFORE_MINUTE`; imports nothing (so `zone.ts` may import it without a cycle).
- `packages/domain/src/shift-reminders.ts` (new) -- `shiftRemindersDueOf(inputs, leads, window, now)` over `atWorkShiftsOf` (`at-work.ts:190`); `index.ts` exports.
- `packages/domain/parity/probe.ts` -- a `reminders` section; `test/runtime-parity.test.ts` pins sample values.
- `supabase/migrations/0042_notification_outbox.sql:417` -- `invoke_notify`, the copy's source; `0044:185` filter; `0046:142` the latest claim; `0045:257` `notify_members`; `0065:277` `member_schedule_inputs`; `0067:463` the gate pattern; `0069:190` `reminder_email_on`.
- `supabase/functions/calendar-feed/{handler,index,deno.json,deno-runtime.d.ts}` -- the shape to copy (pure injected handler, `globalThis` runtime shim, `read('…')` config); `notify/run.ts:52` `sameSecret`.
- `supabase/config.toml:167`, `deploy/functions/main/router.ts:44`, `deploy/functions/Dockerfile`, `scripts/ci/deploy-images.sh:50`, `scripts/ci/probe-functions-image.sh`, `deploy/coolify/supabase/docker-compose.yml:1660`, `supabase/functions/.env.example`.
- CI: every job that starts the stack (`test`, `e2e`, `functions-image`, the deploy action, `playwright.config.ts`) already builds `@shift/domain` first; `remind` imports nothing else.
- Pins: `test/functions-router.test.ts`, `test/key-hygiene.test.ts`, `test/supabase-scaffold.test.ts` (function list `:186`, config `:194`, new 0070 block), `test/self-hosted-stack.test.ts:670`, `test/coolify-deploy.test.ts:639`, `test/claimless-account.test.ts` (`CALLS`), `test/provisioning.test.ts` inventories (`:2814`, `:3062`, `:3120`).
- Mappers (A11): no row gains a column. E2E cleanup: no new table.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/{zone,reminders,shift-reminders,index}.ts`, `packages/domain/test/{zone,shift-reminders}.test.ts` -- due instant and selection, DST/midnight/half/window cases over the parity fixture -- AD-6, AD-7.
- [x] `packages/domain/parity/probe.ts`, `test/runtime-parity.test.ts` -- probe coverage -- AD-19.
- [x] `supabase/migrations/0070_shift_reminders.sql` -- the two RPCs, filter, claim, invoke, cron -- AD-14, AD-18.
- [x] `supabase/functions/remind/**`, `test/remind.test.ts` (DB-free) -- the function and its matrix -- AD-14, AD-17.
- [x] config, router, Dockerfile, hash, probe, compose, `.env.example` and their pins; `claimless-account` `CALLS` -- AD-7, AD-14, AD-17.
- [x] `test/shift-reminders.test.ts` (new, DB, unrun), `test/provisioning.test.ts` inventories, scaffold 0070 block.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-21 (17.2)` on AD-6, AD-14, AD-17, AD-18; `deferred-work.md` entries marked, 17.3's added; `sprint-status.yaml`; 17.1's spec set done.

**Acceptance Criteria:**
- Given a member with `H1` and `EVENING_BEFORE` on, when the job runs twice over the same clock, then the outbox holds one row per channel per reminder.
- Given `supabase/functions/remind/`, when key hygiene runs, then it names no Resend, VAPID or publishable key, and its worker gets exactly three variables.
- Given the Vault without `remind_url`, when the cron job fires, then `invoke_remind()` sends nothing.

## Design Notes

Decisions (founder: decide and record):
1. **The clock is the database's.** `reminder_inputs` returns `now` (epoch ms) with the `today` it used; the function's own clock is never read for the window, so a skewed host cannot move it and the claim-time expiry reads the same clock. "The handler takes its clock as an argument" is met by the pure core taking `now`.
2. **The evening before** is 20:00 on the day before the shift's start `date`, also for a night's worked second half (its link and calendar row are that date).
3. **Selection lives in the domain** (`shiftRemindersDueOf`), so `remind` maps rows and computes nothing (AD-7); the RPC only re-checks state and refuses started shifts (no zone arithmetic in SQL).
4. **`leadHours` in SQL** is `substr(lead, 2)::integer` for an `H` code, pinned equal to `REMINDER_LEAD_HOURS`.
5. **The 17.3 boundary.** `remind` is deployable and the cron job scheduled, but `invoke_remind` does nothing until 17.3 stores `remind_url` and `remind_invoke_secret` in Vault after a `notify` that renders `SHIFT_REMINDER` is live. This story adds `REMIND_INVOKE_SECRET=${SERVICE_PASSWORD_64_REMINDINVOKE}` to the compose (Coolify generates it, as `notify`'s), so arming is a Vault write plus DEPLOY.md, both 17.3's.
6. **Suspension**: `private.organization_live` does not exist yet (0067's note); the suspension story re-creates these RPCs over it.
7. **Up to 5 minutes early.** A row is written once its due time is within 5 minutes, and with no `send_after` column `notify` may send it on its next claim, so a reminder can arrive up to about 5 minutes before its lead (an `H1` about 65 minutes ahead). AD-14 accepts this ("computing at most 5 minutes ahead meets D5").
8. **The key is AD-18's** (member, date, effective team, lead), not the shift type or start: R12 gives at most one at-work shift per date and team (16.4 decision 4), and a change after a reminder was written is FR-62's change notification, never a second reminder (D5, no retraction).
9. **Recipients** follow `notify_members`' one rule (active today, an address, a device), as every notification does; a banned or deleted account whose member is still active is not filtered here, unlike the feed's stricter `calendar_feed_member_live`. Accepted: it receives only its own shift reminders, as it already receives its own change notifications; deactivation is the way a member leaves (AD-16).
10. **A shape breach fails the batch**: items come only from the domain, so a malformed one is a defect to surface (503, logged), not one member's state; state changes since the read are skipped per item.
11. **Deferred inputs:** `reminderDueAt` and the probe — done (1, 2); `reminder_inputs`' gate — done; the filter and claim settlements — done; the re-check reads `lead = any(leads)` and `member_active_on` — done; neither RPC needs a table grant (definers).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts test/functions-router.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/runtime-parity.test.ts test/remind.test.ts` -- pass.

**Manual checks:**
- Bundle `remind` with the saved pinned `edge-runtime` under chroot (no network) as 16.4 did, and serve it: a POST without the secret is 401.
- Unrun by rule: `test/shift-reminders.test.ts`, the provisioning inventories, the claimless sweep, the image probe and runtime-parity job; CI is their first run.

**Results (review 2, 2026-11-21).** `pnpm typecheck`, `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 22 files, 975 passed. `pnpm --filter @shift/ics test`: 31 passed. The nine DB-free root files above: 2503 passed. Still unrun by rule, and so first run in CI: `test/shift-reminders.test.ts` with its two new cases, the provisioning inventories, the claimless sweep and the image probe.

**Results (review 1, 2026-11-21).** `pnpm typecheck`, `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 22 files, 974 passed. `pnpm --filter @shift/ics test`: 31 passed. `pnpm --filter ./apps/web test`: 183 files, 6830 passed. The nine DB-free root files above: 2502 passed (17.1's 3002 was a different set of eight, with `localization-applied`, not these). 0070 re-run in the throwaway PGlite after the today patch: unchanged behaviour.

**Results (implementation, 2026-11-21).**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 22 files, 971 passed. `pnpm --filter @shift/ics test`: 31 passed. `pnpm --filter ./apps/web test`: 183 files, 6830 passed. The nine DB-free root files above (with `test/remind.test.ts`): 2499 passed (key-hygiene's two built-bundle scans skipped as before).
- **0070 compiled and exercised in a throwaway in-process Postgres** (PGlite, scratchpad, over stub tables and the real `notify_members`, `reminder_email_on` and 0044 filter; no shared database touched): two runs of the same two items accepted 2 and 2 and left four rows (one per lead per channel), the subject equal to `md5('SHIFT_REMINDER:'||member||':'||date||':'||team||':'||lead)`, `leadHours` 1 on H1 and absent on the evening lead; all six skips answered 0; all fifteen shape breaches raised 22023 `REMINDER_ITEMS_INVALID`; with the reminder email switch off only the push row was written; the claim returned only the live row and settled expired and unreadable `startsAt` as `REMINDER_EXPIRED`, the lead gone as `REMINDER_TURNED_OFF`, the email as `EMAIL_TURNED_OFF`; `invoke_remind()` sent nothing with no secret or the URL alone, and one bearer POST with both.
- **The bundle, offline.** The image layout built as the Dockerfile's COPY lines in the saved pinned `edge-runtime` v1.74.3 rootfs, every function bundled under `chroot` with no network (`remind` 248 065 bytes). `remind` served alone (`unshare -n`): no bearer and a wrong one 401 `INVOKE_SECRET_REFUSED`; the right one with the gateway unreachable 503 `REMINDER_INPUTS_UNAVAILABLE`, and the runtime's log held `remind: REMINDER_INPUTS_UNAVAILABLE` alone. `scripts/ci/probe-functions-image.sh` itself was not completed locally (see the incident below); CI's `functions-image` job is its first run.
- **Unrun, by the STRICT DATABASE RULE:** `test/shift-reminders.test.ts` (new), the provisioning inventories, the claimless sweep's `remind` call, the scaffold-pinned SQL on a real Postgres, the image probe and the runtime-parity job. CI is their first run.
- **Incident.** A first attempt to run the image probe locally ended with `pkill -f "edge-runtime start"`, which, in the host's PID namespace, very likely stopped the manual-test stack's `supabase_edge_runtime_shift` container (seen `Exited (15)` afterwards). It was not restarted by this story (containers are off limits); reported to the orchestrator.


## Review Findings (review 1, 2026-11-21)

- [x] [Review][Patch] The write-time re-check passed a null `organization_today` to `member_active_on`; a null today now skips the item [0070_shift_reminders.sql]
- [x] [Review][Patch] One write POST above the RPC's 10 000-item cap would fail every run; the write is sent in chunks of 1000 [remind/handler.ts]
- [x] [Review][Patch] A `members` element that was not an object made the whole read 503; it now skips that member alone [remind/handler.ts]
- [x] [Review][Patch] `accepted` documented as items past the re-check, not rows inserted; the DB test's label corrected [0070, handler, test/shift-reminders.test.ts]
- [x] [Review][Patch] Nothing joined the handler's body to the RPC's parameter name: the scaffold pins `enqueue_shift_reminders(p_items jsonb)` and the handler's `{ p_items }`, and the DB suite calls it by name [test/supabase-scaffold.test.ts, test/shift-reminders.test.ts]
- [x] [Review][Patch] The scaffold now asserts 0070 re-creates the latest filter and claim (no other migration redefines them) [test/supabase-scaffold.test.ts]
- [x] [Review][Patch] The claim case settles the transaction's other pending rows first, so a large fixture cannot push its rows out of `claim_notifications(100)` [test/shift-reminders.test.ts]
- [x] [Review][Patch] Vacuous assertions: the shape-breach "wrote nothing" check (savepoint rollback) and the handler's two-runs case now assert something real [test/shift-reminders.test.ts, test/remind.test.ts]
- [x] [Review][Patch] Epic AC 3's no-team and full-day-leave cases, and the window's date bound, are tested in the domain [packages/domain/test/shift-reminders.test.ts]
- [x] [Review][Patch] Comments: the probe's clocks; the spine no longer says the image probe runs the bundled domain's due instants, and names the chunked write [probe.ts, ARCHITECTURE-SPINE.md]
- [x] [Review][Patch] 17.1's OWNER 17.3 (check) entry narrowed to the live screen [deferred-work.md]
- Rejected, with reasons:
  - Add the shift type or start to the key: AD-18 ratified the key, R12 gives one at-work shift per date and team, and a later change is FR-62's (Design Note 8).
  - Re-check at claim time that the shift still exists: that is a projection in the claim (AD-18: the claim compares and looks up only); D5 accepts it, the row being written at most 5 minutes before due.
  - Widen the "two days" bound: a worked start is below minute 2160 (start < 1440, a half's start before the midpoint), so an evening lead's start is at most about 36 h ahead.
  - Filter `reminder_inputs` by channel, or page it: AD-14's accepted scale risk (revisit past 30 s or about 5 MB).
  - Catch `RangeError` only: a malformed assembly can throw a `TypeError` too, and skipping that member is the spec's rule.
  - An account check like the feed's: Design Note 9.
  - A due member in the image probe's stand-in: the runtime-parity job runs the same `dist` on the pinned runtime; the probe proves the bundle starts and refuses.
  - The `sb_secret_claimless_probe` literal: pre-existing, short of the key-material bound.
  - Pinning the `<=` start boundary: the whole-second shape cannot express it; commented.
- Incident (for the orchestrator): during implementation a `pkill -f "edge-runtime start"` stopped the manual-test stack's `supabase_edge_runtime_shift` container (`Exited (15)`). It was not restarted: containers are off limits to this story.

## Review Findings (review 2, 2026-11-21)

Seven layers ran unattended: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor, Epic AC Auditor, Unrun DB Test Auditor, and a regression diff of the re-created filter and claim against 0044 and 0046. The Artifact Renderer had nothing to render because the change generates no file. The Epic AC Auditor found no unlisted deviation. The regression diff found the filter is 0044's with one `SHIFT_REMINDER` email clause, and the claim is 0046's with three reminder-only settles and one reminder-only guard. Signatures, `security definer`, `search_path = ''` and grants are unchanged. Every new clause is gated on `code = 'SHIFT_REMINDER'`, so existing kinds see no change. `for update skip locked` is kept on every settle and the claim. `invoke_remind` is `invoke_notify` with the Vault names swapped, and it is inert without both secrets.

- [x] [Review][Patch] The window's comments now say what the code does. A row is first computed at most 5 minutes before it falls due, within D5's 15, and is still computed for up to 15 minutes after. The window is four runs wide, so every item is sent by about four consecutive runs, not "on an overlap": the unique key makes every later write nothing, and `accepted` counts each of them. [shift-reminders.ts, remind/handler.ts, 0070 comments]
- [x] [Review][Patch] The domain's `startsAt > now` test cannot drop a pair in the window, because every lead is due at least an hour before the start. This is now documented; the RPC's skip is the guard that matters, and the DB suite tests it. [shift-reminders.ts]
- [x] [Review][Patch] `invoke_remind`'s send branch was never run. A DB case now creates both Vault secrets in the rolled-back transaction and asserts one queued POST to `remind_url` with `Authorization: Bearer <remind_invoke_secret>`. It also replays those headers through `remind`'s handler and gets 200 `REMIND_RAN`. It copies `notify-boundary`'s `invoke_notify` case. [test/shift-reminders.test.ts]
- [x] [Review][Patch] Nothing pinned that `reminder_inputs()` answers `members: []`, not null, when nobody has a lead on. The handler would make a null into a 503 on every run. A DB case now turns every lead off in the transaction and asserts `[]`. [test/shift-reminders.test.ts]
- [x] [Review][Patch] New handler tests cover four more inputs:
  - an empty read gives 200 with nothing written;
  - a lowercase `bearer` scheme is accepted;
  - a read whose `now` is 0 or negative gives 503;
  - a write answered `1.5` or `null` gives 503.

  [test/remind.test.ts]
- [x] [Review][Patch] Key hygiene's "out of every migration" test now scans every migration for `vault.create_secret` or `vault.update_secret`, not only 0070. [test/key-hygiene.test.ts]
- [x] [Review][Patch] The autumn transition is now run through the selection as well as through `reminderDueAt`. On 2027-10-31, m1's 07:00 shift with H6 falls due at 00:00Z, not at the wall clock's 23:00Z. [packages/domain/test/shift-reminders.test.ts]
- [x] [Review][Patch] The parity probe used to check `Australia/Sydney` on Zagreb's dates only. It now uses Sydney's own four transition dates, with a spring pin: on 2026-10-04, H3 is 17:00Z, H6 is 14:00Z, and the evening before is 10:00Z (still AEST). [probe.ts, test/runtime-parity.test.ts]
- [x] [Review][Patch] The shape-breach case claimed it "writes nothing of its batch". That half is Postgres's statement atomicity, and no savepoint-free assertion can observe it. The case is retitled to what it shows: one bad item refuses the whole batch. [test/shift-reminders.test.ts]
- [x] [Review][Patch] Two ledger and spec fixes:
  - The 17.1 layout entry in `deferred-work.md` credited 17.2 with 17.1 review 2's browser check. It now says only that 17.2 recorded it.
  - 16.2's entry names the probe's zones and dates.
  - This spec's `review_loop_iteration` was stale.
- [x] [Review][Defer] OWNER 17.3: prove the armed path once (the cron's request answered 200, not 401 from a Vault and environment secret drift). A reminder more than 15 minutes behind every successful run is lost silently. [deferred-work.md]
- [x] [Review][Defer] OWNER 17.3: a late reminder. A `notify` backlog can send an `H12` row hours late, because the claim expires a row only at the start. Bound the staleness beside the push TTL, for email too. [deferred-work.md]
- Rejected, with reasons:
  - **Revive a row settled `REMINDER_TURNED_OFF` or `EMAIL_TURNED_OFF` when the lead is turned back on.**
    - The gap is between the write (at most 5 minutes before due) and the next once-a-minute claim.
    - Reviving settled rows is a retraction path in reverse. D5 and Q25 choose at most once.
    - The filter already drops an email that is off at insert, and a later run inserts it once the email is on again.
  - **Key on the shift type or start, or have the RPC check the timing.** Design Notes 3 and 8 (review 1). The caller is the trusted `service_role` function that runs the domain's selection (AD-7).
  - **One bad item blocks its chunk.** Design Note 10: items come from the domain only, so a malformed one is a defect to surface.
  - **"Two fetch POSTs" versus the chunked write.** This was review 1's recorded patch. A run with at most 1000 items still makes two POSTs.
  - **A whole-run deadline, an advisory lock, duration logs.**
    - This is AD-14's accepted scale risk. At pilot scale a run is one chunk.
    - Overlapping runs are harmless under the unique key.
    - pg_net keeps the answer body, which carries the counts.
  - **A success log line, or aggregate skip kinds.** AD-17 allows fixed codes only. The 200 body carries `members`, `due`, `accepted` and `skipped`.
  - **Start the image without `REMIND_INVOKE_SECRET` in the probe.**
    - "Refuses a missing invoke secret" is read as the bearer, as `notify`'s probe does.
    - The configuration fail-fast is unit-tested.
    - A second container for it is out of proportion.
  - **The cron test's Vault privileges.** `notify-boundary`'s identical delete and `vault.create_secret` steps run green in CI.
  - **Settle precedence for reminder rows (expired before email-off).** Both codes are final and neither is sent. Cosmetic.
  - **The new settles' scans.** They are at the same scale as 0046's, every pending row.
  - **A local manual-run guide.** That is DEPLOY.md, which belongs to 17.3.
  - **17.1's closure inside this PR.** This is the orchestration's choice, recorded in 17.1's spec.
  - **An end-to-end cron, function and database test.** Nothing is armed before 17.3. The deferred smoke covers it.
  - **No `anon` probe in "service_role alone".** The provisioning grant inventory pins it.

## Suggested Review Order

**The due instant and the selection (domain)**

- Entry point: H-leads are real hours before the instant; the evening is 20:00 the day before.
  [`zone.ts:170`](../../packages/domain/src/zone.ts#L170)

- R12 over the read's window, kept when due in [now − 15, now + 5) and not started.
  [`shift-reminders.ts:61`](../../packages/domain/src/shift-reminders.ts#L61)

**The database (0070)**

- The read: members with leads, active today, each with AD-19's assembly; the database's clock.
  [`0070_shift_reminders.sql:108`](../../supabase/migrations/0070_shift_reminders.sql#L108)

- The write: shape refused whole, state re-checked per item, names looked up in SQL.
  [`0070_shift_reminders.sql:154`](../../supabase/migrations/0070_shift_reminders.sql#L154)

- The re-check that skips what changed since the read.
  [`0070_shift_reminders.sql:240`](../../supabase/migrations/0070_shift_reminders.sql#L240)

- AD-18's deterministic subject; at most once through the outbox key.
  [`0070_shift_reminders.sql:293`](../../supabase/migrations/0070_shift_reminders.sql#L293)

- The filter's reminder email clause.
  [`0070_shift_reminders.sql:314`](../../supabase/migrations/0070_shift_reminders.sql#L314)

- Claim-time settlement: expired, turned off, email off.
  [`0070_shift_reminders.sql:420`](../../supabase/migrations/0070_shift_reminders.sql#L420)

- The unarmed job: nothing sent while Vault lacks `remind_url`.
  [`0070_shift_reminders.sql:624`](../../supabase/migrations/0070_shift_reminders.sql#L624)

**The function**

- One run: secret, read, project per member, chunked write.
  [`handler.ts:263`](../../supabase/functions/remind/handler.ts#L263)

- The read's frame; a broken member is skipped, not the run.
  [`handler.ts:179`](../../supabase/functions/remind/handler.ts#L179)

- Three variables, no Resend or VAPID key.
  [`router.ts:81`](../../deploy/functions/main/router.ts#L81)

**Wiring**

- Fourth function in config, with its import map.
  [`config.toml:203`](../../supabase/config.toml#L203)

- Copied and bundled with the domain's `dist`.
  [`Dockerfile:35`](../../deploy/functions/Dockerfile#L35)

- The compose's generated invoke secret.
  [`docker-compose.yml:1664`](../../deploy/coolify/supabase/docker-compose.yml#L1664)

- The image probe's refusals and stand-in read.
  [`probe-functions-image.sh:90`](../../scripts/ci/probe-functions-image.sh#L90)

**Tests**

- DST, midnight, half day, window and AC 3 over the parity fixture.
  [`shift-reminders.test.ts:39`](../../packages/domain/test/shift-reminders.test.ts#L39)

- The handler matrix with a fake gateway.
  [`remind.test.ts:148`](../../test/remind.test.ts#L148)

- DB suite, written unrun: once, re-check, filter, claim, cron.
  [`shift-reminders.test.ts:163`](../../test/shift-reminders.test.ts#L163)
