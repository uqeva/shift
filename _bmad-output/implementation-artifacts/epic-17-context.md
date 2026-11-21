# Epic 17 Context: A member who asks is reminded before their shift

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member who opts in is reminded of their own upcoming shift, the evening before or a few hours ahead, by push or email. Nobody else hears about it, and a member who never asked gets nothing. A reminder is the one notification that no request asserts. A cron-invoked `remind` Edge Function therefore computes it from the canonical server-side projection (16.2's assembly and R12) close to when it falls due, and writes it to the existing outbox. `notify` then delivers it without computing anything. Architect pass 1 is done, and the founder ratified D-S6 (the reminder channels) on 2026-11-21. Epic 16 has merged (through 16.5, #345), so each story now waits only on the one before it.

## Stories

- Story 17.1: A member chooses their reminders
- Story 17.2: The `remind` job writes reminders that fall due
- Story 17.3: Reminders reach the member by push or email

## Requirements & Constraints

- **Opt-in (D4).** Reminders are off until the member turns them on, and no row means off. The member picks at most two leads from a fixed list: 1, 2, 3, 6 or 12 hours before the shift starts, or the evening before at 20:00 in the organization's timezone.
- **Own write, not audited.** The setting is the member's own write, and only their own row can be written. It is not recorded in the change history, like the other notification preferences.
- **Channels (D-S6).**
  - Push is the default channel and follows the existing push switch.
  - Email reminders need their own switch, off by default, on top of the member's email switch, a recorded address and the organization's email switch.
  - A member with no usable channel is told so in words on the settings screen, and gets nothing.
- **Freshness (D5).** A reminder is computed from the schedule as it stands at most 15 minutes before it is due (in practice at most 5 minutes ahead). A reminder already sent is never retracted. A later change to the shift is covered by the existing change notifications.
- **At most once.** Each reminder is sent at most once per shift, lead and channel, however runs overlap (Q25).
- **Who gets one.** Reminders cover only the member's own at-work shifts (R12). An inactive member, a member with no team, or a member absent for the full day gets nothing. An admin gets reminders of their own shifts only, never of coverage. No reminder names another member, an absence or a conflict.
- **DST and midnight.** "N hours before" means N real hours before the shift's real start instant, on both DST dates too. "The evening before" is 20:00 local on the day before the shift's start date. A half day counts from the worked half's start.
- **Text.** The text names the shift type, the date, both clock times and the team, in the organization locale, and links to that day. The variants are `Sutra radiš: {smjena} {od}–{do}, {tim}` and `Za {n} h radiš: …`.
- **Copy.** It lives in the `reminders` namespace of `hr.json`. The DESIGN.md, EXPERIENCE.md and UX-DR (49, 57) lines each story changes are updated in the same change. 17.3 adds the `remind` function, its secret and its cron job to DEPLOY.md.

## Technical Decisions

- **The lead codes.** One closed set, `H1 | H2 | H3 | H6 | H12 | EVENING_BEFORE`, exported once from `packages/domain`. The table check, the RPCs, the due function and `notify`'s variant map use exactly that spelling, held equal by a root test.
- **`reminder_settings` (17.1, the AD-2 row for reminder settings).**
  - Its columns are `(organization_id, member_id, leads text[] not null default '{}', email boolean not null default false)`. It is member-owned and organization-scoped under RLS.
  - `leads` holds at most two distinct codes from the set. Reminders are on exactly when `cardinality(leads) > 0`, with no separate flag.
  - It must pass the claimless-account sweep: a claimless caller gets zero rows or a refusal.
- **`private.reminder_email_on(member)`.** One SQL predicate: an address, the reminder email switch, the member's email switch and the organization's switch. 17.1's screen reads it to show each reminder's channel, and the outbox filter reads it too.
- **AD-14, the `remind` function (17.2).**
  - The pg_cron job `remind` runs every 5 minutes and calls `private.invoke_remind()`, a copy of `invoke_notify`. That reads Vault's `remind_url` (`http://supabase-kong:8000/functions/v1/remind`, the internal network only) and its own `remind_invoke_secret`, and does nothing while either is absent.
  - The function has `verify_jwt = false` and compares the bearer secret in constant time.
  - It is a `[functions.*]` table plus a router `FUNCTIONS` entry, held equal by `test/functions-router.test.ts`. Exactly four Edge Functions exist after it.
  - **Its read** is one `service_role`-only RPC, `reminder_inputs()`. It returns the database's `now` and, per member with reminders on who is active today, their leads, the organization's zone and today, and the `member_schedule_inputs` assembly for today − 1 … today + 1. That RPC is the gate, because the assembly answers for any member id.
  - **Its computation.** It projects R12 and takes each due instant from `zone.ts`. It keeps each (shift, lead) whose due time is in `[now − 15 min, now + 5 min)` and whose shift has not started.
  - **Its write.** Its only write is through the `service_role`-only `enqueue_shift_reminders(p_items jsonb)`. Each item is `{ memberId, date, teamId, shiftTypeId, lead, start, end, startsAt }`:
    - `teamId` is the effective team after loans;
    - `start` and `end` are minutes (the worked half for a half day);
    - `startsAt` is the ISO UTC instant.
  - **Its clock.** The handler takes its clock as an argument, so the DST and midnight tests run in Vitest.
  - **Deploy order.** `remind` stays unarmed, with no `remind_url` in Vault, until a `notify` that renders `SHIFT_REMINDER` (17.3) is deployed. The functions image probe must see `remind` refuse a missing invoke secret.
- **AD-6, the due instant.** `reminderDueAt(lead, date, startMinute, zone)` (the story may rename it) lands in `packages/domain/src/zone.ts` beside `instantOf`. The runtime-parity probe adds it for both DST dates of both years. `zone.ts` is the only module that names `Intl`. A second local-to-UTC conversion anywhere is a defect.
- **AD-17, the keys.**
  - `remind`'s environment is `SUPABASE_URL`, `SHIFT_SECRET_KEY` and `REMIND_INVOKE_SECRET` only. The secret key is there only to call its two `service_role` RPCs.
  - It holds no Resend or VAPID key; those stay `notify`'s.
  - `test/key-hygiene.test.ts` asserts that the secret key appears in `admin-auth`, `notify` and `remind` only.
- **AD-18, the one exception (17.2 amends it; 17.3 delivers).**
  - **The re-check.** `enqueue_shift_reminders` re-checks, at write time, that the member is active today and still has the lead on.
  - **The key.** The RPC computes `subject_id = md5('SHIFT_REMINDER:'||member||':'||date||':'||team||':'||lead)::uuid` in SQL (`uuid-ossp` is not installed). The existing unique key `(code, subject_id, recipient_member_id, channel)` makes each reminder at-most-once.
  - **The row.**
    - Code `SHIFT_REMINDER`, with operands `{ date, teamId, start, end, startsAt, lead, leadHours, shiftTypeName, teamName }`. `leadHours` is absent for `EVENING_BEFORE`.
    - The two names are looked up in SQL at write time. No display text in `p_items` is trusted.
    - `notify` formats minutes through a `TIME_OPERANDS` set beside `DATE_OPERANDS`. It picks the variant from the lead and parses nothing.
  - **The link and footer.** The link is `/kalendar?mjesec=<YYYY-MM>&dan=<date>&danSmjena=<teamId>`. The email footer points to *Obavijesti → Podsjetnici*.
  - **Channels.** The RPC writes through the existing `private.notify_members`: active today, an address for email, a device for push. `private.filter_notification_outbox()` drops a `SHIFT_REMINDER` email row while `reminder_settings.email` is off.
  - **Claim-time settlement.** `claim_notifications` settles a `SHIFT_REMINDER` row:
    - `REMINDER_EXPIRED` once `now() >= startsAt`;
    - `REMINDER_TURNED_OFF` when the lead is gone;
    - `EMAIL_TURNED_OFF` when the email switch went off after it was queued.
  - **Push TTL.** It is `max(0, startsAt − now)`, never the default day.
  - **No retraction and no new column.** A reminder is never retracted, and the outbox gets no `send_after` column.
- **Suspension.** `reminder_inputs`, `enqueue_shift_reminders`, `private.notify_members` and `push_devices_for_send` write or send nothing for a suspended organization, through `private.organization_live`.
- **AD-1.** Nothing derived is persisted. `remind` writes only outbox rows.
- **Accepted scale risk.** `reminder_inputs` builds one assembly per member every run. Revisit it if a run passes 30 s or its read passes about 5 MB.

## UX & Interaction Patterns

- **The screen (UX-DR57)** is *Više → Obavijesti → Podsjetnici*, a section of the existing `/obavijesti` (UX-DR49). It offers:
  - up to two of `1 h prije`, `2 h prije`, `3 h prije`, `6 h prije`, `12 h prije` and `večer prije u 20:00`, off by default;
  - the channel each reminder will use, from the existing switches, or a sentence saying none is available;
  - a separate email-reminder switch.
- **Saving.** It follows UX-DR49's save-at-once pattern, with pending and failure shown.

## Cross-Story Dependencies

- 17.1 → 17.2 → 17.3, strictly in sequence. 17.1 builds on 16.2, which has merged.
- **Reused from Epic 16.** `private.member_schedule_inputs`, R12, `zone.ts`, the `deno.json` map onto `dist`, the Dockerfile and `FUNCTIONS_SOURCES` hashing, and the runtime-parity job. Epic 18's loans reach reminders through R12 and the assembly automatically.
- **Input from `deferred-work.md`, owned by 17.2.** Add `reminderDueAt` with the lead kinds and its parity-probe coverage. Make `reminder_inputs` gate `member_schedule_inputs` to active members with reminders on.
- **Extends Epic 10's pipeline.** `notify`, the outbox, `private.notify_members`, the filter and the claim.
- **Test limits.** The DB tests for the new migrations and the CI runtime-parity job are verified in CI only. 17.3's e2e uses a fake clock.
