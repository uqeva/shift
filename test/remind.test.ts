import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PARITY_FIXTURES, inputsOf } from '../packages/domain/parity/fixtures.ts';
import {
  ENQUEUE_CHUNK,
  ENQUEUE_RPC,
  INPUTS_RPC,
  INVOKE_SECRET_REFUSED,
  METHOD_NOT_ALLOWED,
  REMINDER_ENQUEUE_FAILED,
  REMINDER_INPUTS_UNAVAILABLE,
  REMINDER_MEMBER_SKIPPED,
  REMIND_RAN,
  RPC_TIMEOUT_MS,
  createHandler,
  readConfiguration,
  sameSecret,
  type ConfigurationResult,
} from '../supabase/functions/remind/handler.ts';

/**
 * Story 17.2 (AD-14, AD-17, AD-15): `remind`'s handler, DB-free, with an
 * injected `fetch`. The clock is the read's (`now`, the database's), so every
 * DST and midnight case below is a pinned instant.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_URL = 'http://supabase-kong:8000';
// Throwaway values shaped as the handler demands; none is a key of anything.
const SECRET_KEY = `sb_secret_${'x'.repeat(12)}`;
const INVOKE = 'r'.repeat(48);

const [pilot] = PARITY_FIXTURES;
if (pilot === undefined) throw new Error('the parity fixture lost a fixture');

const configured = readConfiguration((name) =>
  ({ SUPABASE_URL: PROJECT_URL, SHIFT_SECRET_KEY: SECRET_KEY, REMIND_INVOKE_SECRET: INVOKE })[name],
);

interface Call {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: unknown;
}

type Answer = Response | Error;

function harness(answers: readonly Answer[], configuration: ConfigurationResult = configured) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const timeouts: number[] = [];
  const queue = [...answers];
  const handle = createHandler(configuration, {
    fetch: (input, init) => {
      calls.push({ url: input, init, body: JSON.parse(String(init.body)) as unknown });
      const next = queue.shift() ?? new Error('no answer queued');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    timeout: (milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    },
    log: (code) => logs.push(code),
  });
  return { handle, calls, logs, timeouts };
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const post = (authorization: string | null = `Bearer ${INVOKE}`, method = 'POST'): Request =>
  new Request('http://localhost/functions/v1/remind', {
    method,
    headers: authorization === null ? {} : { Authorization: authorization },
  });

const member = (memberId: string, leads: readonly string[], from: string, to: string) => ({
  memberId,
  leads,
  window: { from, to },
  inputs: inputsOf(pilot.organization, memberId),
});

const at = (iso: string): number => Date.parse(iso);

describe('remind: its environment (AD-17)', () => {
  it('reads the gateway, the secret key and its own invoke secret, and refuses each missing or malformed', () => {
    expect(configured).toEqual({
      ok: true,
      configuration: { projectUrl: PROJECT_URL, secretKey: SECRET_KEY, invokeSecret: INVOKE },
    });
    const good: Record<string, string> = { SUPABASE_URL: PROJECT_URL, SHIFT_SECRET_KEY: SECRET_KEY, REMIND_INVOKE_SECRET: INVOKE };
    const cases: readonly (readonly [string, string, string])[] = [
      ['SUPABASE_URL', '', 'PROJECT_URL_MISSING'],
      ['SUPABASE_URL', 'ftp://x', 'PROJECT_URL_INVALID'],
      ['SUPABASE_URL', 'http://u:p@host', 'PROJECT_URL_INVALID'],
      ['SHIFT_SECRET_KEY', '', 'SECRET_KEY_MISSING'],
      ['SHIFT_SECRET_KEY', `sb_publishable_${'y'.repeat(12)}`, 'SECRET_KEY_INVALID'],
      ['REMIND_INVOKE_SECRET', '', 'INVOKE_SECRET_MISSING'],
      ['REMIND_INVOKE_SECRET', 'short', 'INVOKE_SECRET_INVALID'],
      ['REMIND_INVOKE_SECRET', `${'a'.repeat(40)} b`, 'INVOKE_SECRET_INVALID'],
    ];
    for (const [name, value, code] of cases) {
      expect(readConfiguration((key) => ({ ...good, [name]: value })[key]), `${name}=${value}`).toEqual({ ok: false, code });
    }
  });

  it('answers every request 500 with the configuration code, calling nothing', async () => {
    const { handle, calls } = harness([], { ok: false, code: 'INVOKE_SECRET_MISSING' });
    const response = await handle(post());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INVOKE_SECRET_MISSING' });
    expect(calls).toEqual([]);
  });
});

describe('remind: who may run it', () => {
  it('refuses no bearer, a wrong one and a Basic header with 401 before any call', async () => {
    for (const authorization of [null, 'Bearer not-the-secret', `Bearer ${INVOKE}x`, `Basic ${INVOKE}`, 'Bearer']) {
      const { handle, calls } = harness([]);
      const response = await handle(post(authorization));
      expect(response.status, String(authorization)).toBe(401);
      expect(await response.json()).toEqual({ code: INVOKE_SECRET_REFUSED });
      expect(calls).toEqual([]);
    }
  });

  it('answers any method but POST 405, calling nothing', async () => {
    const { handle, calls } = harness([]);
    const response = await handle(post(`Bearer ${INVOKE}`, 'GET'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toEqual({ code: METHOD_NOT_ALLOWED });
    expect(calls).toEqual([]);
  });

  it('compares the secret in full, whatever its length', () => {
    expect(sameSecret(INVOKE, INVOKE)).toBe(true);
    expect(sameSecret(INVOKE.slice(1), INVOKE)).toBe(false);
    expect(sameSecret(`${INVOKE}r`, INVOKE)).toBe(false);
    expect(sameSecret('', INVOKE)).toBe(false);
  });
});

describe('remind: the run', () => {
  it('reads, projects over the database clock and writes the items due, with the secret key as apikey', async () => {
    // B's 2026-01-04 day shift starts 07:00 local, 06:00Z; H2 is due 04:00Z.
    const now = at('2026-01-04T04:00:00Z');
    const { handle, calls, logs, timeouts } = harness([
      json({ now, members: [member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05')] }),
      json(1),
    ]);
    const response = await handle(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: REMIND_RAN, members: 1, due: 1, accepted: 1, skipped: 0 });
    expect(calls.map((call) => call.url)).toEqual([
      `${PROJECT_URL}/rest/v1/rpc/${INPUTS_RPC}`,
      `${PROJECT_URL}/rest/v1/rpc/${ENQUEUE_RPC}`,
    ]);
    for (const call of calls) {
      expect(call.init.method).toBe('POST');
      expect(call.init.redirect).toBe('manual');
      expect(call.init.headers).toEqual({ apikey: SECRET_KEY, 'content-type': 'application/json', accept: 'application/json' });
    }
    expect(timeouts).toEqual([RPC_TIMEOUT_MS, RPC_TIMEOUT_MS]);
    expect(RPC_TIMEOUT_MS).toBe(10_000);
    expect(calls[0]?.body).toEqual({});
    expect(calls[1]?.body).toEqual({
      p_items: [
        {
          memberId: 'pilot-m2',
          date: '2026-01-04',
          teamId: 'pilot-smjena-b',
          shiftTypeId: 'pilot-dan',
          lead: 'H2',
          start: 420,
          end: 1140,
          startsAt: '2026-01-04T06:00:00Z',
        },
      ],
    });
    expect(logs).toEqual([]);
  });

  it('counts real hours on a DST date and a night half from 01:00, by the clock it was given', async () => {
    const spring = at('2026-03-29T02:00:00Z');
    const { handle, calls } = harness([
      json({ now: spring, members: [member('pilot-m5', ['H3'], '2026-03-28', '2026-03-30')] }),
      json(1),
    ]);
    expect((await handle(post())).status).toBe(200);
    expect(calls[1]?.body).toMatchObject({ p_items: [{ date: '2026-03-29', lead: 'H3', startsAt: '2026-03-29T05:00:00Z' }] });

    const half = {
      ...member('pilot-m2', ['H1'], '2025-12-31', '2026-01-02'),
      inputs: {
        ...inputsOf(pilot.organization, 'pilot-m2'),
        leave: [{ id: 'night-half', from: '2026-01-01', to: '2026-01-01', half: 'FIRST', absenceTypeId: 'annual' }],
      },
    };
    const night = harness([json({ now: at('2026-01-01T23:00:00Z'), members: [half] }), json(1)]);
    expect((await night.handle(post())).status).toBe(200);
    expect(night.calls[1]?.body).toMatchObject({
      p_items: [{ date: '2026-01-01', lead: 'H1', start: 1500, end: 1860, startsAt: '2026-01-02T00:00:00Z' }],
    });
  });

  it('writes nothing when nothing is due', async () => {
    const { handle, calls } = harness([json({ now: at('2026-01-04T12:00:00Z'), members: [member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05')] })]);
    const response = await handle(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: REMIND_RAN, members: 1, due: 0, accepted: 0, skipped: 0 });
    expect(calls).toHaveLength(1);
  });

  it('skips one member whose row or assembly is broken, and runs the rest', async () => {
    const now = at('2026-01-04T04:00:00Z');
    const good = member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05');
    const broken = [
      { ...good, memberId: 'pilot-m5' }, // the assembly is another member's
      { ...good, leads: ['H4'] },
      { ...good, leads: ['H1', 'H2', 'H3'] },
      { ...good, window: { from: '2026-01-05', to: '2026-01-03' } }, // reversed: the domain refuses
      { ...good, window: null },
      { ...good, inputs: { ...good.inputs, teams: null } },
      { ...good, inputs: { ...good.inputs, shiftTypes: [...good.inputs.shiftTypes, ...good.inputs.shiftTypes] } },
      { ...good, memberId: 42 },
      // A row that is no object at all, or no member row: that member alone.
      null,
      'pilot-m2',
      [good],
    ];
    const { handle, calls, logs } = harness([json({ now, members: [...broken, good] }), json(1)]);
    const response = await handle(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: REMIND_RAN, members: broken.length + 1, due: 1, accepted: 1, skipped: broken.length });
    expect(calls[1]?.body).toMatchObject({ p_items: [{ memberId: 'pilot-m2', lead: 'H2' }] });
    expect(logs).toEqual(broken.map(() => REMINDER_MEMBER_SKIPPED));
  });

  it('answers 503 REMINDER_INPUTS_UNAVAILABLE and writes nothing when the read fails or is not the read', async () => {
    const answers: readonly Answer[] = [
      new Error('network'),
      json({ code: 'PGRST' }, 500),
      json({ now: 1, members: [] }, 401),
      new Response('not json', { status: 200 }),
      json(null),
      json([]),
      json({ members: [] }),
      json({ now: '1795000000000', members: [] }),
      json({ now: 1.5, members: [] }),
      json({ now: at('2026-01-04T04:00:00Z'), members: {} }),
    ];
    for (const answer of answers) {
      const { handle, calls, logs } = harness([answer]);
      const response = await handle(post());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: REMINDER_INPUTS_UNAVAILABLE });
      expect(calls).toHaveLength(1);
      expect(logs).toEqual([REMINDER_INPUTS_UNAVAILABLE]);
    }
  });

  it('answers 503 REMINDER_ENQUEUE_FAILED when the write fails', async () => {
    const read = (): Response =>
      json({ now: at('2026-01-04T04:00:00Z'), members: [member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05')] });
    for (const write of [new Error('network'), json({ code: '22023', message: 'REMINDER_ITEMS_INVALID' }, 400), json('1'), new Response('x')]) {
      const { handle, calls, logs } = harness([read(), write]);
      const response = await handle(post());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: REMINDER_ENQUEUE_FAILED });
      expect(calls).toHaveLength(2);
      expect(logs).toEqual([REMINDER_ENQUEUE_FAILED]);
    }
  });

  it('sends the same items for two runs over the same clock, and answers each run its own count', async () => {
    const now = at('2026-01-05T17:00:00Z');
    const bodies: unknown[] = [];
    const answers: unknown[] = [];
    // The second run's RPC answers 0: say the member turned the lead off between the runs.
    for (const accepted of [1, 0]) {
      const { handle, calls } = harness([
        json({ now, members: [member('pilot-m2', ['H1', 'EVENING_BEFORE'], '2026-01-04', '2026-01-06')] }),
        json(accepted),
      ]);
      const response = await handle(post());
      expect(response.status).toBe(200);
      answers.push(await response.json());
      bodies.push(calls[1]?.body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(answers).toEqual([
      { code: REMIND_RAN, members: 1, due: 1, accepted: 1, skipped: 0 },
      { code: REMIND_RAN, members: 1, due: 1, accepted: 0, skipped: 0 },
    ]);
  });

  it('writes in chunks of at most 1000 items, one call each, and sums their counts', async () => {
    // The same member 1001 times: each projects the one due reminder.
    const now = at('2026-01-04T04:00:00Z');
    const one = member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05');
    const many = Array.from({ length: ENQUEUE_CHUNK + 1 }, () => one);
    const { handle, calls } = harness([json({ now, members: many }), json(ENQUEUE_CHUNK - 3), json(1)]);
    const response = await handle(post());

    expect(ENQUEUE_CHUNK).toBe(1000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: REMIND_RAN, members: 1001, due: 1001, accepted: ENQUEUE_CHUNK - 2, skipped: 0 });
    expect(calls.map((call) => call.url)).toEqual([
      `${PROJECT_URL}/rest/v1/rpc/${INPUTS_RPC}`,
      `${PROJECT_URL}/rest/v1/rpc/${ENQUEUE_RPC}`,
      `${PROJECT_URL}/rest/v1/rpc/${ENQUEUE_RPC}`,
    ]);
    expect((calls[1]?.body as { p_items: unknown[] }).p_items).toHaveLength(1000);
    expect((calls[2]?.body as { p_items: unknown[] }).p_items).toHaveLength(1);
  });

  it('answers 503 REMINDER_ENQUEUE_FAILED when a later chunk fails', async () => {
    const now = at('2026-01-04T04:00:00Z');
    const many = Array.from({ length: ENQUEUE_CHUNK + 1 }, () => member('pilot-m2', ['H2'], '2026-01-03', '2026-01-05'));
    const { handle, calls, logs } = harness([json({ now, members: many }), json(1000), json({ code: 'XX000' }, 500)]);
    const response = await handle(post());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: REMINDER_ENQUEUE_FAILED });
    expect(calls).toHaveLength(3);
    expect(logs).toEqual([REMINDER_ENQUEUE_FAILED]);
  });
});

describe('remind: its source (AD-7, AD-14)', () => {
  const handler = readFileSync(`${root}supabase/functions/remind/handler.ts`, 'utf8');
  const index = readFileSync(`${root}supabase/functions/remind/index.ts`, 'utf8');

  it('imports @shift/domain alone, and never reads its own clock for the window', () => {
    const imports = [...handler.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]);
    expect(imports).toEqual(['@shift/domain']);
    expect(handler).not.toMatch(/Date\.now|new Date|performance\.now/);
    expect(index).not.toMatch(/Date\.now|new Date/);
    expect([...index.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1])).toEqual(['./handler.ts']);
  });

  it('logs fixed codes only', () => {
    for (const call of index.matchAll(/console\.\w+\(([^()]*)\)/g)) {
      expect(call[1]).toMatch(/^`remind(?: is misconfigured)?: \$\{(?:configuration\.)?code\}`$/);
    }
    for (const call of handler.matchAll(/dependencies\.log\(([^()]*)\)/g)) {
      expect(call[1]).toMatch(/^[A-Z][A-Z_]*$/);
    }
    expect(handler).not.toMatch(/console\./);
  });
});
