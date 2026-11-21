import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import {
  NOTHING_TYPED,
  setPasswordRefusalOf,
  typedStateOf,
  type SetPasswordFailure,
} from '@/features/auth/services/set-password';
import {
  LINK_CONFIRMED,
  LINK_DEAD,
  LINK_UNAVAILABLE,
  NO_PASSWORD,
  RECOVERY_PASSWORD_REFUSED,
  RECOVERY_SAVED,
  confirmsSignup,
  forgetLinkInAddress,
  isRecoveryLink,
  linkFailureMessageKey,
  mailLinkOf,
  passwordFits,
  saveRecoveredPassword,
  setsPasswordOnLink,
  verifyLink,
} from '@/features/auth/services/signup';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * `/potvrda`'s state (story 19.2, UX-DR63, UX-DR64): the link from the URL,
 * and the ONE press that spends it. Nothing is sent on load, so a mail
 * scanner that opens the page, even one that runs its script, consumes
 * nothing (AD-12, AD-22).
 *
 * A signup's link and a recovery link both carry the password form (C8,
 * story 19.3): the press verifies and then saves the password; a save that
 * fails after the verify is retried as a save only, because the link is
 * spent. A signup then goes on to `/postavljanje` with `Adresa je potvrđena.`,
 * on whichever device opened the link; a recovery continues in the app. Only
 * an email-change link keeps the one *Potvrdi* press.
 */
export function useMailLink(search: { readonly token_hash?: string | undefined; readonly type?: string | undefined }) {
  const navigate = useNavigate();
  const [link] = useState(() => mailLinkOf(search.token_hash, search.type));

  // The token leaves the address bar and the history entry as soon as it is in
  // memory (security review of 19.2). The router still sees it (its history
  // patches `replaceState`), so the route's remount key holds through an
  // address without a token (`potvrdaRemountKey`).
  useEffect(() => {
    forgetLinkInAddress(window.location, window.history);
  }, []);
  const [dead, setDead] = useState(link === null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof linkFailureMessageKey> | null>(null);
  const exchanging = useRef(false);
  const verified = useRef(false);
  // A confirmation that succeeded and whose navigation then failed: a second
  // press only navigates, because the link is spent (review of 19.2).
  const confirmed = useRef(false);
  // The recovery form.
  const passwordField = useRef<HTMLInputElement>(null);
  const repeatField = useRef<HTMLInputElement>(null);
  const [passwordShown, setPasswordShown] = useState(false);
  const [typed, setTyped] = useState(NOTHING_TYPED);
  const [refusal, setRefusal] = useState<SetPasswordFailure | null>(null);

  function fieldsInput(): void {
    setTyped(typedStateOf(passwordField.current?.value ?? NO_PASSWORD, repeatField.current?.value ?? NO_PASSWORD));
  }

  function togglePassword(): void {
    setPasswordShown((shown) => !shown);
  }

  async function confirm(): Promise<void> {
    if (link === null || exchanging.current || !writesOnline()) return;

    exchanging.current = true;
    setPending(true);
    setFailure(null);

    try {
      const outcome = confirmed.current ? LINK_CONFIRMED : await verifyLink(supabaseClient().auth, link);

      if (outcome === LINK_CONFIRMED) {
        confirmed.current = true;
        await (confirmsSignup(link)
          ? navigate({ to: '/postavljanje', search: { potvrdeno: true }, replace: true })
          : navigate({ to: '/', replace: true }));

        return;
      }

      if (outcome === LINK_DEAD) setDead(true);
      else setFailure(linkFailureMessageKey(LINK_UNAVAILABLE));
    } catch (cause) {
      console.error(LINK_UNAVAILABLE, cause);
      setFailure(linkFailureMessageKey(LINK_UNAVAILABLE));
    } finally {
      exchanging.current = false;
      setPending(false);
    }
  }

  async function saveRecovery(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const password = passwordField.current;
    const repeat = repeatField.current;

    if (link === null || password === null || repeat === null || exchanging.current || !writesOnline()) return;

    const found = setPasswordRefusalOf(password.value, repeat.value);
    // GoTrue's ceiling, refused on the page as the floor is (no request).
    const tooLong = found === null && !passwordFits(password.value);

    flushSync(() => {
      setPasswordShown(false);
      setRefusal(found);
      setFailure(tooLong ? linkFailureMessageKey(RECOVERY_PASSWORD_REFUSED) : null);
    });

    if (found !== null || tooLong) {
      password.focus();

      return;
    }

    exchanging.current = true;
    setPending(true);

    try {
      const result = await saveRecoveredPassword(supabaseClient().auth, link, password.value, verified.current);
      verified.current = result.verified;
      const outcome = result.outcome;

      if (outcome === RECOVERY_SAVED) {
        // A signup's link (C8, D2) goes on to step 1, as *Potvrdi* did.
        await (confirmsSignup(link)
          ? navigate({ to: '/postavljanje', search: { potvrdeno: true }, replace: true })
          : navigate({ to: '/', replace: true }));

        return;
      }

      if (outcome === LINK_DEAD) {
        setDead(true);

        return;
      }

      flushSync(() => {
        setFailure(linkFailureMessageKey(outcome));
      });
      password.focus();
    } catch (cause) {
      console.error(LINK_UNAVAILABLE, cause);
      setFailure(linkFailureMessageKey(LINK_UNAVAILABLE));
    } finally {
      exchanging.current = false;
      setPending(false);
    }
  }

  return {
    recovery: isRecoveryLink(link?.type ?? search.type),
    // C8 (founder decision 2026-11-21, D2): a signup's link sets the password
    // too, because confirmation forgets every password chosen before it (0071).
    setsPassword: setsPasswordOnLink(link?.type ?? search.type),
    dead,
    pending,
    failure,
    confirm,
    passwordField,
    repeatField,
    passwordShown,
    typed: typed.typed,
    longEnough: typed.longEnough,
    matches: typed.matches,
    refusal,
    fieldsInput,
    togglePassword,
    saveRecovery,
  };
}

export type MailLinkScreenState = ReturnType<typeof useMailLink>;
