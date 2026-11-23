/**
 * STORY 19.4 (AD-24, UX-DR65, 67–69): the setup frame's files, page first,
 * read by the page sweeps (`pages/screens-sweep.test.ts`,
 * `pages/literal-sweep.test.ts`, `pages/key-sweep.test.ts`). The *Danas* card
 * and *Kalendar*'s way back to setup are drawn on those destinations, from
 * this feature, so they are swept here with the frame.
 */
export const ONBOARDING_SCREEN_PARTS = {
  page: ['pages', 'postavljanje.$step.tsx'],
  progressHook: ['features', 'onboarding', 'hooks', 'use-onboarding-progress.ts'],
  frame: ['features', 'onboarding', 'components', 'setup-frame.tsx'],
  rail: ['features', 'onboarding', 'components', 'setup-rail.tsx'],
  footer: ['features', 'onboarding', 'components', 'setup-footer.tsx'],
  explainer: ['features', 'onboarding', 'components', 'step-explainer.tsx'],
  rotationParts: ['features', 'onboarding', 'components', 'rotation-step-parts.tsx'],
  signInLink: ['features', 'onboarding', 'components', 'sign-in-link-card.tsx'],
  summary: ['features', 'onboarding', 'components', 'setup-summary.tsx'],
  card: ['features', 'onboarding', 'components', 'onboarding-card.tsx'],
} as const;

export const ONBOARDING_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'onboarding-screens.fixture.ts',
    why: 'this file: the set itself, read by the page sweeps and rendered by nothing',
  },
  {
    file: 'services/steps.ts',
    why: 'the seven steps, their slugs, order and names; a key source of its own, executed by progress.test.ts',
  },
  {
    file: 'services/progress.ts',
    why: 'every fact, state, the forward control, step 5’s prerequisites, step 7’s lines and the card; a key source of its own, executed by progress.test.ts',
  },
  {
    file: 'services/sign-in-link.ts',
    why: 'step 6’s link and its copy; a key source of its own, executed by sign-in-link.test.ts',
  },
];
