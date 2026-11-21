---
title: '19.2 A stranger creates an account'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_commit: '5771967ceb69cecf4218cc9f22ada328d1234925'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-11-21-signup/README.md'
---

Status: done. Merged as #344, squash `71837c9` (2026-11-21), after `CI passed` went green on `3e8e2c1` (run 44933475976: 13 jobs passed, 5 skipped). One run failed first, on `e331a87` (run 44931092764): `Test (Vitest, local Supabase)` (`localization-applied` ×3: the signup pages and auth modules unlisted, `lozinka` counted from a hard-coded literal; `provisioning` "refuses a member with no organization": 0068's trigger answered 23514 before NOT NULL's 23502) and E2E shards 1 and 2 (`/potvrda` remounting into the dead-link page after the token left the address; `createMember`'s Edge Function round trip). All were fixed by `3e8e2c1` ("fix(auth): CI of story 19.2", logged in the Spec Change Log); no other fix was pushed for CI.

Baseline: `origin/main` at #341 (19.1 merged). Touches the hot files `hr.json` and the structural pins (`pages/*sweep*`, `source-guards.fixture.ts`); no other story in flight touches them. Migration `0068` (main holds 0066 and, since the rebase onto #342, 16.3's 0067), so the scaffold's no-gap case passes. The screens follow the epic 19 UX review (#340, UX-DR62–64), which the founder has **not yet accepted**: they are built to it because it is the current design, and they change with it if the acceptance changes it. Run unattended: the founder said decide and record; F2 stays at its default (admin-issued credentials, no email invitation).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 19.1 opened the door at the gateway and the database, but nobody can walk through it: there is no signup, confirmation or recovery screen, *Prijava* accepts usernames only, the SPA has no home of AD-12's predicate, an email identity could be renamed into a synthesized address, local Auth mail is English, and the staging build never reads `VITE_SIGNUP_ENABLED`.

**Approach:** Build `/registracija`, `/potvrda` and `/zaboravljena-lozinka` (UX-DR63/64) and email sign-in on *Prijava* (UX-DR62) inside `features/auth`, behind `VITE_SIGNUP_ENABLED` where AD-21 says. Add the SPA predicate, a minimal `sessionDestination` that holds a claimless email identity on a `/postavljanje` placeholder until 19.3, the `members_username_follows_email_identity` trigger (0068) with `admin-auth`'s 409, local Croatian templates, the build wiring, a live hook probe (CI) and the gateway enumeration probe script.

## Boundaries & Constraints

**Always:**
- The SPA never reads a mail route's body. Every signup, resend or recovery answer except 429 and a transport failure shows the one neutral screen.
- Before sending, the SPA refuses: malformed or synthesized (the vector file), not printable ASCII after trimming ASCII white space, longer than 255, or failing GoTrue v2.196.0's own format pattern (read from the pinned binary), with `'` refused in every home (19.1's D9 kept). A password under `PASSWORD_MIN_LENGTH` is refused too.
- `/potvrda` verifies only on a press, with `verifyOtp({ token_hash, type })`.
- New copy lives in `signup.*`. Two existing values change: `auth.username` and `auth.organization.placeholder` (O1).
- The trigger derives the username exactly as 0066's hook checks it (trimmed local part, ASCII-only lower case).

**Ask First:** none (decide and record).

**Never:** build `create_organization`, step 1 or the wizard (19.3/19.4), invitations (F2), or a captcha. Never run docker, `supabase`, e2e or DB-connecting tests. No literal secret.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signup | valid shape, new or known address | *Provjeri e-poštu*; resend disabled 60 s | 429: network alert; transport: unavailable alert |
| Local refusal | `a.example.com`, `ana@x.shift.invalid`, NBSP, `o'brien@x.hr`, short password | refused on page, no request, values kept | n/a |
| Email sign-in | entry with `@` | password grant on the address, no slug; organization dimmed and unsent | any refusal: `E-mail ili lozinka nisu točni.`; `email_not_confirmed`: *Potvrdi adresu e-pošte* |
| Claimless email session | after sign-in or confirm | `/postavljanje` placeholder | claimed: the app |
| `/potvrda` | load | nothing sent until *Potvrdi* | dead link: *Poveznica više ne vrijedi* |
| Recovery link | `type=recovery`, two matching passwords | verify, then save the password, continue signed in | a save failure after verify retries the save only |
| Rename an email identity | `admin-auth` or a PATCH | 23514 `SIGN_IN_IS_EMAIL`, 409 from `admin-auth`, no auth call | the derived username itself passes |

## Epic AC Deviations

- "identical in status, body and timing class": proven on the pinned Kong (chroot rehearsal, stand-in GoTrue) and by the probe script. The script's runs on 20.1's rehearsal stack (docker) and on staging, with real known and unknown addresses, are **DEFERRED to 20.5** (deferred-work entry).
- "a verified email identity signs in": it signs in and lands on the `/postavljanje` placeholder, because step 1 is 19.3's. **Narrowed.**
- "the copy is in the `signup` namespace": all new copy is. The two changed *Prijava* values stay under `auth.*`, where the shared sign-in form reads them. **Reinterpreted.**

</frozen-after-approval>

## Code Map

- `apps/web/src/features/auth/services/address.ts` -- AD-12 SPA home: `addressKind`, `isSynthesizedAddress`, `signupAddressOf` (the send check); runs the vector file in `address.test.ts`.
- `apps/web/src/features/auth/services/sign-in.ts`, `hooks/use-sign-in.ts`, `components/sign-in-form.tsx`, `pages/prijava.tsx` -- email path, dimmed organization, `email_not_confirmed`, forgot panel's two paths, the *Registriraj se* link (bare `/prijava`, flag on).
- `apps/web/src/features/auth/services/signup.ts` (new) -- signup, resend, recover and verify outcomes, the resend countdown, the flag `signupEnabled()`.
- `apps/web/src/features/auth/services/session-destination.ts` (new, public) -- `app` or `setup`; used by the `_app` guard and `/postavljanje`'s guard (the sign-in hook reaches it through `_app`).
- new pages `registracija.tsx`, `potvrda.tsx`, `zaboravljena-lozinka.tsx`, `postavljanje.tsx`; their hooks and forms in `features/auth`; `router.ts`, `router.test.ts`.
- `apps/web/src/pages/source-guards.fixture.ts`, `key-sources.fixture.ts`, `screens-sweep`, `key-sweep`, new `features/auth/signup-screens.fixture.ts` -- register the new screens.
- `supabase/migrations/0068_email_identity_username.sql` -- `private.email_identity_username(text)`, `private.refuse_username_change_of_email_identity()`, the trigger.
- `supabase/functions/admin-auth/operations.ts` + `apps/web/src/features/members/services/wire.ts` -- `SIGN_IN_IS_EMAIL` (409) and its message.
- `supabase/config.toml`, `supabase/templates/auth-email/*.html`, `scripts/auth-email-templates.mjs`, `test/auth-email.test.ts` -- local Croatian templates.
- `.github/actions/deploy/action.yml`, `.github/workflows/pipeline.yml`, `scripts/ci/write-local-env.mjs` -- `VITE_SIGNUP_ENABLED` from the checked variable only; mailpit back in CI.
- `test/signup-account.test.ts` (new, DB, written unrun; green in CI, #344) -- live hook probe, mail, verify, B5, the trigger.
- `scripts/probe/signup-enumeration.mjs` (new) -- AD-22's probe for the rehearsal stack and staging.
- `e2e/tests/auth/signup.spec.ts` (new, written unrun; green in CI, #344), `e2e/pages/login.page.ts`.
- Docs: spine AD-12/AD-22 applied clauses, EXPERIENCE.md, DESIGN.md, epics UX-DR33/60/62–64, deferred-work, sprint-status.

## Tasks & Acceptance

**Execution:**
- [x] SPA predicate, services, hooks, components, pages, router and fixtures, as mapped, with node tests for every service.
- [x] Migration 0068, `admin-auth` mapping and the SPA message, with a DB-free stub test.
- [x] Templates, config, CI wiring, write-local-env, probe script and the DB/e2e suites (written unrun; green in CI, #344).
- [x] Docs, spine, deferred-work (19.2 entries RESOLVED, new deferrals), sprint-status.

**Acceptance Criteria:**
- Given the repo, when typecheck, lint, build, the web tests, the domain tests and the allowed root files run, then they pass (the no-gap case excepted until 0067 merges).
- Given the pinned Kong in a chroot rehearsal, when the probe script runs, then every mail answer is one status, body and header set, with medians inside its timing class.

## Spec Change Log

- 2026-11-21 (CI, PR #344, head e331a87) — Six failures, each fixed at its cause; no frozen text changed. (1) `localization-applied` "lists every page": the four signup pages were in neither list; `SOURCES` now reads them off `SIGNUP_PARTS`. (2) "reads every sign-in part and service module": the test read only the sign-in and set-password fixtures; it now reads `SIGNUP_PARTS` and `SIGNUP_SCREEN_EXEMPT` too, its exact exempt list names `services/signup.ts` and `services/session-destination.ts`, and the pinned count is 27 (the unconfirmed panel, five hooks, five parts, two rules). (3) "ships lozinka only from the resource file" (17 vs 14): no hard-coded copy; the three extra are the route path `/zaboravljena-lozinka` (the route definition and the two `<Link to>`), added to `ROUTE_SEGMENTS` as `/postavi-lozinku` was in 7.8. (4) `provisioning` "refuses a member with no organization" got 23514: 0068's BEFORE trigger runs ahead of NOT NULL and the foreign key, and its fail-closed branch judged a row with no organization and an account that does not exist. The trigger now lets through untouched a row with no organization, no account, or an account that does not exist, and the constraints answer (23502, 23503 — `0002:128`'s foreign key is not deferrable, so every such row is still refused). An account that exists with a missing or malformed address is still held as an email identity's. The pinned test is unchanged. (5) `signup.spec.ts` "Potvrda sends nothing on load": a real regression from security review 2. TanStack's browser history patches `window.history.replaceState`, so `forgetLinkInAddress` was a navigation the router saw; the remount key (token and type) changed with it, and the screen remounted with no link and showed the dead-link page for a live link. Reproduced on a static build in headless Chromium (old: *Poveznica više ne vrijedi*, no *Potvrdi*), fixed: `potvrdaRemountKey(search, held)` keeps the held key for an address without a token (a new token still remounts; leaving `/potvrda` unmounts anyway), pinned in `signup.test.ts`. (6) `responsive.spec.ts` "sign-in without a slug fits 320 px": *Registriraj se* was an inline text link 80 × 20 px; it and signup's *Prijavi se* are now `inline-flex min-h-11` (measured 80 × 44 at 320 px; no control under 44 px on `/prijava`, its forgot panel open, or `/registracija`). (7) `first-sign-in.spec.ts:125` (E853) was not a 19.2 regression: it failed before any sign-in, at the admin's `createMember` waiting 5 s for *Račun je izrađen*, passed on retry, and the same wait flaked on the 16.4 branch's run (people.spec, teams.spec) without 19.2's code. `PeoplePage.submitNewMember` now waits up to 15 s for that status, the Edge Function round trip (authorize, GoTrue `createUser`, the row).
- 2026-11-21 (security review 2, applied) — Rebased onto #342 (16.3; 0068 follows 0067 with no gap). The findings in Review 2. No frozen text changed. KEEP: the one-press confirmation, the status-only mail outcome and the fail-closed trigger. The founder decides C8 (pre-account takeover) before production.
- 2026-11-21 (review, applied) — the findings above; no frozen text changed. KEEP: the status-only mail outcome, the send check, the one-press link, and the probe's assertions.
- 2026-11-21 (build) — The Code Map grew, outside the frozen block: `features/auth/hooks/use-mail-sent.ts`, `use-signup.ts`, `use-recover-request.ts`, `use-mail-link.ts`, `use-setup-holding.ts`; `components/signup-form.tsx`, `sent-card.tsx`, `mail-sent-panel.tsx`, `recover-request-form.tsx`, `mail-link-panels.tsx`, `unconfirmed-panel.tsx` (the `Rule` of `set-password-form.tsx` is now exported and shared); `eslint.config.js` (`services/session-destination` and `services/signup` public to pages); `features/members/services/write.ts` (re-export), `members/utils/date-refusal.test.ts` and `members/services/write.test.ts` (the new failure classified); `test/provisioning.test.ts` (0068's three catalog entries, unrun); `test/resource-hygiene.test.ts` (67 sanctioned keys); `test/supabase-scaffold.test.ts` (the three template sections excused from the compose mirror, with the reason); `test/coolify-deploy.test.ts`, `test/ci-scripts.test.ts`; new DB-free `test/email-identity-rename.test.ts` and `test/signup-probe.test.ts`; `DEPLOY.md` §9.9; the UX review's README (O1 taken). DESIGN.md needed no change: its signup "Don't" already describes what was built.

### Review Findings

Review (2026-11-21, `bmad-build` step 4, unattended). Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Epic AC Auditor, Unrun DB Test Auditor (the first launch died on the API limit; all five were relaunched). 15 patched, 6 deferred, the rest dismissed; no intent or spec gap (each finding was fixable inside the frozen intent).

- [x] [Review][Patch] 0068 let `admin-auth` rename an email identity to its derived username, and then `admin-auth` rewrote the address to a synthesized one (Epic AC Auditor, Edge Case Hunter; the epic's AC4, unlisted). The trigger now refuses ANY update naming `username` or `auth_user_id` of an email identity's row (to or from one), and fires on insert too, holding it to the derived username; the spine records the stricter rule (AD-12, AD-3) [0068]
- [x] [Review][Patch] The DB case "lets the derived username through" updated to the value already stored; it is now "refuses even the derived username", and an insert case covers a non-derived username [test/signup-account.test.ts]
- [x] [Review][Patch] The live-probe file now asserts the local door is open (as `seed.sql` leaves it) before any case, so a refusal is the rule's; its header no longer says it bypasses the CLI's Kong (a plain proxy) [test/signup-account.test.ts]
- [x] [Review][Patch] A password over GoTrue's 72 would have been masked into the neutral screen: refused on the page (`signup.form.error.passwordLong`), and the recovery form refuses it too [signup.ts, use-mail-link.ts]
- [x] [Review][Patch] A recovery password GoTrue refuses (422 `same_password` and the like) read "try again" forever: `RECOVERY_PASSWORD_REFUSED` says to choose another [signup.ts]
- [x] [Review][Patch] A confirmation whose navigation failed re-verified the spent link on the next press: it now only navigates [use-mail-link.ts]
- [x] [Review][Patch] `/potvrda` read its link once at mount: the route remounts per link [potvrda.tsx]
- [x] [Review][Patch] *Natrag na prijavu* and *Ispravi adresu* from an unconfirmed sign-in lost the address: the entry is kept [use-sign-in.ts, sign-in-form.tsx]
- [x] [Review][Patch] The two resend buttons had no offline gate or note [mail-sent-panel.tsx, unconfirmed-panel.tsx]
- [x] [Review][Patch] The hint cell's hidden copy lacked the remembered prefix, so it could shrink [sign-in-form.tsx]
- [x] [Review][Patch] The recovery card said the link's validity twice: `signup.recover.typed` is the address only [hr.json]
- [x] [Review][Patch] The probe measured each kind's samples in one run, so warm-up could bias a kind; rounds now interleave the kinds in a shuffled order, every request has a 20 s timeout, and the script and DEPLOY.md §9.9 say what a run leaves and how to remove it [signup-enumeration.mjs, DEPLOY.md]
- [x] [Review][Patch] DEPLOY.md did not say the SPA switch needs a rebuild to change [DEPLOY.md]
- [x] [Review][Patch] The new routes' guards (switch off and on, signed in, claimed and claimless) and `confirmsSignup`, `isRecoveryLink`, `setupSearchOf` had no test [router.test.ts, signup.test.ts]
- [x] [Review][Patch] `login.page.ts`: a JSDoc stranded above the new block; the countdown's pattern built from `hr.json` [e2e/pages/login.page.ts]
- [x] [Review][Defer] `/potvrda` replaces a session already signed in on the device without saying so — deferred, OWNER the D-S5 security review
- [x] [Review][Defer] The resend's countdown in the button's name, and a second resend's unchanged status line, for screen readers — deferred, OWNER 19.4's accessibility pass
- [x] [Review][Defer] E2E of a real mailed link through *Potvrdi*, a recovery link, an unconfirmed sign-in and the switch-off redirects — deferred, OWNER 19.3
- [x] [Review][Defer] A dead recovery link's next step reads as a sign-in's — deferred, OWNER the founder's UX acceptance
- [x] [Review][Defer] The `_app` guard's `setup` redirect carries no return target — deferred, OWNER 19.3
- [x] [Review][Defer] The signup E2E leaves its account on a reused local stack — deferred, OWNER 19.5 (housekeeping deletes it after 7 days)

Dismissed, each with its reason: recovery gated by `VITE_SIGNUP_ENABLED` (AD-21 names `/zaboravljena-lozinka` among the switch's screens, and no email identity exists where it is shut); an email change breaking the derived username (no session can change its address, AD-22); an `email_change` link answering no session (the same); the door closed in CI (`seed.sql` opens it; now asserted); the mixed-case refusal reached by a shut door (the same); username autofill without an input event (the autofill fires `input`); `usableAfterIssue` not throwing (the repository's pattern; the next assertion fails clearly); "jedan sat" against "sat vremena" (both true; 19.1's mail copy); `ivan@` on *Prijava* reading as the email refusal (the one message for every cause of that kind, UX-DR62); the new `ljudi` key outside `signup` (it is the member surface's message, recorded in D9).

### Review 2: security review (2026-11-21)

`bmad-code-review`, unattended, on `git diff origin/main...HEAD` after the rebase onto #342 (16.3), against `SECURITY-REVIEW-EPIC-19.md` rows B5–B8 and C. Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor with Epic AC Auditor, Unrun DB Test Auditor. The Artifact Renderer was not run: there is no generated file. 17 findings patched, 4 deferred, and the rest rejected with reasons. No frozen text was changed.

- [x] [Review2][Patch] `/potvrda?token_hash=…` stayed in the address bar and the history entry until a successful press, so an unused recovery link could be replayed from a shared device's history. The page now reads the link into memory, then replaces the entry with `/potvrda?type=…`. The E2E asserts that the URL no longer has the token. [signup.ts `forgetLinkInAddress`, use-mail-link.ts]
- [x] [Review2][Patch] `shift-web`'s nginx logged the full request line, token included (NFR-27). A request with a query is now logged as its path plus `?[redacted]`, the way Kong's log does it. Rehearsed under `chroot` in a private network namespace on the pinned image: `nginx -t` passes, and the log line reads `GET /potvrda?[redacted]`. [deploy/web/default.conf, test/web-image.test.ts]
- [x] [Review2][Patch] The 72 ceiling counted UTF-16 units. GoTrue and bcrypt count UTF-8 bytes, so a password of 40 letters `č` passed the page and was masked into the neutral screen. The ceiling now counts bytes, and the copy names the two-byte letters. [signup.ts `passwordBytes`, hr.json]
- [x] [Review2][Patch] 0068 let through any address the predicate calls malformed. It now fails closed: only a synthesized address is let through. [0068]
- [x] [Review2][Patch] The probe counted a password grant's 429 as an answer. It now stops on it. [signup-enumeration.mjs, signup-probe.test.ts]
- [x] [Review2][Patch] The probe accepted plain `http://` to any host, which would send the key, the known addresses and the grants in clear text. It now refuses plain http except on loopback. [same]
- [x] [Review2][Patch] A transport failure in the probe was an unhandled rejection that looked like a failed assertion. It now prints `FAIL … transport failure`. [same]
- [x] [Review2][Patch] The probe's shuffle was biased. It is now a Fisher–Yates shuffle. [same]
- [x] [Review2][Patch] DEPLOY.md's probe cleanup matched any `probe-%` address, so it could delete a stranger's pending signup. It is now scoped to the run's own domain. [DEPLOY.md]
- [x] [Review2][Patch] A production build could still read `VITE_SIGNUP_ENABLED` from a `.env` file. Production now builds with the switch exported as `false`, and a test pins it. [.github/actions/deploy/action.yml, test/coolify-deploy.test.ts]
- [x] [Review2][Patch] Three gaps in the E2E's verify counter: it missed a verify that carries a query string, asserted before the network was idle, and did not check the method. It now counts every verify except a preflight, waits for network idle, and asserts one POST carrying the `token_hash`. [e2e/tests/auth/signup.spec.ts]
- [x] [Review2][Patch] The three live GoTrue cases ran under vitest's 5 s default. They now get 30 s, and 60 s for the long one, matching their live siblings. [test/signup-account.test.ts]
- [x] [Review2][Patch] No test exercised the `auth_user_id` half of the trigger. A new owner-built DB case moves a username identity onto an email account and an email identity onto a synthesized account; both expect `23514 SIGN_IN_IS_EMAIL`. [test/signup-account.test.ts]
- [x] [Review2][Patch] "Leaves a username identity's rename as it was" could pass on RLS's silent zero-row refusal. It now reads the rename back. [test/signup-account.test.ts]
- [x] [Review2][Patch] A password over the ceiling did not set `aria-invalid` on its field. [signup-form.tsx]
- [x] [Review2][Patch] C7: `GOTRUE_URI_ALLOW_LIST` was not pinned to the app origin. It now is. [test/self-hosted-stack.test.ts]
- [x] [Review2][Patch] The spec's header still described the 0067 gap, and D13's wording disagreed with the test. Both are fixed. D9 records the fail-closed rule. [this spec]
- [x] [Review2][Defer] **HIGH, blocks production:** pre-account takeover. GoTrue keeps the first, unconfirmed signup's password, and the owner's confirmation then confirms it. Checklist row C8 was added. Owner: the founder at D-S5, built by 19.3 at the latest (deferred-work).
- [x] [Review2][Defer] Login CSRF through a forwarded link: the page names no address. Checklist row C9 was added. Owner: D-S5.
- [x] [Review2][Defer] B5 for an unconfirmed, banned or hook-refused account; confirming on staging that a recovery ends other sessions; Traefik's access log for `/potvrda`. Owner: 20.5.
- [x] [Review2][Defer] 0068 lets an INSERT adopt a claimless email identity into any organization if the inserter knows its `auth.users.id`. Owner: 19.3, to hold such inserts to `create_organization`.

Rejected, each with its reason:
- **Kong headers that vary per request.** `KONG_HEADERS=off` is set, and the rehearsal saw one header set.
- **GoTrue's per-address 429 reveals an account.** Kong answers the mail routes `200 {}` itself before GoTrue runs (D12), so GoTrue's 429 never reaches a client on staging. The SPA reads the status only.
- **A `token_hash` parsed as a number.** That needs all 56 hex characters to be digits, a chance of about 1e-11. An all-digit string with a leading zero also stays a string.
- **`email_change` double confirmation, its template wording, dropping the type, and an email change breaking the derived username.** No session can change its address (C5: Kong refuses `PUT /user` with `email`), so no flow produces that mail.
- **BEFORE-trigger order, and `service_role`.** No other trigger on `members` writes `username` or `auth_user_id`: 0023 and 0035 fire on `role`, and the audit triggers are AFTER. Triggers fire for every role except a replication-role session, which only a superuser can open. "Refuses the owner too" covers the most privileged session role.
- **No HTTP PATCH case.** PostgREST runs the same UPDATE as `authenticated`, under the same RLS and triggers that the SQL case uses. `admin-auth`'s path is covered by the function test.
- **Unicode look-alikes and case tricks.** The predicate is ASCII-only. A look-alike domain is an email identity, so it is protected. A full-width `＠` makes the address malformed, which is now protected too (fail closed). Mixed case is translated to lower case alike in the hook, the derivation and the predicate.
- **Recovery does not end other sessions.** GoTrue's password update logs out every session except the current one. Confirming that on staging is in the 20.5 entry.
- **A recovery verify gives a session before the save.** Whoever holds the link holds the mailbox, which already controls the account.
- **The SPA switch ships the screens' code.** The code is not a secret. The door is enforced at Kong and in the database (rows A1–A10), and the SPA switch is the UX gate.
- **The SPA's trailing-dot rule.** GoTrue's pattern refuses that address in the send check, and C1's vectors agree.
- **Probe request variants (extra fields, other methods).** 19.1's Kong rebuilds the body and refuses other methods, and its own suite pins both.
- **Probe sample size.** `SHIFT_PROBE_SAMPLES` is the operator's to raise, and B8 is reported, never asserted.
- **A regression could read `identities`.** `mailOutcomeOf` takes only the status, and the hooks never read `data`.
- **The frozen I/O row "the derived username itself passes".** It is now stricter (epic AC4 needs that), and this is recorded for the founder, since frozen text is not changed here.
- **`ljudi.form.error.signInIsEmail` outside `signup.*`.** It is copy on the people screen, not signup copy. It is recorded for the founder.
- **The chroot rehearsal leaves no committed artifact.** It is prose by design, and the 20.5 run is the proof.
- **Epic AC4's "answers identically" is not listed as deviated.** The 20.5 deferred entry names `recover` among the probe's routes. This is recorded here.
- **The ASCII-only derivation is not tested on a non-ASCII address.** The hook refuses non-ASCII addresses (19.1's D2 and the vectors).

**Checklist coverage after review 2** (rows 19.2 owns):
- **B5:** met in code and in the probe (`signup-probe.test.ts`, run). The DB half is `signup-account.test.ts`, which passed in CI (#344). The extended kinds are 20.5's.
- **B6, B7:** 19.3's. 19.2 adds no anonymous path: both new functions are revoked from every session role (`provisioning.test.ts`).
- **B8:** open. It gets measured on staging (20.5), and then the founder decides at D-S5.
- **C1:** met (`address.test.ts`).
- **C2:** met. The `admin-auth` 409 with no auth call is run (`email-identity-rename.test.ts`). Rename, insert, re-point and owner cases are in the DB file, which passed in CI (#344).
- **C3:** met (`resetAttributes`, run).
- **C4:** met, with the E2E pending in CI.
- **C5:** 19.1's, unchanged.
- **C6:** met. The press is a POST of `token_hash`, nothing is sent on load, and the token now leaves the URL and the web log. The E2E is pending in CI.
- **C7:** met. The site URL, the allow list and the template links are pinned.
- **C8:** open, HIGH (deferred).
- **C9:** open (deferred).

## Design Notes

Decisions (the founder said decide and record):

- **D1. The apostrophe stays refused** in every home (19.1's D9). No vector, SQL or Lua change; the SPA's send check refuses it as the other homes call it malformed.
- **D2. The SPA's send check** (`signupAddressOf`) is the predicate plus what the gateway and GoTrue would drop unseen: ASCII trimming only, printable ASCII, at most 255 characters, and GoTrue v2.196.0's own pattern read from the pinned binary (`badoux/checkmail`), less the apostrophe. A mixed-case address is sent as typed (GoTrue lower-cases it). A synthesized address is refused on every screen, sign-in included (AD-12).
- **D3. `sessionDestination` is minimal in 19.2**: `setup` for a claimless email identity, `app` otherwise. The `_app` guard sends `setup` to `/postavljanje`, a placeholder outside the layout (its address, `Odjava`, `Adresa je potvrđena.` on arrival from `/potvrda`). A claimless username identity keeps today's behaviour; the rest of AD-24 is 19.3's (deferred-work).
- **D4. The mail outcome reads the status only.** 429 is the network's alert, a missing status, a retryable fetch or a 5xx is the transport's alert, and every other answer — Kong's `200 {}`, and on the CLI's stack GoTrue's own refusals — is the one neutral screen.
- **D5. The throttle** is 60 s from each send, the initial signup included, shown in the button's name; it is `aria-disabled`, never `disabled`.
- **D6. Recovery's press verifies once.** A save that fails after a successful verify is retried as a save only (the link is spent); a dead link shows the dead page with *Zatraži novu poveznicu* when the SPA switch is open.
- **D7. The organization on *Prijava* while the entry is an address**: the bare field is read-only and `aria-disabled` (the form disables nothing, the existing pin), dimmed, not required, never read by the hook; its hint swaps in place inside one grid cell that reserves the taller text, so nothing below moves. On `/prijava/<slug>` the row is dimmed with no extra line (adding one would move the username field). Recorded for the founder (deferred-work).
- **D8. Copy.** All new copy is under `signup.*`. Two existing values changed: `auth.username` (`Korisničko ime ili e-mail`) and O1's `auth.organization.placeholder` (`npr. naziv-organizacije`). The recovery lede is gender-neutral (`Nakon spremanja ostaješ u aplikaciji.`), as 19.1's review made the mail copy. The `/postavljanje` placeholder says creation is not available yet; 19.3 replaces it.
- **D9. The username trigger (0068)** derives with `private.email_identity_username` (0066's ASCII-only derivation). As tightened by review: it fires before insert and before an update naming `username` or `auth_user_id`; for an email identity it refuses every such update and holds an insert to the derived username. Security review 2 made it fail closed: only an account whose address is synthesized is let through, so a malformed or missing address is held as an email identity's. `admin-auth` maps exactly `23514` + `SIGN_IN_IS_EMAIL` to 409 and makes no auth call; the SPA shows `ljudi.form.error.signInIsEmail`.
- **D10. Local mail**: the three templates are committed under `supabase/templates/auth-email/` (the CLI reads them at `supabase start`, before any build), and the test fails a stale one. CI starts the mail catcher again, and `[auth.rate_limit] email_sent = 1000` locally, because the live probe and the signup E2E send real mail.
- **D11. The SPA switch in the build**: the action's `signup-enabled` input is the only source; both jobs pass `vars.VITE_SIGNUP_ENABLED` (the checked variable); the build step refuses it again for production. Locally `write-local-env.mjs` writes `VITE_SIGNUP_ENABLED=true`, because the local door is open.
- **D12. The probe and its timing class.** `scripts/probe/signup-enumeration.mjs` asserts one status, body and header set (less `Date`) per mail route across the four kinds, and every kind's median within 50 ms of every other's; the password grant must answer alike (B5), and its timing difference is reported (B8). It prints no address, and stops on a 429 (the operator raises the mail limit for the window).
- **D13. The live hook probe runs in CI**, reaching GoTrue through the CLI's API gateway, a plain proxy (the enumeration probe never runs there): `test/signup-account.test.ts` (unrun locally) also confirms by the mailed `token_hash` POST, shows the confirmed claimless session reads nothing (its token warmed up first), and checks B5 and 0068 (C2).

**Checklist rows 19.2 owns (SECURITY-REVIEW-EPIC-19.md).**
- B1/B2: the probe, rehearsed on the pinned Kong (below); staging and the rehearsal stack are 20.5's. Met offline.
- B5: `test/signup-account.test.ts` (CI) and the probe. Met, pending CI.
- B6, B7: `create_organization`'s, 19.3's. Not 19.2's.
- B8: measured in the rehearsal against a leaking stand-in only (a 120–160 ms difference the probe reports); the real figure is staging's (20.5, then D-S5). Open.
- C1: the SPA home runs the vector file (`address.test.ts`). Met.
- C2: 0068 and `test/signup-account.test.ts` (CI); `admin-auth` 409 with no auth call (`test/email-identity-rename.test.ts`, run). Met, DB half pending CI.
- C3: `resetAttributes` sends `password` and the flag only (run). Met.
- C4: username sign-in unchanged (the web suite's sign-in tests; CI's E2E). Met, E2E pending CI.
- C5: unchanged from 19.1 (Kong refuses `PUT /user` with `email`). Met.
- C6: `/potvrda` verifies only on a press (E2E counts the verify requests; the live probe confirms by POST). Met, pending CI.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm --filter ./apps/web test`, `pnpm --filter @shift/domain test` -- pass.
- `pnpm exec vitest run` on the eleven allowed root files plus the new DB-free files -- pass.

**Results (2026-11-21, build):**
- `pnpm typecheck`, `pnpm lint` -- clean. `pnpm build` -- pass.
- `pnpm --filter ./apps/web test` -- 180 files, 6744 passed. `pnpm --filter @shift/domain test` -- 20 files, 950 passed.
- The eleven allowed root files plus `test/email-identity-rename.test.ts` and `test/signup-probe.test.ts` -- 2738 passed, 1 failed: `numbers migrations … with no gaps`, at the 0067 gap this branch leaves for story 16.3. With a placeholder `0067` (made and deleted at once) the scaffold file passes (119).
- NOT RUN locally (the STRICT DATABASE RULE and the caller's rules): `test/signup-account.test.ts` (new), `test/provisioning.test.ts` (three entries), `test/admin-auth-boundary.test.ts` (its contract case now meets `SIGN_IN_IS_EMAIL` on both sides), `e2e/tests/auth/signup.spec.ts` (new) and the rest of the E2E. CI is their first run.
- **The probe on the pinned Kong** (saved rootfs under `chroot` in `unshare -n -m`, the compose's own entrypoint and Lua, the mail limit raised for the window, 7 samples per kind and route) in front of a stand-in GoTrue that leaks as v2.196.0 does (a known address fast with `identities: []`, a new one 300 ms, a password grant for a known address 120 ms slower): every mail route answered one status (200), one body and one header set; the kinds' medians spanned 4.2 ms (signup), 1.6 ms (recover) and 4.5 ms (resend), inside the 50 ms class; probe exit 0. The grant answered `400 invalid_credentials` alike, with the stand-in's 120 ms B8 residual reported. The same probe pointed straight at the stand-in failed, as it must (two bodies, two header sets, spans near 300 ms). The synthesized address was never relayed, and Kong's log held no address.
- **The generated files were opened.** The three local templates (`supabase/templates/auth-email/*.html`, equal to the build's) were rasterized with Playwright's headless Chromium at 390 and 900 px with the template variables filled: Croatian copy, one button, the fallback link to `/potvrda?token_hash=…&type=…` wrapping without overflow.
- **The screens were looked at.** A build with the switch on, served by a static server on loopback, rendered by headless Chromium: *Prijava* at 1080 px with an address typed (the hint swapped, nothing moved, the forgot panel's two paths stacked; a first render had set them side by side, fixed by one stacked child), `/registracija` refused locally and with the transport's alert, `/zaboravljena-lozinka`'s refusal, `/potvrda` confirm, recovery and dead pages at 390 px.

**Results (2026-11-21, review applied):**
- `pnpm typecheck`, `pnpm lint` -- clean. `pnpm build` -- pass. `pnpm --filter ./apps/web test` -- 180 files, 6750 passed. `pnpm --filter @shift/domain test` -- 950 passed.
- The eleven allowed root files plus the two new DB-free files -- 2740 passed, 1 failed: the same 0067 gap.
- NOT RUN locally, as before: `test/signup-account.test.ts` (now with the stricter trigger's cases), `test/provisioning.test.ts`, `test/admin-auth-boundary.test.ts`, the E2E.

**Results (2026-11-21, security review 2, after the rebase onto #342):**
- `pnpm install --frozen-lockfile`, `pnpm --filter @shift/domain build`, `pnpm typecheck` and `pnpm lint` are clean.
- Every web test file, passed to vitest explicitly: 180 files, 6752 passed.
- The nine requested root files, plus `test/web-image.test.ts` and `test/email-identity-rename.test.ts`, pass, the migration-gap check included.
- The `shift-web` access-log redaction was rehearsed under `chroot` in a private network namespace, on the pinned nginx image.
- NOT RUN locally, as before: `test/signup-account.test.ts` (now with the re-point case, the read-back and the timeouts), `test/provisioning.test.ts` and the E2E. CI is their first run.

**Results (2026-11-21, CI fix of PR #344):**
- `pnpm build`, `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter ./apps/web test` -- 180 files, 6752 passed.
- `localization-applied`, `resource-hygiene`, `supabase-scaffold`, `key-hygiene`, `localization-guard`, `static-hosting`, `auth-email`, `email-identity-rename`, `signup-probe` -- 9 files, 2812 passed.
- A static build with the switch on, in headless Chromium at 320 px: `/potvrda?token_hash=…&type=signup` keeps *Potvrdi* after the token leaves the address (before the fix: the dead-link page); *Registriraj se* 80 × 44 px.
- NOT RUN locally (the database rule): `test/provisioning.test.ts`, `test/signup-account.test.ts` and the E2E. CI is their run.

**Residual risks (rewritten after the merge, from CI):**
- `test/signup-account.test.ts` ran first in CI and passed in run 44933475976 on `3e8e2c1` (the CLI's GoTrue answered the hook's refusal as assumed, Mailpit's API on 54324 and GoTrue's `error_code` held); `test/provisioning.test.ts` and `test/admin-auth-boundary.test.ts` passed there too, after the 23502 fix.
- The signup E2E ran in CI and passed in the same run, with `VITE_SIGNUP_ENABLED=true` written by `write-local-env.mjs`; a developer's existing `.env.local` still lacks it until rewritten (not CI's to settle).
- `content_path` resolved from the project root: `supabase start` succeeded in CI.
- Still open, not CI's: the screens follow a UX review the founder has not accepted; the enumeration probe against a real GoTrue (deferred-work, OWNER 20.5).
