import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_FEED_KEY,
  CALENDAR_FEED_MEMBER_UNKNOWN,
  CALENDAR_FEED_REFUSED,
  CALENDAR_FEED_STATUS_FUNCTION,
  CALENDAR_FEED_UNAVAILABLE,
  CREATE_CALENDAR_FEED_TOKEN_FUNCTION,
  FEED_CREATING,
  FEED_FOCUS_CARD,
  FEED_FOCUS_LINK,
  FEED_IDLE,
  FEED_LIVE,
  FEED_LOADING,
  FEED_REGENERATE_ARMED,
  FEED_REGENERATING,
  FEED_TURN_OFF_ARMED,
  FEED_TURNING_OFF,
  FEED_WRITE_INITIAL,
  MEMBER_FEED_WRITE_INITIAL,
  FEED_NONE,
  FEED_UNAVAILABLE_VIEW,
  MASK,
  MEMBER_CALENDAR_FEED_KEY,
  MEMBER_CALENDAR_FEED_STATUS_FUNCTION,
  REVOKE_MEMBER_CALENDAR_FEED_TOKEN_FUNCTION,
  REVOKE_OWN_CALENDAR_FEED_TOKEN_FUNCTION,
  createFeedToken,
  feedArmed,
  feedCancelled,
  feedFailureMessageKey,
  feedWriteSettled,
  feedWriteStarted,
  isFeedProjectUrl,
  memberFeedArmed,
  memberFeedReadMessageKey,
  memberFeedReadRetryable,
  memberFeedSettled,
  feedStateOf,
  feedUrlsOf,
  feedViewOf,
  lastFetchedLineOf,
  maskedFeedUrlOf,
  memberFeedLineMessageKey,
  readFeedState,
  readMemberFeedState,
  revokeMemberFeed,
  revokeOwnFeed,
  type FeedRpc,
} from '@/features/calendar-feed/services/feed';
import { LINK_COPIED, LINK_NOT_COPIED, copyLink, linkCopyMessageKey } from '@/features/calendar-feed/utils/copy';
import { persistsKey } from '@/lib/offline/persistence';
import { initLocalization, t } from '@/lib/i18n';

/**
 * STORY 16.5: *Kalendar na mobitelu*'s rules over 0067's five functions,
 * against a stubbed `rpc` (AD-15). The token is a credential (D-S1): it is
 * answered to the caller and never kept, logged or shown in a later state.
 */

/** 0067's shape: 32 bytes as unpadded base64url, 43 characters. */
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
const PROJECT = 'https://api.shift.example';
const MEMBER = '00000000-0000-4000-8000-0000000000b2';
const CREATED = '2026-11-21T10:15:00.123456+00:00';
const FETCHED = '2026-11-21T17:45:00+00:00';

interface Call {
  readonly fn: string;
  readonly args: Readonly<Record<string, unknown>> | undefined;
}

function rpcAnswering(answer: { data: unknown; error: { code?: string; message?: string } | null } | Error): FeedRpc & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the feed state (0067: live, created_at, last_fetched_at only)', () => {
  it('reads a live state and one not live, and keeps exactly the three fields', () => {
    expect(feedStateOf({ live: true, created_at: CREATED, last_fetched_at: null })).toEqual({ live: true, createdAt: CREATED, lastFetchedAt: null });
    expect(feedStateOf({ live: true, created_at: CREATED, last_fetched_at: FETCHED })).toEqual({
      live: true,
      createdAt: CREATED,
      lastFetchedAt: FETCHED,
    });
    expect(feedStateOf({ live: false, created_at: null, last_fetched_at: null })).toEqual({ live: false, createdAt: null, lastFetchedAt: null });
    // Anything else an answer carried is dropped, a token-like field included.
    const kept = feedStateOf({ live: true, created_at: CREATED, last_fetched_at: null, token: TOKEN, token_hash: 'x' });
    expect(Object.keys(kept ?? {}).sort()).toEqual(['createdAt', 'lastFetchedAt', 'live']);
    expect(JSON.stringify(kept)).not.toContain(TOKEN);
  });

  it('refuses what 0067 never answers', () => {
    for (const data of [
      null,
      'live',
      [],
      { live: 'true', created_at: CREATED, last_fetched_at: null },
      { live: true, created_at: null, last_fetched_at: null },
      { live: false, created_at: CREATED, last_fetched_at: null },
      { live: true, created_at: 'yesterday', last_fetched_at: null },
      { live: true, created_at: CREATED, last_fetched_at: 7 },
    ]) {
      expect(feedStateOf(data), JSON.stringify(data)).toBeNull();
    }
  });

  it('reads the viewer’s own state with no argument, and a member’s for an admin by p_member', async () => {
    const own = rpcAnswering({ data: { live: false, created_at: null, last_fetched_at: null }, error: null });
    expect(await readFeedState(own)).toEqual({ ok: true, state: { live: false, createdAt: null, lastFetchedAt: null } });
    expect(own.calls).toEqual([{ fn: CALENDAR_FEED_STATUS_FUNCTION, args: undefined }]);

    const admin = rpcAnswering({ data: { live: true, created_at: CREATED, last_fetched_at: FETCHED }, error: null });
    expect(await readMemberFeedState(admin, MEMBER)).toMatchObject({ ok: true, state: { live: true } });
    expect(admin.calls).toEqual([{ fn: MEMBER_CALENDAR_FEED_STATUS_FUNCTION, args: { p_member: MEMBER } }]);
    expect([CALENDAR_FEED_STATUS_FUNCTION, MEMBER_CALENDAR_FEED_STATUS_FUNCTION]).toEqual(['calendar_feed_status', 'member_calendar_feed_status']);
  });

  it('answers 0067’s refusals by code, and every other failure as unavailable, never throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await readFeedState(rpcAnswering({ data: null, error: { code: '42501', message: 'CALENDAR_FEED_REFUSED' } }))).toEqual({
      ok: false,
      code: CALENDAR_FEED_REFUSED,
    });
    expect(await readMemberFeedState(rpcAnswering({ data: null, error: { code: 'P0002' } }), MEMBER)).toEqual({
      ok: false,
      code: CALENDAR_FEED_MEMBER_UNKNOWN,
    });
    expect(await readFeedState(rpcAnswering({ data: null, error: { code: '08006' } }))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
    expect(await readFeedState(rpcAnswering(new TypeError('Failed to fetch')))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
    expect(await readFeedState(rpcAnswering({ data: { live: 1 }, error: null }))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
  });

  it('keeps neither key on the device: the persisted cache is an allowlist that names neither', () => {
    expect(persistsKey(CALENDAR_FEED_KEY)).toBe(false);
    expect(persistsKey(MEMBER_CALENDAR_FEED_KEY(MEMBER))).toBe(false);
  });
});

describe('creating and turning off a link', () => {
  it('answers the token once, as 0067 returns it, from a call with no argument', async () => {
    const client = rpcAnswering({ data: TOKEN, error: null });
    expect(await createFeedToken(client)).toEqual({ ok: true, token: TOKEN });
    expect(client.calls).toEqual([{ fn: CREATE_CALENDAR_FEED_TOKEN_FUNCTION, args: undefined }]);
  });

  it('refuses an answer that is not a token, and logs codes only, never the answer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const almost = `${TOKEN}=`;
    expect(await createFeedToken(rpcAnswering({ data: almost, error: null }))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
    expect(await createFeedToken(rpcAnswering({ data: null, error: { code: '42501' } }))).toEqual({ ok: false, code: CALENDAR_FEED_REFUSED });
    expect(await createFeedToken(rpcAnswering(new Error(`boom ${TOKEN}`)))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TOKEN);
  });

  it('turns off the viewer’s own link, and an admin a member’s by p_member', async () => {
    const own = rpcAnswering({ data: null, error: null });
    expect(await revokeOwnFeed(own)).toEqual({ ok: true });
    expect(own.calls).toEqual([{ fn: REVOKE_OWN_CALENDAR_FEED_TOKEN_FUNCTION, args: undefined }]);

    const admin = rpcAnswering({ data: null, error: null });
    expect(await revokeMemberFeed(admin, MEMBER)).toEqual({ ok: true });
    expect(admin.calls).toEqual([{ fn: REVOKE_MEMBER_CALENDAR_FEED_TOKEN_FUNCTION, args: { p_member: MEMBER } }]);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await revokeMemberFeed(rpcAnswering({ data: null, error: { code: 'P0002' } }), MEMBER)).toEqual({
      ok: false,
      code: CALENDAR_FEED_MEMBER_UNKNOWN,
    });
    expect(await revokeOwnFeed(rpcAnswering(new Error('offline')))).toEqual({ ok: false, code: CALENDAR_FEED_UNAVAILABLE });
  });
});

describe('the URLs (AD-14) and the mask', () => {
  it('builds the https URL, its webcal twin and Google’s add-by-URL link with the webcal URL encoded', () => {
    const urls = feedUrlsOf(`${PROJECT}/`, TOKEN);
    expect(urls.https).toBe(`${PROJECT}/functions/v1/calendar-feed/${TOKEN}.ics`);
    expect(urls.webcal).toBe(`webcal://api.shift.example/functions/v1/calendar-feed/${TOKEN}.ics`);
    expect(urls.google).toBe(
      `https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapi.shift.example%2Ffunctions%2Fv1%2Fcalendar-feed%2F${TOKEN}.ics`,
    );
    expect(feedUrlsOf('http://127.0.0.1:54321', TOKEN).webcal).toBe(`webcal://127.0.0.1:54321/functions/v1/calendar-feed/${TOKEN}.ics`);
  });

  it('refuses a token 0067 never issues and a project URL that is not http(s), naming neither', () => {
    for (const [project, token] of [
      [PROJECT, TOKEN.slice(1)],
      [PROJECT, `${TOKEN.slice(1)}/`],
      [PROJECT, '../../rest/v1/members.ics?x=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['ftp://api.shift.example', TOKEN],
      ['api.shift.example', TOKEN],
    ] as const) {
      expect(() => feedUrlsOf(project, token)).toThrow(RangeError);
      try {
        feedUrlsOf(project, token);
      } catch (cause) {
        expect((cause as Error).message).not.toContain(TOKEN);
      }
    }
  });

  it('masks the token whole: the origin, …/calendar-feed/ and a fixed run of dots, the project URL’s alone', () => {
    const masked = maskedFeedUrlOf(`${PROJECT}/`);
    expect(masked).toBe(`${PROJECT}/…/calendar-feed/${MASK}.ics`);
    expect(masked).not.toContain(TOKEN.slice(0, 4));
    expect(maskedFeedUrlOf('https://example.com/base/')).toBe(`https://example.com/…/calendar-feed/${MASK}.ics`);
  });
});

describe('the view and its lines', () => {
  it('draws loading, unavailable, no link, or the live state with its last fetch', () => {
    expect(feedViewOf(undefined)).toEqual({ kind: FEED_LOADING });
    expect(feedViewOf({ ok: false, code: CALENDAR_FEED_UNAVAILABLE })).toEqual({ kind: FEED_UNAVAILABLE_VIEW });
    expect(feedViewOf({ ok: true, state: { live: false, createdAt: null, lastFetchedAt: null } })).toEqual({ kind: FEED_NONE });
    expect(feedViewOf({ ok: true, state: { live: true, createdAt: CREATED, lastFetchedAt: FETCHED } })).toEqual({
      kind: FEED_LIVE,
      lastFetchedAt: FETCHED,
    });
  });

  it('treats a held link as live while the read catches up, so Izradi poveznicu is never offered beside it', () => {
    const none = { ok: true, state: { live: false, createdAt: null, lastFetchedAt: null } } as const;
    expect(feedViewOf(undefined, true)).toEqual({ kind: FEED_LIVE, lastFetchedAt: null });
    expect(feedViewOf(none, true)).toEqual({ kind: FEED_LIVE, lastFetchedAt: null });
    expect(feedViewOf({ ok: false, code: CALENDAR_FEED_UNAVAILABLE }, true)).toEqual({ kind: FEED_LIVE, lastFetchedAt: null });
    expect(feedViewOf({ ok: true, state: { live: true, createdAt: CREATED, lastFetchedAt: FETCHED } }, true)).toEqual({
      kind: FEED_LIVE,
      lastFetchedAt: FETCHED,
    });
  });

  it('tells the last fetch as Zagreb’s wall time, and without a known zone says only that it happened (L8)', () => {
    // 17:45Z on 21.11. is 18:45 in Zagreb (+01:00); 30.06. 22:10Z is 01.07. 00:10 (+02:00).
    expect(lastFetchedLineOf(FETCHED, 'Europe/Zagreb')).toEqual({ key: 'feed.lastFetched', date: '21.11.2026', time: '18:45' });
    expect(lastFetchedLineOf('2026-06-30T22:10:00Z', 'Europe/Zagreb')).toEqual({ key: 'feed.lastFetched', date: '01.07.2026', time: '00:10' });
    for (const zone of [null, 'Mars/Olympus']) {
      expect(lastFetchedLineOf(FETCHED, zone)).toEqual({ key: 'feed.fetched', date: '', time: '' });
    }
    expect(lastFetchedLineOf(null, 'Europe/Zagreb')).toEqual({ key: 'feed.neverFetched', date: '', time: '' });
    expect(lastFetchedLineOf(null, null)).toEqual({ key: 'feed.neverFetched', date: '', time: '' });
  });

  it('resolves every line to hr.json, in the binding words (UX-DR54, UX-DR55)', () => {
    expect(t('feed.lastFetched', { date: '21.11.2026', time: '18:45' })).toBe('Zadnje preuzimanje: 21.11.2026 u 18:45');
    expect(t('feed.neverFetched')).toBe('Još nije preuzeto.');
    expect(t(memberFeedLineMessageKey(true))).toBe('Kalendar na mobitelu: uključen');
    expect(t(memberFeedLineMessageKey(false))).toBe('Kalendar na mobitelu: isključen');
    expect(t('feed.member.turnOff')).toBe('Isključi poveznicu');
    expect(t('feed.create')).toBe('Izradi poveznicu');
    expect(t('feed.regenerate')).toBe('Izradi novu poveznicu');
    expect(t('feed.turnOff')).toBe('Isključi');
    expect(t('feed.copy')).toBe('Kopiraj');
    expect(t('feed.google.add')).toBe('Dodaj u Google kalendar');
    expect(t('feed.apple.add')).toBe('Dodaj u Apple kalendar');
    // The fixed note, verbatim from the v2 proposal.
    expect(t('feed.googleLag')).toBe('Google kalendar osvježava pretplate rjeđe — promjene se mogu pojaviti i do dan kasnije. Shift je uvijek točan.');
    // A fault asks to try again; a refusal does not, another try is refused the same.
    expect(t(feedFailureMessageKey(CALENDAR_FEED_UNAVAILABLE))).toContain('Pokušaj ponovno');
    expect(t(feedFailureMessageKey(CALENDAR_FEED_REFUSED))).not.toContain('Pokušaj ponovno');
    expect(feedFailureMessageKey(CALENDAR_FEED_MEMBER_UNKNOWN)).toBe('feed.member.unknown');
    expect(t('feed.fetched')).toBe('Poveznica je preuzeta.');
    expect(t('feed.masked')).toBe('Poveznica je skrivena.');
    // UX-DR54: with no link, ONE sentence.
    expect(t('feed.lede').match(/[.?]/g)).toHaveLength(1);
    expect(t('history.record.calendarFeed')).toBe('Kalendar na mobitelu');
  });
});

describe('the link card’s writes (pure transitions, the hook only sends)', () => {
  const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';

  it('holds a created link, moves focus to it, and asks for a re-read', () => {
    const settled = feedWriteSettled(feedWriteStarted(FEED_WRITE_INITIAL, FEED_CREATING), FEED_CREATING, { ok: true, token: TOKEN });
    expect(settled.reread).toBe(true);
    expect(settled.state).toEqual({ token: TOKEN, stage: FEED_IDLE, failure: null, turnedOff: false, focus: FEED_FOCUS_LINK, landed: 1 });
  });

  it('replaces the link on a regenerate after a create, counted as a new landing (its card keyed by the link starts masked)', () => {
    const created = feedWriteSettled(FEED_WRITE_INITIAL, FEED_CREATING, { ok: true, token: TOKEN }).state;
    const armed = feedArmed(created, FEED_REGENERATE_ARMED);
    expect(armed.stage).toBe(FEED_REGENERATE_ARMED);
    expect(armed.token).toBe(TOKEN);
    const started = feedWriteStarted(armed, FEED_REGENERATING);
    expect(started.token, 'the shown link stays while the request is out').toBe(TOKEN);
    const regenerated = feedWriteSettled(started, FEED_REGENERATING, { ok: true, token: OTHER }).state;
    expect(regenerated).toMatchObject({ token: OTHER, stage: FEED_IDLE, focus: FEED_FOCUS_LINK, landed: 2 });
    expect(feedUrlsOf(PROJECT, OTHER).https).not.toBe(feedUrlsOf(PROJECT, TOKEN).https);
  });

  it.each([CALENDAR_FEED_REFUSED, CALENDAR_FEED_UNAVAILABLE] as const)(
    'drops any shown link on a %s create, regenerate or turn-off, keeps a confirmed write’s dialog open, and re-reads',
    (code) => {
      const holding = feedWriteSettled(FEED_WRITE_INITIAL, FEED_CREATING, { ok: true, token: TOKEN }).state;
      for (const [write, stage] of [
        [FEED_CREATING, FEED_IDLE],
        [FEED_REGENERATING, FEED_REGENERATE_ARMED],
        [FEED_TURNING_OFF, FEED_TURN_OFF_ARMED],
      ] as const) {
        const settled = feedWriteSettled(feedWriteStarted(holding, write), write, { ok: false, code });
        expect(settled.reread).toBe(true);
        expect(settled.state).toMatchObject({ token: null, stage, failure: code, turnedOff: false, focus: null, landed: holding.landed });
      }
    },
  );

  it('drops the link on a landed turn-off and moves focus to the card', () => {
    const holding = feedWriteSettled(FEED_WRITE_INITIAL, FEED_CREATING, { ok: true, token: TOKEN }).state;
    const off = feedWriteSettled(feedWriteStarted(holding, FEED_TURNING_OFF), FEED_TURNING_OFF, { ok: true }).state;
    expect(off).toEqual({ token: null, stage: FEED_IDLE, failure: null, turnedOff: true, focus: FEED_FOCUS_CARD, landed: 2 });
  });

  it('cancels a confirmation, but never one whose request is out', () => {
    const armed = feedArmed({ ...FEED_WRITE_INITIAL, failure: CALENDAR_FEED_REFUSED }, FEED_TURN_OFF_ARMED);
    expect(armed.failure).toBeNull();
    expect(feedCancelled(armed).stage).toBe(FEED_IDLE);
    const out = feedWriteStarted(armed, FEED_TURNING_OFF);
    expect(feedCancelled(out)).toBe(out);
  });

  it('asks for no token where no link could be shown: a project URL that is not http(s)', () => {
    expect(isFeedProjectUrl(PROJECT)).toBe(true);
    expect(isFeedProjectUrl('http://127.0.0.1:54321/')).toBe(true);
    for (const bad of [null, '', ' ', 'api.shift.example', 'ftp://x', 'https://']) expect(isFeedProjectUrl(bad), String(bad)).toBe(false);
  });
});

describe('the admin card (UX-DR55)', () => {
  it('opens the confirmation only online and while the link is live', () => {
    expect(memberFeedArmed(MEMBER_FEED_WRITE_INITIAL, true, true).armed).toBe(true);
    expect(memberFeedArmed(MEMBER_FEED_WRITE_INITIAL, false, true).armed).toBe(false);
    expect(memberFeedArmed(MEMBER_FEED_WRITE_INITIAL, true, false).armed).toBe(false);
  });

  it('keeps the dialog open on a refusal, closes it and counts a landing on success, and re-reads either way', () => {
    const armed = { ...memberFeedArmed(MEMBER_FEED_WRITE_INITIAL, true, true), busy: true };
    const refused = memberFeedSettled(armed, { ok: false, code: CALENDAR_FEED_REFUSED });
    expect(refused).toEqual({ state: { armed: true, busy: false, failure: CALENDAR_FEED_REFUSED, turnedOff: false, landed: 0 }, reread: true });
    const landed = memberFeedSettled(armed, { ok: true });
    expect(landed).toEqual({ state: { armed: false, busy: false, failure: null, turnedOff: true, landed: 1 }, reread: true });
  });

  it('offers a retry for an unavailable read only', () => {
    expect(memberFeedReadRetryable(CALENDAR_FEED_UNAVAILABLE)).toBe(true);
    expect(memberFeedReadRetryable(CALENDAR_FEED_REFUSED)).toBe(false);
    expect(memberFeedReadRetryable(CALENDAR_FEED_MEMBER_UNKNOWN)).toBe(false);
    expect(memberFeedReadMessageKey(CALENDAR_FEED_UNAVAILABLE)).toBe('feed.member.unavailable');
    expect(memberFeedReadMessageKey(CALENDAR_FEED_REFUSED)).toBe('feed.member.refused');
    expect(memberFeedReadMessageKey(CALENDAR_FEED_MEMBER_UNKNOWN)).toBe('feed.member.unknown');
  });
});

describe('the copy (story 7.8’s terms)', () => {
  it('answers whether it landed and never throws', async () => {
    const written: string[] = [];
    expect(await copyLink({ writeText: (text) => (written.push(text), Promise.resolve()) }, 'x')).toBe(LINK_COPIED);
    expect(written).toEqual(['x']);
    expect(await copyLink(undefined, 'x')).toBe(LINK_NOT_COPIED);
    expect(await copyLink({ writeText: () => Promise.reject(new Error('denied')) }, 'x')).toBe(LINK_NOT_COPIED);
    expect(linkCopyMessageKey(LINK_COPIED)).toBe('feed.copied');
    expect(linkCopyMessageKey(LINK_NOT_COPIED)).toBe('feed.copyFailed');
  });
});

describe('the token never reaches the query cache (AC: a revisit shows no part of it)', () => {
  const hook = readFileSync(fileURLToPath(new URL('../hooks/use-calendar-feed.ts', import.meta.url)), 'utf8');

  it('keeps the token in component state only: the state read is re-read, never set from the answer', () => {
    expect(hook).toContain('useState<FeedWriteState>(FEED_WRITE_INITIAL)');
    expect(hook).not.toMatch(/setQueryData|setQueriesData|queryClient|localStorage|sessionStorage|indexedDB|history\.|navigate\(/);
    // The one key is constant: no part of an answer is in it.
    expect(hook).toContain('queryKey: CALENDAR_FEED_KEY,');
    expect(CALENDAR_FEED_KEY).toEqual(['calendar-feed']);
    expect(hook).not.toMatch(/console\./);
  });
});
