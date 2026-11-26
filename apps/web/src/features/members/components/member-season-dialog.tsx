import type { ReactNode, SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { MemberSeason } from '@/features/members/hooks/use-member-season';
import { deactivationClosedRangesText } from '@/features/members/services/deactivation-requests';
import { seasonRefusalMessageKey, seasonRowMessageKey } from '@/features/members/services/season';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import {
  MEMBER_SEASON_DIALOG_HEADING_ID,
  MEMBER_SEASON_END_ID,
  MEMBER_SEASON_ERASURES_ID,
  MEMBER_SEASON_ERROR_ID,
  MEMBER_SEASON_HINT_AND_ERROR,
  MEMBER_SEASON_HINT_ID,
  MEMBER_SEASON_PLAN_ID,
  MEMBER_SEASON_START_ID,
} from '@/features/members/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { NO_TEXT, shownDate } from '@/utils/text';

/**
 * *Sezona* (story 21.11; UX-DR76's *Sezona od–do* in the status card): *Od*
 * and *Do*, then — as they are entered — the status versions the season
 * writes, each a line (`Neaktivna od …`, `Aktivna od …`), and the member's
 * pending requests it closes. Its one *Spremi sezonu* runs the entry's
 * refusals, the last-admin rule and AD-5's erasure check, then the one
 * insert. Not dismissible while that is in flight; a refusal keeps it open
 * with the start focused when the dates are what to fix. The member's work in
 * the season is *Raspored osobe*'s, and the hint says so. Every rule is
 * `@/features/members/services/season`'s.
 */
export function MemberSeasonDialog({ season, name }: { readonly season: MemberSeason; readonly name: string }): ReactNode {
  const gate = useWriteGate();
  const { plan, refusal, pending, closedRequests, startField, endField } = season;
  const rows = plan !== null && plan.ok ? plan.rows : null;
  const described = refusal === null ? MEMBER_SEASON_HINT_ID : MEMBER_SEASON_HINT_AND_ERROR;

  return (
    <>
      <Dialog
        open={season.open}
        dismissible={!pending}
        onOpenChange={(next) => {
          if (!next) season.closeDialog();
        }}
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          if (!pending) season.closeDialog();
        }}
        aria-labelledby={MEMBER_SEASON_DIALOG_HEADING_ID}
      >
        {season.open ? (
          <>
            <DialogHeader closeLabel={t('ljudi.page.close')} onClose={season.closeDialog}>
              <DialogTitle id={MEMBER_SEASON_DIALOG_HEADING_ID}>{t('ljudi.season.heading')}</DialogTitle>
              <DialogDescription>{name}</DialogDescription>
            </DialogHeader>
            <form
              method="post"
              noValidate
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!gate.online) return;
                void season.save();
              }}
            >
              <p className="text-sm text-muted-foreground">{t('ljudi.season.lede')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={MEMBER_SEASON_START_ID}>{t('ljudi.season.start')}</Label>
                  <Input
                    ref={startField}
                    id={MEMBER_SEASON_START_ID}
                    name="start"
                    type="date"
                    required
                    min={season.earliest ?? undefined}
                    value={season.start}
                    readOnly={pending}
                    onChange={(event) => {
                      season.enterStart(event.currentTarget.value);
                    }}
                    aria-describedby={described}
                    className="h-11"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={MEMBER_SEASON_END_ID}>{t('ljudi.season.end')}</Label>
                  <Input
                    ref={endField}
                    id={MEMBER_SEASON_END_ID}
                    name="end"
                    type="date"
                    required
                    min={season.start === NO_TEXT ? (season.earliest ?? undefined) : season.start}
                    value={season.end}
                    readOnly={pending}
                    onChange={(event) => {
                      season.enterEnd(event.currentTarget.value);
                    }}
                    aria-describedby={described}
                    className="h-11"
                  />
                </div>
              </div>
              <p id={MEMBER_SEASON_HINT_ID} className="text-sm text-muted-foreground">
                {t('ljudi.season.hint', { date: shownDate(season.earliest ?? NO_TEXT) })}
              </p>
              {/* WHAT IS WRITTEN, as it is entered: a polite live region, plain weight. */}
              <output id={MEMBER_SEASON_PLAN_ID} aria-live="polite" className="grid gap-2 text-sm">
                {rows === null ? null : (
                  <>
                    <span className="font-medium">{t('ljudi.season.planHeading')}</span>
                    <ul className="grid gap-1">
                      {rows.map((row) => (
                        <li key={row.effectiveFrom}>{t(seasonRowMessageKey(row), { date: shownDate(row.effectiveFrom) })}</li>
                      ))}
                    </ul>
                    {closedRequests === null || closedRequests.length === 0 ? null : (
                      <span>
                        {t('ljudi.season.requests', {
                          count: closedRequests.length,
                          ranges: deactivationClosedRangesText(closedRequests, t),
                        })}
                      </span>
                    )}
                  </>
                )}
              </output>
              {refusal === null ? null : (
                <Notice id={MEMBER_SEASON_ERROR_ID} role="alert">
                  {t(seasonRefusalMessageKey(refusal))}
                </Notice>
              )}
              {season.unchecked ? <Notice role="alert">{t('ljudi.erasures.unavailable')}</Notice> : null}
              <OfflineWriteNote gate={gate} />
              <DialogFooter>
                <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={season.closeDialog}>
                  {t('ljudi.season.cancel')}
                </Button>
                <Button
                  ref={season.saveButton}
                  className="h-11 aria-disabled:opacity-50"
                  type="submit"
                  disabled={pending}
                  aria-disabled={gate.disabled}
                  aria-describedby={gate.describedBy()}
                  aria-busy={pending}
                >
                  {t('ljudi.season.save')}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </Dialog>
      <MemberSeasonErasures season={season} />
    </>
  );
}

/** THE SEASON'S ERASURE DIALOG (AD-5): the shared `ErasureDialog`, one row per conflict the season would erase. */
function MemberSeasonErasures({ season }: { readonly season: MemberSeason }): ReactNode {
  const gate = useWriteGate();
  const shown = season.erasures.shown;

  if (shown === null) return null;

  return (
    <ErasureDialog
      saveButton={season.erasuresSave}
      id={MEMBER_SEASON_ERASURES_ID}
      rows={shown.rows}
      changed={shown.changed}
      decisions={season.erasures.decisions}
      busy={season.pending}
      firstErasure={season.erasures.firstErasure}
      copy={memberErasureCopyOf(shown.rows, t('ljudi.season.save'))}
      scrollRows
      gate={gate}
      onDecide={season.erasures.decide}
      onBack={season.erasures.close}
      onSave={() => {
        void season.confirmErasures(shown);
      }}
    />
  );
}
