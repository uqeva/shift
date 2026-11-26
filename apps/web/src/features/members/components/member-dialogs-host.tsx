import { useEffect, useRef, useState, type ReactNode } from 'react';

import { MemberScheduleSourceDialogs } from '@/features/members/components/member-schedule-source-card';
import { MemberTeamDialog, MemberTeamErasures } from '@/features/members/components/member-team-card';
import { useMemberEdit } from '@/features/members/hooks/use-member-edit';
import { DIALOG_TASK_END, DIALOG_TASK_SEEN, dialogTaskStepOf } from '@/features/members/services/dialog-task';
import { CHANGE_SET } from '@/features/members/services/schedule-source';
import { NO_TEAM_VALUE, TEAM_MOVE } from '@/features/members/services/write';

/** How long the host waits for the person's reads before it gives up, in ms. */
const OPEN_WAIT_MS = 20000;

/**
 * What a member dialog opened from another page is about (story 21.26): a
 * team change with the team already picked (`move.teamId`, `null` for *Bez
 * tima*), or, with no `move`, *Raspored osobe*.
 */
export interface MemberDialogTask {
  readonly memberId: string;
  readonly move: { readonly teamId: string | null } | null;
}

/** What a task ended with, once every dialog it opened has closed. */
export interface MemberDialogOutcome extends MemberDialogEnd {
  readonly memberId: string;
}

/** How it ended. */
interface MemberDialogEnd {
  /** The person's name, once read. */
  readonly name: string | null;
  /** The change was saved. */
  readonly saved: boolean;
  /** A team change is already scheduled: the member page withdraws it, and offers no move until then. */
  readonly blocked: boolean;
  /** The person could not be read. */
  readonly unavailable: boolean;
}

/**
 * ONE PERSON'S DIALOGS, THE MEMBER PAGE'S OWN (story 21.26). Mounted for the
 * one member a task is about, it runs `useMemberEdit(memberId)` — the very
 * hook `/ljudi/$id` runs — and draws that page's dialogs with no card: the
 * team dialog (opened with the team, or *Bez tima*, picked) and its erasure
 * confirmation, or *Raspored osobe*'s form, *Što se mijenja* and erasures.
 * Every read, rule, preview, check and write is the member page's; this
 * opens the dialog once the person is read, and says when every dialog it
 * opened has closed (`onEnd`, once).
 *
 * `opener` is where the hooks put focus after a landed write, in place of
 * the card buttons this host does not draw.
 */
export function MemberDialogsHost({
  task,
  opener,
  onEnd,
}: {
  readonly task: MemberDialogTask;
  readonly opener: HTMLButtonElement | null;
  readonly onEnd: (outcome: MemberDialogOutcome) => void;
}): ReactNode {
  const edit = useMemberEdit(task.memberId);
  const opened = useRef(false);
  const ended = useRef(false);
  /** A render has shown the dialog open (`dialogTaskStepOf`). */
  const seenOpen = useRef(false);
  /** When the host first waited for the person's reads (epoch ms). */
  const mountedAt = useRef<number | null>(null);
  const member = edit.form.member;
  const source = edit.scheduleSource;
  const teamOpener = edit.teamDialog.opener;
  const sourceOpener = source.opener;
  const move = task.move;

  // FOCUS GOES BACK TO THE CALLER'S OPENER: the hooks focus their own opener
  // refs after a landed write, and no card is mounted here to hold them.
  useEffect(() => {
    teamOpener.current = opener;
    sourceOpener.current = opener;
  }, [opener, teamOpener, sourceOpener]);

  /** Ends the task, once. */
  function end(outcome: MemberDialogEnd): void {
    ended.current = true;
    onEnd({ memberId: task.memberId, ...outcome });
  }

  // THE MEMBER HOOKS' OWN MOUNT FIRST. `useMemberTeam` and
  // `useMemberScheduleSource` reset their dialogs in an effect on the member
  // id, which runs on mount — and runs AGAIN when StrictMode replays a fresh
  // mount's effects (the app mounts in StrictMode, and the e2e runs the dev
  // server). Asked for in the mount commit, the dialog was opened by the
  // first pass and closed again by the replayed reset, so it never showed
  // (story 21.26's CI). So the dialog is asked for on the commit after mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // OPEN ONCE THE PERSON IS READ; end at once when nothing can be opened.
  useEffect(() => {
    if (!mounted || opened.current || ended.current) return;

    // A READ THE DIALOG NEEDS WAS REFUSED: the person, the teams, or the
    // position setting (a move is offered only once that is known).
    if (edit.form.refusal !== null || (move !== null && (edit.teamsState.refusal !== null || edit.positionsRefusal !== null))) {
      end({ name: member?.name ?? null, saved: false, blocked: false, unavailable: true });

      return;
    }
    if (member === null) return;

    if (move !== null) {
      const offer = edit.teamOffer;

      if (offer === null) return;
      if (offer.change !== TEAM_MOVE) {
        end({ name: member.name, saved: false, blocked: true, unavailable: false });

        return;
      }
      opened.current = true;
      edit.teamDialog.openWith(move.teamId ?? NO_TEAM_VALUE);

      return;
    }

    if (source.facts === null) return;
    opened.current = true;
    source.openForm();
  });

  // NOTHING SHOWN IN TIME — a read that neither answers nor refuses, or a
  // dialog asked for and closed again before any render showed it (its offer
  // went that moment): the task ends as unavailable rather than leaving the
  // page waiting.
  useEffect(() => {
    if (seenOpen.current || ended.current) return;
    mountedAt.current ??= Date.now();
    const timer = window.setTimeout(
      () => {
        if (!seenOpen.current && !ended.current) end({ name: member?.name ?? null, saved: false, blocked: false, unavailable: true });
      },
      Math.max(0, OPEN_WAIT_MS - (Date.now() - mountedAt.current)),
    );

    return () => {
      window.clearTimeout(timer);
    };
  });

  // EVERY DIALOG IT OPENED HAS CLOSED, and nothing is in flight: the task ends.
  const teamOpen = edit.teamDialog.opening !== null || edit.teamErasures.shown !== null || edit.teamPending;
  const scheduleOpen = source.formOpen || source.checked !== null || source.erasures.shown !== null || source.pending;
  const open = move === null ? scheduleOpen : teamOpen;
  const saved = move === null ? source.saved === CHANGE_SET : edit.teamConfirmed;

  // ENDED ONLY ONCE SEEN OPEN, THEN CLOSED (`dialogTaskStepOf`): this check
  // can see `open` from before the opening landed — in the commit that asked
  // for it, and again when StrictMode replays a fresh mount's effects.
  useEffect(() => {
    const step = dialogTaskStepOf({ opened: opened.current, ended: ended.current, seenOpen: seenOpen.current, open });

    if (step === DIALOG_TASK_SEEN) seenOpen.current = true;
    if (step === DIALOG_TASK_END) end({ name: member?.name ?? null, saved, blocked: false, unavailable: false });
  });

  return move === null ? (
    <MemberScheduleSourceDialogs source={source} />
  ) : (
    <>
      <MemberTeamDialog edit={edit} />
      <MemberTeamErasures edit={edit} />
    </>
  );
}
