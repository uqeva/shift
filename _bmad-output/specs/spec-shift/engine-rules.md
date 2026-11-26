# Engine Rules

The computation rules the domain logic must implement, with the worked examples that decide them. Vocabulary per `glossary.md`. Every rule here is testable without a browser or a rendered component; the pilot's seed configuration referenced in examples is defined in the adopted addendum, §1.

---

## 1. Rotation projection

The Projected Schedule is a pure function:

```
projectedShiftType(team, date) =
    pattern[ (offset + daysBetween(anchorDate, date)) mod cycleLength ]
```

Rules:

- **R1.1** Deterministic and repeatable. Two evaluations for the same team and date agree, always.
- **R1.2** Defined for dates *before* the Anchor Date as well as after. `daysBetween` may be negative; the modulo must be a true mathematical modulo, not a language remainder that returns negatives.
- **R1.3** Cycle Length is arbitrary. Nothing may assume 7, or any relationship to a week.
- **R1.4** The same Shift Type may appear more than once in a Pattern.
- **R1.5** An empty Pattern is **refused at save** — `cycleLength` of 0 leaves the modulo undefined. Same class as R1.6: refused because the result is unrepresentable, not because it is unwise.
- **R1.6** Offset must be within `[0, cycleLength)`, **refused at save** — an offset outside the cycle names no position in the pattern, so `projectedShiftType` has no defined answer. This is one of the product's save refusals, not a warning (§5).
- **R1.7** Teams may share a Pattern at different Offsets, or at the same Offset. The same Offset is legal and produces warnings, not an error (§5).

**Worked example — the pilot.** Pattern `[Dan, Noć, Slobodno, Slobodno]`, cycle length 4, teams at offsets 0–3, shared anchor date. Day grid over one cycle:

```
          A         B         C         D
Day 1    Dan       Noć       Slob      Slob
Day 2    Noć       Slob      Slob      Dan
Day 3    Slob      Slob      Dan       Noć
Day 4    Slob      Dan       Noć       Slob
```

Each day has exactly one team on `Dan` and one on `Noć`. This is a property of this configuration, not a guarantee of the engine.

---

## 2. Override layering

```
scheduledShift(team, date) = applyOverrides(projectedShiftType(team, date))
shiftRoster(team, date)    = activeMembers(team) modified by rosterOverrides(team, date)
```

Rules:

- **R2.1** No Override may write to a Rotation Pattern or Rotation Assignment. The rule records are byte-identical before and after any override operation.
- **R2.2** Removing every Override returns the Schedule to the pure projection exactly, and returns every roster to its default membership.
- **R2.3** A Roster Override's *replace* operation is one atomic action recording both the removed and the added Member — not a remove plus an unrelated add.
- **R2.4** A Member may be added by Roster Override to a shift on a date their own Team is non-working.
- **R2.5** Every Override carries author, timestamp, and reason, and that record outlives the schedule entry it modified.
- **R2.6** Removing an Override is itself an attributable action.
- **R2.7** An overridden date is distinguishable from a projected one without opening a detail view, and the detail exposes the projected value the override replaced.

### Rotation change reconciliation

- **R2.8** A rotation edit takes an effective date. Shifts before it are unchanged.
- **R2.9** Overrides dated on or after the effective date are enumerated for explicit admin disposition — confirm, amend, or discard. None may be silently discarded, and none may be silently reapplied to a shift it was not written for.
- **R2.10** A rotation change creates a new **versioned** Rotation Assignment with a validity range; no Assignment row is ever updated in place, and projection selects the version covering the date being derived. Team membership, Member active status, and Shift Type times are versioned the same way and for the same reason. See `ARCHITECTURE-SPINE.md` AD-2.

---

## 3. Hour computation

Hours are derived, never entered. Two stages: nominal duration, then band intersection.

### Nominal duration

- **R3.1** `nominalDuration = endTime - startTime`, and where `endTime <= startTime`, `+ 24h`. Derived from the times; never entered by hand.
- **R3.2** A non-working Shift Type has zero Nominal Duration and needs no times.
- **R3.3** A midnight-crossing Shift Type produces exactly **one** Scheduled Shift, of its full Nominal Duration, attributed to its **start date**. Never two rows, never two dates, never counted twice.
- **R3.4** A 24-hour Shift Type (e.g. 08:00–08:00) is valid and yields 24 hours.
- **R3.5** Nominal Duration is authoritative for all accounting. Elapsed Duration — real time between absolute instants — differs on daylight-saving transition dates and must never enter an hour total. A 19:00–07:00 shift reports 12 hours on every date of the year.

### Band intersection

- **R3.6** Band Hours are computed by intersecting the shift's **nominal wall-clock interval** with each Hour Band. Operating on nominal intervals is what makes results DST-stable per R3.5.
- **R3.7** Band Hours always sum exactly to Nominal Duration, and Total Hours always equals the summed Nominal Durations of the member's working shifts. This is an invariant to assert, not an expectation.
- **R3.8** A shift straddling a band boundary is **split**, never rounded to one band.
- **R3.9** Hour Bands partition the full 24 hours. A configuration with a gap or an overlap is refused at configuration time, so no working hour is unclassified and none is counted twice.
- **R3.10** A band may cross midnight, and its intersection with a midnight-crossing shift must be computed as one continuous interval on both sides.
- **R3.11** Hours follow the Shift Roster. A Roster Override moves hours between Members; the added Member's rise and the removed Member's fall, with no effect on anyone else.
- **R3.12** Shift **counts** per band are reported alongside hours.
- **R3.13** Moving a band boundary recomputes Band Hours for affected shifts and modifies no Shift Type record and no Total Hours.

**Worked example A — the pilot.** Bands `Dan` starting 07:00 and `Noć` starting 19:00, so `Dan` = 07:00–19:00 and `Noć` = 19:00–07:00. These coincide with the shift changeover times, so no shift straddles a boundary:

| Shift | Nominal | Day hours | Night hours |
|---|---|---|---|
| `Dan` 07:00–19:00 | 12h | 12 | 0 |
| `Noć` 19:00–07:00 | 12h | 0 | 12 |

Five `Dan` shifts and four `Noć` shifts in a month: **60 day, 48 night, 108 total**, with counts 5 and 4.

**Worked example B — bands diverging from shifts.** Same shift types, bands moved to `Dan` starting 06:00 and `Noć` starting 21:00:

| Shift | Nominal | Day hours | Night hours |
|---|---|---|---|
| `Dan` 07:00–19:00 | 12h | 12 | 0 |
| `Noć` 19:00–07:00 | 12h | **3** (19:00–21:00, 06:00–07:00) | **9** (21:00–06:00) |

Same shift records, same nominal durations, different split. **The pilot exercises only example A**, so example B — or an equivalent configuration whose bands and shifts diverge — must exist as a second test fixture or R3.6 and R3.8 ship unverified.

**Worked example C — a 24-hour shift.** A single 07:00–07:00 Shift Type under the pilot's bands yields 12 day and 12 night hours. Recorded to show band intersection is independent of how a duty period is decomposed; the pilot nonetheless models its 24-hour duty as two consecutive 12-hour shifts, because per-band shift counts (R3.12) require day and night to be distinct Shift Types.

---

## 4. Leave accounting

- **R4.1** A Leave Record is a date range for one Member, entered by an Admin. Recording it modifies no Rotation Pattern, no Rotation Assignment, and no Scheduled Shift.
- **R4.2** **Cost** = the count of dates in the range on which the Member had a **working** Scheduled Shift. *(Amended 2026-11-25, R14.5, R15.3: a working Personal Shift, from a Personal Assignment or a personal rotation, is such a shift; a date a Holiday leaves without one costs nothing, R13.4.)* Non-working dates inside the range cost nothing. *This rule is inferred, not confirmed by the pilot organization — see SPEC open questions.*
- **R4.3** Cost is shown before saving, and is recomputed if an Override later changes whether a date in the range is working.
- **R4.4** A range overlapping an existing Leave Record for the same Member is refused, so no date is charged twice.
- **R4.5** `Leave Balance = Leave Allowance − Leave Days consumed in the Leave Year`. The three figures are internally consistent at every observable moment.
- **R4.6** Only Leave Days inside the current Leave Year count toward Balance. The Leave Year need not align to the calendar year.
- **R4.7** A record whose cost exceeds remaining Balance is saved **with a warning**, not refused, so a real agreement is never unrecordable.
- **R4.8** Deleting a Leave Record restores consumed Balance. Amending recomputes cost, Balance, and Conflicts for the new range.
- **R4.9** Changing a Member's Leave Allowance recomputes Balance and never retroactively invalidates an existing Leave Record.
- **R4.10** A working shift covered by a Leave Record is never added into Band Hours or Total Hours. Leave is reported as the Leave Days of the period, never as hours (human decision 2026-10-10). Summed over the periods a record spans, a record's Leave Days equal its cost.
- **R4.11** Every Leave Record has an Absence Type. A type's name and its *draws allowance* flag are Organization data. Every type raises Conflicts by R6.1, and only drawing types count toward R4.5. No type and no record carries a reason (Q5). *(R4.11–R4.15 added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion.)*
- **R4.12** A Half-day Record is a one-date record covering the first or second half of the Member's working Scheduled Shift that date. Its halves are split at the midpoint of the shift's nominal interval. It costs 0.5 Leave Days and raises one Conflict like a full day. The worked half's interval is intersected with the Hour Bands and counted in Band Hours and Total Hours by R3.6; the absent half counts in neither. A Half-day Record on a date without a working shift is refused.
- **R4.13** Leave Allowance is held per Leave Year. Carried-over Days into year *Y* = min(the Organization's carry-over cap, max(0, Leave Balance of year *Y − 1* at its end)). The cap and the expiry date are Organization settings; no default value exists in the core (DI-8). A cap of 0 or an empty setting means no carry-over. *(amended 2026-11-16, story 13.6)* In the chain, each earlier year's allowance counts in proportion to the calendar days of that Leave Year on which the Member was active (status versions only; a Member with none is active on every date), rounded down to a half day: prorated(*Y*) = ⌊2 × allowance(*Y*) × active days / days in *Y*⌋ / 2, and year *Y*'s end balance = prorated(*Y*) + carried days consumed in *Y* − Leave Days drawn in *Y*. The current year's allowance is never prorated.
- **R4.14** Leave Days of drawing types in year *Y* consume Carried-over Days first, in date order, and the current year's allowance after them. Carried-over Days not consumed by Leave Days dated on or before the expiry date expire and are not part of the balance after it.
- **R4.15** Carried-over Days are derived on read (AD-1), never stored. Changing an earlier year's records or allowance recomputes every later year's carry-over and balance. *(amended 2026-11-16, story 13.6)* So does a change to a Member's status versions, since the active days of every year in the chain are derived from them.

**Worked example — carry-over.** Cap 5, and an expiry date the Organization sets inside year *Y*. Year *Y − 1*: allowance 20, used 14, balance 6 → carried 5. Year *Y*: allowance 20; 3 Leave Days before expiry consume 3 carried days; at expiry the remaining 2 carried days lapse; balance after expiry = 20.

**Worked example.** Leave 10.09–14.09 against a schedule of `Dan`, `Noć`, `Slobodno`, `Slobodno`, `Dan`: cost is **3 Leave Days** and **3 Conflicts** are raised. The two `Slobodno` dates cost nothing and raise nothing.

---

## 5. Configuration warnings

Both are reported on save, never persist as standing alerts, and never block.

- **R5.1 Coverage Warning.** Over the next full cycle, report dates with no working Team, and dates with more than one working Team on the same Shift Type.
- **R5.2** Two Teams at the same Offset produce both a duplicate-coverage and a gap warning.
- **R5.3** The pilot configuration reports zero coverage gaps and zero duplicates.
- **R5.4 Rest Gap Warning.** Report where a Team is scheduled for consecutive working Shift Types with no non-working interval between, stating the resulting continuous duration.
- **R5.5** The reported duration is computed from Nominal Durations, so it is stable across daylight-saving transitions.
- **R5.6** The pilot configuration **does** produce a rest-gap report — `Dan` immediately precedes `Noć`, giving 24 continuous hours — and this is a deliberate design, not a misconfiguration. Warnings must therefore be informational at save time only, so a deliberate pattern generates no recurring noise.
- **R5.7** A pattern with a non-working slot between every pair of working slots produces no rest-gap report.

---

## 6. Conflict lifecycle

```
Conflict exists  ⟺  a working Scheduled Shift's roster includes a Member
                    covered by a Leave Record on that shift's date,
                    and no Resolution has been recorded
```

- **R6.1** Detection creates a Conflict per affected working Scheduled Shift. Non-working shifts coinciding with leave create nothing.
- **R6.2** Detection deletes, hides, and alters no Scheduled Shift.
- **R6.3** A Conflict persists until an explicit Resolution is recorded. Nothing expires it, auto-clears it, or suppresses it from view.
- **R6.4** Detection re-runs when: leave is recorded, amended, or deleted; an Override changes a shift type or a roster; a Member changes Team; a Member is deactivated; a Rotation changes.
- **R6.5** There is no recomputation. A Conflict is derived on read from the Schedule and Leave Records, so R6.3 holds by construction — no event can be missed, because no event is what creates it. Only the Conflict Resolution is stored. See `ARCHITECTURE-SPINE.md` AD-4.
- **R6.6** Exactly three Resolutions exist, each recording the acting Admin and a timestamp:

| Resolution | Effect |
|---|---|
| **Accept as Uncovered** | Shift remains, marked Uncovered, stays visible on the Calendar. The shift leaves the absent Member's Band Hours and counts as its Leave Day (R4.10). |
| **Replace Member** | Implemented as a Roster Override (§2). Replacement's Band Hours rise; absent Member's do not. Shift is neither in Conflict nor Uncovered. Warns without blocking if the replacement is themselves on leave or already rostered that date. |
| **Amend Leave** | Recomputes cost, Balance, and Conflicts for the new range (R4.8). Deleting the record clears every Conflict from it and restores Balance. |

- **R6.7** Deleting or amending a Leave Record whose Conflict was already resolved by **Replace Member** must not silently revert that Roster Override; the situation is surfaced to the Admin.
- **R6.8** Unresolved Conflicts are listed soonest-first, with date, Team, Shift Type, Member, and the causing Leave Record. Conflicts for past dates remain listed and distinguishable from upcoming ones.

---

## 7. Member lifecycle effects on the engine

- **R7.1** A Member with no Team has an empty schedule and generates no Conflicts.
- **R7.2** Moving a Member between Teams changes their schedule from the move date forward and rewrites no history.
- **R7.3** Deactivating a Member preserves all historical Scheduled Shifts, Overrides, hours, and Leave Records; removes them from **future** Shift Rosters; alters no past shift; and generates no new Conflicts.
- **R7.4** Deactivation removes a Member from **future** Shift Rosters and alters no past roster, because active status is versioned (`ARCHITECTURE-SPINE.md` AD-2). *Closed 2026-10-10:* a vacated shift is not a Conflict. When the Organization sets Minimum Members, it shows as a Short-staffed Shift by §10, and the deactivation's preview reports it before saving.
- **R7.5** Adding an active Member to a Team adds them to that Team's future Shift Rosters without touching past ones.
- **R7.6** A Team with historical Scheduled Shifts is archived rather than deleted, and its history remains readable.

---

## 8. Required test coverage

- **R8.1** Every constraint in SPEC.md and every rule in this document has at least one automated assertion, executable without rendering a component or starting a browser.
- **R8.2** Two configuration fixtures at minimum: the pilot, and a structurally different organization differing in team count, cycle length, shift durations, **and** band boundaries such that shifts straddle a band edge (worked example B). The second fixture is the UJ-5 configuration from `EXPERIENCE.md`: a security organization, three teams, a five-slot rotation pattern, eight-hour shifts, and its own band boundaries. It is named rather than left to the test author because the pilot's bands coincide with its shift changeovers (R3.8, R8.2 note), so an abstractly-chosen second fixture can satisfy the wording while still never exercising band splitting.
- **R8.3** Explicit cases for all three save refusals — empty pattern (R1.5), offset outside cycle (R1.6), and an hour-band gap or overlap — and for: negative `daysBetween` (R1.2), midnight-crossing intersection (R3.10), both daylight-saving transition dates (R3.5), band-hours-sum invariant across randomized configurations (R3.7), and the leave-overlap refusal (R4.4).

---

## 9. Requests (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

Leave Requests (CAP-19) and Swap Requests (CAP-22) are stored assertions by a Member. They change nothing until an Admin decides them.

- **R9.1** A pending, rejected or withdrawn request derives nothing. It creates no Conflict, charges no Leave Balance, moves no hours, alters no Scheduled Shift or Shift Roster, and creates no Short-staffed Shift. Removing every request leaves every derived figure byte-identical.
- **R9.2** Approval is the only effect a request has. Approving a Leave Request creates one Leave Record of the requested range, Absence Type and half, attributed to the approving Admin. Approving a Swap Request creates a Roster Override replacing A with B on A's shift and, when the request names a return shift, one replacing B with A on B's shift, each attributed to the approving Admin with the reason code `swap`. A Swap Request needs the colleague's acceptance before an Admin may approve it. Rejection and withdrawal record a decision and create nothing.
- **R9.3** An approval preview runs the same rules as the direct write it would make: cost and balance by §4, Conflicts by §6, Short-staffed Shifts by §10, hour deltas by §3, and erasures by AD-5. It never computes a second version of any of them (Q8). Every finding warns and none blocks, except an AD-5 erasure, which needs explicit confirmation.
- **R9.4** A Leave Request whose range overlaps the Member's existing Leave Records or another pending Leave Request of theirs is refused when it is sent. A Swap Request whose given shift is not a working Scheduled Shift on the proposer's roster, or whose return shift is not on the colleague's, is refused when it is sent. If the schedule has changed by approval time so that the request no longer applies, the approval is refused as stale, and the request stays pending for rejection.

## 10. Staffing (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

- **R10.1** *(Amended 2026-11-25: a Team's shifts and their people at work include Personal Shifts counted with it, R14.6.)* The people at work on a working Scheduled Shift are its Shift Roster after Roster Overrides, minus every Member covered on that date by a Leave Record of any Absence Type. A Member on a Half-day Record counts as at work. A replacement placed by an Override counts.
- **R10.2** A Scheduled Shift is short-staffed when it is working **and** its people at work number fewer than the Organization's Minimum Members. *(Amended 2026-11-25, sprint-change-proposal-2026-11-25-pilot-readiness, story 21.20: the minimum of a Team's shift is that Team's own Minimum Members when set, else the Organization's. A Team's minimum overrides the Organization's for that Team only; with neither set, nothing of that Team is short-staffed.)* Non-working shifts are never short-staffed. When Minimum Members is empty, nothing is short-staffed.
- **R10.3** Short-staffed is derived on read (AD-1), never stored, and never resolved: it ends only when the roster, the absence or the setting changes.
- **R10.4** Short-staffed never blocks a save. Every write that can change it reports the shifts it would newly make short-staffed before saving, as `{ code: 'SHORT_STAFFED', date, team, atWork, minimum }` (AD-8). Minimum Members is current-state (AD-2), so changing it changes the report for past dates too.
- **R10.5** Worked example. A team of four on a working shift, Minimum Members 3. One Member on leave: 3 at work, not short-staffed. Two Members on leave: 2 at work, short-staffed. One of those two replaced by an Override: 3 at work, not short-staffed. The same team with Minimum Members empty: never short-staffed.

## 11. Loans (added 2026-11-20, sprint-change-proposal-2026-11-20-v2-scope; implemented by story 18.1)

- **R11.1** The effective Team of a Member on a date is the loan Team if a Loan of theirs covers the date, else their own Team. A Member with no Team can be lent; on the covered dates they work with the loan Team.
- **R11.2** The base Shift Roster of Team T on date d is the active Members whose effective Team on d is T. Roster Overrides then apply on top as before. On the loan Team the Member holds no position. An inactive Member is on no roster, lent or not.
- **R11.3** Loans of one Member never overlap. A Loan to the Member's own Team or to an archived Team is refused when it is written. The engine treats overlapping or malformed Loans as a breached precondition. Because the own Team is versioned, a Loan that later points at it derives as the own Team, position kept. A Roster Override may still put a lent Member on another Team's shift, their own Team's included: a double shift, as for any Member.
- **R11.4** With no Loan, R11.2 equals the existing roster rule exactly. Every schedule, roster, hour, Conflict and staffing figure is byte-identical to what it was before Loans existed.
- **R11.5** A Loan never changes a Rotation Assignment or a Team membership.
- **R11.6** Worked example on the pilot fixture. A Member of Team A is lent to Team C for the 10th to the 12th. A's rosters on those dates lose them and C's gain them. Their hours follow C's Shift Types. The 13th is A again. A Roster Override on A that takes them off on a covered date no longer applies, and one on C does.

## 12. At-work shifts (added 2026-11-20, sprint-change-proposal-2026-11-20-v2-scope; implemented by story 16.2)

- **R12.1** A Member's at-work shifts on date d are the working Scheduled Shifts whose Shift Roster includes them on d — their effective Team's (R11.1) after Roster Overrides, and each shift a Roster Override puts them on — with the Shift Type Overrides applied, minus the date if they hold a full-day Leave Record of any Absence Type. Only Overrides in force apply; one a Rotation change left pending review does not. A shift belongs to the date it starts on (DI-5). A working shift whose Shift Type has no version of its times in effect on d has no interval and is not an at-work shift.
- **R12.2** A Half-day Record keeps the date's one working shift with the worked half's interval, split at the nominal midpoint as hours split it (R4.12): absent the first half, the second is worked, and the reverse. The second half of a midnight-crossing shift may start after midnight; it still belongs to the start date. On a date holding more than one working shift the half splits none, as in hours. A worked half of no minutes leaves no at-work shift.
- **R12.3** The calendar feed, the reminders and the browser's month download read R12 only, through the domain's one function (`atWorkShiftsOf`, AD-7), never a rule of their own.
- **R12.4** Worked example on the pilot fixture. A Member of Team A, which works Dan 07:00–19:00 on the 31st, holds a Half-day Record of the first half that date: their at-work shift is Dan from 13:00 to 19:00. A Member of Team B, which works Noć 19:00–07:00 that date, holds one of the second half: theirs is Noć from 19:00 to 01:00 the next day. A Member lent to Team C works C's shift, not A's. A full-day Leave Record leaves the date with none.

## 13. Holidays (added 2026-11-25, sprint-change-proposal-2026-11-25-pilot-readiness; implemented by story 21.15)

- **R13.1** A Holiday is a civil date of the Organization with a name. At most one per date. It is Organization data entered by an Admin; the engine never decides on its own that a date is a holiday (DI-8). A proposed national list (R13.6) is only a suggestion an Admin accepts.
- **R13.2** A Team is either *off on holidays* or not (a current-state Team setting, off by default). On a Holiday, a Team off on holidays works no shift: its Scheduled Shift that date has no Shift Type, and the projected type is kept beside it as R2.7 keeps an overridden one. A Team not off on holidays works its projection as on any other date. The same holds for a personal rotation's projected shift counted with a Team off on holidays (R15.4). A Personal Assignment on a Holiday is never removed: it is the Admin's explicit plan (R14.4).
- **R13.3** Layering: `scheduledShift(team, date) = shiftTypeOverride(team, date) ?? (holiday(date) ∧ offOnHolidays(team) ? none : projectedShiftType(team, date))`. A Shift Type Override still wins on a Holiday, so an Admin can make a day Team work it. The holiday changes no Rotation Pattern, no Rotation Assignment and no phase: the rotation continues the next date as if the date had been worked.
- **R13.4** Everything that reads the Scheduled Shift follows: Shift Rosters, Roster Overrides (which apply only on a working shift, R2.4), hours, at-work shifts (R12), Conflicts, staffing and Leave cost (R4.2: a date with no working shift costs nothing).
- **R13.5** With no Holiday in an Organization, or no Team off on holidays, every derivation is byte-identical to what it was before Holidays existed.
- **R13.6** The proposed list for Croatia and a year is the fixed list in force (1 January, 6 January, 1 May, 30 May, 22 June, 5 August, 15 August, 1 November, 18 November, 25 December, 26 December) plus Easter Sunday, Easter Monday and Corpus Christi (Easter + 60 days), Easter by the Gregorian computus. The engine returns codes and dates (AD-8); names are the locale's.
- **R13.7** *Holiday hours* (story 21.19) are the minutes of a working shift's nominal interval that fall within a Holiday's civil date, from 00:00 to 24:00, intersected as Band Hours are (DI-5, DI-6). They are a view over Total Hours, not a partition of them: they are counted inside Total Hours and Band Hours as before. *(As built 2026-11-26, story 21.19: each worked shift's interval, the worked half of a half day included, is intersected with 00:00–24:00 of its own date and, past midnight, of the next date, a holiday in the next month included; a leave shift, an untimed shift and a non-working type add nothing. The figure is absent, not 0, when no worked shift touches a holiday, so every output without one is byte-identical, R13.5. A shift counts wholly in the month of its start date (DI-5), so a Noć dated the last day of a month counts its hours after midnight on a holiday on the 1st in that month: such a holiday's first hours are reached from the previous month only.)*
- **R13.8** Worked example on the pilot fixture's shape. Day Team D, off on holidays, would work 06:00–14:00 on a Wednesday Holiday; it works nothing, its roster is empty, and a Leave Record of a D member over that week costs four days, not five. A 24-hour Team on Dan 07:00–19:00 that date works it, and with R13.7 all 12 hours are holiday hours; the Team on Noć 19:00–07:00 the evening before has 7 holiday hours.
- **R13.9** *(Added 2026-11-26, story 21.15: the domain's decisions.)*
  - The rule reads two lists, the holidays' dates and the Teams off on holidays. With either empty it decides nothing, and every output is byte-identical (R13.5). A holiday that is not a calendar date, an empty Team id, or a date or Team given twice is a breached precondition. A Team id naming no Team decides nothing.
  - A Scheduled Shift the holiday emptied keeps its projected type and carries two marks, *holiday* and *off for holiday*. One whose Shift Type Override won on the holiday carries *holiday* alone. A Team that works the holiday, or has no Rotation in effect that date, carries neither: a date's holiday as such is read from the list, never from a cell.
  - A personal rotation's shift counted with a Team off on holidays gives no shift that date, as a day off does. This holds whether or not that Team has a Rotation in effect that date (a rotation-less day Team is the usual case, R15.7), and when a Shift Type Override makes the Team work the holiday (R15.4: an override never changes a personal rotation's shift). The Admin gives such a Member the day with a Personal Assignment. A shift counted with another Team or with none is kept, and so is every Personal Assignment. The counted Team is the effective one, so a Loan decides it (R11.1).
  - The proposed Croatian list is for years from 2020, when the list in force began; an earlier year is refused rather than proposed wrongly. When Corpus Christi falls on a fixed holiday (30 May or 22 June), the date is listed once, as the fixed holiday, so the list holds 13 that year (2024, for one).

## 14. Personal assignments (added 2026-11-25, sprint-change-proposal-2026-11-25-pilot-readiness; implemented by story 21.1)

- **R14.1** A Personal Assignment gives one Member, on one date, one of three things: a working Shift Type, a non-working Shift Type, or a plain day off. A working one may name the Team it counts with. A Member has at most one live Personal Assignment per date. It is an Exception: attributable (DI-11), never versioned, removed rather than edited. Replacing one is a removal and an insert in the same save. An Admin enters it in the manual schedule grid or, for one date, from the Member's page. Members with no Team and Members whose Team has no Rotation are scheduled this way alone.
- **R14.2** **Precedence.** On a date with a Personal Assignment, the Member is on no base Shift Roster (R11.2): neither their own Team's rotation roster nor a loan Team's. The assignment is their day. Roster Overrides still apply on top. One that puts them on a Team's shift still applies (a double booking, which warns). One that takes them off a base roster they are no longer on does not apply, as R11.6 already reads.
- **R14.3** A working assignment is a **Personal Shift** of its Shift Type, with that type's times in effect on the date. A Member inactive on the date has no Personal Shift, as they are on no roster (R7). An assignment kept on such a date derives nothing, and the grid shows it as inactive. A working Shift Type with no version of its times in effect yields no shift (R12.1). The shift counts with the Team the assignment names; if it names none, with the Member's effective Team that date (R11.1); otherwise with no Team. A non-working assignment and a day off are no shift: the Member is off that date.
- **R14.4** **Composition.** A Team's Scheduled Shift (projection, then holidays R13, then Shift Type Overrides) is unchanged by Personal Assignments. It decides only the base roster of Members who have no assignment that date. So, for its Member and date alone, a Personal Assignment beats the Rotation, a Holiday, a Shift Type Override of their Team and a Loan. Rotation Patterns, Rotation Assignments and Team membership are byte-identical before and after (R2.1).
- **R14.5** Everything that reads a Member's shifts includes their Personal Shifts:
  - at-work shifts (R12);
  - hours (R3), with the source `PERSONAL` in the hours explanation;
  - Leave cost (R4.2, as amended: a date on which the Member has a working Personal Shift costs a day);
  - Conflicts (R6.1: a Leave Record over a working Personal Shift collides, keyed by the Member, the date and the counted Team, which may be none);
  - swaps (R9: a Personal Shift can be given or taken);
  - double booking and rest gap (R5), which warn and never block.
- **R14.6** **Staffing** (amends R10.1). The shifts of Team T on date d are T's working Scheduled Shift, if there is one, and one group for each other working Shift Type among the Personal Shifts counted with T that date.
  - The people at work on T's Scheduled Shift are its roster after Roster Overrides, plus the Personal Shifts counted with T of the same Shift Type, minus everyone absent.
  - The people at work in a group are its Personal Shifts minus everyone absent.
  - Each is short-staffed under R10.2.
- **R14.7** With no Personal Assignment in an Organization, every schedule, roster, hour, Conflict, staffing and feed figure is byte-identical to what it was before Personal Assignments existed.
- **R14.8** Worked example. Day Team D has no Rotation. Its two Members and a Member with no Team (a student) are planned in the grid:
  - D1 has 06:00–14:00 on Monday to Friday of week one and 14:00–22:00 in week two;
  - the student has 06:00–14:00 on Saturday, counted with no Team;
  - D2 has a day off on Wednesday.

  Their months, hours, feeds and reminders carry exactly those shifts. D's Monday staffing is one group, 06:00–14:00, with D1 and D2 at work. A 24-hour Team's Member with a Personal Assignment of the day off on their Dan date leaves that Team's roster for that date only. The Team's Scheduled Shift is unchanged, and its staffing drops by one. A Leave Record over the student's Saturday costs one day and raises one Conflict with no Team.
- **R14.9** *(Added 2026-11-25, story 21.1: the domain's decisions.)* A Personal Shift counted with no Team carries no Team (`teamId: null`) wherever it is read: the Member's day, hours, Conflicts, at-work shifts and reminders. It joins no Team's staffing. A Personal Shift has no projected Shift Type, and no Shift Type or Roster Override changes it. A Roster Override that puts a Member on Team T's shift is inert on a date the Member holds a `SHIFT` assignment counted with T. Their day is already T's, as a base-roster Member's is (R14.2 reads this as "already on it"). One counted with another Team or none still applies, as a double booking. In staffing each Member counts once per shift. A Member holding two shifts of one Team that date (a double booking) counts in both. A Team's groups follow its Scheduled Shift, in the order their first Member appears. A short-staffed group is matched across a change by its date, Team and Shift Type, and a Scheduled Shift also matches a group of its own type (R10.4). Until story 21.7 stores it, a Conflict with no Team cannot be resolved.

## 15. A Member's schedule source (added 2026-11-25, sprint-change-proposal-2026-11-25-pilot-readiness; implemented by story 21.9)

- **R15.1** Each Member has, on each date, exactly one **schedule source**:
  - *team rotation*, the default and what every Member has today: the Member is on their effective Team's base roster (R11.2);
  - *personal rotation*: a Rotation Pattern and an offset step, attached to the Member and projected from its effective date exactly as a Team's rotation is (R1);
  - *manual only*: no rotation at all.
- **R15.2** The schedule source is **versioned** (AD-2): each version has an effective date and is selected by the date being derived. A version is never edited in place. A Member with no version has team rotation on every date, so every existing Member derives exactly as before.
- **R15.3** **Precedence** for Member m on date d, highest first:
  1. m's Personal Assignment on d (R14.2);
  2. m's schedule source on d:
     - team rotation: m is on the effective Team's base roster, whose Scheduled Shift is the projection, then holidays (R13), then Shift Type Overrides;
     - personal rotation: m's own projected Shift Type, a working one being a **Personal Shift** that counts with m's effective Team (R14.3, R14.6);
     - manual only: nothing;
  3. Roster Overrides on top (R14.2).

  A Member on a personal rotation or manual only is on no Team's base roster. They stay in their Team for grouping, the directory, Loans and staffing groups.
- **R15.4** A Team's Shift Type Override does not change a personal rotation's shift. A Holiday removes a personal rotation's projected shift when it counts with a Team off on holidays (R13.2), as it removes that Team's own. A Personal Assignment wins over both.
- **R15.5** A Rotation Pattern may be used by Teams and by Members alike. Editing a pattern follows R1 and AD-2 for every user of it.
- **R15.6** With no schedule-source version in an Organization, every derivation is byte-identical to what it was before.
- **R15.7** Worked example. Day worker W is in Team D, which has no Rotation. From the 2nd, W has a personal rotation on the pattern [1. smjena ×5, Slobodno ×2, 2. smjena ×5, Slobodno ×2] at step 1. W works mornings in weeks one and three and afternoons in weeks two and four, all counted with D. A Personal Assignment of a day off on the 10th makes that date free, and the 11th follows the pattern again. A 24-hour Team's Member set to manual only leaves that Team's base roster from their effective date, and has only what is assigned to them.
- **R15.8** *(Added 2026-11-25, story 21.9: the domain's decisions.)*
  - A personal rotation's offset step is the step the Member stands on at the version's effective date: the version is its own anchor.
  - A working step of an active Member is a Personal Shift of that type, with that type's times in effect on the date (R12.1). It counts with the Member's effective Team, or with no Team when they have none (R14.3, R14.9). Like an assignment's shift, it has no projected Shift Type, and no Shift Type Override changes it. A non-working step is a day off. An inactive date has no shift.
  - A Roster Override that puts a Member on the Team their personal rotation counts with is inert on every date of that source, whatever the step. Their days with that Team are their rotation's, and a Personal Assignment changes one (R15.3, step 1). This mirrors R14.9. An override putting them on another Team applies, as a double booking. One taking them off a base roster they are not on is inert (R14.2). A Member on manual only counts with no Team, so an override putting them on a shift applies.
  - In staffing, a personal rotation's shifts join R14.6's groups as an assignment's do. A shift of the Scheduled Shift's type is counted on it.

## 16. Job roles and floaters (added 2026-11-25, sprint-change-proposal-2026-11-25-pilot-readiness; implemented by stories 21.12, 21.13 and 21.14)

- **R16.0** A **Job Role** is Organization data, a name such as a cleaner, a dispatcher or a seasonal worker. A Member has at most one, as a current-state setting. Like Fire Rank (FR-18a) it is descriptive. It changes no derivation, and is shown and filtered on. How a Member's work alternates is their schedule source (R15), chosen per person, never by their role.

- **R16.1** A Member is a **floater** or not. This is a current-state Member setting, off by default, and it holds the Job Roles the floater may cover. It changes no derivation: it only decides who is suggested. A floater is **eligible** for an absent Member when the absent Member has no Job Role, or when the floater lists the absent Member's role. So a role no floater lists, cleaners for example, gets no suggestion.
- **R16.2** For an unresolved Conflict on date d (R6.1), the suggested floaters are the floaters eligible for the absent Member (R16.1), other than that Member, who on d:
  - are active;
  - have no at-work shift (R12, Personal Shifts included);
  - have no Leave Record of any Absence Type;
  - have no shift on d−1 or d+1 whose interval leaves a Rest Gap of zero with the uncovered shift (R5).

  They are ordered by fewest at-work shifts in the month so far, then by name. The domain returns ids and counts (AD-8).
- **R16.3** Picking a floater resolves the Conflict as Replace Member through a Personal Assignment. The floater gets the uncovered shift's Shift Type on d, counted with the Conflict's Team. The resolution references that assignment, and it matches only while the assignment is live (as a Roster Override's does, AD-4).
- **R16.4** Covering a whole Leave Record is the same resolution, made once for each of its unresolved Conflicts, in one save. A date on which the chosen floater is not free is listed and left unresolved, never forced.
- **R16.5** **Seasonal Members** are ordinary Members whose active status (R7, versioned) covers only their season. They are scheduled within it through the grid or a personal rotation (R15). Outside it they are on no roster, have no Personal Shift and are never suggested. Story 21.11 lets an Admin set a season's start and end in one step: today a Member's status allows only one scheduled change at a time.
