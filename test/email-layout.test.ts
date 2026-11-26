import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { authEmailTemplates } from '../apps/web/src/lib/auth-email.ts';
import { deliverEmail } from '../supabase/functions/notify/email.ts';
import { EMAIL_COLOURS, EMAIL_MARK_FILE, emailHtml, escapeHtml } from '../supabase/functions/notify/email-layout.ts';
import { readConfiguration, type ClaimedNotification, type Fetch } from '../supabase/functions/notify/handler.ts';
import {
  MESSAGE_OF_CODE,
  MESSAGE_UNKNOWN,
  OBAVIJESTI,
  OPERANDS_INVALID,
  PODSJETNICI,
  REMINDER_CODE,
  render,
  renderEmail,
  renderPush,
} from '../supabase/functions/notify/messages.ts';

/**
 * Story 21.27 (UX-DR85): every email the product sends is drawn in one layout,
 * `email-layout.ts`. This file pins the layout's mail-client rules, the HTML
 * part `notify` now sends beside its plain text, and that the SPA's copy of the
 * layout (the Auth templates' builder) is the function's, byte for byte.
 * DB-free: it never opens a database and never sends.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const APP_URL = 'https://shift.example.org';
const ORGANIZATION_NAME = 'DVD Primjer';
const TARGET = { appUrl: APP_URL, slug: 'dvd-primjer', organizationName: ORGANIZATION_NAME } as const;
const REQUEST_ID = '0b5e7f9a-3c2d-4e1f-8a6b-9c0d1e2f3a4b';
const TEAM_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const MARK_URL = `${APP_URL}/${EMAIL_MARK_FILE}`;
const linkTo = (path: string): string => `${APP_URL}/prijava/dvd-primjer?povratak=${encodeURIComponent(path)}`;

/** Operands that fill every code's message (the notify-boundary footer case's set). */
const EVERY_OPERAND = {
  startDate: '2046-03-02',
  endDate: '2046-03-06',
  date: '2046-03-02',
  effectiveFrom: '2046-03-02',
  shiftTypeName: 'Dnevna',
  memberName: 'Ana Kovač',
  proposerName: 'Ana Kovač',
  addresseeName: 'Ivo Babić',
  requestId: REQUEST_ID,
  teamName: 'Smjena C',
  from: '2046-03-02',
  to: '2046-03-31',
  days: 12,
  source: 'PERSONAL',
};

const REMINDER = {
  date: '2026-11-23',
  teamId: TEAM_ID,
  start: 420,
  end: 1140,
  startsAt: '2026-11-23T06:00:00Z',
  lead: 'H2',
  leadHours: 2,
  shiftTypeName: 'Dnevna',
  teamName: 'Smjena A',
};

const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
const images = (html: string): string[] => [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);

/** What every email's HTML must and must not hold, whoever built it. */
function expectMailSafe(html: string, markUrl: string, label: string): void {
  expect(html, label).toMatch(/^<!doctype html>\n<html lang="hr">/);
  expect(html, label).toContain('<meta name="color-scheme" content="light dark">');
  expect(html, label).toContain('@media (prefers-color-scheme:dark)');
  // One image: the mark, on the app origin, the same URL for everyone, with an alt.
  expect(images(html), label).toEqual([
    `<img src="${escapeHtml(markUrl)}" width="40" height="40" alt="Smjenko" style="display:block;width:40px;height:40px;border:0;border-radius:9px">`,
  ]);
  expect([...html.matchAll(/\ssrc="/gi)], label).toHaveLength(1);
  // Nothing else is fetched, nothing runs, nothing tracks.
  expect(html, label).not.toMatch(/<script|<link|<iframe|<object|<form|url\(|@import|@font-face|data:|javascript:/i);
  // The bulletproof button: a table cell carries the fill, so Outlook draws it.
  expect(html, label).toMatch(/<td class="sk-button" align="center" bgcolor="#2a4fae"[^>]*>\n<a href="[^"]+"/);
  // Layout by tables at most 600 px wide, never flex or grid.
  expect(html, label).toContain('style="max-width:600px"');
  expect(html, label).not.toMatch(/display:\s*(?:flex|grid)/);
}

describe('one layout for every email (story 21.27)', () => {
  it("keeps the SPA's copy of the layout byte-identical to the function's", () => {
    const canonical = readFileSync(join(repoRoot, 'supabase', 'functions', 'notify', 'email-layout.ts'), 'utf8');
    const copy = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'email-layout.ts'), 'utf8');
    expect(copy, 'apps/web/src/lib/email-layout.ts differs: copy supabase/functions/notify/email-layout.ts over it').toBe(canonical);
    // Pure: it imports nothing, so both the Edge runtime and the build can load it.
    expect(canonical).not.toMatch(/^import\s/m);
  });

  it('gives the button a label 7:1 on its fill in light, and the app’s own dark primary pair in dark', () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (high + 0.05) / (low + 0.05);
    };
    expect(ratio(EMAIL_COLOURS.button, EMAIL_COLOURS.buttonText)).toBeGreaterThanOrEqual(7);
    // `index.css`'s dark `--primary` on `--primary-foreground`: 6.57:1.
    expect(ratio(EMAIL_COLOURS.darkButton, EMAIL_COLOURS.darkButtonText)).toBeCloseTo(6.57, 2);
    // Every text colour on every surface it is drawn on, in both schemes: the
    // heading, the body and the wordmark (text: on the card, the wordmark on the
    // page), the fallback and notes (muted, on the card), the footer (muted and
    // the settings link, on the page), the written-out link (on the card).
    const pairs: readonly (readonly [string, string, string, number])[] = [
      ['text on card', EMAIL_COLOURS.text, EMAIL_COLOURS.card, 7],
      ['wordmark on page', EMAIL_COLOURS.text, EMAIL_COLOURS.page, 7],
      ['muted on card', EMAIL_COLOURS.muted, EMAIL_COLOURS.card, 4.5],
      ['muted on page', EMAIL_COLOURS.muted, EMAIL_COLOURS.page, 4.5],
      ['link on card', EMAIL_COLOURS.link, EMAIL_COLOURS.card, 4.5],
      ['link on page', EMAIL_COLOURS.link, EMAIL_COLOURS.page, 4.5],
      ['dark text on card', EMAIL_COLOURS.darkText, EMAIL_COLOURS.darkCard, 7],
      ['dark wordmark on page', EMAIL_COLOURS.darkText, EMAIL_COLOURS.darkPage, 7],
      ['dark muted on card', EMAIL_COLOURS.darkMuted, EMAIL_COLOURS.darkCard, 4.5],
      ['dark muted on page', EMAIL_COLOURS.darkMuted, EMAIL_COLOURS.darkPage, 4.5],
      ['dark link on card', EMAIL_COLOURS.darkLink, EMAIL_COLOURS.darkCard, 4.5],
      ['dark link on page', EMAIL_COLOURS.darkLink, EMAIL_COLOURS.darkPage, 4.5],
    ];
    for (const [name, foreground, background, minimum] of pairs) {
      expect(ratio(foreground, background), name).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('escapes every text and attribute it is given', () => {
    const html = emailHtml({
      lang: 'hr',
      title: '<t>',
      preheader: '<p>',
      brand: 'Smjenko',
      markUrl: 'https://x.example/m.png?"onerror="x',
      heading: '<h>',
      paragraphs: ['<script>alert(1)</script>'],
      action: { label: '<b>', href: 'https://x.example/a?b=1&c="2"' },
      fallback: '<f>',
      notes: ['<n>'],
      footer: { lines: ['<l>'], link: { label: '<s>', href: 'https://x.example/"s' } },
    });
    expect(html).not.toMatch(/<(?:t|p|h|b|f|n|l|s|script)>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('src="https://x.example/m.png?&quot;onerror=&quot;x"');
    expect(hrefs(html)).toEqual(['https://x.example/a?b=1&amp;c=&quot;2&quot;', 'https://x.example/a?b=1&amp;c=&quot;2&quot;', 'https://x.example/&quot;s']);
  });

  it.each(authEmailTemplates(JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8')) as unknown))(
    'draws the Auth template $file in it, with the mark on GoTrue’s SiteURL',
    ({ file, html }) => {
      expectMailSafe(html, '{{ .SiteURL }}/email-mark.png', file);
    },
  );
});

/** Every variant a code renders with: the two-way swaps, the half days and the three schedule sources. */
const VARIANTS: readonly (readonly [string, string, Record<string, unknown>])[] = [
  ...['SWAP_REQUEST_PROPOSED', 'SWAP_REQUEST_ACCEPTED', 'SWAP_REQUEST_DECLINED', 'SWAP_REQUEST_APPROVED', 'SWAP_REQUEST_REJECTED'].map(
    (code) => [`${code} with a return`, code, { ...EVERY_OPERAND, returnDate: '2046-03-09' }] as const,
  ),
  ...['LEAVE_REQUEST_APPROVED', 'LEAVE_REQUEST_REJECTED', 'LEAVE_RECORDED', 'LEAVE_RECORD_CHANGED', 'LEAVE_RECORD_REMOVED', 'LEAVE_REQUEST_CREATED'].flatMap(
    (code) => (['FIRST', 'SECOND'] as const).map((half) => [`${code} ${half} half`, code, { ...EVERY_OPERAND, half }] as const),
  ),
  ...(['TEAM', 'PERSONAL', 'MANUAL'] as const).map((source) => [`SCHEDULE_SOURCE_CHANGED ${source}`, 'SCHEDULE_SOURCE_CHANGED', { ...EVERY_OPERAND, source }] as const),
  ['the hours reminder', REMINDER_CODE, REMINDER],
  ['the evening-before reminder', REMINDER_CODE, (({ leadHours: _hours, ...rest }) => ({ ...rest, lead: 'EVENING_BEFORE' }))(REMINDER)],
  ['the hours reminder with no team', REMINDER_CODE, (({ teamId: _id, teamName: _name, ...rest }) => rest)(REMINDER)],
  [
    'the evening-before reminder with no team',
    REMINDER_CODE,
    (({ teamId: _id, teamName: _name, leadHours: _hours, ...rest }) => ({ ...rest, lead: 'EVENING_BEFORE' }))(REMINDER),
  ],
];

describe("notify sends an HTML part beside its plain text (story 21.27)", () => {
  it('names the product as the Auth templates do: one brand', () => {
    const resource = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8')) as {
      auth: { brand: { name: string } };
      signup: { email: { fallback: string } };
    };
    expect(OBAVIJESTI.email.brand).toBe(resource.auth.brand.name);
    // One wording for the line before the link written out, in every email.
    expect(OBAVIJESTI.email.fallback).toBe(resource.signup.email.fallback);
  });

  it.each(VARIANTS)('draws %s in the layout, the text exactly render()’s', (_name, code, operands) => {
    const email = renderEmail(code, 'hr', operands, TARGET);
    const text = render(code, 'hr', operands, TARGET);
    if (!email.ok || !text.ok) throw new Error(`${code} did not render`);
    expect(email.text).toBe(text.text);
    expectMailSafe(email.html, MARK_URL, _name);
    expect(hrefs(email.html)).toHaveLength(3);
    expect(email.html).toContain(`>${escapeHtml(email.subject)}</h1>`);
  });

  it.each(Object.keys(MESSAGE_OF_CODE))('renders %s as both parts, the text exactly render()’s', (code) => {
    const email = renderEmail(code, 'hr', EVERY_OPERAND, TARGET);
    const text = render(code, 'hr', EVERY_OPERAND, TARGET);
    const push = renderPush(code, 'hr', EVERY_OPERAND, TARGET);
    if (!email.ok || !text.ok || !push.ok) throw new Error(`${code} did not render`);

    expect(email.subject).toBe(text.subject);
    expect(email.text).toBe(text.text);
    expectMailSafe(email.html, MARK_URL, code);
    // The heading is the subject; the message is the push's body before its link.
    expect(email.html).toContain(`>${escapeHtml(email.subject)}</h1>`);
    const [message] = push.body.split(/ [^.]+: https:\/\//);
    expect(email.html).toContain(`>${escapeHtml(message ?? '?')}</p>`);
    // Three links: the button and the link written out (the surface), and the settings.
    const links = hrefs(email.html);
    expect(links).toHaveLength(3);
    expect(links[0]).toBe(links[1]);
    expect(links[0]).toMatch(/^https:\/\/shift\.example\.org\/prijava\/dvd-primjer\?povratak=%2F/);
    expect(links[2]).toBe(linkTo('/obavijesti'));
    // The footer names the organization and says why the email came.
    expect(email.html).toContain(escapeHtml(OBAVIJESTI.footer.reason.replace('{organizationName}', ORGANIZATION_NAME)));
    expect(email.html).toContain(`>${OBAVIJESTI.footer.settings}</a>`);
  });

  it('ends the plain text with the reason and the settings link, and the push with neither', () => {
    const email = renderEmail('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06' }, TARGET);
    const push = renderPush('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06' }, TARGET);
    expect(email.ok && email.text).toBe(
      `${ORGANIZATION_NAME}: tvoj zahtjev za odsutnost 02.03.2046–06.03.2046 je odobren. Otvori Godišnji: ${linkTo('/godisnji')}\n\n` +
        `Ovu poruku primaš jer su ti u organizaciji ${ORGANIZATION_NAME} uključene obavijesti e-poštom.\n` +
        `Obavijesti e-poštom isključuješ u aplikaciji, pod Obavijesti: ${linkTo('/obavijesti')}`,
    );
    expect(push.ok && push.body).toBe(
      `${ORGANIZATION_NAME}: tvoj zahtjev za odsutnost 02.03.2046–06.03.2046 je odobren. Otvori Godišnji: ${linkTo('/godisnji')}`,
    );
  });

  it('escapes member data spliced into the HTML: a name is text, never markup', () => {
    const hostile = '<img src=x onerror=alert(1)> & "Ana"';
    const email = renderEmail(
      'LEAVE_REQUEST_CREATED',
      'hr',
      { requestId: REQUEST_ID, memberName: hostile, startDate: '2046-03-02', endDate: '2046-03-06' },
      { ...TARGET, organizationName: 'DVD <b>Mladost</b>' },
    );
    if (!email.ok) throw new Error('did not render');
    expectMailSafe(email.html, MARK_URL, 'hostile');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Ana&quot;');
    expect(email.html).toContain('DVD &lt;b&gt;Mladost&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Mladost');
    // The plain text is text: it carries the name as given.
    expect(email.text).toContain(hostile);
  });

  it('draws the shift reminder in the same layout, with its own footer', () => {
    const email = renderEmail(REMINDER_CODE, 'hr', REMINDER, TARGET);
    const text = render(REMINDER_CODE, 'hr', REMINDER, TARGET);
    if (!email.ok || !text.ok) throw new Error('did not render');
    expect(email.text).toBe(text.text);
    expectMailSafe(email.html, MARK_URL, REMINDER_CODE);
    expect(email.html).toContain(`>${PODSJETNICI.hours.action}</a>`);
    expect(email.html).toContain(escapeHtml(PODSJETNICI.footer.reason.replace('{organizationName}', ORGANIZATION_NAME)));
    expect(email.html).toContain(`>${escapeHtml(PODSJETNICI.footer.settings)}</a>`);
    expect(email.html).not.toContain(OBAVIJESTI.footer.settings);
  });

  it('refuses exactly what render() refuses', () => {
    expect(renderEmail('SOMETHING_ELSE', 'hr', {}, TARGET)).toEqual({ ok: false, code: MESSAGE_UNKNOWN });
    expect(renderEmail('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02' }, TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    expect(renderEmail('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06' }, { ...TARGET, slug: null })).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
  });

  it('renders a locale with no resource of its own in Croatian, lang="hr"', () => {
    const operands = { startDate: '2046-03-02', endDate: '2046-03-06' };
    expect(renderEmail('LEAVE_REQUEST_APPROVED', 'en-GB', operands, TARGET)).toEqual(renderEmail('LEAVE_REQUEST_APPROVED', 'hr', operands, TARGET));
  });

  it('a trailing slash on the app URL never doubles in the mark', () => {
    const email = renderEmail('ROTATION_CHANGES', 'hr', { effectiveFrom: '2046-03-02' }, { ...TARGET, appUrl: `${APP_URL}/` });
    expect(email.ok && images(email.html)[0]).toContain(`src="${MARK_URL}"`);
  });
});

describe('deliverEmail posts both parts to Resend (story 21.27)', () => {
  const configuration = readConfiguration(
    (name) =>
      ({
        SUPABASE_URL: 'https://project.example.org',
        SHIFT_SECRET_KEY: 'sb_secret_test',
        NOTIFY_INVOKE_SECRET: 'i'.repeat(64),
        RESEND_API_KEY: 're_test',
        NOTIFY_EMAIL_FROM: 'Smjenko <obavijesti@example.org>',
        SHIFT_APP_URL: APP_URL,
        VAPID_PUBLIC_KEY: `B${'a'.repeat(86)}`,
        VAPID_PRIVATE_KEY: 'p'.repeat(43),
        VAPID_SUBJECT: 'mailto:obavijesti@example.org',
      })[name],
  );
  if (!configuration.ok) throw new Error('configuration refused');

  const row = (code: string, operands: unknown): ClaimedNotification =>
    ({
      id: crypto.randomUUID(),
      code,
      channel: 'email',
      operands,
      attempts: 1,
      claimed_at: '2046-03-01T10:00:00.123456+00:00',
      email: 'ana@example.org',
      locale: 'hr',
      timezone: 'Europe/Zagreb',
      slug: 'dvd-primjer',
      organization_name: ORGANIZATION_NAME,
    }) as unknown as ClaimedNotification;

  it('sends subject, text and html, the text and html from renderEmail', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    const operands = { startDate: '2046-03-02', endDate: '2046-03-06' };
    expect(await deliverEmail(row('LEAVE_REQUEST_APPROVED', operands), configuration.configuration, fetch)).toEqual({ result: 'sent' });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const email = renderEmail('LEAVE_REQUEST_APPROVED', 'hr', operands, TARGET);
    if (!email.ok) throw new Error('did not render');
    expect(body).toEqual({
      from: 'Smjenko <obavijesti@example.org>',
      to: ['ana@example.org'],
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  });

  it('sends nothing for a row it cannot render, retrying as before', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    expect(await deliverEmail(row('SOMETHING_ELSE', {}), configuration.configuration, fetch)).toEqual({
      result: 'transient',
      failureCode: MESSAGE_UNKNOWN,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
