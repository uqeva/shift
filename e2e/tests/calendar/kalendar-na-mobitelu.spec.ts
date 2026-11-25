import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ADMIN_STATE, MEMBER_STATE, readFixture } from '../../utils/run-fixture.ts';
import {
  API_URL,
  createCalendarFeedTokenInSql,
  holdCalendarFeed,
  removeSeededRotation,
  revokeCalendarFeedTokenInSql,
  seedTeamRotation,
  type RotationHold,
} from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 16.5: *Kalendar na mobitelu*, a fixed row in *Više* (and the desktop
 * profile menu) for every role. A member creates their link and sees it once
 * (masked until *Prikaži*), the served `calendar-feed` answers it, a revisit
 * shows the state and never the URL, a regeneration kills the old link, and
 * turning it off kills the new one. An admin's card on the member's page says
 * `uključen` and turns it off, never showing a URL.
 *
 * Written with the story and first run by CI (the local stack is shared).
 * Serial: every case is the same member's one link.
 */

const copy = hr.feed;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
/** 0067's token in the URL the screen shows. */
const FEED_URL = /\/functions\/v1\/calendar-feed\/([A-Za-z0-9_-]{43})\.ics$/;
const feedUrl = (token: string): string => `${API_URL}/functions/v1/calendar-feed/${token}.ics`;

test.describe.configure({ mode: 'serial' });

/**
 * The member's ONE link, held for each case ({@link holdCalendarFeed}): `calendar-feed.spec.ts` (16.4)
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

test.describe('a member on a phone', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE });

  test('creates the link, sees it once, regenerates it and turns it off', async ({ page, calendarFeedPage, notificationsPage, request }) => {
    const fixture = readFixture();
    await revokeCalendarFeedTokenInSql(fixture.slug, fixture.member.username);

    try {
      await page.goto('/danas');
      await calendarFeedPage.moreButton.click();
      await calendarFeedPage.moreRow.click();
      await expect(page).toHaveURL('/kalendar-na-mobitelu');
      await expect(calendarFeedPage.heading(copy.heading)).toBeVisible();

      // No link: one sentence and *Izradi poveznicu*.
      await expect(calendarFeedPage.line(copy.lede)).toBeVisible();
      await calendarFeedPage.button(copy.create).click();

      // Created: the warning, the URL masked, then shown.
      await expect(calendarFeedPage.line(copy.warningTitle)).toBeVisible();
      await expect(calendarFeedPage.url).toContainText('•');
      await calendarFeedPage.button(copy.show).click();
      const first = FEED_URL.exec((await calendarFeedPage.url.textContent()) ?? '')?.[1] ?? '';
      expect(first, 'the shown URL is not a feed URL').toHaveLength(43);
      await expect(calendarFeedPage.appleLink).toHaveAttribute('href', /^webcal:\/\//);
      await expect(calendarFeedPage.googleLink).toHaveAttribute(
        'href',
        /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2F/,
      );
      await expect(calendarFeedPage.line(copy.neverFetched)).toBeVisible();

      // The served function answers the link a calendar app would fetch.
      expect((await request.get(feedUrl(first))).status()).toBe(200);

      // Left in-app for another screen and opened again: the state alone, no part of the token.
      await calendarFeedPage.moreButton.click();
      await notificationsPage.moreRow.click();
      await expect(page).toHaveURL('/obavijesti');
      await calendarFeedPage.moreButton.click();
      await calendarFeedPage.moreRow.click();
      await expect(page).toHaveURL('/kalendar-na-mobitelu');
      await expect(calendarFeedPage.line(copy.revisitNote)).toBeVisible();
      await expect(calendarFeedPage.url).toHaveCount(0);
      expect(await calendarFeedPage.markup()).not.toContain(first);

      // A reload too shows the state, the last fetch and why there is no URL.
      await page.reload();
      await expect(calendarFeedPage.line(copy.on)).toBeVisible();
      await expect(calendarFeedPage.line(copy.revisitNote)).toBeVisible();
      await expect(calendarFeedPage.url).toHaveCount(0);
      await expect(calendarFeedPage.line(/^Zadnje preuzimanje: /)).toBeVisible();
      expect(await calendarFeedPage.markup()).not.toContain(first);

      // Regenerate, confirmed: a new URL, shown once; the old one is gone at once.
      await calendarFeedPage.button(copy.regenerate).click();
      await expect(calendarFeedPage.line(copy.regeneratePrompt)).toBeVisible();
      await calendarFeedPage.button(copy.regenerateConfirm).click();
      // The new link starts masked.
      await expect(calendarFeedPage.url).toContainText('•');
      await calendarFeedPage.button(copy.show).click();
      const second = FEED_URL.exec((await calendarFeedPage.url.textContent()) ?? '')?.[1] ?? '';
      expect(second).toHaveLength(43);
      expect(second).not.toBe(first);
      // *Kopiraj* says whether it landed (the headless clipboard may refuse it; either line is its notice).
      const copyNotice = calendarFeedPage.line(copy.copied).or(calendarFeedPage.line(copy.copyFailed));
      await calendarFeedPage.button(copy.copy).click();
      await expect(copyNotice).toBeVisible();
      // Regenerated again in the same visit: masked once more, no earlier copy notice.
      await calendarFeedPage.button(copy.regenerate).click();
      await calendarFeedPage.button(copy.regenerateConfirm).click();
      await expect(calendarFeedPage.url).toContainText('•');
      await expect(copyNotice).toHaveCount(0);
      await calendarFeedPage.button(copy.show).click();
      const third = FEED_URL.exec((await calendarFeedPage.url.textContent()) ?? '')?.[1] ?? '';
      expect(third).not.toBe(second);
      expect((await request.get(feedUrl(second))).status()).toBe(404);
      expect((await request.get(feedUrl(first))).status()).toBe(404);
      expect((await request.get(feedUrl(third))).status()).toBe(200);

      // Turn off, confirmed: back to no link, and the link answers 404.
      await calendarFeedPage.button(copy.turnOff).click();
      await expect(calendarFeedPage.line(copy.turnOffPrompt)).toBeVisible();
      await calendarFeedPage.button(copy.turnOffConfirm).click();
      await expect(calendarFeedPage.line(copy.turnedOff)).toBeVisible();
      await expect(calendarFeedPage.button(copy.create)).toBeVisible();
      await expect(calendarFeedPage.url).toHaveCount(0);
      expect((await request.get(feedUrl(third))).status()).toBe(404);
    } finally {
      await revokeCalendarFeedTokenInSql(fixture.slug, fixture.member.username);
    }
  });

  test('downloads a month as a .ics file', async ({ calendarFeedPage, fixture, holdRotationForTeams }) => {
    // The run seeds no rotation: the member's team gets one from today
    // ([Dan, Noć, Slobodno, Slobodno]), so the current month has a working day.
    await holdRotationForTeams(async () => {
      const seeded = await seedTeamRotation(fixture.slug, fixture.team.id, randomBytes(3).toString('hex'));
      try {
        await calendarFeedPage.goto();
        const download = await calendarFeedPage.downloadMonth();
        expect(download.suggestedFilename()).toMatch(/^smjenko-\d{4}-\d{2}\.ics$/);
        const text = readFileSync(await download.path(), 'utf8');
        expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(text).not.toContain('REFRESH-INTERVAL');
        const uids = text.replaceAll('\r\n ', '').match(/^UID:.*$/gm) ?? [];
        // An empty file would pass the loop below.
        expect(uids.length).toBeGreaterThan(0);
        for (const uid of uids) expect(uid).toMatch(/@shift-download$/);
      } finally {
        await removeSeededRotation(seeded);
      }
    });
  });
});

test.describe('an admin on the member’s page', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('sees the member’s link on, never its URL, and turns it off', async ({ peoplePage, calendarFeedPage, request }) => {
    const fixture = readFixture();
    const token = await createCalendarFeedTokenInSql(fixture.slug, fixture.member.username);

    try {
      await peoplePage.openMember(fixture.member.name);
      await expect(calendarFeedPage.line(copy.member.on)).toBeVisible();
      expect(await calendarFeedPage.markup()).not.toContain(token);

      await calendarFeedPage.button(copy.member.turnOff).click();
      await expect(calendarFeedPage.line(copy.member.turnOffPrompt)).toBeVisible();
      await calendarFeedPage.button(copy.member.turnOffConfirm).click();
      await expect(calendarFeedPage.line(copy.member.off)).toBeVisible();
      await expect(calendarFeedPage.button(copy.member.turnOff)).toHaveCount(0);
      expect((await request.get(feedUrl(token))).status()).toBe(404);
    } finally {
      await revokeCalendarFeedTokenInSql(fixture.slug, fixture.member.username);
    }
  });
});
