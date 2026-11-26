import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { LeaveCoverState } from '@/features/conflicts/hooks/use-leave-cover';
import { NO_CANDIDATE } from '@/features/conflicts/services/resolution-screen';
import {
  COVER_MODEL_LOADING,
  COVER_MODEL_NONE,
  COVER_MODEL_READY,
  COVER_MODEL_UNAVAILABLE,
  LEAVE_COVER_DATES_ID,
  LEAVE_COVER_ERASURES_ID,
  LEAVE_COVER_FLOATERS_ID,
  LEAVE_COVER_HEADING_ID,
  LEAVE_COVER_PICK_DESCRIBED_BY,
  LEAVE_COVER_SUMMARY_ID,
  leaveCoverFailureLineOf,
  leaveCoverNoneMessageKey,
  leaveCoverReasonMessageKey,
  leaveCoverRefusalMessageKey,
  type LeaveCoverFloater,
} from '@/features/conflicts/services/leave-cover';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import { ManualPreviewBody } from '@/features/planning/components/manual-preview-dialog';
import { manualDateValuesOf } from '@/features/planning/services/manual-preview';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/** One floater's dates: each covered, or left open with its reason. */
function CoverDates({ floater }: { readonly floater: LeaveCoverFloater }): ReactNode {
  return (
    <ul id={LEAVE_COVER_DATES_ID} className="grid min-w-0 gap-1 text-sm">
      {floater.dates.map((date) => (
        <li key={date.key} className="flex min-w-0 flex-wrap gap-x-2">
          <span className="break-words">
            {t('zaOdluku.cover.date', {
              ...manualDateValuesOf(date.collision.date),
              type: date.typeName,
              team: date.teamName ?? t('kalendar.cell.noTeam'),
            })}
          </span>
          <span className={date.covered ? 'break-words font-medium' : 'break-words text-muted-foreground'}>
            {t(leaveCoverReasonMessageKey(date.reason))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The lines a refused check or write leaves in the dialog, and a landed cover the queue could not be reached with. */
function CoverLines({ cover }: { readonly cover: LeaveCoverState }): ReactNode {
  const failure = cover.failure === null ? null : leaveCoverFailureLineOf(cover.failure, cover.taken);
  const landed = cover.landed;

  return (
    <>
      {landed === null ? null : (
        <Notice role="status">
          {t('zaOdluku.savedCover', { member: landed.memberName, replacement: landed.replacementName, count: landed.days })}
        </Notice>
      )}
      {cover.refusal === null ? null : <Notice role="alert">{t(leaveCoverRefusalMessageKey(cover.refusal))}</Notice>}
      {failure === null ? null : (
        <Notice role="alert">{failure.values === undefined ? t(failure.key) : t(failure.key, failure.values)}</Notice>
      )}
      {cover.unchecked ? <Notice role="alert">{t('zaOdluku.cover.unchecked')}</Notice> : null}
    </>
  );
}

/** The first step: the floaters offered, and the picked one's dates. */
function CoverPick({ cover, withdrawn }: { readonly cover: LeaveCoverState; readonly withdrawn: boolean }): ReactNode {
  const gate = useWriteGate();
  const { model, floater } = cover;
  const waiting = floater === null || floater.covered === 0 || cover.landed !== null || withdrawn;

  return (
    <>
      <DialogHeader closeLabel={t('zaOdluku.cover.close')} onClose={cover.close}>
        <DialogTitle id={LEAVE_COVER_HEADING_ID}>{t('zaOdluku.cover.title')}</DialogTitle>
        {model.kind === COVER_MODEL_READY ? (
          <DialogDescription>
            {t('zaOdluku.cover.lede', { member: model.view.absentName, count: model.view.dateCount })}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="grid max-h-[60svh] min-w-0 gap-4 overflow-y-auto">
        {/* A refetch took the last eligible floater away while the dialog is open: said, never unmounted mid-check. */}
        {withdrawn ? <Notice role="status">{t('zaOdluku.cover.withdrawn')}</Notice> : null}
        {model.kind === COVER_MODEL_LOADING ? <p className="text-sm text-muted-foreground">{t('zaOdluku.cover.loading')}</p> : null}
        {model.kind === COVER_MODEL_UNAVAILABLE ? <Notice role="alert">{t('zaOdluku.cover.unavailable')}</Notice> : null}
        {model.kind === COVER_MODEL_NONE ? <p className="text-sm text-muted-foreground">{t('zaOdluku.cover.noFloatersAny')}</p> : null}
        {model.kind === COVER_MODEL_READY && model.view.floaters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(leaveCoverNoneMessageKey(model.view.roleName), { posao: model.view.roleName ?? undefined })}
          </p>
        ) : null}
        {model.kind === COVER_MODEL_READY && model.view.floaters.length !== 0 ? (
          <section className="grid min-w-0 gap-2" aria-labelledby={LEAVE_COVER_FLOATERS_ID}>
            <h3 id={LEAVE_COVER_FLOATERS_ID} className="text-sm font-semibold">
              {t('zaOdluku.cover.floaters')}
            </h3>
            <RadioGroup
              aria-labelledby={LEAVE_COVER_FLOATERS_ID}
              aria-describedby={floater === null ? undefined : LEAVE_COVER_PICK_DESCRIBED_BY}
              value={cover.picked ?? NO_CANDIDATE}
              onValueChange={cover.pick}
              disabled={cover.pending}
              className="gap-1"
            >
              {model.view.floaters.map((one) => (
                <RadioRow key={one.id} value={one.id}>
                  {t('zaOdluku.cover.floaterLine', { name: one.name, covered: one.covered, total: model.view.dateCount })}
                </RadioRow>
              ))}
            </RadioGroup>
          </section>
        ) : null}
        {/* THE PICK'S RESULT, announced politely: how many dates the floater covers. */}
        <p id={LEAVE_COVER_SUMMARY_ID} aria-live="polite" className="text-sm font-medium">
          {floater === null || model.kind !== COVER_MODEL_READY
            ? null
            : t('zaOdluku.cover.floaterLine', { name: floater.name, covered: floater.covered, total: model.view.dateCount })}
        </p>
        {floater === null ? null : <CoverDates floater={floater} />}
        {floater !== null && floater.covered === 0 ? (
          <p className="text-sm text-muted-foreground">{t('zaOdluku.cover.noneCovered', { name: floater.name })}</p>
        ) : null}
        <CoverLines cover={cover} />
      </div>
      <OfflineWriteNote gate={gate} />
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={cover.pending} onClick={cover.close}>
          {t('zaOdluku.cover.cancel')}
        </Button>
        <Button
          ref={cover.checkButton}
          className="h-11 aria-disabled:opacity-50"
          type="button"
          aria-disabled={gate.disabled || waiting || cover.pending}
          aria-describedby={gate.describedBy()}
          aria-busy={cover.pending}
          onClick={() => {
            if (!gate.online || waiting) return;
            void cover.check();
          }}
        >
          {t('zaOdluku.cover.check')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The second step: *Što se mijenja* for the cover, and its *Spremi*. */
function CoverPreview({ cover }: { readonly cover: LeaveCoverState }): ReactNode {
  const gate = useWriteGate();
  const checked = cover.checked;

  if (checked === null) return null;

  return (
    <>
      <DialogHeader closeLabel={t('zaOdluku.cover.close')} onClose={cover.close}>
        <DialogTitle id={LEAVE_COVER_HEADING_ID}>{t('zaOdluku.cover.previewTitle')}</DialogTitle>
        <DialogDescription>
          {t('zaOdluku.cover.previewLede', { name: checked.floater.name, count: checked.items.length })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[60svh] min-w-0 gap-4 overflow-y-auto">
        {cover.changed ? <Notice role="status">{t('zaOdluku.cover.changed')}</Notice> : null}
        <CoverDates floater={checked.floater} />
        <ManualPreviewBody preview={checked.preview} />
        <ShortStaffedBlock report={checked.shortStaffed} />
        {checked.rows.length === 0 ? null : (
          <p className="text-sm font-medium">{t('zaOdluku.cover.erasures', { count: checked.rows.length })}</p>
        )}
        <CoverLines cover={cover} />
      </div>
      <OfflineWriteNote gate={gate} />
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={cover.pending} onClick={cover.back}>
          {t('zaOdluku.cover.back')}
        </Button>
        <Button
          ref={cover.confirmButton}
          className="h-11 aria-disabled:opacity-50"
          type="button"
          aria-disabled={gate.disabled || cover.pending}
          aria-describedby={gate.describedBy()}
          aria-busy={cover.pending}
          onClick={() => {
            if (!gate.online || cover.pending) return;
            void cover.confirm();
          }}
        >
          {t('zaOdluku.cover.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * *POKRIJ CIJELO ODSUSTVO* (story 21.14; R16.4, UX-DR77): the floaters
 * offered for the leave record, each with how many of its unresolved dates
 * they cover; the picked one's dates, covered or left open with the reason;
 * then *Provjeri*'s *Što se mijenja* (the grid's body, the short-staffed
 * block and the erasures' count) and its *Spremi*, which writes the covered
 * dates in one call. Erasures open the shared confirmation, the one thing
 * that waits. Opened on a press, never on mount; not dismissible while a
 * check or write is in flight.
 */
export function LeaveCoverDialog({
  cover,
  withdrawn,
}: {
  readonly cover: LeaveCoverState;
  /** The screen no longer offers the cover (a refetch took the last eligible floater away). */
  readonly withdrawn: boolean;
}): ReactNode {
  const gate = useWriteGate();
  const shown = cover.erasures.shown;

  return (
    <>
      <Dialog
        open={cover.open && shown === null}
        dismissible={!cover.pending}
        onOpenChange={(next) => {
          if (!next) cover.close();
        }}
        aria-labelledby={LEAVE_COVER_HEADING_ID}
      >
        {!cover.open ? null : cover.checked === null ? <CoverPick cover={cover} withdrawn={withdrawn} /> : <CoverPreview cover={cover} />}
      </Dialog>
      {shown === null ? null : (
        <ErasureDialog
          id={LEAVE_COVER_ERASURES_ID}
          rows={shown.rows}
          changed={shown.changed}
          decisions={cover.erasures.decisions}
          busy={cover.pending}
          firstErasure={cover.erasures.firstErasure}
          copy={memberErasureCopyOf(shown.rows, t('zaOdluku.cover.save'))}
          scrollRows
          gate={gate}
          onDecide={cover.erasures.decide}
          onBack={cover.erasures.close}
          onSave={() => {
            void cover.confirmErasures(shown);
          }}
        />
      )}
    </>
  );
}
