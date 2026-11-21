import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { trimAsciiWhitespace } from '@/features/auth/services/address';
import {
  MAIL_SENT,
  MAIL_UNAVAILABLE,
  NO_ADDRESS,
  SIGNUP_ADDRESS_INVALID,
  mailFailureMessageKey,
  requestSignup,
  signupRefusalsOf,
  type SignupRefusal,
} from '@/features/auth/services/signup';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * `/registracija`'s state and its one request (story 19.2, UX-DR63): the two
 * uncontrolled fields' refs, the live floor count, the local refusals, the
 * in-flight ref, and what was sent. Every rule is in
 * `@/features/auth/services/signup`, which the node suite executes.
 *
 * The address shape and the floor are refused on the page, both at once, with
 * no request and every typed value kept (UX-DR34). A valid shape always lands
 * on the one neutral screen, unless the gateway's per-IP limit or the
 * transport answered.
 *
 * *Ispravi adresu* comes back to the form with the address kept: the field
 * unmounts while the neutral screen shows, so its value is held here.
 */
export function useSignup() {
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const exchanging = useRef(false);
  const [emailDefault, setEmailDefault] = useState(NO_ADDRESS);
  const [typed, setTyped] = useState(0);
  const [passwordShown, setPasswordShown] = useState(false);
  const [refusals, setRefusals] = useState<readonly SignupRefusal[]>([]);
  const [failure, setFailure] = useState<ReturnType<typeof mailFailureMessageKey>>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{ readonly address: string; readonly at: number } | null>(null);

  function passwordInput(event: FormEvent<HTMLInputElement>): void {
    setTyped(event.currentTarget.value.length);
  }

  function togglePassword(): void {
    setPasswordShown((shown) => !shown);
  }

  function correct(): void {
    setSent(null);
    setTyped(0);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const email = emailField.current;
    const password = passwordField.current;

    if (email === null || password === null || exchanging.current || !writesOnline()) return;

    const found = signupRefusalsOf(email.value, password.value);

    flushSync(() => {
      setPasswordShown(false);
      setRefusals(found);
      setFailure(null);
    });

    if (found.length > 0) {
      (found[0] === SIGNUP_ADDRESS_INVALID ? email : password).focus();

      return;
    }

    exchanging.current = true;
    setPending(true);

    try {
      const outcome = await requestSignup(supabaseClient().auth, email.value, password.value);

      if (outcome === MAIL_SENT) {
        const address = trimAsciiWhitespace(email.value);
        setEmailDefault(address);
        setSent({ address, at: Date.now() });

        return;
      }

      flushSync(() => {
        setFailure(mailFailureMessageKey(outcome));
      });
      email.focus();
    } catch (cause) {
      console.error(MAIL_UNAVAILABLE, cause);
      flushSync(() => {
        setFailure(mailFailureMessageKey(MAIL_UNAVAILABLE));
      });
      email.focus();
    } finally {
      exchanging.current = false;
      setPending(false);
    }
  }

  return {
    emailField,
    passwordField,
    emailDefault,
    typed,
    passwordShown,
    refusals,
    failure,
    pending,
    sent,
    passwordInput,
    togglePassword,
    correct,
    submit,
  };
}

export type SignupScreenState = ReturnType<typeof useSignup>;
