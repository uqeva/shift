---
title: "16.5 A member subscribes from Kalendar na mobitelu"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: '71837c9c63d58cd29e3345655764bf5a3a5516d7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

Status: review (built, review 1's patches applied, CI pending). DONE MEANS MERGED WITH GREEN CI: the frontmatter stays `in-review` and the sprint status `review` until the PR merges green (approved unattended under the founder's standing instruction; ~2.4k tokens, kept whole: one user goal across layers). Baseline: `main` at #344 (19.2), after 16.4 (#343). Touches hot files (`chrome.tsx`, `hr.json`, the structural pin tests), so it starts from that merge and nothing else that changes them runs beside it. No migration.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 16.3 and 16.4 issue a member's feed token and serve the feed, but no screen creates, shows, regenerates or turns off the link, no admin can see or turn off a member's feed, the change history reads token events as a generic record, and no month can be downloaded as `.ics` (FR-80, FR-82; UX-DR54, UX-DR55; AD-20).

**Approach:** A route `/kalendar-na-mobitelu`, a fixed row in *Više* and the profile menu (as *Obavijesti*), over 0067's five RPCs: create shows the URL once (masked, *Prikaži*, *Kopiraj*), the Google and Apple buttons and their phone steps, a personal-and-secret warning; regenerate and turn off behind confirmations; the last fetch; the two fixed notes. A month download serializes R12 from the browser's own assembly with `calendarOf` (`@shift/ics`, `DOWNLOAD_UID_DOMAIN`). The member page gains the admin's *Kalendar na mobitelu* card. History names the record. The feed gains refresh hints (AD-20 amended).

## Boundaries & Constraints

**Always:**
- The token exists only in the component's memory from the create answer until the page is left; never in the query cache, storage, the URL, a log or an error. Every later visit shows the state only (`live`, `created_at`, `last_fetched_at`).
- Feed URL: `<VITE_SUPABASE_URL>/functions/v1/calendar-feed/<token>.ics`; Apple `webcal://` of it; Google `https://calendar.google.com/calendar/r?cid=<webcal URL, encoded>`. *Kopiraj* copies the https URL.
- Masked by default: the origin and `…/calendar-feed/` shown, the token as dots until *Prikaži*.
- Regenerate and turn off each confirm first; the warning says the old link stops working at once. Writes gated offline (`useWriteGate`).
- Admin card: `Kalendar na mobitelu: uključen / isključen` from `member_calendar_feed_status`, *Isključi poveznicu* (confirmed) only while on; never a URL or token.
- Download: `scheduleInputsOfCalendar(snapshot, leaveRecordsOf(rows, viewer), month)` → `atWorkShiftsOf` → `calendarOf({ uidDomain: DOWNLOAD_UID_DOMAIN, window: month, stamp: now })`; file `shift-<YYYY-MM>.ics`, `text/calendar`. No second serializer, no new runtime dependency.
- Copy in `hr.json`'s `feed` namespace (the nav row's too) and `history.record.calendarFeed`; a team is *Smjena*; gender-neutral.
- Required inputs from `deferred-work.md` answered in Design Notes, their entries marked.

**Ask First:** none (founder: decide and record, no questions).

**Never:** a migration or SQL change; the token in any persisted place; showing the URL on a later visit; an admin reading the URL; leave, absence types or others in the download; running DB tests, e2e, `supabase` or docker containers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No feed | `live:false` | sentence + *Izradi poveznicu* | none |
| Create | press | URL masked, *Prikaži*/*Kopiraj*, Google/Apple, steps, warning; state live, `još nije preuzeto` | refusal → notice, nothing shown |
| Revisit | `live:true` | state, last fetch, "shown once" note, *Izradi novu poveznicu*, *Isključi*; no URL | none |
| Regenerate | confirm | new URL shown once; old dead | refusal → notice, state re-read |
| Turn off | confirm | `live:false` screen | as above |
| Status read fails | offline / error | message + *Pokušaj ponovno*; download still offered | none |
| Copy | no clipboard | "copy not available, select it" notice | none |
| Download | month with a night on the last day, a half day, leave | `.ics` from R12; night ends next day | assembly refused → notice, no file |
| Admin | member on / off | `uključen` + *Isključi poveznicu* / `isključen` | refusal → notice |

## Epic AC Deviations

- "the URL masked by default with *Kopiraj*, *Dodaj u Google kalendar*, *Dodaj u Apple kalendar*" for "a member with a feed" — **narrowed**: only stored as a hash (D-S1, FR-80 "shown once at creation … only while they view it"), the URL and both buttons appear only right after creating or regenerating; a later visit shows the state and says a new link is needed to add it again.
- "*Dodaj u Google kalendar*" — **reinterpreted**: Google's phone app cannot subscribe by URL, so the button opens Google Calendar on the web with the URL prefilled, and the steps say how; FR-80 asks for "the steps for Google Calendar".

</frozen-after-approval>

## Code Map

- `packages/ics/src/calendar.ts` -- feed-only `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H` after `X-WR-TIMEZONE` (`uidDomain === FEED_UID_DOMAIN`); goldens rewritten (`UPDATE_GOLDEN=1`); tests: the download has neither, a DST-gap and repeated-hour start written as nominal wall time.
- `packages/domain/src/history.ts` -- `calendar-feed` record, `calendar_feed_tokens` in `RECORD_OF_TABLE` and `AMEND_KEYS` (`member_id`); `packages/domain/test/history.test.ts`.
- `apps/web/src/features/history/services/history-rows.ts` -- `history.record.calendarFeed`.
- `apps/web/src/features/calendar-feed/` (new) -- `services/feed.ts` (RPC reads/writes, state parse, URLs, mask; pure, tested), `services/month-download.ts` (pure, tested), `utils/copy.ts`, `utils/element-ids.ts`, `hooks/use-calendar-feed.ts`, `hooks/use-member-calendar-feed.ts`, `hooks/use-month-download.ts`, `components/feed-card.tsx`, `components/month-download-card.tsx`, `components/member-feed-card.tsx`.
- Reuse: `useCalendarSnapshot` (`calendar/hooks`), `scheduleInputsOfCalendar` (`calendar/services/schedule-inputs`, made public), `monthHeaderOf`/`calendarTodayOf` (`calendar/utils/month`), `myLeaveRecordsQueryOptions`/`leaveRecordsOf` (`leave/services/leave-list`), `MonthNav`, `CredentialLine`'s copy pattern, `ConfirmDialog`, `Notice`, `useWriteGate`, `readSupabaseEnvironment(buildEnvironment)`.
- `apps/web/src/pages/kalendar-na-mobitelu.tsx` (new), `router.ts`, `pages/ljudi.$id.tsx` (the admin card after *Status*).
- `features/navigation/utils/destinations.ts` (`CALENDAR_FEED_PATH`), `components/chrome.tsx` (row after *Obavijesti*, sheet and profile menu).
- `apps/web/{package.json,vite.config.ts,vitest.config.ts,tsconfig.json}`, `eslint.config.js` (`FEATURE_PUBLIC`), `pnpm-lock.yaml` -- `@shift/ics` alias (source), workspace dependency.
- `hr.json` -- `feed` namespace; `history.record.calendarFeed`.
- Pins: `router.test.ts`, `pages/structural-pins-shell.test.ts`, `source-guards.fixture.ts`, `test/localization-applied.test.ts` and whatever the sweeps name.
- Docs: `EXPERIENCE.md`, `DESIGN.md`, `epics.md` UX-DR31/32/33/54/55; spine AD-20 amended; `deferred-work.md`; `sprint-status.yaml`; the 16.4 spec rewritten as merged.
- Mappers (A11): no row gains a column.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ics/**` -- refresh hints, goldens, gap tests.
- [x] `packages/domain/src/history.ts`, its test, `history-rows.ts` -- the named record, regenerate as one *izmijenjeno*.
- [x] `apps/web/src/features/calendar-feed/**` + tests -- services, hooks, components.
- [x] page, router, chrome, destinations, member page, `hr.json`, configs, lockfile.
- [x] pin tests updated; `e2e/` grepped for the *Više* sheet's and profile menu's rows (A CHANGE TO WHAT A SURFACE SHOWS) and updated.
- [x] `e2e/tests/calendar/kalendar-na-mobitelu.spec.ts` (new, written unrun) -- a member creates, sees the URL once, the feed answers 200 for it, regenerates (old 404), turns off; an admin's card shows `uključen` then turns it off.
- [x] docs, spine, deferred-work (sprint-status and the 16.4 spec rewrite are the orchestrator's, outside this implementation).
- [x] Render the screens (harness) and open a real downloaded `.ics`.

**Acceptance Criteria:**
- Given a created link, when the page is left and reopened, then no part of the token is anywhere on the screen or in the query cache.
- Given a month download and the feed for the same member, when both are serialized over the same dates, then their events differ only in the UID domain and `DTSTAMP`.

## Spec Change Log

- 2026-11-21 (implementation) — decisions taken inside the frozen intent, none of which changes it:
  - **The last fetch's zone** (as revised by review 1). Design Note 7 said "the organization's zone (the snapshot's), else the device's". The device's zone is refused by the app's L8 rule: `format.ts` is the one module that may touch `Intl`, and `format.test.ts` forbids a device-zone default. So the line is told in the calendar snapshot's zone; while that zone is unknown or cannot be rendered it says only `Poveznica je preuzeta.`, with no time, never a silent fallback zone.
  - **The Google button opens a new tab** (`target="_blank"`, `noopener noreferrer`): leaving the page in the same tab would forget the link shown once. The Apple `webcal://` link hands off to the phone's calendar and leaves the page in place.
  - **The two fixed rows are one `<Link>`** over a `FIXED_ROWS` table in `chrome.tsx` (*Obavijesti*, then *Kalendar na mobitelu*), so the chrome still renders its non-destination rows from one element; `structural-pins-shell.test.ts` pins the table's order.
  - **The copy avoids `smjen`**: the omits note says "dane kad radiš" rather than naming the shift or the team, so the `feed` namespace needs no exemption in the team-term sweep; *Smjena* stays the team's word wherever it is said (the calendar's own SUMMARY is data).
  - **The copy-failure line** is a `Notice role="status"`, as the credential line's `Kopiranje nije uspjelo. Zapiši lozinku.` is.
  - **Stage names and literals live in `services/feed.ts`** (`FEED_IDLE` … `FEED_TURNING_OFF`, `NEW_TAB_LINK`) and the browser download in `utils/save-file.ts`, so the screen files hold no string literal the literal sweep would refuse.
- 2026-11-21 (review 1) — patches applied:
  - **The shown link.** While this visit holds a link the view is live (`feedViewOf(read, holdsLink)`), so *Izradi poveznicu* is never offered beside it, and create waits while the state read is in flight. The link is keyed by its URL, so a regeneration in the same visit starts masked with no earlier copy notice. ANY failed create, regenerate or turn-off — a refusal or an unavailable answer — drops the shown link and re-reads the state, so a possibly revoked link never stays on screen. A build with no usable project URL asks for no token (`isFeedProjectUrl`) and says the link is unavailable, so an issued token is never left unshown.
  - **Focus and refusals.** A landed create or regenerate moves focus to the link's heading (`tabIndex={-1}`), a landed turn-off to the card's, and the admin's turn-off to its card's heading. A refused regenerate, turn-off or admin turn-off keeps its confirmation open with a `Notice role="alert"` above its buttons (EXPERIENCE.md's dialog rule). `CALENDAR_FEED_REFUSED` says `Ovu poveznicu ne možeš promijeniti.`, with no "Pokušaj ponovno"; the admin card's read refused or naming an unknown member says so with no retry, and only an unavailable read offers one. The admin's *Isključi poveznicu* arms nothing offline or while the link is not live.
  - **The month download.** A month with no working day makes no file and says `U tom mjesecu nemaš radnih dana, pa nema što preuzeti.`; any other failure shows the failure line. Offline with nothing held (a read paused or failed) it says the schedule cannot be loaded, with a retry, never a button disabled for good (`monthDownloadReadinessOf`). The month control reaches twelve months either side of the current one, its ‹ › stopped at both ends and the reach said in the lede; a month the picker names past it is not taken. The success line says the download started (`Preuzimanje je pokrenuto: {file}`).
  - **The masked URL** hides its dots from screen readers and says `Poveznica je skrivena.`; the warning stays first in reading order and describes *Prikaži* and *Kopiraj*.
  - **No feed** is exactly one sentence (`feed.lede`) and *Izradi poveznicu*; the two fixed notes show only with a link, the just-created one included. UX-DR54, EXPERIENCE.md and DESIGN.md say so.
  - **Pure transitions.** The writes' state changes are `services/feed.ts`'s (`feedWriteStarted`, `feedWriteSettled`, `feedArmed`, `feedCancelled`, `memberFeedArmed`, `memberFeedSettled`), executed by `feed.test.ts`; `lastFetchedLineOf` is tested with Zagreb's real wall time and an unknown zone; `month-download.test.ts` covers the empty month, the reach and the readiness. The e2e spec (unrun) leaves in-app through *Više* and returns, regenerates twice in one visit and checks the link is masked again, and reads the downloaded file.
  - **The epic AC auditor's two minor unlisted points**, recorded here without touching the frozen block: the history record's label lives in `history.record.calendarFeed` by the history's convention, while the epic asks for the copy in the `feed` namespace (the screen's copy is all there); and the no-feed state was fixed to one sentence (above).

## Design Notes

Decisions (founder: decide and record):
1. **Route** `/kalendar-na-mobitelu`, a fixed row (`CalendarPlus`) after *Obavijesti* in *Više* and the profile menu, never a destination; every role.
2. **History** (16.3 deferral): record `calendar-feed`, *Kalendar na mobitelu*; created *dodano*, turned off *uklonjeno*; a regeneration (UPDATE removal + INSERT, one transaction) pairs through `AMEND_KEYS` on `member_id` into one *izmijenjeno* entry.
3. **Refresh hints** (16.4 deferral): adopted for the feed only, `PT1H` each (Apple/Outlook poll; Google ignores them); AD-20 amended. The download carries none (a one-off import).
4. **DST gap / repeated hour** (16.4 deferral): the serializer writes the nominal wall time; RFC 5545 §3.3.5 reads a gap time with the offset before it and a repeated one as the first, `zone.ts`'s own rule, so the client and the app agree. Pinned by tests; no pilot type starts 02:00–03:00. The real-client look joins 20.5's Outlook check.
5. **Month download** (16.4 deferral): `calendarOf` with `DOWNLOAD_UID_DOMAIN`, the month as the window, R12 from the browser's adapter; `apps/web` gets the `@shift/ics` source alias. `Shift`, `PRODID` and the `·` separator stay copy-free names.
6. **Masking** is display only (shoulder-surfing); the token never leaves memory.
7. **Copy outline** (the implementer writes it in `feed.*`): the no-feed sentence (your shifts in Google or Apple Calendar on the phone; add once, it refreshes itself); the warning (*Poveznica je osobna i tajna*: whoever has it sees your shifts; do not send it to anyone; it is shown only now); Google steps (copy the link; open calendar.google.com in a browser, the phone app cannot add a calendar by link; *Ostali kalendari* → + → *Iz URL-a*; paste, *Dodaj kalendar*; the *Shift* calendar then appears in the app, turn on its sync if hidden); Apple steps (on the iPhone press *Dodaj u Apple kalendar* and confirm *Pretplati se*; or *Postavke → Kalendar → Računi → Dodaj račun → Ostalo → Dodaj pretplaćeni kalendar* and paste); the fixed note, verbatim from the v2 proposal: `Google kalendar osvježava pretplate rjeđe — promjene se mogu pojaviti i do dan kasnije. Shift je uvijek točan.`; the omits note (only the shifts you work, with start and end; no leave or absence, no other people); the revisit note (the link is shown only once; to add it on another phone create a new one, which stops the old); turn-off note (a calendar that used it stops updating; remove the subscription there). Last fetch `Zadnje preuzimanje: {datum} u {vrijeme}` / `Još nije preuzeto.` in the organization's zone (the snapshot's), else the device's.
8. **The admin card** sits after *Status* on `/ljudi/$id`, its own read (`member_calendar_feed_status`) and write; a refusal shows the members feature's refusal style; the page's offline note covers it.
9. **Offline** (implementation): `/kalendar-na-mobitelu` is not added to `OFFLINE_READABLE_PATHS`, on `/obavijesti`'s terms, and neither feed key is persisted (`persistsKey` is an allowlist). Offline the state read fails into its message and *Pokušaj ponovno*, every write is gated, and the download still builds from the device's snapshot. Whether a cold offline start should open the route is recorded in `deferred-work.md` for the epic's retrospective.
10. **Required inputs from `deferred-work.md`** and their answers: the 16.3 entry (name the history record; regeneration as one entry) — Design Note 2, marked RESOLVED; the 16.4 month-download entry (the `@shift/ics` alias; `Shift`/separator copy-free) — Design Note 5, marked RESOLVED; the 16.4 refresh-hints and DST-gap entry — Design Notes 3 and 4, marked RESOLVED in part (a real client's look stays OWNER 20.5).
11. **Accepted risks** (review 1): the token stands in the Google button's `cid` href, so it can reach the browser's history and is sent to Google — which receives the link anyway as the subscriber; and *Kopiraj* puts the link in the OS clipboard and any clipboard history. The warning says the link is personal and secret and not to share it; the token stays out of every place the app itself persists.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test`
- the allowed DB-free root files (`localization-applied` after the build)

**Manual checks:**
- Render the screen's states and the admin card in headless Chromium (phone and desktop) and look.
- Download a real month `.ics` from a realistic fixture and read it back.

**Results (2026-11-21, after review 1's patches):**
- `pnpm typecheck` clean; `pnpm lint` clean; `pnpm build` passed.
- `pnpm --filter @shift/domain test`: 20 files, 954 passed. `pnpm --filter @shift/ics test`: 4 files, 31 passed (goldens rewritten with `UPDATE_GOLDEN=1`: each gains the two refresh lines only). `pnpm --filter ./apps/web test`: 182 files, 6814 passed.
- The ten DB-free root files (`localization-applied` after the build): 10 files, 3051 passed.
- Not run here (CI is their first run): `e2e/tests/calendar/kalendar-na-mobitelu.spec.ts` and the updated `e2e/tests/layout/phone-navigation.spec.ts` (the shared stack's rule); `test/calendar-feed.test.ts`, whose one added assertion (the feed's refresh lines) is outside the allowed local list.

**Rendered (A GENERATED FILE IS OPENED).** A DB-free harness, not committed, built the real `FeedCard`, `MonthDownloadCard` and `MemberFeedCard` with the real `index.css`, over hand-built hook states and a seeded query cache, and Playwright's headless Chromium rendered thirteen cases at 390 px and 1280 px — no link, created, created before the re-read lands, revisit, revisit with no zone, unavailable, the regenerate confirmation, the same refused, turned off, a failed create, an empty month, the month control at its lower bound, and the admin's on and off cards: no horizontal scroll and no target under 44 px in any. No link showed the one sentence and *Izradi poveznicu* alone; a link held before the re-read showed no *Izradi poveznicu*. The masked URL read `https://api.shift.example/…/calendar-feed/••••••••••••.ics` on screen and `Poveznica je skrivena.` to the accessibility tree, then the whole URL after *Prikaži*; *Kopiraj* without clipboard permission said `Kopiranje ovdje nije dostupno. …`; Google's href was `https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F…` and Apple's `webcal://…`. The revisit showed `Zadnje preuzimanje: 21.11.2026 u 18:45` (17:45Z in Zagreb), and with no zone `Poveznica je preuzeta.`. The refused regenerate kept its dialog open with `Ovu poveznicu ne možeš promijeniti.` above its buttons; the empty month said `U tom mjesecu nemaš radnih dana, pa nema što preuzeti.`; at 2025-11 the month control's ‹ was disabled.

**Downloaded and read back.** The harness's *Preuzmi .ics* downloaded `shift-2026-03.ics` through the browser's own download: the pilot rotation, the viewer on a team named `Smjena A – Središnja vatrogasna postaja Novi Zagreb-istok, Dežurstvo čćđšž` (every SUMMARY folds), March 2026 (the spring transition inside it), a full day of sick leave on 02.03. and a first-half annual leave on 06.03. Read back: 157 CRLF lines, no bare LF, none over 75 octets; one VTIMEZONE with the 2025-10-26 STANDARD and 2026-03-29 DAYLIGHT observances; 15 events, each exactly UID (`…@shift-download`), DTSTAMP, DTSTART, DTEND, SUMMARY, no refresh lines; 02.03. absent, 06.03. `13:00–19:00` (the worked second half), and 31.03.'s Noć ending `20260401T070000`. All 30 local stamps, resolved through the file's own VTIMEZONE, were formatted back to the same wall clock by Node's tz database. A third-party ICS library could not be fetched here, as in 16.4.

### Review Findings

Review 1 (2026-11-21, `bmad-build` step 4, unattended). Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Epic AC Auditor; the Unrun DB Test Auditor had nothing to audit (no DB-connecting root test changed). No intent_gap or bad_spec: every finding was fixable inside the frozen intent. 17 patched, the rest rejected.

- [x] [Review][Patch] A second *Izradi poveznicu* while the new link was shown (before the re-read) would silently regenerate it; the held link now makes the view live, and create waits for the read [feed.ts `feedViewOf`]
- [x] [Review][Patch] `FeedLink` kept *Prikaži* and the copy notice across a regenerate; keyed by its URL [feed-card.tsx]
- [x] [Review][Patch] A failed or unanswered regenerate kept a possibly revoked link on screen; any failed write drops it and re-reads [feed.ts `feedWriteSettled`]
- [x] [Review][Patch] A build without a valid project URL could issue a token it cannot show; refused before the RPC [use-calendar-feed.ts]
- [x] [Review][Patch] Focus was lost after every landed write; it moves to the link or card heading [feed-card.tsx, member-feed-card.tsx]
- [x] [Review][Patch] Refusals closed the confirmations; they stay open with an alert above the buttons (EXPERIENCE.md's dialog rule)
- [x] [Review][Patch] Permanent refusals said "Pokušaj ponovno", and the admin read showed one message for every failure; `feed.refused`, `feed.member.refused`/`unknown` without a retry; `arm()` ignored offline or not live
- [x] [Review][Patch] An empty month saved an empty file as "Preuzeto"; no file, `feed.download.empty`; any failure has its notice; an offline cold read shows a retry, not a dead button
- [x] [Review][Patch] The month control reached 0001–9999; bounded to the current month ±12, stated in the lede; the success line says the download started
- [x] [Review][Patch] The last fetch fell back to UTC silently; with no zone it reads "Poveznica je preuzeta." with no time
- [x] [Review][Patch] Screen readers read twelve bullets and missed the warning; bullets `aria-hidden` with sr-only "Poveznica je skrivena.", the warning first and describing the two controls
- [x] [Review][Patch] Epic AC 1 (one sentence with no feed) was partly met, unlisted; the lede is one sentence and the two notes show only with a link
- [x] [Review][Patch] Verification gaps: the write transitions lifted into pure functions and tested (refused/unavailable create, regenerate, turn-off; regenerate after create; admin), `lastFetchedLineOf` with a real zone, the empty month and the reach; e2e leaves in-app and returns (not only a reload), regenerates twice masked, reads the downloaded file
- [x] [Review][Patch] The spec cited local scratchpad paths in a public repository; removed. The token in Google's `cid` href and the clipboard recorded as accepted risks (Design Note 11)
- [x] [Review][Patch] The member page's doc comment reflowed
- Rejected: the lockfile and goldens "missing" (left out of the review diff on purpose, they are in the change); the feed query key unscoped by person (every per-person key in the app is constant, and sign-out clears the cache); an *izmijenjeno* calendar-feed entry with no field (the audit row holds nothing else to show, by 0067's recorder); UX-DR33's opening count (the line has said "24 … brings it to N" since 16.1, by the same pattern); a separate 16.5 security review (no credential logic changed server-side; the epic's `security-review` before production stays as recorded in deferred-work).

## Suggested Review Order

**The one-time link**

- Entry point: the hook holds the token in memory only and sends writes.
  [`use-calendar-feed.ts:63`](../../apps/web/src/features/calendar-feed/hooks/use-calendar-feed.ts#L63)

- A held link counts as live, so create is never offered beside it.
  [`feed.ts:450`](../../apps/web/src/features/calendar-feed/services/feed.ts#L450)

- Every failed write drops the shown link and asks a re-read.
  [`feed.ts:365`](../../apps/web/src/features/calendar-feed/services/feed.ts#L365)

- https, webcal and Google URLs from the project URL; the mask.
  [`feed.ts:236`](../../apps/web/src/features/calendar-feed/services/feed.ts#L236)

- The card: states, warning, phone steps, confirmations, notes.
  [`feed-card.tsx:55`](../../apps/web/src/features/calendar-feed/components/feed-card.tsx#L55)

**The admin and the history**

- State only, never a URL; turn-off behind a confirmation.
  [`member-feed-card.tsx:34`](../../apps/web/src/features/calendar-feed/components/member-feed-card.tsx#L34)

- A regeneration pairs into one *izmijenjeno* on the member.
  [`history.ts:315`](../../packages/domain/src/history.ts#L315)

**The serializer**

- Month download: the browser's assembly, R12, `calendarOf` with the download UIDs.
  [`month-download.ts:67`](../../apps/web/src/features/calendar-feed/services/month-download.ts#L67)

- Refresh hints on the feed only (AD-20 amended).
  [`calendar.ts:85`](../../packages/ics/src/calendar.ts#L85)

**Wiring and tests**

- The fixed row after *Obavijesti*, in *Više* and the profile menu.
  [`chrome.tsx:230`](../../apps/web/src/features/navigation/components/chrome.tsx#L230)

- Pure tests of the transitions, URLs and last fetch.
  [`feed.test.ts`](../../apps/web/src/features/calendar-feed/services/feed.test.ts)

- The e2e path, written unrun.
  [`kalendar-na-mobitelu.spec.ts`](../../e2e/tests/calendar/kalendar-na-mobitelu.spec.ts)
