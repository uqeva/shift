import { useEffect, useRef, useState } from 'react';

import {
  MAIL_SENT,
  MAIL_UNAVAILABLE,
  mailFailureMessageKey,
  requestConfirmationResend,
  requestRecovery,
  resendSecondsLeft,
  SENT_SIGNUP,
  type SentKind,
} from '@/features/auth/services/signup';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The one neutral screen's state (story 19.2, UX-DR63): the address as typed
 * (the person's own fact, so showing it reveals nothing), the 60-second
 * throttle on *Pošalji ponovno*, and its two possible failures, both about the
 * network. Every rule is in `@/features/auth/services/signup`.
 *
 * The clock ticks once a second only while a wait is running, and stops at
 * zero. The countdown is in the button's NAME; the resend's own status line
 * is announced once, when it appears.
 */
export function useMailSent(address: string, kind: SentKind, firstSentAt: number) {
  const [sentAt, setSentAt] = useState(firstSentAt);
  const [now, setNow] = useState(firstSentAt);
  const [resent, setResent] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof mailFailureMessageKey>>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const secondsLeft = resendSecondsLeft(sentAt, now);
  const waiting = secondsLeft > 0;

  useEffect(() => {
    if (!waiting) return undefined;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [waiting]);

  async function resend(): Promise<void> {
    if (sending.current || secondsLeft > 0 || !writesOnline()) return;

    sending.current = true;
    setPending(true);
    setFailure(null);

    try {
      const auth = supabaseClient().auth;
      const outcome =
        kind === SENT_SIGNUP ? await requestConfirmationResend(auth, address) : await requestRecovery(auth, address);

      if (outcome === MAIL_SENT) {
        const instant = Date.now();
        setSentAt(instant);
        setNow(instant);
        setResent(true);

        return;
      }

      setFailure(mailFailureMessageKey(outcome));
    } catch (cause) {
      // The client throwing its stable code on a build with no environment.
      console.error(MAIL_UNAVAILABLE, cause);
      setFailure(mailFailureMessageKey(MAIL_UNAVAILABLE));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return { address, signup: kind === SENT_SIGNUP, secondsLeft, waiting, resent, failure, pending, resend };
}

export type MailSentScreenState = ReturnType<typeof useMailSent>;
