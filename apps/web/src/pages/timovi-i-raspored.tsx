import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { PageToolbar, ToolbarLabel } from '@/components/page-toolbar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PageTitle } from '@/components/ui/page-header';
import { MemberDialogsHost, type MemberDialogOutcome } from '@/features/members/components/member-dialogs-host';
import { MemberJobRolePicker } from '@/features/members/components/member-job-role-picker';
import { factText, memberScheduleFactsOf } from '@/features/members/components/member-schedule-source-card';
import { RotationSection } from '@/features/rotation/components/rotation-section';
import { SetupFirstRun, SetupPeopleSection, SetupTeamCard, SetupTypeStrip } from '@/features/setup/components/setup-parts';
import { SetupPickDialog } from '@/features/setup/components/setup-pick-dialog';
import { focusBack, useSetup } from '@/features/setup/hooks/use-setup';
import { ShiftTypeAddDialog } from '@/features/shift-types/components/shift-type-add-dialog';
import { ShiftTypeListSection } from '@/features/shift-types/components/shift-type-list-section';
import { useShiftTypeList, type ShiftTypeListScreen } from '@/features/shift-types/hooks/use-shift-type-list';
import { shiftTypeSavedMessageKey } from '@/features/shift-types/services/write';
import { TeamAddDialog } from '@/features/teams/components/team-add-dialog';
import { TeamEditDialog } from '@/features/teams/components/team-edit-dialog';
import { useTeamList } from '@/features/teams/hooks/use-team-list';
import { t } from '@/lib/i18n';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * THE ROTATION BUILDER IN A DIALOG (story 21.26): `/postavke-rotacije`'s own
 * `RotationSection` — the pattern, the anchor, each team's step, the preview,
 * *Vrijedi od*, the overrides under review, the erasure check and the save
 * bar — with the same shift type section beside it, mounted only while the
 * dialog is open. The draft lives in the builder's store, so closing and
 * opening again keeps it, as leaving that page does. Wide from 640 px; the
 * builder's own stepper below it.
 */
function RotationDialog({
  open,
  onClose,
  shiftTypes,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly shiftTypes: ShiftTypeListScreen;
}): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby="setup-rotation-heading"
      className="max-w-6xl"
    >
      {open ? (
        <RotationSection
          heading={
            <DialogHeader closeLabel={t('postaviRaspored.rotationDialog.close')} onClose={onClose} className="min-w-0 flex-1">
              <DialogTitle id="setup-rotation-heading">{t('postaviRaspored.rotationDialog.title')}</DialogTitle>
              <DialogDescription>{t('postaviRaspored.rotationDialog.lede')}</DialogDescription>
            </DialogHeader>
          }
          shiftTypes={<ShiftTypeListSection screen={shiftTypes} />}
        />
      ) : null}
    </Dialog>
  );
}

/** What the last member dialog ended with: saved, blocked by a scheduled change, or unreadable. */
function TaskOutcome({ outcome }: { readonly outcome: MemberDialogOutcome | null }): ReactNode {
  if (outcome === null) return null;

  const name = outcome.name ?? t('postaviRaspored.host.someone');

  return (
    <>
      {outcome.unavailable ? <Notice role="alert">{t('postaviRaspored.host.unavailable')}</Notice> : null}
      {outcome.blocked ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('postaviRaspored.host.scheduled', { name })}</Notice>
          <Button asChild variant="outline" className="h-11 w-full sm:w-auto sm:justify-self-start">
            <Link to="/ljudi/$id" params={{ id: outcome.memberId }}>
              {t('postaviRaspored.host.openMember', { name })}
            </Link>
          </Button>
        </div>
      ) : null}
      {outcome.saved ? <Notice role="status">{t('postaviRaspored.host.saved', { name })}</Notice> : null}
    </>
  );
}

/**
 * `Timovi i raspored` — a team, a shift and a person linked on one page
 * (story 21.26, UX-DR84; the founder's request of 2026-11-26): the compact
 * toolbar (21.23); *Prvi koraci* while the organization is not set up; the
 * *Tipovi smjena* strip; a card per active team; *Ljudi bez turnusa*.
 *
 * NOTHING HERE IS A NEW WRITE. Every change opens the dialog of the screen
 * that owns it, with that screen's rules, previews and erasure checks: the
 * shift type and team add dialogs (their lists' own hooks), the member
 * page's team dialog and *Raspored osobe* (`MemberDialogsHost`), the team
 * dialog (`TeamEditDialog`) and the rotation builder. *Posao* saves through
 * the member page's write (`MemberJobRolePicker`). This module composes; the
 * reads and the dialog state are `useSetup`, the parts' rules
 * `@/features/setup/services/setup`.
 *
 * LOADED ON FIRST VISIT: the router's first lazy component
 * (`pages/timovi-i-raspored.route.ts`), so the entry chunk keeps under the
 * precache cap. ADMIN ONLY: the route carries the shared admin guard.
 */
export function TimoviIRasporedScreen(): ReactNode {
  const teams = useTeamList();
  const shiftTypes = useShiftTypeList();
  const state = useSetup({ teams, shiftTypes, factsOf: memberScheduleFactsOf });
  const [outcome, setOutcome] = useState<MemberDialogOutcome | null>(null);
  const cards = state.cards;
  const list = shiftTypes.list;
  const typeName = useCallback(
    (id: string): string =>
      [...(list?.active ?? []), ...(list?.archived ?? [])].find((row) => row.type.id === id)?.type.name ??
      t('postaviRaspored.types.unknown'),
    [list],
  );
  const task = state.task;
  const { endTask } = state;
  const endHost = useCallback(
    (ended: MemberDialogOutcome) => {
      setOutcome(ended);
      endTask();
    },
    [endTask],
  );
  const typeSaved = shiftTypes.adding ? null : shiftTypes.saved;
  // *PRVI KORACI*' TWO ADDS: their step's button turns into *Gotovo* once the
  // add lands, so focus goes to the section the step filled, not to nothing.
  const addFocus = useRef<{ readonly opener: HTMLButtonElement | null; readonly fallbackId: string } | null>(null);
  const adding = shiftTypes.adding || teams.adding;

  useEffect(() => {
    if (adding || addFocus.current === null) return;
    const { opener, fallbackId } = addFocus.current;

    addFocus.current = null;
    focusBack(opener, fallbackId);
  }, [adding]);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={state.loading}>
      {/* STORY 21.23'S COMPACT TOOLBAR: the title, and the two adds at the right. */}
      <PageToolbar
        title={
          <PageTitle asChild>
            <h1>{t('nav.timoviIRaspored')}</h1>
          </PageTitle>
        }
        controls={
          <>
            <Button className="h-11" type="button" variant="outline" onClick={shiftTypes.openAdding}>
              <Plus aria-hidden />
              <ToolbarLabel>{t('postaviRaspored.types.add')}</ToolbarLabel>
            </Button>
            <Button className="h-11" type="button" onClick={teams.openAdding}>
              <Plus aria-hidden />
              <ToolbarLabel>{t('postaviRaspored.teams.add')}</ToolbarLabel>
            </Button>
          </>
        }
      />
      {/* WHAT THE LAST CHANGE SAID, under the toolbar. */}
      {teams.created ? <Notice role="status">{t('smjene.created')}</Notice> : null}
      {typeSaved === null ? null : <Notice role="status">{t(shiftTypeSavedMessageKey(typeSaved))}</Notice>}
      <TaskOutcome outcome={outcome} />
      {state.failed ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('postaviRaspored.failed')}</Notice>
          <Button
            ref={keepFocusOnAlert}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            onClick={state.retry}
          >
            {t('postaviRaspored.retry')}
          </Button>
        </div>
      ) : null}
      {state.loading ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.loading')}</p> : null}
      <SetupFirstRun
        steps={state.firstRun}
        actions={{
          types: (opener) => {
            addFocus.current = { opener, fallbackId: state.typesHeadingId };
            shiftTypes.openAdding();
          },
          team: (opener) => {
            addFocus.current = { opener, fallbackId: state.teamsHeadingId };
            teams.openAdding();
          },
          // THE FIRST TEAM'S *Dodaj člana*: the step is reached once a team exists.
          people: (opener) => {
            const first = cards?.[0];

            if (first !== undefined) state.openPick({ card: first, opener });
          },
          rotation: state.openRotation,
        }}
      />
      <SetupTypeStrip list={list} onAdd={shiftTypes.openAdding} />
      {cards === null ? null : (
        <section aria-labelledby={state.teamsHeadingId} className="grid min-w-0 gap-3">
          <h2 id={state.teamsHeadingId} tabIndex={-1} className="font-heading text-lg font-bold">
            {t('postaviRaspored.teams.heading')}
          </h2>
          {cards.length === 0 ? <p className="text-sm text-muted-foreground">{t('postaviRaspored.teams.empty')}</p> : null}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {cards.map((card) => (
              <SetupTeamCard
                key={card.team.id}
                card={card}
                onEdit={(opener) => {
                  state.openTeamEdit(card.team.id, opener);
                }}
                onAddMember={(opener) => {
                  state.openPick({ card, opener });
                }}
                onRemove={(memberId, opener) => {
                  setOutcome(null);
                  state.startTask(memberId, opener, { teamId: null, cardTeamId: card.team.id });
                }}
                onEditRotation={state.openRotation}
              />
            ))}
          </div>
        </section>
      )}
      <SetupPeopleSection
        groups={state.unrotated}
        summaryOf={(fact) => factText(fact, typeName)}
        role={(member) => <MemberJobRolePicker member={member} />}
        onSchedule={(memberId, opener) => {
          setOutcome(null);
          state.startTask(memberId, opener, null);
        }}
        onSet={
          state.members === null
            ? null
            : (opener) => {
                state.openPick({ card: null, opener });
              }
        }
      />
      <ShiftTypeAddDialog screen={shiftTypes} />
      <TeamAddDialog screen={teams} />
      <SetupPickDialog
        pick={state.pick}
        members={state.members}
        today={state.today}
        onClose={state.closePick}
        onPick={(pick, member) => {
          setOutcome(null);
          state.startTask(
            member.id,
            pick.opener,
            pick.card === null ? null : { teamId: pick.card.team.id, cardTeamId: pick.card.team.id },
          );
        }}
      />
      {task === null ? null : (
        <MemberDialogsHost
          key={task.serial}
          task={{ memberId: task.memberId, move: task.move }}
          opener={task.opener}
          onEnd={endHost}
        />
      )}
      {state.teamEdit === null ? null : (
        <TeamEditDialog key={state.teamEdit.id} id={state.teamEdit.id} onClose={state.closeTeamEdit} />
      )}
      <RotationDialog open={state.rotationOpen} onClose={state.closeRotation} shiftTypes={shiftTypes} />
    </main>
  );
}
