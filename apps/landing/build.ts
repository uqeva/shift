/**
 * STORY 21.21 (AD-28). Builds Smjenko's public page into `dist`:
 *
 *   node build.ts                 placeholders (`example.invalid`) for any input not set
 *   node build.ts --production    refuses a missing, invalid or placeholder input
 *
 * Three build inputs, none committed (the repository is public):
 *   - `LANDING_APP_URL`        the *Prijava* link, the app's origin;
 *   - `LANDING_CONTACT_EMAIL`  *Javi se*, shown as text and as a `mailto:`;
 *   - `LANDING_SIGNUP_URL`     *Registriraj se*, drawn only when set (D-S5;
 *                              unset by default, in production too).
 *
 * A URL is `https:`, or plain `http:` to a loopback host outside production,
 * with no user name or password. An address is `local@domain.tld` (no `%`, no
 * leading, trailing or double dot in the local part, a letter-only TLD, never
 * an IP literal). In production, a reserved name (`RESERVED_DOMAINS`: the
 * `.invalid`, `.test`, `.example`, `.localhost` TLDs and `example.com/.org/.net`,
 * with their subdomains, a trailing dot ignored) and every loopback are refused
 * in each URL and in the address's domain. Every value is HTML-escaped where it
 * lands.
 *
 * Every input, and the output directory (`checkOutDir`: never the repository
 * or an ancestor of this package, and only an empty directory or a previous
 * build), is checked BEFORE anything is written. The build is written into a
 * sibling directory and swapped into place, so a refused or failed build
 * leaves `outDir` as it was.
 *
 * The output: `index.html` and `404.html`, the stylesheet and both Outfit
 * subsets under `/assets/` with a content hash in their names (served
 * immutable), and the three icons copied byte-identical from `apps/web/public`.
 * No dependency: Node's own `fs`, `path` and `crypto`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const PLACEHOLDER_HOST = 'example.invalid';
export const PLACEHOLDERS = {
  LANDING_APP_URL: `https://app.${PLACEHOLDER_HOST}/`,
  LANDING_CONTACT_EMAIL: `kontakt@${PLACEHOLDER_HOST}`,
} as const;

/** The two Outfit subsets the app ships (`@fontsource-variable/outfit` 5.3.0). */
export const FONT_FILES = ['outfit-latin-wght-normal.woff2', 'outfit-latin-ext-wght-normal.woff2'] as const;
/** Copied as they are from the app's `public/`, never redrawn (story 21.24). */
export const ICON_FILES = ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'] as const;

export const FONT_DIR = join(here, 'node_modules', '@fontsource-variable', 'outfit', 'files');
export const WEB_PUBLIC = join(here, '..', 'web', 'public');
export const SOURCE_DIR = join(here, 'src');
export const DEFAULT_OUT_DIR = join(here, 'dist');

/**
 * Names that are never a real public address (RFC 2606, RFC 6761), each with
 * its subdomains: refused in a production build, in every URL and in the
 * address's domain. A trailing dot is stripped first, so `example.invalid.`
 * is refused as `example.invalid`.
 */
export const RESERVED_DOMAINS = ['invalid', 'test', 'example', 'localhost', 'example.com', 'example.org', 'example.net'] as const;

/** The local part has no `%`, no leading or trailing dot and no `..`; the
 *  domain is DNS labels ending in a letter-only TLD (never an IP literal). */
const EMAIL =
  /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export class LandingInputError extends Error {
  readonly input: string;
  constructor(input: string, reason: string) {
    super(`${input}: ${reason}`);
    this.name = 'LandingInputError';
    this.input = input;
  }
}

export interface LandingInputs {
  readonly appUrl: string;
  readonly contactEmail: string;
  readonly signupUrl: string | null;
}

export interface BuildOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly production: boolean;
  readonly outDir?: string;
  /**
   * Hostnames exempt from the reserved-name refusal in production. For tests
   * only (so they never need a real-looking domain); the CLI never sets it.
   */
  readonly allowReservedHosts?: readonly string[];
}

export interface BuildResult {
  readonly outDir: string;
  readonly inputs: LandingInputs;
  readonly stylesheet: string;
  readonly fonts: readonly string[];
}

function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function isReservedHost(hostname: string): boolean {
  const host = bare(hostname);
  return RESERVED_DOMAINS.some((reserved) => host === reserved || host.endsWith(`.${reserved}`));
}

export function isLoopbackHost(hostname: string): boolean {
  const host = bare(hostname);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '[::]'
  );
}

/** Production's refusal: a reserved name or a loopback, unless a test exempted the name. */
function refusedInProduction(hostname: string, allow: readonly string[]): boolean {
  if (isLoopbackHost(hostname)) return true;
  return isReservedHost(hostname) && !allow.includes(bare(hostname));
}

function valueOf(env: BuildOptions['env'], name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/** A checked URL, normalized by WHATWG parsing. */
export function checkUrl(input: string, raw: string, production: boolean, allow: readonly string[] = []): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LandingInputError(input, 'is not an absolute URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new LandingInputError(input, 'must not carry a user name or password');
  }
  if (url.protocol === 'http:') {
    if (production || !isLoopbackHost(url.hostname)) {
      throw new LandingInputError(input, 'must be https: (plain http: only to a loopback host outside production)');
    }
  } else if (url.protocol !== 'https:') {
    throw new LandingInputError(input, `must be https:, not ${url.protocol}`);
  }
  if (production && refusedInProduction(url.hostname, allow)) {
    throw new LandingInputError(input, 'is a reserved, placeholder or loopback name, refused in production');
  }
  return url.href;
}

export function checkEmail(input: string, raw: string, production: boolean, allow: readonly string[] = []): string {
  if (raw.length > 254 || !EMAIL.test(raw)) {
    throw new LandingInputError(input, 'is not an e-mail address (local@domain.tld)');
  }
  const domain = raw.slice(raw.indexOf('@') + 1);
  if (production && refusedInProduction(domain, allow)) {
    throw new LandingInputError(input, 'is a reserved, placeholder or loopback domain, refused in production');
  }
  return raw;
}

/** Reads and checks the three inputs. Throws a `LandingInputError` naming the input. */
export function readInputs(env: BuildOptions['env'], production: boolean, allow: readonly string[] = []): LandingInputs {
  const app = valueOf(env, 'LANDING_APP_URL');
  const email = valueOf(env, 'LANDING_CONTACT_EMAIL');
  const signup = valueOf(env, 'LANDING_SIGNUP_URL');
  if (production && app === null) throw new LandingInputError('LANDING_APP_URL', 'is missing, required in production');
  if (production && email === null) {
    throw new LandingInputError('LANDING_CONTACT_EMAIL', 'is missing, required in production');
  }
  return {
    appUrl: checkUrl('LANDING_APP_URL', app ?? PLACEHOLDERS.LANDING_APP_URL, production, allow),
    contactEmail: checkEmail('LANDING_CONTACT_EMAIL', email ?? PLACEHOLDERS.LANDING_CONTACT_EMAIL, production, allow),
    signupUrl: signup === null ? null : checkUrl('LANDING_SIGNUP_URL', signup, production, allow),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hashed(name: string, bytes: Buffer): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const dot = name.lastIndexOf('.');
  return `${name.slice(0, dot)}-${hash}${name.slice(dot)}`;
}

const SIGNUP_BLOCK = /<!-- signup -->([\s\S]*?)<!-- \/signup -->/g;

/** Fills one page's placeholders. Every `{{…}}` must be filled; an unknown one is a build error. */
export function renderPage(template: string, inputs: LandingInputs, assets: { stylesheet: string; font: string }): string {
  const withSignup = template.replace(SIGNUP_BLOCK, (_, block: string) => (inputs.signupUrl === null ? '' : block));
  const values: Record<string, string> = {
    APP_URL: escapeHtml(inputs.appUrl),
    CONTACT_EMAIL: escapeHtml(inputs.contactEmail),
    MAILTO: escapeHtml(`mailto:${inputs.contactEmail}`),
    SIGNUP_URL: escapeHtml(inputs.signupUrl ?? ''),
    STYLESHEET: escapeHtml(`/assets/${assets.stylesheet}`),
    FONT_PRELOAD: escapeHtml(`/assets/${assets.font}`),
  };
  return withSignup.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`landing: unknown placeholder ${match}`);
    return value;
  });
}

const REPO_ROOT = resolve(here, '..', '..');

/**
 * The output directory must be a build output: never the filesystem root, the
 * repository or one of this package's ancestors, and, when it exists, empty or
 * holding a previous build's `index.html`. Anything else is refused, never
 * deleted.
 */
export function checkOutDir(outDir: string): string {
  const target = resolve(outDir);
  const parent = dirname(target);
  if (target === parent || target === REPO_ROOT || `${here}${sep}`.startsWith(`${target}${sep}`)) {
    throw new Error(`landing: refusing to build into ${target}: not a build output directory`);
  }
  if (existsSync(target)) {
    const entries = readdirSync(target);
    if (entries.length > 0 && !entries.includes('index.html')) {
      throw new Error(`landing: refusing to replace ${target}: it is not empty and holds no index.html`);
    }
  }
  return target;
}

export function buildLanding({ env, production, outDir = DEFAULT_OUT_DIR, allowReservedHosts = [] }: BuildOptions): BuildResult {
  // 1. Every input, and the output directory, checked before anything is written.
  const inputs = readInputs(env, production, allowReservedHosts.map((host) => host.toLowerCase().replace(/\.$/, '')));
  const target = checkOutDir(outDir);
  const icons = ICON_FILES.map((icon) => ({ icon, bytes: readFileSync(join(WEB_PUBLIC, icon)) }));

  // 2. Fonts: byte-identical copies, named by their hash.
  const fonts = FONT_FILES.map((file) => {
    const bytes = readFileSync(join(FONT_DIR, file));
    return { file, bytes, name: hashed(file, bytes) };
  });

  // 3. The stylesheet points at the hashed fonts (beside it in /assets/), then is hashed itself.
  let css = readFileSync(join(SOURCE_DIR, 'styles.css'), 'utf8');
  for (const font of fonts) {
    const reference = `url(./fonts/${font.file})`;
    if (!css.includes(reference)) throw new Error(`landing: styles.css does not reference ${font.file}`);
    css = css.replaceAll(reference, `url(${font.name})`);
  }
  const cssBytes = Buffer.from(css, 'utf8');
  const stylesheet = hashed('styles.css', cssBytes);
  const latin = fonts[0];
  if (latin === undefined) throw new Error('landing: no font');
  const assets = { stylesheet, font: latin.name };

  const pages = ['index.html', '404.html'].map((page) => ({
    page,
    html: renderPage(readFileSync(join(SOURCE_DIR, page), 'utf8'), inputs, assets),
  }));

  // 4. Written only now, into a sibling directory, then swapped into place: a
  //    build that fails while writing leaves the previous output untouched.
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), `.${basename(target)}.building-`));
  try {
    mkdirSync(join(staging, 'assets'));
    for (const { page, html } of pages) writeFileSync(join(staging, page), html);
    writeFileSync(join(staging, 'assets', stylesheet), cssBytes);
    for (const font of fonts) writeFileSync(join(staging, 'assets', font.name), font.bytes);
    for (const { icon, bytes } of icons) writeFileSync(join(staging, icon), bytes);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return { outDir: target, inputs, stylesheet, fonts: fonts.map((font) => font.name) };
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const production = process.argv.includes('--production');
  try {
    const result = buildLanding({ env: process.env, production });
    const signup = result.inputs.signupUrl === null ? 'closed' : 'open';
    const placeholders = result.inputs.contactEmail.endsWith(`@${PLACEHOLDER_HOST}`) ? ' (placeholders)' : '';
    process.stdout.write(
      `landing: built ${basename(result.outDir)}/${placeholders}, signup ${signup}, ${production ? 'production' : 'plain'} build\n`,
    );
  } catch (error) {
    console.error(error instanceof LandingInputError ? `landing: refused, ${error.message}` : error);
    process.exitCode = 1;
  }
}
