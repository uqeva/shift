---
title: 'Retro housekeeping: pdfmake 0.3.14, epic 16 A5/A6, epic 17 A5/A6'
type: 'chore'
created: '2026-11-23'
status: 'done'
baseline_commit: '1f28f17bcce0ed51897190333b31052797109c03'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Five dev-owned retrospective action items are open: epic 14 A7 (bump `pdfmake` 0.3.13 → 0.3.14 once two weeks old), epic 16 A5 (ledger and spec hygiene) and A6 (process checklist), epic 17 A5 (docs hygiene in a public repo) and A6 (process rules for `bmad-build.toml`).

**Approach:** One chore branch. Bump the pinned `pdfmake`, update the spine's Stack row, re-render a real history PDF and look at it. Correct the stale docs the two retros name, scrub absolute scratchpad paths from every spec, add the process rules to `_bmad/custom/bmad-build.toml`, and mark the six items done in `sprint-status.yaml`.

## Boundaries & Constraints

**Always:** `pdfmake` stays pinned exactly (`save-exact`), at a version at least two weeks old on the day it is adopted (0.3.14 is of 2026-11-08, so eligible from 2026-11-22; 0.3.15 of 2026-11-20 is not, until 2026-12-04). Edits to retro-owned text quote the retro's own facts (run ids, commits), checked against `gh`. Resolved deferral entries get the `RESOLVED …` prefix.

**Ask First:** a `pdfmake` 0.3.14 change that alters the rendered PDF's layout or the font test; any change to product code beyond the version pin.

**Never:** touch `apps/web/src/lib/i18n/locales/hr.json` or `apps/web/src/index.css` (19.4 is editing them); run DB-connecting tests, e2e, `supabase`, docker, or gitleaks; signal any process this session did not start; rewrite git history (the scratchpad paths stay in past commits; only `HEAD` is cleaned).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PDF under 0.3.14 | 14.3's history PDF built from a realistic fixture (long unbroken words, longest names, many rows, a page break) | Same layout as 0.3.13: landscape A4, header row repeated, *Bilo*/*Sada* aligned, `Stranica n od m`, č/ć/đ drawn | A regression halts the bump (Ask First) |

</frozen-after-approval>

## Code Map

- `apps/web/package.json:36`, `pnpm-lock.yaml` (`pdfmake@0.3.13`, two places) -- the pin; deps of 0.3.14 are unchanged (`pdfkit ^0.20.2`, `xmldoc ^2.0.3`, `linebreak ^1.1.0`).
- `apps/web/src/features/history/services/pdf.ts`, `history-export.ts`, `pdf.test.ts`, `pdf.render.test.ts` -- the writer, the definition, the font test, the node render (`HISTORY_PDF_OUT=<dir>` writes the files).
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md:776` (Stack row), `:231` (14.3's "beyond `pdfmake` 0.3.13").
- `spec-16-1-the-month-prints.md` -- no `Status:` line; `:150` leaves `layout.spec.ts` to CI. Facts: #335, squash `b5469a7`; runs 44883730290 (`7c6418b`: `theme-contrast` 9, `theme-tokens` 3, `theme-fidelity` 3, and E2E shard 2/4's sticky head), 44884807614 (`895ff0e`: sticky head only), fixes `17fa33d`, `9f48916`, green 44886766058 (12 jobs passed, 5 skipped; E2E 144 × 4).
- `spec-16-2-the-domain-package-runs-on-the-server.md:137` -- the stale "not deterministic" paragraph.
- `deferred-work.md:1838` (CLI half), `:1907` (race cases' CI half), `:2001` (`/kalendar-na-mobitelu` offline) -- epic 16 retro R3 and its `:2001` disposition (line numbers as of the baseline, the summary lines).
- `_bmad-output/planning-artifacts/epics.md:402`, `:2910-2914`, `:2922`, `:2950`, `:2981` -- D-S6 "pending"/"waits".
- `/tmp/claude-0/…` and `/private/tmp/claude-501/…` paths: `spec-17-3…md:199`, `spec-19-1…md:147`, `spec-list-reader-refetch-failure.md:96`, `spec-hours-as-on-screen-leave-in-days.md:155`.
- `_bmad/custom/bmad-build.toml` -- `persistent_facts` and the `unrun-db-test-auditor` layer; `test/provisioning.test.ts`'s `grantees` (`:2856`) and invoker `.each` list (`:3150-3165`); `.github/workflows/pipeline.yml` jobs `test` (`:243`) and `e2e` (`:330`) start the stack; `test/claimless-account.test.ts` is 19.1's sweep.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json`, `pnpm-lock.yaml` -- pin `pdfmake` 0.3.14 (`pnpm --filter ./apps/web add pdfmake@0.3.14 --save-exact`).
- [x] `apps/web/src/features/history/services/pdf.render.test.ts` -- 0.3.14 renamed the node build's `virtualfs` to `sharedVirtualfs` (each document now reads through a child file system); the render test registers the faces on `sharedVirtualfs`, and its two comments name 0.3.14. The browser writer (`pdf.ts`, `addVirtualFileSystem`) is unchanged: it writes the same shared singleton.
- [x] `ARCHITECTURE-SPINE.md` -- Stack row to 0.3.14 with its dates and the adoption date; `:231` gains a note that 0.3.14 replaced 0.3.13 on 2026-11-23.
- [x] `spec-16-1…md` -- a `Status: done. Merged as #335 …` line with the runs and fixes; the `:150` sentence rewritten with CI's result.
- [x] `spec-16-2…md` -- mark the `:137` paragraph superseded by the root-cause lines.
- [x] `deferred-work.md` -- `:1838` and `:1907`: their CI halves settled by run 44932179182; `:2001`: `RESOLVED by the epic 16 retrospective` with the disposition (keep the route out of `OFFLINE_READABLE_PATHS`; the PO can overturn).
- [x] `epics.md` -- D-S6 ratified by the founder 2026-11-21; drop the waits-for-D-S6 lines.
- [x] the four specs -- replace absolute scratchpad paths with a plain description.
- [x] `_bmad/custom/bmad-build.toml` -- facts: no pattern kills; a migration's new function in both provisioning inventories; a new Edge Function built by every stack-starting CI job and called by the claimless sweep; theme root files run locally on CSS or token change; orchestrator gitleaks before every push, recorded; the epic's last story rewritten when set done. Widen the unrun-DB-test layer to check the inventories and the Edge Function wiring.
- [x] `sprint-status.yaml` -- items 67, 83, 84, 89, 90 set `done` with a note (`sprint_status.py update --set-action-status`, then the note).

**Acceptance Criteria:**
- Given the branch, when `grep -rE "/tmp/claude-|/private/tmp/" _bmad-output` runs, then only prefix mentions with no real path are left (the epic 17 retro's `/tmp/claude-0/…` and this spec's own).
- Given the bumped pin, when the web tests, typecheck, lint, `pnpm build` and the DB-free root files run, then they pass.

## Spec Change Log

- 2026-11-23 (review, unattended) — the frozen Problem said "Six" items and listed five (14 A7, 16 A5, 16 A6, 17 A5, 17 A6): corrected to "Five" (no human had approved the block; the orchestrator's instruction is the intent). Patched from review: the 0.3.13 vs 0.3.14 pixel comparison (the layout-change dismissal rested on prose only); Roboto 3.016 and the undocumented rename recorded; `deferred-work.md` 1907's historical text restored verbatim (a new head only); the Code Map's line numbers; `bmad-build.toml`'s pattern-kill rule scoped to sessions (CI's own teardown is exempt), the Edge Function rule and auditor widened to a changed `deno.json` import map and told to grep for stack-starting jobs, the claimless sweep's own equality test named, `theme-applied` named as the `dist` reader, the auditor's skip reply. Rejected: keeping the items open until merge (the orchestrator asked for `done` with a note; precedent: items 63 and 64 were set `done` as "built, CI pending"); keeping the `:2001` entry open (the instruction was to record the retro's decision; the entry says the PO can overturn it); new test guards in `pdf.render.test.ts` (the failure already names the property). Deferred: a DB-free test that fails on absolute local paths in committed docs.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
- `pnpm --filter ./apps/web exec vitest run src/features/history` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/static-hosting.test.ts test/key-hygiene.test.ts test/localization-applied.test.ts test/supabase-scaffold.test.ts` -- pass (after `pnpm build`).

**Manual checks:**
- Render the history PDF with 0.3.14 from a realistic fixture, rasterize with `pdftoppm`, look at every page.

**Results (2026-11-23, Node 24.19.0):** typecheck 0; lint 0; `pnpm build` 0 (`pdfmake-*.js` 771 kB and `vfs_fonts-*.js` 855 kB still separate chunks, precache 14 entries); `src/features/history` 7 files, 127 tests pass (the font test `pdf.test.ts` included: 0.3.14's `vfs_fonts.js` changed bytes, and every drawn character is still in its face); the web package 184 files, 6859 tests pass; the five DB-free root files 2705 tests pass. Before the test fix, `pdf.render.test.ts` failed on 0.3.14 at `pdfmake.virtualfs.writeFileSync` (undefined): the rename above. No DB-connecting test, e2e or `supabase` command was run; the bump touches no database.

**Rendered and opened (A GENERATED FILE IS OPENED).** `HISTORY_PDF_OUT=<scratchpad> pnpm exec vitest run src/features/history/services/pdf.render.test.ts` wrote the three PDFs from the real fixtures through pdfmake 0.3.14's node build and the same `vfs_fonts` faces; `pdftoppm -png` rasterized them at 60 and 100 dpi (a 250 dpi crop for the rules), and the pages were looked at. Same page counts as 0.3.13 (`spec-epic-14-retro-a9-history-pdf.md`, Results):
- `history-realistic.pdf`, 9 pages, A4 landscape (841.89 × 595.28 pt). Page 1: *Povijest promjena*, the seven header lines and the replacement note (`�`, `->`); the longest name (`Đurđica-Magdalena Šoštarić-Krčelić Vukovarsko-Srijemska Županijska Vatrogasna Zajednica Čakovec!!žžž`) wraps inside *Autor* and *Predmet*; the unbroken e-mail address breaks inside *Bilo* and *Sada*; nothing past the page edge. Page 2: the last short rows, then blank: the 90-change entry's first row moves whole. Pages 3–5: the 90-change entry as rows of 29, 29, 29 and 3 changes, each repeating *16.11.2026 09:05*, *Đurđa Šoštarić*, *Raspored · promijenjeno*, *Ljiljana Kovačević, 1.–31.12.2026*; rows 2–4 marked *(nastavak)* in italics; *Dan 1.12.* to *Dan 90.12.* in order. Pages 6–7: the 3000-character note in five rows split between words, each continuation marked; then `Zoë � Anić`, `�� -> Smjena B`, `meta: {"a":"->","b":[1,2]}`. Header row repeated on every page; `Stranica n od 9` in each footer; č, ć, đ, š, ž drawn; no empty box. Row rules even at 250 dpi.
- `history-plain.pdf`, 11 pages (`Prikazano: 119 promjena od 119`), each row three changes: no row cut by a page, no *(nastavak)*, no note.
- `history-glyphs.pdf`, 9 pages: its last page ends with *Organizacija · početak* / *Početak povijesti* in italics and *Bez promijenjenih polja* spanning *Bilo* and *Sada*.
- **Side by side with 0.3.13 (review).** The same three fixtures were rendered through the 0.3.13 node build still in `node_modules/.pnpm` (a temporary copy of the render test, deleted after), rasterized at 100 dpi, and every page image compared pixel by pixel with 0.3.14's: all 29 pages are identical (no differing pixel), the page counts match, and `pdftotext -layout` gives identical text. So 0.3.14's table fixes that this document's path could reach (`headerRows: 1` repeated headers, the page height of the temporary context for `dontBreakRows` rows, the polyline and position fixes) change nothing here; the rest (justified text, lists, `pageBreakBefore`, SVG, attachments, URL caching) is not used. Roboto moved to 3.016 in `vfs_fonts.js`: the font test (every drawn character in its face) and the line-height check in `pdf.test.ts` pass, and the pages are pixel-identical.
- **The node rename is undocumented.** 0.3.14's CHANGELOG does not mention `virtualfs` → `sharedVirtualfs`; only the render test's failure found it. The next bump re-checks the node build's internals by running `pdf.render.test.ts`, not by reading the changelog. The browser bundle's `addVirtualFileSystem` writes the same module's default instance that `sharedVirtualfs` names (`build/pdfmake.js`, modules 7791 → 6402), and CI's e2e downloads the real PDF.

**Review (2026-11-23, unattended).** Blind, edge-case and verification-gap layers as fresh-context subagents on the diff from the baseline (passed as a file). The epic AC auditor's question was answered inline: the spec traces to three retrospectives, not to an epic story, so no epic story's ACs apply. The unrun-DB-test layer: no DB test changed. intent_gap 0, bad_spec 0; patches and rejections in the Spec Change Log; one deferral (a local-path test). After the patches: lint 0; `src/features/history` 127 pass; the five DB-free root files 2705 pass. Not CI's here and not run locally: e2e (the real browser download), DB tests; CI is the gate. gitleaks is the orchestrator's.

## Suggested Review Order

**The pdfmake bump**

- The pin, two weeks old on adoption; 0.3.15 is not yet eligible.
  [`package.json:36`](../../apps/web/package.json#L36)

- The only code change: 0.3.14's undocumented node rename, `virtualfs` → `sharedVirtualfs`.
  [`pdf.render.test.ts:221`](../../apps/web/src/features/history/services/pdf.render.test.ts#L221)

- The Stack row: dates, the CVE fix, Roboto 3.016, pixel-identical renders.
  [`ARCHITECTURE-SPINE.md:776`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L776)

**Process rules (bmad-build.toml)**

- Pattern kills banned in sessions; only own PIDs.
  [`bmad-build.toml:37`](../../_bmad/custom/bmad-build.toml#L37)

- Every new database function joins both provisioning inventories.
  [`bmad-build.toml:39`](../../_bmad/custom/bmad-build.toml#L39)

- A new Edge Function or import-map change is built by every stack-starting job and swept.
  [`bmad-build.toml:41`](../../_bmad/custom/bmad-build.toml#L41)

- Theme root files run locally on CSS or token changes; orchestrator gitleaks before push.
  [`bmad-build.toml:43`](../../_bmad/custom/bmad-build.toml#L43)

- The Unrun DB Test Auditor now checks inventories and Edge Function wiring.
  [`bmad-build.toml:82`](../../_bmad/custom/bmad-build.toml#L82)

**Ledger and spec hygiene**

- 16.1 rewritten as merged, naming every CI run and fix.
  [`spec-16-1-the-month-prints.md:12`](spec-16-1-the-month-prints.md#L12)

- 16.2's first diagnosis marked superseded, kept as a record.
  [`spec-16-2-the-domain-package-runs-on-the-server.md:134`](spec-16-2-the-domain-package-runs-on-the-server.md#L134)

- CI halves settled and the offline-route disposition: new heads over verbatim history.
  [`deferred-work.md:1838`](deferred-work.md#L1838)

- Epic 17's header: D-S6 ratified, the waits dropped.
  [`epics.md:2910`](../planning-artifacts/epics.md#L2910)

- A scratchpad path replaced by a description (public repo); three more like it.
  [`spec-17-3-reminders-reach-the-member-by-push-or-email.md:199`](spec-17-3-reminders-reach-the-member-by-push-or-email.md#L199)

**Status**

- The five action items set done, each with its note.
  [`sprint-status.yaml:1231`](sprint-status.yaml#L1231)
