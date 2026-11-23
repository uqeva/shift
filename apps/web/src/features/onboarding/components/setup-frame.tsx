import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { SignOut } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { SetupFooter } from '@/features/onboarding/components/setup-footer';
import { SetupProgressCard, SetupRail } from '@/features/onboarding/components/setup-rail';
import type { OnboardingProgress } from '@/features/onboarding/hooks/use-onboarding-progress';
import { stepNameMessageKey, type FrameStep } from '@/features/onboarding/services/steps';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import { useRenderableLogo } from '@/features/organization/hooks/logo-url';
import { t } from '@/lib/i18n';

/**
 * STORY 19.4 (UX-DR65, AD-24): the setup frame for steps 2–7. No app shell:
 * a top bar with the organization's lockup, *Postavljanje* and *Izađi iz
 * postavljanja* (to *Danas*); the rail from 640 px, the progress card below
 * it; the step's heading and lede; the step's body, which is the shipped
 * surface's own section composed by the page (D9); and the footer.
 *
 * It composes no other feature's surface itself: the page hands the step's
 * body in as children.
 */
export function SetupFrame({
  step,
  progress,
  lede,
  children,
}: {
  readonly step: FrameStep;
  readonly progress: OnboardingProgress;
  /** The step's lede under its heading. */
  readonly lede: string;
  readonly children: ReactNode;
}): ReactNode {
  const { organization, facts } = progress;
  const logo = useRenderableLogo(organization?.logoPath ?? null);

  return (
    <div className="flex min-h-svh w-full min-w-0 flex-col">
      <header className="glass-over-content sticky top-0 z-10 border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <OrganizationLockup
              organization={organization}
              logoUrl={logo.url}
              onUnrenderable={logo.onUnrenderable}
              pending={progress.loading}
              compact
            />
            <div className="grid min-w-0">
              <p className="min-w-0 truncate font-heading font-bold">{organization?.name}</p>
              <p className="text-sm text-muted-foreground">{t('onboarding.frame.label')}</p>
            </div>
          </div>
          <Button asChild variant="outline" className="h-11">
            <Link to="/danas">
              <SignOut aria-hidden />
              {t('onboarding.frame.exit')}
            </Link>
          </Button>
        </div>
      </header>
      <div className="mx-auto grid w-full min-w-0 max-w-6xl flex-1 gap-6 px-4 py-6 sm:grid-cols-[14rem_minmax(0,1fr)] sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="min-w-0 sm:sticky sm:top-24 sm:self-start">
          <SetupRail current={step} facts={facts} />
          <SetupProgressCard current={step} facts={facts} />
        </aside>
        <main className="flex min-w-0 flex-col gap-6" aria-busy={progress.loading}>
          <PageHeader>
            <div className="min-w-0">
              <PageTitle asChild>
                <h1>{t(stepNameMessageKey(step))}</h1>
              </PageTitle>
              <PageDescription>{lede}</PageDescription>
            </div>
          </PageHeader>
          {/* REVIEW 1: an organization that could not be read is said, with
              its retry, never an empty lockup and nothing else. */}
          {progress.organizationFailed ? (
            <div className="grid min-w-0 gap-2">
              <Notice role="alert">{t('onboarding.frame.unavailable')}</Notice>
              <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={progress.retry}>
                {t('onboarding.frame.retry')}
              </Button>
            </div>
          ) : null}
          {children}
          <SetupFooter step={step} facts={facts} />
        </main>
      </div>
    </div>
  );
}
