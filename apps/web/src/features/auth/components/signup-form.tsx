import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { Envelope, Eye, EyeSlash, Lock, Users } from '@/components/ui/icon';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAction, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Rule } from '@/features/auth/components/set-password-form';
import type { SignupScreenState } from '@/features/auth/hooks/use-signup';
import { PASSWORD_MIN_LENGTH } from '@/features/auth/services/set-password';
import {
  SIGNUP_ADDRESS_INVALID,
  SIGNUP_PASSWORD_TOO_LONG,
  SIGNUP_PASSWORD_TOO_SHORT,
  signupRefusalMessageKey,
} from '@/features/auth/services/signup';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * `/registracija`'s form (story 19.2, UX-DR63). A Callout first tells a member
 * of an organization that already uses Shift not to register: credentials
 * come from the administrator (F2: no invitation exists). Then *E-mail*,
 * *Lozinka* with show/hide and the live floor (the set-password step's
 * constant), one *Registriraj se* and the way back to *Prijava*. No repeat
 * field: an email identity recovers by email, and the toggle shows what was
 * typed. No captcha (D-S3), no terms checkbox (open item O2).
 *
 * `method="post"` and `noValidate`, as on *Prijava*: the handler refuses
 * locally, and a failed bundle never puts a password into a URL.
 */
export function SignupForm({ screen }: { readonly screen: SignupScreenState }): ReactNode {
  const { emailField, passwordField, emailDefault, typed, passwordShown, refusals, failure, pending } = screen;
  const gate = useWriteGate();
  const addressRefused = refusals.includes(SIGNUP_ADDRESS_INVALID);
  const passwordRefused = refusals.includes(SIGNUP_PASSWORD_TOO_SHORT) || refusals.includes(SIGNUP_PASSWORD_TOO_LONG);

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
      <Callout>
        <CalloutBody>
          <IconTile variant="primary">
            <Users />
          </IconTile>
          <div className="min-w-0">
            <CalloutTitle>{t('signup.member.heading')}</CalloutTitle>
            <CalloutDescription>{t('signup.member.body')}</CalloutDescription>
          </div>
        </CalloutBody>
      </Callout>
      <div className="grid gap-2">
        <Label htmlFor="signup-email">{t('signup.form.email')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Envelope />
          </InputGroupIcon>
          <Input
            ref={emailField}
            id="signup-email"
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
            aria-invalid={addressRefused}
            aria-describedby={addressRefused ? 'signup-refusal signup-email-hint' : 'signup-email-hint'}
            className="h-11"
          />
        </InputGroup>
        <p id="signup-email-hint" className="text-sm text-muted-foreground">
          {t('signup.form.emailHint')}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="signup-password">{t('signup.form.password')}</Label>
        <InputGroup className="[&>input]:pr-12">
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={passwordField}
            id="signup-password"
            name="password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            onInput={screen.passwordInput}
            aria-invalid={passwordRefused}
            aria-describedby={passwordRefused ? 'signup-refusal signup-length' : 'signup-length'}
            className="h-11"
          />
          <InputGroupAction>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 p-0"
              aria-label={t('auth.passwordShow')}
              aria-pressed={passwordShown}
              aria-controls="signup-password"
              onClick={screen.togglePassword}
            >
              {passwordShown ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </InputGroupAction>
        </InputGroup>
        <div role="status" aria-atomic={false} className="grid gap-1 text-sm">
          <Rule id="signup-length" met={typed >= PASSWORD_MIN_LENGTH}>
            {t('auth.setPassword.ruleLength', { count: typed })}
          </Rule>
        </div>
      </div>
      {refusals.length === 0 ? null : (
        <Notice id="signup-refusal" role="alert">
          {refusals.map((refusal) => (
            <span key={refusal} className="block">
              {t(signupRefusalMessageKey(refusal))}
            </span>
          ))}
        </Notice>
      )}
      {failure === null ? null : <Notice role="alert">{t(failure)}</Notice>}
      <OfflineWriteNote gate={gate} />
      <div className="grid gap-4">
        <Button
          className="h-11 w-full aria-disabled:opacity-50"
          type="submit"
          aria-disabled={gate.disabled || pending}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          {pending ? t('signup.form.pending') : t('signup.form.submit')}
        </Button>
        <p className="flex flex-wrap items-center gap-x-1 text-sm">
          <span>{t('signup.form.haveAccount')}</span>
          <Link to="/prijava" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
            {t('signup.form.signIn')}
          </Link>
        </p>
      </div>
    </form>
  );
}
