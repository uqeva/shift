import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  CALENDAR_FEED_KEY,
  CALENDAR_FEED_UNAVAILABLE,
  FEED_CREATING,
  FEED_REGENERATE_ARMED,
  FEED_REGENERATING,
  FEED_TURN_OFF_ARMED,
  FEED_TURNING_OFF,
  FEED_WRITE_INITIAL,
  createFeedToken,
  feedArmed,
  feedCancelled,
  feedHeldLinkLost,
  feedLinkDropped,
  feedUrlsOf,
  feedViewOf,
  feedWriteSettled,
  feedWriteStarted,
  isFeedProjectUrl,
  maskedFeedUrlOf,
  readFeedState,
  revokeOwnFeed,
  type FeedCreateOutcome,
  type FeedRevokeOutcome,
  type FeedRpc,
  type FeedUrls,
  type FeedWrite,
  type FeedWriteState,
} from '@/features/calendar-feed/services/feed';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { buildEnvironment, readSupabaseEnvironment, supabaseClient } from '@/lib/supabase/client';

/** The client's `rpc`, narrowed to the calls the feed makes; built inside a query or write, never at render. */
function rpc(): FeedRpc {
  return supabaseClient() as unknown as FeedRpc;
}

/** The build's project URL, or `null` when the build has none (the client refuses it the same way). */
function projectUrl(): string | null {
  try {
    return readSupabaseEnvironment(buildEnvironment).url;
  } catch {
    return null;
  }
}

/**
 * `/kalendar-na-mobitelu`'s read and its three writes (story 16.5).
 *
 * THE TOKEN LIVES IN THIS HOOK'S STATE ONLY, from the create's answer until
 * the page is left (D-S1, FR-80 "shown once"): never in the query cache —
 * the state read is re-read, never set from the answer — nor in storage, the
 * URL or a log. The page unmounting drops it; every later visit shows the
 * state alone.
 *
 * Every transition is `services/feed`'s, executed by the node suite
 * (`feedWriteStarted`, `feedWriteSettled`, …); this hook only sends. Create
 * and regenerate are one call (`create_calendar_feed_token` revokes any live
 * link first); regenerate and turn off are each confirmed first. A build with
 * no usable project URL asks for no token at all. Writes are gated offline.
 */
export function useCalendarFeed() {
  const read = useQuery({
    queryKey: CALENDAR_FEED_KEY,
    queryFn: () => readFeedState(rpc()),
    retry: false,
  });
  const writing = useRef(false);
  /** When the last write landed: a read stamped before it describes the state before it. */
  const settledAt = useRef(0);
  const [state, setState] = useState<FeedWriteState>(FEED_WRITE_INITIAL);
  const fresh = read.dataUpdatedAt >= settledAt.current;
  // Turned off elsewhere (an admin, another device) since this visit made it: never shown as working.
  const lost = feedHeldLinkLost(read.data, state.token !== null, fresh);

  useEffect(() => {
    if (lost) setState(feedLinkDropped);
  }, [lost]);

  const project = projectUrl();
  let urls: FeedUrls | null = null;
  if (state.token !== null && !lost && isFeedProjectUrl(project)) {
    try {
      urls = feedUrlsOf(project, state.token);
    } catch {
      urls = null;
    }
  }

  async function write(during: FeedWrite, send: () => Promise<FeedCreateOutcome | FeedRevokeOutcome>): Promise<void> {
    if (writing.current || !writesOnline()) return;

    writing.current = true;
    setState((was) => feedWriteStarted(was, during));

    try {
      // A link that could not be shown is never asked for.
      const needsUrl = during !== FEED_TURNING_OFF;
      const outcome: FeedCreateOutcome | FeedRevokeOutcome =
        needsUrl && !isFeedProjectUrl(project) ? { ok: false, code: CALENDAR_FEED_UNAVAILABLE } : await send();
      const settled = (was: FeedWriteState) => feedWriteSettled(was, during, outcome).state;
      settledAt.current = Date.now();
      setState(settled);
    } finally {
      writing.current = false;
      // The state is read again, never written from the answer: the cache holds no token.
      void read.refetch();
    }
  }

  return {
    view: feedViewOf(read.data, urls !== null, { fresh, turnedOff: state.turnedOff }),
    /** The URLs while this visit created the link, else `null`. */
    urls,
    /** The masked form, the project URL's alone. */
    masked: project === null ? null : maskedFeedUrlOf(project),
    stage: state.stage,
    failure: state.failure,
    turnedOff: state.turnedOff,
    /** Where focus goes after the last landed write, and a count that changes with each landing. */
    focus: state.focus,
    landed: state.landed,
    /** The state read is in flight: *Izradi poveznicu* waits for it. */
    reading: read.isFetching,
    create: () => write(FEED_CREATING, () => createFeedToken(rpc())),
    armRegenerate: () => {
      setState((was) => feedArmed(was, FEED_REGENERATE_ARMED));
    },
    regenerate: () => write(FEED_REGENERATING, () => createFeedToken(rpc())),
    armTurnOff: () => {
      setState((was) => feedArmed(was, FEED_TURN_OFF_ARMED));
    },
    turnOff: () => write(FEED_TURNING_OFF, () => revokeOwnFeed(rpc())),
    cancel: () => {
      setState(feedCancelled);
    },
    retry: async () => {
      if (read.isFetching) return;
      await read.refetch();
    },
    retrying: read.isFetching,
  };
}

export type CalendarFeedState = ReturnType<typeof useCalendarFeed>;
