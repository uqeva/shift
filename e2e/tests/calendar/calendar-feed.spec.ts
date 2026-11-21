import type { APIResponse } from '@playwright/test';

import {
  API_URL,
  createCalendarFeedTokenInSql,
  holdCalendarFeed,
  revokeCalendarFeedTokenInSql,
  type RotationHold,
} from '../../utils/database-helper.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 16.4: the `calendar-feed` Edge Function as the Supabase CLI serves it
 * (`supabase functions serve`, through its `deno.json` map onto both
 * packages' built `dist`, AD-7), behind the local gateway, against the run's
 * real database: a member's token is made by 0067's definer as their own
 * session, and a calendar app's GET and HEAD are plain requests with no
 * session at all.
 *
 * The rules themselves (R12, the serializer, the miss matrix) are asserted in
 * Vitest (`test/calendar-feed.test.ts`, `packages/ics`); this proves the
 * served function, the gateway and the lookup agree end to end.
 */

const feedUrl = (token: string): string => `${API_URL}/functions/v1/calendar-feed/${token}.ics`;

/** A canonical token no row holds. */
const NEVER_ISSUED = `${'n'.repeat(42)}A`;

/** The miss floor (`MISS_FLOOR_MS` in the handler): no 404 leaves sooner. */
const MISS_FLOOR_MS = 250;

/** What a miss answers, the per-response headers aside, and whether it kept the floor. */
async function missOf(send: () => Promise<APIResponse>) {
  const started = Date.now();
  const response = await send();
  const elapsed = Date.now() - started;
  const headers = response.headers();
  return {
    status: response.status(),
    body: await response.text(),
    contentType: headers['content-type'],
    cacheControl: headers['cache-control'],
    floorKept: elapsed >= MISS_FLOOR_MS,
  };
}


/**
 * The member's ONE link, held for each case ({@link holdCalendarFeed}): `kalendar-na-mobitelu.spec.ts` (16.5)
 * creates and revokes the same member's link, in another worker.
 */
let feedHold: RotationHold | null = null;

test.beforeEach(async ({ fixture }) => {
  // Waiting for the other holder may take a while.
  test.slow();
  feedHold = holdCalendarFeed(fixture.slug);
  await feedHold.ready;
});

test.afterEach(async () => {
  await feedHold?.release();
  feedHold = null;
});

test.describe('a member’s calendar feed (story 16.4)', () => {
  test('serves the member’s calendar to a client with no session, and one 404 once the link is gone', async ({ request, fixture }) => {
    // Regenerating replaces the first link, which is then a miss like any other.
    const replaced = await createCalendarFeedTokenInSql(fixture.slug, fixture.member.username);
    const token = await createCalendarFeedTokenInSql(fixture.slug, fixture.member.username);
    try {
      const response = await request.get(feedUrl(token));
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8');
      expect(response.headers()['cache-control']).toBe('private, max-age=900');
      const text = await response.text();
      expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(text).toContain('\r\nX-WR-TIMEZONE:Europe/Zagreb\r\n');
      expect(text).toContain('\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Zagreb\r\n');
      expect(text).not.toMatch(/DESCRIPTION|LOCATION|ATTENDEE|ORGANIZER/);
      // Each event's SUMMARY is a shift type and a team (unfolded first: a long
      // one continues on the next line). The run's rotation may give the member
      // no shift in the window, so the count is not asserted here; Vitest
      // (`test/calendar-feed.test.ts`, `packages/ics`) holds the events.
      const unfolded = text.replaceAll('\r\n ', '');
      for (const summary of unfolded.match(/^SUMMARY:.*$/gm) ?? []) expect(summary).toMatch(/ · /);

      const head = await request.head(feedUrl(token));
      expect(head.status()).toBe(200);
      expect(head.headers()['content-type']).toBe('text/calendar; charset=utf-8');
      expect(head.headers()['cache-control']).toBe('private, max-age=900');
      expect(await head.text()).toBe('');
    } finally {
      await revokeCalendarFeedTokenInSql(fixture.slug, fixture.member.username);
    }

    // Revoked, replaced, never issued and malformed: one answer, none before the floor.
    const revoked = await missOf(() => request.get(feedUrl(token)));
    const replacedMiss = await missOf(() => request.get(feedUrl(replaced)));
    const unknown = await missOf(() => request.get(feedUrl(NEVER_ISSUED)));
    const malformed = await missOf(() => request.get(feedUrl('not-a-token')));
    expect(revoked).toEqual({
      status: 404,
      body: '{"code":"FEED_NOT_FOUND"}',
      contentType: 'application/json',
      cacheControl: 'no-store',
      floorKept: true,
    });
    expect(replacedMiss).toEqual(revoked);
    expect(unknown).toEqual(revoked);
    expect(malformed).toEqual(revoked);
  });

  test('refuses anything but GET and HEAD', async ({ request }) => {
    const response = await request.post(feedUrl(NEVER_ISSUED), { data: {} });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('GET, HEAD');
  });
});
