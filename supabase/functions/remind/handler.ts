/**
 * remind — every decision of the reminder job (AD-14 as amended by Architect
 * pass 1; story 17.2; D5, Q25).
 *
 *   POST /functions/v1/remind      Authorization: Bearer <invoke secret>
 *
 * Its only caller is the `remind` cron job (`private.invoke_remind()`, every
 * five minutes), which carries the invoke secret from Vault as its bearer
 * token. That is no JWT, so the function is `verify_jwt = false` and compares
 * the secret in constant time: a missing or wrong one is a 401
 * `INVOKE_SECRET_REFUSED` before anything is called.
 *
 * THE RUN, and nothing else:
 *
 *   1. one POST to `reminder_inputs` (the `service_role`-only read): the
 *      database's `now` and, per member with reminders on who is active
 *      today, their leads, window and AD-19 assembly;
 *   2. per member, `shiftRemindersDueOf` (`@shift/domain`, AD-7) over that
 *      assembly with the DATABASE's clock, so a skewed host cannot move the
 *      window (the function never reads its own clock for it);
 *   3. POSTs to `enqueue_shift_reminders` with every item due, when there is
 *      any, in chunks of at most {@link ENQUEUE_CHUNK} items, one call per
 *      chunk. The RPC re-checks the state and writes the outbox rows; its
 *      unique key makes every later write of the same item nothing (Q25):
 *      the domain's window is four runs wide, so each item is sent by about
 *      four consecutive runs.
 *
 * One member whose row is not an object, whose frame is malformed, or whose
 * assembly breaks a domain precondition is skipped (`REMINDER_MEMBER_SKIPPED`),
 * not the run. A read that fails, answers other than 200, or is not
 * `{ now: safe integer, members: array }` is a 503
 * `REMINDER_INPUTS_UNAVAILABLE` with nothing written; any chunk of the write
 * that fails makes the run a 503 `REMINDER_ENQUEUE_FAILED` (chunks already
 * written stay: a rerun's items insert nothing). Each call is bounded at
 * {@link RPC_TIMEOUT_MS}.
 *
 * `accepted` in the answer is the sum of the RPC's answers: the items that
 * passed the write-time re-check, NOT rows inserted (an item is accepted by
 * each of the about four runs that send it).
 *
 * AD-17: the gateway's address, the secret key (for its two RPCs only, sent
 * as `apikey`) and its own invoke secret are its whole environment. No
 * Resend, VAPID or publishable key. LOGS carry fixed codes only: never an id,
 * a body or a key.
 *
 * This file imports only `@shift/domain`, so Vitest asserts it with injected
 * fakes (AD-15); `index.ts` is the Deno wiring.
 */

import { reminderLeadsOf, shiftRemindersDueOf, type ScheduleInputs, type ShiftReminder } from '@shift/domain';

/** How long each of the two calls may take before the run is answered 503. */
export const RPC_TIMEOUT_MS = 10_000;

/** The most items one write carries: well inside the RPC's own cap of 10 000. */
export const ENQUEUE_CHUNK = 1000;

export const INPUTS_RPC = 'reminder_inputs';
export const ENQUEUE_RPC = 'enqueue_shift_reminders';

export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
export const INVOKE_SECRET_REFUSED = 'INVOKE_SECRET_REFUSED';
export const REMINDER_INPUTS_UNAVAILABLE = 'REMINDER_INPUTS_UNAVAILABLE';
export const REMINDER_ENQUEUE_FAILED = 'REMINDER_ENQUEUE_FAILED';
/** One member's assembly broke a rule: that member is skipped, the run goes on. */
export const REMINDER_MEMBER_SKIPPED = 'REMINDER_MEMBER_SKIPPED';
export const REMIND_RAN = 'REMIND_RAN';

/** The invoke secret's shape, as `notify`'s: at least 32 URL-safe characters. */
export const INVOKE_SECRET_SHAPE = /^[A-Za-z0-9_-]{32,}$/;

export type ConfigurationCode =
  | 'PROJECT_URL_MISSING'
  | 'PROJECT_URL_INVALID'
  | 'SECRET_KEY_MISSING'
  | 'SECRET_KEY_INVALID'
  | 'INVOKE_SECRET_MISSING'
  | 'INVOKE_SECRET_INVALID';

export interface Configuration {
  readonly projectUrl: string;
  readonly secretKey: string;
  readonly invokeSecret: string;
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

/** The function's whole environment (AD-17): three variables, each checked. */
export function readConfiguration(getEnv: (name: string) => string | undefined): ConfigurationResult {
  const read = (name: string): string => (getEnv(name) ?? '').trim();

  const projectUrl = read('SUPABASE_URL');
  const secretKey = read('SHIFT_SECRET_KEY');
  const invokeSecret = read('REMIND_INVOKE_SECRET');

  if (projectUrl === '') return { ok: false, code: 'PROJECT_URL_MISSING' };
  if (!isHttpUrl(projectUrl)) return { ok: false, code: 'PROJECT_URL_INVALID' };
  if (secretKey === '') return { ok: false, code: 'SECRET_KEY_MISSING' };
  if (!/^sb_secret_[A-Za-z0-9._-]+$/.test(secretKey)) return { ok: false, code: 'SECRET_KEY_INVALID' };
  if (invokeSecret === '') return { ok: false, code: 'INVOKE_SECRET_MISSING' };
  if (!INVOKE_SECRET_SHAPE.test(invokeSecret)) return { ok: false, code: 'INVOKE_SECRET_INVALID' };
  return { ok: true, configuration: { projectUrl: projectUrl.replace(/\/+$/, ''), secretKey, invokeSecret } };
}

export interface RemindDependencies {
  /** The runtime's `fetch`, used for the two RPCs and nothing else. */
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** A signal that aborts after `milliseconds` (the runtime's `AbortSignal.timeout`). */
  readonly timeout: (milliseconds: number) => AbortSignal;
  /** Where the fixed codes go. */
  readonly log: (code: string) => void;
}

/**
 * Whether `given` is `expected`, in time that does not depend on where they
 * first differ (`notify`'s comparison): the loop runs over the longer of the
 * two, so the timing tells a caller only the length of what they sent.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function bearerOf(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? null;
}

function respond(status: number, body: { readonly code: string; readonly [operand: string]: unknown }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** One member as the read answers: the domain checks the rows, this only the frame. */
export interface ReminderMember {
  readonly memberId: unknown;
  readonly leads: unknown;
  readonly window: unknown;
  readonly inputs: unknown;
}

/** The read's frame: the database's clock and the members, unchecked. */
export interface ReminderRead {
  /** The database's clock, epoch milliseconds. */
  readonly now: number;
  /** Each checked by {@link remindersOfMember}. */
  readonly members: readonly unknown[];
}

/**
 * The read's answer, or null when it is not `{ now, members }` (then nothing
 * is written). The members are checked one by one by
 * {@link remindersOfMember}: a broken one skips that member alone.
 */
export function readOf(answer: unknown): ReminderRead | null {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return null;
  const { now, members } = answer as { now?: unknown; members?: unknown };
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now <= 0) return null;
  if (!Array.isArray(members)) return null;
  return { now, members: members as readonly unknown[] };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The frame AD-19 shapes, as `calendar-feed` checks it; its rows are the domain's preconditions'. */
function inputsOf(value: unknown, memberId: string): ScheduleInputs | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  for (const key of ['organizationId', 'timeZone', 'memberId']) {
    if (typeof frame[key] !== 'string' || frame[key] === '') return null;
  }
  if (frame['memberId'] !== memberId) return null;
  for (const key of ['teams', 'shiftTypes', 'steps', 'assignments', 'assignmentStamps', 'members', 'overrides', 'rosterOverrides', 'leave']) {
    if (!Array.isArray(frame[key])) return null;
  }
  return value as ScheduleInputs;
}

/**
 * The reminders due for one member, or null when their row is not the read's
 * shape or their assembly breaks a domain precondition: the caller skips
 * them. The clock is the database's.
 */
export function remindersOfMember(member: unknown, now: number): readonly ShiftReminder[] | null {
  if (typeof member !== 'object' || member === null || Array.isArray(member)) return null;
  const { memberId, leads, window, inputs } = member as ReminderMember;
  if (typeof memberId !== 'string' || memberId === '') return null;
  const chosen = reminderLeadsOf(leads);
  if (chosen === null) return null;
  const { from, to } = (typeof window === 'object' && window !== null ? window : {}) as { from?: unknown; to?: unknown };
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to)) return null;
  const assembly = inputsOf(inputs, memberId);
  if (assembly === null) return null;
  try {
    return shiftRemindersDueOf(assembly, chosen, { from, to }, now);
  } catch {
    // A RangeError from the domain's preconditions. Never its message: it may name an id.
    return null;
  }
}

async function post(
  configuration: Configuration,
  rpc: string,
  body: unknown,
  dependencies: RemindDependencies,
): Promise<{ readonly ok: true; readonly answer: unknown } | { readonly ok: false }> {
  let response: Response;
  try {
    response = await dependencies.fetch(`${configuration.projectUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: configuration.secretKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: dependencies.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    return { ok: false };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false };
  }
  try {
    return { ok: true, answer: JSON.parse(await response.text()) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Build the function's request handler. When `configuration` failed to read,
 * every request answers 500 with that code (AD-17's fail-fast).
 */
export function createHandler(
  configuration: ConfigurationResult,
  dependencies: RemindDependencies,
): (request: Request) => Promise<Response> {
  return async function handle(request: Request): Promise<Response> {
    if (!configuration.ok) return respond(500, { code: configuration.code });

    if (request.method.toUpperCase() !== 'POST') {
      return new Response(JSON.stringify({ code: METHOD_NOT_ALLOWED }), {
        status: 405,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', allow: 'POST' },
      });
    }

    const given = bearerOf(request.headers.get('Authorization'));
    if (given === null || !sameSecret(given, configuration.configuration.invokeSecret)) {
      return respond(401, { code: INVOKE_SECRET_REFUSED });
    }

    const read = await post(configuration.configuration, INPUTS_RPC, {}, dependencies);
    const answer = read.ok ? readOf(read.answer) : null;
    if (answer === null) {
      dependencies.log(REMINDER_INPUTS_UNAVAILABLE);
      return respond(503, { code: REMINDER_INPUTS_UNAVAILABLE });
    }

    const items: ShiftReminder[] = [];
    let skipped = 0;
    for (const member of answer.members) {
      const due = remindersOfMember(member, answer.now);
      if (due === null) {
        skipped += 1;
        dependencies.log(REMINDER_MEMBER_SKIPPED);
        continue;
      }
      items.push(...due);
    }

    // Items that passed the RPC's write-time re-check, not rows inserted.
    let accepted = 0;
    for (let start = 0; start < items.length; start += ENQUEUE_CHUNK) {
      const chunk = items.slice(start, start + ENQUEUE_CHUNK);
      const write = await post(configuration.configuration, ENQUEUE_RPC, { p_items: chunk }, dependencies);
      if (!write.ok || typeof write.answer !== 'number' || !Number.isSafeInteger(write.answer)) {
        dependencies.log(REMINDER_ENQUEUE_FAILED);
        return respond(503, { code: REMINDER_ENQUEUE_FAILED });
      }
      accepted += write.answer;
    }

    return respond(200, { code: REMIND_RAN, members: answer.members.length, due: items.length, accepted, skipped });
  };
}
