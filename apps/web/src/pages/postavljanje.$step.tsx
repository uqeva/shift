import { createRoute, redirect } from '@tanstack/react-router';
import { useCallback, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { HourBandAddDialog } from '@/features/hour-bands/components/hour-band-add-dialog';
import { HourBandListSection } from '@/features/hour-bands/components/hour-band-list-section';
import { useHourBandList } from '@/features/hour-bands/hooks/use-hour-band-list';
import { hourBandsMessageKey, hourBandsRetryMessageKey } from '@/features/hour-bands/services/list';
import { MemberAddDialog } from '@/features/members/components/member-add-dialog';
import { MemberTable } from '@/features/members/components/member-table';
import { useMemberCreate, type MemberAddNavigate } from '@/features/members/hooks/use-member-create';
import { useMemberList, type MembersNavigate } from '@/features/members/hooks/use-member-list';
import { membersMessageKey, membersRetryMessageKey, type MembersSearch } from '@/features/members/services/list';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { RotationPrerequisites, RotationTypesNote } from '@/features/onboarding/components/rotation-step-parts';
import { SetupFrame } from '@/features/onboarding/components/setup-frame';
import { SetupSummary } from '@/features/onboarding/components/setup-summary';
import { SignInLinkCard } from '@/features/onboarding/components/sign-in-link-card';
import { StepExplainer } from '@/features/onboarding/components/step-explainer';
import { useOnboardingProgress, type OnboardingProgress } from '@/features/onboarding/hooks/use-onboarding-progress';
import { factDoneOf, rotationPrerequisitesOf } from '@/features/onboarding/services/progress';
import {
  DONE_STEP,
  FIRST_FRAME_STEP,
  HOUR_BANDS_STEP,
  MEMBERS_STEP,
  ROTATION_STEP,
  SHIFT_TYPES_STEP,
  STEP_SLUGS,
  TEAMS_STEP,
  frameStepOfSlug,
  type FrameStep,
} from '@/features/onboarding/services/steps';
import { RotationSection } from '@/features/rotation/components/rotation-section';
import { ShiftTypeAddDialog } from '@/features/shift-types/components/shift-type-add-dialog';
import { ShiftTypeListSection } from '@/features/shift-types/components/shift-type-list-section';
import { useShiftTypeList } from '@/features/shift-types/hooks/use-shift-type-list';
import { TeamAddDialog } from '@/features/teams/components/team-add-dialog';
import { TeamListSection } from '@/features/teams/components/team-list-section';
import { useTeamList } from '@/features/teams/hooks/use-team-list';
import { teamsMessageKey, teamsRetryMessageKey } from '@/features/teams/services/list';
import { returnSearchFor } from '@/features/auth/services/return-target';
import {
  SETUP_DESTINATION,
  SIGN_OUT_DESTINATION,
  sessionDestination,
} from '@/features/auth/services/session-destination';
import { mustSetPassword } from '@/features/auth/services/set-password';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * `/postavljanje/$step`, steps 2–7 of setup (story 19.4, AD-24, UX-DR65, 67,
 * 68). OUTSIDE the app layout (no shell), with the layout's session,
 * set-password and destination checks and the shared admin guard (D1).
 *
 * THIS FILE COMPOSES (D9). Each step is the shipped surface's own hook and
 * sections, unchanged, with one explainer above it while its fact is missing;
 * every write is that surface's own. The frame, the rail, the footer and
 * every state come from `@/features/onboarding`, whose one progress hook
 * reads each fact under the surface's own key.
 */

function HourBandsStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  const screen = useHourBandList();
  const { refusal } = screen;

  return (
    <SetupFrame step={HOUR_BANDS_STEP} progress={progress} lede={t('organization.hourBands.lede')}>
      {factDoneOf(progress.facts, HOUR_BANDS_STEP) ? null : (
        <StepExplainer
          title={t('onboarding.hourBands.explainerTitle')}
          body={t('onboarding.hourBands.explainerBody')}
          example={t('onboarding.hourBands.example')}
        />
      )}
      {screen.created ? <Notice role="status">{t('organization.hourBands.created')}</Notice> : null}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(hourBandsMessageKey(refusal))}</Notice>
          {screen.retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={screen.retry}
            >
              {t(hourBandsRetryMessageKey(refusal))}
            </Button>
          ) : null}
        </div>
      )}
      <Button className="h-11 self-start" type="button" onClick={screen.openAdding}>
        <Plus aria-hidden />
        {t('organization.hourBands.open')}
      </Button>
      <HourBandAddDialog screen={screen} />
      <HourBandListSection screen={screen} />
    </SetupFrame>
  );
}

function TeamsStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  const screen = useTeamList();
  const { refusal } = screen;

  return (
    <SetupFrame step={TEAMS_STEP} progress={progress} lede={t('onboarding.teams.lede')}>
      {factDoneOf(progress.facts, TEAMS_STEP) ? null : (
        <StepExplainer
          title={t('onboarding.teams.explainerTitle')}
          body={t('onboarding.teams.explainerBody')}
          example={t('onboarding.teams.example')}
        />
      )}
      {screen.created ? <Notice role="status">{t('smjene.created')}</Notice> : null}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(teamsMessageKey(refusal))}</Notice>
          {screen.retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={screen.retry}
            >
              {t(teamsRetryMessageKey(refusal))}
            </Button>
          ) : null}
        </div>
      )}
      <Button className="h-11 self-start" type="button" onClick={screen.openAdding}>
        <Plus aria-hidden />
        {t('smjene.open')}
      </Button>
      <TeamAddDialog screen={screen} />
      <TeamListSection screen={screen} />
    </SetupFrame>
  );
}

function ShiftTypesStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  const screen = useShiftTypeList();

  return (
    <SetupFrame step={SHIFT_TYPES_STEP} progress={progress} lede={t('onboarding.shiftTypes.lede')}>
      {factDoneOf(progress.facts, SHIFT_TYPES_STEP) ? null : (
        <StepExplainer
          title={t('onboarding.shiftTypes.explainerTitle')}
          body={t('onboarding.shiftTypes.explainerBody')}
          example={t('onboarding.shiftTypes.example')}
        />
      )}
      <ShiftTypeListSection screen={screen} />
      <ShiftTypeAddDialog screen={screen} />
    </SetupFrame>
  );
}

function RotationStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  const missing = rotationPrerequisitesOf(progress.facts);
  const blocked = missing !== null && missing.length !== 0;
  const ready = missing !== null && missing.length === 0;

  return (
    <SetupFrame step={ROTATION_STEP} progress={progress} lede={t('onboarding.rotation.lede')}>
      {factDoneOf(progress.facts, ROTATION_STEP) ? null : (
        <StepExplainer
          title={t('onboarding.rotation.explainerTitle')}
          body={t('onboarding.rotation.explainerBody')}
          example={t('onboarding.rotation.example')}
        />
      )}
      {/* A BUILDER THAT CANNOT SAVE IS NEVER DRAWN (UX-DR67): with no team
          or no working type the step names what is missing; while either
          read is pending it draws nothing but the frame. */}
      {/* REVIEW 1: a failed teams or types read is said, with its retry, never nothing. */}
      {missing === null && progress.prerequisitesFailed ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('onboarding.rotation.unavailable')}</Notice>
          <Button
            ref={keepFocusOnAlert}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            onClick={progress.retry}
          >
            {t('onboarding.frame.retry')}
          </Button>
        </div>
      ) : null}
      {blocked ? <RotationPrerequisites missing={missing} /> : null}
      {ready ? (
        <RotationSection heading={null} shiftTypes={<RotationTypesNote count={progress.facts.shiftTypes ?? 0} />} />
      ) : null}
    </SetupFrame>
  );
}

function MembersStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  // LOCAL STATE where *Ljudi* has its URL (the members list's search and the
  // dialog's `?dodaj=1`): the step composes the same hooks, and its own URL
  // stays `/postavljanje/ljudi`.
  const [search, setSearch] = useState<MembersSearch>({});
  const [adding, setAdding] = useState(false);
  const write = useCallback<MembersNavigate>((next) => {
    setSearch(next);
  }, []);
  const writeAdding = useCallback<MemberAddNavigate>((open) => {
    setAdding(open);
  }, []);
  const list = useMemberList(search, write);
  const create = useMemberCreate(adding, writeAdding);
  const { refusal } = list;
  const retryKey = list.retryable && refusal !== null ? membersRetryMessageKey(refusal) : null;

  return (
    <SetupFrame step={MEMBERS_STEP} progress={progress} lede={t('onboarding.members.lede')}>
      {factDoneOf(progress.facts, MEMBERS_STEP) ? null : (
        <StepExplainer
          title={t('onboarding.members.explainerTitle')}
          body={t('onboarding.members.explainerBody')}
          example={t('onboarding.members.example')}
        />
      )}
      {progress.organization === null ? null : <SignInLinkCard slug={progress.organization.slug} />}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(membersMessageKey(refusal))}</Notice>
          {/* As *Ljudi*: a retry only for a read that was unavailable, and only online. */}
          {retryKey === null ? null : (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={list.retry}
            >
              {t(retryKey)}
            </Button>
          )}
        </div>
      )}
      <Button ref={create.opener} type="button" className="h-11 self-start" onClick={create.open}>
        <Plus aria-hidden />
        {t('ljudi.form.add')}
      </Button>
      <MemberTable list={list} />
      <MemberAddDialog create={create} />
    </SetupFrame>
  );
}

function DoneStep({ progress }: { readonly progress: OnboardingProgress }): ReactNode {
  return (
    <SetupFrame step={DONE_STEP} progress={progress} lede={t('onboarding.done.lede')}>
      <SetupSummary progress={progress} />
    </SetupFrame>
  );
}

export function SetupStepScreen(): ReactNode {
  const { step: slug } = setupStepRoute.useParams();
  // The guard has already sent an unknown slug to step 2; this is its fallback.
  const step = frameStepOfSlug(slug) ?? FIRST_FRAME_STEP;
  // THE ONE PROGRESS HOOK (AD-24), read once for the frame and handed to the
  // step: the rail, the footer and the step's explainer cannot disagree.
  const progress = useOnboardingProgress({ admin: true, forCard: false });

  const Step = STEP_SCREENS[step];

  return <Step progress={progress} />;
}

/** Each frame step's body, by step: one component per shipped surface. */
const STEP_SCREENS: Readonly<Record<FrameStep, (props: { readonly progress: OnboardingProgress }) => ReactNode>> = {
  [HOUR_BANDS_STEP]: HourBandsStep,
  [TEAMS_STEP]: TeamsStep,
  [SHIFT_TYPES_STEP]: ShiftTypesStep,
  [ROTATION_STEP]: RotationStep,
  [MEMBERS_STEP]: MembersStep,
  [DONE_STEP]: DoneStep,
};

export const setupStepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/postavljanje/$step',
  beforeLoad: async (options) => {
    const { context, location, params } = options;
    const session = await resolvedSession(context.currentSession);

    // `_app`'s checks, in its order (D1): signed out to *Prijava* with the
    // location carried; a flagged session to its password first; a claimless
    // email identity to step 1; a claimless username identity signed out.
    if (session === null) throw redirect({ to: '/prijava', search: returnSearchFor(location.href) });
    if (mustSetPassword(session)) throw redirect({ to: '/postavi-lozinku', search: returnSearchFor(location.href) });

    const destination = sessionDestination(session);

    if (destination === SETUP_DESTINATION) throw redirect({ to: '/postavljanje' });
    if (destination === SIGN_OUT_DESTINATION) {
      await context.endLocalSession?.();
      throw redirect({ to: '/prijava' });
    }

    // THE SHARED ADMIN GUARD: a member goes to *Danas*.
    await requireAdmin(options);

    // An unknown step is step 2, replacing the entry.
    if (frameStepOfSlug(params.step) === null) {
      throw redirect({ to: '/postavljanje/$step', params: { step: STEP_SLUGS[FIRST_FRAME_STEP] }, replace: true });
    }
  },
  component: SetupStepScreen,
});
