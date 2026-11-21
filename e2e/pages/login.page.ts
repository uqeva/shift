import { expect, type Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/**
 * `/prijava` and `/prijava/:slug`: one sign-in form (story 7.7). With a slug in
 * the URL the organization is a read-only row with `Promijeni`; without one it
 * is a field, prefilled from the last organization signed into on this device.
 */
export class LoginPage extends BasePage {
  readonly path = '/prijava';

  /** The brand panel's ink tile icon (from `lg` up). It is decorative
   *  (`aria-hidden`), so it is found by the icon facade's stable hook. */
  get brandTileIcon(): Locator {
    return this.page.locator('[data-icon="calendar-blank"]');
  }

  /** The brand panel's product name (from `lg` up). */
  get brandName(): Locator {
    return this.page.getByText(hr.auth.brand.name, { exact: true });
  }

  /** The sign-in form's h1. */
  get signInHeading(): Locator {
    return this.heading(hr.auth.heading);
  }

  /** The organization field, on bare `/prijava` or after `Promijeni`. */
  get organizationInput(): Locator {
    return this.page.getByRole('textbox', { name: hr.auth.organization.label, exact: true });
  }

  /** The URL slug's read-only row, on `/prijava/:slug`. */
  get organizationRow(): Locator {
    return this.page.getByRole('group', { name: hr.auth.organization.label, exact: true });
  }

  /** Promijeni, on the URL slug's row. */
  get changeOrganizationButton(): Locator {
    return this.page.getByRole('button', { name: hr.auth.organization.changeLabel, exact: true });
  }

  get usernameInput(): Locator {
    return this.page.getByLabel(hr.auth.username, { exact: true });
  }

  get passwordInput(): Locator {
    return this.page.getByLabel(hr.auth.password, { exact: true });
  }

  /** Prikaži lozinku, the toggle inside the password field. */
  get passwordToggle(): Locator {
    return this.page.getByRole('button', { name: hr.auth.passwordShow, exact: true });
  }

  /** Prijava, or Prijava… while signing in: the one submit button, by type,
   *  since its name changes while the exchange is in flight. */
  get submitButton(): Locator {
    return this.page.locator('form button[type="submit"]');
  }

  /** Zaboravljena lozinka?, the disclosure under the button. */
  get forgotButton(): Locator {
    return this.page.getByRole('button', { name: hr.auth.forgot.trigger, exact: true });
  }

  /** The panel the disclosure opens. */
  get forgotPanel(): Locator {
    return this.page.locator('#forgot-password');
  }

  /** Retro 10 A5: the offer a signed-in visitor gets on another organization's link. */
  get switchHeading(): Locator {
    return this.heading(hr.auth.switch.heading);
  }

  /** The offer's text, naming both organizations by slug. */
  switchBody(current: string, target: string): Locator {
    return this.page.getByText(fill(hr.auth.switch.body, { current, target }), { exact: true });
  }

  /** Sign out of this organization and open the other one's form. */
  switchButton(target: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.auth.switch.switch, { target }), exact: true });
  }

  /** Stay signed in to this organization. */
  stayButton(current: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.auth.switch.stay, { current }), exact: true });
  }

  // ------------------------------------------------- story 19.2: signup screens

  /** *Prijava*'s way to `/registracija` (bare `/prijava` only). */
  get registerLink(): Locator {
    return this.page.getByRole('link', { name: hr.signup.signIn.registerLink, exact: true });
  }

  /** The hint the organization field shows while the entry is an address. */
  get emailOrganizationHint(): Locator {
    return this.page.locator('#organization-hint');
  }

  /** The forgot panel's *Nova lozinka e-mailom*. */
  get recoverByEmailLink(): Locator {
    return this.page.getByRole('link', { name: hr.signup.forgot.emailLink, exact: true });
  }

  /** The address field of `/registracija` and `/zaboravljena-lozinka`. */
  get signupEmailInput(): Locator {
    return this.page.getByLabel(hr.signup.form.email, { exact: true });
  }

  get signupPasswordInput(): Locator {
    return this.page.getByLabel(hr.signup.form.password, { exact: true });
  }

  get signupButton(): Locator {
    return this.page.getByRole('button', { name: hr.signup.form.submit, exact: true });
  }

  get recoverButton(): Locator {
    return this.page.getByRole('button', { name: hr.signup.recover.submit, exact: true });
  }

  /** The Callout telling a member of an existing organization not to register. */
  get memberCallout(): Locator {
    return this.page.getByText(hr.signup.member.heading, { exact: true });
  }

  /** The neutral screen's sentence and the address it shows. */
  get sentBody(): Locator {
    return this.page.getByText(hr.signup.sent.body, { exact: true });
  }

  sentAddress(address: string): Locator {
    return this.page.getByText(fill(hr.signup.sent.typed, { address }), { exact: true });
  }

  /** *Pošalji ponovno*, while the throttle runs (its name carries the time). */
  get resendWaiting(): Locator {
    const [before = '', after = ''] = hr.signup.sent.resendIn.split('{time}');
    return this.page.getByRole('button', { name: new RegExp(`^${before}\\d:\\d\\d${after}$`) });
  }

  get correctAddressButton(): Locator {
    return this.page.getByRole('button', { name: hr.signup.sent.correct, exact: true });
  }

  /** `/potvrda`'s one press. */
  get confirmButton(): Locator {
    return this.page.getByRole('button', { name: hr.signup.confirm.submit, exact: true });
  }

  /** The real sign-in from bare `/prijava`, through GoTrue. Leaves the page
   *  wherever the attempt lands. */
  async submitSignIn(slug: string, username: string, password: string): Promise<void> {
    await this.goto();
    await this.continueSignIn(slug, username, password);
  }

  /** The same from wherever the form already is — after a signed-out
   *  redirect, whose return target rides the URL as `povratak`. */
  async continueSignIn(slug: string, username: string, password: string): Promise<void> {
    await this.fillCredentialsFor(slug, username, password);
    await this.submitButton.click();
  }

  /** Organization, username and password, without submitting. On a slug URL
   *  the row already names the organization, so only the two credentials are
   *  typed; otherwise the field is filled, replacing any prefill. */
  async fillCredentialsFor(slug: string, username: string, password: string): Promise<void> {
    await expect(this.usernameInput).toBeVisible();

    if (await this.organizationInput.isVisible()) {
      await this.organizationInput.fill(slug);
    } else {
      await expect(this.organizationRow).toContainText(slug);
    }

    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  /** Signs in and waits for the landing destination. */
  async signIn(slug: string, username: string, password: string): Promise<void> {
    await this.submitSignIn(slug, username, password);
    await expect(this.page).toHaveURL('/danas');
    await expect(this.heading(hr.nav.danas)).toBeVisible();
  }
}
