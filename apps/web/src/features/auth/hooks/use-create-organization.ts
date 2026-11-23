import { useNavigate, useRouter } from '@tanstack/react-router';
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import {
  AFTER_NAVIGATE,
  AFTER_SIGN_OUT,
  CREATE_ELEMENT_IDS,
  CREATE_FIELD_IDS,
  CREATE_UNAVAILABLE,
  NOTHING_CHOSEN,
  NOTHING_TYPED,
  ORGANIZATION_CREATED,
  ORGANIZATION_INPUT_INVALID,
  ORGANIZATION_NOT_CREATABLE,
  ORGANIZATION_TIMEZONE_UNKNOWN,
  SLUG_UNAVAILABLE,
  afterCreateMessageKey,
  afterCreateOf,
  browserZones,
  createFailureMessageKey,
  createOrganization,
  deviceZoneOf,
  organizationRefusalsOf,
  refreshedDestination,
  slugProposalOf,
  zoneChoicesOf,
  type OrganizationForm,
  type OrganizationRefusal,
} from '@/features/auth/services/create-organization';
import { SIGNED_IN_HOME, knownPathOf, returnTargetOf } from '@/features/auth/services/return-target';
import { localSessionEnd } from '@/features/auth/services/sign-out';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { pageSignOutFallback } from '@/lib/supabase/local-sign-out';

/** What the form's failure notice can say: the definer's failures and the way on (review of 19.3). */
type CreateFailureKey = NonNullable<ReturnType<typeof createFailureMessageKey>> | ReturnType<typeof afterCreateMessageKey>;

/**
 * Step 1's state (story 19.3, UX-DR66, AD-23): every field starts empty and
 * nothing is selected. The slug follows the typed name until the person edits
 * it; the device's zone is proposed and must be confirmed or another chosen
 * (D11). A refusal on the page sends nothing (D10).
 *
 * The answers: `ORGANIZATION_CREATED` and `ORGANIZATION_NOT_CREATABLE` both
 * refresh the session (retried once) and then do what `afterCreateOf` says
 * (review of 19.3): a claimed session goes to the return target the app's
 * guard carried (D7) or `/`; a claimless username identity is signed out on
 * the device; a session still without a claim stays here with a neutral
 * notice, never an error screen and never a silent bounce. After a creation
 * the notice never says it was not created, and a second press only routes.
 * `SLUG_UNAVAILABLE` offers the proposal beside the slug and keeps the typed
 * slug; `ORGANIZATION_TIMEZONE_UNKNOWN` reopens the zone list; `TRY_LATER`
 * keeps every value.
 */
export function useCreateOrganization(povratak: string | undefined) {
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState(NOTHING_TYPED);
  const [slug, setSlug] = useState(NOTHING_TYPED);
  const slugEdited = useRef(false);
  const [organizationType, setOrganizationType] = useState(NOTHING_TYPED);
  const [proposedZone] = useState(() => deviceZoneOf());
  const [timezone, setTimezone] = useState<string | null>(null);
  const [choosingZone, setChoosingZone] = useState(proposedZone === null);
  const zones = useMemo(() => zoneChoicesOf(browserZones(), proposedZone), [proposedZone]);
  const [zoneRefused, setZoneRefused] = useState(false);
  const [leaveDay, setLeaveDay] = useState(NOTHING_CHOSEN);
  const [leaveMonth, setLeaveMonth] = useState(NOTHING_CHOSEN);
  const [adminName, setAdminName] = useState(NOTHING_TYPED);
  const [allowance, setAllowance] = useState(NOTHING_TYPED);
  const [refusals, setRefusals] = useState<readonly OrganizationRefusal[]>([]);
  const [failure, setFailure] = useState<CreateFailureKey | null>(null);
  // The organization exists: a second press only routes (review of 19.3).
  const created = useRef(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  function nameInput(event: ChangeEvent<HTMLInputElement>): void {
    const { value } = event.target;
    setName(value);
    if (!slugEdited.current) {
      setSlug(slugProposalOf(value));
      setProposal(null);
    }
  }

  // A proposal answers the slug it was made for (review 2 of 19.3): typing a
  // new one drops it, and its refusal with it.
  function slugInput(event: ChangeEvent<HTMLInputElement>): void {
    slugEdited.current = true;
    setSlug(event.target.value);
    setProposal(null);
  }

  function confirmZone(): void {
    setTimezone(proposedZone);
  }

  function chooseOtherZone(): void {
    setChoosingZone(true);
    setTimezone(null);
  }

  function zoneChosen(event: ChangeEvent<HTMLSelectElement>): void {
    const { value } = event.target;
    setZoneRefused(false);
    setTimezone(value === NOTHING_CHOSEN ? null : value);
  }

  function takeProposal(): void {
    if (proposal === null) return;
    slugEdited.current = true;
    setSlug(proposal);
    setProposal(null);
  }

  async function route(code: typeof ORGANIZATION_CREATED | typeof ORGANIZATION_NOT_CREATABLE): Promise<void> {
    try {
      // Inside the `try` (review 2 of 19.3): a client that cannot be made
      // ends in the notice, never in an unhandled rejection.
      const next = afterCreateOf(code, await refreshedDestination(supabaseClient().auth));

      if (next.kind === AFTER_NAVIGATE) {
        // STORY 19.4 (D2): with no return target, to `/postavljanje`, whose
        // guard sends a claimed admin to step 2; a carried target still wins.
        // A return target the validator refuses counts as none (review 1).
        const target = returnTargetOf(povratak, knownPathOf(router));
        if (target === SIGNED_IN_HOME) await navigate({ to: '/postavljanje', replace: true });
        else await navigate({ href: target, replace: true });

        return;
      }
      if (next.kind === AFTER_SIGN_OUT) {
        await localSessionEnd(() => supabaseClient().auth, pageSignOutFallback)();
        await navigate({ to: '/prijava', replace: true });

        return;
      }
      setFailure(next.key);
    } catch (cause) {
      // The way on failed; after a creation, never "not created".
      console.error(CREATE_UNAVAILABLE, cause);
      setFailure(afterCreateMessageKey(code));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (sending.current || !writesOnline()) return;

    if (created.current) {
      sending.current = true;
      setPending(true);
      setFailure(null);
      try {
        await route(ORGANIZATION_CREATED);
      } finally {
        sending.current = false;
        setPending(false);
      }

      return;
    }

    const form: OrganizationForm = { name, slug, organizationType, timezone, leaveDay, leaveMonth, adminName, allowance };
    const found = organizationRefusalsOf(form);

    flushSync(() => {
      setRefusals(found);
      setFailure(null);
      setProposal(null);
      setZoneRefused(false);
    });

    const first = found[0];
    if (first !== undefined) {
      document.getElementById(CREATE_FIELD_IDS[first])?.focus();

      return;
    }

    sending.current = true;
    setPending(true);

    try {
      const outcome = await createOrganization({ rpc: (fn, args) => supabaseClient().rpc(fn, args) }, form);

      if (outcome.code === ORGANIZATION_CREATED) created.current = true;
      if (outcome.code === ORGANIZATION_CREATED || outcome.code === ORGANIZATION_NOT_CREATABLE) {
        await route(outcome.code);

        return;
      }

      flushSync(() => {
        if (outcome.code === SLUG_UNAVAILABLE) setProposal(outcome.proposal);
        else if (outcome.code === ORGANIZATION_INPUT_INVALID) setRefusals([outcome.refusal]);
        else {
          if (outcome.code === ORGANIZATION_TIMEZONE_UNKNOWN) {
            setZoneRefused(true);
            setChoosingZone(true);
            setTimezone(null);
          }
          setFailure(createFailureMessageKey(outcome));
        }
      });
      if (outcome.code === ORGANIZATION_INPUT_INVALID) document.getElementById(CREATE_FIELD_IDS[outcome.refusal])?.focus();
      if (outcome.code === ORGANIZATION_TIMEZONE_UNKNOWN) document.getElementById(CREATE_FIELD_IDS.TIMEZONE_UNCONFIRMED)?.focus();
      if (outcome.code === SLUG_UNAVAILABLE) document.getElementById(CREATE_ELEMENT_IDS.useProposal)?.focus();
    } catch (cause) {
      console.error(CREATE_UNAVAILABLE, cause);
      setFailure(afterCreateMessageKey(created.current ? ORGANIZATION_CREATED : ORGANIZATION_NOT_CREATABLE));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return {
    name,
    slug,
    organizationType,
    proposedZone,
    timezone,
    choosingZone,
    zones,
    leaveDay,
    leaveMonth,
    adminName,
    allowance,
    refusals,
    zoneRefused,
    failure,
    proposal,
    pending,
    nameInput,
    slugInput,
    typeInput: (event: ChangeEvent<HTMLInputElement>) => {
      setOrganizationType(event.target.value);
    },
    confirmZone,
    chooseOtherZone,
    zoneChosen,
    leaveDayChosen: (event: ChangeEvent<HTMLSelectElement>) => {
      setLeaveDay(event.target.value);
    },
    leaveMonthChosen: (event: ChangeEvent<HTMLSelectElement>) => {
      setLeaveMonth(event.target.value);
    },
    adminNameInput: (event: ChangeEvent<HTMLInputElement>) => {
      setAdminName(event.target.value);
    },
    allowanceInput: (event: ChangeEvent<HTMLInputElement>) => {
      setAllowance(event.target.value);
    },
    takeProposal,
    submit,
  };
}

export type CreateOrganizationScreenState = ReturnType<typeof useCreateOrganization>;
