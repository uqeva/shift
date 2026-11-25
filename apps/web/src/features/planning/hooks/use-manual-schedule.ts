import { monthOf } from '@shift/domain';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { isCalendarMonth, monthHeaderOf } from '@/features/calendar/utils/month';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  MANUAL_STALE,
  NO_DRAFT,
  draftAgainst,
  draftKeyOf,
  draftWith,
  manualMonthOf,
  movedOf,
  pickableTeamsOf,
  pickableTypesOf,
  positionOf,
  rectangleOf,
  toggledOf,
  type ManualCellRef,
  type ManualDraft,
  type ManualMonth,
  type ManualValue,
} from '@/features/planning/services/manual-grid';
import {
  MANUAL_FAILED,
  MANUAL_UNAVAILABLE,
  manualCheckOf,
  manualPreviewKeyOf,
  saveManualSchedule,
  type ManualReady,
  type ManualRefusal,
  type ManualRpc,
} from '@/features/planning/services/manual-save';
import { MEMBERSHIP_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { useOrganizationToday } from '@/hooks/organization-today';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/** `?mjesec=2026-12&osoba=<id>`: the month shown, and on a phone the member edited. */
export interface ManualSearch {
  readonly mjesec?: string;
  readonly osoba?: string;
}

/** The search as the route validates it: a month of the wrong shape, or a person that is not text, dropped. */
export function manualSearchOf(search: Record<string, unknown>): ManualSearch {
  const mjesec = search['mjesec'];
  const osoba = search['osoba'];

  return {
    ...(isCalendarMonth(mjesec) ? { mjesec } : {}),
    ...(typeof osoba === 'string' && osoba !== '' ? { osoba } : {}),
  };
}

export type ManualNavigate = (next: ManualSearch, options?: { readonly replace?: boolean }) => void;

/** The picker, open on its cells. */
export interface ManualPicking {
  readonly cells: readonly ManualCellRef[];
}

/** The id of the grid's heading (the month), which names the grid and the day list. */
export const MANUAL_HEADING_ID = 'rucni-raspored-month';

/** A cell's DOM id: where focus returns after the picker. */
export function manualCellIdOf(cell: ManualCellRef): string {
  return `rucni-${cell.memberId}-${cell.date}`;
}

/**
 * *RUČNI RASPORED*'s screen (story 21.4; UX-DR72): the month, the draft, the
 * selection, the picker, and *Spremi*'s check, confirmation and write. Every
 * rule is in `@/features/planning/services`; this holds state, focus and the
 * three reads.
 *
 * THE DRAFT SPANS MONTHS: moving to another month keeps it, and the save bar
 * counts every drafted cell. A newer read drops the cells it has made equal
 * to the live rows (`draftAgainst`).
 *
 * *SPREMI* (AD-5 as amended): the three core reads afresh, then *Što se
 * mijenja* in a dialog. Its own *Spremi* checks afresh once more: no erasure
 * writes at once; erasures open the shared erasure confirmation, whose save
 * re-checks and follows the one order (`erasures.follow`). One call writes
 * the whole draft.
 */
export function useManualSchedule(search: ManualSearch, navigate: ManualNavigate) {
  const queryClient = useQueryClient();
  const answer = useCalendarSnapshot();
  const surface = calendarSurfaceStateOf(answer);
  const { snapshot } = surface;
  const { today } = useOrganizationToday(snapshot === null ? null : snapshot.timeZone);
  const readErasures = useErasureReads();
  const saving = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const erasuresSave = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<ManualDraft>(NO_DRAFT);
  const [selected, setSelected] = useState<readonly ManualCellRef[]>([]);
  const [anchor, setAnchor] = useState<ManualCellRef | null>(null);
  const [focus, setFocus] = useState<ManualCellRef | null>(null);
  const [picking, setPicking] = useState<ManualPicking | null>(null);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState<ManualReady | null>(null);
  const [refusal, setRefusal] = useState<ManualRefusal | null>(null);
  const [unchecked, setUnchecked] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const dragging = useRef<{ readonly from: ManualCellRef; moved: boolean; cells: readonly ManualCellRef[] } | null>(null);
  const erasures = useErasureConfirmation<ManualDraft>(pending, () => saveButton.current);

  const month = search.mjesec ?? (today === null ? null : monthOf(today));

  // A NEWER READ drops the drafted cells it has made equal to the live rows.
  useEffect(() => {
    if (snapshot !== null) setDraft((current) => draftAgainst(snapshot, current));
  }, [snapshot]);

  // A MONTH THAT CANNOT BE DERIVED says so (review): never an endless "loading".
  const derived = useMemo((): { readonly shown: ManualMonth | null; readonly failed: boolean } => {
    if (snapshot === null || today === null || month === null) return { shown: null, failed: false };

    try {
      return { shown: manualMonthOf(snapshot, month, today, draft), failed: false };
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);

      return { shown: null, failed: true };
    }
  }, [snapshot, today, month, draft]);
  const { shown, failed } = derived;
  const header = month === null || today === null ? null : monthHeaderOf(month, today);
  const selectedKeys = useMemo(() => new Set(selected.map(draftKeyOf)), [selected]);
  const types = useMemo(() => (snapshot === null ? [] : pickableTypesOf(snapshot)), [snapshot]);
  const teams = useMemo(() => (snapshot === null ? [] : pickableTeamsOf(snapshot)), [snapshot]);
  // THE PHONE'S MEMBER: the search's, when the month shows them, else the first row.
  const person = shown === null ? null : (shown.rows.find((row) => row.memberId === search.osoba) ?? shown.rows[0] ?? null);
  // THE GRID'S ONE TAB STOP: the focused cell, else the first.
  const tabStop =
    shown === null
      ? null
      : focus !== null && positionOf(shown, focus) !== null
        ? focus
        : shown.rows[0] !== undefined && shown.dates[0] !== undefined
          ? { memberId: shown.rows[0].memberId, date: shown.dates[0].date }
          : null;

  /** Another month: the selection was about the one shown. */
  function show(next: string | null): void {
    setSelected([]);
    setAnchor(null);
    navigate({ ...(search.osoba === undefined ? {} : { osoba: search.osoba }), ...(next === null ? {} : { mjesec: next }) });
  }

  /** The phone's member. */
  function choosePerson(memberId: string): void {
    navigate({ ...search, osoba: memberId }, { replace: true });
  }

  function focusCell(cell: ManualCellRef): void {
    setFocus(cell);
    focusLater([() => document.getElementById(manualCellIdOf(cell))], () => null);
  }

  /** The picker over `cells`. */
  function openPicker(cells: readonly ManualCellRef[]): void {
    if (cells.length === 0 || pending) return;

    setSaved(null);
    setPicking({ cells });
  }

  function closePicker(): void {
    const back = picking?.cells.at(-1) ?? focus;

    setPicking(null);
    if (back !== null && back !== undefined) focusCell(back);
  }

  /** A choice of the picker: every picked cell takes `value` in the draft. */
  function pick(value: ManualValue): void {
    if (snapshot === null || picking === null) return;

    setDraft((current) => draftWith(snapshot, current, picking.cells, value));
    setRefusal(null);
    closePicker();
  }

  // ---------------------------------------------------------------- pointer

  function pointerDown(cell: ManualCellRef, event: PointerEvent<HTMLElement>): void {
    if (shown === null || event.button !== 0) return;

    setFocus(cell);

    if (event.shiftKey && anchor !== null) {
      const from = positionOf(shown, anchor);
      const to = positionOf(shown, cell);

      if (from !== null && to !== null) setSelected(rectangleOf(shown, from, to));
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => toggledOf(current, cell));
      setAnchor(cell);
      return;
    }

    dragging.current = { from: cell, moved: false, cells: [cell] };
    setAnchor(cell);
    setSelected([cell]);
  }

  function pointerEnter(cell: ManualCellRef): void {
    const drag = dragging.current;

    if (drag === null || shown === null) return;

    const from = positionOf(shown, drag.from);
    const to = positionOf(shown, cell);

    if (from === null || to === null) return;

    drag.moved = drag.moved || draftKeyOf(drag.from) !== draftKeyOf(cell);
    drag.cells = rectangleOf(shown, from, to);
    setSelected(drag.cells);
  }

  /** A press released over the grid: a plain click opens the picker on its cell, a drag on what it selected. */
  function pointerUp(): void {
    const drag = dragging.current;

    dragging.current = null;
    if (drag !== null) openPicker(drag.moved ? drag.cells : [drag.from]);
  }

  useEffect(() => {
    const release = (): void => {
      dragging.current = null;
    };

    // A press released outside the grid, or cancelled (a scroll took it), ends the drag and opens nothing.
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointerup', release);

    return () => {
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('pointerup', release);
    };
  }, []);

  // ---------------------------------------------------------------- keyboard

  /**
   * The grid's keys (UX-DR72, UX-DR33's one tab stop): arrows, Home and End
   * move; with Shift they extend the selection from its anchor; Space toggles
   * the cell; Enter opens the picker on the selection, or on the cell; Escape
   * clears the selection.
   */
  function gridKey(event: KeyboardEvent<HTMLElement>): void {
    if (shown === null || tabStop === null) return;

    const at = positionOf(shown, tabStop);

    if (at === null) return;

    const moved = movedOf(shown, at, event.key);

    if (moved !== null) {
      event.preventDefault();

      const row = shown.rows[moved.row];
      const date = shown.dates[moved.column];

      if (row === undefined || date === undefined) return;

      const cell = { memberId: row.memberId, date: date.date };

      if (event.shiftKey) {
        const from = positionOf(shown, anchor ?? tabStop);

        if (anchor === null) setAnchor(tabStop);
        if (from !== null) setSelected(rectangleOf(shown, from, moved));
      }

      focusCell(cell);

      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      setSelected((current) => toggledOf(current, tabStop));
      setAnchor(tabStop);

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      openPicker(selected.length > 0 ? selected : [tabStop]);

      return;
    }

    if (event.key === 'Escape' && selected.length > 0) {
      event.preventDefault();
      setSelected([]);
      setAnchor(null);
    }
  }

  // ---------------------------------------------------------------- save

  /** *Odbaci*: the whole draft goes, after nothing is in flight. */
  function discard(): void {
    if (saving.current) return;

    setDraft(NO_DRAFT);
    setSelected([]);
    setRefusal(null);
    setUnchecked(false);
  }

  /** A refusal said on the bar; a stale one re-reads the calendar (the draft is kept). */
  async function refuse(code: ManualRefusal): Promise<void> {
    setRefusal(code);
    focusLater([() => saveButton.current], () => null);

    if (code !== MANUAL_STALE) return;

    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);
    }
  }

  /** The check could not be derived: nothing written, a retry. */
  function uncheckedNow(): void {
    if (!writesOnline()) return;

    setUnchecked(true);
    focusLater([() => retryButton.current], () => saveButton.current);
  }

  /** THE WRITE: one call with the draft the check stood on. */
  async function write(sent: ManualDraft): Promise<void> {
    const outcome = await saveManualSchedule(supabaseClient() as unknown as ManualRpc, sent);

    if (!outcome.ok) {
      await refuse(outcome.code);
    } else {
      // What was sent is saved; a cell drafted meanwhile (none: the dialogs are modal) stays.
      setDraft((current) => (current === sent ? NO_DRAFT : new Map([...current].filter(([key]) => !sent.has(key)))));
      setSelected([]);
      setAnchor(null);
      // WHAT 0077 WROTE (review): an item it found equal meanwhile is no day saved.
      setSaved(Math.max(sent.size - outcome.saved.unchanged, 0));
      focusLater([() => saveButton.current], () => document.getElementById(MANUAL_HEADING_ID));
    }

    try {
      await refreshAfterWrite(queryClient, CALENDAR_KEY, MEMBERSHIP_WRITE_DEPENDENTS);
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);
    }
  }

  /** *Spremi* on the bar: the fresh check, then *Što se mijenja*. */
  async function save(): Promise<void> {
    if (saving.current || draft.size === 0 || !writesOnline()) return;

    saving.current = true;
    setPending(true);
    setRefusal(null);
    setUnchecked(false);
    setSaved(null);

    try {
      const check = await manualCheckOf(readErasures.readAndShare, draft, onlineManager.isOnline());

      if (check.kind === CHECK_UNAVAILABLE) uncheckedNow();
      else if (check.kind === CHECK_REFUSED) await refuse(check.code);
      else setChecked(check);
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);
      await refuse(MANUAL_FAILED);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** *Što se mijenja*'s own *Spremi*: checked afresh; the write at once, or the erasures to confirm. */
  async function confirm(): Promise<void> {
    if (saving.current || checked === null || !writesOnline()) return;

    const sent = checked.draft;

    saving.current = true;
    setPending(true);

    try {
      const check = await manualCheckOf(readErasures.readAndShare, sent, onlineManager.isOnline());

      setChecked(null);

      if (check.kind === CHECK_UNAVAILABLE) uncheckedNow();
      else if (check.kind === CHECK_REFUSED) await refuse(check.code);
      else if (check.rows.length > 0) erasures.show(check.rows, check.draft);
      // THE PREVIEW CHANGED SINCE IT WAS SHOWN (review): the new one is shown,
      // and nothing is written until it is confirmed in turn.
      else if (manualPreviewKeyOf(check) !== manualPreviewKeyOf(checked)) setChecked(check);
      else await write(check.draft);
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);
      setChecked(null);
      await refuse(MANUAL_FAILED);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** *Što se mijenja* closed without saving: the draft stays. */
  function closePreview(): void {
    if (saving.current) return;

    setChecked(null);
    focusLater([() => saveButton.current], () => null);
  }

  /** The erasure confirmation's save: checked afresh, followed through the one order. */
  async function confirmErasures(shownErasures: ShownErasures<ManualDraft>): Promise<void> {
    if (saving.current || !erasures.confirmed || !writesOnline()) return;

    saving.current = true;
    setPending(true);

    try {
      const check = await manualCheckOf(readErasures.readAndShare, shownErasures.subject, onlineManager.isOnline());

      await erasures.follow(shownErasures, check, {
        unavailable: () => {
          erasures.drop();
          uncheckedNow();
        },
        refused: async ({ code }) => {
          erasures.drop();
          await refuse(code);
        },
        subjectOf: (ready) => ready.draft,
        write: async (_ready, subject) => {
          erasures.drop();
          await write(subject);
        },
      });
    } catch (cause) {
      console.error(MANUAL_UNAVAILABLE, cause);
      erasures.drop();
      await refuse(MANUAL_FAILED);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return {
    surface,
    /** The read again, after a failed one. */
    retry: () => {
      void answer.refetch();
    },
    snapshot,
    today,
    month: header,
    shown,
    /** The month could not be derived from the read: an alert, never an endless "loading". */
    failed,
    draft,
    selected,
    selectedKeys,
    tabStop,
    person,
    types,
    teams,
    picking,
    pending,
    checked,
    refusal,
    unchecked,
    saved,
    erasures,
    saveButton,
    retryButton,
    confirmButton,
    erasuresSave,
    show,
    choosePerson,
    openPicker,
    closePicker,
    pick,
    pointerDown,
    pointerEnter,
    pointerUp,
    gridKey,
    focusCell,
    discard,
    save,
    confirm,
    closePreview,
    confirmErasures,
  };
}

export type ManualScreen = ReturnType<typeof useManualSchedule>;
