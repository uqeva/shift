import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { SHORT_STAFFED_UNKNOWN } from '@/features/staffing/services/short-staffed';
import { useTeamMinimum } from '@/features/teams/hooks/use-team-minimum';
import type { TeamRow } from '@/features/teams/services/list';
import { teamMinimumMessageKey, teamMinimumWindowFromOf, type ClearedReport } from '@/features/teams/services/minimum';
import {
  TEAM_MINIMUM_ERROR_ID,
  TEAM_MINIMUM_HINT_ID,
  TEAM_MINIMUM_ID,
  TEAM_MINIMUM_PREVIEW_HEADING_ID,
  TEAM_MINIMUM_STATUS_ID,
} from '@/features/teams/utils/element-ids';
import { t } from '@/lib/i18n';
import type { WriteGate } from '@/lib/offline/use-write-gate';

/**
 * *NAJMANJE LJUDI* (story 21.20, UX-DR79): the team dialog's own minimum,
 * below the rename form and the holiday flag, on its own save. Empty means
 * the organization's, which the hint names. A change that creates or clears
 * a short-staffed shift shows *Što se mijenja* in place of the field (the form
 * stays mounted, hidden, so *Natrag* returns to what was typed): the
 * shifts it makes short (the shared short-staffed block) and the ones it
 * clears, from today over a year, with the note that past dates change too.
 * Nothing here blocks on a short-staffed shift (R10.4).
 *
 * `hidden`: the dialog's other preview, or the archive's question, is shown;
 * the part stays mounted, so what was typed survives.
 *
 * `gate`: the edit body's own write gate, so the one offline note the rename
 * form draws above describes these saves too — never a second note (and a
 * second id) in the one dialog.
 */
export function TeamMinimum({
  team,
  hidden,
  gate,
}: {
  readonly team: TeamRow;
  readonly hidden: boolean;
  readonly gate: WriteGate;
}): ReactNode {
  const screen = useTeamMinimum();
  const { checked, pending, failure, saved } = screen;

  /** The hint: empty is the organization's minimum, named when it is known. */
  function hint(): string {
    const organization = screen.organizationMinimum;

    if (organization === undefined) return t('smjene.minimum.hintUnknown');
    if (organization === null) return t('smjene.minimum.hintNotSet');

    return t('smjene.minimum.hint', { n: organization });
  }

  /** The cleared shifts: a list, or the neutral line when the short-staffed block does not already say it. */
  function renderCleared(cleared: ClearedReport | null, shortUnknown: boolean): ReactNode {
    if (cleared === null) return null;
    if (cleared.kind === SHORT_STAFFED_UNKNOWN) {
      return shortUnknown ? null : <span className="block text-sm">{t('popunjenost.unknown')}</span>;
    }
    if (cleared.rows.length === 0) return null;

    return (
      <section className="grid min-w-0 gap-1 rounded-md border border-border bg-muted p-3 text-sm text-foreground">
        <h4 className="font-medium">{t('smjene.minimum.preview.clearedHeading')}</h4>
        <ul className="grid gap-1">
          {cleared.rows.map((row) => (
            <li key={row.key} className="min-w-0 break-words tabular-nums">
              {t('smjene.minimum.preview.clearedRow', { team: row.teamName, date: row.dayMonth, type: row.shiftTypeName })}
            </li>
          ))}
        </ul>
        {cleared.more === 0 ? null : <p className="tabular-nums">{t('popunjenost.more', { count: cleared.more })}</p>}
      </section>
    );
  }

  function renderPreview(): ReactNode {
    if (checked === null) return null;

    const { value } = checked.change;

    return (
      <section aria-labelledby={TEAM_MINIMUM_PREVIEW_HEADING_ID} className={hidden ? 'hidden' : 'grid gap-4 border-t border-border pt-4'}>
        <div className="grid gap-1">
          <h3 id={TEAM_MINIMUM_PREVIEW_HEADING_ID} tabIndex={-1} className="text-base font-medium">
            {t('smjene.minimum.preview.title')}
          </h3>
          <p className="text-sm">
            {value === null
              ? t('smjene.minimum.preview.ledeNotSet', { team: team.name })
              : t('smjene.minimum.preview.lede', { team: team.name, count: value })}
          </p>
          <p className="text-sm text-muted-foreground">{t('smjene.minimum.preview.window', { date: teamMinimumWindowFromOf(checked) })}</p>
        </div>
        <div className="grid max-h-[50svh] gap-4 overflow-y-auto">
          {screen.changedAgain ? <Notice role="status">{t('smjene.minimum.preview.changed')}</Notice> : null}
          <ShortStaffedBlock report={checked.shortStaffed} />
          {renderCleared(checked.cleared, checked.shortStaffed?.kind === SHORT_STAFFED_UNKNOWN)}
        </div>
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={screen.closeMinimumPreview}>
            {t('smjene.minimum.preview.back')}
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
              void screen.confirmMinimum();
            }}
          >
            {t('smjene.minimum.preview.save')}
          </Button>
        </DialogFooter>
      </section>
    );
  }

  return (
    <>
      {renderPreview()}
    <form
      key={screen.saves}
      method="post"
      noValidate
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void screen.submitMinimum(event, team);
      }}
      className={hidden || checked !== null ? 'hidden' : 'grid gap-2 border-t border-border pt-4'}
    >
      <Label htmlFor={TEAM_MINIMUM_ID}>{t('smjene.minimum.label')}</Label>
      {/* NOT VALIDATED BY THE BROWSER, as the organization's field: an entry that is no whole number
          from 1 is refused by the hook, named, and the field marked. Empty is a value. */}
      <Input
        ref={screen.field}
        id={TEAM_MINIMUM_ID}
        name="minimum"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={(screen.stored === null ? team.minimumMembers : screen.stored.value) ?? undefined}
        onChange={screen.editedMinimum}
        disabled={pending}
        aria-invalid={failure !== null}
        aria-describedby={[TEAM_MINIMUM_HINT_ID, failure === null ? null : TEAM_MINIMUM_ERROR_ID, saved === null ? null : TEAM_MINIMUM_STATUS_ID]
          .filter((id) => id !== null)
          .join(' ')}
        className="h-11"
      />
      <p id={TEAM_MINIMUM_HINT_ID} className="text-sm text-muted-foreground">
        {hint()}
      </p>
      {failure === null ? null : (
        <Notice id={TEAM_MINIMUM_ERROR_ID} role="alert">
          {t(teamMinimumMessageKey(failure))}
        </Notice>
      )}
      {saved === null ? null : (
        <Notice id={TEAM_MINIMUM_STATUS_ID} role="status">
          {saved.value === null ? t('smjene.minimum.savedNotSet') : t('smjene.minimum.saved', { count: saved.value })}
        </Notice>
      )}
      <div className="flex justify-end">
        <Button
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          variant="outline"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          {t('smjene.minimum.save')}
        </Button>
      </div>
    </form>
    </>
  );
}

/** An archived team's minimum, read-only. */
export function TeamMinimumArchived({ team }: { readonly team: TeamRow }): ReactNode {
  return (
    <p className="text-sm">
      {team.minimumMembers === null ? t('smjene.minimum.archivedNotSet') : t('smjene.minimum.archived', { count: team.minimumMembers })}
    </p>
  );
}
