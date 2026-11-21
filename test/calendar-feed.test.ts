import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { atWorkShiftsOf, type ScheduleInputs } from '../packages/domain/src/index.ts';
import { PARITY_FIXTURES, PARITY_VECTOR, inputsOf } from '../packages/domain/parity/fixtures.ts';
import {
  CALENDAR_HEADERS,
  FEED_FAILED,
  FEED_NOT_FOUND,
  FEED_UNAVAILABLE,
  LOOKUP_TIMEOUT_MS,
  METHOD_NOT_ALLOWED,
  MISS_FLOOR_MS,
  createHandler,
  readConfiguration,
  tokenHashOf,
  tokenOf,
  type ConfigurationResult,
  type FeedDependencies,
} from '../supabase/functions/calendar-feed/handler.ts';

/**
 * Story 16.4: the `calendar-feed` Edge Function's decisions (AD-14, AD-17,
 * AD-20; D-S1, D-S2, D-S8), asserted against a fake PostgREST and a fake
 * clock (AD-15), with the real domain and serializer. The same handler runs
 * under the pinned edge-runtime in the image probe and in CI's e2e.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...path: string[]): string => readFileSync(join(repoRoot, ...path), 'utf8');

/** AD-19's pinned vector: the token and the hash the SQL suite pins too. */
const VECTOR_HASH = '2375020bdd6e9ec86da48c727c62d31ca48a92d7ae541c1b47e8b9ec67dcc232';
/** Another canonical token, which no row holds: `x` × 42 and a last character the encoding allows. */
const UNKNOWN_TOKEN = `${'x'.repeat(42)}A`;

const PUBLISHABLE = `sb_publishable_${'p'.repeat(32)}`;
const CONFIGURED: ConfigurationResult = {
  ok: true,
  configuration: { projectUrl: 'http://supabase-kong:8000', publishableKey: PUBLISHABLE },
};

const ARRIVED = Date.UTC(2026, 10, 21, 12, 34, 56, 789);
const WINDOW = { from: '2026-10-21', to: '2027-05-22' };

const pilot = PARITY_FIXTURES[0]?.organization;
if (pilot === undefined) throw new Error('no pilot fixture');
const MEMBER = pilot.members[0]?.id ?? '';
const INPUTS = inputsOf(pilot, MEMBER) as unknown as ScheduleInputs;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

type Answer = { status: number; body: string } | 'throw';

/** A handler over a fake PostgREST answering `answer`, and a clock that only `sleep` moves. */
function harness(
  answer: Answer | 'hang' = { status: 200, body: 'null' },
  configuration: ConfigurationResult = CONFIGURED,
  overrides: Partial<FeedDependencies> = {},
) {
  const calls: Call[] = [];
  const logged: string[] = [];
  const slept: number[] = [];
  const timeouts: number[] = [];
  let clock = ARRIVED;
  const dependencies: FeedDependencies = {
    fetch: (url, init) => {
      calls.push({ url, init });
      // The round trip itself takes a few milliseconds.
      clock += 7;
      if (answer === 'throw') return Promise.reject(new TypeError('connection refused'));
      if (answer === 'hang') {
        // Answers nothing until the request's own signal aborts it, as a stalled gateway.
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        });
      }
      return Promise.resolve(new Response(answer.body, { status: answer.status }));
    },
    now: () => clock,
    sleep: (milliseconds) => {
      slept.push(milliseconds);
      clock += milliseconds;
      return Promise.resolve();
    },
    digest: (data) => crypto.subtle.digest('SHA-256', data),
    log: (code) => logged.push(code),
    // The bound is recorded, and fires at once: the test needs no 10 s wait.
    timeout: (milliseconds) => {
      timeouts.push(milliseconds);
      const controller = new AbortController();
      if (answer === 'hang') queueMicrotask(() => controller.abort(new DOMException('timed out', 'TimeoutError')));
      return controller.signal;
    },
    ...overrides,
  };
  return {
    handle: createHandler(configuration, dependencies),
    calls,
    logged,
    slept,
    timeouts,
    elapsed: () => clock - ARRIVED,
  };
}

const feedRequest = (token: string, method = 'GET', prefix = '/functions/v1'): Request =>
  new Request(`http://supabase-edge-functions:9000${prefix}/calendar-feed/${token}.ics`, { method });

const hit = (inputs: unknown = INPUTS, window: unknown = WINDOW): Answer => ({
  status: 200,
  body: JSON.stringify({ window, inputs }),
});

async function shapeOf(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers.entries()].sort(),
    body: await response.text(),
  };
}

const lines = (text: string): string[] => text.replaceAll('\r\n ', '').split('\r\n');

// -------------------------------------------------------- the configuration

describe('calendar-feed: its environment (AD-17)', () => {
  it('reads the gateway’s address and the publishable key, and nothing else', () => {
    const env: Record<string, string> = { SUPABASE_URL: 'http://supabase-kong:8000/', SHIFT_PUBLISHABLE_KEY: PUBLISHABLE };
    expect(readConfiguration((name) => env[name])).toEqual(CONFIGURED);
  });

  it('refuses a missing or malformed address or key, and a secret key in its place', () => {
    const cases: [Record<string, string>, string][] = [
      [{ SHIFT_PUBLISHABLE_KEY: PUBLISHABLE }, 'PROJECT_URL_MISSING'],
      [{ SUPABASE_URL: 'supabase-kong:8000', SHIFT_PUBLISHABLE_KEY: PUBLISHABLE }, 'PROJECT_URL_INVALID'],
      [{ SUPABASE_URL: 'http://user:pass@kong:8000', SHIFT_PUBLISHABLE_KEY: PUBLISHABLE }, 'PROJECT_URL_INVALID'],
      [{ SUPABASE_URL: 'http://kong:8000/?x=1', SHIFT_PUBLISHABLE_KEY: PUBLISHABLE }, 'PROJECT_URL_INVALID'],
      [{ SUPABASE_URL: 'http://kong:8000/#x', SHIFT_PUBLISHABLE_KEY: PUBLISHABLE }, 'PROJECT_URL_INVALID'],
      [{ SUPABASE_URL: 'http://kong:8000' }, 'PUBLISHABLE_KEY_MISSING'],
      [{ SUPABASE_URL: 'http://kong:8000', SHIFT_PUBLISHABLE_KEY: `sb_secret_${'s'.repeat(32)}` }, 'PUBLISHABLE_KEY_INVALID'],
      [{ SUPABASE_URL: 'http://kong:8000', SHIFT_PUBLISHABLE_KEY: 'eyJhbGciOi.anon.jwt' }, 'PUBLISHABLE_KEY_INVALID'],
    ];
    for (const [env, code] of cases) expect(readConfiguration((name) => env[name])).toEqual({ ok: false, code });
  });

  it('answers 503 when misconfigured, and still 404 for a path that is no feed', async () => {
    const { handle, calls, logged } = harness(undefined, { ok: false, code: 'PUBLISHABLE_KEY_MISSING' });
    const response = await handle(feedRequest(PARITY_VECTOR));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: FEED_UNAVAILABLE });
    expect((await handle(feedRequest('short'))).status).toBe(404);
    expect(calls).toEqual([]);
    expect(logged).toEqual([FEED_UNAVAILABLE]);
  });
});

// -------------------------------------------------------- the token

describe('calendar-feed: the token in the path (AD-14)', () => {
  it('hashes the pinned vector to the hash the SQL suite pins', async () => {
    expect(await tokenHashOf(PARITY_VECTOR, (data) => crypto.subtle.digest('SHA-256', data))).toBe(VECTOR_HASH);
    expect(createHash('sha256').update(PARITY_VECTOR, 'utf8').digest('hex')).toBe(VECTOR_HASH);
  });

  it('takes the canonical 43 characters, with or without the gateway’s prefix, and nothing else', () => {
    const base = 'http://x:9000';
    expect(tokenOf(`${base}/functions/v1/calendar-feed/${PARITY_VECTOR}.ics`)).toBe(PARITY_VECTOR);
    expect(tokenOf(`${base}/calendar-feed/${PARITY_VECTOR}.ics`)).toBe(PARITY_VECTOR);
    // A query string is not part of the path (a calendar app may add one).
    expect(tokenOf(`${base}/calendar-feed/${PARITY_VECTOR}.ics?x=1`)).toBe(PARITY_VECTOR);
    for (const path of [
      `/calendar-feed/${PARITY_VECTOR}`,
      `/calendar-feed/${PARITY_VECTOR}.ICS`,
      `/calendar-feed/${PARITY_VECTOR}.ics/`,
      `/calendar-feed/${PARITY_VECTOR.slice(0, 42)}.ics`,
      `/calendar-feed/${PARITY_VECTOR}x.ics`,
      // The last character carries 4 bits: B is never the 43rd of 32 bytes.
      `/calendar-feed/${'x'.repeat(42)}B.ics`,
      `/calendar-feed/${'x'.repeat(41)}%2DA.ics`,
      `/calendar-feed/${'x'.repeat(41)}+A.ics`,
      `/calendar-feed/a/${PARITY_VECTOR}.ics`,
      `/other/calendar-feed/${PARITY_VECTOR}.ics`,
      `/functions/v1/calendar-feed/${PARITY_VECTOR}.ics.ics`,
    ]) {
      expect(tokenOf(`${base}${path}`), path).toBeNull();
    }
  });
});

// -------------------------------------------------------- a hit

describe('calendar-feed: a live token (AD-14, AD-20)', () => {
  it('asks the one anon RPC by POST with the hash alone, and answers the calendar of R12', async () => {
    const { handle, calls, logged, slept } = harness(hit());
    const response = await handle(feedRequest(PARITY_VECTOR));

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('http://supabase-kong:8000/rest/v1/rpc/calendar_feed_inputs');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe(JSON.stringify({ p_token_hash: VECTOR_HASH }));
    expect(call?.init.headers).toEqual({ apikey: PUBLISHABLE, 'content-type': 'application/json', accept: 'application/json' });
    // A gateway's redirect is never followed: the hash and the key go nowhere else.
    expect(call?.init.redirect).toBe('manual');
    expect(JSON.stringify(call)).not.toContain(PARITY_VECTOR);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual(CALENDAR_HEADERS);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, max-age=900');

    const text = await response.text();
    const shifts = atWorkShiftsOf(INPUTS, WINDOW.from, WINDOW.to);
    expect(shifts.length).toBeGreaterThan(20);
    const unfolded = lines(text);
    expect(unfolded.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(shifts.length);
    expect(unfolded).toContain('X-WR-TIMEZONE:Europe/Zagreb');
    expect(unfolded.filter((line) => line.startsWith('DTSTAMP:'))[0]).toBe('DTSTAMP:20261121T123456Z');
    expect(text).not.toMatch(/DESCRIPTION|LOCATION|ATTENDEE|ORGANIZER/);
    expect(logged).toEqual([]);
    expect(slept).toEqual([]);
  });

  it('answers HEAD with the same status and headers and no body, and still asks the RPC (a fetch)', async () => {
    const { handle, calls } = harness(hit());
    const response = await handle(feedRequest(PARITY_VECTOR, 'HEAD'));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual(CALENDAR_HEADERS);
    expect(await response.text()).toBe('');
    expect(calls).toHaveLength(1);
  });

  it('serves the path without the gateway’s prefix, as the CLI hands it over', async () => {
    const { handle } = harness(hit());
    expect((await handle(feedRequest(PARITY_VECTOR, 'GET', ''))).status).toBe(200);
  });
});

// -------------------------------------------------------- every miss

describe('calendar-feed: one answer for every miss (D-S8, NFR-27)', () => {
  it('answers a malformed token and every RPC miss with one identical 404, none before the floor', async () => {
    const shapes: unknown[] = [];
    for (const [request, answer] of [
      [feedRequest('not-a-token'), undefined],
      [feedRequest(`${'x'.repeat(42)}B`), undefined],
      // Unknown, revoked, replaced and deactivated: the lookup answers one null for all of them (16.3).
      [feedRequest(UNKNOWN_TOKEN), { status: 200, body: 'null' }],
      [feedRequest(PARITY_VECTOR), { status: 200, body: 'null' }],
      [feedRequest(PARITY_VECTOR), { status: 200, body: ' null\n' }],
    ] as const) {
      const { handle, elapsed, logged } = harness(answer);
      const response = await handle(request);
      shapes.push(await shapeOf(response));
      expect(elapsed(), request.url).toBeGreaterThanOrEqual(MISS_FLOOR_MS);
      expect(elapsed(), request.url).toBeLessThan(MISS_FLOOR_MS + 10);
      expect(logged).toEqual([]);
    }
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
    expect(shapes[0]).toEqual({
      status: 404,
      headers: [
        ['cache-control', 'no-store'],
        ['content-type', 'application/json'],
        ['x-content-type-options', 'nosniff'],
      ],
      body: JSON.stringify({ code: FEED_NOT_FOUND }),
    });
  });

  it('answers a HEAD miss with the same status and headers and no body', async () => {
    const { handle: timed, elapsed } = harness();
    const response = await timed(feedRequest(UNKNOWN_TOKEN, 'HEAD'));
    expect(elapsed()).toBeGreaterThanOrEqual(MISS_FLOOR_MS);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('never holds a miss longer than the floor, even when the wall clock steps back', async () => {
    let calls = 0;
    // The arrival reads the clock; the miss then reads it an hour earlier.
    const { handle, slept } = harness(undefined, CONFIGURED, { now: () => (calls++ === 0 ? ARRIVED : ARRIVED - 3_600_000) });
    const response = await handle(feedRequest('not-a-token'));
    expect(response.status).toBe(404);
    expect(slept).toEqual([MISS_FLOOR_MS]);
  });

  it('never sends a malformed token anywhere, and never logs a token or a hash', async () => {
    const malformed = harness();
    await malformed.handle(feedRequest(`${'A'.repeat(42)}B`));
    expect(malformed.calls).toEqual([]);

    for (const answer of [hit(), { status: 200, body: 'null' }, 'throw', { status: 500, body: 'x' }] as const) {
      const { handle, logged } = harness(answer);
      await handle(feedRequest(PARITY_VECTOR));
      expect(logged.join(' ')).not.toContain(PARITY_VECTOR);
      expect(logged.join(' ')).not.toContain(VECTOR_HASH);
      for (const code of logged) expect([FEED_UNAVAILABLE, FEED_FAILED]).toContain(code);
    }
  });
});

// -------------------------------------------------------- refusals

describe('calendar-feed: what is not a fetch', () => {
  it('answers any method but GET and HEAD 405 with Allow, before reading the path', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const { handle, calls } = harness(hit());
      const response = await handle(feedRequest(PARITY_VECTOR, method));
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ code: METHOD_NOT_ALLOWED });
      expect(calls).toEqual([]);
    }
  });

  it('answers 503 FEED_UNAVAILABLE, never the miss, when the lookup cannot be asked or does not answer as itself', async () => {
    for (const answer of [
      'throw',
      { status: 500, body: '{}' },
      { status: 401, body: '{"message":"Invalid API key"}' },
      { status: 404, body: '{"code":"PGRST202"}' },
      { status: 301, body: '' },
      { status: 200, body: 'not json' },
      { status: 200, body: '[]' },
      { status: 200, body: '"text"' },
      hit(INPUTS, { from: '2026-10-21' }),
      hit(INPUTS, { from: 20261021, to: '2027-05-22' }),
      hit(INPUTS, { from: '2027-05-22', to: '2026-10-21' }),
      hit(null),
      hit({ ...INPUTS, timeZone: undefined }),
      hit({ ...INPUTS, memberId: 7 }),
      hit({ ...INPUTS, members: {} }),
      hit({ ...INPUTS, leave: undefined }),
    ] as const) {
      const { handle, logged, slept } = harness(answer);
      const response = await handle(feedRequest(PARITY_VECTOR));
      expect(response.status, JSON.stringify(answer)).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ code: FEED_UNAVAILABLE });
      expect(logged).toEqual([FEED_UNAVAILABLE]);
      expect(slept).toEqual([]);
    }
  });

  it('bounds the lookup: a stalled gateway is answered 503 once the lookup’s signal aborts', async () => {
    const { handle, calls, timeouts, logged } = harness('hang');
    const response = await handle(feedRequest(PARITY_VECTOR));
    expect(timeouts).toEqual([LOOKUP_TIMEOUT_MS]);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: FEED_UNAVAILABLE });
    expect(logged).toEqual([FEED_UNAVAILABLE]);
    // Under the router's worker wall clock (140 s) and a calendar client's patience.
    expect(LOOKUP_TIMEOUT_MS).toBe(10_000);
  });

  it('answers 500 FEED_FAILED when the token cannot be hashed, and asks nothing', async () => {
    const { handle, calls, logged } = harness(hit(), CONFIGURED, { digest: () => Promise.reject(new Error('no crypto')) });
    const response = await handle(feedRequest(PARITY_VECTOR));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: FEED_FAILED });
    expect(calls).toEqual([]);
    expect(logged).toEqual([FEED_FAILED]);
  });

  it('answers 500 FEED_FAILED, naming nothing, when the assembly breaks a domain precondition', async () => {
    const broken = { ...INPUTS, memberId: 'nobody' };
    const { handle, logged } = harness(hit(broken));
    const response = await handle(feedRequest(PARITY_VECTOR));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: FEED_FAILED });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(logged).toEqual([FEED_FAILED]);
  });
});

// -------------------------------------------------------- the source

describe('calendar-feed: its source (AD-7, AD-14, AD-17)', () => {
  const directory = ['supabase', 'functions', 'calendar-feed'];
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const handler = code(read(...directory, 'handler.ts'));
  const wiring = code(read(...directory, 'index.ts'));

  it('maps both packages onto their built dist, and imports nothing else', () => {
    expect(JSON.parse(read(...directory, 'deno.json'))).toEqual({
      imports: {
        '@shift/domain': '../../../packages/domain/dist/index.js',
        '@shift/ics': '../../../packages/ics/dist/index.js',
      },
    });
    expect([...handler.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])).toEqual(['@shift/domain', '@shift/ics']);
    expect([...wiring.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])).toEqual(['./handler.ts']);
    for (const text of [handler, wiring]) expect(text).not.toMatch(/npm:|jsr:|https?:\/\/(?!supabase)|\bimport\s*\(/);
  });

  it('logs fixed codes only, never a URL, a header or a token', () => {
    expect(handler, 'handler.ts logs directly').not.toMatch(/console\./);
    const calls = [...wiring.matchAll(/console\.\w+\(([^()]*)\)/g)].map((match) => match[1]);
    expect(calls).toEqual(['`calendar-feed is misconfigured: ${configuration.code}`', '`calendar-feed: ${code}`']);
  });

  it('holds no secret key, client or table access', () => {
    for (const text of [handler, wiring]) {
      expect(text).not.toMatch(/SHIFT_SECRET_KEY|sb_secret_|service_role|createClient|\.from\(|\/rest\/v1\/(?!rpc\/calendar_feed_inputs)/);
    }
  });
});
