import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  MEMBER_CALENDAR_FEED_KEY,
  MEMBER_FEED_WRITE_INITIAL,
  memberFeedArmed,
  memberFeedSettled,
  readMemberFeedState,
  revokeMemberFeed,
  type FeedRpc,
  type MemberFeedWriteState,
} from '@/features/calendar-feed/services/feed';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';

function rpc(): FeedRpc {
  return supabaseClient() as unknown as FeedRpc;
}

/**
 * The admin's *Kalendar na mobitelu* card on a member's page (story 16.5,
 * UX-DR55): its own read (`member_calendar_feed_status`, state only — an
 * admin never reads a URL or a token) and its one write, the turn-off,
 * confirmed first and gated offline. Its transitions are `services/feed`'s
 * (`memberFeedArmed`, `memberFeedSettled`). The page keys the card by the
 * member, so nothing armed or refused for one member stands over another's.
 */
export function useMemberCalendarFeed(memberId: string) {
  const read = useQuery({
    queryKey: MEMBER_CALENDAR_FEED_KEY(memberId),
    queryFn: () => readMemberFeedState(rpc(), memberId),
    retry: false,
  });
  const writing = useRef(false);
  const [state, setState] = useState<MemberFeedWriteState>(MEMBER_FEED_WRITE_INITIAL);
  const live = read.data !== undefined && read.data.ok && read.data.state.live;

  async function turnOff(): Promise<void> {
    if (writing.current || !writesOnline()) return;

    writing.current = true;
    setState((was) => ({ ...was, busy: true, failure: null }));

    try {
      const outcome = await revokeMemberFeed(rpc(), memberId);
      setState((was) => memberFeedSettled(was, outcome).state);
    } finally {
      writing.current = false;
      void read.refetch();
    }
  }

  return {
    outcome: read.data,
    live,
    armed: state.armed,
    busy: state.busy,
    failure: state.failure,
    turnedOff: state.turnedOff,
    landed: state.landed,
    arm: () => {
      setState((was) => memberFeedArmed(was, writesOnline(), live));
    },
    cancel: () => {
      if (!writing.current) setState((was) => ({ ...was, armed: false, failure: null }));
    },
    turnOff,
    retry: async () => {
      if (read.isFetching) return;
      await read.refetch();
    },
    retrying: read.isFetching,
  };
}

export type MemberCalendarFeedState = ReturnType<typeof useMemberCalendarFeed>;
