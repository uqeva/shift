import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { fetchFreshShared, useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import type { FloaterMember } from '@/features/conflicts/services/floater-suggestions';
import {
  COVER_MODEL_READY,
  LEAVE_COVER_OPEN_ID,
  LEAVE_COVER_UNAVAILABLE,
  STEP_CHANGED,
  STEP_ERASURES,
  STEP_REFUSED,
  STEP_UNAVAILABLE,
  coverConfirmStepOf,
  coverErasureSubjectOf,
  leaveCoverCheckOf,
  leaveCoverMembersOf,
  leaveCoverModelOf,
  type LeaveCoverCheck,
  type LeaveCoverModel,
  type LeaveCoverReads,
  type LeaveCoverReady,
  type LeaveCoverRefusal,
} from '@/features/conflicts/services/leave-cover';
import {
  LEAVE_COVER_SAVED,
  candidateIdOf,
  withResolutionSaved,
  type ResolutionParams,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import {
  RESOLUTION_FAILED,
  RESOLUTION_GONE,
  RESOLUTION_HELD,
  RESOLUTION_TAKEN,
  resolveWithPersonalAssignment,
  type ResolutionCoverRpc,
  type ResolutionWriteFailure,
} from '@/features/conflicts/services/resolution-write';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { MEMBERS_TABLE, membersQueryOptions } from '@/features/members/services/list';
import {
  CONFLICT_REPLACE_TAKEN_DEPENDENTS,
  CONFLICT_REPLACE_WRITE_DEPENDENTS,
  CONFLICT_RESOLUTION_GONE_DEPENDENTS,
  CONFLICT_RESOLUTION_HELD_DEPENDENTS,
  NO_DEPENDENTS,
  refreshAfterWrite,
} from '@/features/teams/services/dependents';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/** What the screen hands the cover: its reads as answered, and how a landed write is held. */
export interface LeaveCoverInputs {
  readonly params: ResolutionParams;
  /** The conflict's leave record, which the cover is keyed on; `null` before the screen is ready. */
  readonly leaveRecordId: string | null;
  readonly snapshot: CalendarSnapshot | null;
  /** The organization's leave rows, as read. */
  readonly records: readonly unknown[] | undefined;
  /** The organization's resolution rows, as read. */
  readonly resolutions: readonly unknown[] | undefined;
  /** The member list's floater fields (0084). */
  readonly members: readonly FloaterMember[] | null;
  /** The screen's view: held while a landed write's re-read and navigation land. */
  readonly view: ResolutionView | null;
  readonly hold: (view: ResolutionView | null) => void;
}

/** A landed cover the queue could not be reached with: said in the dialog itself. */
export interface LeaveCoverLanded {
  readonly memberName: string;
  readonly replacementName: string;
  readonly days: number;
}

/**
 * *POKRIJ CIJELO ODSUSTVO* (story 21.14; R16.4, AD-5): the dialog's state,
 * its check and its one write. Every rule is `services/leave-cover`'s; this
 * holds state, focus and the fresh reads, as *Ručni raspored*'s save does.
 *
 *   - OPENED on a press from the resolution screen, never on mount; nothing
 *     is picked at first.
 *   - *PROVJERI* (`check`): the three core reads and the member list afresh,
 *     the cover rebuilt from them, and the grid's check over its draft.
 *   - *SPREMI* (`confirm`): checked afresh once more, then
 *     `coverConfirmStepOf` — a changed check is shown again first, erasures
 *     open the shared confirmation (whose save compares the fresh check with
 *     the preview shown), otherwise ONE `resolveWithPersonalAssignment` call.
 *   - A REFUSAL is said in the dialog and re-read: taken (the calendar), held
 *     (the calendar and the resolutions), gone (the leave); denied and failed
 *     re-read the resolutions alone.
 *   - LANDED once the call succeeds: the queue with its line, the screen held
 *     meanwhile (only by this hook's own hold). Nothing after the call can turn
 *     it into a failure: a later fault is logged, and the dialog says it landed.
 */
export function useLeaveCover(inputs: LeaveCoverInputs) {
  const { params, leaveRecordId, snapshot, records, resolutions, members, view, hold } = inputs;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readErasures = useErasureReads();
  const saving = useRef(false);
  /** Whether this hook holds the screen's view: only then does it release it. */
  const holding = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState<LeaveCoverReady | null>(null);
  /** The fresh check said something else than the one shown: the preview is shown again. */
  const [changed, setChanged] = useState(false);
  const [refusal, setRefusal] = useState<LeaveCoverRefusal | null>(null);
  const [failure, setFailure] = useState<ResolutionWriteFailure | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState(false);
  const [landed, setLanded] = useState<LeaveCoverLanded | null>(null);
  const erasures = useErasureConfirmation<LeaveCoverReady>(pending, () => confirmButton.current ?? checkButton.current);
  const membersRead = membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE));

  // THE MODEL, only while the dialog is open: it reads every member's month over the leave.
  const model = useMemo(
    (): LeaveCoverModel =>
      leaveCoverModelOf(
        open ? snapshot : null,
        records,
        resolutions,
        members,
        leaveRecordId === null ? null : { memberId: params.memberId, leaveRecordId },
      ),
    [open, snapshot, records, resolutions, members, leaveRecordId, params.memberId],
  );

  // A pick the re-read took away is nobody.
  const floater = model.kind === COVER_MODEL_READY ? (model.view.floaters.find((one) => one.id === picked) ?? null) : null;

  function clearLines(): void {
    setRefusal(null);
    setFailure(null);
    setTaken(null);
    setUnchecked(false);
    setChanged(false);
  }

  /** *Pokrij cijelo odsustvo*: the dialog, nobody picked. */
  function openCover(): void {
    if (saving.current) return;

    clearLines();
    setLanded(null);
    setPicked(null);
    setChecked(null);
    setOpen(true);
  }

  /** The dialog closed without saving: focus back on its button. */
  function close(): void {
    if (saving.current) return;

    setOpen(false);
    setChecked(null);
    erasures.drop();
    focusLater([() => document.getElementById(LEAVE_COVER_OPEN_ID)], () => null);
  }

  /** A floater picked: their dates are listed, and the check starts over. */
  function pick(id: string): void {
    if (saving.current) return;

    setPicked(candidateIdOf(id));
    setChecked(null);
    clearLines();
  }

  /** *Natrag*: from *Što se mijenja* back to the floaters. */
  function back(): void {
    if (saving.current) return;

    setChecked(null);
    setChanged(false);
    focusLater([() => checkButton.current], () => null);
  }

  /** THE FRESH READS: the three core ones and the member list (the floater flag and roles), each afresh, then shared. */
  async function readFresh(): Promise<LeaveCoverReads> {
    const [core, answer] = await Promise.all([readErasures.read(), fetchFreshShared(queryClient, membersRead)]);

    readErasures.share(core);

    return { ...core, members: leaveCoverMembersOf(answer) };
  }

  function check(floaterId: string): Promise<LeaveCoverCheck> {
    if (leaveRecordId === null) return Promise.resolve({ kind: CHECK_UNAVAILABLE });

    return leaveCoverCheckOf(readFresh, { memberId: params.memberId, leaveRecordId, floaterId }, onlineManager.isOnline());
  }

  /** The check could not be derived: nothing written, a retry. */
  function uncheckedNow(): void {
    setChecked(null);
    setUnchecked(true);
    focusLater([() => checkButton.current], () => null);
  }

  function refuse(code: LeaveCoverRefusal): void {
    setChecked(null);
    setRefusal(code);
    focusLater([() => checkButton.current], () => null);
  }

  /** A changed check, shown again: nothing written until it is confirmed in turn. */
  function showChanged(fresh: LeaveCoverReady): void {
    setChecked(fresh);
    setChanged(true);
    focusLater([() => confirmButton.current], () => null);
  }

  async function refresh(dependents: Parameters<typeof refreshAfterWrite>[2]): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, dependents);
    } catch (cause) {
      console.error(LEAVE_COVER_UNAVAILABLE, cause);
    }
  }

  /** THE WRITE: one call with every item the fresh check stood on. */
  async function write(ready: LeaveCoverReady): Promise<void> {
    const outcome = await resolveWithPersonalAssignment(supabaseClient() as unknown as ResolutionCoverRpc, ready.items, false);

    if (!outcome.ok) {
      setChecked(null);
      setFailure(outcome.code);
      if (outcome.code === RESOLUTION_TAKEN) setTaken(ready.floater.name);
      focusLater([() => checkButton.current], () => null);

      // Re-read, so the next *Provjeri* leaves the taken or held date open.
      await refresh(
        outcome.code === RESOLUTION_GONE
          ? CONFLICT_RESOLUTION_GONE_DEPENDENTS
          : outcome.code === RESOLUTION_TAKEN
            ? CONFLICT_REPLACE_TAKEN_DEPENDENTS
            : outcome.code === RESOLUTION_HELD
              ? CONFLICT_RESOLUTION_HELD_DEPENDENTS
              : NO_DEPENDENTS,
      );

      return;
    }

    // LANDED: nothing from here on is a failure of the write.
    const line: LeaveCoverLanded = {
      memberName: ready.absentName,
      replacementName: ready.floater.name,
      days: ready.items.length,
    };

    setChecked(null);
    setLanded(line);

    try {
      // HELD while the re-read lands, so the screen never says its own conflict is no longer open.
      if (view !== null) {
        hold(view);
        holding.current = true;
      }

      await refresh(CONFLICT_REPLACE_WRITE_DEPENDENTS);
      await navigate({
        to: '/za-odluku',
        state: (entry) => withResolutionSaved(entry, { kind: LEAVE_COVER_SAVED, ...line }),
      });
    } catch (cause) {
      // The cover is saved: the dialog says so, and the screen reads afresh.
      console.error(LEAVE_COVER_UNAVAILABLE, cause);

      if (holding.current) {
        holding.current = false;
        hold(null);
      }
    }
  }

  /** Runs `step` once at a time, pending; a fault before any write is a failed line. */
  async function latched(step: () => Promise<void>): Promise<void> {
    if (saving.current || !writesOnline()) return;

    saving.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(LEAVE_COVER_UNAVAILABLE, cause);
      // Only a hold this hook set is released.
      if (holding.current) {
        holding.current = false;
        hold(null);
      }
      erasures.drop();
      setFailure(RESOLUTION_FAILED);
      setChecked(null);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** *Provjeri*: the fresh check, then *Što se mijenja*. */
  function runCheck(): Promise<void> {
    return latched(async () => {
      if (floater === null || floater.covered === 0 || landed !== null) return;

      clearLines();

      const fresh = await check(floater.id);

      if (fresh.kind === CHECK_UNAVAILABLE) uncheckedNow();
      else if (fresh.kind === CHECK_REFUSED) refuse(fresh.code);
      else {
        setChecked(fresh);
        focusLater([() => confirmButton.current], () => null);
      }
    });
  }

  /** *Spremi*: checked afresh, then `coverConfirmStepOf` — stale first, erasures, the write. */
  function confirm(): Promise<void> {
    return latched(async () => {
      const shown = checked;

      if (shown === null) return;

      const step = coverConfirmStepOf(shown, await check(shown.floater.id));

      if (step.kind === STEP_UNAVAILABLE) uncheckedNow();
      else if (step.kind === STEP_REFUSED) refuse(step.code);
      else if (step.kind === STEP_CHANGED) showChanged(step.check);
      else if (step.kind === STEP_ERASURES) erasures.show(step.check.rows, step.check);
      else await write(step.check);
    });
  }

  /** The erasure confirmation's save: checked afresh, compared with the preview shown, followed through the one order. */
  function confirmErasures(shownErasures: ShownErasures<LeaveCoverReady>): Promise<void> {
    if (!erasures.confirmed) return Promise.resolve();

    return latched(async () => {
      const fresh = await check(shownErasures.subject.floater.id);

      await erasures.follow(shownErasures, fresh, {
        unavailable: () => {
          erasures.drop();
          uncheckedNow();
        },
        refused: ({ code }) => {
          erasures.drop();
          refuse(code);
        },
        subjectOf: (ready) => {
          const subject = coverErasureSubjectOf(shownErasures.subject, ready);

          if (subject === null) {
            erasures.drop();
            showChanged(ready);
          }

          return subject;
        },
        write: async (ready) => {
          erasures.drop();
          await write(ready);
        },
      });
    });
  }

  return {
    open,
    model,
    picked,
    floater,
    pending,
    checked,
    changed,
    refusal,
    failure,
    taken,
    unchecked,
    landed,
    erasures,
    checkButton,
    confirmButton,
    openCover,
    close,
    pick,
    back,
    check: runCheck,
    confirm,
    confirmErasures,
  };
}

export type LeaveCoverState = ReturnType<typeof useLeaveCover>;
