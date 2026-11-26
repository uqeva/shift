import type { NationalHolidayCode } from '@shift/domain';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, type CalendarHoliday } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  ASK_ADD,
  ASK_IMPORT,
  ASK_REMOVE,
  CHANGE_ADD,
  CONFIRM_ERASURES,
  CONFIRM_SHOW_AGAIN,
  HOLIDAY_NOTHING_NEW,
  HOLIDAY_STALE,
  holidayCheckOf,
  holidayConfirmStepOf,
  type HolidayAsk,
  type HolidayChange,
  type HolidayCheckReady,
} from '@/features/holidays/services/holiday-check';
import {
  HOLIDAYS_TABLE,
  HOLIDAY_OPENING_ADD,
  HOLIDAY_OPENING_RENAME,
  HOLIDAY_TAKEN,
  holidaysOfYear,
  holidaysSurfaceStateOf,
  importProposalOf,
  isPastDate,
  nationalHolidayMessageKey,
  steppedYearOf,
  yearOf,
  type ImportProposal,
} from '@/features/holidays/services/holidays';
import {
  HOLIDAY_ADDED,
  HOLIDAY_RENAMED,
  HOLIDAY_UNCHECKED,
  HOLIDAY_WRITE_UNAVAILABLE,
  holidaySavedOf,
  holidayWriteTablesOf,
  marksHolidayName,
  renameHoliday,
  writeHolidayChange,
  type HolidayFailure,
  type HolidaySaved,
  type HolidaysWriteTable,
} from '@/features/holidays/services/write';
import {
  ORGANIZATION_HOLIDAYS_ADD_ID,
  ORGANIZATION_HOLIDAYS_HEADING_ID,
  ORGANIZATION_HOLIDAYS_IMPORT_ID,
  ORGANIZATION_HOLIDAY_DATE_FIELD_ID,
  ORGANIZATION_HOLIDAY_NAME_FIELD_ID,
  ORGANIZATION_HOLIDAY_SAVE_ID,
  organizationHolidayRemoveId,
} from '@/features/organization/utils/element-ids';
import { HOLIDAY_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite, retryRead } from '@/features/teams/services/dependents';
import { useOrganizationToday } from '@/hooks/organization-today';
import { t } from '@/lib/i18n';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/** The add or rename dialog's opening: a fresh key, so each opening draws its form afresh. */
export type HolidayOpening =
  | { readonly key: number; readonly kind: typeof HOLIDAY_OPENING_ADD }
  | { readonly key: number; readonly kind: typeof HOLIDAY_OPENING_RENAME; readonly holiday: CalendarHoliday };

/** What landed last, said on the card; an import says how many it added. */
export interface HolidaySavedLine {
  readonly saved: HolidaySaved;
  readonly count: number;
}

/** The element whose id this is, for a focus target. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/** The locale's official name of a national holiday's code (`hr.json`). */
export function nationalHolidayNameOf(code: NationalHolidayCode): string {
  return t(nationalHolidayMessageKey(code));
}

/** The card's heading: where focus lands when the control that started a change is gone. */
const HEADING = byId(ORGANIZATION_HOLIDAYS_HEADING_ID);

/** The control an ask was started from, for focus after its refusal. */
function originOf(ask: HolidayAsk): () => HTMLElement | null {
  switch (ask.kind) {
    case ASK_ADD:
      return byId(ORGANIZATION_HOLIDAYS_ADD_ID);
    case ASK_IMPORT:
      return byId(ORGANIZATION_HOLIDAYS_IMPORT_ID);
    case ASK_REMOVE:
      return byId(organizationHolidayRemoveId(ask.id));
    default:
      return HEADING;
  }
}

/**
 * *Blagdani* on *Organizacija* (story 21.17; UX-DR78): a year's holidays from
 * the calendar snapshot (21.16; no read of its own: Design Note 1), the year
 * picker, *Dodaj blagdan*, *Preimenuj*, *Ukloni*, and *Uvezi državne blagdane*.
 *
 * THE CARD ALONE WAITS FOR THE SNAPSHOT. It is no part of the page's one
 * snapshot (`ORGANIZATION_SURFACE_KEYS`): the other cards never wait for the
 * calendar read. The card has its own loading state, its own unavailable
 * state with a retry (online only), and draws the cached snapshot offline.
 *
 * EVERY WRITE BUT A RENAME GOES THROUGH THE AD-5 CHECK, built as *Raspored
 * osobe*'s (`useMemberScheduleSource`): one in-flight latch, the fresh check
 * on *Dalje* (or on *Ukloni*, *Uvezi*) and again on *Spremi*, decided by
 * `holidayConfirmStepOf` — a preview that changed since it was shown is shown
 * again and said so, never written unseen — the shared erasure confirmation
 * (only an erasure waits), the offline gate, and a landed write re-reading
 * the calendar and its dependents. A rename writes the name alone (AD-5
 * exempt) and re-reads the calendar alone. Every rule is
 * `@/features/holidays/services/*`'s.
 */
export function useOrganizationHolidays() {
  const queryClient = useQueryClient();
  const readErasures = useErasureReads();
  const openings = useRef(0);
  const working = useRef(false);
  const [pending, setPending] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [opening, setOpening] = useState<HolidayOpening | null>(null);
  const [draft, setDraft] = useState({ date: NO_TEXT, name: NO_TEXT });
  /** The dialog's refusal. */
  const [failure, setFailure] = useState<HolidayFailure | null>(null);
  /** A removal's, an import's or a save's refusal: on the card, or in the open preview. */
  const [cardFailure, setCardFailure] = useState<HolidayFailure | null>(null);
  const [saved, setSaved] = useState<HolidaySavedLine | null>(null);
  const [asked, setAsked] = useState<HolidayAsk | null>(null);
  const [checked, setChecked] = useState<HolidayCheckReady | null>(null);
  /** The preview on show is a changed one, shown again: it says so. */
  const [changedAgain, setChangedAgain] = useState(false);
  const erasures = useErasureConfirmation<HolidayChange>(pending, HEADING);
  /** What is open now, for a throw caught by the latch. */
  const open = useRef({ dialog: false, preview: false });

  useEffect(() => {
    open.current = { dialog: opening !== null, preview: checked !== null };
  });

  const calendarRead = useCalendarSnapshot();
  const state = holidaysSurfaceStateOf(calendarRead);
  const { calendar, unavailable, loading } = state;
  const { today } = useOrganizationToday(calendar?.timeZone ?? null);
  const shownYear = year ?? (today === null ? null : yearOf(today));
  const holidays: readonly CalendarHoliday[] | null =
    calendar === null || shownYear === null ? null : holidaysOfYear(calendar, shownYear);
  const proposal: ImportProposal | null =
    calendar === null || shownYear === null ? null : importProposalOf(calendar, shownYear, today, nationalHolidayNameOf);

  function clearNotes(): void {
    setFailure(null);
    setCardFailure(null);
    setSaved(null);
  }

  /** `‹` / `›`: the year before or after the one shown, kept within 1–9999. */
  function stepYear(by: number): void {
    if (shownYear === null || working.current) return;

    clearNotes();
    setYear(steppedYearOf(shownYear, by));
  }

  /** The card's read again, from its unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, CALENDAR_KEY);
  }

  function reopenAdd(): void {
    openings.current += 1;
    setOpening({ key: openings.current, kind: HOLIDAY_OPENING_ADD });
  }

  function openAdd(): void {
    if (working.current) return;

    clearNotes();
    setDraft({ date: NO_TEXT, name: NO_TEXT });
    reopenAdd();
  }

  function openRename(holiday: CalendarHoliday): void {
    if (working.current) return;

    clearNotes();
    openings.current += 1;
    setOpening({ key: openings.current, kind: HOLIDAY_OPENING_RENAME, holiday });
  }

  function close(): void {
    if (working.current) return;

    setOpening(null);
    setFailure(null);
  }

  /** The date as it is chosen: only for the past-date warning; the form is read on submit. */
  function noteDate(date: string): void {
    setDraft((current) => ({ ...current, date }));
  }

  /** A landed holiday write's re-read: not awaited, its failure logged, never the write's. */
  function refreshLanded(): void {
    refreshAfterWrite(queryClient, CALENDAR_KEY, HOLIDAY_WRITE_DEPENDENTS).catch((cause: unknown) => {
      console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);
    });
  }

  /** A rename's, or a stale refusal's, re-read: the calendar snapshot alone. */
  function refreshCalendar(): void {
    refreshAfterWrite(queryClient, CALENDAR_KEY, NO_DEPENDENTS).catch((cause: unknown) => {
      console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);
    });
  }

  /** Runs `step` under the one latch, pending while it does; a throw is said where the person is. */
  async function latched(step: () => Promise<void>, origin: () => HTMLElement | null): Promise<void> {
    if (working.current || !writesOnline()) return;

    working.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);
      if (open.current.dialog) {
        setFailure(HOLIDAY_WRITE_UNAVAILABLE);
        focusLater([byId(ORGANIZATION_HOLIDAY_SAVE_ID)], HEADING);
      } else {
        // The open preview shows the card's refusal; with none open, the card does.
        setCardFailure(HOLIDAY_WRITE_UNAVAILABLE);
        if (!open.current.preview) focusLater([origin], HEADING);
      }
    } finally {
      working.current = false;
      setPending(false);
    }
  }

  /** The fresh check of `ask`; its refusal (or an unavailable check) is handed to `refuse`. */
  async function check(ask: HolidayAsk, refuse: (code: HolidayFailure) => void): Promise<HolidayCheckReady | null> {
    const result = await holidayCheckOf(readErasures.readAndShare, ask, new Date(), onlineManager.isOnline(), nationalHolidayNameOf);

    if (result.kind === CHECK_UNAVAILABLE) {
      refuse(HOLIDAY_UNCHECKED);

      return null;
    }

    if (result.kind === CHECK_REFUSED) {
      refuse(result.code);
      if (result.code === HOLIDAY_STALE) refreshCalendar();

      return null;
    }

    return result;
  }

  /** A refusal said in the add dialog, focus on the field it is about. */
  function refuseInDialog(code: HolidayFailure): void {
    setFailure(code);
    focusLater(
      [byId(marksHolidayName(code) ? ORGANIZATION_HOLIDAY_NAME_FIELD_ID : ORGANIZATION_HOLIDAY_DATE_FIELD_ID), byId(ORGANIZATION_HOLIDAY_SAVE_ID)],
      HEADING,
    );
  }

  /** A refusal said on the card, focus on the control that started `ask`. */
  function refuseOnCard(ask: HolidayAsk): (code: HolidayFailure) => void {
    return (code) => {
      // A date taken between *Dalje* and *Spremi*: back to the dialog, the draft kept and the date marked.
      if (ask.kind === ASK_ADD && code === HOLIDAY_TAKEN) {
        reopenAdd();
        refuseInDialog(code);

        return;
      }

      setCardFailure(code);
      focusLater([originOf(ask)], HEADING);
    };
  }

  /** *Dodaj blagdan*'s *Dalje*: the date and name as entered, checked afresh, then *Što se mijenja*. */
  function next(date: string, name: string): Promise<void> {
    return latched(async () => {
      clearNotes();
      // Kept, so *Natrag* (or a refusal) reopens the dialog with what was entered.
      setDraft({ date, name });

      const ask: HolidayAsk = { kind: ASK_ADD, date, name };
      const ready = await check(ask, refuseInDialog);

      if (ready === null) return;

      setAsked(ask);
      setOpening(null);
      setChangedAgain(false);
      setChecked(ready);
    }, byId(ORGANIZATION_HOLIDAYS_ADD_ID));
  }

  /** *Ukloni* or *Uvezi*: checked afresh, then *Što se mijenja*. */
  function askOnCard(ask: HolidayAsk): Promise<void> {
    return latched(async () => {
      clearNotes();

      const ready = await check(ask, refuseOnCard(ask));

      if (ready === null) return;

      setAsked(ask);
      setChangedAgain(false);
      setChecked(ready);
    }, originOf(ask));
  }

  /** *Ukloni*: the removal checked afresh, then *Što se mijenja*. */
  function askRemove(holiday: CalendarHoliday): Promise<void> {
    return askOnCard({ kind: ASK_REMOVE, id: holiday.id, date: holiday.date, name: holiday.name });
  }

  /** *Uvezi državne blagdane za {godina}*: the year's missing dates checked afresh, then the preview. */
  function askImport(): Promise<void> {
    if (shownYear === null) return Promise.resolve();

    return askOnCard({ kind: ASK_IMPORT, year: shownYear });
  }

  /** The rename dialog's *Spremi*: the name alone, no check (AD-5 exempt). */
  function rename(name: string): Promise<void> {
    if (opening?.kind !== HOLIDAY_OPENING_RENAME) return Promise.resolve();

    const { holiday } = opening;

    return latched(async () => {
      clearNotes();

      const table = supabaseClient().from(HOLIDAYS_TABLE) as unknown as HolidaysWriteTable;
      const outcome = await renameHoliday(table, holiday, name);

      if (!outcome.ok && droppedOffline(outcome.code, HOLIDAY_WRITE_UNAVAILABLE)) {
        focusLater([byId(ORGANIZATION_HOLIDAY_SAVE_ID)], HEADING);

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        focusLater([byId(ORGANIZATION_HOLIDAY_NAME_FIELD_ID), byId(ORGANIZATION_HOLIDAY_SAVE_ID)], HEADING);
        if (outcome.code === HOLIDAY_STALE) refreshCalendar();

        return;
      }

      setOpening(null);
      setSaved({ saved: HOLIDAY_RENAMED, count: 1 });
      focusLater([HEADING], () => null);
      refreshCalendar();
    }, HEADING);
  }

  /** Write what the fresh check `ready` stood on, its tenant the reads' own. */
  async function write(ready: HolidayCheckReady, change: HolidayChange, ask: HolidayAsk): Promise<void> {
    const outcome = await writeHolidayChange(holidayWriteTablesOf(supabaseClient()), ready.organizationId, change);

    setAsked(null);

    if (!outcome.ok) {
      if (droppedOffline(outcome.code, HOLIDAY_WRITE_UNAVAILABLE)) {
        focusLater([originOf(ask)], HEADING);

        return;
      }
      refuseOnCard(ask)(outcome.code);
      if (outcome.code === HOLIDAY_STALE) refreshCalendar();

      return;
    }

    const landed = holidaySavedOf(change);

    // An import that inserted nothing (every date stored meanwhile) says so, never "0 added".
    if (change.kind === CHANGE_ADD && change.year !== null && outcome.rows === 0) setCardFailure(HOLIDAY_NOTHING_NEW);
    else setSaved({ saved: landed, count: outcome.rows });
    // *Dodaj blagdan* is still there to add another; after an import or a removal, the card's heading.
    focusLater(landed === HOLIDAY_ADDED ? [byId(ORGANIZATION_HOLIDAYS_ADD_ID)] : [HEADING], HEADING);
    refreshLanded();
  }

  /** *Što se mijenja*'s *Spremi*: checked afresh; then `holidayConfirmStepOf` decides. */
  function confirm(): Promise<void> {
    const shown = checked;
    const ask = asked;

    if (shown === null || ask === null) return Promise.resolve();

    return latched(async () => {
      setCardFailure(null);

      const ready = await check(ask, (code) => {
        setChecked(null);
        setAsked(null);
        refuseOnCard(ask)(code);
      });

      if (ready === null) return;

      const step = holidayConfirmStepOf(shown, ready);

      if (step === CONFIRM_SHOW_AGAIN) {
        setChangedAgain(true);
        setChecked(ready);

        return;
      }

      setChecked(null);
      if (step === CONFIRM_ERASURES) erasures.show(ready.rows, ready.change);
      else await write(ready, ready.change, ask);
    }, originOf(ask));
  }

  /** *Natrag*: an add goes back to its dialog, the draft as it was; anything else to the card. */
  function closePreview(): void {
    if (working.current) return;

    const back = asked?.kind === ASK_ADD;
    const ask = asked;

    setChecked(null);
    setCardFailure(null);
    if (back) {
      reopenAdd();
    } else {
      setAsked(null);
      focusLater([ask === null ? HEADING : originOf(ask)], HEADING);
    }
  }

  /** The erasure confirmation's save: checked afresh, followed through the one order. */
  function confirmErasures(shown: ShownErasures<HolidayChange>): Promise<void> {
    const ask = asked;

    if (!erasures.confirmed || ask === null) return Promise.resolve();

    return latched(async () => {
      const result = await holidayCheckOf(readErasures.readAndShare, ask, new Date(), onlineManager.isOnline(), nationalHolidayNameOf);

      await erasures.follow(shown, result, {
        unavailable: () => {
          erasures.drop();
          setAsked(null);
          refuseOnCard(ask)(HOLIDAY_UNCHECKED);
        },
        refused: ({ code }) => {
          erasures.drop();
          setAsked(null);
          refuseOnCard(ask)(code);
          // As `check()` does: a stale card is read again.
          if (code === HOLIDAY_STALE) refreshCalendar();
        },
        subjectOf: (ready) => ready.change,
        write: async (ready, subject) => {
          erasures.drop();
          await write(ready, subject, ask);
        },
      });
    }, originOf(ask));
  }

  /** The date entered is before the organization's today: the dialog warns, and never blocks. */
  const draftPast = draft.date !== NO_TEXT && isPastDate(draft.date, today);

  return {
    calendar,
    unavailable,
    loading,
    today,
    year: shownYear,
    holidays,
    proposal,
    opening,
    draft,
    draftPast,
    pending,
    failure,
    cardFailure,
    saved,
    checked,
    changedAgain,
    asked,
    erasures,
    stepYear,
    retry,
    openAdd,
    openRename,
    close,
    noteDate,
    next,
    rename,
    askRemove,
    askImport,
    confirm,
    closePreview,
    confirmErasures,
  };
}

/** What the *Blagdani* card is drawn from. */
export type OrganizationHolidays = ReturnType<typeof useOrganizationHolidays>;
