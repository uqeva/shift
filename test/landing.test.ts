import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { buildLanding, checkOutDir, escapeHtml, FONT_FILES, ICON_FILES, LandingInputError, type BuildResult } from '../apps/landing/build.ts';
import { rawToken, type Theme } from './theme-css.ts';

/**
 * STORY 21.21 (AD-28): Smjenko's public page (`apps/landing`) and its image
 * (`deploy/landing`). DB-free. What needs no browser and no container is held
 * here: the built page's static checks (AD-28's list), the signup gate, the
 * production refusals (the spec's I/O matrix), the tokens equal to the app's
 * in both themes, the font and the mark identical to the app's, the 150 kB
 * static budget, the image's files and the CI job. The image itself is probed
 * by `scripts/ci/probe-landing-image.sh` and the page checked in Chromium by
 * `apps/landing/check/page.spec.ts`, both in CI's `landing-image` job.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...path: string[]): string => readFileSync(join(repoRoot, ...path), 'utf8');
const landing = (...path: string[]): string => join(repoRoot, 'apps', 'landing', ...path);

const scratch = mkdtempSync(join(tmpdir(), 'shift-landing-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * The production values the tests build with. Reserved names (RFC 2606), so
 * nothing here looks like a real domain; production refuses them unless a test
 * exempts them, which only these helpers do (`allowReservedHosts`, never set by
 * the CLI). The refusals below are built WITHOUT the exemption where it matters.
 */
const PRODUCTION = {
  LANDING_APP_URL: 'https://app.example.com',
  LANDING_CONTACT_EMAIL: 'pilot@example.com',
};
const ALLOW = ['app.example.com', 'example.com'];

let builds = 0;
function build(env: Record<string, string>, production = false): { result: BuildResult; html: string; notFound: string; css: string } {
  builds += 1;
  const outDir = join(scratch, `dist-${builds}`);
  const result = buildLanding({ env, production, outDir, allowReservedHosts: ALLOW });
  return {
    result,
    html: readFileSync(join(outDir, 'index.html'), 'utf8'),
    notFound: readFileSync(join(outDir, '404.html'), 'utf8'),
    css: readFileSync(join(outDir, 'assets', result.stylesheet), 'utf8'),
  };
}

/** Builds into a fresh directory that must stay unwritten; returns the refusal. */
function refusal(env: Record<string, string>, production: boolean, allow: string[] = ALLOW): LandingInputError {
  builds += 1;
  const outDir = join(scratch, `refused-${builds}`);
  let caught: unknown;
  try {
    buildLanding({ env, production, outDir, allowReservedHosts: allow });
  } catch (error) {
    caught = error;
  }
  expect(existsSync(outDir), 'a refused build writes nothing').toBe(false);
  expect(caught).toBeInstanceOf(LandingInputError);
  return caught as LandingInputError;
}

const plain = build({});
const pages = { 'index.html': plain.html, '404.html': plain.notFound };

/** A page's markup without its comments (they quote what they forbid). */
const markup = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

// ------------------------------------------------------------- AD-28's list

describe('the built page holds AD-28 static checks', () => {
  for (const [name, html] of Object.entries(pages)) {
    describe(name, () => {
      const page = markup(html);

      it('has no script, no inline handler, no style attribute or element, and no frame', () => {
        expect(page).not.toMatch(/<script/i);
        expect(page).not.toMatch(/\son[a-z]+\s*=/i);
        expect(page).not.toMatch(/\sstyle\s*=/i);
        expect(page).not.toMatch(/<style/i);
        expect(page).not.toMatch(/<(iframe|object|embed|form)\b/i);
        expect(page).not.toMatch(/javascript:/i);
      });

      it('names no origin but the three inputs (here, the placeholders)', () => {
        const origins = [...page.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi)].map((match) => new URL(match[0]).origin);
        expect(new Set(origins)).toEqual(new Set(['https://app.example.invalid']));
        expect(page).not.toMatch(/fonts\.(googleapis|gstatic)|cdn|analytics|gtag|plausible|matomo/i);
      });

      it('is Croatian, with one h1, headings in order, alt on every image and a skip link', () => {
        expect(page).toMatch(/<html lang="hr">/);
        expect(page.match(/<h1\b/g)).toHaveLength(1);
        const levels = [...page.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
        expect(levels[0]).toBe(1);
        for (let at = 1; at < levels.length; at += 1) {
          expect(levels[at]! - levels[at - 1]!, `heading ${at}`).toBeLessThanOrEqual(1);
        }
        for (const image of page.match(/<img\b[^>]*>/g) ?? []) expect(image).toMatch(/\salt="/);
        expect(page).toMatch(/<a class="skip-link" href="#sadrzaj">Preskoči na sadržaj<\/a>/);
        expect(page).toMatch(/<main id="sadrzaj"/);
        // The mark is decorative: hidden from assistive technology.
        expect(page).toMatch(/<svg class="mark" aria-hidden="true" focusable="false"/);
      });

      it('fills every placeholder and links only its own stylesheet', () => {
        expect(page).not.toMatch(/\{\{|\}\}/);
        expect(page).toContain(`<link rel="stylesheet" href="/assets/${plain.result.stylesheet}" />`);
        expect(page).toContain('Bez kolačića i praćenja.');
      expect(page).toContain('Ova stranica ne postavlja kolačiće');
        expect(page).toContain('href="https://app.example.invalid/">Prijava</a>');
      });
    });
  }

  it('says what Smjenko is and does, who it is for, how the pilot works, and how to ask', () => {
    const page = markup(plain.html);
    expect(page).toMatch(/<h1 id="naslov">Raspored smjena za <span class="nowrap">DVD-ove<\/span>, zaštitarske tvrtke i svaki posao u&nbsp;smjenama<\/h1>/);
    for (const heading of [
      'Turnus i ručni raspored',
      'Zamjene',
      'Godišnji odmor',
      'Sati i izvoz',
      'Kalendar na mobitelu',
      'Podsjetnici',
      'Blagdani',
      'Za koga je',
      'Kako ide pilot',
      'Javi se',
    ]) {
      expect(page, heading).toMatch(new RegExp(`<h[23][^>]*>${heading}</h[23]>`));
    }
    expect(page).toContain('<em>kao na papiru</em>');
    expect(page).toContain('<title>Smjenko · raspored smjena za DVD-ove, zaštitarske tvrtke i svaki posao u smjenama</title>');
    // Javi se: the address as selectable text, and a mailto: link.
    expect(page).toContain('<p class="email">kontakt@example.invalid</p>');
    expect(page).toContain('<a class="button button-ink" href="mailto:kontakt@example.invalid">Pošalji e-poruku</a>');
    expect(page).toMatch(/<footer class="site-footer">[\s\S]*Bez kolačića i praćenja\.[\s\S]*kolačiće[\s\S]*<\/footer>/);
  });

  it('keeps the stylesheet to its own origin: no @import, no external url(), only the hashed fonts', () => {
    const css = plain.css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/@import|https?:/);
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
    expect(urls.sort()).toEqual([...plain.result.fonts].sort());
  });
});

// ------------------------------------------------------------- the signup gate

describe('Registriraj se is drawn only when LANDING_SIGNUP_URL is set (D-S5)', () => {
  it('is absent by default, in a plain and in a production build', () => {
    expect(plain.html).not.toContain('Registriraj se');
    expect(build(PRODUCTION, true).html).not.toContain('Registriraj se');
  });

  it('links the signup URL when it is set', () => {
    const open = build({ LANDING_SIGNUP_URL: 'https://app.example.com/registracija' });
    expect(open.html).toContain('<a class="button button-quiet" href="https://app.example.com/registracija">Registriraj se</a>');
    expect(open.notFound).not.toContain('Registriraj se');
  });
});

// ------------------------------------------------------------- the I/O matrix

describe('the inputs (the I/O matrix)', () => {
  it('a plain build uses example.invalid placeholders', () => {
    expect(plain.result.inputs).toEqual({
      appUrl: 'https://app.example.invalid/',
      contactEmail: 'kontakt@example.invalid',
      signupUrl: null,
    });
  });

  it('a production build with real inputs fills them, escaped', () => {
    const built = build({ ...PRODUCTION, LANDING_APP_URL: 'https://app.example.com/?a=1&b=2' }, true);
    expect(built.html).toContain('href="https://app.example.com/?a=1&amp;b=2">Prijava</a>');
    expect(built.html).toContain('<p class="email">pilot@example.com</p>');
    expect(built.html).toContain('href="mailto:pilot@example.com"');
    expect(built.html).not.toContain('example.invalid');
  });

  it('escapes every value', () => {
    expect(escapeHtml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&#39;');
    // A quote in a URL is percent-encoded by parsing, so it can never close the attribute.
    const built = build({ LANDING_APP_URL: 'https://app.example.com/"><x' });
    expect(built.html).toContain('href="https://app.example.com/%22%3E%3Cx">Prijava</a>');
  });

  it('production refuses a missing or placeholder value, naming the input', () => {
    expect(refusal({}, true).input).toBe('LANDING_APP_URL');
    expect(refusal({ LANDING_APP_URL: PRODUCTION.LANDING_APP_URL }, true).input).toBe('LANDING_CONTACT_EMAIL');
    expect(refusal({ ...PRODUCTION, LANDING_APP_URL: 'https://app.example.invalid' }, true).input).toBe('LANDING_APP_URL');
    expect(refusal({ ...PRODUCTION, LANDING_CONTACT_EMAIL: 'kontakt@example.invalid' }, true).input).toBe('LANDING_CONTACT_EMAIL');
    expect(refusal({ ...PRODUCTION, LANDING_SIGNUP_URL: 'https://example.invalid/x' }, true).input).toBe('LANDING_SIGNUP_URL');
    expect(refusal({ ...PRODUCTION, LANDING_APP_URL: '   ' }, true).input).toBe('LANDING_APP_URL');
  });

  it.each([
    ['javascript:alert(1)'],
    ['ftp://app.example.com/'],
    ['https://user:secret@app.example.com/'],
    ['https://user@app.example.com/'],
    ['http://app.example.com/'],
    ['data:text/html,x'],
    ['//app.example.com/'],
    ['not a url'],
  ])('refuses the URL %s, in every input and every mode', (url) => {
    for (const input of ['LANDING_APP_URL', 'LANDING_SIGNUP_URL']) {
      for (const production of [false, true]) {
        expect(refusal({ ...PRODUCTION, [input]: url }, production).input).toBe(input);
      }
    }
  });

  it('production refuses reserved names and loopbacks, a trailing dot ignored, in every URL and the address', () => {
    const reservedHosts = [
      'app.example.invalid.',
      'invalid',
      'app.test',
      'app.example',
      'app.localhost',
      'localhost',
      'localhost.',
      'example.com',
      'app.example.com.',
      'www.example.org',
      'example.net',
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '[::1]',
    ];
    // The other inputs on names exempted here only, none of them under test.
    const base = { LANDING_APP_URL: 'https://app.example.org', LANDING_CONTACT_EMAIL: 'pilot@example.org' };
    const exempt = ['app.example.org', 'example.org'];
    for (const host of reservedHosts) {
      for (const input of ['LANDING_APP_URL', 'LANDING_SIGNUP_URL']) {
        expect(refusal({ ...base, [input]: `https://${host}/` }, true, exempt).input, `${input} ${host}`).toBe(input);
      }
    }
    for (const domain of ['example.invalid', 'mail.test', 'example.com', 'x.example.org', 'example.net', 'localhost.localhost']) {
      expect(refusal({ ...base, LANDING_CONTACT_EMAIL: `info@${domain}` }, true, exempt).input, domain).toBe('LANDING_CONTACT_EMAIL');
    }
    // Without the exemption, the tests' own production values are refused too.
    expect(refusal(PRODUCTION, true, []).input).toBe('LANDING_APP_URL');
    // A plain build takes the same names (they are what it builds with).
    expect(build({ LANDING_APP_URL: 'https://app.example.com./' }).result.inputs.appUrl).toBe('https://app.example.com./');
  });

  it('a refused build into an existing output leaves every file as it was', () => {
    const outDir = join(scratch, 'kept');
    buildLanding({ env: {}, production: false, outDir });
    const snapshot = (): Map<string, string> =>
      new Map(
        readdirSync(outDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const path = join(entry.parentPath, entry.name);
            return [path, readFileSync(path).toString('base64')] as const;
          }),
      );
    const before = snapshot();
    const indexBefore = readFileSync(join(outDir, 'index.html'));
    expect(() => buildLanding({ env: { LANDING_APP_URL: 'javascript:alert(1)' }, production: false, outDir })).toThrow(LandingInputError);
    expect(() => buildLanding({ env: {}, production: true, outDir })).toThrow(LandingInputError);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(outDir, 'index.html')).equals(indexBefore)).toBe(true);
    // No staging directory is left beside it.
    expect(readdirSync(scratch).filter((name) => name.includes('.building-'))).toEqual([]);
  });

  it('never builds into the repository, this package, or a directory that is not a build output', () => {
    expect(() => checkOutDir(repoRoot)).toThrow(/not a build output/);
    expect(() => checkOutDir(landing())).toThrow(/not a build output/);
    expect(() => checkOutDir('/')).toThrow(/not a build output/);
    const foreign = join(scratch, 'foreign');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'keep.txt'), 'mine');
    expect(() => buildLanding({ env: {}, production: false, outDir: foreign })).toThrow(/holds no index\.html/);
    expect(readFileSync(join(foreign, 'keep.txt'), 'utf8')).toBe('mine');
    expect(checkOutDir(join(scratch, 'not-yet'))).toBe(join(scratch, 'not-yet'));
  });

  it('the mailto: link is exactly mailto: and the address shown', () => {
    const built = build({ LANDING_CONTACT_EMAIL: 'info+pilot@example.invalid' });
    const shown = /<p class="email">([^<]+)<\/p>/.exec(built.html)?.[1];
    const href = /href="(mailto:[^"]+)"/.exec(built.html)?.[1];
    expect(shown).toBe('info+pilot@example.invalid');
    expect(href).toBe(`mailto:${shown}`);
  });

  it('allows plain http: to a loopback host outside production only', () => {
    for (const url of ['http://127.0.0.1:5173/', 'http://localhost:8080/', 'http://[::1]:8080/']) {
      expect(build({ LANDING_APP_URL: url }).result.inputs.appUrl).toBe(url);
      expect(refusal({ ...PRODUCTION, LANDING_APP_URL: url }, true).input).toBe('LANDING_APP_URL');
    }
  });

  it.each([
    ['a@b'],
    ['a b@example.com'],
    ['<a>@example.com'],
    ['a@exa mple.com'],
    ['a@example.com>'],
    ['@example.com'],
    ['a@@example.com'],
    ['a@-x.com'],
    ['a%b@example.com'],
    ['.a@example.com'],
    ['a.@example.com'],
    ['a..b@example.com'],
    ['a@1.2.3.4'],
    ['a@[127.0.0.1]'],
    ['a@example.com.'],
  ])(
    'refuses the address %s, naming the input',
    (email) => {
      for (const production of [false, true]) {
        expect(refusal({ ...PRODUCTION, LANDING_CONTACT_EMAIL: email }, production).input).toBe('LANDING_CONTACT_EMAIL');
      }
    },
  );

  it('the CLI refuses with a message naming the input and a non-zero exit', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [landing('build.ts'), '--production'], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', LANDING_APP_URL: 'https://app.example.com', LANDING_CONTACT_EMAIL: 'pilot@example.com' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LANDING_APP_URL: is a reserved');
  });

  it('scripts: build is plain, build:production refuses placeholders', () => {
    const scripts = (JSON.parse(read('apps', 'landing', 'package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['build']).toBe('node build.ts');
    expect(scripts['build:production']).toBe('node build.ts --production');
  });
});

// ------------------------------------------------------------- the app's identity

/** `--name: value` declarations of one block, comment-blind. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(?<![\w-])--([a-z0-9-]+):\s*([^;]+);/g)) {
    expect(found.has(match[1]!), `--${match[1]} declared twice`).toBe(false);
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let at = open; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1;
    if (css[at] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, at);
    }
  }
  throw new Error(`unbalanced ${marker}`);
}

describe("the page is the app's: tokens, font and mark", () => {
  const source = read('apps', 'landing', 'src', 'styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const light = declarations(blockAfter(source, ':root {'));
  const darkMedia = blockAfter(source, '@media (prefers-color-scheme: dark) {');
  const dark = declarations(blockAfter(darkMedia, ':root {'));

  it.each([
    ['light', light],
    ['dark', dark],
  ] as [Theme, Map<string, string>][])('every %s token equals apps/web index.css', (theme, tokens) => {
    expect(tokens.size).toBeGreaterThan(20);
    for (const [name, value] of tokens) {
      expect(value, `--${name} (${theme})`).toBe(rawToken(theme, name));
    }
  });

  it('declares every dark token in light too, and changes the theme only by prefers-color-scheme', () => {
    for (const name of dark.keys()) expect(light.has(name), name).toBe(true);
    expect(source).not.toMatch(/data-theme|\.dark\b/);
  });

  it('copies Outfit 5.3.0 byte-identical, with the package unicode-ranges, and never Google', () => {
    const version = (path: string[]): string =>
      (JSON.parse(read(...path)) as { dependencies: Record<string, string> }).dependencies['@fontsource-variable/outfit']!;
    expect(version(['apps', 'landing', 'package.json'])).toBe('5.3.0');
    expect(version(['apps', 'web', 'package.json'])).toBe('5.3.0');

    const fontsource = join(repoRoot, 'apps', 'web', 'node_modules', '@fontsource-variable', 'outfit');
    const ranges = (css: string): string[] => [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((match) => match[1]!.trim()).sort();
    expect(ranges(source)).toEqual(ranges(readFileSync(join(fontsource, 'index.css'), 'utf8')));

    for (const file of FONT_FILES) {
      const built = plain.result.fonts.find((name) => name.startsWith(file.replace('.woff2', '-')));
      expect(built, file).toBeDefined();
      expect(readFileSync(join(plain.result.outDir, 'assets', built!)).equals(readFileSync(join(fontsource, 'files', file))), file).toBe(true);
    }
  });

  it("draws 21.24's mark: the same paths and colours as brand-mark.tsx, inline and decorative", () => {
    const component = read('apps', 'web', 'src', 'components', 'brand-mark.tsx');
    const paths = (text: string): string[] => [...text.matchAll(/<path stroke="([^"]+)" d="([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(paths(component)).toHaveLength(2);
    for (const html of Object.values(pages)) {
      expect(paths(html)).toEqual(paths(component));
      expect(html).toContain('<rect width="512" height="512" rx="112" fill="#0F172A" />');
      expect(html).toContain('x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#FFF" stroke-opacity=".16" stroke-width="12"');
    }
  });

  it('copies the icons byte-identical from apps/web/public', () => {
    for (const icon of ICON_FILES) {
      expect(readFileSync(join(plain.result.outDir, icon)).equals(readFileSync(join(repoRoot, 'apps', 'web', 'public', icon))), icon).toBe(true);
    }
  });

  it('keeps the first view, fonts included, under 150 kB (static, uncompressed)', () => {
    const first = ['index.html', 'favicon.svg', join('assets', plain.result.stylesheet), ...plain.result.fonts.map((font) => join('assets', font))];
    const bytes = first.reduce((sum, file) => sum + statSync(join(plain.result.outDir, file)).size, 0);
    expect(bytes).toBeLessThan(150_000);
    // Everything in dist is accounted for: nothing else ships.
    const everything = readdirSync(plain.result.outDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    expect(everything.map((entry) => entry.name).sort()).toEqual(
      ['404.html', 'index.html', ...ICON_FILES, plain.result.stylesheet, ...plain.result.fonts].sort(),
    );
  });
});

// ------------------------------------------------------------- the image

const IMAGE =
  'nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03';
const HEADERS_INCLUDE = 'include /etc/nginx/shift/security-headers.conf;';
const EXPECTED_HEADERS: [string, string][] = [
  [
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  ],
  // This host only: includeSubDomains at the apex is the founder's later decision.
  ['Strict-Transport-Security', 'max-age=31536000'],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  [
    'Permissions-Policy',
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), browsing-topics=()',
  ],
];

describe('the shift-landing image (deploy/landing)', () => {
  const dockerfile = read('deploy', 'landing', 'Dockerfile');
  const conf = read('deploy', 'landing', 'default.conf').replace(/^\s*#.*$/gm, '');
  const headers = read('deploy', 'landing', 'security-headers.conf');
  const probe = read('scripts', 'ci', 'probe-landing-image.sh');

  it("sets exactly AD-28's six headers, always, and the probe expects the same", () => {
    const lines = headers.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    expect(lines).toEqual(EXPECTED_HEADERS.map(([name, value]) => `add_header ${name} "${value}" always;`));
    for (const [name, value] of EXPECTED_HEADERS) expect(probe, name).toContain(`${name}: ${value}`);
    // The same Permissions-Policy as shift-web; HSTS without includeSubDomains or preload.
    const web = read('apps', 'web', 'public', '_headers');
    expect(web).toContain(`Permissions-Policy: ${EXPECTED_HEADERS[5]![1]}`);
    const active = (text: string): string => text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(active(headers) + active(probe)).not.toMatch(/includeSubDomains|preload/);
  });

  it("is on shift-web's pinned base, root-owned, checked, uid 101, with a HEALTHCHECK", () => {
    expect(dockerfile.match(/^FROM .*/gm)).toEqual([`FROM ${IMAGE}`]);
    expect(read('deploy', 'web', 'Dockerfile')).toContain(`FROM ${IMAGE}`);
    expect(dockerfile).toContain('COPY --chown=root:root apps/landing/dist/ /usr/share/nginx/html/');
    expect(dockerfile).toContain('chown -R root:root /etc/nginx /var/cache/nginx /usr/share/nginx/html');
    expect(dockerfile).toContain('RUN nginx -t');
    for (const file of [
      "-name 'outfit-latin-wght-normal-*.woff2'",
      "-name 'outfit-latin-ext-wght-normal-*.woff2'",
      'test -f /usr/share/nginx/html/favicon.svg',
      'test -f /usr/share/nginx/html/favicon.ico',
      'test -f /usr/share/nginx/html/apple-touch-icon-180x180.png',
    ]) {
      expect(dockerfile, file).toContain(file);
    }
    expect(dockerfile.trim().split('\n').filter((line) => /^USER /.test(line))).toEqual(['USER root', 'USER 101']);
    expect(dockerfile).toMatch(/HEALTHCHECK [^\n]*\\\n\s+CMD wget -q -O \/dev\/null http:\/\/127\.0\.0\.1:8080\//);
  });

  it('includes the headers in the server and in every location, and has no SPA fallback', () => {
    const locations = conf.match(/location [^{]+\{/g) ?? [];
    expect(locations.length).toBeGreaterThanOrEqual(4);
    expect(conf.split(HEADERS_INCLUDE).length - 1).toBe(locations.length + 1);
    expect(conf).toContain('error_page 404 /404.html;');
    expect(conf).not.toMatch(/try_files[^;]*\/index\.html;/);
    expect(conf).toContain('try_files /index.html =404;');
    expect(conf).toMatch(/location \/assets\/ \{[^}]*add_header Cache-Control "public, max-age=31536000, immutable";/);
    expect(conf).toMatch(/location = \/404\.html \{\s*internal;/);
    expect(conf).toContain('server_tokens off;');
    // No header but the six and Cache-Control.
    for (const match of conf.matchAll(/add_header (\S+)/g)) expect(match[1]).toBe('Cache-Control');
  });

  it('the probe runs offline, read-only, and checks uid, health, writability and 404s', () => {
    expect(probe).toContain('docker run -d --name "$name" --network none --read-only --tmpfs /tmp "$image"');
    for (const marker of ['expect "/$font_ext" 200 font/woff2', 'expect /nope 404', 'expect /assets/nope.css 404', 'METHOD=POST', 'METHOD=HEAD', 'Content-Encoding: gzip', '304', '400', 'HEALTHCHECK', 'uid 101', 'writable by uid 101', 'Set-Cookie']) {
      expect(probe, marker).toContain(marker);
    }
  });
});

// ------------------------------------------------------------- the CI job

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  steps?: Step[];
}

describe("CI's landing-image job", () => {
  const pipeline = parse(read('.github', 'workflows', 'pipeline.yml')) as { jobs: Record<string, Job> };
  const job = pipeline.jobs['landing-image'];
  const runs = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');

  it('builds with placeholders, builds the image, probes it and checks it in Chromium, pushing nothing', () => {
    expect(job?.needs).toBe('quality');
    expect(runs).toContain('pnpm --filter @shift/landing build');
    expect(runs).not.toContain('build:production');
    expect(runs).not.toMatch(/LANDING_(APP_URL|CONTACT_EMAIL)=/);
    expect(runs).toContain('docker build --pull -f deploy/landing/Dockerfile -t "shift-landing:ci-$GITHUB_SHA" .');
    expect(runs).toContain('bash scripts/ci/probe-landing-image.sh "shift-landing:ci-$GITHUB_SHA" apps/landing/dist');
    expect(runs).toContain('pnpm exec playwright test -c apps/landing/playwright.config.ts');
    expect((job?.steps ?? []).some((step) => step.uses === './.github/actions/playwright')).toBe(true);
    expect(JSON.stringify(job)).not.toMatch(/docker push|registry\.sh|packages|secrets\./);
    // Published on the runner's loopback only, failing with the log when it never answers.
    expect(runs).toContain('-p "127.0.0.1:$2:8080"');
    expect(runs).toMatch(/if \[ "\$ready" != 1 \]; then[\s\S]*docker logs "\$3"[\s\S]*docker rm -f "\$3"[\s\S]*return 1/);
    // A second pass with signup open: rebuilt, its own tag, its own port.
    expect(runs).toContain('check "shift-landing:ci-$GITHUB_SHA" 8088 shift-landing-check');
    expect(runs).toContain('LANDING_SIGNUP_URL=https://app.example.invalid/registracija pnpm --filter @shift/landing build');
    expect(runs).toContain('docker build -f deploy/landing/Dockerfile -t "shift-landing:ci-signup-$GITHUB_SHA" .');
    expect(runs).toContain('check "shift-landing:ci-signup-$GITHUB_SHA" 8089 shift-landing-check-signup');
  });

  it('gates CI passed and the notify job, and ShellCheck reads the probe', () => {
    expect(pipeline.jobs['ci-passed']?.needs).toContain('landing-image');
    expect(pipeline.jobs['notify']?.needs).toContain('landing-image');
    const shellcheck = pipeline.jobs['quality']?.steps?.find((step) => step.name === 'ShellCheck')?.run ?? '';
    expect(shellcheck).toContain('scripts/ci/probe-landing-image.sh');
  });
});
