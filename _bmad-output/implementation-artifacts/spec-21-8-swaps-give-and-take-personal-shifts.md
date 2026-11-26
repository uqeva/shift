---
title: '21.8 Swaps give and take personal shifts'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '25f38d31a74048f6c25a65a8fd5505a3818a7ea0'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-7-a-leave-over-a-personal-shift-is-a-conflict-and-a-replacement-is-an-assignment.md'
---

Status: review, built, CI pending (no PR yet; branch `feat/21-8-personal-swaps`). Baseline: `main` at `25f38d3` (21.7 merged, `0081`). Migration `0083`, after 21.20's `0082`: rebased onto `ebfa939` (#383, 21.20) before the push (conflicts: appended blocks in `rls-isolation`, `supabase-scaffold`, `deferred-work.md`, and *Danas*'s string pin, now 117). Touches `hr.json` (hot). Run unattended (the coordinator's brief): the migration number and the stored type were approved by the coordinator; both checkpoints self-approved, decisions in Design Notes.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A swap names a team and a date and is approved as roster overrides, so a Personal Shift (an assignment or a personal rotation's, counted with a team or none) can neither be given nor taken: 21.6 and 21.10 hid them from the swap form, and `swap_requests.team_id` is `not null`.

**Approach:** Migration `0083`: a swap side is a team shift or a Personal Shift (`given_personal`/`return_personal`, its type stored, its counted team or none); `decide_swap_request` writes a personal side as the taker's `SHIFT` and the giver's `OFF` through ONE `save_personal_assignments` call, so 0081's triggers end decisions on replaced assignments. The web proposes, reads, answers, previews and decides them.

## Boundaries & Constraints

**Always:** the database never projects (AD-3): the browser derives the Personal Shift and its type, 0083 stores it; 0049's refusals, signature and grants unchanged; a taker already holding a live `SHIFT` that date is refused (23505 `SWAP_REQUEST_TAKER_ASSIGNED`) before anything is written; one notice per member (0077's save); a team-only swap behaves and is stored exactly as before; no plpgsql alias `old`/`new`, no variable named like a column, no self-reading policy; the e2e cleanups delete the swaps naming an assignment or a type before deleting it.

**Ask First:** none (unattended; the migration was approved).

**Never:** no DB-connecting test, e2e or `supabase` command run locally; no new table, policy or function; no change to `save_personal_assignments`; one date twice in a swap with a personal side (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Personal on a team | viewer's assignment counted with A on A's day off | day detail offers *Predloži zamjenu*; key `{A, date, personal}` | — |
| Teamless | viewer on no team, assignment that date | *Moj raspored* row link `smjena=bez-tima`; lines say `bez tima` | — |
| Taker assigned | colleague holds a `SHIFT` assignment that date | listed, cannot be chosen (`takerAssigned`) | approval 23505 → *taken* |
| Return personal | colleague's teamless assignment later | offered; never on the given date | — |
| Approval | accepted personal swap | taker `SHIFT` (type, team or none), giver `OFF`, one save; decision names the taker's assignment | archived type → *archived* |
| Changed later | approved assignment replaced in the grid | *Odlučeno* reads changed later | — |

## Epic AC Deviations

- AC 1 "the request names it by member and date (team null when none), and 12.2's validity rules apply": met, and widened — the side also stores the shift type (the database cannot derive a personal rotation's, AD-3; spine amended). One date twice in a swap with a personal side is refused (narrowed; DEFERRED, `deferred-work.md` story 21.8).
- AC 1 "when they propose a swap from its day detail": reinterpreted for a teamless Personal Shift, recorded after review (Epic AC auditor): a day detail is a team on a date, so a shift counted with no team has none; it is proposed from its own row on *Moj raspored* (*Predloži zamjenu*, `smjena=bez-tima`), the same surface and rules. A Personal Shift counted with a team is proposed from that team's day detail, as the AC says.
- AC 2 "the taker gets an assignment … and the giver an OFF assignment, through the one save (one notice each)": met, with a refusal the AC does not name: a taker already holding a working assignment that date (one Personal Shift a member and date, R14.1). The preview's double booking for a Personal Shift is the taker's leg against their other legs (`shiftOverlapOf`).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0083_personal_swaps.sql` -- NEW: `team_id` nullable; `given_personal`, `shift_type_id`, `return_personal`, `return_shift_type_id` (+ FKs, partial indexes); checks re-stated (form, completeness, not-the-given, personal dates distinct); open keys NULLS NOT DISTINCT; grant; decisions' `personal_assignment_id`/`return_personal_assignment_id` (+ FKs, unique) and checks; `decide_swap_request` re-created.
- `apps/web/src/features/swaps/services/swap-proposal.ts` -- `SwapShiftKey` (union with `personal`), `SwapGiven`, `swapGivenOfDay`, `SWAP_NO_TEAM`, `swapAlreadyProposedOf`, `sideApplied` (override or `draftAppliedOf`), `SWAP_TAKER_ASSIGNED`/`SwapBlock`, `returnOptionOf`, `swapShiftShownOf`, `swapInsertOf`, blocked words.
- `swaps/services/organization-swaps.ts` -- `SWAP_SHIFT_COLUMNS`, `swapShiftsOfRow` (the one parse), decision's assignment ids, `swapChangedLaterOf` reads assignments, `teamName: null`. `my-swaps.ts` -- the same parse; `SwapShiftShown.noTeam`. `swap-decision.ts` -- null team names, `shiftOverlapOf`, `PERSONAL_ASSIGNMENTS_INVALID` → archived.
- `calendar/utils/day-detail.ts` -- `memberPersonalShiftOf`, `swapOfferedOf` offers a Personal Shift counted with the team, `shiftOverlapOf`; `OpenSwapProposal.teamId` nullable. `calendar/components/calendar-day-list.tsx`, `calendar-month-body.tsx`, `hooks/use-calendar-screen.ts` -- the teamless row's link.
- Components wording `bez tima`: `swap-proposal-form.tsx`, `swap-proposed-line.tsx`, `my-swaps-card.tsx`, `swap-decision-body.tsx`, `conflicts/components/swap-shifts.tsx`; hook `use-swap-proposal.ts`.
- History: `packages/domain/src/history.ts` (fields, hidden `return_personal_assignment_id`), `history-rows.ts`, `history-read.ts` (team nullable). `eslint.config.js` (planning's `manual-grid` public to swaps; swaps' `swap-proposal` to calendar).
- Tests: `swap-personal.test.ts` (new), swap/calendar/history unit tests, `key-sources`/`source-guards` pins, `resource-hygiene`, `supabase-scaffold` (0083 block), unrun `provisioning` (privileges, keys, indexes) and `rls-isolation` (three cases). e2e: `database-helper.ts` (cleanups, seed columns), `decide-swap.spec.ts` (story 21.8 case).
- Deliberately left: `notify` payloads (no team or type, 0050/0051), the deactivation close, `swap_parties_active`, `concurrent-writes` (the lock entry covers the re-created definer), `notify-boundary` (no new notification code).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0083_personal_swaps.sql` -- as the Code Map -- the stored form and the one-save approval.
- [x] web services and components above -- propose, read, preview, decide a Personal Shift -- AC 1 and 2.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-26 (story 21.8)` under AD-26's swaps line -- the stored type.
- [x] tests and e2e helpers above; `deferred-work.md` RESOLVED mark and two entries; sprint status (21.6, 21.7 done, specs rewritten); EXPERIENCE.md, UX-DR47.

**Acceptance Criteria:**
- Given a team-only swap, when it is stored, read or approved, then the row, the parse and the overrides are 0049's.
- Given a Personal Shift's approval, when a save refuses it, then nothing is written and the swap stays accepted.

## Spec Change Log

### 2026-11-26 — review (five layers; no loopback)

- Epic AC auditor: AC 1's teamless entry point (*Moj raspored*'s row, not a day detail) was unlisted; listed above. KEEP: the team-counted Personal Shift's proposal from its day detail.

### 2026-11-26 — CI run 1 on PR #384 (run 45793050063 at `035c2a1`)

- e2e shard 4 failed the new `decide-swap.spec.ts` case: the teamless colleague's *Danas* had no *Zamjene*. Cause: `todayViewOf` reads a viewer with no team (and no loan ahead) as unscheduled, and the member *Danas* drew only the unscheduled card, so *Zamjene* was never rendered for a member on no team, and a teamless student holding Personal Shifts read "not in any team, so there is no schedule" (a 21.6 gap). Fixed: a viewer holding a Personal Shift (`holdsPersonalShifts`) is scheduled, and the unscheduled body also draws *Zamjene*. No database change: the read is a plain select with an embedded decision, filtering on neither team.
- e2e shard 1 was cancelled at the job's 30-minute limit with no log kept (GitHub's log blob was missing); main's shard 1 runs in 10–14 minutes. No failure was reported before the cancel; left to the next run.

## Review Triage Log

- Patched: the taker is also blocked in the browser when their own personal rotation gives them a shift that date (edge-case, blind; the database cannot derive it); the parse refuses a row with a personal side naming one date twice (edge-case); a personal return option must be of a working type (blind); `removeSeededRotation` deletes an approval naming only a return override, which 0083 makes possible (unrun DB auditor); the scaffold block's messages and its no-new-function guard (blind); the 0083 header and the spine say which decisions 0081's triggers end, that the giver's hold is the browser's question as in 0049, that an archived personal type or team is 22023, and that a personal side carries no reason (blind); `epic-21-context.md`'s older status line marked superseded (blind); tests for changed-later over an assignment, the `PERSONAL_ASSIGNMENTS_INVALID` and `SWAP_REQUEST_TAKER_ASSIGNED` mappings, a teamless history request, the teamless sent line's round trip and the blocked words (verification gap).
- Deferred (`deferred-work.md`, story 21.8): a taker's live `OFF` overwritten silently, and the decision screen's generic wording for the taker refusal.
- Rejected: an open key including the form (a member has one Personal Shift a date and is then off every base roster); duplicate links on one row (one Personal Shift a date); the sent line's fallback team name; the snapshot window for changed-later (`calendar_personal_assignments()` answers every live row); console noise from `memberPersonalShiftOf`.
- Not covered by a test, accepted: the *Moj raspored* link's rendering (its rule is `ownSwapShiftOf`'s, tested; the e2e seeds the swap) and the decision preview's personal overlap branch (`shiftOverlapOf` is `rosterOverlapOf`'s body, which its tests cover).

## Design Notes

1. **The type is stored.** The given shift's type is what the taker's assignment is of; a personal rotation's type exists only in the browser's projection (AD-3), so the request carries it. The send check and the stale check compare the stored type with the member's Personal Shift (`sameSwapShift`): a changed type is *given gone* or stale.
2. **One date per member.** 0077 refuses one member and date twice in a batch, so a swap with a personal side never names one date twice (0083's check; the form never offers it).
3. **The taker's existing assignment.** Overwriting a taker's own assigned shift silently would lose it: refused (`SWAP_REQUEST_TAKER_ASSIGNED`, 23505, so the screen's *taken* says it). A taker's team rotation shift that date is not refused (deferred).
4. **The "after"** of a personal side is the grid's own draft "after" (`draftAppliedOf`), so every preview (hours, leave, short-staffed, erasures) reads it as any assignment save.
5. **The flaky `answer-swap.spec.ts:165`.** Its only failure in the recent runs (run 45768524028) was `holdRotation`'s 60 s wait: 21.7's failing `rucni-raspored` case held the rotation lock. Its own steps are not timing-sensitive; it is unchanged, and the lock holder was fixed by `7c8447a`.

## Verification

**Commands:** `pnpm --filter @shift/domain build`, `tsc` (root, web, e2e), `eslint` on the changed trees, `pnpm --filter ./apps/web test`, `pnpm --filter @shift/domain test`, and the DB-free root files `resource-hygiene`, `supabase-scaffold`, `localization-applied`, `localization-guard`, `key-hygiene`, `feature-boundaries`, `import-cycles` by name.

**Results (2026-11-26, after review, rebased on `ebfa939`):** `pnpm typecheck` (root, e2e, smoke, perf, every package), `pnpm lint` and `pnpm build` exit 0. Domain: 27 files, 1185 tests. Web: 205 files, 7422 tests (`swap-personal.test.ts` 15). DB-free root files `resource-hygiene`, `supabase-scaffold`, `localization-applied`, `localization-guard`, `key-hygiene`, `feature-boundaries`, `import-cycles`: 3638 tests. All pass. No CSS or token changed, so the theme root files do not apply. Gitleaks is the orchestrator's; not run here.

**Not run locally (STRICT DATABASE RULE):** `0083` was never applied. The `provisioning` (privileges, keys, indexes) and `rls-isolation` (three cases) changes and the e2e case run first in CI.
