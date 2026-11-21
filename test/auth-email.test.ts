import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  AUTH_EMAIL_DIRECTORY,
  AUTH_EMAIL_TEMPLATES,
  authEmailSubjects,
  authEmailTemplates,
  emailCopyOf,
  escapeHtml,
} from '../apps/web/src/lib/auth-email.ts';
import { leafKeys } from '../apps/web/src/lib/i18n/resource-tree.fixture.ts';

/**
 * Story 19.1 (AD-21, AD-12, D-S4): the Croatian Auth email. The templates are
 * built from `hr.json`'s `signup.email` keys at web build into
 * `dist/auth-email/*.html`, GoTrue fetches them from the app origin
 * (`GOTRUE_MAILER_TEMPLATES_*`), and their subjects are the compose's
 * `GOTRUE_MAILER_SUBJECTS_*`. This file pins both ends to `hr.json`, and every
 * link to AD-12's `token_hash` form. DB-free; the built files are read when a
 * build exists.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RESOURCE = join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json');
const resource = JSON.parse(readFileSync(RESOURCE, 'utf8')) as unknown;
const dist = join(repoRoot, 'apps', 'web', 'dist');
const notBuilt = !existsSync(join(dist, 'index.html'));

const composeText = readFileSync(join(repoRoot, 'deploy', 'coolify', 'supabase', 'docker-compose.yml'), 'utf8');
const compose = parse(composeText) as { services: Record<string, { environment?: string[] }> };

function authEnvironment(): Map<string, string> {
  return new Map(
    (compose.services['supabase-auth']?.environment ?? []).map((entry): [string, string] => {
      const at = entry.indexOf('=');
      return [entry.slice(0, at), entry.slice(at + 1)];
    }),
  );
}

/** Every `href` of a template. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('the Auth email templates (story 19.1)', () => {
  it('builds one template per GoTrue mail Shift sends, each from its own hr.json keys', () => {
    const built = authEmailTemplates(resource);
    expect(built.map(({ file }) => file)).toEqual(['confirmation.html', 'recovery.html', 'email-change.html']);
    const copy = emailCopyOf(resource);
    for (const [index, { key }] of AUTH_EMAIL_TEMPLATES.entries()) {
      const html = built[index]?.html ?? '';
      const text = copy.templates[key];
      expect(html).toContain('<html lang="hr">');
      for (const message of [text.subject, text.heading, text.body, text.action, text.ignore, copy.expiry, copy.fallback]) {
        expect(html, `${key} lacks ${message}`).toContain(escapeHtml(message));
      }
    }
  });

  it('uses every signup.email key hr.json declares, and no other', () => {
    // No screen renders these (the SPA's key sweep leaves the namespace out),
    // so this is where an unused or a missing one is noticed.
    const copy = emailCopyOf(resource);
    const read = [
      'signup.email.expiry',
      'signup.email.fallback',
      ...AUTH_EMAIL_TEMPLATES.flatMap(({ key }) =>
        Object.keys(copy.templates[key]).map((field) => `signup.email.${key}.${field}`),
      ),
    ].sort();
    expect(leafKeys(resource).filter((key) => key.startsWith('signup.email.')).sort()).toEqual(read);
    expect(read).toHaveLength(17);
  });

  it('links every mail to /potvrda with a token_hash and its own type, and to nothing else (AD-12)', () => {
    const types: Record<string, string> = {
      'confirmation.html': 'signup',
      'recovery.html': 'recovery',
      'email-change.html': 'email_change',
    };
    for (const { file, html } of authEmailTemplates(resource)) {
      const links = hrefs(html);
      expect(links.length, file).toBe(2);
      for (const link of links) {
        expect(link, file).toBe(`{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&amp;type=${types[file] ?? ''}`);
      }
      // No GET on /auth/v1/verify, no session token, no remote resource.
      expect(html, file).not.toContain('ConfirmationURL');
      expect(html, file).not.toMatch(/\/auth\/v1\/|access_token|refresh_token/);
      expect(html, file).not.toMatch(/<img|<script|<link|src=|url\(/i);
      expect(html, file).toContain('token_hash');
    }
  });

  it('gives GoTrue each template from the app origin, and each subject word for word from hr.json', () => {
    const env = authEnvironment();
    for (const { file } of AUTH_EMAIL_TEMPLATES) {
      const variable = {
        'confirmation.html': 'GOTRUE_MAILER_TEMPLATES_CONFIRMATION',
        'recovery.html': 'GOTRUE_MAILER_TEMPLATES_RECOVERY',
        'email-change.html': 'GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE',
      }[file];
      expect(env.get(variable), variable).toBe(`\${SHIFT_APP_URL:?}/${AUTH_EMAIL_DIRECTORY}/${file}`);
    }
    const subjects = authEmailSubjects(resource);
    expect(Object.keys(subjects).length).toBe(3);
    for (const [variable, subject] of Object.entries(subjects)) {
      expect(env.get(variable), variable).toBe(subject);
    }
    // No other GoTrue template or subject is set (invite and magic link are
    // routes Kong closes, AD-22).
    expect([...env.keys()].filter((key) => /^GOTRUE_MAILER_(TEMPLATES|SUBJECTS)_/.test(key)).sort()).toEqual(
      [
        'GOTRUE_MAILER_TEMPLATES_CONFIRMATION',
        'GOTRUE_MAILER_TEMPLATES_RECOVERY',
        'GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE',
        ...Object.keys(subjects),
      ].sort(),
    );
  });

  it('escapes the copy it splices into HTML, and refuses a missing message', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(() => emailCopyOf({ signup: { email: {} } })).toThrow(/signup\.email\.confirmation\.subject/);
    expect(() => emailCopyOf({})).toThrow(/hr\.json has no message/);
  });

  it('refuses copy that GoTrue would read as template syntax (review 2)', () => {
    const tampered = structuredClone(resource) as { signup: { email: { recovery: { body: string }; fallback: string } } };
    tampered.signup.email.recovery.body = 'Pozdrav {{ .Email }}';
    expect(() => emailCopyOf(tampered)).toThrow(/signup\.email\.recovery\.body holds a Go template delimiter/);
    const closing = structuredClone(resource) as { signup: { email: { fallback: string } } };
    closing.signup.email.fallback = 'kraj }}';
    expect(() => emailCopyOf(closing)).toThrow(/signup\.email\.fallback holds a Go template delimiter/);
  });

  it('gives the local stack the same templates and subjects, committed and current (story 19.2)', () => {
    // The CLI reads `content_path` at `supabase start`, before any build, so
    // the three files are committed under `supabase/templates/auth-email/`
    // and must equal what the build emits from today's `hr.json`
    // (`node scripts/auth-email-templates.mjs` rewrites them).
    const config = readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8');
    const section = (name: string): Map<string, string> => {
      const at = config.indexOf(`[auth.email.template.${name}]`);
      expect(at, `[auth.email.template.${name}] is missing`).toBeGreaterThan(-1);
      const body = config.slice(at).split('\n').slice(1);
      const end = body.findIndex((line) => line.startsWith('['));
      return new Map(
        (end === -1 ? body : body.slice(0, end))
          .map((line) => /^(\w+) = "(.*)"$/.exec(line.trim()))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match): [string, string] => [match[1] ?? '', match[2] ?? '']),
      );
    };
    const subjects = authEmailSubjects(resource);
    const cli = {
      'confirmation.html': ['confirmation', 'GOTRUE_MAILER_SUBJECTS_CONFIRMATION'],
      'recovery.html': ['recovery', 'GOTRUE_MAILER_SUBJECTS_RECOVERY'],
      'email-change.html': ['email_change', 'GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE'],
    } as const;
    for (const { file, html } of authEmailTemplates(resource)) {
      const [name, subject] = cli[file as keyof typeof cli];
      const values = section(name);
      expect(values.get('content_path'), name).toBe(`./supabase/templates/${AUTH_EMAIL_DIRECTORY}/${file}`);
      expect(values.get('subject'), name).toBe(subjects[subject]);
      expect(
        readFileSync(join(repoRoot, 'supabase', 'templates', AUTH_EMAIL_DIRECTORY, file), 'utf8'),
        `supabase/templates/${AUTH_EMAIL_DIRECTORY}/${file} is stale: run node scripts/auth-email-templates.mjs`,
      ).toBe(html);
    }
    expect(readdirSync(join(repoRoot, 'supabase', 'templates', AUTH_EMAIL_DIRECTORY)).sort()).toEqual(
      AUTH_EMAIL_TEMPLATES.map(({ file }) => file).sort(),
    );
    expect(config.match(/^\[auth\.email\.template\.[a-z_]+\]$/gm)).toHaveLength(3);
  });

  it.skipIf(notBuilt)('is emitted by the web build as exactly these files, which the worker never precaches', () => {
    const emitted = readdirSync(join(dist, AUTH_EMAIL_DIRECTORY)).sort();
    expect(emitted).toEqual(AUTH_EMAIL_TEMPLATES.map(({ file }) => file).sort());
    for (const { file, html } of authEmailTemplates(resource)) {
      expect(readFileSync(join(dist, AUTH_EMAIL_DIRECTORY, file), 'utf8'), `dist/auth-email/${file} is stale`).toBe(html);
    }
    const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(worker).not.toContain(AUTH_EMAIL_DIRECTORY);
  });
});
