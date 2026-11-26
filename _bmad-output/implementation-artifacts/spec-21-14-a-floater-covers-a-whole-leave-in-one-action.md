---
title: '21.14 A floater covers a whole leave in one action'
type: 'feature'
created: '2026-11-26'
status: 'in-review'
baseline_commit: 'f9451c664a16656d173d031693e54fe77456e8ad'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-13-floaters-are-suggested-for-an-uncovered-shift-by-role.md'
---

Status: built, in review (CI pending; not committed by the implementer). Was: in progress (self-approved, unattended). Baseline: story 21.13's commit `f9451c6` on `feat/21-13-21-14-floaters` (migration `0084`). No migration. Touches the hot file `hr.json`. Run unattended (the coordinator's brief): both checkpoints self-approved, decisions in Design Notes.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A floater covering a week's leave takes one resolution screen per date: seven picks and seven saves, and seven notices for the floater. And when the leave is later shortened or a decision superseded, the cover's shift stays with nobody told (the 21.7 deferral).

**Approach:** The resolution screen gains *Pokrij cijelo odsustvo*: a dialog that picks an eligible floater, previews each unresolved conflict of the conflict's leave record as covered or not free (and why), runs AD-5's check over the covered dates, and saves them in ONE `resolve_with_personal_assignment` call (R16.4). The leave guard and the resolution screen name a cover's assignment that stays.

## Boundaries & Constraints

**Always:**
- The dialog's dates are the leave record's unresolved conflicts (the queue's own set), in date order. Each is covered when the floater's `floaterStandingOn` that date is free AND they are among that conflict's `assignmentCandidatesOf`, and its key is not held; otherwise listed with its reason (inactive, on leave, working, rest gap, cannot take that shift, held) and left open, never forced.
- The floaters offered are the eligible ones (`floaterEligibleFor`, the absent member's role), other than the absent member, ordered by covered dates (most first), then 21.13's order; a floater covering no date is listed but cannot be saved.
- *Provjeri* runs the grid's check (`manualCheckOf` over fresh reads) on a draft of the covered items (a `SHIFT` of the conflict's type, counted with its team): erasures block as in *Ručni raspored*, *Što se mijenja* and the short-staffed block are shown. *Spremi* re-checks, and writes only when the fresh check says the same; the write is one `resolveWithPersonalAssignment` call with every covered item (≤ 366), so the floater gets one notice.
- The 21.7 deferral: the leave guard of an amend or removal (5.4e) also names each replacement by assignment on an uncovered date whose assignment still applies (`{name} i dalje ima smjenu {date}`, to remove in *Ručni raspored*); the resolution screen names a superseded decision's cover that still holds its shift (decided on another type, 0038).
- Shown only while the organization has a floater and the record has an unresolved conflict; otherwise the screen is as 21.13 left it.

**Ask First:** none (unattended).

**Never:** a migration; a cover written without the check; a date forced onto a floater who is not free; DB-connecting tests, e2e or `supabase` commands run locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole week | 7 unresolved dates, floater free on 5 | 5 covered, 2 "nije slobodan: radi taj dan" / "odsutan"; one call of 5 items | — |
| Rest gap | floater's Noć ends as a Dan starts | that date "premalo odmora", open | — |
| Held key | one date held by an unapplied cover | "čeka uklanjanje stare zamjene", open | — |
| None free | floater free on no date | listed, *Spremi* waits | — |
| Erasure | cover replaces a day off that a decision needs | erasure dialog, nothing written until confirmed | — |
| Stale | check changed before *Spremi* | preview re-shown, nothing written | — |
| Taken / gone | RPC 23505 / P0002 | the screen's taken / gone line, re-read | — |
| Leave shortened | amend uncovers a covered date | guard line names the cover's shift | unknown read → the unknown line |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- As built (no frozen text changed): the check is `features/planning/services/manual-save.ts`'s `manualCheckFromReads` over the fresh reads (`leaveCoverCheckFromReads`, keyed on the leave record, the member list read fresh beside the three core reads), *Spremi*'s decision `coverConfirmStepOf` / `coverErasureSubjectOf`; the leave guard's cover lines come from `resolutions.ts`'s new `coverLinksOf`, and the superseded line from `replacement-effect.ts`'s `supersededCoverOf`.
- `packages/domain/src/floaters.ts` -- `floaterStandingOn` per date (21.13); NEW `leaveCoverOf` (per-date standings for one floater over a record's uncovered shifts, and the covered count) with tests.
- `apps/web/src/features/conflicts/services/floater-suggestions.ts` -- 21.13's adapter (floaters, windows, at-work shifts); NEW `features/conflicts/services/leave-cover.ts` (+ test): the dialog's model (dates, reasons, offered floaters, draft, items).
- `features/planning/services/manual-save.ts` (`manualCheckOf`, `manualPreviewKeyOf`), `manual-grid.ts` (`ManualDraft`), `components/manual-preview-dialog.tsx` (the preview's blocks) -- reused for the check; `conflicts/components/erasure-dialog.tsx`.
- `features/conflicts/services/resolution-write.ts` -- `resolveWithPersonalAssignment(client, items, held)` (21.7), the one write; its failures.
- `features/conflicts/services/resolution-screen.ts`, `hooks/use-conflict-resolution.ts`, `components/conflict-resolution-body.tsx` -- the action, the dialog's state, the superseded-cover line. NEW `components/leave-cover-dialog.tsx`, `hooks/use-leave-cover.ts`.
- `features/conflicts/services/resolutions.ts` `replacementLinksOf`, `features/leave/services/leave-section-replacements.ts` -- the assignment form's guard line; `replacement-effect.ts` `assignmentStandingIn`.
- `hr.json` (`zaOdluku.cover.*`, the guard's line), catalogs (`key-sources`, `source-guards`, `resource-hygiene`, `localization-applied` SOURCES), structural pins.
- e2e: extend `e2e/tests/conflicts/floater-suggestions.spec.ts` with a whole-leave cover (shared locks, full cleanup); grep e2e for any changed text.

## Tasks & Acceptance

**Execution:**
- [x] Domain `leaveCoverOf` + tests.
- [x] Web model, hook, dialog, action; the check and the one write.
- [x] Leave guard and superseded-cover lines.
- [x] Copy, catalogs, e2e case.
- [x] Spine AD-26 `Amended 2026-11-26 (story 21.14)`; epic context; DESIGN/EXPERIENCE; `deferred-work.md` (the leave-shortened entry RESOLVED); sprint status `review`.

**Acceptance Criteria:**
- Given no floater, when the suites run, then every screen is as 21.13 left it.
- Given typecheck, lint, build, the domain/ICS/web suites and the DB-free root files, when run, then they pass.

## Design Notes

1. **Where.** The dialog opens on a press from the conflict's resolution screen (its record and its unresolved dates); no host opens it on mount.
2. **The check.** The cover writes assignments, so AD-5's guard is the grid's own: the same reads, draft, erasures, preview and short-staffed block, over the covered dates' window.
3. **Sequential covers (as built).** `leaveCoverOf` reads each date's standing with every earlier covered date added to the floater's shifts, so a covered Noć leaves no rest for the next morning's Dan, and a second conflict on a date already covered (a double booking) finds the floater working. A covered shift with no times still marks its date as worked.
4. **Reason order (as built).** The floater's standing first (inactive, on leave, working, rest gap), then *cannot take that shift* (not among that conflict's `assignmentCandidatesOf`), then *held*. A date not writable adds nothing to the floater's day.
5. **Floater order (as built).** Covered dates, most first; then fewest at-work shifts in the first open date's month; then the snapshot's (names') order. Eligibility (R16.1) is read first; the absent member is never offered.
6. **The check (as built).** The cover is rebuilt from the same fresh reads (`leaveCoverCheckFromReads`), so the write sends exactly the items the fresh check stood on; a conflict no longer open is refused as *gone*, a floater covering nothing any more as *none*. *Spremi* compares `leaveCoverKeyOf` (the grid's preview key, every date's cover and the items): a difference shows the new check with *U međuvremenu se nešto promijenilo.* and writes nothing. Erasures go through the shared confirmation's one order.
7. **The landing (as built).** A landed cover holds the screen's view (as a decision does), re-reads `CONFLICT_REPLACE_WRITE_DEPENDENTS` and returns to the queue with a new status kind, `LEAVE_COVER_SAVED` (`zaOdluku.savedCover`: who covers whom, how many shifts). A refusal (taken, gone, held, denied, failed) is said in the dialog with the screen's own line, and re-reads as a decision's refusal does.
8. **Guard lines (as built).** `ReplacementWarning` is now `OverrideWarning | CoverWarning` (`isCoverWarning`); a cover's line follows the date's override lines. The superseded line sits under the facts as a status `Notice`, linking *Ručni raspored* on the cover's cell; it never blocks a decision.
9. **Build notes (the coordinator's brief).** ABSOLUTE RULES, verbatim: "Follow every rule in `_bmad/custom/bmad-build.toml`, including the theme tests on CSS changes. Never run `pnpm exec vitest run` without explicit file arguments. Never run DB-connecting tests, e2e or `supabase` commands; never touch docker containers, staging or the stopped manual-test stack; never `pkill`. Allowed: typecheck, lint, `pnpm build`, the package and web unit tests, the DB-free root tests by name, and headless Chromium renders. Do not run gitleaks. The repo is PUBLIC: no IPs, hostnames, real names or secrets." Toolchain: Node and pnpm from the user-local bin directory on `PATH`. Catalogs: `localization-applied` SOURCES, key-sources, `source-guards`, `resource-hygiene`. e2e takes the shared locks and cleans up fully. Do not commit (the coordinator commits).

## Verification

**Commands:**
- `pnpm build`, `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/ics test`, `pnpm --filter ./apps/web test` -- pass.
- The DB-free root files by name -- pass.
- Not run (STRICT DATABASE RULE): the e2e case is CI's first run.

**As run (2026-11-26, the implementation, before commit):**
- `pnpm typecheck` (root, e2e, smoke, perf and every workspace), `pnpm lint`, `pnpm build` -- clean.
- `pnpm --filter @shift/domain test` 1219 passed (28 files; `floaters.test.ts` gains the whole-leave cases); `pnpm --filter @shift/ics test` 35 passed; `pnpm --filter ./apps/web test` 7516 passed (211 files; `leave-cover.test.ts` new, 19 cases: the matrix's whole week, rest gap, held key and none free, cannot take, eligibility, no floater, the draft and items, the check, stale, gone, offline, the superseded cover, the saved line, and the leave guard's cover lines).
- DB-free root files by name: `resource-hygiene`, `supabase-scaffold`, `localization-applied`, `localization-guard`, `feature-boundaries`, `import-cycles`, `key-hygiene`, `e2e-plural`, `no-jsdom`, `typography-coverage`, `workspace-isolation`, `e2e-midnight-guard`, `e2e-fixture` (its three database cases skipped, no database configured) -- pass.
- No CSS or token changed, so the theme root files were not required.
- Not run (STRICT DATABASE RULE): the e2e case in `e2e/tests/conflicts/floater-suggestions.spec.ts` (*Pokrij cijelo odsustvo* over a Dan and the Noć after it, one call, two assignments and two decisions) is CI's first run. No headless render was made. Gitleaks: not run by this build (the coordinator's brief forbids it; the orchestrator scans before push).

**As run (2026-11-26, after the review pass 1 patches):** typecheck, lint and build clean; domain 1219, ICS 35, web 7525 (211 files; `leave-cover.test.ts` 28 cases) passed; the 12 DB-free root files above (resource-hygiene, supabase-scaffold, localization-applied among them) pass (3900 tests). The e2e case (now counting one `resolve_with_personal_assignment` POST and the saved line's count) remains CI's first run.

## Review Triage Log

### 2026-11-26 — Review pass 1 (no bad_spec loop)

- Layers: blind, edge-case, verification-gap, epic AC, unrun DB/e2e (5 of 5), each a context-free subagent over the diff against `f9451c6`.
- intent_gap: 0. bad_spec: 0. Epic AC: all four parts met; no deviation.
- patch (applied, 17 groups):
  - `[high]` A landed cover could read as "could not be saved" when a later re-read or navigation threw, inviting a second write: the write's success is kept apart from the steps after it; `view === null` still reports and re-reads; a cover never releases the screen's own hold (edge-case, blind).
  - `[high]` *Spremi* reached the erasure confirmation and the write without the stale comparison: `coverConfirmStepOf` decides stale first; confirming erasures compares the key again (edge-case, blind, verification gap).
  - `[medium]` The check read the floater flag and roles from cache: the member list is re-read fresh (`fetchFreshShared`) (edge-case, blind).
  - `[medium]` The check was anchored to the screen's date: it is keyed on the leave record, gone only when none of its dates is open; more than 366 items is the named refusal, never a throw (blind, edge-case).
  - `[medium]` The opener showed with no eligible floater: `leaveCoverOffered` is role-aware and excludes the absent member (blind).
  - `[medium]` Masculine-only reasons, a role-only none line and a hint promising every shift: neutral copy, with- and without-role lines, an honest hint; cover-specific taken and held lines (blind).
  - `[low]` A loading line distinct from none; *Spremi* `aria-disabled` only; the pick's summary announced; the dialog survives a withdrawn offer; superseded covers exclude the key's holder; `coverLinksOf` untrusted on a malformed link; the guard requires a `SHIFT`; floater order across every month of the leave; docs and test names (blind, verification gap).
  - `[medium]` e2e counts exactly one RPC POST, waits for the radio, asserts the saved count (unrun DB/e2e auditor).
- defer: none.
- reject: the noun *odsustvo* in the button and title (UX-DR77's name; *odsutnost* elsewhere, as the app says it).

## Suggested Review Order

**The rule (R16.4)**

- Entry point: one floater over a record's open shifts; a covered date counts as their shift.
  [`floaters.ts:267`](../../packages/domain/src/floaters.ts#L267)

**The dialog's model**

- Dates, reasons and offered floaters from the queue's own set.
  [`leave-cover.ts:280`](../../apps/web/src/features/conflicts/services/leave-cover.ts#L280)

- The check over fresh reads, keyed on the record; the grid's AD-5 check.
  [`leave-cover.ts:473`](../../apps/web/src/features/conflicts/services/leave-cover.ts#L473)

- *Spremi* decides: stale first, then erasures, then the one write.
  [`leave-cover.ts:564`](../../apps/web/src/features/conflicts/services/leave-cover.ts#L564)

- The covered dates as one call's items.
  [`leave-cover.ts:414`](../../apps/web/src/features/conflicts/services/leave-cover.ts#L414)

- Offered only with an eligible floater other than the absent member.
  [`leave-cover.ts:216`](../../apps/web/src/features/conflicts/services/leave-cover.ts#L216)

**Wiring**

- Check, confirm and the landed write kept apart from what follows it.
  [`use-leave-cover.ts:103`](../../apps/web/src/features/conflicts/hooks/use-leave-cover.ts#L103)

- The dialog: floaters, dates, *Što se mijenja*, short-staffed.
  [`leave-cover-dialog.tsx:221`](../../apps/web/src/features/conflicts/components/leave-cover-dialog.tsx#L221)

**A cover that stays (21.7 deferral)**

- The leave guard's cover links.
  [`resolutions.ts:481`](../../apps/web/src/features/conflicts/services/resolutions.ts#L481)

- Cover lines beside override lines.
  [`leave-section-replacements.ts:104`](../../apps/web/src/features/leave/services/leave-section-replacements.ts#L104)

- A superseded decision's cover still holding the shift.
  [`replacement-effect.ts:357`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L357)

**Peripherals**

- e2e, unrun: a Dan and a Noć covered in one call.
  [`floater-suggestions.spec.ts:228`](../../e2e/tests/conflicts/floater-suggestions.spec.ts#L228)
