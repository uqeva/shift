import type { Locator } from '@playwright/test';

import { fullDate } from '../utils/dates.ts';
import { fill, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { ErasureDialogParts } from './erasure-dialog.ts';

const words = hr.rucniRaspored;

/**
 * *Ručni raspored* (`/rucni-raspored`, stories 21.4 and 21.5): the grid, the
 * picker, *Popuni uzorkom*, *Kopiraj*, the save bar, *Što se mijenja* and the
 * save's erasure confirmation. Locators and actions only, never an assertion
 * (`e2e/README.md`).
 */
export class ManualSchedulePage extends BasePage {
  readonly path = '/rucni-raspored';

  /** Opens the month `YYYY-MM`. */
  async gotoMonth(month: string): Promise<void> {
    await this.goto(`?mjesec=${month}`);
  }

  /** A member's cell on a date: the `gridcell` the screen ids by both. */
  cellOf(memberId: string, date: string): Locator {
    return this.page.locator(`[id="rucni-${memberId}-${date}"]`);
  }

  /** The picker, open on one cell (`{name} · {date}`). */
  pickerOf(name: string, date: string): Locator {
    return this.page.getByRole('dialog', { name: fill(words.picker.titleOne, { name, date: fullDate(date) }) });
  }

  /** A choice of an open picker: a type by its name, *Slobodno* or *Očisti*. */
  choiceIn(picker: Locator, name: string): Locator {
    return picker.getByRole('button', { name, exact: true });
  }

  // ------------------------------------------------------------ fill and copy

  get fillButton(): Locator {
    return this.page.getByRole('button', { name: words.fill.open, exact: true });
  }

  get copyButton(): Locator {
    return this.page.getByRole('button', { name: words.copy.open, exact: true });
  }

  get fillDialog(): Locator {
    return this.page.getByRole('dialog', { name: words.fill.title, exact: true });
  }

  get copyDialog(): Locator {
    return this.page.getByRole('dialog', { name: words.copy.title, exact: true });
  }

  /** A person's checkbox in a fill or copy dialog. */
  personIn(dialog: Locator, name: string): Locator {
    return dialog.getByRole('checkbox', { name, exact: true });
  }

  /** A step row's choice, by its position from 1. */
  stepChoiceIn(dialog: Locator, position: number): Locator {
    return dialog.getByLabel(fill(words.fill.choice, { position: String(position) }), { exact: true });
  }

  /** A step row's count of days, by its position from 1. */
  stepCountIn(dialog: Locator, position: number): Locator {
    return dialog.getByLabel(fill(words.fill.count, { position: String(position) }), { exact: true });
  }

  // ------------------------------------------------------------ the save

  /** The save bar's line for `count` unsaved changes. */
  unsaved(count: number): Locator {
    return this.page.getByText(plural(words.bar.count, count), { exact: true });
  }

  /** The save bar's line after a fill or copy drafted `count` days. */
  placedLine(count: number): Locator {
    return this.page.getByText(plural(words.plan.placed, count), { exact: true });
  }

  /** The save bar's line after a fill or copy left out `count` days naming an archived type or team. */
  skippedLine(count: number): Locator {
    return this.page.getByText(plural(words.plan.skipped, count), { exact: true });
  }

  /** The save bar's line once a save wrote `count` days. */
  savedLine(count: number): Locator {
    return this.page.getByText(plural(words.bar.saved, count), { exact: true });
  }

  /** The save bar's *Spremi* (the dialogs' own *Spremi* are inside a `<dialog>`). */
  get saveButton(): Locator {
    return this.main.getByRole('button', { name: words.bar.save, exact: true }).and(this.page.locator(':not(dialog *)'));
  }

  /** *Što se mijenja*. */
  get preview(): Locator {
    return this.page.getByRole('dialog', { name: words.preview.title, exact: true });
  }

  /** *Što se mijenja*'s own *Spremi*. */
  get previewSave(): Locator {
    return this.preview.getByRole('button', { name: words.preview.save, exact: true });
  }

  /** The save's erasure confirmation, in the member page's words with its own save. */
  get erasures(): ErasureDialogParts {
    return new ErasureDialogParts(this.page, { ...hr.ljudi.erasures, save: words.confirm });
  }
}
