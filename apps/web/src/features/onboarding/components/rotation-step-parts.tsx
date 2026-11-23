import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionNumber } from '@/components/ui/section-number';
import {
  prerequisiteMessageKey,
  prerequisiteStepOf,
  type RotationPrerequisite,
} from '@/features/onboarding/services/progress';
import { STEP_SLUGS, SHIFT_TYPES_STEP, stepNameMessageKey, stepNumberOf } from '@/features/onboarding/services/steps';
import { t } from '@/lib/i18n';

/**
 * STORY 19.4 (UX-DR67): step 5 with no team or no working shift type draws no
 * builder that cannot save. It says what is missing, each with a link to the
 * step that sets it.
 */
export function RotationPrerequisites({ missing }: { readonly missing: readonly RotationPrerequisite[] }): ReactNode {
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-3 p-4 sm:p-6">
        <p className="font-semibold">{t('onboarding.rotation.missing')}</p>
        <ul className="grid gap-3">
          {missing.map((item) => {
            const step = prerequisiteStepOf(item);

            return (
              <li key={item} className="grid gap-1">
                <span>{t(prerequisiteMessageKey(item))}</span>
                <Link
                  to="/postavljanje/$step"
                  params={{ step: STEP_SLUGS[step] }}
                  className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                >
                  {t('onboarding.rotation.missingLink', { n: stepNumberOf(step), step: t(stepNameMessageKey(step)) })}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted-foreground">{t('onboarding.rotation.missingNote')}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Step 5's first section in the builder's slot: the shift types step 4 owns,
 * counted, with the way back to it. Read-only; the list and its add dialog are
 * step 4's (one write path).
 */
export function RotationTypesNote({ count }: { readonly count: number }): ReactNode {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <SectionNumber value={1} />
        <CardTitle asChild>
          <h2>{t('onboarding.rotation.typesHeading')}</h2>
        </CardTitle>
        <Badge variant="secondary">{t('onboarding.rotation.typesCount', { count })}</Badge>
      </CardHeader>
      <CardContent className="grid gap-1 pt-0">
        <CardDescription>{t('onboarding.rotation.typesNote')}</CardDescription>
        <Link
          to="/postavljanje/$step"
          params={{ step: STEP_SLUGS[SHIFT_TYPES_STEP] }}
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          {t('onboarding.rotation.missingLink', {
            n: stepNumberOf(SHIFT_TYPES_STEP),
            step: t(stepNameMessageKey(SHIFT_TYPES_STEP)),
          })}
        </Link>
      </CardContent>
    </Card>
  );
}
