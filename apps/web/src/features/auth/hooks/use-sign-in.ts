import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { isEmailEntry, organizationDestination, trimAsciiWhitespace } from '@/features/auth/services/address';
import * as lastOrganization from '@/features/auth/services/last-organization';
import { knownPathOf, returnTargetOf } from '@/features/auth/services/return-target';
import {
  SIGN_IN_UNAVAILABLE,
  SIGN_IN_UNCONFIRMED,
  signIn,
  type SignInFailure,
} from '@/features/auth/services/sign-in';
import {
  MAIL_SENT,
  MAIL_UNAVAILABLE,
  NO_ADDRESS,
  mailFailureMessageKey,
  requestConfirmationResend,
  signupEnabled,
} from '@/features/auth/services/signup';
import { supabaseClient } from '@/lib/supabase/client';
import { writesOnline } from '@/lib/offline/use-write-gate';

/**
 * The sign-in screen's state and its one exchange (story 1.1d, wired by 1.3b,
 * made one form by 7.7): the three uncontrolled fields' refs, the in-flight
 * ref, the refusal, the pending flag, whether the organization is being edited
 * and whether the password is shown, and `submit`.
 *
 * THE ORGANIZATION COMES FROM ONE OF TWO PLACES. AD-12 authenticates against an
 * address namespaced by the slug, and at the moment of sign-in there is no
 * session to read it from (see `pages/prijava.tsx`). With `/prijava/$slug` the
 * page hands the URL slug in, and the form shows it as a row until `Promijeni`
 * swaps in the field. With bare `/prijava` there is no slug, and the field is
 * prefilled from the last organization signed into on this device
 * (`@/features/auth/services/last-organization`), or empty. Either way the
 * value goes to the one unchanged `signIn()`, which refuses a malformed slug
 * locally with the ordinary refusal, so a wrong organization reads exactly like
 * a wrong password.
 *
 * Values are read from the fields through refs rather than held in state, and
 * that is the shape UX-DR34's "a refused save keeps every entered value" asks
 * for: uncontrolled inputs keep what was typed because nothing re-renders them
 * away. It also keeps every string in the screen's parts a `t()` key —
 * `pages/literal-sweep.test.ts` makes any other literal an offence, and reading the form's
 * `elements.namedItem('username')` would be one.
 *
 * THE RETURN TARGET COMES IN ON THE URL. The signed-out redirect put the
 * location the visitor asked for into `povratak`, on either sign-in route; a successful sign-in navigates there through
 * `returnTargetOf`, which refuses anything that is not a same-app path this
 * tree knows and falls back to `/`. The route tree is asked through the router
 * this hook already runs under, so nothing here imports it.
 *
 * FOCUS NEVER DROPS TO `<body>`. The button used to carry `disabled={pending}`,
 * and disabling the element that has just been activated takes it out of the
 * tab order mid-flow. The form marks it `aria-disabled` instead, and the
 * in-flight ref below is what actually refuses a second submit. On a refusal
 * focus moves to the password field, which the refusal describes and which is
 * what a person corrects next — in this handler, not an effect, and only after
 * `flushSync` has committed the refusal, so the field is announced with it.
 *
 * Every rule is in `@/features/auth/services/sign-in`, which the node suite
 * executes; this hook holds state and wiring only.
 */
export function useSignIn(slug: string | undefined) {
  const navigate = useNavigate();
  const router = useRouter();
  // NOT STRICT, so no route id is spelt here (`pages/literal-sweep.test.ts` refuses the
  // literal): this hook runs on both `/prijava` and `/prijava/$slug`, and both
  // shape `povratak` through the same `validateSearch`.
  const { povratak } = useSearch({ strict: false });
  const organizationField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // Read ONCE, at mount: the prefill is a default value for an uncontrolled
  // field, and with a URL slug there is nothing to prefill.
  const [remembered] = useState(() =>
    slug === undefined
      ? lastOrganization.read(lastOrganization.deviceStorage())
      : lastOrganization.NOTHING_REMEMBERED,
  );
  // THE URL SLUG AS IT WILL BE SENT. The route's guard lets a capitalized or
  // padded segment through (`/prijava/DVD-Demo`), and `signIn` and the memory
  // both normalize it, so the row and the `Promijeni` prefill show the
  // normalized slug too: what is shown is what is sent and remembered.
  const shownSlug = slug === undefined ? undefined : (organizationDestination(slug) ?? slug);
  // `Promijeni` swaps the URL slug's row for the field. The URL does not change.
  const [editing, setEditing] = useState(false);
  // Whether the field still holds what this device remembered. Once the
  // person edits it, `Zapamćeno na ovom uređaju.` would no longer be true, so
  // only the how-to hint stays. Tracked from the field's own input event, not
  // an effect.
  const [stillRemembered, setStillRemembered] = useState(true);
  const [passwordShown, setPasswordShown] = useState(false);
  // `Zaboravljena lozinka?` opens its panel in place.
  const [forgotOpen, setForgotOpen] = useState(false);
  // The in-flight flag is a REF as well as state, and the two are not
  // redundant. State drives the button's `aria-disabled`, and state is stale
  // inside a handler that has already been called once this tick — a second
  // submit (double click, Enter while the click lands) reads `false` and fires
  // a second concurrent exchange. The ref is written synchronously, so it is what
  // the guard reads; the state exists only to re-render.
  const exchanging = useRef(false);
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [pending, setPending] = useState(false);
  // STORY 19.2: the email path's state.
  const [emailEntry, setEmailEntry] = useState(false);
  // The entry the form reopens with after *Natrag na prijavu* or *Ispravi
  // adresu* (review of 19.2: UX-DR63 keeps the address).
  const [entryDefault, setEntryDefault] = useState(NO_ADDRESS);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [sent, setSent] = useState<{ readonly address: string; readonly at: number } | null>(null);
  const resending = useRef(false);
  const [resendPending, setResendPending] = useState(false);
  const [resendFailure, setResendFailure] = useState<ReturnType<typeof mailFailureMessageKey>>(null);
  // The field is on screen unless the URL slug's row stands in for it.
  const organizationEditable = slug === undefined || editing;

  function changeOrganization(): void {
    // Committed first, so the field exists to be focused.
    flushSync(() => {
      setEditing(true);
    });
    organizationField.current?.focus();
  }

  function organizationInput(event: FormEvent<HTMLInputElement>): void {
    setStillRemembered(event.currentTarget.value === remembered);
  }

  function togglePassword(): void {
    setPasswordShown((shown) => !shown);
  }

  // STORY 19.2 (UX-DR62): whether the entry is an address, from the field's
  // own input event. While it is, the organization is dimmed and unsent, and
  // nothing above the cursor moves.
  function usernameInput(event: FormEvent<HTMLInputElement>): void {
    setEmailEntry(isEmailEntry(event.currentTarget.value));
  }

  // *Pošalji novu poveznicu* on an unconfirmed sign-in, which then shows the
  // one neutral screen (UX-DR63).
  async function requestNewLink(): Promise<void> {
    if (unconfirmed === null || resending.current || !writesOnline()) return;

    resending.current = true;
    setResendPending(true);
    setResendFailure(null);

    try {
      const outcome = await requestConfirmationResend(supabaseClient().auth, unconfirmed);

      if (outcome === MAIL_SENT) {
        setSent({ address: unconfirmed, at: Date.now() });

        return;
      }

      setResendFailure(mailFailureMessageKey(outcome));
    } catch (cause) {
      console.error(MAIL_UNAVAILABLE, cause);
      setResendFailure(mailFailureMessageKey(MAIL_UNAVAILABLE));
    } finally {
      resending.current = false;
      setResendPending(false);
    }
  }

  // Back to the form, from either panel. The fields mount afresh.
  function backToForm(): void {
    setSent(null);
    setUnconfirmed(null);
    setResendFailure(null);
    setEmailEntry(isEmailEntry(entryDefault));
  }

  function toggleForgot(): void {
    setForgotOpen((open) => !open);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const username = usernameField.current;
    const password = passwordField.current;
    // The row's slug, or what the field holds. `signIn` normalizes and judges
    // it, exactly as it judges the other two values.
    // STORY 19.2 (AD-12): an entry with an `@` is an email sign-in, and the
    // organization is neither read nor sent.
    const byEmail = username !== null && isEmailEntry(username.value);
    const organization = organizationEditable ? organizationField.current?.value : shownSlug;

    if (username === null || password === null || organization === undefined || exchanging.current) {
      return;
    }

    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // RE-MASKED FIRST, committed before anything else: a refusal then never
    // focuses a password shown as plain text, and a credential manager sees a
    // `type="password"` field on the submit it offers to save.
    flushSync(() => {
      setPasswordShown(false);
    });

    exchanging.current = true;
    setFailure(null);
    setPending(true);

    try {
      const outcome = await signIn(supabaseClient().auth, {
        username: username.value,
        password: password.value,
        slug: organization,
      });

      // STORY 19.2: the right password on an address nobody confirmed yet.
      // The card shows *Potvrdi adresu e-pošte* in place of the form.
      if (!outcome.ok && outcome.code === SIGN_IN_UNCONFIRMED) {
        setUnconfirmed(trimAsciiWhitespace(username.value));
        setEntryDefault(trimAsciiWhitespace(username.value));

        return;
      }

      if (!outcome.ok) {
        // COMMITTED FIRST, then focused: `flushSync` renders the refusal and
        // the field's `aria-describedby` pointing at it before focus lands, so
        // the field is announced WITH its error rather than without it.
        flushSync(() => {
          setFailure(outcome.code);
        });
        password.focus();

        return;
      }

      // REMEMBERED ONLY NOW, after the service accepted it, so a typo is never
      // stored. Only the normalized slug: nothing about the person. An email
      // sign-in names no organization, so nothing is remembered for it.
      if (!byEmail) lastOrganization.remember(lastOrganization.deviceStorage(), organization);

      // The return target, or `/` when there is none that is safe. Neither is
      // handed the session: it is established inside the client by the time
      // the call above resolves, and `@/lib/supabase/session-cache` leaves the
      // router alone on a sign-in so this navigation is the only one.
      //
      // REPLACING, so Back from the returned destination does not land on the
      // credential form, whose guard would only forward a signed-in visitor to
      // `/` and on to the first destination.
      await navigate({ href: returnTargetOf(povratak, knownPathOf(router)), replace: true });
    } catch (cause) {
      // Everything `signIn` does not already map: the client throwing its
      // stable code on a build with no environment, and a navigation that
      // rejects. Both used to escape as an unhandled rejection, leaving a
      // screen with no message and — before the `finally` below — a button
      // disabled forever.
      //
      // A misconfiguration reading as an outage is a real cost, and it is the
      // smaller one ONLY because the cause is logged: the stable code and the
      // cause always reach the console, so a deployment with no environment
      // never shows "try again" with an empty console — the failure
      // `client.ts` was written to prevent. `lib/i18n/boot.ts` sets the shape.
      console.error(SIGN_IN_UNAVAILABLE, cause);
      flushSync(() => {
        setFailure(SIGN_IN_UNAVAILABLE);
      });
      password.focus();
    } finally {
      // On EVERY path, including the successful one. Clearing it only on
      // failure left the button permanently disabled the moment `navigate`
      // stopped resolving, with nothing on screen to say why.
      exchanging.current = false;
      setPending(false);
    }
  }

  return {
    shownSlug,
    organizationField,
    usernameField,
    passwordField,
    // What the field opens with: the URL slug after `Promijeni`, otherwise
    // what this device remembered, otherwise nothing.
    organizationDefault: shownSlug ?? remembered,
    // Whether the field holds what this device remembered, which the hint says.
    rememberedHere:
      slug === undefined && remembered !== lastOrganization.NOTHING_REMEMBERED && stillRemembered,
    // FOCUS OPENS WHERE THE FIRST EMPTY VALUE IS: the organization field when
    // nothing fills it, otherwise the username. `autoFocus` rather than an
    // effect, so it happens once, as the field mounts — and `prijavaRoute`'s
    // `remountDeps` remounts the screen when the slug changes, which a
    // params-only navigation would not do on its own.
    organizationFirst: slug === undefined && remembered === lastOrganization.NOTHING_REMEMBERED,
    organizationEditable,
    passwordShown,
    forgotOpen,
    failure,
    pending,
    emailEntry,
    entryDefault,
    unconfirmed,
    sent,
    resendPending,
    resendFailure,
    // AD-21's third switch: the email recovery path and, on bare `/prijava`
    // only, the way to `/registracija` (UX-DR62).
    signupOffered: signupEnabled(),
    registerOffered: slug === undefined && signupEnabled(),
    changeOrganization,
    organizationInput,
    usernameInput,
    togglePassword,
    toggleForgot,
    requestNewLink,
    backToForm,
    submit,
  };
}

/** What the sign-in form is drawn from. */
export type SignInScreenState = ReturnType<typeof useSignIn>;
