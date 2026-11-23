import { useQuery } from '@tanstack/react-query';

import { HOUR_BANDS_TABLE, hourBandsQueryOptions } from '@/features/hour-bands/services/list';
import { MEMBERS_TABLE, membersQueryOptions } from '@/features/members/services/list';
import {
  cardAwaitsOf,
  factsOf,
  onboardingCardOf,
  onboardingReadsOf,
  progressReadsEnabledOf,
  type CardConditions,
  type OnboardingCard,
  type OnboardingFacts,
} from '@/features/onboarding/services/progress';
import {
  organizationSnapshotQueryOptions,
  organizationTable,
  type OrganizationSnapshot,
} from '@/features/organization/services/snapshot';
import { ROTATION_READ_TABLE, rotationQueryOptions } from '@/features/rotation/services/list';
import { SHIFT_TYPES_READ_TABLE, shiftTypesQueryOptions } from '@/features/shift-types/services/list';
import { TEAMS_TABLE, teamsQueryOptions } from '@/features/teams/services/list';
import { supabaseClient } from '@/lib/supabase/client';

/** Who reads the progress: the setup frame (always reads), or the *Danas* card (D5). */
export interface OnboardingProgressOptions {
  /** An active admin (the chrome's role read on *Danas*; the route's guard in the frame). */
  readonly admin: boolean;
  /**
   * The *Danas* card: the five reads run only once the organization says it
   * was founded by signup and is not dismissed (D5), so an operator-provisioned
   * organization pays nothing. The frame reads them always.
   */
  readonly forCard: boolean;
}

export interface OnboardingProgress {
  /** The organization, or `null` while it is not read. */
  readonly organization: OrganizationSnapshot | null;
  /** The organization's read settled with no row to draw: the frame says so. */
  readonly organizationFailed: boolean;
  readonly facts: OnboardingFacts;
  /** The card, when AD-24's conditions hold and every read is there. */
  readonly card: OnboardingCard | null;
  /** Whether the *Danas* card waits for the steps left (step 7's wording). */
  readonly cardAwaits: boolean;
  /** Whether a read is still pending for the first time, the organization's included. */
  readonly loading: boolean;
  /** Whether the teams or shift types read failed with nothing to draw (step 5 says so). */
  readonly prerequisitesFailed: boolean;
  /** Reads every failed read again. */
  retry(): void;
}

/**
 * STORY 19.4 (AD-24): the ONE progress hook. The rail, the forward control,
 * step 5's prerequisites, step 7 and the *Danas* card all read it, so they
 * cannot disagree.
 *
 * It reads every fact through its owning feature's own query options, under
 * the key that surface already reads (AD-13): no key of its own, and no write
 * module of any other feature (D3). A step's write invalidates its own key, so
 * the rail follows the moment the shipped surface's refetch lands. Every
 * decision is `@/features/onboarding/services/progress`'s, which the node
 * suite executes; this hook binds the queries.
 *
 * The organization snapshot is observed here too: outside the chrome (the
 * frame) nothing else observes it, and the step surfaces read it from the cache.
 */
export function useOnboardingProgress({ admin, forCard }: OnboardingProgressOptions): OnboardingProgress {
  const organizationRead = useQuery(organizationSnapshotQueryOptions(organizationTable));
  const outcome = organizationRead.data;
  const organization = outcome !== undefined && outcome.ok ? outcome.snapshot : null;
  const conditions: CardConditions = {
    admin,
    foundedBySignup: organization?.foundedBySignup ?? null,
    dismissed: organization?.onboardingDismissed ?? null,
  };
  const enabled = progressReadsEnabledOf(forCard, conditions);

  const hourBands = useQuery({
    ...hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)),
    enabled,
  });
  const teams = useQuery({ ...teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)), enabled });
  const shiftTypes = useQuery({
    ...shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
    enabled,
  });
  const rotation = useQuery({
    ...rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE)),
    enabled,
  });
  const members = useQuery({ ...membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)), enabled });

  // THE LAST GOOD ANSWER of each read, which TanStack keeps across a failed
  // refetch; none yet is `undefined`, which `factsOf` reads as not done.
  const facts = factsOf(
    onboardingReadsOf({
      hourBands: hourBands.data,
      teams: teams.data,
      shiftTypes: shiftTypes.data,
      rotation: rotation.data,
      members: members.data,
    }),
  );
  const factReads = [hourBands, teams, shiftTypes, rotation, members];

  return {
    organization,
    organizationFailed: organization === null && (organizationRead.isError || (outcome !== undefined && !outcome.ok)),
    facts,
    card: onboardingCardOf(conditions, facts),
    cardAwaits: cardAwaitsOf(conditions),
    // THE GATING READ COUNTS: while the organization is pending, nothing is known yet.
    loading: organizationRead.isPending || (enabled && factReads.some((read) => read.isPending && read.isFetching)),
    prerequisitesFailed:
      (teams.isError && teams.data === undefined) || (shiftTypes.isError && shiftTypes.data === undefined),
    retry: () => {
      for (const read of [organizationRead, ...factReads]) if (read.isError) void read.refetch();
    },
  };
}
