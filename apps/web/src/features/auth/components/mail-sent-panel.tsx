import { useId, type ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { MailSentScreenState } from '@/features/auth/hooks/use-mail-sent';
import { RESEND_WAIT_SECONDS, countdownOf } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * The one neutral answer (story 19.2, UX-DR63, AD-22): after a signup, a
 * resend or a recovery request, for a new, a known confirmed and a known
 * unconfirmed address alike. The gateway answered `200 {}` for all of them and
 * the SPA never read the body, so there is nothing else this screen could say.
 *
 * The address shown is what the person typed, with *Ispravi adresu* back to
 * the form. *Pošalji ponovno* waits 60 s after each send, the remaining time
 * in its name; `aria-disabled`, never `disabled`, so focus stays on it. A
 * resend says the same sentence again as a status line. The only other answer
 * is the per-IP 429, as an alert: about the network, never about the address.
 *
 * The heading is the caller's (the card title), so this draws the body only.
 */
export function MailSentPanel({
  screen,
  onCorrect,
}: {
  readonly screen: MailSentScreenState;
  readonly onCorrect: () => void;
}): ReactNode {
  const { address, signup, secondsLeft, waiting, resent, resends, failure, pending, resend } = screen;
  // STORY 19.4 (D10, the 19.2 deferral): the wait is said once, statically.
  const waitId = useId();
  // Offline, the resend says why it does nothing (story 8.3a's gate).
  const gate = useWriteGate();

  return (
    <div className="grid gap-6">
      <p>{signup ? t('signup.sent.body') : t('signup.recover.sent')}</p>
      <div className="grid gap-2 text-sm">
        <p className="min-w-0 break-words">
          {signup ? t('signup.sent.typed', { address }) : t('signup.recover.typed', { address })}
        </p>
        <Button type="button" variant="link" className="h-11 justify-self-start px-0" onClick={onCorrect}>
          {t('signup.sent.correct')}
        </Button>
        <p className="text-muted-foreground">{t('signup.sent.note')}</p>
      </div>
      {/* KEYED BY THE RESEND (D10): each landed resend mounts the status
          line anew, so a second one is announced again. */}
      {resent ? (
        <Notice key={resends} role="status">
          {t('signup.sent.resent')}
        </Notice>
      ) : null}
      {failure === null ? null : <Notice role="alert">{t(failure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full aria-disabled:opacity-50"
        aria-disabled={gate.disabled || waiting || pending}
        aria-describedby={gate.describedBy(waiting ? waitId : null)}
        aria-busy={pending}
        onClick={() => {
          void resend();
        }}
      >
        {/* THE NAME STAYS `Pošalji ponovno` (D10): the countdown is visible
            text hidden from the accessibility tree, so no screen reader
            re-reads the button each second; the wait is its description. */}
        <span className="sr-only">{t('signup.sent.resend')}</span>
        <span aria-hidden>
          {waiting ? t('signup.sent.resendIn', { time: countdownOf(secondsLeft) }) : t('signup.sent.resend')}
        </span>
      </Button>
      {/* ONLY WHILE IT WAITS, and said once: the time left is never re-read each second. */}
      {waiting ? (
        <p id={waitId} className="sr-only">
          {t('signup.sent.resendWait', { seconds: RESEND_WAIT_SECONDS })}
        </p>
      ) : null}
    </div>
  );
}
