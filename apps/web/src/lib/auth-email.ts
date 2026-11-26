/**
 * STORY 19.1 (AD-21, AD-12, D-S4). The Croatian Auth email templates GoTrue
 * sends over SMTP: confirmation, recovery and email change. Built at BUILD time
 * from `hr.json`'s `signup.email` keys (`vite.config.ts`, plugin
 * `shift-auth-email`) into `dist/auth-email/*.html`, which the `shift-web`
 * image serves from the app origin. GoTrue fetches each one from
 * `GOTRUE_MAILER_TEMPLATES_*`, and its subject is `GOTRUE_MAILER_SUBJECTS_*`
 * in the stack's compose file; `test/auth-email.test.ts` pins both to
 * `hr.json`.
 *
 * Every link is AD-12's: `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&type=<type>`.
 * The SPA posts it with `verifyOtp`, on a click (19.2), so no session token is
 * ever in a URL and a mail scanner's GET consumes nothing. GoTrue's
 * `{{ .ConfirmationURL }}` (a GET on `/auth/v1/verify`) is never used.
 *
 * Story 21.27 (UX-DR85): drawn in the one email layout (`email-layout.ts`,
 * a copy of `notify`'s): the *Smjenko* mark from `{{ .SiteURL }}/email-mark.png`
 * (the app origin, the same URL for everyone), the heading, the body, the
 * button and the link written out, the expiry and the "not yours" line, and a
 * footer saying why the mail came (`signup.email.reason`). GoTrue sends the
 * template as HTML only: it has no plain-text part (spec 21.27's deviation).
 *
 * Pure: no `node:` import, no I/O. The build reads the resource and emits the
 * files. Kept out of the service worker's precache (`globIgnores`).
 */

import { EMAIL_MARK_FILE, emailHtml, escapeHtml } from './email-layout.ts';

export { escapeHtml };

/** The three templates, by the file name GoTrue fetches and the `type` its link carries. */
export const AUTH_EMAIL_TEMPLATES = [
  { key: 'confirmation', file: 'confirmation.html', type: 'signup' },
  { key: 'recovery', file: 'recovery.html', type: 'recovery' },
  { key: 'emailChange', file: 'email-change.html', type: 'email_change' },
] as const;

/** Where the templates land in `dist/`, and so under the app origin. */
export const AUTH_EMAIL_DIRECTORY = 'auth-email';

export type AuthEmailKey = (typeof AUTH_EMAIL_TEMPLATES)[number]['key'];

interface TemplateCopy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly ignore: string;
}

interface EmailCopy {
  readonly brand: string;
  readonly expiry: string;
  readonly fallback: string;
  readonly reason: string;
  readonly templates: Readonly<Record<AuthEmailKey, TemplateCopy>>;
}

function stringAt(node: unknown, path: readonly string[]): string {
  let current: unknown = node;
  for (const part of path) {
    current = typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[part] : undefined;
  }
  if (typeof current !== 'string' || current.trim() === '') {
    throw new Error(`hr.json has no message at ${path.join('.')}: the Auth email templates cannot be built`);
  }
  // GoTrue parses each template as a Go template: copy holding a delimiter
  // would be read as an action (or fail to parse, and GoTrue would fall back
  // to its default English mail). The copy is text, never template syntax.
  if (current.includes('{{') || current.includes('}}')) {
    throw new Error(`hr.json's ${path.join('.')} holds a Go template delimiter ({{ or }}): the Auth email templates cannot be built`);
  }
  return current;
}

/** The `signup.email` copy, read off the resource; a missing message throws, so the build fails. */
export function emailCopyOf(resource: unknown): EmailCopy {
  const base = ['signup', 'email'];
  const templates = Object.fromEntries(
    AUTH_EMAIL_TEMPLATES.map(({ key }) => [
      key,
      {
        subject: stringAt(resource, [...base, key, 'subject']),
        heading: stringAt(resource, [...base, key, 'heading']),
        body: stringAt(resource, [...base, key, 'body']),
        action: stringAt(resource, [...base, key, 'action']),
        ignore: stringAt(resource, [...base, key, 'ignore']),
      },
    ]),
  ) as Record<AuthEmailKey, TemplateCopy>;
  return {
    brand: stringAt(resource, ['auth', 'brand', 'name']),
    expiry: stringAt(resource, [...base, 'expiry']),
    fallback: stringAt(resource, [...base, 'fallback']),
    reason: stringAt(resource, [...base, 'reason']),
    templates,
  };
}

/**
 * AD-12's link, as GoTrue's template syntax. Plain: the layout writes its `&`
 * as `&amp;` in the attribute and the text, which escaping leaves the Go
 * template actions (`{{ .SiteURL }}`, `{{ .TokenHash }}`) untouched by.
 */
export function linkOf(type: string): string {
  return `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&type=${type}`;
}

/** The mark, on the origin GoTrue's `SiteURL` names (the app's). */
export const AUTH_EMAIL_MARK_URL = `{{ .SiteURL }}/${EMAIL_MARK_FILE}`;

/**
 * Each template's file name (under `auth-email/`) and its HTML, in the one
 * email layout: inline styles, one image (the mark, from the app origin), no
 * script, no stylesheet link and no remote font. Its only links are AD-12's.
 */
export function authEmailTemplates(resource: unknown): { readonly file: string; readonly html: string }[] {
  const copy = emailCopyOf(resource);
  return AUTH_EMAIL_TEMPLATES.map(({ key, file, type }) => {
    const text = copy.templates[key];
    const html = emailHtml({
      lang: 'hr',
      title: text.subject,
      preheader: text.body,
      brand: copy.brand,
      markUrl: AUTH_EMAIL_MARK_URL,
      heading: text.heading,
      paragraphs: [text.body],
      action: { label: text.action, href: linkOf(type) },
      fallback: copy.fallback,
      notes: [copy.expiry, text.ignore],
      footer: { lines: [copy.reason] },
    });
    return { file, html };
  });
}

/** Each template's subject, by the GoTrue variable that carries it. */
export function authEmailSubjects(resource: unknown): Readonly<Record<string, string>> {
  const copy = emailCopyOf(resource);
  return {
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: copy.templates.confirmation.subject,
    GOTRUE_MAILER_SUBJECTS_RECOVERY: copy.templates.recovery.subject,
    GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: copy.templates.emailChange.subject,
  };
}
