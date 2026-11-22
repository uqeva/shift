---
title: "17.3 Reminders reach the member by push or email"
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_commit: 'b5e0c94df104a638e7332e1abe4191ef643548bb'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

Status: done. Merged as #350 (squash `bac8d1b`, 2026-11-22) with `CI passed` green in run 44966269960 (head `bcb7990`). CI (PR #350): run 44965308725 on `33a1cf4` failed `Test (Vitest, local Supabase)` on one case, `test/provisioning.test.ts` "holds an expected grantee entry for every function in public and private" (`expected [ 'private.reminder_late/2' ] to deeply equal []`); its E2E shards 3 and 4 were cancelled by the next push. Review 2's `bcb7990` adds `private.reminder_late/2` to both inventories (Review Findings, review 2, first patch); whether review 2 found it independently or from that run is not recorded. No other commit was pushed for CI. Run 44966269960 passed every job: `test/shift-reminders.test.ts` (19), `test/notify-reminder.test.ts` (49), `test/provisioning.test.ts` (319), 0072 on CI's fresh stack, and the four E2E shards (599 passed, none flaky), which include `e2e/tests/notifications/reminder-delivery.spec.ts`. Approved unattended under the founder's standing instruction (decide and record, no questions). ~2.6k tokens, kept whole: one user goal (a due reminder reaches the member, in words, linking to the day) across `notify`, one migration, the e2e and the deploy runbook; the arming and its proof are what make delivery real, so splitting them off would ship a renderer nothing calls. Baseline: `main` at #349 (19.3, squash `b5e0c94`), after #348 (17.2, `abe226e`). Touches `hr.json` (hot: no other hot-file story runs from this baseline). Migration `0072` (19.5 runs in parallel with `0073`). Residual risks CI did not settle: no real Resend or push send was made (CI holds no key), the armed path has run only on CI's local stack, not on staging or production (`deferred-work.md`, the 17.3 entry), and the 17.1 card's other states have had no human look on a phone (OWNER 20.5). Rewritten as merged by the epic 17 retrospective (`epic-17-retro-2026-11-22.md`).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 17.2 writes `SHIFT_REMINDER` rows, but `notify` cannot render them (they would retry `MESSAGE_UNKNOWN` and fail), the push would live a day, a backlog could send "Za 12 h" hours late, and the `remind` job is unarmed with no runbook and no proof that its Vault secret matches the function's (AD-14, AD-18; 17.2's OWNER 17.3 entries).

**Approach:** `notify` renders the code from a pinned copy of `hr.json`'s `reminders.notice` (variant by lead, minutes through `TIME_OPERANDS`), links to the day, ends the email with the *Podsjetnici* footer, and bounds the push TTL. Migration `0072` makes the claim settle a reminder that waited too long. DEPLOY.md arms the job; `write-local-env` and an e2e arm it locally, prove the cron's call is answered `REMIND_RAN`, and drive one reminder end to end on a fake clock.

## Boundaries & Constraints

**Always:**
- Copy: `reminders.notice.{hours,eveningBefore}.{subject,body}` and `reminders.notice.footer` in `hr.json`; `notify/messages.ts` holds `PODSJETNICI`, pinned deep-equal. Subjects `Za {leadHours} h radiš: {shiftTypeName} {start}–{end}, {teamName}` and `Sutra radiš: …`; bodies name the organization and the date and end with `Pogledaj dan u kalendaru: {link}`. No "tim", no `smjena` word (a team is its own name).
- `SHIFT_REMINDER` is rendered on its own branch; `MESSAGE_OF_CODE` and every existing code render byte-identically. The variant is `REMINDER_VARIANT_OF[lead]` (keys exactly `REMINDER_LEADS`, held equal by a root test). `start`/`end` are `TIME_OPERANDS`: whole minutes `0 ≤ m ≤ 2879`, shown as `HH:MM` of `m mod 1440` (equal to the SPA's `formatMinuteOfDay`). An unknown lead, a bad date, team id or minute, or a missing name is `OPERANDS_INVALID`.
- Link `/kalendar?mjesec=<YYYY-MM>&dan=<date>&danSmjena=<teamId>` through `/prijava/<slug>?povratak=…`, which `returnTargetOf` keeps. The email footer links `/obavijesti`.
- Push TTL for `SHIFT_REMINDER`: `max(0, min(startsAt − now, 900 s))`; every other code keeps `PUSH_TTL_SECONDS`. `notify` computes no domain answer.
- `0072`: 0070's claim, plus one settle `REMINDER_LATE` for a pending reminder written 20 minutes ago or more, and the same guard in the select; every other clause, the return type and the grants unchanged.
- Arming is DEPLOY.md's (Vault `remind_url` = `http://supabase-kong:8000/functions/v1/remind`, `remind_invoke_secret` = the container's `REMIND_INVOKE_SECRET`), after a `notify` that renders the code; its smoke reads `net._http_response` for 200 `REMIND_RAN`. No migration writes Vault.
- `write-local-env` writes a fresh random `REMIND_INVOKE_SECRET` (64 hex) into `supabase/functions/.env`.
- E2E (written unrun; CI is its gate): arms the local Vault, calls `private.invoke_remind()`, sees 200 `REMIND_RAN`, disarms; then one lead on through *Podsjetnici*, `remind`'s handler in process with the read's `now` set to the due instant and narrowed to the test member, exactly one row per channel after two runs, each rendered with its link opening the day; lead off, none. The card shows no horizontal overflow at 390 px and 1280 px.
- Required inputs from `deferred-work.md` (OWNER 17.3) answered in Design Notes and marked.

**Ask First:** none (founder: decide and record).

**Never:** a `send_after` column; retracting a reminder; zone arithmetic in `notify` or SQL; a Vault write in a migration; a literal secret anywhere; running DB tests, e2e, `supabase` or containers locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hours | `H2`, 07:00–19:00, Smjena A, 2026-11-23 | `Za 2 h radiš: Dnevna 07:00–19:00, Smjena A` | none |
| Evening | `EVENING_BEFORE`, no `leadHours` | `Sutra radiš: …` | none |
| Night half | start 1500, end 1860 | `01:00–07:00` | none |
| Bad operand | lead `H4`, start 2880, teamId not a uuid | not sent this attempt | `OPERANDS_INVALID` (transient) |
| TTL | startsAt in 1 h / 5 min / past | 900 / 300 / 0 s | none |
| Late | pending reminder written 20 min ago | settled `REMINDER_LATE`, never claimed | none |
| Channels | push only / email only / both / neither | rows for exactly those channels | none |
| Armed | Vault and container secrets equal | cron call answered 200 `REMIND_RAN` | 401 means drift |

## Epic AC Deviations

- "a reminder already sent … is not retracted, and the FR-62 change notification covers it" — met by construction (no path deletes or edits a sent row; FR-62's notices are epic 10's); asserted statically, not by an e2e of a shift change.
- "an e2e test with a fake clock … exactly one reminder arrives per shift and channel" — "arrives" is the outbox row and its rendered email and push; nothing is posted to Resend or a push service from CI (no key there), so the send itself is the Vitest suite's.

</frozen-after-approval>

## Code Map

- `supabase/functions/notify/messages.ts` -- `OBAVIJESTI`, `DATE_OPERANDS`, `compose` (the branch), `linkOf`/`signInPathOf`; add `PODSJETNICI`, `TIME_OPERANDS`, `REMINDER_VARIANT_OF`, `REMINDER_LEADS`, `reminderPathOf`, `formatMinute`.
- `supabase/functions/notify/push.ts:165` -- `ttl: PUSH_TTL_SECONDS`; add `pushTtlSecondsOf(code, operands, now)`, `deliverPush` takes `now`.
- `supabase/functions/notify/handler.ts` -- `REMINDER_PUSH_TTL_MAX_SECONDS = 900`; `run.ts` passes `now()`.
- `supabase/migrations/0070_shift_reminders.sql:358` -- the claim to copy into `0072_reminder_delivery.sql`.
- `apps/web/src/lib/i18n/locales/hr.json:2609` (`reminders`); `test/resource-hygiene.test.ts:2507` sanctions.
- `apps/web/src/lib/i18n/format.ts:65` `formatMinuteOfDay`; `apps/web/src/features/auth/services/return-target.ts:133` `returnTargetOf`.
- `test/notify-boundary.test.ts:223` -- the pin pattern (DB-connecting; not run here); new DB-free `test/notify-reminder.test.ts`.
- `test/supabase-scaffold.test.ts:6466` -- "no later migration redefines the claim" pin, moved to 0072; new 0072 block.
- `test/shift-reminders.test.ts` -- DB, unrun: `REMINDER_LATE` and the four channel cases.
- `scripts/ci/write-local-env.mjs`, `test/ci-scripts.test.ts:238`.
- `e2e/tests/notifications/reminder-delivery.spec.ts` (new); `e2e/utils/database-helper.ts` (Vault arm/disarm, outbox read and cleanup, member team); `seedTeamRotation`/`holdRotation`, `holdNotificationSettings`, `organizationInstant`.
- `DEPLOY.md` §1 (local), §3b (new), §9.5 step 7b, §9.6 Cron.
- Mappers (A11): no row gains a column. E2E cleanup: no new table.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `test/resource-hygiene.test.ts` -- `reminders.notice` copy and its sanctions.
- [x] `supabase/functions/notify/{messages,push,run,handler}.ts` -- render, link, footer, TTL.
- [x] `test/notify-reminder.test.ts` (new, DB-free) -- pin, every lead, minutes, link through `returnTargetOf`, footer, refusals, TTL, unchanged codes, the lead set equal to the domain's, no retraction path.
- [x] `supabase/migrations/0072_reminder_delivery.sql`, `test/supabase-scaffold.test.ts`, `test/shift-reminders.test.ts` -- `REMINDER_LATE`.
- [x] `scripts/ci/write-local-env.mjs`, `test/ci-scripts.test.ts`, `supabase/functions/.env.example` -- local invoke secret.
- [x] `e2e/utils/database-helper.ts`, `e2e/tests/notifications/reminder-delivery.spec.ts` -- armed path and delivery.
- [x] `DEPLOY.md` -- §3b arming, smoke, local.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-21 (17.3)` on AD-14 and AD-18; `EXPERIENCE.md:79`, `epics.md` UX-DR57; `deferred-work.md` entries marked; `sprint-status.yaml`; 17.2's spec set done.

**Acceptance Criteria:**
- Given an `H2` reminder row, when `notify` sends it, then the email reads `Za 2 h radiš: …` with the day's link and the *Podsjetnici* footer, and the push carries the same title and a TTL no longer than 15 minutes nor past the start.
- Given every existing code, when rendered, then its text is unchanged.
- Given the armed local stack, when the cron's own call runs, then pg_net records 200 `REMIND_RAN`.

## Spec Change Log

- **Review 1 (2026-11-21): patches that tighten the frozen Boundaries' late bound and TTL, inside the intent.**
  - **Trigger.** The Edge Case Hunter and the Blind Hunter both found the same gap. A bound counted from `created_at` alone lets an `H1` reminder arrive about 35 minutes after it was due, reading "Za 1 h" with 25 minutes left. A TTL of 0 is still delivered to an online device.
  - **Amended** (Design Notes 4 and 5, AD-18, DEPLOY.md §3b):
    - A reminder is also late once it is 15 minutes past an `H<n>` lead's due instant.
    - The TTL also stops at that instant.
    - A reminder push with no TTL left is not posted.
  - **The frozen lines stay true as written.** A row written 20 minutes ago is still settled, and the TTL is still at most `min(startsAt − now, 900 s)`. The bound is only tighter.
  - **Known-bad state avoided:** a reminder that tells the wrong time.
  - **KEEP:**
    - no zone arithmetic in SQL or `notify` (the evening before keeps the `created_at` bound);
    - 0070's other clauses byte-identical;
    - the `REMINDER_LATE` settle between the expiry settle and the lead settle.

## Design Notes

Decisions (founder: decide and record):
1. **The copy's home** is `reminders.notice` (17.1's namespace), mirrored in `notify` as `PODSJETNICI` beside `OBAVIJESTI`, each pinned to its namespace; `notify-boundary`'s pins of `obavijesti` stand untouched.
2. **Words.** The subject is the epic's line; the body adds the organization and the date (`22.11.2026`), as every notice does. The team is its own name, never "tim".
3. **The footer** links `/obavijesti` (the card is its third section; a hash would not survive the card's async load), and names *Obavijesti → Podsjetnici*.
4. **Late reminders (17.2's entry), as patched in review 1.** A row is written at most 5 minutes before due and at most 15 after. `0072`'s `private.reminder_late` makes it late 15 minutes past its due instant when the lead is `H<n>` (`startsAt − n hours`, a subtraction, `leadHours` agreeing with the lead), or 20 minutes after it was written (`created_at`, every lead: the evening before's due instant needs the zone, so it has only this). The claim settles a late row `REMINDER_LATE`. So an `H<n>` reminder never reaches a device more than 15 minutes after it fell due; the evening-before one ("Sutra radiš") at most about 35 minutes after it was written, when "tomorrow" is still true. An email written by its due instant and retried once (10 min backoff) still goes; one written more than 5 minutes past due may be settled late before its retry (review 2).
5. **TTL**, as patched in review 1: `max(0, min(startsAt − now, 900 s, due + 15 min − now))`, `now` the handler's clock, the last term for an `H<n>` lead only; an unreadable `startsAt` is 0, and the render refuses such a row first. A reminder whose TTL is 0 is never posted (a push service may still deliver a TTL of 0 to an online device): it fails `REMINDER_LATE`. AD-18 amended.
6. **Arming (17.2's entry).** DEPLOY.md §3b: deploy the `notify` that renders `SHIFT_REMINDER`, then the two Vault writes on stdin, then the smoke (prove the armed path, 17.2's entry): `select private.invoke_remind()` and, after a few seconds, `net._http_response` 200 with `REMIND_RAN`; 401 is a secret drift, 503 an unreachable read. Rotation as `notify`'s.
7. **Locally** `write-local-env` generates `REMIND_INVOKE_SECRET` (never a literal); the e2e reads it from `supabase/functions/.env`, arms Vault with `http://supabase_kong_shift:8000/functions/v1/remind`, and deletes both secrets after. An existing `.env` from before needs `--force` once.
8. **The fake clock.** `remind`'s clock is the database's (17.2 decision 1), so the e2e runs `remind`'s own `createHandler` in process over the real gateway, replacing only the read's `now` with the due instant (`H1` before tomorrow's seeded `Noć` at 19:00, `organizationInstant`) and narrowing `members` to the test member, so no other member is written on a fake clock. The RPC's real-clock re-check still applies.
9. **Second half of a night** keeps 17.2's date: the text shows the worked half's times (`01:00–07:00`) and the shift's date, as the calendar does.
10. **Deferred inputs:** rendering, TTL, the footer, DEPLOY.md, arming and `write-local-env`, the armed-path proof (written; its first run is CI's, real environments a new entry), the late bound — all above. The 17.1 card's live layout: the e2e asserts no sideways scroll at 390 px and 1280 px in the both-channels and off states (CI looks; no human eye here); the other states keep their 17.1 harness check, and a human look on a phone stays 20.5's (entry marked in part).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/notify-reminder.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts test/functions-router.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/runtime-parity.test.ts test/remind.test.ts test/localization-guard.test.ts test/localization-applied.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts` -- pass.

**Manual checks:**
- 0072 in a throwaway in-process PGlite over stub tables: a reminder written 21 minutes ago settles `REMINDER_LATE`, one written 19 minutes ago is claimed.
- Unrun by rule: `test/notify-boundary.test.ts`, `test/shift-reminders.test.ts`, the e2e spec; CI is their first run. CI: they passed in run 44966269960 (PR #350).

**Results (implementation, 2026-11-21).** Implemented directly by the planning agent (its investigation was already in context; no fresh subagent re-read the tree).
- `pnpm typecheck` (all four projects), `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 22 files, 975 passed. `pnpm --filter @shift/ics test`: 31 passed. `pnpm --filter ./apps/web test`: 184 files, 6859 passed (`key-sweep.test.ts` now leaves `reminders.notice.*` to `notify`, as it does `obavijesti.*`).
- The fourteen DB-free root files above: 3292 passed (`test/notify-reminder.test.ts` 37 of them).
- **0072 in PGlite** (scratchpad harness `s173/check-0072.mjs`, stub tables and helpers, no shared database): a reminder written 20 minutes before was settled `REMINDER_LATE` and not claimed; one written 19 min 59 s before was claimed; a `LOAN_MADE` row written two hours before was claimed, untouched.
- **The e2e's imports under Playwright's loader**, checked with a throwaway one-test config in the worktree (no browser, no stack, no web server; deleted after): `remind/handler.ts` resolves `@shift/domain` through the root `tsconfig.json`'s paths onto the source, whose `.js` specifiers resolve to `.ts`, and `notify/messages.ts` loads. The spec itself was not run.
- **Unrun, by rule:** `test/shift-reminders.test.ts`'s two new cases (`REMINDER_LATE`, the four channel cases), `test/notify-boundary.test.ts` (unchanged, DB-connecting), 0072 on a real Postgres, and `e2e/tests/notifications/reminder-delivery.spec.ts`. CI is their first run. CI: the first run (44965308725) failed `provisioning`'s inventory on `private.reminder_late/2`; after review 2's fix all passed in run 44966269960.

## Review Findings (review 1, 2026-11-21)

Five layers ran unattended: the Blind Hunter, the Edge Case Hunter, the Verification Gap reviewer, the Epic AC Auditor and the Unrun DB Test Auditor. The Epic AC Auditor found no unlisted deviation: three ACs are met, and two are met in part, both listed. The Unrun DB Test Auditor found no out-of-order scene, no wrong code and no misstored value. It found one weak assertion, patched below.

- [x] [Review][Patch] The late bound now measures from the due instant of an `H<n>` lead, and the push TTL stops there too. A reminder push with no TTL left fails `REMINDER_LATE` and is never posted. [0072, push.ts, Spec Change Log]
- [x] [Review][Patch] The render now refuses an unreadable `startsAt`, which the TTL comment claimed it already did, and a `leadHours` that disagrees with its lead. `REMINDER_LEAD_HOURS` in `notify` is held equal to the domain's. [messages.ts, test/notify-reminder.test.ts]
- [x] [Review][Patch] `TIME_OPERANDS` now applies to `SHIFT_REMINDER` only. Any other code renders as before, whatever its operands are named, and a test covers it. [messages.ts]
- [x] [Review][Patch] DEPLOY.md's proof now reads the request's own row (`where id = $ID`), because `notify` answers every minute. It also lists the other answers: `REMINDER_ENQUEUE_FAILED`, 404, a transport error, and no row yet. [DEPLOY.md §3b, §9.5]
- [x] [Review][Patch] The runbook is now safer to follow:
  - Arming deletes the two Vault names first, so a re-arm or a second rehearsal does not fail.
  - The value reaches the shell through `read -rs`.
  - Disarming says that queued rows are still sent, and how to settle them.
  - Rotation is timed after a tick.
  - The combined worst case (15 minutes past due, or about 35 minutes for the evening before) is stated.

  [DEPLOY.md]
- [x] [Review][Patch] The channel DB case now asserts that each enqueue is accepted. The "neither" row therefore cannot pass because the item was skipped. [test/shift-reminders.test.ts]
- [x] [Review][Patch] The late-settle DB case now also covers three more rows:
  - a row 16 minutes past its due instant, written just now: `REMINDER_LATE`;
  - a row that is late and has started: `REMINDER_EXPIRED`, because the expiry settle runs first;
  - an old row of another code: untouched.

  The PGlite harness covers seven such rows. [test/shift-reminders.test.ts]
- [x] [Review][Patch] The e2e now checks that the day detail opens for the team on that date and names the `Noć`. It no longer checks only the URL. The pg_net poll waits 60 s, beyond pg_net's 55 s timeout. [reminder-delivery.spec.ts, database-helper.ts]
- [x] [Review][Patch] `deferred-work.md` marks the card layout and the armed-path proof RESOLVED in part, naming what stays open: the other states for a human on a phone (20.5), the first real-environment run, and a standing alert. The body status line no longer says draft.
- Rejected, with reasons:
  - **`OPERANDS_INVALID` as permanent.** Transient is every code's rule: a row a newer migration writes before the newer `notify` is deployed. The late bound ends a reminder within 20 minutes anyway.
  - **A device endpoint under `.invalid`.** 0045's check admits only real push hosts. The CI stack arms no `notify` job and holds no VAPID private key, and the case deletes its rows.
  - **Arming crashes or overlaps in the shared local Vault.** CI gives each shard a stack of its own. Locally the arm-to-disarm window is seconds, under the settings lock, and it restores whatever it replaced.
  - **Asserting `due: 0` for the real-clock call.** Another run's organization on a shared local stack may have leads on. The proof is the 200 and the code.
  - **Quoted or duplicated `.env` values.** `write-local-env` writes neither.
  - **`--force` rotating the local secret under a running `functions serve`.** This is documented. The e2e reads the file the served function read when it started in CI.
  - **A push body without the absolute link.** This is every notice's existing shape (retro 10 A6), not this story's.
  - **Pinning the e2e tsconfig path against the root one.** The typecheck fails if either moves, and the Playwright loader check showed the run-time resolution.
  - **The shape check in `write-local-env`.** It is `remind`'s own `INVOKE_SECRET_SHAPE` rule (at least 32 URL-safe characters); 64 hex is what it generates.
  - **Testing FR-62 after a sent reminder.** This is listed in the Epic AC Deviations.


**Results (review 1, 2026-11-21).** `pnpm typecheck`, `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 975 passed. `pnpm --filter @shift/ics test`: 31 passed. `pnpm --filter ./apps/web test`: 184 files, 6859 passed. The fourteen DB-free root files: 3302 passed (`test/notify-reminder.test.ts` 46). The PGlite harness (`s173/check-0072.mjs`) on the patched 0072: seven rows as expected (written 20 min ago, late; 19 min 59 s, claimed; H1 16 min past due, late; 10 min past due, claimed; mismatched `leadHours`, claimed; a recent evening-before row, claimed; an old `LOAN_MADE`, claimed). Still unrun, so first run in CI: the DB cases, 0072 on a real Postgres and the e2e spec. CI: passed in run 44966269960 (PR #350).

## Review Findings (review 2, 2026-11-22)

Six layers ran unattended on `origin/main...HEAD` (`33a1cf4`): the Blind Hunter, the Edge Case Hunter, the Verification Gap reviewer, the Acceptance Auditor, the Epic AC Auditor and the Artifact Renderer.

- **Acceptance and Epic AC Auditors.** No AC is violated, and no deviation is unlisted. Each deferred AC has its entry.
- **0072 against 0070.** Both `claim_notifications` bodies were extracted and run through `diff`. They differ only in the `REMINDER_LATE` settle, between the expiry settle and the lead settle, the select's `and not private.reminder_late(...)` guard, and one comment. The following are byte-identical, so no other kind of notification changes:
  - the signature and the return table;
  - `security definer` and `search_path ''`;
  - every other settle and its in-flight guard;
  - the claim's order, `limit` and `skip locked`;
  - the four grants.
- **Privacy.** The copy's placeholders are exactly the organization's name, the date, the member's own shift type, the start and end, the member's own team, the link and `leadHours`. A test pins this set. The link carries only the slug, the date and the team id.
- **Injection.** No email is HTML: `email.ts` posts `subject` and `text` to Resend as JSON. So a name with `<script>` in it is shown as text, and nothing can be injected into a header. A CR/LF in a name is a pre-existing gap that every notice shares (deferred, below).
- **The tap path.** `povratak` is not an open redirect. `reminderPathOf` builds a fixed `/kalendar?…` from a checked ISO date and an anchored UUID, `signInPathOf` URI-encodes both slug and path, and the SPA's `returnTargetOf` admits same-origin paths only.
- **`write-local-env`.** The secret is `randomBytes(32)` hex, written to a 0600 file and never echoed.
- **Croatian copy.** Grammar and diacritics are correct (`radiš`, `Podsjetnike`, `e-poštom`, `Pogledaj dan u kalendaru`).
- **Artifact Renderer.** A real H2 email and an evening-before email were rendered with `notify`'s own `render` and `renderPush`, through esbuild, with no stubs.
  - The fixture used a 90-character organization name, a 120-character team name with a 51-character unbroken word, and a shift type holding `<script>`, `&` and quotes.
  - The output was shown as a text/plain mail in the standalone Chromium harness at 390 px and 1280 px.
  - Nothing overflowed. Every diacritic and the `→` rendered, and the markup showed as literal text. Night times read `01:00–07:00`, the date `23.11.2026`, and both links are fully encoded.
  - Files: `/tmp/claude-0/-root-ai-agency-projects-shift/15d9a6a8-661d-4657-8658-921e573ab7c3/scratchpad/s173r2/`.

- [x] [Review][Patch] **CI's first DB run would have failed.** `test/provisioning.test.ts` sweeps every function in `public` and `private` against its grantee list, and its invoker list held no `private.reminder_late/2`. Both lists now hold it: grantees none, `SECURITY INVOKER`, empty `search_path`. (high) [test/provisioning.test.ts]
- [x] [Review][Patch] **The e2e's cleanup now survives a timeout.** Both cases register each change for `afterEach` the moment it is made, in one `undo` stack that runs newest first. One failed undo no longer skips the rest. The changes are the Vault arm, the rotation lock and its seed, the member's devices, reminder settings and email, the organization's email switch, and the reminder rows.
  - Before, all of this ran in the body's `finally`, and holds were taken before the `try`. A timeout or a throwing hold could leak the rotation lock or the settings. On a retry, a leaked arm would have been saved as "what was there" and restored, leaving the shard's stack armed for every later spec. (medium) [reminder-delivery.spec.ts]
- [x] [Review][Patch] **The DEPLOY.md runbook is safer to run.**
  - Arming runs as one transaction (`psql -1`), so a failure cannot leave Vault half armed.
  - The proof checks for an empty request id before it builds `where id = $ID`. §9.5 also selects `error_msg`.
  - Rotation has its own stdin-only `vault.update_secret` snippet.
  - The hand settle on disarming is fully qualified. It skips rows `notify` holds in flight, clears `next_attempt_at`, and records `REMINDER_DISARMED` rather than passing as `REMINDER_LATE`.
  - The TTL sentence now lists its three bounds. (medium) [DEPLOY.md §3b, §9.5]
- [x] [Review][Patch] **The push names its failure by cause.** A reminder push with no TTL left whose shift has already started now fails `REMINDER_EXPIRED`, as the claim names that case; otherwise it fails `REMINDER_LATE`. The push's 15-minute grace is exported, and a test holds it equal to 0072's `interval '15 minutes'`. (low) [push.ts, test/notify-reminder.test.ts]
- [x] [Review][Patch] **The "no `tim`, no `smjena`" rule is now a test** over every reminder subject, body and footer. (low) [test/notify-reminder.test.ts]
- [x] [Review][Patch] **The retry claim is narrowed.** "An email retried once still goes" holds for a row written by its due instant. One written more than 5 minutes past due may be settled late before its retry. Design Note 4 and the 0072 header now say so. (low) [0072, Design Notes]
- [x] [Review][Defer] **A CR/LF in a name reaches every notice's email subject.** This is pre-existing and shared by every code, and the frozen rule keeps the existing codes byte-identical. [notify/messages.ts] — deferred to `deferred-work.md`.
- [x] [Review][Defer] **psql interpolates `:'secret'` on the client.** A failed `vault.create_secret` would therefore log the value in the server's error log. This applies to §3a's existing `notify` arming as much as §3b. [DEPLOY.md] — deferred to `deferred-work.md` (D-S5).
- Rejected, with reasons:
  - **The §9.5 rehearsal never loads `SERVICE_PASSWORD_64_REMINDINVOKE`.** It does: the rehearsal sources `$R/.env` with `set -a` before step 7b. It also never needs to disarm, because its trap removes the whole stack, volumes included.
  - **Edge and database clocks may differ.**
    - Self-hosted, both run on one host under NTP, so the skew is seconds against a 15-minute bound.
    - Taking `now` from the claim would change `notify`'s claim contract for every code.
  - **A `leadHours` stored as the string `"2"`.** Only 0070 writes the row, and it writes a number. The SQL treats the string as valid while `notify` refuses it, so such a row would be retried until 0072 settles it late, within 20 minutes. It is never sent wrong.
  - **The evening-before push has no `created_at` term.** This is as specified. The claim's 20-minute bound plus at most 15 minutes of TTL is the stated "about 35 minutes" (Design Note 4, DEPLOY.md).
  - **Trim surrounding spaces in names.** Every notice interpolates names exactly as they were saved, and the database refuses blank ones.
  - **The e2e hardcodes `19:00–07:00` and the 18:00 due instant.** These are the seeded `Noć`'s fixed times (`seedTeamRotation`). A changed seed fails loudly at the subject assertion, which names both.
  - **The "never retracted" test is weak.** It is a static guard over later migrations, beside the structural fact that no path deletes or edits a sent row. Its regexes catch the claim's own settles and any plain `delete from` the outbox.
  - **The channel DB cases depend on their order.** They form one scene on purpose: case 3 removes the device that case 4 must lack. The DB auditor of review 1 and this review's Verification Gap reviewer traced all four cases as correct.
  - **`REMINDER_LATE` lives in `push.ts`, not `handler.ts`.** This is cosmetic. The code is used only by the push branch.
  - **0073 (19.5) may need to redefine the claim.** The scaffold pin "no later migration redefines the claim" now names 0072, so a 19.5 claim copied from 0070 fails CI and must start from 0072's.
  - **A night's second half names the shift's date.** This is Design Note 9's decision, the same as the calendar's.
  - **Spec wording (37 vs 46 tests; 21 vs 20 minutes).** These counts come from different runs: the implementation's and review 1's. Both statements are true.
  - **`deferred-work.md` is hard to read, and the new entry has no story owner.** This is out of scope. The entry names its owners: the first staging and production deploys, and 20.5.
  - **An e2e killed by a signal leaves the local Vault armed.** `afterEach` now covers every failure and timeout. Only a process kill bypasses it. CI's stacks are per shard and thrown away, and locally the window is seconds.

**Results (review 2, 2026-11-22).**
- `pnpm typecheck`, `pnpm lint` and `pnpm build`: clean.
- `pnpm exec vitest run` on `test/resource-hygiene.test.ts`, `test/supabase-scaffold.test.ts`, `test/key-hygiene.test.ts`, `test/functions-router.test.ts`, `test/remind.test.ts`, `test/notify-reminder.test.ts`, `test/localization-guard.test.ts`, `test/localization-applied.test.ts` and `test/coolify-deploy.test.ts`: 9 files, all passed. `notify-reminder` has 49 tests.
- Unrun by rule, so CI is their first run: `test/provisioning.test.ts`'s new entries, `test/shift-reminders.test.ts`'s cases, 0072 on a real Postgres, and the e2e spec. CI: all passed in run 44966269960 (PR #350).

## Suggested Review Order

**The rendered reminder**

- Entry point: a reminder renders on its own branch; every other code is untouched.
  [`messages.ts:641`](../../supabase/functions/notify/messages.ts#L641)

- The pinned copy of `reminders.notice`: the epic's two lines and the footer.
  [`messages.ts:208`](../../supabase/functions/notify/messages.ts#L208)

- Minutes as clock times, for reminders only, mod a day for a night's half.
  [`messages.ts:584`](../../supabase/functions/notify/messages.ts#L584)

- The day link the calendar opens, through the sign-in.
  [`messages.ts:421`](../../supabase/functions/notify/messages.ts#L421)

**Never late**

- TTL: never past the start, 15 minutes, or due + 15 minutes.
  [`push.ts:55`](../../supabase/functions/notify/push.ts#L55)

- No time left: failed, never posted.
  [`push.ts:202`](../../supabase/functions/notify/push.ts#L202)

- The late predicate: the due instant for hours leads, the write time for all.
  [`0072_reminder_delivery.sql:42`](../../supabase/migrations/0072_reminder_delivery.sql#L42)

- The settle, between expiry and the lead settle; and the claim's guard.
  [`0072_reminder_delivery.sql:153`](../../supabase/migrations/0072_reminder_delivery.sql#L153)
  [`0072_reminder_delivery.sql:280`](../../supabase/migrations/0072_reminder_delivery.sql#L280)

**Arming and its proof**

- The runbook: order, Vault on stdin, the proof by request id.
  [`DEPLOY.md:382`](../../DEPLOY.md#L382)

- A fresh local invoke secret per stack.
  [`write-local-env.mjs:46`](../../scripts/ci/write-local-env.mjs#L46)

- The e2e arms the local Vault and reads pg_net's answer.
  [`database-helper.ts:2655`](../../e2e/utils/database-helper.ts#L2655)
  [`reminder-delivery.spec.ts:143`](../../e2e/tests/notifications/reminder-delivery.spec.ts#L143)

**The fake clock**

- `remind`'s own handler with only the read's `now` replaced.
  [`reminder-delivery.spec.ts:112`](../../e2e/tests/notifications/reminder-delivery.spec.ts#L112)

- One lead on through the card; one row per channel; the day opens; off, none.
  [`reminder-delivery.spec.ts:161`](../../e2e/tests/notifications/reminder-delivery.spec.ts#L161)

**Tests and pins**

- Render, TTL and the run, DB-free.
  [`notify-reminder.test.ts:79`](../../test/notify-reminder.test.ts#L79)

- DB, written unrun: the late settle and the four channel cases.
  [`shift-reminders.test.ts:446`](../../test/shift-reminders.test.ts#L446)

- 0072 is 0070's claim plus the settle and guard, word for word.
  [`supabase-scaffold.test.ts:6551`](../../test/supabase-scaffold.test.ts#L6551)

- The copy in `hr.json`.
  [`hr.json:2638`](../../apps/web/src/lib/i18n/locales/hr.json#L2638)
