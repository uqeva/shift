import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight } from '@/components/ui/icon';
import { FORWARD_NEXT, forwardOf, type OnboardingFacts } from '@/features/onboarding/services/progress';
import {
  STEP_SLUGS,
  previousFrameStepOf,
  stepNameMessageKey,
  type FrameStep,
} from '@/features/onboarding/services/steps';
import { t } from '@/lib/i18n';

/**
 * STORY 19.4 (UX-DR65): the footer. *Natrag* from step 3, and one forward
 * control: *Preskoči za sada* (outline) while the step's fact is missing,
 * *Dalje: {step}* (ink) once it exists. Both are navigation; nothing is
 * stored. On a phone the footer is a `glass-over-content` bar at the bottom.
 * Step 7 brings its own actions, so it has *Natrag* alone.
 */
export function SetupFooter({ step, facts }: { readonly step: FrameStep; readonly facts: OnboardingFacts }): ReactNode {
  const previous = previousFrameStepOf(step);
  const forward = forwardOf(facts, step);

  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 max-sm:glass-over-content max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {previous === null ? (
        <span />
      ) : (
        <Button asChild variant="ghost" className="h-11">
          <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[previous] }}>
            <ArrowLeft aria-hidden />
            {t('onboarding.frame.back')}
          </Link>
        </Button>
      )}
      {/* INK ONCE THE FACT EXISTS, OUTLINE WHILE IT IS SKIPPED. */}
      {forward !== null && forward.kind === FORWARD_NEXT ? (
        <Button asChild className="h-11">
          <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[forward.to] }}>
            {t('onboarding.frame.next', { step: t(stepNameMessageKey(forward.to)) })}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : null}
      {forward !== null && forward.kind !== FORWARD_NEXT ? (
        <Button asChild variant="outline" className="h-11">
          <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[forward.to] }}>
            {t('onboarding.frame.skip')}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : null}
    </footer>
  );
}
