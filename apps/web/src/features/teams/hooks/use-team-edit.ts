import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  ASK_FLAG,
  CHANGE_FLAG,
  CONFIRM_ERASURES,
  CONFIRM_SHOW_AGAIN,
  HOLIDAY_STALE,
  holidayCheckOf,
  holidayConfirmStepOf,
  type HolidayAsk,
  type HolidayChange,
  type HolidayCheckReady,
} from '@/features/holidays/services/holiday-check';
import {
  HOLIDAY_UNCHECKED,
  HOLIDAY_WRITE_UNAVAILABLE,
  holidayWriteTablesOf,
  writeHolidayChange,
  type HolidayFailure,
} from '@/features/holidays/services/write';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import {
  NO_DEPENDENTS,
  TEAM_CHANGE_DEPENDENTS,
  TEAM_HOLIDAY_FLAG_DEPENDENTS,
  refreshAfterWrite,
  retryRead,
} from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  teamsSurfaceStateOf,
  type TeamRow,
} from '@/features/teams/services/list';
import { TEAM_LIST_SURFACE_KEYS, teamListTimeZoneOf } from '@/features/teams/services/surface-keys';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  TEAM_ARCHIVED,
  TEAM_RENAMED,
  TEAM_WRITE_UNAVAILABLE,
  archiveStageOf,
  archiveTeam,
  renameTeam,
  renamesAfter,
  teamFormStateOf,
  type TeamSaved,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/features/teams/services/write';
import { zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/**
 * One team's state, its one read and its two writes (story 1.7a): rename it,
 * or archive it.
 *
 * THE SAME ONE READ the list screen makes, under the same key: the team is
 * found in that answer, so the two screens can never show two versions of it.
 * The page keys this by the route's id, so an armed confirmation, a refusal or
 * a confirmation is never carried from one team to another.
 *
 * TWO REFUSAL STATES, each where it happened: the rename's, which the name
 * field is described by, and the archive's, announced inside the archive
 * block, which never marks the name field invalid.
 *
 * STORY 21.17: a third write, *Ne radi na blagdane*, on its own save: the
 * switch asks the AD-5 check (fresh reads, the snapshot with the flag
 * flipped, the erasures from the earliest holiday, *Što se mijenja* over
 * every holiday and the team's lost shifts), shown in place of the form; its
 * *Spremi* checks afresh, writes at once, shows a changed preview again, or
 * opens the erasure confirmation, which alone waits.
 *
 * Every rule is in `@/features/teams/services/list`,
 * `@/features/teams/services/write` and `@/features/holidays/services/*`,
 * which the node suite executes; this hook holds state and wiring only.
 */
export function useTeamEdit(id: string, onClose?: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  /** The archive's own confirm (story 8.3b): focus returns to it when the connection drops under the archive. */
  const archiveConfirm = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The RENAME's refusal: the one the name field is described by. */
  const [failure, setFailure] = useState<TeamWriteFailure | null>(null);
  /** The ARCHIVE's refusal, announced inside the archive block. */
  const [archiveFailure, setArchiveFailure] = useState<TeamWriteFailure | null>(null);
  const [saved, setSaved] = useState<TeamSaved | null>(null);
  /** Landed renames; the form key counts them, never the name. */
  const [renames, setRenames] = useState(0);
  const readErasures = useErasureReads();
  /** The flag the switch asked for, while its check or its preview is out. */
  const [flagAsked, setFlagAsked] = useState<HolidayAsk | null>(null);
  /** *Što se mijenja* of the flag, shown in place of the form. */
  const [flagChecked, setFlagChecked] = useState<HolidayCheckReady | null>(null);
  const [flagFailure, setFlagFailure] = useState<HolidayFailure | null>(null);
  /** The flag a landed save set. */
  const [flagSaved, setFlagSaved] = useState<boolean | null>(null);
  /** The flag's preview on show is a changed one, shown again: it says so. */
  const [flagChangedAgain, setFlagChangedAgain] = useState(false);
  const flagSwitch = useRef<HTMLButtonElement>(null);
  const flagErasures = useErasureConfirmation<HolidayChange>(pending, () => flagSwitch.current);

  const answerRead = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));
  // STORY 8.2d: the same one snapshot the list behind the dialog decides
  // (`TEAM_LIST_SURFACE_KEYS`), so the form and the list are drawn from the
  // cached rows together, or are unavailable together. The as-of note is the
  // list's, under its heading; the dialog adds none.
  const timeZone = teamListTimeZoneOf(
    queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY),
  );
  const { clock, answerOf } = useSnapshotFreshness(
    TEAM_LIST_SURFACE_KEYS,
    [[TEAMS_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const readState = teamsSurfaceStateOf(answer);
  const { refusal: readRefusal, loading } = readState;
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && readRefusal !== null;
  // A read failure hides the form, decided in `teamFormStateOf` from the state.
  const form = teamFormStateOf(readState, id);
  const refusal = failure ?? form.refusal;
  const stage = archiveStageOf(armed, pending);
  /** The archive is being asked about, or is in flight. */
  const confirming = stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY;

  /**
   * Every way the dialog closes: back to the list it is drawn over — or,
   * STORY 21.26, the caller's own close when *Timovi i raspored* opens it.
   */
  function close(): void {
    if (onClose !== undefined) {
      onClose();

      return;
    }
    void navigate({ to: '/ljudi/smjene' });
  }

  /**
   * Re-read the one list, so both screens show what the database holds now,
   * on either outcome. Once the write LANDED, every read that shows a team's
   * name or flag is re-read beside it — the builder, the member list, Danas's
   * line, the rosters and the calendar (`TEAM_CHANGE_DEPENDENTS`) — all
   * started together. A failed or paused re-read resolves rather than rejects
   * (pinned in `dependents.test.ts`); the `try` is for a client that throws
   * before any re-read starts.
   */
  async function refresh(landed: boolean): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, TEAMS_LIST_KEY, landed ? TEAM_CHANGE_DEPENDENTS : NO_DEPENDENTS);
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Rename. The field is uncontrolled and the form is keyed by landed renames
   * only, so a refused rename keeps what was typed even when the re-read
   * brings a name changed elsewhere.
   */
  async function submit(event: FormEvent<HTMLFormElement>, team: TeamRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;

    if (name === null || writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    writing.current = true;
    // A rename is a different decision from the archive it may interrupt.
    setArmed(false);
    setFailure(null);
    setArchiveFailure(null);
    setSaved(null);
    // STORY 21.17: the flag's last line was about the flag, not this write.
    setFlagFailure(null);
    setFlagSaved(null);
    setPending(true);

    try {
      const outcome = await renameTeam(
        supabaseClient().from(TEAMS_TABLE) as unknown as TeamWriteTable,
        team,
        name.value,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, TEAM_WRITE_UNAVAILABLE)) {
        name.focus();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();
      } else {
        setSaved(TEAM_RENAMED);
      }

      await refresh(outcome.ok);
      // AFTER the re-read, so a remount shows what the database now holds.
      setRenames((current) => renamesAfter(current, outcome));
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        name.focus();

        return;
      }
      setFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Archive, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function archive(team: TeamRow): Promise<void> {
    if (writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // STORY 8.3b: the connection dropped under the archive — its confirmation stays armed.
    let keepArmed = false;

    writing.current = true;
    setFailure(null);
    setArchiveFailure(null);
    setSaved(null);
    // STORY 21.17: the flag's last line was about the flag, not this write.
    setFlagFailure(null);
    setFlagSaved(null);
    setPending(true);

    try {
      const outcome = await archiveTeam(
        supabaseClient().from(TEAMS_TABLE) as unknown as TeamWriteTable,
        team,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, TEAM_WRITE_UNAVAILABLE)) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }

      if (!outcome.ok) {
        setArchiveFailure(outcome.code);
      } else {
        setSaved(TEAM_ARCHIVED);
      }

      await refresh(outcome.ok);
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }
      setArchiveFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      if (!keepArmed) setArmed(false);
    }
  }

  /** Runs `step` under the one latch, pending while it does. */
  async function latched(step: () => Promise<void>): Promise<void> {
    if (writing.current || !writesOnline()) return;

    writing.current = true;
    setPending(true);

    try {
      await step();
    } catch (cause) {
      console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);
      // Said under the switch, in this dialog, the preview closed so it shows.
      setFlagChecked(null);
      setFlagAsked(null);
      setFlagFailure(HOLIDAY_WRITE_UNAVAILABLE);
      focusLater([() => flagSwitch.current], () => nameField.current);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** The flag's fresh check (holidays are named nowhere here: no import). */
  async function checkFlag(ask: HolidayAsk): Promise<HolidayCheckReady | null> {
    const result = await holidayCheckOf(readErasures.readAndShare, ask, new Date(), onlineManager.isOnline(), () => NO_TEXT);

    if (result.kind === CHECK_UNAVAILABLE) {
      setFlagFailure(HOLIDAY_UNCHECKED);

      return null;
    }

    if (result.kind === CHECK_REFUSED) {
      setFlagFailure(result.code);
      await refresh(false);

      return null;
    }

    return result;
  }

  /** The switch: the flag `value` checked afresh, then *Što se mijenja* in place of the form. */
  function askFlag(team: TeamRow, value: boolean): Promise<void> {
    return latched(async () => {
      setFailure(null);
      setArchiveFailure(null);
      setSaved(null);
      setFlagFailure(null);
      setFlagSaved(null);

      const ask: HolidayAsk = { kind: ASK_FLAG, teamId: team.id, value };

      setFlagAsked(ask);

      const ready = await checkFlag(ask);

      if (ready === null) {
        setFlagAsked(null);
        focusLater([() => flagSwitch.current], () => nameField.current);

        return;
      }

      setFlagChangedAgain(false);
      setFlagChecked(ready);
    });
  }

  /** Write what the fresh check `ready` stood on, its tenant the reads' own. */
  async function writeFlag(ready: HolidayCheckReady, change: HolidayChange): Promise<void> {
    const outcome = await writeHolidayChange(holidayWriteTablesOf(supabaseClient()), ready.organizationId, change);

    setFlagAsked(null);

    if (!outcome.ok) {
      if (!droppedOffline(outcome.code, HOLIDAY_WRITE_UNAVAILABLE)) setFlagFailure(outcome.code);
      await refresh(false);
    } else {
      setFlagSaved(change.kind === CHANGE_FLAG ? change.value : null);
      try {
        await refreshAfterWrite(queryClient, TEAMS_LIST_KEY, TEAM_HOLIDAY_FLAG_DEPENDENTS);
      } catch (cause) {
        console.error(HOLIDAY_WRITE_UNAVAILABLE, cause);
      }
    }

    focusLater([() => flagSwitch.current], () => nameField.current);
  }

  /** The flag preview's *Spremi*: checked afresh; the write at once, the changed preview again, or the erasures. */
  function confirmFlag(): Promise<void> {
    const shown = flagChecked;
    const ask = flagAsked;

    if (shown === null || ask === null) return Promise.resolve();

    return latched(async () => {
      const ready = await checkFlag(ask);

      setFlagChecked(null);

      if (ready === null) {
        setFlagAsked(null);
        focusLater([() => flagSwitch.current], () => nameField.current);

        return;
      }

      const step = holidayConfirmStepOf(shown, ready);

      if (step === CONFIRM_SHOW_AGAIN) {
        setFlagChangedAgain(true);
        setFlagChecked(ready);
      } else if (step === CONFIRM_ERASURES) {
        flagErasures.show(ready.rows, ready.change);
      } else {
        await writeFlag(ready, ready.change);
      }
    });
  }

  /** *Natrag*: back to the form, the flag as stored. */
  function closeFlagPreview(): void {
    if (writing.current) return;

    setFlagChecked(null);
    setFlagAsked(null);
    focusLater([() => flagSwitch.current], () => nameField.current);
  }

  /** The flag's erasure confirmation: checked afresh, followed through the one order. */
  function confirmFlagErasures(shown: ShownErasures<HolidayChange>): Promise<void> {
    const ask = flagAsked;

    if (!flagErasures.confirmed || ask === null) return Promise.resolve();

    return latched(async () => {
      const result = await holidayCheckOf(readErasures.readAndShare, ask, new Date(), onlineManager.isOnline(), () => NO_TEXT);

      await flagErasures.follow(shown, result, {
        unavailable: () => {
          flagErasures.drop();
          setFlagAsked(null);
          setFlagFailure(HOLIDAY_UNCHECKED);
          focusLater([() => flagSwitch.current], () => nameField.current);
        },
        refused: async ({ code }) => {
          flagErasures.drop();
          setFlagAsked(null);
          setFlagFailure(code);
          focusLater([() => flagSwitch.current], () => nameField.current);
          // As `checkFlag` does: a stale team is read again.
          if (code === HOLIDAY_STALE) await refresh(false);
        },
        subjectOf: (ready) => ready.change,
        write: async (ready, subject) => {
          flagErasures.drop();
          await writeFlag(ready, subject);
        },
      });
    });
  }

  /** The erasure confirmation closed: the flag goes back to what is stored. */
  function closeFlagErasures(): void {
    // Never while its save is in flight: the write's outcome is still to be said.
    if (writing.current) return;

    flagErasures.close();
    setFlagAsked(null);
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, TEAMS_LIST_KEY);
  }

  return {
    nameField,
    archiveConfirm,
    pending,
    setArmed,
    failure,
    archiveFailure,
    setArchiveFailure,
    saved,
    setSaved,
    renames,
    readRefusal,
    retry,
    retryable,
    loading,
    form,
    refusal,
    stage,
    confirming,
    close,
    submit,
    archive,
    flagSwitch,
    flagAsked,
    flagChecked,
    flagFailure,
    flagSaved,
    flagChangedAgain,
    flagErasures,
    askFlag,
    confirmFlag,
    closeFlagPreview,
    confirmFlagErasures,
    closeFlagErasures,
  };
}

/** What the edit screen's parts are drawn from. */
export type TeamEditScreen = ReturnType<typeof useTeamEdit>;
