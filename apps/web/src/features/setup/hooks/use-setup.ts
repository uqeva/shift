import type { ScheduleSource } from '@shift/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
  membersTodayOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  minimumMembersOf,
  organizationSnapshotQueryOptions,
  organizationTable,
} from '@/features/organization/services/snapshot';
import { ROTATION_KEY, ROTATION_READ_TABLE, rotationQueryOptions } from '@/features/rotation/services/list';
import {
  SETUP_PEOPLE_HEADING_ID,
  SETUP_TEAMS_HEADING_ID,
  SETUP_TYPES_HEADING_ID,
  firstRunOf,
  setupTeamHeadingId,
  teamCardsOf,
  unrotatedGroupsOf,
  type SourceFacts,
  type TeamCard,
} from '@/features/setup/services/setup';
import { SHIFT_TYPES_LIST_KEY, type ShiftTypeList } from '@/features/shift-types/services/list';
import { retryRead } from '@/features/teams/services/dependents';
import { TEAMS_LIST_KEY, type TeamRow } from '@/features/teams/services/list';
import { supabaseClient } from '@/lib/supabase/client';

/** A press's own button, for focus to come back to. */
type Opener = HTMLButtonElement | null;

/**
 * A member dialog opened from the page: a team change with the team picked
 * (`move.teamId`, `null` for *Bez tima*), or, with no `move`, *Raspored
 * osobe*; and where focus goes back to — the opener, or a heading when the
 * opener is gone (a removed member's ✕).
 */
export interface SetupTask {
  /** Counts tasks, so a second task for the same person mounts a fresh host. */
  readonly serial: number;
  readonly memberId: string;
  readonly move: { readonly teamId: string | null } | null;
  readonly opener: Opener;
  readonly fallbackId: string;
}

/** A pick dialog: *Dodaj člana* for a team's card, or, with none, *Postavi raspored osobe*. */
export interface SetupPick {
  readonly card: TeamCard | null;
  readonly opener: Opener;
}

/** As much of the team list's screen (`useTeamList`) as the page reads. */
export interface SetupTeamsInput {
  readonly split: { readonly active: readonly TeamRow[] } | null;
  readonly refusal: unknown;
}

/** As much of the shift type list's screen (`useShiftTypeList`) as the page reads. */
export interface SetupShiftTypesInput {
  readonly list: ShiftTypeList | null;
  readonly refusal: unknown;
}

/**
 * Focus back on the opener, or — when it is gone or disabled — on the first
 * element the `fallbackIds` name that is still on the page.
 */
export function focusBack(opener: Opener, ...fallbackIds: readonly string[]): void {
  window.requestAnimationFrame(() => {
    if (opener !== null && opener.isConnected && !opener.disabled) {
      opener.focus();

      return;
    }
    for (const id of fallbackIds) {
      const element = document.getElementById(id);

      if (element !== null) {
        element.focus();

        return;
      }
    }
  });
}

/**
 * *Timovi i raspored*'s reads and state (story 21.26, UX-DR84). It READS
 * what the other screens read, under their own keys (AD-13) — the member
 * list, the rotation snapshot, the calendar snapshot and the organization —
 * beside the team and shift type lists the page hands in (their screens'
 * own hooks, whose add dialogs the page shares), derives the parts
 * (`@/features/setup/services/setup`) and holds which dialog is open. It
 * writes nothing: every change is a dialog of the screen that owns it.
 *
 * `factsOf` is the member page's reading of a member's schedule source
 * (21.10), handed in by the page over this calendar snapshot.
 */
export function useSetup<Fact extends { readonly source: ScheduleSource }>({
  teams,
  shiftTypes,
  factsOf,
}: {
  readonly teams: SetupTeamsInput;
  readonly shiftTypes: SetupShiftTypesInput;
  readonly factsOf: (calendar: CalendarSnapshot, memberId: string, today: string) => SourceFacts<Fact> | null;
}) {
  const queryClient = useQueryClient();
  const membersRead = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const rotationRead = useQuery(rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE)));
  const calendarRead = useCalendarSnapshot();
  const organizationRead = useQuery(organizationSnapshotQueryOptions(organizationTable));

  const membersState = membersSurfaceStateOf(membersRead);
  const members = membersState.members;
  const today = membersTodayOf(members, new Date());
  const calendarState = calendarSurfaceStateOf(calendarRead);
  const calendar = calendarState.snapshot;
  const organization = organizationRead.data;
  const organizationMinimum = organization !== undefined && organization.ok ? minimumMembersOf(organization.snapshot) : null;
  const activeTeams = teams.split?.active ?? null;
  const types = shiftTypes.list?.active ?? null;
  // EVERY TYPE, archived ones too, for the strips: a pattern may still name
  // an archived type, and its chip must carry its name.
  const allTypes = useMemo(
    () => (shiftTypes.list === null ? null : [...shiftTypes.list.active, ...shiftTypes.list.archived]),
    [shiftTypes.list],
  );
  const rotation = rotationRead.data ?? null;

  const cards = useMemo(
    () =>
      members === null || activeTeams === null || today === null || allTypes === null
        ? null
        : teamCardsOf({ teams: activeTeams, members, rotation, types: allTypes, organizationMinimum, today }),
    [members, activeTeams, rotation, allTypes, organizationMinimum, today],
  );
  const unrotated = useMemo(
    () =>
      members === null || calendar === null || today === null
        ? null
        : unrotatedGroupsOf(members, (memberId) => factsOf(calendar, memberId, today), today),
    [members, calendar, today, factsOf],
  );
  const firstRun =
    cards === null || unrotated === null || types === null ? null : firstRunOf({ activeTypes: types.length, cards, unrotated });

  const loading = members === null && membersState.refusal === null;
  // ANY READ THE PAGE DRAWS FROM, refused: one alert and one retry for all of them.
  const failed =
    membersState.refusal !== null ||
    teams.refusal !== null ||
    shiftTypes.refusal !== null ||
    calendarState.refusal !== null ||
    rotationRead.isError ||
    organizationRead.isError;

  // THE DIALOGS: one pick, one member task, one team, the rotation.
  const [pick, setPick] = useState<SetupPick | null>(null);
  const [task, setTask] = useState<SetupTask | null>(null);
  const serial = useRef(0);
  const [teamEdit, setTeamEdit] = useState<{ readonly id: string; readonly opener: Opener } | null>(null);
  const [rotationOpen, setRotationOpen] = useState(false);
  const rotationOpener = useRef<Opener>(null);

  /**
   * Open one member's dialog: a team change with `teamId` picked (`null`:
   * *Bez tima*) from the card of `cardTeamId`, or — `move` absent — their
   * *Raspored osobe*.
   */
  function startTask(memberId: string, opener: Opener, move: { readonly teamId: string | null; readonly cardTeamId: string } | null): void {
    setPick(null);
    serial.current += 1;
    setTask({
      serial: serial.current,
      memberId,
      move: move === null ? null : { teamId: move.teamId },
      opener,
      fallbackId: move === null ? SETUP_PEOPLE_HEADING_ID : setupTeamHeadingId(move.cardTeamId),
    });
  }

  /** The task's dialogs have all closed: unmount its host, focus back. */
  function endTask(): void {
    const current = task;

    setTask(null);
    if (current !== null) focusBack(current.opener, current.fallbackId);
  }

  function openRotation(opener: Opener): void {
    rotationOpener.current = opener;
    setRotationOpen(true);
  }

  function closeRotation(): void {
    setRotationOpen(false);
    focusBack(rotationOpener.current, SETUP_TEAMS_HEADING_ID);
  }

  function openTeamEdit(id: string, opener: Opener): void {
    setTeamEdit({ id, opener });
  }

  function closeTeamEdit(): void {
    const current = teamEdit;

    setTeamEdit(null);
    // AN ARCHIVED TEAM'S CARD IS GONE with its heading: the teams heading then.
    if (current !== null) focusBack(current.opener, setupTeamHeadingId(current.id), SETUP_TEAMS_HEADING_ID);
  }

  function closePick(): void {
    const current = pick;

    setPick(null);
    if (current !== null) {
      focusBack(current.opener, current.card === null ? SETUP_PEOPLE_HEADING_ID : setupTeamHeadingId(current.card.team.id));
    }
  }

  /** The reads' retry, from the page's one refusal. */
  function retry(): void {
    for (const key of [MEMBERS_LIST_KEY, TEAMS_LIST_KEY, SHIFT_TYPES_LIST_KEY, CALENDAR_KEY, ROTATION_KEY, ORGANIZATION_SNAPSHOT_KEY]) {
      void retryRead(queryClient, key);
    }
  }

  return {
    members,
    today,
    cards,
    unrotated,
    firstRun,
    loading,
    failed,
    retry,
    teamsHeadingId: SETUP_TEAMS_HEADING_ID,
    typesHeadingId: SETUP_TYPES_HEADING_ID,
    pick,
    openPick: setPick,
    closePick,
    task,
    startTask,
    endTask,
    teamEdit,
    openTeamEdit,
    closeTeamEdit,
    rotationOpen,
    openRotation,
    closeRotation,
  };
}
