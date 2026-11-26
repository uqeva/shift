import { Link, createRoute, useLocation } from '@tanstack/react-router';

import { OfflineNote } from '@/components/offline-note';
import { MemberFeedCard } from '@/features/calendar-feed/components/member-feed-card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { MemberLeaveCard } from '@/features/leave/components/member-leave-card';
import { leaveHandoffOf, leaveHandoffOriginOf } from '@/features/leave/services/leave-section';
import { MemberAllowanceAction } from '@/features/members/components/member-allowance-dialog';
import { MemberBasicsCard } from '@/features/members/components/member-basics-card';
import { MemberFloaterCard } from '@/features/members/components/member-floater-card';
import { MemberPageTitle } from '@/features/members/components/member-page-header';
import { MemberResetCard } from '@/features/members/components/member-reset-card';
import { MemberScheduleSourceCard } from '@/features/members/components/member-schedule-source-card';
import { MemberStatusCard } from '@/features/members/components/member-status-card';
import { MemberTeamCard } from '@/features/members/components/member-team-card';
import { useMemberEdit } from '@/features/members/hooks/use-member-edit';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { MemberAddShiftCard } from '@/features/planning/components/member-add-shift-card';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/$id` — one member's page (story 1.5b; facts and dialogs since story
 * 7.11). Headed by the person's name, it reads as fact cards in the order of
 * the approved mockup — *Osnovni podaci*, *Smjena*, *Raspored osobe* (story
 * 21.10), *Zamjena* (story 21.13), *Godišnji odmor*, *Status*, *Kalendar na mobitelu* (story 16.5)
 * and *Prijava* — and each
 * card's header button opens its own small dialog. This file composes the
 * screen; its state, reads and handlers are `useMemberEdit`, its cards are
 * components in `@/features/members/components`, and every rule is
 * `@/features/members/services/write`'s. The *Kalendar na mobitelu* card is
 * `@/features/calendar-feed`'s, with its own read and write.
 *
 * THIS IS NOT A DESTINATION. The way back to the list is a link that says so.
 *
 * STORY 8.2c: offline, the page is drawn whole from the device's snapshot —
 * the member edit's reads and the leave card's as one — under ONE as-of note
 * (`OfflineNote`, under the heading), or the whole page is unavailable.
 */

export function LjudiMemberScreen() {
  const { id } = ljudiMemberRoute.useParams();
  const edit = useMemberEdit(id);
  // STORY 5.4d: reached from a conflict's third card, in router state only.
  const state = useLocation().state;
  const handoff = leaveHandoffOf(state);
  /** Kept on the entry after the hand-off has opened, for the way back. */
  const fromConflict = leaveHandoffOriginOf(state) !== null;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          {/* THE WAY BACK, always rendered — including while the read is
              pending and after it has settled failed. A screen reachable only
              by URL that can be left only by the browser's Back button is a
              dead end. Above the title, where a way back is looked for
              (design refresh C). */}
          {/* Each link carries the same `-ml-3`, so on a phone, where the two
              wrap, both line up with the title. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-5">
            <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
              <Link to="/ljudi">
                <ArrowLeft aria-hidden />
                {t('ljudi.form.back')}
              </Link>
            </Button>
            {/* THE WAY BACK TO THE CONFLICTS (story 5.4d), while the page was
                reached from one: the queue re-reads, so a saved amend's
                conflict is gone from it and a cancelled one still stands. */}
            {fromConflict ? (
              <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
                <Link to="/za-odluku">
                  <ArrowLeft aria-hidden />
                  {t('ljudi.form.backToConflicts')}
                </Link>
              </Button>
            ) : null}
          </div>
          <MemberPageTitle edit={edit} />
        </div>
      </PageHeader>
      {/* STORY 8.2c: the page's one as-of note — the leave card decides with it and adds none. */}
      <OfflineNote offline={edit.offline} />
      {/* FACT CARDS, EACH CHANGE IN ITS OWN DIALOG (story 7.11). A card is
          drawn only around a block that renders, so none stands empty — the
          status card renders nothing on one's own row, for instance. */}
      <MemberBasicsCard edit={edit} />
      {/* STORY 1.7b. */}
      <MemberTeamCard edit={edit} />
      {/* STORY 21.10 (UX-DR75): how the member is scheduled — their team's
          rotation, their own, or only by hand — from a date. */}
      <MemberScheduleSourceCard edit={edit} />
      {/* STORY 21.13 (UX-DR77): whether the member covers gaps, and the job
          roles they may cover — what *Za odluku* suggests them by. */}
      <MemberFloaterCard edit={edit} />
      {/* STORY 5.1c: the member's leave — figures, the od–do form and what
          a range costs before it is saved. Keyed by the member, so nothing it
          raised about one member stands over another's. The allowance's
          action is the members feature's, handed in as a slot (story 7.11). */}
      <MemberLeaveCard
        key={id}
        memberId={id}
        handoff={handoff}
        allowanceAction={<MemberAllowanceAction edit={edit} />}
      />
      {/* STORY 21.6: one person, one date — *Ručni raspored*'s single-cell case. */}
      <MemberAddShiftCard memberId={id} />
      {/* STORY 1.6. */}
      <MemberStatusCard edit={edit} />
      {/* STORY 16.5 (UX-DR55): whether the member's calendar link is on, and
          its turn-off; its own read and write, never a URL. Keyed by the
          member, as the leave card is. */}
      <MemberFeedCard key={id} memberId={id} />
      <MemberResetCard edit={edit} />
    </main>
  );
}

export const ljudiMemberRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/$id',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: LjudiMemberScreen,
});
