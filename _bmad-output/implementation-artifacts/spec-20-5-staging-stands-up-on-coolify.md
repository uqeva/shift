---
title: 'Story 20.5: Staging stands up on Coolify'
type: 'feature'
created: '2026-11-23'
status: 'in-review'
baseline_commit: 'b3f37ec51385befe78631e9d56c8082ed9a8d0fc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-20-self-hosting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No Shift environment runs anywhere: the self-hosted stack (20.1), the functions image (20.2) and the web image (20.3) have only ever been checked offline or in CI, and twenty-odd `deferred-work.md` entries wait on a live stack to be settled.

**Approach:** Stand staging up on the founder's Coolify (v4.7.6) through its API: a project `shift` with an environment `staging`, the 20.1 compose with Coolify-generated secrets, the `shift-functions` and `shift-web` images built locally from this commit, every migration pushed over a loopback-only connection in the §9.4 order, Vault armed for `notify` and `remind`, and a demo organization seeded. Then run DEPLOY §9.5's checks and every 20.5-owned deferred check that can run from this host, record each result here, fix what the live run shows is wrong in the repository, and document what stays open.

## Boundaries & Constraints

**Founder decisions (2026-11-23), inputs to this story:**
- 20.4 is applied and confirmed: only 80/443 are public; the Coolify UI/API and SSH are tailnet-only.
- No domain: staging uses `sslip.io` names on the server's public IPv4 (`staging.<ip-dashed>.sslip.io` for the app, `api.staging.<ip-dashed>.sslip.io` for Kong), Let's Encrypt through Coolify's Traefik.
- No email provider: `GOTRUE_SMTP_PASS` and a real `RESEND_API_KEY` stay unset; email paths stay off, push works. The signup door stays SHUT (the auth wrapper refuses an open door without SMTP).
- No backup target and no Tailscale CI client: 20.6's CI deploy stays inert; staging is stood up directly through the Coolify API.
- The project is `shift`, its environment `staging` (the epic named a project `shift-staging`).

**Always:** Coolify-generated `SERVICE_PASSWORD_*` values, checked against the demo values of Supabase's `.env.example`; every secret is read from Coolify or a 0600 file and never printed, committed or put on a command line; Postgres and Studio publish on `127.0.0.1` only; migrations go through `supabase db push --db-url` against that loopback port before GoTrue restarts with the hooks; the repository's compose is pasted as-is (no hand edit in Coolify); each result is recorded here as pass, fail, or deferred with its reason.

**Ask First (stop and report instead):** anything that restarts or reconfigures Coolify's proxy or affects another running service; deleting any Coolify resource this story did not create; any change to the host firewall, sshd or tailnet exposure (`tailscale serve`); AD-17's JWT branch if the opaque-key probe fails.

**Never:** touch the manual-test stack (`supabase_*_shift` containers) or the `shift-v1-test` checkout, or the tailnet-bound dev servers; signal a process this session did not start; push to GHCR; commit an address, hostname, sslip name, port, token or secret (the repository is public: placeholders only); run gitleaks; run `vitest run` without file arguments; open the signup door; decide the `calendar-feed` rate limit number.

**Deferred entries owned by 20.5 (required inputs) and how each is answered:** listed with their result under Verification → *Deferred checks*.

## Epic AC Deviations

- *"the Coolify project `shift-staging`"*: **reinterpreted** as the project `shift` with the environment `staging` (founder decision, 2026-11-23). Production will be the same project's `production` environment or a second project; 20.9 decides, and H-1's isolation (own network, volumes, secrets) holds either way because each Coolify service has its own.
- *"`api.staging.<domain>` and `staging.<domain>` serve over Let's Encrypt TLS"*: **reinterpreted** with `sslip.io` names on the public IPv4 (no domain yet). IPv6 has no sslip name here and is unchecked.
- *"Postgres is reachable only through `tailscale serve`"*: **narrowed**. Postgres publishes on the host's loopback only and the migrations run over it from the host; publishing it on the tailnet with `tailscale serve` is a tailnet-exposure change left to the founder. DEFERRED (entry written).
- *"`db push --db-url` over the tailnet"*: **narrowed** to the loopback connection on the host, for the same reason.
- *"the edge-runtime's environment holds the function secrets"*: **narrowed**. `RESEND_API_KEY` holds an inert `re_` placeholder (the compose requires it and `notify` refuses to start without the `re_` shape), so email sends fail at Resend and only push is delivered. DEFERRED until a domain and a Resend key exist (entry written).
- *"a signup is refused"*: met with the door SHUT (`SHIFT_DISABLE_SIGNUP=true`, `SHIFT_MAILER_AUTOCONFIRM=true`), not `staging.env.example`'s open values: GoTrue's wrapper refuses an open door without SMTP. Opening staging (19.1's deferred entry) stays open.
- *"the CSP from 20.3 is verified and switched to enforcing"*: see Verification; whatever a headless sweep cannot cover (the PWA install, a real push opt-in on a device) is DEFERRED with its entry.
- *"the smoke organization is provisioned (DEPLOY §7)"*: met by the demo organization (`demo-organization.sql`, `demo_target=staging`, §7.5), which provisions through the same `provision-organization.sql` path.
- *"DEPLOY.md §2–§6 describe standing up an environment on Coolify, and say nothing of a hosted project for staging"*: **narrowed**. DEPLOY §9.11 is the record of how staging was stood up on Coolify, and §2 points to it; the full rewrite of §2–§6 away from hosted projects is 20.9's ("DEPLOY.md is the self-hosting runbook"), because production's half and 20.6's enabled pipeline are not in place yet. DEFERRED (entry written).

</frozen-after-approval>

## Code Map

- `deploy/coolify/supabase/docker-compose.yml` -- the stack; pasted into the Coolify service as-is. `supabase-edge-functions` has `pull_policy: always`, so its image must come from a registry, not only the local daemon.
- `deploy/coolify/supabase/staging.env.example` -- the operator inputs; its signup values are the open door, which this story does not use.
- `deploy/functions/Dockerfile`, `deploy/web/Dockerfile` -- the two images, built here from this commit (`apps/web/dist` built with staging's `VITE_*`).
- `supabase/operator/provision-organization.sql`, `supabase/operator/demo-organization.sql` -- the admin and the demo organization (§7.2, §7.5).
- `apps/web/src/lib/content-security-policy.ts`, `apps/web/vite.config.ts` -- `CSP_HEADER` (Report-Only today).
- `DEPLOY.md` §2, §3b, §9.1–§9.10 -- the runbook this story runs; a new §9.11 records the stand-up.
- `test/self-hosted-stack.test.ts`, `test/supabase-scaffold.test.ts` -- pin the compose and DEPLOY; any compose change updates their pins.
- `.github/actions/deploy/action.yml`, `test/coolify-deploy.test.ts` -- changed: every CI database URL ends `?sslmode=disable` (the run showed the CLI refuses a Postgres without TLS).
- `deploy/web/Dockerfile`, `test/web-image.test.ts`, `scripts/ci/probe-web-image.sh`, `apps/web/public/_headers`, `test/static-hosting.test.ts` -- changed: the render stage's `COPY --chmod=0755`; the enforced CSP's comments and pins.
- `deploy/coolify/supabase/production.env.example` -- changed: `SHIFT_PROXY_CIDR` is the stack's own network.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the 20.5-owned entries (CSP, rehearsal, key probe, `${VAR:?}`, pg-meta network, PGRST303, roles, logs, client IP, 404 timing, Outlook/real devices, GraphQL path, functions memory, Coolify API calls, `APP_ORIGINS`, template outage, remind arming).

## Tasks & Acceptance

**Execution:**
- [x] Coolify API -- create the project `shift`/environment `staging`, the compose service with staging's inputs (sslip origins, loopback ports, the door shut, `SHIFT_PROXY_CIDR` from `docker network inspect coolify`, a fresh VAPID pair, an inert Resend placeholder), and the `shift-web` Docker-image application -- the stand-up itself.
- [x] host -- build `shift-functions` and `shift-web` from this commit and serve them from a registry bound to the host's loopback, so `pull_policy: always` and Coolify's image pull both work without GHCR.
- [x] staging DB -- §9.4's order: db, auth, rest, storage healthy; `db push --db-url` over loopback; `migration list` and `check-migrations.mjs`; restart auth; then the rest. Vault: `notify_url`/`remind_url` internal and both invoke secrets (§3a, §3b).
- [x] staging DB -- seed the demo organization (`demo_target=staging`), the admin password generated into a 0600 file and passed on stdin.
- [x] checks -- run §9.5's checks (7, 7b) against staging through its public API origin, then every 20.5-owned deferred check that can run here; record each under Verification.
- [x] `apps/web/src/lib/content-security-policy.ts` (+ its test) -- switch to enforcing if the sweep shows no violation; redeploy and re-check.
- [x] repository fixes the live run reveals (compose, Dockerfiles, DEPLOY), each with its pinned test updated.
- [x] `DEPLOY.md` -- §9.11 "Staging on Coolify (story 20.5)": how it was stood up, what is still manual, placeholders only; §2 points to it.
- [x] `deferred-work.md` -- mark resolved entries `RESOLVED by 20.5 (2026-11-23)` / in part; add entries for this spec's deferrals.
- [x] `sprint-status.yaml` -- 20.5 `review  # staging up, CI pending`; 20.4 `done  # applied and confirmed 2026-11-23`.

**Acceptance Criteria:**
- Given the Coolify service, when its environment is read, then every secret is Coolify-generated and none of the JWT secret, the anon key or the service key equals Supabase's `.env.example` demo value.
- Given the stack, when §9.5 step 7 and 7b run through `https://api.staging.<ip-dashed>.sslip.io`, then each line answers as §9.5 says.
- Given the app origin over HTTPS, when the demo admin signs in, then the token carries `organization_id` and the SPA loads the organization's data.
- Given a signup request, when sent through Kong, then no account is created.

## Spec Change Log

- 2026-11-23, the stand-up resumed (the orchestrator gave the token
  `deploy` and ran the kit's `finish.sh`). Findings and what was amended:
  (1) Kong looped on `SUPABASE_ANON_KEY is empty`: Coolify v4.7.6 creates magic
  variables once, in file order, and signs the role JWTs only if
  `SERVICE_PASSWORD_JWT` already exists; Kong came first. Compose reordered
  (Kong after GoTrue, PostgREST, Storage) with a test; on staging the two
  values were minted as Coolify mints them and set through the API, never
  printed. (2) Kong logged Traefik's address for every client:
  `SHIFT_PROXY_CIDR` must be the stack's own network, not `coolify`'s; DEPLOY
  §9.9 and both env templates corrected, staging's value set. (3) Kong reached
  233 of 240 MiB with one worker per host CPU: `KONG_NGINX_WORKER_PROCESSES=1`
  (also makes `policy: local` limits exact), with a test. (4) `GET /deploy` is
  refused in v4.7.6: it is `POST` (20.6's code already posts). (5) The CSP,
  swept on staging over HTTPS with no violation, is ENFORCED, and the enforced
  build was redeployed and swept again. With every check passing on staging,
  the story goes to `review  # staging up, CI pending`. The earlier review's
  finding that the frozen Epic AC Deviations do not list the blocker is moot:
  the blocker is gone and the ACs are met on staging.

- 2026-11-23, review (blind, edge-case, verification-gap, epic-AC layers).
  Finding (high): the CSP had been switched to enforcing in the repository on
  the strength of a sweep over the rehearsal's loopback HTTP only, while the
  entry and the epic AC ask for staging over HTTPS, and the one constant also
  governs every other environment's next build. Amended: the enforcement is
  REVERTED (`CSP_HEADER` stays Report-Only); DEPLOY §9.7 and both CSP entries
  record the rehearsal sweep as a first result. Avoided: an enforced policy
  never seen on a real HTTPS origin. Also patched: start periods pinned by a
  test; DEPLOY §9.11 no longer states the secrets were generated (unseen until
  the start) and says the public API origin has no `:8000`; the registry's
  risk and retirement (new entry); the backup-recording AC (new entry for
  20.7); the CI URL comment says the tailnet half is unverified; the rehearsal
  CIDR difference stated in §9.5. The epic-AC auditor's list of ACs unmet on
  staging (H-6, TLS, `db push`, Vault, the demo organization, the smoke and §6
  checks, the decoded token) all follow from the blocker below; the frozen
  `Epic AC Deviations` cannot be amended unattended, so they are reported to
  the founder with the blocker, and the story stays `in-progress`. KEEP: the
  compose fixes, the Dockerfile fix, `sslmode=disable`, the kit.

- 2026-11-23, during implementation (not a review loop): the Coolify token
  issued for this story has `read`/`write` but not `deploy`. `POST
  /services/<uuid>/start` and `GET /deploy?uuid=` answer 403 `Missing required
  permissions: deploy`, and changing a token's permissions is the founder's
  (Ask First: credentials and permissions). So staging is CREATED in Coolify but
  NOT STARTED. Amended: the stand-up tasks after the creation are marked
  blocked; DEPLOY.md §9.5's local rehearsal (its "first act") was run on the
  server instead, in full, and every check that needs only a running stack was
  run against it; the rest waits on the token (a new `deferred-work.md` entry
  owns it). The sprint status stays `in-progress`, not `review  # staging up`,
  because staging is not up. KEEP: the frozen intent; the stand-up order.

## Design Notes

**A loopback registry.** `pull_policy: always` makes `docker compose up` pull `SHIFT_FUNCTIONS_IMAGE`; a tag that exists only in the local daemon fails the pull. A `registry:2` container published on `127.0.0.1` gives both the compose and Coolify's Docker-image application a pullable reference (Docker trusts a loopback registry over plain HTTP) without GHCR credentials. It replaces GHCR for staging only until 20.6 is enabled.

**Inert Resend key.** `notify` refuses to start without `re_…` and the compose refuses an empty `RESEND_API_KEY`. A placeholder with the right prefix keeps push and the function alive; Resend answers 401 to every send, which `notify` settles as a failed email, never a crash.

## Verification

**Baseline** `b3f37ec51385befe78631e9d56c8082ed9a8d0fc`. No hot file touched.

**What exists on the host (2026-11-23).** In Coolify: project `shift`,
environment `staging` (Coolify also created an empty `production` environment
in the new project; it holds nothing), the compose service (status `exited`:
never started) with every operator input set, the updated compose pushed with
`PATCH /services/<uuid>`, and the `shift-web` Docker-image application. On the
host: a `registry:2.8.3` container `shift-staging-registry` published on the
loopback only, holding `shift-functions:staging` built from the baseline; a
0600 demo password file; a 0700 kit (`finish.sh`, `checks.sh` and their
helpers) that runs the rest of the stand-up and staging's checks in one go once
the token has `deploy`. Their paths are in the report, not here.

**At first not done, superseded by "On staging" below: the start (BLOCKED on the token's `deploy` ability).** Hence not
yet on staging: H-6's comparison of the generated values with Supabase's demo
values (Coolify's API never returns them, and the containers that would carry
them were never created), the migrations, Vault, the demo organization, the web
deploy, TLS through Traefik, and every staging-side check.

**DEPLOY.md §9.5, the rehearsal (run in full on this server, project
`shift-rehearsal`, own loopback ports, torn down after with its volumes).**

| Step | Result |
| --- | --- |
| 3 order rule 1 | PASS after a fix: Storage took ~95 s to listen at 0.1 CPU and was reported unhealthy at 15 s, so `up --wait` failed. Fix: `start_period` (Storage 180 s, pg-meta 240 s after it took ~135 s, Kong 180 s after ~70 s). |
| 4 every migration from nothing | PASS after a fix: the CLI refused the stack's Postgres (`tls error (The server does not support SSL connections)`); with `?sslmode=disable` all migrations through `0074` applied; `pg_cron,pg_net,supabase_vault` / `t` / 3 jobs / `organization-logos`. |
| 5 order rule 2 | PASS (auth restarted, every service healthy) |
| 6 provision an admin | PASS |
| 7 sign-in through Kong, opaque key | PASS: `authenticated`, `organization_id` present (the hook runs) |
| 7 signup | PASS: `{} 200` (Kong's one answer) and no account created (0 rows) |
| 7 `/auth/v1/otp` | PASS: 404 |
| 7 publishable key as apikey and bearer | PASS: `[] 200` (mapped to anon) |
| 7 secret key | PASS: one row (mapped to service_role) |
| 7 unknown `sb_` key / `/` | PASS: 401 / 404 |
| 7b notify, admin-auth, unknown function | PASS: `INVOKE_SECRET_REFUSED 401`, `AUTHORIZATION_MISSING 401`, `FUNCTION_NOT_FOUND 404` |
| 7b admin session, no payload | PASS: `PAYLOAD_INVALID 400` |
| 7b preflight | PASS: names the app's origin, never `*` |
| 7b cron to the internal gateway | PASS: last `net._http_response` 200, outbox drained (0), 3 notify lines in Kong's log |
| 7b remind armed as §3b | PASS: `200 {"code":"REMIND_RAN",…}` |
| 7b markers (sub-path, query, `calendar-feed/<marker>`) | PASS: 0 in Kong's log, 0 in the functions' log; `calendar-feed/` 0 in both |

**20.5-owned deferred checks.**

| Entry | Result |
| --- | --- |
| live `sb_` key probe | PASS (above). AD-17's JWT branch not needed. |
| `${VAR:?}` in Coolify | PARTLY: Coolify's parser marked every `${NAME:?}` of an `environment:` entry as required, but did not detect the ones in `image:` and `ports:` (set by hand). On magic `SERVICE_*` variables: OPEN (seen only at start). |
| pg-meta/Studio network split | DEFERRED: needs Coolify's rendering of the started stack. |
| PGRST303 first read | PASS on the rehearsal: 20 fresh sign-ins, each read at once, 20 × 200. Staging: with the finish. |
| 404 timing end to end | PASS through Kong: unknown and revoked tokens, one status/body/header set, medians 264/270 ms. Through Traefik: with the finish. (A live token answered 200 `text/calendar`.) |
| `pg_read_all_data` roles | PASS, listed in DEPLOY §9.11: `postgres`, `supabase_admin` (login, password), `supabase_etl_admin`, `supabase_read_only_user` (login, no password), `service_role` (no login). |
| no RPC args in logs | PASS: `log_min_messages=fatal`, `log_statement=ddl`, `pgaudit.log=none`, `auto_explain` at LOG (suppressed); PostgREST default `error`. Hash marker search on staging: with the finish. |
| GraphQL `request.path` | PASS (moot): `pg_graphql` is not enabled on the self-hosted stack; `/graphql/v1` answers `pg_graphql extension is not enabled` to a claimless founder's mutation and to introspection. |
| functions memory | PASS: peak ~125 MiB of 448 MiB; the pair stays. Kong sat at 184 of 192 MiB, so staging's Kong limit is now 240 MiB (total 2.28 GiB, still below production per service). |
| Traefik access log | PASS: off (no `accesslog` option in the proxy's command). |
| CSP verify-then-enforce | VERIFIED ON THE REHEARSAL ONLY, NOT ENFORCED: Chromium over loopback HTTP, signed in as the demo admin, 14 routes, PDF and Excel exports downloaded, a logo uploaded and shown through its signed URL, the service worker registered: 0 violations and 0 failed requests Report-Only, then 0 and 0 with a local enforced build. `CSP_HEADER` stays `Content-Security-Policy-Report-Only` until the same sweep runs on staging over HTTPS (the kit's `checks.sh` runs it), plus push opt-in on a device, PWA install and *Osvježi* by hand. |
| client IP (IPv4/IPv6) | DEFERRED: needs Traefik in front (the finish checks IPv4; IPv6 has no sslip name). |
| Coolify API calls (20.6) | PARTLY: a token without `deploy` is refused start and deploy (403); the CLI's TLS mode answered (CI URLs now `?sslmode=disable`). Rest open. |
| calendar-feed rate limit | NOT SET, by decision (the founder's number); entry written. |
| Outlook / Google / iPhone / `.ics` on a device | DEFERRED: manual, founder's devices, staging running. |
| enumeration probe, B5 extension, recovery sessions | DEFERRED: needs a mail domain. |
| Intl parity under the edge-runtime, admin-auth worker env isolation, `WorkerAlreadyRetired` | DEFERRED (20.9 / not reachable without a probe function). |
| `APP_ORIGINS` (20.6) | UNANSWERED: no decision taken here; stays OWNER 20.5. |
| scheduled backups of a service's database | Not confirmed in the UI; the v4.7.6 API offers volume backups for a service's storages and no database backup for a service's Postgres (DEPLOY §9.11): points to 20.7's `pg_dump` sidecar. |

**Repository fixes the run revealed.** `docker-compose.yml`: start periods
(Storage, Kong, pg-meta's own check made explicit), Kong's staging limit 240 MiB
(`staging.env.example` too). `deploy/web/Dockerfile`: `COPY --chmod=0755`
(Docker Engine 29's BuildKit gives the created directory the same mode; 0644
made `/tmp/render` unenterable and the image could not build here).
`.github/actions/deploy/action.yml`: `?sslmode=disable` on every database URL.
DEPLOY §9.5's script: `sslmode=disable`, `--yes`, `pull_policy: never` for the
local functions image, the door shut and a loopback proxy CIDR for the
rehearsal (the run trusted a private Docker range; the committed text uses
`127.0.0.1/32` because the repository may name no other address; DEPLOY §9.5
says so; in a rehearsal nothing sits in front of Kong, so neither is the peer).
`test/self-hosted-stack.test.ts` pins the three start periods (at least 1.5×
each measured start) and pg-meta's explicit check.

**On staging (2026-11-23, after the token got `deploy`).** Through
`https://api.staging.<ip-dashed>.sslip.io` and `https://staging.<ip-dashed>.sslip.io`.

| Check | Result |
| --- | --- |
| H-6 | PASS: JWT secret and Postgres password 32 characters, not demo values; the role JWTs (minted, see Spec Change Log) carry `anon` / `service_role`, are not the demo tokens and not the demo `iat`. |
| order rules | PASS: db, auth, storage healthy; all 74 migrations pushed over the loopback, `migration list` matches (`check-migrations.mjs`); auth restarted after the push. |
| TLS | PASS: both names on Let's Encrypt certificates (`verify=0`); HTTP answers 302 to HTTPS; HSTS one year. Postgres and Studio publish on `127.0.0.1` only. |
| Vault | PASS: `notify_url`, `remind_url` internal, both invoke secrets set from the functions' environment. |
| demo organization | PASS: 17 members; the admin signs in. |
| §9.5 step 7 | PASS: `authenticated` with `organization_id`; signup `{} 200` and 0 accounts; `/otp` 404; anon `[]`; service one row; unknown key 401; `/` 404. |
| §9.5 step 7b | PASS: notify 401, admin-auth 401 (router), unknown 404, the preflight names the app's origin; the cron's last call 200 and the outbox drained; `remind` 200 `REMIND_RAN`. |
| logs | PASS: no marker and no `calendar-feed/` in Kong's or the functions' log. |
| PGRST303 | PASS: 20 fresh sign-ins read at once, 20 × 200. |
| feed 404 through Traefik and Kong | PASS: a live token 200 `text/calendar`; unknown and revoked 404s alike, medians 265/267 ms (30 each). |
| client address | FAIL then PASS: with the `coolify` subnets Kong logged Traefik (`10.0.x`); with the stack's own subnet it logs the client's own IPv4 and IPv6 address, and a client's `X-Forwarded-For` is not believed. |
| CSP | PASS: the sweep over HTTPS (14 routes, PDF, xlsx, logo upload and display, service worker): 0 violations, 0 failed requests Report-Only, then 0 and 0 with the ENFORCED image deployed. |
| memory | Kong 233/240 MiB with per-CPU workers, ~106 MiB with one; functions ~164/448 MiB; host 9 GiB available. |
| backups (epic AC) | Recorded as far as the API shows: volume backups only for a service; 20.7 confirms in the UI (entry). |

Still by hand (entries): push opt-in on a device, PWA install, *Osvježi*;
Outlook/Google/iPhone; the enumeration probe and real email (no provider);
`tailscale serve`; the pg-meta network split; the calendar-feed limit (the
founder's number); `APP_ORIGINS`.

**Staging refresh (2026-11-24, after #357 and #358).** Founder-approved
staging operations; DEPLOY.md §9.11 records the lessons.

| Step | Result |
| --- | --- |
| backup | `shift-ops backup staging --manual pre-migration`: 69 tables, 1,644 rows. |
| compose | `main`'s compose through `PATCH /services/<uuid>` and a restart, then FOUND: Kong had no `functions-v1-calendar-feed` route. Coolify keeps the stored content of a `content:` file it already wrote; `kong.yml` sent with `PATCH /services/<uuid>/storages`, Kong restarted, the route present (entry). |
| migrations | `0075`, `0076` pushed over the loopback; `check-migrations.mjs`: 76, local and remote agree. |
| images | functions unchanged since the 20.5 baseline (no change under `supabase/functions`, `packages`, `deploy/functions`): not rebuilt. `shift-web` rebuilt from `main` (the name-character change), `check-bundle.mjs` clean, deployed. |
| rotation | §3a's and §3b's rotation blocks, Vault first: both updated; the new values set in Coolify (`envs/bulk`), the service restarted; the container's values and Vault's compared equal in place, never printed; `remind` 200 `REMIND_RAN`, `notify` 200 `NOTIFY_RAN`. Two 401s and three refused connections fell in the window (the restarts), as §3a says. |
| leak | Re-run in sessions with `log_statement = all`, `log_min_messages = error`: the success and a failing block (`ARMING_SECRET_MISSING`, a throwaway value) wrote 12 statements and the error to the log, with no value; none in `pg_stat_activity`. Under staging's own settings (`log_min_messages = fatal`) nothing was logged. The first arming's log was gone with the recreated container, unsearched. |
| feed limit | 130 feed requests from one address in a minute: 120 × 404, 10 × 429 (`API rate limit exceeded`, no rate-limit headers); 130 `notify` and 30 `admin-auth` in the same minute: all 401, none 429. |
| client IP | Kong logged the host's public IPv4 for all 132 feed requests; a client's own `X-Forwarded-For` was not believed (checks.sh). |
| job errors | root cause: Kong's 60 s upstream keep-alive outlived PostgREST's 30 to 60 s idle close; fixed with `KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT=20` (DEPLOY.md §9.11, entry resolved). Kong now closes an idle connection to PostgREST itself at about 20 s. |
| jobs check | `shift-ops jobs-check staging` every 5 minutes, 12:08 to 12:44 UTC: the first four FAILED on the maintenance window's own calls (two 401s between Vault and the container, three refused connections during restarts; the check alerted to the journal at 12:08, as designed), then from 12:28 every run passed (`RECOVERED`), the calls check covering 12:08 to 12:44. 47 cron calls after the last restart, all 200; the 12:30 timer run passed too. |
| checks.sh | PASS: §9.5 steps 7 and 7b, PGRST303 20 × 200, feed 404 medians 281/306 ms with one signature, no marker or `calendar-feed/` in the logs, the client address, the CSP sweep (0 violations, 0 failures, 14 routes, PDF, xlsx, logo). |

**Commands.**
- `pnpm exec vitest run test/self-hosted-stack.test.ts test/supabase-scaffold.test.ts test/resource-hygiene.test.ts test/key-hygiene.test.ts test/coolify-deploy.test.ts test/web-image.test.ts test/static-hosting.test.ts` -- all pass after the review patches (the local `dist` removed, so the built-`dist` cases skip; CI builds its own).
- `eslint` on the changed test files -- clean. Full `pnpm typecheck` / `pnpm lint`: left to CI.
- No DB-connecting root test was run (the STRICT DATABASE RULE); no migration changed.

**Follow-up 2026-11-25: the real domain, email and the open door** (founder decisions of that day; operator work, no code change). These close two Epic AC Deviations above in practice. The frozen block is left as approved.
- *"`api.staging.<domain>` and `staging.<domain>` serve over Let's Encrypt TLS"*: **met.** Both names have certificates from Let's Encrypt (YR2). `http://` redirects 302 to `https://`. The `sslip.io` routes are retired (Coolify's generic 503 page, as for any unknown host). The public names have no AAAA record, so IPv6 is reached only by address.
- *"the edge-runtime's environment holds the function secrets"*: **met.** The real `RESEND_API_KEY` is set, and Resend's API accepted `notify`'s sender and key. GoTrue shares that key, which is the open entry in `deferred-work.md`.
- *"a signup is refused"*: the door is now OPEN on staging, as `staging.env.example` intends. A synthesized address is still never relayed: `checks.sh`'s signup answers `{} 200` and creates 0 accounts.
- `shift-web` was rebuilt for the new API origin with the signup switch on. `check-bundle.mjs` passed (24 files, no secret-shaped value), and so did `probe-web-image.sh`.
- `checks.sh` was re-run over the new HTTPS names and passed everything:
  - the key probe and 7b (CORS names the new app origin);
  - `notify` 200 with the outbox drained, and `remind` 200 `REMIND_RAN`;
  - PGRST303: 20 × 200;
  - feed 404 medians 262/264 ms with one signature;
  - no marker or `calendar-feed/` in the logs;
  - Kong logged the client's own address;
  - the CSP sweep: 0 violations, 0 failures, 14 routes, PDF, xlsx and the logo.
- The uptime workflow (run 45610562576) passed all three staging checks with the new secrets.
- Epic 19's retro A2 checks: see that retro's *A2 progress*.

## Suggested Review Order

**The stand-up record**

- What exists in Coolify, the inputs that differ, the blocker, and what is still manual.
  [`DEPLOY.md:3145`](../../DEPLOY.md#L3145)

**What the rehearsal found in the stack**

- Kong's start period; the functions wait on Kong being healthy.
  [`docker-compose.yml:343`](../../deploy/coolify/supabase/docker-compose.yml#L343)
- Storage needed ~95 s at 0.1 CPU before it listened.
  [`docker-compose.yml:1521`](../../deploy/coolify/supabase/docker-compose.yml#L1521)
- pg-meta: the image's own check made explicit to carry a 240 s period.
  [`docker-compose.yml:1568`](../../deploy/coolify/supabase/docker-compose.yml#L1568)
- Kong sat at 184 of 192 MiB at rest: staging's limit raised to 240 MiB.
  [`docker-compose.yml:324`](../../deploy/coolify/supabase/docker-compose.yml#L324)

**Migrations reach a Postgres without TLS**

- The CLI refuses a server without TLS; the tailnet is the encryption.
  [`action.yml:234`](../../.github/actions/deploy/action.yml#L234)
- The rehearsal script fixed the same way.
  [`DEPLOY.md:2278`](../../DEPLOY.md#L2278)

**The web image builds on Docker Engine 29**

- BuildKit gives the created directory the COPY mode; 0644 made it unenterable.
  [`Dockerfile:29`](../../deploy/web/Dockerfile#L29)

**Peripherals**

- The start periods pinned against the measured start times.
  [`self-hosted-stack.test.ts:904`](../../test/self-hosted-stack.test.ts#L904)
