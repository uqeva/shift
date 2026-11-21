# Epic 19 Context: An organization signs itself up

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let an organization start using Shift with nobody at Shift involved. A stranger creates an account, verifies the email, founds an organization as its first admin (the Founding Admin), and is walked through hour bands, teams, shift types, a rotation with its coverage preview, and members. Nothing is pre-filled and there is no billing. Signup is a second way into the same tenant shape that operator provisioning produces, and operator provisioning keeps working unchanged. The epic ships to staging only. Opening production is a separate founder decision (D-S5), taken after a security review of 19.1–19.5 against `SECURITY-REVIEW-EPIC-19.md`. D-S1–D-S10 are ratified at their defaults and Architect pass 2 is done. The 2026-11-21 signup UX review (`ux-designs/ux-shift-2026-11-21-signup/`, UX-DR62–70) is done but still waits for founder acceptance. Until the founder accepts it, 19.4's spec cannot freeze.

## Stories

- Story 19.1: The signup door opens safely on staging
- Story 19.2: A stranger creates an account
- Story 19.3: A verified account creates its organization
- Story 19.4: The onboarding wizard guides setup and pre-fills nothing
- Story 19.5: Abandoned signups are cleaned up and the operator keeps control

## Requirements & Constraints

- **Verification first.** An address is verified before any organization exists. One account founds at most one organization.
- **No enumeration.** Signup, resend, recovery, email sign-in and organization creation never reveal whether an address, account or organization exists. Each gives one status, one body, one header set and one timing class (a 50 ms window between medians). Slugs are not secret, but no surface lists them or answers an anonymous caller.
- **Isolation.** A self-provisioned organization passes the full `test/rls-isolation.test.ts` suite. A confirmed account with no `members` row reads nothing and writes nothing, across every table, RPC, Storage path and all four Edge Functions.
- **Abuse limits.** Limits apply per address, per account and per network. A global ceiling caps organizations created per rolling 24 h (default 20, an operator setting) and refuses with a neutral "try later". There is no captcha and no disposable-address blocklist.
- **Nothing pre-filled.** A new organization holds only the annual-leave absence type: no team, shift type, pattern, hour band or setting. The `signup` and `onboarding` copy, and the fresh-organization empty-state keys, must not contain fire-department terms, `Dan`/`Noć`/`Slobodno` used as shift names, four teams or 12 hours. No add dialog pre-selects a count, duration, boundary or name.
- **Housekeeping.** Unconfirmed accounts are deleted after 7 days. Confirmed accounts with no organization are deleted after 30 days. An account with a `members` row is never deleted. Only the operator suspends or unsuspends an organization.
- **Repository and docs.** The repository is public, so docs carry no hosts, CIDRs, keys or tokens. All copy is Croatian and lives in `hr.json` (the `signup` and `onboarding` namespaces). Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes.

## Technical Decisions

- **The door: three switches, all shut by default (AD-21).**
  - GoTrue's environment: `SHIFT_DISABLE_SIGNUP` and `SHIFT_MAILER_AUTOCONFIRM` default to `true`. Staging sets them `false`; `production.env.example` keeps them `true`.
  - The database: the singleton `private.signup_settings` (`open`, plus per-day limits 100/20/10). No session has a privilege on it, and closing it is the circuit breaker.
  - The SPA: `VITE_SIGNUP_ENABLED` only changes what is shown, and `require-config.mjs` refuses it for production.
  - The auth entrypoint refuses non-exact booleans. With mail possible, it also requires SMTP, the hook, `GOTRUE_RATE_LIMIT_HEADER`, an OTP of length 10 lasting at most 3600 s, and templates that serve `token_hash`.
  - The before-user-created hook writes nothing and answers one `SIGNUP_REFUSED` for every cause. It is on in every environment.
  - Per-IP limits are Kong `rate-limiting` on the mail routes, `/token`, `/verify` and `rpc/create_organization`. The limits are `SHIFT_LIMIT_*` variables. Traefik labels are never used for limits.
- **The gateway is the boundary (AD-22).**
  - Kong's `/auth/v1/` is an allow-list. Each route's pre-function refuses any other raw spelling of its path with a 404.
  - `signup`, `recover` and `resend` answer `200 {}` at once, then relay a rebuilt body from a timer. That relay is built, so F1 did not open.
  - `/verify` accepts only `{token_hash, type}`, and a `GET` on it is 404. `PUT /user` with `email` or `phone` is 422. `KONG_HEADERS=off`.
  - The SPA never reads the mail routes' bodies. It checks the address shape and the 10-character floor before sending.
  - The enumeration probe is `scripts/probe/signup-enumeration.mjs`. Its runs on the rehearsal stack and on staging belong to story 20.5.
- **Two identity kinds (AD-12).**
  - An account is a username identity exactly when its address is synthesized (`shift.invalid` or a subdomain of it). Every other account is an email identity.
  - The predicate lives in three homes: SPA, SQL and Kong Lua. All three run one vector file, and all lower-case ASCII only.
  - The Founding Admin's username is the trimmed local part, lower-cased ASCII-only. The hook derives it the same way.
  - Email links go to `/potvrda?token_hash=…&type=…`.
- **`create_organization` (AD-23).** It is a definer with `search_path = ''`, executable by `authenticated` only, and it takes no id or address. Its steps, in order:
  1. Lock the caller's `auth.users` row.
  2. Refuse with 42501 `ORGANIZATION_NOT_CREATABLE` unless the caller is confirmed, not banned or deleted, an email identity, without `must_set_password`, and without a `members` row.
  3. Validate the input, timezone through `private.is_known_timezone` (`ORGANIZATION_TIMEZONE_UNKNOWN`).
  4. Take the advisory lock.
  5. Write the `private.organization_attempts` row. A limit returns `TRY_LATER` and is never raised.
  6. Answer a taken or reserved slug with `SLUG_UNAVAILABLE` and a proposal (`-2`…`-9`, else 4 random characters). Reserved slugs are the check constraint `organizations_slug_not_reserved`.
  7. Insert the organization (`founded_by` unique, no FK) and the Founding Admin in one transaction.
  8. Answer `ORGANIZATION_CREATED`. The SPA then refreshes the session.

  GraphQL exposure of the RPC is a 19.3 deferral.
- **Onboarding (AD-24).**
  - `sessionDestination` (`features/auth/services`) is the one router for every guard.
  - Each step composes the shipped feature's components and hooks. There is no second write path, and `features/onboarding` imports no other feature's services.
  - Progress is derived from rows by `use-onboarding-progress.ts`, under each surface's own query keys. The five fact steps are done when: a band exists; a team is not archived; a shift type is not archived; a rotation assignment exists; there is more than one member.
  - Only `organizations.onboarding_dismissed` is stored.
  - "Invitation" means the shipped credential hand-off (F2).
- **Housekeeping and suspension (AD-25, AD-10).**
  - pg_cron `housekeeping` runs at 03:15 UTC and calls `private.delete_abandoned_accounts()`. It uses `skip locked`, then checks again that no `members` row exists.
  - The operator scripts are `supabase/operator/{suspend,unsuspend}-organization.sql` and `signup-report.sql`.
  - `organizations.suspended` is read only through `private.organization_live`. It is checked by member access, the token hook, the calendar feed and the reminder and notify paths.
- **Secrets and audit (AD-17, AD-11).**
  - Auth mail goes over SMTP through Resend with its own key, held only in the auth environment. Croatian templates are built from `hr.json`'s `signup.email` keys.
  - The new `organizations` columns are audited, with `founded_by` hidden. `signup_settings` and `organization_attempts` are excluded from the audit.

## UX & Interaction Patterns

- ***Prijava*** **(UX-DR62, 19.2).**
  - One field, *Korisničko ime ili e-mail*. While the entry holds `@`, Organizacija is dimmed and not sent, and the layout does not move.
  - Each identity kind has one failure message for every cause.
  - `Nova organizacija? Registriraj se` appears only on `/prijava` without a slug.
- **`/registracija` and `/potvrda` (UX-DR60, 63, 19.2).**
  - `/registracija` has a lede saying signup creates a new organization, and a Callout for existing users. It has one password field with show/hide and the live 10-character check.
  - Every valid submit lands on *Provjeri e-poštu*, which shows the typed address and *Ispravi adresu*. *Pošalji ponovno* is disabled for 60 s after each send.
  - The only other answer is the per-IP 429 alert.
  - `/potvrda` verifies only on a press of *Potvrdi*, then goes to step 1. A dead link names no address.
- **Recovery (UX-DR64, 19.2).**
  - *Zaboravljena lozinka?* shows both paths. Email identities go to `/zaboravljena-lozinka`, which gives the same neutral answer and the same throttle.
  - `/potvrda?type=recovery` sets the password on *Spremi novu lozinku*.
- **Step 1, *Nova organizacija* (UX-DR61, 66, 19.3).**
  - No app shell.
  - The slug is proposed from the typed name.
  - The device timezone is shown and must be confirmed or changed, because it is locked afterwards.
  - Locale is read-only. Leave-year start, admin name and allowance start empty.
  - `SLUG_UNAVAILABLE` offers *Koristi prijedlog* and never says who holds the slug. `TRY_LATER` keeps every value. `ORGANIZATION_NOT_CREATABLE` is never a screen: the SPA refreshes and routes.
- **Setup frame, steps 2–7 (UX-DR65, 67, 68, 19.4).**
  - No app shell. There is a top bar with *Izađi iz postavljanja*.
  - A rail headed `Korak {n} od 7` names each step's state in words. Below 640 px it becomes a progress card with a *Svi koraci* sheet.
  - The forward control reads *Preskoči za sada* until the step's fact exists, then *Dalje: {step}*. Steps open in any order.
  - Each unfinished step shows one Callout with neutral examples (`Ekipa 1`, `Jutarnja`/`Odmor`).
  - Step 5 lists its missing prerequisites as links.
  - Step 7 summarizes all steps, with no celebration.
- ***Danas*** **card and empty states (UX-DR69, 70, 19.4).**
  - `Postavljanje: još {n} koraka` is the first card, above *Treba tebe*, and shows only under AD-24's conditions.
  - *Sakrij* asks one neutral confirmation and hides the card for every admin.
  - The card is never the skeleton.
  - In a fresh organization, empty states name setup as the reason.
- **Open items (founder).**
  - O1 is done in 19.2: the placeholder now reads `npr. naziv-organizacije`.
  - O2: whether `/registracija` needs a terms or privacy link before production.
  - O3: 19.4 must clear pre-selected defaults in the shared add dialogs (shift-type kind and times, rotation *Vrijedi od*, member level), which changes them everywhere.

## Cross-Story Dependencies

- **Story order.** 19.1 → 19.2 → 19.3. Both 19.4 and 19.5 follow 19.3. 19.4 also needs the founder to accept the UX review.
- **Staging (epic 20).** The Kong and GoTrue work builds on 20.1's compose (`deploy/coolify/supabase/`) and `test/self-hosted-stack.test.ts`. Applying the epic on staging, the probe runs, and the IPv4/IPv6 client-address checks belong to 20.5.
- **Shipped surfaces.** The wizard reuses the shipped hour-band, team, shift-type, rotation and member surfaces. 19.5 extends the feed, reminder and notify paths from epics 16 and 17 for suspension.
- **Before production.** These must be recorded first:
  - F2 (what "invitation" means);
  - review rows A10 (the accepted denial of service) and B8 (the password-timing residual);
  - the second-factor decision for email identities;
  - O2;
  - the D-S5 checklist (section H of `SECURITY-REVIEW-EPIC-19.md`).
