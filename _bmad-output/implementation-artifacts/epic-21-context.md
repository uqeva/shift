# Epic 21 Context: Plan people like the paper, and the pilot's month is real

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Smjenko plan the first production pilot's real month without workarounds. The pilot is two organizations: a volunteer fire department on 24-hour duty, and a department that mixes 24-hour crews with day workers on alternating weeks, floater students and leave. A staging rehearsal of that month could only fake it with member-less "carrier" teams, per-date overrides, holiday overrides per team and no minimum. This epic retires those workarounds. The 24-hour crews keep their team rotations unchanged. Day workers and students are planned per person, in a manual grid (*Ručni raspored*), by a one-time pattern fill or by a personal rotation. Floaters are suggested to cover leave. Holidays empty the teams that are off on holidays, and each team can have its own minimum. A public page is added, the app is named *Smjenko*, teams are labelled *Tim/Timovi*, and list pages get a compact toolbar. Production (20.9) waits for this epic. The founder approved the scope on 2026-11-25, accepted decisions E-1 to E-8 at their recommended defaults the same day, and then reversed E-5: the app itself is *Smjenko*, not only the landing page.

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
- Story 21.23: Compact toolbar and filters
- Story 21.24: *Smjenko* brand: name, logo and icons

## Requirements & Constraints

- **Absent means byte-identical.** With no personal assignment, schedule version, holiday (or no team off on holidays) and team minimum, every derivation is byte-identical over both fixtures. Each domain story also runs its engine rule's worked example as a test.
- **One precedence rule (E-1).** For a member on a date, highest first: their live Personal Assignment, then their schedule source (team rotation, personal rotation or manual only), then roster overrides on top. A team's Scheduled Shift (projection, then holiday, then Shift Type Override) is computed as before. It decides only the base roster of team-rotation members with no assignment that date. A loan still decides the effective team.
- **A personal shift is a real shift.** It counts in at-work shifts, hours (source `PERSONAL`, shown as *osobni raspored*), leave cost, conflicts (the team may be none), swaps, double booking, rest gap, staffing groups, the feed and reminders. An assignment counts with its named team, else the member's effective team, else none. A non-working type reads as off. An inactive member has no personal shift. A holiday or a Shift Type Override never removes an assignment. A holiday does remove a personal-rotation shift counted with a team that is off on holidays.
- **Visibility (E-2).** Every active member reads every member's live assignments (member, date, kind, type, team), never the note or the author. Admins see notes.
- **Notifications (E-3).** One `SCHEDULE_ASSIGNED` `{ from, to, days }` per affected member per save, never per cell, counting only changed dates on or after today. A member whose changes are all past is not told. A schedule-source change sends `SCHEDULE_SOURCE_CHANGED` `{ effectiveFrom, source }`. Holidays, minimums, roles and floater flags notify nobody.
- **Floaters (E-8).** If the absent member has no role, any floater is eligible. Otherwise only floaters who list that role are eligible. A suggested floater is active, free that date (no at-work shift, no leave, no zero rest gap). Suggestions are ordered by fewest shifts this month, then name. Suggestions never assign by themselves. A whole-leave cover lists the dates the floater is not free and leaves them open.
- **Holidays (E-7).** The Croatian import is the eleven fixed dates plus Easter Sunday, Easter Monday and Corpus Christi (Gregorian computus). It is only a suggestion an admin accepts. Leave on a date a holiday emptied costs nothing. Leave on a 24-hour crew's worked holiday costs a day. Holiday hours are a worked shift's minutes inside the holiday's civil date. They sit inside Total Hours, never change Band Hours, and the *Sati na blagdan* column shows only when the period has a worked holiday.
- **Team minimum.** A team's own minimum (`>= 1`) overrides the organization's. Empty means the organization's applies. There is no "no minimum" state: a team that should never be flagged sets 1.
- **Public page (E-4).** No third-party resource, cookie, script or tracker. The first view is under 150 kB. The contact address is a founder-supplied build input, never committed. The register link shows only once production signup opens.
- **Naming (E-5 reversed, E-6).** The product name users see is *Smjenko* everywhere. Internal identifiers keep *shift*: the `@shift/*` packages, the repo, env vars, databases, URLs, storage keys and feed UID domains. Teams are *Tim/Timovi* in `hr.json`. The route `/smjene` stays. Team names an organization chose (for example `Smjena A`) are data and stay unchanged.
- **Every story:** migrations are forward-only and numbered from the next free number at build time. New organization tables have RLS, `organization_id` first and both audit triggers. Copy lives in `hr.json`, and nothing pilot-specific is seeded (DI-8). The repo is public, so the pilot is described generically. A story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same change.

## Technical Decisions

- **Domain owns every rule (AD-7, AD-8).**
  - `domain/personal` holds R14 and R15. As built, assignments ride on each member (`personalAssignments: { id, date, kind, shiftTypeId, teamId }`, as loans do). `shiftRoster` leaves an assigned member off every base roster. `personalShiftOn` sits in `roster.ts`, over `personal.ts`'s `personalShiftOf`. As built by 21.9, schedule versions ride on each member too (`scheduleVersions`): `scheduleSourceOn` and the personal-rotation projection are in `personal.ts`, `shiftRoster` keeps only team-rotation members, and `personalShiftOn` gives an assignment's shift, else the personal rotation's.
  - Output `teamId` is `string | null`. A personal shift carries `personalAssignmentId`, or `personalRotation: true` for a personal rotation's (21.9). `AtWorkShift` has no `source` field. Reminder items carry `source`.
  - `staffingOn(input, team, date)` gives R14.6's groups: the team's shift plus one group per other working type among the personal shifts counted with the team.
  - The fill is `filledAssignmentsOf(steps, offset, members, from, to)`. The copy is `copiedAssignmentsOf(range, targetStart, members)`. Both produce draft items only, never a stored rule. Copy copies assignments only, so a source date with none clears its target.
  - `domain/floaters` returns suggestions as ids and counts. `domain/holidays` returns `nationalHolidaysOf('HR', year)` as `{ date, code }`. `minimumOf(input, teamId)` gives a team's effective minimum.
- **`personal_assignments` (an exception, never versioned; shipped in `0077`).**
  - One live row per member and date, where live means `removed_at is null`.
  - Sessions have no write. The only writer is `save_personal_assignments(p_changes jsonb)`. It takes the lock, re-checks the caller as an active admin (42501 `PERSONAL_ASSIGNMENTS_REFUSED`) and accepts at most 5 000 `set`/`clear` items. It validates the whole batch first, and any breach refuses all of it (22023 `PERSONAL_ASSIGNMENTS_INVALID`; an archived type or team counts as a breach). It answers `{ inserted, removed, unchanged }`.
  - Members read through `calendar_personal_assignments()`, which returns one jsonb array (not a row set, so `max_rows` cannot cut it). The live helper is `private.live_personal_assignments`.
- **`member_schedule_versions`** (21.10, shipped in `0079`) is versioned like `rotation_assignments`, with its column names (`pattern_id`, `offset_step_id`). `source` is `TEAM`, `PERSONAL` or `MANUAL`. A `PERSONAL` offset is a composite foreign key to a step of that pattern. No version means team rotation. An active admin inserts from the organization's today on (after the latest, one scheduled at a time, never a repeat of the source in force) and deletes only the latest version not yet in effect. Every active member reads them; the snapshot (shape 6) and `member_schedule_inputs` carry every member's, whole. An insert or a cancel notifies `SCHEDULE_SOURCE_CHANGED { effectiveFrom, source }`. *Raspored osobe* names an existing pattern or defines one from step rows.
- **Roles, floaters and seasons.**
  - `job_roles` has a unique name key, archive and no delete. `members.job_role_id` is nullable.
  - `members.is_floater` defaults to false. `floater_roles` is read by admins only. Neither feeds any derivation except eligibility.
  - 21.11 relaxes 0008's one-scheduled-change rule. Versions still alternate, and only the latest is cancellable.
- **Collisions and swaps (AD-4 amended).**
  - `conflict_resolutions.team_id` becomes nullable, under a `NULLS NOT DISTINCT` key.
  - Replace Member gains a `personal_assignment_id` form. It matches only while that assignment is live, of the same date and type, and counted with the collision's team.
  - `resolve_with_personal_assignment(p_items)` writes the assignments and the resolutions in one transaction. As built by 21.7 (`0081`): 1–366 items `{ memberId, date, teamId|null, shiftTypeId, replacementId, note? }`, the assignments through 0077's save (one notice per replacement per call), an equal live `SHIFT` reused, an `OFF` replaced, another `SHIFT` 23505 `CONFLICT_REPLACEMENT_TAKEN`; a trigger ends the resolution when its assignment is removed. A Personal Shift (team or none) is replaced by assignment, a rotation shift by override; a teamless one only by a member with no team that date.
  - A swap approval writes assignments through the same save: the taker gets the shift, the giver gets `OFF`.
- **Holidays and minimums (AD-27).**
  - `organization_holidays` holds one row per date, with a `name` of 1–100 code points. Every member reads it. An admin inserts, renames (`name` only) and deletes.
  - The import is one PostgREST insert with `Prefer: resolution=ignore-duplicates`. There is no RPC.
  - `teams.off_on_holidays` defaults to false. `teams.minimum_members` is a nullable `smallint` with `>= 1`.
  - Holiday names never enter derivation. A cell a holiday emptied keeps `projectedShiftTypeId`.
  - As built by 21.15: every schedule input extends `HolidayRule` (`holidays?`, `teamsOffOnHolidays?`, optional lists of dates and team ids that 21.16 fills). `applyOverride` is the one layer (R13.3). `ScheduleCell` and `MemberShift` carry `holiday`/`offForHoliday` only where the rule touched the team, never on a team that works the holiday. A personal rotation counted with an off team is dropped that date, and an assignment never is. `scheduledShiftTypeOn` applies no holiday, so 21.16 gives its web callers the rule. `nationalHolidaysOf('HR', year)` serves years 2020–9999 as codes, and 21.17 names them in `hr.json`.
  - As built by 21.16 (`0080`): `organization_holidays` (one per date, 23505 `organization_holidays_organization_date_key`; four policies, none reading its own table; the lock and the re-check on every write; both audit triggers; TRUNCATE revoked) and `teams.off_on_holidays`. The snapshot holds `holidays: { id, date, name }[]` and `TeamRow.offOnHolidays` (shape 7). `holidayRuleOfCalendar(snapshot)` is the one recipe, spread by `snapshotScheduleInputOf` and the month grid, `{}` with no holiday or no team off. `scheduledShiftTypeOn` takes the rule as an optional sixth argument; the day detail and the conflict services pass it. History names the record *Blagdan* and the field *Ne radi na blagdane*. 21.17's e2e cleans up with `cleanUpHolidaysInSql(slug)`. As built by 21.17 (no migration): *Organizacija → Blagdani* reads the snapshot's holidays (the card alone waits for it; the page's keys are unchanged), adds one by hand, renames (`name` only, no check), removes, and imports `nationalHolidaysOf` from 2020 as ONE `upsert(…, { onConflict: 'organization_id,date', ignoreDuplicates: true })` of the missing dates, named by `organization.holidays.national.<CODE>`; the team dialog's *Ne radi na blagdane* is its own save. Every write but a rename runs `features/holidays/services/holiday-check.ts` (AD-5: erasures, *Što se mijenja* for the members a holiday can touch, short-staffed, the off teams' lost shifts). As built by 21.18 (no migration): `holidayNamesOfCalendar(snapshot)` (a memoized date → name map over `calendar.holidays`, beside the rule) names every holiday, a worked one too; the models carry the name and the emptied cell, each absent with none (`CalendarRow`/`CalendarDay`/`GridDate`/`DayDetail`/`TodayView`/`WeekDay` `.holiday`, `CalendarCell`/`TodayShift`/`WeekCell` `.offForHoliday`, `ManualCell.holiday`, the month's, week's and grid's `holidays` for the key); the shared `HolidayMark` (star + name) and the `Star` icon draw it; `override-erasures.ts`'s amend compares with the holiday-layered type. As built by 21.19 (no migration): `MemberHours.holidayMinutes?` (R13.7, absent with none) and `HOURS_FIGURE_HOLIDAY` from `MemberHoursInput.holidays`; the web's hours input carries every snapshot holiday date (`hoursSnapshotInputOf`), and *Sati* and the export show *Sati na blagdan* (`sati.holiday`) only with a worked holiday (`OrganizationHoursView.holidayColumn`, decided before the filters).
- **AD-5 guard.**
  - Guarded writes: every assignment save (grid, fill, copy, single date, cover), schedule-version writes, holiday inserts, deletes and imports, and `off_on_holidays` changes.
  - *Što se mijenja* lists, per member, the shifts lost and gained, double bookings, rest gaps, newly short-staffed shifts and roster overrides left inapplicable. Only an erasure blocks.
  - Exempt: holiday renames, minimums, roles and floater settings.
- **Audit (AD-11).** All five new tables are audited. The history groups one save by `transaction_id` into one entry per member (*Ručni raspored: {n} dana*), with its dates collapsible. 21.4 built this.
- **Assembly, feed and reminders (AD-19, AD-20, AD-18).**
  - `member_schedule_inputs` and the device snapshot carry every member's live assignments (done in 21.2, snapshot shape 4), schedule versions (21.10), and holiday dates with `offOnHolidays` (21.16). Both parity fixtures gain each one in that story.
  - Roles, floaters, holiday names and minimums are never carried.
  - Feed UIDs: an assignment's is `<date>-a-<assignmentId>-<memberId>@shift`. A personal rotation's is `<date>-p-<memberId>@shift`. Both shipped (21.2, 21.10), with the `PERSONAL_ROTATION` reminder form and its `:p:` subject (21.10, `0079`), read off 21.9's marker `AtWorkShift.personalRotation`.
  - A team reminder item keeps its eight keys and has no `source`.
  - A holiday-removed shift has no event and no reminder.
  - The feed's fixed lines say *Smjenko*. UIDs are unchanged.
- **Landing (AD-28).**
  - `apps/landing` is hand-written HTML and one stylesheet, with no client script. Its tokens are held equal to `apps/web`'s by a test. It uses self-hosted Outfit.
  - Build inputs: `LANDING_APP_URL`, `LANDING_CONTACT_EMAIL` and `LANDING_SIGNUP_URL`.
  - It ships as its own `shift-landing` nginx image with strict headers. `shift-web` is unchanged.
- **Out of scope:** two personal shifts on one date, holiday lists beyond Croatia, and holiday notifications.

## UX & Interaction Patterns

- **One scroll (UX-DR71).** *Kalendar* and *Ručni raspored* have no inner vertical scroller. The wide grid scrolls only horizontally, with a sticky first column. The date or team header is a separate sticky strip kept in step with the grid. The phone uses a day list with no horizontal overflow.
- ***Ručni raspored* (UX-DR72, UX-DR73; `/rucni-raspored`, admin only, under *Pregled*).**
  - Rows are grouped by team at the month's first date, with no-team rows last. Each row names its source: *rotacija tima* or *ručno* today, and *osobna rotacija* once 21.10 lands.
  - Cells are 36 px marks: an assignment is solid ink with a pencil, a rotation shift is muted with a rotation glyph, a draft change has a dashed edge, an inactive date is hatched.
  - Select by click, shift- or Ctrl-click, drag, or arrows with Space and Enter. *Uredi odabrano* opens the picker, which offers the shift types, *Slobodno*, *Očisti* and *Računaj u tim…*.
  - The draft spans months. A sticky save bar has *Odbaci* and *Spremi*. *Spremi* re-reads, shows *Što se mijenja*, and saves in one call.
  - A phone edits one member's month as a day list.
  - The page uses 21.23's `PageToolbar` and a legend for every mark.
- **Fill and copy (UX-DR74).** *Popuni uzorkom* takes step rows (type or *Slobodno* × count), a start step and a range. *Kopiraj tjedan* and *Kopiraj mjesec* write into the same draft and save path.
- **Day detail.** A personal shift reads `{smjena} · ručno` or `· osobna rotacija`, plus *bez tima* when it has no team.
- **Raspored osobe (UX-DR75).** A card on the member page: *Rotacija tima*, *Osobna rotacija* (pattern, start step, *Vrijedi od*) or *Samo ručno*, with *Povuci* to cancel.
- **Roles (UX-DR76).** Roles are managed in *Organizacija → Poslovi*. *Posao* is set on the member page and shown and filtered on in the grid, the day detail and the directory. *Sezona od–do* sits in the status card.
- **Floaters (UX-DR77).** The member page has *Zamjena* with the roles they can cover. *Za odluku* lists *Predložene zamjene* with each one's shift count. With no eligible floater it says `Nema slobodne zamjene za posao {posao}.`. *Pokrij cijelo odsustvo* previews the covered and the not-free dates.
- **Holidays (UX-DR78).** *Organizacija → Blagdani* has a year picker, *Dodaj blagdan*, and an import with a preview. A past date gets a warning. The team dialog has *Ne radi na blagdane*. A holiday shows as a glyph plus its name, never colour alone. An emptied cell reads *blagdan*.
- **Minimum (UX-DR79).** The team dialog has *Najmanje ljudi*, with the hint `Prazno: vrijedi za organizaciju ({n})`.
- **Public page (UX-DR80).** Direction G, phone first, both themes. A *Smjenko* hero, *Javi se*, *Prijava*, and the footer `Bez kolačića i praćenja.`.
- **Brand (UX-DR81).** The mark is concept C, *Predaja smjene*. Its colours are fixed in both themes. The wordmark is HTML text in Outfit 600, never SVG `<text>`.
- **Compact toolbar (UX-DR82).** One row: the title, the search or the month control, `Filtri` (n), `Prikaz ▾`, `Izvoz ▾` and the primary action. Under it, the result count and removable chips. On a phone, at most two rows. `Filtri` opens a dropdown from 1024 px and a bottom sheet below that.

## Cross-Story Dependencies

- **Status (2026-11-26).** Done, merged with CI green: 21.1–21.5, 21.9, 21.10 (PR #377, `0079`), 21.12, 21.15 (PR #378), and 21.16 with 21.17 (PR #380, `0080`). 21.6 (PR #374) and 21.25 (PR #376) are merged on `main` and still `review` in the sprint status until their specs are rewritten. 21.18 and 21.19 are built and in review, CI pending (no migration; branch `feat/21-18-21-19-holidays-shown`). 21.21, 21.22, 21.23 and 21.24 are built and in review, waiting on CI. The rest are ready-for-dev.
- **Personal track.** 21.1 → 21.2 → 21.3 → 21.4 → 21.5. 21.6 needs 21.2. 21.7 and 21.8 need 21.6.
  - 21.5 reuses 21.4's draft, preview and save.
  - No e2e opens `/rucni-raspored` yet. One is owed with 21.5.
- **Schedule source.** 21.9 needs 21.1. 21.10 needs 21.9 and 21.4. 21.10 replaces the grid's interim row-source rule with `scheduleSourceOn`. 21.11 is independent.
- **Roles and floaters.** 21.12 is independent. 21.13 needs 21.7 and 21.12. 21.14 needs 21.13.
  - As built by 21.7 (`0081`): a teamless collision is listed, resolved, marked on the member's cell and guarded; the grid draws leave and says each new conflict a save makes. 21.13 narrows `assignmentCandidatesOf` and writes `resolveWithPersonalAssignment` (one item); 21.14 passes one item per covered date to the same call.
- **Holidays.** 21.15 needs 21.9. 21.16 needs 21.15. 21.17 and 21.19 need 21.16. 21.18 needs 21.16 and 21.4.
- **Hot files.** Stories touching `index.css`, `components/ui/*`, `chrome.tsx`, `hr.json` or the theme tests start from the previous one's merge. CSS changes run the theme root files.
- **CI-only database cases.** 21.2, 21.7, 21.10, 21.11, 21.13 and 21.16 have database cases that only CI runs, so they get the unrun-DB-test review layer.
- **21.21.** It can be built now. Publishing needs the founder's contact address, and serving the apex needs DNS. It reuses 21.24's mark.
- **After the epic.** The operator demo script is rewritten without carrier teams or holiday overrides after 21.10 and 21.17. Then production (20.9).
