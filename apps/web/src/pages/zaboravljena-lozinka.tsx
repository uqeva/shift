import { createRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RecoverRequestForm } from '@/features/auth/components/recover-request-form';
import { SentCard } from '@/features/auth/components/sent-card';
import { useRecoverRequest } from '@/features/auth/hooks/use-recover-request';
import { SENT_RECOVERY, signupEnabled } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { rootRoute } from '@/pages/__root';

/**
 * `/zaboravljena-lozinka` (story 19.2, UX-DR64): an email identity asks for a
 * recovery link, and every address gets the one neutral answer (AD-22). The
 * link opens `/potvrda?type=recovery`. Composes only.
 */
export function RecoverRequestScreen(): ReactNode {
  const screen = useRecoverRequest();

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        {screen.sent === null ? (
          <>
            <CardHeader>
              <CardTitle asChild>
                <h1>{t('signup.recover.heading')}</h1>
              </CardTitle>
              <CardDescription>{t('signup.recover.lede')}</CardDescription>
            </CardHeader>
            <CardContent>
              <RecoverRequestForm screen={screen} />
            </CardContent>
          </>
        ) : (
          <SentCard
            key={screen.sent.at}
            address={screen.sent.address}
            kind={SENT_RECOVERY}
            at={screen.sent.at}
            onCorrect={screen.correct}
          />
        )}
      </Card>
    </AuthLayout>
  );
}

export const zaboravljenaLozinkaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/zaboravljena-lozinka',
  // AD-21's third switch renders this page too. A signed-in visitor may still
  // ask for a link: recovery answers every address alike.
  beforeLoad: () => {
    if (!signupEnabled()) throw redirect({ to: '/prijava' });
  },
  component: RecoverRequestScreen,
});
