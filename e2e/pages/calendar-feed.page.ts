import type { Download, Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const copy = hr.feed;

/**
 * `/kalendar-na-mobitelu` (story 16.5): the person's own calendar link and a
 * month's `.ics`, the fixed row that opens it from *Više*, and the member
 * page's *Kalendar na mobitelu* card an admin sees.
 */
export class CalendarFeedPage extends BasePage {
  readonly path = '/kalendar-na-mobitelu';

  /** The *Kalendar na mobitelu* row inside the *Više* sheet. */
  get moreRow(): Locator {
    return this.moreSheet.getByRole('link', { name: copy.nav.name, exact: true });
  }

  /** A line of the screen, by its whole text. */
  line(text: string | RegExp): Locator {
    return this.page.getByText(text, typeof text === 'string' ? { exact: true } : {});
  }

  /** A button of the screen, a dialog's included, by its whole name. */
  button(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** The link as shown once: masked, or whole after *Prikaži*. */
  get url(): Locator {
    return this.page.locator('#calendar-feed-url');
  }

  /** Named with the new-tab hint a screen reader hears after it. */
  get googleLink(): Locator {
    return this.page.getByRole('link', { name: `${copy.google.add} ${copy.google.newTab}`, exact: true });
  }

  get appleLink(): Locator {
    return this.page.getByRole('link', { name: copy.apple.add, exact: true });
  }

  /** Presses *Preuzmi .ics* and answers the browser's download. */
  async downloadMonth(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.button(copy.download.action).click(),
    ]);
    return download;
  }

  /** The whole page's markup, to prove no token is in it. */
  async markup(): Promise<string> {
    return this.page.content();
  }
}
