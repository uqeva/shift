import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';

import { CalendarPage } from '../e2e/pages/calendar.page.ts';
import { LoginPage } from '../e2e/pages/login.page.ts';

/**
 * Story 15.5: the glass budget, measured. This is the automatable proxy for a
 * trace on a real low-end Android (DESIGN.md, glass rule 7; UX-DR53). That
 * trace stays a human step (`deferred-work.md`).
 *
 * THREE MEASUREMENTS, the first two on a phone viewport (390 × 844, DPR 3, touch), as an
 * admin on *Kalendar*'s *Sve smjene*, all teams — on a phone the day list of
 * every team since story 21.3, which has no scroller of its own: the page
 * scrolls it:
 *
 *  1. NFR-22, a mid-range phone on a mobile network: 4× CPU throttling, and
 *     Fast 4G bandwidth (9 Mbit/s down, 1.5 Mbit/s up) at Lighthouse's 150 ms
 *     mobile round trip, which is slower than DevTools' preset. Cold: no HTTP
 *     cache and no service worker. From navigation to the month's team days on
 *     screen, at most 2000 ms.
 *  2. The glass budget, a low-end phone: 6× CPU throttling (DevTools' low-tier
 *     mobile). A Chromium trace while the page scrolls through one month,
 *     moves to the next and scrolls through that one, under the glass tab bar
 *     and the glass sticky head. No frame may spend over 50 ms in paint or
 *     composite. That is read two ways: no paint, raster, layerize or
 *     composite task in the trace over 50 ms, and no long animation frame
 *     whose rendering phase (from `renderStart` to its end: style, layout,
 *     paint and commit on the main thread) is over 50 ms. Long animation
 *     frames are only reported over 50 ms, so with none the phase reads 0.
 *  3. The same glass budget at a TABLET width (800 × 600, no touch; story
 *     21.3): *Sve smjene* is the grid there, scrolled by the page under its
 *     sticky team strip, whose copy table doubles the cell DOM. Its trace is
 *     `glass-scroll-grid-trace.json`, its summary `glassBudgetGrid`.
 *
 * WHAT A PROXY CANNOT SHOW. CPU throttling slows the renderer's main thread;
 * the GPU, raster and compositor threads of this machine are not throttled,
 * and that is where a `backdrop-filter` costs most. A pass here says the main
 * thread holds; only the real-device trace (`deferred-work.md`) says a weak
 * phone GPU does.
 *
 * The traces (`glass-scroll-trace.json` and `glass-scroll-grid-trace.json`, open in DevTools → Performance) and
 * `summary.json` are written to `test-results-perf/` for the PR.
 */

const OUT = fileURLToPath(new URL('../test-results-perf/', import.meta.url));
/** The phone's trace, and the grid's at a tablet width (story 21.3), under `OUT`. */
const TRACE_FILE = 'glass-scroll-trace.json';
const GRID_TRACE_FILE = 'glass-scroll-grid-trace.json';
const SUMMARY = `${OUT}summary.json`;

const NFR_22_MS = 2000;
const FRAME_BUDGET_MS = 50;

/** Trace event names that are paint or composite work. */
const PAINT_OR_COMPOSITE = new Set([
  'Paint',
  'PrePaint',
  'PaintImage',
  'Layerize',
  'UpdateLayer',
  'UpdateLayerTree',
  'CompositeLayers',
  'Commit',
  'RasterTask',
  'Decode Image',
  'GPUTask',
]);

function credentials(): { readonly org: string; readonly username: string; readonly password: string } {
  const read = (name: string): string => {
    const found = process.env[name]?.trim();
    if (found === undefined || found === '') throw new Error(`perf: set ${name}`);
    return found;
  };

  return { org: read('PERF_ORG'), username: read('PERF_USERNAME'), password: read('PERF_PASSWORD') };
}

const summary: Record<string, unknown> = {
  // Provenance, so the file attached to a PR says what it measured.
  measuredAt: new Date().toISOString(),
  baseUrl: process.env['PERF_BASE_URL'],
  organization: process.env['PERF_ORG'],
};

function writeSummary(): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
}

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
});

async function signIn(page: Page): Promise<void> {
  const { org, username, password } = credentials();
  await new LoginPage(page).signIn(org, username, password);
}

/**
 * *Sve smjene* is shown: on a phone (story 21.3) the day list of every team,
 * its mode pressed and its first team day drawn.
 */
async function expectAllTeams(calendar: CalendarPage, timeout = 5_000): Promise<void> {
  // STORY 21.23: the modes are `Prikaz ▾`'s menu, closed again before anything is measured.
  const { sve } = await calendar.openModes();
  await expect(sve, 'Sve smjene is not the mode shown (was it not remembered?)').toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout },
  );
  await calendar.closeModes();
  await expect(calendar.dayList.getByRole('button').first()).toBeVisible({ timeout });
}

/** Opens *Kalendar* and makes sure *Sve smjene* (all teams), not *Moj raspored*, shows. */
async function openAllTeams(calendar: CalendarPage): Promise<void> {
  await calendar.goto();
  await expect(calendar.monthHeading()).toBeVisible();
  // Wait until the screen has settled on one mode before deciding (story
  // 21.23: in `Prikaz ▾`'s menu); a pick closes the menu.
  const { sve: modeSwitch } = await calendar.openModes();
  if ((await modeSwitch.getAttribute('aria-pressed')) !== 'true') await modeSwitch.click();
  else await calendar.closeModes();
  await expectAllTeams(calendar);
}

async function throttle(session: CDPSession, rate: number): Promise<void> {
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

test('NFR-22: the month renders within two seconds on a mid-range phone', async ({ page }) => {
  await signIn(page);
  const calendar = new CalendarPage(page);
  // Once unthrottled, so the mode the screen remembers is Sve smjene.
  await openAllTeams(calendar);

  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await throttle(session, 4);

  // "Cold" here means no HTTP cache and no service worker; the session is
  // already signed in, as a member's phone is.
  const started = Date.now();
  await page.goto('/kalendar');
  await expectAllTeams(calendar, 30_000);
  const elapsed = Date.now() - started;

  summary['browser'] = page.context().browser()?.version();
  summary['nfr22'] = { cpuThrottling: 4, network: '9/1.5 Mbit/s, 150 ms', coldMonthMs: elapsed, shown: 'Sve smjene, the day list of every team (story 21.3)', budgetMs: NFR_22_MS };
  writeSummary();
  expect(elapsed, `the month took ${String(elapsed)} ms`).toBeLessThanOrEqual(NFR_22_MS);
});

/** One glass-budget measurement: where it scrolls, and where its trace and summary go. */
interface GlassCase {
  /** The trace file under `test-results-perf/`. */
  readonly trace: string;
  /** The key of `summary.json` it writes. */
  readonly key: string;
  /** Opens *Sve smjene* in the form this width draws, and waits for it. */
  readonly open: (calendar: CalendarPage, page: Page) => Promise<void>;
  /** Waits for the form again after the month changes. */
  readonly shown: (calendar: CalendarPage) => Promise<void>;
  /** Where the pointer sits while the wheel turns: over the month. */
  readonly pointer: { readonly x: number; readonly y: number };
}

/**
 * Scrolls two months under 6× CPU throttling and holds every paint or
 * composite task and every long animation frame's rendering phase to 50 ms.
 */
async function measureGlassBudget(page: Page, browser: Browser, glass: GlassCase): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __loaf: boolean }).__loaf = PerformanceObserver.supportedEntryTypes.includes(
      'long-animation-frame',
    );
    const frames: { duration: number; render: number }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { renderStart: number })[]) {
          const end = entry.startTime + entry.duration;
          frames.push({ duration: entry.duration, render: entry.renderStart > 0 ? end - entry.renderStart : 0 });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // No LoAF in this browser: the trace's task check still runs.
    }
  });

  await signIn(page);
  const calendar = new CalendarPage(page);
  await glass.open(calendar, page);

  const session = await page.context().newCDPSession(page);
  await throttle(session, 6);
  await page.evaluate(() => {
    (window as unknown as { __frames: unknown[] }).__frames.length = 0;
  });

  const tracePath = `${OUT}${glass.trace}`;
  mkdirSync(OUT, { recursive: true });
  await browser.startTracing(page, {
    path: tracePath,
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'toplevel',
      'blink.user_timing',
    ],
  });

  const scrolled: number[] = [];
  const scrollThrough = async (): Promise<void> => {
    await page.mouse.move(glass.pointer.x, glass.pointer.y);
    for (let step = 0; step < 16; step += 1) {
      await page.mouse.wheel(0, 320);
      await page.waitForTimeout(120);
    }
    // How far it got: the page's scroll (the month has no vertical scroller of its own), or any element's.
    scrolled.push(
      await page.evaluate(() => {
        let furthest = window.scrollY;
        for (const element of document.querySelectorAll('*')) furthest = Math.max(furthest, element.scrollTop);
        return furthest;
      }),
    );
    for (let step = 0; step < 16; step += 1) {
      await page.mouse.wheel(0, -320);
      await page.waitForTimeout(120);
    }
  };

  try {
    const heading = await calendar.monthHeading().innerText();
    expect(heading, 'the month heading is empty, so the month change cannot be checked').not.toBe('');
    await scrollThrough();
    await calendar.nextButton.click();
    await expect(calendar.monthHeading()).not.toHaveText(heading);
    await glass.shown(calendar);
    await scrollThrough();
  } finally {
    await browser.stopTracing();
  }
  expect(
    await page.evaluate(() => (window as unknown as { __loaf: boolean }).__loaf),
    'this browser has no long-animation-frame timing, so the frame check would measure nothing',
  ).toBe(true);
  const frames = await page.evaluate(
    () => (window as unknown as { __frames: { duration: number; render: number }[] }).__frames,
  );

  // The trace's paint and composite tasks, longest first.
  const parsed = JSON.parse(readFileSync(tracePath, 'utf8')) as
    | { traceEvents: { name: string; ph: string; dur?: number }[] }
    | { name: string; ph: string; dur?: number }[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const longestByName = new Map<string, number>();
  for (const event of events) {
    if (event.ph !== 'X' || event.dur === undefined || !PAINT_OR_COMPOSITE.has(event.name)) continue;
    longestByName.set(event.name, Math.max(longestByName.get(event.name) ?? 0, event.dur / 1000));
  }
  const longestTaskMs = Math.max(0, ...longestByName.values());
  const longestRenderMs = Math.max(0, ...frames.map((frame) => frame.render));
  const longFrames = frames.filter((frame) => frame.duration > FRAME_BUDGET_MS);

  summary[glass.key] = {
    cpuThrottling: 6,
    viewport: page.viewportSize(),
    trace: `test-results-perf/${glass.trace}`,
    longestPaintOrCompositeTaskMs: Number(longestTaskMs.toFixed(1)),
    longestByTask: Object.fromEntries([...longestByName].map(([name, ms]) => [name, Number(ms.toFixed(1))])),
    scrolledPx: scrolled,
    longAnimationFrames: longFrames.length,
    longestFrameMs: Number(Math.max(0, ...frames.map((frame) => frame.duration)).toFixed(1)),
    longestRenderPhaseMs: Number(longestRenderMs.toFixed(1)),
    budgetMs: FRAME_BUDGET_MS,
  };
  writeSummary();

  expect(Math.min(...scrolled), 'a month did not scroll, so nothing was measured').toBeGreaterThan(0);
  expect(longestByName.size, 'the trace holds no paint or composite task, so nothing was measured').toBeGreaterThan(0);
  expect(longestTaskMs, 'a paint or composite task ran over 50 ms').toBeLessThanOrEqual(FRAME_BUDGET_MS);
  expect(longestRenderMs, 'a frame spent over 50 ms rendering').toBeLessThanOrEqual(FRAME_BUDGET_MS);
}

test('the glass budget: scrolling two months spends no frame over 50 ms in paint or composite on a low-end phone', async ({
  page,
  browser,
}) => {
  await measureGlassBudget(page, browser, {
    trace: TRACE_FILE,
    key: 'glassBudget',
    open: openAllTeams,
    shown: (calendar) => expectAllTeams(calendar),
    pointer: { x: 195, y: 500 },
  });
});

/** *Sve smjene*'s grid from 640 px (story 21.3): the table, its sticky strip and the strip's copy, drawn. */
async function expectGrid(calendar: CalendarPage): Promise<void> {
  await expect(calendar.grid).toBeVisible();
  await expect(calendar.grid.getByRole('gridcell').first()).toBeVisible();
  await expect(calendar.strip).toBeVisible();
}

/** Opens *Kalendar*'s *Sve smjene* at a grid width: the grid, never the day list. */
async function openGridAtWidth(calendar: CalendarPage): Promise<void> {
  await calendar.goto('?prikaz=sve');
  await expect(calendar.monthHeading()).toBeVisible();
  await expect((await calendar.openModes()).sve).toHaveAttribute('aria-pressed', 'true');
  await calendar.closeModes();
  await expectGrid(calendar);
}

test.describe('at a tablet width (story 21.3)', () => {
  // The grid from 640 px: the page scrolls it under the sticky strip, whose
  // copy table doubles the cell DOM. Not a phone, so no touch or mobile viewport.
  test.use({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('the glass budget: scrolling two months of the grid and its strip spends no frame over 50 ms in paint or composite', async ({
    page,
    browser,
  }) => {
    await measureGlassBudget(page, browser, {
      trace: GRID_TRACE_FILE,
      key: 'glassBudgetGrid',
      open: openGridAtWidth,
      shown: expectGrid,
      pointer: { x: 500, y: 400 },
    });
  });
});
