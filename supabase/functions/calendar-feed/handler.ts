/**
 * calendar-feed — every decision of the public feed (AD-14 as amended by
 * Architect pass 1; story 16.4; D-S1, D-S2, D-S8).
 *
 *   GET  /functions/v1/calendar-feed/<token>.ics
 *   HEAD /functions/v1/calendar-feed/<token>.ics
 *
 * The token is the only credential: a calendar app sends a URL and nothing
 * else, so the function is `verify_jwt = false` and holds the PUBLISHABLE key
 * alone (AD-17). It hashes the token with WebCrypto's SHA-256 and sends only
 * the 64 lowercase hex characters, by POST (the RPC is VOLATILE: it stamps
 * `last_fetched_at`), to `public.calendar_feed_inputs`, the one function
 * `anon` may execute. So the token itself never reaches Postgres or its logs.
 *
 * ONE ANSWER FOR EVERY MISS (D-S8, NFR-27). A malformed, unknown, revoked,
 * replaced or deactivated token gets the same 404: the same status, the same
 * fixed body, the same headers (`Cache-Control: no-store`), and the same
 * timing class: no 404 leaves before {@link MISS_FLOOR_MS} after the request
 * arrived, so a refusal before the RPC and the RPC's own index-or-member-rule
 * difference sit under one floor. A lookup that could not be asked is not a
 * miss: it is a 503, which says nothing about the token either.
 *
 * A HIT projects R12 (`atWorkShiftsOf`, AD-7) over the RPC's own window and
 * assembly (AD-19) and serializes it with `@shift/ics` (AD-20): 200
 * `text/calendar`, `Cache-Control: private, max-age=900`. Nothing is kept
 * between requests (AD-1). A `HEAD` is a `GET` without a body, and counts as
 * a fetch.
 *
 * LOGS carry fixed codes only: never the path, the token, the hash or the
 * answer (NFR-27).
 *
 * This file imports only the two pure packages, so Vitest asserts it with
 * injected fakes (AD-15); `index.ts` is the Deno wiring.
 */

import { atWorkShiftsOf, type ScheduleInputs } from '@shift/domain';
import { FEED_UID_DOMAIN, calendarOf } from '@shift/ics';

/** No 404 is answered sooner than this after the request arrived (the timing class, D-S8). */
export const MISS_FLOOR_MS = 250;
/** How long the lookup may take before the request is answered 503. */
export const LOOKUP_TIMEOUT_MS = 10_000;

/** The path, with or without the gateway's prefix; the token is AD-14's canonical 43 characters. */
export const FEED_PATH = /^\/(?:functions\/v1\/)?calendar-feed\/([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])\.ics$/;

export const FEED_NOT_FOUND = 'FEED_NOT_FOUND';
export const FEED_UNAVAILABLE = 'FEED_UNAVAILABLE';
export const FEED_FAILED = 'FEED_FAILED';
export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';

export const CALENDAR_HEADERS = {
  'content-type': 'text/calendar; charset=utf-8',
  'cache-control': 'private, max-age=900',
  // The body holds stored names: no client may read it as anything else.
  'x-content-type-options': 'nosniff',
} as const;

const REFUSAL_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

export type ConfigurationCode =
  | 'PROJECT_URL_MISSING'
  | 'PROJECT_URL_INVALID'
  | 'PUBLISHABLE_KEY_MISSING'
  | 'PUBLISHABLE_KEY_INVALID';

export interface Configuration {
  readonly projectUrl: string;
  readonly publishableKey: string;
}

export type ConfigurationResult =
  | { readonly ok: true; readonly configuration: Configuration }
  | { readonly ok: false; readonly code: ConfigurationCode };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // No credentials, query or fragment: `/rest/v1/rpc/…` is appended to it.
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

/**
 * The function's whole environment: the gateway's address and the
 * publishable key (AD-17). A secret key in its place is refused: the feed
 * must never read past `anon`'s one grant.
 */
export function readConfiguration(getEnv: (name: string) => string | undefined): ConfigurationResult {
  const read = (name: string): string => (getEnv(name) ?? '').trim();

  const projectUrl = read('SUPABASE_URL');
  const publishableKey = read('SHIFT_PUBLISHABLE_KEY');

  if (projectUrl === '') return { ok: false, code: 'PROJECT_URL_MISSING' };
  if (!isHttpUrl(projectUrl)) return { ok: false, code: 'PROJECT_URL_INVALID' };
  if (publishableKey === '') return { ok: false, code: 'PUBLISHABLE_KEY_MISSING' };
  if (!/^sb_publishable_[A-Za-z0-9._-]+$/.test(publishableKey)) return { ok: false, code: 'PUBLISHABLE_KEY_INVALID' };
  return { ok: true, configuration: { projectUrl: projectUrl.replace(/\/+$/, ''), publishableKey } };
}

export interface FeedDependencies {
  /** The runtime's `fetch`, used for the one lookup and nothing else. */
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Epoch milliseconds: the request instant (`DTSTAMP`) and the miss floor's clock. */
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /** SHA-256 of the given octets (WebCrypto's `crypto.subtle.digest`). */
  readonly digest: (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
  /** Where the fixed codes go. */
  readonly log: (code: string) => void;
  /** A signal that aborts after `milliseconds` (the runtime's `AbortSignal.timeout`); the lookup's bound. */
  readonly timeout: (milliseconds: number) => AbortSignal;
}

/** The token's SHA-256 as 64 lowercase hex characters: the hash of its 43-character UTF-8 text (AD-14). */
export async function tokenHashOf(token: string, digest: FeedDependencies['digest']): Promise<string> {
  const bytes = new Uint8Array(await digest(new TextEncoder().encode(token)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The token in a request's path, or null when the path is not the feed's canonical form. */
export function tokenOf(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return FEED_PATH.exec(pathname)?.[1] ?? null;
}

function refusal(status: number, code: string, method: string, extra: Record<string, string> = {}): Response {
  return new Response(method === 'HEAD' ? null : JSON.stringify({ code }), {
    status,
    headers: { ...REFUSAL_HEADERS, ...extra },
  });
}

type Lookup =
  | { readonly kind: 'miss' }
  | { readonly kind: 'hit'; readonly from: string; readonly to: string; readonly inputs: ScheduleInputs }
  | { readonly kind: 'unavailable' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The RPC's answer: `null` is the one miss; `{ window, inputs }` a hit; anything else was not the lookup's. */
function lookupOf(answer: unknown): Lookup {
  if (answer === null) return { kind: 'miss' };
  if (typeof answer !== 'object' || Array.isArray(answer)) return { kind: 'unavailable' };
  const { window, inputs } = answer as { window?: unknown; inputs?: unknown };
  const { from, to } = (window ?? {}) as { from?: unknown; to?: unknown };
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to)) return { kind: 'unavailable' };
  // ISO dates order as text: a reversed window is not the lookup's either.
  if (from > to) return { kind: 'unavailable' };
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return { kind: 'unavailable' };
  // The assembly's frame, as AD-19 shapes it; its rows are the domain's
  // preconditions' to check (a breach there is a 500, not this).
  const frame = inputs as Record<string, unknown>;
  for (const key of ['organizationId', 'timeZone', 'memberId']) {
    if (typeof frame[key] !== 'string' || frame[key] === '') return { kind: 'unavailable' };
  }
  for (const key of ['teams', 'shiftTypes', 'steps', 'assignments', 'assignmentStamps', 'members', 'overrides', 'rosterOverrides', 'leave']) {
    if (!Array.isArray(frame[key])) return { kind: 'unavailable' };
  }
  return { kind: 'hit', from, to, inputs: inputs as unknown as ScheduleInputs };
}

async function lookUp(configuration: Configuration, hash: string, dependencies: FeedDependencies): Promise<Lookup> {
  let response: Response;
  try {
    response = await dependencies.fetch(`${configuration.projectUrl}/rest/v1/rpc/calendar_feed_inputs`, {
      method: 'POST',
      headers: {
        apikey: configuration.publishableKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ p_token_hash: hash }),
      redirect: 'manual',
      signal: dependencies.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unavailable' };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: 'unavailable' };
  }
  try {
    return lookupOf(JSON.parse(await response.text()) as unknown);
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Build the function's request handler. */
export function createHandler(
  configuration: ConfigurationResult,
  dependencies: FeedDependencies,
): (request: Request) => Promise<Response> {
  return async function handle(request: Request): Promise<Response> {
    const arrived = dependencies.now();
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return refusal(405, METHOD_NOT_ALLOWED, method, { allow: 'GET, HEAD' });
    }

    const miss = async (): Promise<Response> => {
      // Never longer than the floor itself: a wall clock stepped back while
      // the request ran must not hold a miss open.
      const wait = Math.min(arrived + MISS_FLOOR_MS - dependencies.now(), MISS_FLOOR_MS);
      if (wait > 0) await dependencies.sleep(wait);
      return refusal(404, FEED_NOT_FOUND, method);
    };

    const token = tokenOf(request.url);
    if (token === null) return miss();

    if (!configuration.ok) {
      dependencies.log(FEED_UNAVAILABLE);
      return refusal(503, FEED_UNAVAILABLE, method);
    }

    let hash: string;
    try {
      hash = await tokenHashOf(token, dependencies.digest);
    } catch {
      dependencies.log(FEED_FAILED);
      return refusal(500, FEED_FAILED, method);
    }

    const lookup = await lookUp(configuration.configuration, hash, dependencies);
    if (lookup.kind === 'miss') return miss();
    if (lookup.kind === 'unavailable') {
      dependencies.log(FEED_UNAVAILABLE);
      return refusal(503, FEED_UNAVAILABLE, method);
    }

    let body: string;
    try {
      const window = { from: lookup.from, to: lookup.to };
      body = calendarOf({
        inputs: lookup.inputs,
        shifts: atWorkShiftsOf(lookup.inputs, window.from, window.to),
        window,
        stamp: arrived,
        uidDomain: FEED_UID_DOMAIN,
      });
    } catch {
      // A RangeError from the domain's preconditions or the serializer: the
      // assembly broke a rule. Never its message: it may name an id.
      dependencies.log(FEED_FAILED);
      return refusal(500, FEED_FAILED, method);
    }

    return new Response(method === 'HEAD' ? null : body, { status: 200, headers: CALENDAR_HEADERS });
  };
}
