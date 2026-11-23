import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowRight } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { useOnboardingProgress } from '@/features/onboarding/hooks/use-onboarding-progress';
import { FACT_TOTAL, STEP_SLUGS, stepNameMessageKey } from '@/features/onboarding/services/steps';
import { OfflineWriteNote } from '@/components/offline-write-note';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { t } from '@/lib/i18n';

/**
 * The one dismiss write, as the card needs it. Structural, so the card takes
 * the organization feature's own hook (`useOnboardingDismiss`) from the page
 * and imports no write module of another feature (D3).
 */
export interface CardDismiss {
  readonly pending: boolean;
  readonly failure: string | null;
  dismiss(organizationId: string): Promise<boolean>;
  reset(): void;
}

/**
 * STORY 19.4 (UX-DR69, AD-24): the *Postavljanje* card, first on an admin's
 * *Danas*. Drawn for an active admin of an organization founded by signup,
 * not dismissed, with fact steps left; absent while any of its reads is
 * missing, and never the skeleton (it sits outside *Danas*'s freshness set,
 * as the loan line does). *Sakrij* asks one neutral question and writes the
 * one stored fact, for every admin.
 */
export function OnboardingCard({
  admin,
  dismiss,
  onDismissed,
}: {
  readonly admin: boolean;
  readonly dismiss: CardDismiss;
  /** Where focus goes once the card is gone: the page's own heading. */
  readonly onDismissed: () => void;
}): ReactNode {
  const headingId = useId();
  const hideTitleId = useId();
  const { organization, card } = useOnboardingProgress({ admin, forCard: true });
  const [asking, setAsking] = useState(false);
  // The shared offline gate, as every other write's (story 8.3a).
  const gate = useWriteGate();

  if (card === null || organization === null) return null;

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div className="grid gap-1">
          <h2 id={headingId} className="font-heading text-lg font-semibold">
            {t('onboarding.card.title', { count: card.remaining.length })}
          </h2>
          <p className="flex flex-wrap gap-x-1 text-sm text-muted-foreground tabular-nums">
            <span>{t('onboarding.card.set', { set: card.set, facts: FACT_TOTAL })}</span>
            {card.rotationLeft ? <span>{t('onboarding.card.rotationLeft')}</span> : null}
          </p>
        </div>
        <ul aria-label={t('onboarding.card.listLabel')} className="grid gap-1">
          {card.remaining.map((step) => (
            <li key={step}>
              <Link
                to="/postavljanje/$step"
                params={{ step: STEP_SLUGS[step] }}
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                {t(stepNameMessageKey(step))}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild className="h-11">
            <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[card.first] }}>
              {t('onboarding.card.resume', { step: t(stepNameMessageKey(card.first)) })}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => {
              dismiss.reset();
              setAsking(true);
            }}
          >
            {t('onboarding.card.hide')}
          </Button>
        </div>
      </section>
      {asking ? (
        <ConfirmDialog
          busy={dismiss.pending}
          onCancel={() => {
            if (!dismiss.pending) setAsking(false);
          }}
          aria-labelledby={hideTitleId}
        >
          <DialogHeader
            closeLabel={t('onboarding.card.cancel')}
            onClose={() => {
              if (!dismiss.pending) setAsking(false);
            }}
          >
            <DialogTitle id={hideTitleId}>{t('onboarding.card.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('onboarding.card.dialogBody')}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('onboarding.card.dialogWhere')}</p>
          {dismiss.failure === null || !gate.online ? null : <Notice role="alert">{t('onboarding.card.refused')}</Notice>}
          <OfflineWriteNote gate={gate} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={dismiss.pending}
              onClick={() => {
                setAsking(false);
              }}
            >
              {t('onboarding.card.cancel')}
            </Button>
            {/* NEUTRAL, never `destructive` (UX-DR69): hiding a reminder deletes nothing. */}
            <Button
              type="button"
              className="h-11 aria-disabled:opacity-50"
              disabled={dismiss.pending}
              aria-busy={dismiss.pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online) return;
                void dismiss.dismiss(organization.id).then((landed) => {
                  if (!landed) return;
                  setAsking(false);
                  // The card goes with the dialog: focus to a stable place.
                  onDismissed();
                });
              }}
            >
              {t('onboarding.card.confirm')}
            </Button>
          </DialogFooter>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/**
 * STORY 19.4 (UX-DR70): *Kalendar* with no team, for an admin while the card
 * would be drawn: *Nastavi postavljanje*, to the first step left. A member
 * never sees it.
 */
export function CalendarSetupResume({ admin }: { readonly admin: boolean }): ReactNode {
  const { card, facts } = useOnboardingProgress({ admin, forCard: true });

  if (card === null || facts.teams !== 0) return null;

  return (
    <Button asChild variant="outline" className="h-11 w-full sm:w-auto sm:self-start">
      <Link to="/postavljanje/$step" params={{ step: STEP_SLUGS[card.first] }}>
        {t('onboarding.card.calendarResume')}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}
