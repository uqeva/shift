import type { ReactNode } from 'react';

import { MonthNav } from '@/components/month-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DownloadSimple } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import type { MonthDownloadState } from '@/features/calendar-feed/hooks/use-month-download';
import { monthDownloadMessageKey } from '@/features/calendar-feed/services/month-download';
import {
  FEED_DOWNLOAD_FAILURE_ID,
  FEED_DOWNLOAD_HEADING_ID,
  FEED_DOWNLOAD_MONTH_HEADING_ID,
} from '@/features/calendar-feed/utils/element-ids';
import { t } from '@/lib/i18n';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * *Preuzmi mjesec* on *Kalendar na mobitelu* (story 16.5): one month of the
 * viewer's own working shifts as a `.ics` file, from the feed's own
 * serializer. The shared month control picks the month, within twelve months
 * either side of the current one; *Preuzmi* builds the file in the browser.
 * Offered whatever the link's state, and offline too while the device holds
 * the reads; without them it says so rather than waiting for good.
 */
export function MonthDownloadCard({ state }: { readonly state: MonthDownloadState }): ReactNode {
  const { month, failure } = state;

  return (
    <Card role="region" aria-labelledby={FEED_DOWNLOAD_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2 id={FEED_DOWNLOAD_HEADING_ID}>{t('feed.download.heading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('feed.download.lede')}</p>
        {state.unavailable ? (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('feed.download.unavailable')}</Notice>
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={state.retry}
            >
              {t('feed.retry')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {/* The heading the month control names and falls back to. */}
            <h3 id={FEED_DOWNLOAD_MONTH_HEADING_ID} className="sr-only">
              {month === null ? t('feed.download.heading') : `${month.monthName} ${month.year}`}
            </h3>
            <MonthNav month={month} headingId={FEED_DOWNLOAD_MONTH_HEADING_ID} onShow={state.show} />
            <Button
              className="h-11"
              type="button"
              disabled={month === null || state.loading}
              aria-busy={state.loading}
              aria-describedby={failure === null ? undefined : FEED_DOWNLOAD_FAILURE_ID}
              onClick={state.download}
            >
              <DownloadSimple aria-hidden />
              {t('feed.download.action')}
            </Button>
          </div>
        )}
        {failure === null ? null : (
          <Notice id={FEED_DOWNLOAD_FAILURE_ID} role="alert">
            {t(monthDownloadMessageKey(failure))}
          </Notice>
        )}
        {state.started === null ? null : <Notice role="status">{t('feed.download.started', { file: state.started })}</Notice>}
      </CardContent>
    </Card>
  );
}
