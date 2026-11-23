import { describe, expect, it } from 'vitest';

import type { MemberListRow, MembersSettled } from '@/features/members/services/list';
import { answerOf, assignmentRow, PILOT, rotationTableOf, SEEDED } from '@/features/rotation/rotation.fixture';
import { readRotation } from '@/features/rotation/services/list';
import type { ShiftTypesSnapshot } from '@/features/shift-types/services/list';
import type { TeamRow } from '@/features/teams/services/list';

import {
  FORWARD_NEXT,
  FORWARD_SKIP,
  MISSING_TEAM,
  MISSING_WORKING_TYPE,
  NO_READS,
  STATE_CREATED,
  STATE_END,
  STATE_SET,
  STATE_UNSET,
  allReadOf,
  cardAwaitsOf,
  factsOf,
  leftMessageKey,
  onboardingReadsOf,
  progressReadsEnabledOf,
  forwardOf,
  onboardingCardOf,
  prerequisiteStepOf,
  remainingStepsOf,
  rotationPrerequisitesOf,
  setCountOf,
  stepStateMessageKey,
  stepStateOf,
  summaryOf,
  type OnboardingReads,
} from '@/features/onboarding/services/progress';
import {
  DONE_STEP,
  FACT_STEPS,
  HOUR_BANDS_STEP,
  MEMBERS_STEP,
  ONBOARDING_STEPS,
  ORGANIZATION_STEP,
  ROTATION_STEP,
  SHIFT_TYPES_STEP,
  TEAMS_STEP,
  frameStepOfSlug,
  nextFrameStepOf,
  previousFrameStepOf,
  stepNameMessageKey,
  stepNumberOf,
  stepPathOf,
} from '@/features/onboarding/services/steps';

/** A fresh organization founded by signup: every read there, nothing set, the founder alone. */
const FRESH: OnboardingReads = { hourBands: [], teams: [], shiftTypes: [], rotation: [], members: 1 };

/** Every fact present. */
const SET_UP: OnboardingReads = {
  hourBands: [{}, {}],
  teams: [{ archived: false }, { archived: false }, { archived: true }],
  shiftTypes: [
    { archived: false, isWorking: true },
    { archived: false, isWorking: false },
  ],
  // The LATEST SAVED record names step 7's date, not the latest date.
  rotation: [
    { effectiveFrom: '2026-12-01', createdAt: '2026-11-21T10:00:00+00:00' },
    { effectiveFrom: '2027-01-01', createdAt: '2026-11-20T10:00:00+00:00' },
  ],
  members: 6,
};

const SIGNUP_ADMIN = { admin: true, foundedBySignup: true, dismissed: false } as const;

describe('the seven steps (D1)', () => {
  it('numbers seven in order, with Croatian slugs for steps 2–7, and an unknown slug is no step', () => {
    expect(ONBOARDING_STEPS).toHaveLength(7);
    expect(FACT_STEPS).toEqual([HOUR_BANDS_STEP, TEAMS_STEP, SHIFT_TYPES_STEP, ROTATION_STEP, MEMBERS_STEP]);
    expect(stepNumberOf(ORGANIZATION_STEP)).toBe(1);
    expect(stepNumberOf(DONE_STEP)).toBe(7);
    expect(stepPathOf(HOUR_BANDS_STEP)).toBe('/postavljanje/satni-pojasi');
    expect(stepPathOf(TEAMS_STEP)).toBe('/postavljanje/smjene');
    expect(stepPathOf(SHIFT_TYPES_STEP)).toBe('/postavljanje/tipovi-smjena');
    expect(stepPathOf(ROTATION_STEP)).toBe('/postavljanje/rotacija');
    expect(stepPathOf(MEMBERS_STEP)).toBe('/postavljanje/ljudi');
    expect(stepPathOf(DONE_STEP)).toBe('/postavljanje/gotovo');
    expect(frameStepOfSlug('rotacija')).toBe(ROTATION_STEP);
    expect(frameStepOfSlug('nepoznato')).toBeNull();
    expect(nextFrameStepOf(HOUR_BANDS_STEP)).toBe(TEAMS_STEP);
    expect(nextFrameStepOf(DONE_STEP)).toBeNull();
    // *Natrag* from step 3 on: step 2 has none.
    expect(previousFrameStepOf(HOUR_BANDS_STEP)).toBeNull();
    expect(previousFrameStepOf(TEAMS_STEP)).toBe(HOUR_BANDS_STEP);
    for (const step of ONBOARDING_STEPS) expect(stepNameMessageKey(step)).toBe(`onboarding.step.${step}`);
  });
});

describe('the facts (AD-24)', () => {
  it('reads a fresh organization as nothing set, and the founder alone as not set', () => {
    const facts = factsOf(FRESH);

    expect(allReadOf(facts)).toBe(true);
    expect(remainingStepsOf(facts)).toEqual(FACT_STEPS);
    expect(setCountOf(facts)).toBe(0);
    expect(stepStateOf(facts, MEMBERS_STEP)).toBe(STATE_UNSET);
    expect(stepStateOf(facts, ORGANIZATION_STEP)).toBe(STATE_CREATED);
    expect(stepStateOf(facts, DONE_STEP)).toBe(STATE_END);
  });

  it('flips each fact on its own row: a band, a team not archived, a type not archived, a version, a second member', () => {
    const cases: readonly [Partial<OnboardingReads>, (typeof FACT_STEPS)[number]][] = [
      [{ hourBands: [{}] }, HOUR_BANDS_STEP],
      [{ teams: [{ archived: false }] }, TEAMS_STEP],
      [{ shiftTypes: [{ archived: false, isWorking: false }] }, SHIFT_TYPES_STEP],
      [{ rotation: [{ effectiveFrom: '2026-12-01', createdAt: '2026-11-21T10:00:00+00:00' }] }, ROTATION_STEP],
      [{ members: 2 }, MEMBERS_STEP],
    ];

    for (const [change, step] of cases) {
      const facts = factsOf({ ...FRESH, ...change });

      expect(stepStateOf(facts, step), step).toBe(STATE_SET);
      expect(remainingStepsOf(facts), step).not.toContain(step);
      expect(setCountOf(facts), step).toBe(1);
      // The forward control follows the same fact.
      expect(forwardOf(facts, step)?.kind, step).toBe(FORWARD_NEXT);
      expect(forwardOf(factsOf(FRESH), step)?.kind, step).toBe(FORWARD_SKIP);
    }
    // Archived rows are no fact.
    expect(stepStateOf(factsOf({ ...FRESH, teams: [{ archived: true }] }), TEAMS_STEP)).toBe(STATE_UNSET);
    expect(stepStateOf(factsOf({ ...FRESH, shiftTypes: [{ archived: true, isWorking: true }] }), SHIFT_TYPES_STEP)).toBe(
      STATE_UNSET,
    );
  });

  it('reads a missing or failed read as not set, never as a guess of done', () => {
    const facts = factsOf(NO_READS);

    expect(allReadOf(facts)).toBe(false);
    for (const step of FACT_STEPS) expect(stepStateOf(facts, step)).toBe(STATE_UNSET);
    expect(allReadOf(factsOf({ ...SET_UP, members: undefined }))).toBe(false);
  });

  it('goes forward to the next step from every fact step, and step 7 has no forward control', () => {
    const facts = factsOf(SET_UP);

    expect(forwardOf(facts, HOUR_BANDS_STEP)).toEqual({ kind: FORWARD_NEXT, to: TEAMS_STEP });
    expect(forwardOf(facts, MEMBERS_STEP)).toEqual({ kind: FORWARD_NEXT, to: DONE_STEP });
    expect(forwardOf(facts, DONE_STEP)).toBeNull();
  });

  it('words each state, and step 7 none', () => {
    expect(stepStateMessageKey(STATE_CREATED)).toBe('onboarding.state.created');
    expect(stepStateMessageKey(STATE_SET)).toBe('onboarding.state.set');
    expect(stepStateMessageKey(STATE_UNSET)).toBe('onboarding.state.unset');
    expect(stepStateMessageKey(STATE_END)).toBeNull();
  });
});

describe('step 5’s prerequisites (UX-DR67)', () => {
  it('names no team and no working type, each with its step, and nothing while a read is missing', () => {
    expect(rotationPrerequisitesOf(factsOf(FRESH))).toEqual([MISSING_TEAM, MISSING_WORKING_TYPE]);
    // A non-working type alone is no working type.
    expect(
      rotationPrerequisitesOf(
        factsOf({ ...FRESH, teams: [{ archived: false }], shiftTypes: [{ archived: false, isWorking: false }] }),
      ),
    ).toEqual([MISSING_WORKING_TYPE]);
    expect(rotationPrerequisitesOf(factsOf(SET_UP))).toEqual([]);
    expect(rotationPrerequisitesOf(factsOf(NO_READS))).toBeNull();
    expect(prerequisiteStepOf(MISSING_TEAM)).toBe(TEAMS_STEP);
    expect(prerequisiteStepOf(MISSING_WORKING_TYPE)).toBe(SHIFT_TYPES_STEP);
  });
});

describe('the Danas card (UX-DR69)', () => {
  it('is drawn for a signup organization’s admin with steps left, counting them and naming the first', () => {
    const facts = factsOf({ ...FRESH, hourBands: [{}], teams: [{ archived: false }] });

    expect(onboardingCardOf(SIGNUP_ADMIN, facts)).toEqual({
      remaining: [SHIFT_TYPES_STEP, ROTATION_STEP, MEMBERS_STEP],
      set: 2,
      first: SHIFT_TYPES_STEP,
      rotationLeft: true,
    });
    // One left, the rotation done: no "no schedule" line.
    const nearly = onboardingCardOf(SIGNUP_ADMIN, factsOf({ ...SET_UP, members: 1 }));
    expect(nearly).toEqual({ remaining: [MEMBERS_STEP], set: 4, first: MEMBERS_STEP, rotationLeft: false });
  });

  it('is absent for an operator organization, once dismissed, for a member, while a read is missing, and when done', () => {
    const facts = factsOf(FRESH);

    expect(onboardingCardOf({ ...SIGNUP_ADMIN, foundedBySignup: false }, facts)).toBeNull();
    expect(onboardingCardOf({ ...SIGNUP_ADMIN, dismissed: true }, facts)).toBeNull();
    expect(onboardingCardOf({ ...SIGNUP_ADMIN, admin: false }, facts)).toBeNull();
    expect(onboardingCardOf({ ...SIGNUP_ADMIN, foundedBySignup: null, dismissed: null }, facts)).toBeNull();
    expect(onboardingCardOf(SIGNUP_ADMIN, factsOf({ ...FRESH, rotation: undefined }))).toBeNull();
    expect(onboardingCardOf(SIGNUP_ADMIN, factsOf(SET_UP))).toBeNull();
  });
});

describe('step 7’s summary (UX-DR68)', () => {
  it('states each done fact’s count, the rotation’s latest Vrijedi od, and what is not set', () => {
    expect(summaryOf(factsOf(SET_UP))).toEqual([
      { step: HOUR_BANDS_STEP, done: true, count: 2, from: null },
      { step: TEAMS_STEP, done: true, count: 2, from: null },
      { step: SHIFT_TYPES_STEP, done: true, count: 2, from: null },
      { step: ROTATION_STEP, done: true, count: 2, from: '2026-12-01' },
      { step: MEMBERS_STEP, done: true, count: 6, from: null },
    ]);
    expect(summaryOf(factsOf(FRESH)).map((line) => line.done)).toEqual([false, false, false, false, false]);
  });
});

describe('the queries as the hook reads them (review 1)', () => {
  const team = (id: string, archived: boolean): TeamRow => ({ id, organizationId: 'org', name: id, archived });
  const types = (rows: readonly { archived: boolean; isWorking: boolean }[]): ShiftTypesSnapshot =>
    ({
      organizationId: 'org',
      timeZone: 'Europe/Zagreb',
      types: rows.map((row, index) => ({ ...row, id: `t${String(index)}`, name: `T${String(index)}` })),
    }) as unknown as ShiftTypesSnapshot;
  const members = (count: number): MembersSettled => ({
    ok: true,
    members: Array.from({ length: count }, (_, index) => ({ id: `m${String(index)}` }) as unknown as MemberListRow),
  });

  it('maps every real answer, a refused members read as no read, and flips each fact and the card count', async () => {
    const noRotation = await readRotation(rotationTableOf(answerOf({ ...PILOT, assignments: [], history: [] })));
    const withRotation = await readRotation(rotationTableOf(answerOf(PILOT)));
    if (!noRotation.ok || !withRotation.ok) throw new Error('fixture rotation did not read');

    const empty = factsOf(
      onboardingReadsOf({
        hourBands: [],
        teams: [team('a', true)],
        shiftTypes: types([{ archived: true, isWorking: true }]),
        rotation: noRotation.snapshot,
        members: members(1),
      }),
    );
    expect(remainingStepsOf(empty)).toEqual(FACT_STEPS);
    expect(onboardingCardOf(SIGNUP_ADMIN, empty)?.remaining).toHaveLength(5);

    const full = factsOf(
      onboardingReadsOf({
        hourBands: [{ id: 'b', organizationId: 'org', name: 'Jutro', startMinute: 360 }],
        teams: [team('a', false)],
        shiftTypes: types([{ archived: false, isWorking: true }]),
        rotation: withRotation.snapshot,
        members: members(2),
      }),
    );
    expect(remainingStepsOf(full)).toEqual([]);
    expect(full.rotationRecords).toBe(withRotation.snapshot.history.length);
    expect(onboardingCardOf(SIGNUP_ADMIN, full)).toBeNull();

    const refused = onboardingReadsOf({
      hourBands: undefined,
      teams: undefined,
      shiftTypes: undefined,
      rotation: undefined,
      members: { ok: false, code: 'MEMBERS_REFUSED' },
    });
    expect(refused.members).toBeUndefined();
    expect(allReadOf(factsOf(refused))).toBe(false);
  });

  it('dates the rotation by its latest saved record', async () => {
    const rows = {
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', SEEDED, '2026-12-01')],
    };
    const outcome = await readRotation(rotationTableOf(answerOf(rows)));
    if (!outcome.ok) throw new Error('fixture rotation did not read');
    const facts = factsOf(onboardingReadsOf({ hourBands: [], teams: [], shiftTypes: undefined, rotation: outcome.snapshot, members: undefined }));
    expect(facts.rotationFrom).not.toBeNull();
  });
});

describe('who reads, and what step 7 promises (D5, review 1)', () => {
  it('runs the card reads only for a signup organization not dismissed, for an admin; the frame for an admin', () => {
    expect(progressReadsEnabledOf(true, SIGNUP_ADMIN)).toBe(true);
    expect(progressReadsEnabledOf(true, { ...SIGNUP_ADMIN, foundedBySignup: false })).toBe(false);
    expect(progressReadsEnabledOf(true, { ...SIGNUP_ADMIN, dismissed: true })).toBe(false);
    expect(progressReadsEnabledOf(true, { ...SIGNUP_ADMIN, admin: false })).toBe(false);
    expect(progressReadsEnabledOf(true, { ...SIGNUP_ADMIN, foundedBySignup: null, dismissed: null })).toBe(false);
    expect(progressReadsEnabledOf(false, { admin: true, foundedBySignup: false, dismissed: true })).toBe(true);
    expect(progressReadsEnabledOf(false, { admin: false, foundedBySignup: true, dismissed: false })).toBe(false);
  });

  it('promises the Danas card only where it will be', () => {
    expect(cardAwaitsOf({ foundedBySignup: true, dismissed: false })).toBe(true);
    expect(cardAwaitsOf({ foundedBySignup: false, dismissed: false })).toBe(false);
    expect(cardAwaitsOf({ foundedBySignup: true, dismissed: true })).toBe(false);
    expect(leftMessageKey(true)).toBe('onboarding.done.left');
    expect(leftMessageKey(false)).toBe('onboarding.done.leftNoCard');
  });
});
