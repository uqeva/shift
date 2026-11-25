import { createRoute, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { MonthNav } from '@/components/month-nav';
import { PageToolbar } from '@/components/page-toolbar';
import { StickyHead } from '@/components/sticky-head';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageTitle } from '@/components/ui/page-header';
import { calendarMessageKey } from '@/features/calendar/services/snapshot';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { ManualCopyDialog } from '@/features/planning/components/manual-copy-dialog';
import { ManualFillDialog } from '@/features/planning/components/manual-fill-dialog';
import { ManualGrid } from '@/features/planning/components/manual-grid';
import { ManualMemberDays } from '@/features/planning/components/manual-member-days';
import { ManualPicker } from '@/features/planning/components/manual-picker';
import { ManualPlanButtons } from '@/features/planning/components/manual-plan-buttons';
import { ManualPreviewDialog } from '@/features/planning/components/manual-preview-dialog';
import { ManualSaveBar } from '@/features/planning/components/manual-save-bar';
import {
  MANUAL_HEADING_ID,
  manualSearchOf,
  useManualSchedule,
  type ManualNavigate,
  type ManualScreen,
  type ManualSearch,
} from '@/features/planning/hooks/use-manual-schedule';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * The grid's key (story 21.4): the letters the month uses and what every mark
 * says, and from 640 px how to select. The selection's action is the page
 * toolbar's (story 21.23's `PageToolbar`).
 */
function ManualLegend({ screen, isPhone }: { readonly screen: ManualScreen; readonly isPhone: boolean }): ReactNode {
  const shown = screen.shown;

  if (shown === null) return null;

  return (
    <div className="grid gap-2 px-4 pb-3 pt-4">
      {/* SELECTION IS THE GRID'S (from 640 px): a phone edits one date at a time. */}
      {isPhone ? null : <p className="text-sm text-muted-foreground">{t('rucniRaspored.selectionHint')}</p>}
      <ul aria-label={t('rucniRaspored.legend.heading')} className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {shown.legend.map((entry) => (
          <li key={entry.letter}>{t('rucniRaspored.legend.entry', { letter: entry.letter, name: entry.name })}</li>
        ))}
        <li>{t('rucniRaspored.legend.off', { mark: t('rucniRaspored.offMark') })}</li>
        <li>{t('rucniRaspored.legend.assigned')}</li>
        <li>{t('rucniRaspored.legend.rotation')}</li>
        <li>{t('rucniRaspored.legend.counted', { mark: t('rucniRaspored.countedMark') })}</li>
        <li>{t('rucniRaspored.legend.more')}</li>
        <li>{t('rucniRaspored.legend.inactive')}</li>
        <li>{t('rucniRaspored.legend.changed')}</li>
      </ul>
    </div>
  );
}

/** The month itself: loading, empty, the grid from 640 px, or one member's day list below it. */
function ManualBody({ screen, isPhone }: { readonly screen: ManualScreen; readonly isPhone: boolean }): ReactNode {
  const shown = screen.shown;

  if (screen.failed) {
    return (
      <Notice role="alert" className="mx-4 mb-4">
        {t('rucniRaspored.failedMonth')}
      </Notice>
    );
  }

  if (shown === null || shown.rows.length === 0) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        {shown === null ? t('rucniRaspored.loading') : t('rucniRaspored.empty')}
      </p>
    );
  }

  return isPhone ? <ManualMemberDays screen={screen} shown={shown} /> : <ManualGrid screen={screen} shown={shown} />;
}

/**
 * `Ručni raspored` — the month planned by hand (story 21.4; UX-DR71–UX-DR73;
 * R14; AD-26). People in rows, grouped by team, dates in columns; a cell or a
 * selection takes a shift type, *Slobodno* or *Očisti* in a draft, and one
 * *Spremi* shows *Što se mijenja* and writes the whole draft through 0077's
 * `save_personal_assignments`. This file composes the screen; the wiring is
 * `useManualSchedule`, every rule is in `features/planning/services`.
 *
 * ADMIN ONLY: the shared admin guard forwards a member; 0077 refuses any other
 * caller anyway. ONLINE ONLY for the save (the write gate).
 *
 * THE PAGE SCROLLS (UX-DR71): the grid has no vertical scroll container; it
 * is as wide as the full page allows (`max-w-none`), and only its own
 * scroller moves sideways. Below 640 px the month toolbar is the sticky head,
 * and the month is one member's day list.
 */
export function RucniRasporedScreen() {
  const search = rucniRasporedRoute.useSearch();
  const navigate = useNavigate({ from: rucniRasporedRoute.fullPath });
  const write: ManualNavigate = (next, options) => {
    void navigate({ search: next, replace: options?.replace ?? false });
  };
  const screen = useManualSchedule(search, write);
  const isPhone = usePhone();
  const refusal = screen.surface.refusal;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 p-6" aria-busy={screen.surface.loading}>
      {/* STORY 21.23'S COMPACT TOOLBAR: the title, the month control from 640 px,
          and the selection's one action at the right. */}
      <PageToolbar
        title={
          <PageTitle asChild>
            <h1>{t('nav.rucniRaspored')}</h1>
          </PageTitle>
        }
        lead={isPhone || refusal !== null ? undefined : <MonthNav month={screen.month} headingId={MANUAL_HEADING_ID} onShow={screen.show} />}
        controls={
          isPhone || refusal !== null ? undefined : (
            <>
              <ManualPlanButtons screen={screen} />
              <Button
                className="h-11"
                type="button"
                variant="outline"
                disabled={screen.selected.length === 0 || screen.pending}
                onClick={() => {
                  screen.openPicker(screen.selected);
                }}
              >
                {t('rucniRaspored.edit', { count: screen.selected.length })}
              </Button>
            </>
          )
        }
      />
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(calendarMessageKey(refusal))}</Notice>
          <Button
            ref={keepFocusOnAlert}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            onClick={screen.retry}
          >
            {t('rucniRaspored.retry')}
          </Button>
        </div>
      )}
      {/* STORY 21.6: *Dodaj smjenu* named a member with no row that month. */}
      {screen.noRow ? <Notice role="alert">{t('rucniRaspored.addShift.noRow')}</Notice> : null}
      {refusal !== null ? null : (
        <Card className="min-w-0">
          {isPhone ? (
            <StickyHead>
              <div className="flex min-w-0 items-center gap-2 px-4 py-2">
                <MonthNav month={screen.month} headingId={MANUAL_HEADING_ID} onShow={screen.show} />
              </div>
            </StickyHead>
          ) : null}
          {isPhone && screen.shown !== null && screen.shown.rows.length !== 0 ? (
            <div className="flex flex-wrap gap-2 px-4 pt-4">
              <ManualPlanButtons screen={screen} />
            </div>
          ) : null}
          <ManualLegend screen={screen} isPhone={isPhone} />
          <ManualBody screen={screen} isPhone={isPhone} />
          <ManualSaveBar screen={screen} />
        </Card>
      )}
      <ManualPicker screen={screen} />
      <ManualFillDialog screen={screen} />
      <ManualCopyDialog screen={screen} />
      <ManualPreviewDialog screen={screen} />
    </main>
  );
}

export const rucniRasporedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/rucni-raspored',
  validateSearch: (search: Record<string, unknown>): ManualSearch => manualSearchOf(search),
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: RucniRasporedScreen,
});
