import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { SignInScreenState } from '@/features/auth/hooks/use-sign-in';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * An unconfirmed email sign-in (story 19.2, UX-DR63). GoTrue says
 * `email_not_confirmed` only for the right password, so the screen may say the
 * address is unconfirmed and offer a new link; the resend lands on the one
 * neutral screen. Drawn under the card's own title.
 */
export function UnconfirmedPanel({ screen }: { readonly screen: SignInScreenState }): ReactNode {
  const gate = useWriteGate();

  return (
    <div className="grid gap-6">
      <p>{t('signup.unconfirmed.body')}</p>
      {screen.resendFailure === null ? null : <Notice role="alert">{t(screen.resendFailure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <div className="grid gap-4">
        <Button
          type="button"
          className="h-11 w-full aria-disabled:opacity-50"
          aria-disabled={gate.disabled || screen.resendPending}
          aria-describedby={gate.describedBy()}
          aria-busy={screen.resendPending}
          onClick={() => {
            void screen.requestNewLink();
          }}
        >
          {screen.resendPending ? t('signup.unconfirmed.pending') : t('signup.unconfirmed.resend')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('signup.unconfirmed.note')}</p>
        <Button type="button" variant="link" className="h-11 justify-self-start px-0" onClick={screen.backToForm}>
          {t('signup.unconfirmed.back')}
        </Button>
      </div>
    </div>
  );
}
