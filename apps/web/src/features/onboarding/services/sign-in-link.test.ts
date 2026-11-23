import { describe, expect, it } from 'vitest';

import {
  LINK_COPIED,
  LINK_NOT_COPIED,
  copySignInLink,
  linkCopyMessageKey,
  signInLinkOf,
} from '@/features/onboarding/services/sign-in-link';

describe('step 6’s sign-in link (UX-DR67)', () => {
  it('is the organization’s own Prijava on this origin', () => {
    expect(signInLinkOf('https://app.example.com', 'tvrtka-primjer')).toBe('https://app.example.com/prijava/tvrtka-primjer');
  });

  it('copies through the clipboard, and says so either way without throwing', async () => {
    const written: string[] = [];

    expect(
      await copySignInLink(
        {
          writeText: (text) => {
            written.push(text);
            return Promise.resolve();
          },
        },
        'x',
      ),
    ).toBe(LINK_COPIED);
    expect(written).toEqual(['x']);
    expect(await copySignInLink(undefined, 'x')).toBe(LINK_NOT_COPIED);
    expect(await copySignInLink({ writeText: () => Promise.reject(new Error('denied')) }, 'x')).toBe(LINK_NOT_COPIED);
    expect(linkCopyMessageKey(LINK_COPIED)).toBe('onboarding.members.copied');
    expect(linkCopyMessageKey(LINK_NOT_COPIED)).toBe('onboarding.members.copyFailed');
  });
});
