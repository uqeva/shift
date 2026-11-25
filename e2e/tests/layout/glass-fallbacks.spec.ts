import type { Locator, Page } from '@playwright/test';

import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 15.5: the glass's solid fallbacks, in a real browser.
 *
 * REDUCED TRANSPARENCY. Anybody who asked the OS for less transparency gets
 * the opaque `--card` and no `backdrop-filter` on every glass surface
 * (`index.css`'s three utilities; the built-CSS pins are in
 * `test/theme-applied.test.ts`). Playwright's `emulateMedia` has no
 * `reducedTransparency`, so the media feature is emulated over CDP
 * (`Emulation.setEmulatedMedia`), and each test first proves the query
 * matches, so a browser that ignored the emulation fails rather than passes.
 *
 * FORCED COLOURS ON SIGN-IN. The brand panel's ink tile turns `Canvas` under
 * forced colours like the panel around it; its icon is `currentColor`, which
 * becomes `CanvasText`, so the tile stays perceivable (the 15.3 review). The
 * shell and sheet under forced colours are `shell-forced-colours.spec.ts`.
 */

/** Emulates `prefers-reduced-transparency: reduce` on this page, over CDP. */
async function reduceTransparency(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches),
    'the browser ignored the reduced-transparency emulation',
  ).toBe(true);
}

/** What the surface computes, and what `--card` resolves to in this browser. */
async function surfaceOf(surface: Locator) {
  return surface.evaluate((element) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'background-color: var(--card); color: var(--border);';
    document.body.append(probe);
    const card = getComputedStyle(probe).backgroundColor;
    const border = getComputedStyle(probe).color;
    probe.remove();

    const style = getComputedStyle(element);

    return { background: style.backgroundColor, backdrop: style.backdropFilter, shadow: style.boxShadow, card, border };
  });
}

async function expectSolidCard(surface: Locator, name: string): Promise<void> {
  const drawn = await surfaceOf(surface);

  expect(drawn.card, '--card does not resolve').not.toBe('rgba(0, 0, 0, 0)');
  expect(drawn.background, `${name} is not the opaque card`).toBe(drawn.card);
  expect(drawn.backdrop, `${name} still blurs`).toBe('none');
  // Story 15.5: the hairline is `--border`, since the white glass one would
  // vanish on the card.
  expect(drawn.shadow, `${name} has no --border hairline`).toContain(`${drawn.border} 0px 0px 0px 1px inset`);
}

test.describe('under reduced transparency, from 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('the sidebar is the opaque card, unblurred', async ({ page, calendarPage }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();
    const sidebar = calendarPage.navigation.locator('xpath=ancestor::aside[1]');

    // Normally: glass, blurred.
    expect((await surfaceOf(sidebar)).backdrop, 'the sidebar is not glass to begin with').toMatch(/blur/);

    await reduceTransparency(page);
    await expectSolidCard(sidebar, 'the sidebar');
  });
});

test.describe('under reduced transparency, at 390 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });

  test('the tab bar, the sticky month head and the Više sheet are the opaque card, unblurred', async ({ page, calendarPage }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();
    // The phone's pill is the navigation landmark itself.
    const tabBar = calendarPage.navigation;

    expect((await surfaceOf(tabBar)).backdrop, 'the tab bar is not glass to begin with').toMatch(/blur/);

    await reduceTransparency(page);
    await expectSolidCard(tabBar, 'the tab bar');
    await expectSolidCard(calendarPage.stickyHead, 'the sticky month head');

    await calendarPage.moreButton.click();
    await expect(calendarPage.moreSheet).toBeVisible();
    await expectSolidCard(calendarPage.moreSheet, 'the Više sheet');
  });
});

test.describe('the sign-in brand panel under forced colours, from 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the Smjenko mark keeps its own colours, the S apart from its tile', async ({ page, loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.signInHeading).toBeVisible();
    const mark = loginPage.brandMark;
    await expect(mark).toHaveCount(1);

    // Story 21.24: the mark replaced the ink tile's icon. It is an image-like
    // brand mark, so forced colours leave it alone (`forced-color-adjust:
    // none`): a repainted mark would draw the S and its tile in one colour.
    await page.emulateMedia({ forcedColors: 'active' });
    const drawn = await mark.evaluate((element) => {
      const [tile] = element.querySelectorAll('rect');
      const [upper, lower] = element.querySelectorAll('path');

      return {
        adjust: getComputedStyle(element).forcedColorAdjust,
        tile: tile === undefined ? null : getComputedStyle(tile).fill,
        upper: upper === undefined ? null : getComputedStyle(upper).stroke,
        lower: lower === undefined ? null : getComputedStyle(lower).stroke,
      };
    });

    expect(drawn.adjust, 'forced colours may repaint the mark').toBe('none');
    expect(drawn.tile, 'the tile is not the ink navy').toBe('rgb(15, 23, 42)');
    expect(drawn.upper, 'the upper arc is not the accent blue').toBe('rgb(63, 160, 250)');
    expect(drawn.lower, 'the lower arc is not white').toBe('rgb(255, 255, 255)');
    await expect(loginPage.brandName).toBeVisible();
  });

  test('the Smjenko mark draws its hairline on dark glass, and only there', async ({ page, loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.signInHeading).toBeVisible();
    const hairline = (): Promise<string> =>
      loginPage.brandMark.evaluate((element) => getComputedStyle(element.querySelectorAll('rect')[1] as Element).display);

    // Story 21.24: the navy tile meets dark glass at 1.03:1, so the dark theme
    // draws a white 16 % hairline around it; the light theme does not.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    expect(await hairline(), 'the hairline shows in the light theme').toBe('none');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await hairline(), 'the hairline is hidden in the dark theme').not.toBe('none');
  });
});
