---
title: '21.24 Smjenko brand: name, logo and icons (with 21.22, teams are called Timovi)'
type: 'feature'
created: '2026-11-25'
status: 'in-review'
baseline_commit: '771ce06a4dff467608f98021680ec21d522081d8'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-25-pilot-readiness.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The founder decided on 2026-11-25 that the product a user sees is *Smjenko*, not *Shift* (reversing E-5's default), with logo concept C (*Predaja smjene*, the handover S), and accepted E-6: a team is *Tim* / *Timovi*, never *Smjena*, so it is not confused with *Tipovi smjena* (story 21.22). The app still says *Shift*, shows the rotation-ring icons, and labels teams *Smjena*.

**Approach:** One branch (`feat/smjenko-brand`), two stories, because both rewrite `hr.json`'s copy. 21.24 renames every user-visible product name, renders the icons from the founder's mark and adds one in-app mark component. 21.22 rewrites every team label in `hr.json` to *Tim*/*Timovi* and turns the hygiene sweep into a literal sweep that finds no team-meaning *smjen*. Docs, the spine (AD-20) and tracking follow.

## Boundaries & Constraints

**Always:**
- The name a user sees is *Smjenko*: title, no-script and boot lines, manifest `name`/`short_name`, the sign-in panel and setup header, Auth mail (subject, title, body; the compose's subjects and `GOTRUE_SMTP_SENDER_NAME`; `config.toml`; the committed local templates), the `NOTIFY_EMAIL_FROM` examples, a push with no title, the feed's `NAME`, `X-WR-CALNAME` and `PRODID` (`-//Smjenko//calendar-feed//HR`), the month download's file name, and the PDF's creator metadata.
- Internal identifiers stay: `@shift/*`, the repository, env var names, DB names, URLs and routes (`/smjene`, `?smjena=`), local-storage keys, the feed's UID domains (`@shift`, `@shift-download`), and the `smjene.*` key namespace.
- Icons are rendered from the founder's mark (sharp, from the repo's `node_modules`): `favicon.svg`, `favicon.ico` (16/32/48), Apple touch 180, PWA 192 and 512 (rounded, transparent corners), maskable 512 (full bleed, `rx 0`). All same-origin.
- The wordmark is HTML text in the app's Outfit at 600 beside the mark, never live SVG `<text>`.
- Every label naming a team says *Tim*/*Timovi*; a worked or rostered shift stays *smjena*, the Shift Type stays *tip smjene*; team names an organization chose (`Smjena A`) are data.
- The CSS-affecting change runs the four theme root files after `pnpm build`.

**Ask First:** none (the founder's decisions are the inputs; unattended).

**Never:** no change to the landing page (21.21), DB, migrations, Edge Function code, env var names or routes; no gitleaks, e2e, DB tests or `supabase` commands here; no product domain, host or real name committed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Feed refresh | an existing subscription | `NAME`/`X-WR-CALNAME` read *Smjenko*, PRODID changes, every UID unchanged | none: PRODID names the writer only |
| Push with no title | a payload without `title` | the notification is titled *Smjenko* | none |
| Dark glass | the mark on the sign-in panel, dark theme | a white 16 % hairline draws the tile's edge (navy on glass is 1.03:1, pinned) | none |
| Forced colours | the sign-in panel under forced colours | the mark keeps its three colours (`forced-color-adjust: none`) | none |
| Team counts | `{count}` teams | `1 tim`, `2 tima`, `5 timova`, `21 tim`, `22 tima` | none |
| Product name in copy | `Smjenko`, `Smjenku` in `hr.json` | the hygiene sweep strips the name before looking for `smjen` | none |

## Epic AC Deviations

The first three quote the founder's instruction of 2026-11-25 that defined 21.24 (the build's brief), from which the epic's ACs were written in this change; they record where the ACs narrow that instruction. *(Sourced by the review, 2026-11-25.)*

- 21.24 brief "PDF and xlsx export headers and metadata": the xlsx writer (`write-excel-file` 4.1.1) writes no document properties and the sheet names no product, so there is nothing to rename there; the PDF gains `creator: Smjenko` in its metadata (`producer` stays the library) and its printed header, which never named the product, is unchanged. Reinterpreted, not deferred.
- 21.24 brief "email templates … subject, body, signature": no Auth or notify mail carried a signature naming the product; the product's name reaches mail through the subjects, bodies and sender display names (GoTrue's compose default; `NOTIFY_EMAIL_FROM`, whose staging value is the operator's). No signature line was added. Reinterpreted.
- 21.24 brief "email/PDF header logos where a logo is shown": neither the mail nor the PDF shows a logo (the Auth templates load no image by design, AD-21's "a mail client loads nothing"), so none was added. Reinterpreted.
- 21.22 AC 1 "navigation": the navigation has no team entry of its own; the team list is reached from *Ljudi* by the link `smjene.heading`, now *Timovi*. Met through that link.

</frozen-after-approval>

## Code Map

- `apps/web/public/{favicon.svg,favicon.ico,apple-touch-icon-180x180.png,pwa-192x192.png,pwa-512x512.png,maskable-icon-512x512.png}` -- the mark and its renders.
- `apps/web/src/components/brand-mark.tsx` -- NEW: the mark (aria-hidden, fixed colours, dark hairline, forced colours off); `components/README.md` names it.
- `apps/web/src/components/layout/auth-layout.tsx`, `apps/web/src/pages/postavljanje.tsx` -- the mark replaces the ink tile's `CalendarBlank`; the name in Outfit 600.
- `apps/web/index.html`, `vite.config.ts` -- title, fallbacks, `favicon.ico` link, manifest name; the icon note.
- `apps/web/public/push-sw.js` -- the untitled push's title.
- `apps/web/src/features/calendar-feed/services/month-download.ts` -- `smjenko-<YYYY-MM>.ics`.
- `apps/web/src/features/history/services/{history-export,pdf}.ts` -- `creator` from `auth.brand.name`; `key-sources.fixture.ts` 28 → 29.
- `apps/web/src/lib/i18n/locales/hr.json` -- 10 product-name messages; 147 team labels (21.22).
- `packages/ics/src/calendar.ts` + goldens + `calendar.test.ts`, `purity.test.ts` -- `CALENDAR_NAME`, `PRODUCT_ID`.
- `supabase/config.toml`, `supabase/templates/auth-email/*` (regenerated by `scripts/auth-email-templates.mjs`), `deploy/coolify/supabase/{docker-compose.yml,*.env.example}`, `supabase/functions/.env.example`, `DEPLOY.md` -- mail names.
- `scripts/ci/probe-web-image.sh`, `test/static-hosting.test.ts` -- `/favicon.ico` probed and allowed.
- `test/resource-hygiene.test.ts` -- the `smjen` predicate rewritten (team never `smjen`; product name stripped), its self-test, a new literal sweep, the pinned imperatives.
- `test/theme-contrast.test.ts` -- the panel draws `<BrandMark>`; the mark's pairs pinned. `test/localization-applied.test.ts`, `test/push-worker.test.ts` -- copy pins.
- `e2e/pages/login.page.ts`, `e2e/tests/layout/glass-fallbacks.spec.ts` -- `brandMark` replaces the calendar-blank hook; `e2e/pages/filter-bar.ts`, `kalendar-na-mobitelu.spec.ts`, `layout.spec.ts` -- names. Every other e2e locator reads `hr.json`.
- Web unit tests pinning old copy (16 files) -- updated.
- Docs: `ARCHITECTURE-SPINE.md` (AD-20 amended), `DESIGN.md` (name, the mark), `EXPERIENCE.md`, `epics.md` (UX-DR18/19/33/36/59/67/68/70, UX-DR81, story 21.24), the proposal, `sprint-status.yaml`, `deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- [x] Icons rendered and looked at (16 px preview, 192, maskable 512); `favicon.ico` holds three PNG entries.
- [x] The mark component and the two headers; e2e hook and forced-colours case rewritten.
- [x] Every product-name surface above; Auth templates regenerated; ICS constants and goldens.
- [x] `hr.json` team labels; hygiene predicate and literal sweep; unit-test pins.
- [x] Spine AD-20 amendment; DESIGN, EXPERIENCE, UX-DRs; epics story 21.24; proposal; sprint status (21.22 and 21.24 `review`); deferred-work (three entries marked RESOLVED).

**Acceptance Criteria:**
- Given the built app, when the manifest, title, templates and feed are read, then each says *Smjenko* and no UID changes.
- Given `hr.json`, when the hygiene suite runs, then no message naming a team says `smjen`, and the pinned labels read *Timovi*, *Novi tim*, *Tim*.
- Given the web, ICS and DB-free root suites, when run, then they pass.

## Spec Change Log

- 2026-11-25, review pass 1 (unattended): the Epic AC Deviations now name their source, the founder's brief, at the epic AC auditor's and the blind hunter's finding that the quoted wording appears nowhere in the repo. No deviation was added or removed. KEEP: the epic ACs as written; the reinterpretations themselves.

## Review Triage Log

### 2026-11-25 — Review pass 1
- Layers: blind, edge-case, verification-gap, epic AC (4 of 5; the unrun-DB-test layer has nothing to audit: no DB test, migration function or Edge Function changed).
- intent_gap: 0. bad_spec: 0 (the deviations' source, logged above).
- patch: 12
  - `[medium]` Stale team labels left in DESIGN.md (filter chip row, filter sheet), EXPERIENCE.md (Ljudi's filters, add member, member page, loan marks, month print, rotation history, empty states, two *Sve smjene*) and epics.md (UX-DR20, 34, 56, 58, 65, 66, the 7.x AC quoting `Sve smjene (4)`) now say *Tim* / *Timovi* (epic AC, blind).
  - `[medium]` The dark hairline was protected only by a source regex: the built CSS is now asserted (`.dark\:inline` under `data-theme=dark`, after `.hidden`), and an e2e case reads the second rect's `display` in both themes (verification-gap).
  - `[medium]` `GOTRUE_SMTP_SENDER_NAME` was pinned by nothing: `test/auth-email.test.ts` now pins it to `auth.brand.name` and `Smjenko` (blind, verification-gap).
  - `[low]` `favicon.svg` drew no edge on a dark browser chrome: it now carries a `prefers-color-scheme: dark` hairline; a test holds its paths, tile and radius equal to `brand-mark.tsx`'s and both headers to `<BrandMark>` (blind).
  - `[low]` The SW precache left out `favicon.ico`: `globPatterns` gains `ico` (edge-case, blind).
  - `[low]` `sizes="48x48"` on the ICO link: now `32x32`, which keeps SVG-capable browsers on the SVG (blind).
  - `[low]` `CalendarBlank` was an orphan export: removed, its import too; the lucide history comment says why (edge-case).
  - `[low]` The spine's AD-20 download name and the manifest deferral said *Shift*; the proposal's story count and UX-DR range, and epics.md's parallel list and planning line, were stale; the gap at 21.23 is explained (blind, epic AC).
  - `[low]` `probe-functions-image.sh`'s `NOTIFY_EMAIL_FROM` example now says `Smjenko <…>`. Root test fixtures that only test the address format keep theirs (blind).
  - `[low]` Test titles with a stray possessive after *Svi timovi* reworded (blind).
  - `[low]` `index.css`'s note that nothing uses `dark:` is updated (verification-gap).
- defer: 2 (`deferred-work.md`): staging's rollout of the name (an operator step); the phone sign-in screen shows no brand (pre-existing, `lg` only).
- Rejected:
  - A `SHIFT_MEANING_KEYS` allowlist for the shift scopes (edge-case): a future team label there without `team` in its key path would pass. The sweep already covers every key that names a team today, plus the explicit list; a whole-scope allowlist of ~90 shift messages is churn for a hypothetical.
  - Pinning 1.03 and 1.53 exactly rather than a threshold (blind): the exact pin is the house rule for a known shortfall (bmad-build: "a known shortfall is pinned exactly"); the hairline is decorative, the glass border's treatment, as DESIGN.md's mark paragraph says.
  - `auth.brand.name` as the PDF creator's key (blind): it is the one product-name key; a second key would be a second copy of the name.
  - `ljudi.leaveRecord.replacementStays` (`ostaje na smjeni {team}`) and `smjene.membership.lastIn`/`firstIn` (`Zadnja u {team}`): a rostered shift, not a team, so kept (Design Note 5).
  - Committing the icon generator: Design Note 1; the paths are now held equal by a test.

## Design Notes

1. **One component, one drawing.** The mark is inline SVG in `brand-mark.tsx` and the same paths in `favicon.svg`; the PNGs and the ICO were rendered from it with sharp (resolved from `node_modules/.pnpm`, no new dependency), at 4× density then resized. The generator stays out of the repo, as the rotation-ring PNGs' did; `vite.config.ts` says how they were made. The landing page (21.21) reuses `favicon.svg` and the component's paths.
2. **The wordmark is text.** *Smjenko* is `auth.brand.name` in `font-heading font-semibold`, so no font outlining and no SVG `<text>` is needed, and it reads at any zoom.
3. **Hygiene after the rename.** The old predicate allowed `smjen` as the Team in a dozen namespaces. Now a message that names a team (its key path says `team`, a team-only namespace, or one of ten listed keys) may not say `smjen` outside the Shift Type's term; `smjen` survives only where it is a worked or rostered shift or inside `tip smjene`. *Smjenko* is stripped first.
4. **`GOTRUE_SMTP_SENDER_NAME` stays a fixed compose value**, now `Smjenko`; making it an input was not asked.
5. **Judgement calls kept as *smjena*:** `ljudi.leaveRecord.replacementStays` (*ostaje na smjeni {team}*, the rostered shift a replacement stays on), `smjene.membership.lastIn`/`firstIn` (*Zadnja u {team}*: the last shift), the day detail's *u sastavu je ove smjene*, and every swap, collision, half-day and staffing message. They name a shift, not a team.

## Verification

**Commands (run 2026-11-25):**
- `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter @shift/ics test` -- 4 files, 32 tests passed.
- `pnpm --filter ./apps/web test` (`apps/web`: `vitest run`) -- 186 files, 6919 tests passed.
- `pnpm build`, then `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/theme-tokens.test.ts test/theme-contrast.test.ts test/theme-fidelity.test.ts test/theme-applied.test.ts test/auth-email.test.ts test/push-worker.test.ts test/static-hosting.test.ts test/localization-applied.test.ts test/localization-guard.test.ts test/key-hygiene.test.ts test/feature-boundaries.test.ts test/self-hosted-stack.test.ts test/typography-coverage.test.ts test/import-cycles.test.ts` -- 16 files passed.
- After review pass 1 the same commands were re-run (typecheck, lint, build, the 16 DB-free root files, the web and ICS suites): all passed.
- Generated files opened: the icons viewed as images (16 px enlarged, 192, maskable 512); `favicon.ico` read by `file` (three PNG entries); the history PDF rendered from `pdf.render.test.ts`'s realistic fixture (`HISTORY_PDF_OUT`), `pdfinfo` reads `Creator: Smjenko`, page 1 rasterized and read (`Tim: svi`, `Tim · promijenjeno`, 9 pages); the ICS goldens hold the new lines.
- Forced colours checked in Chromium (Playwright from `node_modules`): the mark's tile, arcs and `forced-color-adjust` compute as the e2e case expects.
- Not run locally: e2e (the changed `glass-fallbacks`, with its new dark-hairline case, `kalendar-na-mobitelu` and `layout` specs, and every spec reading the renamed `hr.json` labels), the DB-connecting root tests, and the web image probe (`/favicon.ico`). CI is their gate. Gitleaks is the orchestrator's.

**Residual risks:**
- CI has not run: both stories `review`, built, CI pending.
- e2e locators read `hr.json`, so the rename follows; a non-exact text locator that now matches a shorter label (`Tim`) more widely is the likeliest e2e failure.
- Staging keeps *Shift* until the compose is redeployed (sender name, subjects), the web image is rebuilt (title, manifest, icons, templates), the functions image is rebuilt (feed lines), and `NOTIFY_EMAIL_FROM` is set to `Smjenko <…>` by the operator. Installed PWAs pick up the new name and icons on their next manifest check.
