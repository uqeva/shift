import { randomUUID } from 'node:crypto';

import type { Locator, Page, Route } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import { escapeRegExp, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE, type Fixture } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Package 3c: the calendar's layout where no unit test can see it.
 *
 * - ONE SCROLL, THE PAGE'S (story 21.3). The grid has no vertical scroller:
 *   the page scrolls the month, and the date header is a separate sticky
 *   STRIP at the top of the viewport, so a month of many rows scrolled to
 *   its end still names its dates. Since story 21.25 (*Kalendar kao papir*)
 *   the dates are the COLUMNS and the teams, then the people, the rows, so a
 *   28–31-column month scrolls sideways inside the grid's one horizontal
 *   scroller, the strip in step with it and the name column and the strip's
 *   corner at the left; the page never scrolls sideways. The corner, strip, date column and cells stack in order and are
 *   opaque, and a press on the strip opens nothing.
 * - On a phone *Sve smjene* is the day list of every shown team, never a
 *   grid, with no horizontal overflow at any team count.
 * - A focused cell lands CLEAR of the sticky date column and the strip —
 *   from the keys, from Tab and from the day detail's close — in a grid wide
 *   enough to scroll sideways, and the margins that do it are at least the
 *   sizes they clear.
 * - In print the strip is not drawn and the one table prints whole.
 * - While the read is pending, the skeleton and the mode switch follow the
 *   chrome's role answer the moment it is in the cache.
 * - Under forced colours every modifier treatment, the focused cell and the
 *   sticky header keep a visible outline or border, where the box-shadows and
 *   gradients they normally draw are dropped.
 * - On a phone the month toolbar is a sticky head at the top of the viewport,
 *   on *Kalendar* and *Sati*, at most 160 px with its one-line filter summary
 *   once the filter bar has scrolled under it (deferred-work E816).
 */

/** Whether a request is the calendar's one read, not the chrome's branding read of the same table. */
function isCalendarRead(route: Route): boolean {
  const url = decodeURIComponent(route.request().url());

  return url.includes('/rest/v1/organizations') && url.includes('rotation_steps(');
}

/**
 * Lengthens the grid (story 21.25: the teams are its rows): `count` extra
 * active teams, with no rotation, appended to the calendar's answer in the
 * browser alone, so the page scrolls the month without writing a team other
 * tests would see; on a phone, the day list holds that many more. Each is built from the team
 * columns alone — nothing copied from a real row — and named `Širina 01`…,
 * which sorts after every `S…` name under the Croatian collation, so the real
 * teams keep the first columns and the order is fixed.
 */
async function widenWithTeams(page: Page, count: number): Promise<void> {
  await page.route('**/rest/v1/organizations*', async (route) => {
    if (!isCalendarRead(route)) return route.fallback();

    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>[];

    for (const organization of body) {
      const teams = organization['teams'] as Record<string, unknown>[];
      for (let index = 0; index < count; index += 1) {
        teams.push({
          organization_id: organization['id'],
          id: randomUUID(),
          name: `Širina ${String(index + 1).padStart(2, '0')}`,
          archived: false,
          // Story 21.16 (0080): every team row carries its holiday flag, and the read refuses one without it.
          off_on_holidays: false,
          // Story 21.20 (0082): and its own minimum, `null` for none; the read refuses a row without it.
          minimum_members: null,
        });
      }
    }

    await route.fulfill({ response, json: body });
  });
}

/** The grid's one scroller, horizontal only (story 21.3): the table's parent. */
function scrollerOf(grid: Locator): Locator {
  return grid.locator('xpath=..');
}

/** How far the focused cell sits clear of each edge it must not pass; negative is hidden. */
interface Clearance {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The focused cell's clearance: past the sticky date column on the left,
 * below the sticky team STRIP on top, inside the scroller's client edge (its
 * scrollbar excluded) on the right, and above the viewport's bottom.
 */
async function focusedClearance(page: Page): Promise<Clearance> {
  return page.evaluate(() => {
    const cell = document.activeElement;
    if (!(cell instanceof HTMLTableCellElement) || cell.getAttribute('role') !== 'gridcell') {
      throw new Error('E2E: focus is not on a gridcell');
    }
    const table = cell.closest('table');
    const scroller = table?.parentElement ?? null;
    const dateColumn = cell.parentElement?.querySelector('th') ?? null;
    const strip = document.querySelector('[data-grid-strip]');
    if (table === null || strip === null || scroller === null || dateColumn === null) {
      throw new Error('E2E: the grid has no scroller, strip or date column');
    }
    const box = scroller.getBoundingClientRect();
    const drawn = cell.getBoundingClientRect();

    return {
      left: drawn.left - dateColumn.getBoundingClientRect().right,
      top: drawn.top - strip.getBoundingClientRect().bottom,
      right: box.left + scroller.clientLeft + scroller.clientWidth - drawn.right,
      bottom: window.innerHeight - drawn.bottom,
    };
  });
}

/** Fails naming the edge the focused cell is hidden past. */
async function expectClear(page: Page, step: string): Promise<void> {
  const clearance = await focusedClearance(page);
  for (const [edge, value] of Object.entries(clearance)) {
    expect(value, `${step}: the focused cell is hidden past its ${edge} edge`).toBeGreaterThanOrEqual(-ROUNDING);
  }
}

/** Sub-pixel layout rounding, and nothing more. */
const ROUNDING = 1;

/** The strip's date head for day `day` of the month (story 21.25: the dates are the columns), in its inert copy. */
function stripHeader(calendarPage: CalendarPage, day: number): Locator {
  return calendarPage.stripCopy.locator('thead th').filter({ hasText: new RegExp(`^${escapeRegExp(`${String(day)}.`)}`) });
}

test.describe('one scroll, the page’s, on a short window (story 21.3)', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 600 } });

  test('the grid scrolls nothing vertically, and the strip stays at the viewport’s top when the month is scrolled to its end', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    // Story 21.25: the teams are the rows, so twenty more make the month
    // taller than the window, whatever the run organization holds.
    await widenWithTeams(page, 20);
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.teamHeader(fixture.team.name)).toBeAttached();
    // The whole month drawn, so nothing above or inside the grid moves later.
    await expect.poll(() => calendarPage.teamCount()).toBeGreaterThanOrEqual(21);
    expect(await calendarPage.dateCount()).toBeGreaterThanOrEqual(28);
    const scroller = scrollerOf(calendarPage.grid);

    // No vertical scroller: nothing to scroll inside it, and its overflow-y clips.
    const inner = await scroller.evaluate((element) => ({
      room: element.scrollHeight - element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      maxHeight: getComputedStyle(element).maxHeight,
    }));
    expect(inner.room, 'the grid scrolls inside its own container').toBeLessThanOrEqual(ROUNDING);
    expect(inner.overflowY).toBe('hidden');
    expect(inner.maxHeight).toBe('none');
    // The month is taller than the window, so it is the PAGE that scrolls.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      'the page has nothing to scroll',
    ).toBeGreaterThan(0);

    // At the strip's natural place the first row starts right under it.
    const natural = await page.evaluate(() => {
      const strip = document.querySelector('[data-grid-strip]')?.getBoundingClientRect();
      const first = document.querySelector('table[role="grid"] tbody tr')?.getBoundingClientRect();
      if (strip === undefined || first === undefined) throw new Error('E2E: no strip or first row');

      return Math.abs(first.top - strip.bottom);
    });
    expect(natural, 'the grid is not pulled up under the strip').toBeLessThanOrEqual(ROUNDING);

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Measured in ONE frame, polled, so a late layout change never splits the boxes.
    const offsets = () =>
      page.evaluate((rounding) => {
        const strip = document.querySelector('[data-grid-strip]');
        const table = document.querySelector('table[role="grid"]');
        const last = [...(table?.querySelectorAll('tbody tr') ?? [])].at(-1);
        if (strip === null || table === null || last === null || last === undefined) {
          throw new Error('E2E: no strip or grid');
        }
        const box = strip.getBoundingClientRect();
        const end = last.getBoundingClientRect();
        // The strip IS what a point on it hits: nothing scrolls over it, and
        // a press on it reaches no cell.
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

        return {
          atTop: Math.abs(box.top) <= rounding,
          onTop: hit !== null && strip.contains(hit),
          lastRowInView: end.bottom <= window.innerHeight + rounding && end.top >= box.bottom - rounding,
        };
      }, ROUNDING);
    await expect.poll(offsets).toEqual({ atTop: true, onTop: true, lastRowInView: true });
    await expect(stripHeader(calendarPage, 1)).toBeVisible();

    // A press on the strip opens nothing: it is a copy, and no cell is under it for a pointer.
    await calendarPage.strip.click({ position: { x: 300, y: 20 } });
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('the team day list on a phone (story 21.3)', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('holds every team on every date, with no grid and nothing scrolling sideways at any team count', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await widenWithTeams(page, 12);
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.teamDaysOf(fixture.team.name).first()).toBeVisible();
    await expect.poll(() => calendarPage.dayListItems.count()).toBeGreaterThanOrEqual(28);
    expect(await calendarPage.teamDayCount()).toBeGreaterThan(12);
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(calendarPage.strip).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoInnerHorizontalScroll(page);
  });
});

/** The grid, widened past the window's width, and its scroller. */
async function wideGrid(page: Page, calendarPage: CalendarPage, fixture: Fixture): Promise<Locator> {
  await widenWithTeams(page, 12);
  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.teamHeader(fixture.team.name)).toBeAttached();
  const scroller = scrollerOf(calendarPage.grid);
  const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, 'the grid does not scroll sideways').toBeGreaterThan(0);

  return scroller;
}

/**
 * Scrolls the scroller so the grid's tab stop sits partly under the sticky
 * name column (story 21.25: the tab stop is today's column, anywhere in the month).
 */
async function coverFirstColumn(scroller: Locator): Promise<void> {
  await scroller.evaluate((element) => {
    const stop = element.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
    const name = element.querySelector<HTMLElement>('thead th');
    if (stop === null || name === null) throw new Error('E2E: no tab stop or name column');
    element.scrollLeft = Math.max(0, stop.offsetLeft - name.offsetWidth + 20);
  });
}

/** The narrow desktop width where 13+ teams overflow the grid sideways. */
const NARROW = { width: 800, height: 600 } as const;

test.describe('a wide grid at 800 px (story 21.3)', () => {
  test.use({ storageState: ADMIN_STATE, viewport: NARROW });

  test('scrolls sideways only inside its scroller, the strip in step and aligned, the date column and the corner at the left', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await scroller.evaluate((element) => {
      element.scrollLeft = 260;
    });

    const aligned = () =>
      page.evaluate((rounding) => {
        const copy = document.querySelector('[data-grid-strip-copy]');
        const table = document.querySelector('table[role="grid"]');
        const scrollerElement = table?.parentElement ?? null;
        const row = table?.querySelector('tbody tr[data-team-row]') ?? null;
        if (copy === null || table === null || scrollerElement === null || row === null) throw new Error('E2E: no strip or grid');
        const heads = [...copy.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect());
        const cells = [...row.children].map((cell) => cell.getBoundingClientRect());
        const frame = scrollerElement.getBoundingClientRect();

        return {
          inStep: copy.scrollLeft === scrollerElement.scrollLeft,
          // Every date column's left and width, strip over grid.
          columns: heads.slice(1).every((head, index) => {
            const cell = cells[index + 1];

            return (
              cell !== undefined &&
              Math.abs(head.left - cell.left) <= rounding &&
              Math.abs(head.width - cell.width) <= rounding
            );
          }),
          cornerLeft: Math.abs((heads[0]?.left ?? -1) - frame.left) <= rounding,
          dateLeft: Math.abs((cells[0]?.left ?? -1) - frame.left) <= rounding,
        };
      }, ROUNDING);
    await expect.poll(aligned).toEqual({ inStep: true, columns: true, cornerLeft: true, dateLeft: true });
    expect(await scroller.evaluate((element) => element.scrollLeft), 'the grid did not scroll sideways').toBeGreaterThan(0);
    await expectNoHorizontalScroll(page);

    // A month change re-renders both tables with no scroll event: the strip
    // follows the scroller again after the render (its layout effect).
    const heading = calendarPage.monthHeading();
    const before = await heading.innerText();
    await calendarPage.nextButton.click();
    await expect(heading).not.toHaveText(before);
    await expect(calendarPage.teamHeader(fixture.team.name)).toBeAttached();
    await expect.poll(aligned).toEqual({ inStep: true, columns: true, cornerLeft: true, dateLeft: true });
    await expectNoHorizontalScroll(page);
  });

  test('from the keys, a focused cell lands clear of the date column and the strip', async ({ page, calendarPage, fixture }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);
    const rows = await calendarPage.gridRowCount();
    const columns = await calendarPage.dateCount();
    expect(rows).toBeGreaterThan(12);
    expect(columns).toBeGreaterThanOrEqual(28);

    // The LEAST scroll: a step to a cell already in view, away from every
    // edge, moves neither the grid nor the page.
    await calendarPage.cellAt({ row: 5, column: 1 }).evaluate((cell) => {
      cell.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    await calendarPage.cellAt({ row: 4, column: 1 }).focus();
    const scrolled = () =>
      scroller.evaluate((element) => [element.scrollLeft, element.scrollTop, Math.round(window.scrollY)]);
    const before = await scrolled();
    await page.keyboard.press('ArrowDown');
    expect(await calendarPage.focusedCell()).toEqual({ row: 5, column: 1 });
    expect(await scrolled(), 'a step to a cell in view scrolled').toEqual(before);

    // Across to the far end, then back one column at a time: each step left
    // brings a cell out from under the sticky date column.
    await page.keyboard.press('Control+Home');
    expect(await calendarPage.focusedCell()).toEqual({ row: 0, column: 0 });
    await page.keyboard.press('End');
    await expectClear(page, 'End');
    expect(await scroller.evaluate((element) => element.scrollLeft), 'End did not scroll sideways').toBeGreaterThan(0);
    for (let column = columns - 2; column >= 0; column -= 1) {
      await page.keyboard.press('ArrowLeft');
      expect(await calendarPage.focusedCell()).toEqual({ row: 0, column });
      await expectClear(page, `ArrowLeft to column ${String(column)}`);
    }

    // Down one row at a time to the month's end — the PAGE scrolls each cell
    // into view — then back up, each step up bringing one out from under the strip.
    for (let row = 1; row < rows; row += 1) {
      await page.keyboard.press('ArrowDown');
      expect(await calendarPage.focusedCell()).toEqual({ row, column: 0 });
      await expectClear(page, `ArrowDown to row ${String(row)}`);
    }
    expect(await page.evaluate(() => window.scrollY), 'the page did not scroll down the month').toBeGreaterThan(0);
    expect(await scroller.evaluate((element) => element.scrollTop), 'the grid scrolled vertically').toBe(0);
    for (let row = rows - 2; row >= 0; row -= 1) {
      await page.keyboard.press('ArrowUp');
      expect(await calendarPage.focusedCell()).toEqual({ row, column: 0 });
      await expectClear(page, `ArrowUp to row ${String(row)}`);
    }
  });

  test('from Tab and from the day detail closing, a focused cell lands clear too', async ({ page, calendarPage, fixture }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);

    // Tab into the grid on its one tab stop, while that cell is partly under
    // the sticky date column.
    await coverFirstColumn(scroller);
    await calendarPage.exportMenu.focus();
    await page.keyboard.press('Tab');
    await expect(calendarPage.tabStops).toBeFocused();
    await expectClear(page, 'Tab');

    // Open its detail, cover the cell while the Dialog is open, and close it:
    // focus comes back to the cell, whole.
    await page.keyboard.press('Enter');
    await expect(calendarPage.dialog()).toBeVisible();
    await coverFirstColumn(scroller);
    await page.keyboard.press('Escape');
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expect(calendarPage.tabStops).toBeFocused();
    await expectClear(page, 'the day detail closing');
  });

  test('is revealed inside margins at least the sizes they clear', async ({ page, calendarPage, fixture }) => {
    await wideGrid(page, calendarPage, fixture);

    const sizes = await calendarPage.grid.evaluate((table: HTMLTableElement) => {
      const cell = table.querySelector('[role="gridcell"]');
      const strip = document.querySelector('[data-grid-strip]');
      if (cell === null || strip === null || table.tHead === null) throw new Error('E2E: no cell, strip or header');
      const style = getComputedStyle(cell);
      // The name column: the corner and every row's head, never a group's heading across the grid.
      const widths = [...table.querySelectorAll('thead tr > th:first-child, tbody tr[data-team-row] > th:first-child')].map(
        (th) => th.getBoundingClientRect().width,
      );

      return {
        marginLeft: parseFloat(style.scrollMarginLeft),
        marginTop: parseFloat(style.scrollMarginTop),
        width: Math.max(...widths),
        height: strip.getBoundingClientRect().height,
      };
    });
    expect(sizes.width, 'the date column is wider than the cells’ scroll-margin-left').toBeLessThanOrEqual(
      sizes.marginLeft + ROUNDING,
    );
    expect(sizes.height, 'the strip is taller than the cells’ scroll-margin-top').toBeLessThanOrEqual(
      sizes.marginTop + ROUNDING,
    );
  });

  test('stacks corner, strip, date column, cells, each opaque', async ({ page, calendarPage, fixture }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);
    // Past the strip's own place in the page, so it is STUCK, with rows under
    // it: a fixed scroll would leave it short of sticking wherever the page
    // header, the filters and the Card's head above it are taller than that.
    await page.evaluate(() => {
      const strip = document.querySelector('[data-grid-strip]');
      if (strip === null) throw new Error('E2E: no strip');
      window.scrollTo(0, strip.getBoundingClientRect().top + window.scrollY + 300);
    });
    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-grid-strip]')?.getBoundingClientRect().top))
      .toBe(0);
    await scroller.evaluate((element) => {
      element.scrollLeft = 150;
    });

    const stack = await calendarPage.grid.evaluate((table: HTMLTableElement) => {
      const strip = document.querySelector('[data-grid-strip]');
      const copy = document.querySelector('[data-grid-strip-copy]');
      const wrapper = table.parentElement;
      const head = copy?.querySelector('thead tr');
      if (strip === null || copy === null || wrapper === null || head === null || head === undefined) {
        throw new Error('E2E: no strip or scroller');
      }
      const frame = wrapper.getBoundingClientRect();
      const corner = head.children[0];
      // A date head wholly in view past the corner, and a team's row head wholly in view below the strip.
      const header = [...head.children].slice(1).find((th) => {
        const box = th.getBoundingClientRect();

        return box.left >= frame.left + 120 && box.right <= frame.right;
      });
      const stripBottom = strip.getBoundingClientRect().bottom;
      const date = [...table.querySelectorAll('tbody tr[data-team-row]')]
        .map((row) => row.querySelector('th') ?? undefined)
        .find((th) => {
          const box = th?.getBoundingClientRect();

          return box !== undefined && box.top >= stripBottom + 20 && box.bottom <= window.innerHeight;
        });
      if (corner === undefined || header === undefined || date === undefined) {
        throw new Error('E2E: nothing in view to probe');
      }
      // The strip's copy is inert, so a point on it hits the strip itself: what
      // is topmost there is the strip, never a scrolled cell.
      const topmostIn = (element: Element, owner: Element): boolean => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

        return hit !== null && owner.contains(hit);
      };
      const opaque = (element: Element): boolean => {
        const colour = getComputedStyle(element).backgroundColor;
        const alpha = /\/\s*([\d.]+)\)$/.exec(colour)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(colour)?.[1] ?? '1';

        return Number(alpha) === 1;
      };
      const cornerBox = corner.getBoundingClientRect();

      return {
        cornerLeft: cornerBox.left - frame.left,
        cornerTop: cornerBox.top,
        corner: topmostIn(corner, strip),
        header: topmostIn(header, strip),
        date: topmostIn(date, date),
        cornerOpaque: opaque(corner),
        headerOpaque: opaque(header),
        dateOpaque: opaque(date),
      };
    });
    expect(Math.abs(stack.cornerLeft), 'the corner left the grid’s left edge').toBeLessThanOrEqual(ROUNDING);
    expect(Math.abs(stack.cornerTop), 'the corner left the viewport’s top').toBeLessThanOrEqual(ROUNDING);
    expect(stack.corner, 'something paints over the corner').toBe(true);
    expect(stack.header, 'a cell paints over the strip').toBe(true);
    expect(stack.date, 'a cell paints over the date column').toBe(true);
    expect(stack.cornerOpaque, 'the corner shows what scrolls under it').toBe(true);
    expect(stack.headerOpaque, 'the strip shows what scrolls under it').toBe(true);
    expect(stack.dateOpaque, 'the date column shows what scrolls under it').toBe(true);
  });
});

test.describe('the printed month (story 16.1, story 21.3)', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('is the one table, its own header row repeated, with no strip and no pull-up', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.teamHeader(fixture.team.name)).toBeAttached();
    await page.emulateMedia({ media: 'print' });

    const printed = await calendarPage.grid.evaluate((table: HTMLTableElement) => {
      const strip = document.querySelector('[data-grid-strip]');
      const scroller = table.parentElement;
      if (strip === null || scroller === null || table.tHead === null) throw new Error('E2E: no strip, scroller or header');

      return {
        strip: getComputedStyle(strip).display,
        marginTop: getComputedStyle(table).marginTop,
        header: getComputedStyle(table.tHead).display,
        overflow: getComputedStyle(scroller).overflowY,
      };
    });
    expect(printed).toEqual({ strip: 'none', marginTop: '0px', header: 'table-header-group', overflow: 'visible' });
    await page.emulateMedia({ media: 'screen' });
  });
});

/** The sticky head's box, and whether it is sticky, measured in one frame. */
async function stickyHead(page: Page): Promise<{ readonly top: number; readonly bottom: number; readonly sticky: boolean }> {
  return page.evaluate(() => {
    const head = document.querySelector('[data-sticky-head]');
    if (!(head instanceof HTMLElement)) throw new Error('E2E: no sticky head');
    const box = head.getBoundingClientRect();

    return { top: box.top, bottom: box.bottom, sticky: getComputedStyle(head).position === 'sticky' };
  });
}

/** Whether `locator` is inside the sticky head and drawn wholly inside the viewport. */
async function inHead(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();

    return (
      element.closest('[data-sticky-head]') !== null &&
      box.height > 0 &&
      box.top >= -1 &&
      box.bottom <= window.innerHeight + 1
    );
  });
}

/** The most the phone's head may take: the toolbar, and room for its one summary line. */
const STICKY_HEAD_MAX = 160;

test.describe("the phone's sticky head (deferred-work E816)", () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('holds the month toolbar alone, at most 160 px, and the team day list’s last day stays clear of it at the page end', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    const chip = calendarPage.filters.removeTeam(fixture.team.name);
    await expect(chip).toBeVisible();
    // STORY 21.3: on a phone *Sve smjene* is the day list of every shown team.
    await expect.poll(() => calendarPage.dayListItems.count()).toBeGreaterThanOrEqual(28);
    const natural = await stickyHead(page);
    expect(natural.sticky, 'the head is not sticky on a phone').toBe(true);
    expect(natural.bottom - natural.top, 'the sticky head is taller than its budget').toBeLessThanOrEqual(STICKY_HEAD_MAX);

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // At the top of the viewport (the Card's 1 px border above it at most),
    // with the toolbar in it and on screen; the chips are not in it.
    await expect.poll(async () => Math.abs((await stickyHead(page)).top)).toBeLessThanOrEqual(1 + ROUNDING);
    expect(await inHead(calendarPage.monthTrigger), 'the month toolbar scrolled away').toBe(true);
    expect(await inHead(chip), 'the chip bar is in the sticky head').toBe(false);
    // The month's last day is drawn clear of it, and of its summary line's room.
    const last = await calendarPage.dayListItems.last().boundingBox();
    const head = await stickyHead(page);
    expect(last, 'the last day has no box').not.toBeNull();
    expect(last!.y, 'the sticky head covers the last day').toBeGreaterThanOrEqual(head.bottom - ROUNDING);
    if (await calendarPage.stickySummary.isVisible()) {
      const line = await calendarPage.stickySummary.boundingBox();
      expect(last!.y, 'the summary line covers the last day').toBeGreaterThanOrEqual(line!.y + line!.height - ROUNDING);
    }
  });

  test('says the active filters in one line once the filter bar has scrolled under it', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    // A person chosen: their day list is long and has no scroller of its own,
    // so the page scrolls the filter bar well under the head.
    await calendarPage.goto('?prikaz=sve');
    await calendarPage.filters.choosePerson(fixture.member.name);
    const chip = calendarPage.filters.removePerson(fixture.member.name);
    await expect(chip).toBeVisible();
    await expect(calendarPage.stickySummary).toHaveCount(0);

    await page.evaluate(() => {
      window.scrollBy(0, 800);
    });
    await expect.poll(async () => Math.round((await stickyHead(page)).top)).toBe(0);
    await expect(calendarPage.stickySummary).toBeVisible();
    await expect(calendarPage.stickySummary).toContainText(fixture.member.name);
    await expect(calendarPage.stickySummary).toHaveAttribute('aria-hidden', 'true');
    // One line, under the toolbar, inside the budget.
    const line = await calendarPage.stickySummary.boundingBox();
    expect(line!.height, 'the summary is more than one line').toBeLessThanOrEqual(26);
    expect(line!.y + line!.height, 'the head and its line pass the budget').toBeLessThanOrEqual(STICKY_HEAD_MAX + ROUNDING);
    expect(await inHead(calendarPage.monthTrigger), 'the month toolbar scrolled away').toBe(true);

    // Back up: the bar is in sight again, and the line goes.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect(calendarPage.stickySummary).toHaveCount(0);
  });

  test('is not drawn from 640 px up, where the month is the toolbar’s (story 21.23)', async ({ page, calendarPage }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.monthTrigger).toBeVisible();
    await expect(calendarPage.stickyHead).toHaveCount(0);
  });

  test('on Sati holds the month toolbar too', async ({ page, hoursPage }) => {
    await hoursPage.goto();
    await expect(hoursPage.monthTrigger).toBeVisible();
    const head = await stickyHead(page);
    expect(head.sticky, 'the head is not sticky on a phone').toBe(true);
    expect(head.bottom - head.top, 'the sticky head is taller than its budget').toBeLessThanOrEqual(STICKY_HEAD_MAX);
    expect(await inHead(hoursPage.monthTrigger)).toBe(true);
  });
});

test.describe('Moj raspored on a phone (deferred-work E816, E822)', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 } });

  test('stays at the top with the toolbar while the long day list scrolls under it (E816)', async ({
    page,
    calendarPage,
  }) => {
    await calendarPage.goto('?prikaz=moj');
    await expect(calendarPage.dayList).toBeVisible();
    const natural = await stickyHead(page);

    await page.evaluate((by) => {
      window.scrollBy(0, by);
    }, natural.top + 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(natural.top + 300);
    await expect.poll(async () => Math.round((await stickyHead(page)).top)).toBe(0);
    expect(await inHead(calendarPage.monthTrigger), 'the month toolbar scrolled away').toBe(true);
  });

  test('says whose schedule it is, the team, and that the filters belong to Svi timovi, in the filters’ place', async ({
    calendarPage,
  }) => {
    await calendarPage.goto('?prikaz=moj');
    await expect(calendarPage.dayList).toBeVisible();
    await expect(calendarPage.ownNote).toHaveText(
      new RegExp(`^Tvoj raspored · .+\\. Filtri vrijede za „${escapeRegExp(hr.kalendar.mode.sve)}”\\.$`),
    );
    await expect(calendarPage.filters.bar).toHaveCount(0);
  });
});

/** Whether a request is the chrome's own role read (`MEMBER_ROLE_KEY`). */
function isRoleRead(route: Route): boolean {
  const url = new URL(route.request().url());

  return url.pathname.endsWith('/rest/v1/members') && url.searchParams.get('select') === 'role';
}

/** A route handler held until `release` is called. */
function held(): { readonly wait: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { wait, release };
}

test.describe('the calendar while its read is pending, on a phone, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 } });

  test('follows the chrome’s role the moment it is cached: grid, then the day list and the switch', async ({
    page,
    calendarPage,
  }) => {
    const role = held();
    const calendar = held();
    await page.route('**/rest/v1/members*', async (route) => {
      if (isRoleRead(route)) await role.wait;
      await route.fallback();
    });
    await page.route('**/rest/v1/organizations*', async (route) => {
      if (isCalendarRead(route)) await calendar.wait;
      await route.fallback();
    });

    await calendarPage.goto();
    // The month's placeholder bars, not the month heading's.
    const pulses = calendarPage.skeletonPulses;
    const { moj, sve } = calendarPage.modes();

    // No role yet: the grid's thirty rows of five (a date and four team
    // columns), and no switch — no `Prikaz ▾` (story 21.23) — since the mode
    // is unknown.
    await expect(pulses).toHaveCount(30 * 5);
    await expect(calendarPage.viewMenu).toHaveCount(0);

    // The role lands in the cache: the day list's thirty rows of two, and the
    // switch on *Moj raspored* — before the calendar's read has answered.
    role.release();
    await expect(pulses).toHaveCount(30 * 2);
    await calendarPage.openModes();
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
    await expect(sve).toHaveAttribute('aria-pressed', 'false');
    await expect(calendarPage.anyGrid).toHaveCount(0);

    calendar.release();
    await expect(calendarPage.dayList).toBeVisible();
    await expect(pulses).toHaveCount(0);
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * The ten modifier treatments, as `modifiers.ts` names them: story 11.3 added
 * short-staffed's edge, alone and precomposed with each ring.
 */
const TREATMENTS = [
  { name: 'modifier-ring-conflict', kind: 'ring' },
  { name: 'modifier-ring-overridden', kind: 'ring' },
  { name: 'modifier-ring-conflict-overridden', kind: 'ring' },
  { name: 'modifier-edge-short-staffed', kind: 'edge' },
  { name: 'modifier-ring-conflict-short-staffed', kind: 'ring' },
  { name: 'modifier-ring-overridden-short-staffed', kind: 'ring' },
  { name: 'modifier-ring-conflict-overridden-short-staffed', kind: 'ring' },
  { name: 'modifier-hatch-leave', kind: 'hatch' },
  { name: 'modifier-hatch-uncovered', kind: 'hatch' },
  { name: 'modifier-hatch-leave-uncovered', kind: 'hatch' },
] as const;

/** The grid cell box's padding (`CALENDAR_CELL_CLASS`), which a ring's inset outline must stay inside. */
const CELL_PADDING = 'px-2 py-1';

interface Drawn {
  readonly name: string;
  readonly boxShadow: string;
  readonly backgroundImage: string;
  /** `style width`; `none …` is no outline. */
  readonly outline: string;
  /** `width top-style left-style`; `0px …` is no border. */
  readonly border: string;
  /** `width style` of the bottom border alone: short-staffed's forced-colours edge (story 11.3). */
  readonly edge: string;
  /** How deep the outline reaches into the box, and the box's thinnest padding. */
  readonly outlineDepth: number;
  readonly outlineWidth: number;
  readonly padding: number;
}

/** Each treatment's computed drawing, on a probe carrying its class and the cell's padding. */
async function drawnTreatments(page: Page): Promise<Drawn[]> {
  return page.evaluate(
    ({ names, padding }) =>
      names.map((name) => {
        const probe = document.createElement('div');
        probe.className = `${padding} ${name}`;
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const drawn = {
          name,
          boxShadow: style.boxShadow,
          backgroundImage: style.backgroundImage,
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderLeftStyle}`,
          edge: `${style.borderBottomWidth} ${style.borderBottomStyle}`,
          outlineDepth: -parseFloat(style.outlineOffset),
          outlineWidth: parseFloat(style.outlineWidth),
          padding: Math.min(parseFloat(style.paddingTop), parseFloat(style.paddingLeft)),
        };
        probe.remove();

        return drawn;
      }),
    { names: TREATMENTS.map((treatment) => treatment.name), padding: CELL_PADDING },
  );
}

/**
 * `NONWORKING_CHIP_CLASS` (`apps/web/src/features/shift-types/services/list.ts`),
 * restated: the E2E suite imports nothing from the app's source, and
 * `list.test.ts` pins the original to this exact string.
 */
const NONWORKING_CLASSES =
  'bg-shift-nonworking text-shift-nonworking-foreground outline outline-1 -outline-offset-1 outline-shift-nonworking-border forced-colors:outline-none';

interface Probed {
  readonly className: string;
  /** `style width`; `none …` is no outline. */
  readonly outline: string;
  readonly outlineColor: string;
  readonly outlineOffset: number;
  readonly width: number;
  readonly height: number;
}

/** Each class list's computed outline and box, on a probe carrying a label like a cell's. */
async function probed(page: Page, classNames: readonly string[]): Promise<Probed[]> {
  return page.evaluate(
    (names) =>
      names.map((className) => {
        const probe = document.createElement('div');
        probe.className = className;
        probe.style.width = 'max-content';
        probe.textContent = 'N';
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const box = probe.getBoundingClientRect();
        const drawn = {
          className,
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          outlineColor: style.outlineColor,
          outlineOffset: parseFloat(style.outlineOffset),
          width: box.width,
          height: box.height,
        };
        probe.remove();

        return drawn;
      }),
    classNames,
  );
}

/** The alpha of a computed colour string (`rgba(…, a)`, `oklch(… / a)`, or opaque). */
function alphaOf(colour: string): number {
  if (colour === 'transparent') return 0;
  const found = /[/,]\s*([\d.]+%?)\s*\)$/.exec(colour);
  if (found?.[1] === undefined || /^(rgb|hsl)\(/.test(colour)) return 1;

  return found[1].endsWith('%') ? parseFloat(found[1]) / 100 : parseFloat(found[1]);
}

test.describe('the calendar under forced colours', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('keeps an outline or a border where the shadows and hatches are dropped', async ({ page, calendarPage }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();

    // Normally: the shadow or the hatch, and no outline or border of their own.
    await page.emulateMedia({ forcedColors: 'none' });
    for (const [index, drawn] of (await drawnTreatments(page)).entries()) {
      const kind = TREATMENTS[index]?.kind;
      if (kind === 'hatch') expect(drawn.backgroundImage, drawn.name).not.toBe('none');
      else expect(drawn.boxShadow, drawn.name).not.toBe('none');
      expect(drawn.outline, drawn.name).toMatch(/^none /);
      expect(drawn.border, drawn.name).toMatch(/^0px /);
      expect(drawn.edge, drawn.name).toMatch(/^0px /);
    }

    // Forced: the browser drops both, and each keeps its own fallback.
    await page.emulateMedia({ forcedColors: 'active' });
    const forced = await drawnTreatments(page);
    for (const [index, drawn] of forced.entries()) {
      const kind = TREATMENTS[index]?.kind;
      if (kind === 'ring') {
        expect(drawn.outline, `${drawn.name} has no outline`).not.toMatch(/^none /);
        // Inset, and no deeper than the cell's padding, so it never covers the label.
        expect(drawn.outlineWidth, `${drawn.name} reaches past its inset`).toBeLessThanOrEqual(drawn.outlineDepth);
        expect(drawn.outlineDepth, `${drawn.name} covers the label`).toBeLessThanOrEqual(drawn.padding);
        // Story 11.3: a ring with the edge keeps a solid bottom band 3 px deeper than itself.
        if (drawn.name.endsWith('-short-staffed')) {
          expect(drawn.edge, `${drawn.name} has no edge`).toBe(`${String(drawn.outlineDepth + 3)}px solid`);
        }
      } else if (kind === 'edge') {
        expect(drawn.outline, drawn.name).toMatch(/^none /);
        expect(drawn.edge, `${drawn.name} has no edge`).toBe('3px solid');
      } else {
        expect(drawn.border, `${drawn.name} has no border`).toMatch(/^[1-9]\d*px (dotted|dashed) /);
      }
    }
    // Still told apart from each other.
    const rings = forced
      .filter((_, index) => TREATMENTS[index]?.kind !== 'hatch')
      .map((drawn) => `${drawn.outline} ${drawn.edge}`);
    const hatches = forced.filter((_, index) => TREATMENTS[index]?.kind === 'hatch').map((drawn) => drawn.border);
    expect(new Set(rings).size).toBe(rings.length);
    expect(new Set(hatches).size).toBe(hatches.length);
  });

  test('a non-working cell keeps its hairline out of the way of the rings (story 7.1)', async ({ page, calendarPage }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();

    // The three rings alone: the short-staffed ones draw the same outline plus their edge.
    const rings = TREATMENTS.filter((treatment) => treatment.kind === 'ring' && !treatment.name.endsWith('-short-staffed')).map(
      (treatment) => treatment.name,
    );
    const bare = `${CELL_PADDING}`;
    const nonworking = `${CELL_PADDING} ${NONWORKING_CLASSES}`;

    // Normally: a 1px outline drawn INSIDE the box, in the token — transparent
    // in light, a faint white in dark — and the box exactly a working cell's.
    await page.emulateMedia({ forcedColors: 'none' });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      const [plain, cell] = await probed(page, [bare, nonworking]);
      if (plain === undefined || cell === undefined) throw new Error('no probe');

      expect(cell.outline, theme).toMatch(/^solid 1px$/);
      expect(cell.outlineOffset, `${theme}: the hairline is not drawn inside the box`).toBeLessThan(0);
      if (theme === 'light') expect(alphaOf(cell.outlineColor), cell.outlineColor).toBe(0);
      else expect(alphaOf(cell.outlineColor), cell.outlineColor).toBeCloseTo(0.07, 2);
      expect({ width: cell.width, height: cell.height }, `${theme}: the hairline takes layout space`).toEqual({
        width: plain.width,
        height: plain.height,
      });
    }

    // Forced: no hairline on its own, and every ring keeps its own outline.
    await page.emulateMedia({ forcedColors: 'active' });
    const [alone] = await probed(page, [nonworking]);
    expect(alone?.outline, 'the hairline shows under forced colours').toMatch(/^none /);

    const ringed = await probed(
      page,
      rings.map((ring) => `${nonworking} ${ring}`),
    );
    const expected: Record<string, RegExp> = {
      'modifier-ring-conflict': /^solid 2px$/,
      'modifier-ring-overridden': /^dashed 2px$/,
      'modifier-ring-conflict-overridden': /^double 4px$/,
    };
    for (const [index, drawn] of ringed.entries()) {
      const ring = rings[index] ?? '';
      expect(drawn.outline, `${ring} on a non-working cell`).toMatch(expected[ring] ?? /^$/);
    }
    expect(new Set(ringed.map((drawn) => drawn.outline)).size).toBe(ringed.length);
  });

  test('shows the focused cell and the sticky header’s edge', async ({ page, calendarPage }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.grid).toBeVisible();

    await calendarPage.exportMenu.focus();
    await page.keyboard.press('Tab');
    await expect(calendarPage.tabStops).toBeFocused();
    const outline = await calendarPage.tabStops.evaluate((cell) => {
      const style = getComputedStyle(cell);

      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style, 'the focused cell shows no focus under forced colours').not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);

    const edges = await calendarPage.headerCells.evaluateAll((cells) =>
      cells.map((cell) => {
        const style = getComputedStyle(cell);

        return `${style.borderBottomStyle} ${style.borderBottomWidth}`;
      }),
    );
    for (const edge of edges) expect(edge, 'a header cell has no edge under forced colours').toMatch(/^solid [1-9]/);

    // STORY 21.3: the header a person sees is the sticky strip, and it keeps the edge too.
    const strip = await calendarPage.strip.evaluate((element) => {
      const style = getComputedStyle(element);

      return `${style.borderBottomStyle} ${style.borderBottomWidth}`;
    });
    expect(strip, 'the sticky strip has no edge under forced colours').toMatch(/^solid [1-9]/);
  });
});
