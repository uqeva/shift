import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, Calendar, House } from '@/components/ui/icon';
import type { OnboardingProgress } from '@/features/onboarding/hooks/use-onboarding-progress';
import {
  leftMessageKey,
  remainingStepsOf,
  summaryCountMessageKey,
  summaryOf,
  type SummaryLine,
} from '@/features/onboarding/services/progress';
import {
  ORGANIZATION_STEP,
  ROTATION_STEP,
  STEP_SLUGS,
  stepNameMessageKey,
} from '@/features/onboarding/services/steps';
import { t } from '@/lib/i18n';
import { shownDate } from '@/utils/text';

/** A done line's fact in words: a count, or the rotation's `Vrijedi od`. */
function factText(line: SummaryLine): string {
  if (line.step === ROTATION_STEP) {
    return line.from === null ? t('onboarding.state.set') : t('onboarding.done.rotationFrom', { date: shownDate(line.from) });
  }

  return t(summaryCountMessageKey(line.step), { count: line.count });
}

/**
 * STORY 19.4 (UX-DR68): step 7, *Gotovo*. The six steps' facts from the same
 * progress hook as the rail and the *Danas* card, so the three never
 * disagree. With steps left it names them, each with *Postavi*, and says
 * where the reminder waits; with none left, one plain sentence and *Otvori
 * kalendar*. No celebration.
 */
export function SetupSummary({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  const { organization, facts } = progress;
  const remaining = remainingStepsOf(facts);
  const first = remaining[0];

  return (
    <>
      <p>
        {first === undefined
          ? t('onboarding.done.finished')
          : t(leftMessageKey(progress.cardAwaits), { count: remaining.length })}
      </p>
      <Card className="min-w-0">
        <dl aria-label={t('onboarding.done.summaryLabel')} className="divide-y divide-border">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
            <dt className="font-semibold">{t(stepNameMessageKey(ORGANIZATION_STEP))}</dt>
            <dd className="min-w-0 break-words text-muted-foreground">
              {organization === null
                ? null
                : t('onboarding.done.organizationLine', { name: organization.name, slug: organization.slug })}
            </dd>
          </div>
          {summaryOf(facts).map((line) => (
            <div
              key={line.step}
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
            >
              <dt className="font-semibold">{t(stepNameMessageKey(line.step))}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-3 text-muted-foreground tabular-nums">
                {line.done ? factText(line) : t('onboarding.state.unset')}
                {line.done ? null : (
                  <Button asChild variant="outline" className="h-11">
                    <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[line.step] }}>
                      <span aria-hidden>{t('onboarding.done.set')}</span>
                      <span className="sr-only">
                        {t('onboarding.done.setLabel', { step: t(stepNameMessageKey(line.step)) })}
                      </span>
                    </Link>
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        {first === undefined ? (
          <Button asChild className="h-11">
            <Link to="/kalendar">
              <Calendar aria-hidden />
              {t('onboarding.done.openCalendar')}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="h-11">
          <Link to="/danas">
            <House aria-hidden />
            {t('onboarding.done.toToday')}
          </Link>
        </Button>
        {first === undefined ? null : (
          <Button asChild className="h-11">
            <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[first] }}>
              {t('onboarding.done.resume', { step: t(stepNameMessageKey(first)) })}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </>
  );
}
