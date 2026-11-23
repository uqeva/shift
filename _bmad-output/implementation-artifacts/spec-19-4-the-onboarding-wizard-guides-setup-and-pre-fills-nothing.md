---
title: '19.4 The onboarding wizard guides setup and pre-fills nothing'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
baseline_commit: 'bac8d1b517ed3c622e458407e6a7efa86cffd7eb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-11-21-signup/README.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
---

Status: review, built, CI pending (unattended run; the founder said not to ask, so the checkpoint is taken as approved and every decision is recorded here). Review 1 (five layers) patched; one proposed amendment of the frozen Epic AC Deviations waits for the founder (Spec Change Log). DONE MEANS MERGED WITH GREEN CI: the frontmatter stays `in-review` until the PR merges.

Baseline: `origin/main` at #350, rebased before push onto #352 (19.5 with 0073) (17.3 merged; 19.1 #341, 19.2 #344, 19.3 #349 merged). 19.5 is in review and holds migration 0073, so this story's migration is **0074** and the scaffold's no-gap case fails locally until 0073 merges (expected). This story owns the hot files `hr.json` and `index.css` for its run; no other story edits them in parallel. The screens follow the epic 19 UX review (UX-DR65, 67–70, mockups `onboarding-1.html`, `danas-and-empty-states-1.html`), which the founder has **not yet accepted**: built to it.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Founding Admin who has created an organization (19.3) lands on an empty *Danas* with no guidance: nothing walks them through hour bands, teams, shift types, a rotation and members, nothing says how far setup is, and three shared add dialogs still pre-select values (FR-97, UX O3).

**Approach:** `/postavljanje/<korak>` steps 2–7 in a setup frame that composes each shipped surface's own components and hooks (AD-24, D9); one progress hook derives every step's state from the rows those surfaces already read; a *Danas* card resumes setup until done or dismissed, the only stored fact being `organizations.onboarding_dismissed` (migration 0074); the shared add dialogs pre-select nothing; empty states name setup as the reason.

## Boundaries & Constraints

**Always:**
- One write path per fact: every step write is the shipped surface's own hook. `features/onboarding` imports no other feature's write module; it reads each fact through the owning feature's own query options and key (`FEATURE_PUBLIC`).
- Progress facts exactly as AD-24: a band; a team not archived; a shift type not archived; a rotation assignment (any version); more than one member. Steps open in any order; *Preskoči za sada* stores nothing.
- The card: active admin, `founded_by` set, not dismissed, steps left; never the skeleton; absent while its reads are missing.
- Nothing pre-filled, nothing pilot- or fire-specific: the `onboarding` namespace and the UX-DR70 keys pass a literal sweep (fire terms, `Dan`/`Noć`/`Slobodno` as shift names, four teams, 12 hours).
- Copy in `hr.json`; a team is a *Smjena*.

**Ask First:** none (the founder said decide and record).

**Never:** a second implementation of any surface; a stored progress or skip flag; an email invitation (F2); suspension or housekeeping (19.5); docker, `supabase`, e2e or DB-connecting test runs; a literal secret.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| After founding | step 1 `ORGANIZATION_CREATED`, no return target | `/postavljanje` → `/postavljanje/satni-pojasi` | a carried return target still wins (19.3 D7) |
| Claimed admin opens `/postavljanje` | signup or operator organization | step 2 | a member goes to *Danas* |
| Step fact missing / present | e.g. no band / one band | *Preskoči za sada* (outline) / *Dalje: Smjene* (ink); rail word *nije postavljeno* / *postavljeno* | a failed fact read: the step reads *nije postavljeno*, never a guess of done |
| Step 5 prerequisites | no team or no working type | `Za rotaciju još nedostaje:` + links; no builder | n/a |
| *Danas* card | signup org, 3 facts missing, not dismissed | first card, `Postavljanje: još 3 koraka` | operator org, dismissed, member, or reads missing: no card |
| *Sakrij* | confirm | `onboarding_dismissed = true`, card gone for every admin | refusal: alert in the dialog, card stays |
| Add dialogs | open any of the three | no kind, no times, no level, no allowance, *Vrijedi od* empty | submit without: the field's refusal, nothing sent |

## Epic AC Deviations

- "each embeds the shipped write path … Members (credentials or invitation)": met; invitation is the credential hand-off (AD-24, F2). Edits from the embedded lists (*Uredi*) open the shipped edit screens in the app shell, not inside the frame: the edit screens are routes, not components (Design Notes D6).
- "empty states explain each concept with organization-neutral examples": met by each step's explainer and the list empty states. UX-DR70's organization *Sati* line (people but no rotation) is **DEFERRED** (deferred-work): *Sati* draws a zero row per active person, so "nobody has a shift" needs a new derivation in the hours feature.
- "a progress rail `korak 3 od 7`": built as UX-DR65 writes it, `Korak 3 od 7`.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0074_onboarding_dismissed.sql` (new) -- the column, its column grant; audited by 0061's triggers as a field.
- `packages/domain/src/history.ts` + test -- `onboarding_dismissed` → `onboardingDismissed` (boolean field).
- `apps/web/src/features/history/services/history-rows.ts` -- its label key.
- `apps/web/src/features/organization/services/snapshot.ts` (+ test) -- columns `founded_by`, `onboarding_dismissed`, mapped to `foundedBySignup` (a boolean; the uuid is never kept) and `onboardingDismissed`; the dismiss edit through the existing update.
- `apps/web/src/features/organization/hooks/use-onboarding-dismiss.ts` (new) -- the one dismiss write, under `ORGANIZATION_SNAPSHOT_KEY`.
- `apps/web/src/features/onboarding/` (new) -- `services/progress.ts` (pure: facts, step states, counts, labels, next step; node-tested), `services/steps.ts` (the seven steps and their slugs), `hooks/use-onboarding-progress.ts`, `components/` (setup frame, rail, phone progress card and *Svi koraci* sheet, footer, explainer, step 5 prerequisites, step 6 sign-in link, step 7 summary, *Danas* card and *Sakrij* dialog).
- `apps/web/src/pages/postavljanje.tsx` -- a claimed session: return target, else step 2 (admin) or *Danas*; step 1's lede gains `Korak 1 od 7` (deferred-work, 19.3).
- `apps/web/src/pages/postavljanje.$step.tsx` (new; the parameter is `$step`, D13), `router.ts` -- steps 2–7, outside the app layout, guarded (session, set-password, admin).
- Reads reused: `hourBandsQueryOptions`/`HOUR_BANDS_LIST_KEY`, `teamsQueryOptions`, `shiftTypesQueryOptions`, `rotationQueryOptions` (history = every version), `membersQueryOptions` (`eslint.config.js` `FEATURE_PUBLIC`).
- Steps compose: `HourBandAddDialog`/`HourBandListSection`/`useHourBandList`; `TeamAddDialog`/`TeamListSection`/`useTeamList`; `ShiftTypeListSection`/`ShiftTypeAddDialog`/`useShiftTypeList`; `RotationSection`; `MemberTable`/`MemberAddDialog`/`useMemberList`/`useMemberCreate` with local state for the URL search.
- O3: `shift-types` (kind unselected, `SHIFT_TYPE_KIND_MISSING`; the hook resets the kind on every opening), `rotation/utils/draft.ts` (`effectiveChosen`, `ROTATION_EFFECTIVE_UNCHOSEN` the save's last refusal, `previewRefusalOf` for previews) + `services/erasures.ts` (the 11.2 preview ignores it) + `services/write.ts` (`effectiveFromRefusedOf`) + `services/history.ts` (`draftSaveBarHintOf`) + `rotation-section.tsx` (*Vrijedi od* shown empty, marked and described by the refusal) + `rotation-notices.tsx` (the refusal's id) + `rotation-save-bar.tsx`; `use-rotation-builder.ts` changed only to take focus to *Vrijedi od* on its refusal (the phone stepper moved to step 3 first); `members` (level unselected, allowance empty; `newMemberChoiceOf` in `services/write.ts`).
- Empty states: hour-band table, team list, shift-type list; *Danas* coverage with no team; *Kalendar* with no team; *Ljudi* with one person.
- 19.2 deferral: `features/auth/components/mail-sent-panel.tsx`, `hooks/use-mail-sent.ts` (a stable name, a re-announced resend).
- Pages: `danas.tsx` (card first; its heading takes focus after a dismissal), `kalendar.tsx`/`calendar-grid.tsx`. `ljudi.tsx` is unchanged: the one-person line lives in the shared `member-table.tsx` (from `use-member-list.ts`'s unfiltered count), so *Ljudi* and step 6 both show it.
- Tests and sweeps: `hr.json`, `test/resource-hygiene.test.ts`, `pages/*sweep*`, `key-sources.fixture.ts`, `router.test.ts`, `test/supabase-scaffold.test.ts` (0074 pins, the organizations column grant list), `test/rls-isolation.test.ts` (grant list, unrun), `test/create-organization.test.ts` (a fresh organization's rows and the dismissal, unrun), `e2e/tests/auth/signup.spec.ts` (founding lands on step 2, unrun).
- Implementation notes found in planning (not frozen):
  - Copy is in the mockups word for word: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-11-21-signup/mockups/onboarding-1.html` (steps 2–8) and `danas-and-empty-states-1.html`; UX-DR65–70 in `epics.md` win where they differ.
  - The migration follows `0048_minimum_members.sql`'s shape (`add column`, then `grant update (…) on table public.organizations to authenticated`); 0004's `organizations_update_by_own_active_admin` already admits only an active admin. Pins: `test/supabase-scaffold.test.ts` ~line 950 (the granted-column list) and ~1310 (per-column cases); `test/rls-isolation.test.ts` ~2368 (the same list).
  - History: `HistoryField` list (~line 174) and `FIELD_OF_COLUMN` in `packages/domain/src/history.ts`; `history-rows.ts` maps each field to `history.field.*`.
  - `useTeamList`, `useHourBandList` read `ORGANIZATION_SNAPSHOT_KEY` from the cache (the chrome observes it); outside the chrome the setup frame observes it itself (its lockup reads the organization).
  - `useMemberList(search, write)` and `useMemberCreate(open, writeAdding)` take the URL's search and writers on *Ljudi*; step 6 passes a fixed default search and local state.
  - `RotationSection` takes `heading` and `shiftTypes` slots; step 5 passes its own heading and no shift-type section (step 4 owns it).
  - The rotation snapshot's `history` holds every version's attribution (unbounded): its length is the rotation fact.
  - `sati`'s zero rows: `organizationHoursRowsOf` gives every active member a row, hence the deferral.
  - Rendering: Playwright's headless shell at `/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` with `LD_LIBRARY_PATH=/tmp/claude-0/-root-ai-agency-projects-shift/15d9a6a8-661d-4657-8658-921e573ab7c3/scratchpad/libs/usr/lib/x86_64-linux-gnu`; `playwright-core` is in `node_modules/.pnpm/playwright-core@1.63.0`; scripts go in that scratchpad (`render/shot.mjs` screenshots a URL). A DB-free harness (Vite with stubbed query data, as 16.1 did) or a dev server with mocked reads renders the real components.
- Docs: epics UX-DR33/61/65–70 as built, EXPERIENCE.md, spine AD-24 (amended, as built), SECURITY-REVIEW 19.4 evidence (D5, E4), deferred-work, sprint-status.

## Tasks & Acceptance

**Execution:**
- [x] 0074, the domain field, the scaffold pins, the unrun DB cases.
- [x] Organization snapshot and the dismiss hook.
- [x] The onboarding feature, the two routes, the *Danas* card.
- [x] O3 in the three dialogs; the empty states; the resend countdown.
- [x] Copy, sweeps, fixtures, router tests; e2e grep for changed surfaces.
- [x] Render the frame, each step, the card and the empty states in Chromium and look at them.
- [x] Docs, deferred-work (19.4 entries answered), sprint-status (17.3 `done  # #350`, 19.4 `review  # built, CI pending`).

**Acceptance Criteria:**
- Given the repo, when typecheck, lint, build, the web and domain suites and the allowed root files run, then they pass (the scaffold's no-gap case excepted until 0073 merges).
- Given `progress.ts`, when each fact flips, then the rail state, the card's count and plural, the next step and the forward control follow, in one function.

## Design Notes

Decisions (the founder said decide and record):

- **D1. Routes.** `/postavljanje/$korak` (built as `$step`, D13) with Croatian slugs `satni-pojasi`, `smjene`, `tipovi-smjena`, `rotacija`, `ljudi`, `gotovo`; an unknown slug goes to step 2. Outside `_app` (no shell), with `_app`'s session, set-password and destination checks and the shared admin guard.
- **D2. After founding** with no return target, step 1 navigates to `/postavljanje`, whose guard sends a claimed admin to step 2 (UX-DR65); a carried target still wins (19.3 D7).
- **D3. Reads.** `features/onboarding` imports other features' `services/list` query options (read-only) and no write module: AD-24's "imports no other feature's services" read as "no second write path", since AD-24 itself has the hook read through the owners' query options.
- **D4. `founded_by` in the snapshot.** Selected and mapped to a boolean at parse; the uuid is never kept or rendered. Every member can already select it (table-wide SELECT); no grant changes.
- **D5. Card reads** run only once the organization snapshot says founded by signup and not dismissed, so an operator-provisioned organization pays no extra read.
- **D6. Edits** (*Uredi* on a list row) open the shipped edit route in the app; the frame hosts list, add and builder only.
- **D7. O3 everywhere.** Shift type: the kind starts at *Odaberi*, times appear only for a working kind, empty. Rotation: the draft keeps today as its preview date, but *Vrijedi od* is shown empty and a save refuses `Odaberi datum od kojeg rotacija vrijedi.` until a date is chosen (`effectiveChosen`); the anchor stays today (not a stored default the user sees). Member: level at *Odaberi* and the allowance empty (a pre-filled 20 is a count, FR-97).
- **D8. Danas card position.** First in the admin column, above *Treba tebe*, outside `AdminTodayBody`'s skeleton.
- **D9. Step 6** composes *Ljudi*'s table and *Nova osoba* dialog unchanged; the "Ti" mark on the founder's row is not added (the shared table has no viewer mark), and `Za sada si jedina osoba u organizaciji.` says it instead.
- **D10. Resend countdown** (19.2 deferral): the button's name stays `Pošalji ponovno`; the countdown is visible text hidden from the accessibility tree, and a static description says the wait; a second resend re-announces its status line.
- **D11. The history** shows the dismissal as a field (`Postavljanje sakriveno`), not hidden.

Decisions taken while building (recorded here, outside the frozen block):

- **D12. Step 5's first section.** The builder's `shiftTypes` slot holds a read-only note of step 4's types (`N tipova smjena u upotrebi`, the way back to step 4), not the list: on a phone the builder is a four-step stepper whose step 1 is that slot, and an empty step 1 would be a dead end. The list and its add dialog stay step 4's (one write path). The frame draws the step's heading and explainer; `RotationSection` gets `heading={null}`, so its header holds the history button alone.
- **D13. The route parameter is `$step`, not `$korak`.** The URL is unchanged (`/postavljanje/<slug>`, D1). `test/localization-applied.test.ts` counts `korak` as a word, and a route parameter named `korak` ships in the chunk as data. The slugs are written as whole paths in `services/steps.ts`, and `/postavljanje/tipovi-smjena` joins the sweep's route segments (as `/postavke-rotacije/tipovi-smjena/` did), since its `smjena` is a path, never copy.
- **D14. `Vrijedi od` never chosen is the draft's LAST refusal.** An unchanged or otherwise refused draft still says its own reason first (judged on the preview's date, today); `ROTATION_EFFECTIVE_UNCHOSEN` only stands between a sound draft and its save. The save bar names no date until one is chosen. The anchor (*Referentni datum*) stays today, as D7 records.
- **D15. The allowance's own refusal.** An empty leave-days field is `Upiši dane godišnjeg odmora (0 ili više).` (`MEMBER_ALLOWANCE_EMPTY`); a field holding something else keeps the shipped `Unesena vrijednost nije dopuštena.`. A level not chosen is `Odaberi razinu ovlasti.` (`MEMBER_LEVEL_UNPICKED`), in field order after the address. Neither is on the wire.
- **D16. The frame's top bar** shows the organization's lockup and name, *Postavljanje* and *Izađi iz postavljanja*; not the admin's name (it would be a further read for a label). Step 1 is named in the rail and not linked: it has no page to reopen once the organization exists.
- **D17. Step 6** shows the full sign-in link (`{origin}/prijava/{kratica}`), not the mockup's `…/` abbreviation, because that is what *Kopiraj* copies. The founder's one-person line is the shared table's (`ljudi.alone`), drawn on *Ljudi* too; the step adds no second line.
- **D18. *Kalendar*'s *Nastavi postavljanje*** shows for an admin while the card would be drawn and no team exists (the calendar is empty), above the month card; it goes to the first step left.
- **D19. The step count words.** The card's title, step 7's `left` line and its counts are ICU plurals (one/few/other); step 7's rotation line is the latest saved version's *Vrijedi od*.
- **Left for the founder** (deferred-work, 19.4 block): the rotation builder's *Novi korak* picker opens on the first type in use (a picker, nothing is added until *Dodaj korak*), and *Sati*'s fresh-organization line.

Required inputs (deferred-work entries addressed to 19.4), each answered and marked RESOLVED in the same change:
- 19.2/19.3 `sessionDestination`, STAYS OPEN part (a claimed admin asking for `/postavljanje` reaches steps 2–7): D1, D2.
- 19.2 resend countdown and the unchanged status line: D10.
- 19.3 step 1's lede without `Korak 1 od 7`: step 1's lede gains it, now that the rail exists (the entry's D2 half stays with the founder).
- UX O3 (README): D7, applied in the shared dialogs, so everywhere.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm --filter ./apps/web test`, `pnpm --filter @shift/domain test` -- pass.
- `pnpm exec vitest run` on the allowed root files -- pass, but the scaffold's no-gap case until 0073 merges.

**Manual checks:**
- The Chromium harness renders steps 2–7 (desktop and phone), the *Svi koraci* sheet, the *Danas* card and its dialog, and the changed empty states; each image is looked at.

**Results after review 1 (2026-11-23, local):** `pnpm typecheck` and `pnpm lint` clean; `pnpm build` passed. Web: 186 files, 6902 passed. Domain: 22 files, 976 passed. The eleven allowed root files: 3708 passed, 1 failed — the scaffold's no-gap case (0073 unmerged), as before. Re-rendered in the harness and looked at: step 2, step 5 with a refused save (`Odaberi datum od kojeg rotacija vrijedi.`, focus on the empty *Vrijedi od*), step 7 with steps left for a signup organization (the card's promise) and an operator one (`… na njihovim stranicama.`), step 4's refusal and the kind reset, step 6's refusals, *Danas* with the card, its dialog (naming *Organizacija*), and after a confirmed dismissal (the card gone). The new DB case and the e2e additions are unrun (CI).

**Results (2026-11-22, local):**
- `pnpm typecheck` (web, e2e, smoke, perf, domain) and `pnpm lint` clean; `pnpm build` passed.
- Web: 186 files, 6893 tests passed (new: `features/onboarding/services/progress.test.ts`, `sign-in-link.test.ts`; extended: organization snapshot, shift-type write, rotation draft and write, member write and date-refusal, `router.test.ts`, the page sweeps and key sources). Domain: 22 files, 976 passed.
- The eleven allowed root files: 3705 passed, 1 failed — `supabase-scaffold`'s "numbers migrations … with no gaps", expected while 0073 (19.5) is unmerged (this branch has 0072 and 0074). The new 0074 pins and the onboarding literal sweep (`resource-hygiene`, with its self-test) pass.
- NOT RUN (the rules): `test/create-organization.test.ts`'s new case "the onboarding card's one stored fact" and the edited granted-column list in `test/rls-isolation.test.ts` (DB-connecting; CI's fresh stack is their first run); every e2e change (CI is the gate): `signup.spec.ts` (founding lands on step 2, *Izađi iz postavljanja*, the card's `Postavljanje: još 5 koraka`), the rotation specs (`chooseEffectiveFrom` before each desktop save, `Vrijedi od` asserted empty with today as its `min`, the phone stepper choosing it on step 3), `rotation.page.ts`'s `addShiftType` choosing *Radni*, `people.page.ts`'s `fillNewMember` choosing *Član* and 20 days, `login.page.ts`'s `resendWaiting` by its fixed name.
- **Rendered and looked at** (a DB-free harness in the scratchpad, not committed: the real app built with Vite, a fake signed-in admin session, Supabase answered by a fake `fetch` from `rotation.fixture.ts` rows, Playwright's headless Chromium at 390 and 1280 px): step 2 fresh (explainer, the band list's empty state, *Preskoči za sada*), step 3 with three teams (*Dalje: Tipovi smjena*, rail ticks), step 4 and its add dialog (*Odaberi*, no times), step 5 with no working type (`Za rotaciju još nedostaje:` and the link to step 4) and with the builder (*Vrijedi od* empty, the types note in section 1), step 6 alone (sign-in link, `Za sada si jedina osoba u organizaciji.`) and its *Nova osoba* (level *Odaberi*, days empty), step 7 with three steps left and with none, the phone's progress card and *Svi koraci* sheet, an unknown slug and bare `/postavljanje` (both land on step 2), *Danas* for a signup organization (card first, `Postavljanje: još 5 koraka`, coverage `Još nema nijedne smjene.`) and for an operator organization (no card), the *Sakrij* dialog, *Kalendar* with no team (*Nastavi postavljanje*, the two lines), *Ljudi* with one person. No horizontal scroll and no control under 44 px at either width. Pressed in the harness: *Sakrij postavljanje* (the PATCH sends `onboarding_dismissed`, the card goes); a shift type with no kind (`Odaberi vrstu tipa smjene: radni ili neradni.`, then *Radni* shows empty times); a person with no level, then no days (each its own refusal); a rotation save with *Vrijedi od* empty (`Odaberi datum od kojeg rotacija vrijedi.`, the field still empty). The harness's *Danas* admin body answered its other reads with empty rows; the screens are the real components, not the page compositions copied.

**Residual risks:**
- The DB case and every e2e edit are unrun until CI. The rotation e2e edits are the widest: every builder save now needs `Vrijedi od` chosen, and a save reached while the input is off screen (the phone stepper past step 3) needs it chosen first; two phone flows were edited, others may surface in CI.
- The UX review is pending the founder's acceptance; the screens follow it (and the decisions above).
- 0074 must be applied before this SPA ships (the snapshot selects `founded_by` and `onboarding_dismissed`), as `DEPLOY.md` orders migrations before the SPA; and it merges after 0073.

**Results after the rebase onto `origin/main` at #352 (19.5, 0073 merged; 2026-11-23).** Conflicts resolved: `sprint-status.yaml` (main's 19.3 `done  # #349`, 19.5 `review`, epic 17 retro done; 19.4 `review  # built, CI pending`), `deferred-work.md` (19.5's section kept, then 19.4's), `packages/domain/test/history.test.ts` (both `suspended` and `onboarding_dismissed` in the audited-columns fixture), and 17.3's spec (main's retro rewrite kept; this branch's rewrite dropped). Then: `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; web suite 186 files, 6902 passed; domain 22 files, 976 passed; the eleven allowed root files 3715 passed, none failed (the no-gap case now passes with 0073 on main). Still unrun, CI is their first run: the two DB cases in `test/create-organization.test.ts`, the `rls-isolation` grant list, and the `e2e/` changes.

## Review Findings

**Review 1 (2026-11-23).** Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Epic AC Auditor, Unrun DB Test Auditor (the last found nothing blocking). Every patch below is applied in the working tree.

Patches:
1. `ROTATION_EFFECTIVE_UNCHOSEN` silenced the 11.2 short-staffed preview for every unchosen draft, everywhere. `previewRefusalOf` (draft.ts) ignores it, and `draftShortStaffedOf` (erasures.ts) uses it; the save path (`erasure-check.ts`, the builder, `saveRotation`) still refuses. Node test in `staffing/surfaces.test.ts`.
2. A refused *Vrijedi od* (not chosen, past, too far: `effectiveFromRefusedOf`) marks the input `aria-invalid`, describes it by the save's alert (`ROTATION_SAVE_ERROR_ID`) and takes focus there; on a phone the stepper reaches step 3 first. The draft test's comment on clearing now says a cleared input keeps the chosen date, and tests it.
3. `ROTATION_EFFECTIVE_UNCHOSEN` joins the "every code its own key" list; `draftSaveBarHintOf` (history.ts, pure) names no date while `effectiveChosen` is unset, node-tested.
4. Step 5 says a failed teams or shift-types read, with a retry, instead of nothing; the frame says a failed organization read, with a retry; step 6 has the members list's retry, as *Ljudi* does.
5. A `povratak` that `returnTargetOf` refuses counts as none, in `use-create-organization.ts` and the `/postavljanje` guard, so the founder reaches step 2. Router test.
6. The `/postavljanje` guard reads the role without a `cause`, so never a reused answer: founding navigates there from the same route (a `stay`), and the role cached before the claim would have sent the new founder to *Danas*. Router test pins `{ reuse: false }`.
7. The progress hook's `loading` includes the gating organization read. The query data → reads mapping is `onboardingReadsOf` (progress.ts), node-tested over real snapshot shapes (a `readRotation` snapshot, members ok and refused, archived teams and types), each fact flipping and the card's count; the D5 gate is `progressReadsEnabledOf`, node-tested.
8. Step 7 promises the *Danas* card only where it will be (`cardAwaitsOf`: founded by signup, not dismissed; `onboarding.done.leftNoCard` otherwise). The rotation's date is the latest SAVED record's `Vrijedi od` (by `createdAt`), not the latest date; `rotationVersions` is `rotationRecords` (one per team and date saved).
9. The dismissal uses the shared write gate (`useWriteGate`, `OfflineWriteNote`); the dialog does not close through `onCancel` while pending; after a dismissal focus goes to *Danas*'s heading. The dialog names *Organizacija* too.
10. The resend's description is attached only while waiting and takes `RESEND_WAIT_SECONDS` as `{seconds}`. Step 6's *Kopiraj* status is remounted per copy (re-announced) and clears after `LINK_STATUS_MS`.
11. `Korak {n} od {total}`, `Postavljeno {set} od {facts}` and step 1's lede take `STEP_TOTAL` / `FACT_TOTAL` as parameters; the rendered text is unchanged.
12. The frame's h1 renders always; the stale `lede: null` comment is gone (`lede` is required).
13. The one-person line was checked: it counts the unfiltered read (`members` before narrowing) and is drawn only by the admin's `MemberTable`, never the member directory. No change.
14. The shift-type dialog resets its kind to *Odaberi* (and the times away) on every opening.
15. The add-member dialog's level and days refusals are `newMemberChoiceOf` (write.ts), node-tested; the structural pin reads its `!choice.ok` branch.
16. *Pokrivenost danas*'s no-team condition is `coverageHasNoTeamOf` (admin-today.ts), node-tested over all-off and all-no-rotation.
17. Indentation fixed in the two list empty states; step 2 uses the shipped `organization.hourBands.lede`, and the duplicate key is gone (hygiene pins updated).
18. `test/create-organization.test.ts` (unrun): a member-role colleague of the founded organization and the pilot's admin each update `onboarding_dismissed` and match zero rows; every scene is built as the owner before `actAs`. `rls-isolation`'s title says "fifteen" writable columns.
19. `e2e/tests/auth/signup.spec.ts` (unrun): after the card, a band on step 2 → the rail's *postavljeno*, *Dalje: Smjene*, *Danas* `još 4 koraka`; *Sakrij* → confirm → the card gone, also after a reload (new `login.page.ts` locators).
20. DESIGN.md's *setup-rail* and *Postavljanje card* rows and EXPERIENCE.md's inventory row have "as built" lines; UX-DR69's "no other entry point" is reconciled with *Kalendar*'s *Nastavi postavljanje* (shown only while the card would be). The requested amendment to the frozen `## Epic AC Deviations` is NOT written into the frozen block (see the Spec Change Log).

Rejected:
- O3 reaching existing organizations' rotation builder (every builder now needs *Vrijedi od* chosen): intended by O3 and D7 (the dialogs are shared); flagged for the founder.
- Setting 19.3 `done` in sprint-status: outside this story's instruction; reported to the orchestrator.
- Undoing a dismissal from settings: UX-DR69 adds no other entry point; the founder may ask for one.

## Spec Change Log

- **2026-11-23, review 1 — proposed amendment to the frozen `## Epic AC Deviations`, NOT applied.** The orchestrator asked for this bullet, for the founder's approval: *"every step shows … *Preskoči za sada*": reinterpreted per UX-DR65: on steps 2–6 the forward control reads *Preskoči za sada* while the fact is missing and *Dalje: {step}* once it exists; step 7 has its own actions; below 640 px the rail is the progress card with *Svi koraci*.* The frozen block is human-owned ("do not modify unless human renegotiates") and this run's instructions forbid editing it, so the bullet waits here for the founder to accept and move it into the frozen block.

## Suggested Review Order

**Progress derived from the rows (AD-24)**

- Entry point: the query data of each owning surface, mapped to the five facts.
  [`progress.ts:99`](../../apps/web/src/features/onboarding/services/progress.ts#L99)

- The facts, then the forward control and the card, one pure module.
  [`progress.ts:126`](../../apps/web/src/features/onboarding/services/progress.ts#L126)

- D5: no fact read for an operator, dismissed or member organization.
  [`progress.ts:312`](../../apps/web/src/features/onboarding/services/progress.ts#L312)

- The one hook, reading through the owners' query options.
  [`use-onboarding-progress.ts:70`](../../apps/web/src/features/onboarding/hooks/use-onboarding-progress.ts#L70)

**Routing and the frame**

- `/postavljanje` for a claimed session: return target, else step 2; role read fresh.
  [`postavljanje.tsx:72`](../../apps/web/src/pages/postavljanje.tsx#L72)

- Steps 2–7, each composing the shipped surface's hooks and components.
  [`postavljanje.$step.tsx:291`](../../apps/web/src/pages/postavljanje.$step.tsx#L291)

- The frame: top bar, rail, phone progress card, footer.
  [`setup-frame.tsx:26`](../../apps/web/src/features/onboarding/components/setup-frame.tsx#L26)

**The one stored fact**

- 0074: the column and its own column grant.
  [`0074_onboarding_dismissed.sql:24`](../../supabase/migrations/0074_onboarding_dismissed.sql#L24)

- The dismissal, through the organization's existing update.
  [`use-onboarding-dismiss.ts:35`](../../apps/web/src/features/organization/hooks/use-onboarding-dismiss.ts#L35)

- The card, first on admin *Danas*, outside the skeleton.
  [`onboarding-card.tsx:35`](../../apps/web/src/features/onboarding/components/onboarding-card.tsx#L35)

**O3: nothing pre-selected**

- *Vrijedi od* unchosen refuses the save, never the previews.
  [`draft.ts:746`](../../apps/web/src/features/rotation/utils/draft.ts#L746)

- A member's level and days, refused in field order before anything is sent.
  [`write.ts:2347`](../../apps/web/src/features/members/services/write.ts#L2347)

- A shift type's kind starts at *Odaberi*.
  [`write.ts:84`](../../apps/web/src/features/shift-types/services/write.ts#L84)

**Peripherals**

- The resend's stable name and its description while waiting (19.2 deferral).
  [`mail-sent-panel.tsx:81`](../../apps/web/src/features/auth/components/mail-sent-panel.tsx#L81)

- DB, written unrun: only an active admin of the organization dismisses.
  [`create-organization.test.ts:521`](../../test/create-organization.test.ts#L521)
