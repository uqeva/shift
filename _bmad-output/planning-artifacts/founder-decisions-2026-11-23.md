# Founder decisions, 2026-11-23

- **Given by:** the founder, on 2026-11-23: "go with your recommendations". Each decision below is the recommendation that was open in the named artifact as it stood at `b3f37ec` (main, 2026-11-23), adopted as recommended; the wording adopted is that artifact's at that commit.
- **Recorded by:** branch `feat/founder-decisions-and-hardening` (`spec-founder-decisions-and-hardening-2026-11-23.md`), which also builds the three decisions that need code (2 A2, 5 (a), 5 (b)).
- **This ledger is the index.** Each decision is also written where it was open: `deferred-work.md`, the retro action items in `sprint-status.yaml`, `SECURITY-REVIEW-EPIC-19.md`, `ARCHITECTURE-SPINE.md`, the v2 proposal and `epics.md`. This file is public: it holds no host, address or secret.

## 1. Epic 19's UX review (#340) is accepted

`ux-designs/ux-shift-2026-11-21-signup/` is accepted as the design of 19.2–19.4.

- **F2: no email invitations.** FR-96's "Members (credentials or invitation)" means the shipped admin-issued credentials (AD-24's reading). No invitation path is built; AD-12 keeps two identity kinds. The spine's Deferred entry *Invitations by email* stays the place to revisit it.
- **O2: a terms and privacy link on `/registracija` is REQUIRED before production signup opens.** It is a D-S5 gate (`SECURITY-REVIEW-EPIC-19.md` H, item 5b), not a staging one: staging shows none. Its text and URL are the founder's and legal's; the story that adds it comes before production opening (tracked as an action item in `sprint-status.yaml`).
- **Not decided by this acceptance:** the items 19.3 and 19.4 left with the founder in `deferred-work.md` (the `/potvrda` D2 half, the *Sati* empty state, the rotation builder's *Novi korak* picker). They stay open there.

## 2. Epic 16 (calendar feed)

- **A1: 16.5's accepted risks are signed off.** The feed token stands in *Dodaj u Google kalendar*'s `cid` link (the new tab's history, and Google, which receives the link anyway as the subscriber), and *Kopiraj* puts the link in the OS clipboard and any clipboard history. The app persists it nowhere.
- **A2: the calendar feed is limited to 120 requests a minute per client IP, on that route only.** Built: Kong's `rate-limiting` on its own route, `functions-v1-calendar-feed` (`deploy/coolify/supabase/docker-compose.yml`), `minute: 120`, `limit_by: ip` (the address Kong resolves through 19.1's client-IP chain), `policy: local`, `hide_client_headers: true`; every other function stays unlimited. Pinned by `test/self-hosted-stack.test.ts`. Still open with 20.5: confirming on the running stack that Kong sees each client's own address.

## 3. Epic 18 (loans)

- **A1: the member-wide loan read is ratified.** `calendar_team_loans()` gives every active member each live loan's member, team and dates, never its reason or author, because every member's derived rosters already reveal those facts (R11.2). The PRD line, 18.2's epic AC and `epic-18-context.md` are amended to say so.
- **A2: the terminology stays as it is.** *Smjena* is the team's label (the Smjene screen, `history.field.team`); *tim* is loan prose (`posudba iz tima {tim}`, `U timu {tim} …`). `Smjena: Smjena C` beside a loan's *tim*, and `smjene.error.lentTo`'s *Tim*, are accepted. Closed; no copy story.

## 4. Story 19.5 (housekeeping and suspension): accepted as built

- Automatic deletion of abandoned accounts: email identities only, never a banned account, never a member or a `founded_by`; unconfirmed accounts 7 days after the last link, confirmed ones 30 days after confirmation; and the circuit breaker (no deletion at all above seven times `accounts_per_day` candidates, `HOUSEKEEPING_HALTED`).
- Revoked feed tokens are kept.
- `organization_attempts` is purged after 30 days.
- Suspension is visible to members afterwards only as two organization history entries with no field shown.

## 5. Epic 17 A3 (reminders)

- **(b) A member whose auth account is banned or deleted gets no reminders.** This reverses 17.2's Design Note 9. Built: migration `0075_reminders_need_a_live_account.sql` re-creates `reminder_inputs` and `enqueue_shift_reminders` with the calendar feed's account check (`deleted_at is null`, `banned_until` null or passed), word for word 16.3's; a scaffold pin diffs both against 0073, and `test/shift-reminders.test.ts` proves it on CI's stack. Every other notification still follows `notify_members`' rule.
- **(a) The Vault secret never reaches the database log.** Built: DEPLOY.md §3a (notify), §3b (remind) and §9.5 load an invoke secret as the one data row of a `COPY … FROM STDIN` into a temporary table and call `vault.create_secret((select value from arming), …)`. No statement the server receives holds the value, so `log_min_error_statement`, `log_statement = all`, `pg_stat_activity` and `pg_stat_statements` never see it. Why each alternative was not used is in DEPLOY.md §3a, *A secret never enters a statement*. Pinned by `test/self-hosted-stack.test.ts`, which runs every arming block under bash.

## 6. The GitHub repository stays public

Free CI is kept. Nothing secret is in it: no keys, no host addresses, no CIDRs. The orchestrator's gitleaks scan before every push and the repository's key-hygiene tests stay the guard.

## Built alongside (dev hardening, not founder decisions)

- **Epic 17 A4, in part:** migration `0076_names_refuse_control_characters.sql` refuses a control character inside a team's or a shift type's name (`teams_name_characters`, `shift_types_name_characters`), after folding any existing row; the web app refuses it before sending (`smjene.error.control`, `rotation.shiftTypes.error.nameControl`). Member names, which also reach email subjects, stay open.
- **Story 20.4's deferred pg_net revoke: not built.** Review found that a migration (run as the demoted `postgres`) cannot revoke grants `supabase_admin` made; it stays open in `deferred-work.md` as an operator step for 20.5.
