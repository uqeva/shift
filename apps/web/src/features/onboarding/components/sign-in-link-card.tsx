import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Copy } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import {
  LINK_STATUS_MS,
  copySignInLink,
  linkCopyMessageKey,
  signInLinkOf,
  type LinkCopy,
} from '@/features/onboarding/services/sign-in-link';
import { t } from '@/lib/i18n';

/**
 * STORY 19.4 (UX-DR67, AD-24, F2): step 6's sign-in link with *Kopiraj*. The
 * "invitation" is the shipped hand-off: the admin gives each person this link
 * with the username and the initial password *Nova osoba* shows once. No
 * email invitation exists.
 */
export function SignInLinkCard({ slug }: { readonly slug: string }): ReactNode {
  const [copied, setCopied] = useState<LinkCopy | null>(null);
  // How many copies were made: the status line is mounted anew for each, so a
  // second *Kopiraj* is announced again (as the resend's, D10).
  const [copies, setCopies] = useState(0);
  const link = signInLinkOf(window.location.origin, slug);

  // The status does not linger: it goes a few seconds after the last copy.
  useEffect(() => {
    if (copied === null) return undefined;
    const timer = window.setTimeout(() => {
      setCopied(null);
    }, LINK_STATUS_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied, copies]);

  async function copy(): Promise<void> {
    setCopied(await copySignInLink(navigator.clipboard as Clipboard | undefined, link));
    setCopies((count) => count + 1);
  }

  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-2 p-4 sm:p-6">
        <p className="font-semibold">{t('onboarding.members.signInLink')}</p>
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          {/* DATA, in a monospace face; it wraps at its slashes rather than overflowing. */}
          <p className="min-w-0 break-all font-mono text-sm">{link}</p>
          <Button
            className="h-11 shrink-0"
            type="button"
            variant="outline"
            onClick={() => {
              void copy();
            }}
          >
            <Copy aria-hidden />
            {t('onboarding.members.copy')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('onboarding.members.signInHint')}</p>
        {copied === null ? null : (
          <Notice key={copies} role="status">
            {t(linkCopyMessageKey(copied))}
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}
