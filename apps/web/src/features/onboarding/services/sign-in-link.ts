/**
 * STORY 19.4 (UX-DR67): step 6's sign-in link, the organization's own
 * `/prijava/{kratica}` on this app's origin, and its copy. Pure, so
 * `sign-in-link.test.ts` executes it with no browser; `navigator.clipboard`
 * is absent outside a secure context, so the writer is a parameter.
 */

/** The link a new member signs in at: the app's origin and the organization's slug. */
export function signInLinkOf(origin: string, slug: string): string {
  return `${origin}/prijava/${encodeURIComponent(slug)}`;
}

/** How long a copy's status line stays (review 1: never forever). */
export const LINK_STATUS_MS = 6000;

export const LINK_COPIED = 'copied';
export const LINK_NOT_COPIED = 'notCopied';

export type LinkCopy = typeof LINK_COPIED | typeof LINK_NOT_COPIED;

/** As much of `navigator.clipboard` as the copy uses. */
export interface LinkClipboard {
  writeText(text: string): Promise<void>;
}

/** Copies the link; a missing or refusing clipboard is "not copied", never a throw. */
export async function copySignInLink(clipboard: LinkClipboard | undefined, link: string): Promise<LinkCopy> {
  if (clipboard === undefined) return LINK_NOT_COPIED;

  try {
    await clipboard.writeText(link);

    return LINK_COPIED;
  } catch {
    return LINK_NOT_COPIED;
  }
}

/** The status line after a copy. */
export function linkCopyMessageKey(outcome: LinkCopy): 'onboarding.members.copied' | 'onboarding.members.copyFailed' {
  return outcome === LINK_COPIED ? 'onboarding.members.copied' : 'onboarding.members.copyFailed';
}
