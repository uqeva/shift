import { createRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { CreateOrganizationForm } from '@/features/auth/components/create-organization-form';
import { useCreateOrganization } from '@/features/auth/hooks/use-create-organization';
import { useSetupHolding } from '@/features/auth/hooks/use-setup-holding';
import { SIGNED_IN_HOME, returnSearchOf, returnTargetOf } from '@/features/auth/services/return-target';
import {
  APP_DESTINATION,
  SIGN_OUT_DESTINATION,
  sessionDestination,
} from '@/features/auth/services/session-destination';
import { NO_ADDRESS, setupSearchOf } from '@/features/auth/services/signup';
import { guardMemberRole } from '@/features/navigation/services/admin-guard';
import { isAdministrator } from '@/features/navigation/services/role';
import { FIRST_FRAME_STEP, STEP_SLUGS, STEP_TOTAL } from '@/features/onboarding/services/steps';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

/**
 * `/postavljanje`, step 1 (story 19.3, UX-DR66, AD-23, AD-24): a claimless
 * EMAIL identity founds its organization here. No app shell: the Shift
 * lockup, the signed-in address and *Odjava* (C9's evidence: the address is
 * named before anything is created), then the create-organization form.
 * Outside the app layout, because the layout's guard is what sends the
 * session here. Steps 2–7 are 19.4's (`/postavljanje/$step`). Composes only.
 */
export function SetupScreen(): ReactNode {
  const { email } = postavljanjeRoute.useRouteContext();
  const { potvrdeno, povratak } = postavljanjeRoute.useSearch();
  const holding = useSetupHolding();
  const screen = useCreateOrganization(povratak);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <p className="font-heading text-xl font-semibold">{t('auth.brand.name')}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <p className="min-w-0 break-words text-sm text-muted-foreground">{email}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              void holding.leave();
            }}
          >
            {t('signup.setup.signOut')}
          </Button>
        </div>
      </header>
      {holding.signOutFailed ? <Notice role="alert">{t('signup.setup.signOutError')}</Notice> : null}
      <div className="grid gap-2">
        <h1 className="font-heading text-2xl font-extrabold">{t('signup.setup.heading')}</h1>
        <p className="text-muted-foreground">{t('signup.setup.lede', { total: STEP_TOTAL })}</p>
      </div>
      {potvrdeno === true ? <Notice role="status">{t('signup.confirm.confirmed')}</Notice> : null}
      <CreateOrganizationForm screen={screen} email={email} />
    </main>
  );
}

export const postavljanjeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/postavljanje',
  // `Adresa je potvrđena.` once, on arrival from `/potvrda`; and the return
  // target the app's guard carried (D7), followed after founding.
  validateSearch: (search: Record<string, unknown>) => ({ ...setupSearchOf(search), ...returnSearchOf(search) }),
  beforeLoad: async (options) => {
    const { context, search } = options;
    const session = await resolvedSession(context.currentSession);

    if (session === null) throw redirect({ to: '/prijava' });

    const destination = sessionDestination(session);

    if (destination === APP_DESTINATION) {
      // 19.3 D7: a carried return target still wins, validated as `_app`'s
      // sign-in routes do. One the validator refuses counts as none (review 1).
      const target = returnTargetOf(search.povratak, context.isKnownPath);
      if (target !== SIGNED_IN_HOME) throw redirect({ href: target });
      // STORY 19.4 (AD-24, D1, D2): a claimed admin asking for setup reaches
      // step 2, whatever founded the organization; anyone else goes to *Danas*.
      // ALWAYS A FRESH ROLE READ (review 1): no `cause` is passed, so the
      // read never reuses a cached answer. Founding navigates here from this
      // very route (a `stay`), and the role cached before the claim existed
      // must not send the new Founding Admin to *Danas*.
      if (isAdministrator(await guardMemberRole({ context }))) {
        throw redirect({ to: '/postavljanje/$step', params: { step: STEP_SLUGS[FIRST_FRAME_STEP] }, replace: true });
      }
      throw redirect({ to: '/danas', replace: true });
    }
    // A claimless username identity lost its `members` row: signed out here.
    if (destination === SIGN_OUT_DESTINATION) {
      await context.endLocalSession?.();
      throw redirect({ to: '/prijava' });
    }

    return { email: session.user.email ?? NO_ADDRESS };
  },
  component: SetupScreen,
});
