import { createRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { useSetupHolding } from '@/features/auth/hooks/use-setup-holding';
import { SETUP_DESTINATION, sessionDestination } from '@/features/auth/services/session-destination';
import { NO_ADDRESS, setupSearchOf } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

/**
 * `/postavljanje` as story 19.2 leaves it: where a claimless EMAIL identity
 * waits (AD-24's `sessionDestination`), with its address and *Odjava*. It sits
 * outside the app layout, as the set-password step does, because a claimless
 * session reads nothing there. Story 19.3 replaces the body with step 1, the
 * create-organization form (AD-23, UX-DR66).
 */
export function SetupHoldingScreen(): ReactNode {
  const { email } = postavljanjeRoute.useRouteContext();
  const { potvrdeno } = postavljanjeRoute.useSearch();
  const screen = useSetupHolding();

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle asChild>
            <h1>{t('signup.setup.heading')}</h1>
          </CardTitle>
          <CardDescription className="min-w-0 break-words">{t('signup.setup.signedInAs', { email })}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {potvrdeno === true ? <Notice role="status">{t('signup.confirm.confirmed')}</Notice> : null}
          <p>{t('signup.setup.body')}</p>
          {screen.signOutFailed ? <Notice role="alert">{t('signup.setup.signOutError')}</Notice> : null}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => {
              void screen.leave();
            }}
          >
            {t('signup.setup.signOut')}
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export const postavljanjeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/postavljanje',
  // `Adresa je potvrđena.` is shown once, on arrival from `/potvrda`.
  validateSearch: setupSearchOf,
  beforeLoad: async ({ context }) => {
    const session = await resolvedSession(context.currentSession);

    if (session === null) throw redirect({ to: '/prijava' });
    // A session with an organization, or one that is not an email identity's,
    // has nothing to set up here: the app decides for it.
    if (sessionDestination(session) !== SETUP_DESTINATION) throw redirect({ to: '/' });

    return { email: session.user.email ?? NO_ADDRESS };
  },
  component: SetupHoldingScreen,
});
