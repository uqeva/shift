---
title: 'Story 20.8: Someone hears when Shift is down (interim)'
type: 'feature'
created: '2026-11-23'
status: 'in-review'
baseline_revision: 'b3f37ec51385befe78631e9d56c8082ed9a8d0fc'
baseline_commit: 'b3f37ec51385befe78631e9d56c8082ed9a8d0fc'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-20-7-backups-leave-the-host-and-a-restore-is-rehearsed.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing watches staging from outside the host, and nothing on the host notices a failing pg_cron job: `housekeeping`'s counts and halts are invisible (its log lines are dropped, 19.5's entry), a `remind` or `notify` call answered 401/500 is read by nobody (17.2/17.3's entries), and Kong runs at `crit` so a gateway outage leaves no log (16.4's entry). The founder has no UptimeRobot account (H-13).

**Approach:** H-13's no-new-provider fallback, which the founder chose (2026-11-23): a GitHub Actions workflow every 30 minutes checks each configured environment's app root, `auth/v1/health` and `notify`'s `401 INVOKE_SECRET_REFUSED`, with every URL and key read from repository variables and masked, fails loudly, and opens or updates one issue per environment (closed with a comment on recovery). On the host, `shift-ops jobs-check` (20.7's tool) runs every 15 minutes, read-only, and fails on a failed or stale cron job, repeated non-200 `pg_net` answers, or a stale backup, which runs the same alert unit as the backup. UptimeRobot stays documented, to add later.

## Boundaries & Constraints

**Always:** The repository is public: no URL, hostname or key in the workflow, the script, an issue or a log (every value masked with `::add-mask::` before use; issue text names only the environment, the check, a status code or an error class, and the time). Least privilege: `contents: read`, `issues: write`. Inert until `vars.UPTIME_ENABLED == 'true'`; when enabled with no environment configured, it fails. A check fails only after a retry. The host check is read-only (`default_transaction_read_only`).

**Ask First:** setting repository variables (the founder does); a credential on the host for alert delivery.

**Never:** a secret or token in a variable the workflow logs; a write to the database from the host check; a new paid service.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All up | 200 shell, 200 health, 401 `INVOKE_SECRET_REFUSED` | job green; an open uptime issue for that environment is commented "recovered" and closed | — |
| App down | app root 502 twice | job red, `::error::` per failing check; issue `Uptime: staging is down` opened, or commented when the failing set changed (body updated otherwise) | — |
| Network error | DNS or TLS failure | the error's class (`ENOTFOUND`), never the message | — |
| Not configured | `UPTIME_ENABLED` unset | job skipped | — |
| Enabled, no URLs | `UPTIME_ENABLED=true`, no env vars | job red: "no environment configured" | — |
| Host: job failed | last `housekeeping` run `failed` (e.g. `HOUSEKEEPING_HALTED`) | exit 1, the job and its message named | alert unit |
| Host: job stale | `notify` no success in 10 min, `remind` 20 min, `housekeeping` 26 h (never run: noted, not failed) | exit 1 | alert unit |
| Host: failed calls | ≥ 2 non-200, timed-out or errored `net._http_response` rows in 20 min | exit 1, status and the body's `code` only | alert unit |
| Host: backup stale | newest daily set older than 26 h | exit 1 | alert unit |

## Epic AC Deviations

- "the founder is alerted within 10 minutes (proposed NFR-34), and again on recovery": NARROWED. A 30-minute schedule (GitHub may delay it further) detects within about 30–45 minutes; recovery is reported by the issue's closing comment. The 10-minute target needs UptimeRobot (H-13's default, 5-minute checks), DEFERRED until the founder creates the account (`deferred-work.md`). Alerts reach the founder through GitHub's issue and failed-run notifications.
- "Coolify's notifications … backup or deploy fails, a container stops, disk use passes 80 %": DEFERRED. Needs an SMTP or chat channel in Coolify (the founder's). The host's backup failures alert through `shift-alert@` instead.
- "`shift-web` is stopped on staging" as the test: NOT RUN. Stopping staging's containers is outside this run's rules; the check's failure path is proven by tests and by a run against a refused URL.

</frozen-after-approval>

## Code Map

- `.github/workflows/pipeline.yml` -- pinned `actions/checkout` SHA to reuse; `notify` job's issue/notification pattern.
- `scripts/ci/*.mjs` + `test/ci-scripts.test.ts` -- convention: exported pure functions plus a CLI entry run as a child `node`.
- `deploy/host/shift-ops.sh` (20.7) -- `jobs-check` and `alert` live here.
- `supabase/migrations/0073_housekeeping_and_suspension.sql` -- the `housekeeping` job (03:15 UTC) and `HOUSEKEEPING_HALTED`.
- DEPLOY §9.10 -- says monitoring is 20.8's.
- Staging facts (read-only): Kong answers `auth/v1/health` only with an `apikey` (the publishable key, public by design); `functions/v1/notify` without credentials answers 401 `INVOKE_SECRET_REFUSED`; cron jobs `notify` (every minute), `remind` (every 5 min), `housekeeping`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/ci/uptime.mjs` -- checks, retry, masking, issue open/update/close through the REST API with `GITHUB_TOKEN`.
- [x] `.github/workflows/uptime.yml` -- `*/30` schedule + dispatch, gated on `vars.UPTIME_ENABLED`.
- [x] `test/uptime.test.ts` -- checks, issue logic with a fake fetch, the workflow's shape, no URL in it.
- [x] `deploy/host/shift-ops.sh` `jobs-check` + `deploy/host/systemd/shift-jobs-check@.{service,timer}` + `deploy/host/alert-hook.example`.
- [x] `DEPLOY.md` §9.13 -- "the site is down" runbook, the variables, UptimeRobot for later, the alert hook.
- [x] `deferred-work.md` -- mark the 19.5 housekeeping, 17.2 remind and 16.4 Kong entries RESOLVED in part; new entries for the deferred ACs.

**Acceptance Criteria:**
- Given the workflow file, when it is read, then it names no URL or key: the origins and the key come from `secrets.*`, only `UPTIME_ENABLED` from `vars.*` (Spec Change Log), and its permissions are `contents: read` and `issues: write`.
- Given the staging host, when `shift-ops jobs-check staging` runs, then it reads only and reports each job's state.

## Spec Change Log

- 2026-11-24, review. The origins and the publishable key are repository SECRETS, not variables (the frozen Approach says "repository variables", as the founder asked): a step's environment, variables included, is printed in a public repository's run log, while secrets are masked. Same intent (nothing in the public view), safer mechanism; the founder sets secrets plus the one variable `UPTIME_ENABLED`. Patches: the issue comments only when WHICH checks fail changes (a detail change updates the body); a misconfigured environment no longer stops a valid one from being checked; every check runs at once and the job's timeout is 10 minutes, so a total outage still opens the issue; the issue is opened without its label if the label cannot be set; tests for a refused issue API, the label fallback and a mixed configuration. On the host: the jobs check alerts when its failing checks change and again every 6 hours (`ALERT_REPEAT_HOURS`), and reports `RECOVERED` once; a never-run long job fails once the database has been up longer than its limit; it checks disk use (85 %); the hook must be 0700; behavioural tests with a stub `docker` cover every failing case. KEEP: masking before any output; no origin, host or key in a log or an issue.

## Verification

**Commands:**
- `pnpm exec vitest run test/uptime.test.ts test/host-ops.test.ts` -- pass (DB-free; a fake fetch stands in for the origins and GitHub's API, a stub `docker` for the stack).
- `tsc -p tsconfig.json`, `eslint` -- clean.

**Live, 2026-11-23:**
- `node scripts/ci/uptime.mjs` from the host with staging's three values in the environment (never committed): `app` 200 with the shell, `auth` 200, `notify` 401 `INVOKE_SECRET_REFUSED`; exit 0. Against a refused loopback port: three `::error::` lines naming only `ECONNREFUSED`, exit 1. The workflow itself has not run yet. The founder set the three staging secrets and `UPTIME_ENABLED=true` on 2026-11-24; GitHub runs a schedule and offers the manual dispatch only from the default branch, so its first run follows the merge (then dispatch it once by hand).
- Kong refuses `auth/v1/health` without an `apikey` (401 "No API key found in request"); with the publishable key, 200. Hence the key secret.
- `shift-ops jobs-check staging`, by hand and through its timer: `notify` and `remind` OK, `housekeeping` "has not run yet" (staging started today), backup age OK. The first run found 2 failed cron calls in 20 minutes (500 `CLAIM_FAILED`, 503 `REMINDER_INPUTS_UNAVAILABLE`) and failed, as designed; recorded in `deferred-work.md` for 20.5 to investigate. The timer's later run (1 in the window) passed; after the review's patches, `jobs-check staging` passes again with the disk lines (20 % used) and `housekeeping` noted (the database up less than 26 hours).
