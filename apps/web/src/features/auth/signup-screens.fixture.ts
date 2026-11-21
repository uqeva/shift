/**
 * Story 19.2's screens (UX-DR63, UX-DR64, AD-24): `/registracija`,
 * `/potvrda`, `/zaboravljena-lozinka` and the `/postavljanje` placeholder, as
 * ONE file set under the auth feature, disjoint from the sign-in and
 * set-password sets, and read as one source by the page sweeps. The four
 * pages come first (the registration page is read first), then their hooks,
 * then the parts they draw. The neutral screen's card (`sent-card.tsx`) and
 * panel are in this set; *Prijava* also draws the card, for an unconfirmed
 * sign-in's new link.
 */
export const SIGNUP_PARTS = {
  page: ['pages', 'registracija.tsx'],
  linkPage: ['pages', 'potvrda.tsx'],
  recoverPage: ['pages', 'zaboravljena-lozinka.tsx'],
  setupPage: ['pages', 'postavljanje.tsx'],
  hook: ['features', 'auth', 'hooks', 'use-signup.ts'],
  sentHook: ['features', 'auth', 'hooks', 'use-mail-sent.ts'],
  linkHook: ['features', 'auth', 'hooks', 'use-mail-link.ts'],
  recoverHook: ['features', 'auth', 'hooks', 'use-recover-request.ts'],
  setupHook: ['features', 'auth', 'hooks', 'use-setup-holding.ts'],
  form: ['features', 'auth', 'components', 'signup-form.tsx'],
  sentCard: ['features', 'auth', 'components', 'sent-card.tsx'],
  sentPanel: ['features', 'auth', 'components', 'mail-sent-panel.tsx'],
  recoverForm: ['features', 'auth', 'components', 'recover-request-form.tsx'],
  linkPanels: ['features', 'auth', 'components', 'mail-link-panels.tsx'],
} as const;

/** The auth files the signup screens use and render nothing of: each a key source or a rule. */
export const SIGNUP_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'signup-screens.fixture.ts',
    why: 'this file: the set itself, read by the page sweeps and rendered by nothing',
  },
  {
    file: 'services/signup.ts',
    why: 'the mail outcomes, the local refusals, the throttle, the link and the SPA switch; a key source of its own, executed by signup.test.ts',
  },
  {
    file: 'services/session-destination.ts',
    why: 'AD-24: where a session goes, which the layout guard and the placeholder share; executed by session-destination.test.ts',
  },
];
