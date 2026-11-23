import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Rows } from '@/components/ui/icon';
import {
  setCountOf,
  stepMarkedDoneOf,
  stepStateMessageKey,
  stepStateOf,
  type OnboardingFacts,
} from '@/features/onboarding/services/progress';
import {
  FACT_TOTAL,
  ONBOARDING_STEPS,
  ORGANIZATION_STEP,
  STEP_SLUGS,
  STEP_TOTAL,
  stepNameMessageKey,
  stepNumberOf,
  type FrameStep,
  type OnboardingStep,
} from '@/features/onboarding/services/steps';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** One step's row: its number (a check once done), its name and its state in words. */
function StepRow({
  step,
  current,
  facts,
  onOpen,
}: {
  readonly step: OnboardingStep;
  readonly current: FrameStep;
  readonly facts: OnboardingFacts;
  readonly onOpen?: (() => void) | undefined;
}): ReactNode {
  const state = stepStateOf(facts, step);
  const stateKey = stepStateMessageKey(state);
  const done = stepMarkedDoneOf(state);
  const isCurrent = step === current;
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          done ? 'border-ink bg-ink text-ink-foreground' : 'border-border',
          isCurrent && !done ? 'border-ink' : null,
        )}
      >
        {done ? <Check className="size-4" /> : stepNumberOf(step)}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className={cn('font-semibold', isCurrent ? 'underline underline-offset-4' : null)}>
          {t(stepNameMessageKey(step))}
        </span>
        {stateKey === null ? null : <span className="text-xs text-muted-foreground">{t(stateKey)}</span>}
      </span>
    </>
  );

  // STEP 1 IS DONE BY EXISTING and has no page to reopen: it is named, never linked.
  if (step === ORGANIZATION_STEP) {
    return <li className="flex min-h-11 items-center gap-3 px-2 py-1.5">{body}</li>;
  }

  return (
    <li>
      <Link
        to="/postavljanje/$step"
        params={{ step: STEP_SLUGS[step] }}
        aria-current={isCurrent ? 'step' : undefined}
        onClick={onOpen}
        className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    </li>
  );
}

/** The seven steps in order, every one reachable (UX-DR65: no step is locked). */
function StepList({
  current,
  facts,
  onOpen,
}: {
  readonly current: FrameStep;
  readonly facts: OnboardingFacts;
  readonly onOpen?: () => void;
}): ReactNode {
  return (
    <ol className="grid gap-1">
      {ONBOARDING_STEPS.map((step) => (
        <StepRow key={step} step={step} current={current} facts={facts} onOpen={onOpen} />
      ))}
    </ol>
  );
}

/**
 * STORY 19.4 (UX-DR65): the rail card from 640 px, headed `Korak {n} od 7`,
 * each step's state in words, the current one `aria-current="step"` and
 * underlined. Every state is derived (`progress.ts`).
 */
export function SetupRail({ current, facts }: { readonly current: FrameStep; readonly facts: OnboardingFacts }): ReactNode {
  return (
    <Card className="min-w-0 p-4 max-sm:hidden">
      <nav aria-label={t('onboarding.frame.railLabel')} className="grid gap-3">
        <h2 className="font-heading text-base font-semibold">
          {t('onboarding.frame.railHeading', { n: stepNumberOf(current), total: STEP_TOTAL })}
        </h2>
        <StepList current={current} facts={facts} />
      </nav>
    </Card>
  );
}

/**
 * Below 640 px (UX-DR65): `Korak {n} od 7 · {step}` over a seven-segment bar
 * (done, current and open differ by fill and outline, and the words carry it),
 * and *Svi koraci*, which opens the rail in the docked sheet.
 */
export function SetupProgressCard({
  current,
  facts,
}: {
  readonly current: FrameStep;
  readonly facts: OnboardingFacts;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const sheetHeadingId = useId();
  const number = stepNumberOf(current);

  return (
    <Card className="grid min-w-0 gap-3 p-4 sm:hidden">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-semibold tabular-nums">
          {t('onboarding.frame.progress', { n: number, total: STEP_TOTAL, step: t(stepNameMessageKey(current)) })}
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            setOpen(true);
          }}
        >
          <Rows aria-hidden />
          {t('onboarding.frame.allSteps')}
        </Button>
      </div>
      <div aria-hidden className="grid grid-cols-7 gap-1">
        {ONBOARDING_STEPS.map((step) => {
          const done = stepMarkedDoneOf(stepStateOf(facts, step));

          return (
            <span
              key={step}
              className={cn(
                'h-1.5 rounded-full border',
                done ? 'border-ink bg-ink' : step === current ? 'border-2 border-ink bg-background' : 'border-border bg-muted',
              )}
            />
          );
        })}
      </div>
      <Dialog open={open} onOpenChange={setOpen} docked aria-labelledby={sheetHeadingId}>
        <DialogHeader
          closeLabel={t('onboarding.frame.close')}
          onClose={() => {
            setOpen(false);
          }}
        >
          <DialogTitle id={sheetHeadingId}>{t('onboarding.frame.sheetHeading')}</DialogTitle>
          <DialogDescription className="tabular-nums">
            {t('onboarding.frame.sheetLine', { set: setCountOf(facts), facts: FACT_TOTAL, n: number, total: STEP_TOTAL })}
          </DialogDescription>
        </DialogHeader>
        <nav aria-label={t('onboarding.frame.railLabel')}>
          <StepList
            current={current}
            facts={facts}
            onOpen={() => {
              setOpen(false);
            }}
          />
        </nav>
      </Dialog>
    </Card>
  );
}
