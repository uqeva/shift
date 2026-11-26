import { SCHEDULE_SOURCE_PERSONAL, type ScheduleSource } from '@shift/domain';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import type { MemberScreen } from '@/features/members/hooks/member-edit-context';
import {
  CHANGE_CANCEL,
  CHANGE_SET,
  EMPTY_PATTERN_ROW,
  EMPTY_SCHEDULE_DRAFT,
  NEW_PATTERN,
  SCHEDULE_SOURCE_UNAVAILABLE,
  SOURCE_PAST,
  SOURCE_SCHEDULED,
  SOURCE_TAKEN,
  SOURCE_UNCHANGED,
  SOURCE_UNCHOSEN,
  SOURCE_WRITE_FAILED,
  SOURCE_WRITE_REFUSED,
  draftSequenceOf,
  patternOptionsOf,
  scheduleSourceCheckOf,
  scheduleSourceFactsOf,
  scheduleSourcePreviewKeyOf,
  scheduleSourceTablesOf,
  writeScheduleChange,
  type PatternOption,
  type ScheduleSourceAsk,
  type ScheduleSourceChange,
  type ScheduleSourceDraft,
  type ScheduleSourceFacts,
  type ScheduleSourceReady,
  type ScheduleSourceRefusal,
  type ScheduleSourceWriteFailure,
} from '@/features/members/services/schedule-source';
import { MEMBERSHIP_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/** What landed last, said on the card: a version set, or the scheduled one cancelled. */
export type ScheduleSourceSaved = typeof CHANGE_SET | typeof CHANGE_CANCEL;

/** The refusals *Vrijedi od* answers for: focus goes back to it. */
const DATE_REFUSALS: ReadonlySet<string> = new Set([SOURCE_UNCHOSEN, SOURCE_PAST, SOURCE_SCHEDULED, SOURCE_TAKEN, SOURCE_UNCHANGED]);

/**
 * *RASPORED OSOBE* (story 21.10; UX-DR75): the member page's card, its form
 * dialog and its *Što se mijenja*, built as the loan dialog is
 * (`useMemberLoan`): one in-flight latch, a pending flag and a refusal; the
 * fresh check on *Dalje* and again on *Spremi* (a preview that changed since
 * it was shown is shown again, never written unseen); the shared erasure
 * confirmation (AD-5: only an erasure waits); the offline gate; and a landed
 * write re-reading the calendar and its dependents. *Povuci* checks and
 * confirms the cancel of the scheduled version the same way. Every rule is
 * `@/features/members/services/schedule-source`'s.
 */
export function useMemberScheduleSource(screen: MemberScreen) {
  const { id, today, calendarSnapshot, readErasures } = screen;
  const queryClient = useQueryClient();
  const working = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const cancelOpener = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const scheduleFromField = useRef<HTMLInputElement>(null);
  /** The step rows' count field, shared: the row mounted last holds it, so a row added is where focus lands. */
  const scheduleCountField = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const erasuresSave = useRef<HTMLButtonElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleSourceDraft>(EMPTY_SCHEDULE_DRAFT);
  const [asked, setAsked] = useState<ScheduleSourceAsk | null>(null);
  const [checked, setChecked] = useState<ScheduleSourceReady | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<ScheduleSourceRefusal | ScheduleSourceWriteFailure | null>(null);
  const [unchecked, setUnchecked] = useState(false);
  const [saved, setSaved] = useState<ScheduleSourceSaved | null>(null);
  const erasures = useErasureConfirmation<ScheduleSourceChange>(pending, () => opener.current);
  const erasureDialog = useRef(erasures);

  useEffect(() => {
    erasureDialog.current = erasures;
  });

  // ANOTHER MEMBER: nothing raised for the last one stands over this one.
  useEffect(() => {
    erasureDialog.current.drop();
    setFormOpen(false);
    setChecked(null);
    setAsked(null);
    setRefusal(null);
    setUnchecked(false);
    setSaved(null);
  }, [id]);

  const facts: ScheduleSourceFacts | null =
    calendarSnapshot === null || today === null ? null : scheduleSourceFactsOf(calendarSnapshot, id, today);
  const patterns: readonly PatternOption[] = useMemo(
    () => (calendarSnapshot === null ? [] : patternOptionsOf(calendarSnapshot)),
    [calendarSnapshot],
  );
  const types = useMemo(() => (calendarSnapshot === null ? [] : calendarSnapshot.types.filter((type) => !type.archived)), [calendarSnapshot]);
  const sequence = useMemo(() => {
    if (calendarSnapshot === null || draft.source !== SCHEDULE_SOURCE_PERSONAL) return null;

    const known = draftSequenceOf(calendarSnapshot, draft);

    return known.ok ? known.shiftTypeIds : null;
  }, [calendarSnapshot, draft]);

  function typeName(shiftTypeId: string): string {
    return calendarSnapshot?.types.find((type) => type.id === shiftTypeId)?.name ?? shiftTypeId;
  }

  // ------------------------------------------------------------- the form

  function openForm(): void {
    if (working.current) return;

    setDraft(EMPTY_SCHEDULE_DRAFT);
    setRefusal(null);
    setUnchecked(false);
    setSaved(null);
    setFormOpen(true);
  }

  function closeForm(): void {
    if (working.current) return;

    setFormOpen(false);
    setRefusal(null);
    setUnchecked(false);
    focusLater([() => opener.current], () => null);
  }

  function change(next: Partial<ScheduleSourceDraft>): void {
    setRefusal(null);
    setUnchecked(false);
    setDraft((current) => ({ ...current, ...next }));
  }

  const edits = {
    setSource: (source: ScheduleSource) => change({ source }),
    setEffectiveFrom: (effectiveFrom: string) => change({ effectiveFrom }),
    setPattern: (patternId: string | null) => change({ patternId, startStep: 0 }),
    setStartStep: (startStep: number) => change({ startStep }),
    setRow: (index: number, row: { readonly shiftTypeId?: string; readonly count?: string }) =>
      change({ rows: draft.rows.map((one, at) => (at === index ? { ...one, ...row } : one)), startStep: 0 }),
    addRow: () => {
      change({ rows: [...draft.rows, EMPTY_PATTERN_ROW] });
      focusLater([() => scheduleCountField.current], () => null);
    },
    removeRow: (index: number) =>
      change({ rows: draft.rows.length === 1 ? draft.rows : draft.rows.filter((_, at) => at !== index), startStep: 0 }),
  };

  // ------------------------------------------------------------ the check

  /** The refusal the last check answered, or `null`: where focus goes after it. */
  const lastRefusal = useRef<string | null>(null);

  /** The fresh check of `ask`; a refusal or an unavailable check is said where `ask` was made. */
  async function check(ask: ScheduleSourceAsk): Promise<ScheduleSourceReady | null> {
    if (today === null) return null;

    const result = await scheduleSourceCheckOf(readErasures.readAndShare, ask, today, onlineManager.isOnline());

    if (result.kind === CHECK_UNAVAILABLE) {
      lastRefusal.current = null;
      setUnchecked(true);

      return null;
    }

    if (result.kind === CHECK_REFUSED) {
      lastRefusal.current = result.code;
      setRefusal(result.code);

      return null;
    }

    lastRefusal.current = null;

    return result;
  }

  /** Runs `step` under the one latch, pending while it does. */
  async function latched(step: () => Promise<void>): Promise<void> {
    if (working.current || !writesOnline()) return;

    working.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(SCHEDULE_SOURCE_UNAVAILABLE, cause);
      setChecked(null);
      setRefusal(SOURCE_WRITE_FAILED);
    } finally {
      working.current = false;
      setPending(false);
    }
  }

  /** *Dalje*: the draft checked afresh, then *Što se mijenja*. */
  function next(): Promise<void> {
    return latched(async () => {
      setRefusal(null);
      setUnchecked(false);

      const ask: ScheduleSourceAsk = { kind: CHANGE_SET, memberId: id, draft };
      const ready = await check(ask);

      if (ready === null) {
        // A date the database would refuse is the date's to fix; anything else, the form's.
        const dated = scheduleFromField.current !== null && lastRefusal.current !== null && DATE_REFUSALS.has(lastRefusal.current);
        focusLater([() => (dated ? scheduleFromField.current : nextButton.current)], () => null);

        return;
      }

      setAsked(ask);
      setFormOpen(false);
      setChecked(ready);
    });
  }

  /** *Povuci*: the scheduled version's cancel checked afresh, then *Što se mijenja*. */
  function cancelScheduled(effectiveFrom: string): Promise<void> {
    return latched(async () => {
      setRefusal(null);
      setUnchecked(false);
      setSaved(null);

      const ask: ScheduleSourceAsk = { kind: CHANGE_CANCEL, memberId: id, effectiveFrom };
      const ready = await check(ask);

      if (ready === null) {
        focusLater([() => cancelOpener.current], () => opener.current);

        return;
      }

      setAsked(ask);
      setChecked(ready);
    });
  }

  // ------------------------------------------------------------ the write

  async function write(change: ScheduleSourceChange): Promise<void> {
    const organizationId = calendarSnapshot?.organizationId;

    if (organizationId === undefined) {
      setRefusal(SOURCE_WRITE_FAILED);

      return;
    }

    const outcome = await writeScheduleChange(scheduleSourceTablesOf(supabaseClient()), organizationId, change);

    if (outcome.ok) {
      setSaved(change.kind);
      setAsked(null);
      setDraft(EMPTY_SCHEDULE_DRAFT);
      focusLater([() => opener.current], () => null);
    } else {
      setRefusal(outcome.code);
      if (outcome.code === SOURCE_WRITE_REFUSED) focusLater([() => opener.current], () => null);
    }

    try {
      await refreshAfterWrite(queryClient, CALENDAR_KEY, MEMBERSHIP_WRITE_DEPENDENTS);
    } catch (cause) {
      console.error(SCHEDULE_SOURCE_UNAVAILABLE, cause);
    }
  }

  /** *Što se mijenja*'s *Spremi*: checked afresh; the write at once, the changed preview again, or the erasures to confirm. */
  function confirm(): Promise<void> {
    const shown = checked;
    const ask = asked;

    if (shown === null || ask === null) return Promise.resolve();

    return latched(async () => {
      const ready = await check(ask);

      setChecked(null);

      if (ready === null) {
        focusLater([() => opener.current], () => null);

        return;
      }

      if (ready.rows.length > 0) erasures.show(ready.rows, ready.change);
      else if (scheduleSourcePreviewKeyOf(ready) !== scheduleSourcePreviewKeyOf(shown)) setChecked(ready);
      else await write(ready.change);
    });
  }

  /** *Što se mijenja* closed without saving: the draft stays for the form. */
  function closePreview(): void {
    if (working.current) return;

    setChecked(null);
    focusLater([() => opener.current], () => null);
  }

  /** The erasure confirmation's save: checked afresh, followed through the one order. */
  function confirmErasures(shown: ShownErasures<ScheduleSourceChange>): Promise<void> {
    const ask = asked;

    if (!erasures.confirmed || ask === null || today === null) return Promise.resolve();

    return latched(async () => {
      const result = await scheduleSourceCheckOf(readErasures.readAndShare, ask, today, onlineManager.isOnline());

      await erasures.follow(shown, result, {
        unavailable: () => {
          erasures.drop();
          setUnchecked(true);
        },
        refused: ({ code }) => {
          erasures.drop();
          setRefusal(code);
        },
        subjectOf: (ready) => ready.change,
        write: async (_ready, subject) => {
          erasures.drop();
          await write(subject);
        },
      });
    });
  }

  return {
    facts,
    patterns,
    types,
    typeName,
    sequence,
    newPattern: NEW_PATTERN,
    formOpen,
    draft,
    pending,
    refusal,
    unchecked,
    saved,
    checked,
    erasures,
    opener,
    cancelOpener,
    nextButton,
    scheduleFromField,
    scheduleCountField,
    confirmButton,
    erasuresSave,
    openForm,
    closeForm,
    ...edits,
    next,
    cancelScheduled,
    confirm,
    closePreview,
    confirmErasures,
  };
}

export type MemberScheduleSource = ReturnType<typeof useMemberScheduleSource>;
