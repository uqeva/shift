import { useEffect, useState, type ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { CalendarPlus, Copy, Eye, EyeSlash, Warning } from '@/components/ui/icon';
import { IconTile } from '@/components/ui/icon-tile';
import { Notice } from '@/components/ui/notice';
import type { CalendarFeedState } from '@/features/calendar-feed/hooks/use-calendar-feed';
import {
  FEED_FOCUS_LINK,
  FEED_LIVE,
  FEED_LOADING,
  FEED_NONE,
  FEED_REGENERATE_ARMED,
  FEED_REGENERATING,
  FEED_TURN_OFF_ARMED,
  FEED_TURNING_OFF,
  FEED_UNAVAILABLE_VIEW,
  NEW_TAB_LINK,
  feedBusy,
  feedFailureMessageKey,
  lastFetchedLineOf,
  type FeedUrls,
} from '@/features/calendar-feed/services/feed';
import { copyLink, linkCopyMessageKey, type LinkCopy } from '@/features/calendar-feed/utils/copy';
import {
  FEED_FAILURE_ID,
  FEED_HEADING_ID,
  FEED_LINK_HEADING_ID,
  FEED_REGENERATE_PROMPT_ID,
  FEED_TURN_OFF_PROMPT_ID,
  FEED_URL_ID,
  FEED_URL_MASKED_ID,
  FEED_WARNING_ID,
} from '@/features/calendar-feed/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * *Kalendar na mobitelu*'s link (story 16.5, UX-DR54). With no link: one
 * sentence and *Izradi poveznicu*, nothing else. Right after creating (or
 * regenerating) it: the warning that the link is personal and secret, the URL
 * masked with *Prikaži* and *Kopiraj*, *Dodaj u Google kalendar* and *Dodaj u
 * Apple kalendar* with each one's phone steps. On any later visit: the state,
 * the last fetch and that the link is shown only once — never the URL.
 * *Izradi novu poveznicu* and *Isključi* each confirm first, and a refusal
 * keeps the confirmation open with the alert above its buttons. With a link,
 * the two fixed notes close the card. A landed create or regenerate moves
 * focus to the link's heading, a landed turn-off to the card's.
 */
export function FeedCard({ state, timeZone }: { readonly state: CalendarFeedState; readonly timeZone: string | null }): ReactNode {
  const gate = useWriteGate();
  const { view, urls, stage, failure, turnedOff, focus, landed } = state;
  const busy = feedBusy(stage);
  const regenerating = stage === FEED_REGENERATING;
  const turningOff = stage === FEED_TURNING_OFF;
  const confirming = stage === FEED_REGENERATE_ARMED || regenerating || stage === FEED_TURN_OFF_ARMED || turningOff;

  // FOCUS AFTER A LANDED WRITE: the new link's heading, or the card's after a turn-off.
  useEffect(() => {
    if (landed === 0 || focus === null) return;
    document.getElementById(focus === FEED_FOCUS_LINK ? FEED_LINK_HEADING_ID : FEED_HEADING_ID)?.focus();
  }, [landed, focus]);

  function renderWrite(label: string, onPress: () => void, primary: boolean, waitForRead: boolean): ReactNode {
    const held = busy || (waitForRead && state.reading);

    return (
      <Button
        className="h-11 w-full aria-disabled:opacity-50 sm:w-auto"
        type="button"
        variant={primary ? 'default' : 'outline'}
        disabled={held}
        aria-busy={held}
        aria-disabled={gate.disabled}
        aria-describedby={gate.describedBy(failure === null ? null : FEED_FAILURE_ID)}
        onClick={() => {
          if (!gate.online) return;
          onPress();
        }}
      >
        {label}
      </Button>
    );
  }

  function renderLastFetched(lastFetchedAt: string | null): ReactNode {
    const line = lastFetchedLineOf(lastFetchedAt, timeZone);

    return <p className="text-sm">{t(line.key, { date: line.date, time: line.time })}</p>;
  }

  function renderLoading(): ReactNode {
    return (
      <div role="status" aria-busy className="grid animate-pulse gap-3">
        <span className="sr-only">{t('feed.loading')}</span>
        <div className="h-5 w-64 max-w-full rounded bg-muted" />
      </div>
    );
  }

  function renderUnavailable(): ReactNode {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice role="alert">{t('feed.unavailable')}</Notice>
        <Button
          ref={keepFocusOnAlert}
          className="h-11 w-full sm:w-auto sm:justify-self-start"
          type="button"
          variant="outline"
          aria-busy={state.retrying}
          onClick={() => {
            void state.retry();
          }}
        >
          {t('feed.retry')}
        </Button>
      </div>
    );
  }

  function renderNone(): ReactNode {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{t('feed.lede')}</p>
        <div className="grid gap-2 sm:flex">{renderWrite(t('feed.create'), () => void state.create(), true, true)}</div>
      </div>
    );
  }

  function renderLive(lastFetchedAt: string | null): ReactNode {
    return (
      <div className="grid gap-4">
        <p className="text-sm font-medium">{t('feed.on')}</p>
        {renderLastFetched(lastFetchedAt)}
        {/* A LATER VISIT says why there is no URL: it is shown once. */}
        {urls === null ? <p className="text-sm text-muted-foreground">{t('feed.revisitNote')}</p> : null}
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {renderWrite(t('feed.regenerate'), state.armRegenerate, false, false)}
          {renderWrite(t('feed.turnOff'), state.armTurnOff, false, false)}
        </div>
      </div>
    );
  }

  return (
    <Card role="region" aria-labelledby={FEED_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2 id={FEED_HEADING_ID} tabIndex={-1}>
            {t('feed.linkHeading')}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* THE LINK, ONCE: above every state of the read, so a re-read that
            fails cannot take the only showing with it. */}
        {/* Keyed by the link: a regeneration starts masked, with no earlier copy notice. */}
        {urls === null ? null : <FeedLink key={urls.https} urls={urls} masked={state.masked} />}
        {view.kind === FEED_LOADING ? renderLoading() : null}
        {view.kind === FEED_UNAVAILABLE_VIEW ? renderUnavailable() : null}
        {view.kind === FEED_NONE ? renderNone() : null}
        {view.kind === FEED_LIVE ? renderLive(view.lastFetchedAt) : null}
        {/* ONE note under the gate's id: an open confirmation draws its own. */}
        {confirming ? null : <OfflineWriteNote gate={gate} />}
        {/* A create's refusal here; a confirmed write's stays in its dialog. */}
        {failure === null || confirming ? null : (
          <Notice id={FEED_FAILURE_ID} role="alert">
            {t(feedFailureMessageKey(failure))}
          </Notice>
        )}
        {turnedOff ? <Notice role="status">{t('feed.turnedOff')}</Notice> : null}
        {/* THE TWO FIXED NOTES, only with a link: with none, one sentence and one button (UX-DR54). */}
        {view.kind === FEED_LIVE ? (
          <div className="grid gap-2 border-t pt-4 text-sm text-muted-foreground">
            <p>{t('feed.googleLag')}</p>
            <p>{t('feed.omits')}</p>
          </div>
        ) : null}
      </CardContent>
      {stage === FEED_REGENERATE_ARMED || regenerating ? (
        <ConfirmDialog busy={regenerating} onCancel={state.cancel} aria-labelledby={FEED_REGENERATE_PROMPT_ID}>
          <p id={FEED_REGENERATE_PROMPT_ID} className="text-sm font-medium">
            {t('feed.regeneratePrompt')}
          </p>
          <OfflineWriteNote gate={gate} />
          {failure === null ? null : (
            <Notice id={FEED_FAILURE_ID} role="alert">
              {t(feedFailureMessageKey(failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={regenerating} onClick={state.cancel}>
              {t('feed.cancel')}
            </Button>
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              disabled={regenerating}
              aria-busy={regenerating}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy(failure === null ? null : FEED_FAILURE_ID)}
              onClick={() => {
                if (!gate.online) return;
                void state.regenerate();
              }}
            >
              {t('feed.regenerateConfirm')}
            </Button>
          </DialogFooter>
        </ConfirmDialog>
      ) : null}
      {stage === FEED_TURN_OFF_ARMED || turningOff ? (
        <ConfirmDialog busy={turningOff} onCancel={state.cancel} aria-labelledby={FEED_TURN_OFF_PROMPT_ID}>
          <p id={FEED_TURN_OFF_PROMPT_ID} className="text-sm font-medium">
            {t('feed.turnOffPrompt')}
          </p>
          <OfflineWriteNote gate={gate} />
          {failure === null ? null : (
            <Notice id={FEED_FAILURE_ID} role="alert">
              {t(feedFailureMessageKey(failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={turningOff} onClick={state.cancel}>
              {t('feed.cancel')}
            </Button>
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              disabled={turningOff}
              aria-busy={turningOff}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy(failure === null ? null : FEED_FAILURE_ID)}
              onClick={() => {
                if (!gate.online) return;
                void state.turnOff();
              }}
            >
              {t('feed.turnOffConfirm')}
            </Button>
          </DialogFooter>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/**
 * The link as created: the warning first, the URL masked until *Prikaži*,
 * *Kopiraj* (the https URL), the two add buttons and each calendar's steps.
 * Its show and copy state is its own and goes with it.
 */
function FeedLink({ urls, masked }: { readonly urls: FeedUrls; readonly masked: string | null }): ReactNode {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<LinkCopy | null>(null);

  async function copy(): Promise<void> {
    // Absent outside a secure context, so read here and never assumed.
    setCopied(await copyLink(navigator.clipboard as Clipboard | undefined, urls.https));
  }

  return (
    <section aria-labelledby={FEED_LINK_HEADING_ID} className="grid gap-4">
      <h3 id={FEED_LINK_HEADING_ID} tabIndex={-1} className="text-base font-semibold">
        {t('feed.created')}
      </h3>
      <Callout id={FEED_WARNING_ID}>
        <CalloutBody>
          <IconTile variant="primary">
            <Warning aria-hidden />
          </IconTile>
          <div className="min-w-0">
            <CalloutTitle>{t('feed.warningTitle')}</CalloutTitle>
            <CalloutDescription>{t('feed.warning')}</CalloutDescription>
          </div>
        </CalloutBody>
      </Callout>
      <div className="grid gap-2">
        <p className="text-sm font-semibold leading-none">{t('feed.urlLabel')}</p>
        <div className="grid min-w-0 gap-2 rounded-md bg-muted px-3 py-2">
          {/* DATA, never a key. `break-all`: a URL has no word to wrap at. */}
          <p id={FEED_URL_ID} className="min-w-0 select-all break-all font-mono text-sm">
            {shown || masked === null ? (
              urls.https
            ) : (
              <>
                {/* THE DOTS ARE NOT READ OUT: a screen reader hears that the link is hidden. */}
                <span aria-hidden>{masked}</span>
                <span id={FEED_URL_MASKED_ID} className="sr-only">
                  {t('feed.masked')}
                </span>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11"
              type="button"
              variant="outline"
              aria-pressed={shown}
              aria-controls={FEED_URL_ID}
              aria-describedby={FEED_WARNING_ID}
              onClick={() => {
                setShown((was) => !was);
              }}
            >
              {shown ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
              {shown ? t('feed.hide') : t('feed.show')}
            </Button>
            <Button
              className="h-11"
              type="button"
              variant="outline"
              aria-describedby={FEED_WARNING_ID}
              onClick={() => {
                void copy();
              }}
            >
              <Copy aria-hidden />
              {t('feed.copy')}
            </Button>
          </div>
        </div>
        {copied === null ? null : <Notice role="status">{t(linkCopyMessageKey(copied))}</Notice>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="grid content-start gap-2">
          <h4 className="text-sm font-semibold">{t('feed.google.heading')}</h4>
          <Button asChild className="h-11 justify-self-start">
            <a href={urls.google} {...NEW_TAB_LINK}>
              <CalendarPlus aria-hidden />
              {t('feed.google.add')}
              {/* It opens a new tab: said to a screen reader, as the name alone would not. */}
              <span className="sr-only"> {t('feed.google.newTab')}</span>
            </a>
          </Button>
          <ol className="grid list-decimal gap-1 pl-5 text-sm">
            <li>{t('feed.google.step1')}</li>
            <li>{t('feed.google.step2')}</li>
            <li>{t('feed.google.step3')}</li>
            <li>{t('feed.google.step4')}</li>
            <li>{t('feed.google.step5')}</li>
          </ol>
        </section>
        <section className="grid content-start gap-2">
          <h4 className="text-sm font-semibold">{t('feed.apple.heading')}</h4>
          <Button asChild className="h-11 justify-self-start">
            <a href={urls.webcal}>
              <CalendarPlus aria-hidden />
              {t('feed.apple.add')}
            </a>
          </Button>
          <ol className="grid list-decimal gap-1 pl-5 text-sm">
            <li>{t('feed.apple.step1')}</li>
            <li>{t('feed.apple.step2')}</li>
          </ol>
        </section>
      </div>
    </section>
  );
}
