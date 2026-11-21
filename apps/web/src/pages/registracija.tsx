import { createRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SentCard } from '@/features/auth/components/sent-card';
import { SignupForm } from '@/features/auth/components/signup-form';
import { useSignup } from '@/features/auth/hooks/use-signup';
import { SENT_SIGNUP, signupEnabled } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

/**
 * `/registracija` (story 19.2, UX-DR60, UX-DR63): a stranger creates an
 * account, which founds a NEW organization and never joins one. Then the one
 * neutral *Provjeri e-poštu* screen, in the same card.
 *
 * Composes only: the state is `useSignup`, the drawing `SignupForm` and
 * `SentCard`, every rule `@/features/auth/services/signup`.
 */
export function SignupScreen(): ReactNode {
  const screen = useSignup();

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        {screen.sent === null ? (
          <>
            <CardHeader>
              <CardTitle asChild>
                <h1>{t('signup.heading')}</h1>
              </CardTitle>
              <CardDescription>{t('signup.lede')}</CardDescription>
            </CardHeader>
            <CardContent>
              <SignupForm screen={screen} />
            </CardContent>
          </>
        ) : (
          <SentCard
            key={screen.sent.at}
            address={screen.sent.address}
            kind={SENT_SIGNUP}
            at={screen.sent.at}
            onCorrect={screen.correct}
          />
        )}
      </Card>
    </AuthLayout>
  );
}

export const registracijaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/registracija',
  // AD-21's third switch: with it shut the page does not exist for anyone,
  // and a signed-in visitor has an account already. Both go elsewhere.
  beforeLoad: async ({ context }) => {
    if (!signupEnabled()) throw redirect({ to: '/prijava' });
    if ((await resolvedSession(context.currentSession)) !== null) throw redirect({ to: '/' });
  },
  component: SignupScreen,
});
