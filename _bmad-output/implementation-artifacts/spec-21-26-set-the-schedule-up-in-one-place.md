---
title: 'Story 21.26: Set the schedule up in one place (Postavi raspored na jednom mjestu)'
type: 'feature'
created: '2026-11-26'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'ebfa939100aad0aac0665e5bfb6de5cb9fd6b6f5'
context: []
---

Baseline: `origin/main` at `ebfa9391` (21.20 merged). Touches the hot file `hr.json`; 21.8 (swaps, `0083`) runs in parallel and is rebased against.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The founder still cannot quickly link a team, a shift and a person: the shift types, the teams, the rotation, team membership, *Raspored osobe*, *Posao* and the team flags live on five screens (*Postavke rotacije*, `/ljudi/smjene`, the rotation builder, the member page, *Organizacija*).

**Approach:** One new admin destination, *Timovi i raspored* (`/timovi-i-raspored`, under *Postavke*), composed only of the existing dialogs and write paths: a *Tipovi smjena* strip with *Dodaj tip*, a card per active team (member chips with add and remove, the rotation as a chip strip edited in the existing builder in a dialog, *Ne radi na blagdane* and *Najmanje ljudi* edited in the existing team dialog), *Ljudi bez turnusa* grouped by job role with *Raspored osobe* and an inline *Posao*, and *Prvi koraci* for an empty organization. The route is the first lazily loaded one.

## Boundaries & Constraints

**Always:** reuse the existing writes and dialogs: the member page's team dialog (`useMemberEdit` + `MemberTeamDialog`, with its *Što se mijenja*, short-staffed and erasure dialogs), *Raspored osobe*'s dialogs, the team dialog (`useTeamEdit` + `TeamEditBody`, flag check and minimum preview), `RotationSection`, `ShiftTypeAddDialog`, `TeamAddDialog`, and `saveMember` for *Posao*. Copy in `hr.json`. Compact `PageToolbar`, glass surfaces, 44 px targets, keyboard, focus back to the opener, one column on a phone with no sideways scroll. Admin guard. Root lists, router pins and e2e updated in the same change.

**Ask First:** a migration or a new server function (none expected: stop and report).

**Never:** a second copy of a write rule; inline forms on the member page (7.11 holds there); changing `/ljudi/smjene` or `/postavke-rotacije` behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add a member | *Dodaj člana* → pick a person → *Dalje* | the team dialog opens for them, this team chosen, *Vrijedi od* today | the dialog's own refusals |
| Remove a member | chip ✕ | the team dialog opens with *Bez tima* chosen | as above |
| Change already scheduled | a person with a scheduled team change | no dialog; a notice links to their page to withdraw it | — |
| Rotation strip | team on step k of `D N S S` | chips from step k, letters with full names | no rotation: *Bez rotacije* |
| People | source PERSONAL or MANUAL today | listed under their role, *Bez posla* last | none: the section says so |
| *Posao* changed | pick | `saveMember({ jobRoleId })`, re-read | refusal beside the picker |
| Empty org | no type / team / member on a team / rotation | *Prvi koraci*, first unfinished step's action enabled | — |

## Epic AC Deviations

- *"Dodaj člana … or a chip's ✕ … the member page's team dialog opens … with the team (or bez tima) chosen"*: narrowed. A person whose team change is already scheduled gets no dialog (the member page offers only its withdrawal then): the page says so and links to their page. A scheduled joiner or leaver has no ✕. Why: the member page's own rule (one scheduled change at a time, 0010), reused rather than bypassed.
- *"the route's code is loaded only when it is first opened"*: reinterpreted as "not in the boot chunks; fetched by `import()` when the route first renders". The worker still precaches the chunk at install, as it precaches every chunk, so the page opens offline. Why: the offline shell (story 8.1) precaches every JS file; excluding one would break offline reading of the page.
- *"Prvi koraci … no other person"*: reinterpreted as "nobody is placed" (on an active team, today or scheduled, or on a personal or manual schedule), since the admin who sets up is a member too. Why: "other" cannot be told from the page's reads without reading the session; placing anyone is what the step asks for.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/timovi-i-raspored.route.ts` (new) -- the route; `component` is `TimoviIRasporedLazy`, a `lazyRouteComponent` of the page module. A `.ts` beside the page so the file that owns the path (`timovi-i-raspored.tsx`) is the one titled `nav.timoviIRaspored`, as the structural pins require.
- `apps/web/src/pages/timovi-i-raspored.tsx` (new) -- the lazily loaded screen; composes every part and the dialogs (pages may import other features' components and hooks; features may not).
- `apps/web/src/features/setup/services/setup.ts` (new) -- pure rules: team cards (members today and scheduled, the strip from the assignment in force or the next scheduled, the minimum), people without a turnus (from a `factsOf` the page hands in), first-run steps and their message keys, element ids.
- `apps/web/src/features/setup/hooks/use-setup.ts` (new) -- reads members, rotation, calendar snapshot, organization; takes the team and shift type list screens; holds the dialogs.
- `apps/web/src/features/setup/components/{setup-parts,setup-pick-dialog}.tsx` (new) -- strip, team card, people section, first run; the person picker.
- `apps/web/src/features/members/components/member-dialogs-host.tsx` (new) -- `useMemberEdit(memberId)` with the member page's team dialog (opened via `teamDialog.openWith(preset)`) or *Raspored osobe*'s dialogs, no card.
- `apps/web/src/features/members/{components/member-job-role-picker.tsx,hooks/use-member-job-role.ts}` (new) -- inline *Posao* through `saveMember({ jobRoleId })`.
- `apps/web/src/features/members/hooks/use-member-team.ts`, `components/member-team-card.tsx` -- `openWith(preset)`; the picker opens on `pickedTeam`; `MemberTeamErasures` exported.
- `apps/web/src/features/members/components/member-schedule-source-card.tsx` -- `MemberScheduleSourceDialogs`, `factText`, `memberScheduleFactsOf` exported.
- `apps/web/src/features/teams/{hooks/use-team-edit.ts,components/team-edit-dialog.tsx}` -- `useTeamEdit(id, onClose?)`; the team dialog over another page.
- `apps/web/src/features/navigation/utils/{destinations,icons,destination-copy}.ts` -- the settings destination, first under *Postavke*; *Više* place `Timovi`.
- `apps/web/src/router.ts`, `router.test.ts` -- registration; the lazy component pinned by identity and preloaded.
- `apps/web/src/lib/i18n/locales/hr.json` -- `nav.timoviIRaspored`, `shell.description.timoviIRaspored`, `shell.place.timoviIRaspored`, `postaviRaspored.*`.
- Root lists: `test/localization-applied.test.ts` (SOURCES; the boot chunks are the entry and its `modulepreload`s), `test/static-hosting.test.ts` (preloaded chunks precached), `test/resource-hygiene.test.ts` (keys; `postaviRaspored` speaks the Shift Type's term), `pages/source-guards.fixture.ts`, `pages/key-sources.fixture.ts`, `pages/screens-sweep.test.ts`, `pages/structural-pins-shell.test.ts`, `features/teams/team-screens.fixture.ts`.
- `e2e/tests/teams/setup-in-one-place.spec.ts`, `e2e/pages/setup.page.ts` (new); `e2e/utils/i18n.ts` and `e2e/tests/layout/phone-navigation.spec.ts` name the new destination.

## Tasks & Acceptance

**Execution:**
- [x] `features/setup/services/setup.ts` + test -- the pure rules and their edge cases.
- [x] member/team hooks and cards -- the preset, the exports, `onClose`.
- [x] setup parts, hook and the page -- the screen.
- [x] route, router, destinations, `hr.json`, root lists, docs (UX-DR84, DESIGN.md, EXPERIENCE.md).
- [x] e2e spec with the rotation hold and full cleanup.

**Acceptance Criteria:**
- Given an admin, when they open *Timovi i raspored*, then every part above is drawn from existing reads, and a member is sent on by the admin guard.
- Given any dialog opened from the page, when it closes, then focus returns to its opener (or the card's heading when the opener is gone).
- Given the built app, when it is first loaded, then the screen's code is in its own chunk, fetched on first visit.

## Spec Change Log

## Design Notes

A new destination rather than a reworked `/ljudi/smjene`: the founder's problem is reach, `/ljudi/smjene` is not a destination (it is reached from *Ljudi*), and it keeps archive and rename with their e2e unchanged. The member dialogs are hosted by mounting `useMemberEdit(memberId)` for the one person being changed, so every rule, preview and erasure check is the member page's own. The composition sits in `pages/` because the feature-boundary rule lets a page import any feature's components and hooks, and lets a feature import only another's public modules; no `FEATURE_PUBLIC` entry was widened.

THE FIRST LAZY ROUTE SPLITS THE SHARED CODE. Rolldown does not merge the modules the entry shares with a lazy chunk back into the entry, so the build is now the entry (~1.0 MB), a shared chunk the entry imports statically and the page preloads (~1.2 MB), and the screen's own chunk (~26 kB). Each file is far under the 3 MiB per-file precache cap; all are precached. The two root tests that read "the entry chunk" now read the boot chunks (entry plus its `modulepreload`s).

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- clean.
- `pnpm --filter @shift/web test` -- green after the review fixes (figures in the report).
- Review fixes (all patch): the member host ended a task in the same commit that opened it (now skips the asking render); a refused or silent read ends it as unavailable (20 s at most); a second task for the same person mounts a fresh host (`serial`); every read the page draws from is in its one refusal and retry; strips letter over every type, archived ones included; focus falls back to the right heading (picker, archived team, *Prvi koraci*' adds); *Posao* is never disabled mid-choice and redraws on the stored role after a pick that wrote nothing; the team dialog's close waits for its write; a root test pins the screen out of the boot chunks; the e2e picks by id, closes *Uredi tim* back to the page with focus, and checks 360 px.
- `pnpm build` -- `timovi-i-raspored-*.js` 25.5 kB, a separate chunk; 17 precache entries.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/localization-applied.test.ts test/static-hosting.test.ts test/feature-boundaries.test.ts test/theme-tokens.test.ts test/theme-contrast.test.ts test/theme-fidelity.test.ts test/theme-applied.test.ts` -- green (no CSS or token change; run anyway).
- The e2e spec is written and unrun (no local e2e by rule): CI is its first run.
- CI's first run (2026-11-26) failed twice, both fixed:
  - `phone-navigation.spec.ts` "the sidebar shows the sheet's two groups" pinned *Postavke* as two links. It now lists *Timovi i raspored* first.
  - `setup-in-one-place.spec.ts`: the team dialog never showed after the ✕. The first fix (`def79648`) made the host end only once the dialog has been SEEN open and is then closed (`members/services/dialog-task.ts`, unit-tested). That was right but not the cause: CI failed the same way.
  - THE CAUSE, from the CI trace and a repro. The trace showed the ✕ click landing, no request after it (every read was cached), no alert, and the host mounted with its team dialog closed and empty. `useMemberTeam` and `useMemberScheduleSource` reset their dialogs in an effect on the member id. That effect runs on mount, and runs again when StrictMode replays a fresh mount's effects (the app mounts in `StrictMode`; the e2e runs the dev server). The host asked for the dialog in the mount commit, so the replayed reset closed it before any render showed it; the host then waited on its 20 s timer, past the 5 s assertion.
  - Reproduced on the dev server in StrictMode, in a scratch harness that is not committed:
    - the real `useMemberTeam`: after `openWith`, `open` stays false on every render, while the picked team stays `none`;
    - the real `MemberDialogsHost`, its reads seeded in the cache and no network: the dialog never shows within 8 s.
    - With the fix, both show the dialog, *Bez tima* is picked, and *Odustani* ends the task once.
  - FIX: the host asks for the dialog on the commit after mount (`mounted` state), once the member hooks' own mount effects, replay included, have run.

**Manual checks:**
- Headless Chromium render of the built parts with fixture props, at 1280 px (light, dark, first run) and 360 px: no horizontal overflow, no control under 44 px, no console error.

## Suggested Review Order

**The page and its lazy route**

- The composition: every part, and each change routed to its owner's dialog.
  [`timovi-i-raspored.tsx:112`](../../apps/web/src/pages/timovi-i-raspored.tsx#L112)

- The first lazy route: the page module behind `lazyRouteComponent`.
  [`timovi-i-raspored.route.ts:21`](../../apps/web/src/pages/timovi-i-raspored.route.ts#L21)

- The builder reused whole, inside a wide dialog.
  [`timovi-i-raspored.tsx:36`](../../apps/web/src/pages/timovi-i-raspored.tsx#L36)

**Reusing the member page's dialogs**

- One person's `useMemberEdit`, its dialogs with no card; opens once read, ends once closed.
  [`member-dialogs-host.tsx:52`](../../apps/web/src/features/members/components/member-dialogs-host.tsx#L52)

- Why the end check skips the render that asked for the dialog.
  [`member-dialogs-host.tsx:143`](../../apps/web/src/features/members/components/member-dialogs-host.tsx#L143)

- The team dialog opened with a team (or no team) picked; *Promijeni* still opens empty.
  [`use-member-team.ts:238`](../../apps/web/src/features/members/hooks/use-member-team.ts#L238)

- *Posao* inline through the member page's own write.
  [`use-member-job-role.ts:35`](../../apps/web/src/features/members/hooks/use-member-job-role.ts#L35)

- The team dialog closes to its caller when one is given.
  [`use-team-edit.ts:151`](../../apps/web/src/features/teams/hooks/use-team-edit.ts#L151)

**The rules**

- A team's strip starts on today's step, or on a scheduled rotation's first date.
  [`setup.ts:86`](../../apps/web/src/features/setup/services/setup.ts#L86)

- *Ljudi bez turnusa*: personal or manual today, by role, *Bez posla* last.
  [`setup.ts:226`](../../apps/web/src/features/setup/services/setup.ts#L226)

- *Prvi koraci*' order and its next step.
  [`setup.ts:306`](../../apps/web/src/features/setup/services/setup.ts#L306)

- One refusal and one retry over every read the page draws.
  [`use-setup.ts:159`](../../apps/web/src/features/setup/hooks/use-setup.ts#L159)

**Navigation and pins**

- The eleventh destination, first under *Postavke*.
  [`destinations.ts:138`](../../apps/web/src/features/navigation/utils/destinations.ts#L138)

- The boot chunks: the entry and its preloads, now that shared code splits.
  [`localization-applied.test.ts:916`](../../test/localization-applied.test.ts#L916)

- The screen stays out of the boot chunks.
  [`localization-applied.test.ts:2102`](../../test/localization-applied.test.ts#L2102)

- The end-to-end path through the member page's dialogs.
  [`setup-in-one-place.spec.ts:98`](../../e2e/tests/teams/setup-in-one-place.spec.ts#L98)
