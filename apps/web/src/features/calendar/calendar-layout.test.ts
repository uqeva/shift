import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CALENDAR_SCREEN_PARTS } from '@/features/calendar/calendar-screen.fixture';

/**
 * Package 3c and story 21.3, the parts of the calendar's layout a source can
 * hold and a browser run cannot: one scroll, the page's (no height bound and
 * no vertical scroller on the grid, a horizontal-only scroller), the sticky
 * strip (outside the scroller, under the phone's head, hidden from assistive
 * technology and print), the pull-up that IS the header height, the scroll
 * margins that ARE the sticky sizes, the phone's form chosen by `usePhone()`,
 * and the one read. The rest is `e2e/tests/calendar/layout.spec.ts`.
 */

const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = (parts: readonly string[]): string =>
  readFileSync(join(srcRoot, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const grid = source(CALENDAR_SCREEN_PARTS.grid);
const hook = source(CALENDAR_SCREEN_PARTS.screenHook);
const binding = source(CALENDAR_SCREEN_PARTS.snapshotHook);

/** Every `className="…"` string in the grid. */
const classes = [...grid.matchAll(/className="([^"]*)"/g)].map(([, value]) => value ?? '');

/** The one element of the grid's source that carries `attribute` (a whole attribute name or `name="value"`), as its tag's text. */
const tagWith = (attribute: string): string => {
  const whole = new RegExp(`\\s${attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s=>/])`);
  const tags = [...grid.matchAll(/<[A-Za-z][^>]*>/g)].map(([tag]) => tag).filter((tag) => whole.test(tag));

  expect(tags, `exactly one element carries ${attribute}`).toHaveLength(1);

  return tags[0] ?? '';
};
const classesOf = (tag: string): string[] => (/className="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);

describe('one scroll, the page’s (story 21.3)', () => {
  it('bounds no part of the grid in height and scrolls nothing in it vertically', () => {
    expect(grid, 'a height bound is back on the grid').not.toMatch(/\bmax-h-|\bh-\[\d+s?d?l?vh\]|svh|dvh|\bvh\b/);
    expect(grid, 'a vertical scroller is back on the grid').not.toMatch(/\boverflow-(auto|scroll|y-auto|y-scroll)\b/);
    expect(grid, 'the grid is inside the table primitive’s overflow-auto wrapper').not.toMatch(/<Table\b/);
  });

  it('scrolls the grid sideways only, in one scroller lifted in print', () => {
    const scroller = classesOf(tagWith('data-grid-scroller'));

    expect(scroller).toEqual(expect.arrayContaining(['overflow-x-auto', 'overflow-y-hidden', 'print:overflow-visible']));
    expect(tagWith('data-grid-scroller'), 'the strip does not follow the scroller sideways').toMatch(/onScroll=/);
  });

  it('isolates the sticky layers in one frame', () => {
    expect(classesOf(tagWith('data-grid-frame'))).toContain('isolate');
  });

  // `max-sm:top-[var(--sticky-head,0px)]` is a guard only: a phone draws the
  // day list, but between `usePhone()`'s `(max-width: 639px)` and `max-sm`
  // (below 640 px) a fractional width draws the grid under `max-sm` CSS.
  it('keeps the strip sticky at the top (guarded under the sticky head at a fractional sub-640 width), hidden from assistive technology, inert and unprinted', () => {
    const tag = tagWith('data-grid-strip');
    const copy = tagWith('data-grid-strip-copy');

    expect(classesOf(tag)).toEqual(
      expect.arrayContaining([
        'sticky',
        'top-0',
        'max-sm:top-[var(--sticky-head,0px)]',
        'print:hidden',
        'forced-colors:border-b',
      ]),
    );
    expect(tag).toMatch(/\baria-hidden\b/);
    // The copy is inert, the strip itself is not: an inert box is no pointer
    // target, so a press would fall through it onto the cell scrolled under.
    expect(tag).not.toMatch(/\binert\b/);
    expect(copy).toMatch(/\binert\b/);
    expect(classesOf(copy)).toEqual(expect.arrayContaining(['h-full', 'overflow-hidden']));
    expect(copy, 'the copy does not follow the scroller sideways').toMatch(/ref=\{strip\}/);
  });

  it('gives the strip’s copy no role, id, handler or tab stop', () => {
    const copy = /function renderStripTable[\s\S]*?\n}\n/.exec(grid)?.[0] ?? '';

    expect(copy, 'no strip table').not.toBe('');
    expect(copy).not.toMatch(/\brole=|\bid=|\bon[A-Z]\w*=|tabIndex|aria-current|data-row|data-column/);
  });
});

describe('the sticky sizes', () => {
  const cell = classes.find((value) => /\bscroll-ml-/.test(value)) ?? '';
  const margin = (axis: 'l' | 't'): string | undefined => new RegExp(`\\bscroll-m${axis}-(\\d+)\\b`).exec(cell)?.[1];
  const corner = classes.find((value) => /\bsticky\b/.test(value) && /\bleft-0\b/.test(value) && /\bz-30\b/.test(value)) ?? '';
  // The header cells are the cells with the header's inset edge: the corner and the team header.
  const header = classes.filter((value) => /\bbg-muted\b/.test(value) && /shadow-\[inset_0_-1px/.test(value));
  const strip = classesOf(tagWith('data-grid-strip'));
  const table = classesOf(tagWith('role="grid"'));

  it('ties the date column width to scroll-margin-left', () => {
    const width = /\bw-(\d+)\b/.exec(corner)?.[1];

    expect(width, 'the date column has no explicit width').toBeDefined();
    expect(corner.split(/\s+/)).toContain(`min-w-${width ?? ''}`);
    expect(margin('l')).toBe(width);
  });

  it('ties the strip height, every header cell, the pull-up and scroll-margin-top together', () => {
    const height = strip.map((value) => /^h-(\d+)$/.exec(value)?.[1]).find((value) => value !== undefined);

    expect(height, 'the strip has no explicit height').toBeDefined();
    expect(header, 'the corner and the team header').toHaveLength(2);
    for (const value of header) expect(/\bh-(\d+)\b/.exec(value)?.[1], 'a header cell is not the strip’s height').toBe(height);
    expect(table, 'the grid is not pulled up by the header height').toContain(`-mt-${height ?? ''}`);
    expect(table, 'the pull-up is not lifted in print').toContain('print:mt-0');
    expect(margin('t')).toBe(height);
  });

  it('never makes a header cell sticky on the vertical axis, which the scroller would hold', () => {
    expect(header.join(' ')).not.toMatch(/\btop-0\b/);
  });
});

describe('the phone’s form (story 21.3)', () => {
  const dayList = source(CALENDAR_SCREEN_PARTS.dayList);

  it('is chosen by usePhone(), so exactly one form is in the DOM', () => {
    expect(grid).toMatch(/const isPhone = usePhone\(\);/);
    expect(grid).toMatch(/if \(isPhone\) \{\s*return <CalendarTeamDays\b/);
  });

  it('is a day list of every shown team, named by the month heading, each team a button that opens its day', () => {
    const teamDays = /export function CalendarTeamDays[\s\S]*?\n}\n/.exec(dayList)?.[0] ?? '';

    expect(teamDays, 'no CalendarTeamDays').not.toBe('');
    expect(teamDays).toMatch(/aria-labelledby=\{MONTH_HEADING_ID\}/);
    expect(teamDays).toMatch(/aria-current=\{row\.isToday \? 'date' : undefined\}/);
    expect(teamDays).toMatch(/aria-haspopup=\{DAY_DETAIL_POPUP\}/);
    expect(teamDays).toMatch(/aria-label=\{labels\?\.\[rowIndex\]\?\.\[column\]\}/);
    expect(teamDays).toMatch(/openDay\(cell\.teamId, row\.date, event\.currentTarget\)/);
    expect(teamDays, 'the buttons do not wrap').toMatch(/grid-cols-\[repeat\(auto-fill,/);
    // Capped at the row's width (a container, `100cqi`): the calendar's source
    // holds no `%` (the "only reads" sweep in `snapshot.test.ts`).
    expect(teamDays, 'the row is not a container').toMatch(/className="@container min-w-0 flex-1"/);
    expect(teamDays, 'a large root font makes a track wider than the row').toMatch(/minmax\(min\(6\.5rem,100cqi\),1fr\)/);
    expect(teamDays, 'a long word overflows its button').toMatch(/\[overflow-wrap:anywhere\]/);
  });
});

describe('the calendar makes one schedule read, one leave read by role (story 5.3c), and an admin\'s resolution read (story 5.4a)', () => {
  it('holds exactly four reads in the screen hook — the snapshot through its one binding, the two leave reads only one role enables, and the resolutions only an admin enables — and no other way to fetch', () => {
    expect(hook.split('useCalendarSnapshot(').length - 1).toBe(1);
    expect(hook.split('useQuery(').length - 1).toBe(3);
    expect(hook.split('calendarQueryOptions(').length - 1).toBe(0);
    expect(binding.split('useQuery(').length - 1).toBe(1);
    expect(binding.split('calendarQueryOptions(').length - 1).toBe(1);
    expect(hook.split('organizationLeaveRecordsQueryOptions(').length - 1).toBe(1);
    expect(hook.split('myLeaveRecordsQueryOptions(').length - 1).toBe(1);
    expect(hook.split('organizationConflictResolutionsQueryOptions(').length - 1).toBe(1);
    // A member is shown no conflict, so the calendar never reads their own resolutions.
    expect(hook.split('myConflictResolutionsQueryOptions(').length - 1).toBe(0);
    expect(hook.split('enabled:').length - 1).toBe(3);
    expect(hook).not.toMatch(/\b(fetchQuery|ensureQueryData|prefetchQuery|fetchInfiniteQuery|refetchQueries)\b/);
  });
});

describe('the calendar snapshot has one binding (deferred work from 7.13c)', () => {
  /** Every non-test module under `src`, as its path from `src` and its source without comments. */
  const modules = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: source([name]) }));

  it('calls `calendarQueryOptions(` nowhere but its definition and the one binding, so every screen shares the key by construction', () => {
    const callers = modules.filter(({ text }) => text.includes('calendarQueryOptions(')).map(({ name }) => name).sort();

    expect(callers).toEqual([
      join('features', 'calendar', 'hooks', 'use-calendar-snapshot.ts'),
      join('features', 'calendar', 'services', 'snapshot.ts'),
    ]);
  });

  it('is what the screens that read the snapshot observe it through', () => {
    const observers = modules.filter(({ text }) => /\buseCalendarSnapshot\(\)/.test(text)).map(({ name }) => name);

    expect(observers.length, 'no screen reads the snapshot through the binding').toBeGreaterThanOrEqual(10);
  });
});

describe("a change dialog's preview reads on the panel (story 15.4)", () => {
  // The panel is glass, so the box under *Što se mijenja* is a reading
  // surface: an opaque `muted` fill, never a translucent one.
  const preview = source(['features', 'calendar', 'components', 'change-preview-output.tsx']);

  it('fills the box with opaque bg-muted, never an alpha of it', () => {
    expect(preview).toMatch(/\bbg-muted\b(?!\/)/);
    expect(preview, 'the preview box is a translucent muted fill').not.toMatch(/bg-muted\//);
  });
});
