import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { ManualScreen } from '@/features/planning/hooks/use-manual-schedule';
import { manualRefusalMessageKey } from '@/features/planning/services/manual-save';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * THE SAVE BAR (story 21.4; UX-DR72): sticky at the bottom of the page — on a
 * phone above the floating tab bar — with the draft's change count, *Odbaci*
 * and *Spremi*. Its line is a polite live region: the count, then what a
 * landed save wrote. A refusal or an unchecked save is an alert under it,
 * the unchecked one with *Provjeri ponovno*.
 */
export function ManualSaveBar({ screen }: { readonly screen: ManualScreen }): ReactNode {
  const gate = useWriteGate();
  const count = screen.draft.size;

  return (
    <div className="sticky bottom-[calc(4.75rem+2px+env(safe-area-inset-bottom,0px))] z-30 grid gap-2 border-t bg-card px-4 py-3 sm:bottom-0">
      <div className="flex flex-wrap items-center gap-3">
        <p aria-live="polite" className="min-w-0 flex-1 text-sm">
          {count > 0
            ? t('rucniRaspored.bar.count', { count })
            : screen.saved === null
              ? t('rucniRaspored.bar.none')
              : t('rucniRaspored.bar.saved', { count: screen.saved })}
        </p>
        <Button className="h-11" type="button" variant="outline" disabled={count === 0 || screen.pending} onClick={screen.discard}>
          {t('rucniRaspored.bar.discard')}
        </Button>
        <Button
          ref={screen.saveButton}
          className="h-11 aria-disabled:opacity-50"
          type="button"
          disabled={count === 0 || screen.pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={screen.pending}
          onClick={() => {
            if (!gate.online) return;
            void screen.save();
          }}
        >
          {t('rucniRaspored.bar.save')}
        </Button>
      </div>
      {screen.refusal === null ? null : <Notice role="alert">{t(manualRefusalMessageKey(screen.refusal))}</Notice>}
      {screen.unchecked ? (
        <Notice role="alert">
          {t('rucniRaspored.unchecked')}
          <Button
            ref={screen.retryButton}
            className="mt-3 flex h-11 aria-disabled:opacity-50"
            type="button"
            variant="outline"
            disabled={screen.pending}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            onClick={() => {
              if (!gate.online) return;
              void screen.save();
            }}
          >
            {t('rucniRaspored.retryCheck')}
          </Button>
        </Notice>
      ) : null}
      <OfflineWriteNote gate={gate} />
    </div>
  );
}
