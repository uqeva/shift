import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { trimAsciiWhitespace } from '@/features/auth/services/address';
import {
  MAIL_SENT,
  MAIL_UNAVAILABLE,
  NO_ADDRESS,
  mailFailureMessageKey,
  recoveryRefusalMessageKey,
  requestRecovery,
} from '@/features/auth/services/signup';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * `/zaboravljena-lozinka`'s state (story 19.2, UX-DR64): one address field, a
 * local refusal (an entry with no `@` reads `Upiši adresu e-pošte.`), and then
 * the one neutral answer for every address. A username identity's password is
 * still set by its administrator; the page says so under the form.
 */
export function useRecoverRequest() {
  const emailField = useRef<HTMLInputElement>(null);
  const exchanging = useRef(false);
  const [emailDefault, setEmailDefault] = useState(NO_ADDRESS);
  const [refusal, setRefusal] = useState<ReturnType<typeof recoveryRefusalMessageKey>>(null);
  const [failure, setFailure] = useState<ReturnType<typeof mailFailureMessageKey>>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{ readonly address: string; readonly at: number } | null>(null);

  function correct(): void {
    setSent(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const email = emailField.current;

    if (email === null || exchanging.current || !writesOnline()) return;

    const found = recoveryRefusalMessageKey(email.value);

    flushSync(() => {
      setRefusal(found);
      setFailure(null);
    });

    if (found !== null) {
      email.focus();

      return;
    }

    exchanging.current = true;
    setPending(true);

    try {
      const outcome = await requestRecovery(supabaseClient().auth, email.value);

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

  return { emailField, emailDefault, refusal, failure, pending, sent, correct, submit };
}

export type RecoverRequestScreenState = ReturnType<typeof useRecoverRequest>;
