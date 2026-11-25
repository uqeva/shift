import type { ReactNode } from 'react';

import { ToolbarMenu } from '@/components/page-toolbar';
import { Button } from '@/components/ui/button';
import { Check, DownloadSimple, Printer, Rows } from '@/components/ui/icon';
import { MODE_MOJ, MODE_SVE, type CalendarMode } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';

/**
 * The two modes (story 3.2a) as the toolbar's `Prikaz ▾` (story 21.23): a
 * menu holding one group named *Prikaz kalendara*, a 44 px row per mode. The
 * chosen mode is pressed (`aria-pressed`), filled from its own state and
 * marked with a check, so the fill and the state never disagree and the
 * difference is never colour alone. A pick closes the menu and puts focus
 * back on `Prikaz`.
 */
export function CalendarModeSwitch({
  chosen,
  onChoose,
}: {
  readonly chosen: CalendarMode;
  readonly onChoose: (prikaz: CalendarMode) => void;
}): ReactNode {
  return (
    <ToolbarMenu
      label={t('toolbar.view')}
      icon={<Rows aria-hidden />}
      menuLabel={t('toolbar.viewMenu')}
      menu={(done) => (
        <div role="group" aria-label={t('kalendar.mode.label')} className="grid gap-1">
          <Button
            type="button"
            variant="ghost"
            className="group h-11 justify-between gap-3 px-2 font-normal aria-pressed:bg-primary/10 aria-pressed:font-semibold"
            aria-pressed={chosen === MODE_MOJ}
            onClick={() => {
              done();
              onChoose(MODE_MOJ);
            }}
          >
            {t('kalendar.mode.moj')}
            <Check aria-hidden className="invisible group-aria-pressed:visible" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="group h-11 justify-between gap-3 px-2 font-normal aria-pressed:bg-primary/10 aria-pressed:font-semibold"
            aria-pressed={chosen === MODE_SVE}
            onClick={() => {
              done();
              onChoose(MODE_SVE);
            }}
          >
            {t('kalendar.mode.sve')}
            <Check aria-hidden className="invisible group-aria-pressed:visible" />
          </Button>
        </div>
      )}
    />
  );
}

/**
 * *Kalendar*'s `Izvoz ▾` (stories 16.1, 21.23): *Ispiši*, which closes the
 * menu, then opens the browser's own print dialog (`usePrintMonth`), where
 * the month is printed or saved as a PDF.
 */
export function CalendarExportMenu({ onPrint }: { readonly onPrint: () => void }): ReactNode {
  return (
    <ToolbarMenu
      label={t('toolbar.export')}
      icon={<DownloadSimple aria-hidden />}
      menuLabel={t('toolbar.exportMenu')}
      menu={(done) => (
        <Button
          className="h-11 justify-start gap-2 px-2 font-normal"
          type="button"
          variant="ghost"
          onClick={() => {
            done();
            onPrint();
          }}
        >
          <Printer aria-hidden className="size-4 shrink-0" />
          {t('print.action')}
        </Button>
      )}
    />
  );
}
