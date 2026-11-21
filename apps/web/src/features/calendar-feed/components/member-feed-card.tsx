import { useEffect, type ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { useMemberCalendarFeed } from '@/features/calendar-feed/hooks/use-member-calendar-feed';
import {
  feedFailureMessageKey,
  memberFeedLineMessageKey,
  memberFeedReadMessageKey,
  memberFeedReadRetryable,
} from '@/features/calendar-feed/services/feed';
import {
  MEMBER_FEED_FAILURE_ID,
  MEMBER_FEED_HEADING_ID,
  MEMBER_FEED_PROMPT_ID,
} from '@/features/calendar-feed/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * The member page's *Kalendar na mobitelu* card (story 16.5, UX-DR55), after
 * *Status*: `Kalendar na mobitelu: uključen / isključen`, and while on,
 * *Isključi poveznicu*, confirmed first and gated offline. A refused turn-off
 * keeps its dialog open with the refusal above its buttons; a landed one
 * closes it and moves focus to the card's heading. A read that fails says
 * why, with a retry only when another try can answer. Never a URL or a
 * token: the admin's read answers the state alone. The page keys it by the
 * member.
 */
export function MemberFeedCard({ memberId }: { readonly memberId: string }): ReactNode {
  const feed = useMemberCalendarFeed(memberId);
  const gate = useWriteGate();
  const { outcome, live, landed } = feed;

  useEffect(() => {
    if (landed > 0) document.getElementById(MEMBER_FEED_HEADING_ID)?.focus();
  }, [landed]);

  return (
    <Card role="region" aria-labelledby={MEMBER_FEED_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle asChild>
          <h2 id={MEMBER_FEED_HEADING_ID} tabIndex={-1}>
            {t('feed.member.heading')}
          </h2>
        </CardTitle>
        {live ? (
          <Button
            className="h-11 aria-disabled:opacity-50"
            type="button"
            variant="outline"
            disabled={feed.busy}
            aria-busy={feed.busy}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            onClick={() => {
              if (!gate.online) return;
              feed.arm();
            }}
          >
            {t('feed.member.turnOff')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {outcome === undefined ? (
          <div role="status" aria-busy className="grid animate-pulse gap-3">
            <span className="sr-only">{t('feed.loading')}</span>
            <div className="h-5 w-56 max-w-full rounded bg-muted" />
          </div>
        ) : null}
        {outcome?.ok === true ? <p className="text-sm font-medium">{t(memberFeedLineMessageKey(live))}</p> : null}
        {outcome?.ok === false ? (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t(memberFeedReadMessageKey(outcome.code))}</Notice>
            {memberFeedReadRetryable(outcome.code) ? (
              <Button
                ref={keepFocusOnAlert}
                className="h-11 w-full sm:w-auto sm:justify-self-start"
                type="button"
                variant="outline"
                aria-busy={feed.retrying}
                onClick={() => {
                  void feed.retry();
                }}
              >
                {t('feed.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* ONE note under the gate's id: the open dialog draws its own. */}
        {feed.armed ? null : <OfflineWriteNote gate={gate} />}
        {feed.turnedOff ? <Notice role="status">{t('feed.member.turnedOff')}</Notice> : null}
      </CardContent>
      {feed.armed ? (
        <ConfirmDialog busy={feed.busy} onCancel={feed.cancel} aria-labelledby={MEMBER_FEED_PROMPT_ID}>
          <p id={MEMBER_FEED_PROMPT_ID} className="text-sm font-medium">
            {t('feed.member.turnOffPrompt')}
          </p>
          <OfflineWriteNote gate={gate} />
          {/* A REFUSAL KEEPS THE DIALOG OPEN, the alert above its buttons. */}
          {feed.failure === null ? null : (
            <Notice id={MEMBER_FEED_FAILURE_ID} role="alert">
              {t(feedFailureMessageKey(feed.failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={feed.busy} onClick={feed.cancel}>
              {t('feed.cancel')}
            </Button>
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              disabled={feed.busy}
              aria-busy={feed.busy}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy(feed.failure === null ? null : MEMBER_FEED_FAILURE_ID)}
              onClick={() => {
                if (!gate.online) return;
                void feed.turnOff();
              }}
            >
              {t('feed.member.turnOffConfirm')}
            </Button>
          </DialogFooter>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
