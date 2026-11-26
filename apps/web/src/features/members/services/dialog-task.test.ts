import { describe, expect, it } from 'vitest';

import {
  DIALOG_TASK_END,
  DIALOG_TASK_SEEN,
  DIALOG_TASK_WAIT,
  dialogTaskStepOf,
} from '@/features/members/services/dialog-task';

/** The host's end check over a sequence of renders, refs carried as the host carries them. */
function run(renders: readonly { readonly opened: boolean; readonly open: boolean }[]): string[] {
  let seenOpen = false;
  let ended = false;

  return renders.map(({ opened, open }) => {
    const step = dialogTaskStepOf({ opened, ended, seenOpen, open });

    if (step === DIALOG_TASK_SEEN) seenOpen = true;
    if (step === DIALOG_TASK_END) ended = true;

    return step;
  });
}

describe('dialogTaskStepOf (story 21.26)', () => {
  it('never ends in the commit that asked for the dialog, which still sees it closed', () => {
    expect(dialogTaskStepOf({ opened: true, ended: false, seenOpen: false, open: false })).toBe(DIALOG_TASK_WAIT);
  });

  it('never ends on StrictMode’s replay of a fresh mount’s effects, however often it runs before the opening lands', () => {
    // Mount, the replay, then the render with the opening, then the close.
    expect(
      run([
        { opened: true, open: false },
        { opened: true, open: false },
        { opened: true, open: true },
        { opened: true, open: false },
      ]),
    ).toEqual([DIALOG_TASK_WAIT, DIALOG_TASK_WAIT, DIALOG_TASK_SEEN, DIALOG_TASK_END]);
  });

  it('keeps waiting while the dialog, its erasures or its write stay open, and ends once', () => {
    expect(
      run([
        { opened: true, open: true },
        { opened: true, open: true },
        { opened: true, open: false },
        { opened: true, open: false },
      ]),
    ).toEqual([DIALOG_TASK_SEEN, DIALOG_TASK_SEEN, DIALOG_TASK_END, DIALOG_TASK_WAIT]);
  });

  it('does nothing before the host asked', () => {
    expect(dialogTaskStepOf({ opened: false, ended: false, seenOpen: false, open: false })).toBe(DIALOG_TASK_WAIT);
    expect(dialogTaskStepOf({ opened: false, ended: false, seenOpen: false, open: true })).toBe(DIALOG_TASK_WAIT);
  });
});
