import type { Locator, Page } from '@playwright/test';

import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';

const filter = hr.filter;

/** `Tim: ` — what the Tim chip's name starts with (`Smjena: ` before story 21.22). */
const TEAM_CHIP = new RegExp(`^${escapeRegExp(filter.chip.team.replace('{value}', ''))}`);

/** `Osoba: ` — what the Osoba chip's name starts with. */
const PERSON_CHIP = new RegExp(`^${escapeRegExp(filter.chip.person.replace('{value}', ''))}`);

/** `Prikazano:` — what every summary starts with. */
const SUMMARY = new RegExp(`^${escapeRegExp(filter.summary.all.split(' ')[0] ?? '')}`);

/** `Svi timovi` — the Tim picker's first option, whatever it counts. */
const ALL_TEAMS = new RegExp(`^${escapeRegExp(filter.allTeams.replace(/ \(\{count\}\)$/, ''))}`);

/** `Filtri`, or `Filtri, aktivno: 2` while filters are on (story 15.7). */
const FILTRI = new RegExp(
  `^${escapeRegExp(filter.open)}(?:${escapeRegExp(filter.openActive.replace(/^[^,]*/, '')).replace(escapeRegExp('{count}'), '\\d+')})?$`,
);

/**
 * An ICU message with simple `{name}` placeholders and at most one plural
 * argument named `countName`, filled the way the app fills it: the
 * placeholders by `fill`, the plural through `plural` for `count`.
 */
export function filterText(
  message: string,
  values: Readonly<Record<string, string>>,
  plural_?: { readonly name: string; readonly count: number },
): string {
  const filled = fill(message, values);

  return plural_ === undefined ? filled : plural(filled.replace(`{${plural_.name}, plural,`, '{count, plural,'), plural_.count);
}

/** `Filtri` or `Aktivni filtri`: the two groups the bar draws in the compact toolbar (story 21.23). */
const BAR_GROUP = new RegExp(`^(?:${escapeRegExp(filter.label)}|${escapeRegExp(filter.activeLabel)})$`);

/**
 * THE SHARED FILTER BAR'S LOCATORS (stories 7.5, 15.7, 21.23): the one
 * pattern *Kalendar*'s *Sve smjene*, *Sati*'s organization table, *Ljudi*,
 * *Godišnji*'s overview and *Povijest promjena* render at every width —
 * `Filtri` (in the compact page toolbar since story 21.23, in its own group;
 * on *Sati* still in the summary card), the `role="status"` result line, one
 * removable chip per active filter with `Očisti sve` (in the toolbar their own
 * group, `Aktivni filtri`), and the *Filtri* panel — a bottom sheet below
 * 1024 px, a dropdown under `Filtri` from it — where each filter is a field
 * whose value is picked in a searchable picker, with the live result line,
 * `Očisti` and `Primijeni`. Locators and actions only, never an assertion
 * (`e2e/README.md`).
 */
export class FilterBarParts {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * The bar's groups: `Filtri` (the toolbar's trigger, or *Sati*'s summary
   * card with its chips) and, while a chip is drawn in the toolbar,
   * `Aktivni filtri`. Chain from it; assert on `filtriButton` or a chip.
   */
  get bar(): Locator {
    return this.page.getByRole('group', { name: BAR_GROUP });
  }

  /** The active Smjena chip's body (drawn only while a team is chosen). */
  get teamChip(): Locator {
    return this.bar.getByRole('button', { name: TEAM_CHIP });
  }

  /** The active Osoba chip's body (drawn only while a person is chosen). */
  get personChip(): Locator {
    return this.bar.getByRole('button', { name: PERSON_CHIP });
  }

  /** The Smjena chip's text for `team`. */
  teamChipText(team: string): string {
    return fill(filter.chip.team, { value: team });
  }

  /** The Osoba chip's text for `person`. */
  personChipText(person: string): string {
    return fill(filter.chip.person, { value: person });
  }

  /** The Smjena chip's ✕ while `team` is chosen. */
  removeTeam(team: string): Locator {
    return this.page.getByRole('button', { name: fill(filter.remove.team, { value: team }), exact: true });
  }

  /** The Osoba chip's ✕ while `person` is chosen. */
  removePerson(person: string): Locator {
    return this.page.getByRole('button', { name: fill(filter.remove.person, { value: person }), exact: true });
  }

  /** The summary line under the toolbar: `Prikazano: …` — not the panel's copy of it. */
  get summary(): Locator {
    return this.page.getByRole('status').filter({ hasText: SUMMARY }).and(this.page.locator(':not(dialog *)'));
  }

  /** `Očisti sve`, after the chips. */
  get clearButton(): Locator {
    return this.bar.getByRole('button', { name: filter.clearAll, exact: true });
  }

  /** `Filtri`, or `Filtri, aktivno: N`, in the summary card. */
  get filtriButton(): Locator {
    return this.bar.getByRole('button', { name: FILTRI });
  }

  /** `Filtri`'s name for `count` filters on: `Filtri` with none. */
  filtriName(count: number): string {
    return count === 0 ? filter.open : fill(filter.openActive, { count: String(count) });
  }

  // ---------------------------------------------------------- the sheet

  /** The *Filtri* sheet. */
  get sheet(): Locator {
    return this.page.getByRole('dialog', { name: filter.sheetTitle, exact: true });
  }

  /** A field of the sheet, by its label (`Smjena`): named by the label and the value chosen. */
  field(label: string): Locator {
    return this.sheet
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(label)} `) })
      .and(this.page.locator('[aria-haspopup="dialog"]'));
  }

  /** The Smjena field. */
  get teamField(): Locator {
    return this.field(filter.team);
  }

  /** The Osoba field. */
  get personField(): Locator {
    return this.field(filter.person);
  }

  /** A field's accessible name: its label, then the value chosen. */
  fieldName(label: string, value: string): string {
    return `${label} ${value}`;
  }

  /** A picker, open, by its name: `Odaberi smjenu`. */
  picker(name: string): Locator {
    return this.page.getByRole('dialog', { name, exact: true });
  }

  /** The Smjena picker, open. */
  get teamPicker(): Locator {
    return this.picker(filter.teamPicker);
  }

  /** The Osoba picker, open. */
  get personPicker(): Locator {
    return this.picker(filter.personPicker);
  }

  /** A picker's search for the field labelled `label`: `Pretraži: Smjena`. */
  optionSearch(label: string): Locator {
    return this.page.getByRole('searchbox', { name: fill(filter.optionSearch, { label }), exact: true });
  }

  /** `Nema rezultata`, in an open picker. */
  get noMatch(): Locator {
    return this.page.getByText(filter.noMatch, { exact: true });
  }

  /** `Sve smjene (4)` in the Smjena picker. */
  allTeamsOption(count: number): Locator {
    return this.teamPicker.getByRole('button', { name: fill(filter.allTeams, { count: String(count) }), exact: true });
  }

  /** A team in the Smjena picker: its name, then its person count. */
  teamOption(team: string): Locator {
    return this.teamPicker.getByRole('button', { name: new RegExp(`^${escapeRegExp(team)}\\s*\\d`) });
  }

  /** Every team in the Smjena picker. */
  get teamOptions(): Locator {
    return this.teamPicker.getByRole('button').filter({ hasNotText: ALL_TEAMS });
  }

  /** The Osoba picker's search, `Traži osobu (17)`. */
  get personSearch(): Locator {
    return this.page.getByRole('searchbox', { name: new RegExp(`^${escapeRegExp(filter.search.replace(/ \(\{count\}\)$/, ''))}`) });
  }

  /** `1 od 17`, under the search. */
  matches(shown: number, total: number): Locator {
    return this.page.getByText(fill(filter.matches, { shown: String(shown), total: String(total) }), { exact: true });
  }

  /** `{shown} od {any}`, under the search, whatever the total. */
  matchesOf(shown: number): Locator {
    const pattern = escapeRegExp(fill(filter.matches, { shown: String(shown), total: '\u0000' })).replace('\u0000', '\\d+');

    return this.page.getByText(new RegExp(`^${pattern}$`));
  }

  /** The summary line's text for `message`, filled. */
  summaryText(
    message: string,
    values: Readonly<Record<string, string>>,
    count?: { readonly name: string; readonly count: number },
  ): string {
    return filterText(message, values, count);
  }

  /** A person in the Osoba picker. */
  personOption(person: string): Locator {
    return this.personPicker.getByRole('button', { name: person, exact: true });
  }

  /** A group heading in the Osoba picker: a team's name, or `Bez smjene`. */
  personGroup(name: string): Locator {
    return this.personPicker.getByText(name, { exact: true });
  }

  /** The panel's live result line, above its buttons (story 21.23): the screen's own summary. */
  get sheetSummary(): Locator {
    return this.sheet.getByRole('status');
  }

  /** The panel's `Primijeni`, which closes it (story 21.23). */
  get sheetApply(): Locator {
    return this.sheet.getByRole('button', { name: filter.sheetApply, exact: true });
  }

  /** The panel's `Očisti`. */
  get sheetReset(): Locator {
    return this.sheet.getByRole('button', { name: filter.sheetReset, exact: true });
  }

  /** The sheet's close. */
  get sheetClose(): Locator {
    return this.sheet.getByRole('button', { name: filter.sheetClose, exact: true });
  }

  /** The sheet's note that a person replaces the team (Kalendar). */
  get replaceNote(): Locator {
    return this.sheet.getByText(filter.replaceNote, { exact: true });
  }

  // ---------------------------------------------------------- actions

  /** Opens the sheet through `Filtri`, unless it is open already. */
  async openSheet(): Promise<void> {
    if (await this.sheet.isVisible()) return;
    await this.filtriButton.click();
    await this.sheet.waitFor();
  }

  /** Closes the panel through `Primijeni`, and waits for it to go. */
  async showResults(): Promise<void> {
    await this.sheetApply.click();
    await this.sheet.waitFor({ state: 'hidden' });
  }

  /** In the open sheet, opens the field labelled `label` and presses `option` in its picker. */
  async pickIn(label: string, option: Locator): Promise<void> {
    await this.field(label).click();
    await option.click();
  }

  /** Opens the sheet, chooses `team` in the Smjena picker, and closes the sheet. */
  async chooseTeam(team: string): Promise<void> {
    await this.openSheet();
    await this.pickIn(filter.team, this.teamOption(team));
    await this.showResults();
  }

  /** Opens the sheet, chooses `person` in the Osoba picker, and closes the sheet. */
  async choosePerson(person: string): Promise<void> {
    await this.openSheet();
    await this.pickIn(filter.person, this.personOption(person));
    await this.showResults();
  }
}
