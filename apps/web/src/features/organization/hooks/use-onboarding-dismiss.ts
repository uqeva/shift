import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_UNAVAILABLE,
  organizationTable,
  updateOrganization,
  type OrganizationFailure,
} from '@/features/organization/services/snapshot';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';

/** What *Sakrij postavljanje* holds: whether it is writing, and the last refusal. */
export interface OnboardingDismiss {
  readonly pending: boolean;
  /** The last refusal's code, or `null`; cleared when the dialog opens again. */
  readonly failure: OrganizationFailure | null;
  /** Writes the dismissal; answers whether it landed. */
  dismiss(organizationId: string): Promise<boolean>;
  /** Clears the refusal (the dialog opening again). */
  reset(): void;
}

/**
 * STORY 19.4 (AD-24, UX-DR69): the one write of `organizations.onboarding_dismissed`,
 * the onboarding card's only stored fact. It goes through the organization's
 * own update (its own disjoint write shape) and re-reads the snapshot under
 * {@link ORGANIZATION_SNAPSHOT_KEY}, so the card is gone for this admin at once
 * and for every other admin on their next read.
 *
 * A refusal (a member-role session, a deactivated admin: the policy matches no
 * row) keeps the dialog open with its alert; offline, nothing is sent and the
 * write answers as refused, so the card stays.
 */
export function useOnboardingDismiss(): OnboardingDismiss {
  const queryClient = useQueryClient();
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<OrganizationFailure | null>(null);

  async function dismiss(organizationId: string): Promise<boolean> {
    if (writing.current) return false;
    if (!writesOnline()) {
      setFailure(ORGANIZATION_UNAVAILABLE);

      return false;
    }

    writing.current = true;
    setPending(true);
    setFailure(null);

    try {
      const outcome = await updateOrganization(organizationTable(), organizationId, { onboardingDismissed: true });

      if (!outcome.ok) {
        if (!droppedOffline(outcome.code, ORGANIZATION_UNAVAILABLE)) console.error(outcome.code);
        setFailure(outcome.code);

        return false;
      }

      // Written straight into the cache (the row the database answered with),
      // then re-read: the card reads this key, so it goes at once.
      queryClient.setQueryData(ORGANIZATION_SNAPSHOT_KEY, outcome);
      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(ORGANIZATION_UNAVAILABLE, cause);
      }

      return true;
    } catch (cause) {
      console.error(ORGANIZATION_UNAVAILABLE, cause);
      setFailure(ORGANIZATION_UNAVAILABLE);

      return false;
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  return { pending, failure, dismiss, reset: () => setFailure(null) };
}
