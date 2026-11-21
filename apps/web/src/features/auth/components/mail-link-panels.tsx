import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Eye, EyeSlash, Lock } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAction, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Rule } from '@/features/auth/components/set-password-form';
import type { MailLinkScreenState } from '@/features/auth/hooks/use-mail-link';
import { failureDescribes, setPasswordMessageKey } from '@/features/auth/services/set-password';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * `/potvrda`'s three bodies (story 19.2, UX-DR63, UX-DR64): the one *Potvrdi*
 * button, the recovery form whose *Spremi novu lozinku* is the press that
 * verifies, and the dead link. Each is drawn under the page's card title.
 */

/** A confirmation link: one button, and nothing sent until it is pressed. */
export function ConfirmPanel({ screen }: { readonly screen: MailLinkScreenState }): ReactNode {
  const gate = useWriteGate();

  return (
    <div className="grid gap-6">
      {screen.failure === null ? null : <Notice role="alert">{t(screen.failure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <Button
        type="button"
        className="h-11 w-full aria-disabled:opacity-50"
        aria-disabled={gate.disabled || screen.pending}
        aria-describedby={gate.describedBy()}
        aria-busy={screen.pending}
        onClick={() => {
          void screen.confirm();
        }}
      >
        {screen.pending ? t('signup.confirm.pending') : t('signup.confirm.submit')}
      </Button>
    </div>
  );
}

/** A recovery link: the set-password step's two fields and live checks. */
export function RecoveryForm({ screen }: { readonly screen: MailLinkScreenState }): ReactNode {
  const { passwordField, repeatField, passwordShown, typed, longEnough, matches, refusal, failure, pending } = screen;
  const gate = useWriteGate();
  const describes = failureDescribes(refusal);

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void screen.saveRecovery(event);
      }}
      className="grid gap-6"
    >
      <div className="grid gap-2">
        <Label htmlFor="recovery-password">{t('auth.setPassword.password')}</Label>
        <InputGroup className="[&>input]:pr-12">
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={passwordField}
            id="recovery-password"
            name="new-password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the screen is this one form; focus opens on its first field, as on Prijava.
            autoFocus
            onInput={screen.fieldsInput}
            aria-describedby={describes.password ? 'recovery-refusal recovery-length' : 'recovery-length'}
            className="h-11"
          />
          <InputGroupAction>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 p-0"
              aria-label={t('auth.passwordShow')}
              aria-pressed={passwordShown}
              aria-controls="recovery-password recovery-repeat"
              onClick={screen.togglePassword}
            >
              {passwordShown ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </InputGroupAction>
        </InputGroup>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recovery-repeat">{t('auth.setPassword.repeat')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={repeatField}
            id="recovery-repeat"
            name="repeat-password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            onInput={screen.fieldsInput}
            aria-describedby={describes.repeat ? 'recovery-refusal recovery-match' : 'recovery-match'}
            className="h-11"
          />
        </InputGroup>
      </div>
      <div role="status" aria-atomic={false} className="grid gap-1 text-sm">
        <Rule id="recovery-length" met={longEnough}>
          {t('auth.setPassword.ruleLength', { count: typed })}
        </Rule>
        <Rule id="recovery-match" met={matches}>
          {t('auth.setPassword.ruleMatch')}
        </Rule>
      </div>
      {refusal === null ? null : (
        <Notice id="recovery-refusal" role="alert">
          {t(setPasswordMessageKey(refusal))}
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
        {pending ? t('signup.recovery.pending') : t('signup.recovery.submit')}
      </Button>
    </form>
  );
}

/**
 * A used, expired or unreadable link (UX-DR63). It names no address, because
 * the token carries none the page may name, so it cannot resend: it points to
 * *Prijava*, where an unconfirmed address is offered a new link, or, for a
 * recovery link, to a new request.
 */
export function DeadLinkPanel({ recovery, canRecover }: { readonly recovery: boolean; readonly canRecover: boolean }): ReactNode {
  return (
    <div className="grid gap-6">
      <p>{t('signup.dead.body')}</p>
      <p className="text-sm text-muted-foreground">{t('signup.dead.next')}</p>
      <div className="grid gap-4">
        <Button asChild className="h-11 w-full">
          <Link to="/prijava">{t('signup.dead.signIn')}</Link>
        </Button>
        {recovery && canRecover ? (
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/zaboravljena-lozinka">{t('signup.dead.recover')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
