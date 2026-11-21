---
title: '19.2 A stranger creates an account'
type: 'feature'
created: '2026-11-21'
status: 'review'
baseline_commit: '5771967ceb69cecf4218cc9f22ada328d1234925'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-11-21-signup/README.md'
---

Status: review (built, CI pending; no PR yet). DONE MEANS MERGED WITH GREEN CI.

Baseline: `origin/main` at #341 (19.1 merged). Touches the hot files `hr.json` and the structural pins (`pages/*sweep*`, `source-guards.fixture.ts`); no other story in flight touches them. Migration `0068` (main holds 0066; unmerged 16.3 holds 0067), so it may need renumbering, and `test/supabase-scaffold.test.ts`'s no-gap case fails until 0067 lands. The screens follow the epic 19 UX review (#340, UX-DR62–64), which the founder has **not yet accepted**: they are built to it because it is the current design, and they change with it if the acceptance changes it. Run unattended: the founder said decide and record; F2 stays at its default (admin-issued credentials, no email invitation).

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
- `test/signup-account.test.ts` (new, DB, unrun) -- live hook probe, mail, verify, B5, the trigger.
- `scripts/probe/signup-enumeration.mjs` (new) -- AD-22's probe for the rehearsal stack and staging.
- `e2e/tests/auth/signup.spec.ts` (new, unrun), `e2e/pages/login.page.ts`.
- Docs: spine AD-12/AD-22 applied clauses, EXPERIENCE.md, DESIGN.md, epics UX-DR33/60/62–64, deferred-work, sprint-status.

## Tasks & Acceptance

**Execution:**
- [x] SPA predicate, services, hooks, components, pages, router and fixtures, as mapped, with node tests for every service.
- [x] Migration 0068, `admin-auth` mapping and the SPA message, with a DB-free stub test.
- [x] Templates, config, CI wiring, write-local-env, probe script and the DB/e2e suites (unrun).
- [x] Docs, spine, deferred-work (19.2 entries RESOLVED, new deferrals), sprint-status.

**Acceptance Criteria:**
- Given the repo, when typecheck, lint, build, the web tests, the domain tests and the allowed root files run, then they pass (the no-gap case excepted until 0067 merges).
- Given the pinned Kong in a chroot rehearsal, when the probe script runs, then every mail answer is one status, body and header set, with medians inside its timing class.

## Spec Change Log

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
- **D9. The username trigger (0068)** derives with `private.email_identity_username` (0066's ASCII-only derivation). As tightened by review: it fires before insert and before an update naming `username` or `auth_user_id`; for an email identity it refuses every such update and holds an insert to the derived username; a member with no account or a non-email address is untouched. `admin-auth` maps exactly `23514` + `SIGN_IN_IS_EMAIL` to 409 and makes no auth call; the SPA shows `ljudi.form.error.signInIsEmail`.
- **D10. Local mail**: the three templates are committed under `supabase/templates/auth-email/` (the CLI reads them at `supabase start`, before any build), and the test fails a stale one. CI starts the mail catcher again, and `[auth.rate_limit] email_sent = 1000` locally, because the live probe and the signup E2E send real mail.
- **D11. The SPA switch in the build**: the action's `signup-enabled` input is the only source; both jobs pass `vars.VITE_SIGNUP_ENABLED` (the checked variable); the build step refuses it again for production. Locally `write-local-env.mjs` writes `VITE_SIGNUP_ENABLED=true`, because the local door is open.
- **D12. The probe and its timing class.** `scripts/probe/signup-enumeration.mjs` asserts one status, body and header set (less `Date`) per mail route across the four kinds, and every kind's median within 50 ms of every other's; the password grant must answer alike (B5), and its timing difference is reported (B8). It prints no address, and stops on a 429 (the operator raises the mail limit for the window).
- **D13. The live hook probe runs in CI**, through the CLI's GoTrue directly (never the CLI's Kong): `test/signup-account.test.ts` (unrun locally) also confirms by the mailed `token_hash` POST, shows the confirmed claimless session reads nothing (its token warmed up first), and checks B5 and 0068 (C2).

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

**Residual risks:**
- `test/signup-account.test.ts` has never run. It assumes the CLI's GoTrue answers the hook's refusal as 403 with `SIGNUP_REFUSED` in the body (19.1's suite assumed the same), Mailpit's `/api/v1/search` and `/api/v1/message/{id}` on port 54324, and GoTrue's `error_code` field.
- The signup E2E has never run; it relies on `VITE_SIGNUP_ENABLED=true` in the dev server's `.env.local`, written by `write-local-env.mjs` in CI (a developer's existing `.env.local` lacks it until rewritten).
- `content_path` is read relative to the project root by CLI 2.116, as its own template documents; if not, `supabase start` fails loudly in CI.
- The screens follow a UX review the founder has not accepted.
