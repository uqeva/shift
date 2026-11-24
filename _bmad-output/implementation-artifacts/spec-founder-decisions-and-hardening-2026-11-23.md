---
title: 'Founder decisions of 2026-11-23, recorded and built; control characters in names; pg_net revoke'
type: 'chore'
created: '2026-11-23'
status: 'review'
baseline_commit: 'b3f37ec'
review_loop_iteration: 0
context: ['_bmad-output/planning-artifacts/founder-decisions-2026-11-23.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Six founder decisions were open across the epic 16, 17, 18 and 19 retrospectives, the epic 19 UX review (#340), 19.5's deferrals and the D-S5 checklist. On 2026-11-23 the founder said "go with your recommendations". Three of them need code: the calendar feed's per-IP limit (epic 16 A2), no reminders for a banned or deleted account (epic 17 A3 (b)) and a Vault arming that never puts the secret into a statement (epic 17 A3 (a)). Two dev hardening items from `deferred-work.md` were picked: control characters in names that reach email subjects (epic 17 A4) and story 20.4's deferred pg_net revoke (withdrawn on review: see Spec Change Log).

**Approach:** Record every decision where it was open, with one ledger (`founder-decisions-2026-11-23.md`). Build the three decided changes and the two hardening items, each with tests: a Kong route of its own for the feed with `rate-limiting`, migration `0075` (the feed's account check in the reminder read and write), the DEPLOY.md runbooks rewritten to `COPY … FROM STDIN`, migration `0076` (refuse control characters in team and shift-type names, existing rows folded) with UI validation; and an attempt at story 20.4's pg_net revoke, withdrawn (Spec Change Log).

## Boundaries & Constraints

**Always:** the founder's decisions as stated (120 a minute per client IP, that route only; the feed's account check, word for word; no secret in statement text). Each re-created function is its source's text plus the one change, diffed by a scaffold pin. Resolved deferrals get the `RESOLVED …` prefix. Migrations are 0075 onward.

**Ask First:** changing the founder's number or scope; touching member names (written by `admin-auth` too; left open).

**Never:** run DB-connecting tests, e2e, `supabase` or docker commands; signal a process; run gitleaks; write a host, address or secret into the public repository.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Feed burst | 121st feed request in a minute from one client IP | 429 from Kong on `functions-v1-calendar-feed`; other functions unaffected | `hide_client_headers` |
| Feed spelling | `/functions/v1//calendar-feed/x`, `/functions/v1/calendar%2Dfeed/x` | the limited route (Kong matches the normalized path) | — |
| Banned member | `banned_until` in the future, or `deleted_at` set | `reminder_inputs` omits them; `enqueue_shift_reminders` skips the item (0) | a lapsed ban is no ban |
| Name with a line break | `Tim\nA` (team or type) typed or sent | refused before sending (UI), 23514 `teams_name_characters` / `shift_types_name_characters` (DB) | own message key |
| Existing bad name | `Tim\nA` stored before 0076 | folded to `Tim A` | blank or colliding fold stops the migration `NAME_CONTROL_FOLD_CONFLICT` |

## Epic AC Deviations

No epic story; retro action items and deferrals only. Against those items:

- **Epic 16 A2** ("20.5 applies the confirmed number on a running stack"): the number is in the compose and pinned; the running-stack check (Kong resolves each client's own address, 429 past 120 a minute) stays with 20.5, `deferred-work.md` STILL OPEN.
- **Epic 17 A3 (a)** ("confirm logging settings or pass the value as a bind parameter"): a third method, `COPY … FROM STDIN` into a temporary table, because a bind parameter is logged under `log_statement = all` (Design Note 2). Proved under bash only; its first run against Postgres is the next arming (20.5's rehearsal).
- **Epic 17 A3 (b)**: a reminder already queued when an account is banned is still sent or settled within the claim's bound (about 20 minutes), accepted (Design Note 5).
- **Epic 17 A4** ("names for every notice email subject"): teams and shift types only; member names stay open, recorded in `deferred-work.md` and `sprint-status.yaml`.

</frozen-after-approval>

## Code Map

- `deploy/coolify/supabase/docker-compose.yml` -- Kong: new service `functions-v1-calendar-feed` before `functions-v1`, regex path `/functions/v1/(?=calendar-feed(?:/|$))`, cors as the catch-all's, `rate-limiting` `minute: 120`, `limit_by: ip`, `policy: local`, `hide_client_headers: true`.
- `supabase/migrations/0075_reminders_need_a_live_account.sql` -- `reminder_inputs`, `enqueue_shift_reminders` from 0073 plus the account check.
- `supabase/migrations/0076_names_refuse_control_characters.sql` -- guard, fold, `teams_name_characters`, `shift_types_name_characters`.
- `apps/web/src/utils/name.ts` -- `NAME_CONTROL_CHARACTER_CLASS`, `hasControlCharacter`, `namesCharacterCheck`.
- `apps/web/src/features/teams/services/write.ts`, `apps/web/src/features/shift-types/services/write.ts` -- `TEAM_NAME_CONTROL`, `SHIFT_TYPE_NAME_CONTROL`, refused before sending and read from the constraint; message keys. Both are the only writers of the two names (the onboarding steps reuse their dialogs).
- `apps/web/src/lib/i18n/locales/hr.json` -- `smjene.error.control`, `rotation.shiftTypes.error.nameControl`; `test/resource-hygiene.test.ts` pins both.
- `DEPLOY.md` -- §3a step 4 (notify arm and rotate) and the new *A secret never enters a statement*; §3b step 2 and rotation; §9.5 the two rehearsal blocks.
- Tests: `test/self-hosted-stack.test.ts` (feed route and limit; Vault arming blocks run under bash), `test/supabase-scaffold.test.ts` (0073 pin bounded to 0073; 0075 word-for-word; 0076 class and order), `test/shift-reminders.test.ts` (0075, DB), `test/name-key.test.ts` (0076, DB), web unit tests for `name.ts` and both write services.
- Records: `founder-decisions-2026-11-23.md` (new), `deferred-work.md`, `sprint-status.yaml`, `SECURITY-REVIEW-EPIC-19.md`, `ARCHITECTURE-SPINE.md` (AD-2, AD-14, AD-24, AD-25, Deferred), `sprint-change-proposal-2026-11-20-v2-scope.md`, `epics.md`, `prd.md:1135`, `epic-18-context.md`, the UX review README, `EXPERIENCE.md`, `DESIGN.md`, the mockups index, `spec-17-2…md` Design Note 9.

## Tasks & Acceptance

**Execution:**
- [x] Kong route and limit, with pins (founder 2 A2).
- [x] `0075` and its scaffold and DB tests (founder 5 (b)).
- [x] DEPLOY.md arming by `COPY`, the safety argument, and the bash-run pin (founder 5 (a)).
- [x] `0076`, UI validation, `hr.json`, unit, scaffold and DB tests (epic 17 A4, in part).
- [ ] ~~`0077` and its tests (20.4's deferral)~~ -- withdrawn on review (Spec Change Log).
- [x] Every record listed in the Code Map, and the ledger.

**Acceptance Criteria:**
- Given the rendered Kong config, when a request's normalized path's first function segment is `calendar-feed`, then it takes `functions-v1-calendar-feed`, limited 120 a minute per IP, and the upstream path is the catch-all's.
- Given a banned or deleted account, when `remind` reads or writes, then it gets no reminder; a lapsed ban does.
- Given any arming block in DEPLOY.md, when run, then the value is only the COPY's data row.
- Given a team or shift-type name with a control character inside it, when written by any caller, then it is refused by name.

## Design Notes

1. **Why a regex route with a lookahead.** Kong 2.8 tries regex paths before every prefix path and matches on the normalized path, so every spelling the router would serve as `calendar-feed` (its first raw segment, exactly) lands on the limited route. A prefix route `/functions/v1/calendar-feed` would also catch `calendar-feedx` and, under `strip_path`, change the upstream path; the lookahead leaves only `/functions/v1/` stripped, so the router receives exactly what the catch-all sends it. `limit_by: ip` is the address Kong resolved through `KONG_TRUSTED_IPS` and `X-Forwarded-For` (19.1); `policy: local` is DB-less Kong's only policy. The number is the founder's and is not a compose variable.
2. **Why `COPY` and not `\bind`.** A bind parameter keeps the value out of the statement text, but `log_statement = all` logs bound parameters as the statement's detail (`log_parameter_max_length` defaults to unlimited). A well-formed `COPY` data row is logged by no `log_*` setting; a malformed one is quoted in the error's `CONTEXT`, so the value is checked in the shell before anything is sent, and the copy is CSV with a delimiter (`\x01`) and quote (`\x02`) no value holds. A rotation refuses (`ARMING_SECRET_MISSING`) when the secret it would replace does not exist. The temporary table is session-local, not WAL-logged, and dropped at commit or rollback.
3. **0076 folds, then validates.** 0024 refused existing data instead of rewriting it; here the fold is a cosmetic change (a single-line input drops a pasted line break, but a pasted tab or U+2028 can survive, which is what the client check now refuses), recorded in the history as an operator write, and guarded so it can never blank a name or merge two. The checks are added validated.
4. **No pg_net migration.** See the Spec Change Log.
5. **Residuals accepted here.** The feed limit is per client IP, and server-side calendar fetchers (Google) poll many members' feeds from shared addresses, so at scale they share the 120 a minute (founder's number; 20.5 watches it). The arming blocks are proved under bash, not yet against Postgres (20.5's rehearsal is their first run). A reminder already queued when an account is banned is still sent or settled by the claim within its bound (0072: at most about 20 minutes). Member names may still hold control characters (open). 

## Verification

**Commands (local, DB-free):**
- `pnpm typecheck` -- passed.
- `pnpm lint` -- passed.
- `pnpm build` -- passed.
- `pnpm exec vitest run test/self-hosted-stack.test.ts test/supabase-scaffold.test.ts test/resource-hygiene.test.ts` -- passed.
- `apps/web`: `pnpm exec vitest run src/utils/name.test.ts src/features/teams/services/write.test.ts src/features/shift-types/services/write.test.ts` -- passed.

**Not run locally (STRICT DATABASE RULE; CI is their first run):** `test/shift-reminders.test.ts` (the 0075 case), `test/name-key.test.ts` (the 0076 cases and the adjusted 0024 cases). A local failure caused by the unapplied migrations would be expected.

## Spec Change Log

- **2026-11-24, review (Unrun DB Test Auditor), finding high.** `0077` (revoke pg_net from `anon` and `authenticated`, then raise `PG_NET_REVOKE_INEFFECTIVE` if a request role could still execute a `net` function) would have failed every stack start in CI: on the pinned image `postgres` is demoted (`NOSUPERUSER`), `pg_net` is created as `supabase_admin` through supautils, and the image's event trigger (owned by `supabase_admin`) makes the grants, so a REVOKE by `postgres` removes nothing. **Amended:** `0077`, `test/pg-net-grants.test.ts` and its scaffold pin removed; the deferral stays open in `deferred-work.md` with the finding and two options (an operator step as `supabase_admin`, or accept). **Known-bad state avoided:** a migration that cannot apply. **KEEP:** 0075, 0076, the Kong route and the DEPLOY.md arming, unchanged.
- **2026-11-24, review (all layers), patches.** DEPLOY.md: the value is checked in the shell (`grep -Eqx` on stdin) before any block sends it; `COPY` is CSV with `\x01`/`\x02` as delimiter and quote; every block carries the `ARMING_VALUE_INVALID` check, create blocks a `delete` first, rotations `ARMING_SECRET_MISSING`; prose corrected (a malformed `COPY` row is quoted in an error's `CONTEXT`). 18.2's AC and `epic-18-context.md` rewritten, not appended; 19.4's UX note updated; 0076's header names `NAME_CONTROL_CHARACTER_CLASS`; the 0075 test's messages corrected; a sprint-status action item for the terms and privacy link; three deferrals added (feed limit and shared fetcher IPs; the arming blocks unproved against Postgres; format characters and the fold conflict's detail).
