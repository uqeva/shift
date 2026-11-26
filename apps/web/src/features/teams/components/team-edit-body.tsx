import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { Users } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import { HolidayCheckBody, holidayErasureCopyOf } from '@/features/holidays/components/holiday-check-body';
import { ASK_FLAG, CHANGE_FLAG } from '@/features/holidays/services/holiday-check';
import { teamHolidayFlagMessageKey } from '@/features/holidays/services/write';
import {
  TEAM_OFF_ON_HOLIDAYS_ERASURES_ID,
  TEAM_OFF_ON_HOLIDAYS_HINT_ID,
  TEAM_OFF_ON_HOLIDAYS_ID,
  TEAM_OFF_ON_HOLIDAYS_PREVIEW_HEADING_ID,
  TEAM_OFF_ON_HOLIDAYS_STATUS_ID,
} from '@/features/teams/utils/element-ids';
import {
  TeamArchive,
  TeamArchiveConfirm,
  TeamArchiveRefusal,
} from '@/features/teams/components/team-archive';
import type { TeamEditScreen } from '@/features/teams/hooks/use-team-edit';
import type { TeamRow } from '@/features/teams/services/list';
import { teamFormKey } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { NAME_MAX_LENGTH } from '@/utils/name';

/**
 * The dialog's body: the team's rename form and its archive, an archived
 * team's name and note, or the skeleton while it is read.
 *
 * STORY 21.17: below the form, *Ne radi na blagdane*, on its own save: the
 * switch asks the check, and *Što se mijenja* replaces the form until its
 * *Spremi* or *Natrag*. An archived team states the setting, read-only.
 *
 * The helpers are declared inside the component, at its two-space
 * indentation, so the sign-in suite's scoped extraction reads each one.
 */
export function TeamEditBody({ screen }: { readonly screen: TeamEditScreen }): ReactNode {
  const { form, loading, renames, submit, confirming, nameField, setSaved, failure, archiveFailure, pending, flagChecked, flagSwitch } =
    screen;
  // STORY 8.3b: offline, the rename is gated and the note says why.
  const gate = useWriteGate();

  /** An archived team: frozen, so its name and a note, and nothing that writes. */
  function renderArchived(team: TeamRow): ReactNode {
    return (
      <div className="grid gap-2">
        <p className="break-words text-base font-medium">{team.name}</p>
        <p className="text-sm text-muted-foreground">{t('smjene.archivedNote')}</p>
        <p className="text-sm">{team.offOnHolidays ? t('smjene.offOnHolidays.archivedOn') : t('smjene.offOnHolidays.archivedOff')}</p>
      </div>
    );
  }

  /** *Ne radi na blagdane*: the switch, its hint, and what its last save or refusal said. */
  function renderFlag(team: TeamRow): ReactNode {
    const asked = screen.flagAsked;
    const value = asked !== null && asked.kind === ASK_FLAG ? asked.value : team.offOnHolidays;

    return (
      <div className="grid gap-2 border-t border-border pt-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor={TEAM_OFF_ON_HOLIDAYS_ID}>{t('smjene.offOnHolidays.label')}</Label>
          <Switch
            ref={flagSwitch}
            id={TEAM_OFF_ON_HOLIDAYS_ID}
            checked={value}
            disabled={pending}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy(TEAM_OFF_ON_HOLIDAYS_HINT_ID)}
            onCheckedChange={(next) => {
              if (!gate.online) return;
              void screen.askFlag(team, next);
            }}
          />
        </div>
        <p id={TEAM_OFF_ON_HOLIDAYS_HINT_ID} className="text-sm text-muted-foreground">
          {t('smjene.offOnHolidays.hint')}
        </p>
        {screen.flagFailure === null ? null : <Notice role="alert">{t(teamHolidayFlagMessageKey(screen.flagFailure))}</Notice>}
        {screen.flagSaved === null ? null : (
          <Notice id={TEAM_OFF_ON_HOLIDAYS_STATUS_ID} role="status">
            {screen.flagSaved ? t('smjene.offOnHolidays.savedOn') : t('smjene.offOnHolidays.savedOff')}
          </Notice>
        )}
      </div>
    );
  }

  /** The flag's *Što se mijenja*, in place of the form. */
  function renderFlagPreview(team: TeamRow): ReactNode {
    const checked = flagChecked;

    if (checked === null) return null;

    const on = checked.change.kind === CHANGE_FLAG && checked.change.value;

    return (
      <section aria-labelledby={TEAM_OFF_ON_HOLIDAYS_PREVIEW_HEADING_ID} className="grid gap-4">
        <div className="grid gap-1">
          <h3 id={TEAM_OFF_ON_HOLIDAYS_PREVIEW_HEADING_ID} className="text-base font-medium">
            {t('smjene.offOnHolidays.preview.title')}
          </h3>
          <p className="text-sm">
            {on ? t('smjene.offOnHolidays.preview.ledeOn', { team: team.name }) : t('smjene.offOnHolidays.preview.ledeOff', { team: team.name })}
          </p>
        </div>
        <div className="grid max-h-[50svh] gap-4 overflow-y-auto">
          {screen.flagChangedAgain ? <Notice role="status">{t('organization.holidays.preview.changed')}</Notice> : null}
          {checked.dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('smjene.offOnHolidays.preview.noHolidays')}</p>
          ) : (
            <HolidayCheckBody checked={checked} />
          )}
        </div>
        <OfflineWriteNote gate={gate} />
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={screen.closeFlagPreview}>
            {t('smjene.offOnHolidays.preview.back')}
          </Button>
          <Button
            className="h-11 aria-disabled:opacity-50"
            type="button"
            disabled={pending}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            aria-busy={pending}
            onClick={() => {
              if (!gate.online) return;
              void screen.confirmFlag();
            }}
          >
            {t('smjene.offOnHolidays.preview.save')}
          </Button>
        </DialogFooter>
      </section>
    );
  }

  function renderTeam(team: TeamRow): ReactNode {
    if (team.archived) return renderArchived(team);

    return (
      <>
        {/* HIDDEN, NOT UNMOUNTED, while the archive is asked about: a
            cancelled archive returns to the form with what was typed. */}
        <form
          key={teamFormKey(team, renames)}
          method="post"
          noValidate
          onSubmit={(event) => {
            if (!gate.online) {
              event.preventDefault();
              return;
            }
            void submit(event, team);
          }}
          className={confirming || flagChecked !== null ? 'hidden' : 'grid gap-5'}
        >
          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('smjene.name')}</Label>
            <InputGroup>
              <InputGroupIcon>
                <Users />
              </InputGroupIcon>
              <Input
                ref={nameField}
                id="team-name"
                name="name"
                maxLength={NAME_MAX_LENGTH}
                type="text"
                required
                defaultValue={team.name}
                onChange={() => {
                  // A confirmation describes the last save, not what is typed now.
                  setSaved(null);
                }}
                aria-invalid={failure !== null}
                aria-describedby={failure === null ? undefined : 'team-form-error'}
                className="h-11"
              />
            </InputGroup>
          </div>
          <TeamArchiveRefusal archiveFailure={archiveFailure} />
          {/* THE TWO DECISIONS TOGETHER, at the right: archive, then save.
              Neutral, never `destructive`, which UX-DR4 keeps for conflicts.
              The dialog's close is the way back. */}
          <OfflineWriteNote gate={gate} />
          <DialogFooter>
            <TeamArchive screen={screen} team={team} />
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="submit"
              disabled={pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              aria-busy={pending}
            >
              {t('smjene.save')}
            </Button>
          </DialogFooter>
        </form>
        {confirming ? <TeamArchiveConfirm screen={screen} team={team} /> : null}
        {confirming || flagChecked !== null ? null : renderFlag(team)}
        {flagChecked === null ? null : renderFlagPreview(team)}
      </>
    );
  }

  if (form.team !== null) return renderTeam(form.team);

  return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
}

/**
 * THE FLAG'S ERASURE CONFIRMATION (AD-5, story 21.17): the shared
 * `ErasureDialog`, one row per conflict the flag would erase, drawn beside the
 * team's dialog (the page renders it) so it stacks above it.
 */
export function TeamHolidayFlagErasures({ screen }: { readonly screen: TeamEditScreen }): ReactNode {
  const gate = useWriteGate();
  const shown = screen.flagErasures.shown;
  const team = screen.form.team;

  if (shown === null || team === null) return null;

  return (
    <ErasureDialog
      id={TEAM_OFF_ON_HOLIDAYS_ERASURES_ID}
      rows={shown.rows}
      changed={shown.changed}
      decisions={screen.flagErasures.decisions}
      busy={screen.pending}
      firstErasure={screen.flagErasures.firstErasure}
      copy={holidayErasureCopyOf(shown.rows, t('smjene.offOnHolidays.preview.save'))}
      scrollRows
      gate={gate}
      onDecide={screen.flagErasures.decide}
      onBack={screen.closeFlagErasures}
      onSave={() => {
        void screen.confirmFlagErasures(shown);
      }}
    />
  );
}
