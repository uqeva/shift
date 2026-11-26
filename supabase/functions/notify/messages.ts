/**
 * The text `notify` sends, and the one way it is rendered.
 *
 * A COPY of `apps/web/src/lib/i18n/locales/hr.json`'s `obavijesti` namespace.
 * The function cannot import from `apps/web` (it is deployed on its own), so
 * the copy is pinned deep-equal to the resource by `test/notify-boundary.test.ts`:
 * one source of truth, checked in CI. Edit `hr.json` first, then this file.
 *
 * Rendering is plain `{name}` interpolation and nothing else: no ICU, no
 * plural, no select. An operand that is an ISO calendar date is formatted the
 * way the SPA's `formatIsoDate` formats it (`23.09.2026`, UX-DR34), and one
 * that is a minute of the shift (story 17.3) the way `formatMinuteOfDay`
 * does (`07:00`). Nothing here computes a domain answer (AD-16's spirit,
 * AD-18): the operands arrive already decided, in the outbox row.
 *
 * Story 17.3: a shift reminder (`SHIFT_REMINDER`, AD-18's one exception) is
 * rendered from {@link PODSJETNICI}, a second pinned copy, of `hr.json`'s
 * `reminders.notice`, on its own branch: every other code renders exactly as
 * before.
 *
 * Story 21.27 (UX-DR85): each message is a `body` and an `action`, the
 * button's label; the plain text and the push join them as before
 * (`<body> <action>: <link>`). The footer is a `reason` (why the email came,
 * naming the organization) and a `settings` line linking to `/obavijesti`.
 * {@link renderEmail} also draws the HTML part, in `email-layout.ts`.
 *
 * Imports only `email-layout.ts`, which imports nothing, so Vitest asserts it
 * in the node environment (AD-15).
 */

import { EMAIL_MARK_FILE, emailHtml } from './email-layout.ts';

export const OBAVIJESTI = {
  leaveRequestApproved: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} je odobren',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} je odobren.',
    action: 'Otvori Godišnji',
  },
  leaveRequestApprovedHalfFirst: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} (prvi dio smjene) je odobren',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} (prvi dio smjene) je odobren.',
    action: 'Otvori Godišnji',
  },
  leaveRequestApprovedHalfSecond: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} (drugi dio smjene) je odobren',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} (drugi dio smjene) je odobren.',
    action: 'Otvori Godišnji',
  },
  leaveRequestRejected: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} je odbijen',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} je odbijen.',
    action: 'Otvori Godišnji',
  },
  leaveRequestRejectedHalfFirst: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} (prvi dio smjene) je odbijen',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} (prvi dio smjene) je odbijen.',
    action: 'Otvori Godišnji',
  },
  leaveRequestRejectedHalfSecond: {
    subject: 'Zahtjev za odsutnost {startDate}–{endDate} (drugi dio smjene) je odbijen',
    body: '{organizationName}: tvoj zahtjev za odsutnost {startDate}–{endDate} (drugi dio smjene) je odbijen.',
    action: 'Otvori Godišnji',
  },
  leaveRecorded: {
    subject: 'Upisana ti je odsutnost {startDate}–{endDate}',
    body: '{organizationName}: upisana ti je odsutnost {startDate}–{endDate}.',
    action: 'Otvori Godišnji',
  },
  leaveRecordedHalfFirst: {
    subject: 'Upisana ti je odsutnost {startDate}–{endDate} (prvi dio smjene)',
    body: '{organizationName}: upisana ti je odsutnost {startDate}–{endDate} (prvi dio smjene).',
    action: 'Otvori Godišnji',
  },
  leaveRecordedHalfSecond: {
    subject: 'Upisana ti je odsutnost {startDate}–{endDate} (drugi dio smjene)',
    body: '{organizationName}: upisana ti je odsutnost {startDate}–{endDate} (drugi dio smjene).',
    action: 'Otvori Godišnji',
  },
  leaveRecordChanged: {
    subject: 'Izmijenjena ti je odsutnost, sada {startDate}–{endDate}',
    body: '{organizationName}: tvoja odsutnost izmijenjena je na {startDate}–{endDate}.',
    action: 'Otvori Godišnji',
  },
  leaveRecordChangedHalfFirst: {
    subject: 'Izmijenjena ti je odsutnost, sada {startDate}–{endDate} (prvi dio smjene)',
    body: '{organizationName}: tvoja odsutnost izmijenjena je na {startDate}–{endDate} (prvi dio smjene).',
    action: 'Otvori Godišnji',
  },
  leaveRecordChangedHalfSecond: {
    subject: 'Izmijenjena ti je odsutnost, sada {startDate}–{endDate} (drugi dio smjene)',
    body: '{organizationName}: tvoja odsutnost izmijenjena je na {startDate}–{endDate} (drugi dio smjene).',
    action: 'Otvori Godišnji',
  },
  leaveRecordRemoved: {
    subject: 'Uklonjena ti je odsutnost {startDate}–{endDate}',
    body: '{organizationName}: uklonjena ti je odsutnost {startDate}–{endDate}.',
    action: 'Otvori Godišnji',
  },
  leaveRecordRemovedHalfFirst: {
    subject: 'Uklonjena ti je odsutnost {startDate}–{endDate} (prvi dio smjene)',
    body: '{organizationName}: uklonjena ti je odsutnost {startDate}–{endDate} (prvi dio smjene).',
    action: 'Otvori Godišnji',
  },
  leaveRecordRemovedHalfSecond: {
    subject: 'Uklonjena ti je odsutnost {startDate}–{endDate} (drugi dio smjene)',
    body: '{organizationName}: uklonjena ti je odsutnost {startDate}–{endDate} (drugi dio smjene).',
    action: 'Otvori Godišnji',
  },
  rosterPutOn: {
    subject: 'Promjena rasporeda {date}: na rasporedu si',
    body: '{organizationName}: upisana je promjena rasporeda koja te stavlja na raspored {date}.',
    action: 'Otvori kalendar',
  },
  rosterPutOnChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: izmijenjena je promjena rasporeda koja te stavlja na raspored {date}.',
    action: 'Otvori kalendar',
  },
  rosterPutOnRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: uklonjena je promjena rasporeda koja te stavila na raspored {date}.',
    action: 'Otvori kalendar',
  },
  rosterTakenOff: {
    subject: 'Promjena rasporeda {date}: nisi na rasporedu',
    body: '{organizationName}: upisana je promjena rasporeda koja te miče s rasporeda {date}.',
    action: 'Otvori kalendar',
  },
  rosterTakenOffChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: izmijenjena je promjena rasporeda koja te miče s rasporeda {date}.',
    action: 'Otvori kalendar',
  },
  rosterTakenOffRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: uklonjena je promjena rasporeda koja te maknula s rasporeda {date}.',
    action: 'Otvori kalendar',
  },
  teamShiftTypeSet: {
    subject: 'Promjena rasporeda {date}',
    body: '{organizationName}: za {date} vrijedi {shiftTypeName} umjesto rasporeda po rotaciji.',
    action: 'Otvori kalendar',
  },
  teamShiftTypeChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: za {date} sada vrijedi {shiftTypeName} umjesto rasporeda po rotaciji.',
    action: 'Otvori kalendar',
  },
  teamShiftTypeRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: za {date} ponovno vrijedi raspored po rotaciji.',
    action: 'Otvori kalendar',
  },
  rotationChanges: {
    subject: 'Nova rotacija od {effectiveFrom}',
    body: '{organizationName}: od {effectiveFrom} vrijedi nova rotacija.',
    action: 'Otvori kalendar',
  },
  rotationChangeCancelled: {
    subject: 'Otkazana promjena rotacije od {effectiveFrom}',
    body: '{organizationName}: promjena rotacije zakazana od {effectiveFrom} je otkazana.',
    action: 'Otvori kalendar',
  },
  leaveRequestCreated: {
    subject: 'Novi zahtjev za odsutnost: {memberName}',
    body: '{organizationName}: {memberName} traži odsutnost {startDate}–{endDate}.',
    action: 'Odluči o zahtjevu',
  },
  leaveRequestCreatedHalfFirst: {
    subject: 'Novi zahtjev za odsutnost: {memberName}',
    body: '{organizationName}: {memberName} traži odsutnost {startDate}–{endDate} (prvi dio smjene).',
    action: 'Odluči o zahtjevu',
  },
  leaveRequestCreatedHalfSecond: {
    subject: 'Novi zahtjev za odsutnost: {memberName}',
    body: '{organizationName}: {memberName} traži odsutnost {startDate}–{endDate} (drugi dio smjene).',
    action: 'Odluči o zahtjevu',
  },
  swapRequestProposed: {
    subject: 'Predložena ti je zamjena {date}',
    body: '{organizationName}: predložena ti je zamjena smjene {date}.',
    action: 'Odgovori na prijedlog',
  },
  swapRequestProposedWithReturn: {
    subject: 'Predložena ti je zamjena {date} (zauzvrat {returnDate})',
    body: '{organizationName}: predložena ti je zamjena smjene {date} (zauzvrat {returnDate}).',
    action: 'Odgovori na prijedlog',
  },
  swapRequestAccepted: {
    subject: 'Zamjena {date} je prihvaćena',
    body: '{organizationName}: tvoj prijedlog zamjene smjene {date} je prihvaćen i čeka odluku.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestAcceptedWithReturn: {
    subject: 'Zamjena {date} (zauzvrat {returnDate}) je prihvaćena',
    body: '{organizationName}: tvoj prijedlog zamjene smjene {date} (zauzvrat {returnDate}) je prihvaćen i čeka odluku.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestDeclined: {
    subject: 'Zamjena {date} je odbijena',
    body: '{organizationName}: tvoj prijedlog zamjene smjene {date} je odbijen.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestDeclinedWithReturn: {
    subject: 'Zamjena {date} (zauzvrat {returnDate}) je odbijena',
    body: '{organizationName}: tvoj prijedlog zamjene smjene {date} (zauzvrat {returnDate}) je odbijen.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestWaiting: {
    subject: 'Nova zamjena za odluku: {proposerName} → {addresseeName}',
    body: '{organizationName}: zamjena smjene {date}, {proposerName} → {addresseeName}.',
    action: 'Odluči o zamjeni',
  },
  swapRequestApproved: {
    subject: 'Zamjena {date} je odobrena',
    body: '{organizationName}: zamjena smjene {date} je odobrena.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestApprovedWithReturn: {
    subject: 'Zamjena {date} (zauzvrat {returnDate}) je odobrena',
    body: '{organizationName}: zamjena smjene {date} (zauzvrat {returnDate}) je odobrena.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestRejected: {
    subject: 'Zamjena {date} nije odobrena',
    body: '{organizationName}: zamjena smjene {date} nije odobrena.',
    action: 'Pogledaj zamjenu',
  },
  swapRequestRejectedWithReturn: {
    subject: 'Zamjena {date} (zauzvrat {returnDate}) nije odobrena',
    body: '{organizationName}: zamjena smjene {date} (zauzvrat {returnDate}) nije odobrena.',
    action: 'Pogledaj zamjenu',
  },
  loanMade: {
    subject: 'Od {startDate} do {endDate} radiš u timu {teamName}',
    body: '{organizationName}: od {startDate} do {endDate} radiš u timu {teamName}.',
    action: 'Otvori kalendar',
  },
  loanChanged: {
    subject: 'Posudba je izmijenjena: od {startDate} do {endDate} radiš u timu {teamName}',
    body: '{organizationName}: tvoja posudba je izmijenjena. Od {startDate} do {endDate} radiš u timu {teamName}.',
    action: 'Otvori kalendar',
  },
  loanRemoved: {
    subject: 'Posudba u timu {teamName} je uklonjena',
    body: '{organizationName}: posudba u timu {teamName} od {startDate} do {endDate} je uklonjena.',
    action: 'Otvori kalendar',
  },
  scheduleAssigned: {
    subject: 'Raspored ti je izmijenjen od {from} do {to}',
    body: '{organizationName}: raspored ti je izmijenjen od {from} do {to} (izmijenjenih dana: {days}).',
    action: 'Otvori kalendar',
  },
  scheduleSourceTeam: {
    subject: 'Od {effectiveFrom} radiš po rotaciji tima',
    body: '{organizationName}: od {effectiveFrom} raspored ti slijedi rotaciju tima u kojem si.',
    action: 'Otvori kalendar',
  },
  scheduleSourcePersonal: {
    subject: 'Od {effectiveFrom} radiš po osobnoj rotaciji',
    body: '{organizationName}: od {effectiveFrom} radiš po svojoj osobnoj rotaciji, neovisno o rotaciji tima.',
    action: 'Otvori kalendar',
  },
  scheduleSourceManual: {
    subject: 'Od {effectiveFrom} raspored ti se slaže ručno',
    body: '{organizationName}: od {effectiveFrom} radiš samo dane koje ti administrator dodijeli u rasporedu.',
    action: 'Otvori kalendar',
  },
  footer: {
    reason: 'Ovu poruku primaš jer su ti u organizaciji {organizationName} uključene obavijesti e-poštom.',
    settings: 'Obavijesti e-poštom isključuješ u aplikaciji, pod Obavijesti',
  },
  email: {
    brand: 'Smjenko',
    fallback: 'Ako gumb ne radi, otvori ovu poveznicu:',
  },
} as const;

/**
 * Story 17.3: the shift reminder's text. A COPY of `hr.json`'s
 * `reminders.notice`, pinned deep-equal by `test/notify-reminder.test.ts`, as
 * {@link OBAVIJESTI} is to `obavijesti`. Edit `hr.json` first, then this.
 * `hours` names the lead in hours (`Za 2 h radiš: …`); `eveningBefore` is the
 * 20:00 reminder (`Sutra radiš: …`); `footer` ends every reminder email,
 * pointing to *Obavijesti → Podsjetnici*.
 */
export const PODSJETNICI = {
  hours: {
    subject: 'Za {leadHours} h radiš: {shiftTypeName} {start}–{end}, {teamName}',
    body: '{organizationName}: za {leadHours} h, {date}, radiš: {shiftTypeName} {start}–{end}, {teamName}.',
    action: 'Otvori dan u kalendaru',
  },
  eveningBefore: {
    subject: 'Sutra radiš: {shiftTypeName} {start}–{end}, {teamName}',
    body: '{organizationName}: sutra, {date}, radiš: {shiftTypeName} {start}–{end}, {teamName}.',
    action: 'Otvori dan u kalendaru',
  },
  hoursNoTeam: {
    subject: 'Za {leadHours} h radiš: {shiftTypeName} {start}–{end}',
    body: '{organizationName}: za {leadHours} h, {date}, radiš: {shiftTypeName} {start}–{end}.',
    action: 'Otvori dan u kalendaru',
  },
  eveningBeforeNoTeam: {
    subject: 'Sutra radiš: {shiftTypeName} {start}–{end}',
    body: '{organizationName}: sutra, {date}, radiš: {shiftTypeName} {start}–{end}.',
    action: 'Otvori dan u kalendaru',
  },
  footer: {
    reason: 'Ovaj podsjetnik primaš jer su ti u organizaciji {organizationName} uključeni podsjetnici e-poštom.',
    settings: 'Podsjetnike e-poštom isključuješ u aplikaciji, pod Obavijesti → Podsjetnici',
  },
} as const;

/** The code `remind` writes (0070), rendered from {@link PODSJETNICI}. */
export const REMINDER_CODE = 'SHIFT_REMINDER';

/**
 * The lead codes, as `@shift/domain`'s `REMINDER_LEADS` spells them (AD-18:
 * one closed set). A copy, because this module imports nothing; held equal to
 * the domain's by `test/notify-reminder.test.ts`.
 */
export const REMINDER_LEADS = ['H1', 'H2', 'H3', 'H6', 'H12', 'EVENING_BEFORE'] as const;

export type ReminderLeadCode = (typeof REMINDER_LEADS)[number];

export type ReminderNoticeKey = Exclude<keyof typeof PODSJETNICI, 'footer'>;

/**
 * The hours each `H<n>` lead names, as `@shift/domain`'s `REMINDER_LEAD_HOURS`
 * (held equal by `test/notify-reminder.test.ts`). A row whose `leadHours`
 * disagrees with its lead is refused rather than telling the wrong time.
 */
export const REMINDER_LEAD_HOURS: Readonly<Record<Exclude<ReminderLeadCode, 'EVENING_BEFORE'>, number>> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H6: 6,
  H12: 12,
};

/** `startsAt` as 0070 writes it: a whole-second UTC instant. */
export const STARTS_AT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * The text each lead renders with (AD-18: "the variant from the lead"). An
 * `H<n>` lead names its hours through the row's `leadHours`; the evening
 * before names none.
 */
export const REMINDER_VARIANT_OF: Readonly<Record<ReminderLeadCode, 'hours' | 'eveningBefore'>> = {
  H1: 'hours',
  H2: 'hours',
  H3: 'hours',
  H6: 'hours',
  H12: 'hours',
  EVENING_BEFORE: 'eveningBefore',
};

/**
 * Story 21.2 (AD-18 as amended): the variant a reminder of a Personal Shift
 * counted with no team renders with. Its row carries neither `teamId` nor
 * `teamName` (0077); the text names no team and the link no `danSmjena`.
 */
export const REMINDER_NO_TEAM_VARIANT_OF: Readonly<Record<'hours' | 'eveningBefore', ReminderNoticeKey>> = {
  hours: 'hoursNoTeam',
  eveningBefore: 'eveningBeforeNoTeam',
};

/**
 * A message an outbox code renders with. `footer` is not one: it is the lines
 * every email ends with (story 10.3), linking to the settings; nor is `email`,
 * the HTML part's own words (story 21.27).
 */
export type MessageKey = Exclude<keyof typeof OBAVIJESTI, 'footer' | 'email'>;

/** The surface the footer links to: the member's own notification settings. */
export const SETTINGS_PATH = '/obavijesti';

/**
 * The resources by language. One today, as in the SPA. A locale with no
 * resource of its own renders in Croatian, as the SPA does.
 */
const MESSAGES_BY_LANGUAGE: Readonly<Record<string, typeof OBAVIJESTI>> = { hr: OBAVIJESTI };

/** The reminder's text by language, on the same terms (story 17.3). */
const REMINDERS_BY_LANGUAGE: Readonly<Record<string, typeof PODSJETNICI>> = { hr: PODSJETNICI };

const FALLBACK_LANGUAGE = 'hr';

/** Each outbox code `notify` can render, and the message it renders with. */
export const MESSAGE_OF_CODE: Readonly<Record<string, MessageKey>> = {
  LEAVE_REQUEST_APPROVED: 'leaveRequestApproved',
  LEAVE_REQUEST_REJECTED: 'leaveRequestRejected',
  LEAVE_RECORDED: 'leaveRecorded',
  LEAVE_RECORD_CHANGED: 'leaveRecordChanged',
  LEAVE_RECORD_REMOVED: 'leaveRecordRemoved',
  ROSTER_PUT_ON: 'rosterPutOn',
  ROSTER_PUT_ON_CHANGED: 'rosterPutOnChanged',
  ROSTER_PUT_ON_REMOVED: 'rosterPutOnRemoved',
  ROSTER_TAKEN_OFF: 'rosterTakenOff',
  ROSTER_TAKEN_OFF_CHANGED: 'rosterTakenOffChanged',
  ROSTER_TAKEN_OFF_REMOVED: 'rosterTakenOffRemoved',
  TEAM_SHIFT_TYPE_SET: 'teamShiftTypeSet',
  TEAM_SHIFT_TYPE_CHANGED: 'teamShiftTypeChanged',
  TEAM_SHIFT_TYPE_REMOVED: 'teamShiftTypeRemoved',
  ROTATION_CHANGES: 'rotationChanges',
  ROTATION_CHANGE_CANCELLED: 'rotationChangeCancelled',
  LEAVE_REQUEST_CREATED: 'leaveRequestCreated',
  SWAP_REQUEST_PROPOSED: 'swapRequestProposed',
  SWAP_REQUEST_ACCEPTED: 'swapRequestAccepted',
  SWAP_REQUEST_DECLINED: 'swapRequestDeclined',
  SWAP_REQUEST_WAITING: 'swapRequestWaiting',
  SWAP_REQUEST_APPROVED: 'swapRequestApproved',
  SWAP_REQUEST_REJECTED: 'swapRequestRejected',
  // Story 18.3 (0063): the lent member, told of the loan.
  LOAN_MADE: 'loanMade',
  // Story 18.4 (0064): one notice for an amend, one for a removal.
  LOAN_CHANGED: 'loanChanged',
  LOAN_REMOVED: 'loanRemoved',
  // Story 21.2 (0077, E-3): one notice per member per personal-assignment save.
  SCHEDULE_ASSIGNED: 'scheduleAssigned',
  // Story 21.10 (0079, E-3): a member's schedule source from a date; the
  // message is the one {@link SOURCE_VARIANT_OF} picks by the row's `source`.
  SCHEDULE_SOURCE_CHANGED: 'scheduleSourceTeam',
};

/**
 * Story 21.10 (0079): the message a `SCHEDULE_SOURCE_CHANGED` row renders
 * with, by its `source` operand — `TEAM`, `PERSONAL` or `MANUAL`, the source
 * in force from `effectiveFrom` (an insert's own, or after a cancel the one it
 * restores). A row with any other `source`, or none, is refused: the renderer
 * has no ICU to word a code. A code with no entry here ignores `source`.
 */
export const SOURCE_VARIANT_OF: Readonly<Partial<Record<MessageKey, { readonly TEAM: MessageKey; readonly PERSONAL: MessageKey; readonly MANUAL: MessageKey }>>> = {
  scheduleSourceTeam: { TEAM: 'scheduleSourceTeam', PERSONAL: 'scheduleSourcePersonal', MANUAL: 'scheduleSourceManual' },
};

/**
 * The message a two-way swap's notice renders with instead of its code's own
 * (epic 12 retro, R6): the same text naming the return shift too. Chosen only
 * when the operands carry a string `returnDate` (0050, 0051 write one for a
 * two-way swap); a malformed one is refused as any other date operand. A
 * variant rather than conditional text: the renderer refuses a missing operand
 * and has no ICU, and a one-way notice renders exactly as before.
 * `swapRequestWaiting` has none: 0051 writes no `returnDate` for it.
 */
export const RETURN_VARIANT_OF: Readonly<Partial<Record<MessageKey, MessageKey>>> = {
  swapRequestProposed: 'swapRequestProposedWithReturn',
  swapRequestAccepted: 'swapRequestAcceptedWithReturn',
  swapRequestDeclined: 'swapRequestDeclinedWithReturn',
  swapRequestApproved: 'swapRequestApprovedWithReturn',
  swapRequestRejected: 'swapRequestRejectedWithReturn',
};

/**
 * The message a half-day leave notice renders with instead of its code's own
 * (story 13.7b): the same text with the half after the range, as the app names
 * it (13.7). Chosen when the operands carry `half` (0060 writes `FIRST` or
 * `SECOND` from the row; a whole day carries no `half` key and renders exactly
 * as before). A `half` that is neither value, or a `half` on a code with no
 * half variant, is refused. A code is never in both this map and
 * {@link RETURN_VARIANT_OF}, so the half lookup by the code's key cannot
 * overwrite a return variant.
 */
export const HALF_VARIANT_OF: Readonly<Partial<Record<MessageKey, { readonly FIRST: MessageKey; readonly SECOND: MessageKey }>>> = {
  leaveRequestApproved: { FIRST: 'leaveRequestApprovedHalfFirst', SECOND: 'leaveRequestApprovedHalfSecond' },
  leaveRequestRejected: { FIRST: 'leaveRequestRejectedHalfFirst', SECOND: 'leaveRequestRejectedHalfSecond' },
  leaveRecorded: { FIRST: 'leaveRecordedHalfFirst', SECOND: 'leaveRecordedHalfSecond' },
  leaveRecordChanged: { FIRST: 'leaveRecordChangedHalfFirst', SECOND: 'leaveRecordChangedHalfSecond' },
  leaveRecordRemoved: { FIRST: 'leaveRecordRemovedHalfFirst', SECOND: 'leaveRecordRemovedHalfSecond' },
  leaveRequestCreated: { FIRST: 'leaveRequestCreatedHalfFirst', SECOND: 'leaveRequestCreatedHalfSecond' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The in-app path of the surface a message links to, from the row's operands
 * (the request's id for a new leave request or a swap waiting for a
 * decision), or `null` when the operands do not name one.
 */
export function linkPathOf(key: MessageKey, operands: Readonly<Record<string, unknown>>): string | null {
  switch (key) {
    case 'leaveRequestApproved':
    case 'leaveRequestRejected':
    case 'leaveRecorded':
    case 'leaveRecordChanged':
    case 'leaveRecordRemoved':
    case 'leaveRequestApprovedHalfFirst':
    case 'leaveRequestApprovedHalfSecond':
    case 'leaveRequestRejectedHalfFirst':
    case 'leaveRequestRejectedHalfSecond':
    case 'leaveRecordedHalfFirst':
    case 'leaveRecordedHalfSecond':
    case 'leaveRecordChangedHalfFirst':
    case 'leaveRecordChangedHalfSecond':
    case 'leaveRecordRemovedHalfFirst':
    case 'leaveRecordRemovedHalfSecond':
      return '/godisnji';
    case 'rosterPutOn':
    case 'rosterPutOnChanged':
    case 'rosterPutOnRemoved':
    case 'rosterTakenOff':
    case 'rosterTakenOffChanged':
    case 'rosterTakenOffRemoved':
    case 'teamShiftTypeSet':
    case 'teamShiftTypeChanged':
    case 'teamShiftTypeRemoved':
    case 'rotationChanges':
    case 'rotationChangeCancelled':
    case 'loanMade':
    case 'loanChanged':
    case 'loanRemoved':
    case 'scheduleAssigned':
    case 'scheduleSourceTeam':
    case 'scheduleSourcePersonal':
    case 'scheduleSourceManual':
      return '/kalendar';
    case 'swapRequestProposed':
    case 'swapRequestAccepted':
    case 'swapRequestDeclined':
    case 'swapRequestApproved':
    case 'swapRequestRejected':
    case 'swapRequestProposedWithReturn':
    case 'swapRequestAcceptedWithReturn':
    case 'swapRequestDeclinedWithReturn':
    case 'swapRequestApprovedWithReturn':
    case 'swapRequestRejectedWithReturn':
      return '/danas';
    case 'leaveRequestCreated':
    case 'leaveRequestCreatedHalfFirst':
    case 'leaveRequestCreatedHalfSecond': {
      const id = operands['requestId'];
      return typeof id === 'string' && UUID.test(id) ? `/za-odluku/zahtjev/${id.toLowerCase()}` : null;
    }
    case 'swapRequestWaiting': {
      const id = operands['requestId'];
      return typeof id === 'string' && UUID.test(id) ? `/za-odluku/zamjena/${id.toLowerCase()}` : null;
    }
  }
}

/**
 * Story 17.3: the day a reminder is about, opened in *Kalendar* on that team
 * (`?mjesec=…&dan=…&danSmjena=…`, as the calendar's own day links), or `null`
 * when the operands do not name a real date and a team id. Story 21.2: a row
 * with no `teamId` key at all (a Personal Shift counted with no team) opens
 * the day alone (`?mjesec=…&dan=…`).
 */
export function reminderPathOf(operands: Readonly<Record<string, unknown>>): string | null {
  const date = operands['date'];
  if (typeof date !== 'string' || formatIsoDate(date) === null) return null;
  if (!Object.hasOwn(operands, 'teamId')) return `/kalendar?mjesec=${date.slice(0, 7)}&dan=${date}`;
  const teamId = operands['teamId'];
  if (typeof teamId !== 'string' || !UUID.test(teamId)) return null;
  return `/kalendar?mjesec=${date.slice(0, 7)}&dan=${date}&danSmjena=${teamId.toLowerCase()}`;
}

/** The organization a row belongs to, as the claim returns it. */
export interface RenderTarget {
  /** The app's origin; a trailing slash is ignored. */
  readonly appUrl: string;
  /** The organization's slug: the sign-in link names it. */
  readonly slug: string | null;
  /** The organization's name: every body names it. */
  readonly organizationName: string | null;
}

/**
 * The link an email carries: the organization's sign-in route, returning to
 * the surface (`/prijava/<slug>?povratak=<path>`). A signed-in visitor is
 * sent straight on; anyone else signs in first, into the right organization.
 */
export function linkOf(appUrl: string, slug: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${signInPathOf(slug, path)}`;
}

/**
 * The same sign-in link with no origin (`/prijava/<slug>?povratak=<path>`):
 * what a push carries (retro 10 A6). The service worker resolves it on its own
 * origin, so a deployment serving the app from more than one origin never
 * loses the deep link to `SHIFT_APP_URL`'s.
 */
export function signInPathOf(slug: string, path: string): string {
  return `/prijava/${encodeURIComponent(slug)}?povratak=${encodeURIComponent(path)}`;
}

/** No message is known for the row's code: a code `notify` cannot render. */
export const MESSAGE_UNKNOWN = 'MESSAGE_UNKNOWN';
/** The message names an operand the row does not carry, or carries as other than a string or number. */
export const OPERANDS_INVALID = 'OPERANDS_INVALID';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The operands that are ISO calendar dates, by name, and the only ones
 * formatted as dates. A name (a member's, a shift type's) is text, however
 * much it looks like a date.
 */
const DATE_OPERANDS: ReadonlySet<string> = new Set(['startDate', 'endDate', 'date', 'effectiveFrom', 'returnDate', 'from', 'to']);

/**
 * Story 17.3: the operands that are minutes of a shift (AD-6: integer minutes
 * since the shift date's midnight), by name, and the only ones formatted as a
 * clock time, for a reminder only: its `start` and `end` (0070). Any other
 * code renders exactly as before, whatever its operands are named.
 */
const TIME_OPERANDS: ReadonlySet<string> = new Set(['start', 'end']);

/** The last minute a shift's interval may name: the end of the next day (0070's `<= 2879`). */
export const LAST_SHIFT_MINUTE = 2879;

const MINUTES_PER_DAY = 1440;

/**
 * A minute of a shift as a clock time: `420` → `07:00`, `1500` → `01:00` (a
 * night's second half, past midnight), as `apps/web`'s `formatMinuteOfDay`
 * shows `minute mod 1440`. `null` for anything that is not a whole minute in
 * `0 … 2879`.
 */
export function formatMinute(minute: unknown): string | null {
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > LAST_SHIFT_MINUTE) return null;
  const ofDay = minute % MINUTES_PER_DAY;
  return `${String(Math.floor(ofDay / 60)).padStart(2, '0')}:${String(ofDay % 60).padStart(2, '0')}`;
}

/**
 * `2026-09-23` → `23.09.2026`, as `apps/web`'s `formatIsoDate`. `null` for a
 * string that is not a real calendar date, so a malformed value is a case
 * rather than `NaN.NaN.NaN`.
 */
export function formatIsoDate(isoDate: string): string | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;

  const [, year = '', month = '', day = ''] = match;
  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  // `Date.UTC` maps years 0–99 to 1900–1999; set the full year explicitly.
  instant.setUTCFullYear(Number(year));

  const valid =
    Number(year) >= 1 &&
    instant.getUTCFullYear() === Number(year) &&
    instant.getUTCMonth() === Number(month) - 1 &&
    instant.getUTCDate() === Number(day);

  return valid ? `${day}.${month}.${year}` : null;
}

/**
 * Story 21.27: the language a message renders in, as `compose` resolves it:
 * the locale's own when there is a resource for it, else the fallback. One
 * resource table decides for the email's own words and the reminder alike:
 * both hold Croatian alone, and a language added to one is added to both.
 */
function renderedLanguageOf(language: string): string {
  return Object.hasOwn(MESSAGES_BY_LANGUAGE, language) ? language : FALLBACK_LANGUAGE;
}

/** The language subtag of a BCP 47 tag, lowercased: `hr-HR` → `hr`. */
function languageOf(locale: string | null): string {
  return (locale ?? '').split('-')[0]?.trim().toLowerCase() ?? '';
}

function interpolate(template: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : text;
}

export type Rendered =
  | { readonly ok: true; readonly subject: string; readonly text: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

/**
 * A push notification's payload (story 10.4): the email's subject as the
 * title, its body WITHOUT the footer (the footer speaks of email), and the
 * same sign-in link to the surface as a PATH (retro 10 A6), which the service
 * worker opens on its own origin on a tap. The body's own text still names the
 * absolute link, as the email's does.
 */
export type RenderedPush =
  | { readonly ok: true; readonly title: string; readonly body: string; readonly url: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

type Composed =
  | {
      readonly ok: true;
      readonly subject: string;
      /** The message, without its link. */
      readonly body: string;
      /** The button's label; the text says it before the link. */
      readonly action: string;
      readonly link: string;
      readonly linkPath: string;
      /** Why the email came, naming the organization. */
      readonly reason: string;
      /** Where email is turned off; the text says it before the settings link. */
      readonly settings: string;
      readonly settingsLink: string;
      /** Story 21.27: the language the message was rendered in, which the HTML part's own words follow. */
      readonly language: string;
    }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

/** The parts one row renders to, shared by the email and the push. */
function compose(code: string, locale: string | null, operands: unknown, target: RenderTarget): Composed {
  const isReminder = code === REMINDER_CODE;
  const codeKey = !isReminder && Object.hasOwn(MESSAGE_OF_CODE, code) ? MESSAGE_OF_CODE[code] : undefined;
  if (!isReminder && codeKey === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  const language = languageOf(locale);
  const messages = MESSAGES_BY_LANGUAGE[language] ?? MESSAGES_BY_LANGUAGE[FALLBACK_LANGUAGE];
  if (messages === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  if (operands === null || typeof operands !== 'object' || Array.isArray(operands)) {
    return { ok: false, code: OPERANDS_INVALID };
  }

  const slug = (target.slug ?? '').trim();
  const organizationName = (target.organizationName ?? '').trim();
  if (slug === '' || organizationName === '') return { ok: false, code: OPERANDS_INVALID };

  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(operands as Record<string, unknown>)) {
    if (isReminder && TIME_OPERANDS.has(name)) {
      // 17.3: a minute of the shift, or the row is refused, never `NaN:NaN`.
      const formatted = formatMinute(value);
      if (formatted === null) return { ok: false, code: OPERANDS_INVALID };
      values[name] = formatted;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      values[name] = String(value);
    } else if (typeof value === 'string' && DATE_OPERANDS.has(name)) {
      const formatted = formatIsoDate(value);
      if (formatted === null) return { ok: false, code: OPERANDS_INVALID };
      values[name] = formatted;
    } else if (typeof value === 'string') {
      values[name] = value;
    }
  }

  if (isReminder) {
    return composeReminder(language, operands as Record<string, unknown>, values, target.appUrl, slug, organizationName);
  }
  if (codeKey === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  const variant = RETURN_VARIANT_OF[codeKey];
  let key = variant !== undefined && typeof (operands as Record<string, unknown>)['returnDate'] === 'string' ? variant : codeKey;

  // 0060: a half day names its half; no `half` key is a whole day.
  if (Object.hasOwn(operands, 'half')) {
    const half = (operands as Record<string, unknown>)['half'];
    if (half !== 'FIRST' && half !== 'SECOND') return { ok: false, code: OPERANDS_INVALID };
    // A code with no half variant is never written with a `half`.
    const halfVariant = HALF_VARIANT_OF[codeKey];
    if (halfVariant === undefined) return { ok: false, code: OPERANDS_INVALID };
    key = halfVariant[half];
  }

  // 0079: a schedule source's notice says which source, by its own message.
  const sourceVariant = SOURCE_VARIANT_OF[codeKey];
  if (sourceVariant !== undefined) {
    const source = (operands as Record<string, unknown>)['source'];
    if (source !== 'TEAM' && source !== 'PERSONAL' && source !== 'MANUAL') return { ok: false, code: OPERANDS_INVALID };
    key = sourceVariant[source];
  }

  const path = linkPathOf(key, operands as Record<string, unknown>);
  if (path === null) return { ok: false, code: OPERANDS_INVALID };
  const link = linkOf(target.appUrl, slug, path);
  values['organizationName'] = organizationName;
  values['link'] = link;

  const message = messages[key];
  const subject = interpolate(message.subject, values);
  const body = interpolate(message.body, values);
  const action = interpolate(message.action, values);
  const reason = interpolate(messages.footer.reason, { organizationName });
  if (subject === null || body === null || action === null || reason === null) return { ok: false, code: OPERANDS_INVALID };

  return {
    ok: true,
    subject,
    body,
    action,
    link,
    linkPath: signInPathOf(slug, path),
    reason,
    settings: messages.footer.settings,
    settingsLink: linkOf(target.appUrl, slug, SETTINGS_PATH),
    language: renderedLanguageOf(language),
  };
}

/**
 * Story 17.3: a shift reminder's parts. The variant is the lead's
 * ({@link REMINDER_VARIANT_OF}); the names, the date and the minutes are the
 * row's, as `enqueue_shift_reminders` wrote them; the link opens the day, and
 * the footer is the reminder's own. A lead outside the set, a blank name, a
 * missing minute, a `leadHours` that is not its lead's, or an unreadable
 * `startsAt` refuses the row.
 */
function composeReminder(
  language: string,
  operands: Readonly<Record<string, unknown>>,
  values: Record<string, string>,
  appUrl: string,
  slug: string,
  organizationName: string,
): Composed {
  const reminders = REMINDERS_BY_LANGUAGE[language] ?? REMINDERS_BY_LANGUAGE[FALLBACK_LANGUAGE];
  if (reminders === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  const lead = operands['lead'];
  const leadKey = typeof lead === 'string' && Object.hasOwn(REMINDER_VARIANT_OF, lead) ? REMINDER_VARIANT_OF[lead as ReminderLeadCode] : undefined;
  if (leadKey === undefined) return { ok: false, code: OPERANDS_INVALID };
  // Story 21.2: a row with neither `teamId` nor `teamName` is a teamless Personal Shift's; one without the other is refused.
  const teamless = !Object.hasOwn(operands, 'teamId') && !Object.hasOwn(operands, 'teamName');
  if (!teamless && (!Object.hasOwn(operands, 'teamId') || !Object.hasOwn(operands, 'teamName'))) return { ok: false, code: OPERANDS_INVALID };
  const key: ReminderNoticeKey = teamless ? REMINDER_NO_TEAM_VARIANT_OF[leadKey] : leadKey;
  for (const name of teamless ? ['shiftTypeName'] : ['shiftTypeName', 'teamName']) {
    const text = operands[name];
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, code: OPERANDS_INVALID };
  }
  // Both ends are needed, and only as minutes: a missing one is never `00:00`.
  if (values['start'] === undefined || values['end'] === undefined) return { ok: false, code: OPERANDS_INVALID };
  if (leadKey === 'hours') {
    // The hours the text names are the lead's own: a disagreeing row is refused.
    const hours = operands['leadHours'];
    if (hours !== REMINDER_LEAD_HOURS[lead as Exclude<ReminderLeadCode, 'EVENING_BEFORE'>]) return { ok: false, code: OPERANDS_INVALID };
  }
  const startsAt = operands['startsAt'];
  if (typeof startsAt !== 'string' || !STARTS_AT_SHAPE.test(startsAt) || !Number.isFinite(Date.parse(startsAt))) {
    return { ok: false, code: OPERANDS_INVALID };
  }

  const path = reminderPathOf(operands);
  if (path === null) return { ok: false, code: OPERANDS_INVALID };
  const link = linkOf(appUrl, slug, path);
  values['organizationName'] = organizationName;
  values['link'] = link;

  const message = reminders[key];
  const subject = interpolate(message.subject, values);
  const body = interpolate(message.body, values);
  const action = interpolate(message.action, values);
  const reason = interpolate(reminders.footer.reason, { organizationName });
  if (subject === null || body === null || action === null || reason === null) return { ok: false, code: OPERANDS_INVALID };

  return {
    ok: true,
    subject,
    body,
    action,
    link,
    linkPath: signInPathOf(slug, path),
    reason,
    settings: reminders.footer.settings,
    settingsLink: linkOf(appUrl, slug, SETTINGS_PATH),
    language: renderedLanguageOf(language),
  };
}

/**
 * One outbox row's email, in the organization's language, naming the
 * organization and linking through its sign-in route to the surface. Every
 * body ends with the footer (story 10.3; its reason since 21.27), linking the
 * same way to `/obavijesti`, where the member turns email off. This is the
 * plain-text part; {@link renderEmail} adds the HTML.
 */
export function render(code: string, locale: string | null, operands: unknown, target: RenderTarget): Rendered {
  const composed = compose(code, locale, operands, target);
  if (!composed.ok) return composed;

  return { ok: true, subject: composed.subject, text: textOf(composed) };
}

/** The message and its link, on one line: the plain text's first paragraph and the push's body. */
function messageLineOf(composed: Extract<Composed, { ok: true }>): string {
  return `${composed.body} ${composed.action}: ${composed.link}`;
}

/** The plain-text part: the message line, then the footer's two lines. */
function textOf(composed: Extract<Composed, { ok: true }>): string {
  return `${messageLineOf(composed)}\n\n${composed.reason}\n${composed.settings}: ${composed.settingsLink}`;
}

export type RenderedEmail =
  | { readonly ok: true; readonly subject: string; readonly text: string; readonly html: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

/**
 * Story 21.27 (UX-DR85): one outbox row's email with both parts, the plain
 * text {@link render} returns and the HTML drawn in `email-layout.ts`: the
 * mark from `<appUrl>/email-mark.png`, the subject as the heading, the
 * message, the action as the button to the same sign-in link, and the footer
 * (the reason, then the settings line as a link). Every text is escaped by
 * the layout; nothing here writes HTML.
 */
export function renderEmail(code: string, locale: string | null, operands: unknown, target: RenderTarget): RenderedEmail {
  const composed = compose(code, locale, operands, target);
  if (!composed.ok) return composed;

  // The words around the message follow the language it was rendered in.
  const messages = MESSAGES_BY_LANGUAGE[composed.language] ?? OBAVIJESTI;
  const html = emailHtml({
    lang: composed.language,
    title: composed.subject,
    preheader: composed.body,
    brand: messages.email.brand,
    markUrl: `${target.appUrl.replace(/\/+$/, '')}/${EMAIL_MARK_FILE}`,
    heading: composed.subject,
    paragraphs: [composed.body],
    action: { label: composed.action, href: composed.link },
    fallback: messages.email.fallback,
    notes: [],
    footer: { lines: [composed.reason], link: { label: composed.settings, href: composed.settingsLink } },
  });
  return { ok: true, subject: composed.subject, text: textOf(composed), html };
}

/**
 * One outbox row's push payload (story 10.4): the same text as the email, by
 * the same code and operands, without the email's footer, and the path the
 * notification opens on the worker's origin.
 */
export function renderPush(code: string, locale: string | null, operands: unknown, target: RenderTarget): RenderedPush {
  const composed = compose(code, locale, operands, target);
  if (!composed.ok) return composed;

  return { ok: true, title: composed.subject, body: messageLineOf(composed), url: composed.linkPath };
}
