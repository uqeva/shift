---
title: "17.1 A member chooses their reminders"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: '83804393643bf966769d014f75be7f5b9190c459'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

Status: review (built, review 1's patches applied, CI pending). DONE MEANS MERGED WITH GREEN CI: the frontmatter stays `in-review` and the sprint status `review` until the PR merges green. ~2.1k tokens, kept whole: one user goal across layers. Approved unattended under the founder's standing instruction (decide and record, no questions). Baseline: `main` at #345 (16.5), which touched `hr.json` and the structural pins; nothing else that changes them runs beside it. Migration `0069`. Residual risks: the DB suites (`test/reminder-settings.test.ts`, the edited `provisioning` and `rls-isolation` cases, the claimless sweep over `0069`) and both e2e specs have never run (CI is their first run); the card's phone and desktop layout has not been looked at in a browser (headless Chromium cannot start on this machine), only rendered to static markup.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-26 needs a member's own reminder choice before `remind` (17.2) can write anything, and no table, rule or screen holds it (FR-85, FR-65, UX-DR57, D-S6).

**Approach:** Migration `0069` adds `reminder_settings` (AD-18's row: `leads text[]` of at most two distinct codes from the closed set, `email boolean default false`), own-row RLS on 0044's terms, `private.reminder_email_on(member)` (AD-18's one email predicate) and `public.reminder_channels()`, the caller's own `{push, email}`. The lead codes are exported once from `@shift/domain`. `/obavijesti` gains a *Podsjetnici* card: six switches (at most two on), the email-reminder switch, and the channel the reminders will use or, in words, that none is available.

## Boundaries & Constraints

**Always:**
- Lead codes `H1 | H2 | H3 | H6 | H12 | EVENING_BEFORE`, exported once from `packages/domain` (`REMINDER_LEADS`, `MAX_REMINDER_LEADS = 2`); the `0069` check spells exactly that set, held equal by a DB-free root pin.
- No row = off, email off (D4, D-S6). On ⇔ `cardinality(leads) > 0`; no separate flag. Leads are stored in `REMINDER_LEADS` order.
- Own row only: select/insert/update policies as `notification_settings` (claim + active `current_member_access()` + `auth_user_id`); insert grant `(organization_id, member_id, leads, email)`, update `(leads, email)`; no delete; `anon` nothing. Writes are update-then-insert, never an upsert (0044's reason).
- `reminder_email_on(member)` = recorded non-blank address ∧ member's `notification_settings.email` (no row: on) ∧ `organizations.email_notifications` ∧ `reminder_settings.email` (no row: off). `reminder_channels()` answers `{push: ≥1 own device, email: reminder_email_on}`; raises 42501 `REMINDER_SETTINGS_REFUSED` for a caller who is not an active member of the claimed organization (the claimless sweep's refusal).
- Not audited (FR-85, FR-78 amendment): named excluded in AD-11 and the scaffold pin; no history record.
- Copy in `hr.json`'s `reminders` namespace; leads read `1 h prije` … `12 h prije`, `večer prije u 20:00`; gender-neutral; writes gated offline (`useWriteGate`), saved on change like the screen's other controls.
- Spine: AD-2 gains the row (current-state); AD-18 and AD-11 amended for 17.1 as shipped; UX-DR49/57, EXPERIENCE.md, DESIGN.md updated.

**Ask First:** none (founder: decide and record).

**Never:** `reminderDueAt`, `reminder_inputs`, `enqueue_shift_reminders`, the outbox filter or claim changes, `remind` or `notify` (17.2/17.3); an admin reading another member's row; running DB tests, e2e, `supabase` or docker containers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Never opened | no row | all six off, email-reminder off, "reminders are off" | none |
| Choose | turn on `večer prije` then `2 h prije` | row `{H2, EVENING_BEFORE}`; status line | refusal → notice, control returns to stored |
| Third | two on | the other four `aria-disabled`, a line says at most two; a press does nothing | none |
| Channels | push device / reminder email on / both / neither | names the channel(s); neither: says in words none is available and how to turn one on | channel read fails → line omitted, card still works |
| Email switch on, email unreachable | no address or email off | says email reminders cannot be sent and why | none |
| DB | 3 leads, a duplicate, an unknown code, another member's row | check violation / RLS refusal | 23514 / 42501 |
| Offline | no connection | controls inert, offline note | none |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0044_notification_settings.sql` -- the pattern: table, three own-row policies, column grants, `private.touch_notification_settings()` (reused by the new touch trigger, generic body).
- `supabase/migrations/0067_calendar_feed_tokens.sql:380` -- own-member definer read pattern (`calendar_feed_status`), refusal shape.
- `supabase/migrations/0045_push_subscriptions.sql:43` -- `push_subscriptions(organization_id, member_id, …)`: a device.
- `supabase/migrations/0045_push_subscriptions.sql` `notify_members` email rule: `m.email is not null and btrim(m.email) <> ''`.
- `packages/domain/src/index.ts` -- export the new `reminders.ts`.
- `apps/web/src/features/notifications/services/settings.ts` -- read/write shape to mirror (`firstRow`, update-then-insert, 23505 retry, 42501 → refused).
- `apps/web/src/features/notifications/{hooks/use-notification-settings.ts,hooks/use-push-settings.ts}` -- invalidate the reminders key after a landed write (the channel line follows).
- `apps/web/src/pages/obavijesti.tsx` -- third card.
- `apps/web/src/components/ui/switch.tsx` -- the control (read only; hot file untouched).
- Pins: `test/supabase-scaffold.test.ts` (`AUDIT_EXCLUDED`, policy-name list ~582), `test/provisioning.test.ts` (RLS table list ~700, privilege case beside 0044's ~791, function inventories ~2757/2961/3056), `test/rls-isolation.test.ts` (policy list ~1001).
- `e2e/utils/database-helper.ts` -- the FK is `on delete cascade` to `members`, and e2e removes members only by deleting the organization, so cleanup needs no new delete; add a hold/restore helper for the new e2e spec.
- Mappers (A11): no existing row gains a column.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/reminders.ts` (+ index, test) -- `REMINDER_LEADS`, `ReminderLead`, `MAX_REMINDER_LEADS`, `isReminderLead`, `reminderLeadsOf(unknown)` (canonical order, dedupe, or null).
- [x] `supabase/migrations/0069_reminder_settings.sql` -- table, checks, policies, grants, touch trigger, the two functions, grants.
- [x] `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts`, `test/rls-isolation.test.ts` -- pins (lead set equals domain's; excluded from audit; grants; inventories).
- [x] `test/reminder-settings.test.ts` (new, DB, unrun) -- defaults, own-row read/write, refusals, checks, channels for each case; scenes as owner before `actAs`.
- [x] `apps/web/src/features/notifications/services/reminders.ts` (+ test), `hooks/use-reminder-settings.ts`, `components/reminder-settings-card.tsx`, `utils/element-ids.ts`; page; invalidations; `hr.json` `reminders`.
- [x] `e2e/tests/notifications/reminders.spec.ts` (new, unrun) + helper.
- [x] Docs: spine AD-2/AD-11/AD-18, `epics.md` UX-DR49/57, EXPERIENCE.md, DESIGN.md, `deferred-work.md` (17.2 entries).

**Acceptance Criteria:**
- Given a member with two leads on, when another member (or an admin) selects or writes that row, then they read zero rows and their write changes nothing or is refused.
- Given the domain's `REMINDER_LEADS`, when the scaffold pin reads `0069`, then the check's set is exactly that list.

## Design Notes

1. **Place:** *Podsjetnici* is the third card on `/obavijesti`, after *E-pošta* and *Obavijesti na uređaju* (it names both); no sub-route.
2. **Control:** six `Switch` rows in lead order (shortest first, the evening last), each saved on change; with two on, the rest are `aria-disabled` (never `disabled`, focus stays) and the hint says to turn one off first.
3. **Channels:** push = the member has a device anywhere (what `notify_members` uses), not only this one; the line names devices with push on and email; the email-reminder switch is always shown (it is the member's stored choice), and when on but unreachable the line says email reminders are not sent and points at *E-pošta*.
4. **The filter and claim** (`filter_notification_outbox` dropping `SHIFT_REMINDER` email rows on `reminder_email_on`, `REMINDER_TURNED_OFF`) land with the first reminder row, in 17.2/17.3; recorded in `deferred-work.md` OWNER 17.2.
5. **Required input** (`deferred-work.md`, 16.2 entry OWNER 17.2, "the lead kinds 17.1/17.2 define"): 17.1 defines the kinds as the six codes above; `reminderDueAt` and the parity probe stay 17.2's; the entry is annotated.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test`
- the allowed DB-free root files (`localization-applied` after the build)

**Manual checks:**
- Render the card's states (phone and desktop) and look.
- DB suites (`reminder-settings`, `provisioning`, `rls-isolation`, `claimless-account`) and e2e are unrun here: CI is their first run, on its fresh stack with `0069`.

**Results (implementation and review 1, 2026-11-21).**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: clean. `pnpm --filter @shift/domain test`: 21 files, 958 passed. `pnpm --filter ./apps/web test`: 183 files, 6830 passed. The eight allowed DB-free root files (after the build): 3002 passed (2999 before review 1; the three new `reminders` keys). Re-run after review 1's patches; the static render below predates them.
- **Rendered, not looked at.** No headless browser runs on this machine (Playwright's Chromium lacks `libatk-1.0`; no system browser, and Docker is off limits), so no screenshot was taken. The card was rendered instead to static markup with the real `hr.json`, through an uncommitted harness (deleted), in nine states: never opened, two on with the status line, one on with no channel, both channels, email on but no address, a failed save, a write in flight, loading, unavailable. Seen: six switches in lead order and the email switch, each labelled by its `Label`; with two on the other four `aria-disabled="true"` and described by the limit line; in flight every switch `aria-disabled`, the email one `aria-busy`; the failure notice named by every switch; the channel line and the no-address reason worded as `hr.json` has them; no `⟦key⟧`. Phone and desktop layout (no horizontal scroll, 44 px rows) is UNVERIFIED by eye: the rows are `min-h-11` flex rows with `min-w-0` and `break-words` labels, as 13.5's switch rows are.
- **Unrun, by the STRICT DATABASE RULE:** `test/reminder-settings.test.ts` (new), the changed cases of `test/provisioning.test.ts` and `test/rls-isolation.test.ts`, `test/claimless-account.test.ts` over the new table and RPC (by reasoning: a claimless caller reads zero rows, its insert and delete are 42501, its update matches nothing, and `reminder_channels()` raises 42501 `REMINDER_SETTINGS_REFUSED`), and the e2e spec `e2e/tests/notifications/reminders.spec.ts` (new). CI is their first run.
- **e2e lock.** `settings.spec.ts` and `reminders.spec.ts` set the same member's address, email row and devices, and run in parallel workers, so both now hold `holdNotificationSettings(slug)` (the bounded advisory lock 16.5's feed specs use) for every case.

## Spec Change Log

- **2026-11-21 (review 1) — patches applied.** No change to the frozen block.
  - Copy: the card's retry and save failure are `reminders.retry` and `reminders.saveFailed` (every string of the card in `reminders`); a fifth channel line, `reminders.channelNoneEmailOn`, replaces `channelNone` while the reminder email switch is on, so the member is never told to turn on what is on (`channelMessageKey(channels, emailSwitchOn)`, unit-tested).
  - Lines: the channel line and the email-unreachable reason show only while a lead is on, no write is in flight and the channels read is not under way (the hook answers `null` while it refetches after an invalidation), so no stale line flashes; no reason is drawn while the *E-pošta* view is loading (`emailUnreachableMessageKey` answers `null`).
  - Saves: a press that changes nothing sends nothing (a lead already in that state, the email switch at its shown value). Before the write the settings read is cancelled (`cancelQueries`, exact), so an older refetch cannot land over the answer; after a failed or refused write it is invalidated, so the switches resync to what the database holds. Across tabs the last write wins: accepted, no optimistic concurrency (rejected in review).
  - `retry()` refetches the settings and the channels together. The organization's email switch (`saveEmailNotifications`) now invalidates `REMINDER_CHANNELS_KEY` too, which makes `services/reminders` a public module of the notifications feature for `organization` (`eslint.config.js` FEATURE_PUBLIC).
  - Accessibility: one `aria-busy` container holds the lead group and the email switch; no `role="switch"` carries `aria-busy`. `notificationsReminderLeadSwitchId` takes a `ReminderLead`.
  - `REMINDER_SETTINGS_REFUSED`'s doc now covers a choice refused before it is sent (more than two leads, an unknown code).
  - `0069`: a comment on `reminder_settings_leads_check` says the order clause holds order and distinctness only because the maximum is 2, and must be rewritten with any change to `MAX_REMINDER_LEADS`.
  - DB test (unrun): "is off with no row" now sets the organization's switch on and removes the member's email row, so the missing reminder row is the only reason email is off; the label "a device does not count as push" is corrected; a new case deactivates the member today (the admin's own RLS insert of a status version, as `calendar-feed-tokens.test.ts` builds it, with the row stored as the owner first) and holds that they read zero rows, change nothing, are refused an insert (42501) and refused `reminder_channels()` (42501 `REMINDER_SETTINGS_REFUSED`). There is no shared helper in `test/`; the 16.3 file's local helper is copied.
  - e2e (unrun): the channel case holds the member's devices (`holdPushDevicesInSql`, restored after), the address with no email row, and the organization's switch on; it then turns *E-pošta* off in its own card on the same page and asserts `channelNoneEmailOn` and the `emailOff` reason without a reload (pins the invalidation). A new offline case: the section's offline note, every switch `aria-disabled="true"`, a forced press sends nothing.

## Suggested Review Order

**Schema and the one email predicate**

- The member's own row: leads from the closed set, at most two, in set order.
  [`0069_reminder_settings.sql:46`](../../supabase/migrations/0069_reminder_settings.sql#L46)

- One check: shape, size, membership and order (order implies distinct).
  [`0069_reminder_settings.sql:68`](../../supabase/migrations/0069_reminder_settings.sql#L68)

- Own-row policies copied from 0044, so the scaffold pin reads them equal.
  [`0069_reminder_settings.sql:95`](../../supabase/migrations/0069_reminder_settings.sql#L95)

- AD-18's conjunction: address, member email, organization switch, reminder switch.
  [`0069_reminder_settings.sql:190`](../../supabase/migrations/0069_reminder_settings.sql#L190)

- The caller's own channels; 42501 for anyone not an active member (claimless sweep).
  [`0069_reminder_settings.sql:227`](../../supabase/migrations/0069_reminder_settings.sql#L227)

**The lead codes, once**

- The closed set and the maximum, exported from the domain.
  [`reminders.ts:19`](../../packages/domain/src/reminders.ts#L19)

- The scaffold pin holds the migration's literals equal to `REMINDER_LEADS`.
  [`supabase-scaffold.test.ts:6235`](../../test/supabase-scaffold.test.ts#L6235)

**The Podsjetnici card**

- Update-then-insert write, 23505 retry, 42501 refused, as the email setting.
  [`reminders.ts:185`](../../apps/web/src/features/notifications/services/reminders.ts#L185)

- The channel line's choice, including the variant when email is already on.
  [`reminders.ts:267`](../../apps/web/src/features/notifications/services/reminders.ts#L267)

- Save at once: cancel the read, write, resync on failure, refresh channels.
  [`use-reminder-settings.ts:63`](../../apps/web/src/features/notifications/hooks/use-reminder-settings.ts#L63)

- Six switches, at most two held, the email switch, the lines.
  [`reminder-settings-card.tsx:45`](../../apps/web/src/features/notifications/components/reminder-settings-card.tsx#L45)

- Third card on the screen, given the E-pošta view for the reason line.
  [`obavijesti.tsx:45`](../../apps/web/src/pages/obavijesti.tsx#L45)

- The other switches' landed writes refresh the channel line.
  [`use-organization-settings.ts:477`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L477)

**Tests and docs**

- DB suite, written unrun: defaults, own row, refusals, checks, channels.
  [`reminder-settings.test.ts:116`](../../test/reminder-settings.test.ts#L116)

- e2e, written unrun: off by default, two held, channels, offline, failure.
  [`reminders.spec.ts:49`](../../e2e/tests/notifications/reminders.spec.ts#L49)

- Spine: AD-2 row, AD-11 exclusion, AD-18 as shipped.
  [`ARCHITECTURE-SPINE.md:416`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L416)
