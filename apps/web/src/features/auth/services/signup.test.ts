import type { Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  LINK_CONFIRMED,
  LINK_DEAD,
  LINK_UNAVAILABLE,
  MAIL_SENT,
  MAIL_THROTTLED,
  MAIL_UNAVAILABLE,
  PASSWORD_MAX_LENGTH,
  addressWithoutToken,
  forgetLinkInAddress,
  RECOVERY_NOT_SAVED,
  RECOVERY_PASSWORD_REFUSED,
  RECOVERY_SAVED,
  SIGNUP_PASSWORD_TOO_LONG,
  confirmsSignup,
  isRecoveryLink,
  passwordFits,
  potvrdaRemountKey,
  setupSearchOf,
  RESEND_WAIT_SECONDS,
  SIGNUP_ADDRESS_INVALID,
  SIGNUP_PASSWORD_TOO_SHORT,
  countdownOf,
  linkFailureMessageKey,
  mailFailureMessageKey,
  mailLinkOf,
  mailOutcomeOf,
  potvrdaSearchOf,
  recoveryRefusalMessageKey,
  requestConfirmationResend,
  requestRecovery,
  requestSignup,
  resendSecondsLeft,
  saveRecoveredPassword,
  signupEnabledFrom,
  signupRefusalMessageKey,
  signupRefusalsOf,
  verifyLink,
  type MailAuth,
  type MailFailure,
} from '@/features/auth/services/signup';

/** A password over the floor, made here so no literal credential sits in the file. */
const LONG_ENOUGH = 'x'.repeat(12);
const SESSION = { access_token: 'token' } as unknown as Session;

function mailAuth(error: MailFailure | null = null) {
  return {
    signUp: vi.fn(async () => ({ error })),
    resend: vi.fn(async () => ({ error })),
    resetPasswordForEmail: vi.fn(async () => ({ error })),
  } satisfies MailAuth;
}

describe('the mail outcome (story 19.2, AD-22): the status only, never the body', () => {
  it.each([
    ['no error (Kong’s 200 {})', null, MAIL_SENT],
    ['a 429 from the per-IP limit', { status: 429 }, MAIL_THROTTLED],
    ['a fetch that never answered', { name: 'AuthRetryableFetchError', status: 0 }, MAIL_UNAVAILABLE],
    ['no status at all', {}, MAIL_UNAVAILABLE],
    ['a 5xx', { status: 502 }, MAIL_UNAVAILABLE],
    ['the CLI’s 403 SIGNUP_REFUSED', { status: 403, code: 'SIGNUP_REFUSED' }, MAIL_SENT],
    ['a 422 weak password', { status: 422, code: 'weak_password' }, MAIL_SENT],
    ['a 400 invalid address', { status: 400, code: 'validation_failed' }, MAIL_SENT],
  ] as const)('%s', (_case, error, outcome) => {
    expect(mailOutcomeOf(error)).toBe(outcome);
  });

  it('maps the two failures to their messages and the rest to the neutral screen', () => {
    expect(mailFailureMessageKey(MAIL_THROTTLED)).toBe('signup.error.throttled');
    expect(mailFailureMessageKey(MAIL_UNAVAILABLE)).toBe('signup.error.unavailable');
    expect(mailFailureMessageKey(MAIL_SENT)).toBeNull();
  });
});

describe('the signup form', () => {
  it('refuses the address shape and the floor together, with no request', () => {
    expect(signupRefusalsOf('ana.example.com', 'short')).toEqual([SIGNUP_ADDRESS_INVALID, SIGNUP_PASSWORD_TOO_SHORT]);
    expect(signupRefusalsOf('ana@DVD.Shift.Invalid', LONG_ENOUGH)).toEqual([SIGNUP_ADDRESS_INVALID]);
    expect(signupRefusalsOf('ana@example.com', 'x'.repeat(9))).toEqual([SIGNUP_PASSWORD_TOO_SHORT]);
    expect(signupRefusalsOf('ana@example.com', 'x'.repeat(10))).toEqual([]);
    expect(signupRefusalMessageKey(SIGNUP_ADDRESS_INVALID)).toBe('signup.form.error.address');
    expect(signupRefusalMessageKey(SIGNUP_PASSWORD_TOO_SHORT)).toBe('signup.form.error.password');
  });

  it('sends the trimmed address and the password, and nothing else', async () => {
    const auth = mailAuth();

    expect(await requestSignup(auth, ' Ana@Example.com\n', LONG_ENOUGH)).toBe(MAIL_SENT);
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'Ana@Example.com', password: LONG_ENOUGH });
  });

  it('never sends what the page refuses', async () => {
    const auth = mailAuth();

    expect(await requestSignup(auth, 'ana@dvd.shift.invalid', LONG_ENOUGH)).toBe(MAIL_UNAVAILABLE);
    expect(await requestSignup(auth, 'ana@example.com', 'short')).toBe(MAIL_UNAVAILABLE);
    expect(await requestConfirmationResend(auth, ' ana@example.com')).toBe(MAIL_UNAVAILABLE);
    expect(await requestRecovery(auth, 'ivan.maric')).toBe(MAIL_UNAVAILABLE);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.resend).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('resends a signup link and asks for recovery by the address alone', async () => {
    const auth = mailAuth({ status: 429 });

    expect(await requestConfirmationResend(auth, 'ana@example.com')).toBe(MAIL_THROTTLED);
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'ana@example.com' });
    expect(await requestRecovery(auth, 'ana@example.com')).toBe(MAIL_THROTTLED);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ana@example.com');
  });

  it('reads a thrown request as the transport', async () => {
    const auth = mailAuth();
    auth.signUp.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await requestSignup(auth, 'ana@example.com', LONG_ENOUGH)).toBe(MAIL_UNAVAILABLE);
  });

  it('refuses a recovery entry with no @ in its own words', () => {
    expect(recoveryRefusalMessageKey('ivan.maric')).toBe('signup.recover.error.address');
    expect(recoveryRefusalMessageKey('ana@@example.com')).toBe('signup.form.error.address');
    expect(recoveryRefusalMessageKey('ana@example.com')).toBeNull();
  });
});

describe('the resend throttle (UX-DR63)', () => {
  it('waits 60 s after each send', () => {
    expect(RESEND_WAIT_SECONDS).toBe(60);
    expect(resendSecondsLeft(null, 5_000)).toBe(0);
    expect(resendSecondsLeft(1_000, 1_000)).toBe(60);
    expect(resendSecondsLeft(1_000, 13_500)).toBe(48);
    expect(resendSecondsLeft(1_000, 61_000)).toBe(0);
    expect(resendSecondsLeft(1_000, 500)).toBe(60);
  });

  it('writes the countdown as m:ss', () => {
    expect(countdownOf(48)).toBe('0:48');
    expect(countdownOf(60)).toBe('1:00');
    expect(countdownOf(5)).toBe('0:05');
    expect(countdownOf(-1)).toBe('0:00');
  });
});

describe('the mail link (AD-12)', () => {
  const HASH = 'a'.repeat(56);

  it('takes a hex token_hash and one of the three types', () => {
    expect(mailLinkOf(HASH, 'signup')).toEqual({ tokenHash: HASH, type: 'signup' });
    expect(mailLinkOf(HASH, 'recovery')).toEqual({ tokenHash: HASH, type: 'recovery' });
    expect(mailLinkOf(HASH, 'email_change')).toEqual({ tokenHash: HASH, type: 'email_change' });
  });

  it.each([
    ['no hash', undefined, 'signup'],
    ['a pkce hash', `pkce_${HASH}`, 'signup'],
    ['a magic link type', HASH, 'magiclink'],
    ['no type', HASH, undefined],
    ['an overlong hash', 'a'.repeat(129), 'signup'],
  ])('refuses %s', (_case, hash, type) => {
    expect(mailLinkOf(hash, type)).toBeNull();
  });

  it('keeps only the two strings of the search', () => {
    expect(potvrdaSearchOf({ token_hash: HASH, type: 'signup', other: 'x' })).toEqual({ token_hash: HASH, type: 'signup' });
    expect(potvrdaSearchOf({ token_hash: 7 })).toEqual({});
  });

  it('verifies by POST on the press, and reads the answer', async () => {
    const link = { tokenHash: HASH, type: 'signup' as const };
    const confirmed = vi.fn(async () => ({ data: { session: SESSION }, error: null }));

    expect(await verifyLink({ verifyOtp: confirmed }, link)).toBe(LINK_CONFIRMED);
    expect(confirmed).toHaveBeenCalledWith({ token_hash: HASH, type: 'signup' });
    expect(
      await verifyLink({ verifyOtp: async () => ({ data: { session: null }, error: { status: 403, code: 'otp_expired' } }) }, link),
    ).toBe(LINK_DEAD);
    expect(await verifyLink({ verifyOtp: async () => ({ data: { session: null }, error: null }) }, link)).toBe(LINK_DEAD);
    expect(await verifyLink({ verifyOtp: async () => ({ data: { session: null }, error: { status: 429 } }) }, link)).toBe(
      LINK_UNAVAILABLE,
    );
    expect(
      await verifyLink(
        {
          verifyOtp: async () => {
            throw new TypeError('Failed to fetch');
          },
        },
        link,
      ),
    ).toBe(LINK_UNAVAILABLE);
  });
});

describe('the recovery save (UX-DR64)', () => {
  const link = { tokenHash: 'b'.repeat(56), type: 'recovery' as const };

  it('verifies, then saves the new password', async () => {
    const auth = {
      verifyOtp: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    };

    expect(await saveRecoveredPassword(auth, link, LONG_ENOUGH, false)).toEqual({ outcome: RECOVERY_SAVED, verified: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: LONG_ENOUGH });
  });

  it('retries only the save once the link is spent', async () => {
    const auth = {
      verifyOtp: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
      updateUser: vi.fn(async () => ({ error: { status: 500 } })),
    };

    expect(await saveRecoveredPassword(auth, link, LONG_ENOUGH, false)).toEqual({ outcome: RECOVERY_NOT_SAVED, verified: true });
    auth.updateUser.mockResolvedValueOnce({ error: null } as never);
    expect(await saveRecoveredPassword(auth, link, LONG_ENOUGH, true)).toEqual({ outcome: RECOVERY_SAVED, verified: true });
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('saves nothing for a dead link', async () => {
    const auth = {
      verifyOtp: vi.fn(async () => ({ data: { session: null }, error: { status: 403 } })),
      updateUser: vi.fn(async () => ({ error: null })),
    };

    expect(await saveRecoveredPassword(auth, link, LONG_ENOUGH, false)).toEqual({ outcome: LINK_DEAD, verified: false });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('maps the two retryable failures to their messages', () => {
    expect(linkFailureMessageKey(LINK_UNAVAILABLE)).toBe('signup.confirm.error.unavailable');
    expect(linkFailureMessageKey(RECOVERY_NOT_SAVED)).toBe('signup.recovery.error.notSaved');
  });
});

describe('review of 19.2: the ceiling, a refused password, and the link helpers', () => {
  const link = { tokenHash: 'c'.repeat(56), type: 'recovery' as const };

  it('refuses a password over GoTrue’s 72 on the page, and never sends one', async () => {
    expect(PASSWORD_MAX_LENGTH).toBe(72);
    expect(passwordFits('x'.repeat(72))).toBe(true);
    expect(passwordFits('x'.repeat(73))).toBe(false);
    expect(signupRefusalsOf('ana@example.com', 'x'.repeat(73))).toEqual([SIGNUP_PASSWORD_TOO_LONG]);
    expect(signupRefusalMessageKey(SIGNUP_PASSWORD_TOO_LONG)).toBe('signup.form.error.passwordLong');
    // GoTrue counts UTF-8 bytes (security review of 19.2): 40 letters `č` are 80.
    expect(passwordFits('č'.repeat(36))).toBe(true);
    expect(passwordFits('č'.repeat(37))).toBe(false);
    expect(signupRefusalsOf('ana@example.com', 'č'.repeat(40))).toEqual([SIGNUP_PASSWORD_TOO_LONG]);
    const auth = mailAuth();
    expect(await requestSignup(auth, 'ana@example.com', 'x'.repeat(73))).toBe(MAIL_UNAVAILABLE);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('says a password GoTrue refused (422) is refused, never “try again”', async () => {
    const auth = {
      verifyOtp: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
      updateUser: vi.fn(async () => ({ error: { status: 422, code: 'same_password' } })),
    };

    expect(await saveRecoveredPassword(auth, link, LONG_ENOUGH, false)).toEqual({
      outcome: RECOVERY_PASSWORD_REFUSED,
      verified: true,
    });
    expect(linkFailureMessageKey(RECOVERY_PASSWORD_REFUSED)).toBe('signup.recovery.error.refused');
  });

  it('routes a confirmed link by its type, and reads the setup search and remount key', () => {
    expect(confirmsSignup({ tokenHash: 'a', type: 'signup' })).toBe(true);
    expect(confirmsSignup({ tokenHash: 'a', type: 'email_change' })).toBe(false);
    expect(isRecoveryLink('recovery')).toBe(true);
    expect(isRecoveryLink('signup')).toBe(false);
    expect(isRecoveryLink(undefined)).toBe(false);
    expect(setupSearchOf({ potvrdeno: true })).toEqual({ potvrdeno: true });
    expect(setupSearchOf({ potvrdeno: 'true' })).toEqual({ potvrdeno: true });
    expect(setupSearchOf({ potvrdeno: '1' })).toEqual({});
    expect(potvrdaRemountKey({ token_hash: 'ab', type: 'signup' })).not.toBe(potvrdaRemountKey({ token_hash: 'cd', type: 'signup' }));
  });
});

describe('the SPA switch (AD-21)', () => {
  it('opens on exactly true', () => {
    expect(signupEnabledFrom('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', true]) expect(signupEnabledFrom(value)).toBe(false);
  });
});

describe('the token leaves the address once read (security review of 19.2)', () => {
  it('drops token_hash and keeps type, and leaves an address without a token alone', () => {
    expect(addressWithoutToken('/potvrda', `?token_hash=${'a'.repeat(56)}&type=recovery`)).toBe('/potvrda?type=recovery');
    expect(addressWithoutToken('/potvrda', `?token_hash=${'a'.repeat(56)}`)).toBe('/potvrda');
    expect(addressWithoutToken('/potvrda', '?type=signup')).toBeNull();
    expect(addressWithoutToken('/potvrda', '')).toBeNull();
  });

  it('replaces the current entry, keeping its state, only when a token is there', () => {
    const replaceState = vi.fn();
    const state = { key: 'router' };
    forgetLinkInAddress({ pathname: '/potvrda', search: `?token_hash=${'b'.repeat(56)}&type=signup` }, { state, replaceState });
    expect(replaceState).toHaveBeenCalledWith(state, '', '/potvrda?type=signup');

    replaceState.mockClear();
    forgetLinkInAddress({ pathname: '/potvrda', search: '?type=signup' }, { state, replaceState });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
