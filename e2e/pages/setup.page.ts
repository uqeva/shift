import type { Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const words = hr.postaviRaspored;

/**
 * *Timovi i raspored* (`/timovi-i-raspored`, story 21.26): the type strip,
 * a card per team, *Ljudi bez turnusa*, the person picker, and the member
 * page's dialogs opened over it. Locators and actions only, never an
 * assertion (`e2e/README.md`).
 */
export class SetupPage extends BasePage {
  readonly path = '/timovi-i-raspored';

  /** One team's card, by its heading. */
  teamCard(team: string): Locator {
    return this.page.getByRole('region', { name: team, exact: true });
  }

  /** A team card's member chips. */
  membersOf(team: string): Locator {
    return this.teamCard(team).getByRole('list', { name: words.team.members, exact: true });
  }

  /** A member chip's ✕: the member page's team dialog with *Bez tima* picked. */
  removeButton(name: string, team: string): Locator {
    return this.page.getByRole('button', { name: fill(words.team.remove, { name, team }), exact: true });
  }

  addMemberButton(team: string): Locator {
    return this.page.getByRole('button', { name: fill(words.team.addMemberNamed, { team }), exact: true });
  }

  /** A team's rotation strip. */
  stripOf(team: string): Locator {
    return this.page.getByRole('list', { name: fill(words.team.rotationLabel, { team }), exact: true });
  }

  /** The person picker, for a team's add or for *Postavi raspored osobe*. */
  pickDialog(title: string): Locator {
    return this.page.getByRole('dialog', { name: title, exact: true });
  }

  get setScheduleButton(): Locator {
    return this.page.getByRole('button', { name: words.people.set, exact: true });
  }

  get peopleSection(): Locator {
    return this.page.getByRole('region', { name: words.people.heading, exact: true });
  }

  /** A team card's *Uredi tim*. */
  editTeamButton(team: string): Locator {
    return this.page.getByRole('button', { name: fill(words.team.editNamed, { team }), exact: true });
  }

  /** The team dialog (`/ljudi/smjene/$id`'s own), opened over this page. */
  get teamEditDialog(): Locator {
    return this.page.getByRole('dialog', { name: hr.smjene.editHeading, exact: true });
  }

  /** The member page's team dialog, opened over this page. */
  get teamDialog(): Locator {
    return this.page.getByRole('dialog', { name: hr.smjene.membership.dialogHeading, exact: true });
  }

  /** *Raspored osobe*'s form and *Što se mijenja*, opened over this page. */
  get scheduleDialog(): Locator {
    return this.page.getByRole('dialog', { name: hr.rasporedOsobe.title, exact: true });
  }

  get schedulePreview(): Locator {
    return this.page.getByRole('dialog', { name: hr.rasporedOsobe.preview.title, exact: true });
  }
}
