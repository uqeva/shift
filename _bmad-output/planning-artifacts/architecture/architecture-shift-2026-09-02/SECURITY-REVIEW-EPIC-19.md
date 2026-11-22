# Security review checklist: Epic 19 (self-service signup)

- **Status:** checklist, written by Architect pass 2 (AP2) on 2026-11-21. It is not a review result.
- **Used by:** the `security-review` of 19.1–19.5 that D-S5 requires before production opens (ratified 2026-11-21), and each 19.x story's code review for its own rows.
- **Governing ADs:** AD-10, AD-11, AD-12, AD-16, AD-17 and AD-21–AD-25 in `ARCHITECTURE-SPINE.md`.
- **This repository is public.** The review records findings and evidence. It never records host addresses, CIDRs, keys or tokens.

Each row needs evidence: a test that runs in CI, a probe run on the local stack or on staging, or a file and line. "Looks right" is not evidence.

## A. The door (AD-21)

| # | Check | Evidence |
|---|---|---|
| A1 | The compose defaults `SHIFT_DISABLE_SIGNUP` and `SHIFT_MAILER_AUTOCONFIRM` to `true`. `production.env.example` keeps both `true`. The parity test fails otherwise | test |
| A2 | The auth entrypoint refuses any boolean that is not exactly `true` or `false`. The test tries `0`, `f` and `False`. With signup on, it refuses to start unless all of these hold: autoconfirm off, SMTP set, the before-user-created hook on, `GOTRUE_RATE_LIMIT_HEADER` set, `OTP_EXP` of 3600 or less, `OTP_LENGTH` 10, and each template URL serving `token_hash` | test (runs the wrapper) |
| A3 | `private.signup_settings.open` defaults to false. No session role holds any privilege on the table | catalog test |
| A4 | `require-config.mjs` refuses `VITE_SIGNUP_ENABLED=true` for production | test |
| A5 | The hook refuses a synthesized address, an address whose local part fails the username check, a closed door and the accounts ceiling, all with one message. It writes nothing. Its execute grant is `supabase_auth_admin` only | DB test, catalog |
| A6 | `POST /admin/users` (admin-auth's `createUser`) still works with the hook on, so the hook does not run there | local-stack probe |
| A7 | Kong's `rate-limiting` is on the four routes, with the staging values, `limit_by: ip` and `hide_client_headers`, and it answers 429 when exceeded. No Traefik label middleware exists (Coolify would chain it onto every route) | Kong render test, rehearsal probe |
| A8 | GoTrue's per-IP limit and its audit log see the client address, not the proxy. `KONG_TRUSTED_IPS` is the proxy network only, never `0.0.0.0/0` or `::/0`. A client-sent `X-Real-IP` and a spoofed `X-Forwarded-For` are not trusted | staging probe |
| A9 | `GOTRUE_RATE_LIMIT_EMAIL_SENT` and `SMTP_MAX_FREQUENCY` are set explicitly. The budget fits Resend's plan together with `notify`'s volume | config, figures |
| A10 | **An accepted denial of service is decided.** One actor can exhaust `accounts_per_day`, the stack-wide email budget or the organization ceiling, and that shuts signup or recovery for everyone. IPv6 rotation inside one /64 escapes per-address limits. Record the production values, the alert (`signup-report.sql`), and whether the host serves AAAA | founder decision at D-S5 |

## B. Anti-enumeration (AD-22)

| # | Check | Evidence |
|---|---|---|
| B1 | Through Kong, signup, recover and resend each answer `200 {}` with identical header names and values for four addresses: new, known confirmed, known unconfirmed and synthesized. `KONG_HEADERS=off`: no `Via`, `Server` or `X-Kong-*` header | probe on 20.1's rehearsal stack, then staging (19.2) |
| B2 | The timing class is uniform for the same four. Kong answers first and relays in the background. If that cannot be proven, founder decision F1 is recorded | probe |
| B3 | A synthesized, malformed or unreadable body never reaches GoTrue on the three routes | probe and Kong render test |
| B4 | Kong's `/auth/v1/` is an allow-list. `otp`, `magiclink`, `reauthenticate`, `invite`, `authorize`, `callback`, `factors`, `sso`, a GET on `verify`, and path variants (trailing or doubled `/`, `;`, percent-encoding) all answer 404 | probe |
| B4a | `POST /auth/v1/verify` passes only `{token_hash, type}`. An email-plus-code body is refused before GoTrue. OTP expiry is 3600 or less, and its length is 10 | probe, config |
| B4b | `PUT /auth/v1/user` with `email` or `phone` is refused by Kong. A password change still works | probe |
| B5 | A password grant gives `invalid_credentials` for an unknown address and for a wrong password alike | probe |
| B6 | `create_organization` answers `SLUG_UNAVAILABLE` for a taken slug and for a reserved slug with the same shape. It is limited per account and per IP | DB test |
| B7 | No anonymous read path lists or confirms organizations or slugs. `has_function_privilege('anon', …)` lists nothing new | catalog test |
| B8 | **Accepted residual:** a password grant for a known address takes a bcrypt comparison that an unknown one does not. Measure it on staging and record whether the founder accepts it | probe, founder |
| B9 | A masked GoTrue failure is still visible: Kong logs the upstream status as a fixed code without the address | log check |

## C. Identity (AD-12, AD-16)

| # | Check | Evidence |
|---|---|---|
| C1 | The three homes of the synthesized-address predicate (SPA, SQL, Kong's rendered Lua) agree on `test/fixtures/synthesized-addresses.json`: mixed case, a subdomain, a trailing dot, look-alikes (`shift.invalid.example`, `xshift.invalid`), and malformed addresses (two `@`, quotes) | test |
| C2 | Renaming an email identity is refused by `members_username_follows_email_identity` (23514 `SIGN_IN_IS_EMAIL`), through `admin-auth` (409, no auth call) and through a direct PATCH alike | DB test, function test |
| C3 | `resetPassword` never sends `email`. A reset Founding Admin must set a password at the next sign-in | function test |
| C4 | Username sign-in for every existing account is unchanged with signup on | e2e and probe |
| C5 | No session can change its sign-in address (B4b), so neither kind can become the other | probe |
| C6 | Email links use `token_hash` and are verified by POST, on a click. No session token appears in a URL. Opening a link with a GET, or loading `/potvrda`, consumes nothing | probe |
| C7 | The allow list and the site URL are the app origin only. A link cannot redirect anywhere else | config |
| C8 | A confirmed signup holds only a password the confirming person chose. A stranger who signed the same address up first, unconfirmed, cannot leave their password on the account the owner confirms (GoTrue v2.196.0 keeps the first signup's password on a repeat signup). Added by the security review of 19.2. **Decided and built by 19.3** (founder decision 2026-11-21: confirmation forgets the password; see the 19.3 rows below), CI green (PR #349) | DB or e2e test |
| C9 | After a link is used, the page names the address now signed in before anything is created, so a forwarded link (login CSRF) or a device already signed in as another account is visible. Added by the security review of 19.2 | e2e |

## D. Creating an organization (AD-23)

| # | Check | Evidence |
|---|---|---|
| D1 | The function takes no organization id, member id or address. Execute is `authenticated` only | catalog |
| D2 | It is refused for an unconfirmed account, for a username identity, for an account with `must_set_password`, and for an account that already has a member row in any organization | DB test |
| D3 | Two concurrent calls from one account create one organization. `founded_by` is unique | DB test |
| D4 | The 24-hour ceiling and the per-account attempts limit hold under concurrency. A limit commits its attempt row | DB test |
| D5 | The new organization holds no team, shift type, pattern, hour band or setting beyond FR-74's annual leave. Its row set equals an operator-provisioned organization's | DB test |
| D6 | A self-provisioned fixture organization passes all of `test/rls-isolation.test.ts`, in both directions against the pilot fixture | DB suite |
| D7 | `search_path = ''` and every name is qualified. No dynamic SQL | source pin |

### Story 19.3's evidence (as built 2026-11-21; every DB and e2e case was written unrun and passed on CI's first run, PR #349, run 44960497114)

| # | Evidence |
|---|---|
| B6 | `test/create-organization.test.ts` "answers a taken and a reserved slug alike": one shape, one proposal, both counted. The per-IP limit is Kong's route (A7); the per-account limit is the "past the account's attempts" case. Source pin: `test/supabase-scaffold.test.ts` (0071 block) |
| B7 | `test/create-organization.test.ts` catalog case: `anon` executes none of 0071's functions, no session role holds a privilege on `private.organization_attempts`. `create_organization` answers only `auth.uid()`'s own state and lists nothing |
| C8 | 0071's `private.forget_password_on_confirmation` (a hash the confirming UPDATE leaves unchanged only, so a password set in the same update is kept). Recorded edges: autoconfirm would forget every signup password (the AD-21 entrypoint refuses autoconfirm with signup open; `config.toml` pins confirmations on); an identity unlink resets `email_confirmed_at` (`/user/identities` is not on Kong's allow-list). Also (BEFORE UPDATE OF `email_confirmed_at` on `auth.users`), read against GoTrue v2.196.0's `User.Confirm`, `User.Authenticate` and `PUT /user`. `test/signup-account.test.ts`: the stranger's first password and the owner's repeat signup's are both refused after the confirmation, the password set with `PUT /user` signs in; the database case nulls only a first, non-synthesized confirmation. `/potvrda`'s signup link is the password form (`e2e/tests/auth/signup.spec.ts`). Security review 2 of 19.3 read every `email_confirmed_at` writer in GoTrue v2.196.0 (all through `User.Confirm`, two columns, so no route confirms and sets a hash in one UPDATE; admin `updateUserById` keeps its password by a later UPDATE, admin `createUser` of a real address loses it), its migrations (none recreates `auth.users` or its triggers), and existing accounts (only the null-to-set transition acts, so confirmed accounts, the founder's and the pilot's included, keep their passwords) |
| C9 | Not decided here (19.3 D3): step 1 names the signed-in address (`Prijavljuješ se adresom …`) and shows it beside *Odjava* before anything is created (`e2e/tests/auth/signup.spec.ts`). Whether a forwarded link is acceptable stays with D-S5 |
| D1 | `test/create-organization.test.ts` catalog case: the eight argument names, definer, `search_path=""`, `authenticated` only. Source pin: no id or address parameter |
| D2 | `test/create-organization.test.ts`: unconfirmed, username identity, `must_set_password`, banned, already a member and no account all answer 42501 `ORGANIZATION_NOT_CREATABLE`, with no attempt row |
| D3 | `organizations_founded_by_key` (unique); `test/create-organization.test.ts`: two concurrent calls from one account found one organization (committed, cleaned up) |
| D4 | `test/create-organization.test.ts`: a shut door, the per-account attempts and the 24-hour ceiling each answer `TRY_LATER` with the attempt row kept. Under concurrency the advisory lock serializes the count (source pin); a two-account concurrent ceiling case is not written |
| D5 | `test/provisioning.test.ts`: a self-provisioned and an operator-provisioned organization leave the same non-empty tables; `test/create-organization.test.ts`: the rows written, annual leave only |
| D6 | **Deferred to the D-S5 review** (19.3's Epic AC Deviations, `deferred-work.md`). Narrowed evidence: `test/create-organization.test.ts`'s sweep of every public table with an `organization_id`, both directions against the pilot |
| D7 | `test/supabase-scaffold.test.ts`: `search_path = ''`, no `execute` or `format(`, every write qualified |
| E4 | `authenticated` holds no UPDATE on `founded_by` (0004's column grants never name it; scaffold pin, catalog case). `anon` keeps Supabase's default table grant and meets no update policy, so row level security refuses it; `service_role` is the secret key's trusted role (AD-17), past row level security for every column. No policy inserts an organization; `signup_settings` and `organization_attempts` grant nothing |

## E. An account with no organization, and suspension (AD-10)

| # | Check | Evidence |
|---|---|---|
| E1 | A confirmed account with no claim reads zero rows from every table and view, is refused on every write, gets nothing from every executable function except `create_organization`, cannot write to Storage, and gets nothing from the four functions. The suite is enumerated from the catalog | DB suite (19.1) |
| E2 | `clearMustSetPassword` from such an account changes nothing but its own flag | function test |
| E3 | A suspended organization: its existing tokens read nothing at once, a new sign-in or refresh is refused, the feed answers 404, no reminder or notification is written or sent, and queued rows settle `ORGANIZATION_SUSPENDED`. The catalog sweep runs as a suspended admin. Only `private.organization_live` names `suspended` | DB test, source pin |
| E4 | No session can write `organizations.suspended`, `founded_by` or `signup_settings` | catalog test |

## F. Housekeeping and the operator (AD-25)

| # | Check | Evidence |
|---|---|---|
| F1 | The job deletes only accounts with no member row that are past 7 days (unconfirmed) or 30 days (confirmed) | DB test |
| F2 | An account that is inside `create_organization` is skipped and never deleted (`skip locked`, then the re-check) | DB test |
| F3 | No session role can execute the job's function | catalog |
| F4 | The operator scripts work only over the tailnet and change only `suspended` | runbook |

### Story 19.5's evidence (as built 2026-11-21; every DB case written unrun, CI is its first run)

Migration `0073_housekeeping_and_suspension.sql`. Beside the unrun DB files, the whole migration chain 0001–0073 and the four operator scripts (19.5's three and `provision-organization.sql`) were applied to an in-process PGlite over a stand-in for Supabase's platform schemas, and the housekeeping and suspension behaviour below was exercised there (single connection: the lock races are CI's alone).

| # | Evidence |
|---|---|
| E3 | `test/suspended-organization.test.ts`: the catalog sweep of 19.1, moved to `test/catalog-sweep.ts`, run as an admin of the pilot suspended by `suspend-organization.sql` (zero rows from every table and view, every write refused, the same answer from every executable function with real and absent ids, no Storage read or write); the hook answers `SIGN_IN_REFUSED` for its members only; the feed lookup answers null; `reminder_inputs` omits, `enqueue_shift_reminders` skips, `notify_members` queues nothing; `push_devices_for_send` answers `inactive`; the claim settles a queued row `ORGANIZATION_SUSPENDED` and never sends it, after unsuspending too. Source pin (`test/supabase-scaffold.test.ts`, 0073 block): only `private.organization_live` names `suspended` in any function body, and each of the nine re-created callers equals its latest definition word for word but for the check |
| E4 | `suspended` is outside every column grant (scaffold pin; `has_column_privilege` case); an admin's update is refused 42501 and `anon`'s matches no row (no update policy). `service_role` is the secret key's trusted role (AD-17), as for `founded_by`; the test asserts it holds the privilege, so a change is a decision |
| F1 | `test/housekeeping.test.ts`: stale unconfirmed (8 days, or a link last re-sent 9 days ago) and confirmed (31 days) email identities go, and the returned counts equal, by kind, a count taken just before by the stated rule (a second run answers zero); 6 and 29 days, a link re-sent 2 days ago, a banned account (confirmed or not), a late confirmation, accounts with a member row (confirmed or not), synthesized accounts (member or not, a subdomain, upper case, a trailing dot), no address, a malformed address and an organization's `founded_by` stay; a Founding Admin made by `create_organization` 45 days after confirmation stays; identities cascade; attempts older than 30 days go. One failing account (a restricting foreign key) is counted `failed` and the rest still go (DB case, PGlite). Above seven times `accounts_per_day` candidates the job deletes nothing and fails `HOUSEKEEPING_HALTED`, so an emptied `members` table cannot empty `auth.users` (DB case, PGlite, scaffold pin; security review 2026-11-22) |
| F2 | `test/housekeeping.test.ts`: an account held `for update` (AD-23 step 1) or by an uncommitted member insert (its foreign key's key share lock) is skipped, then deleted once released. Source pin: the lock, then a new statement's re-check, then the delete, which itself re-checks |
| F3 | `test/housekeeping.test.ts` and `test/provisioning.test.ts`: no session role executes `private.delete_abandoned_accounts()`; a definer with `search_path = ''`; the `housekeeping` job is `15 3 * * *`, run as the function's owner, who holds DELETE on `auth.users` |
| F4 | Scaffold pin: each script is one `do` block reading the slug from a setting, and writes `organizations.suspended` alone; `signup-report.sql` is one `select` that writes nothing. `test/suspended-organization.test.ts` runs all three (an unknown and a missing slug refused; only the column and two audit rows change). DEPLOY.md §9.10 is the runbook (over the tailnet only) |

## G. Secrets and logs (AD-17, NFR-27)

| # | Check | Evidence |
|---|---|---|
| G1 | GoTrue's SMTP key is its own sending-only, domain-restricted Resend key per stack, held only in the auth resource's Coolify environment | runbook, key-hygiene test |
| G2 | No email address, password or `token_hash` is written to Kong's, Traefik's, GoTrue's or the SPA's logs beyond GoTrue's own audit table | staging log search |
| G3 | The SPA bundle check still passes. No new key is in the bundle | CI |

## H. Production opening (D-S5): every box, then the founder's go

1. A through G are reviewed, each with evidence, and nothing is open at high severity.
2. The limits are verified on the production stack's own configuration: the production values of the Kong limits, the GoTrue limits and `signup_settings`.
3. The Resend plan's volume has been checked against the D-S3 ceiling plus `notify` (D-S4's cost risk).
4. Backups (20.7) and monitoring (20.8) run on production.
5. The decision on a second factor for email identities is recorded (spine, Deferred). F1 (timing, if Kong cannot relay) and A10 (accepted denial of service) are decided.
5a. Production restores only from production dumps; a staging dump would carry `signup_settings.open = true`.
6. **The founder says go.** Then, in this order: a reviewed PR lets production build with `VITE_SIGNUP_ENABLED`; the operator sets the production GoTrue environment and restarts auth; then the operator opens `signup_settings` by SQL. Closing again is the reverse order. `signup_settings.open = false` alone stops new accounts and organizations at once.
