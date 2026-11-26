import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { REMINDER_LEADS as DOMAIN_REMINDER_LEADS, REMINDER_LEAD_HOURS } from '../packages/domain/src/index.ts';
import { returnTargetOf } from '../apps/web/src/features/auth/services/return-target.ts';
import { formatMinuteOfDay } from '../apps/web/src/lib/i18n/format.ts';
import {
  CLAIM_RPC,
  NOTIFY_RAN,
  PUSH_DEVICES_RPC,
  PUSH_TTL_SECONDS,
  REMINDER_PUSH_TTL_MAX_SECONDS,
  RESEND_ENDPOINT,
  readConfiguration,
  type Fetch,
  type OutboxClient,
  type PushEncryptor,
  type RpcAnswer,
} from '../supabase/functions/notify/handler.ts';
import { REMINDER_EXPIRED, REMINDER_GRACE_SECONDS, REMINDER_LATE, pushTtlSecondsOf } from '../supabase/functions/notify/push.ts';
import { createHandler } from '../supabase/functions/notify/run.ts';
import {
  LAST_SHIFT_MINUTE,
  MESSAGE_OF_CODE,
  OPERANDS_INVALID,
  PODSJETNICI,
  REMINDER_CODE,
  REMINDER_LEADS,
  REMINDER_LEAD_HOURS as NOTIFY_REMINDER_LEAD_HOURS,
  REMINDER_VARIANT_OF,
  formatMinute,
  reminderPathOf,
  render,
  renderPush,
} from '../supabase/functions/notify/messages.ts';

/**
 * Story 17.3: `notify` renders a shift reminder (AD-18's one exception) and
 * sends it by push or email, asserted without a database (AD-15). The DB
 * half (the claim's `REMINDER_LATE`, the channels) is
 * `test/shift-reminders.test.ts`'s, run in CI.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const APP_URL = 'https://shift.example.org';
const ORGANIZATION_NAME = 'DVD Kaštel Novi';
const TARGET = { appUrl: APP_URL, slug: 'dvd-kastel-novi', organizationName: ORGANIZATION_NAME } as const;
const TEAM_ID = '3f2c8a5e-1b7d-4c9e-9a3f-5d6e7f8a9b0c';
const linkTo = (path: string): string => `${APP_URL}/prijava/dvd-kastel-novi?povratak=${encodeURIComponent(path)}`;
const pathTo = (path: string): string => `/prijava/dvd-kastel-novi?povratak=${encodeURIComponent(path)}`;
const DAY = `/kalendar?mjesec=2026-11&dan=2026-11-23&danSmjena=${TEAM_ID}`;
const FOOTER = `\n\nPodsjetnike e-poštom možeš isključiti u aplikaciji, pod Obavijesti → Podsjetnici: ${linkTo('/obavijesti')}`;

/** A row's operands as 0070's `enqueue_shift_reminders` writes them. */
function operands(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: '2026-11-23',
    teamId: TEAM_ID,
    start: 420,
    end: 1140,
    startsAt: '2026-11-23T06:00:00Z',
    lead: 'H2',
    leadHours: 2,
    shiftTypeName: 'Dnevna',
    teamName: 'Smjena A',
    ...overrides,
  };
}

function evening(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { leadHours: _hours, ...rest } = operands({ lead: 'EVENING_BEFORE', ...overrides });
  return rest;
}

describe('notify renders reminders from a pinned copy of reminders.notice (story 17.3)', () => {
  it("keeps its reminder text deep-equal to hr.json's reminders.notice", () => {
    const resource = JSON.parse(
      readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8'),
    ) as { reminders?: { notice?: unknown } };
    expect(resource.reminders?.notice, 'hr.json has no reminders.notice').toBeDefined();
    expect(PODSJETNICI).toEqual(resource.reminders?.notice);
  });

  it('never calls a team "tim" nor the shift a "smjena": a team is its own name', () => {
    const words: string[] = [PODSJETNICI.hours, PODSJETNICI.eveningBefore].flatMap((message) => [message.subject, message.body]);
    words.push(PODSJETNICI.footer);
    const texts = words.map((text) => text.replace(/\{\w+\}/g, ''));
    for (const text of texts) {
      expect(text).not.toMatch(/\btim(?:a|u|om|ovi)?\b/iu);
      expect(text).not.toMatch(/smjen/iu);
    }
  });

  it("spells the lead set exactly as the domain does, and picks a variant for each lead", () => {
    expect([...REMINDER_LEADS]).toEqual([...DOMAIN_REMINDER_LEADS]);
    expect(Object.keys(REMINDER_VARIANT_OF)).toEqual([...DOMAIN_REMINDER_LEADS]);
    for (const lead of DOMAIN_REMINDER_LEADS) {
      expect(REMINDER_VARIANT_OF[lead], lead).toBe(lead === 'EVENING_BEFORE' ? 'eveningBefore' : 'hours');
    }
    expect(NOTIFY_REMINDER_LEAD_HOURS).toEqual(REMINDER_LEAD_HOURS);
    expect(REMINDER_CODE).toBe('SHIFT_REMINDER');
    // Its own branch: the existing codes' map is untouched (notify-boundary pins it).
    expect(Object.keys(MESSAGE_OF_CODE)).not.toContain(REMINDER_CODE);
  });

  it('renders an hours reminder with the organization, the date, both times, the team and the day link', () => {
    expect(render(REMINDER_CODE, 'hr', operands(), TARGET)).toEqual({
      ok: true,
      subject: 'Za 2 h radiš: Dnevna 07:00–19:00, Smjena A',
      text: `${ORGANIZATION_NAME}: za 2 h, 23.11.2026, radiš: Dnevna 07:00–19:00, Smjena A. Pogledaj dan u kalendaru: ${linkTo(DAY)}${FOOTER}`,
    });
  });

  it.each(Object.entries(REMINDER_LEAD_HOURS))('names %s as %i h', (lead, hours) => {
    const rendered = render(REMINDER_CODE, 'hr', operands({ lead, leadHours: hours }), TARGET);
    expect(rendered).toMatchObject({ ok: true, subject: `Za ${String(hours)} h radiš: Dnevna 07:00–19:00, Smjena A` });
  });

  it('renders the evening-before reminder as Sutra radiš, with no hours', () => {
    expect(render(REMINDER_CODE, 'hr', evening(), TARGET)).toEqual({
      ok: true,
      subject: 'Sutra radiš: Dnevna 07:00–19:00, Smjena A',
      text: `${ORGANIZATION_NAME}: sutra, 23.11.2026, radiš: Dnevna 07:00–19:00, Smjena A. Pogledaj dan u kalendaru: ${linkTo(DAY)}${FOOTER}`,
    });
  });

  it("shows a night's worked second half past midnight, and a night over midnight, as clock times", () => {
    expect(render(REMINDER_CODE, 'hr', operands({ start: 1500, end: 1860, shiftTypeName: 'Noćna' }), TARGET)).toMatchObject({
      ok: true,
      subject: 'Za 2 h radiš: Noćna 01:00–07:00, Smjena A',
    });
    expect(render(REMINDER_CODE, 'hr', operands({ start: 1140, end: 1860 }), TARGET)).toMatchObject({
      subject: 'Za 2 h radiš: Dnevna 19:00–07:00, Smjena A',
    });
  });

  it("formats a minute as the SPA's formatMinuteOfDay does, mod a day, and refuses anything else", () => {
    for (const minute of [0, 1, 59, 60, 420, 1139, 1439, 1440, 1500, 2160, LAST_SHIFT_MINUTE]) {
      expect(formatMinute(minute), String(minute)).toBe(formatMinuteOfDay(minute % 1440));
    }
    for (const bad of [-1, LAST_SHIFT_MINUTE + 1, 1.5, Number.NaN, '420', null, undefined]) {
      expect(formatMinute(bad), String(bad)).toBeNull();
    }
  });

  it('pushes the same title and body without the footer, opening the day through the sign-in path', () => {
    expect(renderPush(REMINDER_CODE, 'hr', operands(), TARGET)).toEqual({
      ok: true,
      title: 'Za 2 h radiš: Dnevna 07:00–19:00, Smjena A',
      body: `${ORGANIZATION_NAME}: za 2 h, 23.11.2026, radiš: Dnevna 07:00–19:00, Smjena A. Pogledaj dan u kalendaru: ${linkTo(DAY)}`,
      url: pathTo(DAY),
    });
  });

  it('links to a path the sign-in follows to the day, with the month, the day and the team intact', () => {
    const rendered = renderPush(REMINDER_CODE, 'hr', operands({ teamId: TEAM_ID.toUpperCase() }), TARGET);
    if (!rendered.ok) throw new Error('the reminder did not render');
    const url = new URL(rendered.url, APP_URL);
    expect(url.pathname).toBe('/prijava/dvd-kastel-novi');
    const povratak = url.searchParams.get('povratak') ?? '';
    expect(povratak).toBe(DAY);
    expect(returnTargetOf(povratak, (pathname) => pathname === '/kalendar')).toBe(DAY);
    expect(reminderPathOf(operands())).toBe(DAY);
  });

  it('ends a reminder email with its own footer, pointing to Obavijesti → Podsjetnici', () => {
    const rendered = render(REMINDER_CODE, 'hr', evening(), TARGET);
    if (!rendered.ok) throw new Error('the reminder did not render');
    expect(rendered.text.endsWith(FOOTER)).toBe(true);
    const footerLink = new URL(/https?:\/\/\S+$/.exec(rendered.text)?.[0] ?? '');
    expect(footerLink.searchParams.get('povratak')).toBe('/obavijesti');
    expect(rendered.text).not.toContain('Obavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti:');
  });

  it.each([
    ['a lead outside the set', operands({ lead: 'H4' })],
    ['no lead', operands({ lead: undefined })],
    ['an hours lead with no leadHours', operands({ leadHours: undefined })],
    ['a fractional leadHours', operands({ leadHours: 1.5 })],
    ['a leadHours that is not its lead\'s', operands({ lead: 'H2', leadHours: 12 })],
    ['no startsAt', operands({ startsAt: undefined })],
    ['an unreadable startsAt', operands({ startsAt: 'tomorrow' })],
    ['a minute past the next day', operands({ end: LAST_SHIFT_MINUTE + 1 })],
    ['a negative minute', operands({ start: -1 })],
    ['a minute as text', operands({ start: '07:00' })],
    ['no end', operands({ end: undefined })],
    ['a team id that is no uuid', operands({ teamId: 'smjena-a' })],
    ['a date that does not exist', operands({ date: '2026-02-30' })],
    ['a blank shift type name', operands({ shiftTypeName: '  ' })],
    ['no team name', operands({ teamName: undefined })],
  ])('refuses %s as OPERANDS_INVALID, never rendering a guess', (_why, given) => {
    const cleaned = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined));
    expect(render(REMINDER_CODE, 'hr', cleaned, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    expect(renderPush(REMINDER_CODE, 'hr', cleaned, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
  });

  it('leaves operands named start or end alone on any other code', () => {
    expect(
      render('LOAN_MADE', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06', teamName: 'Smjena C', start: 'x', end: 99999 }, TARGET),
    ).toMatchObject({ ok: true, subject: 'Od 02.03.2046 do 06.03.2046 radiš u timu Smjena C' });
  });

  it('renders an existing code exactly as before (a loan names its team, nothing changed)', () => {
    expect(render('LOAN_MADE', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06', teamName: 'Smjena C' }, TARGET)).toEqual({
      ok: true,
      subject: 'Od 02.03.2046 do 06.03.2046 radiš u timu Smjena C',
      text: `${ORGANIZATION_NAME}: od 02.03.2046 do 06.03.2046 radiš u timu Smjena C. Pogledaj kalendar: ${linkTo('/kalendar')}\n\nObavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: ${linkTo('/obavijesti')}`,
    });
  });

  it('names no other member, no absence and no conflict: only its own operands', () => {
    for (const message of [PODSJETNICI.hours, PODSJETNICI.eveningBefore]) {
      const names = [...`${message.subject} ${message.body}`.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      expect(new Set(names)).toEqual(
        new Set([
          'organizationName',
          'date',
          'shiftTypeName',
          'start',
          'end',
          'teamName',
          'link',
          ...(message === PODSJETNICI.hours ? ['leadHours'] : []),
        ]),
      );
    }
  });
});

describe("a reminder push lives until its shift starts, at most 15 minutes (story 17.3, AD-18)", () => {
  const NOW = Date.parse('2026-11-23T05:00:00Z');

  it.each([
    ['an hour ahead', '2026-11-23T06:00:00Z', REMINDER_PUSH_TTL_MAX_SECONDS],
    ['five minutes ahead', '2026-11-23T05:05:00Z', 300],
    ['starting now', '2026-11-23T05:00:00Z', 0],
    ['already started', '2026-11-23T04:59:00Z', 0],
    ['unreadable', 'tomorrow', 0],
  ])('%s: %s gives %i s', (_why, startsAt, ttl) => {
    expect(pushTtlSecondsOf(REMINDER_CODE, { startsAt }, NOW)).toBe(ttl);
  });

  it.each([
    ['H1 at its due instant', 'H1', '2026-11-23T06:00:00Z', 900],
    ['H1 ten minutes past due', 'H1', '2026-11-23T05:50:00Z', 300],
    ['H2 three quarters of an hour past due', 'H2', '2026-11-23T06:15:00Z', 0],
    ['the evening before, by the start alone', 'EVENING_BEFORE', '2026-11-23T05:05:00Z', 300],
  ])('%s: never past 15 minutes after the due instant', (_why, lead, startsAt, ttl) => {
    expect(pushTtlSecondsOf(REMINDER_CODE, { startsAt, lead }, NOW)).toBe(ttl);
  });

  it('keeps the day for every other code, and caps the reminder at 900 s', () => {
    expect(REMINDER_PUSH_TTL_MAX_SECONDS).toBe(900);
    expect(pushTtlSecondsOf('LOAN_MADE', { startsAt: '2026-11-23T05:05:00Z' }, NOW)).toBe(PUSH_TTL_SECONDS);
    expect(pushTtlSecondsOf(REMINDER_CODE, null, NOW)).toBe(0);
  });
});

describe('notify sends a claimed reminder by email and by push (story 17.3)', () => {
  const INVOKE_SECRET = 'i'.repeat(40);
  const ENVIRONMENT: Readonly<Record<string, string>> = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SHIFT_SECRET_KEY: 'sb_secret_test',
    NOTIFY_INVOKE_SECRET: INVOKE_SECRET,
    RESEND_API_KEY: 're_test',
    NOTIFY_EMAIL_FROM: 'Shift <obavijesti@example.org>',
    SHIFT_APP_URL: APP_URL,
    VAPID_PUBLIC_KEY: `B${'a'.repeat(86)}`,
    VAPID_PRIVATE_KEY: 'p'.repeat(43),
    VAPID_SUBJECT: 'mailto:obavijesti@example.org',
  };
  const configured = readConfiguration((name) => ENVIRONMENT[name]);
  const DEVICE = { id: crypto.randomUUID(), endpoint: 'https://push.example.org/d', p256dh: 'k', auth: 'a', member_id: crypto.randomUUID() };

  function claimed(channel: 'email' | 'push', given: Record<string, unknown>) {
    return {
      id: crypto.randomUUID(),
      code: REMINDER_CODE,
      channel,
      operands: given,
      attempts: 1,
      claimed_at: '2026-11-23T05:00:00.123456+00:00',
      email: channel === 'email' ? 'ana@example.org' : null,
      locale: 'hr',
      timezone: 'Europe/Zagreb',
      slug: 'dvd-kastel-novi',
      organization_name: ORGANIZATION_NAME,
      subject_id: crypto.randomUUID(),
      ...(channel === 'push' ? { subscriptions: [DEVICE] } : {}),
    };
  }

  async function run(rows: readonly unknown[], now: number) {
    const settles: Record<string, unknown>[] = [];
    const client: OutboxClient = {
      rpc: (fn, args): Promise<RpcAnswer> => {
        if (fn === CLAIM_RPC) return Promise.resolve({ data: rows, error: null });
        if (fn === PUSH_DEVICES_RPC) return Promise.resolve({ data: { status: 'ready', devices: [DEVICE] }, error: null });
        settles.push(args);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const posts: { url: string; body: unknown }[] = [];
    const fetch = vi.fn<Fetch>((url, init) => {
      posts.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      return Promise.resolve(new Response(null, { status: 201 }));
    });
    const encrypted: { payload: unknown; ttl: number }[] = [];
    const encryptPush: PushEncryptor = (subscription, payload, options) => {
      encrypted.push({ payload: JSON.parse(payload), ttl: options.ttl });
      return { endpoint: subscription.endpoint, headers: {}, body: new Uint8Array([1]) };
    };
    const handle = createHandler(configured, {
      makeClient: () => client,
      fetch,
      encryptPush,
      now: () => now,
      sleep: () => Promise.resolve(),
    });
    const response = await handle(
      new Request('http://localhost/functions/v1/notify', { method: 'POST', headers: { Authorization: `Bearer ${INVOKE_SECRET}` } }),
    );
    return { response, settles, posts, encrypted };
  }

  it('posts the rendered email to Resend and the push with a TTL down to the start, and settles both sent', async () => {
    // The H2 reminder fell due at 04:00Z, five minutes ago.
    const now = Date.parse('2026-11-23T04:05:00Z');
    const { response, settles, posts, encrypted } = await run([claimed('email', operands()), claimed('push', operands())], now);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: NOTIFY_RAN, claimed: 2, sent: 2 });
    const email = posts.find((post) => post.url === RESEND_ENDPOINT);
    expect(email?.body).toMatchObject({
      to: ['ana@example.org'],
      subject: 'Za 2 h radiš: Dnevna 07:00–19:00, Smjena A',
      text: `${ORGANIZATION_NAME}: za 2 h, 23.11.2026, radiš: Dnevna 07:00–19:00, Smjena A. Pogledaj dan u kalendaru: ${linkTo(DAY)}${FOOTER}`,
    });
    expect(encrypted).toHaveLength(1);
    // Ten minutes left of its 15 past the due instant: 600 s, under the start and the cap.
    expect(encrypted[0]?.ttl).toBe(600);
    expect(encrypted[0]?.payload).toMatchObject({ title: 'Za 2 h radiš: Dnevna 07:00–19:00, Smjena A', url: pathTo(DAY) });
    expect(settles.map((settle) => settle['p_result'])).toEqual(['sent', 'sent']);
  });

  it('never posts a reminder push with no time left, and fails it REMINDER_LATE', async () => {
    const { settles, encrypted } = await run([claimed('push', operands())], Date.parse('2026-11-23T04:20:00Z'));
    expect(encrypted).toEqual([]);
    expect(settles).toEqual([expect.objectContaining({ p_result: 'permanent', p_failure_code: REMINDER_LATE })]);
  });

  it('fails a reminder push whose shift has started REMINDER_EXPIRED, as the claim names it, and posts nothing', async () => {
    // The H2 row's shift starts at 06:00Z.
    const { settles, encrypted } = await run([claimed('push', operands())], Date.parse('2026-11-23T06:00:00Z'));
    expect(encrypted).toEqual([]);
    expect(settles).toEqual([expect.objectContaining({ p_result: 'permanent', p_failure_code: REMINDER_EXPIRED })]);
  });

  it('holds the push grace equal to 0072\'s late bound', () => {
    const sql = readFileSync(join(repoRoot, 'supabase', 'migrations', '0072_reminder_delivery.sql'), 'utf8');
    const late = /create function private\.reminder_late[\s\S]*?\$\$;/.exec(sql)?.[0] ?? '';
    expect(late).toContain(`+ interval '${String(REMINDER_GRACE_SECONDS / 60)} minutes'`);
  });

  it('retries a reminder it cannot render, as any unrenderable row, and sends nothing', async () => {
    const { settles, posts, encrypted } = await run([claimed('email', operands({ lead: 'H4' }))], Date.parse('2026-11-23T05:00:00Z'));
    expect(posts).toEqual([]);
    expect(encrypted).toEqual([]);
    expect(settles).toEqual([expect.objectContaining({ p_result: 'transient', p_failure_code: OPERANDS_INVALID })]);
  });
});

describe('a reminder already sent is never retracted (story 17.3, D5)', () => {
  it('leaves sent rows alone: every reminder settle reads unsent rows, and no later migration deletes outbox rows', () => {
    const migrations = join(repoRoot, 'supabase', 'migrations');
    const later = readdirSync(migrations).filter((name) => name >= '0069').sort();
    expect(later).toContain('0072_reminder_delivery.sql');
    for (const name of later) {
      const sql = readFileSync(join(migrations, name), 'utf8');
      expect(sql, `${name} deletes outbox rows`).not.toMatch(/delete\s+from\s+(?:public\.)?notification_outbox/i);
      // Each settle's own scan is of rows not yet sent or failed.
      for (const settle of sql.matchAll(/update public\.notification_outbox o\s+set failed_at = now\(\),[\s\S]*?for update skip locked/g)) {
        expect(settle[0], name).toContain('where c.sent_at is null');
      }
    }
    // `notify` reaches the outbox only through its four RPCs: no retraction can be written there.
    const handler = readFileSync(join(repoRoot, 'supabase', 'functions', 'notify', 'handler.ts'), 'utf8');
    expect(handler).toMatch(/fn: typeof CLAIM_RPC \| typeof SETTLE_RPC \| typeof DELETE_SUBSCRIPTION_RPC \| typeof PUSH_DEVICES_RPC/);
  });
});

describe('story 21.2: a reminder of a Personal Shift with no team, and the batched schedule notice (AD-18 as amended)', () => {
  /** The operands 0077 writes for a teamless assignment's reminder: neither `teamId` nor `teamName`. */
  const teamless = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const { teamId: _team, teamName: _name, ...rest } = operands(overrides);
    return rest;
  };
  const DAY_ALONE = '/kalendar?mjesec=2026-11&dan=2026-11-23';

  it('renders the no-team variant of each lead, linking to the day alone', () => {
    expect(render(REMINDER_CODE, 'hr', teamless(), TARGET)).toEqual({
      ok: true,
      subject: 'Za 2 h radiš: Dnevna 07:00–19:00',
      text: `${ORGANIZATION_NAME}: za 2 h, 23.11.2026, radiš: Dnevna 07:00–19:00. Pogledaj dan u kalendaru: ${linkTo(DAY_ALONE)}${FOOTER}`,
    });
    const { leadHours: _hours, ...eveningTeamless } = teamless({ lead: 'EVENING_BEFORE' });
    expect(render(REMINDER_CODE, 'hr', eveningTeamless, TARGET)).toMatchObject({ ok: true, subject: 'Sutra radiš: Dnevna 07:00–19:00' });
    expect(renderPush(REMINDER_CODE, 'hr', teamless(), TARGET)).toMatchObject({ ok: true, url: pathTo(DAY_ALONE) });
    expect(reminderPathOf(teamless())).toBe(DAY_ALONE);
    expect(returnTargetOf(DAY_ALONE, (pathname) => pathname === '/kalendar')).toBe(DAY_ALONE);
  });

  it('refuses a row with a team name and no team id, or a team id and no name', () => {
    const { teamId: _team, ...nameOnly } = operands();
    expect(render(REMINDER_CODE, 'hr', nameOnly, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    const { teamName: _name, ...idOnly } = operands();
    expect(render(REMINDER_CODE, 'hr', idOnly, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    expect(render(REMINDER_CODE, 'hr', teamless({ shiftTypeName: ' ' }), TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
  });

  it('names no team in the no-team variants, and nothing but its own operands', () => {
    for (const message of [PODSJETNICI.hoursNoTeam, PODSJETNICI.eveningBeforeNoTeam]) {
      const names = [...`${message.subject} ${message.body}`.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      expect(new Set(names)).toEqual(
        new Set([
          'organizationName',
          'date',
          'shiftTypeName',
          'start',
          'end',
          'link',
          ...(message === PODSJETNICI.hoursNoTeam ? ['leadHours'] : []),
        ]),
      );
      for (const text of [message.subject, message.body].map((one) => one.replace(/\{\w+\}/g, ''))) {
        expect(text).not.toMatch(/\btim(?:a|u|om|ovi)?\b/iu);
        expect(text).not.toMatch(/smjen/iu);
      }
    }
  });

  it('renders SCHEDULE_ASSIGNED with the first and last changed date and the count, linking to Kalendar', () => {
    expect(MESSAGE_OF_CODE['SCHEDULE_ASSIGNED']).toBe('scheduleAssigned');
    expect(render('SCHEDULE_ASSIGNED', 'hr', { from: '2046-03-02', to: '2046-03-31', days: 12 }, TARGET)).toEqual({
      ok: true,
      subject: 'Raspored ti je izmijenjen od 02.03.2046 do 31.03.2046',
      text: `${ORGANIZATION_NAME}: raspored ti je izmijenjen od 02.03.2046 do 31.03.2046 (izmijenjenih dana: 12). Pogledaj kalendar: ${linkTo('/kalendar')}\n\nObavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: ${linkTo('/obavijesti')}`,
    });
    expect(render('SCHEDULE_ASSIGNED', 'hr', { from: '2046-02-30', to: '2046-03-31', days: 1 }, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    expect(render('SCHEDULE_ASSIGNED', 'hr', { from: '2046-03-02', to: '2046-03-31' }, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
  });

  it('renders SCHEDULE_SOURCE_CHANGED by its source, linking to Kalendar, and refuses any other source (story 21.10)', () => {
    const footer = `\n\nObavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: ${linkTo('/obavijesti')}`;
    expect(render('SCHEDULE_SOURCE_CHANGED', 'hr', { effectiveFrom: '2046-03-02', source: 'TEAM' }, TARGET)).toEqual({
      ok: true,
      subject: 'Od 02.03.2046 radiš po rotaciji tima',
      text: `${ORGANIZATION_NAME}: od 02.03.2046 tvoj raspored opet slijedi rotaciju tvog tima. Pogledaj kalendar: ${linkTo('/kalendar')}${footer}`,
    });
    expect(render('SCHEDULE_SOURCE_CHANGED', 'hr', { effectiveFrom: '2046-03-02', source: 'PERSONAL' }, TARGET)).toMatchObject({
      ok: true,
      subject: 'Od 02.03.2046 radiš po osobnoj rotaciji',
    });
    expect(render('SCHEDULE_SOURCE_CHANGED', 'hr', { effectiveFrom: '2046-03-02', source: 'MANUAL' }, TARGET)).toEqual({
      ok: true,
      subject: 'Od 02.03.2046 raspored ti se slaže ručno',
      text: `${ORGANIZATION_NAME}: od 02.03.2046 radiš samo dane koje ti administrator dodijeli u rasporedu. Pogledaj kalendar: ${linkTo('/kalendar')}${footer}`,
    });
    for (const operands of [{ effectiveFrom: '2046-03-02' }, { effectiveFrom: '2046-03-02', source: 'ROTATION' }, { effectiveFrom: '2046-02-30', source: 'TEAM' }]) {
      expect(render('SCHEDULE_SOURCE_CHANGED', 'hr', operands, TARGET), JSON.stringify(operands)).toEqual({ ok: false, code: OPERANDS_INVALID });
    }
  });
});
