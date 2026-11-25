import type { ReactNode } from 'react';

import { ToolbarMenu } from '@/components/page-toolbar';
import { Button } from '@/components/ui/button';
import { DownloadSimple } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import type { useHistoryExport } from '@/features/history/hooks/use-history-export';
import { t } from '@/lib/i18n';

/** The export's state, shared by the toolbar's menu and the notices under it. */
export type HistoryExporting = ReturnType<typeof useHistoryExport>;

/**
 * *Povijest promjena*'s one export (story 14.3) in the compact toolbar's
 * `Izvoz ▾` (story 21.23), as the hours table's (`OrganizationHoursExport`):
 * the menu holds one action that downloads exactly the rows shown as a PDF —
 * closed (`disabled`) when no row is shown, inert but focusable
 * (`aria-disabled`) while the file is built, so the menu stays open on it and
 * it keeps the focus. `Izvoz` says it is busy meanwhile. It is drawn only in
 * the ready state of the admin-guarded page, so a member-role viewer never
 * has it.
 */
export function HistoryExportMenu({ exporting }: { readonly exporting: HistoryExporting }): ReactNode {
  const { empty, disabled, labelKey, pending, start } = exporting;

  return (
    <ToolbarMenu
      label={t('toolbar.export')}
      icon={<DownloadSimple aria-hidden />}
      menuLabel={t('toolbar.exportMenu')}
      busy={pending}
      menu={() => (
        // Building keeps the focus: `aria-disabled`, the press refused by the hook.
        <Button
          type="button"
          variant="ghost"
          className="h-11 justify-start gap-2 px-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          disabled={empty}
          aria-disabled={disabled}
          aria-busy={pending}
          onClick={start}
        >
          {t(labelKey)}
        </Button>
      )}
    />
  );
}

/**
 * Under the toolbar, the export's outcome (story 14.3): the line a failed
 * build shows, the refusal of more changes than one file takes (epic 14 retro
 * A9) and, after a download, a status line naming the file and its changes.
 */
export function HistoryExportNotices({ exporting }: { readonly exporting: HistoryExporting }): ReactNode {
  const { failed, refused, written } = exporting;

  if (refused === null && !failed && written === null) return null;

  return (
    <div className="grid min-w-0 justify-items-start gap-3">
      {refused === null ? null : <Notice role="alert">{t('history.export.tooLarge', refused)}</Notice>}
      {failed ? <Notice role="alert">{t('history.export.failed')}</Notice> : null}
      {written === null ? null : <Notice role="status">{t('history.export.done', written)}</Notice>}
    </div>
  );
}
