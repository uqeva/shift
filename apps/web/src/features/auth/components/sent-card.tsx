import type { ReactNode } from 'react';

import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MailSentPanel } from '@/features/auth/components/mail-sent-panel';
import { useMailSent } from '@/features/auth/hooks/use-mail-sent';
import type { SentKind } from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';

/**
 * The neutral screen as a card's header and body (story 19.2, UX-DR63), shared
 * by `/registracija`, an unconfirmed sign-in's new link and
 * `/zaboravljena-lozinka`. Keyed by the caller on the send's instant, so a new
 * send starts its own throttle.
 */
export function SentCard({
  address,
  kind,
  at,
  onCorrect,
}: {
  readonly address: string;
  readonly kind: SentKind;
  readonly at: number;
  readonly onCorrect: () => void;
}): ReactNode {
  const sent = useMailSent(address, kind, at);

  return (
    <>
      <CardHeader>
        <CardTitle asChild>
          <h1>{t('signup.sent.heading')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <MailSentPanel screen={sent} onCorrect={onCorrect} />
      </CardContent>
    </>
  );
}
