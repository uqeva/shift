---
title: 'Story 21.27: Emails look like Smjenko (Emailovi izgledaju kao Smjenko)'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: 'a2d8fe865ccad6873ae303096e52e39ef4c9ba3b'
review_loop_iteration: 0
context: []
---

Status: done. PR #390, squash `6e2f824`, merged 2026-11-26 with `CI passed` green on the PR's only run (45859333772 at `a390fb9`). `main`'s push run for `6e2f824` (45861492689) was in progress when this line was written. No migration. Set `done` and this line written by the epic 21 retrospective (2026-11-26).

Baseline: `origin/main` at a2d8fe86 (after 21.11's merge). Touches the hot file `hr.json`: sequential after the last merged story, as the HOT FILES rule asks.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every email the product sends is unbranded: the three GoTrue templates are a plain card, and every `notify` email and shift reminder is plain text only, a sentence with a raw URL in it. Nothing says *Smjenko*, there is no button, and the footer does not say why the member gets the email.

**Approach:** One pure, dependency-free layout (`email-layout.ts`: a 600 px table, the mark as a PNG from the app origin, a bulletproof button, the link written out, a footer, a dark-mode block) used by the GoTrue template builder and by `notify`, which now sends an HTML part beside its plain-text part. Each message's link sentence becomes its own short `action` key in `hr.json`, the button's label.

## Boundaries & Constraints

**Always:**
- `hr.json` is the one source: `OBAVIJESTI` and `PODSJETNICI` stay deep-equal to `obavijesti` and `reminders.notice`; the GoTrue templates are built from `signup.email` and `auth.brand.name`; the committed local templates equal the build.
- Every Auth link stays `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&type=<type>` (written `&amp;` in HTML), the only `href`s in an Auth template.
- The only image is `<origin>/email-mark.png` (`{{ .SiteURL }}` in GoTrue, `SHIFT_APP_URL` in `notify`): no query, no per-recipient part, `alt`, fixed width and height. No font, script, stylesheet link, `url(`, tracking pixel, data URI or third-party host.
- Every text spliced into HTML is escaped after interpolation (names, team and shift type names are member data).
- The plain-text part and the push keep today's shape: the message, then `<action>: <link>`, then the footer; the push has no footer.
- The mark is served by the web image's `location /` with the security headers, listed in the static-hosting allowlist and kept out of the precache.

**Ask First:** a migration, a new server function, a paid service, or a GoTrue email hook (the only way to give GoTrue mail a text part).

**Never:** an inline SVG or `data:` image; an external host; open or click tracking; any change to the link targets, the outbox, the claim, the settle or the codes; running DB-connecting tests, e2e or `supabase`; sending real email.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Notify email | any code with valid operands | Resend body has `subject`, `text`, `html`; html has the mark, heading = subject, body, button to the sign-in link, the link written out, footer with org name and settings link | N/A |
| Hostile name | `memberName: '<img src=x>'` | html shows `&lt;img src=x&gt;`, no extra tag or `src=` | N/A |
| Refused row | unknown code / bad operands | no send, same failure code as today | transient / OPERANDS_INVALID unchanged |
| Reminder | `SHIFT_REMINDER` | same layout, reminder footer (*Obavijesti → Podsjetnici*) | as today |
| Auth template | confirmation / recovery / email change | layout with Go template placeholders intact; exactly two `href`s, both AD-12 links; one `<img>` | build fails on a missing key or a `{{` in copy |

## Epic AC Deviations

- Epic AC 2 ("Resend receives an HTML part and a plain-text part") is met for `notify`; the GoTrue mail gets NO plain-text part: GoTrue's mailer sends the fetched template as `text/html` only, and a text part needs a send-email hook (a new server function, Ask First). Deferred, `deferred-work.md` entry written.
- Epic AC 1 footer for Auth mail: GoTrue knows no organization and the account has no notification settings, so the Auth footer says why the mail came (`signup.email.reason`) and names *Smjenko*, with no organization and no settings link (the two AD-12 links stay the only `href`s).

</frozen-after-approval>

## Code Map

- `supabase/functions/notify/email-layout.ts` -- NEW, canonical layout + `escapeHtml`; imports nothing.
- `apps/web/src/lib/email-layout.ts` -- NEW byte-identical copy (apps/web cannot import from `supabase/`); pinned identical by test.
- `apps/web/src/lib/auth-email.ts` -- build each template through the layout; new key `signup.email.reason`; brand from `auth.brand.name`.
- `supabase/templates/auth-email/*.html` -- regenerated by `node scripts/auth-email-templates.mjs`.
- `supabase/functions/notify/messages.ts` -- messages get `action`; `footer` becomes `{reason, settings}`; new `email: {brand, fallback}`; `compose` returns parts; new `renderEmail` (subject, text, html). `render`/`renderPush` text unchanged in shape.
- `supabase/functions/notify/email.ts` -- `deliverEmail` posts `html` too.
- `apps/web/src/lib/i18n/locales/hr.json` -- `obavijesti`, `reminders.notice`, `signup.email.reason`.
- `apps/web/public/email-mark.png` -- NEW 96×96 PNG of `favicon.svg` (light, no dark edge).
- `apps/web/vite.config.ts` -- `globIgnores` gains `email-mark.png`.
- `test/static-hosting.test.ts` -- allowlist `email-mark.png`; precache excludes it.
- `test/auth-email.test.ts`, `test/notify-boundary.test.ts`, `test/notify-reminder.test.ts`, `test/resource-hygiene.test.ts` -- updated pins; new `test/email-layout.test.ts` (DB-free).
- Read-only: `deploy/web/default.conf` (`location /` serves the PNG with headers), `push.ts` (uses `renderPush`), `handler.ts` (no log of bodies).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/notify/email-layout.ts` + copy -- layout -- one design for every email.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `messages.ts` -- split link sentence into `action`, footer object, `email` chrome; copy review -- button labels, why-you-got-this.
- [x] `messages.ts`, `email.ts` -- `renderEmail`, post `html` -- HTML part beside text.
- [x] `auth-email.ts`, templates, `hr.json` -- layout + `reason` -- branded Auth mail.
- [x] `email-mark.png`, `vite.config.ts`, `static-hosting.test.ts` -- the hosted mark.
- [x] tests listed in the Code Map -- pins, escaping, hrefs, image, identical copy.
- [x] DESIGN.md, EXPERIENCE.md -- UX-DR85 lines.
- [x] scratchpad renders: every template to HTML and a 600 px light screenshot.

**Acceptance Criteria:**
- Given any email, when rendered, then it matches UX-DR85 and the I/O matrix.
- Given `pnpm build`, when `dist/` is read, then `email-mark.png` and the three templates are emitted, and `sw.js` lists neither.

## Spec Change Log

- Review 1 (2026-11-26), patches only, no loopback: the Epic AC Deviations section moved inside the frozen block (bmad-build rule); `swapRequestWaiting` no longer says *čeka tvoju odluku* (epic AC 4); Outlook ghost table and `mso-padding-alt`; preheader filler and `x-apple-disable-message-reformatting`; one fallback wording for Auth and notify; a neutral Auth reason (true for email change too); `compose` returns the language the HTML follows; contrast pinned on every surface; every variant and reminder drawn in the test; neutral fixtures in the new test. KEEP: the byte-identical layout copy and its pin, the `action` key split, both parts from one `compose`.

## Design Notes

Text part: `{body} {action}: {link}\n\n{reason}\n{settings}: {settingsLink}`. Push: `{body} {action}: {link}`. HTML: heading = subject; paragraph = body; button = action; fallback line + link; footer = reason, then settings as a link.

Colours (the app's light tokens): page `#e8edf5`, card `#ffffff`, text `#0f172a`, muted `#556275`, button `#2a4fae` with `#ffffff` (7.4:1; the app's primary `#2f55b8` is 6.7:1, darkened one step for a 7:1 button), accent line `#3fa0fa`. Dark block: page `#0a1020`, card `#111a2e`, text `#e2e8f0`, muted `#94a3b8`, link `#7cc0ff`, button `#3fa0fa` with `#0b1628` (the app's own dark primary pair, 6.6:1). Every text colour is pinned on every surface it is drawn on (card and page, both schemes) in `test/email-layout.test.ts`.

Outlook on Windows: a fixed 600 px ghost table in `<!--[if mso]>` and the button's padding as `mso-padding-alt` on its cell.

Root lists: `localization-applied` and `key-sources` need no entry: the SPA's key sweep leaves `obavijesti.*`, `signup.email.*` and `reminders.notice.*` out (no screen renders them), and `email-layout.ts` holds no copy; `resource-hygiene` lists every new key; `notify-boundary`'s operand checks now read `action` too.

`apps/web/tsconfig.json` gains `allowImportingTsExtensions` (it is `noEmit`) so `auth-email.ts` can import `./email-layout.ts` by file name and `scripts/auth-email-templates.mjs` can still run it in Node.

The mark is served from `location /` (`no-cache`), so a client that loads images without a proxy revalidates it on each open and nginx's access log records that request (IP, time, user agent), as it records any visit. Nothing per recipient is in the URL. Whether to serve it with a long cache and no access log is left to the founder (`deferred-work.md`).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- pass (build emits `dist/email-mark.png` and the three templates; `sw.js` names neither).
- `pnpm exec vitest run test/auth-email.test.ts test/email-layout.test.ts test/notify-reminder.test.ts test/static-hosting.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/web-image.test.ts test/theme-applied.test.ts` -- pass, after the build.
- `apps/web`: `pnpm test` -- pass (`router.test.ts` leaves `email` out of the message keys).
- `notify-boundary.test.ts` opens a database, so it was not run as is: its DB-free cases (270) ran green from a scratch copy whose database import was stubbed (no connection possible), then the copy was deleted. Its 19 DB cases are CI's.
- e2e not run (rule): `reminder-delivery.spec.ts` updated to the new footer, unrun; `signup.spec.ts` reads `&amp;type=` from the mail's HTML, which the layout still writes.

**Manual checks:**
- Every email (3 Auth templates, every notify code and variant, 3 reminder variants: 53) rendered by a scratch script to HTML and `.txt`, and screenshotted at 600 px in headless Chromium, light and dark, in the session's scratchpad (`emails/`, `emails-dark/`). Looked at: the mark and wordmark, heading, body, button, written-out link and footer read in both schemes; a long name wraps.

## Suggested Review Order

**One layout**

- The layout every email is drawn in: tables, the mark, the button, the footer.
  [`email-layout.ts:136`](../../supabase/functions/notify/email-layout.ts#L136)

- The bulletproof button: the cell carries the fill and Outlook's padding.
  [`email-layout.ts:122`](../../supabase/functions/notify/email-layout.ts#L122)

- Outlook's fixed 600 px ghost table around the max-width one.
  [`email-layout.ts:160`](../../supabase/functions/notify/email-layout.ts#L160)

**notify's HTML part**

- Both parts from one `compose`; the HTML's words follow the rendered language.
  [`messages.ts:905`](../../supabase/functions/notify/messages.ts#L905)

- The plain text keeps today's shape, then the reason and the settings line.
  [`messages.ts:889`](../../supabase/functions/notify/messages.ts#L889)

- Resend now receives `html` beside `text`.
  [`email.ts:49`](../../supabase/functions/notify/email.ts#L49)

**Copy**

- Each message is a body and a button label; the footer a reason and a settings line.
  [`hr.json:2679`](../../apps/web/src/lib/i18n/locales/hr.json#L2679)

**Auth templates**

- The three GoTrue templates through the same layout, the mark on SiteURL.
  [`auth-email.ts:117`](../../apps/web/src/lib/auth-email.ts#L117)

**Serving the mark**

- Kept out of the precache; the static allowlist and the image probe name it.
  [`vite.config.ts`](../../apps/web/vite.config.ts)

**Tests**

- Mail-safety pins, escaping, every variant, contrast, the identical copy, Resend's body.
  [`email-layout.test.ts:1`](../../test/email-layout.test.ts#L1)

- One image, one `src`, nothing else fetched; AD-12 links unchanged.
  [`auth-email.test.ts:1`](../../test/auth-email.test.ts#L1)
