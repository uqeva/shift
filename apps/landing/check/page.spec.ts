import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * STORY 21.21 (AD-28). The public page in Chromium, against the running image
 * (`playwright.config.ts` says how it is started). At a phone's 320 px and a
 * desktop's 1280 px, in the light and the dark theme:
 *
 *   - axe (`axe-core`, the root devDependency) finds no violation;
 *   - nothing is requested from another origin, and nothing fails;
 *   - no cookie is set, and no answer carries `Set-Cookie`;
 *   - no console error, so the strict policy refused nothing the page uses;
 *   - no horizontal scroll, and every link is a 44 px target;
 *   - the first view, fonts included, is under 150 kB transferred.
 *
 * The 404 page is checked at both widths too. The page has no script, so axe
 * is run through Playwright's evaluate (DevTools' own channel, which the
 * page's policy does not govern), never through an injected `<script>`.
 */

const BUDGET_BYTES = 150_000;
const WIDTHS = [320, 1280] as const;
const THEMES = ['light', 'dark'] as const;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const screenshotDir = process.env['LANDING_SCREENSHOT_DIR'];

interface Visit {
  readonly page: Page;
  readonly origins: Set<string>;
  readonly failures: string[];
  readonly consoleErrors: string[];
  readonly setCookies: string[];
  readonly transferred: () => Promise<number>;
  readonly close: () => Promise<void>;
}

async function visit(
  browser: Browser,
  baseURL: string,
  path: string,
  width: number,
  theme: 'light' | 'dark',
): Promise<Visit> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width === 320 ? 640 : 800 },
    colorScheme: theme,
    locale: 'hr-HR',
  });
  const page = await context.newPage();
  const origins = new Set<string>();
  const failures: string[] = [];
  const consoleErrors: string[] = [];
  const setCookies: string[] = [];
  const sizes: Promise<number>[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'data:') origins.add(url.origin);
  });
  page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText ?? ''}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response) => {
    const cookie = response.headers()['set-cookie'];
    if (cookie !== undefined) setCookies.push(`${response.url()}: ${cookie}`);
    sizes.push(
      response
        .request()
        .sizes()
        .then((size) => size.responseBodySize + size.responseHeadersSize)
        .catch(() => 0),
    );
  });

  await page.goto(path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  return {
    page,
    origins,
    failures,
    consoleErrors,
    setCookies,
    transferred: async () => (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0),
    close: () => context.close(),
  };
}

interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: { readonly target: unknown[] }[];
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({ target: node.target })),
    }));
  }, AXE_TAGS);
  return violations.map(
    (violation) => `${violation.id} (${violation.impact ?? '-'}): ${violation.nodes.map((node) => JSON.stringify(node.target)).join(', ')}`,
  );
}

function baseOf(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error('no baseURL');
  return baseURL;
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`the page at ${width} px, ${theme}`, async ({ browser, baseURL }) => {
      const base = baseOf(baseURL);
      const own = new URL(base).origin;
      const run = await visit(browser, base, '/', width, theme);
      const { page } = run;

      await expect(page.locator('html')).toHaveAttribute('lang', 'hr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      // Prijava, and Javi se with the address as text and a mailto: link.
      await expect(page.getByRole('link', { name: 'Prijava' }).first()).toBeVisible();
      await expect(page.locator('#kontakt .email')).toBeVisible();
      await expect(page.locator('#kontakt a[href^="mailto:"]')).toBeVisible();
      await expect(page.getByText('Bez kolačića i praćenja.')).toBeVisible();

      // The theme the OS asked for is the one drawn.
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background, 'the page background').toBe(theme === 'light' ? 'oklch(0.9446 0.012 259.82)' : 'oklch(0.1765 0.0346 267.28)');
      // The app's own font, from this origin.
      expect(await page.evaluate(() => document.fonts.check('600 16px "Outfit Variable"', 'ščćžđ'))).toBe(true);

      expect([...run.origins], 'requested origins').toEqual([own]);
      expect(run.failures, 'failed requests').toEqual([]);
      expect(run.consoleErrors, 'console errors (a refused policy shows here)').toEqual([]);
      expect(run.setCookies, 'Set-Cookie answers').toEqual([]);
      expect(await page.context().cookies(), 'cookies').toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(0);

      const small = await page.evaluate(() =>
        [...document.querySelectorAll('a')]
          .filter((link) => !link.classList.contains('skip-link'))
          .map((link) => ({ text: link.textContent?.trim() ?? '', box: link.getBoundingClientRect() }))
          .filter(({ box }) => box.height < 44 || box.width < 44)
          .map(({ text, box }) => `${text} ${Math.round(box.width)}x${Math.round(box.height)}`),
      );
      expect(small, 'links under 44 px').toEqual([]);

      const transferred = await run.transferred();
      expect(transferred, `first view transferred (${transferred} B)`).toBeLessThan(BUDGET_BYTES);

      // Run before the Tab below: unfocused, the skip link is translated out of
      // view; focused, it is drawn over the header's mark, which axe's
      // target-size rule would report as an overlap.
      expect(await axeViolations(page), 'axe violations').toEqual([]);

      if (screenshotDir !== undefined && screenshotDir !== '') {
        await page.screenshot({ path: join(screenshotDir, `landing-${width}-${theme}.png`), fullPage: true });
      }

      // The skip link is the first stop, is shown when focused, and lands on the content.
      await page.keyboard.press('Tab');
      await expect(page.locator('.skip-link')).toBeFocused();
      await expect(page.locator('.skip-link')).toBeInViewport();
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
      await run.close();
    });
  }

  test(`the 404 page at ${width} px`, async ({ browser, baseURL }) => {
    const base = baseOf(baseURL);
    const run = await visit(browser, base, '/nope', width, 'light');
    const { page } = run;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ta stranica ne postoji');
    expect([...run.origins]).toEqual([new URL(base).origin]);
    // Chromium reports the document's own 404 status as a console error; nothing else may be one.
    expect(run.consoleErrors.filter((text) => !/status of 404/.test(text))).toEqual([]);
    expect(run.consoleErrors.length).toBeLessThanOrEqual(1);
    expect(await page.context().cookies()).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await axeViolations(page), 'axe violations').toEqual([]);
    await run.close();
  });
}
