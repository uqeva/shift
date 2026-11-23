/**
 * STORY 19.4 (AD-24, UX-DR65): the seven steps of `/postavljanje`, in order.
 *
 * Step 1 (*Organizacija*) is 19.3's create form at `/postavljanje` itself and
 * is done by existing; step 7 (*Gotovo*) is the summary. The five between
 * each have a FACT, derived from the rows the shipped surface reads
 * (`progress.ts`); nothing here is stored.
 *
 * Slugs are Croatian and are the URL's `/postavljanje/<step>` (D1). An
 * unknown slug is step 2.
 */

/** The seven steps, as the rail names them. */
export const ORGANIZATION_STEP = 'organization';
export const HOUR_BANDS_STEP = 'hourBands';
export const TEAMS_STEP = 'teams';
export const SHIFT_TYPES_STEP = 'shiftTypes';
export const ROTATION_STEP = 'rotation';
export const MEMBERS_STEP = 'members';
export const DONE_STEP = 'done';

/** The five steps that have a fact (AD-24). */
export type FactStep =
  | typeof HOUR_BANDS_STEP
  | typeof TEAMS_STEP
  | typeof SHIFT_TYPES_STEP
  | typeof ROTATION_STEP
  | typeof MEMBERS_STEP;

export type OnboardingStep = typeof ORGANIZATION_STEP | FactStep | typeof DONE_STEP;

/** A step with a page of its own in the frame: steps 2–7. */
export type FrameStep = FactStep | typeof DONE_STEP;

/** All seven, in order: the rail's order and the number each one carries. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  ORGANIZATION_STEP,
  HOUR_BANDS_STEP,
  TEAMS_STEP,
  SHIFT_TYPES_STEP,
  ROTATION_STEP,
  MEMBERS_STEP,
  DONE_STEP,
];

/** The five fact steps, in order. */
export const FACT_STEPS: readonly FactStep[] = [HOUR_BANDS_STEP, TEAMS_STEP, SHIFT_TYPES_STEP, ROTATION_STEP, MEMBERS_STEP];

/** How many steps the rail counts (`Korak {n} od 7`). */
export const STEP_TOTAL = ONBOARDING_STEPS.length;

/** How many facts the card counts (`Postavljeno {k} od 5`). */
export const FACT_TOTAL = FACT_STEPS.length;

/**
 * Each frame step's path (D1), written whole: a segment that is also a
 * counted word (`tipovi-smjena`) ships as a route path, which
 * `test/localization-applied.test.ts` sets apart from copy by its prefix.
 */
const STEP_PATHS: Readonly<Record<FrameStep, string>> = {
  [HOUR_BANDS_STEP]: '/postavljanje/satni-pojasi',
  [TEAMS_STEP]: '/postavljanje/smjene',
  [SHIFT_TYPES_STEP]: '/postavljanje/tipovi-smjena',
  [ROTATION_STEP]: '/postavljanje/rotacija',
  [MEMBERS_STEP]: '/postavljanje/ljudi',
  [DONE_STEP]: '/postavljanje/gotovo',
};

/** The URL segment of each frame step (D1): its path's last segment. */
export const STEP_SLUGS: Readonly<Record<FrameStep, string>> = Object.fromEntries(
  (Object.entries(STEP_PATHS) as [FrameStep, string][]).map(([step, path]) => [step, path.split('/').at(-1) ?? path]),
) as Readonly<Record<FrameStep, string>>;

/** Where `/postavljanje` sends a claimed admin with no return target (UX-DR65): step 2. */
export const FIRST_FRAME_STEP: FrameStep = HOUR_BANDS_STEP;

/** The path step 1 lives at; steps 2–7 are beneath it. */
export const SETUP_PATH = '/postavljanje';

/** The frame step a URL segment names, or `null` for one it does not know. */
export function frameStepOfSlug(slug: string): FrameStep | null {
  const found = (Object.entries(STEP_SLUGS) as [FrameStep, string][]).find(([, known]) => known === slug);

  return found === undefined ? null : found[0];
}

/** The step's number, 1 to 7. */
export function stepNumberOf(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

/** Whether a step has a fact. */
export function isFactStep(step: OnboardingStep): step is FactStep {
  return (FACT_STEPS as readonly OnboardingStep[]).includes(step);
}

/** The step after `step` in the frame (2 → 3 … 6 → 7), or `null` after step 7. */
export function nextFrameStepOf(step: FrameStep): FrameStep | null {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];

  return next === undefined || next === ORGANIZATION_STEP ? null : next;
}

/** The step before `step` in the frame (3 → 2 … 7 → 6), or `null` on step 2 (*Natrag* from step 3). */
export function previousFrameStepOf(step: FrameStep): FrameStep | null {
  const previous = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1];

  return previous === undefined || previous === ORGANIZATION_STEP ? null : previous;
}

/** The path a frame step lives at. */
export function stepPathOf(step: FrameStep): string {
  return STEP_PATHS[step];
}

/** A step's name, as the rail, the card and the footer say it. Exhaustive. */
export function stepNameMessageKey(
  step: OnboardingStep,
):
  | 'onboarding.step.organization'
  | 'onboarding.step.hourBands'
  | 'onboarding.step.teams'
  | 'onboarding.step.shiftTypes'
  | 'onboarding.step.rotation'
  | 'onboarding.step.members'
  | 'onboarding.step.done' {
  switch (step) {
    case ORGANIZATION_STEP:
      return 'onboarding.step.organization';
    case HOUR_BANDS_STEP:
      return 'onboarding.step.hourBands';
    case TEAMS_STEP:
      return 'onboarding.step.teams';
    case SHIFT_TYPES_STEP:
      return 'onboarding.step.shiftTypes';
    case ROTATION_STEP:
      return 'onboarding.step.rotation';
    case MEMBERS_STEP:
      return 'onboarding.step.members';
    case DONE_STEP:
      return 'onboarding.step.done';
    default: {
      const unhandled: never = step;

      return unhandled;
    }
  }
}
