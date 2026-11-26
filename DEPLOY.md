# DEPLOY

Everything needed to take this repository from a clean checkout to a live
staging and production deployment, and to promote a migration through them.

There are exactly four moving parts, because the architecture has no server
tier beyond two Edge Functions (AD-14):

| Part | Where it runs | What it holds |
| --- | --- | --- |
| `apps/web` | Cloudflare Pages, static | the publishable key only |
| `supabase/migrations` | Supabase Postgres | the schema, forward-only; the `notify` cron job and its two Vault secrets' names |
| `supabase/functions/admin-auth` | Supabase Edge Functions | the secret key |
| `supabase/functions/notify` | Supabase Edge Functions, called every minute by pg_cron | the secret key (for its four RPCs), the Resend key, the invoke secret, the VAPID key pair and subject |

The secret key exists only in the Edge Functions' per-environment secrets. If
you ever find `sb_secret_*` in a Pages environment variable, in a committed
file, or in a migration, stop and rotate it — every RLS policy in the system is
decorative until you do. The same goes for a Resend key (`re_*`): it is read by
`notify` and nothing else (AD-17).

> **Self-hosting (Epic 20).** Shift is moving off Supabase cloud and Cloudflare
> Pages onto our own server, run by Coolify. The self-hosted stack that
> replaces each Supabase project is defined in §9, and the pipeline that deploys
> to it in §8 (story 20.6). §0–§7 still describe the hosted setup until story
> 20.9 rewrites them; no environment uses it.

---

## 0. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node | `24.19.0` (see `.nvmrc`) | pnpm 11 requires ≥ 22.13 |
| pnpm | `11.25.0` | pinned in `package.json` → `packageManager` |
| Docker Desktop | current | the Supabase CLI runs Postgres locally |
| Supabase CLI | `2.116.0` | installed as a workspace dev dependency |

```bash
nvm use                 # picks up .nvmrc
corepack enable pnpm    # picks up packageManager
pnpm install
```

The Supabase CLI is local to the repo, so invoke it through pnpm:

```bash
pnpm exec supabase --version
```

### Authenticating the CLI

Everything in §1 works offline. Everything that touches a remote project —
`link`, `db push`, `config push`, `secrets set`, `functions deploy` — needs a
Supabase account token first, and two prompts catch people out:

```bash
pnpm exec supabase login          # opens a browser, stores the token
# or, non-interactively (CI, or a machine with no browser):
export SUPABASE_ACCESS_TOKEN=sbp_...
```

`supabase link` then asks for that project's **database password** — the one set
when the project was created, not your account password, and not recoverable
(reset it under *Project Settings → Database* if it is lost). Pass it
non-interactively with `--password`, or let the prompt take it.

Without the token, `link` fails with an authorization error that reads exactly
like the paused-project failure §2 warns about. Log in first and you can tell
the two apart.

---

## 1. Local

```bash
pnpm install
pnpm exec supabase start        # boots Postgres, PostgREST, Auth, Studio
pnpm exec supabase db reset     # applies every migration, then loads seed.sql
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @shift/web dev
```

`supabase start` prints the local API URL and keys. Put the URL and the
**publishable** key into `apps/web/.env.local`. `seed.sql` is local and
test-only: it is never applied to staging or production.

> **The access token hook needs a restart, not a reset.** `config.toml`'s
> `[auth.hook.custom_access_token]` becomes a `GOTRUE_HOOK_*` environment
> variable on the auth container, and an edit to that file does not reach a
> container that is already running — `supabase db reset` will not do it either,
> because it restarts containers without recreating them from the config. After
> any change to that section, run a full stop and start:
>
> ```bash
> pnpm exec supabase stop && pnpm exec supabase start
> docker inspect supabase_auth_shift \
>   --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i hook
> # -> GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
> # -> GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook
> ```
>
> With no hook, tokens carry no `organization_id` and every policy reads zero
> rows — which looks exactly like a broken policy and is not one.
> `test/rls-isolation.test.ts` names this in its failure message for that
> reason.

To run the Edge Function locally, copy its env template and fill it in with an
editor. Do not `printf` or `echo` a key into place and do not pass one as a
command-line argument: either way `sb_secret_*` lands in your shell history,
which is a committed-file leak with extra steps.

```bash
cp supabase/functions/.env.example supabase/functions/.env
$EDITOR supabase/functions/.env        # gitignored; paste the local keys here

pnpm exec supabase functions serve admin-auth
```

`notify` reads the same file. Locally it needs a Resend key of its own (a test
key sends nothing real) and an invoke secret; without them it answers every
call `500` with the missing variable's code, which is harmless. The local cron
job does nothing until the local Vault holds `notify_url` and
`notify_invoke_secret` (§3a), so a fresh stack never calls it. To try a send by
hand:

```bash
pnpm exec supabase functions serve notify
curl -s -X POST http://127.0.0.1:54321/functions/v1/notify \
  -H "Authorization: Bearer $(grep ^NOTIFY_INVOKE_SECRET= supabase/functions/.env | cut -d= -f2-)"
# -> 200 {"code":"NOTIFY_RAN","claimed":…,"sent":…,"failed":…,"retried":…,"unsettled":…}
```

`supabase functions serve` reads `supabase/functions/.env` by default, so no
flag is needed. `supabase start` printed the local keys; `SUPABASE_URL` is
injected for you.

`supabase functions serve` serves every function, `calendar-feed` (story 16.4)
included, which loads `@shift/domain` and `@shift/ics` from their built
`dist` through its `deno.json` (AD-7). Build both before serving, and again
after changing either (a `dist` module added while it runs needs a restart):

```bash
pnpm --filter @shift/domain --filter @shift/ics build
```

The feed is public: a calendar app GETs
`http://127.0.0.1:54321/functions/v1/calendar-feed/<token>.ics` with no
header at all, and every unknown, revoked, replaced, deactivated or malformed
token answers the same `404 {"code":"FEED_NOT_FOUND"}`, never sooner than
250 ms after it arrived (the timing class, D-S8: a slow 404 is by design).
Its other answers say where to look: `405 METHOD_NOT_ALLOWED` (a client sent
anything but GET or HEAD);
`503 FEED_UNAVAILABLE`, logged as `calendar-feed: FEED_UNAVAILABLE` (the
function is misconfigured, logged at start as `calendar-feed is misconfigured:
<code>`, or the lookup through the gateway failed, timed out or answered
something else: check Kong and PostgREST); `500 FEED_FAILED` (the member's
assembly broke a domain rule: a data problem, never the token). A token is made by
`create_calendar_feed_token()` as the member's own session (16.5's screen);
never paste one into a shell history or an issue.

`createUser` and `updateUserById` are implemented (story 1.5b). Both authorize
against the database before they act — the caller must be an active admin of the
target member's own organization, read through `current_member_access()` as the
caller — and both use the secret key ONLY for the `auth.admin.*` call, with every
`members` write going through the caller's own JWT so row level security and
attribution still apply.

There is no `ban` or `unban` (story 1.6, human decision 2026-09-23).
Deactivation is an RLS-governed PostgREST insert into `member_status_versions`
(`0008_member_status.sql`), not a function call — and cancelling a change
that is not yet in effect is an RLS-governed delete of that row. `current_member_access()`
reads the version covering today in the organization's zone, so a deactivated
member reads nothing on their next statement, and `custom_access_token_hook`
refuses them a token with a 403, so sign-in and refresh both fail with the
ordinary credentials message. Nothing is written to GoTrue: a token minted
before the date keeps authenticating to GoTrue's own endpoints until it
expires, and reads no organization data.
An existing `auth.users.banned_until` is still honoured — `current_member_access()`
ANDs it with the version covering today — but nothing in the product sets it any
more.

The first organization does not go through this function at all — see §7.

Gate before you push anything:

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

---

## 2. Supabase projects

> **Staging is not a hosted project any more (story 20.5).** It is the
> self-hosted stack on our server, run by Coolify: §9.11 records how it was
> stood up and what is still manual. Production's move is story 20.9, which
> rewrites §2–§6 as the self-hosting runbook; until then the hosted text below
> describes production's current path only.

Create **two** projects on the free plan — that is exactly the two active
projects the free plan allows.

| Environment | Project name | Note |
| --- | --- | --- |
| staging | `shift-staging` | the rehearsal for every promotion |
| production | `shift-production` | the pilot organization |

For each, record from *Project Settings → API keys*:

- the project URL,
- the **publishable** key (`sb_publishable_*`),
- the **secret** key (`sb_secret_*`).

Do not use the legacy `anon` / `service_role` keys. They are deprecated at the
end of 2026 and this system does not read them.

> **Free-plan catch.** A project with no API requests for a week is paused
> automatically. Before any promotion to staging, open the staging project in
> the dashboard and confirm it is active, or the first `db push` will fail in a
> way that looks like a credentials problem.

---

## 3. Where each key goes

| Value | staging | production |
| --- | --- | --- |
| project URL | derived from the `staging` Environment's `SUPABASE_PROJECT_REF` into the build's `VITE_SUPABASE_URL` **and** function env (auto) | same, `production` Environment |
| `sb_publishable_*` | `staging` Environment variable `SUPABASE_PUBLISHABLE_KEY` → the build's `VITE_SUPABASE_PUBLISHABLE_KEY` + function secret `SHIFT_PUBLISHABLE_KEY` | same, `production` Environment |
| `sb_secret_*` | `staging` Environment secret `SUPABASE_SECRET_KEY` → function secret `SHIFT_SECRET_KEY` **only** | same, `production` Environment |
| Resend key `re_*` | `staging` Environment secret `RESEND_API_KEY` → function secret `RESEND_API_KEY`, read by `notify` only | same, `production` Environment |
| notify invoke secret | `staging` Environment secret `NOTIFY_INVOKE_SECRET` → function secret `NOTIFY_INVOKE_SECRET`, **and** the Vault secret `notify_invoke_secret` (§3a) | same, `production` Environment |
| sender address | `staging` Environment variable `NOTIFY_EMAIL_FROM` → function secret `NOTIFY_EMAIL_FROM` | same, `production` Environment |
| app origin | the first `APP_ORIGINS` entry → function secret `SHIFT_APP_URL` (auto) | same |
| VAPID private key | `staging` Environment secret `VAPID_PRIVATE_KEY` → function secret `VAPID_PRIVATE_KEY`, read by `notify` only | same, `production` Environment |
| VAPID public key | `staging` Environment variable `VAPID_PUBLIC_KEY` → function secret `VAPID_PUBLIC_KEY` + the build's `VITE_VAPID_PUBLIC_KEY` | same, `production` Environment |
| VAPID subject | `staging` Environment variable `VAPID_SUBJECT` (`mailto:…` or an `https:` URL) → function secret `VAPID_SUBJECT` | same, `production` Environment |

The pipeline (§8) sets the function secrets itself on every deploy, from those
GitHub Environment values, through a temporary env file exactly like the one
below. The manual commands in this section are the fallback.

The function reads its project URL from `SUPABASE_URL`, which the Edge Runtime
injects — you never set it. It needs the publishable key too, because it builds
a second, caller-scoped client from the caller's JWT so that RLS and attribution
still apply to every domain-table write it makes.

Set the function secrets per project **from a file**, never as arguments — a
`NAME=VALUE` argument is recorded in shell history, and rotating a key you have
already leaked to your own history is the one avoidable step here:

```bash
cp supabase/functions/.env.example supabase/functions/.env.staging
$EDITOR supabase/functions/.env.staging       # gitignored

pnpm exec supabase secrets set \
  --env-file supabase/functions/.env.staging \
  --project-ref <staging-ref>
```

Repeat with `supabase/functions/.env.production` and `<production-ref>`. Every
`supabase/functions/.env*` file except `.env.example` is gitignored.

**Function secrets are per project, not per function.** `supabase secrets set`
puts every value in both functions' environments; that is the platform's
granularity, not a choice. What keeps the Resend key, the invoke secret and the
VAPID private key `notify`'s alone is that nothing else reads them:
`test/key-hygiene.test.ts` fails if any file outside `supabase/functions/notify/`
names them in code.

`SHIFT_ALLOWED_ORIGINS` is a comma-separated allowlist of exact origins. An
origin not on it receives no `Access-Control-Allow-*` header at all, so the
browser refuses the response — set it to the exact Pages hostname(s) for that
environment. It is required: unset, blank or only commas, the function refuses
every request with `500 {"code":"ALLOWED_ORIGINS_MISSING"}` (§6), because the
SPA is its only caller and a list that admits no browser is always a mistake.

### 3a. Notifications: Resend, Vault and the schedule (story 10.1)

`notify` sends what `notification_outbox` holds. Migration `0042` schedules the
pg_cron job `notify` every minute; it POSTs to the function with the invoke
secret as its bearer token, and **does nothing while either Vault secret below
is absent**. Set up each environment once, in this order.

How a row is delivered: one run claims at most 8 rows and sends emails about
550 ms apart. It starts no email send after 45 s and no push row after 35 s (a
push row's device read, send and gone-device delete take up to 5 s each;
migration `0046`), and what it does not start is released untried
(`RUN_DEADLINE`), so the run ends inside pg_net's 55 s.
A network error, 408, 409, 429 or 5xx releases the row and backs it off
(attempts × 10 minutes: 10, 20, 30, 40), and the fifth failure fails it
`ATTEMPTS_EXHAUSTED`. A 401 or 403 from Resend (the key or the domain) stops
**email** for the rest of the run and gives every later email row back without
spending its attempt, `PROVIDER_UNAUTHORIZED`, so a misconfiguration delays mail
and loses none; push rows in the same run are still sent (the channels are
independent). Any other 4xx fails the row
`PROVIDER_REFUSED`. Every send carries the row id as Resend's
`Idempotency-Key`, which holds for 24 hours, longer than five attempts take.

**1. The sending domain.** In Resend, add a domain you control (for example
`obavijesti.<your-domain>`), and publish the DNS records Resend shows: the SPF
`TXT` (`include:amazonses.com` or as Resend shows it), the DKIM `TXT`
(`resend._domainkey`) and the bounce `MX`. Wait until Resend marks the domain
*Verified*. Unverified, Resend refuses every send with a 403, which `notify`
answers by stopping email for that run and giving the email rows back
(`PROVIDER_UNAUTHORIZED`): no email is sent and none is lost until the domain
verifies. Push is not held by it. Use one domain per
environment, or one domain for both; `NOTIFY_EMAIL_FROM` names an address on it
(`Smjenko <obavijesti@obavijesti.example.org>`; the product's name is
*Smjenko* since story 21.24).

**2. The Resend key.** Create an API key with *Sending access* only, limited to
that domain. It is the Environment secret `RESEND_API_KEY` (§8.2), and for a
manual setup a line in `supabase/functions/.env.<environment>` (§3).

**3. The invoke secret.** Generate it once per environment, and never reuse
one across environments:

```bash
openssl rand -hex 32      # 64 characters; paste it, do not pipe it anywhere
```

Its charset is `[A-Za-z0-9_-]`, at least 32 characters: the function
(`INVOKE_SECRET_INVALID`) and the pre-deploy check refuse anything else, such
as a space, a quote or a colon a header or a SQL literal could mangle. Hex
output always fits.

It goes to two places, with the same value: the Environment secret
`NOTIFY_INVOKE_SECRET` (the pipeline makes it a function secret), and that
project's Vault.

**4. Vault.** Once per environment, through `psql` on stdin, as *A secret
never enters a statement* below says (never the SQL editor, which sends the
value inside the statement; never in a committed file or a migration). `$DC`
is `docker compose` for the environment's Supabase stack on its host (§9.5);
`notify_url` is the internal gateway (§9.6, *Cron*). Read the value into the
shell without echoing it (`read -rs SERVICE_PASSWORD_64_NOTIFYINVOKE`, pasted
from Coolify's environment view of the Supabase resource):

```bash
printf '%s' "$SERVICE_PASSWORD_64_NOTIFYINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
{
  echo "create temp table arming (value text not null) on commit drop;"
  echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
  printf '%s\n' "$SERVICE_PASSWORD_64_NOTIFYINVOKE"
  echo '\.'
  echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
  echo "delete from vault.secrets where name in ('notify_url', 'notify_invoke_secret');"
  echo "select vault.create_secret('http://supabase-kong:8000/functions/v1/notify', 'notify_url');"
  echo "select vault.create_secret((select value from arming), 'notify_invoke_secret');"
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
unset SERVICE_PASSWORD_64_NOTIFYINVOKE
```

To rotate the invoke secret, update both places, Vault first (the new value
read with `read -rs` as above):

```bash
printf '%s' "$SERVICE_PASSWORD_64_NOTIFYINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
{
  echo "create temp table arming (value text not null) on commit drop;"
  echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
  printf '%s\n' "$SERVICE_PASSWORD_64_NOTIFYINVOKE"
  echo '\.'
  echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
  echo "do \$\$ begin if not exists (select 1 from vault.secrets where name = 'notify_invoke_secret') then raise exception 'ARMING_SECRET_MISSING'; end if; end \$\$;"
  echo "select vault.update_secret((select id from vault.secrets where name = 'notify_invoke_secret'), (select value from arming));"
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
unset SERVICE_PASSWORD_64_NOTIFYINVOKE
```

then the container's variable, then redeploy. Between the two steps the
function answers the job `401` and nothing is claimed: no email is lost, it
waits for the next minute.

**A secret never enters a statement** (founder decision 2026-11-23, epic 17
retro A3 (a); the D-S5 review). Every Vault write of an invoke secret, here,
in §3b and in §9.5, follows one shape, and no other is used. Every
environment is a self-hosted stack (epic 20), so these blocks are the arming
for each of them; a hosted project's SQL editor, which sends the value inside
the statement, is not used.

- **The value is checked in the shell before anything is sent.** The line
  before each block pipes it to `grep` (on stdin, never as an argument) and
  sends nothing unless it is §3a step 3's charset, 32 characters or more. A
  malformed `COPY` row is the one way the server would quote a data row back
  (an error's `CONTEXT: COPY arming, line 1: "…"`), so no such row is sent.
- **The value travels as `COPY` data, never as statement text.** The block
  creates a temporary table, sends `copy arming (value) from stdin` (CSV, with a delimiter and a
  quote character no pasted value holds, so no character of the value can make
  `COPY` misparse the row and echo it in an error's `CONTEXT`) and then
  the value as that copy's one data row (psql reads it from the same stdin,
  up to `\.`), and calls `vault.create_secret((select value from arming), …)`
  or `vault.update_secret(…, (select value from arming))`. So every statement
  the server receives (what `log_min_error_statement` writes beside a failed
  statement, which is Postgres's default; what `log_statement = all` would
  write for every statement; `pg_stat_activity.query`; `pg_stat_statements`)
  holds the table's name and never the value. Postgres logs no well-formed
  `COPY` data row under any `log_*` setting, and the shell check and the CSV
  format keep the row well formed.
- **Why not a psql variable or a bind parameter.** `:'secret'` is
  interpolated by psql on the client, so the server received, and on an
  error logged, the value inside the statement: the risk this replaces. A
  `\bind` parameter is out of the statement text, but `log_statement = all`
  logs it as the statement's `parameters:` detail (`log_parameter_max_length`
  is unlimited by default), so it is safe only while nobody raises the level.
- **Where else the value could appear, and why it does not.** The temporary
  table is this session's alone, is never WAL-logged and is dropped at commit
  (`on commit drop`; a failure rolls back the whole `-1` transaction, which
  drops it too). The `do` block checks the value's shape (§3a step 3's
  charset, 32 characters or more) and refuses with a fixed message that
  names no value; an error inside Vault's own functions reports their
  statements with their parameter names, not values, and the only key on
  `vault.secrets` is the name, which the `delete` first keeps from colliding.
  The value is never on a command line (`printf` and `echo` are shell
  builtins, so no process's arguments hold it), never in shell history
  (`read -rs`), and `psql -q` without `-a`, `-e` or `-E` echoes nothing.
- **What stays.** Vault holds the value, decrypted for its readers, by
  design; and the container's environment holds it, as every function
  secret is held.

**5. VAPID (story 10.4).** Web Push signs every send with a VAPID key pair, one
per environment. Generate it once:

```bash
pnpm dlx web-push@3.6.7 generate-vapid-keys
```

and set the private half (43 characters) as the Environment secret
`VAPID_PRIVATE_KEY`, the public half (87 characters) as the Environment
variable `VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT` — who a push service may
contact — as a variable, `mailto:<an address you read>` or an `https:` URL.
`notify` reads all three; without them, or with one malformed, it still sends
email and retries every push as `PUSH_NOT_CONFIGURED` (it logs the
`VAPID_*_MISSING`/`_INVALID` code at start). The deploy gate
(`scripts/ci/require-config.mjs`) checks that the public key is the private
key's own and fails the deploy on a mismatched pair. The public key is also the build's
`VITE_VAPID_PUBLIC_KEY` (§4): AD-17, as amended by story 10.4, lets the SPA
carry it, and it is public by design. The private key never leaves the
function's environment.

**Never rotate the pair casually.** Every device subscribed under the old
public key; after a rotation its push service refuses each send (`403`,
`PUSH_SERVICE_UNAUTHORIZED`), which `notify` retries and then fails. The next
time the member turns push on on that device, the SPA sees the subscription
was made under another key, unsubscribes it and subscribes again under the new
one; until then that device receives nothing. Rotate only after a leak, and
tell the members to turn push off and on again on each device.

**Locally** the same two Vault statements against the local database turn the
local job on, with `notify_url` set to the API gateway as the database
container reaches it on the stack's Docker network
(`http://supabase_kong_shift:8000/functions/v1/notify`) and
`supabase functions serve notify` running. `supabase db reset` removes them
again.

### 3b. Reminders: the `remind` function, its secret and its cron job (story 17.3)

A shift reminder (CAP-26, AD-14 and AD-18 as amended) is written by the
`remind` Edge Function and sent by `notify`, as every other notice is.

- **The function.** `supabase/functions/remind` (`verify_jwt = false`), in the
  `shift-functions` image beside the other three (§9.6). Its environment is
  `SUPABASE_URL`, `SHIFT_SECRET_KEY` (for its two `service_role` RPCs,
  `reminder_inputs` and `enqueue_shift_reminders`) and its own
  `REMIND_INVOKE_SECRET`, never `notify`'s. It holds no Resend or VAPID key.
- **The secret.** On a self-hosted stack the compose generates it
  (`REMIND_INVOKE_SECRET=${SERVICE_PASSWORD_64_REMINDINVOKE}`); read the value
  in Coolify's environment view of the Supabase resource. Elsewhere generate it
  as §3a step 3 does (`openssl rand -hex 32`), once per environment.
- **The cron job.** `remind`, every five minutes (`*/5 * * * *`), runs
  `select private.invoke_remind()` (0070). It POSTs to Vault's `remind_url`
  with Vault's `remind_invoke_secret` as its bearer, and does nothing while
  either is absent. A migration never writes either.

**Arming it, in this order, once per environment:**

1. Deploy (and smoke) the release whose `notify` renders `SHIFT_REMINDER`
   (story 17.3, migration `0072`). Arming before it would queue reminders an
   older `notify` retries as `MESSAGE_UNKNOWN` until they fail.
2. Vault, through `psql` on stdin, never on a command line (the internal
   gateway, never the public origin; the secret as `COPY` data, never in a
   statement: §3a, *A secret never enters a statement*). `$DC` is `docker
   compose` for the environment's Supabase stack on its host, as §9.5
   defines it for the rehearsal. Put the value into the shell without
   echoing it or leaving it in history (`read -rs SERVICE_PASSWORD_64_REMINDINVOKE`,
   then paste it from Coolify's environment view). The delete makes the
   step safe to run again (a second `vault.create_secret` of the same name
   fails), and `-1` runs the block as one transaction, so a failure leaves
   Vault as it was rather than half armed:

   ```bash
   printf '%s' "$SERVICE_PASSWORD_64_REMINDINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
   {
     echo "create temp table arming (value text not null) on commit drop;"
     echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
     printf '%s\n' "$SERVICE_PASSWORD_64_REMINDINVOKE"
     echo '\.'
     echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
     echo "delete from vault.secrets where name in ('remind_url', 'remind_invoke_secret');"
     echo "select vault.create_secret('http://supabase-kong:8000/functions/v1/remind', 'remind_url');"
     echo "select vault.create_secret((select value from arming), 'remind_invoke_secret');"
   } | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
   unset SERVICE_PASSWORD_64_REMINDINVOKE
   ```

3. **Prove the armed path once** (the cron's own statement, answered by the
   function):

   ```bash
   ID=$($DC exec -T supabase-db psql -U postgres -At -c "select private.invoke_remind();")
   if [ -z "$ID" ]; then
     echo "no request: Vault does not hold both secrets (step 2)"   # ❌
   else
     sleep 10           # by ITS id: the notify job answers every minute too
     $DC exec -T supabase-db psql -U postgres -At -c "
       select status_code, content, error_msg from net._http_response where id = $ID;"
   fi
   # -> 200|{"code":"REMIND_RAN","members":…,"due":…,"accepted":…,"skipped":…}|   ✅
   # -> 401 INVOKE_SECRET_REFUSED: Vault's remind_invoke_secret is not the container's REMIND_INVOKE_SECRET ❌
   # -> 503 REMINDER_INPUTS_UNAVAILABLE: the read did not reach the database (SUPABASE_URL, the secret key) ❌
   # -> 503 REMINDER_ENQUEUE_FAILED: the write failed (0070 or 0072 not applied?) ❌
   # -> 404 FUNCTION_NOT_FOUND: the image has no remind (the router's table) ❌
   # -> an empty status with error_msg: remind_url is wrong or the gateway is down ❌
   # -> no row yet: wait and read again; pg_net gives up after 55 s ❌
   ```

   A reminder whose due instant is more than 15 minutes behind every
   successful run is never written, so a drifted secret loses reminders
   silently: repeat this check after any rotation, and look at the last few
   `net._http_response` rows when a member says a reminder did not come.

**Rotating** the invoke secret: Vault first, on stdin as in step 2 (the new
value read with `read -rs`, never on a command line):

```bash
printf '%s' "$SERVICE_PASSWORD_64_REMINDINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
{
  echo "create temp table arming (value text not null) on commit drop;"
  echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
  printf '%s\n' "$SERVICE_PASSWORD_64_REMINDINVOKE"
  echo '\.'
  echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
  echo "do \$\$ begin if not exists (select 1 from vault.secrets where name = 'remind_invoke_secret') then raise exception 'ARMING_SECRET_MISSING'; end if; end \$\$;"
  echo "select vault.update_secret((select id from vault.secrets where name = 'remind_invoke_secret'), (select value from arming));"
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
unset SERVICE_PASSWORD_64_REMINDINVOKE
```

then the container's variable and a redeploy, right after a `*/5` tick so the
gap falls between runs. In between the job is answered 401 and writes
nothing; a reminder that fell due then is written by the next good run if it
is less than 15 minutes behind, and lost otherwise. Prove the path again
(step 3) afterwards.

**Disarming** (to stop every reminder): delete the two Vault secrets
(`delete from vault.secrets where name in ('remind_url', 'remind_invoke_secret');`).
The settings members chose stay. Reminders already queued are still sent by
`notify` until their bound (below) settles them, at most about 20 minutes; to
stop those too, settle them by hand
(`update public.notification_outbox set failed_at = now(), failure_code = 'REMINDER_DISARMED', next_attempt_at = null where code = 'SHIFT_REMINDER' and sent_at is null and failed_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes');`:
its own code, so a later "why did my reminder not come" reads as the disarm,
and never a row `notify` holds in flight).

**What the member receives.** `notify` renders the row from `hr.json`'s
`reminders.notice` (`Za 2 h radiš: Dnevna 07:00–19:00, Smjena A`, or `Sutra
radiš: …`), linking through the organization's sign-in to that day in
*Kalendar*; an email ends with the line pointing to *Obavijesti →
Podsjetnici*. The claim settles a reminder `REMINDER_LATE` (0072) once it is
15 minutes past its due instant (an `H<n>` lead) or 20 minutes after it was
written (any lead). A push's TTL is the least of three bounds: 15 minutes,
the time left to the shift's start, and (an `H<n>` lead only) the time left to
15 minutes past its due instant; a reminder with none left is not posted. So an `H<n>`
reminder never arrives more than 15 minutes after it fell due, and a
backlog never sends "in 12 hours" hours late; the evening-before one, whose
due instant needs the zone, may arrive up to about 35 minutes after it was
written.

**Locally** `node scripts/ci/write-local-env.mjs` writes a fresh
`REMIND_INVOKE_SECRET` into `supabase/functions/.env` (an older file needs
`--force` once). The E2E (`e2e/tests/notifications/reminder-delivery.spec.ts`)
arms the local Vault with `http://supabase_kong_shift:8000/functions/v1/remind`
and that value, proves the cron's call is answered `REMIND_RAN`, and disarms it
again (`SHIFT_E2E_REMIND_URL` overrides that URL for a stack whose gateway
has another name). To arm the local job by hand, run step 2 against the local
database with that URL and the value from the file.

---

## 4. Cloudflare Pages

One Pages project, **with no Git connection**. The pipeline publishes to it by
Direct Upload (`wrangler pages deploy`, §8), after every gate has passed and —
for production — after a human has approved. A Git-connected project would
build and publish `main` on its own, before any of that, so the Git integration
is not used at all.

Create it once, from a machine logged in to Cloudflare (`pnpm exec wrangler
login`), or in the dashboard via *Workers & Pages → Create → Pages → Upload
assets* (**not** *Connect to Git*):

```bash
pnpm exec wrangler pages project create <project> --production-branch main
```

| Setting | Value |
| --- | --- |
| Production branch | `main` — the pipeline's production deploy uses `--branch main` |
| Preview branch alias | `staging` — the staging deploy uses `--branch staging`, served at `https://staging.<project>.pages.dev` |
| Build settings | none: Cloudflare never builds this project, the pipeline uploads `apps/web/dist` |

**If the project already exists connected to Git**, a Git-connected project
cannot switch to Direct Upload. Create a new project as above (a new
`<project>.pages.dev` hostname), move any custom domain to it, and delete the
old one — or, at the very least, turn off *Settings → Builds & deployments →
Automatic deployments* for both production and preview so nothing publishes
without the pipeline.

There are **no Pages environment variables** to set. `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_VAPID_PUBLIC_KEY` are build-time
values, and the build now runs in the pipeline's deploy job, which reads them
from that GitHub Environment (§8):

| Variable | Where it comes from |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co`, from the environment's `SUPABASE_PROJECT_REF` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the environment's `SUPABASE_PUBLISHABLE_KEY` variable (`sb_publishable_*`) |
| `VITE_VAPID_PUBLIC_KEY` | the environment's `VAPID_PUBLIC_KEY` variable (story 10.4, §3a). Left empty, the app runs, and `/obavijesti` says push is unavailable, with no control |

Vite inlines `VITE_*` variables into the bundle at build time, which is why the
secret key can never appear here.

Both values are checked at runtime, and a bad one throws the stable code
`SUPABASE_ENVIRONMENT_MISSING` rather than degrading quietly. Five things count
as bad: either variable absent, either one whitespace-only, a `VITE_SUPABASE_URL`
that is not an `http(s)` URL — a bare project ref is the usual way to get this
wrong — and a `VITE_SUPABASE_PUBLISHABLE_KEY` that does not begin
`sb_publishable_`. That last one is a security check as much as a correctness
one: a secret key pasted into this variable would be inlined into every chunk
served to every browser.

**The symptom, if you get one wrong.** The client is built on first use, not at
boot, so the throw is caught by whichever screen needed it first. A visitor sees
either the sign-in form saying *"Prijava trenutačno nije moguća. Pokušaj
ponovno."* on every attempt, or a redirect to that form when they expected to
already be signed in. Both look exactly like a Supabase outage. The way to tell
them apart is the browser console, which carries the stable code and the cause;
if you are debugging what looks like an outage and the console names
`SUPABASE_ENVIRONMENT_MISSING`, the project is misconfigured and Supabase is
fine. Fix it by correcting the GitHub Environment variable (§8) and **redeploying** —
these are build-time values, so changing the GitHub Environment variable does
nothing until the next deploy (re-run the deploy job, or push to `main`).

The deploy job builds with `pnpm --filter "@shift/web..." build`. The `...` in
`--filter @shift/web...` is pnpm's dependency ellipsis: it builds
`@shift/web` **and everything it depends on**, in topological order. It is a
no-op today and stops being one the moment `apps/web` imports `@shift/domain`,
at which point the plain `--filter @shift/web` would deploy a bundle built
against a stale or missing `packages/domain/dist`. Do not remove it.

**Source maps never reach the CDN.** The build emits `dist/assets/*.js.map`
with `sourcemap: 'hidden'` (`apps/web/vite.config.ts`): the maps exist, so a
production stack trace can be decoded against the same build, but no chunk
carries a `//# sourceMappingURL` comment. A map holds the whole original
source, comments included, so the deploy job deletes every `*.map` in
`apps/web/dist` before `wrangler pages deploy` (§8.1). A manual upload must do
the same (§5.3). Keep a map you want for debugging out of the upload, never in
it.

Deep links need no configuration beyond what is committed:
`apps/web/public/_redirects` contains `/*  /index.html  200`, so
`GET /some/deep/route` serves `index.html` with HTTP 200 rather than a 404.
There is no server to route it any other way.

Security headers are committed too: `apps/web/public/_headers` sets
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, a restrictive
`Permissions-Policy` and (story 20.3) `Strict-Transport-Security` on every
path, and the build copies it into `dist/` and appends a
`Content-Security-Policy-Report-Only` derived from `VITE_SUPABASE_URL` (§9.7).
It is not enforced until story 20.5 has verified it on staging. Check the headers
after a deploy with
`curl -sI https://<host>/ | grep -iE 'x-content-type|referrer|x-frame|permissions|strict-transport-security|content-security-policy'`.

While Pages is still deployed (deploys are off today), the HSTS line and the
Report-Only CSP reach Pages too: Pages reads the same built `_headers`. COOP
and CORP (`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`) are
deliberately not added: the image's headers equal today's hosting's, and
adding them is a later hardening decision.

---

## 5. Migration promotion runbook

Migrations are forward-only git files. **A file that has been promoted past
local is never edited.** A correction is a new migration with a higher number.

Run these in order. Do not skip staging.

### 5.1 Author locally

Migrations are **hand-numbered**. Do not run `supabase migration new`: it emits
a timestamp-prefixed filename (`20260904131500_name.sql`), and
`test/supabase-scaffold.test.ts` requires `<0000>_<snake_case>.sql`, contiguous
from `0001`, so that lexicographic order — which is the order the CLI applies
migrations in — matches numeric order. Create the file yourself with the next
number.

```bash
# 1. Write the migration. Number it above the highest existing file.
$EDITOR supabase/migrations/0003_<name>.sql

# 2. Prove it applies from nothing, not just from your current state.
pnpm exec supabase db reset

# 3. Prove the workspace is still green.
pnpm build && pnpm lint && pnpm typecheck && pnpm test

# 4. Commit the migration together with the code that needs it.
git add supabase/migrations/0003_<name>.sql && git commit
```

### 5.2 Promote to staging

> **Superseded for the self-hosted stacks (story 19.1).** `config.toml` now carries local and staging's auth values (`[auth] enable_signup = true`, confirmations on), so a `config push` of it would OPEN signup on a hosted project. The signup door, its switches and its probe are §9.9's.

```bash
# Confirm you are logged in (§0) and the staging project is not paused (§2):
pnpm exec supabase link --project-ref <staging-ref>
pnpm exec supabase db push                       # applies pending migrations only
pnpm exec supabase migration list                # local vs remote, must agree
pnpm exec supabase config push                   # see 5.2a — auth config is NOT in a migration
pnpm exec supabase functions deploy admin-auth   # only if the function changed
pnpm exec supabase functions deploy notify       # only if the function changed
```

#### 5.2a Why `config push` is not optional

> **Superseded for the self-hosted stacks (story 19.1).** `config.toml` now carries local and staging's auth values (`[auth] enable_signup = true`, confirmations on), so a `config push` of it would OPEN signup on a hosted project. The signup door, its switches and its probe are §9.9's.

`supabase/config.toml` governs the **local** stack only. Nothing in a migration
carries it. So a remote project that has never had `config push` run against it
keeps Supabase's defaults — and Supabase's default is **signup enabled**, which
contradicts the system's own rule that there is no open signup anywhere:
credentials are admin-issued through `admin-auth`, and an account that can sign
itself up has no member row, no organization claim and no business existing.

`config push` is what makes these three true remotely, per environment:

| Setting in `config.toml` | Value | Why |
| --- | --- | --- |
| `[auth] enable_signup` | `false` | no self-registration; an admin issues credentials |
| `[auth.email] enable_signup` | `true` | **not** the signup door — see below |
| `[auth] enable_anonymous_sign_ins` | `false` | an anonymous session has no organization |
| `[auth] site_url` | that environment's Pages URL | where a recovery link returns to |
| `[auth] additional_redirect_urls` | that environment's Pages URL(s) | an unlisted redirect is refused |
| `[auth.hook.custom_access_token]` | `enabled = true` + the `pg-functions://` URI | without it no token carries `organization_id` and every policy reads zero rows — see §5.2b |

<a id="the-two-enable-signup-keys"></a>

> **The two `enable_signup` keys are not two halves of the same switch**, and
> the names mislead. `[auth] enable_signup` becomes `GOTRUE_DISABLE_SIGNUP` and
> is the only one that refuses self-registration. `[auth.email] enable_signup`
> becomes `GOTRUE_EXTERNAL_EMAIL_ENABLED` and turns the **email/password
> provider** on or off in its entirety, sign-in included. Set it to `false` and
> every admin-issued credential stops working — a password grant answers
> `422 "Email logins are disabled"` — while open signup is no more refused than
> it already was. It is `true` on purpose, and `test/supabase-scaffold.test.ts`
> pins both values.

#### 5.2b The access token hook: order matters, in one direction only

`[auth.hook.custom_access_token]` names
`pg-functions://postgres/public/custom_access_token_hook`, and that function is
created by `supabase/migrations/0003_access_control.sql`. So the two commands in
§5.2 are not interchangeable:

```bash
pnpm exec supabase db push      # FIRST — creates the hook function
pnpm exec supabase config push  # THEN  — tells GoTrue to call it
```

Backwards, GoTrue is told to call a function that does not exist and **every
sign-in fails** for the window between the two commands. In the documented
order the worst case is harmless: between the push and the config push, tokens
are minted with no `organization_id` claim, and a token with no claim reads zero
rows rather than another tenant's — the policies fail closed on the claim's
absence by design.

**If you already pushed backwards**, sign-in is down until one of these lands,
and either is a single command:

```bash
# Preferred — finish what was started. The function is what the hook wants.
pnpm exec supabase db push

# Or back the hook out first, then push the migration and re-enable it.
$EDITOR supabase/config.toml     # [auth.hook.custom_access_token] enabled = false
pnpm exec supabase config push   # sign-in recovers immediately, without the claim
pnpm exec supabase db push       # then the function the hook wants
$EDITOR supabase/config.toml     # enabled = true again
pnpm exec supabase config push   # and the claim comes back at the next sign-in
```

With the hook off, sign-in works and every token is claimless — so sessions
read zero rows until you re-enable it. That is a degraded read, not an outage,
and it is the state to be in while the migration is fixed.

Three consequences worth knowing before the first promotion:

- **A claim-carrying token is only issued at the next sign-in.** The hook runs
  when a token is minted, not retroactively. Sessions held across the promotion
  keep their claimless tokens until they expire (`jwt_expiry = 3600`) or refresh,
  and until then those sessions read nothing. There is no backfill to write —
  nothing is stored on the account — but expect existing sessions to look
  logged-in and empty for up to an hour.
- **Remotely, `config push` is the only thing that enables it.** Nothing in a
  migration carries auth configuration (§5.2a), so an environment that has
  never had `config push` run against it has the function and no hook.
- **Verify the outcome, per environment**, by decoding a real token rather than
  trusting the command's exit code.

Read the password rather than typing it into the command. A `-d` argument lands
in shell history and in `ps` output for every other user on the machine — the
same leak §3 refuses to accept for the secret key, and this is a live member
credential against a real project. `jq --arg` is the same leak wearing a
different hat: an argument is an argument, and `ps` shows it. Pass both values
through the environment instead, which `jq` reads as `$ENV`, and unset them
after:

```bash
read -rsp 'password: ' SHIFT_PROBE_PASSWORD; echo
read -rp 'sign-in address: ' SHIFT_PROBE_ADDRESS

export SHIFT_PROBE_ADDRESS SHIFT_PROBE_PASSWORD

jq -n '{email: $ENV.SHIFT_PROBE_ADDRESS, password: $ENV.SHIFT_PROBE_PASSWORD}' \
  | curl -s -X POST 'https://<ref>.supabase.co/auth/v1/token?grant_type=password' \
      -H 'apikey: <that environment sb_publishable_*>' \
      -H 'content-type: application/json' \
      --data @- \
  | jq -r '.access_token | split(".")[1] | @base64d | fromjson'

unset SHIFT_PROBE_PASSWORD SHIFT_PROBE_ADDRESS
# -> "organization_id": "<that member organization>"   the hook runs  ✅
# -> "role": "authenticated"                           always, and never a domain role
# -> no organization_id at all                          config push has not run ❌
```

`jq`'s `@base64d` is what decodes the payload, not `base64 -d`: a JWT segment is
**unpadded base64url**, which GNU `base64` rejects outright and macOS spells
`-D` anyway — so the obvious pipeline fails, and a `2>/dev/null` on it hides the
failure and prints nothing at all.

`site_url` and `additional_redirect_urls` differ per environment while
`config.toml` holds the local values, so **set them for the target environment
before pushing** — either edit them for the push, or set them in the dashboard
and confirm `config push` does not revert them. Whichever you choose, §6
verifies the outcome rather than the intent. The `[auth.rate_limit]` table is
local only too (raised for the E2E suite): remove it for the push. Running
`node scripts/ci/set-auth-urls.mjs <origin>[,<origin>...]` does both, as the
pipeline does, and `git checkout supabase/config.toml` puts the file back.

> A `config push` failure is not cosmetic. Until it succeeds, that environment
> accepts self-service signups. Treat it as a blocking step, not a follow-up.

#### 5.2c The SPA and the schema: order matters, in one direction only

The same shape as §5.2b, one layer up, and it became an application-wide risk in
story 1.4c. `apps/web/src/features/organization/services/snapshot.ts` names every column it reads
in one constant, and the navigation chrome reads that row on **every signed-in
screen** to draw the organization's lockup and its accent. So a build that
selects a column the database does not have yet does not degrade — PostgREST
answers `42703 column organizations.brand_accent does not exist`, the whole read
fails, and the shell falls back everywhere at once.

```bash
pnpm exec supabase db push      # FIRST — adds the column
# THEN deploy the SPA that selects it
```

Backwards, the window between the two is an application in which no signed-in
screen can read its own organization. In the documented order the window is
harmless in the way this system's windows are meant to be: the column exists and
the old build simply does not ask for it.

This is not specific to `brand_accent`. It is true of **every column added to
`ORGANIZATION_COLUMNS`**, and it is worse than the same mistake looked in story
1.4b, where `logo_path` was read by `/organizacija` alone: one screen degrading
is a screen somebody can avoid, and the chrome is on all of them. Pages
deployments and `db push` are separate commands with no ordering between them,
so the ordering is this runbook's to state — and the pipeline's deploy job
(§8) runs them in this order for every environment.

Then verify on staging, against the Preview deployment:

- the migration appears in `supabase migration list` as applied remotely;
- signup is off — the §6 signup probe is refused;
- the Preview URL loads and a deep link returns 200;
- `admin-auth` answers with a JSON `code` rather than a 500 without one.

### 5.3 Promote to production

> **Superseded for the self-hosted stacks (story 19.1).** `config.toml` now carries local and staging's auth values (`[auth] enable_signup = true`, confirmations on), so a `config push` of it would OPEN signup on a hosted project. The signup door, its switches and its probe are §9.9's.

Only after staging has been verified.

```bash
pnpm exec supabase link --project-ref <production-ref>
pnpm exec supabase db push
pnpm exec supabase migration list
pnpm exec supabase config push                   # NEVER for production since 19.1: it would open signup (5.2a)
pnpm exec supabase functions deploy admin-auth   # only if the function changed
pnpm exec supabase functions deploy notify       # only if the function changed
```

**Migration `0043` before the `notify` that needs it.** Story 10.2's `notify`
names the organization in every email and reads that name from
`claim_notifications`, which only `0043` returns. Deployed against a database
still on `0042`, the new function gets no `organization_name`, renders nothing,
and releases each row as transient: every run spends an attempt, and after
five the row fails `ATTEMPTS_EXHAUSTED`. So `db push` first, then
`functions deploy notify` — the order above, and the order the deploy action
(§8) runs. The reverse window is harmless: the old `notify` ignores the extra
column, and a code it cannot render yet (one only `0043` writes) is retried
with backoff, five attempts over about 100 minutes, so deploy the function
within that window.

**Migration `0044` before the SPA and the `notify` of story 10.3.** `0044` adds
`organizations.email_notifications`, which `ORGANIZATION_COLUMNS` now selects
(§5.2c: the chrome reads it on every signed-in screen), and the
`notification_settings` table `/obavijesti` reads and writes. It also adds the
outbox filter trigger, so a member's or an organization's switch stops the
writes from the moment it lands. The new `notify` only adds the footer line
linking to `/obavijesti`; it reads nothing `0044` adds, but the link lands on a
route only the new SPA has. Deployed on its own, that means `db push`, then the
SPA, then `functions deploy notify`; deployed together with `0045` (as the
first deploy does), the combined order below wins. The switches also act at claim time: `claim_notifications`
(re-created by `0044`, same signature and grants) settles as failed, with
`failure_code = 'EMAIL_TURNED_OFF'`, every pending email row whose recipient or
organization has email off, including rows waiting out a retry; only a row
already claimed and in flight can still send. The `notify` function needs no
change for this.

**Migration `0045`, then the `notify` of story 10.4 straight away, then the
SPA.** `0045` adds `push_subscriptions` with `register_push_subscription` (the
SPA's *Obavijesti na uređaju* calls it), `delete_push_subscription` (the new
`notify` calls it), the `push` channel, and a `claim_notifications` that now
returns a `subscriptions` column (dropped and re-created, same grants). Every
writer writes a `push` row beside the `email` row for a recipient with a
device. The old `notify` knows only email and would send a `push` row by email,
so deploy the new one right after `db push`: `db push`, the function secrets
(with the VAPID values), `functions deploy notify`, and only then the SPA
(built with `VITE_VAPID_PUBLIC_KEY`). That is the order the deploy action (§8)
runs, and no `push` row exists before a member turns push on in the new SPA.
The new `notify` needs nothing of the new SPA. A VAPID value missing or
malformed never stops email: `notify` logs `notify cannot send push:
VAPID_…` at start and retries every `push` row as `PUSH_NOT_CONFIGURED`.
A `push` row whose member has no device left is settled failed at the claim
(`failure_code = 'PUSH_NO_SUBSCRIPTION'`); one whose every device answered
`404`/`410` fails `PUSH_SUBSCRIPTION_GONE`, and those devices are deleted.
A push service's own failures carry `PUSH_SERVICE_*` codes, never Resend's.

**Migration `0046` (the retro-10 batch), then its `notify` straight away.**
`0046` changes who a notification reaches and adds `notify`'s fourth RPC:

- `decide_leave_request` writes the decision's rows through
  `private.notify_members`, so the decision follows the same recipient rules as
  every other event on both channels: never the deciding admin's own session,
  only a member active today, and an email row only for a member with an
  address (before, the email row was written unconditionally);
- `claim_notifications` (same signature and grants) settles as failed, with
  `failure_code = 'RECIPIENT_INACTIVE'`, every pending `email` or `push` row
  whose recipient is not active in the organization's today, and never returns
  one;
- `push_devices_for_send(p_id uuid, p_claimed_at timestamptz)`, `service_role`
  only: `{status, devices}` — a push row's recipient's devices as they are
  **now** (`ready`), or `lease_lost` when the row is no longer the caller's
  (nothing is posted or settled), or `inactive` when the recipient was
  deactivated after the claim (settled `RECIPIENT_INACTIVE`). `notify` reads it
  right before posting, so a device handed to another member during the lease
  (a shared phone) is not posted the earlier member's notification; only the
  milliseconds between that read and the POST remain, an accepted window. The
  claim's `subscriptions` column stays, but `notify` no longer sends to it.

The new `notify` calls `push_devices_for_send`, which only `0046` has: against
a database without it (PostgREST answers `PGRST202`), every push row is given
back as `PUSH_DEVICES_MISSING` **without spending its attempt**, and none is
sent, so the window costs delay, never a lost row. Any other failed device read
is retried as `PUSH_DEVICES_UNAVAILABLE`, which does spend the attempt. So
`db push` first, then `functions deploy notify` — the deploy action's order.
The old (10.4) `notify` keeps working against `0046`, since the claim still
returns `subscriptions`. The same `notify` also: stops only email on a Resend
`401`/`403` (push rows in the run are still sent), and reports why each channel
stopped as `stopped: { email?, push? }` in its run answer; sends each push with a
path-only `url` (`/prijava/<slug>?povratak=…`), which the service worker opens
on its own origin, so a second origin in `APP_ORIGINS` no longer loses the deep
link; starts no push row after 35 s and no email after 45 s (checked
again after the pace wait), and bounds every settle like a send, so a run fits
inside pg_net's 55 s. The SPA needs nothing of `0046`.

**The first deploy of `0042`–`0046` together.** One order, which the deploy
action (§8.1) already runs:

1. `db push` — all five migrations;
2. the function secrets, with the Resend key, the invoke secret,
   `NOTIFY_EMAIL_FROM`, `SHIFT_APP_URL` and the VAPID values (§3a);
3. `functions deploy notify` — straight after `db push`, before the SPA;
4. the SPA, built with `VITE_VAPID_PUBLIC_KEY`;
5. **last, by hand, Vault** (§3a step 4): `notify_url` and
   `notify_invoke_secret`. Until both exist the cron job sends nothing, so no
   email's `/obavijesti` footer link (`0044`) can land on a bundle without the
   route, and no row is claimed by a half-deployed pair.

This replaces the per-migration orders above for that deploy: `0044`'s "SPA
before `notify`" is satisfied by step 5 instead (nothing is sent before the SPA
is live), and `0045`/`0046`'s "`notify` right after `db push`" by step 3.

**Never roll `notify` back below story 10.4 once `0045` is applied.** A `notify`
older than 10.4 knows only email: it sends every claimed `push` row as an email
to its recipient's address (a second copy of the same notification), and fails
the rest `RECIPIENT_NO_EMAIL`. Roll back only to a 10.4 or later `notify`; to
stop push instead, unset `VAPID_PRIVATE_KEY` (push rows are then retried as
`PUSH_NOT_CONFIGURED` and email is untouched). Rolling the batch's `notify` back
to 10.4's is safe: it ignores `push_devices_for_send` and sends to the claim's
`subscriptions`, without `0046`'s handover check.

**Migration `0048` before the SPA of story 11.1.** `0048` adds
`organizations.minimum_members` (nullable, `>= 1`, its own column grant), which
`ORGANIZATION_COLUMNS` now selects: an SPA deployed first asks for a column the
database lacks, PostgREST refuses the read, and every signed-in screen loses its
organization. `db push`, then the SPA. No function changes.

**Migration `0057` before the SPA of story 13.4.** `0057` adds the carry-over
setting, four nullable columns on `organizations` (`carry_over_max_days`,
`carry_over_expiry_month`, `carry_over_expiry_day`,
`carry_over_first_leave_year`, all four or none, one column grant), which
`ORGANIZATION_COLUMNS` now selects: as with `0048`, an SPA deployed first asks
for columns the database lacks and every signed-in screen loses its
organization. `db push`, then the SPA. No function changes, and nothing to
backfill: every organization starts with no carry-over.

**Epic 13, migrations `0053`–`0060`.** `db push` before the SPA holds for
`0053`–`0059` except `0056`; `0060` has no SPA step, only `notify` after it.
Each item below says what breaks if the order is reversed.
Installed PWAs (`registerType: 'prompt'`) keep an old bundle in control past a
deploy until the member takes the update prompt. So "an old client" here
includes installed devices for at least one release after the SPA ships.

- **`0053` before the SPA of story 13.2.** Without it, a member session's
  `absence_types` embed answers an empty catalog under `0052`'s admin-only
  policy, and the member's *Sati* is unavailable.
- **`0054` before the SPA of story 13.2b.** The new client always sends
  `p_absence_type_id` to `amend_leave_record` and selects
  `leave_requests.absence_type_id`. Against a database without `0054`, every
  amend fails with no matching function, and the request reads fail. An old
  client against `0054` keeps working: the request's type defaults to annual
  leave, and a null `p_absence_type_id` keeps the record's type.
- **`0055` before the SPA of story 13.3.** `MEMBERS_COLUMNS` embeds
  `leave_allowances(...)` and the organization's leave-year start. Without
  `0055`, every member read fails (`PGRST200`), which takes down Ljudi and
  every balance surface.
- **`0056` AFTER the SPA of story 13.3b, by at least one release.** This is the
  reverse case. `0056` takes `UPDATE (leave_allowance_days)` away, so an old
  client's *Promijeni pravo* PATCH is refused (`42501`). The new client only
  inserts into `leave_allowances`, so it works without `0056`. Apply `0056`
  once stale installed clients have had their update prompt, or together with
  a client version check once one exists.
- **`0057` before the SPA of story 13.4**, as above.
- **`0058` before the SPA of story 13.5.** The client selects
  `leave_records.half` and calls `amend_leave_record` with `p_half`. Without
  `0058`, the leave reads fail and every amend fails with no matching
  function. **Old installed clients against `0058`:** an amend sent without
  `p_half` writes a whole day, so an old bundle that amends a half-day record
  (only its dates or type) silently turns it into a whole day and charges 1
  instead of 0.5. The old bundle cannot show a half, so the admin cannot see
  it happen. The amend lands and notifies like any other. Until a client
  version check exists, the mitigation is the update prompt: an admin who
  amends leave should take it before amending a half-day record.
- **`0059` before the SPA of story 13.5b.** The client selects
  `leave_requests.half`. Without `0059`, every request read fails, on both the
  member's *Godišnji* and the admin's *Zahtjevi*. An old client against `0059`
  keeps working: its requests name no half and are whole days, and approval
  (`decide_leave_request`, same signature) copies whatever half the request
  holds.
- **`0060` before the `notify` function of story 13.7b.** `db push`, then
  `supabase functions deploy notify`. The SPA bundle changes only by the
  `obavijesti` copy in `hr.json`, which it never renders, so it has no order
  with `0060`. `0060` adds a
  `half` operand (`FIRST`/`SECOND`) to the six leave notifications of a half
  day, and none to a whole day's. An old `notify` against `0060` ignores the
  unknown operand and sends the whole-day text, so pushing `0060` first is
  safe. A new `notify` against a database without `0060` never sees a `half`
  and also sends the whole-day text. Rows already in the outbox when `0060`
  lands carry no `half` and send as whole days.

**Epic 14, migration `0061` (story 14.1).** `db push` alone: no SPA and no
Edge Function changes with it, and `notify` and `admin-auth` stay as they are.
Push it **outside the pilot's working hours**. `0061` attaches two audit
triggers to each of the 21 audited tables, and each `create trigger` holds its
table's lock until the migration commits, so writes wait for the push. With the
pipeline (§8), merging to `main` pushes `0061` to staging at once; the
production approval is the step that must be given outside the pilot's working
hours. In the same transaction, `0061` backfills the change history from the attribution columns
and writes one `HISTORY_BEGINS` marker per organization. **Before `0061`, hard
deletes and current-state edits (a rename, an archive flag, a member's details)
were never recorded and cannot be recovered.** The backfill rebuilds only what
`created_*`, `confirmed_*`, `removed_*`, `closed_*`, `answered_*` and the
decisions' `decided_*` hold, using each row's values as they stand at the push.
The SPA of story 14.2 reads `audit_events` and must ship **after** `0061`.
Deployed first, it would query a table the database does not have. From
`0061` on, the seed, the demo script and the e2e helpers leave owner-written
events (`actor` null), so `audit_events` is never empty after them. A write
from a session with no `SET ROLE` (the migration and its backfill, the seed, an
operator script, GoTrue's cascade, Studio's SQL editor) records `session_role`
as the literal `none`, so the history cannot tell those sources apart.

With the pipeline enabled (§8), merging to `main` is what promotes: staging is
deployed and smoked, then production waits for an approval, and each deploy
pushes migrations **before** it publishes the SPA. Without it, nothing publishes
on its own — the Pages project has no Git connection (§4) — so a manual
promotion ends with a manual upload, built with that environment's values:

```bash
VITE_SUPABASE_URL=https://<production-ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<production sb_publishable_*> \
VITE_VAPID_PUBLIC_KEY=<production VAPID public key> \
  pnpm --filter "@shift/web..." build
find apps/web/dist -name '*.map' -type f -delete   # source maps stay off the CDN (§4)
pnpm exec wrangler pages deploy apps/web/dist --project-name <project> --branch main
# staging: the staging values, and --branch staging
```

### 5.4 If a push fails midway

`supabase db push` applies migrations one at a time and stops at the first
error, recording only what succeeded. Do not edit the failed file if it has
already been promoted anywhere else — write the fix as the next migration,
verify it with `supabase db reset` locally, and push again.

---

## 6. Post-deploy verification

```bash
# Static SPA, no server runtime, no SSR output
ls apps/web/dist                       # index.html, assets/, _redirects, _headers

# The bundle carries no secret
grep -rn "sb_secret_" apps/web/dist/ || echo CLEAN

# Exactly two Edge Functions exist (AD-14)
ls supabase/functions/                 # -> admin-auth  notify
pnpm exec supabase functions list --project-ref <ref>   # -> admin-auth, notify; nothing else
```

Against the live host:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/                  # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/some/deep/route   # 200

# `resetPassword` WITH NO PAYLOAD, and NOT `createUser`: every operation is
# implemented, so the smoke test must be one the function refuses before it
# acts. A reset with no `memberId` is refused by its own validation, before
# either client is used.
curl -s -X POST https://<ref>.supabase.co/functions/v1/admin-auth \
  -H 'Authorization: Bearer <a real user JWT>' \
  -H 'content-type: application/json' \
  -d '{"operation":"resetPassword"}'
# -> 400 {"code":"PAYLOAD_INVALID"}
```

If the function returns `500 {"code":"SECRET_KEY_MISSING"}` or
`500 {"code":"SECRET_KEY_INVALID"}`, its secrets are not set for that project.
It never falls back to the publishable key. `500 {"code":"PROJECT_URL_INVALID"}`
means `SUPABASE_URL` is not a parseable http(s) URL, and
`500 {"code":"ALLOWED_ORIGINS_MISSING"}` that `SHIFT_ALLOWED_ORIGINS` names no
origin (§3). A browser sees none of these codes — with no allowlist it gets no
CORS header — so read them with `curl`, or in the function's log, which names
the code at startup.

`notify`, against the live host (the deploy action runs this probe after every
deploy). Without the invoke secret it refuses before
claiming anything; a `500` with a code instead names the missing or malformed
function secret (`RESEND_API_KEY_MISSING`, `INVOKE_SECRET_INVALID`, …; a
VAPID problem is logged, not answered, because email does not depend on it):

```bash
curl -s -X POST https://<ref>.supabase.co/functions/v1/notify
# -> 401 {"code":"INVOKE_SECRET_REFUSED"}
```

In the project's *SQL Editor*, the schedule and its recent runs, and the
outbox's state (counts only; never select `operands` for a report):

```sql
select jobname, schedule, active from cron.job where jobname = 'notify';
-- -> notify | * * * * * | t
select name from vault.secrets where name in ('notify_url', 'notify_invoke_secret');
-- -> both names; with either missing the job sends nothing (§3a)
select status_code, count(*) from net._http_response
 where created > now() - interval '1 hour' group by 1;
-- -> 200 ✅ · 401 the Vault secret and the function secret differ ❌ · 500 read the code
select id, created, error_msg from net._http_response
 where created > now() - interval '1 hour' and status_code is null
 order by created desc limit 20;
-- -> no rows ✅ · a timeout or a DNS error: the call never got an answer;
--    `notify_url` is wrong, or a run took longer than 55 s
select count(*) filter (where sent_at is not null) as sent,
       count(*) filter (where failed_at is not null) as failed,
       count(*) filter (where sent_at is null and failed_at is null) as waiting
  from notification_outbox;
select failure_code, count(*) from notification_outbox
 where failed_at is not null group by 1;
-- RECIPIENT_NO_EMAIL is expected (a member with no address);
-- PROVIDER_REFUSED means Resend refused the message itself (a 4xx other than 401/403);
-- ATTEMPTS_EXHAUSTED means five transient failures (Resend down, or rate-limited);
-- EMAIL_TURNED_OFF is expected (story 10.3): the recipient or the organization
-- turned email off after the row was queued, and the claim settled it unsent.
select failure_code, count(*) from notification_outbox
 where sent_at is null and failed_at is null and failure_code is not null group by 1;
-- PROVIDER_UNAUTHORIZED waiting means the key or the domain is wrong (§3a 1–2):
-- nothing is lost, every row is retried once it is fixed.
```

### When a member write half-happened

`admin-auth` performs two writes per operation against two services, and nothing
spans them (§ `supabase/functions/admin-auth/operations.ts`). Each pair carries a
compensating action, and each carries a distinct code for the case where the
COMPENSATION itself failed. Those two codes are the only states in this system a
person at a screen cannot resolve, so they are operator work. Both are logged by
the function with the identifier you need; the reply carries the code alone.

**`ACCOUNT_NOT_REMOVED`** — an `auth.users` row was created, its `members` row was
refused, and deleting the account failed too. The account can sign in, carries no
`organization_id` claim, and therefore reads nothing anywhere. It also holds the
synthesized address, so re-issuing that username answers `USERNAME_TAKEN` for
ever until it is removed.

```bash
# The function logged `ACCOUNT_NOT_REMOVED <auth user id>`.
# Confirm it really has no member row before removing anything.
select u.id, u.email, m.id as member
  from auth.users u left join members m on m.auth_user_id = u.id
 where u.id = '<auth user id>';
-- member IS NULL -> safe to delete; the row is an orphan by definition.
delete from auth.users where id = '<auth user id>';
```

**`USERNAME_NOT_RESTORED`** — `members.username` was moved, the address would not
follow, and putting the row back failed. The two stores now disagree: the member
signs in at the OLD address and the list shows the NEW username. Nothing in
PostgreSQL can hold the two together (`0007`), so the reconciliation is manual —
and the address is the authority, because it is what authenticates.

```bash
# The function logged `USERNAME_NOT_RESTORED <member id>`.
select m.id, m.username, split_part(u.email, '@', 1) as signs_in_as
  from members m join auth.users u on u.id = m.auth_user_id
 where m.id = '<member id>';
-- Put the row back to what the account actually answers to:
update members m
   set username = lower(split_part(u.email, '@', 1))
  from auth.users u
 where u.id = m.auth_user_id and m.id = '<member id>';
```

Then ask the admin to try the rename again. If it keeps failing, the cause is in
the function's log line above the code.

### When a status version already in effect is wrong

A deactivation dated today or earlier is in effect, and nothing in the product
undoes it. No policy updates or deletes an in-effect `member_status_versions`
row, and an admin cannot change their own status. So when an admin deactivated
the wrong member, or the organization's only reachable admin was deactivated by
a mistaken date, the correction is an operator write as the owner.

**Append a reactivation dated today. Never delete or update the wrong row.**
History is immutable: the member really was out on the days already past, and
the record of that stays. The new row is the correction, and it ends the outage
from today on.

```bash
# 1. Read the member's versions and the organization's today.
select v.effective_from, v.active, v.created_at,
       public.organization_today(v.organization_id) as today
  from member_status_versions v
  join members m on m.id = v.member_id
  join organizations o on o.id = m.organization_id
 where o.slug = '<slug>' and m.username = '<username>'
 order by v.effective_from;
```

- The wrong row is the latest and is dated **before today**: go to step 2.
- The wrong row is dated **after today**: it is not in effect yet. Another
  active admin cancels it in the product. If none can, deleting that one row as
  the owner is that same cancellation and rewrites nothing that has happened.
- A version dated **after** the wrong one is already scheduled (only the latest
  row can lie in the future): cancel that one first, as above, so the history
  still alternates. Then go to step 2.
- The wrong row is dated **today**: today's date is taken, because a member has
  one version per date (`unique (member_id, effective_from)`). Date the
  reactivation tomorrow instead (`+ 1` in step 2). The member is back at
  midnight in the organization's zone. That costs one day, which is less than a
  rewritten history.

```bash
# 2. Append the reactivation. `created_by` cannot default here (no session, so
#    no auth.uid()), so attribute it to the admin who asked for the correction.
#    For a lone admin, that is the member themselves.
insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
select m.organization_id, m.id, true, public.organization_today(m.organization_id), '<requesting admin auth user id>'
  from members m join organizations o on o.id = m.organization_id
 where o.slug = '<slug>' and m.username = '<username>';
```

Run step 1 again: the new row is the latest, `active` is true, and it is dated
today (or tomorrow). The member signs in again as usual. The access-token hook
refused them while they were inactive, so no session needs to be revoked.

### TRUNCATE is refused, for `postgres` too

`0023` puts a `before truncate` trigger on `members`, `member_status_versions`
and `team_membership_versions`. Each raises `23001 TRUNCATE_REFUSED`, for every
role, and so does any `truncate ... cascade` that reaches one of them. TRUNCATE
fires no row trigger, so it would bypass the zero-admins rule and every version
rule. To remove one organization, `delete from organizations where id = ...`:
the cascade runs row by row, and every rule still holds.

If a maintenance job really must TRUNCATE one of these tables, disable that
table's trigger in the same transaction, so it cannot outlive the job:

```sql
begin;
alter table public.member_status_versions disable trigger member_status_versions_refuse_truncate;
truncate public.member_status_versions;
alter table public.member_status_versions enable trigger member_status_versions_refuse_truncate;
commit;
```

The `alter table` takes ACCESS EXCLUSIVE on the table until commit, so run it
in a maintenance window.

Since `0061` (story 14.1), no session role (`anon`, `authenticated`,
`service_role`) holds TRUNCATE on `audit_events` or on any of the 21 audited
tables, because a TRUNCATE fires no row trigger and would leave no history.
Only the owner can still truncate them, and a truncate by the owner is not
recorded.

### Signup is off, remotely

> **Superseded for the self-hosted stacks (story 19.1).** `config.toml` now carries local and staging's auth values (`[auth] enable_signup = true`, confirmations on), so a `config push` of it would OPEN signup on a hosted project. The signup door, its switches and its probe are §9.9's.

`config push` (§5.2a) is the only thing that turns Supabase's default open
signup off on a remote project, so verify the outcome rather than trusting the
command's exit code. Run this against **each** environment:

```bash
curl -s -X POST 'https://<ref>.supabase.co/auth/v1/signup' \
  -H 'apikey: <that environment's sb_publishable_*>' \
  -H 'content-type: application/json' \
  -d '{"email":"probe@example.invalid","password":"a-long-throwaway-password"}'
# -> {"code":422,"error_code":"signup_disabled",...}   signup is off  ✅
# -> a user object, or a confirmation-sent reply       signup is OPEN ❌
```

An open result means that project accepts self-service accounts. Re-run
`supabase config push` for it, re-probe, and delete any account the probe
created before moving on.

Also confirm, in the dashboard under *Authentication → URL Configuration*, that
Site URL and Redirect URLs name that environment's Pages hostname — a stale
`http://127.0.0.1:5173` there sends every password-recovery link to localhost.

---

## 7. Provisioning an organization

An organization is created by an operator, by hand, once per tenant. **No
product surface creates one** (FR-2) and none ever will, so this section is the
only way a tenant comes into existence.

### 7.1 What the operator holds, and what they do not

| Credential | Needed here | Why |
| --- | --- | --- |
| The database password (the same one `supabase db push` uses) | **yes** | the script connects as `postgres` and writes rows |
| The secret key (`sb_secret_*`) | **no** | AD-17 confines it to the `admin-auth` function's environment |
| The publishable key | **no** | nothing in this path goes through PostgREST |

`supabase/operator/provision-organization.sql` is SQL rather than a Node CLI for
exactly that reason. A script calling the Admin API to create the first user
would put the secret key into an operator's shell, which amends AD-17 rather
than obeying it. Writing `auth.users` directly needs no key at all, and it makes
"one transaction" literally true across the auth rows and the domain rows: an
organization and its first admin are created together or not at all.

### 7.2 Run it

Every value arrives as a session setting, so nothing is interpolated into SQL
text and a name with an apostrophe in it is data rather than syntax. `PGOPTIONS`
is how libpq carries them: `-c <name>=<value>` per setting, with any space in a
value escaped as `\ `.

The first admin's password is read without echoing it, so it never lands in
shell history, and it is unset afterwards. It must be at least as long as
`minimum_password_length` in `supabase/config.toml` (10); a shorter one is
refused with `ADMIN_PASSWORD_TOO_SHORT`. Inside `PGOPTIONS` a value cannot hold
a space or a backslash (a space would need `\ `, and the backslash itself is
consumed), so generate one without either: `openssl rand -hex 16` does.

```bash
read -s ADMIN_PW
PGOPTIONS="\
-c shift.organization_slug=vatrogasci-primjer \
-c shift.organization_name=Vatrogasci\ Primjer \
-c shift.organization_type=Fire\ Department \
-c shift.organization_timezone=Europe/Zagreb \
-c shift.organization_locale=hr \
-c shift.leave_year_start_month=1 \
-c shift.leave_year_start_day=1 \
-c shift.admin_name=Ime\ Prezime \
-c shift.admin_username=ime.prezime \
-c shift.admin_password=$ADMIN_PW \
-c shift.admin_leave_allowance_days=20" \
  pnpm db:provision
unset ADMIN_PW
```

`PGOPTIONS` is still visible in the process list for as long as the command
runs. On a shared machine, or for a password that needs a space or a backslash,
pipe the settings and the script to `psql` in one session instead, the way §7.5
does for the demo, and pass the password as a `psql` variable:
`set_config('shift.admin_password', :'pw', false)` quotes it as data.

`pnpm db:provision` is
`supabase db query --local -f supabase/operator/provision-organization.sql`.
For a remote project, run the same file with `--linked` (after
`supabase link`) instead of `--local`.

| Setting | Required | Notes |
| --- | --- | --- |
| `shift.organization_slug` | yes | lowercase letters, digits and single hyphens; the sign-in addresses are built from it, so it cannot change later |
| `shift.organization_name` | yes | |
| `shift.organization_short_name` | no | |
| `shift.organization_description` | no | |
| `shift.organization_address` | no | |
| `shift.organization_contact_email` | no | the organization's own address, not a member's |
| `shift.organization_type` | yes | a descriptive label; inert, and it never affects scheduling |
| `shift.organization_timezone` | yes | IANA `Area/Location` name (`Europe/Zagreb`). Every date and time renders in it, and the product cannot change it later. An abbreviation (`CET`, `UTC`), a POSIX string or a `posix/` alias is refused |
| `shift.organization_locale` | yes | BCP 47 tag |
| `shift.leave_year_start_month` | yes | 1–12 |
| `shift.leave_year_start_day` | yes | 1–28 |
| `shift.admin_name` | yes | |
| `shift.admin_username` | yes | lowercase; becomes the local part of the sign-in address |
| `shift.admin_password` | yes | at least 10 characters (`minimum_password_length`) |
| `shift.admin_email` | no | a real address if the admin has one; sign-in never uses it |
| `shift.admin_leave_allowance_days` | yes | |

The admin signs in with the **synthesized address**, not the username on its
own: `<shift.admin_username>@<shift.organization_slug>.shift.invalid`. The
script prints it as a `NOTICE` when it succeeds. `.invalid` is reserved by
RFC 2606 and resolves nowhere, which is what makes an account usable by someone
with no email address (AD-12).

### 7.3 Refusals

| What you did | What comes back |
| --- | --- |
| Supplied organization attributes and no admin | `ORGANIZATION_WITHOUT_ADMIN`, and the organization row is rolled back with it |
| Omitted a required organization attribute | a Postgres `23502` / `23514` — the schema refuses it, there is no separate validation |
| Reused a slug or a username within a slug | a unique violation, `23505` |
| Gave a first-admin password shorter than 10 characters | `ADMIN_PASSWORD_TOO_SHORT` (`23514`) |
| Gave a timezone that is not an IANA `Area/Location` name the database knows | `ORGANIZATION_TIMEZONE_UNKNOWN` (`23514`), with the value in the detail |
| Gave a setting of white space alone (tabs and no-break spaces included) | read as not given: `ORGANIZATION_WITHOUT_ADMIN` for an admin setting, the schema's `23502` for a required organization one |

Later, once the organization exists, the database refuses any path that would
leave it with zero admins — deleting the last admin, or downgrading their role
— with `ORGANIZATION_WOULD_HAVE_NO_ADMIN`. That check is deferred to commit, so
swapping one admin for another inside a single transaction stays legal.

### 7.4 Verify

```bash
# Exactly one admin, and the whole schema still carries exactly one
# constraint trigger. `tgisinternal` matters: every foreign key is implemented
# as a trigger with a constraint too, so counting without it can never be 1.
pnpm exec supabase db query --local "
  select (select count(*) from members where role = 'admin') as admins,
         (select count(*) from pg_constraint
           where contype = 't' and connamespace = 'public'::regnamespace) as constraint_triggers"

# The admin authenticates. Use the local publishable key from `supabase status`.
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $(pnpm exec supabase status -o json | jq -r .PUBLISHABLE_KEY)" \
  -H 'content-type: application/json' \
  -d '{"email":"ime.prezime@vatrogasci-primjer.shift.invalid","password":"<the password>"}'
# -> an access_token   ✅
# -> 400 invalid_grant for a username that was never issued   ✅
# -> 422 "Email logins are disabled"   ❌ [auth.email] enable_signup is false
#    (see the blockquote in §5.2a — that key is the provider, not the signup door)
```

Reading `organizations` or `members` through PostgREST with the publishable key
and no session returns `[]`, not an error: row level security is on and every
policy is `to authenticated`, so an anonymous caller matches none of them. That
stays true forever — there is no anonymous read path in this system — and
`test/provisioning.test.ts` and `test/rls-isolation.test.ts` both assert it.

With a session it returns that organization's rows and no other:

```bash
# The token from the grant above, against the real HTTP path the SPA uses.
curl -s 'http://127.0.0.1:54321/rest/v1/members?select=name,role' \
  -H "apikey: $(pnpm exec supabase status -o json | jq -r .PUBLISHABLE_KEY)" \
  -H "Authorization: Bearer <the access_token>"
# -> that organization's members only  ✅
# -> []  the token carries no organization_id claim — see §5.2b   ❌
```

A member-role token reads the same list and changes nothing on it: a `PATCH`
answers `204` having affected zero rows, and a `POST` answers
`403 {"code":"42501"}`. Both are asserted in `test/rls-isolation.test.ts`
against both fixtures.

### 7.5 Demo organization (local and staging)

`supabase/operator/demo-organization.sql` creates `dvd-demo`, "DVD Kaštel Novi
(demo)": one admin (`admin`, "Demo Admin", no rank), sixteen members in four
crews, `Smjena A` to `Smjena D` (each a commander, a driver and two
firefighters, all ranked), the pilot's hour bands (`Dan` 07:00, `Noć` 19:00),
its shift types (`Dan`, `Noć`, `Slobodno`) and its rotation (`Dan`, `Noć`,
`Slobodno`, `Slobodno`, with `Smjena A` to `Smjena D` at offsets 0 to 3,
anchored on and effective from 2020-01-01). It is what a human looks at. It is not a test fixture:
`supabase/seed.sql`, the tests and the E2E suite do not use it, and it touches
no other organization.

**Never run it in production.** The script refuses unless `shift.demo_target`
is `local` or `staging`. That guard checks only the target you *declare*: it
cannot tell which database it is connected to. Before a `--linked` run,
confirm that `supabase link` points at the **staging** project
(`supabase projects list` marks the linked one), and re-link if in doubt.

| Setting | Required | Notes |
| --- | --- | --- |
| `shift.demo_target` | yes | `local` or `staging`; anything else, unset included, is refused with `DEMO_TARGET_REFUSED` |
| `shift.demo_password` | yes | every demo account's password; no default; unset, empty or whitespace-only is refused with `DEMO_PASSWORD_MISSING` |

Both refusals raise SQLSTATE `P0001` and write nothing. Every account signs in
as `<username>@dvd-demo.shift.invalid`, the admin as
`admin@dvd-demo.shift.invalid`.

#### Local

```bash
pnpm db:demo
pnpm exec supabase db query --local \
  "select count(*) from members m join organizations o on o.id = m.organization_id where o.slug = 'dvd-demo'"
# -> 17
```

`pnpm db:demo` is
`PGOPTIONS='-c shift.demo_target=local -c shift.demo_password=local-fixture-password' supabase db query --local -f supabase/operator/demo-organization.sql`.

#### Staging

> **Not yet verified against a real staging project.** Staging deploys are
> still off, so the `--linked` path below has been exercised only in its
> `--local` form. Check the verification query's answer the first time.

Read the password without echoing it or leaving it in shell history. Inside
`PGOPTIONS` a value cannot contain spaces or backslashes, so choose a password
without them:

```bash
read -s DEMO_PW
PGOPTIONS="-c shift.demo_target=staging -c shift.demo_password=$DEMO_PW" \
  pnpm exec supabase db query --linked -f supabase/operator/demo-organization.sql
unset DEMO_PW
```

`PGOPTIONS` travels in the connection's startup packet, and a connection
pooler may not pass it through. If the run is refused with
`DEMO_TARGET_REFUSED` although you set the target, set both values in the same
session instead. `supabase db query` sends one statement per call, so use
`psql` with the staging connection string (Dashboard → Connect), which runs
everything piped to it in one session. The password goes in as a `psql`
variable, so it is quoted as data and never appears in the SQL text:

```bash
read -s DEMO_PW
{ echo "select set_config('shift.demo_target', 'staging', false), set_config('shift.demo_password', :'pw', false);"
  cat supabase/operator/demo-organization.sql; } \
  | psql "<the staging connection string>" -v ON_ERROR_STOP=1 -v pw="$DEMO_PW"
unset DEMO_PW
```

Verify:

```bash
pnpm exec supabase db query --linked \
  "select count(*) from members m join organizations o on o.id = m.organization_id where o.slug = 'dvd-demo'"
# -> 17
```

#### Re-running and removing

**Re-running replaces the demo.** In one transaction, serialized against any
concurrent run by an advisory lock, the script deletes the `dvd-demo`
organization (everything scoped to it cascades) and every auth user under
`@dvd-demo.shift.invalid`, then creates it all again. Any edits made to the
demo are lost. Only `@dvd-demo.shift.invalid` auth users are removed: an
account added to the demo through the interface with any other address loses
its member row (it cascades with the organization) but keeps its auth user,
which then belongs to no organization. Delete such an account by hand if it
matters.

To remove the demo entirely, run these two queries in this order (use
`--linked` instead of `--local` for staging; `supabase db query` takes one
statement per call):

```bash
pnpm exec supabase db query --local "delete from organizations where slug = 'dvd-demo'"
pnpm exec supabase db query --local "delete from auth.users where email like '%@dvd-demo.shift.invalid'"
```

### 7.6 Paper-schedule demo, `dvd-mladost` (local and staging)

`supabase/operator/demo-mladost.sql` creates `dvd-mladost`, "DVD Mladost
(demo)": one department's paper schedule for November 2026, rebuilt in the
app so it can be compared with the paper day by day, with Epic 21's tools:
four 24-hour crews (`Smjena 1` to `Smjena 4`, a team rotation and a minimum of
4 each), one day team (`Dnevni`, off on holidays, minimum 1) whose four
dispatchers and one cleaner each have a personal rotation, manual-only
students on no team whose days are personal assignments, the Croatian
holidays for 2026 (so 18 November empties the day team's rotations), job
roles, per-person exceptions as personal assignments, and four annual leaves,
one of them partly covered by a replacement by assignment (0081). There is no
carrier team, shift-type override or roster override. It needs the schema
through 0082. The script's header explains how each part of the paper maps
onto the model.

It holds the schedule's **structure only**, keyed by abstract person keys
(`S1-ZAP`, `A1`, `ST3`, …). The people are a parameter: `shift.demo_people`
is a JSON array with one `{key, name, username, password}` object per key.
The names are **fictional**. The paper's real names, and every password, stay
out of the repository, the database and the logs. The script refuses with
`DEMO_PEOPLE_INVALID` on a missing, unknown or repeated key, or on a blank
field, and it refuses with `DEMO_TARGET_REFUSED` as §7.5 does. Re-running it
replaces `dvd-mladost` and every `@dvd-mladost.shift.invalid` auth user, and
nothing else, including anything added to `dvd-mladost` by hand. The person
with key `S1-ZAP` is the admin.

Pass the JSON on `psql`'s stdin. Base64 keeps it one quoted token, and it
never appears on a command line:

```bash
{ printf '\\set people %s\n' "$(base64 -w0 people.json)"
  echo "select set_config('shift.demo_target', 'staging', false), set_config('shift.demo_people', convert_from(decode(:'people', 'base64'), 'UTF8'), false) \\g /dev/null"
  cat supabase/operator/demo-mladost.sql; } \
  | psql "<the staging connection string>" -v ON_ERROR_STOP=1 -q
```

To remove it, run §7.5's two deletes with `dvd-mladost` in place of
`dvd-demo`.

---

## 8. CI/CD

One GitHub Actions workflow, `.github/workflows/pipeline.yml`, runs on every
pull request to `main` and every push to `main`.

| Job | Runs on | What it does |
| --- | --- | --- |
| `quality` | PR + `main` | Gitleaks over the **full** history (`.gitleaks.toml`), then `pnpm lint` |
| `build` | PR + `main` | `pnpm typecheck`, `pnpm build`, uploads `apps/web/dist` as the `web-dist` artifact (built with no environment's values, so it proves the build and is never deployed) |
| `test` | PR + `main` | `supabase start -x $SUPABASE_UNUSED_SERVICES` (the stack without Studio, analytics, Realtime and the mail catcher, which no job uses), `pnpm build`, `pnpm test`; **fails if the root Vitest run skipped anything** (§8.5) |
| `changes` | PR | Is anything but docs changed? A pull request that changes only `_bmad-output/`, `_bmad/`, `.claude/`, `docs/` or Markdown skips `e2e` and `e2e-report`; a push to `main` always runs them |
| `e2e` | PR + `main`, four shards | Each shard on a runner of its own, so it never shares a stack with `test` or another shard (`e2e/README.md`): `supabase start -x edge-runtime,$SUPABASE_UNUSED_SERVICES`, the two local env files from `supabase status` (`scripts/ci/write-local-env.mjs`), `supabase functions serve admin-auth` and Vite on `127.0.0.1:5173`, then `pnpm test:e2e --shard=N/4`, which writes a blob report. Shard 1 then runs `pnpm test:smoke` against those same local servers (anonymous checks plus sign-in as the seeded `dvd-kastel-novi` / `ana.kovac`), so the smoke specs run on every PR. A failing shard uploads its traces and screenshots |
| `e2e-report` | after `e2e` | Merges the shards' blob reports into one HTML report, uploaded as `e2e-report` |
| `ci-passed` (check **CI passed**) | PR + `main`, always | The one check branch protection requires: fails if any of `quality`, `build`, `test`, `changes`, `e2e` failed, was cancelled or was skipped, except `e2e` skipped on a docs-only PR. `e2e-report` is not gated |
| `deploy-staging` | `main`, deploys enabled | §8.1 against the `staging` stack in Coolify: images built and probed, migrations over the tailnet, images pushed to GHCR and deployed |
| `smoke-staging` | after `deploy-staging` | `pnpm test:smoke` against the staging origin, with the smoke account if configured |
| `deploy-production` | after `smoke-staging`, **after approval** | §8.1 against the `production` stack, with the functions digest staging deployed; a migration only after a recorded backup (§8.2 step 6) |
| `smoke-production` | after `deploy-production` | `pnpm test:smoke`, anonymous |
| `notify` | any failed or cancelled job on `main` | an error annotation and a run-summary line naming the failed and cancelled jobs; a Slack post if `SLACK_WEBHOOK_URL` is set |

A failing job stops everything after it: production never starts unless
staging deployed **and** its smoke passed.

**Branch protection on `main`** (retro 10 A12). Required: a pull request; the
single status check **CI passed**, with "require branches to be up to date
before merging", so a PR's run includes the latest `main`; no bypass for
admins. Do not require the E2E shards by name: on a docs-only PR the skipped
matrix job reports as `E2E (Playwright, shard ${{ matrix.shard }}/4)`, so a
required `shard 1/4` never reports and the PR waits forever. Renaming the
`ci-passed` job's `name:` needs the same change in the rule.

**Concurrency.** GitHub keeps at most one *running* and one *pending* run or
job per concurrency group, and when a newer one arrives it silently cancels the
older **pending** one — it does not form a queue. The workflow is built around
that rule:

- Pull requests: one group per PR, and a newer push cancels the run in progress.
- Pushes to `main`: no workflow-level group. Every push runs `quality`,
  `build`, `test` and `e2e` straight away, so CI on `main` is never held back —
  or dropped — behind a run parked at the production approval.
- `deploy-staging` and `deploy-production` each have a job-level group that
  never cancels a deploy in progress. While one runs, a newer run's deploy
  waits; if a third arrives meanwhile, the second's pending deploy is cancelled
  and only the newest is kept — which is the one worth shipping. Two runs can
  therefore interleave: staging can already hold run B while production is
  still waiting for approval of run A. Approve (or reject) the older production
  deploy first, and check which commit a pending approval is for.

### 8.1 What a deploy job does, in order

`.github/actions/deploy/action.yml`, once per environment (story 20.6). The
target is that environment's self-hosted stack and `shift-web` application in
Coolify (§9); nothing is deployed to Supabase cloud or Cloudflare. Every step
that can refuse a release runs **before** the runner reaches the server, so no
migration is applied for a release whose images would be refused.

1. **Check the configuration** (`scripts/ci/require-config.mjs`, in the job):
   every item of §8.2 is set, has no leading or trailing whitespace, and has
   its shape (an https API origin, a tailnet host and a port, a tailnet
   Coolify URL, Coolify uuids and token, a `tskey-client-` secret, an
   `sb_publishable_` key, an 87-character VAPID public key), naming each one
   that fails; then `APP_ORIGINS` is parsed once (`scripts/ci/origins.mjs`).
2. **Build `apps/web`** with that environment's `VITE_SUPABASE_URL` (=
   `SUPABASE_API_URL`), `VITE_SUPABASE_PUBLISHABLE_KEY` and
   `VITE_VAPID_PUBLIC_KEY`, so its CSP names its own API origin.
3. **The bundle check** (`scripts/ci/check-bundle.mjs`): no `sb_secret_` key,
   no JWT whose `role` is not `anon`, no Resend key, and not the private half
   of this environment's VAPID public key. GitHub holds none of the stack's
   runtime secrets any more, so the check refuses these shapes, not values:
   a secret with no recognisable shape (the invoke secret, the JWT signing
   secret, the Postgres password) is not looked for, and stays out of the
   bundle because no `VITE_*` carries it. Then every `*.map` is deleted.
4. **Build `shift-web` and probe it offline** with the same probe as the
   `web-image` job (`scripts/ci/probe-web-image.sh`, §9.7), against this
   build's `_headers`.
5. **`shift-functions`.** Staging builds it and probes it offline
   (`scripts/ci/probe-functions-image.sh`, §9.6), unless GHCR already holds
   the probed build of the same sources (`:src-<hash>` of `deploy/functions`,
   both functions, `.dockerignore` and the probe), which is reused, so a
   release that changes only the SPA never restarts the stack. Production
   never rebuilds it: it deploys the digest staging deployed in the same run,
   and fails if none was handed over.
6. **Push to GHCR** (`scripts/ci/registry.sh push`), logged in with the job's
   own `GITHUB_TOKEN` on stdin: `ghcr.io/<owner>/shift-functions:<sha>` and
   `:src-<hash>`, and `ghcr.io/<owner>/shift-web:<environment>-<sha>`.
   Nothing pulls these tags, so pushing changes nothing that runs. They are
   not immutable (a re-run of the job pushes a rebuilt image under the same
   commit tag): **the digests in the run summary** are the rollback handles
   (§8.7). A registry read that fails (a login, a rate limit) fails the step;
   it is never taken for a missing tag. Only the two deploy jobs hold
   `packages: write`, and they run only on a push to `main` with deploys
   enabled.
7. **Join the tailnet** as an ephemeral node tagged `tag:ci`
   (`tailscale/github-action`, the OAuth client of §8.2). The tailnet ACL lets
   `tag:ci` reach the two stacks' Postgres ports and the Coolify API only. The
   node logs out when the job ends.
8. **`supabase migration list --db-url`**, then **the backup gate**
   (`scripts/ci/backup-gate.mjs`, H-12): if migrations are pending in
   **production**, the job stops unless `PRE_MIGRATION_BACKUP_AT` records a
   backup taken within the last 24 hours (§8.2 step 6). Staging needs none.
9. **`supabase db push --db-url`**, migrations only, never the seed; then
   `migration list --db-url` again, failing on any difference between local and
   remote (`scripts/ci/check-migrations.mjs`). The URL is
   `postgresql://postgres@$DB_HOST:$DB_PORT/postgres`: the password reaches
   the CLI as `PGPASSWORD`, never in the URL or as an argument. GoTrue's
   settings are not pushed: they are the stack's compose environment, held to
   `config.toml` by a test (§9.3, §8.6).
10. **Deploy `shift-functions`.** The stack runs
    `ghcr.io/<owner>/shift-functions:<environment>` (its `SHIFT_FUNCTIONS_IMAGE`,
    pulled on every start). A deploy-only Coolify token cannot change that
    reference, so `registry.sh point` moves the tag to the probed digest (a
    carbon copy of the manifest, verified), and
    `POST /api/v1/services/<uuid>/restart?latest=true`
    (`scripts/ci/coolify.mjs restart-service`) restarts the stack with its
    images pulled again. **That restarts the whole stack, Postgres included**:
    about a minute without the API, on every release that changes the
    functions, and on no other. The step waits (10 minutes at most) until
    Postgres reports a start time after the request, which shows the restart
    ran; which digest the functions container then runs is not visible from
    the runner (story 20.5 checks it on the host). If the digest equals the
    last one verified here (`:<environment>-live`) and the channel tag names
    it too, nothing restarts. `psql` and a connection are checked before the
    migration, and every database step has a 10-second connect timeout. The
    logic is `scripts/ci/deploy-images.sh`.
11. **The `notify` probe**, in the same step: a POST to
    `$SUPABASE_API_URL/functions/v1/notify` with no token must answer
    `401 {"code":"INVOKE_SECRET_REFUSED"}`, retried for up to five minutes
    while the stack starts. Only then does `:<environment>-live` record the
    digest. **If anything in steps 10–11 fails** after the channel tag was
    moved, the tag is put back on the digest it named before, so a later
    restart brings the verified image back. The stack may already run the new
    one (the restart may have happened): the job's warning says so, and
    §8.7 is the way back. On an environment's first deploy there is nothing
    to put back, and the job says that instead.
12. **Deploy `shift-web`**, after the migration and the functions (§5.2c):
    `registry.sh point` moves `ghcr.io/<owner>/shift-web:<environment>` to the
    probed digest, `POST /api/v1/deploy?uuid=<uuid>&force=false`
    (`coolify.mjs deploy-application`) has Coolify pull it and replace the
    container, and `scripts/ci/wait-for-web.mjs` polls the first app origin
    until `/` is byte-for-byte this build's `index.html` (10 minutes at most),
    then that the live answer carries every header of this build's
    `_headers` `/*` block with its exact value, HSTS included, and
    `Cache-Control: no-cache` (it keeps polling while the old container still
    answers with the old headers). A failure puts the channel tag back.
    Traefik must add no security header of its own (no Coolify header
    middleware on this resource): a second value would fail the check. As
    for the functions, the container may already be the new one when the
    check fails: redeploy (§8.7) to return to the restored tag.
13. The run summary names both images by digest, failed runs included (a
    failed run's digests are not a rollback target); the job's outputs give
    the smoke jobs the app origin and the API URL. The waits are bounded by
    wall clock (restart 10 minutes, probe 5, origin 10, each plus one last
    try), about 26 minutes at worst, so with the builds the deploy jobs'
    timeout is 45.

The pipeline uses no `supabase link`, `config push`, `secrets set`,
`functions deploy` or `wrangler`, and holds no Supabase account token, no
Cloudflare token and no runtime secret of a stack. The Vault secrets the cron
job reads are set by hand, once per stack (§3a, §9.4): the pipeline never
writes Vault.

### 8.2 Configure it

Nothing deploys until the repository variable `DEPLOY_ENABLED` is exactly
`true`. Until then, pushes to `main` run `quality`, `build`, `test` and `e2e`
only, stay green, and the `build` job's run summary lists what is left to
configure. Once it is `true`, a missing or malformed item fails the deploy job
by name, before anything reaches the server, rather than being skipped.

**1. Stand each environment up in Coolify first** (story 20.5 for staging,
20.9 for production): the stack from `deploy/coolify/supabase/` with
`SHIFT_FUNCTIONS_IMAGE=ghcr.io/<owner>/shift-functions:<environment>`, and a
Docker-image application for `shift-web` with image
`ghcr.io/<owner>/shift-web` and tag `<environment>` (§9.7). The pipeline never
creates a Coolify resource. Coolify pulls from GHCR with a registry credential
on the server: a token with `read:packages` only (H-9), never the deploy
job's. The first deploy's push creates the two GHCR packages (private) before
Coolify is asked to pull them.

**2. Two Environments**, under *Settings → Environments*. Both settings marked
required are the gate; do not skip either.

| Environment | Deployment branches (**required**) | Required reviewers |
| --- | --- | --- |
| `staging` | *Selected branches* → `main` only | none |
| `production` | *Selected branches* → `main` only | **required**: at least one person — `deploy-production` waits in the run until someone approves it |

**3. On EACH Environment, these secrets** (Environment secrets, never
repository secrets: a repository secret is readable by any job on any branch,
an Environment secret only by a job that names that Environment, so only from
`main`, and for production only after approval). Each value is that
environment's own; staging and production never share one (H-8).

| Name | Kind | Value |
| --- | --- | --- |
| `SUPABASE_DB_PASSWORD` | secret | the stack's Postgres password (Coolify's generated `SERVICE_PASSWORD_POSTGRES`), for `db push` and `migration list` only |
| `COOLIFY_API_TOKEN` | secret | a Coolify API token with the **deploy** permission only (*Keys & Tokens → API tokens*), `<id>\|<token>`. It can queue a deploy or a restart and nothing else: it cannot read or change a resource's settings or secrets |
| `TS_OAUTH_CLIENT_ID` | secret | a Tailscale OAuth client with the `auth_keys` scope, limited to the tag `tag:ci` |
| `TS_OAUTH_SECRET` | secret | that client's secret (`tskey-client-…`) |

**4. On EACH Environment, these variables** (public or non-secret):

| Name | Kind | Value |
| --- | --- | --- |
| `APP_ORIGINS` | variable | the app's bare **https** origin, `https://staging.<domain>` or `https://app.<domain>` (comma-separated if there are more; the first is the one checked, the Environment URL and the smoke's target). It must equal the stack's `SHIFT_APP_URL` |
| `SUPABASE_API_URL` | variable | the stack's public API origin, Kong's domain: `https://api.staging.<domain>` or `https://api.<domain>` |
| `SUPABASE_PUBLISHABLE_KEY` | variable | the stack's publishable key, `sb_publishable_` + Coolify's `SERVICE_PASSWORD_64_PUBLISHABLEKEY` (§9.2). Public by design: it is inlined into the bundle |
| `VAPID_PUBLIC_KEY` | variable | the stack's Web Push public key (87 characters), the same value as its `VAPID_PUBLIC_KEY` in Coolify |
| `DB_HOST` | variable | the server's tailnet host, where `tailscale serve` publishes the stack's Postgres: its full MagicDNS name (`<name>.<tailnet>.ts.net`) or Tailscale address (Tailscale's CGNAT range). A public host name or a bare label is refused: the database password goes to it, and a bare label could be answered by the runner's own DNS |
| `DB_PORT` | variable | that environment's Postgres port on the tailnet |
| `COOLIFY_API_URL` | variable | Coolify's API origin **on the tailnet**, `http://<name>.<tailnet>.ts.net:<port>` or a Tailscale address (plain http is accepted for a tailnet host only) |
| `COOLIFY_WEB_UUID` | variable | the `shift-web` application's uuid in Coolify |
| `COOLIFY_FUNCTIONS_UUID` | variable | the Supabase stack's (service's) uuid in Coolify |

**5. The tailnet ACL** (the founder's): `tag:ci` may reach the two Postgres
ports and the Coolify API port on the server, and nothing else; the OAuth
client may create keys for `tag:ci` only. Keys it creates are ephemeral.

What this does NOT separate (accepted until 20.9): both environments join as
the same `tag:ci`, so a staging job can reach production's Postgres port (it
still needs production's password, which only the approved production job
holds), and a Coolify API token is scoped to a team, not a project, so
staging's deploy-only token could queue a deploy or restart of a production
resource. Such a call can only redeploy what production's channel tags name,
and only the approved production job moves those; it is still a restart the
production reviewer did not approve. Per-environment tags
(`tag:ci-staging`, `tag:ci-production`) and per-environment Coolify teams
are the fix, owned by 20.9. The Tailscale action passes the OAuth secret to
`tailscale up` as an argument on the (single-use) runner; it never reaches
the log.

**6. Production migrations: the backup before them** (H-12;
`PRE_MIGRATION_BACKUP_AT`, a `production` Environment variable). When a
release carries migrations, `deploy-production` stops before `db push` unless
this records a backup taken in the last 24 hours. Before approving such a
release: take a manual backup on the host,
`shift-ops backup production --manual pre-migration` (§9.12; its set name is
its UTC time), set `PRE_MIGRATION_BACKUP_AT` to that time as
`YYYY-MM-DDTHH:MMZ`, then approve (or re-run the job). A time up to five
minutes ahead of the runner's clock is accepted (clock skew); later is
refused. **Clear the variable after the release**: the gate cannot tell
which release a backup was taken for, so a value left set lets any other
release with migrations through for 24 hours. Releases without migrations
ignore it. Story 20.7 kept this step manual: the deploy job cannot reach the
host, and a dump taken on the runner would leave personal data on GitHub's
machines. Automating it needs a forced-command SSH key for `tag:ci`, a
permission only the founder can grant (§9.12, `deferred-work.md`).

Repository-level, only two things, neither a deploy credential:

| Name | Kind | Value |
| --- | --- | --- |
| `DEPLOY_ENABLED` | variable | `true` to turn deploys on; anything else (or unset) keeps them off |
| `SLACK_WEBHOOK_URL` | secret, optional | an incoming-webhook URL for `notify`; unset means no Slack post |

**Never in GitHub:** the stack's secret key, the Resend key
(`RESEND_API_KEY`), the invoke secret (`NOTIFY_INVOKE_SECRET`), the VAPID
private key (`VAPID_PRIVATE_KEY`), the JWT signing secret, any Supabase
account token or Cloudflare token. They live in the stack's Coolify
environment only (AD-17 as amended, §9.2). The GHCR push credential is the
job's own `GITHUB_TOKEN`; no registry token is stored anywhere in GitHub.

**7. The smoke account (staging only, optional).** With all three set on the
`staging` Environment, `smoke-staging` also signs in and checks it lands on
`/danas`. With none of them set that one case is skipped and the rest still
run; with only one or two set, the smoke fails as misconfigured.

| Name | Kind | Value |
| --- | --- | --- |
| `SMOKE_ORG` | variable | the smoke organization's slug |
| `SMOKE_USERNAME` | variable | the smoke member's username |
| `SMOKE_PASSWORD` | secret | that member's password |

Provision it by hand with §7 against **staging**, as its own organization (for
example `smoke`), never inside a real tenant. `smoke-production` is anonymous;
production has no smoke account.

**8. Turn it on:** set `DEPLOY_ENABLED` to `true`, then push to `main` (or
re-run the latest `main` run). Read the first run's deploy logs end to end:
the Coolify calls (§8.1 steps 10 and 12) are written against Coolify v4.7.6's
API and have never run against our instance.

### 8.3 The remote smoke

`smoke/` with `playwright.smoke.config.ts` — no web server, no global setup,
nothing provisioned. Against `SMOKE_BASE_URL` it checks that `/` and a deep link
answer 200 with the SPA shell, that `/prijava` renders with no
`SUPABASE_ENVIRONMENT_MISSING` in the console, that Kong answers the signup
route with its one `200 {}` and no `Server`, `Via` or `X-Kong-*` header, and
closes `/auth/v1/otp`, `/magiclink`, `/signup/` and a GET on `/verify` with 404
(story 19.1, §9.9), that `admin-auth` answers CORS for the deployed origin,
and, with the smoke account configured, that sign-in lands on `/danas`. It
never signs out: a sign-out revokes every session of the account.

**It writes nothing.** The signup probe's address is synthesized
(`smoke-probe-<uuid>@smoke.shift.invalid`), which Kong answers itself and never
relays to GoTrue (AD-22), and which the before-user-created hook would refuse
anyway, so the probe creates no account whether the stack's door is shut or
open. Whether the door is shut is read from the stack's environment and
`private.signup_settings` (§9.9), not probed: Kong gives every address one
answer by design.

Run it locally against the dev server; the project URL and publishable key fall
back to `apps/web/.env.local`:

```bash
SMOKE_BASE_URL=http://127.0.0.1:5173 pnpm test:smoke
# with the sign-in case, against the local seed:
SMOKE_BASE_URL=http://127.0.0.1:5173 SMOKE_ORG=dvd-kastel-novi \
  SMOKE_USERNAME=ana.kovac SMOKE_PASSWORD=local-fixture-password pnpm test:smoke
```

### 8.4 When the pipeline is not an option

The pipeline is the only thing that builds, probes and publishes an image:
no founder device holds a GHCR write credential, and none should. Without
Actions, the manual path can therefore only **promote what the pipeline
already published**: apply migrations and point Coolify at a release whose
digests a run summary names. A release that was never built waits for
Actions. A manual promotion and a pipeline deploy must never overlap, and
nothing but you can stop that:

1. set the repository variable `DEPLOY_ENABLED` to anything but `true` (for
   example `paused`); runs already past their deploy gate are not stopped, so
   let any in-flight deploy finish, or cancel it, first;
2. from a founder device on the tailnet, at the checkout of that release's
   commit: for production with pending migrations, a backup first (§8.2
   step 6); `PGPASSWORD=… pnpm exec supabase db push --db-url
   "postgresql://postgres@<tailnet host>:<port>/postgres"`, then
   `migration list --db-url … --output-format json` and
   `scripts/ci/check-migrations.mjs` on its output;
3. in Coolify, pin the stack and the `shift-web` application to that
   release's digests exactly as a rollback does (§8.7), functions first, and
   verify with §6 and §9.5 step 7b;
4. leave the pins in place until the pipeline deploys again: before setting
   `DEPLOY_ENABLED` back to `true`, set both resources back to their channel
   tag (`<environment>`) in the same sitting as the next pipeline run, and
   check that run's summary shows the release you expect.

The hosted runbook in §5 describes Supabase cloud and Cloudflare Pages, which
no environment uses any more; story 20.9 rewrites it.

### 8.5 What "no test skipped" covers

Only the **root** Vitest run (`vitest run` over `test/**`, the last command of
`pnpm test`) is checked, from its JSON report
(`scripts/ci/assert-no-skipped.mjs`). The `pnpm -r test` package runs before it
are not. In CI every root `skipIf` prerequisite is present — the stack is up
and the app is built — so a skip there means a prerequisite silently went
missing. It also means **an `it.skip`, `it.todo` or `describe.skip` in a root
test now fails CI**: remove the case, or finish it, instead of parking it.

### 8.6 What replaced `config push`

> **Superseded for the self-hosted stacks (story 19.1).** `config.toml` now carries local and staging's auth values (`[auth] enable_signup = true`, confirmations on), so a `config push` of it would OPEN signup on a hosted project. The signup door, its switches and its probe are §9.9's.

On the hosted platform, `supabase config push` sent `config.toml`'s auth and
API settings to each project on every deploy. A self-hosted stack has no such
endpoint: GoTrue and PostgREST are configured by the stack's compose
environment (§9.3), and **the pipeline does not push it**. Their parity with
`supabase/config.toml` (signup off, the email provider on, anonymous sign-ins
off, autoconfirm, JWT expiry, refresh rotation and reuse interval, the
minimum password length, the access token hook, PostgREST's schemas, search
path and row cap) is `test/self-hosted-stack.test.ts`, which runs on every
pull request. A change to one of those settings is a reviewed change of
`config.toml` and the compose file together, applied in Coolify by the
operator (redeploy the stack after the migration that needs it, §9.4).
`config.toml`'s `[auth.rate_limit]` stays local-only.

### 8.7 Rolling back

Every deploy's run summary names its two images by digest:
`ghcr.io/<owner>/shift-web@sha256:<hex>` and
`ghcr.io/<owner>/shift-functions@sha256:<hex>`. The commit tags beside them
(`shift-web:<environment>-<sha>`, `shift-functions:<sha>`) are convenient but
a re-run can overwrite them; the digest cannot change. To roll back to an
earlier release, **redeploy its images through Coolify, by digest**:

- **The SPA.** In Coolify, the environment's `shift-web` application:
  *Configuration → General → Docker Image Tag* = `sha256-<hex>` (Coolify
  v4.7.6 reads a tag starting `sha256-` as the image digest), save,
  *Redeploy*. It changes nothing in the database. Check the origin serves the
  old build (§6).
- **The functions.** The stack's environment: `SHIFT_FUNCTIONS_IMAGE` =
  `ghcr.io/<owner>/shift-functions@sha256:<hex>`, save, *Restart* (the
  stack, Postgres included, restarts for about a minute). Never to a
  `notify` older than story 10.4 while `0045` is applied: an older `notify`
  emails every `push` row (§5.3).
- **Then set both back to the channel tag** (`<environment>`) before the next
  deploy. Until then the pipeline still moves the channel tag but Coolify keeps
  running the pinned one: `wait-for-web.mjs` fails the next deploy loudly for
  the SPA, but nothing notices for the functions (the pipeline compares with
  the digest it last verified, `:<environment>-live`, not with what Coolify
  runs, and the `notify` probe answers the same from either). Pause deploys
  (`DEPLOY_ENABLED`) while a rollback is in force, and revert the bad commit on
  `main` so the next release is a fix, not the same image again.
- **Migrations are forward-fix only** (§5.4). There is no down-migration and
  no reset of a stack's database, ever. A bad migration is corrected by the
  next migration, promoted the same way. A restore from backup is the only way
  back (story 20.7), and it loses every write since the backup.

Because the database cannot roll back, write schema changes so the SPA can —
**expand, then contract**:

1. **Expand:** a release adds only — a new column (nullable or with a default),
   a new table, a new function. The bundle already live does not ask for it, so
   rolling the SPA back is always safe (§5.2c is the same rule from the other
   side: the column exists before any bundle selects it).
2. **Migrate readers:** a later release switches the SPA to the new shape.
3. **Contract:** only once no live bundle — including the one you might roll
   back to — reads the old column, a further release drops or renames it.

Never drop or rename a column that the live bundle reads in the same release
that stops reading it: the deploy pushes the migration first, so between
`db push` and the new image going live every signed-in screen that reads it
fails (§5.2c), and rolling the SPA back afterwards lands on a bundle that reads
a column that no longer exists.

---

## 9. Self-hosted stack (story 20.1)

Shift is moving off hosted platforms onto our own server, run by Coolify
(Epic 20, `sprint-change-proposal-2026-11-20-self-hosting.md`). Until story
20.9 rewrites this runbook, the sections above still describe the hosted
setup. This section describes the self-hosted Supabase stack that replaces a
"Supabase project", one per environment. Story 20.5 rehearsed it on the server
and created staging in Coolify (§9.11).

The stack is `deploy/coolify/supabase/docker-compose.yml`. It is derived from
Coolify's Supabase service template at Coolify v4.7.6 (commit
`b7cbdb480faa1a124423e3c3c886481848c96cf9`) and trimmed. **The repository's
file is the source of truth.** It is pasted into a Coolify "Docker Compose"
resource per environment (`shift-staging`, `shift-production`) and never edited
in Coolify; a change is a reviewed PR here, then pasted again.

### 9.1 What runs, and what does not

| Service | Image (Supabase CLI 2.116.0's own) | Role | Reachable from |
| --- | --- | --- | --- |
| `supabase-db` | `supabase/postgres:17.6.1.165` | Postgres 17 with `pg_cron`, `pg_net`, Vault (as `[db] major_version`) | `127.0.0.1:<loopback-port>` only, published to the tailnet with `tailscale serve --tcp` |
| `supabase-kong` | `kong:2.8.1` | the gateway; maps opaque keys to role JWTs (§9.2) | the internet, at `api.<domain>`, through Coolify's Traefik with TLS. **The only public route into the stack** |
| `supabase-auth` | `supabase/gotrue:v2.196.0` | Auth, configured by its environment (§9.3) | the stack's network |
| `supabase-rest` | `postgrest/postgrest:v16.1` | PostgREST | the stack's network |
| `supabase-storage` | `supabase/storage-api:v1.70.3` | Storage, **file** backend on the named volume `supabase-storage-data` (logos only; uploads capped at the logo bucket's 2 MiB from `0005`) | the stack's network |
| `supabase-meta` | `supabase/postgres-meta:v0.98.0` | Studio's database API | the stack's network |
| `supabase-studio` | `supabase/studio:2026.08.17-sha-0c1da8f` | the dashboard | `127.0.0.1:<loopback-port>` only, over the tailnet. **No domain, no Kong route** |
| `supabase-edge-functions` | `shift-functions` (story 20.2): `supabase/edge-runtime:v1.74.3` with the router and both functions baked in, built by CI | the router, `admin-auth` and `notify` (§9.6) | through Kong's `/functions/v1/` |
| `shift-web` (its own Coolify resource, not in the compose) | `shift-web` (story 20.3): `nginxinc/nginx-unprivileged:1.30.6-alpine3.24` (by digest) with the built SPA, built by CI | the SPA: `dist`, `_headers`' headers on every response, the SPA fallback, caching (§9.7) | the internet, at `app.<domain>`, through Coolify's Traefik with TLS |

**Studio has no login of its own.** Whoever reaches its port is an
administrator of the database. Its only protection is H-5: it publishes on the
host's loopback, `tailscale serve` puts it on the tailnet, and the Tailscale
ACL limits it to the founder's devices. It holds no JWT signing secret.

**Not run, and why:** Realtime (Shift subscribes to nothing), analytics
(Logflare) and Vector (the heaviest services; logs are read with `docker logs`
through Coolify), Supavisor (PostgREST pools its own connections; pilot scale),
MinIO and imgproxy (the file backend is enough for logos, and no image is
transformed). Kong has no Studio catch-all, no `/pg/` route (pg-meta through
the public gateway), no MCP and no SAML routes.

**The functions** run the `shift-functions` image (story 20.2), whose base is
the edge-runtime the CLI pins; its router, the image and the gateway's part are
§9.6.

**Limits and logs.** Every service has a `mem_limit` and `cpus`, defaulting to
staging's value, so a variable left out fails low. Staging's is strictly below
production's for every service: about 2.2 GiB and 1.0 CPU in all, against
production's (`production.env.example`) about 2.9 GiB. Postgres's
`shared_buffers` is 128 MB on staging, 256 MB on production. Every service
logs through Docker's `json-file` driver, rotated at 10 MB with three files
kept, so a noisy container cannot fill the disk.

What story 20.5's rehearsal measured at staging's limits: a small CPU share
makes the Node and Lua services slow to START, not slow to serve. Storage
needed about 95 s, pg-meta about 135 s and Kong about 70 s before their health
checks passed, so each has a `start_period` (180 s, 240 s, 180 s) and is not
reported unhealthy, nor `up --wait` failed, while it is still starting. Kong
sat at about 184 MiB at rest and reached 233 MiB on staging with one nginx
worker per host CPU; it now runs one worker (`KONG_NGINX_WORKER_PROCESSES=1`,
which also makes each `policy: local` limit exact) and sat at about 106 MiB
after staging's checks, under a 240 MiB limit (production keeps 256 MiB); pg-meta sat at about 94 of its 112 MiB. The functions
container peaked at about 125 MiB of its 448 MiB through the rehearsal's
probes (two warm workers): the pair `FUNCTIONS_MEM_LIMIT=448m` and
`MEMORY_LIMIT_MB = 150` per worker stays (`deferred-work.md`).

**Inputs.** `staging.env.example` and `production.env.example` list every
variable the operator sets in Coolify, with placeholders only (`<domain>`,
`<loopback-port>`, `<registry>`, `<sha>`): the app origin, the functions
image (§9.6), two loopback ports, the sender, the limits,
and the values no generator can make: `RESEND_API_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. The compose refuses to start without
any of `SHIFT_APP_URL`, `SHIFT_FUNCTIONS_IMAGE`, the two loopback ports, `NOTIFY_EMAIL_FROM` and those
four (`${NAME:?}`), and none has a default. Never write a real value,
an address or a port into either file: the repository is public.

### 9.2 Keys and secrets (AD-17 as amended by 20.1)

Every other secret is **generated by Coolify** when the resource is created,
and none has a default in the compose:

| Variable | What it is | Held by |
| --- | --- | --- |
| `SERVICE_PASSWORD_JWT` | the JWT signing secret, the root of every key of the stack | GoTrue, PostgREST, Storage. **Never Kong, Studio or `edge-runtime`** |
| `SERVICE_SUPABASEANON_KEY`, `SERVICE_SUPABASESERVICE_KEY` | the `anon` and `service_role` HS256 JWTs Coolify signs with it | Kong, Storage, Studio |
| `SERVICE_PASSWORD_64_PUBLISHABLEKEY` | the publishable key is `sb_publishable_` + this | Kong, `edge-runtime` (`SHIFT_PUBLISHABLE_KEY`), the SPA's build |
| `SERVICE_PASSWORD_64_SECRETKEY` | the secret key is `sb_secret_` + this | Kong, `edge-runtime` (`SHIFT_SECRET_KEY`) only |
| `SERVICE_PASSWORD_64_NOTIFYINVOKE` | `NOTIFY_INVOKE_SECRET` (64 characters, matches `notify`'s shape) | `edge-runtime`, and the stack's Vault (§3a) |
| `SERVICE_PASSWORD_64_REMINDINVOKE` | `REMIND_INVOKE_SECRET` (story 17.2; 64 characters, `remind`'s own, never `notify`'s) | `edge-runtime`, and the stack's Vault once armed (§3b) |
| `SERVICE_PASSWORD_POSTGRES` | Postgres's password: `postgres` and `supabase_admin` (superusers) and every service role (`roles.sql`), and `db push`'s | GoTrue, PostgREST, Storage, pg-meta and Studio. Each of those containers therefore holds a superuser password; none is reachable from outside the stack's network but Studio's loopback port |
| `SERVICE_PASSWORD_PGMETACRYPTO` | pg-meta's encryption key | pg-meta, Studio |

Each stack generates its own, so staging and production never share a value,
and none is ever the demo value of Supabase's self-hosting `.env.example`.

**The key form is the opaque one, `sb_publishable_…` / `sb_secret_…`, settled
from the pinned sources.** No service behind Kong is authenticated by an `sb_`
key: Kong maps it. (The `apikey` header itself is forwarded as it came,
`hide_credentials: false`, as the CLI does.)
Its request-transformer replaces `Authorization` with `Bearer <service_role
JWT>` when `apikey` is the secret key and `Bearer <anon JWT>` when it is the
publishable key, and passes through any `Authorization` that is not
`Bearer sb_…` (a member's session token). That is the expression Supabase CLI
2.116.0 builds for its own local stack (`legacyBuildKongBearerToken` in
`kong.service.ts`). Coolify v4.7.6's template has the same expression
(`LUA_AUTH_EXPR`, key-auth consumers for both forms), but maps to asymmetric
role JWTs and only when the operator sets the opaque keys (otherwise it falls
back to the JWTs alone); here the keys are always generated and map to the
HS256 role JWTs, as the CLI's do. Kong takes the key from the `apikey` header
only (`key_in_query: false`), the header the mapping reads, so a key is never
written to the access log as part of a URL. So the functions' and the
SPA's `sb_` guards stay exactly as they are, and the functions hold no JWT, no
signing secret and no database password. Kong's entrypoint substitutes the keys
into its declarative config with `awk` over `ENVIRON`, never `eval echo`, which
would run the Lua `$(…)` as a shell command. **It fails closed:** Kong does not
start if either role JWT is empty, either opaque key has fewer than 32
characters after its prefix, any of the four holds a character outside
`[A-Za-z0-9._-]` (which could break out of the Lua string it is spliced into),
or the two keys or the two JWTs are the same value. So an empty generated value
can never make the bare `sb_secret_` a `service_role` credential.

One difference from the hosted platform: a hosted project refuses an
`sb_secret_` key sent from a browser; this gateway does not. The secret key
lives only in the `edge-runtime` environment and is never in a browser, so the
difference matters only for a key that has already leaked, and the answer to
that is rotation.

The live confirmation is the probe in §9.5, run on the first stand-up.

**Rotating the Postgres password.** `roles.sql` runs only when the data volume
is empty, so changing `SERVICE_PASSWORD_POSTGRES` on a running stack also
needs its `ALTER USER … WITH PASSWORD` statements (authenticator, pgbouncer,
supabase_auth_admin, supabase_functions_admin, supabase_storage_admin) re-run
by hand with the new value, and `postgres`'s and `supabase_admin`'s own
(pg-meta and Studio log in as `supabase_admin`), before the services restart.

### 9.3 Auth settings: `config.toml` stays the source

A self-hosted GoTrue is configured by environment variables, not by
`config push`. The compose mirrors `supabase/config.toml` literal for literal,
and `test/supabase-scaffold.test.ts` fails, naming the variable and both
values, when they differ:

| Compose (GoTrue, PostgREST) | `config.toml` |
| --- | --- |
| `GOTRUE_DISABLE_SIGNUP=${SHIFT_DISABLE_SIGNUP:-true}` | not `[auth] enable_signup`, through `staging.env.example`; production's template keeps `true` (§9.9) |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED=true` | `[auth.email] enable_signup` (the provider, not the signup door, §5.2a) |
| `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false` | `[auth] enable_anonymous_sign_ins` |
| `GOTRUE_MAILER_AUTOCONFIRM=${SHIFT_MAILER_AUTOCONFIRM:-true}` | not `[auth.email] enable_confirmations` (pinned `true` outright), through `staging.env.example`; production's keeps `true` |
| `GOTRUE_MAILER_OTP_EXP=3600`, `GOTRUE_MAILER_OTP_LENGTH=10` | `[auth.email] otp_expiry`, `otp_length` |
| `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true`, `…_URI=pg-functions://postgres/public/before_user_created_hook` | `[auth.hook.before_user_created]` |
| `GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED=true` | `[auth.email] double_confirm_changes` |
| `GOTRUE_EXTERNAL_PHONE_ENABLED=false`, `GOTRUE_SMS_AUTOCONFIRM=true` | `[auth.sms] enable_signup`, not `enable_confirmations` |
| `GOTRUE_JWT_EXP=3600`, `PGRST_APP_SETTINGS_JWT_EXP=3600` | `[auth] jwt_expiry` |
| `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true`, `…_REUSE_INTERVAL=10` | `enable_refresh_token_rotation`, `refresh_token_reuse_interval` |
| `GOTRUE_PASSWORD_MIN_LENGTH=10` | `minimum_password_length` |
| `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `…_URI=pg-functions://postgres/public/custom_access_token_hook` | `[auth.hook.custom_access_token]` |
| `PGRST_DB_SCHEMAS`, `PGRST_DB_EXTRA_SEARCH_PATH`, `PGRST_DB_MAX_ROWS` | `[api] schemas`, `extra_search_path`, `max_rows` |

Not mirrored: `site_url` and the redirect list (per environment: both are
`SHIFT_APP_URL`), and `[auth.rate_limit]` (local only; the deployed limits are
GoTrue's own and Kong's, §9.9). Since story 19.1, `config.toml` is the source
of local and STAGING's auth settings; production's closed door lives in
`production.env.example` (AD-10 as amended). GoTrue's SMTP, templates, subjects
and limits are §9.9's. To change an auth setting, change `config.toml` and the
compose in one PR, then paste the compose into Coolify and redeploy GoTrue.

### 9.4 The order rules on a fresh stack

1. **GoTrue and Storage before the first `db push`.** Migration `0003`
   creates `current_member_access()`, a SQL function whose body Postgres checks
   at creation and which reads `auth.users.deleted_at` and `banned_until`;
   those columns, and `auth.identities` that provisioning writes, come from
   GoTrue's own migrations. Migration `0005` inserts the logo bucket into
   `storage.buckets`, which Storage's own migrations create when it first
   starts.
2. **The hook's migration before GoTrue runs with the hook.**
   `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` names a function created by
   `0003`, and `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED` one created by `0066`
   (story 19.1). The same holds for every later change that enables a hook:
   the migration first, then the GoTrue environment (§5.2b). Until `0066` is
   pushed, a user-creating path other than `POST /admin/users` fails on the
   missing function; Kong leaves only `/signup` open (§9.9), and the door is
   shut by `GOTRUE_DISABLE_SIGNUP` anyway.
3. Migrations are applied with `supabase db push --db-url` over the tailnet,
   never through a public port and never by a container inside the stack.

**The first Coolify deploy of a stack, in order** (story 20.5 runs it):

1. Deploy the resource with the compose and its environment.
2. Wait until `supabase-auth` and `supabase-storage` report healthy: GoTrue's
   and Storage's own schema migrations have then run.
3. `supabase db push --db-url` over the tailnet, then
   `supabase migration list --db-url` and `check-migrations.mjs` (§5).
4. Restart `supabase-auth`, so GoTrue starts with the hook's function present.

Meanwhile GoTrue runs with a hook that does not exist yet. That is harmless:
there are no users before the push and provisioning (§7), so it signs in
nobody, and nothing issues a token. Story 20.5 also writes the self-hosted
Vault setup (§3a), with `notify_url` set to the internal
`http://supabase-kong:8000/functions/v1/notify`, never the public origin.

### 9.5 The local rehearsal and the key probe (story 20.5's first act)

This proves the stack before it holds anything: every migration applies from
nothing, the extensions work, the hook runs, signup is refused, and the opaque
keys work through Kong. **Story 20.5 ran it** on the server that hosts staging
(2026-11-23): every step answered as written below (the results are in its
spec's Verification). The run found five things, fixed here: Storage, Kong and
pg-meta need a start period at staging's CPU share (§9.1), the CLI refuses a
Postgres without TLS unless the URL says `sslmode=disable`, the locally built
functions image must not be pulled, and `staging.env.example`'s open door and
placeholder proxy network stop GoTrue and Kong from starting in a rehearsal.
(The run trusted a private Docker range as the proxy network; the script below says
`127.0.0.1/32` because this repository names no other address. Either passes
Kong's check, and in a rehearsal nothing sits in front of Kong, so neither is
ever the peer.)

It runs under its own project name, `shift-rehearsal`, on its own loopback
ports. **Never** use the project name or the ports of the local development
stack (`supabase start`, ports 543xx), and never run `supabase stop` or
`supabase db reset` here: they act on the development stack.

```bash
# 0. From the repository root, a scratch directory outside it, three free
#    loopback ports, and a teardown that runs however the script ends.
cd "$(git rev-parse --show-toplevel)"
R=$(mktemp -d); PG_PORT=<free port>; KONG_PORT=<free port>; STUDIO_PORT=<free port>
DC="docker compose -p shift-rehearsal --project-directory $R --env-file $R/.env -f $R/docker-compose.yml"
teardown() {
  $DC down -v
  unset ADMIN_PW JWT PUB SEC DB_URL VAPID_PRIVATE_KEY RESEND_API_KEY \
    $(sed -n 's/^\(SERVICE_[A-Z0-9_]*\)=.*/\1/p' "$R/.env" 2>/dev/null)
  rm -rf "$R"
}
trap teardown EXIT
set -eo pipefail   # a failed step stops here; the trap still tears down

# 1a. The functions image, built locally from this checkout (story 20.2);
#     nothing is pushed.
docker build -f deploy/functions/Dockerfile -t shift-functions:rehearsal .

# 1. Coolify writes each `content:` bind to its `source` file; plain
#    `docker compose` does not accept `content:` or `exclude_from_hc`. Render
#    them, and publish Kong on the loopback for the rehearsal only.
node --input-type=module -e '
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
const out = process.argv[1];
const compose = parse(readFileSync("deploy/coolify/supabase/docker-compose.yml", "utf8"));
for (const service of Object.values(compose.services)) {
  delete service.exclude_from_hc;
  for (const volume of service.volumes ?? []) {
    if (typeof volume !== "object" || volume.content === undefined) continue;
    const file = join(out, volume.source);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, volume.content);
    delete volume.content;
  }
}
compose.services["supabase-kong"].ports = ["127.0.0.1:${KONG_LOOPBACK_PORT:?}:8000"];
// The image was built locally in step 1a: never pulled.
compose.services["supabase-edge-functions"].pull_policy = "never";
writeFileSync(join(out, "docker-compose.yml"), stringify(compose));
' "$R"

# 2. What Coolify would generate, generated locally into the scratch .env.
JWT=$(openssl rand -hex 32)
{
  echo "SERVICE_PASSWORD_POSTGRES=$(openssl rand -hex 16)"
  echo "SERVICE_PASSWORD_JWT=$JWT"
  echo "SERVICE_PASSWORD_PGMETACRYPTO=$(openssl rand -hex 16)"
  echo "SERVICE_PASSWORD_64_PUBLISHABLEKEY=$(openssl rand -hex 32)"
  echo "SERVICE_PASSWORD_64_SECRETKEY=$(openssl rand -hex 32)"
  echo "SERVICE_PASSWORD_64_NOTIFYINVOKE=$(openssl rand -hex 32)"
  echo "SERVICE_PASSWORD_64_REMINDINVOKE=$(openssl rand -hex 32)"
  JWT=$JWT node -e '
    const c = require("node:crypto"), s = process.env.JWT, now = Math.floor(Date.now() / 1000);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = (role) => { const h = b({ alg: "HS256", typ: "JWT" }), p = b({ role, iss: "supabase", iat: now, exp: now + 86400 });
      return `${h}.${p}.${c.createHmac("sha256", s).update(`${h}.${p}`).digest("base64url")}`; };
    console.log(`SERVICE_SUPABASEANON_KEY=${t("anon")}`); console.log(`SERVICE_SUPABASESERVICE_KEY=${t("service_role")}`);'
  echo "SERVICE_URL_SUPABASEKONG=http://127.0.0.1:$KONG_PORT"
  echo "KONG_LOOPBACK_PORT=$KONG_PORT"
  # The operator inputs, staging's limits; placeholders replaced with local values.
  sed -e "s/^POSTGRES_LOOPBACK_PORT=.*/POSTGRES_LOOPBACK_PORT=$PG_PORT/" \
      -e "s/^STUDIO_LOOPBACK_PORT=.*/STUDIO_LOOPBACK_PORT=$STUDIO_PORT/" \
      -e 's#^SHIFT_APP_URL=.*#SHIFT_APP_URL=http://127.0.0.1:5173#' \
      -e 's#^SHIFT_FUNCTIONS_IMAGE=.*#SHIFT_FUNCTIONS_IMAGE=shift-functions:rehearsal#' \
      -e 's/<domain>/rehearsal.invalid/g' \
      -e 's/^RESEND_API_KEY=$/RESEND_API_KEY=re_rehearsal/' \
      -e 's/^SHIFT_DISABLE_SIGNUP=.*/SHIFT_DISABLE_SIGNUP=true/' \
      -e 's/^SHIFT_MAILER_AUTOCONFIRM=.*/SHIFT_MAILER_AUTOCONFIRM=true/' \
      -e 's#^SHIFT_PROXY_CIDR=.*#SHIFT_PROXY_CIDR=127.0.0.1/32#' \
      deploy/coolify/supabase/staging.env.example
} > "$R/.env"
# A real VAPID pair, written over the template's two empty lines.
VAPID=$(pnpm dlx web-push@3.6.7 generate-vapid-keys --json)
sed -i -e "s/^VAPID_PUBLIC_KEY=$/VAPID_PUBLIC_KEY=$(node -pe 'JSON.parse(process.argv[1]).publicKey' "$VAPID")/" \
       -e "s/^VAPID_PRIVATE_KEY=$/VAPID_PRIVATE_KEY=$(node -pe 'JSON.parse(process.argv[1]).privateKey' "$VAPID")/" \
       "$R/.env"
unset VAPID
set -a; . "$R/.env"; set +a

# 3. Order rule 1: Postgres, GoTrue, PostgREST and Storage first, until GoTrue
#    and Storage are healthy (their own schema migrations have then run).
#    GoTrue starts with a hook whose function does not exist yet; with no user
#    it signs nobody in, and step 5 restarts it.
$DC up -d --wait supabase-db supabase-auth supabase-rest supabase-storage

# 4. Every migration, from nothing.
# The stack's Postgres speaks no TLS; without `sslmode=disable` the CLI refuses it.
DB_URL="postgresql://postgres:$SERVICE_PASSWORD_POSTGRES@127.0.0.1:$PG_PORT/postgres?sslmode=disable"
pnpm exec supabase db push --db-url "$DB_URL" --yes
pnpm exec supabase migration list --db-url "$DB_URL"
$DC exec -T supabase-db psql -U postgres -At -c "
  select string_agg(extname, ',' order by extname) from pg_extension
   where extname in ('pg_cron', 'pg_net', 'supabase_vault');
  select vault.create_secret('rehearsal', 'rehearsal_probe') is not null;
  select count(*) from cron.job;
  select id from storage.buckets where id = 'organization-logos';"
# -> pg_cron,pg_net,supabase_vault / t / at least 1 / organization-logos   ✅

# 5. Order rule 2: GoTrue restarted now that the hook's function exists, then
#    Kong and the rest, the functions included, until all are healthy.
$DC restart supabase-auth
$DC up -d --wait supabase-auth supabase-kong
$DC up -d --wait

# 6. Provision an admin (§7.2's settings) in the rehearsal database. The
#    password goes in on stdin as a psql variable, never on a command line.
SLUG=rehearsal; ADMIN_USERNAME=admin
ADMIN_EMAIL="$ADMIN_USERNAME@$SLUG.shift.invalid"   # §7.2: <username>@<slug>.shift.invalid
read -rs ADMIN_PW   # 10 to 64 letters and digits: a throwaway, and safe to splice below
case "$ADMIN_PW" in *[!A-Za-z0-9]*|'') echo 'letters and digits only' >&2; exit 1 ;; esac
[ "${#ADMIN_PW}" -ge 10 ] || { echo 'at least 10 characters' >&2; exit 1; }
{
  printf '\\set pw %s\n' "$ADMIN_PW"
  cat <<SQL
select set_config('shift.organization_slug', '$SLUG', false),
       set_config('shift.organization_name', 'Rehearsal', false),
       set_config('shift.organization_type', 'Fire Department', false),
       set_config('shift.organization_timezone', 'Europe/Zagreb', false),
       set_config('shift.organization_locale', 'hr', false),
       set_config('shift.leave_year_start_month', '1', false),
       set_config('shift.leave_year_start_day', '1', false),
       set_config('shift.admin_name', 'Admin', false),
       set_config('shift.admin_username', '$ADMIN_USERNAME', false),
       set_config('shift.admin_password', :'pw', false),
       set_config('shift.admin_leave_allowance_days', '20', false);
SQL
  cat supabase/operator/provision-organization.sql
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -f -

# 7. The key probe and the sign-in, through Kong, with the OPAQUE keys only.
API="http://127.0.0.1:$KONG_PORT"
PUB="sb_publishable_$SERVICE_PASSWORD_64_PUBLISHABLEKEY"
SEC="sb_secret_$SERVICE_PASSWORD_64_SECRETKEY"
printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PW" \
  | curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $PUB" \
      -H 'content-type: application/json' --data-binary @- \
  | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const p = JSON.parse(s).access_token.split(".")[1];
      const c = JSON.parse(Buffer.from(p, "base64url").toString());
      console.log(c.role, c.organization_id); });'
# -> authenticated <the organization's uuid>   ✅ the hook runs
curl -s -w ' %{http_code}\n' -X POST "$API/auth/v1/signup" -H "apikey: $PUB" \
  -H 'content-type: application/json' -d "{\"email\":\"x@rehearsal.shift.invalid\",\"password\":\"$(openssl rand -hex 8)\"}"
# -> {} 200   ✅ Kong's one answer (story 19.1, §9.9); a synthesized address is
#                never relayed, so this creates nothing. Whether the door is shut
#                is the environment's and signup_settings', not this probe's.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/auth/v1/otp" -H "apikey: $PUB" -d '{}'
# -> 404   ✅ the allow-list (AD-22)
# supabase-js's shape: the key as apikey AND as a bearer token.
curl -s "$API/rest/v1/organizations?select=id" -H "apikey: $PUB" -H "Authorization: Bearer $PUB"
# -> []          ✅ mapped to anon. No migration revokes anon's SELECT on
#                   organizations, and every policy is `to authenticated` (§7.4),
#                   so anon reads zero rows. A 401 "JWT" error here means the
#                   mapping failed: Kong forwarded the opaque key itself.
# The secret key goes into a private config file, never onto a command line.
SEC_CFG=$(mktemp)
printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SEC" "$SEC" > "$SEC_CFG"
curl -s -K "$SEC_CFG" "$API/rest/v1/organizations?select=id"
rm -f "$SEC_CFG"
# -> one row     ✅ mapped to service_role
WRONG_KEY="sb_publishable_$(openssl rand -hex 16)"   # a well-formed key that is not ours
curl -s -o /dev/null -w '%{http_code}\n' "$API/rest/v1/organizations" -H "apikey: $WRONG_KEY"
# -> 401         ✅ an unknown key is refused at the gateway
curl -s -o /dev/null -w '%{http_code}\n' "$API/"
# -> 404         ✅ no catch-all, no Studio

# 7b. The functions, through Kong and the router (story 20.2, §9.6).
curl -s -w ' %{http_code}\n' -X POST "$API/functions/v1/notify"
# -> {"code":"INVOKE_SECRET_REFUSED"} 401   ✅ notify answers, no token
curl -s -w ' %{http_code}\n' -X POST "$API/functions/v1/admin-auth"
# -> {"code":"AUTHORIZATION_MISSING"} 401   ✅ refused by the router, before the handler
curl -s -w ' %{http_code}\n' "$API/functions/v1/nope"
# -> {"code":"FUNCTION_NOT_FOUND"} 404      ✅ only config.toml's functions exist
# An admin's session, accepted by GoTrue, reaches the handler. The token goes
# into a private config file, never onto a command line.
# (The login JSON is built by node, so a quote or backslash in the password
# cannot break it; no token, and the step stops here instead of probing with
# `Bearer undefined`.)
TOKEN=$(ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PW="$ADMIN_PW" \
    node -e 'process.stdout.write(JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PW }))' \
  | curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $PUB" \
      -H 'content-type: application/json' --data-binary @- \
  | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { let t; try { t = JSON.parse(s).access_token; } catch {} if (typeof t === "string" && t !== "") console.log(t); });')
[ -n "$TOKEN" ] || { echo 'FAIL  no admin session: check ADMIN_EMAIL and ADMIN_PW' >&2; false; }
TOKEN_CFG="$R/token.cfg"   # inside the scratch directory: the trap removes it
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" > "$TOKEN_CFG"
curl -s -w ' %{http_code}\n' -K "$TOKEN_CFG" -X POST "$API/functions/v1/admin-auth" \
  -H "Origin: $SHIFT_APP_URL" -H 'content-type: application/json' -d '{"operation":"resetPassword"}'
# -> {"code":"PAYLOAD_INVALID"} 400         ✅
rm -f "$TOKEN_CFG"; unset TOKEN
curl -s -D - -o /dev/null -X OPTIONS "$API/functions/v1/admin-auth" -H "Origin: $SHIFT_APP_URL" \
  -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'
# -> Access-Control-Allow-Origin: <the app's origin>   ✅ and never `*`
# The cron path: Vault's notify_url is the INTERNAL gateway, never the public
# origin. The invoke secret goes in on stdin as COPY data, never inside a
# statement (§3a, "A secret never enters a statement").
printf '%s' "$SERVICE_PASSWORD_64_NOTIFYINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
{
  echo "create temp table arming (value text not null) on commit drop;"
  echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
  printf '%s\n' "$SERVICE_PASSWORD_64_NOTIFYINVOKE"
  echo '\.'
  echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
  echo "delete from vault.secrets where name in ('notify_url', 'notify_invoke_secret');"
  echo "select vault.create_secret('http://supabase-kong:8000/functions/v1/notify', 'notify_url');"
  echo "select vault.create_secret((select value from arming), 'notify_invoke_secret');"
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
sleep 75   # the notify job runs every minute
$DC exec -T supabase-db psql -U postgres -At -c "
  select status_code from net._http_response order by id desc limit 1;
  select count(*) from notification_outbox where sent_at is null and failed_at is null;"
# -> 200 / 0     ✅ the job reached notify on the stack's network; the outbox is drained
$DC logs supabase-kong | grep -c 'functions/v1/notify'
# -> at least 1  ✅ the job's calls are in Kong's log
# Story 17.3: the reminder job, armed as §3b arms it, and its call proved once.
printf '%s' "$SERVICE_PASSWORD_64_REMINDINVOKE" | grep -Eqx '[A-Za-z0-9_-]{32,}' || { echo 'not an invoke secret: nothing sent' >&2; false; } &&
{
  echo "create temp table arming (value text not null) on commit drop;"
  echo "copy arming (value) from stdin with (format csv, delimiter E'\\x01', quote E'\\x02');"
  printf '%s\n' "$SERVICE_PASSWORD_64_REMINDINVOKE"
  echo '\.'
  echo "do \$\$ begin if (select count(*) from arming where value ~ '^[A-Za-z0-9_-]{32,}\$') <> 1 then raise exception 'ARMING_VALUE_INVALID'; end if; end \$\$;"
  echo "delete from vault.secrets where name in ('remind_url', 'remind_invoke_secret');"
  echo "select vault.create_secret('http://supabase-kong:8000/functions/v1/remind', 'remind_url');"
  echo "select vault.create_secret((select value from arming), 'remind_invoke_secret');"
} | $DC exec -T supabase-db psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f -
ID=$($DC exec -T supabase-db psql -U postgres -At -c "select private.invoke_remind();")
[ -n "$ID" ] || { echo "no request: Vault does not hold both remind secrets"; exit 1; }
sleep 10
$DC exec -T supabase-db psql -U postgres -At -c "
  select status_code, content, error_msg from net._http_response where id = $ID;"
# -> 200|{"code":"REMIND_RAN",…}   ✅ remind answered the cron's own call (401: the secrets drifted)
MARK="probe$(openssl rand -hex 8)"
curl -s -o /dev/null "$API/functions/v1/notify/$MARK?token=$MARK"
curl -s -o /dev/null "$API/storage/v1/object/sign/organization-logos/x.png?token=$MARK"
sleep 1; $DC logs supabase-kong | grep -c "$MARK" || true   # grep exits 1 on no match
# -> 0           ✅ neither a function's sub-path nor a query reaches the log (§9.6)

# 8. The trap tears down on exit, volumes included. Nothing of the development
#    stack was touched.
```

Record the result in story 20.5's spec, including step 7b (story 20.2's
end-to-end probe, `deferred-work.md`). If the `sb_` probe fails (401 or
`invalid JWT` with the opaque keys while the JWT keys work), stop: AD-17's other
branch (the stack's `anon`/`service_role` JWTs, with every shape guard decoding
the role claim) is then a founder-visible change, not a fix in place.

### 9.6 The functions: router, image and gateway (story 20.2)

On a hosted project the platform's gateway decided which function needed a
session. On our stack that is the **router**, `deploy/functions/main`: the
`edge-runtime` main service, platform plumbing and not an Edge Function
(AD-14 as amended). It:

- serves only the functions in its table, which a test holds equal to
  `supabase/config.toml`'s `[functions.*]` tables (`admin-auth`, `notify`).
  Any other name, an empty path, a percent-encoded name, or a path a URL
  parser would rewrite (a `.`/`..` segment, any `%2e`, a backslash) is
  `404 {"code":"FUNCTION_NOT_FOUND"}`: Kong forwards and logs the raw path, so
  a function runs only under the name Kong's access log records;
- for a function with `verify_jwt = true` (`admin-auth`), asks GoTrue
  `GET /user` with the caller's bearer token, **directly on the stack's
  network** (`SHIFT_AUTH_URL=http://supabase-auth:9999`). Not through Kong:
  Kong's auth route needs an `apikey`, and the router holds none. GoTrue's 200
  with a user (a JSON object with a string `id` and `aud`) forwards the
  request untouched; a 200 with anything else is not GoTrue's and is the 503
  below; no bearer token, or GoTrue refusing it, is
  `401 {"code":"AUTHORIZATION_MISSING"}` (the code the SPA already turns into
  "sign in again"); GoTrue down, slow (5 s), rate-limiting or unaddressed is
  `503 {"code":"AUTHORIZATION_UNVERIFIED"}`, never a pass and never a
  sign-out. **Stricter than the hosted gateway**, which let any validly
  signed JWT through, the anon key's included: here only a live user
  session passes, so a key alone never reaches `admin-auth` (whose every
  operation needs a session anyway). The check trusts the address: keep
  the resource's "Connect to Predefined Network" option off, so
  `supabase-auth` and `supabase-kong` resolve on this stack's own network
  only (20.5 checks it on the host);
- gives each function's worker only the variables its own handler reads:
  `admin-auth` never sees the Resend key, the invoke secret or the VAPID
  private key; `notify` never sees the publishable key;
- holds no key and no JWT signing secret, reads no table, and logs fixed codes
  only (`router: AUTHORIZATION_UNVERIFIED`, `router: FUNCTION_UNAVAILABLE`),
  never a URL, a header or a token.

`notify` (`verify_jwt = false`) is forwarded as it came: its own invoke secret
check answers the cron job, and anyone else gets
`401 {"code":"INVOKE_SECRET_REFUSED"}`. `calendar-feed` (`verify_jwt = false`,
story 16.4) is forwarded as it came too: the token in its path is the
credential, and its worker holds `SUPABASE_URL` and `SHIFT_PUBLISHABLE_KEY`
only. A function added later (v2's `remind`) is added to `config.toml`, the
router's table and the Dockerfile together, or the test fails.

**The image.** `deploy/functions/Dockerfile` builds `shift-functions` from the
repository root: base `supabase/edge-runtime:v1.74.3` (the CLI's pin), the
router, both functions, and each function **bundled at build time** into an
eszip with its npm dependencies inside (`edge-runtime bundle`).
`calendar-feed` bundles the built `dist` of `@shift/domain` and `@shift/ics`,
which the Dockerfile copies to `/home/packages/`, where its `deno.json` map
lands (story 16.4, AD-7): whatever builds the image runs
`pnpm --filter @shift/domain --filter @shift/ics build` first. The router
starts each worker from its bundle with remote modules disallowed, so a cold
start reads a local file and fetches nothing; a missing bundle is
`500 {"code":"FUNCTION_UNAVAILABLE"}`, never a fall-back to source. The image
holds code only: no key, no secret, no address. CI's `functions-image` job
builds it on every run (never pushed) and probes it on an `--internal`
network beside a stand-in GoTrue (`scripts/ci/probe-functions-image.sh`):
every worker starts from its bundle, `admin-auth`'s handler answers
`PAYLOAD_INVALID`, and `calendar-feed` answers an unknown and a malformed
token with one identical `404 FEED_NOT_FOUND` and the pinned vector (served
by a stand-in RPC) with a calendar. The staging deploy job builds and probes it the same way
and pushes that very image to GHCR (story 20.6, §8.1). The compose names it
per environment as `SHIFT_FUNCTIONS_IMAGE`, set once to the channel tag
`ghcr.io/<owner>/shift-functions:<environment>`, which the pipeline moves to
each release's probed digest; `pull_policy: always` makes every start pull
it. Its healthcheck is a TCP connect to the
main service with the image's own `bash`; the router answers no health path.

**CORS.** Kong's functions route answers CORS for `SHIFT_APP_URL` alone (no
credentials, `GET`/`POST`/`OPTIONS`): Kong answers the preflight itself, and
every reply, the router's refusals included, names the app's origin, never
`*`. Kong refuses to start if `SHIFT_APP_URL` is not a plain `http(s)` origin
with no path (a character outside `[A-Za-z0-9.:/-]` would make Kong read it as
a regex). The handlers keep their own `SHIFT_ALLOWED_ORIGINS` check.

**The access log (NFR-27).** Kong writes its access log in the format
`shift_redacted`, from the `log-redaction.conf` bind
(`KONG_NGINX_HTTP_INCLUDE`): a function's path is logged up to its name and
`[redacted]` after it (so `calendar-feed/<token>` never reaches a log), every
other query string is `?[redacted]` (Storage's signed URLs carry `?token=`),
and the referer is not logged. Two logs this file cannot redact, both checked
on the host by story 20.5 (`deferred-work.md`):

- **Kong's error log** prints the request line when an upstream fails
  (`request: "GET /functions/v1/...`). Story 16.4 set `KONG_LOG_LEVEL=crit`,
  so no `error` or `warn` line is written: every lesser gateway diagnostic is
  given up with it, and outages are seen through the uptime check (20.8).
  To diagnose a gateway failure before 20.8 exists, raise the level on the
  host for the session only (`KONG_LOG_LEVEL=error`, redeploy), set it back
  to `crit`, and delete what was written meanwhile: those lines may hold a
  feed token. 20.5 still searches the host's Kong and functions logs for
  `calendar-feed/`.
- **Traefik's access log** is Coolify's proxy, off by default. Keep it off; if
  it is ever turned on, drop the request path and query fields.

**Cron.** Vault's `notify_url` on a self-hosted stack is
`http://supabase-kong:8000/functions/v1/notify`, the internal gateway: the
scheduled call never leaves the host (§9.4, §9.5 step 7b). So is
`remind_url`, `http://supabase-kong:8000/functions/v1/remind`, armed only
after the `notify` that renders reminders is live (§3b, story 17.3).

### 9.7 The SPA: the `shift-web` image (story 20.3)

On Cloudflare Pages, `_redirects` gave the SPA fallback and `_headers` the
security headers. Self-hosted, nothing reads either file, so the SPA ships as
its own image, `shift-web` (`deploy/web/Dockerfile`), and serves both itself.
It is a static server and nothing more (AD-14): no application code, no
proxying, no key.

**The base.** `nginxinc/nginx-unprivileged:1.30.6-alpine3.24`, pinned by tag
and index digest: F5's nginx built to run as uid 101, listening on 8080, with
its pid and temp files in `/tmp`. The image's config and files are owned by
root and not writable by uid 101 (the base leaves `/etc/nginx` to uid 101),
`server_tokens` is off, and `nginx -t` checks the config at build; the server
then runs as uid 101. It listens on IPv4 only: a container without IPv6
cannot bind `[::]`.

**The headers.** One file holds every security header: the BUILT
`apps/web/dist/_headers`, whose `/*` block is `public/_headers`
(`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
`Permissions-Policy` and `Strict-Transport-Security: max-age=31536000;
includeSubDomains`, no preload) plus the build's CSP line. At image build,
`deploy/web/render-headers.sh` (POSIX sh and awk, run in the base's busybox)
turns each header into `add_header <Name> "<value>" always;`, value unchanged,
and every nginx location includes the result, so every response, errors
included, carries every header. The script refuses, and the image build fails,
on a block other than `/*` or a second `/*` block, a `!` detach, a header
named twice, a header nginx sets itself or that frames the response
(`Cache-Control`, `Content-Type`, `Content-Length`, `Server`, `Date`, `ETag`,
`Last-Modified`, `Vary`, `Content-Encoding`, `Accept-Ranges`, `Content-Range`,
`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Location`, `Expires`), or a value holding `"`, `$`, `\`, a control character or
a non-ASCII character. Nothing else in the image sets a security header.

**The CSP.** The Vite build (`vite.config.ts`, from
`apps/web/src/lib/content-security-policy.ts`) derives it from the same
`VITE_SUPABASE_URL` the bundle is built with, and the SHA-256 of each inline
script of the built `index.html` (the theme pre-script), so it cannot drift
from either:

```text
default-src 'self'; script-src 'self' 'sha256-<inline script>';
style-src 'self' 'unsafe-inline'; img-src 'self' <supabase origin>;
connect-src 'self' <supabase origin>; font-src 'self'; worker-src 'self';
manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none';
frame-src 'none'; frame-ancestors 'none'
```

It ships as **`Content-Security-Policy`, enforcing, since story 20.5.** 20.3
shipped it Report-Only. 20.5 swept the SPA in Chromium (signed in, every main
screen, the PDF and Excel exports, a logo upload and its signed-URL display,
the service worker's registration): on its rehearsal stack, then on staging
over HTTPS, Report-Only and then enforced, with no violation and no failed
request (its spec, Verification). A push opt-in on a real device, the PWA
install and an update through *Osvježi* are checked by hand on staging
(`deferred-work.md`). Going back is setting `CSP_HEADER` to
`Content-Security-Policy-Report-Only` (and its three pins in the tests), then
rebuilding and redeploying every environment's image. There is no `report-uri`
(no endpoint receives reports). A `VITE_SUPABASE_URL` that
is not an `http(s)` URL with a plain host fails the build; an empty one (CI's
`build` job) gives the policy with no Supabase origin. Styles keep
`'unsafe-inline'`: `index.html` has inline `<style>` blocks and a `style=`
attribute, and React writes `style` attributes.

**Routing and caching** (`deploy/web/default.conf`):

| Request | Answer |
| --- | --- |
| `/`, a deep link (`/kalendar/2026-09`), any unknown path outside `/assets/` | `200 index.html`, `Cache-Control: no-cache` |
| `/sw.js`, `/push-sw.js`, `/site.webmanifest` (`application/manifest+json`), the icons | `200`, `no-cache`: revalidated on every use, so a deploy is seen at once |
| `/assets/<hashed>` | `200`, `public, max-age=31536000, immutable` (on a success only) |
| a missing `/assets/…` file, and `/assets/` itself | a plain-text `404`, never `index.html`, never immutable |
| any `*.map` | `404` |

A missing root file such as `/sw.js` keeps answering the shell with 200, as
Cloudflare Pages did: the fallback rule is the same for every path outside
`/assets/` (parity, a reviewed decision), with one exception: a missing
`/site.webmanifest` is a plain-text 404, never the shell under the manifest's
type (every build emits it).

**No source map** is in the image: `.dockerignore` keeps the web build's maps
(`apps/web/dist/**/*.map`) out of the build context, and the build fails if
one is left. `_headers` and `_redirects` are not copied in either. The build
also fails if `dist/_headers` has no Content-Security-Policy line (a stale or
pre-plugin `dist`).

**Build and probe.** CI's `web-image` job builds the image from the `build`
job's `dist` (never pushed) and probes it with `--network none` and a
read-only root (`scripts/ci/probe-web-image.sh`): the table above, every
header of that `dist/_headers` exactly once with its exact value on every
answer (the 404s, a `POST`'s 405, a `HEAD`, a revalidation's 304 and the 400
nginx gives an oversized header before choosing a location included), gzip on
the entry chunk the page names, uid 101, no map, no file outside `/tmp`
writable by uid 101, the image's own `HEALTHCHECK` command, and
`render-headers.sh`'s refusals under the image's busybox. The image's
`HEALTHCHECK` fetches `/` with its own busybox `wget` every 30 s.
That `dist` is built with no environment's `VITE_*`, so
it proves the image only. The deploy job (story 20.6, §8.1) builds `shift-web`
per environment from that environment's own build (its `VITE_SUPABASE_URL`,
so its CSP names its own API origin), probes it the same way, pushes that
image as `ghcr.io/<owner>/shift-web:<environment>-<sha>`, moves
`:<environment>` to its digest and has Coolify deploy it; Coolify never builds
from Git.

**In Coolify** (story 20.5): a Docker-image resource per environment, image
`ghcr.io/<owner>/shift-web` with the tag `<environment>` (the channel tag the
pipeline moves; never a digest or a commit tag, except during a rollback,
§8.7), port 8080, the domain `https://app.<domain>`. Traefik terminates TLS (Let's
Encrypt) and redirects HTTP to HTTPS; a browser honours HSTS only from an
HTTPS answer, so the first visit over HTTPS pins the host for a year.
Run it with a read-only root and a tmpfs on `/tmp` if Coolify allows it; it
needs no other writable path.

### 9.8 The host: closed to everything but the web (story 20.4)

**Applied and confirmed by the founder (2026-11-23):** only 80 and 443 are
public; the Coolify UI and API and SSH are reached over the tailnet only. The
steps below are how it was, and is again, applied.

After it, the only services the internet reaches are 80/tcp, 443/tcp and
443/udp, over IPv4 and IPv6. The host also still answers ICMP, receives its
DHCP replies, and accepts Tailscale's WireGuard UDP port (which answers only
to tailnet peers). SSH, the Coolify UI and API (and its realtime and terminal
ports), Studio and Postgres are reached over the tailnet only.

| Component | What `shift-host.sh apply <component>` does | Decision |
| --- | --- | --- |
| `firewall` | Loads two chains of its own, `SHIFT-INPUT` and `SHIFT-DOCKER-USER`, for IPv4 and IPv6 (`deploy/host/firewall/shift-v4.rules`, `shift-v6.rules`), and puts one jump to each at position 1 of `INPUT` and `DOCKER-USER` (tailscaled may later put its own `ts-*` jumps above it; they only admit tailnet traffic, so the check ignores them). Docker's chains and the rules already in `DOCKER-USER` (the development stack's drop) are left as they are. Installs `shift-host-firewall.service`, which reloads the CONFIRMED rules after Docker starts | H-2, H-3, H-4 |
| `sshd` | Installs `/etc/ssh/sshd_config.d/00-shift-hardening.conf` (key only, `PermitRootLogin prohibit-password`), checks it with `sshd -t` and `sshd -T`, reloads sshd; refuses if root's `authorized_keys` holds no key | H-4 |
| `swap` | A 4 GiB `/swapfile`, in `/etc/fstab`, and `vm.swappiness = 10` (`/etc/sysctl.d/99-shift-swap.conf`) | H-15 |
| `upgrades` | Keeps unattended security upgrades on, sets `Unattended-Upgrade::Automatic-Reboot "false"`, and holds Docker Engine and containerd back from unattended upgrades (`/etc/apt/apt.conf.d/52shift-unattended-upgrades`) | H-10 |
| `coolify` | Sets Coolify's `is_auto_update_enabled` to false (the field the UI's Settings > Auto Update writes) and pins `AUTOUPDATE=false` in Coolify's own `/data/coolify/source/.env`, which its init and its upgrade script read | H-10 |

**The rules, in words.** On the public interface (`PUBLIC_IF`, usually
`eth0`; the script refuses one that does not carry the default route), a new
connection is admitted only to 80/tcp, 443/tcp or 443/udp, whether it goes to
a container (`SHIFT-DOCKER-USER`, judged by the connection's ORIGINAL
destination port, because `DOCKER-USER` sees packets after Docker's DNAT) or
to the host itself (`SHIFT-INPUT`, which also admits ICMP, DHCP replies and
Tailscale's UDP port). Everything else new from the public interface is
dropped, on both families: a port Docker publishes on `[::]` through its
userland proxy reaches `INPUT`, not `FORWARD`. SSH is admitted only from `lo`,
the tailnet interface and Coolify's own Docker network (bridge and subnets
read from `docker network inspect coolify`): Coolify reaches its own host over
SSH from there, so a rule that admitted only the tailnet would cut Coolify off
its server. Traffic arriving on the tailnet is not filtered here; the
Tailscale ACL decides who reaches what (H-5). Any OTHER interface with an
address (a provider's private network, say) is filtered for SSH only, and
`plan` names it. Admitted packets `RETURN` rather than `ACCEPT`, so nothing
that was dropped before is admitted now.

**Docker Engine 28 or later.** Before 28, a port published on `127.0.0.1`
(Postgres and Studio, §9.1) was reachable from other hosts on the same L2
segment. `SHIFT-DOCKER-USER` drops forwarded traffic from the public interface
whose original destination is `127.0.0.0/8` or `::1` whatever the version, and
`plan` warns below 28; upgrade in the maintenance window if it does.

**What the host firewall does not reach.** Traffic between containers of one
stack never crosses the public interface. postgres-meta answering `/query`
without authentication to its stack's network, and `pg_net` being executable
by `anon` and `authenticated`, are therefore not closed here: the network
split is story 20.5's, the `REVOKE` a migration story of its own
(`deferred-work.md`).

#### Applying it (the founder, from the provider's console)

`shift-host.sh` with no mode is `plan`: it changes nothing and prints what it
would run. It exits 3 when something would change and 0 when nothing would.
`apply` needs the components named.

Applying `firewall` or `sshd` FIRST records what is there and arms two ways
back, so a step that fails half-way is still undone:

- a transient timer that runs `revert` after `REVERT_AFTER` seconds (300 by
  default) unless `confirm` runs;
- `shift-host-revert-at-boot.service`, which runs the same `revert` if the
  host reboots before `confirm`.

`revert` goes back to the last CONFIRMED state: the confirmed firewall if
there was one (otherwise no `SHIFT-*` rules at all), and the sshd drop-in
exactly as it was. `confirm` checks first that the live rules equal the
applied ones and that `sshd -T` shows the hardened values; only then does it
keep them, and enable the boot unit that reloads them.

```bash
# 0. On the host, as root, on the PROVIDER'S CONSOLE (not SSH: apply refuses a
#    session with sshd among its ancestors for firewall and sshd, unless
#    --allow-ssh-session is given; tmux or screen hide that, so do not use
#    them, and Tailscale SSH counts as SSH). Check out exactly the commit the security-review approved.
git clone <this repository's clone URL> /root/shift
cd /root/shift
git checkout --detach <the reviewed commit>
git rev-parse HEAD                                  # -> the reviewed commit

# 1. Re-inspect the host before changing anything (proposal §1.3). Note what
#    listens, the current rules, sshd's effective values and the interfaces.
#    Keep the notes off the repository: it is public.
ss -ltnup
iptables -S; ip6tables -S
sshd -T | grep -E '^(port|passwordauthentication|permitrootlogin|kbdinteractiveauthentication) '
ls /etc/ssh/sshd_config.d/
ip -br addr; ip route show default; ip -6 route show default
docker version --format '{{.Server.Version}}'      # 28 or later
docker network inspect coolify --format '{{.Driver}} {{json .IPAM.Config}}'
grep -c . /root/.ssh/authorized_keys                # at least one key, Coolify's included

# 2. The host's values, from step 1, in a file outside the checkout.
install -m 0600 deploy/host/host.env.example /root/host.env
"${EDITOR:-nano}" /root/host.env                    # PUBLIC_IF, SSH_PORT, TAILSCALE_IF, ...

# 3. Read the rules exactly as they will be loaded, and the plan.
deploy/host/shift-host.sh render --env /root/host.env
deploy/host/shift-host.sh plan --env /root/host.env

# 4. Firewall and sshd together, under the revert.
deploy/host/shift-host.sh apply firewall sshd --env /root/host.env
# -> A revert is armed: in 300s, or at the next boot, the change is undone unless confirmed.

# 5. Within the window, from a NEW session on a tailnet device (keep the
#    console open):
#    - ssh root@<the host's tailnet name>        by key; a password is refused
#    - the Coolify UI at http://<tailnet name>:<Coolify's port>
#    - Coolify > Servers > localhost > Validate Server   ✅ (SSH from its bridge)
#    - https://app.<domain> and https://api.<domain> answer, once they exist
#    All good: confirm, on the console.
/usr/local/sbin/shift-host confirm
#    Anything wrong: do nothing and the timer reverts, or revert now.
/usr/local/sbin/shift-host revert

# 6. The rest. No timer: none of these can cut access.
deploy/host/shift-host.sh apply swap upgrades coolify --env /root/host.env

# 7. Everything in force. The installed copy plans from the confirmed files.
/usr/local/sbin/shift-host plan                     # -> Nothing to change. (exit 0)
/usr/local/sbin/shift-host status
```

Then, **from a machine outside the host** (not routed through it), as root,
with nmap:

```bash
sudo deploy/host/verify-exposure.sh --ipv4 <public IPv4> --ipv6 <public IPv6> \
  --tailnet-host <the host's tailnet name> --coolify-port <Coolify's port> \
  --studio-url <Studio's tailscale-serve URL> --postgres-port <its tailscale-serve port> \
  --tailscale-udp-port <host.env's TAILSCALE_UDP_PORT, if not 41641>
# -> PASS  IPv4 ...: only 80 and 443 answer on TCP
# -> PASS  IPv4 ...: of the UDP ports probed (...), none answers but 443 (and Tailscale's)
# -> PASS  IPv6 ... (the same two)
# -> PASS  SSH over the tailnet offers publickey only (a password is refused)
# -> PASS  SSH by key works / Coolify UI / Studio / Postgres answer over the tailnet
```

A provider's own firewall in front of the host makes this scan green
whatever the host's rules say: scan with it open (or absent), so the scan
judges the host. The script runs as root, so the tailnet SSH checks use
root's keys and `known_hosts` on the scanning machine.

A full TCP scan of each address must find exactly 80 and 443. The UDP half
probes common ports only, and a silent UDP service reads like a dropped port;
for UDP, the rules (`render`) are the proof. If the
scanning machine has no IPv6 route, the IPv6 lines FAIL: scan from one that
has. **Studio and Postgres** exist on the tailnet only once story 20.5 has
stood a stack up: before that, run without `--studio-url` and
`--postgres-port`, and run the full command again as part of 20.5; the epic's
"Studio and Postgres answer over the tailnet" is proved then. Run the scan
again after the first reboot in the maintenance window, to prove the boot
unit.

**Locked out?** The console still works whatever the firewall says. Before
`confirm`: `/usr/local/sbin/shift-host revert` there, or reboot (the
revert-at-boot unit undoes both the firewall and the sshd change). After
`confirm`, `revert` with nothing pending refuses; `revert --all` removes the
whole hardening, firewall and sshd drop-in. A revert that fails keeps the
change pending, so run it again (or reboot) until it reports success. A later re-apply (with a new `--env` file) goes through the
same `apply`, check, `confirm`; left unconfirmed, it reverts to the last
confirmed state.

#### The monthly maintenance window (H-10, H-15)

Proposed, to be ratified with H-10: **the first Saturday of each month,
07:00–09:00 Europe/Zagreb**, outside the hours the pilot's teams plan in.
Nothing reboots or upgrades itself outside it: unattended upgrades install
security fixes but never reboot and never touch Docker Engine or containerd,
and Coolify does not update itself. In the window:

1. A manual backup of each production database (story 20.7's procedure).
2. `apt update && apt full-upgrade`, Docker Engine included; reboot if
   `/var/run/reboot-required` exists.
3. Coolify, by hand, after reading its release notes, from its UI. Then
   `shift-host plan firewall`: if the upgrade recreated Coolify's network
   (a new bridge or subnet), `systemctl restart shift-host-firewall` loads
   the rules for it, or Validate Server fails until the next reboot.
4. After the reboot: `shift-host status` shows both chains and
   `shift-host-firewall.service` active; `shift-host plan` says nothing to
   change; `verify-exposure.sh` passes from outside; `free -h` shows the swap.

### 9.9 The signup door (story 19.1)

Self-service signup (epic 19) is open on a stack only while **three switches**
are all open, and each is shut by default (AD-21). This section is the
operator's side of them, of Kong's anti-enumeration allow-list (AD-22) and of
the Auth email GoTrue sends. Production stays shut: opening it is the
founder's decision at D-S5, after the security review in
`SECURITY-REVIEW-EPIC-19.md` (section H gives the order).

1. **GoTrue's environment.** `SHIFT_DISABLE_SIGNUP` and
   `SHIFT_MAILER_AUTOCONFIRM`, both `true` unless set. `staging.env.example`
   sets both `false`; `production.env.example` keeps both `true`.
2. **The database.** `private.signup_settings` (migration `0066`), one row,
   `open = false` when created. No session role holds any privilege on it, so
   the operator opens and closes it over the tailnet with the Postgres
   password, never through the API:

   ```sql
   update private.signup_settings set open = true where id;   -- open
   update private.signup_settings set open = false where id;  -- the circuit breaker
   select * from private.signup_settings;                     -- the ceilings
   ```

   Closing it stops new accounts at once (the before-user-created hook
   refuses every one), and from 19.3 new organizations too. It does NOT stop
   mail to addresses that already exist: a resend or a recovery for an
   unconfirmed or a confirmed account, or a repeat signup of a known address,
   still reaches GoTrue and spends the Resend budget. Shutting mail is the
   GoTrue environment (`SHIFT_DISABLE_SIGNUP=true`, and removing
   `GOTRUE_SMTP_PASS`), then a restart of the auth resource. The ceilings
   (`accounts_per_day` 100, `organizations_per_day` 20,
   `attempts_per_account` 10) are changed the same way.
3. **The SPA.** `VITE_SIGNUP_ENABLED` renders the signup screens
   (`/registracija`, *Prijava*'s link to it, `/zaboravljena-lozinka`; story
   19.2). It is a cosmetic switch, not a control: `require-config.mjs` refuses
   it for production, so production's deploy fails if the variable is set on
   that environment to anything but `false`. The deploy action's build reads
   it only from its `signup-enabled` input, which each deploy job passes from
   the same `vars.VITE_SIGNUP_ENABLED`, and refuses it again for production.
   Set it to `true` on the `staging` environment when staging opens. Vite
   inlines it at build time, so a change takes effect only with the next
   deploy's build, opening or shutting alike; the GoTrue and SQL switches act
   at once.

**Production relays `/recover` to a GoTrue with no SMTP key.** Kong's mail
routes are the same on every stack. On production no email identity exists,
so nothing is sent and nothing is lost: GoTrue's failure is logged by Kong as
`AUTH_MAIL_RELAY recover <status>`.

**GoTrue will not start a half-built open door.** Its entrypoint is a wrapper
in the compose (`/usr/local/etc/auth-entrypoint.sh`). It refuses any boolean
that is not exactly `true` or `false`, and with `GOTRUE_DISABLE_SIGNUP=false`
it exits, naming the guard, unless autoconfirm is off, GoTrue's SMTP host,
user, key and sender are set, the before-user-created hook is on, the
client-address header is set, the OTP is 3600 s or less and 10 characters
long, and each template URL answers 200 over HTTPS with a `token_hash` link.
Whenever `GOTRUE_SMTP_PASS` is set, even with the door shut, the OTP and the
templates are checked too. A refused start shows in `supabase-auth`'s log as
`auth-entrypoint: …`; fix the named value in Coolify and restart the resource.

**GoTrue's start is coupled to the app origin.** With the door open or a key
set, GoTrue fetches its three templates from `SHIFT_APP_URL` at start, so the
web resource (`shift-web`) must answer them. The wrapper tries each fetch 6
times, 5 s apart; after that it refuses, and Coolify restarts GoTrue, which
tries again. After a host reboot sign-in waits on the web resource, never
loops forever on it. If the web resource is down for long, sign-in is down
with it: bring the web resource back first. `shift-web` serves
`/auth-email/<name>.html` as itself and anything else under `/auth-email/` as
a plain 404, never the SPA's `index.html`.

**Auth email** goes over SMTP through Resend (AD-17 as amended):

- `GOTRUE_SMTP_PASS` is **GoTrue's own** Resend key: create one per stack in
  Resend, sending-only and restricted to the sending domain, and set it in
  Coolify on the stack's environment beside the compose. It is never
  `notify`'s `RESEND_API_KEY`, never a GitHub secret, never in this
  repository. Revoking one key leaves the other path working. A shut stack
  (production) may leave it empty.
- `SHIFT_AUTH_EMAIL_FROM` is the sender address, on the verified domain.
- The templates are built from `hr.json`'s `signup.email` keys into the SPA's
  `dist/auth-email/` (confirmation, recovery, email change) and served from
  the app origin; GoTrue fetches them from `SHIFT_APP_URL`. Their subjects are
  in the compose. Each link is `/potvrda?token_hash=…&type=…` (story 19.2),
  which verifies only when the person presses *Potvrdi* or *Spremi novu
  lozinku*. Locally the CLI sends the same templates, committed under
  `supabase/templates/auth-email/` (`node scripts/auth-email-templates.mjs`
  rewrites them after a copy change), into its mail catcher.
- `SHIFT_AUTH_EMAIL_PER_HOUR` (10 on staging) caps GoTrue's mail for the whole
  stack; Resend's daily allowance is shared with `notify` (checklist A9).

**The client's address (AD-21).** `SHIFT_PROXY_CIDR` is the network from which
Coolify's Traefik reaches Kong, as CIDRs: the stack's OWN Docker network, which
Coolify names after the service's uuid and attaches its Traefik to. Read it on
the host after the first start with `docker network inspect <service uuid>`
(the subnet of its IPAM config), set it in Coolify, never here, and restart the
service. (Story 20.5 first set the `coolify` network's subnets, as this text
then said, and Kong logged Traefik's address on the stack's network for every
client.) Kong believes `X-Forwarded-For` from those peers alone
(`KONG_TRUSTED_IPS`; it refuses an empty value, any `/0`, and a network wider
than an IPv4 /8 or an IPv6 /32), sends GoTrue the
resolved client as `X-Real-IP`, overwriting a client's own, and GoTrue's
per-IP limits read it (`GOTRUE_RATE_LIMIT_HEADER`). Story 20.5 confirms on the
host, for IPv4 and IPv6, that Kong's access log shows each client's own
address, not Docker's gateway.

**Kong's limits** are per client address (`rate-limiting`, `policy: local`),
each an operator input defaulting to staging's value: the mail routes (signup,
recover and resend together) 5 an hour and 20 a day, `/auth/v1/token` 60 a
minute and 1440 an hour, `/auth/v1/verify` 15 a minute and 360 an hour, and
`rpc/create_organization` 10 an hour. Kong 2.8 has no 5-minute window, so
AD-21's per-5-minute figures became these (the spine records it); the
per-minute windows allow bursts up to 2.5 times AD-21's 5-minute figures, and
only the hourly ceilings hold its rate (accepted for staging, revisited at
D-S5). A limit
answers Kong's own 429, the same for every address. Production's values are
set by the D-S5 checklist.

**Kong's `/auth/v1/` is an allow-list (AD-22).** `signup`, `recover` and
`resend` (POST), `token`, `verify` (POST only), `user` (GET, PUT), `logout`,
`health`, `.well-known/jwks.json` and `admin/*` (the secret key alone). Every
other path, and any other spelling of these (a doubled `/`, `%75`, a trailing
`/`, `;`, upper case), is Kong's 404. The mail routes answer `200 {}` at once,
whatever the body, and relay to GoTrue in the background only an email
identity's address, rebuilt from the route's own fields; a relay GoTrue
refuses is logged by Kong as `AUTH_MAIL_RELAY <route> <status>`, never with
the address (or `UNREAD` when Kong could not read the body), so a masked
outage still shows in its log. `verify` passes only `{token_hash, type}` with a
hex hash; a `PUT /user` naming `email` or `phone` is 422. Each route's spelling
check, and the REST catch-all's refusal of any other spelling of
`create_organization`, runs before every other plugin, so a variant is 404
with or without a key. The admin API takes GET, POST, PUT and DELETE with the secret key alone,
and refuses a doubled `/`, `;`, `%` or a dot segment. Kong
adds no `Server`, `Via` or latency header (`KONG_HEADERS=off`).

**Opening staging** (done 2026-11-25, §9.11 *Email and the open door*), once
story 20.5 stands it up and 19.2 has shipped the screens: set the inputs above in Coolify (`SHIFT_DISABLE_SIGNUP=false`,
`SHIFT_MAILER_AUTOCONFIRM=false`, `GOTRUE_SMTP_PASS`, `SHIFT_AUTH_EMAIL_FROM`,
`SHIFT_PROXY_CIDR`), push migrations (`0066` before GoTrue restarts, §9.4),
redeploy, check `supabase-auth`'s log shows no `auth-entrypoint:` refusal,
then open `signup_settings` by SQL. Closing is the reverse: the SQL first
(immediate), then the environment.

**The enumeration probe (story 19.2, checklist B1, B2, B5, B8).** On 20.1's
rehearsal stack (§9.5) and then on staging, run
`scripts/probe/signup-enumeration.mjs` from the operator's machine with
`SHIFT_PROBE_API` (the stack's API origin), `SHIFT_PROBE_KEY` (its publishable
key), `SHIFT_PROBE_KNOWN_CONFIRMED` and `SHIFT_PROBE_KNOWN_UNCONFIRMED` (two
test accounts' addresses) and `SHIFT_PROBE_NEW_DOMAIN` (a domain whose mail the
operator receives) in the environment. A full run sends more mail requests
than Kong's per-address limit allows, so raise `SHIFT_LIMIT_MAIL_HOUR` and
`SHIFT_LIMIT_MAIL_DAY` for the window, redeploy, run, and restore them. It
exits 0 only when every mail route gives one status, body and header set and
the medians sit inside one timing class (50 ms), and when the password grant
answers an unknown address and a wrong password alike; it reports the grant's
timing difference for the founder (B8). It prints no address. Never run it
against the CLI's Kong. It leaves one unconfirmed account per sample (each
counts against `accounts_per_day`) and sends real mail; afterwards, over the
tailnet, `delete from auth.users where email like 'probe-%@' || '<SHIFT_PROBE_NEW_DOMAIN>'
and email_confirmed_at is null and not exists (select 1 from public.members m where
m.auth_user_id = auth.users.id);`, with the run's own domain written in, removes
them and no stranger's pending signup.

What staging's first run (2026-11-25) taught. Against Resend's test inboxes the
new addresses must be `delivered+probe-<uuid>@resend.dev` (a bare
`probe-<uuid>@resend.dev` is a real address at Resend, not a test inbox), so
the run used a copy whose only change is that prefix. GoTrue's own
`GOTRUE_RATE_LIMIT_EMAIL_SENT` (10 an hour for the stack) runs out within the
first round, after which a `new` signup is rolled back (GoTrue's 429): the
probe still measures Kong's answers, which is its point, but creates no
account and sends little mail. Raising Kong's mail limit for the window lets
about a hundred relays reach GoTrue within a few seconds, and at 0.1 CPU it fell
behind: for about 35 s it answered the relays 504 and 500 (database and DNS
dial timeouts in its log) and recovered by itself, with no restart. Run the
probe when nobody else is using staging. Those failures show in GoTrue's log
only: Kong runs at `KONG_LOG_LEVEL=crit`, so its `AUTH_MAIL_RELAY` lines
(`ngx.ERR`) are not written at all, and a masked mail outage does NOT show in
Kong's log as this section says above (`deferred-work.md`). Kong's limit is per client address, so one address
cannot do this at staging's real values (5 an hour).

**A dump carries the switch.** A staging dump holds
`signup_settings.open = true`. Production restores only from production's own
dumps (story 20.7), never from staging's.

### 9.10 Housekeeping, suspension and the abuse report (story 19.5)

The operator's side of AD-25. Everything here is SQL run as `postgres` with the
database password, **over the tailnet only** (the stack's Postgres as
`tailscale serve` publishes it on the server's tailnet host, §8.2's `DB_HOST`),
never through the API: no session role may call any of it. Run `psql` with
`-v ON_ERROR_STOP=1`, so a refusal (`ORGANIZATION_UNKNOWN`) exits non-zero.
Locally, run the same files with `supabase db query --local -f <file>`, the
slug passed the same way (`PGOPTIONS="-c shift.organization_slug=<slug>"`).

**The `housekeeping` job** (migration `0073`) is pg_cron's, daily at 03:15
UTC, clear of the nightly backup. It calls
`private.delete_abandoned_accounts()`, which deletes an `auth.users` row only
when all of these hold, read again under the row's lock:

- its address is an email identity's: a username account (`…@….shift.invalid`)
  is **never** deleted, whatever its age, and neither is one with no readable
  address;
- it is not banned now (a banned abuser's account and its evidence stay);
- no `members` row names it, in any organization;
- no organization was founded by it (`founded_by`);
- it is unconfirmed, and both created and last sent a confirmation link more
  than 7 days ago (a repeat signup re-sends the link), or it was confirmed
  more than 30 days ago (D-S7).

An account inside `create_organization`, or one a member insert is naming at
that moment, is skipped and tried again the next night; so is one whose delete
fails for any other reason, logged as `HOUSEKEEPING_SKIPPED <id> <sqlstate>`
and counted as `failed`, without undoing the rest. GoTrue's identities,
sessions and tokens go with the account. The job also deletes
`private.organization_attempts` rows older than 30 days. It deletes no
organization and no domain row: revoked calendar links stay as the removals
they are.

**The circuit breaker.** Before deleting anything the job counts its
candidates. The before-user-created hook admits at most `accounts_per_day`
memberless accounts a day, so a normal night has at most two days' arrivals.
If the count is above **seven times `accounts_per_day`** (700 by default), the
job deletes nothing and fails with `HOUSEKEEPING_HALTED` (`<n> candidates,
ceiling <m>` in its detail). `cron.job_run_details` then shows `failed` with
that message. A count that high means the rule is reading something wrong, for
example a `members` table emptied or half restored, so find the cause first.
To clear a real backlog once it is understood, run the job by hand with a
higher ceiling for that session only:

```sql
set shift.housekeeping_ceiling = 2000;
select private.delete_abandoned_accounts();
```

During a restore from backup (20.7, §9.12), pause the job first
(`select cron.alter_job((select jobid from cron.job where jobname = 'housekeeping'), active => false);`)
and re-enable it (`active => true`) once the restored data has been checked.

**What a run leaves.** The function answers its counts,
`{"unconfirmed_accounts": …, "confirmed_accounts": …,
"organization_attempts": …, "failed": …}`, and raises them as a `LOG` line
(`HOUSEKEEPING {…}`), with a `WARNING` (`HOUSEKEEPING_SKIPPED <id> <sqlstate>`)
for each account it skipped. The self-hosted stack's Postgres runs with
`log_min_messages=fatal` (`deploy/coolify/supabase/docker-compose.yml`), so
those lines **do not reach the container's log there**. pg_cron's
`cron.job_run_details` records only whether the statement succeeded, so a
nightly run's counts are not kept anywhere. Since story 20.8 the host's jobs
check (§9.13) alerts on a failed run (a halt included) and on a job that
stopped running; a durable record of the counts, and so an alert on
`failed > 0`, still needs a migration (`deferred-work.md`). To see the
counts, run the job by hand: it answers them. To check that it runs:

```sql
select jobname, schedule, command, active from cron.job where jobname = 'housekeeping';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'housekeeping')
 order by start_time desc limit 7;
```

Running it by hand (`select private.delete_abandoned_accounts();`) answers the
same counts. The e2e signup accounts a reused local stack accumulates go the
same way after 7 days.

**Suspending an organization** (FR-101). Only the operator does this; no
screen offers it.

```bash
PGOPTIONS="-c shift.organization_slug=<slug>" \
  psql -v ON_ERROR_STOP=1 "<the stack's database URL over the tailnet>" -f supabase/operator/suspend-organization.sql
```

From the commit on, the organization's members read and write nothing, a
sign-in or a token refresh is refused (they see *Prijava*'s one refusal
message, the same as a deactivated account's), every member's calendar link
answers the feed's one 404, and no reminder or notification is written or
sent; queued notifications settle `ORGANIZATION_SUSPENDED` (a push `notify`
had already claimed settles `RECIPIENT_INACTIVE`, and an email it had already
claimed may still go out). A token already
issued keeps its claim until it expires, but reads nothing. A device's offline
copy stays readable on that device until it lapses or signs out, and cannot
sync or write. Nothing is deleted. `unsuspend-organization.sql`, run the same
way, restores it as it was; notifications settled meanwhile are not sent
again. Both refuse an unknown slug (`ORGANIZATION_UNKNOWN`) or none
(`ORGANIZATION_SLUG_MISSING`), and say so when there was nothing to change.
Each leaves one entry in the organization's change history with no field
shown.

**The abuse report.** `signup-report.sql` reads and writes nothing:

```bash
psql -v ON_ERROR_STOP=1 "<the stack's database URL over the tailnet>" -At -f supabase/operator/signup-report.sql
```

It prints one JSON document: the switch and its ceilings; the last 24 hours'
accounts with no member (counted exactly as the hook counts its ceiling) against `accounts_per_day` and
signup-founded organizations against `organizations_per_day` (checklist A10's
alert: either near its ceiling is the signal); the 50 newest email-identity
accounts of the last 7 days; accounts per day by confirmation state and
organizations founded per day for 30 days, beside the ceilings (the job has
already removed what it deletes, so a day older than a week shows what
remains, not what arrived); every
organization founded by signup (slug, name, created, suspended, members); and
the 20 accounts with the most `create_organization` attempts. Its output holds
addresses: keep it on the operator's machine, never in an issue, a pull
request or this repository.

**The runbook, when abuse appears.**

1. Close the door: `update private.signup_settings set open = false where
   id;` (§9.9). This stops new accounts and organizations at once. One actor
   filling the ceilings shuts signup for everyone anyway (A10).
2. Run the report.
3. Suspend each organization the report shows to be abusive, by slug.
4. Leave the abandoned accounts to the job, or run it by hand. An account
   that founded an organization is never deleted by it; the organization is
   suspended instead. To keep an abusive account and its attempts as evidence,
   ban it, over the same tailnet connection:
   `update auth.users set banned_until = now() + interval '10 years' where id = '<id>';`.
   GoTrue refuses a banned account's sign-in and refresh, and the job never
   deletes a banned account.
5. Reopen the door once the cause is understood, and record what happened in
   the security review (A10).

**Opening production (D-S5)** follows section H of
`_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md`,
in its order, and nothing else does:

1. The security review of 19.1–19.5 is done against sections A to G, each row
   with its evidence, and nothing is open at high severity.
2. The limits are verified on the production stack's own configuration: its
   Kong limits, its GoTrue limits and its `signup_settings`.
3. The Resend plan's volume is checked against the D-S3 ceiling plus
   `notify`'s (D-S4).
4. Backups (20.7) and monitoring (20.8) run on production, and this job
   appears in `cron.job` there.
5. The second-factor decision for email identities, founder decision F1 (B2's
   timing, if Kong cannot relay) and A10 are recorded.
6. Production restores only from production's own dumps.
7. **The founder says go.** Then a reviewed PR lets production build with
   `VITE_SIGNUP_ENABLED`, the operator sets production's GoTrue environment
   and restarts auth, and last opens `signup_settings` by SQL. Closing is the
   reverse order.

### 9.11 Staging on Coolify (story 20.5)

Staging is the first stack on the server. It is stood up through the Coolify
API from the host, not by the pipeline: 20.6's deploy stays inert until the
founder enables it (a Tailscale OAuth client for CI, a deploy-scoped token, a
registry credential). **The repository holds no address, hostname, port or
secret of it**; the operator reads them in Coolify.

**Status (2026-11-23): running.** The stack and the web application run on
Let's Encrypt certificates; the migrations, Vault and the demo organization are
in place, and §9.5's checks and story 20.5's pass on staging (its spec,
Verification). Starting the service and deploying the application need the
Coolify token's `deploy` ability (a read/write token is refused with 403).
**Refreshed 2026-11-24** to `main`'s compose (the `calendar-feed` limit), with
migrations `0075` and `0076` pushed after a `pre-migration` backup (§9.12), a
new `shift-web` image, both invoke secrets rotated (below) and Kong's upstream
keep-alive shortened (below).
**Moved to its own domain and opened 2026-11-25** (founder decisions of that
day): the app and the API answer on `staging.<domain>` and
`api.staging.<domain>` with Let's Encrypt certificates, Auth email goes through
Resend, `notify` holds a real key, and the signup door is OPEN on staging only
(§9.9; production stays shut). See *Moving staging to another domain* and
*Email and the open door* below.
**Refreshed again 2026-11-25** to `main` (stories 21.1-21.3 and the *Smjenko*
brand, 21.24): a `pre-migration` backup (§9.12), then `main`'s compose by
`PATCH` (only GoTrue's sender name and subjects changed; every `content:` file
already matched, so no storage update), migration `0077` pushed and
`check-migrations` clean, a new functions image (probed with
`probe-functions-image.sh`) and a new `shift-web` (same inputs, signup on),
the service restarted, then GoTrue alone restarted once the new `shift-web`
was live, so it fetched the new templates (order rule: the templates come from
the app origin at start). The checks below, the CSP sweep and
`shift-ops jobs-check staging` passed.
**Refreshed 2026-11-26** to `main` (job roles, *Raspored osobe* and member
schedule versions, the *Ručni raspored* grid, the compact toolbar, personal
shifts, schedule sources and the holiday rule; the landing app is NOT deployed,
it waits for its DNS and email): a `pre-migration` backup (§9.12); `main`'s
compose unchanged since the last refresh and every `content:` file matching
the one Coolify wrote, so no `PATCH` and no storage update; migrations `0078`
and `0079` pushed over the loopback and `check-migrations` clean (79 agree); a
new functions image (probed with `probe-functions-image.sh`) and a new
`shift-web` (same inputs, signup on; `check-bundle.mjs` and
`probe-web-image.sh` passed), the web application deployed first and the
service restarted after it, so GoTrue fetched the templates from the live
`shift-web` (no separate GoTrue restart needed). The checks below passed. The
CSP sweep now also visits `/rucni-raspored` and opens (never saves) a member's
*Raspored osobe* dialog, and opens the history page's *Izvoz* menu before
*Izvezi u PDF* (the compact toolbar moved it there); no violation, no failed
request. Both demo organizations sign in; `dvd-mladost`'s verifier reports the
one known mismatch (a test member the founder added by hand, kept).
`shift-ops jobs-check staging` passed.

**What exists in Coolify.** A project `shift` with an environment `staging`
(the founder's choice; the epic had named a project `shift-staging`), holding:

- the **compose service** (`deploy/coolify/supabase/docker-compose.yml`, pasted
  through the API as `docker_compose_raw`, never edited in Coolify), with Kong's
  URL `https://api.staging.<domain>:8000` (`:8000` is the container port
  Traefik forwards to; the public API origin, and so `VITE_SUPABASE_URL`, is
  `https://api.staging.<domain>` with no port). Coolify generates every
  `SERVICE_PASSWORD_*` (and the role JWTs, see below), but its API never
  returns their values to a token without `read:sensitive`, so H-6's check
  (none empty, none a demo value of Supabase's `.env.example`) reads them on
  the host from the containers' environment; on staging every one passed;
- the **`shift-web` application** (Docker image, port 8080, the domain
  `https://staging.<domain>`, HTTPS forced, `--read-only --tmpfs /tmp`,
  64 MiB, 0.1 CPU).

`<domain>` is the founder's domain since 2026-11-25 (DNS-only A records to the
server's public IPv4; no AAAA, so the public names are IPv4 only). Until then
staging ran on `sslip.io` names of the server's IPv4; those routes are retired
(an old name now gets Coolify's generic 503 page, like any unknown host).
Production's names (`app.<domain>`, `api.<domain>`) are reserved for 20.9 and
configured nowhere yet.

**The operator's inputs** are `staging.env.example`'s, with these differences
(decided 2026-11-23, updated 2026-11-25):

| Input | Staging today | Why |
| --- | --- | --- |
| `SHIFT_DISABLE_SIGNUP`, `SHIFT_MAILER_AUTOCONFIRM` | `false`, `false` (the door OPEN, since 2026-11-25) | `staging.env.example`'s values; GoTrue's wrapper started with every guard met (§9.9) |
| `GOTRUE_SMTP_PASS` | a sending-only Resend key restricted to the sending domain | Auth email (§9.9) |
| `SHIFT_AUTH_EMAIL_FROM` | `noreply@mail.<domain>` (Resend's verified sending subdomain, EU region) | GoTrue's display name is the compose's `Smjenko` (`GOTRUE_SMTP_SENDER_NAME`, story 21.24; `Shift` before it) |
| `RESEND_API_KEY` | **the same** sending-only key as `GOTRUE_SMTP_PASS` | the founder issued one staging key; §9.9's "never notify's key" (revoking one leaves the other path working) is not met on staging, and production needs two (`deferred-work.md`) |
| `NOTIFY_EMAIL_FROM` | `Smjenko <noreply@mail.<domain>>` (the product's name since story 21.24) | on the verified sending domain |
| `VAPID_*` | a pair generated for staging; the subject is the app's `https` origin | push works |
| `SHIFT_FUNCTIONS_IMAGE` | `127.0.0.1:<registry-port>/shift-functions:staging` | see the registry below |
| `SHIFT_PROXY_CIDR` | the stack's own network's subnet (`docker network inspect <service uuid>`; IPv4 only, as Coolify creates it) | §9.9: Traefik reaches Kong there. Kong logs each client's own IPv4 and IPv6 address, and a client's own `X-Forwarded-For` is not believed |

**Images without GHCR: a loopback registry.** The compose's
`pull_policy: always` makes every start pull `SHIFT_FUNCTIONS_IMAGE`, and
Coolify pulls a Docker-image application's image too, so a tag that exists only
in the host's Docker cannot be used. Until 20.6 pushes to GHCR, the images are
built on the host from the branch's commit and pushed to a `registry:2.8.3`
container (`shift-staging-registry`, restart `unless-stopped`, its images on
the named volume `shift-staging-registry`) published on `127.0.0.1` only, which
Docker trusts over plain HTTP. It has no authentication: anything on the host
that can reach the loopback could push an image staging would pull, which on a
single-tenant host is everyone who is already root. It is retired when 20.6's
pipeline is enabled (`deferred-work.md`). `shift-web` is built for staging's API origin and
publishable key (§9.7), checked with `scripts/ci/check-bundle.mjs`, and its maps
deleted, as the pipeline does. The loopback registry is not a production path:
20.9 uses GHCR through 20.6.

**Postgres and the migrations.** Postgres and Studio publish on two loopback
ports (`POSTGRES_LOOPBACK_PORT`, `STUDIO_LOOPBACK_PORT`). The migrations are
pushed over that loopback from the host, in §9.4's order, with
`?sslmode=disable` in the URL (the stack's Postgres speaks no TLS; over the
tailnet the encryption is WireGuard's, and CI's URLs carry the same parameter,
unverified over the tailnet until `tailscale serve` exists).
**Publishing them on the tailnet with `tailscale serve --tcp` is the founder's
step** (a change to what the tailnet exposes), and after it 20.4's
`verify-exposure.sh` runs again with `--studio-url` and `--postgres-port`.

**Vault** gets `notify_url` and `remind_url` on the internal gateway
(`http://supabase-kong:8000/functions/v1/…`) and both invoke secrets, read from
the functions container's environment and given to `psql` on stdin (§3a, §3b).
Each secret goes in as the one data row of a `COPY` into a temporary table,
checked in the shell first, so it never enters a statement (§3a, *A secret
never enters a statement*; founder decision 2026-11-23). Staging was first
armed before that rule, with the value interpolated into the statement by psql,
so both invoke secrets were rotated once on 2026-11-24 with §3a's and §3b's
rotation blocks (new values set as `SERVICE_PASSWORD_64_NOTIFYINVOKE` and
`SERVICE_PASSWORD_64_REMINDINVOKE` through `PATCH /services/<uuid>/envs/bulk`,
then the service restarted; `notify` and `remind` answered the cron 200).
The blocks were then run again in sessions with `log_statement = all` and
`log_min_messages = error`, once succeeding and once failing
(`ARMING_SECRET_MISSING`): the database log held every statement and the
error, and no value. The log of the first arming could not be searched: a
Coolify restart recreates the containers, and their logs go with them
(search a container's log BEFORE restarting it).

**The demo organization** (§7.5, `demo_target=staging`) is seeded with `psql`
inside the database container (validated on the rehearsal stack: 17 members,
and the admin signs in with an `organization_id` claim), the password passed as
a psql variable on stdin. The founder then signs in at `https://staging.<domain>/prijava/dvd-demo` as
`admin`; the password is in a 0600 file on the host, never in the repository.

**Changing the compose of a running stack.** `PATCH /services/<uuid>` with a
new `docker_compose_raw` re-renders the compose, but **not** a `content:` file
Coolify already wrote (`kong.yml`, the entrypoints, `log-redaction.conf`): its
parser keeps the content it stored for a file it knows (v4.7.6), so the old
file stays and nothing says so. On the 2026-11-24 refresh the new
`calendar-feed` route was missing from Kong after the PATCH and a restart.
For each `content:` file the change touches, compare the compose's content
with the file under `/data/coolify/services/<uuid>/` and send the new content
with `PATCH /services/<uuid>/storages` (`{"type": "file", "uuid": <the file
storage's uuid, from GET …/storages>, "content": …}`; it needs `deploy`, and
Coolify writes the file at once), then restart the service (or, for Kong
alone, the Kong container: its entrypoint renders `kong.yml` at start).
Check the running container (`grep -c functions-v1-calendar-feed
/usr/local/kong/kong.yml`) before calling a change applied.

**Kong lets go of an idle upstream connection first.** PostgREST closes an
idle keep-alive connection after 30 to 60 s (31.5 s measured), and Kong 2.8
kept one for 60 s: a request Kong sent on a connection PostgREST closed that
instant was answered 502, and a POST is not retried. That was the first
jobs check's `notify` 500 `CLAIM_FAILED` and `remind` 503
`REMINDER_INPUTS_UNAVAILABLE` (Kong logged `502` on `/rest/v1/rpc/…` in
0.002 to 0.16 s; PostgREST and Postgres logged nothing, and the database was
not busy: not the 0.25 CPU). `KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT=20` makes
Kong close first (seen on staging: Kong's side of an idle connection to
PostgREST goes to `TIME-WAIT` at about 20 s).

**Coolify's API, as found on v4.7.6.** `POST /projects`, `POST
/projects/<uuid>/environments`, `POST /services` (`docker_compose_raw` base64,
`urls` for Kong's domain, `instant_deploy: false`), `PATCH
/services/<uuid>/envs/bulk`, `PATCH /services/<uuid>` (a new compose) and
`POST /applications/dockerimage` need the token's `write` ability.
**Starting the service (`POST /services/<uuid>/start`, `/restart`) and
deploying an application (`POST /deploy?uuid=<uuid>&force=false`; a GET is
refused as "This endpoint has changed to a POST request") need `deploy`**, which a read/write token does
not have. Coolify's parser records each `${NAME:?}` it finds in an
`environment:` entry as a required variable, but not the ones in `image:` or
`ports:` (`SHIFT_FUNCTIONS_IMAGE`, the two loopback ports), which must be set
by hand all the same. A description may hold only letters, digits, spaces and
`- _ . , ! ? ( ) ' " + = * / @ &`.

**Magic variables are generated in file order, once.** Coolify v4.7.6 walks the
compose service by service and creates each magic variable the first time it
sees it, never regenerating one it created empty. It signs
`SERVICE_SUPABASEANON_KEY` and `SERVICE_SUPABASESERVICE_KEY` with
`SERVICE_PASSWORD_JWT` only if that already exists. Kong (which uses the role
JWTs and must not hold the secret) used to come before GoTrue, so on staging's
first start both role JWTs were created EMPTY and Kong refused to start
(`kong-entrypoint: SUPABASE_ANON_KEY is empty`). The compose now lists Kong
after GoTrue, PostgREST and Storage, and a test holds the order. On staging the
two values were then minted on the host exactly as Coolify mints them (HS256
with the stack's own secret, `iss supabase`, the role claim) and set through
`PATCH /services/<uuid>/envs/bulk`, never printed. A new stack created from
today's compose gets them from Coolify.

**Backups.** Coolify's API lists volume backups for a service's storages
(`/services/<uuid>/storages/<uuid>/backups`) and no database backup for a
service's Postgres. 20.7 therefore backs the stack up from the host with its
own `pg_dump` (§9.12), whatever the UI offers.

**Roles that read every row (16.4's host check).** On the self-hosted image a
role that is a superuser, bypasses RLS or holds `pg_read_all_data` can read
`calendar_feed_tokens.token_hash`. The image creates: `postgres` and
`supabase_admin` (they log in, with the stack's Postgres password),
`supabase_etl_admin` and `supabase_read_only_user` (they may log in but have
NO password, so nobody can), `service_role` (no login; reached only through
Kong's secret-key mapping) and `pg_read_all_data` itself (no login). The only
credential among them is the Postgres password, held by the stack's services
and reached on the loopback (and on the tailnet once it is served) only. No
statement reaches a log with its arguments: Postgres runs with
`log_min_messages=fatal` (and `log_statement=ddl`, `pgaudit.log=none`), and
PostgREST at its default `error` level.

**The `calendar-feed` limit** (120 a minute per client IP, founder decision
2026-11-23) is in force since the 2026-11-24 refresh: 130 feed requests from one
address inside a minute were answered 120 × 404 and 10 × 429, while 130
`notify` and 30 `admin-auth` requests in the same minute all got their 401s;
Kong logged the client's own address for each.

**Moving staging to another domain** (done once, 2026-11-25, from the
`sslip.io` names). The order matters because GoTrue fetches its templates from
the app origin at start (§9.9):

1. Build `shift-web` for the new API origin (`VITE_SUPABASE_URL=https://api.staging.<domain>`,
   which also writes the CSP's `connect-src` and `img-src`), check it with
   `scripts/ci/check-bundle.mjs` and `scripts/ci/probe-web-image.sh`, delete
   its maps, push it to the loopback registry.
2. `PATCH /applications/<web uuid>` with `{"domains": "https://staging.<domain>"}`
   and deploy it (`POST /deploy?uuid=…`). Coolify's Traefik issues the Let's
   Encrypt certificate for the new name; the old name's route goes with the
   old domain.
3. `PATCH /services/<uuid>` with `{"urls": [{"name": "supabase-kong", "url":
   "https://api.staging.<domain>:8000"}]}`: Coolify regenerates
   `SERVICE_URL_SUPABASEKONG*` (so `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`,
   `STORAGE_PUBLIC_URL`) and Kong's Traefik labels. Then
   `PATCH /services/<uuid>/envs/bulk` with `SHIFT_APP_URL` (GoTrue's site URL,
   redirect allow-list and template URLs, Kong's CORS origin, the functions'
   allowed origin) and `VAPID_SUBJECT`, and restart the service.
4. No `content:` file names an origin (Kong renders `kong.yml` from
   `SHIFT_APP_URL` at start), so the storages need no update; check with
   `grep -rl <old name> /data/coolify/services/<uuid>/`, which should find
   only `.env` and the rendered compose before the restart, and nothing after.
5. Check every container's environment for the old name (none), both
   certificates (Let's Encrypt), `http://` → `https://` (302), the old names
   (Coolify's 503 page), then the checks below and the CSP sweep.

**Email and the open door (2026-11-25).** Set as §9.9's *Opening staging* says:
`GOTRUE_SMTP_PASS`, `SHIFT_AUTH_EMAIL_FROM`, `RESEND_API_KEY`,
`NOTIFY_EMAIL_FROM`, `SHIFT_DISABLE_SIGNUP=false`,
`SHIFT_MAILER_AUTOCONFIRM=false` through `envs/bulk`, the service restarted,
`supabase-auth` up with no `auth-entrypoint:` line and no restart (so every
guard held, the three template fetches from the new origin included), then
`update private.signup_settings set open = true where id;`. `shift-web` is built
with `VITE_SIGNUP_ENABLED=true` (the third switch). No staging member has an
email address, so `notify` mails nobody until someone adds one. Epic 19's
retro A2 checks ran the same day, against Resend's test inboxes only
(`delivered@resend.dev` with `+` labels, `bounced@resend.dev`); their results
are in that retro's *A2 progress*. Closing is §9.9's reverse: the SQL first.

**Not set on staging, by decision.** Nothing of the email path now; the second
Resend key (above) is open. Backups and monitoring arrived with 20.7 and 20.8
(§9.12, §9.13).

### 9.12 Backups and the restore drill (story 20.7)

(§9.11, staging on Coolify, is story 20.5's.) Coolify cannot schedule a
backup of a Postgres that lives inside a compose service (20.5 found only
volume backups in its API), so each stack is backed up by the host itself:
`deploy/host/shift-ops.sh`, installed as `/usr/local/sbin/shift-ops`, run by
`shift-backup@<env>.timer`. **This is the interim (H-11 undecided):** the sets
stay on the host, and the founder's computer pulls them over the tailnet. The
off-host bucket is a second step, built but off.

**What a set holds.** Every night at 01:30 Europe/Zagreb (`Persistent=true`:
a night the host was down is caught up at boot; not H-12's 02:30, which does
not exist on the spring-forward night, and systemd then skips the run:
`systemd-analyze calendar` showed it), one directory
`/var/backups/shift/<env>/daily/<UTC time>/` (root, 0700; files 0600):

| File | What | Why |
| --- | --- | --- |
| `db.dump` | `pg_dump -Fc` of the `postgres` database as `supabase_admin`, by the database container's own `pg_dump` (the stack's pinned image), under a 50-minute `timeout` inside the container | the data; custom format, read back with `pg_restore -l` before the set counts |
| `roles.sql` | `pg_dumpall --roles-only --no-role-passwords` | `pg_dump` holds no role, and a fresh image lacks some (`supabase_functions_admin`). **No password** is in it: a new stack sets its own at init |
| `supabase-db-config.tar.gz` | the `<uuid>_supabase-db-config` volume | **pgsodium's root key**, which Vault's secrets are encrypted under: the same night's dump and key, together |
| `supabase-storage-data.tar.gz` | the `<uuid>_supabase-storage-data` volume | the uploaded logos |
| `row-counts.tsv` | rows per table, counted from the dump itself | what the drill compares against |
| `MANIFEST`, `SHA256SUMS` | the environment, the database image (its tag and its exact id), the latest migration, tables, rows; a checksum of every file | the drill refuses a set that does not match |

Reading the dump back and counting its rows run in a throwaway container of
the same image with no network, never in the stack's database container: the
live database does only the `pg_dump`.

The database's own volume is not copied: a file copy of a running cluster is
inconsistent, and the dump is its copy. Coolify's `APP_KEY` is never in a set
(it decrypts Coolify's own data; its copy is the founder's password manager,
H-8). **A set is as secret as the database**: it holds every member's data
and Vault's key. A set is written as `.partial-<name>` and renamed only when
complete, so an interrupted night never counts and never makes retention
delete a good set; the next run removes what an interrupted one left (a
timeout, an OOM kill, a reboot). A run refuses to start on a disk 95 % full.

**Kept:** 7 daily; the Sunday set (Europe/Zagreb) also as a weekly one (hard
links, no second copy; 4 kept), and any daily set when the newest weekly one
is a week old (a missed Sunday); 5 manual. A backup waits up to 30 minutes
for a running drill. Everything the tool does is
read-only towards the stack: `docker exec` of `pg_dump`, `pg_dumpall`,
`pg_restore` and read-only `psql`, and `tar` of the volumes' mount points.
Nothing stops or restarts a stack container.

**Install it** (root, on the host, from a checkout of `main`):

```bash
install -d -m 0700 /etc/shift-ops
cp deploy/host/ops.env.example /etc/shift-ops/<env>.env && chmod 0600 /etc/shift-ops/<env>.env
# Set SERVICE_UUID to the stack's Coolify service id (the suffix of its
# container names: `docker ps --format '{{.Names}}' | grep supabase-db-`).
deploy/host/shift-ops.sh install <env>       # the tool, the units, both timers
shift-ops config <env>                       # the effective settings
shift-ops backup <env>                       # one set now
shift-ops list <env>                         # the sets, and the last drill
systemctl list-timers 'shift-*'
```

`install --no-jobs-check` installs the backup timer alone. To remove:
`systemctl disable --now shift-backup@<env>.timer shift-jobs-check@<env>.timer`.
A failed night runs `shift-alert@` (§9.13), and the jobs check fails when the
newest daily set is older than 26 hours, so a timer that stopped is noticed.

**Before a production migration** (§8.2 step 6): `shift-ops backup production
--manual pre-migration` writes `manual/<UTC time>-pre-migration/` and prints
the line to set, `PRE_MIGRATION_BACKUP_AT=<YYYY-MM-DDTHH:MMZ>`. The deploy job cannot take it itself:
the tailnet ACL admits `tag:ci` to Postgres and the Coolify API only, and a
dump on the runner would leave personal data on GitHub's machines outside the
EU. Automating it means a forced-command SSH key for `tag:ci`, the founder's
decision (`deferred-work.md`).

#### The nightly pull to the founder's computer (the interim off-host copy)

The host holds no credential for this copy: the founder's computer pulls, so a
compromised host cannot delete it. Over the tailnet, with the host's OpenSSH
(port 22 is admitted only from the tailnet, §9.8), and a key that can only
read the backups:

```bash
# On the founder's computer, once: a key for this only (no passphrase, so the
# schedule can use it; it can read the backups and nothing else).
ssh-keygen -t ed25519 -f ~/.ssh/shift-backup-pull -C shift-backup-pull -N ''
```

On the host, one line in `/root/.ssh/authorized_keys` (`rrsync` ships with
Ubuntu's rsync), restricted to reading `/var/backups/shift`:

```text
command="/usr/bin/rrsync -ro /var/backups/shift",restrict ssh-ed25519 AAAA… shift-backup-pull
```

Then, on the founder's computer (its disk encrypted: FileVault, BitLocker or
LUKS, so the copy is encrypted at rest):

```bash
rsync -a -e "ssh -i ~/.ssh/shift-backup-pull" root@<the host's tailnet name>:staging/ ~/ShiftBackups/staging/
```

Paths are relative to `/var/backups/shift`. 20.4's sshd drop-in allows it
(`PermitRootLogin prohibit-password`: root by key only). Not Tailscale SSH: it
ignores `authorized_keys`, and with it the restriction. The key reads every
set, production's included: keep it only on that computer, and replace it
(a new line, the old one removed) if the computer is lost or once a year. Schedule it daily after
03:00 Europe/Zagreb (cron, or a launchd agent on macOS), and prune the
computer's copy by hand: it keeps whatever the host has pruned.

#### The off-host bucket (H-11): off until a credential exists

When the founder has decided H-11 (default: Backblaze B2, EU Central, the
bucket's default encryption on), a second step copies every new set to the
bucket after the local one is complete. The host only ever **adds**
(`rclone copy --immutable`): give it a key **without** `deleteFiles`, scoped
to the one bucket, and let the bucket's lifecycle rule keep 30 days. A
failed copy fails the run (and alerts); the local set stays.

```bash
# rclone: a pinned release from rclone.org, not the distribution's older one.
install -m 0600 /dev/null /etc/shift-ops/rclone.conf
cat >/etc/shift-ops/rclone.conf <<'EOF'
[shift-offsite]
type = b2
account = <the application key's id>
key = <the application key>
hard_delete = false
EOF
# Then in /etc/shift-ops/<env>.env, instead of OFFSITE=off:
#   OFFSITE=rclone
#   RCLONE_REMOTE=shift-offsite:<bucket>/<env>
shift-ops backup <env>     # proves it once
```

Nothing of this exists on the host until the founder turns it on.

#### The restore drill

```bash
shift-ops drill <env>                                     # the newest daily set
shift-ops drill <env> /var/backups/shift/<env>/weekly/<set>
```

It never touches a stack. It checks the set's `SHA256SUMS` and that both
archives read back, creates a volume
and a container of its own (`shift-drill-<env>-<time>`, the set's database
image, `--network none`, pg_cron told not to launch the restored jobs, a
throwaway password from an env file), restores the set's db-config into the
volume before the first start, applies `roles.sql`, runs `pg_restore --clean
--if-exists --exit-on-error`, and then requires:

- every table's row count equal to the dump's (`row-counts.tsv`, and the dump
  read again);
- every Vault secret to decrypt with the restored key (counted, never read
  out).

The container and the volume are removed however it ends. The result (a
failure with its reason) and its duration go to
`/var/backups/shift/<env>/drills.log`. It uses the set's exact image when the
host still has it, and says so when it does not. Run it before go-live
and then quarterly (H-12), and after any change to this tool.

This drill restores the database alone. 20.9's pre-go-live drill restores the
**off-host** copy into a full throwaway stack and signs the smoke account in
(`deferred-work.md`).

#### Restoring a stack for real

The order matters; time it against H-12's RTO (4 h on the same host, 1
working day on a new host).

1. **A new stack**, if the old one is gone: §9.11's way, from the same
   compose. Before its **first** start, create its db-config volume
   (`docker volume create <new uuid>_supabase-db-config`) and untar the set's
   `supabase-db-config.tar.gz` into its mount point (`tar --numeric-owner
   -xzf …`): Vault then decrypts with the key it was written under. Without
   it, re-create the Vault secrets afterwards (§3a, §3b).
2. **Only Postgres running.** Stop every other container of the stack, so
   nothing writes while the data is replaced. **Then stop pg_cron from running
   jobs** before any job row comes back with the data (the restored
   `housekeeping` could delete accounts, and `notify`/`remind` resend):
   `alter system set cron.launch_active_jobs = off; select pg_reload_conf();`
3. Roles, then the data, as `supabase_admin` inside the database container:

   ```bash
   docker exec -i supabase-db-<uuid> psql -X -U supabase_admin -d postgres -q < roles.sql   # "already exists" is expected
   docker exec -i supabase-db-<uuid> pg_restore -U supabase_admin -d postgres --clean --if-exists --exit-on-error < db.dump
   ```

4. **Pause `housekeeping`** (§9.10), then let pg_cron run the other jobs again:
   `select cron.alter_job((select jobid from cron.job where jobname = 'housekeeping'), active => false);`
   `alter system reset cron.launch_active_jobs; select pg_reload_conf();`
5. The storage volume: while Storage is stopped, empty
   `<uuid>_supabase-storage-data` and untar `supabase-storage-data.tar.gz`
   into it.
6. Start the stack (§9.4's order rules hold: the access-token hook's function
   exists, so GoTrue can start). Check Vault
   (`select count(*), count(decrypted_secret) from vault.decrypted_secrets;`,
   equal), `notify` and `remind` answering the cron (§3a, §3b), and a
   sign-in. A new stack has a new JWT secret, so every member signs in again.
7. Re-enable `housekeeping` once the data has been checked.
8. Record the time taken.

### 9.13 When Shift is down: monitoring (story 20.8)

H-13's fallback without a new provider, until the founder creates an
UptimeRobot account: two watchers, one outside the host and one on it.

**Outside: `.github/workflows/uptime.yml`, every 30 minutes** (at :07 and
:37; GitHub may start a scheduled run late). For each configured environment
it checks, each retried once after 20 seconds:

| Check | Request | Up when |
| --- | --- | --- |
| `app` | `GET https://<app>/` | 200 with the SPA shell (`<div id="root">`) |
| `auth` | `GET https://<api>/auth/v1/health`, the publishable key as `apikey` (Kong wants one) | 200 |
| `notify` | `POST https://<api>/functions/v1/notify`, no credential | 401 `INVOKE_SECRET_REFUSED`: Kong, edge-runtime and the router all answered. This is also what watches the gateway now that Kong logs at `crit` |

A failure fails the run (an `::error::` per check) and opens the issue
**"Uptime: <environment> is down"**, or updates the open one (a comment when
the set of failing checks changes, the body otherwise). When every check
passes again, it comments "Recovered" and closes it. GitHub e-mails the
founder for a new issue and a comment when they watch the repository, and for
a failed scheduled run (to whoever last changed the workflow's schedule).

**The repository is public, and so are its run logs and issues.** The
origins and the key are therefore repository **secrets**, not variables: a
step's environment, variables included, is printed in its public log, while
secrets are masked. The script masks every origin, host and key again, and
writes only the environment, the check, a status code, a known error code or
an error class (`ECONNREFUSED`, `TIMEOUT`) to the log and the issue.

To turn it on (GitHub → Settings → Secrets and variables → Actions):

| Kind | Name | Value |
| --- | --- | --- |
| secret | `UPTIME_STAGING_APP_URL` | `https://staging.<domain>` (an origin, no path) |
| secret | `UPTIME_STAGING_API_URL` | `https://api.staging.<domain>` |
| secret | `UPTIME_STAGING_PUBLISHABLE_KEY` | staging's publishable key (public by design, kept masked) |
| secret | `UPTIME_PRODUCTION_APP_URL`, `…_API_URL`, `…_PUBLISHABLE_KEY` | the same three for production, from 20.9 |
| variable | `UPTIME_ENABLED` | `true` |

An environment with one or two of its three secrets set fails the run (a
half-configured environment would go unwatched); one with none is skipped;
enabled with none at all, the run fails. Run it once by hand (Actions →
Uptime → Run workflow) after setting them. GitHub disables a schedule after
60 days without activity in the repository: re-enable it in the Actions tab.

**Within 10 minutes (NFR-34) needs UptimeRobot**, H-13's default: its free
plan checks every 5 minutes. When the founder has an account, add three
monitors with the same three checks (the `notify` one a keyword monitor on
`INVOKE_SECRET_REFUSED`, POST, expecting 401; the `auth` one with the
`apikey` header), alerting to the founder's e-mail, and keep this workflow as
the second opinion.

**On the host: `shift-jobs-check@<env>.timer`, every 15 minutes**
(installed with the backup, §9.12; read-only, every query in a read-only
transaction). `shift-ops jobs-check <env>` fails when:

- a cron job (`notify`, `remind`, `housekeeping`) is missing or inactive, its
  last run **failed** (a `HOUSEKEEPING_HALTED` included, with its message),
  or its last success is older than 10 minutes (`notify`), 20 (`remind`) or
  26 hours (`housekeeping`; one that has never run yet is only noted);
- two or more of the cron's HTTP calls (`pg_net`'s answers, kept six hours)
  in the last 20 minutes were not 200, timed out or failed to connect: a
  `remind` or `notify` answered 401 (the Vault secret drifted from the
  container's), 500 or 503. Only the status and the body's `code` are shown;
- the newest daily backup set is older than 26 hours;
- the disk under the backups or under Docker is more than 85 % used
  (`DISK_MAX_PERCENT`).

A long job (`housekeeping`) that has never run is only noted while the
database has been up less than its limit; after that, it fails.

Housekeeping's nightly counts (`failed > 0`) are still not kept anywhere: a
durable record of them needs a migration (`deferred-work.md`).

**How a failure reaches the founder.** Both units have
`OnFailure=shift-alert@%n.service`, which writes `SHIFT_ALERT <unit> failed`
to the journal and runs `/etc/shift-ops/alert-hook` if it exists: an
executable the founder writes from `deploy/host/alert-hook.example` (e-mail
through a relay, an ntfy topic or a Telegram bot), root's, 0700 (refused if
anyone else may read or write it). It gets the unit's name and its last
journal lines, which can carry a job's error message: prefer e-mail or a
provider in the EU, and a private topic. The jobs check alerts when its
failing checks change, and again every 6 hours while they stay the same
(`ALERT_REPEAT_HOURS`; in between, its run says "still failing" and
succeeds); when they clear, the hook gets one `RECOVERED` message. Until it
exists, a failure is only in the journal (`journalctl -u 'shift-*'`). Its
credential (an address, a topic, a token) lives in that file only. Try it
with `systemctl start shift-alert@test.service`.

**Coolify's notifications** (a failed deploy, a stopped container, disk above
80 %) need an e-mail (SMTP) or chat channel in Coolify → Settings →
Notifications; the founder's, when one exists (`deferred-work.md`).

#### The site is down

1. **Which part?** The issue names the checks. `app` alone: the `shift-web`
   application. `auth` and `notify` together: Kong or the whole stack.
   `notify` alone: the functions container (`supabase-edge-functions-<uuid>`).
   All three with `ECONNREFUSED`, `TIMEOUT` or `ENOTFOUND`: the host, Traefik
   or DNS.
2. **Is the host up?** Over the tailnet: `ssh root@<the host's tailnet name>`.
   No answer: the provider's console (reboot from there if it hangs; §9.8's
   firewall comes back with Docker).
3. **The containers:** `docker ps -a --format '{{.Names}}\t{{.Status}}'`. A
   stopped or unhealthy one: its log (`docker logs --tail 100 <name>`), then
   restart it **in Coolify** (the service, or the application), never by
   hand-editing the stack.
4. **Traefik and certificates:** `docker logs --tail 100 coolify-proxy` (an
   ACME error, a renewal failure).
5. **Disk and memory:** `df -h /`, `free -m`, `docker system df`. A full disk
   stops Postgres first; old images (`docker image prune`) are the usual
   space.
6. **Kong at `crit`** logs almost nothing; for a session, raise it in Coolify
   (`KONG_LOG_LEVEL=info`), restart Kong, read, and set it back.
7. **Recovered?** The next run closes the issue; run the workflow by hand to
   confirm at once. Write what happened in the issue before it closes.

### 9.14 The public page: the `shift-landing` image (story 21.21)

Smjenko's public page (AD-28) is its own static image, `shift-landing`
(`deploy/landing/Dockerfile`), beside `shift-web` and independent of it: one
hand-written Croatian page, a 404 page, one stylesheet, the app's own Outfit
and icons, no script, no cookie and no third-party request. `shift-web` is
unchanged.

**Build inputs** (none committed; the repository is public):

| Input | Value | Notes |
| --- | --- | --- |
| `LANDING_APP_URL` | `https://app.<domain>` (staging: `https://staging.<domain>`) | the *Prijava* link |
| `LANDING_CONTACT_EMAIL` | `info@<domain>` (the founder's decision of 2026-11-25; delivered by Cloudflare Email Routing) | *Javi se*: shown as text and as a `mailto:` link |
| `LANDING_SIGNUP_URL` | unset | *Registriraj se* is drawn only when it is set; set it only once production signup opens (D-S5) |

```bash
pnpm --filter @shift/landing build             # placeholders (example.invalid), as CI builds it
LANDING_APP_URL=https://app.<domain> \
LANDING_CONTACT_EMAIL=info@<domain> \
  pnpm --filter @shift/landing build:production # refuses a missing, invalid or placeholder input
docker build -f deploy/landing/Dockerfile -t shift-landing:<environment>-<sha> .
bash scripts/ci/probe-landing-image.sh shift-landing:<environment>-<sha> apps/landing/dist
```

`build:production` refuses, naming the input and leaving `dist` as it was: a
missing `LANDING_APP_URL` or `LANDING_CONTACT_EMAIL`; in any URL or the
address's domain, a reserved name (`.invalid`, `.test`, `.example`,
`.localhost`, `example.com`, `example.org`, `example.net` and their
subdomains, a trailing dot ignored) or a loopback (`localhost`, `127.0.0.0/8`,
`0.0.0.0`, `[::1]`); a URL that is not `https:` (plain `http:` is allowed only
to a loopback host, and only in a plain build) or carries a user name or
password; and an address that is not `local@domain.tld` (no `%`, no leading,
trailing or double dot, never an IP literal). Every value is HTML-escaped
where it lands, and the build is swapped into `dist` only once it is whole.

**The image.** `shift-web`'s pinned `nginx-unprivileged` base (§9.7), files
owned by root, `nginx -t` at build, uid 101, a `HEALTHCHECK` on `/`. Every
answer, the 404s, a 405, a 304 and nginx's own 400 included, carries
(`deploy/landing/security-headers.conf`):

```text
Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: <every feature off, as shift-web's>
```

HSTS here pins the page's own host only. Unlike `shift-web`'s, it has no
`includeSubDomains`: served at the apex, that would pin every subdomain of
`<domain>` to HTTPS for a year, and no `preload`. Adding either at the apex is
the founder's later decision, made in `security-headers.conf`, the probe and
`test/landing.test.ts` together.

| Request | Answer |
| --- | --- |
| `/`, `/index.html` | `200`, `no-cache` |
| `/favicon.svg`, `/favicon.ico`, `/apple-touch-icon-180x180.png` | `200`, `no-cache` |
| `/assets/<hashed>` (the stylesheet, the two fonts) | `200`, `public, max-age=31536000, immutable` |
| anything else, `/assets/` and `/404.html` included | the 404 page with `404`, `no-cache` (no SPA fallback) |

**Checks (CI's `landing-image` job, on every PR).** The placeholder build, the
image, the offline probe above (`--network none`, read-only root), then the
page on the runner's loopback in Chromium (`apps/landing/check/page.spec.ts`):
axe at 320 and 1280 px in both themes, no request to another origin, no
cookie, no console error, no horizontal scroll, 44 px links, and the first view
under 150 kB transferred. It pushes nothing.

**The inputs are baked in.** The page is static, so each image holds its
environment's addresses. Staging's image is never promoted to production:
each environment's image is built from the same commit with its own inputs
(and its own tag), and a rollback is redeploying that environment's previous
tag.

**Before publishing: the address must work.** `info@<domain>` is delivered by
Cloudflare Email Routing, which adds its MX and SPF records at the apex. The
founder confirms in Cloudflare that the route and those records are active,
then sends a test message to `info@<domain>` from an outside mailbox and sees
it arrive. Only then is a production page with that address deployed.

**Staging, until the pipeline builds it.** The deploy job (20.6) does not
build `shift-landing` yet (`deferred-work.md`): it needs per-environment
inputs and a Coolify resource the operator creates. Until then it is deployed
by hand as staging's images are (§9.11): build it on the host from the
branch's commit with staging's inputs and `build:production`, probe it, push
it to the loopback registry as `127.0.0.1:<registry-port>/shift-landing:staging`,
and create a Coolify Docker-image application in the `staging` environment:
port 8080, a hostname the founder chooses (for example `www.staging.<domain>`),
HTTPS forced, `--read-only --tmpfs /tmp`, 64 MiB, 0.1 CPU (as `shift-web`).

**Production (after 20.9).** A second Coolify application in production,
from GHCR as `shift-web` is, built with production's inputs, serving the apex
`https://<domain>` with `https://www.<domain>` redirected to it (a Traefik
redirect in Coolify). It needs the apex DNS record, which is the founder's
step: an `A` record for `<domain>` (and one for `www.<domain>`) to the
server's public IPv4, DNS-only, as the other names (§9.11). Nothing in the
repository names the domain or the address.
