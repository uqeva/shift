import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import type { ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import {
  manualDateValuesOf,
  manualInertMessageKey,
  manualShiftMessageKey,
  type ManualMemberPreview,
  type ManualPreview,
} from '@/features/planning/services/manual-preview';
import { ERASURES_ID, PREVIEW_HEADING_ID } from '@/features/planning/utils/element-ids';
import { shiftTypeDurationMessageKey } from '@/features/shift-types/services/list';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { NO_TEXT } from '@/utils/text';
import { durationValuesOf } from '@/utils/time';

/** A shift as a double-booking line names it: the type and its team, or *bez tima*. */
function shiftText(shift: { readonly team: string | null; readonly type: string }): string {
  return shift.team === null
    ? t('rucniRaspored.preview.shiftNoTeam', { type: shift.type })
    : t('rucniRaspored.preview.shift', { type: shift.type, team: shift.team });
}

/** One member's block: the shifts lost and gained, then the warnings the save makes for them. */
function renderMember(block: ManualMemberPreview): ReactNode {
  return (
    <section key={block.memberId} className="grid gap-1 text-sm">
      <h3 className="font-medium">{block.name}</h3>
      {block.shifts.map((line) => (
        <p key={JSON.stringify([line.side, line.date, line.team, line.type])}>
          {t(manualShiftMessageKey(line), {
            type: line.type,
            team: line.team ?? NO_TEXT,
            range: line.range ?? NO_TEXT,
            ...manualDateValuesOf(line.date),
          })}
        </p>
      ))}
      {block.moreShifts === 0 ? null : <p>{t('rucniRaspored.preview.more', { count: block.moreShifts })}</p>}
      {block.doubles.map((line) => (
        <p key={line.key}>
          {t('rucniRaspored.preview.double', { first: shiftText(line.first), second: shiftText(line.second), ...manualDateValuesOf(line.date) })}
        </p>
      ))}
      {block.restGaps.map((line) => (
        <p key={line.key}>
          {t('rucniRaspored.preview.restGap', {
            duration: t(shiftTypeDurationMessageKey(line.totalMinutes), durationValuesOf(line.totalMinutes)),
            ...manualDateValuesOf(line.date),
          })}
        </p>
      ))}
      {block.teamless.map((line) => (
        <p key={line.key}>{t('rucniRaspored.preview.unlistedLeave', manualDateValuesOf(line.date))}</p>
      ))}
    </section>
  );
}

/** *Što se mijenja*'s body: a block per member, the roster changes left inapplicable, or the one line that nothing moves. */
function renderPreview(preview: ManualPreview): ReactNode {
  return (
    <div className="grid gap-4">
      {preview.members.length === 0 && preview.inert.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('rucniRaspored.preview.nothing')}</p>
      ) : null}
      {preview.members.map(renderMember)}
      {preview.inert.length === 0 ? null : (
        <section className="grid gap-1 text-sm">
          <h3 className="font-medium">{t('rucniRaspored.preview.inertHeading')}</h3>
          {preview.inert.map((line) => (
            <p key={line.key}>
              {t(manualInertMessageKey(line), {
                team: line.team,
                out: line.out === null ? NO_TEXT : (line.out.name ?? t('rucniRaspored.preview.unknownMember')),
                in: line.in === null ? NO_TEXT : (line.in.name ?? t('rucniRaspored.preview.unknownMember')),
                ...manualDateValuesOf(line.date),
              })}
            </p>
          ))}
          <p className="text-muted-foreground">{t('rucniRaspored.preview.inertNote')}</p>
        </section>
      )}
    </div>
  );
}

/**
 * *ŠTO SE MIJENJA* (story 21.4; AD-5 as amended): what the fresh check
 * derived for the draft — per member the shifts lost and gained, double
 * bookings, work with no rest and leave over a shift with no team; the
 * short-staffed block; the roster changes left inapplicable; and how many
 * conflicts the save erases. Nothing here blocks: its *Spremi* checks afresh
 * and writes, or opens the erasure confirmation (`ManualErasures`), which is
 * the one thing that waits. Not dismissible while a check or write is in flight.
 */
export function ManualPreviewDialog({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const gate = useWriteGate();
  const checked = screen.checked;

  return (
    <>
      <Dialog
        open={checked !== null}
        dismissible={!screen.pending}
        onOpenChange={(next) => {
          if (!next) screen.closePreview();
        }}
        aria-labelledby={PREVIEW_HEADING_ID}
      >
        {checked === null ? null : (
          <>
            <DialogHeader closeLabel={t('rucniRaspored.preview.close')} onClose={screen.closePreview}>
              <DialogTitle id={PREVIEW_HEADING_ID}>{t('rucniRaspored.preview.title')}</DialogTitle>
              <DialogDescription>{t('rucniRaspored.preview.lede', { count: checked.draft.size })}</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[60svh] gap-4 overflow-y-auto">
              {renderPreview(checked.preview)}
              <ShortStaffedBlock report={checked.shortStaffed} />
              {checked.rows.length === 0 ? null : (
                <p className="text-sm font-medium">{t('rucniRaspored.preview.erasures', { count: checked.rows.length })}</p>
              )}
            </div>
            <OfflineWriteNote gate={gate} />
            <DialogFooter>
              <Button className="h-11" type="button" variant="outline" disabled={screen.pending} onClick={screen.closePreview}>
                {t('rucniRaspored.preview.back')}
              </Button>
              <Button
                ref={screen.confirmButton}
                className="h-11 aria-disabled:opacity-50"
                type="button"
                disabled={screen.pending}
                aria-disabled={gate.disabled}
                aria-describedby={gate.describedBy()}
                aria-busy={screen.pending}
                onClick={() => {
                  if (!gate.online) return;
                  void screen.confirm();
                }}
              >
                {t('rucniRaspored.preview.save')}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
      <ManualErasures screen={screen} />
    </>
  );
}

/** THE SAVE'S ERASURE DIALOG (AD-5): the shared `ErasureDialog`, one row per conflict the save would erase. */
function ManualErasures({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const gate = useWriteGate();
  const shown = screen.erasures.shown;

  if (shown === null) return null;

  return (
    <ErasureDialog
      saveButton={screen.erasuresSave}
      id={ERASURES_ID}
      rows={shown.rows}
      changed={shown.changed}
      decisions={screen.erasures.decisions}
      busy={screen.pending}
      firstErasure={screen.erasures.firstErasure}
      copy={memberErasureCopyOf(shown.rows, t('rucniRaspored.confirm'))}
      scrollRows
      gate={gate}
      onDecide={screen.erasures.decide}
      onBack={screen.erasures.close}
      onSave={() => {
        void screen.confirmErasures(shown);
      }}
    />
  );
}
