import { createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmPanel, DeadLinkPanel, RecoveryForm } from '@/features/auth/components/mail-link-panels';
import { useMailLink, type MailLinkScreenState } from '@/features/auth/hooks/use-mail-link';
import { NO_LINK_KEY, potvrdaRemountKey, potvrdaSearchOf, signupEnabled } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { rootRoute } from '@/pages/__root';

/**
 * `/potvrda?token_hash=…&type=…` (story 19.2, AD-12, UX-DR63, UX-DR64): where
 * every Auth email links. It acts only on a press, so loading it, by a person
 * or a mail scanner, consumes nothing. Not behind AD-21's SPA switch: it
 * holds no form a stranger could use without a mail, and a recovery link
 * sent before a switch was shut still works. Composes only.
 */
export function MailLinkScreen(): ReactNode {
  const search = potvrdaRoute.useSearch();
  const screen = useMailLink(search);

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <MailLinkCard screen={screen} />
      </Card>
    </AuthLayout>
  );
}

/** The card's header and body for the link's state: dead, recovery or a confirmation. */
function MailLinkCard({ screen }: { readonly screen: MailLinkScreenState }): ReactNode {
  if (screen.dead) {
    return (
      <>
        <CardHeader>
          <CardTitle asChild>
            <h1>{t('signup.dead.heading')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DeadLinkPanel recovery={screen.recovery} canRecover={signupEnabled()} />
        </CardContent>
      </>
    );
  }

  if (screen.recovery) {
    return (
      <>
        <CardHeader>
          <CardTitle asChild>
            <h1>{t('signup.recovery.heading')}</h1>
          </CardTitle>
          <CardDescription>{t('signup.recovery.lede')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoveryForm screen={screen} />
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle asChild>
          <h1>{t('signup.confirm.heading')}</h1>
        </CardTitle>
        <CardDescription>{t('signup.confirm.lede')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ConfirmPanel screen={screen} />
      </CardContent>
    </>
  );
}

/** The last link's remount key, held while its token leaves the address. */
let heldRemountKey = NO_LINK_KEY;

export const potvrdaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/potvrda',
  // The two values, as strings, and nothing else; judged only on the press.
  validateSearch: potvrdaSearchOf,
  // REMOUNTED PER LINK (review of 19.2): the hook reads the link once, at
  // mount, so a second link opened in the same tab mounts afresh. Taking the
  // token out of the address keeps the key (CI of 19.2), or the screen would
  // remount with no link and call a live link dead.
  remountDeps: ({ search }) => (heldRemountKey = potvrdaRemountKey(search, heldRemountKey)),
  component: MailLinkScreen,
});
