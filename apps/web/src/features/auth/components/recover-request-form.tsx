import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Envelope } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import type { RecoverRequestScreenState } from '@/features/auth/hooks/use-recover-request';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * `/zaboravljena-lozinka`'s form (story 19.2, UX-DR64): *E-mail* and *Pošalji
 * poveznicu*. Recovery is for email identities only (AD-12); a username
 * identity is told, as on *Prijava*, that its administrator sets the password.
 */
export function RecoverRequestForm({ screen }: { readonly screen: RecoverRequestScreenState }): ReactNode {
  const { emailField, emailDefault, refusal, failure, pending } = screen;
  const gate = useWriteGate();

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void screen.submit(event);
      }}
      className="grid gap-6"
    >
      <div className="grid gap-2">
        <Label htmlFor="recover-email">{t('signup.form.email')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Envelope />
          </InputGroupIcon>
          <Input
            ref={emailField}
            id="recover-email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the screen is this one form; focus opens on its first field, as on Prijava.
            autoFocus
            defaultValue={emailDefault}
            aria-invalid={refusal !== null}
            aria-describedby={refusal === null ? undefined : 'recover-refusal'}
            className="h-11"
          />
        </InputGroup>
      </div>
      {refusal === null ? null : (
        <Notice id="recover-refusal" role="alert">
          {t(refusal)}
        </Notice>
      )}
      {failure === null ? null : <Notice role="alert">{t(failure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <Button
        className="h-11 w-full aria-disabled:opacity-50"
        type="submit"
        aria-disabled={gate.disabled || pending}
        aria-describedby={gate.describedBy()}
        aria-busy={pending}
      >
        {pending ? t('signup.recover.pending') : t('signup.recover.submit')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('signup.recover.username')}</p>
    </form>
  );
}
