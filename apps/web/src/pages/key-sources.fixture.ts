import {
  ABSENCE_TYPE_LIST_KEYS,
  ABSENCE_TYPE_WRITE_KEYS,
  ACCENT_KEYS,
  JOB_ROLE_LIST_KEYS,
  JOB_ROLE_WRITE_KEYS,
  HOLIDAY_CHECK_BODY,
  HOLIDAY_KEYS,
  AUTH_LAYOUT,
  CALENDAR_EMPTY_DAY_KEYS,
  CALENDAR_DAY_DETAIL_KEYS,
  CALENDAR_MODIFIER_KEYS,
  CALENDAR_OVERRIDE_WRITE_KEYS,
  CALENDAR_ROSTER_WRITE_KEYS,
  CALENDAR_SNAPSHOT_KEYS,
  CHROME,
  CREDENTIAL_COPY_KEYS,
  DANAS,
  DESTINATION_COPY_KEYS,
  DESTINATION_SCREENS,
  EMAIL_NOTIFICATIONS_KEYS,
  ERROR_SCREEN,
  FILTER_BAR_KEYS,
  GODISNJI,
  POVIJEST_PROMJENA,
  RUCNI_RASPORED,
  RUCNI_RASPORED_KEYS,
  LEAVE_REQUEST,
  HOUR_BAND_EDIT,
  HOUR_BAND_LIST,
  HOUR_BAND_LIST_KEYS,
  HOUR_BAND_WRITE_KEYS,
  HOURS_EXPLANATION_KEYS,
  LOAN_MARKS_KEYS,
  HOURS_EXPORT_KEYS,
  HISTORY_EXPORT_KEYS,
  HISTORY_ROWS_KEYS,
  HOURS_KEYS,
  KALENDAR,
  LEAVE_OVERVIEW_KEYS,
  LEAVE_SECTION_KEYS,
  LOCKUP,
  MEMBER_CREATE,
  MEMBER_DIRECTORY,
  MEMBER_EDIT,
  MEMBER_FACTS_KEYS,
  MEMBER_LIST,
  MEMBER_LIST_KEYS,
  MEMBER_MOVE_PREVIEW_KEYS,
  MEMBER_LOAN_KEYS,
  MEMBER_SCHEDULE_SOURCE_KEYS,
  STAFFING_BLOCK,
  MEMBER_WRITE_KEYS,
  memberListKeys,
  memberWriteKeys,
  MESSAGE_KEYS,
  messageKeyUnion,
  messageKeyUnions,
  LEAVE_REQUEST_LIST_KEYS,
  MY_LEAVE_KEYS,
  NAVIGATION_MESSAGE_KEYS,
  NOT_FOUND,
  NOTIFICATIONS,
  NOTIFICATIONS_KEYS,
  ONBOARDING,
  ONBOARDING_LINK_KEYS,
  ONBOARDING_PROGRESS_KEYS,
  ONBOARDING_STEP_KEYS,
  CALENDAR_FEED,
  CALENDAR_FEED_COPY_KEYS,
  CALENDAR_FEED_DOWNLOAD_KEYS,
  CALENDAR_FEED_KEYS,
  MEMBER_FEED_CARD,
  ORGANIZATION_HOURS_KEYS,
  PUSH_KEYS,
  REMINDER_KEYS,
  ORGANIZATION_MESSAGE_KEYS,
  POSITION_KEYS,
  RANK_KEYS,
  ZA_ODLUKU,
  REPLACEMENT_CANDIDATE_KEYS,
  RESOLUTION,
  RESOLUTION_SCREEN_KEYS,
  RESOLUTION_WRITE_KEYS,
  LEAVE_REQUEST_REVIEW,
  LEAVE_REQUEST_REVIEW_KEYS,
  SWAP_PROPOSAL,
  SWAP_PROPOSAL_KEYS,
  MY_SWAPS_KEYS,
  SWAP_DECISION,
  SWAP_DECISION_KEYS,
  ROTATION_DISPOSITION_KEYS,
  ROTATION_HISTORY_DIALOG,
  ROTATION_HISTORY_KEYS,
  ROTATION_LIST_KEYS,
  ROTATION_OVERRIDE_REVIEW,
  ROTATION_SECTION,
  ROTATION_STEPPER_KEYS,
  ROTATION_WARNING_KEYS,
  ROTATION_WRITE_KEYS,
  SATI,
  SCREEN,
  SET_PASSWORD_KEYS,
  SET_PASSWORD_SCREEN,
  SIGNUP_KEYS,
  SIGNUP_SCREEN,
  CREATE_ORGANIZATION_KEYS,
  SETTINGS,
  SHIFT_TYPE_EDIT,
  SHIFT_TYPE_LIST,
  SHIFT_TYPE_LIST_KEYS,
  SHIFT_TYPE_WRITE_KEYS,
  TEAM_EDIT,
  TEAM_LIST,
  TEAM_LIST_KEYS,
  TEAM_ROSTER,
  TEAM_ROSTER_KEYS,
  TEAM_WRITE_KEYS,
  TODAY_ADMIN_KEYS,
  TODAY_DUTY_KEYS,
  TODAY_KEYS,
  translationKeys,
  UPDATE_NOTICE,
  OFFLINE_NOTE,
  OFFLINE_WRITE_NOTE,
} from './source-guards.fixture';

// `KEY_SOURCES`, shared by the source guards in this folder: every module that can put
// a key on screen, with the reader that finds its keys and the count it is held to.

/**
 * Every source that contributes a key, with the reader that finds them in it.
 *
 * The reader is named per entry rather than assumed, because they are not the
 * same shape: a screen renders `t('key')`, and the message mapping declares its
 * keys as a return-type union in a `.ts` module that renders nothing. Both are
 * "a key this application can put on screen", and the set comparison below is
 * only true if both are read.
 */
export const KEY_SOURCES = [
  // SIXTEEN SINCE STORY 7.7, counted per call: the heading; the organization
  // label (twice: the field's `<Label>` and the URL slug row's), `remembered`,
  // `hint`, `placeholder`, `change` and `changeLabel`; the username and password labels; the
  // toggle's `passwordShow`; `submit` and `pending`; and the disclosure's
  // `trigger`, `heading` and `body`.
  // TWENTY-TWO SINCE RETRO 10 A5: the other-organization offer's heading,
  // body, switch, pending, stay and refusal.
  // THIRTY-EIGHT SINCE STORY 19.2: the email path's hint, refusal panel,
  // recovery path and the way to `/registracija`.
  { name: 'the sign-in screen', file: SCREEN, keys: translationKeys, strings: 38 },
  // STORY 7.8. ELEVEN on the set-password step: the heading and the lede; the
  // two field labels and the toggle's `passwordShow`; the two live checks;
  // `submit` and `pending`; `Odjava` and the sign-out refusal. The checks'
  // met / not-yet words and the save's refusals come through the next entry.
  { name: 'the set-password screen', file: SET_PASSWORD_SCREEN, keys: translationKeys, strings: 11 },
  // EIGHT over two unions: the six failures (`setPasswordMessageKey`) — the
  // sixth, `signInAgain`, from the 7.8 review: a refused token after the
  // password landed — and the live checks' two states in words
  // (`ruleStateMessageKey`).
  { name: 'the set-password rules', file: SET_PASSWORD_KEYS, keys: messageKeyUnions, strings: 8 },
  // STORY 19.2: the signup screens, and their rules' message unions.
  // EIGHTY-EIGHT SINCE STORY 19.3: step 1's form and frame, and the signup link's password form.
  // NINETY SINCE STORY 19.4 (D10): the resend's name written once more, and its wait.
  { name: 'the signup screens', file: SIGNUP_SCREEN, keys: translationKeys, strings: 90 },
  { name: 'the signup rules', file: SIGNUP_KEYS, keys: messageKeyUnions, strings: 10 },
  // STORY 19.3: step 1's rules, seven local refusals, three failures, and the two notices after an answer (review of 19.3).
  { name: 'the create-organization rules', file: CREATE_ORGANIZATION_KEYS, keys: messageKeyUnions, strings: 12 },
  { name: 'the not-found component', file: NOT_FOUND, keys: translationKeys, strings: 2 },
  // A148. THREE on the error screen: the heading, the lede and the retry.
  { name: 'the error screen', file: ERROR_SCREEN, keys: translationKeys, strings: 3 },
  // STORY 8.1. TWO on the update notice: the message and *Osvježi*.
  { name: 'the update notice', file: UPDATE_NOTICE, keys: translationKeys, strings: 2 },
  // STORY 8.2. ONE on the as-of note: *Bez veze · stanje od …*.
  { name: 'the as-of note', file: OFFLINE_NOTE, keys: translationKeys, strings: 1 },
  // STORY 8.3a. TWO on the offline write note: the save's and the sign-in's.
  { name: 'the offline write note', file: OFFLINE_WRITE_NOTE, keys: translationKeys, strings: 2 },
  // THREE on the sign-in frame (visual refresh A; glass since story 15.3): the
  // brand panel's product name, headline and subline, written once and
  // rendered around both steps, so neither step's own count moved.
  { name: 'the sign-in frame', file: AUTH_LAYOUT, keys: translationKeys, strings: 3 },
  // STORY 19.2: the email refusal and the unconfirmed address joined the two.
  { name: 'the failure-to-message mapping', file: MESSAGE_KEYS, keys: messageKeyUnion, strings: 4 },
  // TWELVE on the settings surface: its own `nav.organizacija` heading, five
  // field labels, the save and cancel actions, the logo's own label, the choose
  // action — rendered TWICE, once as the button's text and once as the hidden
  // file input's `aria-label`, because the two controls are one affordance and
  // a screen reader must hear the same word the eye sees — and
  // `nav.organizacija` a second time, as the neutral mark's accessible name for
  // the unreachable case where the organization's own name is blank. The set
  // comparison below dedupes, so twelve `t()` calls over ten keys is correct
  // rather than a count that drifted.
  //
  // The refusal is NOT among them — it reaches `t()` through
  // `organizationMessageKey`, which is the next entry, for the reason the
  // sign-in refusals do: a ternary over codes written in a `.tsx` is executed
  // by nothing.
  // TWELVE on the settings surface, and it is the same number for a different
  // reason since story 1.4c. The logo's `<img>` and neutral mark moved into the
  // shared lockup, taking the mark's borrowed `nav.organizacija` fallback with
  // them; the accent control's own label arrived in its place. Its five OPTION
  // names are not here — they reach `t()` through `accentMessageKey`, which is
  // the entry below, for the reason every refusal on this screen does: a lookup
  // written in a `.tsx` is executed by nothing.
  //
  // So: `nav.organizacija` as the heading, five field labels, the accent label,
  // the save and cancel actions, the logo's own label, and the choose action
  // rendered TWICE — once as the button's text and once as the hidden file
  // input's `aria-label`, because the two controls are one affordance and a
  // screen reader must hear the word the eye sees. The set comparison below
  // dedupes, so twelve calls over eleven keys is correct rather than drift.
  //
  // THIRTEEN SINCE STORY 2.1b: the link to the hour band editor, which renders
  // that screen's own heading as its text.
  //
  // FOURTEEN SINCE MEMBER RANK: the fire-rank setting's label. Its two option
  // names and its status line reach `t()` through `fireRanksMessageKey`.
  //
  // EIGHTEEN SINCE DESIGN REFRESH C: the lede, the logo's accepted formats,
  // and the aside's title and body.
  // NINETEEN since the settings fix: the read's retry reuses `shell.retry`.
  //
  // FORTY-EIGHT SINCE STORY 7.18, the page of facts with a dialog per change.
  // The page: its heading, lede and the hour band link. The read's retry.
  // The shared dialog: its close, cancel and save. *Profil*: its heading, the
  // saved line, the shared `Promijeni`, and per row a label and a change name
  // (the name, the logo and the accent), the logo's two facts in words, and
  // the name dialog's title and label (keys written a second time). The logo
  // dialog: title, hint, the choose action twice (button and file input, one
  // affordance), and the chosen file. The accent dialog: title, label, the
  // UX-DR5 rule and the line when nothing is chosen. *Vrijeme i godina*: its
  // heading, `Uredi` and its name, the saved line, the zone's label, its
  // locked word, the leave year's label and value, the reason, and the
  // dialog's title and two labels. The fire-rank card: heading, `Uredi` and
  // its name, the use label, and the dialog's title, label and hint. The
  // option names, the accent's stored label and the fire-rank status line
  // reach `t()` through their `MessageKey` modules. The aside left the page:
  // its title and body went with it.
  //
  // FIFTY-SEVEN SINCE THE DEFERRED 7.18 WORK: the leave dialog's current
  // leave year, and the *Satni pojasi* card — its heading (the header link's
  // key written a second time), `Otvori` and its name, the bands' label, the
  // count and its value with the names, and the coverage's label and value.
  //
  // FIFTY-EIGHT SINCE C500: the skeleton's loading words, visually hidden.
  // SIXTY-FIVE SINCE STORY 10.3: the email-notifications card's heading and
  // dialog title, `Uredi` and its name, the fact's label (twice: the fact and
  // the dialog's group) and the hint. Its two option names and its status
  // line reach `t()` through `emailNotificationsMessageKey` and
  // `emailNotificationsStatusMessageKey`.
  // SEVENTY-FIVE SINCE STORY 11.1: the minimum-members card's heading and
  // dialog title, `Uredi` and its name, the fact's label (twice: the fact and
  // the field's label), not set, the hint, and the two saved lines.
  // EIGHTY-EIGHT SINCE STORY 13.1b: the *Vrste odsutnosti* card's heading,
  // `Dodaj` and its name, `Uredi` and its name, the dialog's two titles, its
  // close, the name's label, the drawing choice's label, annual leave's hint,
  // Odustani and Spremi. What a row says about drawing, the refusals and the
  // confirmations reach `t()` through the absence type modules.
  // STORY 13.2b: the edit dialog's line on what changing a type's flag does.
  // ONE HUNDRED AND SEVEN SINCE STORY 13.4: the *Prijenos godišnjeg* card's
  // heading, `Uredi` and its name, the fact's label, the fact or none, the two
  // saved lines, the dialog title, the cap's label and hint, the expiry's
  // group label, its day and month labels and their empty choices, and the
  // first year's label and hint.
  // A HUNDRED AND FIFTY-NINE SINCE STORY 21.17: *Blagdani* — its heading, the
  // year and its two steps, `Dodaj blagdan`, the import and its nothing-new
  // and before-2020 lines, the empty year, a row's date, `Preimenuj` and
  // `Ukloni` with their names, the dialog's two titles, close, date, name,
  // past-date warning, Odustani, Dalje and Spremi, the unavailable read, the
  // preview's title, three ledes, *Natrag* and three saves, and the official
  // names through the hook (`nationalHolidayMessageKey`). A HUNDRED AND SIXTY:
  // the read's retry is the shared `shell.retry`, and the preview's changed line.
  { name: 'the organization settings surface', file: SETTINGS, keys: translationKeys, strings: 160 },
  {
    // EIGHT on the member list since story 1.5b, up from five, and the number is
    // still small because most of what this screen says is read off a table
    // rather than written into the markup.
    // Its own `nav.ljudi` heading, the search field's label, the level filter's
    // label — which is the COLUMN's key `ljudi.role` rendered a second time,
    // because the control filters exactly what that column shows and two words
    // for one thing is two things to a reader — the table's caption, and the
    // stated row count.
    //
    // The four column headings are NOT among them, and neither are the three
    // filter options, the two level labels or the two refusals: every one of
    // those reaches `t()` through `@/features/members/services/list`, which is the entry below.
    // A lookup written in a `.tsx` is executed by nothing (AD-15), and the 1.5a
    // review shipped two swapped sort keys green for exactly that reason.
    // The three that arrived are the add action, the actions column's own
    // heading — a `<th>` with no text is announced as nothing at all — and the
    // row action, whose name INTERPOLATES the member it acts on because four
    // hundred rows announcing the same three words is four hundred controls a
    // screen-reader user cannot tell apart.
    //
    // TEN SINCE STORY 1.6: the inactive marker, which INTERPOLATES the name it
    // sits beside, and the scheduled-deactivation marker, which interpolates
    // the date as well. Whether a member is inactive today or scheduled out is
    // `@/features/members/services/list`'s decision, as at the organization's today; the screen
    // only renders the kind of cell the column produced.
    //
    // ELEVEN SINCE STORY 1.7a: the link to the teams screen, which renders
    // `smjene.heading`, the teams screen's own heading, as its text.
    //
    // TWELVE SINCE STORY 1.7b: `smjene.membership.none`, the team cell's
    // positive words for a member on no team today.
    //
    // ELEVEN SINCE VISUAL REFRESH B: the two marker keys LEFT for
    // `@/features/members/services/list` (`memberStatusMessageKey`, counted there), where their
    // pairing to a cell is executed, and `ljudi.status.separator` arrived: the
    // visually hidden separator read between a name and its marker badge.
    //
    // THIRTEEN SINCE THE TEAM FILTER: its label, which is the team COLUMN's
    // key `smjene.membership.column` rendered a second time for the reason
    // `ljudi.role` is, and the reset. The three team options reach `t()`
    // through `teamFilterMessageKey`, counted with the rules below.
    //
    // FOURTEEN SINCE DESIGN REFRESH C: the lede.
    //
    // TWENTY-FOUR SINCE STORY 7.6: the stacked rows' caption (the list's
    // name), the edit-link name and the status separator again (three), the
    // allowance's unit beside its figure (`cellUnit`), and the shared sort
    // control's six — `Poredano:`, its accessible name with the direction,
    // the two directions, the sorted option's name with its direction and
    // the picker's name. The rows' field labels are the columns' own keys,
    // `t(column.label)`, counted with the rules.
    //
    // THIRTY-EIGHT SINCE STORY 7.13: the two selects' labels, the count and
    // the reset left with the selects; the three chips arrived — Razina's
    // text, value, ✕, picker and sheet heading, Smjena's (the shared
    // `filter.*` keys) with `Bez smjene` and the pending name, Status's text,
    // ✕, picker and heading — with each option's person count and the
    // summary line's message. FORTY-ONE with the option-chip bar's own part,
    // read with the member list: `Filtri`, its count, and the bar's label.
    //
    // FORTY-THREE SINCE STORY 7.17: the page renders the directory's title —
    // `nav.ljudi` a second time — and its lede. The directory's own words are
    // its set's, below.
    //
    // FORTY-TWO SINCE STORY 15.7: `Filtri` and its count moved into the shared
    // summary card (`@/components/filter-bar`, counted in the Kalendar set),
    // and the option bar's own part gained its pickers' search label.
    name: 'the member list',
    file: MEMBER_LIST,
    keys: translationKeys,
    // STORY 19.4: the one-person line (ljudi.alone).
    strings: 51,
  },
  {
    // STORY 1.7a. EIGHT on the team list: its heading, the link back
    // (`nav.ljudi`, the destination it returns to), the name label, the add
    // action, the created confirmation, the active group's heading and count,
    // and the archived group's count, which IS its heading. Both counts are ICU
    // plurals and are rendered at zero. The row action (edit or view) and the
    // refusals reach `t()` through the two `@/features/teams` modules.
    //
    // FIFTEEN SINCE DESIGN REFRESH C: the lede, the add dialog's open button,
    // heading, close and cancel, and the table's heads (the name label again,
    // and actions).
    // SIXTEEN SINCE THE STACKED ROWS (UX-DR17): the name label once more, on
    // the phone's stacked row.
    name: 'the team list',
    file: TEAM_LIST,
    keys: translationKeys,
    // STORY 19.4: the empty state's fact and consequence.
    strings: 18,
  },
  {
    // EIGHT on one team: the name label, Save, the archive offer, prompt,
    // confirm and cancel, the note an archived team carries instead of
    // controls, and the link back. The heading (edit or view) and the saved
    // confirmation (renamed or archived) are chosen in `@/features/teams`, below.
    //
    // NINE SINCE DESIGN REFRESH C, as a dialog: its close replaced the link
    // back, and the archive offer shows a short word beside its whole name.
    // TWENTY-TWO SINCE STORY 21.17: *Ne radi na blagdane* — the switch's
    // label and hint, an archived team's two read-only lines, the two saved
    // lines, and its *Što se mijenja*: title, two ledes, the no-holiday line,
    // *Natrag* and *Spremi* (the erasure dialog's save is the same word).
    // TWENTY-THREE with the preview's changed line.
    name: 'the team edit form',
    file: TEAM_EDIT,
    keys: translationKeys,
    strings: 23,
  },
  {
    // FIVE over three unions, so read by `memberListKeys`, which reads every
    // union rather than the first: the row action (edit, or view for an
    // archived team), the one-team heading by the same rule, and the read
    // failure. Zero rows is an answer here, not a refusal. SIX SINCE THE
    // DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the team list rules',
    file: TEAM_LIST_KEYS,
    keys: memberListKeys,
    strings: 6,
  },
  {
    // NINE over two unions: seven refusals — the empty name, the taken name,
    // the stale screen, the outright refusal, another invalid value, the
    // service, and a team the list lacks — and the two confirmations, a rename
    // and an archive, which are different sentences on purpose.
    //
    // TEN SINCE STORY 1.7b: the in-use refusal, an archive of a team somebody
    // is on today or is scheduled onto.
    //
    // ELEVEN SINCE 0036: a name over the maximum. (0036's archive of a team
    // in a rotation was withdrawn by 0037.)
    //
    // TWELVE SINCE STORY 18.4: 0064's archive refusal while a loan to the team
    // is current (`smjene.error.lentTo`).
    //
    // THIRTEEN SINCE 0076: a name carrying a control character
    // (`smjene.error.control`).
    name: 'the team write rules',
    file: TEAM_WRITE_KEYS,
    keys: memberListKeys,
    strings: 13,
  },
  {
    // STORY 1.8. FOUR on the roster: the heading while there is no roster to
    // name, the archived note, the ICU plural count, and the link back. The
    // team's name and the members' names are data.
    //
    // FIVE SINCE MEMBER RANK: the name-and-rank line. The rank's own words
    // reach `t()` through `rankMessageKey`.
    //
    // FOUR SINCE TEAM POSITION: the name-and-rank line moved, with the two
    // lines carrying a position, into `@/features/members/utils/position`'s
    // `rosterLineMessageKey`, where a node test executes the choice.
    name: 'the team roster',
    file: TEAM_ROSTER,
    keys: translationKeys,
    strings: 4,
  },
  {
    // STORY 7.17. NINE on the member directory: the search's label and its
    // placeholder, *tvoja smjena*, the count (the roster's own plural), the
    // unavailable notice and its retry, the no-hit line and *Poništi
    // pretragu*, and the no-team line. The names, the teams' names and the
    // rank and position words are data or the roster lines'.
    name: 'the member directory',
    file: MEMBER_DIRECTORY,
    keys: translationKeys,
    strings: 9,
  },
  {
    // ONE on Danas: its own `nav.danas` heading. The line's words and its
    // refusal reach `t()` through `@/features/teams/services/roster`, below.
    //
    // FIFTEEN SINCE STORY 6.1a: the date subline (on the page and under the
    // next shift's date), the retry, the no-rotation and no-shift words, the
    // leave's range, the next shift's plain title and its none sentence, the
    // `count.days` beside both, the week's heading and its link, and the
    // leave word. The cases, the headings and the two lines come through
    // `@/features/today/services/today`, below.
    //
    // TWENTY-FOUR SINCE STORY 6.1b: the leave's cost sentence and its
    // `count.days`; the hours tile's kicker, one band's hours, the separator
    // between bands and *Sati*'s conflict line; the leave tile's kicker, its
    // balance through `count.days` and its hint. Each tile's unavailable
    // sentence is its detail view's own, through `hoursMessageKey` and
    // `myLeaveMessageKey`.
    //
    // TWENTY-SEVEN SINCE STORY 6.2: the duty-block's kicker with the total,
    // its progress (the bar's valuetext and the line under it, written once)
    // and one end of the span (written once, for both ends). Its headline,
    // end line, leg states and notes come through
    // `@/features/today/services/today-duty`, below; each duration is
    // `durationMessageKey`'s.
    //
    // FIFTY-EIGHT SINCE STORY 6.3, thirty-one more: the admin's subtitle
    // (five: the date line again for an admin before their case answers,
    // the subtitle, its separator twice — between shifts and before the team
    // link — and the no-rotation word); *Treba tebe*'s heading, count
    // (`zaOdluku.count`), calm and past lines, a row's date and the action
    // (six); the coverage's heading, members (a plural), full shift, none,
    // off line with its list separator, and link (seven); the absences'
    // heading, none and link (three); the week's heading, region, team
    // column, no-rotation word, legend and its two entries, and link
    // (eight); the admin unavailable line and its retry (two).
    //
    // FIFTY-NINE SINCE THE STORY 6.3 REVIEW: the teams with no rotation
    // today, with a second list separator (two more); the full shift's mark
    // moved into `coverageStaffingMessageKey`'s union, below (one fewer). The
    // status, badges, phases, absent lines and cell names come through
    // `@/features/today/services/admin-today`, below.
    //
    // SIXTY SINCE THE LONE-NOĆ CARRY-OVER: a shift from yesterday still
    // running is marked `od jučer` on its row (one more).
    //
    // FIFTY-EIGHT SINCE B449: an empty day of the week and the today card's
    // no-shift line say inactive or no team through `dayEmptyMessageKey`,
    // counted in the calendar's `empty-day` (two fewer).
    //
    // SIXTY-TWO SINCE STORY 9.5: *Treba tebe*'s rows name their kind
    // (*Odsutnost u smjeni*, *Zahtjev za odsutnost*), and a pending
    // request's row its range and its member or the words for one who is gone.
    //
    // SIXTY-FOUR SINCE STORY 11.3: *Ovaj tjedan*'s short-staffed cell adds
    // `premalo ljudi` to its name, and the legend lists the mark.
    //
    // SEVENTY SINCE STORY 11.4: *Premalo ljudi*'s heading, count, calm line
    // with the minimum, a row, `i još {n}` and its link to the calendar. A
    // row's people at work are the short-staffed block's `popunjenost.atWork`.
    //
    // NINETY-THREE SINCE STORY 12.3: *Zamjene* — its heading; a row's shift,
    // its colleague line from either side and its return shift from either
    // side, an unknown colleague; *Datum je prošao* and the stale line; the
    // addressee's consequence in the proposal preview's words (its heading,
    // both "who works" lines, the hours line, no change, the signed delta
    // less or more, and the leave note); *Prihvati*, *Odbij* and *Povuci*,
    // each with its accessible name. The status words and the outcome lines
    // come through `@/features/swaps/services/my-swaps`, a key source.
    // NINETY-FIVE SINCE THE 12.3 REVIEW: the stale line for a row that can
    // only be withdrawn, and an unknown team's words.
    // NINETY-SEVEN SINCE STORY 12.4: *Treba tebe*'s swap row — its kind
    // (*Zamjena smjene*) and the proposer → the colleague. Its shifts are the
    // queue's own `SwapShifts`, counted on *Za odluku*.
    // STORY 13.2b: the leave case's heading, naming today's type, drawn apart from the other cases'.
    // NINETY-NINE SINCE STORY 13.7: a half day's cost in its line, through
    // `count.days`. The line, its half's words and a half-day request's or
    // absence's half come through `@/features/today/services/today` and
    // `leaveRangeHalfMessageKey` (`@/features/leave/services/leave-section`).
    name: 'the Danas destination',
    file: DANAS,
    keys: translationKeys,
    // STORY 19.4: coverage with no team, its fact and its consequence.
    // 107 SINCE STORY 21.6: a Personal Shift's `ručno` and `dodijeljeno ručno` on a row and on a coverage group, `bez tima` on a row and in a duty note.
    // 109 SINCE ITS REVIEW: a duty leg's `ručno` and `dodijeljeno ručno`.
    // 114 SINCE STORY 21.18: the holiday's calls — the shared mark's `blagdan {name}` and an emptied shift's `blagdan` (`holiday-mark.tsx`), and the admin week's head and cell label `blagdan {name}`, an emptied cell's `blagdan`, and its legend's word and key line.
    // 115 SINCE STORY 21.7: a teamless conflict's `bez tima` in *Treba tebe*.
    strings: 115,
  },
  {
    // STORY 6.1a: today's three cases, the next shift's two headings, and
    // the two lines in place of a case (unavailable, unscheduled).
    // ELEVEN SINCE STORY 13.7: a half day's line, with and without its cost,
    // off `todayHalfLineMessageKey`, and the absent half's two words, off
    // `todayHalfMessageKey`.
    name: 'the Danas rules',
    file: TODAY_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 6.2: the duty's two headlines, its two end lines, the three leg
    // states and the three notes.
    name: 'the Danas duty rules',
    file: TODAY_DUTY_KEYS,
    keys: messageKeyUnions,
    strings: 10,
  },
  {
    // STORY 6.3: the subtitle's four statuses and its working shift with or
    // without times; a row's two badges and its shift with or without times;
    // the three phases, the three absent states and a coverage row's shift
    // with or without times; an absence's line and tomorrow's, each with or
    // without a team; and a week cell's four names.
    //
    // THIRTY-TWO SINCE THE STORY 6.3 REVIEW: a one-day absence's line and
    // tomorrow's, each with or without a team (four), and a working team's
    // staffing, full or nobody rostered (two).
    //
    // THIRTY-THREE SINCE E897: a working shift carried over from yesterday,
    // marked `od jučer` in the subtitle as on the member's card.
    name: 'the Danas admin rules',
    file: TODAY_ADMIN_KEYS,
    keys: messageKeyUnions,
    strings: 33,
  },
  {
    // FOUR over two unions: the roster's two refusals (unknown, and the
    // service) and the Danas line's two openings (the team label, or no
    // team). The own-row read's refusal left with Danas's own read (E804).
    name: 'the team roster rules',
    file: TEAM_ROSTER_KEYS,
    keys: memberListKeys,
    strings: 4,
  },
  {
    // STORY 2.1b. THIRTEEN on the band list: its heading, the link back
    // (`nav.organizacija`), the name and start labels, the add action, the
    // created confirmation, the ICU count, the row action, the window and
    // duration labels, the midnight flag, the coverage sentence, and the bar's
    // uncovered flag. Every figure is data from `@/features/hour-bands/services/list`; the
    // duration's shape and the refusals reach `t()` through the two modules.
    //
    // TWENTY-SEVEN SINCE DESIGN REFRESH C. The coverage sentence became two stat
    // tiles (the covered label and value; the uncovered label, a second use of
    // the flag's key), and the page gained its lede, the explainer's title and
    // body, the dialog's open button, heading, close and cancel, the list and
    // timeline headings, and the table's column heads (the name label again,
    // from, to, the duration label and actions). THIRTY-TWO with the add
    // dialog's computed end: its label, its pending text, the hint, and the
    // preview's duration label and midnight flag.
    // THIRTY-SIX SINCE THE STACKED ROWS (UX-DR17): the phone's row labels its
    // name, from, to and duration fields with the column heads' keys again.
    name: 'the hour band list',
    file: HOUR_BAND_LIST,
    keys: translationKeys,
    // STORY 19.4: the empty state's fact and what the first band does.
    strings: 38,
  },
  {
    // TWELVE on one band: its heading, the two field labels, Save, the window
    // and duration labels, the midnight flag, the removal offer, prompt,
    // confirm and cancel, and the link back. FIFTEEN SINCE DESIGN REFRESH C,
    // as a dialog: the window label gave way to the computed end's label,
    // pending text and hint, the dialog's close replaced the link back, and
    // the removal offer shows a short word beside its whole accessible name.
    name: 'the hour band edit form',
    file: HOUR_BAND_EDIT,
    keys: translationKeys,
    strings: 15,
  },
  {
    // FOUR over two unions: the duration's three shapes and the read failure.
    // FIVE SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the hour band list rules',
    file: HOUR_BAND_LIST_KEYS,
    keys: memberListKeys,
    strings: 5,
  },
  {
    // ELEVEN over two unions: nine refusals — the blank name, the taken name,
    // the taken start, the invalid start, the stale screen, the outright
    // refusal, another invalid value, the service, and a band the list lacks —
    // and the two confirmations, an edit and a removal.
    //
    // TWELVE SINCE 0036: a name over the maximum.
    name: 'the hour band write rules',
    file: HOUR_BAND_WRITE_KEYS,
    keys: memberListKeys,
    strings: 12,
  },
  {
    // STORY 2.2b. On the shift type list: the destination's own heading, the
    // section heading, the four field labels, the add action, the ICU count, the archived heading, the row action, and
    // what a row says — the non-working pill, the no-times line, the times and
    // duration labels, the midnight flag and the scheduled correction. The
    // kind options, the duration's shape and the refusals reach `t()` through
    // the two modules.
    //
    // TWENTY-FIVE SINCE DESIGN REFRESH C: the lede, the add dialog's open
    // button, heading, close and cancel, the table's column heads (name, kind,
    // the times label again, the duration label, actions), the working pill
    // beside the non-working one; the section heading became the card's.
    // TWENTY-TWO SINCE THE OWNER LAYOUT (story 2.3b): the kind column's
    // head and its two pills are gone; a non-working type reads as a dash.
    // TWENTY-NINE SINCE STORY 7.6: the two section headings again, each
    // naming its phone list, and the stacked rows' five — the name label, the
    // times label twice (the times, and the midnight flag beside the
    // duration), the duration label and the edit link. The no-times line,
    // the scheduled correction and the midnight flag moved out of the table
    // into `shift-type-cells.tsx`, which both forms draw, so each is still
    // written once.
    name: 'the shift type list',
    file: SHIFT_TYPE_LIST,
    keys: translationKeys,
    // STORY 19.4: the kind's Odaberi and the empty state's two lines.
    strings: 32,
  },
  {
    // On one type: the facts a row says (as on the list), the name and Save,
    // the times heading, date, start and end labels, the note, the set and
    // correct actions, the cancellation, the archive offer, prompt, confirm
    // and cancel, the archived note, and the link back.
    // TWENTY-THREE SINCE DESIGN REFRESH C, as a dialog: its close replaced
    // the link back, and the archive offer shows a short word beside its
    // whole accessible name.
    name: 'the shift type edit form',
    file: SHIFT_TYPE_EDIT,
    keys: translationKeys,
    strings: 23,
  },
  {
    // The duration's three shapes, the read failure, and the two headings;
    // since the deferred-work sweep, the read failure's retry.
    name: 'the shift type list rules',
    file: SHIFT_TYPE_LIST_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // The two kinds, the thirteen refusals and the five confirmations — the
    // created one among them, rendered through `shiftTypeSavedMessageKey`.
    //
    // TWENTY-TWO SINCE 0036: a name over the maximum, and an archive of a type a
    // rotation in force or scheduled steps through.
    name: 'the shift type write rules',
    file: SHIFT_TYPE_WRITE_KEYS,
    keys: memberListKeys,
    // STORY 19.4: no kind chosen (O3).
    // 0076: a name carrying a control character
    // (`rotation.shiftTypes.error.nameControl`).
    strings: 24,
  },
  {
    // STORY 2.3b. THIRTY-SIX on the builder since the renegotiation — the
    // two move labels gone; the handle's name and role description, the
    // keyboard instructions, and the four announcements (lifted, over,
    // dropped, and cancelled from two events) added. Before it, THIRTY: the three card headings and their
    // ledes (the anchor note is the offsets card's), the empty pattern, the
    // steps' caption and position, the archived label, the three step
    // actions, the new step and its add, the three figure labels, the cycle
    // length and the unknown hours, the anchor, the three offset columns, a
    // team's step label and its options, the empty offsets note, the date
    // column, the save and its note. The hours' shape comes
    // through `shiftTypeDurationMessageKey`, counted with the shift type list
    // rules; the refusals and the confirmation through the two modules below.
    name: 'the rotation builder',
    file: ROTATION_SECTION,
    // THIRTY-SEVEN SINCE THE OWNER ADDITION: the spread action. FORTY-ONE
    // SINCE THE OWNER LAYOUT: the non-working steps figure, the callout's
    // title and body, and the day-number column head; the date column head
    // went with the transposed preview.
    // FORTY-FOUR SINCE THE CYCLES CHOICE: its label, its ICU options and
    // the cycle's name over each cycle's first day.
    // FORTY-EIGHT SINCE STORY 2.4: the stepper's progress line, the bar's
    // label, a reached step's "završeno" and Natrag. The step names and
    // Dalje's labels come through `@/features/rotation/utils/stepper`, counted below.
    // SIXTY-THREE SINCE STORY 2.6: `Vrijedi od`; the cancel's offer, prompt,
    // keep and confirm; and the history's heading, lede, empty note, five
    // column heads, save time and team count. The statuses and the unknown
    // author come through `@/features/rotation/services/history`, counted below.
    // SIXTY-FOUR SINCE STORY 3.5c: the save's confirmation counts the
    // overrides left pending. The review itself is the next entry.
    // SEVENTY-SEVEN SINCE STORY 5.5a: the erasure confirmation's title, lede,
    // row title, the row's two second lines (the team free, or working
    // without the member), the toggles' group label, the two toggles, the way
    // back, the kept hint and its own save (the builder's save key, written a
    // second time); and the refusal when the check cannot be derived, with
    // its retry.
    // SEVENTY-NINE SINCE THE 5.5a REVIEW: the line when the list changed
    // since it was decided, and the save's confirmation counting the
    // conflicts it removed.
    // NINETY-FOUR SINCE STORY 5.5g: the cancel's own erasure dialog — its
    // title, lede, changed line, row title, the row's two second lines, the
    // toggles' group label, the two toggles, the way back, the kept hint and
    // its own save (the cancel's confirm key, written a second time) — the
    // refusal inside the cancel's confirmation, with its retry, and the
    // cancel's notice counting the conflicts it removed.
    // NINETY-EIGHT SINCE STORY 5.5c: the save bar's region label, its
    // "Odbaci promjene" and its hint, with and without the rotation in force.
    // EIGHTY-EIGHT SINCE STORY 7.18: the history's ten moved to its own
    // dialog, the next entry.
    // NINETY SINCE THE STACKED OFFSETS (UX-DR17): the phone's row labels the
    // team and the anchor's type with the column heads' keys again.
    // NINETY-ONE SINCE STORY 11.2: *Što se mijenja* over the short-staffed
    // block above the save bar; the block's own words are its entry's.
    keys: translationKeys,
    strings: 91,
  },
  {
    // STORY 7.18: the history behind a header button — the button and the
    // dialog's title (the heading key, written twice), its close and lede,
    // the empty note, the five column heads, the save time and the team
    // count. The statuses and the unknown author come through
    // `@/features/rotation/services/history`.
    // SIXTEEN SINCE THE STACKED ROWS (UX-DR17): the heading is read once now
    // (eleven), and the phone's row labels its five fields with the column
    // heads' keys again.
    name: 'the rotation history',
    file: ROTATION_HISTORY_DIALOG,
    keys: translationKeys,
    strings: 16,
  },
  {
    // STORY 3.5c: the review's heading, lede and count; a row's title, type,
    // projected type or no rotation, reason, author and unknown author, and
    // its three actions; the amend's title, close, two labels, cancel, save
    // and saving; and the discard's two prompts, cancel, confirm and
    // discarding; and the review that cannot be derived. The refusals and
    // what a landed disposition says come through
    // `@/features/rotation/services/override-disposition`, below.
    // FORTY-TWO SINCE STORY 5.5h: the review's erasure confirmation — its
    // title, a confirm's and an amend's lede, changed line, row title, the
    // row's "taj dan slobodna" line, the toggles' group label, the two
    // toggles, the way back, the kept hint, and its own save, "Potvrdi
    // izmjenu" or "Spremi izmjenu" (the amend's key written a second time) —
    // the refusal when the check cannot be derived,
    // with its retry, and the landed disposition's count of the conflicts it
    // removed. The hook renders no string.
    // FIFTY SINCE 0039: a pending roster override's row — its change, said
    // as a replacement, an arrival or a removal, with an unknown member named
    // as the unknown author is — its amend's title and member field, its
    // discard's prompt, and its erasure row's "taj dan bez {member}" line.
    name: 'the rotation override review',
    file: ROTATION_OVERRIDE_REVIEW,
    keys: translationKeys,
    strings: 50,
  },
  {
    // STORY 3.5c: the six refusals of a disposition (an archived team or type
    // among them), 0035's seventh (the governing rotation version changed),
    // and the three things a landed one says — confirmed, amended, discarded.
    // 0039 adds two roster refusals: the same arriving member, and one
    // already put on by another live change.
    name: 'the rotation disposition rules',
    file: ROTATION_DISPOSITION_KEYS,
    keys: memberListKeys,
    strings: 12,
  },
  {
    // STORY 2.4: the four step names and Dalje's three labels, one per step
    // it can lead to.
    name: 'the rotation stepper rules',
    file: ROTATION_STEPPER_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // STORY 2.5: the six warning lines (gap, duplicate, and the rest gap
    // known, unknown, endless and endless unknown), the summary counting
    // them, a date's detail, and the list's and the run's separators.
    // ELEVEN: a doubled type of a duplicate date, naming its teams.
    name: 'the rotation warning rules',
    file: ROTATION_WARNING_KEYS,
    keys: memberListKeys,
    strings: 11,
  },
  {
    // STORY 2.6: the history's three statuses, in words, and the unknown author.
    // `memberListKeys`, as the warning rules use, because the module holds TWO
    // `\w*MessageKey` unions: `messageKeyUnion` reads only the first and would
    // drop the unknown author. It has no quoted `label:` entry to over-read.
    name: 'the rotation history rules',
    file: ROTATION_HISTORY_KEYS,
    keys: memberListKeys,
    strings: 4,
  },
  {
    // STORY 3.1. EIGHT on Kalendar: its own `nav.kalendar` heading, the month
    // heading, the previous and next months' names, `Ovaj mjesec`, the date
    // column head, the no-rotation label and the no-teams note. The read
    // failure comes through `@/features/calendar/services/snapshot`, below. THIRTEEN SINCE STORY
    // 3.2a: the mode switch's label and its two modes, the no-team notice and
    // a day on no team. FOURTEEN SINCE STORY 3.2b: the legend's heading. The
    // marks' labels come through `@/features/calendar/utils/modifiers`, below. EIGHTEEN SINCE
    // STORY 3.3a: the team filter's label, its all-teams option, the heading
    // over the teams and the reset. TWENTY SINCE STORY 3.3b: the heading over
    // the people and a person on no team all month. TWENTY-SIX SINCE STORY
    // 3.4b: the day detail's title, its close, the heading over its roster,
    // the empty roster, an off day and a day with no rotation. The roster's rank and
    // position labels come through `@/features/members/utils/rank` and `@/features/members/utils/position`,
    // already key sources. THIRTY-TWO SINCE STORY 3.5a: the override block's
    // heading, the projected type, the author, the unknown author, the time
    // it was saved and its reason. FORTY-TWO SINCE STORY 3.5b: the form's
    // heading, its two labels, save and saving, and the removal's action,
    // prompt, confirm, cancel and removing. The refusals come through
    // `@/features/calendar/services/override-write`, below. FORTY-NINE SINCE
    // STORY 3.5c: the pending block's heading, body and type, its reason,
    // author and unknown author, and the removal's prompt with no rotation.
    // FIFTY-NINE SINCE STORY 3.6a: the roster changes' heading and pending
    // heading, an addition, a removal and a replacement, each change's
    // author, time and reason, and the unknown member twice — named on the
    // roster and in a change.
    // SEVENTY-FOUR SINCE STORY 3.6b: the roster form's heading, its two
    // member labels, "— nitko —" twice (one per `Select`), its reason, save
    // and saving; the removal's action, prompt, confirm, cancel and removing;
    // the inert block's heading; and a member on no team. The unknown member
    // of a change line moved with the line to `roster-form.tsx` (net zero).
    // The refusals and the notices come through
    // `@/features/calendar/services/roster-write`, below.
    // SEVENTY-FIVE SINCE EPIC 4 RETRO C2: the roster form's overlap hint.
    // SEVENTY-SIX SINCE STORY 5.3c: the unavailable alert's retry. The marks'
    // labels still come through `@/features/calendar/utils/modifiers`.
    // NINETY-TWO SINCE STORY 5.5b: the roster change's erasure confirmation —
    // its title, lede, changed line, row title, the row's two second lines,
    // the toggles' group label, the two toggles, the way back and the kept
    // hint, and its own save, "Spremi promjenu" or "Ukloni" (both keys written
    // a second time) — the refusal when the check cannot be derived, with its
    // retry, and the landed write's count of the conflicts it removed.
    // NINETY-THREE SINCE THE 5.5b REVIEW: a removal's own lede and kept hint;
    // the row's "taj dan slobodna" is gone, since a roster change never makes
    // the team free.
    name: 'the Kalendar destination',
    file: KALENDAR,
    keys: translationKeys,
    // ONE HUNDRED AND TEN SINCE STORY 5.5f: the shift-type override's erasure
    // confirmation — its title, a set's and a removal's lede, the changed
    // line, row title, the row's "taj dan slobodna" line, the toggles' group
    // label, the two toggles, the way back, a set's and a removal's kept
    // hint, and its own save, "Spremi izmjenu" or "Ukloni" (both keys written
    // a second time) — the refusal when the check cannot be derived, with
    // its retry, and the landed write's count of the conflicts it removed.
    // ONE HUNDRED AND TWENTY-ONE SINCE STORY 7.4: the month toolbar's group
    // name, the trigger's name, the month heading twice more (the trigger's
    // visible text and a picker month's name, "Ožujak 2025"), "ovaj mjesec"
    // three times (the trigger's name, its label and the current picker
    // month's name), the picker's name, the year's ‹ and ›, and "ovaj" under
    // the current month.
    // ONE HUNDRED AND THIRTY-EIGHT SINCE STORY 7.5: the filter `Select`'s
    // label, its "all" option, its two group labels and its reset (five) gave
    // way to the shared filter bar's twenty-two — the bar's group name,
    // `Filtri` with and without its count, `Poništi filtre`, the two pickers'
    // names, `Sve smjene` and a team's person count (twice each: the picker
    // and the sheet), the teams' group heading, `Sve osobe`, `Bez smjene`,
    // the search's label and its match count, the sheet's title, close,
    // Smjena and Osoba headings, the note that a person replaces the team,
    // and `Poništi` and `Prikaži`. The summary, a chip's text and a ✕'s name
    // are `t()` calls here too, but over keys `@/utils/filter-bar` chooses —
    // `t(filterSummaryMessageKey(…))` — so those keys are counted in that
    // module, a key source, and not here.
    // ONE HUNDRED AND SIXTY-TWO SINCE STORY 7.9: day detail is facts, and each
    // change is its own dialog — *Izmjene*'s heading and empty sentence; the
    // conflict's heading, line and "Odluči"; the footer's two
    // openers; each dialog's close and cancel, and its description (the day,
    // or the day with its type and times); a "Dolazi" group's heading; and
    // *Što se mijenja* — its label, the type from and to (a type with its
    // times), who leaves and who arrives (or an unknown name), the hours of a
    // group of members, signed less or more, or nobody's. ONE HUNDRED AND
    // SIXTY-SEVEN SINCE ITS REVIEW: the type dialog's placeholder, a conflict
    // line without dates, an unknown member's name, the preview's side with
    // no rotation, and the notice when the day stops offering the roster form;
    // each dialog's close now names its change. ONE HUNDRED AND SIXTY-EIGHT
    // SINCE ITS CODE REVIEW: the notice when the day stops offering the type
    // form with no override on it.
    //
    // ONE HUNDRED AND SIXTY-FIVE SINCE B449: an empty day, the viewer's empty
    // month and a person's say inactive or no team through `empty-day`'s
    // unions, counted there (three fewer).
    // ONE HUNDRED AND SEVENTY-ONE SINCE THE DEFERRED-WORK SWEEP: the month
    // picker's phone sheet — its title and close (E792) — and its footer — the
    // key hint and `Ovaj mjesec` (E795); and *Moj raspored*'s sentence, with
    // the team and without (E822).
    // ONE HUNDRED AND SEVENTY-FOUR SINCE STORY 15.7: the filter bar's sheet
    // became fields with searchable pickers — `Poništi filtre` gave way to
    // `Očisti sve` and `Filtri · N` to the Badge's name, a team's person count
    // is drawn once (the picker's), and the Smjena label (the search's), the
    // option search's label, `Nema rezultata` and `Sve osobe` (the Osoba
    // field's value) arrived. ONE HUNDRED AND SEVENTY-FIVE with the Smjena
    // field's value while a person replaces the team (`Zamijenjeno osobom`).
    // ONE HUNDRED AND SEVENTY-THREE SINCE STORY 15.7b: the month control's
    // `ovaj mjesec` Badge and its `Ovaj mjesec` button off the current month
    // are gone; both keys stay, in the trigger's name and the picker footer.
    // ONE HUNDRED AND SEVENTY-FOUR SINCE STORY 11.3: the day detail's people
    // at work line, `Premalo ljudi: {atWork}` while the shift is short (the
    // figure itself is the short-staffed block's `popunjenost.atWork`).
    // ONE HUNDRED AND SEVENTY-SIX SINCE STORY 12.2: a member's *Predloži
    // zamjenu* in the day detail's footer, and the status line a landed swap
    // proposal returns to the month with. ONE HUNDRED AND SEVENTY-FIVE SINCE
    // ITS REVIEW: the line's two messages, with and without a return shift,
    // are chosen in `@/features/swaps/services/swap-proposal`, a key source.
    // ONE HUNDRED AND SEVENTY-SEVEN SINCE STORY 12.3: the footer's mark on a
    // shift the viewer already proposed, *Zamjena predložena · {kolega}*, and
    // an unknown colleague's words.
    // ONE HUNDRED AND EIGHTY-TWO SINCE STORY 18.5: the loan mark's two
    // wordings (`posudba iz tima {tim}`, `posudba, bez svog tima`) and the
    // directory's `trenutno u timu {tim}` with its hidden separator, from the
    // shared `@/components/loan-mark`, and the day detail's separator before
    // a lent member's mark.
    // ONE HUNDRED AND EIGHTY-THREE SINCE ITS REVIEW: the Osoba picker's hidden
    // separator before a lent person's mark (`@/components/filter-bar`).
    // ONE HUNDRED AND EIGHTY-EIGHT SINCE STORY 16.1: the printed month —
    // *Ispiši*, the header's title and time printed, and *Moj raspored*'s
    // filter in words with and without a team.
    // STORY 19.4: where a schedule comes from, with no team.
    // ONE HUNDRED AND NINETY-SEVEN SINCE STORY 21.23: the compact toolbar —
    // `Prikaz` and `Izvoz` with their menus' names, and the shared bar's
    // `Filtri` group, trigger and count, `Aktivni filtri` and `Primijeni`.
    // 207 SINCE STORY 21.6: the cell's `ručno`, `bez tima` and a group's `dodijeljeno ručno`, the legend's pencil, a staffing group's heading, an assigned member's `ručno` and `dodijeljeno ručno`, and the overlap hint's `bez tima`.
    // 206 SINCE ITS REVIEW: the off and no-rotation sentences moved to `dayNotWorkingMessageKey` (the day detail's rules).
    // 231 SINCE STORY 21.25 (*Kalendar kao papir*): the paper grid's calls — its corner, the teams' heading, a person's no role, no team and unreadable days (its line and its cells' names), a filter or a month that leaves nothing (twice), the key of letters, its entry, *Slobodno* with its mark, a letter box's off mark and a staffing group's `+N`, a person's cell's three words — less the date column head; and the shared filter bar's *Posao* field, picker, *Svi poslovi* (twice), *Bez posla* and the summary with a role.
    // 233 SINCE STORY 21.10: a day detail member's `osobna rotacija`, after the line's separator.
    // 240 SINCE STORY 21.18: the holiday's calls — the shared mark's `blagdan {name}` and an emptied cell's `blagdan` (`holiday-mark.tsx`), the date head's `blagdan {name}` (`date-grid.tsx`), the key's word and line, and the day detail's `{team} ne radi na blagdan.` and `Prema rotaciji: {type}.`.
    // 239 SINCE ITS REVIEW: the emptied day's sentence moved to `holidayOffMessageKey` (the day detail's rules).
    strings: 239,
  },
  {
    // STORY 12.2. On the swap proposal: its heading (twice, once while the
    // role is read), lede and back link; the given shift's label and line, a
    // type with its times; the colleague's label, placeholder and empty
    // line; the return shift's label, none, hint and option line; an option
    // a live roster key holds; the preview's prompt, blocked line, heading,
    // both "who works" lines, both hours lines, a month, no change and the
    // signed delta's duration, less or more, and the given shift's type
    // fallback; *Pošalji*, *Odustani*, the
    // unavailable alert twice with its retry twice, an unknown member, and
    // the notice for a shift that is not the viewer's. The refusals come
    // through `@/features/swaps/services/swap-proposal`, a key source.
    // THIRTY-NINE SINCE STORY 12.3: the notice for a shift the viewer already
    // proposed in an open swap, naming the colleague, or an unknown one.
    name: 'the swap proposal',
    file: SWAP_PROPOSAL,
    keys: translationKeys,
    strings: 39,
  },
  {
    // STORY 12.2: the refusals a send says, off `swapSendMessageKey` — NINE
    // since its review (no colleague, a colleague or a choice no longer
    // offered) — and the status line's two messages, off
    // `swapProposedMessageKey`.
    name: 'the swap proposal rules',
    file: SWAP_PROPOSAL_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 12.3: *Zamjene*'s eight status words (`swapWordMessageKey`), and
    // what *Prihvati*, *Odbij* and *Povuci* say when they land
    // (`swapActedMessageKey`) and when they are refused
    // (`swapActFailureMessageKey`).
    name: 'the swaps card rules',
    file: MY_SWAPS_KEYS,
    keys: messageKeyUnions,
    strings: 14,
  },
  {
    // STORY 12.4. On one swap's decision screen, through `t('…')`: the way
    // back, the heading, the missing and unavailable lines with the retry,
    // the parties, a shift and the two shifts, the preview's heading, its
    // who-works lines, each member's hours with a month, no change and the
    // signed delta's duration, less or more, the leave and double-booking
    // warnings, the preview that cannot be derived, the past and stale lines,
    // the decided line with its admin (or one no longer a member), the
    // unchecked refusal and its retry, *Odbij* and *Odobri* with the
    // approval's reason, and the erasure confirmation's words. The status
    // words and the refusals come through the rules below.
    name: 'the swap decision screen',
    file: SWAP_DECISION,
    keys: translationKeys,
    strings: 40,
  },
  {
    // STORY 12.4: the decision screen's seven status words, off
    // `swapStatusMessageKey`, and its seven refusals, off
    // `swapDecisionFailureMessageKey`.
    name: 'the swap decision rules',
    file: SWAP_DECISION_KEYS,
    keys: messageKeyUnions,
    strings: 14,
  },
  {
    // B449: what an empty day or month says — inactive, or on no team — for
    // a day, the viewer's month and a chosen person's. `memberListKeys`, for
    // the module's TWO unions.
    name: 'the calendar empty-day words',
    file: CALENDAR_EMPTY_DAY_KEYS,
    keys: memberListKeys,
    strings: 6,
  },
  {
    // STORY 3.2b: the four marks' labels and the no-rotation label a cell's
    // full label reads; story 11.3 added short-staffed's, the fifth.
    // `memberListKeys`, because the module holds TWO `\w*MessageKey` unions
    // and `messageKeyUnion` reads only the first.
    name: 'the calendar modifier vocabulary',
    file: CALENDAR_MODIFIER_KEYS,
    keys: memberListKeys,
    // 8 SINCE STORY 21.6: `dodijeljeno ručno` and `bez tima` in a label.
    // 9 SINCE STORY 21.18: `blagdan`, after the date with the holiday's name and in an emptied cell's type slot.
    strings: 9,
  },
  {
    // STORY 21.6: the day detail's sentence for an off or no-rotation day,
    // with or without a staffing group (`dayNotWorkingMessageKey`).
    name: 'the day detail rules',
    file: CALENDAR_DAY_DETAIL_KEYS,
    keys: messageKeyUnions,
    // 6 SINCE STORY 21.18'S REVIEW: a holiday-emptied day's sentence, with and without a staffing group (`holidayOffMessageKey`).
    strings: 6,
  },
  {
    // STORY 4.1b. TWELVE on Sati: its own `nav.sati` heading; the shared month
    // navigation's four (the heading, previous, current, next — counted in the
    // Kalendar set too, and deduped by the set comparison); and the summary's
    // seven — the total's and the count's labels, the shift count twice (the
    // month's and a band's), the bands' heading, the leave row and the
    // untimed note. Every hour figure reaches `t()` through
    // `@/features/hour-bands/services/list`'s `durationMessageKey`, already a
    // key source, and the failure through `@/features/hours/services/my-hours`.
    //
    // TWENTY-SIX SINCE STORY 4.2: an admin's organization table — its
    // caption, its five fixed headings (a band's is its name as stored), the
    // two filters' labels and "all" options and the no-team mark (eleven);
    // the shift count twice more (a row's and a band cell's) and the untimed
    // note once more (the table's own). Its empty lines come through
    // `@/features/hours/services/organization-hours`, a key source.
    //
    // TWENTY-SEVEN SINCE STORY 4.3: the export's failure line. Its action's
    // two labels come through `hoursExportMessageKey`, and the sheet's
    // headings and names through `@/features/hours/services/hours-export`,
    // a key source.
    // The empty leave mark comes through `leaveShownOf` in
    // `@/features/hours/services/my-hours`, a key source.
    //
    // THIRTY SINCE STORY 5.3d: the viewer's own line of shifts in unresolved
    // conflict, the table's conflicts heading, and the retry the unavailable
    // message offers when a read failed.
    //
    // FORTY-ONE SINCE STORY 7.4: the shared month toolbar's eleven more,
    // counted in the Kalendar set too.
    //
    // SIXTY-ONE SINCE STORY 7.5: the two filters' labels and "all" options
    // (four) gave way to the shared filter bar's twenty-two, counted in the
    // Kalendar set too, and the empty table's two ways out, `Ukloni filtar:
    // Smjena B` and `Poništi filtre`. Its sentences' keys are chosen by
    // `@/features/hours/services/organization-hours` and the month in the
    // locative's by `@/utils/filter-bar`, both key sources.
    //
    // EIGHTY-FOUR SINCE STORY 7.6: the stacked rows' seventeen — the sort
    // control's five fixed column headings, the caption naming the list,
    // each value's label (member, team, shifts, total, leave, conflicts —
    // six), the no-team mark, the shift count twice (the row's and a
    // band's), the conflict line and the untimed note — and the shared sort
    // control's six, `Poredano:`, its accessible name with the direction,
    // the two directions, the sorted option's name with its direction and
    // the picker's name, counted in the member list too. A band's label is
    // its name as stored. The empty result moved to its own part
    // (`organization-hours-empty.tsx`) and is counted once, as before.
    //
    // ONE HUNDRED AND FIVE SINCE STORY 7.14: the table's footer label and the
    // phone's (two), the export's status line, a member's own title, and the
    // explanation's — the ⓘ's name, the dialog's close and two fallbacks of
    // its title (a title and a description), the line, the `+` and `=` marks,
    // the sum's name, the empty and the unavailable sentences — and the figure
    // names each ⓘ is given (the total's and the leave's words, in the summary and
    // twice in each of the table and the stacked rows). The figure's
    // words and the source's three come through
    // `@/features/hours/services/hours-explanation`, a key source.
    //
    // ONE HUNDRED AND SIX SINCE THE 7.14 REVIEW: a line's words for a shift in
    // unresolved conflict, beside its `⚠` (FR-42b).
    //
    // ONE HUNDRED AND FIVE SINCE LEAVE IN DAYS: a line's words are made by
    // `@/features/hours/services/hours-explanation` (a key source), since a
    // leave line pairs each shift's team and type, so the dialog renders the
    // line it is given.
    //
    // ONE HUNDRED AND SIX SINCE E909: the conflicts column sorts, so the
    // phone's sort control offers its heading too.
    //
    // ONE HUNDRED AND TEN SINCE THE DEFERRED-WORK SWEEP: the shared month
    // picker's phone sheet, its title and close (E792), and its footer, the
    // key hint and `Ovaj mjesec` (E795).
    //
    // ONE HUNDRED AND ELEVEN SINCE C587: the no-team mark moved out of the
    // table and the stacked rows (two) into `hours-marks.tsx`, once, beside
    // the two words a screen reader hears for an empty mark — `nema` for the
    // leave and `bez smjene` for the team. The leave's glyph still comes off
    // `leaveShownOf`, a key source.
    //
    // ONE HUNDRED AND FIFTEEN SINCE STORY 15.7: the shared filter bar's
    // four more, counted in the Kalendar set too.
    //
    // ONE HUNDRED AND THIRTEEN SINCE STORY 15.7b: the month control's Badge
    // and its `Ovaj mjesec` button are gone, counted in the Kalendar set too.
    //
    // ONE HUNDRED AND SIX SINCE STORY 13.2: the fixed leave heading is gone
    // (DI-8) — the summary's row label and its ⓘ's name, the table's heading
    // and its ⓘ's name, the stacked rows' sort option, label and ⓘ's name,
    // seven. Each leave column is named by `leaveColumnNameOf` in
    // `@/features/hours/services/my-hours`, a key source: a drawing type's
    // stored name, or *Ostala odsutnost*.
    name: 'the Sati destination',
    file: SATI,
    keys: translationKeys,
    // ONE HUNDRED AND SEVEN SINCE STORY 18.5: the shared Osoba picker's hidden
    // separator before a lent person's mark.
    // ONE HUNDRED AND ELEVEN SINCE STORY 21.23: the shared bar's toolbar
    // `Filtri` (its group, word and count) and the `Aktivni filtri` group.
    // 120 SINCE STORY 21.25: the shared filter bar's *Posao* calls (its field and picker, *Svi poslovi* twice, *Bez posla*, the summary with a role, the picker's search and count), drawn on *Sati* never but held in its source.
    // 128 SINCE STORY 21.19: *Sati na blagdan* — the summary's label and its ⓘ's name (two); the table's heading, a row's `—` and its ⓘ's name (three); the stacked rows' label, `—` and ⓘ's name (three).
    strings: 128,
  },
  {
    // STORY 5.2c. THREE on Godišnji: its own `nav.godisnji` heading, the
    // retry, and `count.days` once — written once inside the map over the
    // three tiles. The tiles' labels and the two lines in place of the figures
    // come through `@/features/leave/services/my-leave`, a key source.
    //
    // THIRTY-SIX SINCE STORY 7.15: the admin's overview — the page's lede,
    // its own unavailable line and retry (beside the member's), the search's
    // label and placeholder, the summary, the empty sentences and
    // *Poništi pretragu*, the overview's unavailable line and retry, and the
    // five column names, the caption, *Bez smjene* and the unscheduled line,
    // written once in the table and once in the stacked rows.
    //
    // FIFTY SINCE E884: the Smjena chip's six, as Ljudi's (its text set and at
    // every team, its ✕, its picker and heading, and an option's count), the
    // pending team name, the Stanje chip's four (its text, ✕, picker and
    // heading) and its options' count, and the empty line the chips leave
    // with *Poništi filtre*.
    //
    // SIXTY-THREE SINCE STORY 9.3: *Zatraži godišnji* and the sent line on
    // the page; and the requests list's heading, its empty and unavailable
    // lines with the retry, a row's range with and without its cost, the
    // cost, the hidden range and state labels, *Povuci zahtjev* and its
    // accessible name, and the withdrawn line. The status words, the closing
    // date's line and the refusals come through
    // `@/features/leave/services/my-leave`.
    // STORY 13.2b: the type of each of the viewer's requests, its term for a screen reader.
    // SIXTY-SEVEN SINCE STORY 13.4b: the overview's *Preneseno* heading, once
    // in the table and once in the stacked rows, and the summary's form with
    // the carried sum. The carried line's shapes come through
    // `@/features/leave/services/leave-section`.
    name: 'the Godišnji destination',
    file: GODISNJI,
    keys: translationKeys,
    // SIXTY-SIX SINCE STORY 21.23: the overview's lede gone, and the search's
    // placeholder the shared `Traži…` rather than its label again.
    strings: 66,
  },
  {
    // STORY 9.3. On the request form: its heading (twice, once while the role
    // is read) and lede, od and do, the cost and the balance after it with
    // `count.days`, the in-year charge, the two notes, *Pošalji* and
    // *Odustani*, the unavailable line with its retry, *Natrag na Godišnji*,
    // and the page's own retry while the role cannot be read. The reasons,
    // the refusals and the unscheduled line come through
    // `@/features/leave/services/my-leave`, a key source.
    // STORY 13.2b: the type group's label, and the line that a type which does not draw leaves the balance as it is.
    // STORY 13.4b: the over-balance warning when it is the expiry's (`godisnji.expiryExceeds`).
    // TWENTY-FIVE SINCE STORY 13.5b: *Pola dana* and its hint, the half
    // group's label and a half card's times, the admin dialog's keys. The two
    // cards' names come through `leaveHalfMessageKey` in
    // `@/features/leave/services/leave-section`, a key source.
    name: 'the leave request form',
    file: LEAVE_REQUEST,
    keys: translationKeys,
    strings: 25,
  },
  {
    // STORY 14.2. On Povijest promjena: its own `nav.povijestPromjena`
    // heading and lede; the five column headings and the caption, twice
    // (table and stacked rows); the reconstructed badge; the three ways a
    // field's *bilo → sada* reads and the line for none; the begins
    // statement; the offline, unavailable, retry, empty and filtered lines
    // with *Poništi filtre*; and the four chips' words, options and the
    // summary. The kinds, fields, values and periods come through
    // `@/features/history/services/history-rows`, a key source.
    // FIFTY-TWO SINCE ITS REVIEW: the start-of-history badge, twice (table
    // and stacked rows); the begins statement's two wordings come through
    // `historyBeginsMessageKey`.
    // FIFTY-FOUR SINCE STORY 14.3: the export's failed and done lines; its
    // action's two labels come through `historyExportMessageKey` in
    // `@/features/history/services/history-export`, a key source.
    // FIFTY-SIX SINCE EPIC 14 RETRO A9: the rows drawn in steps — the line
    // that says how many are drawn, and *Prikaži još*.
    // FIFTY-SEVEN SINCE EPIC 14 RETRO A9 (PDF): the export's refusal of more
    // changes than one file takes.
    name: 'the Povijest promjena destination',
    file: POVIJEST_PROMJENA,
    keys: translationKeys,
    // FIFTY-EIGHT SINCE STORY 21.23: the lede gone, `Izvoz` and its menu's name added.
    // FIFTY-NINE SINCE STORY 21.4: a grid save's `Prikaži {n} dana`.
    strings: 59,
  },
  {
    // STORY 14.2: the history's words — the record, action, field, value,
    // author and period records, off their `\w*MessageKey` unions, and the
    // lines built with `t()`.
    name: 'the change history rules',
    file: HISTORY_ROWS_KEYS,
    // 125 SINCE ITS REVIEW: the `other` record's word and the begins
    // statement's two wordings.
    // 147 SINCE EPIC 14 RETRO A4: five field labels (status, pattern, offset,
    // the two overrides) and six status words off the unions; the step,
    // pattern and override texts and the override's two one-sided texts, the
    // three earlier-saved words, and the three unknown names inside them.
    // 150 SINCE ITS REVIEW: a rotation step's ordinal label, and the two
    // marks on sides that differ but read alike.
    // 151 SINCE STORY 18.5: the loan record's word, `Posudba`.
    // 152 SINCE STORY 16.5: the calendar link's record, `Kalendar na mobitelu`.
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    // STORY 19.4: the onboarding dismissal's field label.
    // 154 SINCE STORY 21.2: a personal assignment's note's field label, `Napomena`.
    // 166 SINCE STORY 21.4 (with its review: a note beside an assignment): the record `Ručni raspored`, the action
    // `planirano`, the two kinds, an assignment's kind label, its two values
    // (`slobodno`, a type with its team) and a grouped save's kind line,
    // and the unknown type twice and team once more inside those values.
    // 169 SINCE STORY 21.12: the job role record, its field label and the unknown role.
    // 174 SINCE STORY 21.10: the schedule version record, its source field and the three sources.
    // 176 SINCE STORY 21.16: the holiday record, `Blagdan`, and a team's field, `Ne radi na blagdane`.
    strings: 176,
  },
  {
    // STORY 21.4: *Ručni raspored* — the page, the grid and its legend, the
    // picker, the save bar and *Što se mijenja*.
    // 118 SINCE STORY 21.5: forty more — *Popuni uzorkom*'s eighteen keys,
    // nineteen uses (*Slobodno* twice); *Kopiraj*'s thirteen; the people
    // field's legend and *Bez tima* and each dialog's *Odustani* and close
    // (six); and the save bar's two lines. 119 WITH 21.12'S ENTRY: a row's job role beside its source.
    name: 'the Ručni raspored destination',
    file: RUCNI_RASPORED,
    keys: translationKeys,
    // 120 SINCE STORY 21.6: *Dodaj smjenu*'s alert for a member with no row.
    // 128 SINCE STORY 21.25: the *Posao* filter's chip, ✕, picker, heading, *Svi poslovi*, *Bez posla*, count and result count (`manual-filters.tsx`).
    // 129 SINCE STORY 21.10: a row's source *osobna rotacija*.
    // 136 SINCE STORY 21.18: the holiday's calls — an emptied cell's value `blagdan` (the label and the phone's line), the label's `blagdan {name}` after the date, the shared date head's and mark's `blagdan {name}`, and the legend's word and key line.
    // 138 SINCE STORY 21.7: a cell's `odsutnost` and its legend line.
    strings: 138,
  },
  {
    // STORY 21.4: the preview's shift and inert-override lines, and the save's refusals.
    // 26 SINCE STORY 21.5: the ten refusals of a fill or copy.
    name: 'the Ručni raspored rules',
    file: RUCNI_RASPORED_KEYS,
    keys: messageKeyUnions,
    strings: 26,
  },
  {
    // STORY 14.3: the PDF's words — the title (the caption), the header's
    // organization, period, three filter lines (each set or `sve`), summary,
    // generation time and the begins statement off `historyBeginsMessageKey`;
    // the six column headings; a change's two sides and the line for none;
    // the two badges; the file's name and the page footer; and the action's
    // two labels, off `historyExportMessageKey`.
    // 28 SINCE EPIC 14 RETRO A9 (PDF): a continuation's *(nastavak)* and the
    // note on replaced characters.
    // 29 SINCE STORY 21.24: the product's name, *Smjenko*, as the PDF's creator.
    name: 'the change history export rules',
    file: HISTORY_EXPORT_KEYS,
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    strings: 29,
  },
  {
    // E884: the Stanje chip's five options and the five values its text says,
    // off `leaveOverviewStateMessageKey` and `leaveOverviewStateValueMessageKey`.
    name: 'the Godišnji overview rules',
    file: LEAVE_OVERVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 10,
  },
  {
    // STORY 5.3b. NINE on Za odluku (Raspored until story 9.1): its own `nav.zaOdluku` heading; the
    // unavailable line and its retry; the count, always shown, and the empty
    // sentence; and a row's four — the past words, the member and team, and
    // the shift with the causing range, with and without times. Its rules
    // module renders no string, so it is no key source.
    name: 'the Za odluku destination',
    file: ZA_ODLUKU,
    keys: translationKeys,
    // STILL NINE SINCE STORY 5.4b: the status line a decision returns with
    // reads through `resolutionSavedMessageKey`, the rules' union below.
    // TWENTY-THREE SINCE STORY 7.16: the two tabs' name, label and queue count
    // (four), and the Odlučeno list's count, empty sentence, shift-gone line,
    // the decisions (accepted, replacement with and without a name, amended),
    // and who decided it and when, with the words for an admin no longer
    // there.
    // THIRTY-FIVE SINCE STORY 9.5: each item names its kind, on Čeka odluku
    // (*Odsutnost u smjeni*, *Zahtjev za odsutnost*) and on Odlučeno
    // (both again); a pending request's row, its member or the words for one
    // who is gone, and its range; a decided request's row, its outcome
    // (*Odobren*, *Odbijen*), its member or the gone words, its range, and
    // who decided it and when, with the words for an admin no longer there.
    // THIRTY-SIX SINCE 0041: a request closed on its member's deactivation,
    // *Zatvoren deaktivacijom*, as its own outcome.
    // FORTY-EIGHT SINCE STORY 12.4: a waiting swap's row on Čeka odluku and a
    // decided swap's on Odlučeno — each its kind (*Zamjena smjene*) and the
    // proposer → the colleague — the swap's shifts written once
    // (`SwapShifts`: a shift, and the given and return shifts together), and
    // on Odlučeno its three outcomes (*Odobrena*, *Nije odobrena*,
    // *Zatvorena deaktivacijom*) and *Zamjena je naknadno izmijenjena u
    // kalendaru.*
    // 51 SINCE STORY 21.7: `bez tima` for a teamless conflict on Čeka odluku, on Odlučeno and in the status line.
    strings: 51,
  },
  {
    // STORY 5.4b. On one conflict's screen, through `t('…')`: the way back
    // with its count and plainly, the heading, the place in the queue, ‹ and
    // › with a date and at an end, the conflict's mark, the absent member's
    // leave, the choice's heading and hint, the card's title and sentence,
    // the strip's three labels, the uncovered mark, the balance and its
    // unchanged line, Odustani, Spremi odluku and its pending label, the
    // missing line, and the unavailable line with its retry. The rest come
    // through the rules' unions below.
    // THIRTY-THREE SINCE STORY 5.4c: the second card's title and sentence,
    // the replacement's name in its strip, the picker's heading and its
    // nobody-to-add line, and the generated reason.
    // THIRTY-SIX SINCE STORY 5.4d: the third card's title, the absent member
    // working in its strip, and the balance it gives back.
    // THIRTY-EIGHT SINCE STORY 5.5d: Spremi's hint while a replacement that
    // no longer applies holds the key, and its link to the calendar.
    // FORTY SINCE D726: the third card's line naming the days a later start
    // drops, and the line saying some of them are past.
    // FORTY-ONE SINCE STORY 11.2: a strip's words for a shift still short of
    // people. The term against the minimum is the short-staffed block's own
    // `atWorkText`, counted with the block.
    // FORTY SINCE STORY 13.2b: the third card's balance change comes through
    // `amendBalanceChangeMessageKey`, a rules key, no longer a literal here.
    name: 'the conflict resolution screen',
    file: RESOLUTION,
    keys: translationKeys,
    // 43 SINCE STORY 21.7: the accept card's sentence for a shift with no team, and `bez tima` in the facts and the coworkers line.
    strings: 43,
  },
  {
    // STORY 5.4b: the facts line with and without times, who else works or
    // nobody, the save hint before and after a choice, the hours as leave or
    // the empty mark, the coverage term, and the queue's status line by the
    // saved outcome.
    // SIXTEEN SINCE STORY 5.4c: the hint while nobody is picked and while
    // nobody can be, the three candidate group headings, and the status line
    // naming the replacement.
    // TWENTY-THREE SINCE STORY 5.4d: the third card's three sentences (the
    // leave starts later, ends earlier, or is removed), its hours as work or
    // the empty mark, and the hint once it is chosen, with a date or for a
    // removal.
    // TWENTY SINCE STORY 7.9: the three candidate group headings moved to the
    // calendar's public `utils/replacement-candidates`, counted there.
    // TWENTY-TWO SINCE STORY 9.4: the status line for a leave request
    // approved or rejected on its own screen, in the same slot.
    // TWENTY-FOUR SINCE STORY 12.4: and for a swap approved or rejected.
    // TWENTY-SIX SINCE STORY 13.2b: the third card's balance change, what it
    // gives back or *bez promjene* for a record that does not draw.
    name: 'the conflict resolution rules',
    file: RESOLUTION_SCREEN_KEYS,
    keys: messageKeyUnions,
    // 28 SINCE STORY 21.7: the coworkers line and its empty sentence for a shift with no team.
    strings: 28,
  },
  {
    // STORY 9.4. On one leave request's decision screen, through `t('…')`:
    // the way back, the heading, the missing and unavailable lines with the
    // retry, the range, the cost and the balance after approval with
    // `count.days`, the in-year charge, the overlap and over-balance notes,
    // the decided line with its admin (or one no longer a member), the
    // withdrawn date, and *Odbij* and *Odobri*. The status word comes through
    // `@/features/leave/services/my-leave`, the base lines and the refusals
    // through the rules below, and the collisions through the dialog's lines.
    // TWENTY SINCE ITS REVIEW: the neutral line for a member gone from both
    // lists, on the facts and as the queue's line names them.
    // STORY 13.2b: the request's type, and the line that a type which does not draw leaves the balance as it is.
    // STORY 13.4b: the over-balance warning when it is the expiry's (`godisnji.expiryExceeds`).
    // TWENTY-FOUR SINCE STORY 13.7: why a requested half costs nothing, its
    // date holding no working shift (`godisnji.request.halfNoShift`).
    name: 'the leave request decision screen',
    file: LEAVE_REQUEST_REVIEW,
    keys: translationKeys,
    strings: 24,
  },
  {
    // STORY 10.3. On *Obavijesti*: its heading and lede; the email card's
    // heading, the loading words, the unavailable line and its retry, the
    // no-address line, the address label, the organization-off line, the
    // control's label, its two options and the failure notice. The saved
    // line comes through `emailStatusMessageKey`, the entry below.
    // TWENTY-FIVE SINCE STORY 10.4: the push card's heading, its loading
    // words, the iOS-install, unsupported and blocked lines, the unavailable
    // line and its retry, its lede, its control's label, its two options and
    // its failure notice. Its saved line comes through `pushStatusMessageKey`.
    // TWENTY-SIX: the line a build with no VAPID public key shows.
    // THIRTY-SEVEN SINCE STORY 17.1: the reminders card's heading, its loading
    // words, the unavailable line and its retry (`reminders.retry`), its lede, the leads' label,
    // the limit line, the email switch's label, the off line, its failure
    // notice and its saved line. The leads' labels and the channel lines come
    // through `reminders.ts`'s unions, the entry for the reminder rules.
    name: 'the notification settings screen',
    file: NOTIFICATIONS,
    keys: translationKeys,
    strings: 37,
  },
  {
    // STORY 16.5. On *Kalendar na mobitelu*: the heading, the link card's
    // heading, loading words, unavailable line and retry, the no-link lede and
    // *Izradi poveznicu*, the live line, the revisit note, *Izradi novu
    // poveznicu* and *Isključi*, each confirmation's prompt, cancel and confirm,
    // the turned-off line, the two fixed notes; the created link's heading,
    // warning title and text, its label, *Prikaži* and *Sakrij*, *Kopiraj*,
    // each calendar's heading, add link and steps, Google's new-tab hint
    // (review 2); the download's heading,
    // lede, unavailable line, retry, *Preuzmi*, failure and saved lines. The
    // last fetch, the copy's status and the write failure come through the
    // rules entries below.
    name: 'the calendar link screen',
    file: CALENDAR_FEED,
    keys: translationKeys,
    strings: 47,
  },
  {
    // STORY 16.5 (UX-DR55): the member card's heading, loading words,
    // *Isključi poveznicu*, unavailable line and retry, the prompt, cancel and
    // confirm, the turned-off line. Its on/off line comes off
    // `memberFeedLineMessageKey`, its read failures off
    // `memberFeedReadMessageKey` (review 1: eight).
    name: 'the member calendar link card',
    file: MEMBER_FEED_CARD,
    keys: translationKeys,
    strings: 8,
  },
  {
    // STORY 16.5: the three last-fetch lines, the admin's on and off, the
    // three write failures and the admin card's three read failures, off
    // four unions (review 1).
    name: 'the calendar link rules',
    file: CALENDAR_FEED_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 16.5 (review 1): the download's empty month and its failure, off
    // `monthDownloadMessageKey`.
    name: 'the month download rules',
    file: CALENDAR_FEED_DOWNLOAD_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 16.5: the copy's two status lines, off `linkCopyMessageKey`.
    name: 'the calendar link copy',
    file: CALENDAR_FEED_COPY_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 17.1: the six leads' labels (`leadMessageKey`), the five channel
    // lines (`channelMessageKey`, the no-channel line in two forms by the
    // email switch) and the four reasons email reminders are not sent
    // (`emailUnreachableMessageKey`).
    name: 'the reminder settings rules',
    file: REMINDER_KEYS,
    keys: messageKeyUnions,
    strings: 15,
  },
  {
    // STORY 10.4: the push section's two saved lines, off `pushStatusMessageKey`.
    name: 'the push settings rules',
    file: PUSH_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 19.4: the setup frame, its steps' explainers, step 6's link, step 7
    // and the *Danas* card with its *Sakrij* dialog.
    name: 'the setup frame',
    file: ONBOARDING,
    keys: translationKeys,
    // 78 SINCE REVIEW 1: the frame's unavailable line and retry, step 5's unavailable line and its retry.
    strings: 78,
  },
  { name: 'the setup steps', file: ONBOARDING_STEP_KEYS, keys: messageKeyUnions, strings: 7 },
  // Three states, two prerequisites, step 7's four counts and its two left lines (review 1).
  { name: 'the setup progress rules', file: ONBOARDING_PROGRESS_KEYS, keys: messageKeyUnions, strings: 11 },
  { name: 'the setup link rules', file: ONBOARDING_LINK_KEYS, keys: messageKeyUnions, strings: 2 },
  {
    // STORY 10.3: the two saved lines, off `emailStatusMessageKey`, and the
    // two ledes, one per role, off `ledeMessageKey`.
    name: 'the notification settings rules',
    file: NOTIFICATIONS_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 13.1b: what a row says about drawing (two) and the read failure,
    // off `absenceTypeDrawsMessageKey` and `absenceTypesMessageKey`.
    name: 'the absence type list rules',
    file: ABSENCE_TYPE_LIST_KEYS,
    keys: messageKeyUnions,
    strings: 3,
  },
  {
    // STORY 13.1b: eight refusals — the blank, long and taken name, no drawing
    // choice, annual leave set not to draw, the stale card, the outright
    // refusal and the service — and two confirmations, an add and an edit.
    name: 'the absence type write rules',
    file: ABSENCE_TYPE_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 10,
  },
  {
    // STORY 21.12: the read failure, off `jobRolesMessageKey`.
    name: 'the job role list rules',
    file: JOB_ROLE_LIST_KEYS,
    keys: messageKeyUnions,
    strings: 1,
  },
  {
    // STORY 21.12: seven refusals — the blank, long, control-character and
    // taken name, the stale card, the outright refusal and the service — and
    // four confirmations: an add, a rename, an archive and a restore.
    name: 'the job role write rules',
    file: JOB_ROLE_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 21.17: the fourteen official names of the import's codes, the
    // eleven refusals of a holiday write (the date, the three name rules, the
    // date taken, the stale card, nothing new, no import before 2020, the
    // outright refusal, the service and the unchecked change), its four
    // confirmations, and the team flag's four refusals. THIRTY-FOUR with the
    // impossible date.
    name: 'the holiday rules',
    file: HOLIDAY_KEYS,
    keys: messageKeyUnions,
    strings: 34,
  },
  {
    // STORY 21.17: *Što se mijenja* of a holiday write — the past dates'
    // warning, the import's heading, row, *već upisano* and past mark, the
    // teams' heading, their lost and gained lines and the none line, the
    // erasure count, and the erasure row of a team the holiday empties;
    // the flag's past holidays left out, and no team off on holidays.
    name: 'the holiday preview body',
    file: HOLIDAY_CHECK_BODY,
    keys: translationKeys,
    strings: 13,
  },
  {
    // STORY 10.3: the organization's email-notifications switch — its two
    // option labels and its two status lines, off two unions.
    name: 'the email-notifications switch labels',
    file: EMAIL_NOTIFICATIONS_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 9.4: the base's three lines in place of the figures (unavailable,
    // unscheduled, absent) and the decision's four refusals, off
    // `reviewBaseMessageKey` and `reviewFailureMessageKey`.
    // EIGHT SINCE 0041: an approval refused because the member is inactive
    // on a date of the request.
    name: 'the leave request decision rules',
    file: LEAVE_REQUEST_REVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 8,
  },
  {
    // STORY 7.9: the three candidate group headings — free, working that day,
    // on leave that day — shared by the conflict screen's picker and the day
    // detail's roster dialog, off `candidateGroupMessageKey`.
    // FOUR SINCE D717: a candidate's line with the continuous duty the shift
    // would make, off `candidateContinuousMessageKey`.
    name: 'the replacement candidate groups',
    file: REPLACEMENT_CANDIDATE_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 5.4b: the write's three refusals — gone, denied, failed. FOUR
    // SINCE STORY 5.4c: the replacement already on the shift. FIVE SINCE
    // STORY 5.5d: the key a replacement that does not apply still holds.
    name: 'the conflict resolution write',
    file: RESOLUTION_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 5,
  },
  {
    // STORY 5.2c: the two lines in place of the figures (unavailable,
    // unscheduled), off `myLeaveMessageKey`, and the three tiles' labels, as
    // `label` entries — `memberListKeys` reads both shapes.
    // TWENTY-TWO SINCE STORY 9.3: the request form's four reasons and four
    // refusals, the withdrawal's three refusals, the four status words, and
    // the closing date's two lines, decided and withdrawn.
    // TWENTY-FIVE SINCE 0041: a send refused because the member is inactive
    // in the range, the fifth status word (*Zatvoren deaktivacijom*) and its
    // closing date's line.
    // TWENTY-SEVEN SINCE 0047: the past start, as the form's reason and as
    // the database's refusal.
    // STORY 13.2b: the reason no type is chosen yet.
    // THIRTY SINCE STORY 13.5b: the two half-day reasons in the member's own
    // words, no half chosen and a date without exactly one working shift.
    name: 'the Godišnji rules',
    file: MY_LEAVE_KEYS,
    keys: memberListKeys,
    strings: 30,
  },
  {
    // 0047: the line under an approved request whose leave an admin amended
    // or removed since, on *Godišnji* and on *Odlučeno* alike.
    name: 'the leave request record change',
    file: LEAVE_REQUEST_LIST_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 4.1b: the hours' one failure, a read or a domain refusal alike.
    // TWO SINCE THE EMPTY LEAVE FIX (Epic 4 retro, R2): the empty figure `—`
    // a leave of 0 reads, off `leaveMessageKey`.
    // THREE SINCE LEAVE IN DAYS: a leave reads as its day count, `count.days`,
    // off the same union.
    // FOUR SINCE STORY 13.2: *Ostala odsutnost*, the leave column of every
    // type that does not draw, off `otherAbsenceMessageKey`.
    name: 'the hours rules',
    file: HOURS_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 4.2: why an admin's table is empty — nobody matches the filter,
    // or nobody has a row this month.
    // FIVE SINCE STORY 7.5, read off BOTH unions: the month with nobody, the
    // person not in the team chosen (in place of "nobody matches"), the
    // filters showing nobody (a filter alone, which the options rule out
    // today), and where the person is instead — their own team, or none this
    // month.
    name: 'the organization hours rules',
    file: ORGANIZATION_HOURS_KEYS,
    keys: messageKeyUnions,
    strings: 5,
  },
  {
    // STORY 7.5: the filter bar's model — the summary line's five forms, a
    // chip's four (a team or a person, chosen or `sve`), a ✕'s two names,
    // and the twelve months in the locative an empty table's sentence reads.
    // TWENTY-ONE SINCE STORY 15.7: only an active chip is drawn, so a chip
    // has two forms, never `sve`.
    name: 'the filter bar rules',
    file: FILTER_BAR_KEYS,
    keys: messageKeyUnions,
    // 23 SINCE STORY 21.25: the *Posao* chip's text and its ✕'s name.
    strings: 23,
  },
  {
    // STORY 4.3: the export's sheet — its eight `t()` calls: the five fixed
    // column headings 4.2 already renders, the no-team mark, the sheet's name
    // and the file's — and its action's two labels, the imperative and the
    // one it wears while the file is built, off `hoursExportMessageKey`.
    // ELEVEN SINCE STORY 5.3d: the conflicts column's heading, the table's own.
    // STILL ELEVEN SINCE LEAVE IN DAYS: the leave column's heading names its
    // unit, days, in place of the table's own heading.
    // TWELVE SINCE E922: the footer row's label, the table's own.
    // STILL TWELVE SINCE STORY 13.2: the one leave heading became one per
    // leave column, `{name} (dani)`, a single key with the column's name.
    // THIRTEEN SINCE STORY 21.19: the *Sati na blagdan* column's heading, the table's own.
    name: 'the hours export rules',
    file: HOURS_EXPORT_KEYS,
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    strings: 13,
  },
  {
    // STORY 7.14: the figure's name — the total's and the leave's words —
    // the month, the person and month, and a shift's line, off `t()`; and the
    // three words a shift's source reads as, off `hoursSourceMessageKey`.
    // NINE SINCE LEAVE IN DAYS: a shift's line and a leave line's
    // `team · type`, made here rather than in the dialog. TWELVE SINCE ITS
    // REVIEW: a decided shift's leave line (`sati.explain.line` again, with
    // the decision as its source) and the two decisions' words, the resolved
    // queue's own, off `leaveDecisionMessageKey`.
    // ELEVEN SINCE STORY 13.2: the leave's fixed name is gone; a leave column's
    // dialog is named by `leaveColumnNameOf`, `@/features/hours/services/my-hours`'s.
    // TWELVE SINCE STORY 18.5: a loan shift's source, `posudba`.
    // THIRTEEN SINCE STORY 21.1: a Personal Shift's source, `osobni raspored`.
    name: 'the hours explanation rules',
    file: HOURS_EXPLANATION_KEYS,
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    // 14 SINCE STORY 21.6: a teamless line's `bez tima`.
    // 15 SINCE STORY 21.19: the holiday figure's name, *Sati na blagdan*.
    strings: 15,
  },
  {
    // STORY 18.5: a member's own loan, covering today or ahead, off
    // `loanNoticeMessageKey` (UX-DR59).
    name: 'the loan marks rules',
    file: LOAN_MARKS_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 5.1c: the leave card's four reasons for no preview (incomplete,
    // reversed, over a year, refused by the domain), its four refusals — the
    // overlap with and without the conflict's dates, denied and failed — and
    // the two lines in place of the figures (unavailable, unscheduled), off
    // `leaveReasonMessageKey`, `leaveRefusalMessageKey` and `leaveBaseMessageKey`.
    // SIXTEEN SINCE STORY 5.2b: the reason an unchanged amend is not sent,
    // the amend's and the removal's own denied and failed lines, and the line
    // for a record already gone.
    // EIGHTEEN SINCE THE 5.2b REVIEW: the removal prompt's two forms, with
    // and without the in-year part, off `leaveRemovePromptMessageKey`.
    // STORY 13.2b: the reason no type is chosen yet, and each type card's drawing line (the type card's own two).
    // THIRTY SINCE STORY 13.4b: the carried line's three shapes, in each of
    // its three forms — the line, the member card's value and the overview's
    // cell — off `leaveCarriedLineMessageKey` and its two siblings.
    // THIRTY-SIX SINCE STORY 13.5: the two reasons a half day is not sent (no
    // half chosen, no single working shift), the two half cards' names, and a
    // half day's cost in a list, each half.
    // THIRTY-EIGHT SINCE STORY 13.5b: a half-day request's range, each half,
    // off `leaveRangeHalfMessageKey`, for every request surface.
    name: 'the leave card rules',
    file: LEAVE_SECTION_KEYS,
    keys: messageKeyUnions,
    strings: 38,
  },
  {
    // STORY 3.1: the calendar's one read failure.
    name: 'the calendar read rules',
    file: CALENDAR_SNAPSHOT_KEYS,
    keys: messageKeyUnion,
    strings: 1,
  },
  {
    // STORY 3.5b: the six refusals of setting or removing an override, and
    // the two things a landed write says — saved, and removed. NINE SINCE
    // STORY 3.5c: a pending override removed from a day with no rotation.
    // TEN SINCE STORY 7.9: no type chosen in the type dialog, its own refusal.
    //
    // ELEVEN SINCE 0036: a team or type archived while the day was open.
    name: 'the calendar override write rules',
    file: CALENDAR_OVERRIDE_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 3.6b: the six refusals of changing a roster or removing a
    // change, and the two things a landed write says — saved, and removed.
    //
    // NINE SINCE 0036: a team archived while the day was open.
    name: 'the calendar roster write rules',
    file: CALENDAR_ROSTER_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 9,
  },
  {
    // The read failure, and its retry (deferred-work sweep).
    name: 'the rotation read rules',
    file: ROTATION_LIST_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // The eight refusals, the "nothing changed" note beside a failure after
    // the pattern, and the confirmation.
    // FIFTEEN SINCE STORY 2.6: the past effective date; the cancel's three
    // refusals (stale, and the save's refused and unavailable again) and its
    // confirmation. SIXTEEN: an effective date more than a year ahead.
    name: 'the rotation write rules',
    file: ROTATION_WRITE_KEYS,
    keys: memberWriteKeys,
    // STORY 19.4: Vrijedi od never chosen (O3).
    strings: 17,
  },
  {
    // THIRTEEN on the create form: its own heading, five field labels, the save
    // and cancel actions, the link back to the list, and the credential panel's
    // three — plus `ljudi.form.username` a SECOND time, as that panel's label
    // for the username it just issued. The set comparison below dedupes, so
    // thirteen calls over twelve keys is correct rather than drift.
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover.
    //
    // FOURTEEN SINCE MEMBER RANK: the rank control's label. Its options reach
    // `t()` through `rankMessageKey`, counted with the rank rules below.
    // NINETEEN SINCE DESIGN REFRESH C: the lede, the two section headings,
    // and the aside's title and body.
    //
    // TWENTY SINCE STORY 7.8: `Kopiraj` on the credential line.
    //
    // NINETEEN SINCE STORY 7.13b, a dialog: the title and lede stay, the two
    // section headings, the aside, the link back and the second username label
    // go; the username's hint, the dialog's close, `Račun je izrađen: {name} ·
    // {username}`, the no-team line, *Dodaj još jednu* and *Otvori stranicu
    // osobe* arrive, and the submit is `Dodaj osobu` rather than `Spremi`.
    name: 'the member create form',
    file: MEMBER_CREATE,
    keys: translationKeys,
    // STORY 19.4: the level's Odaberi (O3).
    strings: 20,
  },
  {
    // EIGHTEEN on the edit form: its own heading, five field labels, save,
    // cancel, the link back, the confirmation that a save landed, and the
    // admin-issued reset's EIGHT — the offer, the confirmation's prompt, its
    // confirm and cancel, and the shown panel's four (that it was issued, the
    // label over the password, the write-it-down sentence, and the dismiss).
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover. `ljudi.form.credentialOnce` is rendered a SECOND time here — the
    // create panel already shows it — and the set comparison below dedupes, so
    // eighteen calls over seventeen keys is correct rather than drift.
    //
    // `ljudi.form.saved` is the tenth and it is not decoration: every field
    // here is uncontrolled and remounts to the values it was just saved with,
    // so without it a successful save looks identical to a press that did
    // nothing.
    //
    // TWENTY-ONE SINCE STORY 1.6: the status block's three literal keys — the
    // date control's label, the confirmation's cancel, and the confirmation
    // that a change landed. Its status lines, offer, prompt and confirm vary
    // with the member's history and reach `t()` through `@/features/members/services/wire`,
    // which is the entry below.
    //
    // TWENTY-EIGHT SINCE STORY 1.7b: the team block's seven literal calls —
    // the line stating the team today, `Bez smjene` twice (as that line's
    // value and as the picker's "no team" option), the picker's and the date's
    // labels, the confirmation's cancel, and the confirmation that a change
    // landed. Its scheduled line, offer, prompt and confirm reach `t()`
    // through `@/features/members/services/wire`.
    //
    // TWENTY-NINE SINCE MEMBER RANK: the rank control's label, as on the
    // create form.
    //
    // THIRTY-FOUR SINCE DESIGN REFRESH C: the form's two section headings, and
    // the headings of the cards the team, status and password moved into.
    //
    // FIFTY-THREE SINCE STORY 5.1c: the leave card's nineteen literal calls —
    // its heading, the three figures' labels (the allowance's is `ljudi.leave`)
    // and `count.days` for a figure, the form's legend, the od and do labels,
    // the preview's two labels and `count.days` for each, the overlap and
    // over-balance notes, the unavailable line twice (in place of the figures
    // and of a preview the domain refused), the save's two status lines and
    // the save action. Its reasons and refusals reach `t()` through
    // `@/features/leave/services/leave-section`, the entry below.
    //
    // FIFTY-FOUR SINCE THE 5.1c REVIEW: three more — the in-year charge, the
    // plain saved line and the retry — and two fewer, the unavailable line's
    // two literal calls, which now come through `leaveBaseMessageKey` (a
    // preview the domain refuses is a reason, through `leaveReasonMessageKey`).
    //
    // SEVENTY-THREE SINCE STORY 5.2b: nineteen more. The records list's
    // heading and empty line, each row's `count.days`, its two short actions
    // and their two full names, and the removed line; the removal prompt with
    // its `count.days`, its cancel, confirm and in-flight label; and the
    // form's amend legend, save and cancel, and the amended line's two forms
    // with its over-balance warning.
    //
    // SEVENTY-FIVE SINCE THE 5.2b REVIEW: the prompt itself now comes through
    // `leaveRemovePromptMessageKey` (one fewer), and three more — the prompt's
    // in-year `count.days`, a row's in-year line and the row's amend marker.
    //
    // SEVENTY-SIX SINCE STORY 5.4d: "Natrag na Za odluku".
    //
    // SEVENTY-EIGHT SINCE STORY 5.4e: the replacement guard's two lines — a
    // replacement left rostered, and that the replacements cannot be checked
    // — written once in `LeaveReplacementLines` and rendered in the amend
    // preview, the removal confirmation and both notices.
    //
    // NINETY-FOUR SINCE STORY 5.5e: sixteen more. The erasure dialogs' ten
    // words, written once in `memberErasureCopyOf` (title, lede, changed
    // line, a row's title and second line, the toggles' group label,
    // "Potvrdi brisanje", "Zadrži", the way back and the kept hint); and in
    // each of the two cards the unavailable line, its retry and the removed
    // count beside the saved line.
    //
    // NINETY-FIVE SINCE STORY 7.8: `Kopiraj` on the reset's credential line.
    //
    // ONE HUNDRED AND TWENTY-NINE SINCE STORY 7.11, facts and dialogs: the
    // header's fallback title, separator and no-team word; the basics card's
    // heading, facts, edit button and its dialog's title, close and fields;
    // the team card's header button, its dialog's title, description,
    // placeholder, current-team option and Spremi; the allowance's button,
    // notice, dialog and field; the status dialog's question; the sign-in
    // card's heading, line and button; and the leave card's year heading and
    // *Pravo*. Every dialog's close button is `ljudi.page.close`. And the
    // team withdrawal's prompt, written by the card itself.
    //
    // ONE HUNDRED AND FORTY-NINE SINCE STORY 7.12, the leave dialog: the
    // card's *Upiši godišnji* and its name; the dialog's two titles, close,
    // cancel, *Što se mijenja*, *Bilo* and *Sada* with their ranges; the
    // conflict lines (one line's shape, created, where, none, cleared, kept,
    // new, their one group shape and unknown); and the removal's cleared
    // line or its unknown line — less the form's two legends and the row's amend-mode word they
    // replace.
    // ONE HUNDRED AND FIFTY-THREE SINCE THE DEFERRED-WORK SWEEP: the read
    // failure's retry, the status date's hint, the team dialog's *Što se
    // mijenja* heading (decision 16), and the reset dialog's close.
    //
    // ONE HUNDRED AND FIFTY-FIVE SINCE D723: the card's line when a hand-off
    // from a conflict opened nothing, and the amend dialog's line when its
    // od and do came from the conflict.
    // ONE HUNDRED AND FIFTY-SIX SINCE 0041: the deactivation question's line
    // naming the pending leave requests it closes.
    // STORY 13.2b: the leave dialog's type group label and the unchanged-balance line.
    // STORY 13.3b: the allowance field's *Vrijedi od {year}.* hint.
    // STORY 13.4b: the leave card's *Preneseno* row label.
    // STORY 13.4b: the expiry's over-balance warning in the leave dialog and in the saved and amended lines.
    // ONE HUNDRED AND SIXTY-FOUR SINCE STORY 13.5: four new — the leave
    // dialog's *Pola dana* switch, its hint, the half group's label and a half
    // card's times — and three fewer, since the four `count.days` calls of a
    // record's or a range's cost (the row, the removal prompt, *Bilo* and the
    // preview's cost) now go through one `leaveCostText`, which makes one
    // `count.days` call of its own and names the half: +4 − 4 + 1.
    // ONE HUNDRED AND EIGHTY-EIGHT SINCE STORY 18.3: the *Smjena* card's
    // `Posudi drugom timu`, its accessible name, the saved line and what the
    // guarded write removed (4); the loan dialog's title, its two descriptions,
    // close, the four labels and the placeholder, *Što se mijenja* with
    // `i još {n}`, the double, rest-gap and inert lines' fixed keys (heading,
    // note), the unchecked line and its retry, cancel, *Spremi* and the erasure
    // dialog's save (20). ONE HUNDRED AND NINETY SINCE ITS REVIEW: *Razlog*'s
    // hint and the neutral words for an inert override's unnamed member.
    // TWO HUNDRED AND ONE SINCE STORY 18.4: the card's loan list — its heading,
    // a row, the unknown team, *Izmijeni posudbu* and its accessible name — and
    // the amend dialog's title, *Razlog*'s keep hint, *Završi danas*, *Ukloni
    // posudbu* and its hint, the inactive-days line and the removal's erasure
    // save (12); the card's saved line now goes through `loanSavedMessageKey`
    // (−1).
    name: 'the member edit form',
    file: MEMBER_EDIT,
    keys: translationKeys,
    // 218 SINCE STORY 21.6: the loan preview's `bez tima` (four) and *Dodaj smjenu*'s card (its title and opener, the hint) and dialog (title, *Zatvori*, *Datum*, the hint, *Odustani*, *Odaberi smjenu*).
    // 264 SINCE STORY 21.10: *Raspored osobe* — its card (title, *Promijeni raspored*, the facts and their four line shapes, a run and its separator, *Povuci* and its name, the two saved lines, *Učitava se*, the unchecked alert), its form (the three sources and their hints, its heading, *Vrijedi od* and its hint, *Uzorak*, *Odaberi*, *Novi uzorak*, the steps' legend, a step's type, count and removal, *Dodaj korak*, *Početni korak*, its option and hint, *Zatvori*, *Odustani*, *Dalje*) and its *Što se mijenja* (title, two ledes, the window, *Natrag na uređivanje*, *Spremi*, *Povuci promjenu*).
    strings: 264,
  },
  {
    // THIRTEEN on the member write path's rules: eleven `ljudi.form.error.*`
    // refusals, the LIST's own refusal — reused rather than reworded, because
    // `/ljudi/$id` is reachable by URL and a read the database declines
    // outright is not a failed write — and the partial-save sentence. It is the
    // second key source read by neither `translationKeys` nor
    // `messageKeyUnion`; see `memberWriteKeys`, which reads both shapes this
    // module declares keys in.
    //
    // THE ELEVENTH REFUSAL IS THE RESET'S. "The password was not changed" is
    // its own sentence rather than the service fallback because this surface is
    // the ONLY recovery an account with no email address has, and the fact an
    // admin needs before they tell somebody anything is whether the credential
    // moved at all.
    //
    // THIRTY-FIVE SINCE STORY 1.6: seven refusals a status change can earn —
    // a past date, the caller's own row, a date that already has a version, a
    // date before the latest one, a change that changes nothing, a
    // cancellation of a change already in effect, and a list behind the
    // database (look again); ELEVEN keys the offer,
    // prompt and confirm take across the three changes (a prompt for today
    // and one for a later date, for each of deactivate and reactivate); and
    // the FOUR status lines — today's in the present, the scheduled change's
    // in the future. Paired by `statusOfferMessageKey` and its siblings so
    // the pairing is executed rather than written into the screen.
    //
    // FIFTY-FOUR SINCE STORY 1.7b, all under `smjene.membership.*`: eight team
    // refusals, the two offers (move, cancel the scheduled move), five prompts
    // (onto a team or onto none, today or later, and the cancellation), the
    // two confirms, and the two scheduled lines (onto a team, onto none).
    //
    // SIXTY-TWO SINCE TEAM POSITION: the refusal for an unchanged team AND
    // position, four prompts (a move naming its position, and a position-only
    // change, each today or later), the scheduled line with a position, and
    // the current-team line in both its forms — moved here out of the screen
    // as `teamCurrentMessageKey`'s union.
    //
    // SIXTY-FIVE after review: the refusal for a team with no position while
    // positions are in use, and the two scheduled lines for a change that
    // keeps the team — by position, and neutral while positions are off.
    //
    // SIXTY-ONE SINCE STORY 7.11: five more — the placeholder's refusal
    // (`Odaberi smjenu.`), and the status dialog's title and final button for
    // each of deactivate and reactivate — and nine fewer. A move has no
    // confirmation any more, so its eight prompts are retired, and the
    // withdrawal's prompt is the card's own `t()` call now.
    //
    // SIXTY-FOUR SINCE STORY 7.13c: the deactivation's final button with its
    // date (`statusSubmitMessageKey`), and its consequence in numbers with and
    // without the month clause (`deactivationConsequenceMessageKey`).
    //
    // SIXTY-FIVE SINCE 0036: a name over the maximum.
    //
    // SIXTY-SIX SINCE STORY 19.2: an email identity's username is not renamed.
    name: 'the member write rules',
    file: MEMBER_WRITE_KEYS,
    keys: memberWriteKeys,
    // STORY 19.4: no level chosen and no allowance (O3).
    strings: 68,
  },
  {
    // ELEVEN on the member list's rules: four column headings, two permission
    // levels, three counted filter options and two refusals. It is the first
    // key source read by neither `translationKeys` nor `messageKeyUnion` — see
    // `memberListKeys`, which reads both shapes this module declares keys in.
    // TWELVE SINCE STORY 1.7b: the team column's heading.
    // EIGHTEEN SINCE VISUAL REFRESH B: the summary row's four stat labels, read
    // off `membersSummaryOf`'s `label:` entries the way the headings are, and
    // the two inactive-marker keys, which moved here from the screen as
    // `memberStatusMessageKey`'s return union.
    // TWENTY-ONE SINCE THE TEAM FILTER: `teamFilterMessageKey`'s three counted
    // options — every team, a named team, and no team.
    // TWENTY-FOUR SINCE DESIGN REFRESH C: `teamMarkerMessageKey`'s three
    // markers for a scheduled team change — a move, no team, and a change
    // that keeps the team.
    // THIRTY SINCE STORY 7.13: the four stat labels and the two inactive
    // markers left with the stat cards and the name's badge; the status
    // column's heading and its four facts arrived (`memberStatusMessageKey`),
    // the summary line's two forms, the level picker's every-level option,
    // the status chip's three values and its three option names, and the team
    // options are now `Sve smjene` and `Bez smjene` beside their counts.
    // THIRTY-ONE SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the member list rules',
    file: MEMBER_LIST_KEYS,
    keys: memberListKeys,
    strings: 33,
  },
  {
    // STORY 11.2: the short-staffed block every save that can cause one draws
    // in its *Što se mijenja* — its heading, a row, people at work against the
    // minimum, `i još {n}`, and the neutral line when it cannot be checked.
    name: 'the short-staffed block',
    file: STAFFING_BLOCK,
    keys: translationKeys,
    strings: 5,
  },
  {
    // DECISION 16, the deferred-work sweep: the team dialog's last shift in
    // the team left and first in the team joined, each with or without the
    // type's range (`moveShiftMessageKey`).
    name: 'the team move preview rules',
    file: MEMBER_MOVE_PREVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 18.3: the loan dialog's eleven refusals (`loanRefusalMessageKey`),
    // its four shift lines, each with or without a range
    // (`loanShiftMessageKey`), and its three inert-override lines
    // (`loanInertMessageKey`).
    // TWENTY-TWO SINCE STORY 18.4: what a landed lend, amend or removal says
    // (`loanSavedMessageKey`), and the amend that changes nothing.
    name: 'the loan dialog rules',
    file: MEMBER_LOAN_KEYS,
    keys: messageKeyUnions,
    strings: 22,
  },
  {
    // STORY 21.10: *Raspored osobe*'s rules — the three sources' names
    // (`scheduleSourceMessageKey`) and the twelve refusals' words
    // (`scheduleSourceRefusalMessageKey`).
    name: 'the schedule source rules',
    file: MEMBER_SCHEDULE_SOURCE_KEYS,
    keys: messageKeyUnions,
    strings: 15,
  },
  {
    // ONE on the lockup: the accessible name it falls back to when the
    // organization's own name is blank. `0002:72` makes that unreachable from
    // the database, but an empty accessible name on a `role="img"` is an
    // element a screen reader announces as nothing at all. Everything else the
    // lockup shows is DATA — the organization's name, its logo — and data is
    // never a key.
    name: 'the organization lockup',
    file: LOCKUP,
    keys: translationKeys,
    strings: 1,
  },
  {
    // FIVE, for four curated accents and no accent — the fourth instance of the
    // `\w*MessageKey` shape, after sign-in, the organization's refusals and the
    // chrome's. It is a mapping rather than a list because the mutation it
    // refuses is invisible in a diff: two swapped branches leave an
    // organization that chose green reading `Plava`, and a `.tsx` lookup is
    // executed by nothing (AD-15). `accent.test.ts` runs it.
    name: 'the accent-to-label mapping',
    file: ACCENT_KEYS,
    keys: messageKeyUnion,
    strings: 5,
  },
  {
    // STORY 7.11. TWO on the member page's header: today's status badge,
    // active or not, off `memberStatusBadgeMessageKey`.
    name: 'the member page header facts',
    file: MEMBER_FACTS_KEYS,
    keys: memberListKeys,
    strings: 2,
  },
  {
    // MEMBER RANK. TWENTY-NINE over four unions: the eleven rank labels, no
    // rank and unknown rank (`rankMessageKey`, 13); the roster's form — the
    // eleven labels again and its own lowercase unknown rank
    // (`rosterRankMessageKey`, 12); the setting's two option labels and its
    // two status lines. The set comparison dedupes the repeated labels. A
    // mapping for the accent's reason: a `.tsx` lookup is executed by nothing,
    // and `rank.test.ts` runs this one.
    name: 'the rank-to-label mapping',
    file: RANK_KEYS,
    keys: memberListKeys,
    strings: 29,
  },
  {
    // TEAM POSITION. SEVEN over two unions: the three position labels and the
    // unknown position (`positionMessageKey`), and the roster's three lines —
    // with a rank, with a position, with both (`rosterLineMessageKey`). Read
    // by `memberListKeys`, the extractor the rank mapping uses, because both
    // modules declare keys only as `\w*MessageKey` return unions. A mapping for
    // the rank's reason, and `position.test.ts` runs it.
    name: 'the position-to-label mapping',
    file: POSITION_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // STORY 7.8. TWO: what `Kopiraj` did — copied, or write it down.
    name: 'the credential copy mapping',
    file: CREDENTIAL_COPY_KEYS,
    keys: memberListKeys,
    strings: 2,
  },
  {
    // NINE since story 7.18 (ten from story 1.4b; no write carries a zone any
    // more, so the zone's refusal went), and one function rather than two: the surface
    // shows exactly one message region, so a second mapping would need a
    // screen-side ternary choosing between them — the executed-by-nothing
    // branch this entry exists to abolish.
    //
    // TEN SINCE 0036: a name over the maximum.
    // ELEVEN SINCE 0048 (story 11.1): minimum members that is no whole number from 1.
    // TWELVE SINCE 0057 (story 13.4): a carry-over setting 0057 would refuse.
    name: 'the organization failure-to-message mapping',
    file: ORGANIZATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 12,
  },
  // SIX literal keys on the chrome — the navigation landmark's name twice (one
  // per bar), the collapse's two state-dependent names, the exit and the retry —
  // and that count is smaller than what the chrome RENDERS, which is the
  // interesting part. The eight destination labels reach `t()` as
  // `t(destination.key)`, read off `@/features/navigation/utils/destinations` rather than
  // written here, so `translationKeys` finds none of them and must not: a chrome
  // that named its own keys would be a ninth copy of the destination list, and
  // the whole reason that table is data is that a test can execute it. The eight
  // stay in the set comparison below because the eight destination screens each
  // render their own heading.
  // TEN: the theme control's name per preference (three) and its group's label
  // came in; the sidebar's muted section label, a third `shell.navigation`,
  // went out with the sidebar redesign. The profile card's role words arrive
  // through `memberRoleLabelKey`, a key this sweep does not see by design.
  // SEVENTEEN with story 7.3's *Više*: its name twice (the button's word and
  // the sheet's `aria-label`), the sheet's close, its three group headings
  // and the "role · organization" line under the person's name.
  // EIGHTEEN with the sheet's copy: the current row's "Ovdje si". The rows'
  // descriptions and the place under *Više* come through the next entry but
  // one.
  // TWENTY with story 8.4: *Instaliraj* and its iOS steps.
  // TWENTY-FOUR SINCE STORY 10.3: the fixed *Obavijesti* row — its name
  // (in the sheet and in the menu), its description, and *Ovdje si*.
  // TWENTY-FIVE SINCE STORY 16.5: the two fixed rows are one table, each
  // name and description said once — *Obavijesti*'s two (its name was said
  // twice before) and *Kalendar na mobitelu*'s two.
  { name: 'the navigation chrome', file: CHROME, keys: translationKeys, strings: 25 },
  {
    // TWO, for three role codes and one sign-out code. The collapse is the
    // decision `messages.test.ts` executes; what this count pins is that there
    // are exactly two messages to collapse into, so a third failure that quietly
    // grew its own message has to be justified here first.
    name: 'the chrome failure-to-message mapping',
    file: NAVIGATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 2,
  },
  {
    // NINE over two unions: a description per destination key (eight), and
    // the one place *Više* names by a shorter word than the label.
    // TEN SINCE STORY 14.2: *Povijest promjena*'s description.
    // ELEVEN SINCE STORY 21.4: *Ručni raspored*'s description.
    name: 'the destination copy mapping',
    file: DESTINATION_COPY_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  // ONE each, exactly. The seven together are what make the set comparison
  // below hold once `hr.json` gained eight `nav.*` keys: a key declared and
  // never rendered is a string nobody reviewed, and a destination rendering two
  // keys is a screen this story did not sanction.
  ...DESTINATION_SCREENS.map((destination) => ({
    ...destination,
    keys: translationKeys,
    strings: 1,
  })),
];
