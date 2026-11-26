/**
 * WHEN A MEMBER DIALOG OPENED FROM ANOTHER PAGE HAS ENDED (story 21.26).
 *
 * `MemberDialogsHost` asks the member page's hooks to open a dialog, then
 * waits for every dialog it opened to close. Its end check runs in an effect,
 * and an effect may see `open` from a render BEFORE the opening landed: in
 * the very commit that asked for it, and again when React's StrictMode
 * replays a fresh mount's effects with the host's refs already set. So the
 * task ends only once the dialog has been SEEN open and is then closed. A
 * dialog that never shows (its offer went in the same moment) is the host's
 * timer's to end, never this check's.
 */

/** Nothing to do yet: not asked, already ended, or not yet seen open. */
export const DIALOG_TASK_WAIT = 'wait';
/** The dialog is open now: remember that it was seen. */
export const DIALOG_TASK_SEEN = 'seen';
/** Seen open, now closed with nothing in flight: the task ends. */
export const DIALOG_TASK_END = 'end';

export type DialogTaskStep = typeof DIALOG_TASK_WAIT | typeof DIALOG_TASK_SEEN | typeof DIALOG_TASK_END;

/** What the host's end check does with the state it sees. */
export function dialogTaskStepOf(state: {
  /** The host has asked for the dialog. */
  readonly opened: boolean;
  /** The task has already ended. */
  readonly ended: boolean;
  /** A render has shown the dialog (or its erasures, or a write) open. */
  readonly seenOpen: boolean;
  /** The dialog, its erasure confirmation or its write is open or in flight now. */
  readonly open: boolean;
}): DialogTaskStep {
  if (!state.opened || state.ended) return DIALOG_TASK_WAIT;
  if (state.open) return DIALOG_TASK_SEEN;

  return state.seenOpen ? DIALOG_TASK_END : DIALOG_TASK_WAIT;
}
