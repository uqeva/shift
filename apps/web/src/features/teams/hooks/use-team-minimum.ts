import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { minimumMembersOf, organizationSnapshotQueryOptions, organizationTable } from '@/features/organization/services/snapshot';
import { NO_DEPENDENTS, TEAM_CHANGE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { TEAMS_LIST_KEY, TEAMS_TABLE, type TeamRow } from '@/features/teams/services/list';
import {
  TEAM_MINIMUM_INVALID,
  TEAM_MINIMUM_UNAVAILABLE,
  TEAM_MINIMUM_UNCHECKED,
  enteredTeamMinimumOf,
  teamMinimumCheckOf,
  teamMinimumConfirmedOf,
  teamMinimumPreviewShownOf,
  writeTeamMinimum,
  type TeamMinimumChange,
  type TeamMinimumCheckReady,
  type TeamMinimumFailure,
  type TeamMinimumTable,
} from '@/features/teams/services/minimum';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { TEAM_MINIMUM_PREVIEW_HEADING_ID } from '@/features/teams/utils/element-ids';
import { focusLater } from '@/utils/focus-later';

/**
 * *Najmanje ljudi* in the team dialog (story 21.20, UX-DR79): one field, its
 * own save, and *Što se mijenja* when the change creates or clears a
 * short-staffed shift.
 *
 * THE SAVE: the field is read and checked afresh (`teamMinimumCheckOf`: the
 * three core reads, the erasures, the shifts made short and cleared). A
 * change that says nothing is written at once; one that says something shows
 * the preview in place of the field, whose *Spremi* checks afresh again and
 * writes the same preview, or shows a changed one again. *Natrag* returns to
 * the field as typed: the form stays mounted, hidden, under the preview.
 *
 * ITS OWN LATCH: the rename, the archive and the holiday flag are other
 * columns, each serialized by the database (0035's lock, widened by 0082), so
 * one write never waits for another here.
 *
 * Every rule is in `@/features/teams/services/minimum`, which the node suite
 * executes; this hook holds state and wiring only.
 */
/** A minimum as saved: `value: null` is the organization's. */
interface MinimumValue {
  readonly value: number | null;
}

export function useTeamMinimum() {
  const queryClient = useQueryClient();
  const readErasures = useErasureReads();
  const field = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState<TeamMinimumChange | null>(null);
  const [checked, setChecked] = useState<TeamMinimumCheckReady | null>(null);
  const [failure, setFailure] = useState<TeamMinimumFailure | null>(null);
  /** The minimum a landed save set (`value: null`: the organization's). */
  const [saved, setSaved] = useState<MinimumValue | null>(null);
  /** The value the form is seeded with after a landed save, until the re-read team row says it (a failed re-read keeps it). */
  const [stored, setStored] = useState<MinimumValue | null>(null);
  const [changedAgain, setChangedAgain] = useState(false);
  /** Landed saves; the form's key counts them, so the field shows what is stored. */
  const [saves, setSaves] = useState(0);

  // SUBSCRIBED, the chrome's one organization read under its own key: the hint follows it when it lands or changes.
  const organization = useQuery(organizationSnapshotQueryOptions(organizationTable)).data;
  /**
   * The organization's minimum the empty field stands for, in its hint:
   * `undefined` while the organization snapshot is not held (the hint names
   * no number then), `null` while it is not set.
   */
  const organizationMinimum = organization?.ok === true ? minimumMembersOf(organization.snapshot) : undefined;

  /** Re-read the team list, and once a write landed every read a team change makes stale. */
  async function reread(landed: boolean): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, TEAMS_LIST_KEY, landed ? TEAM_CHANGE_DEPENDENTS : NO_DEPENDENTS);
    } catch (cause) {
      console.error(TEAM_MINIMUM_UNAVAILABLE, cause);
    }
  }

  /** Runs `step` under the latch; anything it throws is said under the field. */
  async function latched(step: () => Promise<void>): Promise<void> {
    if (writing.current || !writesOnline()) return;

    writing.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(TEAM_MINIMUM_UNAVAILABLE, cause);
      setChecked(null);
      setAsked(null);
      setFailure(TEAM_MINIMUM_UNAVAILABLE);
      focusLater([() => field.current], () => field.current);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** The fresh check; a failure is said under the field and answers `null`. */
  async function check(change: TeamMinimumChange): Promise<TeamMinimumCheckReady | null> {
    const result = await teamMinimumCheckOf(readErasures.readAndShare, change, new Date(), onlineManager.isOnline());

    if (result.kind === CHECK_UNAVAILABLE) {
      setFailure(TEAM_MINIMUM_UNCHECKED);

      return null;
    }

    if (result.kind === CHECK_REFUSED) {
      setFailure(result.code);
      await reread(false);

      return null;
    }

    return result;
  }

  /** Write what the fresh check stood on (nothing, when the team already holds it). */
  async function write(ready: TeamMinimumCheckReady): Promise<void> {
    const outcome = ready.unchanged
      ? ({ ok: true } as const)
      : await writeTeamMinimum(supabaseClient().from(TEAMS_TABLE) as unknown as TeamMinimumTable, ready.organizationId, ready.change);

    setAsked(null);

    if (!outcome.ok) {
      if (!droppedOffline(outcome.code, TEAM_MINIMUM_UNAVAILABLE)) setFailure(outcome.code);
      await reread(false);
    } else {
      setSaved({ value: ready.change.value });
      setStored({ value: ready.change.value });
      await reread(!ready.unchanged);
      setSaves((current) => current + 1);
    }

    focusLater([() => field.current], () => field.current);
  }

  /** *Spremi najmanje ljudi*: the field read, checked afresh; written at once, or *Što se mijenja* shown. */
  function submitMinimum(event: FormEvent<HTMLFormElement>, team: TeamRow): Promise<void> {
    event.preventDefault();

    // No field mounted is nothing typed: never read as "empty", which would clear the minimum.
    if (field.current === null) return Promise.resolve();

    const entered = enteredTeamMinimumOf(team.id, field.current.value);

    // REFUSED BEFORE THE LATCH, so the field is never disabled under its own focus.
    if (!entered.ok) {
      setSaved(null);
      setFailure(TEAM_MINIMUM_INVALID);
      field.current.focus();

      return Promise.resolve();
    }

    return latched(async () => {
      setFailure(null);
      setSaved(null);

      setAsked(entered.change);

      const ready = await check(entered.change);

      if (ready === null) {
        setAsked(null);
        focusLater([() => field.current], () => field.current);

        return;
      }

      if (!teamMinimumPreviewShownOf(ready)) {
        await write(ready);

        return;
      }

      setChangedAgain(false);
      setChecked(ready);
      focusLater([() => document.getElementById(TEAM_MINIMUM_PREVIEW_HEADING_ID)], () => field.current);
    });
  }

  /** The preview's *Spremi*: checked afresh; the same preview is written, a changed one shown again. */
  function confirmMinimum(): Promise<void> {
    const shown = checked;
    const change = asked;

    if (shown === null || change === null) return Promise.resolve();

    return latched(async () => {
      const ready = await check(change);

      setChecked(null);

      if (ready === null) {
        setAsked(null);
        focusLater([() => field.current], () => field.current);

        return;
      }

      // The team holds it already (another admin set the same): nothing to show again, nothing to send.
      if (ready.unchanged) {
        await write(ready);

        return;
      }

      if (!teamMinimumConfirmedOf(shown, ready)) {
        setChangedAgain(true);
        setChecked(ready);
        focusLater([() => document.getElementById(TEAM_MINIMUM_PREVIEW_HEADING_ID)], () => field.current);

        return;
      }

      await write(ready);
    });
  }

  /** *Natrag*: back to the field, as typed. */
  function closeMinimumPreview(): void {
    if (writing.current) return;

    setChecked(null);
    setAsked(null);
    focusLater([() => field.current], () => field.current);
  }

  /** What was typed changed: the last save's line no longer describes it. */
  function editedMinimum(): void {
    setSaved(null);
  }

  return {
    field,
    stored,
    editedMinimum,
    pending,
    checked,
    failure,
    saved,
    changedAgain,
    saves,
    organizationMinimum,
    submitMinimum,
    confirmMinimum,
    closeMinimumPreview,
  };
}

/** What *Najmanje ljudi* is drawn from. */
export type TeamMinimumScreen = ReturnType<typeof useTeamMinimum>;
