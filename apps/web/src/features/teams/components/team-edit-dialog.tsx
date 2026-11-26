import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { TeamEditBody, TeamHolidayFlagErasures } from '@/features/teams/components/team-edit-body';
import { useTeamEdit } from '@/features/teams/hooks/use-team-edit';
import { teamHeadingMessageKey, teamsMessageKey, teamsRetryMessageKey } from '@/features/teams/services/list';
import { teamSavedMessageKey, teamWriteMessageKey } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * THE TEAM DIALOG, OVER *TIMOVI I RASPORED* (story 21.26): `/ljudi/smjene/$id`'s
 * own dialog — `useTeamEdit` and `TeamEditBody`, so the rename, the archive,
 * *Ne radi na blagdane* with its check and erasures, and *Najmanje ljudi*
 * with its *Što se mijenja* are exactly that page's — opened here over this
 * page, and closed back to it rather than to the team list.
 */
export function TeamEditDialog({ id, onClose }: { readonly id: string; readonly onClose: () => void }): ReactNode {
  const screen = useTeamEdit(id, onClose);
  const { close, form, readRefusal, refusal, saved } = screen;

  return (
    <>
      <Dialog
        open={true}
        dismissible={!screen.pending}
        onOpenChange={(open) => {
          if (!open && !screen.pending) close();
        }}
        aria-labelledby="team-edit-dialog-heading"
      >
        <DialogHeader
          closeLabel={t('smjene.close')}
          onClose={() => {
            // NOT WHILE A WRITE OR THE FLAG'S CHECK IS OUT, as Escape and the backdrop.
            if (!screen.pending) close();
          }}
        >
          <DialogTitle id="team-edit-dialog-heading">{t(teamHeadingMessageKey(form.team))}</DialogTitle>
        </DialogHeader>
        {readRefusal === null ? null : (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t(teamsMessageKey(readRefusal))}</Notice>
            {screen.retryable ? (
              <Button
                ref={keepFocusOnAlert}
                className="h-11 w-full sm:w-auto sm:justify-self-start"
                type="button"
                variant="outline"
                onClick={screen.retry}
              >
                {t(teamsRetryMessageKey(readRefusal))}
              </Button>
            ) : null}
          </div>
        )}
        {refusal === null ? null : (
          <Notice id="team-form-error" role="alert">
            {t(teamWriteMessageKey(refusal))}
          </Notice>
        )}
        {saved === null ? null : <Notice role="status">{t(teamSavedMessageKey(saved))}</Notice>}
        <TeamEditBody screen={screen} />
      </Dialog>
      <TeamHolidayFlagErasures screen={screen} />
    </>
  );
}
