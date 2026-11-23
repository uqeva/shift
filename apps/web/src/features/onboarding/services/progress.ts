/**
 * STORY 19.4 (AD-24, UX-DR65, 67–69): onboarding progress, DERIVED, in one
 * place. The rail, the forward control, step 5's prerequisites, step 7's
 * summary and the *Danas* card all read these functions over the same facts,
 * so they cannot disagree.
 *
 * The facts (AD-24), each read from the rows the shipped surface already
 * reads, under its own key (the hook binds them):
 *   - hour bands: at least one;
 *   - teams: one not archived;
 *   - shift types: one not archived;
 *   - the rotation: a rotation assignment exists (any version);
 *   - members: more than one member.
 *
 * A READ THAT IS MISSING OR FAILED IS `null`, and `null` is never done: a step
 * reads *nije postavljeno* rather than a guess. The card needs every read.
 *
 * Pure: no React, no client. Executed by `progress.test.ts`.
 */

import type { HourBandRow } from '@/features/hour-bands/services/list';
import type { MembersSettled } from '@/features/members/services/list';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import type { ShiftTypesSnapshot } from '@/features/shift-types/services/list';
import type { TeamRow } from '@/features/teams/services/list';
import {
  DONE_STEP,
  FACT_STEPS,
  FACT_TOTAL,
  HOUR_BANDS_STEP,
  MEMBERS_STEP,
  ORGANIZATION_STEP,
  ROTATION_STEP,
  SHIFT_TYPES_STEP,
  TEAMS_STEP,
  isFactStep,
  nextFrameStepOf,
  type FactStep,
  type FrameStep,
  type OnboardingStep,
} from '@/features/onboarding/services/steps';

/** What each surface's read holds, as this module needs it; `undefined` while it has none. */
export interface OnboardingReads {
  /** The hour bands (`HOUR_BANDS_LIST_KEY`). */
  readonly hourBands: readonly unknown[] | undefined;
  /** The teams, archived included (`TEAMS_LIST_KEY`). */
  readonly teams: readonly { readonly archived: boolean }[] | undefined;
  /** The shift types, archived included (`SHIFT_TYPES_LIST_KEY`). */
  readonly shiftTypes: readonly { readonly archived: boolean; readonly isWorking: boolean }[] | undefined;
  /**
   * Every stored rotation assignment's attribution, unbounded (`ROTATION_KEY`'s
   * `history`): one record per team and date saved, not per save.
   */
  readonly rotation: readonly { readonly effectiveFrom: string; readonly createdAt: string }[] | undefined;
  /** How many members the organization has (`MEMBERS_LIST_KEY`), or `undefined`. */
  readonly members: number | undefined;
}

/** The facts, each a count (or `null` while its read is missing). */
export interface OnboardingFacts {
  readonly hourBands: number | null;
  /** Teams not archived. */
  readonly teams: number | null;
  /** Shift types not archived. */
  readonly shiftTypes: number | null;
  /** Working shift types not archived (step 5's prerequisite). */
  readonly workingTypes: number | null;
  /** Stored rotation assignment records (one per team and date saved; any is the fact). */
  readonly rotationRecords: number | null;
  /** The `Vrijedi od` of the LATEST SAVED record (by its save time), or `null` for none. */
  readonly rotationFrom: string | null;
  /** Members, any status. */
  readonly members: number | null;
}

/** Every read missing: what the hook answers before anything arrived. */
export const NO_READS: OnboardingReads = {
  hourBands: undefined,
  teams: undefined,
  shiftTypes: undefined,
  rotation: undefined,
  members: undefined,
};

/** What each surface's query holds, typed as those queries answer (the hook's inputs). */
export interface OnboardingQueryData {
  readonly hourBands: readonly HourBandRow[] | undefined;
  readonly teams: readonly TeamRow[] | undefined;
  readonly shiftTypes: ShiftTypesSnapshot | undefined;
  readonly rotation: RotationSnapshot | undefined;
  readonly members: MembersSettled | undefined;
}

/**
 * The reads the queries hold: each surface's last good answer, mapped once.
 * A refused members read is no read (never "one member").
 */
export function onboardingReadsOf(data: OnboardingQueryData): OnboardingReads {
  return {
    hourBands: data.hourBands,
    teams: data.teams,
    shiftTypes: data.shiftTypes?.types,
    rotation: data.rotation?.history,
    members: data.members !== undefined && data.members.ok ? data.members.members.length : undefined,
  };
}

/** The record saved last: the latest save time, then the later date. */
function latestSavedOf(records: readonly { readonly effectiveFrom: string; readonly createdAt: string }[]): string | null {
  let latest: { readonly effectiveFrom: string; readonly createdAt: string } | null = null;

  for (const record of records) {
    const later =
      latest === null ||
      Date.parse(record.createdAt) > Date.parse(latest.createdAt) ||
      (Date.parse(record.createdAt) === Date.parse(latest.createdAt) && record.effectiveFrom > latest.effectiveFrom);

    if (later) latest = record;
  }

  return latest?.effectiveFrom ?? null;
}

/** The facts the reads hold. */
export function factsOf(reads: OnboardingReads): OnboardingFacts {
  const types = reads.shiftTypes?.filter((type) => !type.archived);
  const versions = reads.rotation;
  const latest = versions === undefined ? null : latestSavedOf(versions);

  return {
    hourBands: reads.hourBands?.length ?? null,
    teams: reads.teams?.filter((team) => !team.archived).length ?? null,
    shiftTypes: types?.length ?? null,
    workingTypes: types?.filter((type) => type.isWorking).length ?? null,
    rotationRecords: versions?.length ?? null,
    rotationFrom: latest,
    members: reads.members ?? null,
  };
}

/** The count a fact step's fact is, or `null` while its read is missing. */
function countOf(facts: OnboardingFacts, step: FactStep): number | null {
  switch (step) {
    case HOUR_BANDS_STEP:
      return facts.hourBands;
    case TEAMS_STEP:
      return facts.teams;
    case SHIFT_TYPES_STEP:
      return facts.shiftTypes;
    case ROTATION_STEP:
      return facts.rotationRecords;
    case MEMBERS_STEP:
      return facts.members;
    default: {
      const unhandled: never = step;

      return unhandled;
    }
  }
}

/** Whether a fact step is done: its fact exists. A missing read is never done. */
export function factDoneOf(facts: OnboardingFacts, step: FactStep): boolean {
  const count = countOf(facts, step);

  if (count === null) return false;

  // AD-24: more than one member, so the Founding Admin alone is not done.
  return step === MEMBERS_STEP ? count > 1 : count > 0;
}

/** Whether every fact's read is there (the card is absent until it is). */
export function allReadOf(facts: OnboardingFacts): boolean {
  return FACT_STEPS.every((step) => countOf(facts, step) !== null);
}

/** The fact steps not done, in order. */
export function remainingStepsOf(facts: OnboardingFacts): readonly FactStep[] {
  return FACT_STEPS.filter((step) => !factDoneOf(facts, step));
}

/** How many of the five are done (`Postavljeno {k} od 5`). */
export function setCountOf(facts: OnboardingFacts): number {
  return FACT_TOTAL - remainingStepsOf(facts).length;
}

/** A step's state in words (UX-DR65): created (step 1), set, not set, or the end (step 7). */
export const STATE_CREATED = 'created';
export const STATE_SET = 'set';
export const STATE_UNSET = 'unset';
export const STATE_END = 'end';

export type StepState = typeof STATE_CREATED | typeof STATE_SET | typeof STATE_UNSET | typeof STATE_END;

export function stepStateOf(facts: OnboardingFacts, step: OnboardingStep): StepState {
  if (step === ORGANIZATION_STEP) return STATE_CREATED;
  if (step === DONE_STEP) return STATE_END;

  return factDoneOf(facts, step) ? STATE_SET : STATE_UNSET;
}

/** Whether the rail marks the step done (a check instead of its number). */
export function stepMarkedDoneOf(state: StepState): boolean {
  return state === STATE_CREATED || state === STATE_SET;
}

/** The state's word, or `null` for step 7, which shows none. */
export function stepStateMessageKey(
  state: StepState,
): 'onboarding.state.created' | 'onboarding.state.set' | 'onboarding.state.unset' | null {
  switch (state) {
    case STATE_CREATED:
      return 'onboarding.state.created';
    case STATE_SET:
      return 'onboarding.state.set';
    case STATE_UNSET:
      return 'onboarding.state.unset';
    case STATE_END:
      return null;
    default: {
      const unhandled: never = state;

      return unhandled;
    }
  }
}

/** The forward control (UX-DR65): skip (outline) while the fact is missing, next (ink) once it exists. */
export const FORWARD_SKIP = 'skip';
export const FORWARD_NEXT = 'next';

export interface Forward {
  readonly kind: typeof FORWARD_SKIP | typeof FORWARD_NEXT;
  /** Where it goes: always the next step. Navigation only; nothing is stored. */
  readonly to: FrameStep;
}

/** The footer's one forward control on `step`, or `null` on step 7, which has its own actions. */
export function forwardOf(facts: OnboardingFacts, step: FrameStep): Forward | null {
  const to = nextFrameStepOf(step);

  if (to === null || !isFactStep(step)) return null;

  return { kind: factDoneOf(facts, step) ? FORWARD_NEXT : FORWARD_SKIP, to };
}

/** What step 5 still needs before its builder can save (UX-DR67). */
export const MISSING_TEAM = 'team';
export const MISSING_WORKING_TYPE = 'workingType';

export type RotationPrerequisite = typeof MISSING_TEAM | typeof MISSING_WORKING_TYPE;

/**
 * Step 5's missing prerequisites, in step order, or `null` while either read
 * is missing (the step draws its skeleton then, never a false list).
 */
export function rotationPrerequisitesOf(facts: OnboardingFacts): readonly RotationPrerequisite[] | null {
  if (facts.teams === null || facts.workingTypes === null) return null;

  const missing: RotationPrerequisite[] = [];

  if (facts.teams === 0) missing.push(MISSING_TEAM);
  if (facts.workingTypes === 0) missing.push(MISSING_WORKING_TYPE);

  return missing;
}

/** The step each prerequisite is set on. */
export function prerequisiteStepOf(missing: RotationPrerequisite): FrameStep {
  return missing === MISSING_TEAM ? TEAMS_STEP : SHIFT_TYPES_STEP;
}

/** A prerequisite in words. Exhaustive. */
export function prerequisiteMessageKey(
  missing: RotationPrerequisite,
): 'onboarding.rotation.missingTeam' | 'onboarding.rotation.missingWorkingType' {
  switch (missing) {
    case MISSING_TEAM:
      return 'onboarding.rotation.missingTeam';
    case MISSING_WORKING_TYPE:
      return 'onboarding.rotation.missingWorkingType';
    default: {
      const unhandled: never = missing;

      return unhandled;
    }
  }
}

/** Who reads *Danas*, and what the organization snapshot says (AD-24's conditions). */
export interface CardConditions {
  /** An active admin (the chrome's role read). */
  readonly admin: boolean;
  /** `founded_by` set; `null` while the organization is not read. */
  readonly foundedBySignup: boolean | null;
  /** `onboarding_dismissed`; `null` while the organization is not read. */
  readonly dismissed: boolean | null;
}

/** Whether the card's own reads are worth making at all (D5): founded by signup, not dismissed, an admin. */
export function cardReadsWantedOf(conditions: CardConditions): boolean {
  return conditions.admin && conditions.foundedBySignup === true && conditions.dismissed === false;
}

/**
 * Whether the five fact reads run (D5): for the card only under
 * {@link cardReadsWantedOf}, so an operator-provisioned or dismissed
 * organization, or a member, pays no read; in the frame whenever an admin
 * reads it (the route's guard already admitted one).
 */
export function progressReadsEnabledOf(forCard: boolean, conditions: CardConditions): boolean {
  return forCard ? cardReadsWantedOf(conditions) : conditions.admin;
}

/** Whether the *Danas* card will be there for steps left (step 7's wording): founded by signup, not dismissed. */
export function cardAwaitsOf(conditions: Pick<CardConditions, 'foundedBySignup' | 'dismissed'>): boolean {
  return conditions.foundedBySignup === true && conditions.dismissed === false;
}

/** Step 7's line with steps left: the card's promise only when the card will be there. */
export function leftMessageKey(cardAwaits: boolean): 'onboarding.done.left' | 'onboarding.done.leftNoCard' {
  return cardAwaits ? 'onboarding.done.left' : 'onboarding.done.leftNoCard';
}

/** The *Danas* card, when it is drawn. */
export interface OnboardingCard {
  /** The fact steps not done, in order; never empty. */
  readonly remaining: readonly FactStep[];
  /** How many of the five are done. */
  readonly set: number;
  /** Where *Nastavi* goes: the first step not done. */
  readonly first: FactStep;
  /** Whether the rotation is one of them (`Dok rotacija nije spremljena…`). */
  readonly rotationLeft: boolean;
}

/**
 * The card (UX-DR69, AD-24): an active admin, an organization founded by
 * signup and not dismissed, every read there, and steps left. Anything else,
 * a missing read included, is no card (never a skeleton).
 */
export function onboardingCardOf(conditions: CardConditions, facts: OnboardingFacts): OnboardingCard | null {
  if (!cardReadsWantedOf(conditions) || !allReadOf(facts)) return null;

  const remaining = remainingStepsOf(facts);
  const first = remaining[0];

  if (first === undefined) return null;

  return { remaining, set: FACT_TOTAL - remaining.length, first, rotationLeft: remaining.includes(ROTATION_STEP) };
}

/** One line of step 7's summary (UX-DR68). */
export interface SummaryLine {
  readonly step: FactStep;
  readonly done: boolean;
  /** The count the line states (`2 pojasa`), for a done step but the rotation. */
  readonly count: number;
  /** The rotation's `Vrijedi od`, for a done rotation. */
  readonly from: string | null;
}

/** Step 7's five fact lines, from the same facts as the rail. */
export function summaryOf(facts: OnboardingFacts): readonly SummaryLine[] {
  return FACT_STEPS.map((step) => ({
    step,
    done: factDoneOf(facts, step),
    count: countOf(facts, step) ?? 0,
    from: step === ROTATION_STEP ? facts.rotationFrom : null,
  }));
}

/** A done step's fact in words, on step 7. Exhaustive; the rotation's is a date. */
export function summaryCountMessageKey(
  step: Exclude<FactStep, typeof ROTATION_STEP>,
):
  | 'onboarding.done.hourBandsCount'
  | 'onboarding.done.teamsCount'
  | 'onboarding.done.shiftTypesCount'
  | 'onboarding.done.membersCount' {
  switch (step) {
    case HOUR_BANDS_STEP:
      return 'onboarding.done.hourBandsCount';
    case TEAMS_STEP:
      return 'onboarding.done.teamsCount';
    case SHIFT_TYPES_STEP:
      return 'onboarding.done.shiftTypesCount';
    case MEMBERS_STEP:
      return 'onboarding.done.membersCount';
    default: {
      const unhandled: never = step;

      return unhandled;
    }
  }
}
