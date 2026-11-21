import { createRoute } from '@tanstack/react-router';

import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { FeedCard } from '@/features/calendar-feed/components/feed-card';
import { MonthDownloadCard } from '@/features/calendar-feed/components/month-download-card';
import { useCalendarFeed } from '@/features/calendar-feed/hooks/use-calendar-feed';
import { useMonthDownload } from '@/features/calendar-feed/hooks/use-month-download';
import { FEED_PAGE_HEADING_ID } from '@/features/calendar-feed/utils/element-ids';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/kalendar-na-mobitelu` — *Kalendar na mobitelu* (story 16.5, UX-DR54): the
 * signed-in person's own calendar link, for every role, and a month as a
 * `.ics` file. Reached from a fixed row in *Više* and the profile menu, never
 * a destination. Two independent sections: the link (`useCalendarFeed`, the
 * rules `@/features/calendar-feed/services/feed`) and the download
 * (`useMonthDownload`, `@/features/calendar-feed/services/month-download`).
 * The link's token lives in the first hook's state only, so leaving this page
 * forgets it. The session guard is the `_app` layout's.
 */
export function KalendarNaMobiteluScreen() {
  const feed = useCalendarFeed();
  const download = useMonthDownload();

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-labelledby={FEED_PAGE_HEADING_ID}
    >
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <PageTitle asChild>
            <h1 id={FEED_PAGE_HEADING_ID}>{t('feed.heading')}</h1>
          </PageTitle>
        </div>
      </PageHeader>
      <FeedCard state={feed} timeZone={download.timeZone} />
      <MonthDownloadCard state={download} />
    </main>
  );
}

export const kalendarNaMobiteluRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar-na-mobitelu',
  component: KalendarNaMobiteluScreen,
});
