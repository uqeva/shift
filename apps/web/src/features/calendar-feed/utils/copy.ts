/**
 * *Kopiraj* beside the calendar link (story 16.5), on the credential line's
 * terms (story 7.8): the clipboard is a parameter, so both outcomes run in
 * the node suite. `navigator.clipboard` is absent outside a secure context
 * and `writeText` rejects without permission; either way the person is told
 * to select the link by hand. The failure is SWALLOWED, never logged: the
 * value it was handed is the link, a credential.
 */

/** The copy landed. */
export const LINK_COPIED = 'copied';
/** It did not, for whichever reason. */
export const LINK_NOT_COPIED = 'notCopied';

export type LinkCopy = typeof LINK_COPIED | typeof LINK_NOT_COPIED;

/** As much of `navigator.clipboard` as the copy uses. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Copies the text, answering whether it landed. Never throws. */
export async function copyLink(clipboard: ClipboardWriter | undefined, text: string): Promise<LinkCopy> {
  if (clipboard === undefined) return LINK_NOT_COPIED;

  try {
    await clipboard.writeText(text);

    return LINK_COPIED;
  } catch {
    return LINK_NOT_COPIED;
  }
}

/** The status line each outcome renders as. */
export function linkCopyMessageKey(outcome: LinkCopy): 'feed.copied' | 'feed.copyFailed' {
  return outcome === LINK_COPIED ? 'feed.copied' : 'feed.copyFailed';
}
