---
title: "16.4 The calendar feed serves a member's own shifts"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: 'e5f6b7faf57ee53b94c37d8542b3befb2726102b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

Status: built, CI pending (in review). Approved unattended under the orchestrator's standing instruction (~2.6k tokens, kept whole: one user goal across layers). Baseline: `main` at #342 (16.3). Touches the structural pin tests (`test/supabase-scaffold.test.ts`'s function list, `test/functions-router.test.ts`), so it runs after 16.3's merge and before any other story that changes them; no migration (19.2 may take `0068`).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 16.3 stores a member's feed token and answers `calendar_feed_inputs`, but nothing serves `GET /calendar-feed/<token>.ics`: no `calendar-feed` Edge Function, no ICS serializer, and the functions image cannot load `@shift/domain` (AD-7, AD-14, AD-17, AD-20; D-S1, D-S2, D-S8).

**Approach:** Add `packages/ics` (`@shift/ics`, the hand-written RFC 5545 subset over `zone.ts`, golden files) and the public `calendar-feed` function: path check, WebCrypto SHA-256, the one anon RPC by POST, R12 over the answer, one identical 404 for every miss. Wire it into `config.toml`, the router, the image (both `dist`s), the deploy hash, the image probe, CI's e2e and Kong's log level, and answer the 16.4 deferrals.

## Boundaries & Constraints

**Always:**
- `calendar-feed`: `verify_jwt = false`; environment `SUPABASE_URL` and `SHIFT_PUBLISHABLE_KEY` only; no npm or remote import; imports `@shift/domain`/`@shift/ics` through its `deno.json` onto `../../../packages/*/dist/index.js`.
- `GET`/`HEAD` only (else 405 `Allow: GET, HEAD`). Path `…/calendar-feed/<token>.ics`, token `^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`, optional `/functions/v1` prefix. Only the 64-hex hash leaves the function, by POST to `/rest/v1/rpc/calendar_feed_inputs` with the publishable key as `apikey`.
- Every miss (malformed, unknown, revoked, replaced, deactivated) is one 404: body `{"code":"FEED_NOT_FOUND"}`, `content-type: application/json`, `cache-control: no-store`, and answered no sooner than 250 ms after the request arrived (the timing class). `HEAD` has the same headers and no body.
- A hit: R12 (`atWorkShiftsOf`) over the RPC's window and assembly, `calendarOf`, 200 `text/calendar; charset=utf-8`, `cache-control: private, max-age=900`; `DTSTAMP` is the request instant. Nothing cached.
- Logs: fixed codes only, never the path, token or hash. Kong `KONG_LOG_LEVEL=crit`.
- `@shift/ics`: imports `@shift/domain` only; no `Date`/`Intl`; CRLF, 75-octet folding on UTF-8 boundaries, TEXT escaping; VTIMEZONE per AD-20 with no `RRULE`; one VEVENT per R12 shift, `UID:<date>-<teamId>-<memberId>@shift`, `DTSTART;TZID`/`DTEND;TZID` local, `SUMMARY:<shift type> · <team>`, nothing else.
- Required inputs from `deferred-work.md` answered in Design Notes and their entries marked.

**Ask First:** none (founder: decide and record).

**Never:** a migration; any screen, `hr.json` copy or month download (16.5); the secret key in `calendar-feed`; DESCRIPTION, LOCATION, ATTENDEE, ORGANIZER, leave, absence types, hours or other members in the feed; running DB tests, e2e, `supabase` or docker containers locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hit | live token | 200 calendar, private max-age 900 | none |
| HEAD hit | live token | 200, same headers, no body; counts as a fetch | none |
| Miss ×5 | malformed / unknown / revoked / replaced / deactivated | identical 404, ≥ 250 ms | none |
| Method | POST, OPTIONS | 405 | none |
| Lookup down | network error, timeout, non-200 | 503 `FEED_UNAVAILABLE`, no-store | logged code |
| Bad assembly | RangeError from R12/ICS | 500 `FEED_FAILED`, no-store | logged code |
| Misconfigured | URL or key missing/invalid, `sb_secret_` | 503 | logged at start |
| DST, night, half | 2026-03-29, 2026-10-25, Noć 19–07, FIRST half | local wall times, ends next date, worked half | none |

## Epic AC Deviations

- "projects R12 … over the past 31 and next 182 days" — met; the window is the RPC's (`organization_today`), not the function's clock.
- "one identical 404 in … timing class" — **reinterpreted**: the class is a 250 ms floor for every miss; the database's residual work difference (index stop vs member rule) sits under it. Measured end to end only by the epic's `security-review` (deferred-work, OWNER that review).
- "a VTIMEZONE for the organization's timezone" — met for Google/Apple; Outlook is a manual check later (deferred-work, accepted risk until then).

</frozen-after-approval>

## Code Map

- `packages/ics/` (new) -- `src/{text,timezone,calendar,index}.ts`, `test/{text,timezone,calendar,purity}.test.ts`, `test/golden/{zagreb-named,tokyo,parity-pilot}.ics`, `package.json` (`dependencies: @shift/domain workspace:*`), `tsconfig*.json` (typecheck maps the domain to src; build reads its dist), `vitest.config.ts`; `.gitattributes` keeps the goldens' CRLF.
- `packages/domain` -- unchanged; reused: `zoneTransitionsOf`, `offsetMinutesAt`, `instantOf`, `utcIsoOf` (`zone.ts`), `daysBetween` (`projection.ts:81`, the civil-day arithmetic, so `calendar.ts` stays internal), `atWorkShiftsOf`, `ScheduleInputs`, `AtWorkShift` (`at-work.ts`), `parity/fixtures.ts` (`PARITY_VECTOR`, `PARITY_FIXTURES`).
- `supabase/functions/calendar-feed/{deno.json,index.ts,handler.ts,deno-runtime.d.ts}` (new) -- handler pure and injected (`fetch`, `now`, `sleep`, `digest`, `log`), as `notify/run.ts`; `index.ts` names the runtime through `globalThis` (`notify/deno-runtime.d.ts` pattern).
- `supabase/config.toml` -- `[functions.calendar-feed]`.
- `deploy/functions/main/router.ts` -- `FUNCTIONS` entry; `deploy/functions/Dockerfile` -- copy both dists to `/home/packages/*/dist/`, the function, bundle it.
- `scripts/ci/deploy-images.sh:50` -- `FUNCTIONS_SOURCES` + the function and `packages/ics`; `scripts/ci/probe-functions-image.sh` -- PostgREST stand-in (busybox CGI), the 404 for malformed and unknown, the 405.
- `.github/workflows/pipeline.yml` -- `functions-image` and `e2e` build both packages; `deploy-staging` needs `runtime-parity`; `.github/actions/deploy/action.yml` builds them before the image.
- `deploy/coolify/supabase/docker-compose.yml` -- `KONG_LOG_LEVEL=crit`.
- `playwright.config.ts` (build both packages before `functions serve`), `e2e/tests/calendar/calendar-feed.spec.ts` (new), `e2e/utils/database-helper.ts` (`createCalendarFeedTokenInSql`, `revokeCalendarFeedTokenInSql`: 0067's definers as the member's own session) -- the CLI-served feed. No new table, so the cleanup is unchanged (tokens cascade with members).
- `DEPLOY.md` -- local serve, the image, Kong's error log.
- `test/calendar-feed.test.ts` (new) -- the handler matrix with the real packages; `test/concurrent-writes.test.ts` -- the two-connection lock races (unrun).
- Pins: `test/functions-router.test.ts`, `test/key-hygiene.test.ts`, `test/coolify-deploy.test.ts`, `test/self-hosted-stack.test.ts`, `test/supabase-scaffold.test.ts` (three functions), `vitest.config.ts`, `tsconfig.json`, `eslint.config.js` (ics purity).
- Mappers (rule A11): no row gains a column.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ics/**`, `packages/domain/src/index.ts`, `pnpm-lock.yaml` -- the serializer, goldens, purity -- AD-20.
- [x] `supabase/functions/calendar-feed/**`, `test/calendar-feed.test.ts` -- the function and its matrix (vector `PARITY_VECTOR`) -- AD-14, D-S8.
- [x] `config.toml`, router, Dockerfile, `deploy-images.sh`, probe, pipeline, deploy action, compose and their pin tests -- AD-7, AD-14, AD-17.
- [x] `e2e/**`, `playwright.config.ts` -- the CLI serves the map (written unrun).
- [x] `test/concurrent-writes.test.ts` -- regeneration ×2; creation vs deactivation, both orders (unrun).
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-21 (16.4)` on AD-7, AD-14, AD-17, AD-20.
- [x] `deferred-work.md`, `sprint-status.yaml` -- entries marked; Outlook, timing, roles entries.

**Acceptance Criteria:**
- Given the built image, when the probe asks for an unknown and a malformed token, then both get the identical 404.
- Given `supabase/functions/calendar-feed/`, when key hygiene runs, then nothing there names the secret key and its worker gets two variables.
- Given golden files for both DST transitions, a night crossing them and a no-DST zone, when serialized, then the bytes match and a reader of the file alone (independent of the serializer's code; an ICS library check is deferred to 20.5) resolves each event to the instant the tz database means.

## Spec Change Log

- 2026-11-21, review 1 (five layers: blind hunter, edge-case hunter, verification gap, epic AC auditor, unrun DB test auditor). No intent_gap or bad_spec; the epic AC auditor found no unlisted deviation, and the unrun DB auditor no defect in the race cases or the e2e helpers. Patched: the lookup now answers 503 for an assembly whose frame is wrong (string ids and zone, nine arrays), as AD-14 says, and `calendarOf` refuses a non-string zone (`RegExp.test(undefined)` passed); `SUPABASE_URL` with a query or fragment is refused; the lookup's bound is an injected `timeout` so a stalled gateway is proven to end in 503; tests pin `redirect: 'manual'`, the digest-failure 500 and the HEAD miss's floor; the probe also checks the vector's 503 with the stand-in gone and refuses two empty misses as "identical"; the e2e spec unfolds SUMMARY lines and checks the HEAD's cache-control; `foldLine` lost a dead variable; spine wording (the floor's limit; zone data via `zone.ts`, not `Intl`); DEPLOY.md names every answer's meaning. Deferred: rate limiting (security review / 20.x), refresh hints and DST-gap display (16.5), an ICS library parse (20.5). Rejected: changing the ratified UID format, DTSTAMP and the stack-wide Kong level (spine decisions); collapsing a duplicate UID (R12 cannot give one); a lenient path (AD-14's canonical form); ETag (pilot scale); per-worker SUPABASE_URL in the probe (commented instead). KEEP: the handler's shape, the 250 ms floor, the goldens.

## Design Notes

Decisions (founder: decide and record):
1. **Summary** `Dan · Smjena A` (U+00B7 separator, no copy key: names only). `NAME`/`X-WR-CALNAME` `Shift`; `PRODID:-//Shift//calendar-feed//HR`. Control characters in a name become a space.
2. **VTIMEZONE**: transitions from `zoneTransitionsOf(zone, from − 366 d, to + 1 d)` (the extra day covers a night's `DTEND`); the last before the window's first instant opens it; none before → one `STANDARD` at the window's offset, `DTSTART:19700101T000000`. `DAYLIGHT` when the offset rises. No `TZNAME`.
3. **Timing class**: a 250 ms floor on every 404. A lookup failure is 503, never the 404 (it says nothing about the token).
4. **UID collision** (two R12 shifts on one date and team) throws: R12 gives at most one per team and date.
5. **No npm client**: the lookup is one `fetch`, so the function bundles with no dependency at all (~250 kB eszip).
6. **The CLI**: 2.116.0's `functions serve` serves every function ("Serve all Functions locally", from its binary), so the existing serve step serves the feed once both dists are built; `config.toml` also names its `import_map`.
7. **Deferred inputs:** Dockerfile `dist` copy — done; CLI `functions serve` — the e2e job builds both dists before serving and its spec fetches the feed (confirmed when CI's e2e is green); `deploy-staging` needs `runtime-parity` — done; 404 timing — decision 3; the per-member lock race — written in `concurrent-writes` (CI); `pg_read_all_data` — the self-hosted `supabase/postgres:17.6.1.165` grants it to `supabase_read_only_user`; 20.5's host check lists every member of `pg_read_all_data` and every `rolbypassrls`/`rolsuper` role and confirms none logs in from outside the host (entry re-owned to 20.5); read parity — not extended: the lookup serves only `calendar_feed_member_live` members, all of whom have a browser path (RESOLVED); Kong error log — `crit` (RESOLVED in part; Traefik and the functions log stay 20.5's).
8. **Outlook**: unverified; a manual import on staging before production (deferred-work, OWNER 20.5).

## Verification

**Commands (2026-11-21, all pass):**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- `pnpm --filter @shift/domain test` -- 20 files, 950 tests; `pnpm --filter ./apps/web test` -- 178 files, 6665 tests.
- In `packages/ics`: `pnpm exec vitest run test/text.test.ts test/timezone.test.ts test/calendar.test.ts test/purity.test.ts` -- 4 files, 29 tests.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts test/functions-router.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/runtime-parity.test.ts test/calendar-feed.test.ts` -- 9 files pass (2 skipped are key-hygiene's built-bundle scans, as before).
- Unrun by rule, CI's first run: `test/concurrent-writes.test.ts`'s three 0067 race cases; `e2e/tests/calendar/calendar-feed.spec.ts`.

**Manual checks (no container started; the saved pinned `edge-runtime` v1.74.3 rootfs under `chroot`, `unshare -n` loopback only):**
- The image layout (both `dist`s in `/home/packages/`, the three functions, the router) built as the Dockerfile's COPY lines; `edge-runtime bundle` of `calendar-feed` offline: 249 790 bytes (after review).
- `scripts/ci/probe-functions-image.sh` itself, through a stand-in `docker` (the chroot, host busybox 1.37 httpd and its CGI): 16/16 ok after review, the unknown and malformed 404s identical, the vector's calendar, and its 503 with the stand-in gone.
- A real assembly (the pilot parity member, D2 window 2026-10-21…2027-05-22, 106 shifts, a transition inside) served by the router and the function behind a busybox CGI: 200 `text/calendar`, `private, max-age=900`; HEAD the same headers, no body; the body byte-identical to Node's `calendarOf` of the same assembly, `DTSTAMP` aside; the stub gone, 503; a malformed token 404 in 279 ms. The runtime's log held `calendar-feed: FEED_UNAVAILABLE` and nothing else.
- The golden files opened: `zagreb-named.ics` (9 events, both transitions, a folded 3-line SUMMARY of Croatian letters and every escape), `tokyo.ics`, `parity-pilot.ics` (112 events over 2026-03-20…10-31; the runtime check's 106 are the same member over the D2 window). Each was read back by a reader of the file alone, in the test (an ICS library could not be fetched here): every event resolved through the file's own observances to an instant Node's tz database formats back to the written wall clock; the spring night is 11 h (18:00Z–05:00Z), the autumn night 13 h (17:00Z–06:00Z).

**Residual risk:** the e2e spec (the CLI's `functions serve` over the map, the local gateway, the real lookup) and the race cases run first in CI; Outlook is unchecked (deferred-work, OWNER 20.5); the 404's timing end to end is the epic's `security-review`'s.

## Suggested Review Order

**The feed's decisions**

- Entry point: one handler, GET/HEAD, the miss floor, lookup, R12, serialize.
  [`handler.ts:205`](../../supabase/functions/calendar-feed/handler.ts#L205)

- Every miss is one 404, no sooner than 250 ms after arrival.
  [`handler.ts:216`](../../supabase/functions/calendar-feed/handler.ts#L216)

- `null` is the one miss; a malformed answer is 503, never the miss.
  [`handler.ts:157`](../../supabase/functions/calendar-feed/handler.ts#L157)

- Publishable key and gateway address only; a secret key is refused.
  [`handler.ts:98`](../../supabase/functions/calendar-feed/handler.ts#L98)

**The serializer (AD-20)**

- Fixed calendar lines, one VEVENT per R12 shift, refusals for what R12 never gives.
  [`calendar.ts:53`](../../packages/ics/src/calendar.ts#L53)

- Explicit observances from `zone.ts`, covering the window and the day after.
  [`timezone.ts:90`](../../packages/ics/src/timezone.ts#L90)

- 75-octet folding on UTF-8 boundaries.
  [`text.ts:52`](../../packages/ics/src/text.ts#L52)

**Wiring and deploy (AD-7, AD-14, AD-17)**

- Public function in config, with its import map.
  [`config.toml:169`](../../supabase/config.toml#L169)

- Router gives its worker two variables.
  [`router.ts:72`](../../deploy/functions/main/router.ts#L72)

- Both dists copied where the map lands, bundled into the eszip.
  [`Dockerfile:28`](../../deploy/functions/Dockerfile#L28)

- Source hash covers the function and `@shift/ics`, never dist.
  [`deploy-images.sh:50`](../../scripts/ci/deploy-images.sh#L50)

- Image probe: a stand-in RPC; identical misses, a hit, a 503.
  [`probe-functions-image.sh:45`](../../scripts/ci/probe-functions-image.sh#L45)

- Kong's error log above `crit` only.
  [`docker-compose.yml:392`](../../deploy/coolify/supabase/docker-compose.yml#L392)

- Staging waits for runtime parity.
  [`pipeline.yml:512`](../../.github/workflows/pipeline.yml#L512)

**Tests**

- The miss matrix with a fake clock and the real packages.
  [`calendar-feed.test.ts:249`](../../test/calendar-feed.test.ts#L249)

- Two-connection lock races, written unrun.
  [`concurrent-writes.test.ts:2469`](../../test/concurrent-writes.test.ts#L2469)

- The CLI-served feed end to end, written unrun.
  [`calendar-feed.spec.ts:39`](../../e2e/tests/calendar/calendar-feed.spec.ts#L39)
