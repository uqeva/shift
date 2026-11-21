---
title: '19.3 A verified account creates its organization'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: 'e82bb39'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-11-21-signup/README.md'
---

Status: review, built, CI pending (unattended run; the checkpoint was taken as approved, the founder having said not to ask).

Baseline: `origin/main` at #347 (17.1 merged; 19.1 #341 and 19.2 #344 merged). Touches the hot file `hr.json` and the structural pins; story 17.2 runs in parallel with migration 0070, so this story's migration is **0071** and the scaffold's no-gap case fails locally until 0070 merges (expected). The screens follow the epic 19 UX review (UX-DR63, UX-DR66), which the founder has **not yet accepted**: built to it. Run unattended: the founder said not to ask questions, and decided C8 (2026-11-21).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A confirmed email identity waits on a `/postavljanje` placeholder: nothing founds an organization (AD-23), `sessionDestination` knows two answers of AD-24's four, and checklist C8 is open at high severity: GoTrue v2.196.0 keeps the first, unconfirmed signup's password, so a stranger who signed an address up first can sign into the account its owner confirms.

**Approach:** Migration 0071 adds `public.create_organization` (AD-23, in full), its columns, table and helper, holds every email-identity member insert to it, and makes confirmation forget the password the account was created with (founder decision on C8). `/potvrda` for a signup becomes "set password and confirm"; `/postavljanje` becomes step 1 (UX-DR66); `sessionDestination` gains AD-24's remaining answers.

## Boundaries & Constraints

**Always:**
- `create_organization` follows AD-23's eight steps in order: no id or address accepted, `auth.uid()` only, a limit RETURNED (`TRY_LATER`) so its attempt row commits, `SLUG_UNAVAILABLE` with a proposal for a taken and a reserved slug alike, exactly the operator script's domain rows, the username derived by `private.email_identity_username` (0066's way).
- The C8 fix lives in the database, atomically with GoTrue's own confirmation, and is read from GoTrue v2.196.0's pinned source; no GoTrue change.
- New definers reachable by `authenticated` pass 19.1's claimless sweep (only `create_organization` may succeed); every other new function is executable by no session role.
- Copy in `hr.json` (`signup.*`); nothing pre-filled or pilot-specific.

**Ask First:** none (the founder said decide and record).

**Never:** the wizard's steps 2–7, the *Danas* card, `onboarding_dismissed`, suspension, housekeeping (19.4, 19.5); an email invitation (F2); a captcha. Never run docker, `supabase`, e2e or DB-connecting tests; no literal secret.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confirm a signup | `/potvrda?type=signup`, two matching passwords, press | verify, save the password, `/postavljanje` with `Adresa je potvrđena.` | save fails after verify: retry the save only |
| C8 | stranger signed up first with password A; owner confirms and sets B | A and the signup password are refused (`invalid_credentials`); B signs in | n/a |
| Create | valid step 1 | `ORGANIZATION_CREATED`, refresh, *Danas* | refresh fails: retry once, then route |
| Slug taken or reserved | `admin`, an existing slug | `Ta kratica nije dostupna. Prijedlog: …` + *Koristi prijedlog*; typed slug kept | n/a |
| Limit | ceiling, attempts, door shut | `Organizaciju trenutačno nije moguće stvoriti. Pokušaj kasnije.`, values kept | attempt row committed |
| Not creatable | already a member, unconfirmed, username identity, flagged | refresh and route, never an error screen | n/a |
| Adopt a stranger | admin inserts an email identity's member row | 23514 `SIGN_IN_IS_EMAIL` | n/a |
| GraphQL | `createOrganization` through `rpc/graphql` | 42501 `ORGANIZATION_NOT_CREATABLE` | n/a |

## Epic AC Deviations

- "a self-provisioned fixture organization passes the full `test/rls-isolation.test.ts` suite": **narrowed.** The suite's 14 000 lines are bound to the two seeded fixtures. 19.3 proves the self-provisioned organization's rows equal an operator-provisioned one's (`provisioning.test.ts`) and runs a catalog-enumerated isolation sweep, both directions against the pilot, in a new DB file. The full suite on a self-provisioned fixture is **DEFERRED** to the D-S5 security review (row D6; deferred-work entry).
- "the hook stamps the organization claim": met; the browser half is the E2E (written unrun).
- C8 changes 19.2's frozen one-press confirmation (UX-DR63): the founder's decision of 2026-11-21, recorded in UX-DR63, the mockup notes and the checklist.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0071_create_organization.sql` (new) -- `private.is_known_timezone`, `organizations.founded_by` + unique index, `organizations_slug_not_reserved`, `private.organization_attempts`, `public.create_organization`, 0068's trigger function replaced (the founding setting), `private.forget_password_on_confirmation` + trigger on `auth.users`.
- `supabase/operator/provision-organization.sql` -- calls `private.is_known_timezone` (AD-23 step 3).
- GoTrue v2.196.0 source (read, not vendored): `internal/models/user.go` `Confirm` (UpdateOnly two columns), `Authenticate` (nil/empty hash is false), `UpdatePassword` (logs out other sessions); `internal/api/verify.go` `signupVerify`/`recoverVerify` (Confirm, then `Reload`); `internal/api/user.go:151–214` (no current-password check without a password); `internal/api/admin.go:491–549` (createUser confirms by UPDATE after INSERT, hence the synthesized exemption).
- `apps/web/src/features/auth/services/session-destination.ts` -- `app`, `setup`, `signOut`.
- `apps/web/src/features/auth/services/create-organization.ts` (new) -- input check, slug proposal from the name, answer mapping, refresh-and-route.
- `apps/web/src/features/auth/hooks/use-create-organization.ts`, `components/create-organization-form.tsx` (new); `pages/postavljanje.tsx` (step 1); `pages/_app.tsx` (sign-out, return target); `pages/__root.tsx`, `router.ts` (a local sign-out in the context).
- `apps/web/src/features/auth/hooks/use-mail-link.ts`, `components/mail-link-panels.tsx`, `services/signup.ts`, `pages/potvrda.tsx` -- the signup link takes the password form.
- `packages/domain/src/history.ts` + test -- `founded_by` hidden (AD-11).
- `hr.json`, `test/resource-hygiene.test.ts`, fixtures and sweeps that register screens and keys.
- Tests: `test/create-organization.test.ts` (new, DB, unrun), `test/signup-account.test.ts` (C8, unrun), `test/provisioning.test.ts` (catalog, unrun), `test/supabase-scaffold.test.ts` (pins, run), `test/fixtures/known-timezones.json` (new), `e2e/tests/auth/signup.spec.ts` (mailed link, recovery, unconfirmed, step 1; unrun).
- Implementation notes found in planning (not frozen):
  - The claimless sweep (`test/claimless-account.test.ts:69`) already exempts `create_organization`; every other new function revokes execute from `public`, `anon`, `authenticated` and `service_role`, each by name (0066's pattern).
  - `test/signup-account.test.ts`'s `emailIdentityMember` inserts an email identity's member row as the owner; under D5 it sets `shift.founding_account` first (as the definer does), and a new case shows an admin's insert refused. Its live case now expects the signup password refused after the verify (C8), then sets a password with `PUT /auth/v1/user` and signs in with it; a second case signs one address up twice (the first password a stranger's).
  - `e2e/tests/auth/signup.spec.ts` "Potvrda sends nothing on load" presses the signup link through the new password form.
  - The history domain pins `HISTORY_HIDDEN_COLUMNS` exactly (`packages/domain/test/history.test.ts:982`) and the scaffold holds every audited column a field or hidden.
  - `test/provisioning.test.ts` pins catalog entries, `argumentCount` and returned columns; add 0071's.
  - `format.test.ts` bans reading the device zone in `lib/i18n/format.ts` only; step 1's browser-zone proposal lives in the auth service.
  - Operator script domain rows: `organizations (slug, name, short_name, description, address, contact_email, organization_type, timezone, locale, leave_year_start_month, leave_year_start_day)` and `members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)`; the RPC writes the first, fourth-to-ninth columns it has (no short name, description, address or contact email) and `founded_by`.
  - The rest of AD-23's names: `private.name_key` (0024), 0002's slug rule, the 0036 name-length checks (100), `private.address_kind` (0066), `private.email_identity_username` (0068).
- Docs: spine AD-12/22/23/24 clauses, SECURITY-REVIEW rows C8, C9, B6, B7, D1–D7, E4, epics UX-DR63/66, EXPERIENCE.md, the mockup's `/potvrda` notes, deferred-work, sprint-status.

## Tasks & Acceptance

**Execution:**
- [x] `0071` and the operator script, as mapped.
- [x] SPA: services with node tests, hooks, components, pages, router, copy, fixtures.
- [x] DB and E2E tests, written unrun; scaffold and domain pins, run.
- [x] Docs, deferred-work (19.3 entries answered), sprint-status `review  # built, CI pending`.

**Acceptance Criteria:**
- Given the repo, when typecheck, lint, build, the web and domain suites and the allowed root files run, then they pass (the no-gap case excepted until 0070 merges).

## Design Notes

Decisions (the founder said decide and record):

- **D1. C8: confirmation forgets the password.** A trigger `BEFORE UPDATE OF email_confirmed_at ON auth.users`: when the address was unconfirmed and becomes confirmed, and it is not synthesized, `encrypted_password` becomes null, in GoTrue's own UPDATE. GoTrue confirms with `UpdateOnly(confirmation_token, email_confirmed_at)` and then reloads the row, so nothing writes the old hash back; a null hash never authenticates; `PUT /user` sets a first password with no current-password check and logs out every other session. Admin-created and operator accounts are synthesized (exempt: `createUser` confirms by an UPDATE after its INSERT). So whatever password anyone chose before confirmation, the stranger's or the owner's, stops working at confirmation, and the account holds only the password set on `/potvrda`. A recovery link on an unconfirmed account confirms too, and its form sets the password. `/registracija` keeps its password field: GoTrue requires one, and it lets an unconfirmed sign-in be offered a new link.
- **D2. `/potvrda` for a signup** is the recovery form with signup copy: *Potvrdi i spremi lozinku* verifies and saves in one press; a save that fails after the verify is retried as a save only; a person who leaves before saving has a confirmed account with no password and recovers by email. A used or expired signup link therefore offers *Zatraži novu poveznicu* (recovery) beside *Prijava* (review of 19.3).
- **D3. C9** is not decided here. Step 1 now names the signed-in address before anything is created (UX-DR66), which is C9's evidence; whether a forwarded link is acceptable stays with D-S5.
- **D4. GraphQL** (deferred-work, OWNER 19.3): the definer refuses (42501 `ORGANIZATION_NOT_CREATABLE`) when PostgREST's `request.path` is set and is not `/rpc/create_organization`, so `rpc/graphql` cannot go around Kong's per-IP route. A direct SQL call (tests, operator) has no path.
- **D5. 0068's gap** (deferred-work, OWNER 19.3): the definer sets the transaction-local `shift.founding_account` to the caller; the trigger refuses an email identity's member insert unless that setting names the row's account. No session can set it through PostgREST.
- **D6. `sessionDestination`**: `app` (claimed), `setup` (claimless email identity), `signOut` (claimless username identity: the guard ends the session locally). A claimed session asking for `/postavljanje` goes to the app until 19.4 builds steps 2–7.
- **D7. The return target** travels from `_app` to `/postavljanje` and is used after founding.
- **D8. The founder's rename hint** (deferred-work, "consider"): declined; the trigger refuses and `admin-auth`'s 409 already explains.
- **D9. Step 1 lives in `features/auth`**: it ends the signup path and uses `sessionDestination`; `features/onboarding` is 19.4's.
- **D10. Input refusals** are raised before counting as 22023 `ORGANIZATION_INPUT_INVALID` (detail names the field) and `ORGANIZATION_TIMEZONE_UNKNOWN`; the page refuses the same before sending.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm --filter ./apps/web test`, `pnpm --filter @shift/domain test` -- pass.
- `pnpm exec vitest run` on the allowed root files -- pass.

**Results (2026-11-21, implementation):**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pass.
- `pnpm --filter ./apps/web test`: 184 files, 6852 tests pass. `pnpm --filter @shift/domain test`: 21 files, 958 tests pass.
- The allowed root files (after the build): 3127 of 3128 pass; the one failure is the scaffold's no-gap case (0070 is 17.2's, not yet merged), as expected.
- Written unrun, CI is their first run: `test/create-organization.test.ts` (new), `test/signup-account.test.ts` (C8 live and database cases, D5), `test/provisioning.test.ts` (catalog entries, the self/operator twin), `test/claimless-account.test.ts` (its admin-created email identity now sets its password after `createUser`, which C8 makes necessary), `e2e/tests/auth/signup.spec.ts` (the mailed link, step 1 to *Danas*, a taken slug, an unconfirmed sign-in, a recovery link).
- Deviations from the mockup, recorded in UX-DR66 and deferred-work: no `Korak 1 od 7` in step 1's lede until 19.4 builds the rail. The `Intl.` read of the device zone is the one named exception in `format.test.ts`; the zone list and the zone check moved into `lib/i18n/format.ts` (`supportedTimeZones`, `isRenderableTimeZone`).

**Residual risks:** every DB and E2E case above is unrun; the race (D3) commits on the shared CI stack and cleans up after itself; the edge-runtime half of the timezone parity vector is deferred (OWNER 20.5); a two-account concurrent ceiling case (D4 under concurrency) is reasoned from the advisory lock, not tested.

## Review Findings

Review of 2026-11-21, every finding patched (frozen text unchanged):

1. BLOCKER, patched: 0035's `members_refuse_write_by_stale_admin` would refuse the Founding Admin insert through PostgREST (`role` stays `authenticated` in a definer, depth 1). 0071 restates 0064's `public.refuse_write_by_stale_admin()` word for word with one early exit for a `members` INSERT whose `auth_user_id` is `shift.founding_account`, revokes restated; scaffold pin (latest definition, exit before 0023's gate, 0064's branches kept). The DB tests call the definer as `authenticated` with claims.
2. Patched: the C8 trigger nulls only a hash the same UPDATE leaves unchanged; DB case (confirm and set together keeps it). Autoconfirm and identity unlink recorded in the migration header, the spine and the checklist.
3. Patched: the random slug proposal is bounded to twenty tries, then `TRY_LATER`.
4. Patched: `is_known_timezone` and the SPA refuse `Etc/…`; parity vector, provisioning cases and scaffold pin updated.
5. Patched: `founded_by`'s privileges described as they are (authenticated has no UPDATE; anon refused by RLS; service_role trusted); header, test and checklist corrected; no grant changed.
6. Patched: `afterCreateOf` (pure, node-tested over each outcome and destination) decides navigate, sign out or a neutral notice; after a creation the notice says the way on failed (`signup.setup.error.routing`) and a second press only routes.
7. Patched: `localSessionEnd` runs within the fallback's budget and clears the stored session on a refusal, rejection or timeout; `router.options.context.endLocalSession` pinned by identity; the `/postavljanje` orphan case asserts its stand-in ran.
8. Patched: a claimed session at `/postavljanje` goes to the carried, validated return target; router test.
9. Patched: `ORGANIZATION_TIMEZONE_UNKNOWN` marks the zone invalid, reopens the list and focuses it; the slug proposal renders beside the slug (aria-invalid, described by it) and focus moves to *Koristi prijedlog*; the allowance has maxLength 5.
10. Patched: a fallback zone list when `Intl.supportedValuesOf` is missing, and the proposed zone kept among the choices.
11. Patched: `slugProposalOf` folds with NFKD and explicit maps (đ, ł, ø, æ, œ, ß, þ, ð, ı) and the digraph letters; tests for each.
12. Patched: a unit test for `setsPasswordOnLink`; D2 states that a dead signup link offers recovery.
13. Patched: the B5 pair runs after `PUT /user`, so a wrong password meets a held hash.
14. Patched: a DB case that the access token hook stamps `organization_id` for the account just founded.
15. Patched: the no-account refusal checks its attempts; the race test's and the e2e cleanups are best-effort, in foreign-key order, each failure logged.
16. Patched: an e2e step opens `/kalendar` as the claimless founder, lands on `/postavljanje?povratak=%2Fkalendar`, founds, and lands on `/kalendar`.

Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Epic AC Auditor, Unrun DB Test Auditor (all five ran). Rejected, each with its reason: the `-2…-9` proposal walk reveals which suffixed slugs exist (slugs are not secret, D-S8, and each probe costs an attempt); reserved slugs are not refused on the page (the answer is the same proposal, and a second list in the SPA would be a second owner of the rule); `organization_attempts` has no retention (AD-25's housekeeping purges rows older than 30 days, story 19.5); `address_kind` of a null email in the C8 trigger (an account with no email has no email confirmation to make); no test that PostgREST cannot set `shift.founding_account` (no exposed schema holds `set_config`, and PostgREST sets only `request.*` settings; recorded for the D-S5 review); a two-account concurrent ceiling case (reasoned from the advisory lock, a residual risk above).

### Review 2 (security review, 2026-11-21, after the rebase onto 17.2)

Rebased onto `origin/main` with 17.2 (#348, 0070). Conflicts: `deferred-work.md` (both stories' sections kept), `sprint-status.yaml` (`last_updated`), `test/provisioning.test.ts` (three catalog lists: 17.2's 0070 entries, then 19.3's 0071 entries), `test/supabase-scaffold.test.ts` (17.2's 0070 describe block closed, then 19.3's 0071 block). 0071 keeps its number; the scaffold's no-gap case now passes.

Run unattended (the founder said not to ask). Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor with the checklist rows, Epic AC Auditor (all five ran; Artifact Renderer: no generated file), plus the orchestrator's own read of C8 against GoTrue v2.196.0's source (`internal/models/user.go`, `internal/api/{verify,admin,signup,external,identity,token}.go`, `migrations/`).

**C8 evidence (read against the pinned source):**
- Every GoTrue path that sets `email_confirmed_at` goes through `User.Confirm`, `UpdateOnly(confirmation_token, email_confirmed_at)` (callers: `signupVerify`, `recoverVerify`, `ConfirmEmailChange` when unconfirmed, autoconfirm `/signup`, admin create and update, OAuth and identity linking). None writes `encrypted_password` in that UPDATE, so the trigger always sees an unchanged hash and nulls it; nothing after it in those requests writes the old hash back (pop's `UpdateOnly` names its columns; the token endpoint's re-encrypt only runs on a valid password, which a null hash never is).
- Bypass by "confirm and set the password in one UPDATE": no GoTrue route issues one. `updateUserById({ password, email_confirm })` confirms (nulls) and then writes the new hash in `UpdatePassword`'s own UPDATE, so the admin's password is kept; only the operator's SQL can do both at once, and it is trusted. A stranger controls no confirming UPDATE.
- Admin `createUser({ email: real, password, email_confirm: true })` INSERTs the hash then confirms, so that password is forgotten (already handled in `test/claimless-account.test.ts`; `admin-auth` only creates synthesized addresses, which are exempt). An invite's temporary random password is forgotten too: harmless.
- Upgrades: GoTrue's migrations only add columns and indexes to `auth.users`; none drops or recreates the table or its triggers. Dropping `email_confirmed_at` would fail on the trigger's column dependency rather than drop it silently.
- Existing accounts: only the null-to-set transition acts. The founder's and the pilot's accounts are confirmed already (and the pilot's synthesized), so no existing password is touched. The seed, the demo and the e2e helper insert confirmed rows (an INSERT fires no UPDATE trigger).
- Shape: `security definer`, `set search_path = ''`, owned by the migration role, EXECUTE revoked from `public`, `anon`, `authenticated`, `service_role`; reads only `private.address_kind` (a null address reads `malformed`, and the trigger fires only when `email_confirmed_at` is set, which a phone-only account never does).

**`create_organization` evidence:** 0071's `refuse_write_by_stale_admin()` diffed against 0064's: identical but for the one early exit (and the 0035/0036/0064/0071 chain has no other definer). `shift.founding_account` follows 0043/0045's `shift.notify_*` pattern: transaction-local, set and cleared inside the definer, rolled back with the block's subtransaction; PostgREST sets only `request.*` settings and no exposed schema holds `set_config`. The `request.path` guard cannot be spoofed (the client's own path is what PostgREST records, and only `/rpc/create_organization` passes); it does nothing when the setting is unset (deferred: a live GraphQL probe, OWNER 20.5). Tenant isolation: the definer reads only the caller's `auth.users` row, the caller's membership, the attempt and ceiling counts and slug existence; it returns only the new organization's id and slug. Races: the caller's row lock and the advisory lock serialize, and `organizations_founded_by_key` answers a self-race.

**Findings, review 2:**
1. Patched: an email-change link's `ConfirmPanel` showed the signup's reworded lede and press ("Postavi lozinku…", *Potvrdi i spremi lozinku*) with no password field. New keys `signup.confirm.changeLede` and `signup.confirm.changeSubmit`, used by `potvrda.tsx`'s last branch and `ConfirmPanel`; resource inventory updated.
2. Patched: a `SLUG_UNAVAILABLE` proposal (and its `aria-invalid`) stayed on a newly typed slug; typing the slug, or the name while the slug follows it, now drops it.
3. Patched: `route()`'s refresh ran outside its `try`, so a throw on the second press was an unhandled rejection; it now ends in the notice.
4. Patched: 0071's header (not yet promoted) corrected: the stale NUMBERING note; the admin-API mechanics of C8 stated as read in admin.go (the earlier text named `updateUserById` as a single confirming-and-setting UPDATE, which it is not); GoTrue's migrations and already-confirmed accounts; section (viii) listed.
5. Patched: `refreshedDestination`'s docstring said the screen routes after two failed refreshes; it shows the neutral notice (review 1, finding 6), recorded there as the deviation from AD-24's "refresh and route" and its fourth answer (a refused refresh is not signed out).
6. Patched: the e2e dead signup link now asserts D2's *Zatraži novu poveznicu*.
7. Deferred (OWNER 20.5): a live `rpc/graphql` probe of D4 on the pinned PostgREST.
8. Deferred (operator tooling): C8 forgets a password the admin API's `createUser` sets for a real address; documented where an operator creates one by hand.

Rejected, each with its reason: a null address passing step 2 (`address_kind(null)` is `malformed`, refused); the dead signup link offering recovery (D2, intended); `attempts` never purged and throttled retries extending the window (AD-25's housekeeping owns retention, review 1; counting every attempt is AD-23 step 5); slug enumeration through proposals (review 1: slugs are not secret, D-S8, each probe costs an attempt); the client not refusing reserved slugs (review 1); the global advisory lock (held for one short definer call, under per-account and per-IP limits); the over-length name message (the field's own maxLength stops it on the page); no hook-level test for the second press (no React test harness in `apps/web`; the decision is `afterCreateOf`, node-tested, and the guard is three lines); `NOT_CREATABLE` with a still-claimless session showing "try again" (banned, deleted or held accounts only; suspension is 19.5's); the routing loop via `povratak=/postavljanje` (each hop drops one level of nesting and ends at `/`); `founded_by` outliving its account (an attribution like `created_by`, by design).

Open for CI (not runnable here): every DB and e2e case, and that the migration role may create a trigger on `auth.users` and lock its rows (0071 is the first migration to do either; Supabase supports triggers on `auth.users` from user migrations).

## Suggested Review Order

**C8: confirmation forgets the password**

- Entry point: GoTrue's own confirming UPDATE nulls an email identity's unchanged hash.
  [`0071_create_organization.sql:458`](../../supabase/migrations/0071_create_organization.sql#L458)

- The signup link now takes the password form; verify and save in one press.
  [`use-mail-link.ts:172`](../../apps/web/src/features/auth/hooks/use-mail-link.ts#L172)

**create_organization (AD-23)**

- The eight steps in order; limits returned, slug answered by constraint name.
  [`0071_create_organization.sql:170`](../../supabase/migrations/0071_create_organization.sql#L170)

- D4: refuses any PostgREST path but its own, closing GraphQL.
  [`0071_create_organization.sql:229`](../../supabase/migrations/0071_create_organization.sql#L229)

- D5: the founding setting, the only key to an email identity's member insert.
  [`0071_create_organization.sql:334`](../../supabase/migrations/0071_create_organization.sql#L334)

- 0068's trigger, holding email-identity inserts to the definer.
  [`0071_create_organization.sql:414`](../../supabase/migrations/0071_create_organization.sql#L414)

- 0064's stale-admin re-check, restated with the founding insert's exit.
  [`0071_create_organization.sql:493`](../../supabase/migrations/0071_create_organization.sql#L493)

- The timezone rule in one function, which the operator script calls too.
  [`0071_create_organization.sql:101`](../../supabase/migrations/0071_create_organization.sql#L101)

**Routing (AD-24)**

- Three answers: app, setup, signOut.
  [`session-destination.ts:38`](../../apps/web/src/features/auth/services/session-destination.ts#L38)

- What follows an answer and a refresh, as a pure function.
  [`create-organization.ts:436`](../../apps/web/src/features/auth/services/create-organization.ts#L436)

- The guard signs a claimless username identity out locally.
  [`_app.tsx:169`](../../apps/web/src/pages/_app.tsx#L169)

- A bounded local sign-out with the storage fallback, so the guards cannot loop.
  [`sign-out.ts:335`](../../apps/web/src/features/auth/services/sign-out.ts#L335)

**Step 1 (UX-DR66)**

- The page's guard and its return target.
  [`postavljanje.tsx:75`](../../apps/web/src/pages/postavljanje.tsx#L75)

- The form's state, refusals and answers.
  [`use-create-organization.ts:57`](../../apps/web/src/features/auth/hooks/use-create-organization.ts#L57)

- The slug proposed from the typed name.
  [`create-organization.ts:45`](../../apps/web/src/features/auth/services/create-organization.ts#L45)

**Tests (DB and E2E written unrun)**

- C8 live: a stranger's earlier password signs nothing in once the owner confirms.
  [`signup-account.test.ts:241`](../../test/signup-account.test.ts#L241)

- Who may call it, input, limits, slug, rows, isolation, the race.
  [`create-organization.test.ts:138`](../../test/create-organization.test.ts#L138)

