# Epic 21 Context: Plan people like the paper, and the pilot's month is real

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Shift able to plan the first production pilot's real month without workarounds. The pilot has two organizations: a fire department on 24-hour duty, and a department with 24-hour crews, day workers on alternating weeks, floater students and leave. The 24-hour crews keep their team rotations unchanged. Day workers and students are planned per person, either in a manual grid (*Ručni raspored*) or through a personal rotation. Floaters are suggested to cover leave. Holidays empty the day teams, and each team can have its own minimum. A public page (*Smjenko*) is added, and teams are relabelled *Timovi*. A real staging rehearsal had to work around these gaps with carrier teams, per-date overrides and no minimum. This epic removes those workarounds. Production (20.9) waits until this epic is done. The founder accepted decisions E-1 to E-8 on 2026-11-25 at the recommended defaults.

## Stories

- Story 21.1: The personal-assignment rule in the domain
- Story 21.2: A personal assignment is a recorded exception
- Story 21.3: The calendar scrolls with the page
- Story 21.4: An admin plans the month in *Ručni raspored*
- Story 21.5: *Popuni uzorkom* and *Kopiraj* fill a range
- Story 21.6: Personal shifts are read wherever shifts are read
- Story 21.7: A leave over a personal shift is a conflict, and a replacement is an assignment
- Story 21.8: Swaps give and take personal shifts
- Story 21.9: The schedule-source rule in the domain
- Story 21.10: An admin gives a member their own rotation, or makes them manual only
- Story 21.11: A seasonal member's season is set in one step
- Story 21.12: Job roles are organization data
- Story 21.13: Floaters are suggested for an uncovered shift, by role
- Story 21.14: A floater covers a whole leave in one action
- Story 21.15: The holiday rule in the domain
- Story 21.16: Holidays are organization data
- Story 21.17: An admin enters holidays and imports the official list
- Story 21.18: Holidays show on the calendar, the schedule and the grid
- Story 21.19: Worked holiday hours are their own figure (cuttable)
- Story 21.20: Each team has its own minimum
- Story 21.21: *Smjenko*, the public page
- Story 21.22: Teams are called *Timovi*

## Requirements & Constraints

- **Absent means byte-identical.** With no personal assignment, no schedule version, no holiday (or no team off on holidays) and no team minimum, every derivation must be byte-identical over both fixtures. Each story proves this, and each domain story also runs the engine rules' worked example as a test.
- **One precedence rule (decided, E-1).** For a member on a date, highest first: their live Personal Assignment, then their schedule source (team rotation, personal rotation or manual only), then roster overrides on top. A team's Scheduled Shift is computed as before (projection, then holiday, then Shift Type Override). It only decides the base roster of team-rotation members who have no assignment that date. A loan still decides the effective team.
- **A personal shift is a real shift.** It counts in at-work shifts, hours (source `PERSONAL`, shown as *osobni raspored*), leave cost, conflicts (the team may be none), swaps, double booking and rest gap, staffing groups, the feed and reminders. Staffing for team T on date d is T's working shift plus one group for each other working type among the personal shifts counted with T.
- **Assignment semantics.** A member has at most one live assignment per date, of kind `SHIFT` or `OFF`. A non-working type reads as off. It counts with the named team, else the member's effective team, else none. An inactive member has no personal shift. A holiday or a team's Shift Type Override never removes an assignment. A holiday does remove a personal rotation's shift counted with a team that is off on holidays.
- **Visibility (decided, E-2).** Every active member reads every member's live assignments (member, date, kind, type, team). Members never see the note or the author. Admins see notes.
- **Notifications (decided, E-3).** A personal-assignment save sends one `SCHEDULE_ASSIGNED` per affected member per save, `{ from, to, days }`, never one per cell. A member whose changed dates are all past is not told. A schedule-source change sends `SCHEDULE_SOURCE_CHANGED` `{ effectiveFrom, source }`. Holidays, minimums, roles and floater flags notify nobody.
- **Floaters (decided, E-8).** When the absent member has no role, any floater is eligible. Otherwise only floaters who list that role are eligible. A suggested floater is active, has no at-work shift and no leave that date, and has no zero rest gap against the uncovered shift. Suggestions are ordered by fewest shifts this month, then by name. Suggestions never assign anything themselves. A whole-leave cover lists dates the floater is not free and leaves them unresolved.
- **Holidays (decided, E-7).** The import list for Croatia is the fixed eleven dates plus Easter Sunday, Easter Monday and Corpus Christi (Gregorian computus). It is only a suggestion an admin accepts. Leave on a date a holiday emptied costs nothing. Leave on a 24-hour crew's worked holiday costs a day. Holiday hours are the minutes of a worked shift inside the holiday's civil date. They are counted inside Total Hours and never change Band Hours. The *Sati na blagdan* column appears only when the period has a worked holiday.
- **Team minimum.** A team's own minimum (`>= 1`) overrides the organization's for that team. An empty team minimum means the organization's minimum applies. There is no "no minimum" state for a team: a team that should never be flagged sets 1.
- **Public page (decided, E-4, E-5).** No third-party resource, no cookie, no script, no tracker, and a first view under 150 kB. The contact address is a build input supplied by the founder and is never committed. The register link shows only once production signup opens. *Smjenko* names the landing page only, not the app.
- **Rename (decided, E-6).** Teams are labelled *Timovi*/*Tim* everywhere in `hr.json`. The route `/smjene` is kept. Team names an organization chose (for example `Smjena A`) are data and stay unchanged. This reverses the 2026-11-23 terminology decision.
- **Every story:**
  - migrations are forward-only and numbered at build time;
  - copy lives in `hr.json`, and nothing pilot-specific is seeded (DI-8);
  - the repo is public, so the pilot is described generically, never by a real name, host or address;
  - the DESIGN.md, EXPERIENCE.md and UX-DR lines a story changes are updated in the same change.

## Technical Decisions

- **Domain owns every rule (AD-7, AD-8).**
  - `domain/personal` owns R14 and R15. As built by 21.1 (AD-26 amended), assignments ride on each member (`personalAssignments`, as loans do). `shiftRoster` leaves an assigned member off every base roster, and `personalShiftOn` (in `roster.ts`, over `personal.ts`'s rule) carries the counted team. 21.9 adds `scheduleSourceOn` in the same place.
  - `atWorkShiftsOf` returns `teamId: string | null`, and `personalAssignmentId` when the shift comes from an assignment. The `source` field (`TEAM`, `PERSONAL_ROTATION`, `ASSIGNMENT`) is 21.2's for reminder items and 21.9's for the rotation form.
  - `filledAssignmentsOf(steps, offset, members, from, to)` and `copiedAssignmentsOf(range, targetStart, members)` produce draft items only. Nothing is stored as a rule. Copy copies assignments only, so a source date with none clears its target.
  - `domain/floaters` returns R16.2's suggestions as ids and counts. `domain/holidays` returns `nationalHolidaysOf('HR', year)` as codes and dates.
  - `minimumOf(input, teamId)` gives a team's effective minimum.
- **Input shapes.**
  - The schedule, hours, staffing and collision inputs gain `personalAssignments` `{ id, memberId, date, kind, shiftTypeId?, teamId? }` and `scheduleVersions` `{ memberId, effectiveFrom, source, patternId?, offsetStepId? }`.
  - `ScheduleInput` gains `holidays` (dates only, never names) and `teamsOffOnHolidays`. `StaffingInput` gains `teamMinimums`.
  - On a cell a holiday emptied, `ScheduleCell` has `holiday` and `offForHoliday` set, `shiftTypeId` null and `projectedShiftTypeId` kept.
- **`personal_assignments` (an exception, never versioned).**
  - Columns: `organization_id` first, `id`, `member_id`, `date`, `kind` (`SHIFT`/`OFF`), `shift_type_id` (required for `SHIFT`), a nullable `team_id`, a `note` of 1–200 code points, `created_*` and `removed_*`.
  - At most one live row per member and date: a partial unique index where `removed_at is null`.
  - Sessions have no direct write. The only writer is the definer `save_personal_assignments(p_changes jsonb)`. It re-checks that the caller is an active admin, takes the organization lock and accepts at most 5 000 items (`set` or `clear`). It validates the whole batch first and refuses all of it with 22023 `PERSONAL_ASSIGNMENTS_INVALID`. An item equal to the live row writes nothing. It uses `shift.notify_suppress` and then writes the batched notice.
  - Members read through `calendar_personal_assignments()`. The new AD-19 helper is `private.live_personal_assignments`.
- **`member_schedule_versions` (versioned, like `rotation_assignments`).**
  - `source` is `TEAM`, `PERSONAL` or `MANUAL`. For `PERSONAL`, the offset is a composite foreign key to a step of that pattern.
  - Unique per member and `effective_from`. No version means team rotation.
  - Only an active admin inserts, from the organization's today on, and deletes a version not yet in effect. The existing re-check and the archived-pattern refusals apply. Patterns are shared by teams and members.
- **Job roles and floaters (current-state).**
  - `job_roles` has a unique `name_key`, archive and no delete.
  - `members.job_role_id` is nullable, with a column UPDATE grant. Every active member reads roles.
  - `members.is_floater` defaults to false.
  - `floater_roles` is read by admins only. Neither table feeds any derivation.
- **Seasons.** 21.11 relaxes the status insert rule so that a version may be dated after a scheduled one. Versions must still alternate, only the latest version is cancellable, and Q6 holds. The `admin-auth` create can write a new member inactive until the season starts.
- **Collisions (AD-4 amended).**
  - `conflict_resolutions.team_id` becomes nullable, with a `NULLS NOT DISTINCT` key.
  - Replace Member gains a `personal_assignment_id` form. That resolution matches only while the assignment is live, of the same date and type, and counted with the collision's team. Removing the assignment through the save ends the resolution.
  - `resolve_with_personal_assignment(p_items)` writes the assignments and the resolutions in one transaction.
- **Swaps.** `swap_requests` gains nullable `given_personal` and `return_personal` flags. Approval writes assignments through the same save: the taker gets the type and the team, and the giver gets `OFF`.
- **Holidays and minimums (AD-27).**
  - `organization_holidays` has one row per date and a `name` of 1–100 code points. Every active member reads it. An active admin inserts, renames (`name` only) and deletes.
  - The import is one PostgREST insert with `Prefer: resolution=ignore-duplicates`. There is no RPC.
  - `teams.off_on_holidays` defaults to false. `teams.minimum_members` is a nullable `smallint` with `>= 1`. Each has a column UPDATE grant.
  - Holiday hours are computed on read, beside the band figures.
- **AD-5 guard.** These writes are guarded: assignment saves (grid, fill, copy, single date, cover), a schedule-version insert or cancel, a holiday insert, delete or import, and an `off_on_holidays` change.
  - *Što se mijenja* lists, per member, the shifts lost and gained, double bookings, rest gaps, newly short-staffed shifts and roster overrides left inapplicable. Only an erased decision blocks.
  - The diff runs from the earliest affected date. A holiday rename, a minimum, a role or a floater setting is exempt.
- **Audit (AD-11).** All five new tables attach both audit triggers. History groups a grid save by `transaction_id` into one entry per member and save (*Ručni raspored: {n} dana*), expandable to its dates.
- **Server assembly, feed and reminders (AD-19, AD-20, AD-18).**
  - `member_schedule_inputs` and the browser snapshot carry every member's versions and live assignments, the holiday dates and `offOnHolidays`. Both parity fixtures gain each of these in the story that adds it. Roles, floaters, holiday names and minimums are not carried.
  - Feed UIDs: `<date>-p-<memberId>@shift` for a personal rotation and `<date>-a-<assignmentId>-<memberId>@shift` for an assignment (also `@shift-download`). The summary adds the team name only when there is a team.
  - Reminder items gain `source` (`TEAM`, `PERSONAL_ROTATION` or `ASSIGNMENT`), with their own subject hashes and a no-team rendering. An `ASSIGNMENT` reminder is skipped unless its row is still live and equal.
  - A shift a holiday removed has no event and no reminder.
  - As built by 21.2 (`0077`): a team reminder item keeps its 8 keys and has no `source`. Only the `ASSIGNMENT` form is new, and `PERSONAL_ROTATION` and the `-p-` UID are 21.9's. `SCHEDULE_ASSIGNED`'s `{ from, to, days }` counts only the written dates on or after today. An archived type or team in an item refuses the whole save. The history draws the table as a generic record until 21.4.
- **Landing (AD-28).**
  - `apps/landing` is hand-written HTML and one stylesheet, with no client script. Its tokens are held equal to `apps/web`'s by a test. It uses self-hosted Outfit (Latin Extended).
  - Its build inputs are `LANDING_APP_URL`, `LANDING_CONTACT_EMAIL` (a production build refuses the placeholder) and `LANDING_SIGNUP_URL`.
  - `deploy/landing` builds on `shift-web`'s pinned nginx-unprivileged base, with a strict CSP, HSTS, `no-referrer`, `nosniff` and an all-off `Permissions-Policy`.
  - CI checks: no script or inline handler or style attribute, `lang="hr"`, one `h1` with headings in order, alt text, a skip link, the 150 kB budget, and axe at both widths and in both themes. `shift-web` is unchanged.
- **Deferred.** Two personal shifts on one date, holiday lists beyond Croatia and holiday notifications are all out of scope.

## UX & Interaction Patterns

- **Page scroll (UX-DR71).** *Kalendar* and *Ručni raspored* have no inner vertical scroll container. The day header row sticks under the chrome. A wide grid scrolls only horizontally, with a sticky first column and a separate sticky header kept in step with it. The phone uses the day list with no horizontal overflow.
- **Ručni raspored (UX-DR72, UX-DR73).** The grid is admin only, under *Raspored*.
  - Rows are people grouped by their team at the start of the month, with no-team rows last. Columns are dates.
  - The cell picker offers the shift types, *Slobodno*, *Očisti* and *Računaj u tim…*. Cells are selected by click, shift-click, drag or arrows with Space.
  - A sticky save bar has the change count, *Spremi* and *Odbaci*.
  - Each row names its source (*rotacija tima*, *osobna rotacija*, *ručno*). Rotation cells are muted with a glyph. Assigned cells are solid with a pencil mark, and their accessible name includes `dodijeljeno ručno`.
  - On a phone, the admin edits one member's month at a time.
- **Day detail.** A personal shift reads `{smjena} · ručno` or `· osobna rotacija`, plus `bez tima` when it counts with no team.
- **Fill and copy (UX-DR74).** *Popuni uzorkom* takes step rows, *Počni od koraka* and a range. *Kopiraj tjedan* and *Kopiraj mjesec* copy into the draft.
- **Raspored osobe (UX-DR75).** The member page card offers *Rotacija tima*, *Osobna rotacija* (pattern, start step and *Vrijedi od*) or *Samo ručno*, with *Povuci* to cancel. It reuses the rotation builder's cycle preview.
- **Poslovi (UX-DR76).** Roles are managed in *Organizacija → Poslovi*. *Posao* is set on the member page and shown and filtered on in the grid, the day detail and the directory. *Sezona od–do* sits in the status card.
- **Floaters (UX-DR77).** The member page has *Zamjena* with *Može mijenjati: …*. *Predložene zamjene* in *Za odluku* lists suggestions, each with their shift count this month. With none it shows `Nema slobodne zamjene za posao {posao}.`. *Pokrij cijelo odsustvo* previews which dates are covered and which are not free.
- **Holidays (UX-DR78).** *Organizacija → Blagdani* has a year picker, *Dodaj blagdan* and *Uvezi državne blagdane za {godina}* with a preview. A past date gets a warning. The team dialog has *Ne radi na blagdane*. A holiday shows as a glyph plus its name, never colour alone. A cell the holiday emptied reads *blagdan*.
- **Minimum (UX-DR79).** The team dialog has *Najmanje ljudi*, with the hint `Prazno: vrijedi za organizaciju ({n})`.
- **Public page (UX-DR80).** Direction G, phone first, both themes. It has a *Smjenko* hero, what it does, who it is for, *Javi se* and *Prijava*, and a footer `Bez kolačića i praćenja.`.

## Cross-Story Dependencies

- **Build order:** 21.1 → 21.2 → (21.3) → 21.4 → 21.5; 21.6 needs 21.2; 21.7 and 21.8 need 21.6.
- **Schedule source:** 21.9 needs 21.1. 21.10 needs 21.9 and 21.4. 21.11 is independent.
- **Roles and floaters:** 21.12 is independent. 21.13 needs 21.7 and 21.12. 21.14 needs 21.13.
- **Holidays:** 21.15 needs 21.9. 21.16 needs 21.15. 21.17 and 21.19 need 21.16. 21.18 needs 21.16 and 21.4.
- **Parallel work:** 21.3, 21.12, 21.20, 21.21 and 21.22 touch no other story's files and may run in parallel worktrees. The hot-file rule still applies: stories touching `index.css`, `components/ui/*`, `chrome.tsx` or `hr.json` (notably 21.3 and 21.22) start from the previous one's merge.
- **CI-only database cases:** 21.2, 21.7, 21.10, 21.11, 21.13 and 21.16 have database cases that only CI runs, so they get the unrun-DB-test review layer.
- **21.21:** it can be built now. Publishing it needs the founder's contact address, and serving the apex needs the apex DNS record.
- **After the epic:** `supabase/operator/demo-mladost.sql` is rewritten without carrier teams or holiday overrides after 21.10 and 21.17 (deferred-work). Production (20.9) follows this epic.
