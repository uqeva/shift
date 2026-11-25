# Sprint Change Proposal: pilot readiness (Epic 21)

- **Date:** 2026-11-25
- **Author:** Developer (correct-course, headless), for the founder
- **Mode:** batch, unattended. The founder approved the scope and asked for no questions, so each product choice below is recorded as a decision with its rationale. The ones the founder may want to change are listed in §6 (E-1 to E-8), each with a recommended default that stands for planning.
- **Scope classification:** Moderate to major. It adds one epic (21, 22 stories), FR-102 to FR-116 and NFR-35 to the PRD, engine rules R13 to R16 (R4.2, R10.1 and R10.2 amended), AD-26 to AD-28 to the spine, and amends AD-2, AD-4, AD-5, AD-11, AD-18, AD-19 and AD-20. No shipped behaviour changes until its story ships. With none of the new data recorded, every derivation stays byte-identical.
- **Status:** scope approved by the founder on 2026-11-25. The planning changes are applied on branch `docs/correct-course-pilot-readiness`. **Production (20.9) stays after this epic.**
- **Decisions:** E-1 to E-8 (§6) were ACCEPTED by the founder on 2026-11-25 at the recommended defaults, E-6 included: teams are labelled *Timovi*, so story 21.22 is unblocked. Source: the founder's instruction to the orchestrated build of story 21.1, which handed down the decisions and asked that they be recorded here, in the spine and in `sprint-status.yaml`. Recorded on branch `feat/21-1-personal-assignment-rule`.

---

## 1. Issue summary

**Trigger.** The founder approved the scope of the first production pilot on 2026-11-25. The pilot has two organizations:

- a volunteer fire department on 24-hour duty;
- a department with mixed day and 24-hour teams: four D/N/SL/SL crews, day workers on alternating 06–14 and 14–22 weeks, floater students, and leave.

Modelling the real November schedule of the second one on staging (operator script `supabase/operator/demo-mladost.sql`, DEPLOY §7.6, which holds no real names) exposed gaps that the script could only work around:

| # | Gap | Workaround in the script |
|---|---|---|
| 1 | No holidays | a shift-type override to the off type, per day team, on the holiday |
| 2 | No shift for a person without a team | two member-less "carrier" teams with an all-off rotation, a shift-type override per date, and roster overrides adding students |
| 3 | One organization-wide minimum | no minimum set at all, because crews have four, day teams two, and one team one |
| 4 | No public page | none |
| 5, 6 | A "Vod" position; moving a person to another team's shift for a day | rank `nco`; two roster overrides |

**Additions by the founder the same day (recorded as received).**

- **A manual schedule grid** (*ručni raspored*): people × days. Click a cell for a shift type, *Slobodno* or clear; multi-select; copy a week or a month. Per-person assignments take precedence over the team rotation. Members with no rotation are scheduled only this way. Everything downstream treats these as real shifts, and the affected member is notified once per batch. It is the top story, and it absorbs item 2.
- **Turnus teams keep team rotations.** Day workers and students are scheduled per person. *Popuni uzorkom* fills selected people over a range from a step pattern, once. The UI must say who is on a team rotation and who is planned by hand.
- **A personal rotation.** The rotation model is attached to a member and projected ongoing, with grid edits on top. A member follows their team's rotation, their own rotation, or is manual only.
- **Floaters** cover gaps. *Za odluku* suggests the floaters who are free that date, a pick creates a per-person assignment, and a whole leave range can be covered in one action.
- **The calendar scrolls with the page,** with no inner scroll box and with sticky headers. The grid follows the same principle.
- **Organization job roles** (for example a cleaner, a dispatcher, a seasonal worker). They are shown and filtered on. How a person alternates is chosen per person, through the personal rotation. Floater eligibility is by role.
- **Seasonal workers.** A member is active for a date range only.
- **Rename the UI label *Smjene*** (meaning teams) to *Timovi* or *Ekipe*. This is founder-decidable (decided 2026-11-25: *Timovi*, E-6).

**Category.** A new requirement from the stakeholder, found by a real-data rehearsal. Nothing shipped is wrong. The PRD put public-holiday calendars, and any staffing rule beyond one minimum, out of scope (§7.2). Team-only rotations were a deliberate v1 model (CAP-8) that the pilot outgrew.

## 2. Checklist record

| Item | Status | Finding |
|---|---|---|
| 1.1 Triggering story | [x] | None. A rehearsal of real data on staging after Epic 20.5 |
| 1.2 Core problem | [x] | Team rotation is the only way to plan; holidays and per-team minimums are missing |
| 1.3 Evidence | [x] | The workarounds in `demo-mladost.sql`'s header (§1 table) |
| 2.1–2.2 Current epic | [N/A] | Epic 20 is unchanged. Only 20.9's gate gains "after epic 21" |
| 2.3 Future epics | [x] | A new Epic 21. No later epic exists |
| 2.4 Obsolete or new epics | [x] | New epic. Nothing becomes obsolete |
| 2.5 Order | [x] | 21 before 20.9 (founder) |
| 3.1 PRD | [!] → done | §5.25–§5.28 added (FR-102–FR-116), NFR-35, out-of-scope and non-goal lines amended |
| 3.2 Architecture | [!] → done | AD-26–AD-28 added; AD-2, 4, 5, 11, 18, 19, 20 amended; containers, entities, map, Deferred |
| 3.3 UX | [!] → done | UX-DR71–UX-DR80 in `epics.md`. DESIGN.md and EXPERIENCE.md are updated by each story, as usual |
| 3.4 Other artifacts | [x] | `engine-rules.md` R13–R16 (R4.2, R10.1, R10.2 amended), `sprint-status.yaml`, `deferred-work.md` |
| 4.1 Direct adjustment | [x] | Viable: additive layers, byte-identical when absent |
| 4.2 Rollback | [N/A] | Nothing to revert |
| 4.3 MVP review | [x] | Pilot scope grows, and production waits for it (founder) |
| 4.4 Path | [x] | Direct adjustment through a new epic |
| 5.x Proposal | [x] | This document |
| 6.x Approval and handoff | [x] | Scope approved by the founder 2026-11-25; E-1 to E-8 accepted at their defaults the same day |

## 3. Impact analysis and recommended approach

**Approach: direct adjustment, one new epic of small stories, each shippable alone.**

The design rests on one rule. **For a member on a date: their Personal Assignment, then their schedule source (team rotation, personal rotation, or manual only), then roster overrides on top** (R15.3, AD-26). Each part is an asserted row, and the domain package is the only place they meet (AD-7). So:

- **Turnus crews change nothing.** No member has a schedule version or an assignment until an admin makes one. Every existing figure is byte-identical (R14.7, R15.6), and each story proves this over both fixtures.
- **Ad-hoc shifts and the grid are one table** (`personal_assignments`). The member page's *Dodaj smjenu* is the grid's single-cell case.
- **Item 6 is absorbed.** An assignment can count with another team.
- **"Vod" becomes a job role.** Job roles are organization data, so FR-18a's fixed list stays unwidened (DI-8).
- **Seasons need almost nothing new.** Member status is already versioned (0008). Only the rule allowing one scheduled change at a time is relaxed, so a season is set in one step (21.11).
- **Holidays are one layer in the one function** that already layers a team's scheduled type (R13.3). The import is a PostgREST insert with no RPC (AD-27).
- **Holiday hours** (21.19) are in scope as a small, cuttable story. They are computed like band hours, add no setting, and show only when the period has a worked holiday. Deferring them affects no other story.

**What changes for each downstream consumer.**

- **Calendar, my schedule, Danas, hours and export, history** follow through the domain, and their surfaces add marks (21.6, 21.18).
- **Feed and reminders** follow through R12 and `member_schedule_inputs` (AD-19 as amended). A personal shift may have no team, so the ICS UID and summary (AD-20) and the reminder item and subject (AD-18) gain a no-team form.
- **Leave conflicts.** `conflict_resolutions.team_id` becomes nullable (`NULLS NOT DISTINCT`), and Replace Member gains a form that references an assignment (AD-4 as amended, 21.7). Floaters use it (21.13, 21.14).
- **Swaps** may give or take a personal shift. Approval writes assignments where it wrote roster overrides (21.8).
- **AD-5.** Assignment saves, schedule versions, holidays and the team flag are guarded. Holiday renames, minimums, roles and floater settings are exempt.
- **Notifications** are one per member per save (`SCHEDULE_ASSIGNED`), never one per cell (AD-18 as amended).
- **The landing page** is a separate static image with no script, cookie or third party (AD-28). `shift-web` is unchanged.

**Effort and risk.** There are 22 stories, most of them the size of an epic-18 story. The riskiest are 21.1 and 21.9 (the roster rule under every figure), each guarded by "absent ⇒ byte-identical" over both fixtures and the parity suites. 21.7 is the other, because it changes `conflict_resolutions`' key: it is forward-only and keeps every existing row's meaning. The risk to timeline is that production (20.9) moves behind this epic, by the founder's decision.

**Order (build order, from the founder's sequence).** 1) the assignment layer, the page scroll, the grid and the fill (21.1–21.8); 2) the personal rotation and seasons (21.9–21.11); 3) roles, then floaters (21.12–21.14); 4) holidays (21.15–21.19); 5) the per-team minimum (21.20); 6) the landing page (21.21); 7) the rename (21.22). 21.3, 21.11, 21.12, 21.20, 21.21 and 21.22 share no files with their neighbours and may run in parallel worktrees.

## 4. Detailed change proposals (applied on this branch)

### 4.1 Stories: new Epic 21 in `epics.md`

| # | Story | One line |
|---|---|---|
| 21.1 | The personal-assignment rule in the domain | R14: an assignment beats the base roster; personal shifts are read everywhere; staffing groups |
| 21.2 | A personal assignment is a recorded exception | `personal_assignments`, one batch save RPC, batched notice, member read, assembly and parity, feed and reminder forms |
| 21.3 | The calendar scrolls with the page | no inner scroll box; sticky header and first column; phone day list |
| 21.4 | An admin plans the month in *Ručni raspored* | people × days grid, picker, multi-select, source marks, preview, one save |
| 21.5 | *Popuni uzorkom* and *Kopiraj* fill a range | one-time pattern fill and week or month copy, into the draft |
| 21.6 | Personal shifts are read wherever shifts are read | day detail, my schedule, Danas, hours and export source, history; *Dodaj smjenu* (item 2) |
| 21.7 | A leave over a personal shift is a conflict, and a replacement is an assignment | nullable team key; Replace Member by assignment |
| 21.8 | Swaps give and take personal shifts | swaps name a personal shift; approval writes assignments |
| 21.9 | The schedule-source rule in the domain | R15: team rotation, personal rotation or manual only, versioned |
| 21.10 | An admin gives a member their own rotation, or makes them manual only | `member_schedule_versions`; *Raspored osobe* |
| 21.11 | A seasonal member's season is set in one step | relax 0008's one-scheduled-change rule; *Sezona od–do* |
| 21.12 | Job roles are organization data | `job_roles`, `members.job_role_id`, shown and filtered |
| 21.13 | Floaters are suggested for an uncovered shift, by role | `is_floater`, `floater_roles`, suggestions in *Za odluku* |
| 21.14 | A floater covers a whole leave in one action | range cover, dates not free listed |
| 21.15 | The holiday rule in the domain | R13 layer; `nationalHolidaysOf('HR', year)` with Easter |
| 21.16 | Holidays are organization data | `organization_holidays`, `teams.off_on_holidays`, reads, parity |
| 21.17 | An admin enters holidays and imports the official list | *Blagdani*; idempotent import; team flag |
| 21.18 | Holidays show on the calendar, the schedule and the grid | glyph and name everywhere |
| 21.19 | Worked holiday hours are their own figure (cuttable) | R13.7; *Sati na blagdan* column |
| 21.20 | Each team has its own minimum | `teams.minimum_members`, overriding the organization's |
| 21.21 | *Smjenko*, the public page | static page, own image, apex; no tracker |
| 21.22 | Teams are called *Timovi* | label rename, after E-6 |

Each story's ACs are in `epics.md`, Epic 21. `epics.md` also gains CAP-29 to CAP-32 (and CAP-21 as amended), Q31, UX-DR71 to UX-DR80, the coverage rows and the Epic List entry.

### 4.2 PRD (`prds/prd-shift-2026-09-01/prd.md`)

- **NEW** §5.25 Personal Scheduling (FR-102 to FR-110), §5.26 Organization Holidays (FR-111 to FR-114), §5.27 Minimum Members per Team (FR-115, amending FR-70), §5.28 Public Product Page (FR-116); NFR-35.
- **§5.11 and §7.2.** OLD: "Out of Scope for MVP: public-holiday calendars; …". NEW: holidays moved into scope on 2026-11-25 (§5.26).
- **§6 Non-Goals.** OLD: "One Minimum Members number warns." NEW: "One Minimum Members number per Team (or the Organization's) warns. Floater suggestions only list who is free; they never assign."
- **§7.1.** A *Pilot readiness* line, before production.

### 4.3 Engine rules (`_bmad-output/specs/spec-shift/engine-rules.md`)

New sections: §13 Holidays (R13.1–R13.8), §14 Personal assignments (R14.1–R14.8), §15 A Member's schedule source (R15.1–R15.7), §16 Job roles and floaters (R16.0–R16.5, seasons included). R4.2 (leave cost), R10.1 (staffing groups) and R10.2 (per-team minimum) are amended in place.

### 4.4 Architecture spine

- **AD-26.** One order: assignment, then schedule source, then roster overrides. The tables `personal_assignments` (writes only through `save_personal_assignments`; member-wide read without note or author), `member_schedule_versions`, `job_roles`, `floater_roles`, `members.is_floater`; seasons; collisions and swaps over personal shifts; where each enters the domain, the browser's reads and the assembly.
- **AD-27.** `organization_holidays` (current-state, one per date, import by ignore-duplicates insert), `teams.off_on_holidays`, `teams.minimum_members`; the holiday layer; `nationalHolidaysOf`; no notifications.
- **AD-28.** The public page: `apps/landing`, its own `shift-landing` image and resource at the apex, three uncommitted build inputs, strict headers, CI checks.
- **Amendments.**
  - AD-2: seven table rows.
  - AD-4: nullable collision team; Replace Member by assignment.
  - AD-5: which new writes are guarded.
  - AD-11: five audited tables; history grouped per save.
  - AD-18: batched `SCHEDULE_ASSIGNED`, `SCHEDULE_SOURCE_CHANGED`; reminder items with `source`.
  - AD-19: the assembly carries versions, assignments, holidays and the team flag.
  - AD-20: UIDs and summaries for personal shifts.
  - Elsewhere: the containers diagram, core entities, the capability map, and three Deferred entries.

### 4.5 Tracking

- `sprint-status.yaml`: `epic-21: backlog`, the 22 stories `ready-for-dev`, each with its dependencies; 20.9's gate gains "epic 21".
- `deferred-work.md`: rewrite `demo-mladost.sql` after 21.10 and 21.17; the app-rename question (E-5); the items held for later.

## 5. Implementation handoff

- **Route:** Developer agent (`bmad-build`, `bmad-create-story` per story), in the order above. No PM or Architect pass is needed: AD-26 to AD-28 are the pass. One review layer per story as usual, plus the unrun-DB-test review layer for 21.2, 21.7, 21.10, 21.11, 21.13 and 21.16, whose database cases are CI-only.
- **Rules carried into every story:**
  - planning-doc-only agents run no code;
  - never bare `pnpm exec vitest run` (always with explicit file arguments);
  - no local DB tests, e2e, docker or `supabase` commands (CI runs them);
  - the repository is public, so no real names, hosts or addresses, and the pilot is "a department with mixed day and 24-hour teams";
  - forward-only migrations, RLS, audit triggers, and the domain as the single projection.
- **Success criteria:**
  - the staging month of `demo-mladost.sql`, rewritten without carrier teams or holiday overrides (deferred-work), matches the paper day by day;
  - every Epic 21 story is merged with CI green, and with its data absent the fixtures are byte-identical;
  - then 20.9.

## 6. Founder-decidable items (ACCEPTED 2026-11-25 at the recommended defaults)

**Decision status:** the founder accepted all eight on 2026-11-25, each at its recommended default below. E-6 is *Timovi*. E-4's contact address is still the founder's build input, supplied before 21.21 publishes.

| # | Decision | Recommended default | Why |
|---|---|---|---|
| E-1 | The precedence model | Assignment, then schedule source (team rotation, personal rotation or manual only, versioned), then roster overrides on top. A team's minimum overrides the organization's | One rule, no new concept for crews. A day worker is one setting, not a team |
| E-2 | Who reads others' personal assignments | Every active member reads member, date, shift type and team, never a note or an author | Same ground as the loan read ratified on 2026-11-23: the calendar already shows who works |
| E-3 | Notifications | One `SCHEDULE_ASSIGNED` per member per save and one on a schedule-source change; none for holidays, minimums, roles or floater flags | Batched as asked. A holiday is visible to all and entered ahead |
| E-4 | The landing page's contact address and register link | The founder supplies the address as a build input, never committed. The register link appears only after D-S5. The page is its own static image at the apex | A public repo, and production signup is not open |
| E-5 | *Smjenko* as the app's name too | The landing page only for now; renaming the app is a later one-story decision | Rename touches Auth mail, the manifest and tests together |
| E-6 | The *Smjene* label for teams | ***Timovi***, labels only, with the URL `/smjene` kept. It reverses the 2026-11-23 terminology decision (epic 18 retro A2) | Loan copy already says *tim*. *Ekipe* reads as fire jargon, against DI-8's spirit |
| E-7 | Holiday hours, and leave on a holiday | In scope as 21.19 (cuttable), shown whenever a worked holiday falls in the period, with no setting. Leave over a date a holiday emptied costs nothing (R4.2 unchanged), while leave on a 24-hour crew's worked holiday costs a day | Smallest version that serves the hour report. Holiday-free leave follows the existing rule |
| E-8 | Floater eligibility when the absent member has no role | Any floater is eligible. With a role, only floaters listing it are, so a cleaner with no eligible floater gets none | Matches the founder's example and needs no default role |

Items 5 and 6 of the original brief are settled without new mechanisms. "Vod" is a job role (21.12). Moving a person to another team's shift for a day is an assignment counted with that team (21.4, 21.6).
