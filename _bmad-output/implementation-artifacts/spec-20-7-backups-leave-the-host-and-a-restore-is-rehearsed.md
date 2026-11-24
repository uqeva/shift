---
title: 'Story 20.7: Backups leave the host, and a restore is rehearsed (interim)'
type: 'feature'
created: '2026-11-23'
status: 'in-review'
baseline_revision: 'b3f37ec51385befe78631e9d56c8082ed9a8d0fc'
baseline_commit: 'b3f37ec51385befe78631e9d56c8082ed9a8d0fc'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-20-self-hosting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staging runs on Coolify (20.5) with no backup at all, and Coolify cannot schedule a database backup for a Postgres that lives inside a compose service (20.5's finding: the API lists volume backups only). The founder has no off-host target (H-11) and no credential for one yet.

**Approach:** The INTERIM path the founder chose (2026-11-23): a host tool `shift-ops` with a systemd timer per stack that, nightly at 02:30 Europe/Zagreb, writes a backup set (a custom-format `pg_dump` taken with the stack's own `pg_dump`, the roles without passwords, a tar of `supabase-db-config` and `supabase-storage-data`, the per-table row counts read from the dump, `SHA256SUMS`) to a root-only directory, keeping 7 daily and 4 weekly sets (and 5 manual ones, the pre-migration backup). A drill restores a set into a throwaway Postgres container of the same image with no network and checks the row counts and Vault. The founder's computer pulls the sets over the tailnet (runbook). An S3 copy (`rclone`) is a second step, off until a credential exists; its configuration is documented, not created.

## Boundaries & Constraints

**Always:** Read-only towards the stack: `docker exec` into the database container for `pg_dump`/`pg_dumpall` only, volumes read from their mount points; never stop, restart or change a stack container. Sets are written as `.partial-*` and renamed when complete, so retention never counts or deletes an incomplete set. Directories 0700, files 0600, root. Config is `KEY=VALUE` data in `/etc/shift-ops/<env>.env`, parsed, never sourced, every value validated. A failure exits non-zero and triggers the alert unit (shared with 20.8). Strict bash, ShellCheck in CI.

**Ask First:** a host credential for an off-host copy (H-11); letting CI reach the host (an automated pre-migration backup from the deploy job).

**Never:** a secret in a log, the repository or the backup's file names; role passwords in a backup (`--no-role-passwords`); Coolify's `APP_KEY` (`/data/coolify/source/.env`) in a backup; a restore into staging; deletion of off-host copies from the host (retention there is the bucket's lifecycle rule); an address, hostname or service UUID in a committed file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly run | timer at 02:30 Zagreb | `daily/<UTC stamp>/` complete; on the configured weekday also hard-linked into `weekly/`; oldest beyond 7 / 4 pruned | — |
| Manual run | `shift-ops backup <env> --manual pre-migration` | `manual/<stamp>-pre-migration/`; 5 kept | label must be `[a-z0-9-]` |
| Dump fails | DB container down | no set written, partial removed, exit 1, alert unit runs | — |
| Prune | 9 dailies, keep 7 | 2 oldest complete sets deleted; `.partial-*` and foreign names untouched | — |
| Off-site on | `SHIFT_BACKUP_OFFSITE=rclone`, no `rclone` | exit 1, the local set kept | loud failure |
| Drill | a set | throwaway container (same image, `--network none`, pg_cron jobs not launched), roles + `pg_restore --clean --if-exists --exit-on-error`, counts equal the dump's, every Vault secret decrypts; container and volume removed on every exit; a line appended to `drills.log` with the duration | mismatch → exit 1 |
| Bad checksum | a set edited | drill refuses before starting anything | exit 1 |

## Epic AC Deviations

- "a dump lands locally (7 kept) and on the off-host EU target with server-side encryption (30 kept), through Coolify's scheduled backup, or a pinned `pg_dump` sidecar": NARROWED. Local only (7 daily + 4 weekly), by a host timer using the stack image's own `pg_dump` (pinned with the stack), not a sidecar: no new container in the stack, nothing for Coolify to manage. The off-host step is built but off until H-11 (DEFERRED, `deferred-work.md`).
- "the storage volume and Coolify's data go to the same target nightly with `restic`, and a failure alerts the founder": NARROWED. The storage and db-config volumes are tarred into the same set; Coolify's own data is not backed up (DEFERRED with H-11); `restic` replaced by tar + the optional `rclone` copy. A failure runs the alert unit, whose delivery is the founder's hook (20.8).
- "a founder device pulls them nightly over the tailnet, with no credential for the copy on the host": MET as a runbook (a restricted read-only `rrsync` key); the device's schedule is the founder's to install.
- "restore drill … in a throwaway stack … the Vault secrets are re-created, the smoke account signs in": NARROWED. The drill restores the latest LOCAL set into a throwaway database (not a full stack); Vault is proven decryptable with the backed-up key instead of re-created; no sign-in (no GoTrue). The full-stack drill from the off-host copy, with sign-in and RTO, is DEFERRED to 20.9's pre-go-live drill.
- "the Coolify `APP_KEY`'s offline copy is confirmed (H-8)": DEFERRED to the founder (a secret; this story may not handle it). Listed in the report.

</frozen-after-approval>

## Code Map

- `deploy/host/shift-host.sh` -- 20.4's host tool: style reference (strict bash, env file parsed not sourced, `install`).
- `deploy/host/systemd/` -- 20.4's units; the new units sit beside them.
- `test/host-hardening.test.ts` -- structural tests and the "no real address" test over every file in `deploy/host/` (covers the new files for free).
- `.github/workflows/pipeline.yml` `quality` → `ShellCheck` -- `deploy/host/*.sh` already linted.
- `scripts/ci/backup-gate.mjs` -- the manual pre-migration gate; its operator text names the new manual backup. `test/coolify-deploy.test.ts` pins only `PRE_MIGRATION_BACKUP_AT is not set`.
- Staging (read-only facts): DB container `supabase-db-<service uuid>`, volumes `<uuid>_supabase-db-config` (holds `pgsodium_root.key`, which `vault.getkey_script` reads) and `<uuid>_supabase-storage-data`; `supabase_admin` connects over the container's local socket without a password; no extension `pgsodium`, `supabase_vault 0.3.1`, `pg_cron 1.6.4`.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/host/shift-ops.sh` -- subcommands `backup`, `drill`, `prune`, `list`, `jobs-check` (20.8), `alert`, `install`, `config` -- one tool, one config.
- [x] `deploy/host/ops.env.example` -- every key, the rclone step documented off.
- [x] `deploy/host/systemd/shift-backup@.{service,timer}`, `shift-alert@.service` -- 01:30 Europe/Zagreb (Spec Change Log), `Persistent=true`, `OnFailure=shift-alert@%n.service`.
- [x] `test/host-ops.test.ts` -- structural pins and behavioural tests of `prune`, `config` and the COPY counter, DB-free.
- [x] `scripts/ci/backup-gate.mjs` -- the operator text names `shift-ops backup production --manual pre-migration`.
- [x] `DEPLOY.md` §8.2 and new §9.12 -- backup, pull, off-site, drill and full-restore runbook.
- [x] `deferred-work.md` -- mark the 20.1 db-config entry RESOLVED; the two gate entries RESOLVED in part; new entries for the deferred ACs.

**Acceptance Criteria:**
- Given the staging stack, when `shift-ops backup staging` runs on the host, then a complete set exists under `/var/backups/shift/staging/daily/` with 0600 files and a valid `SHA256SUMS`.
- Given that set, when `shift-ops drill staging` runs, then every table's row count equals the dump's, every Vault secret decrypts, and no drill container or volume remains.
- Given the timer is installed, when `systemctl list-timers` is read, then `shift-backup@staging.timer` is next due at 01:30 Europe/Zagreb.

## Spec Change Log

- 2026-11-24, review (blind, edge-case, verification-gap and epic-AC layers). Patches, no loopback: the dump is read back and counted in a throwaway container of the same image (`--network none`), not in the live database's container (the frozen Always line says `pg_dump`/`pg_dumpall` only; it now holds); `pg_dump` runs under `timeout` inside the container; the next run sweeps partials left by a killed run; a run refuses a disk 95 % full; a set records its image id and the drill prefers it; a manual set prints `PRE_MIGRATION_BACKUP_AT=…`; an empty `--manual` label is refused; a weekly set is also taken when the newest is a week old; the drill reads both archives back and writes EVERY failure (with its reason) to `drills.log`; the env file must be root's and not writable by others; the backup waits up to 30 minutes for a drill. The restore runbook stops pg_cron before the data comes back and empties the storage volume first. Behavioural tests with a stub `docker` now run `backup` (set, sweep, weekly, failed dump, manual) and `jobs-check`. Known text drift in the frozen block, recorded here rather than edited: the I/O matrix's `SHIFT_BACKUP_OFFSITE` is the key `OFFSITE`; the deviation "MET as a runbook" for the tailnet pull is PARTLY met (the restricted key and the device's schedule are the founder's steps, not installed). Deferred: a heartbeat for the watchers themselves, a retry of a failed off-site copy, `systemd-analyze verify` in CI (`deferred-work.md`). The timer runs at 01:30 Europe/Zagreb, not the frozen 02:30: `systemd-analyze calendar` showed systemd skipping 02:30 on the spring-forward night (2027-03-28), while 01:30 runs every night; for the founder to accept (`deferred-work.md`). KEEP: read-only towards the stack; `.partial-*` then rename; roles without passwords; the drill's own container and volume, removed on every exit.

## Design Notes

Why the roles file: `pg_dump` omits cluster roles, and the throwaway image lacks some the stack's init created (`supabase_functions_admin`); without them the restore fails. `--no-role-passwords` keeps the passwords out; a new stack sets them itself at init.

Why the db-config tar answers the 20.1 entry: Vault's secrets are encrypted under `pgsodium_root.key` in that volume. The set pairs the dump with the key of the same night; restoring both makes Vault readable (the drill proves it), restoring the dump alone means re-creating the Vault secrets (DEPLOY §3a/§3b).

Why no live tar of `supabase-db-data`: a file copy of a running cluster is not consistent; the dump is the database's copy.

Pre-migration backup: the deploy job cannot reach the host (tailnet ACL admits `tag:ci` to Postgres and the Coolify API only), and a dump on the runner would leave personal data on GitHub's machines outside the EU. So the operator runs the manual backup and the gate stays (DEPLOY §8.2). Automating it means a forced-command SSH key for `tag:ci`: a permission decision, the founder's.

## Verification

**Commands:**
- `pnpm exec vitest run test/host-ops.test.ts test/uptime.test.ts test/host-hardening.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts` -- pass (all DB-free).
- `shellcheck -x deploy/host/*.sh deploy/host/alert-hook.example` (ShellCheck 0.11.0) -- clean.
- `tsc -p tsconfig.json`, `eslint` on the changed scripts and tests -- clean.

**On the host, 2026-11-23 (staging only; the manual-test stack untouched):**
- Experiment first, with a throwaway container of the stack's image: a whole-database `pg_restore --clean --if-exists` into a fresh image fails on 6 statements (`role "supabase_functions_admin" does not exist`); with `pg_dumpall --roles-only --no-role-passwords` applied first it exits 0. That is why a set holds `roles.sql`.
- `shift-ops install staging`: `/usr/local/sbin/shift-ops`, five units in `/etc/systemd/system`, `/etc/shift-ops/staging.env` (0600: the service id and `OFFSITE=off` only), `/var/backups/shift/staging` (0700). Timers: `shift-backup@staging.timer` next at 01:30 Europe/Zagreb (00:30 UTC; reinstalled after the review, 2026-11-24), `shift-jobs-check@staging.timer` every 15 minutes.
- Backups: one by hand, one through `systemctl start shift-backup@staging.service` (the unit's sandbox): each about 3 s, 1.1 MB (dump 1.07 MB, db-config 6 KB, storage 26 KB), 69 tables, 666 and 682 rows, latest migration 0074, files 0600, directories 0700.
- Drills: `shift-ops drill staging` on each set: PASS, 69 tables and every row count equal to the dump's, Vault 4/4 secrets decrypt with the restored key, 9 s and 15 s (database only; not the epic's full-stack RTO). No drill container or volume left (`docker ps -a --filter label=shift-ops.drill`, `docker volume ls`). Refusals proven: a set with an edited file is refused by `SHA256SUMS` before anything starts; a set whose `row-counts.tsv` was changed (and re-summed) fails "the dump's rows differ", and its container and volume were removed.
- After the review's patches (2026-11-24), reinstalled: `systemctl start shift-backup@staging.service` (69 tables, 798 rows) and its drill PASS (Vault 4/4, 15 s, the set's exact image), no drill container or volume left; earlier, a manual set (counted by the throwaway pg_restore container; it printed `PRE_MIGRATION_BACKUP_AT=…`) and its drill: PASS, 69 tables, 791 rows, Vault 4/4, 19 s, using the set's exact image id; then removed. A copy with an edited `MANIFEST` was refused by `SHA256SUMS`, and the refusal is now a `result=FAIL` line in `drills.log`.
- Alert chain: `shift-jobs-check@` of a stack whose container does not exist failed and triggered `shift-alert@…` (OnFailure), which ran a temporary test hook with the unit's name and its journal (then removed). With no hook, the alert unit logs `SHIFT_ALERT … failed` and "the failure is only in the journal".

## Suggested Review Order

**The backup set**

- Read-only towards the stack: pg_dump in its container, the rest in a throwaway one.
  [`shift-ops.sh:277`](../../deploy/host/shift-ops.sh#L277)

- Reading the dump back never loads the live database.
  [`shift-ops.sh:257`](../../deploy/host/shift-ops.sh#L257)

**The drill**

- Own container, no network, jobs not launched, every outcome logged.
  [`shift-ops.sh:445`](../../deploy/host/shift-ops.sh#L445)

**Alerting (20.8)**

- The host checks, and when they alert.
  [`shift-ops.sh:571`](../../deploy/host/shift-ops.sh#L571)
  [`shift-ops.sh:677`](../../deploy/host/shift-ops.sh#L677)

- The outside check: masking, issue plan.
  [`uptime.mjs:279`](../../scripts/ci/uptime.mjs#L279)
  [`uptime.mjs:191`](../../scripts/ci/uptime.mjs#L191)

**Runbook and tests**

- DEPLOY §9.12 and §9.13.
  [`DEPLOY.md:3113`](../../DEPLOY.md#L3113)

- Behavioural tests against a stub docker.
  [`host-ops.test.ts`](../../test/host-ops.test.ts)
  [`uptime.test.ts`](../../test/uptime.test.ts)
