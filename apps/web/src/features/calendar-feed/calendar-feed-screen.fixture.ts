/**
 * STORY 16.5: *KALENDAR NA MOBITELU*'S FILE SET, `/kalendar-na-mobitelu` —
 * its page, the link's hook and card, and the month download's hook and card.
 * The page is first. Segments under `apps/web/src`, joined by each suite
 * against its own root, so this module imports nothing.
 */
export const CALENDAR_FEED_SCREEN_PARTS = {
  page: ['pages', 'kalendar-na-mobitelu.tsx'],
  hook: ['features', 'calendar-feed', 'hooks', 'use-calendar-feed.ts'],
  card: ['features', 'calendar-feed', 'components', 'feed-card.tsx'],
  downloadHook: ['features', 'calendar-feed', 'hooks', 'use-month-download.ts'],
  downloadCard: ['features', 'calendar-feed', 'components', 'month-download-card.tsx'],
} as const;

/**
 * STORY 16.5 (UX-DR55): the member page's *Kalendar na mobitelu* card and its
 * hook, a set of its own, drawn on `/ljudi/$id` after *Status*.
 */
export const MEMBER_FEED_CARD_PARTS = {
  card: ['features', 'calendar-feed', 'components', 'member-feed-card.tsx'],
  hook: ['features', 'calendar-feed', 'hooks', 'use-member-calendar-feed.ts'],
} as const;

/**
 * Non-test modules under the calendar-feed feature that are NOT part of
 * either set, each with the reason. Everything else found there must be
 * listed above. Paths are relative to the feature.
 */
export const CALENDAR_FEED_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'calendar-feed-screen.fixture.ts',
    why: 'this file: the two sets themselves, read by the source sweeps and rendered by nothing',
  },
  {
    file: 'utils/element-ids.ts',
    why: 'the screen’s and the card’s element ids, named once; identifiers rather than copy',
  },
  {
    file: 'utils/copy.ts',
    why: 'the copy and its two status lines; a key source of its own, executed by feed.test.ts',
  },
  {
    file: 'utils/save-file.ts',
    why: 'hands the browser a text file to save through an object URL; no copy and no rule',
  },
  {
    file: 'services/feed.ts',
    why: 'the five reads and writes, the URLs, the mask and the view rule; a key source of its own, executed by feed.test.ts',
  },
  {
    file: 'services/month-download.ts',
    why: 'the month as a calendar file, R12 through the feed’s own serializer, its reach and its two lines; a key source of its own, executed by month-download.test.ts',
  },
];
